use axum::{
    routing::{get, post, put},
    Router,
};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod config;
mod crawler;
mod db;
mod llm;
mod scheduler;

pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: config::Config,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = config::Config::from_env();

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    let state = Arc::new(AppState { db: pool.clone(), config });

    scheduler::start(state.clone()).await;

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/dashboard", get(api::dashboard::get_dashboard))
        .route("/api/works", get(api::works::list_works))
        .route("/api/works/{id}", get(api::works::get_work))
        .route("/api/works/{id}/stats", get(api::works::get_work_stats))
        .route("/api/works/{id}/daily", get(api::works::get_work_daily))
        .route("/api/works/sync", post(api::works::trigger_sync))
        .route("/api/predict", post(api::predict::create_prediction))
        .route("/api/predictions", get(api::predict::list_predictions))
        .route("/api/retro/{work_id}", post(api::retro::create_retro))
        .route("/api/retros", get(api::retro::list_retros))
        .route("/api/rubric", get(api::rubric::get_rubric))
        .route("/api/rubric", put(api::rubric::update_rubric))
        .route("/api/rubric/history", get(api::rubric::get_history))
        .route("/api/candidates", get(api::seeds::list_candidates))
        .route("/api/candidates", post(api::seeds::add_candidate))
        .route("/api/seeds/generate", post(api::seeds::generate_seeds))
        .route("/api/observations", get(api::observations::list_observations))
        .route("/api/observations", post(api::observations::add_observation))
        .route("/api/settings/cookie", put(api::settings::update_cookie))
        .route("/api/settings/status", get(api::settings::get_status))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    tracing::info!("Backend listening on :8080");
    axum::serve(listener, app).await?;

    Ok(())
}
