use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct LlmClient {
    http: Client,
    api_key: String,
    model: String,
}

#[derive(Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
}

#[derive(Deserialize)]
struct ChatResponse {
    content: Option<Vec<ContentBlock>>,
}

#[derive(Deserialize)]
struct ContentBlock {
    text: Option<String>,
}

impl LlmClient {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            http: Client::new(),
            api_key,
            model,
        }
    }

    pub async fn chat(&self, system: &str, user_msg: &str) -> Result<String> {
        let req = ChatRequest {
            model: self.model.clone(),
            max_tokens: 4096,
            messages: vec![
                Message { role: "user".to_string(), content: user_msg.to_string() },
            ],
        };

        let resp = self.http
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&serde_json::json!({
                "model": self.model,
                "max_tokens": 4096,
                "system": system,
                "messages": [{"role": "user", "content": user_msg}]
            }))
            .send()
            .await?
            .error_for_status()?
            .json::<serde_json::Value>()
            .await?;

        let text = resp.get("content")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|b| b.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        Ok(text)
    }

    pub async fn score_script(&self, script: &str, rubric_json: &str) -> Result<serde_json::Value> {
        let system = "你是一个内容评分专家。根据给定的 rubric 维度定义，对稿子进行 1-5 分打分。\
                      返回 JSON 格式：{\"scores\": {\"维度名\": 分数}, \"composite\": 加权总分, \
                      \"bucket\": \"预测阅读区间\", \"reasoning\": \"一句话理由\"}";

        let user_msg = format!(
            "## Rubric\n{}\n\n## 稿子\n{}\n\n请打分并预测阅读区间。返回纯 JSON。",
            rubric_json, script
        );

        let resp = self.chat(system, &user_msg).await?;
        let parsed: serde_json::Value = serde_json::from_str(&resp)
            .unwrap_or(serde_json::json!({"error": "parse_failed", "raw": resp}));

        Ok(parsed)
    }

    pub async fn generate_retro(
        &self,
        prediction_json: &str,
        actual_data_json: &str,
        daily_json: &str,
    ) -> Result<serde_json::Value> {
        let system = "你是一个内容复盘分析师。对比预测和实际数据，分析偏差原因，提取可复用的观察。\
                      返回 JSON：{\"hit\": bool, \"error_direction\": \"over/under/hit\", \
                      \"analysis\": \"分析文本\", \"observations\": [\"观察1\", \"观察2\"]}";

        let user_msg = format!(
            "## 预测\n{}\n\n## 实际数据\n{}\n\n## 日增长\n{}\n\n请复盘。返回纯 JSON。",
            prediction_json, actual_data_json, daily_json
        );

        let resp = self.chat(system, &user_msg).await?;
        let parsed: serde_json::Value = serde_json::from_str(&resp)
            .unwrap_or(serde_json::json!({"error": "parse_failed", "raw": resp}));

        Ok(parsed)
    }

    pub async fn recommend_seeds(
        &self,
        history_json: &str,
        rubric_json: &str,
    ) -> Result<serde_json::Value> {
        let system = "你是一个选题推荐专家。基于历史爆款数据和评分公式，推荐下一篇选题方向。\
                      返回 JSON：{\"seeds\": [{\"title\": \"建议标题\", \"angle\": \"切入角度\", \
                      \"rationale\": \"推荐理由\", \"estimated_tier\": \"tier1/tier2\"}]}";

        let user_msg = format!(
            "## 历史数据（按阅读量排序）\n{}\n\n## 当前 Rubric\n{}\n\n请推荐 3-5 个选题。返回纯 JSON。",
            history_json, rubric_json
        );

        let resp = self.chat(system, &user_msg).await?;
        let parsed: serde_json::Value = serde_json::from_str(&resp)
            .unwrap_or(serde_json::json!({"error": "parse_failed", "raw": resp}));

        Ok(parsed)
    }
}
