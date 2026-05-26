use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawledWork {
    pub platform_id: String,
    pub item_id: Option<String>,
    pub title: String,
    pub word_count: i32,
    pub category: Option<String>,
    pub sign_status: i32,
    pub create_time: Option<i64>,
    pub update_time: Option<i64>,
    pub read_count: i64,
    pub is_data_show: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawledStats {
    pub read_count: i64,
    pub show_count: i64,
    pub click_rate: f32,
    pub digg_count: i32,
    pub comment_count: i32,
    pub shelf_count: i32,
    pub pay_rate: f32,
    pub popularity_score: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawledDaily {
    pub date: NaiveDate,
    pub show_count: i32,
    pub read_count: i32,
    pub read_100_percent: i32,
    pub read_15s: i32,
    pub read_30s: i32,
    pub read_60s: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountStats {
    pub read_count: i64,
    pub show_count: i64,
    pub click_rate: f32,
    pub digg_count: i32,
    pub comment_count: i32,
    pub shelf_count: i32,
    pub pay_rate: f32,
    pub popularity_score: i32,
    pub read_count_increase: i64,
    pub show_count_increase: i64,
}
