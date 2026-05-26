use axum::{extract::State, Json};
use serde::Deserialize;
use std::sync::Arc;

use crate::db::models::Candidate;
use crate::AppState;

pub async fn list_candidates(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<Candidate>> {
    let candidates = sqlx::query_as::<_, Candidate>(
        "SELECT * FROM candidates WHERE status != 'dropped' ORDER BY composite DESC NULLS LAST"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(candidates)
}

#[derive(Deserialize)]
pub struct AddCandidateRequest {
    pub title: String,
    pub source: Option<String>,
    pub notes: Option<String>,
}

pub async fn add_candidate(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AddCandidateRequest>,
) -> Json<serde_json::Value> {
    let result = sqlx::query(
        "INSERT INTO candidates (title, source, notes) VALUES ($1, $2, $3)"
    )
    .bind(&req.title)
    .bind(&req.source)
    .bind(&req.notes)
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => Json(serde_json::json!({"status": "ok"})),
        Err(e) => Json(serde_json::json!({"status": "error", "message": e.to_string()})),
    }
}

pub async fn generate_seeds(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    // TODO: call LLM to generate seed topics based on historical data
    Json(serde_json::json!({
        "status": "not_implemented",
        "message": "AI seed generation pending"
    }))
}
