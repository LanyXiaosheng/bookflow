use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use bookflow_domain::Score;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// 后端用的 AI 配置（从 env 读）
#[derive(Clone)]
pub struct AiConfig {
    pub provider: Provider,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub timeout: Duration,
}

#[derive(Clone, Copy, Debug)]
pub enum Provider {
    Anthropic,
    Openai,
}

impl AiConfig {
    pub fn from_env() -> Result<Self> {
        let provider = match std::env::var("AI_PROVIDER")
            .unwrap_or_else(|_| "anthropic".into())
            .to_ascii_lowercase()
            .as_str()
        {
            "openai" => Provider::Openai,
            _ => Provider::Anthropic,
        };
        let base_url = std::env::var("AI_BASE_URL").context("AI_BASE_URL 未设置")?;
        let api_key = std::env::var("AI_API_KEY").context("AI_API_KEY 未设置")?;
        let model = std::env::var("AI_MODEL").context("AI_MODEL 未设置")?;
        let timeout = Duration::from_secs(
            std::env::var("AI_TIMEOUT_SECS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(60),
        );
        Ok(Self { provider, base_url, api_key, model, timeout })
    }
}

#[derive(Clone)]
pub struct AiClient {
    cfg: AiConfig,
    http: reqwest::Client,
}

impl AiClient {
    pub fn new(cfg: AiConfig) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(cfg.timeout)
            .build()
            .context("构建 reqwest client 失败")?;
        Ok(Self { cfg, http })
    }

    /// 发一段 user 消息，让模型严格回 JSON。返回模型的纯文本响应。
    pub async fn complete_json(&self, system: &str, user: &str) -> Result<String> {
        match self.cfg.provider {
            Provider::Anthropic => self.complete_anthropic(system, user).await,
            Provider::Openai => self.complete_openai(system, user).await,
        }
    }

    async fn complete_anthropic(&self, system: &str, user: &str) -> Result<String> {
        let url = format!("{}/v1/messages", self.cfg.base_url.trim_end_matches('/'));
        let body = json!({
            "model": self.cfg.model,
            "max_tokens": 1024,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        });
        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.cfg.api_key))
            .header("x-api-key", &self.cfg.api_key)
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

    async fn complete_openai(&self, system: &str, user: &str) -> Result<String> {
        let url = format!(
            "{}/v1/chat/completions",
            self.cfg.base_url.trim_end_matches('/')
        );
        let body = json!({
            "model": self.cfg.model,
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
            .bearer_auth(&self.cfg.api_key)
            .json(&body)
            .send()
            .await
            .context("调 openai 失败（连接/超时）")?;
        let status = resp.status();
        let text = resp.text().await.context("读 openai 响应失败")?;
        if !status.is_success() {
            return Err(anyhow!("openai {} : {}", status, text));
        }
        let parsed: OpenAiResp = serde_json::from_str(&text)
            .with_context(|| format!("解析 openai 响应失败: {text}"))?;
        let out = parsed
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .unwrap_or_default();
        Ok(out)
    }
}

#[derive(Deserialize)]
struct AnthropicResp {
    content: Vec<AnthropicBlock>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AnthropicBlock {
    Text { text: String },
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

pub async fn score_seed(
    client: &AiClient,
    req: &AiScoreRequest<'_>,
) -> Result<AiScoreResponse> {
    let user = format!(
        "标题：{}\n赛道：{}\n\n请按 schema 严格只回 JSON。",
        req.title, req.track
    );
    let raw = client.complete_json(SCORE_SYSTEM, &user).await?;
    let json_str = extract_json(&raw)
        .with_context(|| format!("AI 输出找不到 JSON 块：{raw}"))?;
    let parsed: AiScoreResponse = serde_json::from_str(json_str)
        .with_context(|| format!("AI JSON 解析失败：{json_str}"))?;
    // 兜底：让分数落在 1..=5
    let s = &parsed.score;
    for (name, v) in [
        ("title", s.title), ("opening", s.opening), ("slap", s.slap),
        ("emotion", s.emotion), ("twist", s.twist), ("hook", s.hook), ("finish", s.finish),
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
}
