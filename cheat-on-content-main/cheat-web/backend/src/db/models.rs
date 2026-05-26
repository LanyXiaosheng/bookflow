use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct Account {
    pub id: i32,
    pub platform: String,
    pub name: Option<String>,
    pub cookie: Option<String>,
    pub meta: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct Work {
    pub id: i32,
    pub account_id: i32,
    pub platform: String,
    pub platform_id: String,
    pub item_id: Option<String>,
    pub title: String,
    pub word_count: i32,
    pub category: Option<String>,
    pub sign_status: i32,
    pub create_time: Option<DateTime<Utc>>,
    pub update_time: Option<DateTime<Utc>>,
    pub meta: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct WorkStat {
    pub id: i32,
    pub work_id: i32,
    pub read_count: i64,
    pub show_count: i64,
    pub click_rate: f32,
    pub digg_count: i32,
    pub comment_count: i32,
    pub shelf_count: i32,
    pub pay_rate: f32,
    pub popularity_score: i32,
    pub meta: serde_json::Value,
    pub fetched_at: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct WorkDaily {
    pub id: i32,
    pub work_id: i32,
    pub date: NaiveDate,
    pub show_count: i32,
    pub read_count: i32,
    pub read_100_percent: i32,
    pub read_15s: i32,
    pub read_30s: i32,
    pub read_60s: i32,
    pub meta: serde_json::Value,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct Prediction {
    pub id: i32,
    pub work_id: i32,
    pub rubric_version: String,
    pub scores: serde_json::Value,
    pub composite: Option<f64>,
    pub bucket: Option<String>,
    pub confidence: Option<String>,
    pub reasoning: Option<String>,
    pub blind_scores: Option<serde_json::Value>,
    pub predicted_at: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct Retro {
    pub id: i32,
    pub work_id: i32,
    pub prediction_id: Option<i32>,
    pub actual_read: Option<i64>,
    pub actual_bucket: Option<String>,
    pub hit: Option<bool>,
    pub analysis: Option<String>,
    pub observations: Option<serde_json::Value>,
    pub retro_at: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct RubricVersion {
    pub id: i32,
    pub version: String,
    pub dimensions: serde_json::Value,
    pub bucket_ranges: serde_json::Value,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct Candidate {
    pub id: i32,
    pub title: String,
    pub source: Option<String>,
    pub scores: Option<serde_json::Value>,
    pub composite: Option<f64>,
    pub tier: Option<String>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
pub struct Observation {
    pub id: i32,
    pub content: String,
    pub source_type: Option<String>,
    pub source_id: Option<i32>,
    pub status: String,
    pub created_at: DateTime<Utc>,
}
