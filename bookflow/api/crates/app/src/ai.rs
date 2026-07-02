use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use bookflow_domain::{Beat, Score, Tier};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::{sleep, Instant};
use tracing::{error, warn};

/// 后端用的 AI 配置（从 env 读，运行时可被 Settings 接口热替换）
#[derive(Clone, Debug)]
pub struct AiConfig {
    pub provider: Provider,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub image_model: String,
    pub duomiapi_key: String,
    pub timeout: Duration,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    Anthropic,
    Openai,
}

impl Provider {
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "openai" | "azure" | "google" => Provider::Openai,
            // deepseek ccswitch 走 Anthropic Messages 协议
            "deepseek" => Provider::Anthropic,
            _ => Provider::Anthropic,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
        }
    }
}

impl AiConfig {
    pub fn from_env() -> Result<Self> {
        let provider =
            Provider::parse(&std::env::var("AI_PROVIDER").unwrap_or_else(|_| "anthropic".into()));
        let base_url = std::env::var("AI_BASE_URL").context("AI_BASE_URL 未设置")?;
        let api_key = std::env::var("AI_API_KEY").context("AI_API_KEY 未设置")?;
        let model = std::env::var("AI_MODEL").context("AI_MODEL 未设置")?;
        let image_model = std::env::var("AI_IMAGE_MODEL").unwrap_or_else(|_| "gpt-image-2".into());
        let duomiapi_key = std::env::var("DOMIAPI_KEY").unwrap_or_default();
        let timeout = Duration::from_secs(
            std::env::var("AI_TIMEOUT_SECS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(60),
        );
        Ok(Self {
            provider,
            base_url,
            api_key,
            model,
            image_model,
            duomiapi_key,
            timeout,
        })
    }
}

#[derive(Clone)]
pub struct AiClient {
    cfg: Arc<RwLock<AiConfig>>,
    http: reqwest::Client,
    /// 全局限速闸门：记录「下一次最早可发请求」的时刻。所有 AI 调用串行过闸，
    /// 把瞬时并发摊平成错峰，避免一次性打空上游共享账号池（503 No available accounts）。
    rate_gate: Arc<Mutex<Instant>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedImage {
    pub model: String,
    pub prompt: String,
    pub mime_type: String,
    pub data_url: String,
}

impl AiClient {
    pub fn new(cfg: AiConfig) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(cfg.timeout)
            .build()
            .context("构建 reqwest client 失败")?;
        Ok(Self {
            cfg: Arc::new(RwLock::new(cfg)),
            http,
            rate_gate: Arc::new(Mutex::new(Instant::now())),
        })
    }

    /// 全局限速：每次 AI 请求发起前调用。串行抢闸 + 按最小间隔放行，
    /// 把瞬时并发摊平。间隔由 AI_MIN_INTERVAL_MS 控制（默认 350ms，0=不限速）。
    async fn throttle(&self) {
        let interval_ms: u64 = std::env::var("AI_MIN_INTERVAL_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(350);
        if interval_ms == 0 {
            return;
        }
        let interval = Duration::from_millis(interval_ms);
        let mut next = self.rate_gate.lock().await;
        let now = Instant::now();
        if *next > now {
            let wait = *next - now;
            sleep(wait).await;
            *next += interval;
        } else {
            *next = now + interval;
        }
    }

    /// 热替换配置（Settings PUT 后调用）。注意：timeout 改了不会重建 http client，下次重启生效。
    pub async fn reload(&self, cfg: AiConfig) {
        *self.cfg.write().await = cfg;
    }

    pub async fn snapshot(&self) -> AiConfig {
        self.cfg.read().await.clone()
    }

    pub async fn generate_image(
        &self,
        prompt: &str,
        size: &str,
        quality: &str,
    ) -> Result<GeneratedImage> {
        let cfg = self.cfg.read().await.clone();
        // 优先走多米 API（如果 key 已配置）
        if !cfg.duomiapi_key.is_empty() {
            let duomi = DuoMiClient::new(cfg.duomiapi_key.clone());
            match duomi
                .blocking_generate_image(&cfg.image_model, prompt, size, quality)
                .await
            {
                Ok(img) => return Ok(img),
                Err(e) => {
                    // 多米异步接口失败，fallback 到标准 OpenAI 同步接口（用 duomiapi_key 鉴权）
                    tracing::warn!(err = %e, "多米生图失败，fallback 到 OpenAI 同步接口");
                    let mut fallback_cfg = cfg.clone();
                    fallback_cfg.api_key = cfg.duomiapi_key.clone();
                    return self.generate_openai_image(&fallback_cfg, prompt, size, quality).await;
                }
            }
        }
        match cfg.provider {
            Provider::Openai => {
                self.generate_openai_image(&cfg, prompt, size, quality)
                    .await
            }
            Provider::Anthropic => {
                // Anthropic provider 不支持生图，但如果 base_url 兼容 OpenAI 格式，尝试走 OpenAI 路径
                self.generate_openai_image(&cfg, prompt, size, quality).await
            }
        }
    }

    /// 发一段 user 消息，让模型严格回 JSON。返回模型的纯文本响应。
    pub async fn complete_json(&self, system: &str, user: &str) -> Result<String> {
        let cfg = self.cfg.read().await.clone();
        match cfg.provider {
            Provider::Anthropic => self.complete_anthropic(&cfg, system, user).await,
            Provider::Openai => self.complete_openai(&cfg, system, user).await,
        }
    }

    async fn complete_anthropic(&self, cfg: &AiConfig, system: &str, user: &str) -> Result<String> {
        let url = format!("{}/v1/messages", cfg.base_url.trim_end_matches('/'));
        for attempt in 1..=MAX_AI_ATTEMPTS {
            self.throttle().await;
            let body = json!({
                "model": cfg.model,
                "max_tokens": 4096,
                "system": anthropic_system_field(system),
                "messages": [{"role": "user", "content": user}],
            });
            let send = self
                .http
                .post(&url)
                .header("Authorization", format!("Bearer {}", cfg.api_key))
                .header("x-api-key", &cfg.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await;
            match send {
                Ok(resp) => {
                    let status = resp.status();
                    let text = resp.text().await.context("读 anthropic 响应失败")?;
                    if status.is_success() {
                        let parsed: AnthropicResp = serde_json::from_str(&text)
                            .with_context(|| format!("解析 anthropic 响应失败: {text}"))?;
                        let truncated = parsed.stop_reason.as_deref() == Some("max_tokens");
                        let out = parsed
                            .content
                            .into_iter()
                            .filter_map(|b| match b {
                                AnthropicBlock::Text { text } => Some(text),
                                _ => None,
                            })
                            .collect::<Vec<_>>()
                            .join("");
                        if truncated {
                            // 输出被 max_tokens 截断，JSON 必然不完整，提前给出可读错误
                            return Err(anyhow!(
                                "AI 输出超长被截断（stop_reason=max_tokens），请缩短章节或重试"
                            ));
                        }
                        return Ok(out);
                    }

                    let retryable = should_retry_status(status) || body_is_retryable(&text);
                    if retryable && attempt < MAX_AI_ATTEMPTS {
                        warn!(
                            attempt,
                            max_attempts = MAX_AI_ATTEMPTS,
                            %status,
                            "anthropic completion failed with retryable response, retrying"
                        );
                        sleep(retry_delay(attempt)).await;
                        continue;
                    }
                    return Err(anyhow!("anthropic {} : {}", status, text));
                }
                Err(err) => {
                    if should_retry_transport(&err) && attempt < MAX_AI_ATTEMPTS {
                        warn!(
                            attempt,
                            max_attempts = MAX_AI_ATTEMPTS,
                            err = %err,
                            "anthropic completion transport failed, retrying"
                        );
                        sleep(retry_delay(attempt)).await;
                        continue;
                    }
                    return Err(anyhow::Error::new(err).context("调 anthropic 失败（连接/超时）"));
                }
            }
        }
        unreachable!("anthropic completion retry loop must return")
    }

    async fn complete_openai(&self, cfg: &AiConfig, system: &str, user: &str) -> Result<String> {
        if openai_uses_responses_api(cfg) {
            return self.complete_openai_responses(cfg, system, user).await;
        }
        let url = format!("{}/v1/chat/completions", cfg.base_url.trim_end_matches('/'));
        for attempt in 1..=MAX_AI_ATTEMPTS {
            self.throttle().await;
        let body = json!({
                "model": cfg.model,
                "temperature": 0.4,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            });
            let send = self
                .http
                .post(&url)
                .bearer_auth(&cfg.api_key)
                .json(&body)
                .send()
                .await;
            match send {
                Ok(resp) => {
                    let status = resp.status();
                    let text = resp.text().await.context("读 openai 响应失败")?;
                    if status.is_success() {
                        let parsed: OpenAiResp = serde_json::from_str(&text)
                            .with_context(|| format!("解析 openai 响应失败: {text}"))?;
                        let out = parsed
                            .choices
                            .into_iter()
                            .next()
                            .map(|c| c.message.content)
                            .unwrap_or_default();
                        return Ok(out);
                    }

                    if should_retry_status(status) && attempt < MAX_AI_ATTEMPTS {
                        warn!(
                            attempt,
                            max_attempts = MAX_AI_ATTEMPTS,
                            %status,
                            "openai completion failed with retryable status"
                        );
                        sleep(retry_delay(attempt)).await;
                        continue;
                    }

                    error!(
                        attempt,
                        %status,
                        body = %text,
                        "openai completion failed"
                    );
                    return Err(anyhow!(openai_status_user_message(status)));
                }
                Err(err) => {
                    if should_retry_transport(&err) && attempt < MAX_AI_ATTEMPTS {
                        warn!(
                            attempt,
                            max_attempts = MAX_AI_ATTEMPTS,
                            err = %err,
                            "openai completion transport failed, retrying"
                        );
                        sleep(retry_delay(attempt)).await;
                        continue;
                    }

                    error!(attempt, err = %err, "openai completion transport failed");
                    return Err(anyhow!(openai_transport_user_message(&err)));
                }
            }
        }
        unreachable!("openai completion retry loop must return")
    }

    async fn complete_openai_responses(
        &self,
        cfg: &AiConfig,
        system: &str,
        user: &str,
    ) -> Result<String> {
        let url = format!("{}/v1/responses", cfg.base_url.trim_end_matches('/'));
        for attempt in 1..=MAX_AI_ATTEMPTS {
            self.throttle().await;
            let body = json!({
                "model": cfg.model,
                "instructions": system,
                "input": user,
            });
            let send = self
                .http
                .post(&url)
                .bearer_auth(&cfg.api_key)
                .json(&body)
                .send()
                .await;
            match send {
                Ok(resp) => {
                    let status = resp.status();
                    let text = resp.text().await.context("读 openai responses 响应失败")?;
                    if status.is_success() {
                        let parsed: OpenAiResponsesResp = serde_json::from_str(&text)
                            .with_context(|| format!("解析 openai responses 响应失败: {text}"))?;
                        if !parsed.output_text.is_empty() {
                            return Ok(parsed.output_text);
                        }
                        let out = parsed
                            .output
                            .into_iter()
                            .flat_map(|item| item.content.into_iter())
                            .filter_map(|c| c.text)
                            .collect::<String>();
                        return Ok(out);
                    }

                    if should_retry_status(status) && attempt < MAX_AI_ATTEMPTS {
                        warn!(
                            attempt,
                            max_attempts = MAX_AI_ATTEMPTS,
                            %status,
                            "openai responses completion failed with retryable status"
                        );
                        sleep(retry_delay(attempt)).await;
                        continue;
                    }

                    error!(
                        attempt,
                        %status,
                        body = %text,
                        "openai responses completion failed"
                    );
                    return Err(anyhow!(openai_status_user_message(status)));
                }
                Err(err) => {
                    if should_retry_transport(&err) && attempt < MAX_AI_ATTEMPTS {
                        warn!(
                            attempt,
                            max_attempts = MAX_AI_ATTEMPTS,
                            err = %err,
                            "openai responses completion transport failed, retrying"
                        );
                        sleep(retry_delay(attempt)).await;
                        continue;
                    }

                    error!(attempt, err = %err, "openai responses completion transport failed");
                    return Err(anyhow!(openai_transport_user_message(&err)));
                }
            }
        }
        unreachable!("openai responses completion retry loop must return")
    }

    async fn generate_openai_image(
        &self,
        cfg: &AiConfig,
        prompt: &str,
        size: &str,
        quality: &str,
    ) -> Result<GeneratedImage> {
        #[derive(Deserialize)]
        struct OpenAiImageData {
            b64_json: Option<String>,
        }
        #[derive(Deserialize)]
        struct OpenAiImageResp {
            data: Vec<OpenAiImageData>,
        }

        let url = format!(
            "{}/v1/images/generations",
            cfg.base_url.trim_end_matches('/')
        );
        for attempt in 1..=MAX_AI_ATTEMPTS {
            let body = json!({
                "model": cfg.image_model,
                "prompt": prompt,
                "size": size,
                "quality": quality,
                "response_format": "b64_json",
            });
            let send = self
                .http
                .post(&url)
                .bearer_auth(&cfg.api_key)
                .json(&body)
                .send()
                .await;
            match send {
                Ok(resp) => {
                    let status = resp.status();
                    let text = resp.text().await.context("读 openai 生图响应失败")?;
                    if status.is_success() {
                        let parsed: OpenAiImageResp = serde_json::from_str(&text)
                            .with_context(|| format!("解析 openai 生图响应失败: {text}"))?;
                        let b64 = parsed
                            .data
                            .into_iter()
                            .next()
                            .and_then(|item| item.b64_json)
                            .ok_or_else(|| anyhow!("openai 生图响应没有返回 b64_json"))?;
                        return Ok(GeneratedImage {
                            model: cfg.image_model.clone(),
                            prompt: prompt.to_string(),
                            mime_type: "image/png".into(),
                            data_url: format!("data:image/png;base64,{b64}"),
                        });
                    }

                    if should_retry_status(status) && attempt < MAX_AI_ATTEMPTS {
                        warn!(
                            attempt,
                            max_attempts = MAX_AI_ATTEMPTS,
                            %status,
                            "openai image generation failed with retryable status"
                        );
                        sleep(retry_delay(attempt)).await;
                        continue;
                    }

                    error!(
                        attempt,
                        %status,
                        body = %text,
                        "openai image generation failed"
                    );
                    return Err(anyhow!(openai_status_user_message(status)));
                }
                Err(err) => {
                    if should_retry_transport(&err) && attempt < MAX_AI_ATTEMPTS {
                        warn!(
                            attempt,
                            max_attempts = MAX_AI_ATTEMPTS,
                            err = %err,
                            "openai image generation transport failed, retrying"
                        );
                        sleep(retry_delay(attempt)).await;
                        continue;
                    }

                    error!(attempt, err = %err, "openai image generation transport failed");
                    return Err(anyhow!(openai_transport_user_message(&err)));
                }
            }
        }
        unreachable!("openai image retry loop must return")
    }

    /// 流式生成纯文本（不要求 JSON）。返回一个 mpsc 接收端，
    /// handler 把 Delta 转成 SSE 推到前端。一次写一段长文（README/大纲/正文/发布稿/配套）都用它。
    /// max_tokens 这里给得宽，长文本（万字级）用 8000-16000 为宜。
    pub async fn stream_text(
        &self,
        system: String,
        user: String,
        max_tokens: u32,
    ) -> mpsc::Receiver<StreamEvent> {
        let (tx, rx) = mpsc::channel::<StreamEvent>(64);
        let cfg = self.cfg.read().await.clone();
        let http = self.http.clone();
        let gate = self.rate_gate.clone();
        tokio::spawn(async move {
            let r = match cfg.provider {
                Provider::Anthropic => {
                    stream_anthropic(&http, &cfg, &system, &user, max_tokens, tx.clone(), &gate).await
                }
                Provider::Openai => {
                    if openai_uses_responses_api(&cfg) {
                        stream_openai_responses(
                            &http,
                            &cfg,
                            &system,
                            &user,
                            max_tokens,
                            tx.clone(),
                            &gate,
                        )
                        .await
                    } else {
                        stream_openai(&http, &cfg, &system, &user, max_tokens, tx.clone(), &gate)
                            .await
                    }
                }
            };
            if let Err(e) = r {
                let _ = tx.send(StreamEvent::Error(format!("{e:#}"))).await;
            }
            let _ = tx.send(StreamEvent::Done).await;
        });
        rx
    }
}

#[derive(Debug, Clone)]
pub enum StreamEvent {
    Delta(String),
    /// 上游繁忙、后端正在退避重试。attempt 是即将开始的第几次尝试，max 是总次数。
    Retry { attempt: usize, max: usize },
    Done,
    Error(String),
}

fn stream_timeout(cfg: &AiConfig) -> Duration {
    cfg.timeout.max(Duration::from_secs(600))
}

/// 是否对 Anthropic 请求的 system 段打 prompt-cache 断点。
///
/// 默认开启：system 提示词是稳定前缀（章节写作的 system 一本书内被复用几十次），
/// 打断点后从「每次 cache-create」变成「首次 create、后续 read」，且变动的正文留在
/// 断点之后、不进缓存区 —— 直接消掉「整书正文被反复 cache-write 却从不命中」的浪费。
///
/// 上游代理若不认 content-block 形式的 system（少见），设 AI_PROMPT_CACHE=0 即刻回退
/// 到纯字符串 system，与改造前完全一致。
fn prompt_cache_enabled() -> bool {
    !matches!(
        std::env::var("AI_PROMPT_CACHE")
            .ok()
            .as_deref()
            .map(str::trim),
        Some("0") | Some("false") | Some("off") | Some("no")
    )
}

/// 构造 Anthropic 请求体的 `system` 字段。
/// - 开启缓存：返回单个 text content-block，并在块尾打 `cache_control: ephemeral` 断点，
///   使「system 及之前」成为可复用的缓存前缀；变动的 user 正文在断点之后，不被缓存。
/// - 关闭缓存：返回纯字符串，与历史行为字节级一致。
fn anthropic_system_field(system: &str) -> serde_json::Value {
    if prompt_cache_enabled() {
        json!([{
            "type": "text",
            "text": system,
            "cache_control": { "type": "ephemeral" }
        }])
    } else {
        json!(system)
    }
}

/// 全局限速闸门（流式专用，复用 AiClient.rate_gate）。
async fn throttle_gate(gate: &Arc<Mutex<Instant>>) {
    let interval_ms: u64 = std::env::var("AI_MIN_INTERVAL_MS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(350);
    if interval_ms == 0 {
        return;
    }
    let interval = Duration::from_millis(interval_ms);
    let mut next = gate.lock().await;
    let now = Instant::now();
    if *next > now {
        let wait = *next - now;
        sleep(wait).await;
        *next += interval;
    } else {
        *next = now + interval;
    }
}

const MAX_AI_ATTEMPTS: usize = 7;

fn should_retry_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 429 | 502 | 503 | 504)
}

fn should_retry_transport(err: &reqwest::Error) -> bool {
    err.is_timeout() || err.is_connect()
}

/// 指数退避 + 抖动。代理账号池空窗常持续几秒到十几秒，
/// 总退避（1+2+4+8≈15s）能盖住大多数空窗，让请求自愈，不必用户手动重试。
/// 抖动避免多个并发请求在同一时刻一起重试，反而再次打满池子。
fn retry_delay(attempt: usize) -> Duration {
    let base_ms: u64 = match attempt {
        1 => 1000,
        2 => 2000,
        3 => 4000,
        4 => 8000,
        5 => 12000,
        _ => 16000,
    };
    // 0..=base/2 的伪随机抖动，无需引第三方 rng
    let jitter = pseudo_jitter(base_ms / 2);
    Duration::from_millis(base_ms + jitter)
}

/// 基于系统纳秒时钟的轻量抖动，范围 0..=max_ms。
fn pseudo_jitter(max_ms: u64) -> u64 {
    if max_ms == 0 {
        return 0;
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    nanos % (max_ms + 1)
}

/// 上游代理共享账号池，账号被占满 / 过载时会以非标准状态码 + 文案返回，
/// 这类是瞬时错误，值得重试（区别于 401 鉴权失败这种永久错误）。
fn body_is_retryable(body: &str) -> bool {
    let b = body.to_ascii_lowercase();
    b.contains("no available accounts") || b.contains("overloaded") || b.contains("rate_limit")
}

fn openai_uses_responses_api(cfg: &AiConfig) -> bool {
    if cfg.provider != Provider::Openai || !cfg.model.starts_with("gpt-5") {
        return false;
    }
    match std::env::var("AI_OPENAI_API_KIND")
        .ok()
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("responses") => return true,
        Some("chat") | Some("chat_completions") | Some("chat-completions") => return false,
        _ => {}
    }
    is_official_openai_base_url(&cfg.base_url)
}

fn is_official_openai_base_url(base_url: &str) -> bool {
    let normalized = base_url.trim().to_ascii_lowercase();
    normalized == "https://api.openai.com"
        || normalized == "https://api.openai.com/"
        || normalized.starts_with("https://api.openai.com/")
}

fn openai_status_user_message(status: reqwest::StatusCode) -> &'static str {
    match status.as_u16() {
        429 | 502 | 503 | 504 => "上游 AI 服务暂时不可用，请稍后重试",
        400 | 401 | 403 | 404 => "AI 服务请求失败，请检查模型、鉴权和网关配置",
        _ => "AI 服务请求失败，请稍后重试",
    }
}

fn openai_transport_user_message(err: &reqwest::Error) -> &'static str {
    if err.is_timeout() || err.is_connect() {
        "AI 服务连接超时，请稍后重试"
    } else {
        "AI 服务请求失败，请稍后重试"
    }
}

/// 读流结果：用于决定是否可安全重试。
enum DrainOutcome {
    /// 正常读完（已收到 [DONE]/message_stop 或流自然结束且吐过内容）
    Done,
    /// 还没吐出任何 delta 就断流/早期错误 —— 可安全整请求重试
    RetryableEarly(String),
    /// 已吐出内容后失败 —— 不能重试（会重复），上抛
    Fatal(anyhow::Error),
}

async fn stream_anthropic(
    http: &reqwest::Client,
    cfg: &AiConfig,
    system: &str,
    user: &str,
    max_tokens: u32,
    tx: mpsc::Sender<StreamEvent>,
    gate: &Arc<Mutex<Instant>>,
) -> Result<()> {
    let url = format!("{}/v1/messages", cfg.base_url.trim_end_matches('/'));
    // 连接 + 读流整体放进重试循环：
    // - 连接/状态码失败可重试
    // - 开流后「还没吐出任何 delta」就断流/报错，也可安全重试（不会重复内容）
    // - 一旦已吐出 delta 再失败，则上抛，交前端步骤级重试整步重跑
    for attempt in 1..=MAX_AI_ATTEMPTS {
        throttle_gate(gate).await;
        let body = json!({
            "model": cfg.model,
            "max_tokens": max_tokens,
            "stream": true,
            "system": anthropic_system_field(system),
            "messages": [{"role": "user", "content": user}],
        });
        let send = http
            .post(&url)
            .header("x-api-key", &cfg.api_key)
            .header("Authorization", format!("Bearer {}", cfg.api_key))
            .header("anthropic-version", "2023-06-01")
            .header("accept", "text/event-stream")
            .timeout(stream_timeout(cfg))
            .json(&body)
            .send()
            .await;
        let resp = match send {
            Ok(candidate) => {
                let status = candidate.status();
                if status.is_success() {
                    candidate
                } else {
                    let text = candidate.text().await.unwrap_or_default();
                    let retryable = should_retry_status(status) || body_is_retryable(&text);
                    if retryable && attempt < MAX_AI_ATTEMPTS {
                        warn!(attempt, max_attempts = MAX_AI_ATTEMPTS, %status,
                            "anthropic stream failed with retryable response, retrying");
                        tx.send(StreamEvent::Retry { attempt: attempt + 1, max: MAX_AI_ATTEMPTS }).await.ok();
                        sleep(retry_delay(attempt)).await;
                        continue;
                    }
                    error!(attempt, %status, body = %text, "anthropic stream failed");
                    return Err(anyhow!("anthropic stream {} : {}", status, text));
                }
            }
            Err(err) => {
                if should_retry_transport(&err) && attempt < MAX_AI_ATTEMPTS {
                    warn!(attempt, max_attempts = MAX_AI_ATTEMPTS, err = %err,
                        "anthropic stream transport failed, retrying");
                    tx.send(StreamEvent::Retry { attempt: attempt + 1, max: MAX_AI_ATTEMPTS }).await.ok();
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                return Err(anyhow::Error::new(err).context("调 anthropic stream 失败（连接/超时）"));
            }
        };

        match drain_anthropic_stream(resp, &tx).await {
            DrainOutcome::Done => return Ok(()),
            DrainOutcome::Fatal(e) => return Err(e),
            DrainOutcome::RetryableEarly(why) => {
                if attempt < MAX_AI_ATTEMPTS {
                    warn!(attempt, why, "anthropic stream failed before any delta, retrying");
                    tx.send(StreamEvent::Retry { attempt: attempt + 1, max: MAX_AI_ATTEMPTS }).await.ok();
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                return Err(anyhow!("anthropic stream 多次重试仍未产出内容：{why}"));
            }
        }
    }
    Ok(())
}

/// 读 Anthropic SSE 流。返回 DrainOutcome 决定能否重试。
async fn drain_anthropic_stream(
    resp: reqwest::Response,
    tx: &mpsc::Sender<StreamEvent>,
) -> DrainOutcome {
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut emitted = 0usize;
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                if emitted == 0 {
                    return DrainOutcome::RetryableEarly(format!("断流：{e}"));
                }
                return DrainOutcome::Fatal(anyhow::Error::new(e).context("读 anthropic SSE chunk 失败"));
            }
        };
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buf.find("\n\n") {
            let event = buf[..idx].to_string();
            buf.drain(..idx + 2);
            for line in event.lines() {
                if let Some(payload) = line.strip_prefix("data: ") {
                    if payload.trim() == "[DONE]" {
                        return DrainOutcome::Done;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) {
                        match v.get("type").and_then(|t| t.as_str()) {
                            Some("content_block_delta") => {
                                if let Some(text) = v.pointer("/delta/text").and_then(|t| t.as_str()) {
                                    if !text.is_empty() {
                                        emitted += 1;
                                        tx.send(StreamEvent::Delta(text.to_string())).await.ok();
                                    }
                                }
                            }
                            Some("error") => {
                                let msg = v
                                    .pointer("/error/message")
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("anthropic stream error")
                                    .to_string();
                                if emitted == 0 && body_is_retryable(&msg) {
                                    return DrainOutcome::RetryableEarly(msg);
                                }
                                return DrainOutcome::Fatal(anyhow!(msg));
                            }
                            Some("message_stop") => return DrainOutcome::Done,
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    // 流自然结束
    if emitted == 0 {
        DrainOutcome::RetryableEarly("流结束但未产出任何内容".into())
    } else {
        DrainOutcome::Done
    }
}


async fn stream_openai(
    http: &reqwest::Client,
    cfg: &AiConfig,
    system: &str,
    user: &str,
    max_tokens: u32,
    tx: mpsc::Sender<StreamEvent>,
    gate: &Arc<Mutex<Instant>>,
) -> Result<()> {
    let url = format!("{}/v1/chat/completions", cfg.base_url.trim_end_matches('/'));
    for attempt in 1..=MAX_AI_ATTEMPTS {
        throttle_gate(gate).await;
        let body = json!({
            "model": cfg.model,
            "temperature": 0.9,
            "stream": true,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        });
        let send = http
            .post(&url)
            .bearer_auth(&cfg.api_key)
            .header("accept", "text/event-stream")
            .timeout(stream_timeout(cfg))
            .json(&body)
            .send()
            .await;
        let resp = match send {
            Ok(candidate) => {
                let status = candidate.status();
                if status.is_success() {
                    candidate
                } else {
                    let text = candidate.text().await.unwrap_or_default();
                    if (should_retry_status(status) || body_is_retryable(&text))
                        && attempt < MAX_AI_ATTEMPTS
                    {
                        warn!(attempt, max_attempts = MAX_AI_ATTEMPTS, %status,
                            "openai stream failed with retryable status");
                        tx.send(StreamEvent::Retry { attempt: attempt + 1, max: MAX_AI_ATTEMPTS }).await.ok();
                        sleep(retry_delay(attempt)).await;
                        continue;
                    }
                    error!(attempt, %status, body = %text, "openai stream failed");
                    return Err(anyhow!(openai_status_user_message(status)));
                }
            }
            Err(err) => {
                if should_retry_transport(&err) && attempt < MAX_AI_ATTEMPTS {
                    warn!(attempt, max_attempts = MAX_AI_ATTEMPTS, err = %err,
                        "openai stream transport failed, retrying");
                    tx.send(StreamEvent::Retry { attempt: attempt + 1, max: MAX_AI_ATTEMPTS }).await.ok();
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                error!(attempt, err = %err, "openai stream transport failed");
                return Err(anyhow!(openai_transport_user_message(&err)));
            }
        };

        match drain_openai_stream(resp, &tx).await {
            DrainOutcome::Done => return Ok(()),
            DrainOutcome::Fatal(e) => return Err(e),
            DrainOutcome::RetryableEarly(why) => {
                if attempt < MAX_AI_ATTEMPTS {
                    warn!(attempt, why, "openai stream failed before any delta, retrying");
                    tx.send(StreamEvent::Retry { attempt: attempt + 1, max: MAX_AI_ATTEMPTS }).await.ok();
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                return Err(anyhow!("openai stream 多次重试仍未产出内容：{why}"));
            }
        }
    }
    Ok(())
}

async fn stream_openai_responses(
    http: &reqwest::Client,
    cfg: &AiConfig,
    system: &str,
    user: &str,
    max_tokens: u32,
    tx: mpsc::Sender<StreamEvent>,
    gate: &Arc<Mutex<Instant>>,
) -> Result<()> {
    let url = format!("{}/v1/responses", cfg.base_url.trim_end_matches('/'));
    for attempt in 1..=MAX_AI_ATTEMPTS {
        throttle_gate(gate).await;
        let body = json!({
            "model": cfg.model,
            "stream": true,
            "instructions": system,
            "input": user,
            "max_output_tokens": max_tokens,
        });
        let send = http
            .post(&url)
            .bearer_auth(&cfg.api_key)
            .header("accept", "text/event-stream")
            .timeout(stream_timeout(cfg))
            .json(&body)
            .send()
            .await;
        let resp = match send {
            Ok(candidate) => {
                let status = candidate.status();
                if status.is_success() {
                    candidate
                } else {
                    let text = candidate.text().await.unwrap_or_default();
                    if (should_retry_status(status) || body_is_retryable(&text))
                        && attempt < MAX_AI_ATTEMPTS
                    {
                        warn!(attempt, max_attempts = MAX_AI_ATTEMPTS, %status,
                            "openai responses stream failed with retryable status");
                        tx.send(StreamEvent::Retry { attempt: attempt + 1, max: MAX_AI_ATTEMPTS }).await.ok();
                        sleep(retry_delay(attempt)).await;
                        continue;
                    }
                    error!(attempt, %status, body = %text, "openai responses stream failed");
                    return Err(anyhow!(openai_status_user_message(status)));
                }
            }
            Err(err) => {
                if should_retry_transport(&err) && attempt < MAX_AI_ATTEMPTS {
                    warn!(attempt, max_attempts = MAX_AI_ATTEMPTS, err = %err,
                        "openai responses stream transport failed, retrying");
                    tx.send(StreamEvent::Retry { attempt: attempt + 1, max: MAX_AI_ATTEMPTS }).await.ok();
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                error!(attempt, err = %err, "openai responses stream transport failed");
                return Err(anyhow!(openai_transport_user_message(&err)));
            }
        };

        match drain_openai_responses_stream(resp, &tx).await {
            DrainOutcome::Done => return Ok(()),
            DrainOutcome::Fatal(e) => return Err(e),
            DrainOutcome::RetryableEarly(why) => {
                if attempt < MAX_AI_ATTEMPTS {
                    warn!(attempt, why, "openai responses stream failed before any delta, retrying");
                    tx.send(StreamEvent::Retry { attempt: attempt + 1, max: MAX_AI_ATTEMPTS }).await.ok();
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                return Err(anyhow!("openai responses stream 多次重试仍未产出内容：{why}"));
            }
        }
    }
    Ok(())
}

/// 读 OpenAI 兼容 SSE 流。
async fn drain_openai_stream(
    resp: reqwest::Response,
    tx: &mpsc::Sender<StreamEvent>,
) -> DrainOutcome {
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut emitted = 0usize;
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                if emitted == 0 {
                    return DrainOutcome::RetryableEarly(format!("断流：{e}"));
                }
                return DrainOutcome::Fatal(anyhow::Error::new(e).context("读 openai SSE chunk 失败"));
            }
        };
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buf.find("\n\n") {
            let event = buf[..idx].to_string();
            buf.drain(..idx + 2);
            for line in event.lines() {
                if let Some(payload) = line.strip_prefix("data: ") {
                    if payload.trim() == "[DONE]" {
                        return DrainOutcome::Done;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) {
                        if let Some(text) = v
                            .pointer("/choices/0/delta/content")
                            .and_then(|t| t.as_str())
                        {
                            if !text.is_empty() {
                                emitted += 1;
                                tx.send(StreamEvent::Delta(text.to_string())).await.ok();
                            }
                        }
                    }
                }
            }
        }
    }
    if emitted == 0 {
        DrainOutcome::RetryableEarly("流结束但未产出任何内容".into())
    } else {
        DrainOutcome::Done
    }
}

async fn drain_openai_responses_stream(
    resp: reqwest::Response,
    tx: &mpsc::Sender<StreamEvent>,
) -> DrainOutcome {
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut emitted = 0usize;
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                if emitted == 0 {
                    return DrainOutcome::RetryableEarly(format!("断流：{e}"));
                }
                return DrainOutcome::Fatal(anyhow::Error::new(e).context("读 openai responses SSE chunk 失败"));
            }
        };
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buf.find("\n\n") {
            let event = buf[..idx].to_string();
            buf.drain(..idx + 2);
            let mut event_name = "";
            for line in event.lines() {
                if let Some(name) = line.strip_prefix("event: ") {
                    event_name = name.trim();
                }
                if let Some(payload) = line.strip_prefix("data: ") {
                    if payload.trim() == "[DONE]" {
                        return DrainOutcome::Done;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) {
                        if event_name == "response.output_text.delta" {
                            if let Some(text) = v.pointer("/delta").and_then(|t| t.as_str()) {
                                if !text.is_empty() {
                                    emitted += 1;
                                    tx.send(StreamEvent::Delta(text.to_string())).await.ok();
                                }
                            }
                        } else if event_name == "response.failed" {
                            let msg = v
                                .pointer("/response/error/message")
                                .and_then(|t| t.as_str())
                                .unwrap_or("openai responses stream error")
                                .to_string();
                            if emitted == 0 && body_is_retryable(&msg) {
                                return DrainOutcome::RetryableEarly(msg);
                            }
                            return DrainOutcome::Fatal(anyhow!(msg));
                        } else if event_name == "response.completed" {
                            return DrainOutcome::Done;
                        }
                    }
                }
            }
        }
    }
    if emitted == 0 {
        DrainOutcome::RetryableEarly("流结束但未产出任何内容".into())
    } else {
        DrainOutcome::Done
    }
}

#[derive(Deserialize)]
struct AnthropicResp {
    content: Vec<AnthropicBlock>,
    #[serde(default)]
    stop_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AnthropicBlock {
    Text {
        text: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct OpenAiResp {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMsg,
}

#[derive(Deserialize)]
struct OpenAiMsg {
    content: String,
}

#[derive(Deserialize)]
struct OpenAiResponsesResp {
    #[serde(default)]
    output_text: String,
    #[serde(default)]
    output: Vec<OpenAiResponsesOutput>,
}

#[derive(Deserialize)]
struct OpenAiResponsesOutput {
    #[serde(default)]
    content: Vec<OpenAiResponsesContent>,
}

#[derive(Deserialize)]
struct OpenAiResponsesContent {
    #[serde(default)]
    text: Option<String>,
}

// === 选题 AI 试评 ===

#[derive(Debug, Serialize)]
pub struct AiScoreRequest<'a> {
    pub title: &'a str,
    pub track: &'a str,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiScoreResponse {
    pub score: Score,
    /// 总分（4 维之和，满分 40）。后端权威重算，不信 AI 自报。
    #[serde(default)]
    pub total: i32,
    /// 立项段位，后端按 total 重算。
    #[serde(default)]
    pub tier: String,
    /// 对标真实爆款：点名 hot_tracks 里最相似的标题 + 差异点。
    #[serde(default)]
    pub benchmark: String,
    pub rationale: String,
    pub suggestions: Vec<String>,
}

const SCORE_SYSTEM: &str = include_str!("ai_prompts/seed_scorer.system.md");

pub async fn score_seed(client: &AiClient, req: &AiScoreRequest<'_>) -> Result<AiScoreResponse> {
    let hot = load_hot_tracks();
    let user = format!(
        "标题：{}\n赛道：{}{}\n\n请对标上面的真实热词榜数据给分，并按 schema 严格只回 JSON。",
        req.title, req.track, hot
    );
    let raw = client.complete_json(SCORE_SYSTEM, &user).await?;
    let json_str = extract_json(&raw).with_context(|| format!("AI 输出找不到 JSON 块：{raw}"))?;
    let mut parsed: AiScoreResponse =
        serde_json::from_str(json_str).with_context(|| format!("AI JSON 解析失败：{json_str}"))?;
    // 校验：4 维都落在 1..=10
    parsed
        .score
        .validate()
        .map_err(|e| anyhow!("AI 评分越界：{e}"))?;
    // 代码层硬规则（不靠 AI）：标题超长、无数字锚点、跟爆款撞车强制扣分
    apply_hard_rules(req.title, &mut parsed.score);
    // total / tier 后端权威重算
    parsed.total = parsed.score.total();
    parsed.tier = Tier::from_total(parsed.total).as_str().to_string();
    Ok(parsed)
}

/// 硬规则校验（代码层面，不靠 AI），就地修改 score：
/// - 标题 >25 字 → title_ctr -2
/// - 标题无数字/时间锚点 → title_ctr -1
/// - 跟 hot_tracks 标题 jaccard 相似度 >0.6 → novelty 强制 ≤3（撞车）
/// 所有维度最终钳制在 1..=10。
fn apply_hard_rules(title: &str, score: &mut Score) {
    if title.chars().count() > 25 {
        score.title_ctr -= 2;
    }
    if !has_number_or_time_anchor(title) {
        score.title_ctr -= 1;
    }
    if max_similarity_with_hot_tracks(title) > 0.6 {
        score.novelty = score.novelty.min(3);
    }
    // 钳制到 1..=10
    score.title_ctr = score.title_ctr.clamp(1, 10);
    score.conflict = score.conflict.clamp(1, 10);
    score.tagfit = score.tagfit.clamp(1, 10);
    score.novelty = score.novelty.clamp(1, 10);
}

/// 标题是否含数字 / 时间锚点（阿拉伯数字、中文数字、年代/时间词）。
fn has_number_or_time_anchor(title: &str) -> bool {
    const CN_NUM: &str = "零一二三四五六七八九十百千万亿两";
    const TIME_WORDS: [&str; 12] = [
        "年", "天", "夜", "月", "日", "岁", "周", "分钟", "小时", "那晚", "当天", "第",
    ];
    if title.chars().any(|c| c.is_ascii_digit()) {
        return true;
    }
    if title.chars().any(|c| CN_NUM.contains(c)) {
        return true;
    }
    TIME_WORDS.iter().any(|w| title.contains(w))
}

/// 跟 hot_tracks 里所有标题逐一算字符级 Jaccard 相似度，取最大值。
/// hot_tracks 文件缺失 / 无标题时返回 0.0（不触发撞车惩罚）。
fn max_similarity_with_hot_tracks(title: &str) -> f64 {
    let hot_titles = hot_track_titles();
    hot_titles
        .iter()
        .map(|h| jaccard_char_similarity(title, h))
        .fold(0.0_f64, f64::max)
}

/// 字符集 Jaccard：|A∩B| / |A∪B|，忽略标点和空白。两边都空时算 0。
fn jaccard_char_similarity(a: &str, b: &str) -> f64 {
    use std::collections::HashSet;
    let norm = |s: &str| -> HashSet<char> {
        s.chars()
            .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
            .filter(|c| !"，。！？、：；「」『』（）·…—".contains(*c))
            .collect()
    };
    let sa = norm(a);
    let sb = norm(b);
    if sa.is_empty() || sb.is_empty() {
        return 0.0;
    }
    let inter = sa.intersection(&sb).count() as f64;
    let union = sa.union(&sb).count() as f64;
    if union == 0.0 {
        0.0
    } else {
        inter / union
    }
}

/// 解析 hot_tracks.md 表格，抽出「标题」列（每个表格的第一列内容行）。
/// 跳过表头行（含「标题」「阅读量」等）和分隔行（---）。
fn hot_track_titles() -> Vec<String> {
    let content = read_hot_tracks_raw();
    let mut titles = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if !line.starts_with('|') {
            continue;
        }
        let cells: Vec<&str> = line.trim_matches('|').split('|').map(str::trim).collect();
        let Some(first) = cells.first() else {
            continue;
        };
        let first = *first;
        // 跳过分隔行（----）和表头（标题/阅读量/标签/数据/开头钩子）
        if first.is_empty()
            || first.chars().all(|c| c == '-' || c == ':')
            || first == "标题"
            || first.contains("阅读")
            || first.contains("数据")
        {
            continue;
        }
        titles.push(first.to_string());
    }
    titles
}

/// 从模型可能夹了 markdown 围栏 / 多余前后缀的输出里抠出 {...}
fn extract_json(s: &str) -> Option<&str> {
    let start = s.find('{')?;
    // 从末尾向前找 }
    let end = s.rfind('}')?;
    if end > start {
        Some(&s[start..=end])
    } else {
        None
    }
}

// === 项目级流式生成 ===

const README_SYSTEM: &str = include_str!("ai_prompts/project_readme.system.md");
const CHARACTER_SETUP_SYSTEM: &str = include_str!("ai_prompts/project_character_setup.system.md");
const OUTLINE_SYSTEM: &str = include_str!("ai_prompts/project_outline.system.md");
const PUBLISH_SYSTEM: &str = include_str!("ai_prompts/project_publish.system.md");
const SIDE_DISHES_SYSTEM: &str = include_str!("ai_prompts/project_side_dishes.system.md");
const BLURB_SYSTEM: &str = include_str!("ai_prompts/project_blurb.system.md");
const BOOK_SUMMARY_SYSTEM: &str = include_str!("ai_prompts/project_book_summary.system.md");
const BOOK_POLISH_SYSTEM: &str = include_str!("ai_prompts/project_book_polish.system.md");
const ANTI_AI_RULES: &str = include_str!("ai_prompts/anti_ai_rules.md");

pub async fn stream_readme(
    client: &AiClient,
    title: &str,
    track: &str,
    score_total: i32,
    today: &str,
) -> mpsc::Receiver<StreamEvent> {
    let user = format!(
        "标题：{title}\n赛道：{track}\n评分总分：{score_total}\n今天：{today}\n\n请按 README 模板输出。"
    );
    client
        .stream_text(README_SYSTEM.to_string(), user, 2000)
        .await
}

pub async fn stream_character_setup(
    client: &AiClient,
    readme_md: &str,
) -> mpsc::Receiver<StreamEvent> {
    let user = format!(
        "项目 README：\n\n{readme_md}\n\n请基于这份 README 输出固定模板的角色设定，供后续大纲和正文直接沿用。"
    );
    client
        .stream_text(CHARACTER_SETUP_SYSTEM.to_string(), user, 6000)
        .await
}

fn outline_user_prompt(readme_md: &str, character_setup_md: &str) -> String {
    format!(
        "项目 README：\n\n{readme_md}\n\n角色设定：\n\n{character_setup_md}\n\n请按大纲模板输出（故事主线 + 10 章细纲 + 爆点节奏表）。"
    )
}

pub async fn stream_outline(
    client: &AiClient,
    readme_md: &str,
    character_setup_md: &str,
) -> mpsc::Receiver<StreamEvent> {
    let user = outline_user_prompt(readme_md, character_setup_md);
    client
        .stream_text(OUTLINE_SYSTEM.to_string(), user, 4000)
        .await
}

pub async fn stream_publish_post(
    client: &AiClient,
    readme_md: &str,
    outline_md: &str,
    body_excerpt: &str,
) -> mpsc::Receiver<StreamEvent> {
    let user = format!(
        "README:\n{readme_md}\n\n大纲:\n{outline_md}\n\n正文节选（仅供风格参考）:\n{body_excerpt}\n\n请输出发布稿。"
    );
    client
        .stream_text(PUBLISH_SYSTEM.to_string(), user, 8000)
        .await
}

// === 发布前QA自检 ===

const PUBLISH_QA_SYSTEM: &str = include_str!("ai_prompts/publish_qa.system.md");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishQaResponse {
    pub first_sentence_score: i32,
    pub first_sentence_comment: String,
    pub retention_score: i32,
    pub retention_comment: String,
    pub pacing_score: i32,
    pub pacing_comment: String,
    pub anti_ai_score: i32,
    pub anti_ai_comment: String,
    pub title_match_score: i32,
    pub title_match_comment: String,
    pub total_score: i32,
    pub verdict: String,
    #[serde(default)]
    pub kill_reasons: Vec<String>,
    #[serde(default)]
    pub quick_fix: String,
}

pub async fn publish_qa_check(
    client: &AiClient,
    title: &str,
    publish_text: &str,
) -> Result<PublishQaResponse> {
    let excerpt: String = publish_text.chars().take(2000).collect();
    let user = format!("标题：{title}\n\n正文（前2000字）：\n{excerpt}");
    let raw = client.complete_json(PUBLISH_QA_SYSTEM, &user).await?;
    let json_str = extract_json(&raw).unwrap_or(&raw);
    let resp: PublishQaResponse = match serde_json::from_str(json_str) {
        Ok(p) => p,
        Err(first_err) => {
            // 兜底：让 AI 把上次输出修成合法 JSON（多见于内引号未转义），跟 beats_for_chapter 一致
            let fix_user = format!(
                "下面这段 JSON 有解析错误（{first_err}），请把它修成合法 JSON 后原样返回。\n注意：字符串字面量里的引号要换成中文「」或『』，不要用英文 \" 否则继续坏。\n\n{json_str}"
            );
            let fixed_raw = client.complete_json(PUBLISH_QA_SYSTEM, &fix_user).await?;
            let fixed = extract_json(&fixed_raw).unwrap_or(&fixed_raw);
            serde_json::from_str::<PublishQaResponse>(fixed)
                .map_err(|e| anyhow!("QA 自检 JSON 修复后仍解析失败: {e}\nraw: {fixed}"))?
        }
    };
    Ok(resp)
}

pub async fn stream_side_dishes(
    client: &AiClient,
    track: &str,
    readme_md: &str,
    outline_md: &str,
    body_excerpt: &str,
) -> mpsc::Receiver<StreamEvent> {
    let scope = side_dish_tag_scope_from_track(track);
    let user = side_dishes_user_prompt(readme_md, outline_md, body_excerpt, &scope);
    client
        .stream_text(SIDE_DISHES_SYSTEM.to_string(), user, 2000)
        .await
}

#[derive(Debug, Clone)]
pub struct SideDishTagScope {
    primary: String,
    plots: Vec<String>,
}

pub fn side_dish_tag_scope_from_track(track: &str) -> SideDishTagScope {
    let (primary, plots) = split_project_track(track);
    SideDishTagScope { primary, plots }
}

fn side_dishes_user_prompt(
    readme_md: &str,
    outline_md: &str,
    body_excerpt: &str,
    scope: &SideDishTagScope,
) -> String {
    format!(
        "README:\n{readme_md}\n\n大纲:\n{outline_md}\n\n正文节选（用于挑选段引流）:\n{body_excerpt}\n\n标签硬约束：\n- 主分类只能填写：{primary}\n- 情节只能从这里选择：{plots}\n- 角色只能从系统 prompt 的角色池里选\n- 情绪只能从系统 prompt 的情绪池里选\n- 背景只能从系统 prompt 的背景池里选\n- 禁止输出不在上述范围内的主分类或情节；不确定时也必须使用上述值。\n\n请输出配套.md。",
        primary = scope.primary,
        plots = scope.plots.join(" / "),
    )
}

pub fn normalize_side_dishes_tags(content: &str, scope: &SideDishTagScope) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let Some(tag_heading_idx) = lines.iter().position(|line| line.trim() == "## 标签") else {
        return content.to_string();
    };
    let next_heading_idx = lines
        .iter()
        .enumerate()
        .skip(tag_heading_idx + 1)
        .find_map(|(idx, line)| line.trim_start().starts_with("## ").then_some(idx))
        .unwrap_or(lines.len());

    let mut out = Vec::new();
    out.extend(lines[..=tag_heading_idx].iter().map(|line| (*line).to_string()));
    out.push(format!("- 主分类：{}", scope.primary));
    out.push(format!("- 情节：{}", scope.plots.join(" / ")));

    let tag_lines = &lines[tag_heading_idx + 1..next_heading_idx];
    out.push(format!(
        "- 角色：{}",
        normalize_tag_values(tag_lines, "角色", &SIDE_DISH_ROLE_TAGS, 1, 2, &["大女主"])
            .join(" / ")
    ));
    out.push(format!(
        "- 情绪：{}",
        normalize_tag_values(tag_lines, "情绪", &SIDE_DISH_EMOTION_TAGS, 1, 2, &["爽文"])
            .join(" / ")
    ));
    out.push(format!(
        "- 背景：{}",
        normalize_tag_values(tag_lines, "背景", &SIDE_DISH_BACKGROUND_TAGS, 1, 1, &["现代都市"])
            .join(" / ")
    ));

    out.extend(lines[next_heading_idx..].iter().map(|line| (*line).to_string()));
    let mut normalized = out.join("\n");
    if content.ends_with('\n') {
        normalized.push('\n');
    }
    normalized
}

const SIDE_DISH_ROLE_TAGS: [&str; 7] = [
    "霸总",
    "病娇",
    "双强",
    "高智商女主",
    "大女主",
    "真千金",
    "天才宝宝",
];
const SIDE_DISH_EMOTION_TAGS: [&str; 6] = ["爽文", "解压", "高能", "反转", "上头", "短小精悍"];
const SIDE_DISH_BACKGROUND_TAGS: [&str; 6] = [
    "豪门",
    "娱乐圈",
    "商战",
    "校园",
    "古言宫斗",
    "现代都市",
];

fn normalize_tag_values(
    tag_lines: &[&str],
    label: &str,
    allowed: &[&str],
    min: usize,
    max: usize,
    fallback: &[&str],
) -> Vec<String> {
    let mut values = tag_lines
        .iter()
        .find_map(|line| parse_tag_line(line, label))
        .unwrap_or_default()
        .into_iter()
        .filter(|item| allowed.iter().any(|allowed_item| allowed_item == item))
        .fold(Vec::<String>::new(), |mut acc, item| {
            if !acc.iter().any(|existing| existing == &item) {
                acc.push(item);
            }
            acc
        });
    for item in fallback {
        if values.len() >= min {
            break;
        }
        if allowed.iter().any(|allowed_item| allowed_item == item)
            && !values.iter().any(|existing| existing == item)
        {
            values.push((*item).to_string());
        }
    }
    values.truncate(max);
    values
}

fn parse_tag_line(line: &str, label: &str) -> Option<Vec<String>> {
    let trimmed = line.trim();
    let rest = trimmed
        .strip_prefix("- ")
        .unwrap_or(trimmed)
        .strip_prefix(&format!("{label}："))
        .or_else(|| {
            trimmed
                .strip_prefix("- ")
                .unwrap_or(trimmed)
                .strip_prefix(&format!("{label}:"))
        })?;
    Some(
        rest.split(['/', '／', '、', ',', '，'])
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect(),
    )
}

fn split_project_track(track: &str) -> (String, Vec<String>) {
    let normalized = track.trim();
    if normalized.is_empty() {
        return ("婚姻家庭".to_string(), vec!["追妻火葬场".to_string()]);
    }
    let separators = ["·", " / ", "/", "-", "｜", "|"];
    for separator in separators {
        if let Some(idx) = normalized.find(separator) {
            if idx == 0 {
                continue;
            }
            let primary = normalized[..idx].trim();
            let plots = normalized[idx + separator.len()..]
                .split('/')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            return (
                if primary.is_empty() { "婚姻家庭" } else { primary }.to_string(),
                if plots.is_empty() {
                    vec!["追妻火葬场".to_string()]
                } else {
                    plots
                },
            );
        }
    }
    match normalized {
        "现言婚恋火葬场" => ("婚姻家庭".to_string(), vec!["追妻火葬场".to_string()]),
        "古言重生打脸" => ("历史古代".to_string(), vec!["重生".to_string()]),
        "古言替嫁冲喜" => ("古言甜宠".to_string(), vec!["先婚后爱".to_string()]),
        "悬疑规则怪谈" => ("悬疑惊悚".to_string(), vec!["规则怪谈".to_string()]),
        _ => (normalized.to_string(), vec!["追妻火葬场".to_string()]),
    }
}

pub async fn stream_blurb(
    client: &AiClient,
    readme_md: &str,
    outline_md: &str,
    body_excerpt: &str,
) -> mpsc::Receiver<StreamEvent> {
    let user = format!(
        "README:\n{readme_md}\n\n大纲:\n{outline_md}\n\n正文节选:\n{body_excerpt}\n\n请输出 100-200 字叙事导语。"
    );
    client
        .stream_text(BLURB_SYSTEM.to_string(), user, 800)
        .await
}

/// 整合单章正文。逐章调用、再在上层拼成全书，避免一次性整本请求过重导致代理超时。
pub async fn stream_book_summary_chapter(
    client: &AiClient,
    chapter_source: &str,
) -> mpsc::Receiver<StreamEvent> {
    let user = format!(
        "下面是某一章的正文原稿，章节标题写在开头：\n\n{chapter_source}\n\n请保留「# 第N章 标题」这个开头，把这一章整合成连贯顺滑的正文。以整合、去重、修顺为主，篇幅与原稿大致相当，不要刻意扩写或注水。只输出这一章。"
    );
    // 单章远小于整本，6000 token 足够覆盖一章正文，请求轻、快、几乎不超时。
    client
        .stream_text(BOOK_SUMMARY_SYSTEM.to_string(), user, 6000)
        .await
}

/// 全书汇总：逐章整合再拼（串行）。每章一个轻量请求（小、快、几乎不超时），
/// 整章流式转发到同一个合并 channel，章节间插空行分隔。
/// 支持断章续传：from 指定已完成的章数（≥1 时跳过前 from 章直接出全文）。
///
/// 说明：曾尝试 2-3 章并发提速，但实测这个上游代理在并发流式请求下会把连接挂住
/// （流开着不吐字），按章序输出时被前面卡住的章拖死，首字延迟反而更长。
/// 所以这里坚持串行 —— 慢但稳，零超时。
pub fn stream_book_summary_chapters(
    client: &AiClient,
    chapter_sources: Vec<String>,
    from: usize,
) -> mpsc::Receiver<StreamEvent> {
    let (tx, rx) = mpsc::channel::<StreamEvent>(64);
    let client = client.clone();
    tokio::spawn(async move {
        if from > 0 && from <= chapter_sources.len() {
            tx.send(StreamEvent::Delta(
                format!("（续写模式：跳过前 {from} 章，从第 {} 章开始）\n\n", from + 1)
            )).await.ok();
        }
        for (i, source) in chapter_sources.iter().enumerate().skip(from) {
            if i > 0 {
                if tx.send(StreamEvent::Delta("\n\n".to_string())).await.is_err() {
                    return;
                }
            }
            let mut chapter_rx = stream_book_summary_chapter(&client, source).await;
            while let Some(ev) = chapter_rx.recv().await {
                match ev {
                    StreamEvent::Delta(_) | StreamEvent::Retry { .. } => {
                        if tx.send(ev).await.is_err() {
                            return;
                        }
                    }
                    StreamEvent::Error(e) => {
                        let _ = tx.send(StreamEvent::Error(e)).await;
                        let _ = tx.send(StreamEvent::Done).await;
                        return;
                    }
                    StreamEvent::Done => break,
                }
            }
        }
        let _ = tx.send(StreamEvent::Done).await;
    });
    rx
}

pub async fn stream_book_polish(
    client: &AiClient,
    summary_body: &str,
) -> mpsc::Receiver<StreamEvent> {
    let user =
        format!("下面是一版完整正文：\n\n{summary_body}\n\n请在不改变剧情事实的前提下做优化升华。");
    client
        .stream_text(BOOK_POLISH_SYSTEM.to_string(), user, 12000)
        .await
}

// === 章节 AI 拆 beats ===

const BEATS_SYSTEM: &str = include_str!("ai_prompts/chapter_beats.system.md");

#[derive(Debug, Deserialize)]
struct BeatsResp {
    beats: Vec<Beat>,
}

pub async fn beats_for_chapter(
    client: &AiClient,
    project_title: &str,
    track: &str,
    chapter_title: &str,
) -> Result<Vec<Beat>> {
    let user = format!(
        "项目：{project_title}\n赛道：{track}\n章节标题：{chapter_title}\n\n请按 schema 严格只回 JSON。"
    );
    let raw = client.complete_json(BEATS_SYSTEM, &user).await?;
    let json_str = extract_json(&raw).with_context(|| format!("AI 输出找不到 JSON 块：{raw}"))?;
    let parsed: BeatsResp = match serde_json::from_str(json_str) {
        Ok(p) => p,
        Err(first_err) => {
            // 兜底：让 AI 把上次输出修成合法 JSON（多见于内引号未转义）
            let fix_user = format!(
                "下面这段 JSON 有解析错误（{first_err}），请把它修成合法 JSON 后原样返回。\n注意：字符串字面量里的引号要换成中文「」或『』，不要用英文 \" 否则继续坏。\n\n{json_str}"
            );
            let fixed_raw = client.complete_json(BEATS_SYSTEM, &fix_user).await?;
            let fixed = extract_json(&fixed_raw)
                .with_context(|| format!("AI 修复输出仍找不到 JSON：{fixed_raw}"))?;
            serde_json::from_str::<BeatsResp>(fixed)
                .with_context(|| format!("修复后仍解析失败：{fixed}"))?
        }
    };
    if parsed.beats.is_empty() {
        return Err(anyhow!("AI 没拆出任何 beat"));
    }
    Ok(parsed.beats)
}

// === 章节 AI 段落写作 ===

const WRITE_SYSTEM: &str = include_str!("ai_prompts/chapter_write.system.md");
const FULL_WRITE_SYSTEM: &str = include_str!("ai_prompts/chapter_write_full.system.md");
const OPENINGS_REF: &str = include_str!("../../../../story_openings_ref.md");

pub async fn write_paragraph(
    client: &AiClient,
    project_title: &str,
    track: &str,
    chapter_title: &str,
    beat: &Beat,
    prev_tail: &str,
    character_setup: &str,
) -> Result<String> {
    let prev = if prev_tail.trim().is_empty() {
        "（这是章节第一段，无上文）".to_string()
    } else {
        format!("上一段结尾（衔接用，别复述）：\n{}", prev_tail.trim())
    };
    let setup = character_setup.trim();
    let setup_section = if setup.is_empty() {
        String::new()
    } else {
        format!("\n角色设定（严格按这个写，包括人称、姓名、关系）：\n{}",
            if setup.chars().count() > 1500 {
                format!("{}…（下略）", setup.chars().take(1500).collect::<String>())
            } else {
                setup.to_string()
            })
    };
    let user = format!(
        "项目：{project_title}\n赛道：{track}\n章节：{chapter_title}\n\n本段 beat：{} — {}\n{prev}{setup_section}\n\n直接写正文段落。",
        beat.label, beat.note,
    );
    let text = client.complete_json(&format!("{WRITE_SYSTEM}\n\n{ANTI_AI_RULES}"), &user).await?;
    Ok(text.trim().to_string())
}

pub async fn stream_write_paragraph(
    client: &AiClient,
    project_title: &str,
    track: &str,
    chapter_title: &str,
    beat: &Beat,
    prev_tail: &str,
    character_setup: &str,
) -> mpsc::Receiver<StreamEvent> {
    let prev = if prev_tail.trim().is_empty() {
        "（这是章节第一段，无上文）".to_string()
    } else {
        format!("上一段结尾（衔接用，别复述）：\n{}", prev_tail.trim())
    };
    let setup = character_setup.trim();
    let setup_section = if setup.is_empty() {
        String::new()
    } else {
        format!("\n角色设定（严格按这个写，包括人称、姓名、关系）：\n{}",
            if setup.chars().count() > 1500 {
                format!("{}…（下略）", setup.chars().take(1500).collect::<String>())
            } else {
                setup.to_string()
            })
    };
    let user = format!(
        "项目：{project_title}\n赛道：{track}\n章节：{chapter_title}\n\n本段 beat：{} — {}\n{prev}{setup_section}\n\n直接写正文段落。\n\n⚠️ 硬性字数：本段 400-600 字，写完即停。超过 600 字=不合格。番茄短篇读者 3 分钟看完一章，别注水。",
        beat.label, beat.note,
    );
    client
        .stream_text(format!("{WRITE_SYSTEM}\n\n{ANTI_AI_RULES}"), user, 800)
        .await
}

// === 章节 AI 整章写作（一口气写完，替代逐 beat 分段）===

/// 整章一次性写作。给大纲单章描述 + 精简角色提示 + 上一章结尾，目标 1500-2000 字。
/// 角色设定截断 800 字（只取核心人设/命名），prev_tail 取衔接用的上一章尾段。
pub async fn stream_write_full_chapter(
    client: &AiClient,
    project_title: &str,
    track: &str,
    chapter_title: &str,
    chapter_idx: i16,
    outline_excerpt: &str,
    prev_tail: &str,
    character_setup: &str,
) -> mpsc::Receiver<StreamEvent> {
    let outline = outline_excerpt.trim();
    let outline_section = if outline.is_empty() {
        "（大纲未提供本章描述，按章节标题自由发挥，但要承接上一章）".to_string()
    } else {
        format!("本章大纲（要完成的事，别被细节牵着展开）：\n{outline}")
    };

    let prev = if prev_tail.trim().is_empty() {
        "（这是第一章，无上文）".to_string()
    } else {
        format!("上一章结尾（衔接用，别复述）：\n{}", prev_tail.trim())
    };

    let setup = character_setup.trim();
    let setup_section = if setup.is_empty() {
        String::new()
    } else {
        // 只取前 800 字核心人设 + 命名，避免全量 5000 字让模型展开过度
        let trimmed = if setup.chars().count() > 800 {
            format!("{}…（下略）", setup.chars().take(800).collect::<String>())
        } else {
            setup.to_string()
        };
        format!("\n角色提示（只看这个写，包括人称、姓名、关系，不要展开）：\n{trimmed}")
    };

    let user = format!(
        "项目：{project_title}\n赛道：{track}\n第{chapter_idx}章：{chapter_title}\n\n{outline_section}\n{prev}{setup_section}\n\n现在一口气写完这一章。\n\n⚠️ 硬性字数：全章 1500-2000 字，连贯成篇，不分小标题、不分 beat。低于 1200 字内容不够，超过 2000 字算注水。番茄读者 3 分钟看完一章，章尾必须留钩子。",
    );
    client
        .stream_text(format!("{FULL_WRITE_SYSTEM}\n\n{ANTI_AI_RULES}"), user, 600)
        .await
}

// === 选题批量生成 ===

const GENERATOR_SYSTEM: &str = include_str!("ai_prompts/seed_generator.system.md");

#[derive(Debug, Serialize, Deserialize)]
pub struct AiSeedCandidate {
    pub title: String,
    pub score: Score,
    pub why_buy: String,
    #[serde(default)]
    #[serde(rename = "type")]
    pub title_type: String,
    #[serde(default)]
    pub blurb_hint: String,
    /// 推荐原因：为什么现在推这个题材（一句话）
    #[serde(default)]
    pub recommend_reason: String,
    /// 目前热度：AI 估的市场热度标签（爆款在售 / 上升期 / 平稳 / 冷门）
    #[serde(default)]
    pub heat: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiSeedGenerated {
    pub track: String,
    pub candidates: Vec<AiSeedCandidate>,
}

// === 热词注入 ===
/// 读 hot_tracks.md 原始内容（由外部爬虫每日更新）。文件不存在 / 为空时返回空串。
/// 评分用的标题解析（hot_track_titles）和选题注入（load_hot_tracks）共用这个读取器。
fn read_hot_tracks_raw() -> String {
    let candidates = ["hot_tracks.md", "../hot_tracks.md", "../../hot_tracks.md"];
    for p in &candidates {
        if let Ok(content) = std::fs::read_to_string(p) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    String::new()
}

/// 读取 hot_tracks.md，拼成追加段落注入选题 / 评分 prompt。
/// 文件不存在或读取失败时静默返回空串，不影响正常流程。
fn load_hot_tracks() -> String {
    let raw = read_hot_tracks_raw();
    if raw.is_empty() {
        String::new()
    } else {
        format!("\n\n---\n以下是番茄短篇今日真实热词榜（优先围绕这些方向出题 / 对标评分）：\n{raw}")
    }
}

/// 读取 my_track_analysis.md（作者自身作品数据复盘），注入选题 prompt。
/// 文件不存在或读取失败时静默返回空串。
fn load_my_track_analysis() -> String {
    let candidates = [
        "my_track_analysis.md",
        "../my_track_analysis.md",
        "../../my_track_analysis.md",
    ];
    for p in &candidates {
        if let Ok(content) = std::fs::read_to_string(p) {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                return format!("\n\n---\n以下是作者自己作品的数据复盘，选题时必须参考：\n{trimmed}");
            }
        }
    }
    String::new()
}

/// 把用户账号复盘策略（已验证公式 / 优势赛道 / 禁用赛道）拼成提示词追加段，注入选题 prompt。
/// 策略为空对象或缺字段时静默跳过对应小节。
fn format_strategy_for_prompt(strategy: &serde_json::Value) -> String {
    let obj = match strategy.as_object() {
        Some(o) if !o.is_empty() => o,
        _ => return String::new(),
    };

    // 取字符串数组（["a","b"]）的辅助
    let str_list = |v: &serde_json::Value| -> Vec<String> {
        v.as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    };

    let mut sections: Vec<String> = Vec::new();

    if let Some(formula) = obj.get("proven_formula").and_then(|v| v.as_object()) {
        let mut lines: Vec<String> = Vec::new();
        if let Some(p) = formula.get("title_pattern").and_then(|v| v.as_str()) {
            if !p.trim().is_empty() {
                lines.push(format!("已验证标题公式：{}", p.trim()));
            }
        }
        let best_tracks = formula
            .get("best_tracks")
            .map(str_list)
            .unwrap_or_default();
        if !best_tracks.is_empty() {
            lines.push(format!("优势赛道（优先围绕这些出题）：{}", best_tracks.join("、")));
        }
        let examples = formula.get("examples").map(str_list).unwrap_or_default();
        if !examples.is_empty() {
            lines.push(format!("过往爆款标题示例：{}", examples.join("｜")));
        }
        if !lines.is_empty() {
            sections.push(lines.join("\n"));
        }
    }

    // 顶层 best_tracks 作为兜底（结构示例里 best_tracks 在 proven_formula 内，但容错处理）
    let top_best = obj.get("best_tracks").map(str_list).unwrap_or_default();
    if !top_best.is_empty() {
        sections.push(format!("优势赛道（优先围绕这些出题）：{}", top_best.join("、")));
    }

    let banned = obj.get("banned_tracks").map(str_list).unwrap_or_default();
    if !banned.is_empty() {
        sections.push(format!("禁止赛道（绝对不要出这些方向的题）：{}", banned.join("、")));
    }

    if sections.is_empty() {
        return String::new();
    }
    format!(
        "\n\n---\n以下是本账号的复盘策略，出题时必须遵守：\n{}",
        sections.join("\n")
    )
}

pub async fn generate_seeds(
    client: &AiClient,
    track: &str,
    strategy: Option<&serde_json::Value>,
) -> Result<AiSeedGenerated> {    let hot = load_hot_tracks();
    let my_analysis = load_my_track_analysis();
    let strategy_block = strategy.map(format_strategy_for_prompt).unwrap_or_default();
    let user = format!(
        "赛道：{track}{hot}{my_analysis}{strategy_block}\n\n请按 schema 严格只回 JSON。"
    );
    let raw = client.complete_json(GENERATOR_SYSTEM, &user).await?;
    let json_str = extract_json(&raw).with_context(|| format!("AI 输出找不到 JSON 块：{raw}"))?;
    let mut parsed: AiSeedGenerated = match serde_json::from_str(json_str) {
        Ok(p) => p,
        Err(first_err) => {
            // 兜底修复一次
            let fix_user = format!(
                "下面这段 JSON 有解析错误（{first_err}），请把它修成合法 JSON 后原样返回。\n注意：字符串字面量里的引号要换成中文「」或『』，不要用英文 \" 否则继续坏。\n\n{json_str}"
            );
            let fixed_raw = client.complete_json(GENERATOR_SYSTEM, &fix_user).await?;
            let fixed = extract_json(&fixed_raw)
                .with_context(|| format!("AI 修复输出仍找不到 JSON：{fixed_raw}"))?;
            serde_json::from_str::<AiSeedGenerated>(fixed)
                .with_context(|| format!("修复后仍解析失败：{fixed}"))?
        }
    };
    if parsed.candidates.is_empty() {
        return Err(anyhow!("AI 没生成任何候选选题"));
    }
    // 校验 + 硬规则：4 维落在 1..=10，再按代码层硬规则修正撞车 / 超长 / 无锚点
    for c in &mut parsed.candidates {
        c.score
            .validate()
            .map_err(|e| anyhow!("AI 给候选「{}」的评分越界：{e}", c.title))?;
        apply_hard_rules(&c.title, &mut c.score);
    }
    Ok(parsed)
}

// === 赛道推荐（主分类 + 情节组合）===

const TRACK_RECOMMEND_SYSTEM: &str = include_str!("ai_prompts/track_recommend.system.md");

#[derive(Debug, Serialize, Deserialize)]
pub struct AiTrackRecommendation {
    pub primary: String,
    pub plots: Vec<String>,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub heat: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiTrackRecommendGenerated {
    pub recommendations: Vec<AiTrackRecommendation>,
}

pub async fn recommend_tracks(
    client: &AiClient,
    primaries: &[String],
    plots: &[String],
) -> Result<AiTrackRecommendGenerated> {
    let hot = load_hot_tracks();
    let my_analysis = load_my_track_analysis();
    let user = format!(
        "可选主分类（只能从这里选 1 个）：\n{}\n\n可选情节标签（只能从这里选 1-3 个）：\n{}\n{}{}\n请按 schema 严格只回 JSON。",
        primaries.join("、"),
        plots.join("、"),
        hot,
        my_analysis,
    );
    let raw = client.complete_json(TRACK_RECOMMEND_SYSTEM, &user).await?;
    let json_str = extract_json(&raw).with_context(|| format!("AI 输出找不到 JSON 块：{raw}"))?;
    let parsed: AiTrackRecommendGenerated = match serde_json::from_str(json_str) {
        Ok(p) => p,
        Err(first_err) => {
            let fix_user = format!(
                "下面这段 JSON 有解析错误（{first_err}），请把它修成合法 JSON 后原样返回。\n注意：字符串字面量里的引号要换成中文「」，不要用英文 \"。\n\n{json_str}"
            );
            let fixed_raw = client.complete_json(TRACK_RECOMMEND_SYSTEM, &fix_user).await?;
            let fixed = extract_json(&fixed_raw)
                .with_context(|| format!("AI 修复输出仍找不到 JSON：{fixed_raw}"))?;
            serde_json::from_str::<AiTrackRecommendGenerated>(fixed)
                .with_context(|| format!("修复后仍解析失败：{fixed}"))?
        }
    };
    if parsed.recommendations.is_empty() {
        return Err(anyhow!("AI 没推荐任何赛道组合"));
    }
    Ok(parsed)
}

// === 历史候选热度回填 ===

const HEAT_BACKFILL_SYSTEM: &str = include_str!("ai_prompts/seed_heat_backfill.system.md");

#[derive(Debug, Serialize, Deserialize)]
pub struct HeatBackfillItem {
    pub title: String,
    #[serde(default)]
    pub heat: String,
    #[serde(default)]
    pub recommend_reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct HeatBackfillResp {
    items: Vec<HeatBackfillItem>,
}

/// 一批 (title, track) → 热度 + 推荐原因
pub async fn backfill_heat(
    client: &AiClient,
    rows: &[(String, String)],
) -> Result<Vec<HeatBackfillItem>> {
    let list = rows
        .iter()
        .map(|(title, track)| format!("- 标题：{title}（赛道：{track}）"))
        .collect::<Vec<_>>()
        .join("\n");
    let user = format!("候选列表：\n{list}\n\n请按 schema 严格只回 JSON。");
    let raw = client.complete_json(HEAT_BACKFILL_SYSTEM, &user).await?;
    let json_str = extract_json(&raw).with_context(|| format!("AI 输出找不到 JSON 块：{raw}"))?;
    let parsed: HeatBackfillResp = serde_json::from_str(json_str)
        .with_context(|| format!("AI JSON 解析失败：{json_str}"))?;
    Ok(parsed.items)
}

// === 多米 API（文生图 / 图生图 / 文生视频） ===
const DOMIAPI_BASE: &str = "https://duomiapi.com";

#[derive(Debug, Serialize, Deserialize)]
pub struct DuoMiTaskResult {
    pub id: String,
    pub state: String,
    pub progress: i64,
    pub create_time: i64,
    pub update_time: i64,
    pub action: String,
    pub data: Option<DuoMiTaskData>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DuoMiTaskData {
    pub images: Option<Vec<DuoMiImage>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DuoMiImage {
    pub url: String,
    pub file_name: String,
}

/// 用于 pix/kling video feed 的返回格式
#[derive(Debug, Serialize, Deserialize)]
pub struct DuoMiVideoFeedResp {
    pub code: i32,
    pub msg: String,
    pub data: Option<DuoMiVideoData>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DuoMiVideoData {
    pub task_id: String,
    pub state: String,
    pub status: String,
    pub prompt: Option<String>,
    pub video_url: Option<String>,
    pub image_url: Option<String>,
    pub poster: Option<String>,
}

/// 多米 API 客户端
#[derive(Clone)]
pub struct DuoMiClient {
    key: String,
    http: reqwest::Client,
}

impl DuoMiClient {
    pub fn new(key: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(240))
            .build()
            .expect("构建 DuoMiClient http 失败");
        Self { key, http }
    }

    /// 文生图（gpt-image-2 / nano-banana）
    pub async fn create_image(
        &self,
        model: &str,
        prompt: &str,
        size: &str,
        quality: &str,
    ) -> Result<String> {
        if model.starts_with("gemini") || model == "nano-banana" {
            // nano-banana 专用端点
            let body = json!({
                "model": model,
                "prompt": prompt,
                "key": self.key,
            });
            let resp = self
                .http
                .post(format!("{}/api/gemini/nano-banana", DOMIAPI_BASE))
                .json(&body)
                .send()
                .await
                .context("nano-banana 请求失败")?;
            let status = resp.status();
            let text = resp.text().await.context("读 nano-banana 响应失败")?;
            if !status.is_success() {
                return Err(anyhow!("多米 nano-banana {} 错误: {}", status, text.chars().take(200).collect::<String>()));
            }
            let parsed: serde_json::Value =
                serde_json::from_str(&text).context("解析 nano-banana 响应失败")?;
            let task_id = parsed["data"]["task_id"]
                .as_str()
                .ok_or_else(|| anyhow!("nano-banana 无 task_id: {text}"))?;
            Ok(task_id.to_string())
        } else {
            // gpt-image-2 统一入口
            let body = json!({
                "model": model,
                "prompt": prompt,
                "size": size,
                "quality": quality,
                "key": self.key,
            });
            tracing::warn!(key_len = %self.key.len(), key_prefix = %self.key.chars().take(4).collect::<String>(), "duomi create_image");
            let resp = self
                .http
                .post(format!(
                    "{}/v1/images/generations?async=true",
                    DOMIAPI_BASE
                ))

                .json(&body)
                .send()
                .await
                .context("gpt-image-2 请求失败")?;
            let status = resp.status();
            let text = resp.text().await.context("读 gpt-image-2 响应失败")?;
            if !status.is_success() {
                return Err(anyhow!("多米生图接口 {} 错误: {}", status, text.chars().take(200).collect::<String>()));
            }
            let parsed: serde_json::Value =
                serde_json::from_str(&text).context("解析 gpt-image-2 响应失败")?;
            let task_id = parsed["id"]
                .as_str()
                .ok_or_else(|| anyhow!("gpt-image-2 无 id: {text}"))?;
            Ok(task_id.to_string())
        }
    }

    /// 图生图（nano-banana-edit）
    pub async fn create_image_edit(
        &self,
        model: &str,
        prompt: &str,
        image_url: &str,
    ) -> Result<String> {
        let body = json!({
            "model": model,
            "prompt": prompt,
            "image": image_url,
            "key": self.key,
        });
        let resp = self
            .http
            .post(format!("{}/api/gemini/nano-banana-edit", DOMIAPI_BASE))
            .json(&body)
            .send()
            .await
            .context("nano-banana-edit 请求失败")?;
        let status = resp.status();
        let text = resp.text().await.context("读 nano-banana-edit 响应失败")?;
        if !status.is_success() {
            return Err(anyhow!("多米 nano-banana-edit {} 错误: {}", status, text.chars().take(200).collect::<String>()));
        }
        let parsed: serde_json::Value =
            serde_json::from_str(&text).context("解析 nano-banana-edit 响应失败")?;
        let task_id = parsed["data"]["task_id"]
            .as_str()
            .ok_or_else(|| anyhow!("nano-banana-edit 无 task_id: {text}"))?;
        Ok(task_id.to_string())
    }

    /// 文生视频（pix）
    pub async fn create_video(
        &self,
        model: &str,
        prompt: &str,
        image_url: &str,
        duration: i32,
    ) -> Result<String> {
        let body = json!({
            "model": model,
            "prompt": prompt,
            "image": image_url,
            "duration": duration,
            "key": self.key,
        });
        let resp = self
            .http
            .post(format!("{}/api/video/pix/pro/generate", DOMIAPI_BASE))
            .json(&body)
            .send()
            .await
            .context("pix 视频请求失败")?;
        let status = resp.status();
        let text = resp.text().await.context("读 pix 视频响应失败")?;
        if !status.is_success() {
            return Err(anyhow!("多米 pix 视频 {} 错误: {}", status, text.chars().take(200).collect::<String>()));
        }
        let parsed: serde_json::Value =
            serde_json::from_str(&text).context("解析 pix 视频响应失败")?;
        let task_id = parsed["data"]["task_id"]
            .as_str()
            .ok_or_else(|| anyhow!("pix 视频无 task_id: {text}"))?;
        Ok(task_id.to_string())
    }

    /// 查询任务状态（统一 /v1/tasks/{id}，适用于 gpt-image-2 / nano-banana 图片任务）
    pub async fn query_task(&self, task_id: &str) -> Result<DuoMiTaskResult> {
        let url = format!("{}/v1/tasks/{}?key={}", DOMIAPI_BASE, task_id, self.key);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .context("查询任务失败")?;
        let status = resp.status();
        let text = resp.text().await.context("读查询任务响应失败")?;
        if !status.is_success() {
            return Err(anyhow!("多米查询任务 {} 错误: {}", status, text.chars().take(200).collect::<String>()));
        }
        serde_json::from_str(&text)
            .with_context(|| format!("解析查询任务响应失败: {text}"))
    }

    /// 查询视频任务（pix feed）
    pub async fn query_video(&self, task_id: &str) -> Result<DuoMiVideoFeedResp> {
        let url = format!(
            "{}/api/video/pix/feed?task_id={}&key={}",
            DOMIAPI_BASE, task_id, self.key
        );
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .context("查询视频任务失败")?;
        let status = resp.status();
        let text = resp.text().await.context("读查询视频响应失败")?;
        if !status.is_success() {
            return Err(anyhow!("多米查询视频 {} 错误: {}", status, text.chars().take(200).collect::<String>()));
        }
        serde_json::from_str(&text)
            .with_context(|| format!("解析查询视频响应失败: {text}"))
    }

    /// 提交 → 轮询 → 下载 → 返回 data:image/png;base64,...
    /// 阻塞直到生成完成。最多等 300 秒（多米排队高峰可达 2-3 分钟）。
    pub async fn blocking_generate_image(
        &self,
        model: &str,
        prompt: &str,
        size: &str,
        quality: &str,
    ) -> Result<GeneratedImage> {
        // 把像素尺寸（如 1024x1536）转多米比例格式（如 2:3），米模型不认像素尺寸
        let duomi_size = match size {
            "1024x1024" | "1:1" => "1:1",
            "1024x1536" | "1024x1792" | "2:3" => "2:3",
            "1536x1024" | "1792x1024" | "3:2" => "3:2",
            "16:9" => "16:9",
            "9:16" => "9:16",
            "1:2" => "1:2",
            "2:1" => "2:1",
            "4:3" => "4:3",
            "3:4" => "3:4",
            "5:4" => "5:4",
            "4:5" => "4:5",
            other => other, // 已经是比例格式或自定义像素尺寸（如 1792x1024）
        };
        let task_id = self.create_image(model, prompt, duomi_size, quality).await?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(300);
        let mut last_progress = 0i64;
        loop {
            if tokio::time::Instant::now() >= deadline {
                return Err(anyhow!("多米生图超时（300s），task_id={task_id}"));
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
            let task = self.query_task(&task_id).await?;
            match task.state.as_str() {
                "completed" | "success" | "succeeded" => {
                    let images = task
                        .data
                        .and_then(|d| d.images)
                        .ok_or_else(|| anyhow!("多米任务完成但无图片: task_id={task_id}"))?;
                    let first = images
                        .into_iter()
                        .next()
                        .ok_or_else(|| anyhow!("多米图片列表为空: task_id={task_id}"))?;
                    // 下载图片
                    let bytes = self
                        .http
                        .get(&first.url)
                        .send()
                        .await
                        .context("下载多米图片失败")?
                        .bytes()
                        .await
                        .context("读多米图片字节流失败")?;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    return Ok(GeneratedImage {
                        model: model.to_string(),
                        prompt: prompt.to_string(),
                        mime_type: "image/png".into(),
                        data_url: format!("data:image/png;base64,{b64}"),
                    });
                }
                "failed" | "error" => {
                    return Err(anyhow!("多米生图失败: task_id={task_id}"));
                }
                _ => {
                    if task.progress > last_progress {
                        last_progress = task.progress;
                        tracing::info!(%task_id, progress = task.progress, "多米生图进度");
                    }
                    // 继续轮询。gpt-image-2 可能全程 progress=0 然后直接 completed
                }
            }
        }
    }
}

/// 复盘分析输出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewAnalyzeResponse {
    pub overall_result: String,
    pub title_result: String,
    pub hook_result: String,
    pub emotion_result: String,
    #[serde(default)]
    pub dropout_analysis: String,
    pub success_reason: String,
    pub failure_reason: String,
    pub next_action: String,
}

const REVIEW_ANALYZE_SYSTEM: &str = include_str!("ai_prompts/review_analyze.system.md");

/// AI 复盘分析：根据作品数据（标题/赛道/字数/阅读量/分类标签）生成复盘结论
pub async fn analyze_review(
    client: &AiClient,
    project_title: &str,
    track: &str,
    total_words: u32,
    read_count: i64,
    word_number: i32,
    categories_json: Option<&str>,
) -> Result<ReviewAnalyzeResponse> {
    let user = format!(
        "标题：{project_title}\n赛道：{track}\n总字数：{total_words}\n阅读量：{read_count}\n互动量：{word_number}\n分类标签：{}",
        categories_json.unwrap_or("[]")
    );
    let raw = client.complete_json(REVIEW_ANALYZE_SYSTEM, &user).await?;
    let json_str = extract_json(&raw).unwrap_or(&raw);
    let resp: ReviewAnalyzeResponse = serde_json::from_str(json_str)
        .map_err(|e| anyhow!("AI 复盘分析 JSON 解析失败: {e}\nraw: {json_str}"))?;
    Ok(resp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_handles_fenced_json() {
        let raw = "```json\n{\"score\":{\"title_ctr\":8,\"conflict\":7,\"tagfit\":8,\"novelty\":6},\"total\":29,\"tier\":\"backlog\",\"benchmark\":\"x\",\"rationale\":\"x\",\"suggestions\":[]}\n```";
        let j = extract_json(raw).unwrap();
        let r: AiScoreResponse = serde_json::from_str(j).unwrap();
        assert_eq!(r.score.title_ctr, 8);
        assert_eq!(r.score.total(), 29);
    }

    #[test]
    fn hard_rules_penalize_long_and_anchorless_titles() {
        // 超 25 字 + 无数字锚点 → title_ctr 连扣 3（10 - 2 - 1 = 7）
        let mut s = Score { title_ctr: 10, conflict: 8, tagfit: 8, novelty: 8 };
        let long_no_anchor = "他在某个寻常的午后忽然意识到这段感情早已悄悄走到了尽头却无人察觉真相";
        apply_hard_rules(long_no_anchor, &mut s);
        assert_eq!(s.title_ctr, 7);
    }

    #[test]
    fn anchor_detection_catches_numbers_and_time_words() {
        assert!(has_number_or_time_anchor("中了8987万那晚妻子让我装穷"));
        assert!(has_number_or_time_anchor("重生1977我把丈夫还给妹妹"));
        assert!(has_number_or_time_anchor("等了师父八十年"));
        assert!(has_number_or_time_anchor("签字那天他才知道"));
        assert!(!has_number_or_time_anchor("他在雨里说爱我"));
    }

    #[test]
    fn jaccard_flags_near_duplicate_titles() {
        let a = "重生1977我把丈夫还给妹妹";
        let b = "重生1977，我把丈夫还给妹妹";
        assert!(jaccard_char_similarity(a, b) > 0.6);
        let c = "悬疑规则怪谈夜班电梯";
        assert!(jaccard_char_similarity(a, c) < 0.6);
    }

    #[test]
    fn body_is_retryable_catches_proxy_transient_errors() {
        // 上游代理共享账号池耗尽 / 过载 / 限流 → 瞬时错误，应重试
        assert!(body_is_retryable(
            r#"{"error":{"message":"No available accounts: no available accounts"}}"#
        ));
        assert!(body_is_retryable(
            r#"{"error":{"message":"Upstream rate limit exceeded","type":"rate_limit_error"}}"#
        ));
        assert!(body_is_retryable(r#"{"error":{"type":"overloaded_error"}}"#));
        // 鉴权失败是永久错误，不该重试
        assert!(!body_is_retryable(
            r#"{"code":"INVALID_API_KEY","message":"Invalid API key"}"#
        ));
    }

    #[test]
    fn status_retry_matches_gateway_errors() {
        use reqwest::StatusCode;
        assert!(should_retry_status(StatusCode::TOO_MANY_REQUESTS)); // 429
        assert!(should_retry_status(StatusCode::BAD_GATEWAY)); // 502
        assert!(should_retry_status(StatusCode::SERVICE_UNAVAILABLE)); // 503
        assert!(!should_retry_status(StatusCode::UNAUTHORIZED)); // 401 不重试
        assert!(!should_retry_status(StatusCode::OK));
    }

    #[test]
    fn summary_prompt_mentions_full_book_rewrite() {
        let system = BOOK_SUMMARY_SYSTEM;
        assert!(system.contains("连贯"));
        assert!(system.contains("第N章 标题"));
        // 清洗式整合：篇幅跟随原稿，不再强行扩写到固定字数
        assert!(system.contains("不刻意扩写"));
        assert!(system.contains("整合"));
    }

    #[test]
    fn polish_prompt_mentions_de_ai_and_immersion() {
        let system = BOOK_POLISH_SYSTEM;
        assert!(system.contains("去 AI 味"));
        assert!(system.contains("代入感"));
    }

    #[test]
    fn character_setup_prompt_mentions_relationships_and_romance() {
        let system = CHARACTER_SETUP_SYSTEM;
        assert!(system.contains("关系图"));
        assert!(system.contains("感情线"));
        assert!(system.contains("角色名"));
    }

    #[test]
    fn outline_prompt_embeds_character_setup_context() {
        let user = outline_user_prompt("# README", "角色设定正文");
        assert!(user.contains("项目 README"));
        assert!(user.contains("# README"));
        assert!(user.contains("角色设定"));
        assert!(user.contains("角色设定正文"));
    }

    #[test]
    fn side_dishes_prompt_locks_project_track_tags() {
        let scope = side_dish_tag_scope_from_track("婚姻家庭·追妻火葬场/大女主");
        let user = side_dishes_user_prompt("# README", "# 大纲", "正文", &scope);

        assert!(user.contains("主分类只能填写：婚姻家庭"));
        assert!(user.contains("情节只能从这里选择：追妻火葬场 / 大女主"));
        assert!(user.contains("禁止输出不在上述范围内的主分类或情节"));
    }

    #[test]
    fn normalize_side_dishes_tags_replaces_out_of_pool_track_labels() {
        let scope = side_dish_tag_scope_from_track("婚姻家庭·追妻火葬场/大女主");
        let raw = r#"# 配套：测试

## 标签
- 主分类：都市职场
- 情节：火葬场 / 复仇 / 反套路 / 马甲
- 角色：大女主 / 双强
- 情绪：爽文 / 解压
- 背景：商战

## 推荐发布时段
21:00-22:00
"#;

        let normalized = normalize_side_dishes_tags(raw, &scope);

        assert!(normalized.contains("- 主分类：婚姻家庭"));
        assert!(normalized.contains("- 情节：追妻火葬场 / 大女主"));
        assert!(normalized.contains("- 角色：大女主 / 双强"));
        assert!(normalized.contains("- 情绪：爽文 / 解压"));
        assert!(normalized.contains("- 背景：商战"));
        assert!(!normalized.contains("主分类：都市职场"));
        assert!(!normalized.contains("情节：火葬场 / 复仇 / 反套路 / 马甲"));
    }

    #[test]
    fn stream_timeout_has_ten_minute_floor() {
        let cfg = AiConfig {
            provider: Provider::Openai,
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
            image_model: "gpt-image-2".into(),
            duomiapi_key: String::new(),
            timeout: Duration::from_secs(60),
        };
        assert_eq!(stream_timeout(&cfg), Duration::from_secs(600));
    }

    #[test]
    fn stream_timeout_respects_higher_config() {
        let cfg = AiConfig {
            provider: Provider::Anthropic,
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
            image_model: "gpt-image-2".into(),
            duomiapi_key: String::new(),
            timeout: Duration::from_secs(900),
        };
        assert_eq!(stream_timeout(&cfg), Duration::from_secs(900));
    }

    #[test]
    fn system_field_toggles_cache_breakpoint() {
        // env 是进程级共享，本测试内串行设/清，避免污染其他用例。
        std::env::set_var("AI_PROMPT_CACHE", "1");
        let on = anthropic_system_field("SYS");
        assert_eq!(on[0]["text"], "SYS");
        assert_eq!(on[0]["cache_control"]["type"], "ephemeral");

        std::env::set_var("AI_PROMPT_CACHE", "0");
        let off = anthropic_system_field("SYS");
        assert_eq!(off, serde_json::json!("SYS"));
        assert!(off.get(0).is_none(), "关闭时应是纯字符串、无 content-block");

        std::env::remove_var("AI_PROMPT_CACHE");
        // 缺省（未设）视为开启
        assert!(anthropic_system_field("SYS")[0]["cache_control"].is_object());
    }

    #[test]
    fn official_openai_gpt_5_models_use_responses_api() {
        let cfg = AiConfig {
            provider: Provider::Openai,
            base_url: "https://api.openai.com".into(),
            api_key: "sk-test".into(),
            model: "gpt-5.5".into(),
            image_model: "gpt-image-2".into(),
            duomiapi_key: String::new(),
            timeout: Duration::from_secs(60),
        };
        assert!(openai_uses_responses_api(&cfg));
    }

    #[test]
    fn openai_compatible_gateway_gpt_5_models_keep_chat_completions_by_default() {
        let cfg = AiConfig {
            provider: Provider::Openai,
            base_url: "http://70.39.197.121:8080".into(),
            api_key: "sk-test".into(),
            model: "gpt-5.5".into(),
            image_model: "gpt-image-2".into(),
            duomiapi_key: String::new(),
            timeout: Duration::from_secs(60),
        };
        assert!(!openai_uses_responses_api(&cfg));
    }

    #[test]
    fn anthropic_claude_models_never_use_openai_responses_api() {
        let cfg = AiConfig {
            provider: Provider::Anthropic,
            base_url: "http://70.39.197.121:8080".into(),
            api_key: "sk-test".into(),
            model: "claude-opus-4-8".into(),
            image_model: "gpt-image-2".into(),
            duomiapi_key: String::new(),
            timeout: Duration::from_secs(60),
        };
        assert!(!openai_uses_responses_api(&cfg));
    }

    #[test]
    fn legacy_openai_models_keep_chat_completions_api() {
        let cfg = AiConfig {
            provider: Provider::Openai,
            base_url: "http://example.com".into(),
            api_key: "sk-test".into(),
            model: "gpt-4o-mini".into(),
            image_model: "gpt-image-2".into(),
            duomiapi_key: String::new(),
            timeout: Duration::from_secs(60),
        };
        assert!(!openai_uses_responses_api(&cfg));
    }
}
