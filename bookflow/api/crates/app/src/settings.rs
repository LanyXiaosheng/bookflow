use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::ai::{AiConfig, Provider};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub image_model: String,
    pub timeout_secs: i32,
}

#[derive(Debug, Deserialize)]
pub struct SettingsPatch {
    pub provider: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub image_model: Option<String>,
    pub timeout_secs: Option<i32>,
}

impl Settings {
    pub fn to_ai_config(&self) -> AiConfig {
        AiConfig {
            provider: Provider::parse(&self.provider),
            base_url: self.base_url.clone(),
            api_key: self.api_key.clone(),
            model: self.model.clone(),
            image_model: self.image_model.clone(),
            timeout: std::time::Duration::from_secs(self.timeout_secs.max(1) as u64),
        }
    }

    pub fn from_ai_config(cfg: &AiConfig) -> Self {
        Self {
            provider: cfg.provider.as_str().to_string(),
            base_url: cfg.base_url.clone(),
            api_key: cfg.api_key.clone(),
            model: cfg.model.clone(),
            image_model: cfg.image_model.clone(),
            timeout_secs: cfg.timeout.as_secs() as i32,
        }
    }
}

#[derive(Clone)]
pub struct SettingsRepo {
    pool: PgPool,
}

impl SettingsRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// 读 DB 单行；DB 字段全空时返回 None，外面用 .env 兜底
    pub async fn read(&self) -> Result<Option<Settings>> {
        self.ensure_image_model_column().await?;
        let row = sqlx::query_as::<_, (String, String, String, String, String, i32)>(
            "SELECT provider, base_url, api_key, model, COALESCE(image_model, 'gpt-image-2') AS image_model, timeout_secs FROM app_settings WHERE id = TRUE",
        )
        .fetch_optional(&self.pool)
        .await
        .context("读 app_settings 失败")?;

        let Some((provider, base_url, api_key, model, image_model, timeout_secs)) = row else {
            return Ok(None);
        };

        // 关键字段都为空字符串时，认为 DB 还没设置过
        if base_url.is_empty() && api_key.is_empty() {
            return Ok(None);
        }
        Ok(Some(Settings {
            provider,
            base_url,
            api_key,
            model,
            image_model,
            timeout_secs,
        }))
    }

    pub async fn upsert(&self, s: &Settings) -> Result<Settings> {
        self.ensure_image_model_column().await?;
        let row = sqlx::query_as::<_, (String, String, String, String, String, i32)>(
            r#"
            UPDATE app_settings
            SET provider = $1, base_url = $2, api_key = $3, model = $4, image_model = $5, timeout_secs = $6
            WHERE id = TRUE
            RETURNING provider, base_url, api_key, model, image_model, timeout_secs
            "#,
        )
        .bind(&s.provider)
        .bind(&s.base_url)
        .bind(&s.api_key)
        .bind(&s.model)
        .bind(&s.image_model)
        .bind(s.timeout_secs)
        .fetch_one(&self.pool)
        .await
        .context("写 app_settings 失败")?;
        let (provider, base_url, api_key, model, image_model, timeout_secs) = row;
        Ok(Settings {
            provider,
            base_url,
            api_key,
            model,
            image_model,
            timeout_secs,
        })
    }

    async fn ensure_image_model_column(&self) -> Result<()> {
        sqlx::query(
            "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS image_model TEXT NOT NULL DEFAULT 'gpt-image-2'",
        )
        .execute(&self.pool)
        .await
        .context("补 image_model 列失败")?;
        Ok(())
    }

    /// 写 .env 兜底值进 DB（首次启动用）
    pub async fn ensure_seeded_from_env(&self, cfg: &AiConfig) -> Result<()> {
        if self.read().await?.is_none() {
            self.upsert(&Settings::from_ai_config(cfg)).await?;
        }
        Ok(())
    }
}
