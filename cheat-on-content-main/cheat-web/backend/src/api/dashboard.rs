use axum::{extract::State, Json};
use serde::Serialize;
use std::sync::Arc;

use crate::AppState;

#[derive(Serialize)]
pub struct DashboardResponse {
    pub total_works: i64,
    pub total_reads: i64,
    pub total_shows: i64,
    pub click_rate: f64,
    pub total_digg: i64,
    pub total_comments: i64,
    pub total_shelf: i64,
    pub today_read_increase: i64,
    pub today_show_increase: i64,
    pub platforms: Vec<PlatformSummary>,
}

#[derive(Serialize)]
pub struct PlatformSummary {
    pub platform: String,
    pub work_count: i64,
    pub total_reads: i64,
}

pub async fn get_dashboard(
    State(state): State<Arc<AppState>>,
) -> Json<DashboardResponse> {
    let work_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM works")
        .fetch_one(&state.db)
        .await
        .unwrap_or((0,));

    let stats = sqlx::query_as::<_, (i64, i64, i64, i64, i64)>(
        "SELECT COALESCE(SUM(read_count), 0), COALESCE(SUM(show_count), 0), \
         COALESCE(SUM(digg_count), 0), COALESCE(SUM(comment_count), 0), \
         COALESCE(SUM(shelf_count), 0) \
         FROM work_stats ws \
         WHERE ws.id IN (SELECT MAX(id) FROM work_stats GROUP BY work_id)"
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or((0, 0, 0, 0, 0));

    let click_rate = if stats.1 > 0 {
        stats.0 as f64 / stats.1 as f64
    } else {
        0.0
    };

    Json(DashboardResponse {
        total_works: work_count.0,
        total_reads: stats.0,
        total_shows: stats.1,
        click_rate,
        total_digg: stats.2,
        total_comments: stats.3,
        total_shelf: stats.4,
        today_read_increase: 0,
        today_show_increase: 0,
        platforms: vec![],
    })
}
