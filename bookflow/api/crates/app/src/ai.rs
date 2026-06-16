use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use bookflow_domain::{Beat, Score};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{mpsc, RwLock};
use tokio::time::sleep;
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
        })
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
            return duomi
                .blocking_generate_image(&cfg.image_model, prompt, size, quality)
                .await;
        }
        match cfg.provider {
            Provider::Openai => {
                self.generate_openai_image(&cfg, prompt, size, quality)
                    .await
            }
            Provider::Anthropic => Err(anyhow!("当前 provider 不支持生图，请切到 OpenAI 或在设置中配置多米 API Key")),
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
            let body = json!({
                "model": cfg.model,
                "max_tokens": 4096,
                "system": system,
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
        let url = format!("{}/v1/chat/completions", cfg.base_url.trim_end_matches('/'));
        for attempt in 1..=MAX_AI_ATTEMPTS {
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
        tokio::spawn(async move {
            let r = match cfg.provider {
                Provider::Anthropic => {
                    stream_anthropic(&http, &cfg, &system, &user, max_tokens, tx.clone()).await
                }
                Provider::Openai => {
                    stream_openai(&http, &cfg, &system, &user, max_tokens, tx.clone()).await
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

const MAX_AI_ATTEMPTS: usize = 5;

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
        _ => 8000,
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

async fn stream_anthropic(
    http: &reqwest::Client,
    cfg: &AiConfig,
    system: &str,
    user: &str,
    max_tokens: u32,
    tx: mpsc::Sender<StreamEvent>,
) -> Result<()> {
    let url = format!("{}/v1/messages", cfg.base_url.trim_end_matches('/'));
    // 只在「建连 + 拿状态码」阶段重试：一旦开始读流、吐出 delta 就不能重试（否则重复内容）。
    let mut resp = None;
    for attempt in 1..=MAX_AI_ATTEMPTS {
        let body = json!({
            "model": cfg.model,
            "max_tokens": max_tokens,
            "stream": true,
            "system": system,
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
        match send {
            Ok(candidate) => {
                let status = candidate.status();
                if status.is_success() {
                    resp = Some(candidate);
                    break;
                }
                let text = candidate.text().await.unwrap_or_default();
                let retryable = should_retry_status(status) || body_is_retryable(&text);
                if retryable && attempt < MAX_AI_ATTEMPTS {
                    warn!(
                        attempt,
                        max_attempts = MAX_AI_ATTEMPTS,
                        %status,
                        "anthropic stream failed with retryable response, retrying"
                    );
                    tx.send(StreamEvent::Retry {
                        attempt: attempt + 1,
                        max: MAX_AI_ATTEMPTS,
                    })
                    .await
                    .ok();
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                error!(attempt, %status, body = %text, "anthropic stream failed");
                return Err(anyhow!("anthropic stream {} : {}", status, text));
            }
            Err(err) => {
                if should_retry_transport(&err) && attempt < MAX_AI_ATTEMPTS {
                    warn!(
                        attempt,
                        max_attempts = MAX_AI_ATTEMPTS,
                        err = %err,
                        "anthropic stream transport failed, retrying"
                    );
                    tx.send(StreamEvent::Retry {
                        attempt: attempt + 1,
                        max: MAX_AI_ATTEMPTS,
                    })
                    .await
                    .ok();
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                return Err(anyhow::Error::new(err).context("调 anthropic stream 失败（连接/超时）"));
            }
        }
    }
    let resp = resp.expect("anthropic stream retry loop must produce a response");
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("读 anthropic SSE chunk 失败")?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        // SSE 事件以空行分隔
        while let Some(idx) = buf.find("\n\n") {
            let event = buf[..idx].to_string();
            buf.drain(..idx + 2);
            // 一个 event 可能多行 data: ；只关心 data 字段
            for line in event.lines() {
                if let Some(payload) = line.strip_prefix("data: ") {
                    if payload.trim() == "[DONE]" {
                        return Ok(());
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) {
                        match v.get("type").and_then(|t| t.as_str()) {
                            Some("content_block_delta") => {
                                if let Some(text) =
                                    v.pointer("/delta/text").and_then(|t| t.as_str())
                                {
                                    if !text.is_empty() {
                                        tx.send(StreamEvent::Delta(text.to_string())).await.ok();
                                    }
                                }
                            }
                            Some("error") => {
                                let msg = v
                                    .pointer("/error/message")
                                    .and_then(|t| t.as_str())
                                    .unwrap_or("anthropic stream error");
                                return Err(anyhow!(msg.to_string()));
                            }
                            Some("message_stop") => return Ok(()),
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

async fn stream_openai(
    http: &reqwest::Client,
    cfg: &AiConfig,
    system: &str,
    user: &str,
    max_tokens: u32,
    tx: mpsc::Sender<StreamEvent>,
) -> Result<()> {
    let url = format!("{}/v1/chat/completions", cfg.base_url.trim_end_matches('/'));
    let mut resp = None;
    for attempt in 1..=MAX_AI_ATTEMPTS {
        let body = json!({
            "model": cfg.model,
            "temperature": 0.4,
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
        match send {
            Ok(candidate) => {
                let status = candidate.status();
                if status.is_success() {
                    resp = Some(candidate);
                    break;
                }
                let text = candidate.text().await.unwrap_or_default();
                if should_retry_status(status) && attempt < MAX_AI_ATTEMPTS {
                    warn!(
                        attempt,
                        max_attempts = MAX_AI_ATTEMPTS,
                        %status,
                        "openai stream failed with retryable status"
                    );
                    tx.send(StreamEvent::Retry {
                        attempt: attempt + 1,
                        max: MAX_AI_ATTEMPTS,
                    })
                    .await
                    .ok();
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                error!(attempt, %status, body = %text, "openai stream failed");
                return Err(anyhow!(openai_status_user_message(status)));
            }
            Err(err) => {
                if should_retry_transport(&err) && attempt < MAX_AI_ATTEMPTS {
                    warn!(
                        attempt,
                        max_attempts = MAX_AI_ATTEMPTS,
                        err = %err,
                        "openai stream transport failed, retrying"
                    );
                    tx.send(StreamEvent::Retry {
                        attempt: attempt + 1,
                        max: MAX_AI_ATTEMPTS,
                    })
                    .await
                    .ok();
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                error!(attempt, err = %err, "openai stream transport failed");
                return Err(anyhow!(openai_transport_user_message(&err)));
            }
        }
    }
    let resp = resp.expect("openai stream retry loop must produce a response");
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("读 openai SSE chunk 失败")?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(idx) = buf.find("\n\n") {
            let event = buf[..idx].to_string();
            buf.drain(..idx + 2);
            for line in event.lines() {
                if let Some(payload) = line.strip_prefix("data: ") {
                    if payload.trim() == "[DONE]" {
                        return Ok(());
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) {
                        if let Some(text) = v
                            .pointer("/choices/0/delta/content")
                            .and_then(|t| t.as_str())
                        {
                            if !text.is_empty() {
                                tx.send(StreamEvent::Delta(text.to_string())).await.ok();
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
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

// === 选题 AI 试评 ===

#[derive(Debug, Serialize)]
pub struct AiScoreRequest<'a> {
    pub title: &'a str,
    pub track: &'a str,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiScoreResponse {
    pub score: Score,
    pub rationale: String,
    pub suggestions: Vec<String>,
}

const SCORE_SYSTEM: &str = include_str!("ai_prompts/seed_scorer.system.md");

pub async fn score_seed(client: &AiClient, req: &AiScoreRequest<'_>) -> Result<AiScoreResponse> {
    let user = format!(
        "标题：{}\n赛道：{}\n\n请按 schema 严格只回 JSON。",
        req.title, req.track
    );
    let raw = client.complete_json(SCORE_SYSTEM, &user).await?;
    let json_str = extract_json(&raw).with_context(|| format!("AI 输出找不到 JSON 块：{raw}"))?;
    let parsed: AiScoreResponse =
        serde_json::from_str(json_str).with_context(|| format!("AI JSON 解析失败：{json_str}"))?;
    // 兜底：让分数落在 1..=5
    let s = &parsed.score;
    for (name, v) in [
        ("title", s.title),
        ("opening", s.opening),
        ("slap", s.slap),
        ("emotion", s.emotion),
        ("twist", s.twist),
        ("hook", s.hook),
        ("finish", s.finish),
        ("tagfit", s.tagfit),
    ] {
        if !(1..=5).contains(&v) {
            return Err(anyhow!("AI 给出 {} = {} 越界", name, v));
        }
    }
    Ok(parsed)
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

pub async fn stream_side_dishes(
    client: &AiClient,
    readme_md: &str,
    outline_md: &str,
    body_excerpt: &str,
) -> mpsc::Receiver<StreamEvent> {
    let user = format!(
        "README:\n{readme_md}\n\n大纲:\n{outline_md}\n\n正文节选（用于挑选段引流）:\n{body_excerpt}\n\n请输出配套.md。"
    );
    client
        .stream_text(SIDE_DISHES_SYSTEM.to_string(), user, 2000)
        .await
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
    let text = client.complete_json(WRITE_SYSTEM, &user).await?;
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
        "项目：{project_title}\n赛道：{track}\n章节：{chapter_title}\n\n本段 beat：{} — {}\n{prev}{setup_section}\n\n直接写正文段落。",
        beat.label, beat.note,
    );
    client
        .stream_text(WRITE_SYSTEM.to_string(), user, 1200)
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

pub async fn generate_seeds(client: &AiClient, track: &str) -> Result<AiSeedGenerated> {
    let user = format!("赛道：{track}\n\n请按 schema 严格只回 JSON。");
    let raw = client.complete_json(GENERATOR_SYSTEM, &user).await?;
    let json_str = extract_json(&raw).with_context(|| format!("AI 输出找不到 JSON 块：{raw}"))?;
    let parsed: AiSeedGenerated = match serde_json::from_str(json_str) {
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
    // 兜底：评分都落在 1..=5
    for c in &parsed.candidates {
        let s = &c.score;
        for (name, v) in [
            ("title", s.title),
            ("opening", s.opening),
            ("slap", s.slap),
            ("emotion", s.emotion),
            ("twist", s.twist),
            ("hook", s.hook),
            ("finish", s.finish),
            ("tagfit", s.tagfit),
        ] {
            if !(1..=5).contains(&v) {
                return Err(anyhow!("AI 给出 {} = {} 越界 (标题: {})", name, v, c.title));
            }
        }
    }
    Ok(parsed)
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
            let text = resp.text().await.context("读 nano-banana 响应失败")?;
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
            let text = resp.text().await.context("读 gpt-image-2 响应失败")?;
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
        let text = resp.text().await.context("读 nano-banana-edit 响应失败")?;
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
        let text = resp.text().await.context("读 pix 视频响应失败")?;
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
        let text = resp.text().await.context("读查询任务响应失败")?;
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
        let text = resp.text().await.context("读查询视频响应失败")?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_handles_fenced_json() {
        let raw = "```json\n{\"score\":{\"title\":5,\"opening\":4,\"slap\":4,\"emotion\":4,\"twist\":4,\"hook\":4,\"finish\":4},\"rationale\":\"x\",\"suggestions\":[]}\n```";
        let j = extract_json(raw).unwrap();
        let r: AiScoreResponse = serde_json::from_str(j).unwrap();
        assert_eq!(r.score.title, 5);
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
    fn stream_timeout_has_ten_minute_floor() {
        let cfg = AiConfig {
            provider: Provider::Openai,
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
            image_model: "gpt-image-2".into(),
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
            timeout: Duration::from_secs(900),
        };
        assert_eq!(stream_timeout(&cfg), Duration::from_secs(900));
    }
}
