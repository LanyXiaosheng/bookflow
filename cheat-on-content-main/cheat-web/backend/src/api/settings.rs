use axum::{extract::State, Json};
use serde::Deserialize;
use std::sync::Arc;

use crate::AppState;

#[derive(Deserialize)]
pub struct UpdateCookieRequest {
    pub platform: String,
    pub cookie: String,
}

pub async fn update_cookie(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateCookieRequest>,
) -> Json<serde_json::Value> {
    let result = sqlx::query(
        "INSERT INTO accounts (platform, cookie) VALUES ($1, $2) \
         ON CONFLICT (platform, (COALESCE(name, ''))) \
         DO UPDATE SET cookie = $2, updated_at = NOW()"
    )
    .bind(&req.platform)
    .bind(&req.cookie)
    .execute(&state.db)
    .await;

    // Simpler approach: upsert by platform
    let result = sqlx::query(
        "UPDATE accounts SET cookie = $1, updated_at = NOW() WHERE platform = $2"
    )
    .bind(&req.cookie)
    .bind(&req.platform)
    .execute(&state.db)
    .await;

    match result {
        Ok(r) => {
            if r.rows_affected() == 0 {
                let _ = sqlx::query(
                    "INSERT INTO accounts (platform, cookie) VALUES ($1, $2)"
                )
                .bind(&req.platform)
                .bind(&req.cookie)
                .execute(&state.db)
                .await;
            }
            Json(serde_json::json!({"status": "ok"}))
        }
        Err(e) => Json(serde_json::json!({"status": "error", "message": e.to_string()})),
    }
}

pub async fn get_status(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let accounts = sqlx::query_as::<_, (i32, String, Option<String>)>(
        "SELECT id, platform, name FROM accounts"
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let platforms: Vec<serde_json::Value> = accounts.iter().map(|(id, platform, name)| {
        serde_json::json!({
            "id": id,
            "platform": platform,
            "name": name,
            "cookie_set": true,
        })
    }).collect();

    Json(serde_json::json!({
        "accounts": platforms,
        "llm_configured": !state.config.llm_api_key.is_empty(),
        "llm_model": state.config.llm_model,
    }))
}
