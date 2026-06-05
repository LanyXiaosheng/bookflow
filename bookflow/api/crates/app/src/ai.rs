use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use bookflow_domain::{Beat, Score};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{mpsc, RwLock};

/// 后端用的 AI 配置（从 env 读，运行时可被 Settings 接口热替换）
#[derive(Clone, Debug)]
pub struct AiConfig {
    pub provider: Provider,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
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
            "openai" => Provider::Openai,
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
            timeout,
        })
    }
}

#[derive(Clone)]
pub struct AiClient {
    cfg: Arc<RwLock<AiConfig>>,
    http: reqwest::Client,
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
        let body = json!({
            "model": cfg.model,
            "max_tokens": 1024,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        });
        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", cfg.api_key))
            .header("x-api-key", &cfg.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .context("调 anthropic 失败（连接/超时）")?;
        let status = resp.status();
        let text = resp.text().await.context("读 anthropic 响应失败")?;
        if !status.is_success() {
            return Err(anyhow!("anthropic {} : {}", status, text));
        }
        let parsed: AnthropicResp = serde_json::from_str(&text)
            .with_context(|| format!("解析 anthropic 响应失败: {text}"))?;
        let out = parsed
            .content
            .into_iter()
            .filter_map(|b| match b {
                AnthropicBlock::Text { text } => Some(text),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");
        Ok(out)
    }

    async fn complete_openai(&self, cfg: &AiConfig, system: &str, user: &str) -> Result<String> {
        let url = format!("{}/v1/chat/completions", cfg.base_url.trim_end_matches('/'));
        let body = json!({
            "model": cfg.model,
            "temperature": 0.4,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        });
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&cfg.api_key)
            .json(&body)
            .send()
            .await
            .context("调 openai 失败（连接/超时）")?;
        let status = resp.status();
        let text = resp.text().await.context("读 openai 响应失败")?;
        if !status.is_success() {
            return Err(anyhow!("openai {} : {}", status, text));
        }
        let parsed: OpenAiResp =
            serde_json::from_str(&text).with_context(|| format!("解析 openai 响应失败: {text}"))?;
        let out = parsed
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default();
        Ok(out)
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
    Done,
    Error(String),
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
    let body = json!({
        "model": cfg.model,
        "max_tokens": max_tokens,
        "stream": true,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    });
    let resp = http
        .post(&url)
        .header("x-api-key", &cfg.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .context("调 anthropic stream 失败（连接/超时）")?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("anthropic stream {} : {}", status, text));
    }
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
    let resp = http
        .post(&url)
        .bearer_auth(&cfg.api_key)
        .header("accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .context("调 openai stream 失败（连接/超时）")?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("openai stream {} : {}", status, text));
    }
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
const OUTLINE_SYSTEM: &str = include_str!("ai_prompts/project_outline.system.md");
const PUBLISH_SYSTEM: &str = include_str!("ai_prompts/project_publish.system.md");
const SIDE_DISHES_SYSTEM: &str = include_str!("ai_prompts/project_side_dishes.system.md");
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

pub async fn stream_outline(client: &AiClient, readme_md: &str) -> mpsc::Receiver<StreamEvent> {
    let user = format!(
        "项目 README：\n\n{readme_md}\n\n请按大纲模板输出（故事主线 + 10 章细纲 + 爆点节奏表）。"
    );
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

pub async fn stream_book_summary(
    client: &AiClient,
    full_book_source: &str,
) -> mpsc::Receiver<StreamEvent> {
    let user =
        format!("下面是按章节整理的全书原稿：\n\n{full_book_source}\n\n请整合成一版连贯完整正文。");
    client
        .stream_text(BOOK_SUMMARY_SYSTEM.to_string(), user, 12000)
        .await
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
) -> Result<String> {
    let prev = if prev_tail.trim().is_empty() {
        "（这是章节第一段，无上文）".to_string()
    } else {
        format!("上一段结尾（衔接用，别复述）：\n{}", prev_tail.trim())
    };
    let user = format!(
        "项目：{project_title}\n赛道：{track}\n章节：{chapter_title}\n\n本段 beat：{} — {}\n\n{prev}\n\n直接写正文段落。",
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
) -> mpsc::Receiver<StreamEvent> {
    let prev = if prev_tail.trim().is_empty() {
        "（这是章节第一段，无上文）".to_string()
    } else {
        format!("上一段结尾（衔接用，别复述）：\n{}", prev_tail.trim())
    };
    let user = format!(
        "项目：{project_title}\n赛道：{track}\n章节：{chapter_title}\n\n本段 beat：{} — {}\n\n{prev}\n\n直接写正文段落。",
        beat.label, beat.note,
    );
    client
        .stream_text(WRITE_SYSTEM.to_string(), user, 1600)
        .await
}

// === 选题批量生成 ===

const GENERATOR_SYSTEM: &str = include_str!("ai_prompts/seed_generator.system.md");

#[derive(Debug, Serialize, Deserialize)]
pub struct AiSeedCandidate {
    pub title: String,
    pub score: Score,
    pub why_buy: String,
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
        ] {
            if !(1..=5).contains(&v) {
                return Err(anyhow!("AI 给出 {} = {} 越界 (标题: {})", name, v, c.title));
            }
        }
    }
    Ok(parsed)
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
    fn summary_prompt_mentions_full_book_rewrite() {
        let system = BOOK_SUMMARY_SYSTEM;
        assert!(system.contains("连贯"));
        assert!(system.contains("完整正文"));
    }

    #[test]
    fn polish_prompt_mentions_de_ai_and_immersion() {
        let system = BOOK_POLISH_SYSTEM;
        assert!(system.contains("去 AI 味"));
        assert!(system.contains("代入感"));
    }
}
