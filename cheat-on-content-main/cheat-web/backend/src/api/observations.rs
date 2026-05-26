use axum::{extract::State, Json};
use serde::Deserialize;
use std::sync::Arc;

use crate::db::models::Observation;
use crate::AppState;

pub async fn list_observations(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<Observation>> {
    let obs = sqlx::query_as::<_, Observation>(
        "SELECT * FROM observations ORDER BY created_at DESC"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(obs)
}

#[derive(Deserialize)]
pub struct AddObservationRequest {
    pub content: String,
    pub source_type: Option<String>,
}

pub async fn add_observation(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AddObservationRequest>,
) -> Json<serde_json::Value> {
    let result = sqlx::query(
        "INSERT INTO observations (content, source_type) VALUES ($1, $2)"
    )
    .bind(&req.content)
    .bind(&req.source_type)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => Json(serde_json::json!({"status": "ok"})),
        Err(e) => Json(serde_json::json!({"status": "error", "message": e.to_string()})),
    }
}
