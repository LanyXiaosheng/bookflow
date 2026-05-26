use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::db::models::{Work, WorkDaily, WorkStat};
use crate::AppState;

#[derive(Deserialize)]
pub struct ListParams {
    pub platform: Option<String>,
    pub category: Option<String>,
    pub min_reads: Option<i64>,
    pub sort_by: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Serialize)]
pub struct WorkListResponse {
    pub works: Vec<WorkWithStats>,
    pub total: i64,
}

#[derive(Serialize)]
pub struct WorkWithStats {
    #[serde(flatten)]
    pub work: Work,
    pub read_count: i64,
    pub show_count: i64,
    pub click_rate: f32,
    pub digg_count: i32,
    pub comment_count: i32,
    pub shelf_count: i32,
}

pub async fn list_works(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ListParams>,
) -> Json<WorkListResponse> {
    let page = params.page.unwrap_or(0);
    let page_size = params.page_size.unwrap_or(50);
    let offset = page * page_size;

    let works = sqlx::query_as::<_, Work>(
        "SELECT * FROM works ORDER BY create_time DESC LIMIT $1 OFFSET $2"
    )
    .bind(page_size)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM works")
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));

    let mut result = Vec::new();
    for work in works {
        let stat = sqlx::query_as::<_, WorkStat>(
            "SELECT * FROM work_stats WHERE work_id = $1 ORDER BY fetched_at DESC LIMIT 1"
        )
        .bind(work.id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);

        result.push(WorkWithStats {
            read_count: stat.as_ref().map(|s| s.read_count).unwrap_or(0),
            show_count: stat.as_ref().map(|s| s.show_count).unwrap_or(0),
            click_rate: stat.as_ref().map(|s| s.click_rate).unwrap_or(0.0),
            digg_count: stat.as_ref().map(|s| s.digg_count).unwrap_or(0),
            comment_count: stat.as_ref().map(|s| s.comment_count).unwrap_or(0),
            shelf_count: stat.as_ref().map(|s| s.shelf_count).unwrap_or(0),
            work,
        });
    }

    Json(WorkListResponse {
        works: result,
        total: total.0,
    })
}

pub async fn get_work(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i32>,
) -> Json<Option<WorkWithStats>> {
    let work = sqlx::query_as::<_, Work>("SELECT * FROM works WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);

    let Some(work) = work else {
        return Json(None);
    };

    let stat = sqlx::query_as::<_, WorkStat>(
        "SELECT * FROM work_stats WHERE work_id = $1 ORDER BY fetched_at DESC LIMIT 1"
    )
    .bind(work.id)
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    Json(Some(WorkWithStats {
        read_count: stat.as_ref().map(|s| s.read_count).unwrap_or(0),
        show_count: stat.as_ref().map(|s| s.show_count).unwrap_or(0),
        click_rate: stat.as_ref().map(|s| s.click_rate).unwrap_or(0.0),
        digg_count: stat.as_ref().map(|s| s.digg_count).unwrap_or(0),
        comment_count: stat.as_ref().map(|s| s.comment_count).unwrap_or(0),
        shelf_count: stat.as_ref().map(|s| s.shelf_count).unwrap_or(0),
        work,
    }))
}

pub async fn get_work_stats(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i32>,
) -> Json<Vec<WorkStat>> {
    let stats = sqlx::query_as::<_, WorkStat>(
        "SELECT * FROM work_stats WHERE work_id = $1 ORDER BY fetched_at ASC"
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(stats)
}

pub async fn get_work_daily(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i32>,
) -> Json<Vec<WorkDaily>> {
    let daily = sqlx::query_as::<_, WorkDaily>(
        "SELECT * FROM work_daily WHERE work_id = $1 ORDER BY date ASC"
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(daily)
}

pub async fn trigger_sync(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    // TODO: trigger crawler sync job
    Json(serde_json::json!({"status": "sync_triggered"}))
}
