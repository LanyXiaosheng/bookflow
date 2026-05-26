use axum::{extract::State, Json};
use serde::Deserialize;
use std::sync::Arc;

use crate::db::models::RubricVersion;
use crate::AppState;

pub async fn get_rubric(
    State(state): State<Arc<AppState>>,
) -> Json<Option<RubricVersion>> {
    let rubric = sqlx::query_as::<_, RubricVersion>(
        "SELECT * FROM rubric_versions ORDER BY created_at DESC LIMIT 1"
    )
    .fetch_optional(&state.db)
    .await
    .unwrap_or(None);

    Json(rubric)
}

#[derive(Deserialize)]
pub struct UpdateRubricRequest {
    pub version: String,
    pub dimensions: serde_json::Value,
    pub bucket_ranges: serde_json::Value,
    pub notes: Option<String>,
}

pub async fn update_rubric(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateRubricRequest>,
) -> Json<serde_json::Value> {
    let result = sqlx::query(
        "INSERT INTO rubric_versions (version, dimensions, bucket_ranges, notes) \
         VALUES ($1, $2, $3, $4)"
    )
    .bind(&req.version)
    .bind(&req.dimensions)
    .bind(&req.bucket_ranges)
    .bind(&req.notes)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => Json(serde_json::json!({"status": "ok"})),
        Err(e) => Json(serde_json::json!({"status": "error", "message": e.to_string()})),
    }
}

pub async fn get_history(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<RubricVersion>> {
    let versions = sqlx::query_as::<_, RubricVersion>(
        "SELECT * FROM rubric_versions ORDER BY created_at ASC"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(versions)
}
