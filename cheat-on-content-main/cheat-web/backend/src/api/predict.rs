use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;

#[derive(Deserialize)]
pub struct PredictRequest {
    pub script: String,
    pub title: Option<String>,
    pub work_id: Option<i32>,
}

#[derive(Serialize)]
pub struct PredictResponse {
    pub id: i32,
    pub scores: serde_json::Value,
    pub composite: f64,
    pub bucket: String,
    pub confidence: String,
    pub reasoning: String,
}

pub async fn create_prediction(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PredictRequest>,
) -> Json<serde_json::Value> {
    // TODO: call LLM for scoring + prediction
    Json(serde_json::json!({
        "status": "not_implemented",
        "message": "LLM integration pending"
    }))
}

pub async fn list_predictions(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<serde_json::Value>> {
    let predictions = sqlx::query_as::<_, crate::db::models::Prediction>(
        "SELECT * FROM predictions ORDER BY predicted_at DESC LIMIT 50"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(predictions.into_iter().map(|p| serde_json::to_value(p).unwrap()).collect())
}
