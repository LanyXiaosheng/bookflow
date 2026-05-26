use anyhow::Result;
use chrono::NaiveDate;
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;

use super::types::*;

const BASE_URL: &str = "https://fanqienovel.com";
const SHORT_LIST_API: &str = "/api/author/short_article/list/v0/";
const STATS_COMMON_API: &str = "/api/author/sa_stats/common/v0/";
const STATS_SINGLE_API: &str = "/api/author/sa_stats/single_common/v0/";
const STATS_BY_DATE_API: &str = "/api/author/sa_stats/single_by_date/v0/";

pub struct FanqieClient {
    http: Client,
    cookie: String,
}

#[derive(Deserialize)]
struct ApiResponse<T> {
    code: i32,
    message: Option<String>,
    data: Option<T>,
}

#[derive(Deserialize)]
struct ListData {
    item_list: Option<Vec<RawWork>>,
    total_count: Option<i64>,
}

#[derive(Deserialize)]
struct RawWork {
    book_id: Option<String>,
    item_id: Option<String>,
    multi_title: Option<Vec<String>>,
    title: Option<String>,
    word_count: Option<serde_json::Value>,
    category: Option<Vec<CategoryItem>>,
    sign_status: Option<i32>,
    create_time: Option<serde_json::Value>,
    update_time: Option<serde_json::Value>,
    read_count: Option<serde_json::Value>,
    is_data_show: Option<i32>,
}

#[derive(Deserialize)]
struct CategoryItem {
    name: Option<String>,
}

impl FanqieClient {
    pub fn new(cookie: String) -> Self {
        let http = Client::builder()
            .default_headers({
                let mut h = reqwest::header::HeaderMap::new();
                h.insert("accept", "application/json, text/plain, */*".parse().unwrap());
                h.insert("accept-language", "zh-CN,zh;q=0.9".parse().unwrap());
                h.insert("referer", "https://fanqienovel.com/main/writer/short-manage".parse().unwrap());
                h.insert("sec-fetch-dest", "empty".parse().unwrap());
                h.insert("sec-fetch-mode", "cors".parse().unwrap());
                h.insert("sec-fetch-site", "same-origin".parse().unwrap());
                h.insert("user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36".parse().unwrap());
                h
            })
            .build()
            .unwrap();

        Self { http, cookie }
    }

    async fn get_raw(&self, path: &str, params: &[(&str, &str)]) -> Result<serde_json::Value> {
        let url = format!("{}{}", BASE_URL, path);
        let resp = self.http
            .get(&url)
            .query(params)
            .header("cookie", &self.cookie)
            .send()
            .await?
            .error_for_status()?
            .json::<serde_json::Value>()
            .await?;

        let code = resp.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
        if code != 0 {
            let msg = resp.get("message").and_then(|v| v.as_str()).unwrap_or("unknown");
            anyhow::bail!("API error code={}: {}", code, msg);
        }

        Ok(resp.get("data").cloned().unwrap_or(serde_json::Value::Null))
    }

    pub async fn fetch_all_works(&self) -> Result<Vec<CrawledWork>> {
        let mut all = Vec::new();
        let mut page: u32 = 0;

        loop {
            let page_str = page.to_string();
            let params = vec![
                ("aid", "2503"),
                ("app_name", "muye_novel"),
                ("page_count", "20"),
                ("page_index", page_str.as_str()),
                ("status", "0"),
                ("time_sort", "0"),
                ("image_fmt_list", "450x800"),
                ("book_image_fmt_list", "190x250"),
                ("pack_type", "1"),
            ];

            let data = self.get_raw(SHORT_LIST_API, &params).await?;
            let items = data.get("item_list").and_then(|v| v.as_array()).cloned().unwrap_or_default();

            if items.is_empty() {
                break;
            }

            for item in &items {
                all.push(normalize_work(item));
            }

            let total = data.get("total_count").and_then(|v| v.as_i64()).unwrap_or(0);
            if all.len() as i64 >= total {
                break;
            }

            page += 1;
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }

        Ok(all)
    }

    pub async fn fetch_account_stats(&self) -> Result<AccountStats> {
        let params = vec![("aid", "2503"), ("app_name", "muye_novel")];
        let data = self.get_raw(STATS_COMMON_API, &params).await?;

        Ok(AccountStats {
            read_count: val_i64(&data, "read_count"),
            show_count: val_i64(&data, "show_count"),
            click_rate: val_f32(&data, "click_rate"),
            digg_count: val_i32(&data, "digg_count"),
            comment_count: val_i32(&data, "comment_count"),
            shelf_count: val_i32(&data, "shelf_count"),
            pay_rate: val_f32(&data, "douyin_pay_rate"),
            popularity_score: val_i32(&data, "douyin_read_popularity_score"),
            read_count_increase: val_i64(&data, "read_count_increase"),
            show_count_increase: val_i64(&data, "show_count_increase"),
        })
    }

    pub async fn fetch_work_stats(&self, book_id: &str) -> Result<CrawledStats> {
        let params = vec![("aid", "2503"), ("app_name", "muye_novel"), ("book_id", book_id)];
        let data = self.get_raw(STATS_SINGLE_API, &params).await?;

        Ok(CrawledStats {
            read_count: val_i64(&data, "read_count"),
            show_count: val_i64(&data, "show_count"),
            click_rate: val_f32(&data, "click_rate"),
            digg_count: val_i32(&data, "digg_count"),
            comment_count: val_i32(&data, "comment_count"),
            shelf_count: val_i32(&data, "shelf_count"),
            pay_rate: val_f32(&data, "douyin_pay_rate"),
            popularity_score: val_i32(&data, "douyin_read_popularity_score"),
        })
    }

    pub async fn fetch_work_daily(&self, book_id: &str, date: NaiveDate) -> Result<CrawledDaily> {
        let ts = date.and_hms_opt(0, 0, 0).unwrap()
            .and_utc().timestamp().to_string();
        let params = vec![
            ("aid", "2503"),
            ("app_name", "muye_novel"),
            ("book_id", book_id),
            ("start_date", ts.as_str()),
            ("end_date", ts.as_str()),
        ];
        let data = self.get_raw(STATS_BY_DATE_API, &params).await?;

        Ok(CrawledDaily {
            date,
            show_count: val_i32(&data, "show_count"),
            read_count: val_i32(&data, "read_count"),
            read_100_percent: val_i32(&data, "read_100_percent_count"),
            read_15s: val_i32(&data, "read_count_15s"),
            read_30s: val_i32(&data, "read_count_30s"),
            read_60s: val_i32(&data, "read_count_60s"),
        })
    }
}

fn normalize_work(item: &serde_json::Value) -> CrawledWork {
    let multi_title = item.get("multi_title")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let title = if multi_title.is_empty() {
        item.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string()
    } else {
        multi_title.to_string()
    };

    let categories: Vec<String> = item.get("category")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter()
            .filter_map(|c| c.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
            .collect())
        .unwrap_or_default();

    CrawledWork {
        platform_id: item.get("book_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        item_id: item.get("item_id").and_then(|v| v.as_str()).map(|s| s.to_string()),
        title,
        word_count: val_i32(item, "word_count"),
        category: if categories.is_empty() { None } else { Some(categories.join(" / ")) },
        sign_status: item.get("sign_status").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
        create_time: val_opt_i64(item, "create_time"),
        update_time: val_opt_i64(item, "update_time"),
        read_count: val_i64(item, "read_count"),
        is_data_show: item.get("is_data_show").and_then(|v| v.as_i64()).unwrap_or(0) == 1,
    }
}

fn val_i64(data: &serde_json::Value, key: &str) -> i64 {
    match data.get(key) {
        Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(serde_json::Value::String(s)) => s.parse::<i64>().unwrap_or(0),
        _ => 0,
    }
}

fn val_i32(data: &serde_json::Value, key: &str) -> i32 {
    val_i64(data, key) as i32
}

fn val_f32(data: &serde_json::Value, key: &str) -> f32 {
    match data.get(key) {
        Some(serde_json::Value::Number(n)) => n.as_f64().unwrap_or(0.0) as f32,
        Some(serde_json::Value::String(s)) => s.parse::<f32>().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn val_opt_i64(data: &serde_json::Value, key: &str) -> Option<i64> {
    match data.get(key) {
        Some(serde_json::Value::Number(n)) => n.as_i64(),
        Some(serde_json::Value::String(s)) => s.parse::<i64>().ok(),
        _ => None,
    }
}
