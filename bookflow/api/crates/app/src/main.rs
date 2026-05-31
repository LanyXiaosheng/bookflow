use std::net::SocketAddr;

use anyhow::Context;
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use bookflow_domain::{DomainError, NewSeed, Seed};
use bookflow_storage::{pool, SeedRepo};
use serde::Serialize;
use sqlx::PgPool;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::info;

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    seeds: SeedRepo,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // .env 在仓库根（bookflow/.env）
    let _ = dotenvy::from_path("../.env");
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .json()
        .init();

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL 未设置")?;
    let port: u16 = std::env::var("APP_PORT").ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);

    let pool = pool(&database_url).await.context("连不上 db")?;
    bookflow_storage::migrate(&pool).await.context("migration 失败")?;
    info!("db connected & migrated");

    let state = AppState {
        seeds: SeedRepo::new(pool.clone()),
        pool,
    };

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/seeds", post(create_seed).get(list_seeds))
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = ([0, 0, 0, 0], port).into();
    info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

#[derive(Serialize)]
struct Health {
    db: bool,
}

async fn healthz(State(s): State<AppState>) -> impl IntoResponse {
    let db_ok = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&s.pool)
        .await
        .is_ok();
    let code = if db_ok { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE };
    (code, Json(Health { db: db_ok }))
}

async fn create_seed(
    State(s): State<AppState>,
    Json(payload): Json<NewSeed>,
) -> Result<(StatusCode, Json<Seed>), AppError> {
    payload.validate().map_err(AppError::Domain)?;
    let seed = s.seeds.insert(&payload).await.map_err(AppError::Storage)?;
    Ok((StatusCode::CREATED, Json(seed)))
}

async fn list_seeds(State(s): State<AppState>) -> Result<Json<Vec<Seed>>, AppError> {
    let seeds = s.seeds.list().await.map_err(AppError::Storage)?;
    Ok(Json(seeds))
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error(transparent)]
    Domain(DomainError),
    #[error(transparent)]
    Storage(bookflow_storage::StorageError),
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        match self {
            AppError::Domain(e) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": e })),
            )
                .into_response(),
            AppError::Storage(e) => {
                tracing::error!(err = %e, "storage error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "internal" })),
                )
                    .into_response()
            }
        }
    }
}
