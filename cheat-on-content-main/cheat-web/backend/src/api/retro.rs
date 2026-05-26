use axum::{extract::{Path, State}, Json};
use serde::Serialize;
use std::sync::Arc;

use crate::AppState;

pub async fn create_retro(
    State(state): State<Arc<AppState>>,
    Path(work_id): Path<i32>,
) -> Json<serde_json::Value> {
    // TODO: fetch actual data + call LLM for retro analysis
    Json(serde_json::json!({
        "status": "not_implemented",
        "message": "Retro flow pending"
    }))
}

pub async fn list_retros(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<serde_json::Value>> {
    let retros = sqlx::query_as::<_, crate::db::models::Retro>(
        "SELECT * FROM retros ORDER BY retro_at DESC LIMIT 50"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(retros.into_iter().map(|r| serde_json::to_value(r).unwrap()).collect())
}
