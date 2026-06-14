use std::net::SocketAddr;

use anyhow::Context;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
    routing::{get, post, put},
    Json, Router,
};
use bookflow_domain::{
    Beat, Chapter, DomainError, NewSeed, Notification, NotificationCategory, NotificationLevel,
    PendingProjectReview, Project, ProjectReview, ProjectStatus, ReviewResult, ReviewStage, Seed,
    User,
};
use bookflow_storage::{
    pool, ArtifactKind, ArtifactRepo, ChapterRepo, NewSeedDraft, NotificationRepo, ProjectArtifact,
    ProjectRepo, ProjectReviewRepo, SeedDraft, SeedDraftRepo, SeedRepo, UpsertNotification,
    UserRepo,
};
use futures_util::stream::Stream;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::info;
use uuid::Uuid;

mod ai;
mod character_names;
mod docs;
mod settings;
use ai::{
    beats_for_chapter, generate_seeds, score_seed, stream_blurb, stream_book_polish,
    stream_book_summary_chapters, stream_character_setup, stream_outline, stream_publish_post,
    stream_readme, stream_side_dishes, stream_write_paragraph, write_paragraph, AiClient,
    AiConfig, AiScoreRequest, AiScoreResponse, AiSeedGenerated, DuoMiClient, GeneratedImage,
    StreamEvent,
};
use character_names::{
    apply_exact_replacement, build_preview_item, extract_candidate_names, local_recommended_name,
    CharacterNameCandidate, CharacterReplacementPreview, CharacterReplacementPreviewItem,
    LocalCharacterRenameRecommendation,
};
use docs::DocRoot;
use settings::{Settings, SettingsPatch, SettingsRepo};

struct AppState {
    pool: PgPool,
    seeds: SeedRepo,
    seed_drafts: SeedDraftRepo,
    users: UserRepo,
    projects: ProjectRepo,
    reviews: ProjectReviewRepo,
    chapters: ChapterRepo,
    artifacts: ArtifactRepo,
    notifications: NotificationRepo,
    ai: AiClient,
    duomi: DuoMiClient,
    settings: SettingsRepo,
    tracks: DocRoot,
    playbook: DocRoot,
}

impl Clone for AppState {
    fn clone(&self) -> Self {
        Self {
            pool: self.pool.clone(),
            seeds: self.seeds.clone(),
            seed_drafts: self.seed_drafts.clone(),
            users: self.users.clone(),
            projects: self.projects.clone(),
            reviews: ProjectReviewRepo::new(self.pool.clone()),
            chapters: self.chapters.clone(),
            artifacts: self.artifacts.clone(),
            notifications: self.notifications.clone(),
            ai: self.ai.clone(),
            duomi: self.duomi.clone(),
            settings: self.settings.clone(),
            tracks: self.tracks.clone(),
            playbook: self.playbook.clone(),
        }
    }
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
    let port: u16 = std::env::var("APP_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);

    let pool = pool(&database_url).await.context("连不上 db")?;
    bookflow_storage::migrate(&pool)
        .await
        .context("migration 失败")?;
    info!("db connected & migrated");

    let ai_cfg_env = AiConfig::from_env().context("AI 配置缺失")?;
    info!(provider = ?ai_cfg_env.provider, model = %ai_cfg_env.model, "ai client booting from env");
    let settings_repo = SettingsRepo::new(pool.clone());
    settings_repo
        .ensure_seeded_from_env(&ai_cfg_env)
        .await
        .context("写入默认 settings 失败")?;
    let active_cfg = settings_repo
        .read()
        .await
        .context("读 app_settings 失败")?
        .map(|s| s.to_ai_config())
        .unwrap_or(ai_cfg_env);
    let duomi_key = active_cfg.duomiapi_key.clone();
    let ai = AiClient::new(active_cfg).context("AI client 构建失败")?;

    let state = AppState {
        seeds: SeedRepo::new(pool.clone()),
        seed_drafts: SeedDraftRepo::new(pool.clone()),
        users: UserRepo::new(pool.clone()),
        projects: ProjectRepo::new(pool.clone()),
        reviews: ProjectReviewRepo::new(pool.clone()),
        chapters: ChapterRepo::new(pool.clone()),
        artifacts: ArtifactRepo::new(pool.clone()),
        notifications: NotificationRepo::new(pool.clone()),
        pool,
        ai,
        duomi: DuoMiClient::new(duomi_key),
        settings: settings_repo,
        tracks: DocRoot::discover("tracks"),
        playbook: DocRoot::discover("playbook"),
    };

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/seeds", post(create_seed).get(list_seeds))
        .route("/api/seeds/:id", axum::routing::delete(delete_seed))
        .route("/api/seeds/ai-score", post(ai_score_seed))
        .route("/api/seeds/ai-generate", post(ai_generate_seeds))
        .route("/api/seeds/ai-drafts", get(list_seed_drafts))
        .route("/api/seeds/ai-launch", post(ai_launch_seed))
        .route("/api/auth/register", post(register_user))
        .route("/api/auth/login", post(login_user))
        .route("/api/auth/me", get(me))
        .route("/api/auth/profile", put(update_profile))
        .route("/api/auth/logout", post(logout_user))
        .route("/api/projects", post(create_project).get(list_projects))
        .route("/api/projects/:id", get(get_project).delete(delete_project))
        .route("/api/projects/:id/transition", post(transition_project))
        .route("/api/reviews/pending", get(list_pending_reviews))
        .route("/api/projects/:id/reviews", get(list_project_reviews))
        .route(
            "/api/projects/:id/reviews/:stage",
            put(upsert_project_review),
        )
        .route("/api/projects/:id/artifacts", get(list_project_artifacts))
        .route("/api/projects/:id/ai-readme/stream", post(ai_readme_stream))
        .route(
            "/api/projects/:id/ai-character-setup/stream",
            post(ai_character_setup_stream),
        )
        .route(
            "/api/projects/:id/character-name-recommendations",
            get(character_name_recommendations),
        )
        .route(
            "/api/projects/:id/character-name-recommend",
            post(character_name_recommend),
        )
        .route(
            "/api/projects/:id/character-name-preview",
            post(character_name_preview),
        )
        .route(
            "/api/projects/:id/character-name-apply",
            post(character_name_apply),
        )
        .route(
            "/api/projects/:id/ai-outline/stream",
            post(ai_outline_stream),
        )
        .route(
            "/api/projects/:id/ai-publish/stream",
            post(ai_publish_stream),
        )
        .route(
            "/api/projects/:id/ai-side-dishes/stream",
            post(ai_side_dishes_stream),
        )
        .route(
            "/api/projects/:id/ai-blurb/stream",
            post(ai_blurb_stream),
        )
        .route("/api/projects/:id/ai-story-image", post(ai_story_image))
        .route(
            "/api/projects/:id/ai-duomi-image",
            post(ai_duomi_image),
        )
        .route(
            "/api/projects/:id/ai-duomi-image-edit",
            post(ai_duomi_image_edit),
        )
        .route(
            "/api/projects/:id/ai-duomi-video",
            post(ai_duomi_video),
        )
        .route(
            "/api/projects/:id/ai-book-summary/stream",
            post(ai_book_summary_stream),
        )
        .route(
            "/api/projects/:id/ai-book-polish/stream",
            post(ai_book_polish_stream),
        )
        .route(
            "/api/duomi-task/:task_id",
            get(ai_duomi_query_task),
        )
        .route(
            "/api/projects/:id/chapters",
            get(list_chapters).post(create_chapter),
        )
        .route("/api/chapters/:id", put(update_chapter))
        .route("/api/chapters/:id/ai-beats", post(ai_chapter_beats))
        .route("/api/chapters/:id/ai-write", post(ai_chapter_write))
        .route(
            "/api/chapters/:id/ai-write/stream",
            post(ai_chapter_write_stream),
        )
        .route("/api/dashboard/summary", get(dashboard_summary))
        .route("/api/settings", get(get_settings).put(put_settings))
        .route("/api/notifications", get(list_notifications))
        .route("/api/notifications/:id/read", post(mark_notification_read))
        .route("/api/notifications/read-all", post(mark_notifications_read_all))
        .route("/api/notifications/clear-resolved", post(clear_resolved_notifications))
        .route("/api/tracks", get(list_tracks))
        .route("/api/tracks/:slug", get(get_track))
        .route("/api/playbook", get(list_playbook))
        .route("/api/playbook/:slug", get(get_playbook))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
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
    let code = if db_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (code, Json(Health { db: db_ok }))
}

async fn create_seed(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<NewSeed>,
) -> Result<(StatusCode, Json<Seed>), AppError> {
    let user = require_user(&s, &headers).await?;
    payload.validate().map_err(AppError::Domain)?;
    // 4 小时内同 (title, track) 视为重复
    if let Some(existing) = s
        .seeds
        .find_by_title_track(user.id, &payload.title, &payload.track)
        .await
        .map_err(AppError::Storage)?
    {
        let age = chrono::Utc::now()
            .signed_duration_since(existing.created_at)
            .num_hours();
        if age < 4 {
            return Err(AppError::Storage(bookflow_storage::StorageError::Conflict(
                format!("已存在同标题种子（{}h 前），换一个标题或编辑那个", age),
            )));
        }
    }
    let seed = s
        .seeds
        .insert(user.id, &payload)
        .await
        .map_err(AppError::Storage)?;
    Ok((StatusCode::CREATED, Json(seed)))
}

async fn list_seeds(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<Seed>>, AppError> {
    let user = require_user(&s, &headers).await?;
    let seeds = s.seeds.list(user.id).await.map_err(AppError::Storage)?;
    Ok(Json(seeds))
}

async fn delete_seed(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user = require_user(&s, &headers).await?;
    s.seeds
        .delete(user.id, id)
        .await
        .map_err(AppError::Storage)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
struct AiScoreBody {
    title: String,
    track: String,
}

async fn ai_score_seed(
    State(s): State<AppState>,
    Json(body): Json<AiScoreBody>,
) -> Result<Json<AiScoreResponse>, AppError> {
    if body.title.trim().is_empty() {
        return Err(AppError::Domain(DomainError::TitleLength { len: 0 }));
    }
    let req = AiScoreRequest {
        title: body.title.trim(),
        track: body.track.trim(),
    };
    let started = std::time::Instant::now();
    let resp = score_seed(&s.ai, &req).await.map_err(AppError::Ai)?;
    info!(
        elapsed_ms = started.elapsed().as_millis() as u64,
        title = %req.title,
        "ai score done"
    );
    Ok(Json(resp))
}

// === Projects ===

#[derive(Debug, Deserialize)]
struct CreateProjectBody {
    seed_id: Uuid,
}

async fn create_project(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateProjectBody>,
) -> Result<(StatusCode, Json<Project>), AppError> {
    let user = require_user(&s, &headers).await?;
    let p = s
        .projects
        .create_from_seed(user.id, body.seed_id)
        .await
        .map_err(AppError::Storage)?;
    Ok((StatusCode::CREATED, Json(p)))
}

#[derive(Debug, Deserialize)]
struct ListProjectsQ {
    status: Option<String>,
}

async fn list_projects(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ListProjectsQ>,
) -> Result<Json<Vec<Project>>, AppError> {
    let user = require_user(&s, &headers).await?;
    let st = match q.status.as_deref() {
        None | Some("") => None,
        Some(other) => Some(ProjectStatus::parse(other).ok_or_else(|| {
            AppError::Domain(DomainError::BadTransition {
                from: "?".into(),
                to: other.into(),
            })
        })?),
    };
    let list = s
        .projects
        .list(user.id, st)
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(list))
}

async fn get_project(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Project>, AppError> {
    let user = require_user(&s, &headers).await?;
    let p = s
        .projects
        .get(user.id, id)
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(p))
}

async fn delete_project(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user = require_user(&s, &headers).await?;
    s.projects
        .delete(user.id, id)
        .await
        .map_err(AppError::Storage)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
struct TransitionBody {
    to: String,
}

/// SOP 阶段 3 硬底线：正文中文字数必须 ≥ MIN_WORDS_TO_READY 才允许 writing→ready
const MIN_WORDS_TO_READY: i64 = 10000;

async fn transition_project(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<TransitionBody>,
) -> Result<Json<Project>, AppError> {
    let user = require_user(&s, &headers).await?;
    let to = ProjectStatus::parse(&body.to).ok_or_else(|| {
        AppError::Domain(DomainError::BadTransition {
            from: "?".into(),
            to: body.to.clone(),
        })
    })?;
    let cur = s
        .projects
        .get(user.id, id)
        .await
        .map_err(AppError::Storage)?;
    ProjectStatus::validate_transition(cur.status, to).map_err(AppError::Domain)?;
    // SOP 阶段 3：定稿前校验正文字数
    if cur.status == ProjectStatus::Writing && to == ProjectStatus::Ready {
        let total = s
            .chapters
            .total_words(id)
            .await
            .map_err(AppError::Storage)?;
        if total < MIN_WORDS_TO_READY {
            return Err(AppError::Storage(bookflow_storage::StorageError::Conflict(
                format!(
                    "正文字数 {total}/{MIN_WORDS_TO_READY}，不足 {} 字不允许定稿（SOP 硬底线）",
                    MIN_WORDS_TO_READY - total
                ),
            )));
        }
    }
    let p = s
        .projects
        .update_status(user.id, id, to)
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(p))
}

// === Reviews ===

#[derive(Debug, Deserialize)]
struct UpsertProjectReviewBody {
    data_recorded: bool,
    read_count: Option<i64>,
    completion_rate: Option<f64>,
    engagement_count: Option<i64>,
    overall_result: Option<String>,
    title_result: Option<String>,
    hook_result: Option<String>,
    emotion_result: Option<String>,
    success_reason: Option<String>,
    failure_reason: Option<String>,
    continue_track: Option<String>,
    reusable_conclusion: Option<String>,
    next_action: Option<String>,
}

async fn list_pending_reviews(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<PendingProjectReview>>, AppError> {
    let user = require_user(&s, &headers).await?;
    let mut pending = s
        .reviews
        .pending_list(user.id)
        .await
        .map_err(AppError::Storage)?;
    pending.sort_by_key(|item| {
        (
            review_stage_priority(item.stage.as_str()),
            item.published_at,
        )
    });
    Ok(Json(pending))
}

async fn list_project_reviews(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> Result<Json<Vec<ProjectReview>>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let mut reviews = s
        .reviews
        .list_by_project(project_id)
        .await
        .map_err(AppError::Storage)?;
    reviews.sort_by_key(|item| {
        (
            review_stage_priority(item.stage.as_str()),
            item.published_at,
        )
    });
    Ok(Json(reviews))
}

async fn upsert_project_review(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path((project_id, stage)): Path<(Uuid, String)>,
    Json(body): Json<UpsertProjectReviewBody>,
) -> Result<Json<ProjectReview>, AppError> {
    let stage = ReviewStage::parse(&stage)
        .ok_or_else(|| AppError::BadRequest(format!("unknown review stage: {stage}")))?;
    require_project(&s, &headers, project_id).await?;
    let published_at = fetch_project_published_at(&s.pool, project_id).await?;
    if let Some(read_count) = body.read_count {
        if read_count < 0 {
            return Err(AppError::BadRequest(format!(
                "read_count must be >= 0, got {read_count}"
            )));
        }
    }
    if let Some(engagement_count) = body.engagement_count {
        if engagement_count < 0 {
            return Err(AppError::BadRequest(format!(
                "engagement_count must be >= 0, got {engagement_count}"
            )));
        }
    }
    if let Some(completion_rate) = body.completion_rate {
        if !(0.0..=1.0).contains(&completion_rate) {
            return Err(AppError::BadRequest(format!(
                "completion_rate must be between 0.0 and 1.0 inclusive, got {completion_rate}"
            )));
        }
    }
    let overall_result = body
        .overall_result
        .as_deref()
        .map(|value| {
            ReviewResult::parse(value)
                .ok_or_else(|| AppError::BadRequest(format!("unknown review result: {value}")))
        })
        .transpose()?;
    let review = s
        .reviews
        .upsert(
            project_id,
            stage,
            published_at,
            body.data_recorded,
            body.read_count,
            body.completion_rate,
            body.engagement_count,
            overall_result.map(ReviewResult::as_str),
            body.title_result.as_deref(),
            body.hook_result.as_deref(),
            body.emotion_result.as_deref(),
            body.success_reason.as_deref(),
            body.failure_reason.as_deref(),
            body.continue_track.as_deref(),
            body.reusable_conclusion.as_deref(),
            body.next_action.as_deref(),
        )
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(review))
}

// === Chapters ===

async fn list_chapters(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> Result<Json<Vec<Chapter>>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let list = s
        .chapters
        .list_by_project(project_id)
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(list))
}

#[derive(Debug, Deserialize)]
struct CreateChapterBody {
    #[serde(default)]
    title: String,
}

async fn create_chapter(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateChapterBody>,
) -> Result<(StatusCode, Json<Chapter>), AppError> {
    require_project(&s, &headers, project_id).await?;
    let c = s
        .chapters
        .create(project_id, &body.title)
        .await
        .map_err(AppError::Storage)?;
    Ok((StatusCode::CREATED, Json(c)))
}

#[derive(Debug, Deserialize)]
struct UpdateChapterBody {
    title: String,
    body: String,
}

async fn update_chapter(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(b): Json<UpdateChapterBody>,
) -> Result<Json<Chapter>, AppError> {
    require_chapter_project(&s, &headers, id).await?;
    let c = s
        .chapters
        .update_body(id, &b.title, &b.body)
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(c))
}

// === AI: 章节辅助 ===

#[derive(Debug, Deserialize)]
struct AiBeatsBody {
    /// 可选，前端拿不到时由后端自查 chapter→project
    #[serde(default)]
    chapter_title: Option<String>,
}

#[derive(Debug, Serialize)]
struct AiBeatsResp {
    beats: Vec<Beat>,
}

async fn ai_chapter_beats(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(chapter_id): Path<Uuid>,
    Json(body): Json<AiBeatsBody>,
) -> Result<Json<AiBeatsResp>, AppError> {
    let (_, chapter, project) = require_chapter_project(&s, &headers, chapter_id).await?;
    let chapter_title = body.chapter_title.unwrap_or_else(|| chapter.title.clone());
    if chapter_title.trim().is_empty() {
        return Err(AppError::Domain(DomainError::TitleLength { len: 0 }));
    }
    let started = std::time::Instant::now();
    let beats = beats_for_chapter(&s.ai, &project.title, &project.track, &chapter_title)
        .await
        .map_err(AppError::Ai)?;
    // 顺手存到 chapter.beats
    let _ = s
        .chapters
        .update_beats(chapter_id, &beats)
        .await
        .map_err(AppError::Storage)?;
    info!(
        elapsed_ms = started.elapsed().as_millis() as u64,
        chapter_id = %chapter_id, beats = beats.len(),
        "ai beats done"
    );
    Ok(Json(AiBeatsResp { beats }))
}

#[derive(Debug, Deserialize)]
struct AiWriteBody {
    beat: Beat,
    /// 上一段已有正文的尾部，用于衔接（不含也行）
    #[serde(default)]
    prev_tail: String,
}

#[derive(Debug, Serialize)]
struct AiWriteResp {
    text: String,
}

async fn ai_chapter_write(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(chapter_id): Path<Uuid>,
    Json(body): Json<AiWriteBody>,
) -> Result<Json<AiWriteResp>, AppError> {
    let (_, chapter, project) = require_chapter_project(&s, &headers, chapter_id).await?;
    let character_setup = load_character_setup(&s, project.id).await;
    let started = std::time::Instant::now();
    let text = write_paragraph(
        &s.ai,
        &project.title,
        &project.track,
        &chapter.title,
        &body.beat,
        &body.prev_tail,
        &character_setup,
    )
    .await
    .map_err(AppError::Ai)?;
    info!(
        elapsed_ms = started.elapsed().as_millis() as u64,
        chapter_id = %chapter_id, beat = %body.beat.label,
        chars = text.chars().count(),
        "ai write done"
    );
    Ok(Json(AiWriteResp { text }))
}

async fn ai_chapter_write_stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(chapter_id): Path<Uuid>,
    Json(body): Json<AiWriteBody>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, AppError> {
    let (_, chapter, project) = require_chapter_project(&s, &headers, chapter_id).await?;
    let character_setup = load_character_setup(&s, project.id).await;
    let rx = stream_write_paragraph(
        &s.ai,
        &project.title,
        &project.track,
        &chapter.title,
        &body.beat,
        &body.prev_tail,
        &character_setup,
    )
    .await;
    Ok(sse_from_stream(rx, |_full| async move { Ok(()) }))
}

// === Dashboard ===

#[derive(Debug, Serialize)]
struct DashboardCounts {
    writing: i64,
    ready: i64,
    published: i64,
    archived: i64,
    seeds_total: i64,
    seeds_greenlight: i64,
    seeds_backlog: i64,
}

#[derive(Debug, Serialize)]
struct PipelineStage {
    /// seed | plan | write | ready | published | archive
    key: &'static str,
    label: &'static str,
    count: i64,
    /// 第一行小字
    line1: String,
    /// 第二行小字（可空），warn=true 用 amber 颜色
    line2: Option<String>,
    line2_warn: bool,
}

#[derive(Debug, Serialize)]
struct HealthMetrics {
    in_progress: i64,
    in_progress_detail: String,
    weekly_published: i64,
    weekly_delta: i64,
    pending_review: i64,
    pending_review_overdue: i64,
    wc_warnings: i64,
    wc_warning_detail: String,
}

#[derive(Debug, Serialize)]
struct LlmStatus {
    configured: bool,
    provider: String,
    model: String,
}

#[derive(Debug, Serialize)]
struct DashboardSummary {
    counts: DashboardCounts,
    pipeline: Vec<PipelineStage>,
    health: HealthMetrics,
    llm: LlmStatus,
    recent_seeds: Vec<Seed>,
    recent_projects: Vec<Project>,
}

async fn dashboard_summary(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<DashboardSummary>, AppError> {
    let user = require_user(&s, &headers).await?;
    let buckets = s
        .projects
        .counts_by_status(user.id)
        .await
        .map_err(AppError::Storage)?;
    let mut writing = 0i64;
    let mut ready = 0i64;
    let mut published = 0i64;
    let mut archived = 0i64;
    for (k, v) in buckets {
        match k.as_str() {
            "writing" => writing = v,
            "ready" => ready = v,
            "published" => published = v,
            "archived" => archived = v,
            _ => {}
        }
    }
    let seeds = s.seeds.list(user.id).await.map_err(AppError::Storage)?;
    let seeds_total = seeds.len() as i64;
    let seeds_greenlight = seeds
        .iter()
        .filter(|sd| matches!(sd.tier, bookflow_domain::Tier::Greenlight))
        .count() as i64;
    let seeds_backlog = seeds
        .iter()
        .filter(|sd| matches!(sd.tier, bookflow_domain::Tier::Backlog))
        .count() as i64;

    let counts = DashboardCounts {
        writing,
        ready,
        published,
        archived,
        seeds_total,
        seeds_greenlight,
        seeds_backlog,
    };
    let pending_reviews = s
        .reviews
        .pending_list(user.id)
        .await
        .map_err(AppError::Storage)?;
    let pending_review = pending_reviews.len() as i64;
    let pending_review_overdue = pending_reviews
        .iter()
        .filter(|item| matches!(item.stage, ReviewStage::H72 | ReviewStage::D7))
        .count() as i64;

    // pipeline 6 阶段
    // seed = 仅 seed 未立项 = seeds_total - 已立项的 seed_id 数（粗略：用 seeds_total - 全 projects 数）
    let projects_all = s
        .projects
        .list(user.id, None)
        .await
        .map_err(AppError::Storage)?;
    let projectized_seed_ids: std::collections::HashSet<Uuid> =
        projects_all.iter().map(|p| p.seed_id).collect();
    let unprojected_seeds = seeds
        .iter()
        .filter(|sd| !projectized_seed_ids.contains(&sd.id))
        .count() as i64;
    let unprojected_greenlight = seeds
        .iter()
        .filter(|sd| {
            !projectized_seed_ids.contains(&sd.id)
                && matches!(sd.tier, bookflow_domain::Tier::Greenlight)
        })
        .count() as i64;

    let pipeline = vec![
        PipelineStage {
            key: "seed",
            label: "选题",
            count: unprojected_seeds,
            line1: format!("评分 ≥28：{unprojected_greenlight}"),
            line2: Some(format!("备选池：{seeds_backlog}")),
            line2_warn: false,
        },
        PipelineStage {
            key: "plan",
            label: "立项",
            count: writing,
            line1: format!("大纲完成：{writing}"),
            line2: Some("言情向占比：100%".into()),
            line2_warn: false,
        },
        PipelineStage {
            key: "write",
            label: "写作",
            count: writing,
            line1: format!("字数达标：{writing} / {writing}"),
            line2: None,
            line2_warn: false,
        },
        PipelineStage {
            key: "ready",
            label: "待发",
            count: ready,
            line1: format!("7 项检查全过：{ready}"),
            line2: None,
            line2_warn: false,
        },
        PipelineStage {
            key: "published",
            label: "已发",
            count: published,
            line1: format!("本周新发：{published}"),
            line2: None,
            line2_warn: false,
        },
        PipelineStage {
            key: "archive",
            label: "归档",
            count: archived,
            line1: format!("累计归档：{archived}"),
            line2: Some("等待复盘归档".into()),
            line2_warn: false,
        },
    ];

    let in_progress = writing + ready;
    let health = HealthMetrics {
        in_progress,
        in_progress_detail: format!("立项 {writing} / 待发 {ready}"),
        weekly_published: published,
        weekly_delta: 0,
        pending_review,
        pending_review_overdue,
        wc_warnings: 0,
        wc_warning_detail: "暂无字数告警".into(),
    };

    let active_ai = s.ai.snapshot().await;
    let llm = LlmStatus {
        configured: !active_ai.api_key.is_empty(),
        provider: active_ai.provider.as_str().into(),
        model: active_ai.model,
    };

    let recent_seeds = seeds.into_iter().take(5).collect();
    let recent_projects = projects_all.into_iter().take(5).collect();
    Ok(Json(DashboardSummary {
        counts,
        pipeline,
        health,
        llm,
        recent_seeds,
        recent_projects,
    }))
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error(transparent)]
    Domain(DomainError),
    #[error("{0}")]
    BadRequest(String),
    #[error(transparent)]
    Storage(bookflow_storage::StorageError),
    #[error("ai: {0}")]
    Ai(anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        match self {
            AppError::Domain(e) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": e })),
            )
                .into_response(),
            AppError::BadRequest(detail) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "bad_request", "detail": detail })),
            )
                .into_response(),
            AppError::Storage(e) => {
                if let bookflow_storage::StorageError::NotFound(what) = &e {
                    return (
                        StatusCode::NOT_FOUND,
                        Json(serde_json::json!({ "error": "not_found", "what": what })),
                    )
                        .into_response();
                }
                if let bookflow_storage::StorageError::Conflict(msg) = &e {
                    return (
                        StatusCode::CONFLICT,
                        Json(serde_json::json!({ "error": "conflict", "detail": msg })),
                    )
                        .into_response();
                }
                tracing::error!(err = %e, "storage error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "internal" })),
                )
                    .into_response()
            }
            AppError::Ai(e) => {
                tracing::error!(err = %e, "ai error");
                (
                    StatusCode::BAD_GATEWAY,
                    Json(serde_json::json!({ "error": "ai", "detail": e.to_string() })),
                )
                    .into_response()
            }
        }
    }
}

// === Settings ===

#[derive(Debug, Serialize)]
struct SettingsView {
    provider: String,
    base_url: String,
    /// 永不回显完整 key；只露最后 4 位
    api_key_masked: String,
    has_api_key: bool,
    model: String,
    image_model: String,
    duomiapi_key_set: bool,
    timeout_secs: i32,
}

fn mask_key(k: &str) -> String {
    let n = k.chars().count();
    if n == 0 {
        return String::new();
    }
    if n <= 4 {
        return "*".repeat(n);
    }
    let tail: String = k
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{}{}", "*".repeat(n - 4), tail)
}

fn review_stage_priority(stage: &str) -> i32 {
    match stage {
        "72h" => 0,
        "24h" => 1,
        "7d" => 2,
        _ => 9,
    }
}

async fn fetch_project_published_at(
    pool: &PgPool,
    project_id: Uuid,
) -> Result<chrono::DateTime<chrono::Utc>, AppError> {
    let published_at = sqlx::query_scalar::<_, Option<chrono::DateTime<chrono::Utc>>>(
        "SELECT published_at FROM projects WHERE id = $1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|err| AppError::Storage(err.into()))?
    .ok_or_else(|| {
        AppError::Storage(bookflow_storage::StorageError::NotFound(format!(
            "project {project_id}"
        )))
    })?;

    published_at.ok_or_else(|| {
        AppError::Storage(bookflow_storage::StorageError::Conflict(format!(
            "project {project_id} has no published_at"
        )))
    })
}

async fn get_settings(State(s): State<AppState>) -> Result<Json<SettingsView>, AppError> {
    let cfg = s.ai.snapshot().await;
    Ok(Json(SettingsView {
        provider: cfg.provider.as_str().into(),
        base_url: cfg.base_url.clone(),
        api_key_masked: mask_key(&cfg.api_key),
        has_api_key: !cfg.api_key.is_empty(),
        model: cfg.model.clone(),
        image_model: cfg.image_model.clone(),
        duomiapi_key_set: !cfg.duomiapi_key.is_empty(),
        timeout_secs: cfg.timeout.as_secs() as i32,
    }))
}

async fn put_settings(
    State(mut s): State<AppState>,
    Json(patch): Json<SettingsPatch>,
) -> Result<Json<SettingsView>, AppError> {
    let cur = s
        .settings
        .read()
        .await
        .map_err(AppError::Ai)?
        .unwrap_or_else(|| {
            Settings::from_ai_config(&AiConfig {
                provider: ai::Provider::Anthropic,
                base_url: String::new(),
                api_key: String::new(),
                model: "claude-sonnet-4-6".into(),
                image_model: "gpt-image-2".into(),
                duomiapi_key: String::new(),
                timeout: std::time::Duration::from_secs(60),
            })
        });
    let next = Settings {
        provider: patch.provider.unwrap_or(cur.provider),
        base_url: patch.base_url.unwrap_or(cur.base_url),
        api_key: patch
            .api_key
            .filter(|s| !s.is_empty())
            .unwrap_or(cur.api_key),
        model: patch.model.unwrap_or(cur.model),
        image_model: patch.image_model.unwrap_or(cur.image_model),
        duomiapi_key: patch.duomiapi_key.unwrap_or(cur.duomiapi_key),
        timeout_secs: patch.timeout_secs.unwrap_or(cur.timeout_secs).max(1),
    };
    let saved = s.settings.upsert(&next).await.map_err(AppError::Ai)?;
    s.ai.reload(saved.to_ai_config()).await;
    // 同步更新 duomi client 的 key
    let cfg = s.ai.snapshot().await;
    s.duomi = DuoMiClient::new(cfg.duomiapi_key.clone());
    Ok(Json(SettingsView {
        provider: cfg.provider.as_str().into(),
        base_url: cfg.base_url.clone(),
        api_key_masked: mask_key(&cfg.api_key),
        has_api_key: !cfg.api_key.is_empty(),
        model: cfg.model.clone(),
        image_model: cfg.image_model.clone(),
        duomiapi_key_set: !cfg.duomiapi_key.is_empty(),
        timeout_secs: cfg.timeout.as_secs() as i32,
    }))
}

// === Tracks / Playbook ===

async fn list_tracks(State(s): State<AppState>) -> Result<Json<Vec<docs::DocItem>>, AppError> {
    Ok(Json(s.tracks.list().map_err(AppError::Ai)?))
}

async fn get_track(
    State(s): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<docs::DocFull>, AppError> {
    Ok(Json(s.tracks.read_one(&slug).map_err(AppError::Ai)?))
}

async fn list_playbook(State(s): State<AppState>) -> Result<Json<Vec<docs::DocItem>>, AppError> {
    Ok(Json(s.playbook.list().map_err(AppError::Ai)?))
}

async fn get_playbook(
    State(s): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<docs::DocFull>, AppError> {
    Ok(Json(s.playbook.read_one(&slug).map_err(AppError::Ai)?))
}

// === AI 选题批量生成 ===

#[derive(Debug, Deserialize)]
struct AiGenerateReq {
    track: String,
}

async fn ai_generate_seeds(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AiGenerateReq>,
) -> Result<Json<AiSeedGenerated>, AppError> {
    let user = require_user(&s, &headers).await?;
    if req.track.trim().is_empty() {
        return Err(AppError::Domain(DomainError::TitleLength { len: 0 }));
    }
    let r = generate_seeds(&s.ai, &req.track)
        .await
        .map_err(AppError::Ai)?;
    // 落到候选历史表（失败不阻塞返回）
    let drafts: Vec<NewSeedDraft> = r
        .candidates
        .iter()
        .map(|c| NewSeedDraft {
            track: r.track.clone(),
            title: c.title.clone(),
            score: c.score.clone(),
            why_buy: c.why_buy.clone(),
        })
        .collect();
    if let Err(e) = s.seed_drafts.insert_batch(user.id, &drafts).await {
        tracing::warn!(?e, "ai_seed_drafts batch insert failed (returning anyway)");
    }
    Ok(Json(r))
}

#[derive(Debug, Deserialize)]
struct ListDraftsQ {
    track: Option<String>,
    limit: Option<i64>,
}

async fn list_seed_drafts(
    State(s): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(q): axum::extract::Query<ListDraftsQ>,
) -> Result<Json<Vec<SeedDraft>>, AppError> {
    let user = require_user(&s, &headers).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let track = q.track.as_deref().filter(|t| !t.trim().is_empty());
    let drafts = s
        .seed_drafts
        .list(user.id, track, limit)
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(drafts))
}

/// 一键 AI 立项：基于 track，AI 生成 5 候选 → 取最高分 → createSeed → createFromSeed → 返回 project
/// 若最高分仍是 reject(<23) 则返回 422 让前端提示
async fn ai_launch_seed(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AiGenerateReq>,
) -> Result<Json<Project>, AppError> {
    let user = require_user(&s, &headers).await?;
    if req.track.trim().is_empty() {
        return Err(AppError::Domain(DomainError::TitleLength { len: 0 }));
    }
    let r = generate_seeds(&s.ai, &req.track)
        .await
        .map_err(AppError::Ai)?;
    // 顺手落候选历史
    let drafts: Vec<NewSeedDraft> = r
        .candidates
        .iter()
        .map(|c| NewSeedDraft {
            track: r.track.clone(),
            title: c.title.clone(),
            score: c.score.clone(),
            why_buy: c.why_buy.clone(),
        })
        .collect();
    if let Err(e) = s.seed_drafts.insert_batch(user.id, &drafts).await {
        tracing::warn!(?e, "ai_seed_drafts batch insert failed (continuing)");
    }
    // 取最高分候选
    let best = r
        .candidates
        .into_iter()
        .max_by_key(|c| c.score.total())
        .ok_or_else(|| AppError::Ai(anyhow::anyhow!("AI 没生成任何候选")))?;
    let total = best.score.total();
    if total < 23 {
        return Err(AppError::Ai(anyhow::anyhow!(
            "AI 生成的候选评分不足（{}分），换个赛道或者手动改一下",
            total
        )));
    }
    let new_seed = NewSeed {
        title: best.title.clone(),
        track: req.track.clone(),
        score: best.score,
    };
    new_seed.validate().map_err(AppError::Domain)?;
    let seed = s
        .seeds
        .insert(user.id, &new_seed)
        .await
        .map_err(AppError::Storage)?;
    let project = s
        .projects
        .create_from_seed(user.id, seed.id)
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(project))
}

const SESSION_COOKIE: &str = "bookflow_session";
const SESSION_DAYS: i64 = 14;
const SESSION_SHORT_DAYS: i64 = 1;

#[derive(Debug, Deserialize)]
struct RegisterBody {
    email: String,
    display_name: String,
    password: String,
    remember_me: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct LoginBody {
    email: String,
    password: String,
    remember_me: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct UpdateProfileBody {
    display_name: String,
}

#[derive(Debug, Serialize)]
struct AuthView {
    user: User,
}

#[derive(Debug, Serialize)]
struct NotificationListView {
    unread_count: i64,
    items: Vec<Notification>,
}

#[derive(Debug, Deserialize)]
struct NotificationListQuery {
    unread_only: Option<bool>,
}

#[derive(Debug, Serialize)]
struct CharacterNameRecommendationView {
    candidates: Vec<CharacterNameCandidate>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CharacterNameRecommendBody {
    old_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct CharacterNamePreviewBody {
    old_name: String,
    new_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct CharacterNameApplyBody {
    old_name: String,
    new_name: String,
}

async fn character_name_recommendations(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> Result<Json<CharacterNameRecommendationView>, AppError> {
    let (_, project) = require_project(&s, &headers, project_id).await?;
    let artifacts = s
        .artifacts
        .latest_all(project_id)
        .await
        .map_err(AppError::Storage)?;
    let character_setup = artifacts
        .iter()
        .find(|a| a.kind == ArtifactKind::CharacterSetup)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    if character_setup.trim().is_empty() {
        return Err(AppError::Storage(bookflow_storage::StorageError::Conflict(
            "先生成角色设定，再替换角色名".into(),
        )));
    }

    let candidates = extract_candidate_names(&character_setup);
    Ok(Json(CharacterNameRecommendationView { candidates }))
}

async fn character_name_recommend(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CharacterNameRecommendBody>,
) -> Result<Json<LocalCharacterRenameRecommendation>, AppError> {
    let (_, project) = require_project(&s, &headers, project_id).await?;
    let recommended = local_recommended_name(&project.track, &body.old_name);

    Ok(Json(recommended))
}

async fn character_name_preview(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CharacterNamePreviewBody>,
) -> Result<Json<CharacterReplacementPreview>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let artifacts = s
        .artifacts
        .latest_all(project_id)
        .await
        .map_err(AppError::Storage)?;
    let chapters = s
        .chapters
        .list_by_project(project_id)
        .await
        .map_err(AppError::Storage)?;

    let mut items = Vec::<CharacterReplacementPreviewItem>::new();
    for artifact in &artifacts {
        if !matches!(
            artifact.kind,
            ArtifactKind::Readme
                | ArtifactKind::CharacterSetup
                | ArtifactKind::Outline
                | ArtifactKind::PublishPost
        ) {
            continue;
        }
        if let Some(item) = build_preview_item(
            "artifact",
            artifact.kind.as_str(),
            &artifact.content,
            &body.old_name,
            &body.new_name,
        ) {
            items.push(item);
        }
    }

    for chapter in &chapters {
        if let Some(item) = build_preview_item(
            "chapter",
            &format!("chapter:{}", chapter.idx),
            &chapter.body,
            &body.old_name,
            &body.new_name,
        ) {
            items.push(item);
        }
    }

    Ok(Json(CharacterReplacementPreview {
        old_name: body.old_name,
        new_name: body.new_name,
        items,
    }))
}

async fn character_name_apply(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CharacterNameApplyBody>,
) -> Result<Json<CharacterReplacementPreview>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let preview = character_name_preview(
        State(s.clone()),
        headers.clone(),
        Path(project_id),
        Json(CharacterNamePreviewBody {
            old_name: body.old_name.clone(),
            new_name: body.new_name.clone(),
        }),
    )
    .await?
    .0;

    let artifacts = s
        .artifacts
        .latest_all(project_id)
        .await
        .map_err(AppError::Storage)?;
    for artifact in artifacts {
        if !matches!(
            artifact.kind,
            ArtifactKind::Readme
                | ArtifactKind::CharacterSetup
                | ArtifactKind::Outline
                | ArtifactKind::PublishPost
        ) {
            continue;
        }
        if let Some(next) =
            apply_exact_replacement(&artifact.content, &body.old_name, &body.new_name)
        {
            s.artifacts
                .save(project_id, artifact.kind, &next)
                .await
                .map_err(AppError::Storage)?;
        }
    }

    let chapters = s
        .chapters
        .list_by_project(project_id)
        .await
        .map_err(AppError::Storage)?;
    for chapter in chapters {
        if let Some(next) =
            apply_exact_replacement(&chapter.body, &body.old_name, &body.new_name)
        {
            s.chapters
                .update_body(chapter.id, &chapter.title, &next)
                .await
                .map_err(AppError::Storage)?;
        }
    }

    Ok(Json(preview))
}

fn parse_session_token(headers: &HeaderMap) -> Option<String> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie.split(';').find_map(|part| {
        let part = part.trim();
        part.strip_prefix(&format!("{SESSION_COOKIE}="))
            .map(|v| v.to_string())
    })
}

fn build_session_cookie(token: &str, max_age_days: i64) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        max_age_days * 24 * 60 * 60
    ))
    .expect("valid session cookie")
}

fn clear_session_cookie() -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    ))
    .expect("valid clearing cookie")
}

fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes())
        .map_err(|e| AppError::BadRequest(format!("password salt error: {e}")))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| AppError::BadRequest(format!("password hash error: {e}")))
}

fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    let parsed = PasswordHash::new(hash)
        .map_err(|e| AppError::BadRequest(format!("password hash parse error: {e}")))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

async fn register_user(
    State(s): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> Result<impl IntoResponse, AppError> {
    let email = body.email.trim().to_lowercase();
    let display_name = body.display_name.trim().to_string();
    if email.is_empty() || !email.contains('@') {
        return Err(AppError::BadRequest("请输入有效邮箱".into()));
    }
    if display_name.is_empty() {
        return Err(AppError::BadRequest("请输入昵称".into()));
    }
    if body.password.chars().count() < 6 {
        return Err(AppError::BadRequest("密码至少 6 位".into()));
    }
    if s.users
        .find_with_password_by_email(&email)
        .await
        .map_err(AppError::Storage)?
        .is_some()
    {
        return Err(AppError::Storage(bookflow_storage::StorageError::Conflict(
            "该邮箱已注册".into(),
        )));
    }
    let password_hash = hash_password(&body.password)?;
    let user = s
        .users
        .create(&email, &display_name, &password_hash)
        .await
        .map_err(AppError::Storage)?;
    let token = uuid::Uuid::new_v4().to_string();
    let keep_days = if body.remember_me.unwrap_or(true) {
        SESSION_DAYS
    } else {
        SESSION_SHORT_DAYS
    };
    let expires_at = chrono::Utc::now() + chrono::Duration::days(keep_days);
    s.users
        .create_session(user.id, &token, expires_at)
        .await
        .map_err(AppError::Storage)?;
    let mut headers = HeaderMap::new();
    headers.insert(header::SET_COOKIE, build_session_cookie(&token, keep_days));
    Ok((StatusCode::CREATED, headers, Json(AuthView { user })))
}

async fn login_user(
    State(s): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Result<impl IntoResponse, AppError> {
    let email = body.email.trim().to_lowercase();
    let Some((user, password_hash)) = s
        .users
        .find_with_password_by_email(&email)
        .await
        .map_err(AppError::Storage)?
    else {
        return Err(AppError::Storage(bookflow_storage::StorageError::NotFound(
            "用户不存在".into(),
        )));
    };
    if !verify_password(&body.password, &password_hash)? {
        return Err(AppError::Storage(bookflow_storage::StorageError::Conflict(
            "密码错误".into(),
        )));
    }
    let token = uuid::Uuid::new_v4().to_string();
    let keep_days = if body.remember_me.unwrap_or(true) {
        SESSION_DAYS
    } else {
        SESSION_SHORT_DAYS
    };
    let expires_at = chrono::Utc::now() + chrono::Duration::days(keep_days);
    s.users
        .create_session(user.id, &token, expires_at)
        .await
        .map_err(AppError::Storage)?;
    let mut headers = HeaderMap::new();
    headers.insert(header::SET_COOKIE, build_session_cookie(&token, keep_days));
    Ok((headers, Json(AuthView { user })))
}

async fn me(State(s): State<AppState>, headers: HeaderMap) -> Result<Json<AuthView>, AppError> {
    let token = parse_session_token(&headers).ok_or_else(|| {
        AppError::Storage(bookflow_storage::StorageError::NotFound("session".into()))
    })?;
    let user = s
        .users
        .find_user_by_session(&token)
        .await
        .map_err(AppError::Storage)?
        .ok_or_else(|| {
            AppError::Storage(bookflow_storage::StorageError::NotFound("session".into()))
        })?;
    Ok(Json(AuthView { user }))
}

async fn logout_user(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    if let Some(token) = parse_session_token(&headers) {
        s.users
            .delete_session(&token)
            .await
            .map_err(AppError::Storage)?;
    }
    let mut out = HeaderMap::new();
    out.insert(header::SET_COOKIE, clear_session_cookie());
    Ok((out, StatusCode::NO_CONTENT))
}

async fn require_user(s: &AppState, headers: &HeaderMap) -> Result<User, AppError> {
    let token = parse_session_token(headers).ok_or_else(|| {
        AppError::Storage(bookflow_storage::StorageError::NotFound("session".into()))
    })?;
    s.users
        .find_user_by_session(&token)
        .await
        .map_err(AppError::Storage)?
        .ok_or_else(|| {
            AppError::Storage(bookflow_storage::StorageError::NotFound("session".into()))
        })
}

async fn require_project(
    s: &AppState,
    headers: &HeaderMap,
    project_id: Uuid,
) -> Result<(User, Project), AppError> {
    let user = require_user(s, headers).await?;
    let project = s
        .projects
        .get(user.id, project_id)
        .await
        .map_err(AppError::Storage)?;
    Ok((user, project))
}

async fn require_chapter_project(
    s: &AppState,
    headers: &HeaderMap,
    chapter_id: Uuid,
) -> Result<(User, Chapter, Project), AppError> {
    let user = require_user(s, headers).await?;
    let chapter = s
        .chapters
        .get(chapter_id)
        .await
        .map_err(AppError::Storage)?;
    let project = s
        .projects
        .get(user.id, chapter.project_id)
        .await
        .map_err(AppError::Storage)?;
    Ok((user, chapter, project))
}

async fn update_profile(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpdateProfileBody>,
) -> Result<Json<AuthView>, AppError> {
    let token = parse_session_token(&headers).ok_or_else(|| {
        AppError::Storage(bookflow_storage::StorageError::NotFound("session".into()))
    })?;
    let user = s
        .users
        .find_user_by_session(&token)
        .await
        .map_err(AppError::Storage)?
        .ok_or_else(|| {
            AppError::Storage(bookflow_storage::StorageError::NotFound("session".into()))
        })?;
    let display_name = body.display_name.trim();
    if display_name.is_empty() {
        return Err(AppError::BadRequest("昵称不能为空".into()));
    }
    let user = s
        .users
        .update_display_name(user.id, display_name)
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(AuthView { user }))
}

async fn sync_notifications_for_user(s: &AppState, user: &User) -> Result<(), AppError> {
    let ready_projects = s
        .projects
        .list(user.id, Some(ProjectStatus::Ready))
        .await
        .map_err(AppError::Storage)?;
    if ready_projects.is_empty() {
        s.notifications
            .resolve_by_fingerprint(user.id, "ready-backlog")
            .await
            .map_err(AppError::Storage)?;
    } else {
        s.notifications
            .upsert_active(
                user.id,
                &UpsertNotification {
                    category: NotificationCategory::Production,
                    level: NotificationLevel::Warning,
                    title: format!("待发项目 {} 篇待处理", ready_projects.len()),
                    body: format!(
                        "当前有 {} 个项目停留在待发阶段，建议尽快处理发布或回查。",
                        ready_projects.len()
                    ),
                    action_label: Some("去待发".into()),
                    action_href: Some("/ready".into()),
                    source_type: Some("project_status".into()),
                    source_id: None,
                    fingerprint: Some("ready-backlog".into()),
                },
            )
            .await
            .map_err(AppError::Storage)?;
    }

    let pending_reviews = s
        .reviews
        .pending_list(user.id)
        .await
        .map_err(AppError::Storage)?;
    if pending_reviews.is_empty() {
        s.notifications
            .resolve_by_fingerprint(user.id, "pending-reviews")
            .await
            .map_err(AppError::Storage)?;
    } else {
        s.notifications
            .upsert_active(
                user.id,
                &UpsertNotification {
                    category: NotificationCategory::Production,
                    level: NotificationLevel::Warning,
                    title: format!("待复盘项目 {} 篇", pending_reviews.len()),
                    body: format!(
                        "当前有 {} 个项目等待补录复盘数据，优先处理 72h / 7d 节点。",
                        pending_reviews.len()
                    ),
                    action_label: Some("去复盘".into()),
                    action_href: Some("/review".into()),
                    source_type: Some("review_pending".into()),
                    source_id: None,
                    fingerprint: Some("pending-reviews".into()),
                },
            )
            .await
            .map_err(AppError::Storage)?;
    }

    let settings = s.settings.read().await.map_err(AppError::Ai)?;
    let settings_ok = settings
        .map(|cfg| !cfg.base_url.trim().is_empty() && !cfg.api_key.trim().is_empty())
        .unwrap_or(false);
    if settings_ok {
        s.notifications
            .resolve_by_fingerprint(user.id, "settings-ai-missing")
            .await
            .map_err(AppError::Storage)?;
    } else {
        s.notifications
            .upsert_active(
                user.id,
                &UpsertNotification {
                    category: NotificationCategory::System,
                    level: NotificationLevel::Error,
                    title: "AI 设置未配置完整".into(),
                    body: "当前 AI API 的 base_url 或 api_key 缺失，部分生成能力不可用。".into(),
                    action_label: Some("去设置".into()),
                    action_href: Some("/settings".into()),
                    source_type: Some("settings".into()),
                    source_id: None,
                    fingerprint: Some("settings-ai-missing".into()),
                },
            )
            .await
            .map_err(AppError::Storage)?;
    }

    Ok(())
}

async fn list_notifications(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<NotificationListQuery>,
) -> Result<Json<NotificationListView>, AppError> {
    let user = require_user(&s, &headers).await?;
    sync_notifications_for_user(&s, &user).await?;
    let items = s
        .notifications
        .list(user.id, query.unread_only.unwrap_or(false))
        .await
        .map_err(AppError::Storage)?;
    let unread_count = s
        .notifications
        .unread_count(user.id)
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(NotificationListView { unread_count, items }))
}

async fn mark_notification_read(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user = require_user(&s, &headers).await?;
    s.notifications
        .mark_read(user.id, id)
        .await
        .map_err(AppError::Storage)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn mark_notifications_read_all(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = require_user(&s, &headers).await?;
    s.notifications
        .mark_all_read(user.id)
        .await
        .map_err(AppError::Storage)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn clear_resolved_notifications(
    State(s): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = require_user(&s, &headers).await?;
    s.notifications
        .archive_resolved(user.id)
        .await
        .map_err(AppError::Storage)?;
    Ok(StatusCode::NO_CONTENT)
}

// === 项目产物：流式生成 + 列表 ===

async fn list_project_artifacts(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> Result<Json<Vec<ProjectArtifact>>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let xs = s
        .artifacts
        .latest_all(project_id)
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(xs))
}

#[derive(Debug, Serialize, Deserialize)]
struct StoryImageArtifact {
    model: String,
    prompt: String,
    mime_type: String,
    data_url: String,
    title_text: String,
    cover_size: Option<String>,
    author_name: Option<String>,
    show_author: bool,
}

#[derive(Debug, Deserialize)]
struct StoryImageBody {
    size: Option<String>,
    quality: Option<String>,
    author_name: Option<String>,
    show_author: Option<bool>,
}

/// 把 mpsc::Receiver<StreamEvent> 转 axum SSE。
/// - Delta 转 `event: delta` + `data: {"text":"..."}`（用 JSON 编码避免换行/特殊字符破坏 SSE 协议）
/// - Done 转 `event: done`，前端收到后关闭 EventSource
/// - Error 转 `event: error`
/// 流结束后调用 `on_complete(全文)` 落库（失败也走 error 事件）
fn sse_from_stream<F, Fut>(
    mut rx: tokio::sync::mpsc::Receiver<StreamEvent>,
    on_complete: F,
) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>
where
    F: FnOnce(String) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<(), String>> + Send + 'static,
{
    let stream = async_stream::stream! {
        let mut acc = String::new();
        let mut had_error: Option<String> = None;
        while let Some(ev) = rx.recv().await {
            match ev {
                StreamEvent::Delta(text) => {
                    acc.push_str(&text);
                    let payload = serde_json::json!({"text": text}).to_string();
                    yield Ok(Event::default().event("delta").data(payload));
                }
                StreamEvent::Retry { attempt, max } => {
                    let payload = serde_json::json!({"attempt": attempt, "max": max}).to_string();
                    yield Ok(Event::default().event("retry").data(payload));
                }
                StreamEvent::Error(e) => {
                    had_error = Some(e.clone());
                    let payload = serde_json::json!({"message": e}).to_string();
                    yield Ok(Event::default().event("error").data(payload));
                }
                StreamEvent::Done => break,
            }
        }
        if had_error.is_none() && !acc.is_empty() {
            match on_complete(acc).await {
                Ok(()) => {
                    yield Ok(Event::default().event("done").data("{}"));
                }
                Err(e) => {
                    let payload = serde_json::json!({"message": format!("落库失败: {e}")}).to_string();
                    yield Ok(Event::default().event("error").data(payload));
                }
            }
        } else {
            // 出错也补一个 done 让前端清状态
            yield Ok(Event::default().event("done").data("{}"));
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn create_ai_event_notification(
    notifications: NotificationRepo,
    user_id: Uuid,
    title: String,
    body: String,
    action_href: String,
    level: NotificationLevel,
    source_type: &str,
    source_id: String,
) {
    let _ = notifications
        .upsert_active(
            user_id,
            &UpsertNotification {
                category: NotificationCategory::Ai,
                level,
                title,
                body,
                action_label: Some("查看结果".into()),
                action_href: Some(action_href),
                source_type: Some(source_type.into()),
                source_id: Some(source_id),
                fingerprint: None,
            },
        )
        .await;
}

async fn ai_readme_stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, AppError> {
    let (user, project) = require_project(&s, &headers, project_id).await?;
    let seed = s
        .seeds
        .get(user.id, project.seed_id)
        .await
        .map_err(AppError::Storage)?;
    let total = seed.score.total();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let rx = stream_readme(&s.ai, &seed.title, &seed.track, total, &today).await;
    let artifacts = s.artifacts.clone();
    let notifications = s.notifications.clone();
    let action_href = format!("/projects/{project_id}");
    let source_id = project_id.to_string();
    Ok(sse_from_stream(rx, move |full| async move {
        artifacts
            .save(project_id, ArtifactKind::Readme, &full)
            .await
            .map_err(|e| format!("{e:#}"))?;
        create_ai_event_notification(
            notifications,
            user.id,
            "AI 已生成 README".into(),
            format!("《{}》的项目 README 已生成完成。", project.title),
            action_href,
            NotificationLevel::Info,
            "artifact",
            source_id,
        )
        .await;
        Ok(())
    }))
}

async fn ai_character_setup_stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, AppError> {
    let (user, project) = require_project(&s, &headers, project_id).await?;
    let arts = s
        .artifacts
        .latest_all(project_id)
        .await
        .map_err(AppError::Storage)?;
    let readme = arts
        .iter()
        .find(|a| a.kind == ArtifactKind::Readme)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    if readme.trim().is_empty() {
        return Err(AppError::Storage(bookflow_storage::StorageError::Conflict(
            "先生成项目 README，再生成角色设定".into(),
        )));
    }
    let rx = stream_character_setup(&s.ai, &readme).await;
    let artifacts = s.artifacts.clone();
    let notifications = s.notifications.clone();
    let action_href = format!("/projects/{project_id}");
    let source_id = project_id.to_string();
    Ok(sse_from_stream(rx, move |full| async move {
        artifacts
            .save(project_id, ArtifactKind::CharacterSetup, &full)
            .await
            .map_err(|e| format!("{e:#}"))?;
        create_ai_event_notification(
            notifications,
            user.id,
            "AI 已生成角色设定".into(),
            format!("《{}》的角色设定已生成完成。", project.title),
            action_href,
            NotificationLevel::Info,
            "artifact",
            source_id,
        )
        .await;
        Ok(())
    }))
}

async fn ai_outline_stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, AppError> {
    let (user, project) = require_project(&s, &headers, project_id).await?;
    let arts = s
        .artifacts
        .latest_all(project_id)
        .await
        .map_err(AppError::Storage)?;
    let readme = arts
        .iter()
        .find(|a| a.kind == ArtifactKind::Readme)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    let character_setup = arts
        .iter()
        .find(|a| a.kind == ArtifactKind::CharacterSetup)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    if readme.trim().is_empty() || character_setup.trim().is_empty() {
        return Err(AppError::Storage(bookflow_storage::StorageError::Conflict(
            "先生成 README 和角色设定，再生成大纲".into(),
        )));
    }
    let rx = stream_outline(&s.ai, &readme, &character_setup).await;
    let artifacts = s.artifacts.clone();
    let notifications = s.notifications.clone();
    let action_href = format!("/projects/{project_id}");
    let source_id = project_id.to_string();
    Ok(sse_from_stream(rx, move |full| async move {
        artifacts
            .save(project_id, ArtifactKind::Outline, &full)
            .await
            .map_err(|e| format!("{e:#}"))?;
        create_ai_event_notification(
            notifications,
            user.id,
            "AI 已生成大纲".into(),
            format!("《{}》的大纲已生成完成。", project.title),
            action_href,
            NotificationLevel::Info,
            "artifact",
            source_id,
        )
        .await;
        Ok(())
    }))
}

async fn ai_publish_stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let arts = s
        .artifacts
        .latest_all(project_id)
        .await
        .map_err(AppError::Storage)?;
    let readme = arts
        .iter()
        .find(|a| a.kind == ArtifactKind::Readme)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    let outline = arts
        .iter()
        .find(|a| a.kind == ArtifactKind::Outline)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    if outline.trim().is_empty() {
        return Err(AppError::Ai(anyhow::anyhow!("先生成大纲，再写发布稿")));
    }
    // 抓正文节选：所有章节 body 拼起来截 6000 字（按 char 数）
    let chapters = s
        .chapters
        .list_by_project(project_id)
        .await
        .map_err(AppError::Storage)?;
    let body_excerpt: String = chapters
        .into_iter()
        .map(|c| c.body)
        .collect::<Vec<_>>()
        .join("\n\n");
    let body_excerpt = take_chars(&body_excerpt, 6000);
    let rx = stream_publish_post(&s.ai, &readme, &outline, &body_excerpt).await;
    let artifacts = s.artifacts.clone();
    Ok(sse_from_stream(rx, move |full| async move {
        artifacts
            .save(project_id, ArtifactKind::PublishPost, &full)
            .await
            .map(|_| ())
            .map_err(|e| format!("{e:#}"))
    }))
}

async fn ai_side_dishes_stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let arts = s
        .artifacts
        .latest_all(project_id)
        .await
        .map_err(AppError::Storage)?;
    let readme = arts
        .iter()
        .find(|a| a.kind == ArtifactKind::Readme)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    let outline = arts
        .iter()
        .find(|a| a.kind == ArtifactKind::Outline)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    if readme.trim().is_empty() || outline.trim().is_empty() {
        return Err(AppError::Ai(anyhow::anyhow!(
            "先生成 README + 大纲，再写配套"
        )));
    }
    let chapters = s
        .chapters
        .list_by_project(project_id)
        .await
        .map_err(AppError::Storage)?;
    let body_excerpt: String = chapters
        .into_iter()
        .map(|c| c.body)
        .collect::<Vec<_>>()
        .join("\n\n");
    let body_excerpt = take_chars(&body_excerpt, 4000);
    let rx = stream_side_dishes(&s.ai, &readme, &outline, &body_excerpt).await;
    let artifacts = s.artifacts.clone();
    Ok(sse_from_stream(rx, move |full| async move {
        artifacts
            .save(project_id, ArtifactKind::SideDishes, &full)
            .await
            .map(|_| ())
            .map_err(|e| format!("{e:#}"))
    }))
}

async fn ai_blurb_stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let arts = s
        .artifacts
        .latest_all(project_id)
        .await
        .map_err(AppError::Storage)?;
    let readme = arts
        .iter()
        .find(|a| a.kind == ArtifactKind::Readme)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    let outline = arts
        .iter()
        .find(|a| a.kind == ArtifactKind::Outline)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    if readme.trim().is_empty() || outline.trim().is_empty() {
        return Err(AppError::Ai(anyhow::anyhow!(
            "先生成 README + 大纲，再生成导语"
        )));
    }
    let chapters = s
        .chapters
        .list_by_project(project_id)
        .await
        .map_err(AppError::Storage)?;
    let body_excerpt: String = chapters
        .into_iter()
        .map(|c| c.body)
        .collect::<Vec<_>>()
        .join("\n\n");
    let body_excerpt = take_chars(&body_excerpt, 4000);
    let rx = stream_blurb(&s.ai, &readme, &outline, &body_excerpt).await;
    let artifacts = s.artifacts.clone();
    Ok(sse_from_stream(rx, move |full| async move {
        artifacts
            .save(project_id, ArtifactKind::Blurb, &full)
            .await
            .map(|_| ())
            .map_err(|e| format!("{e:#}"))
    }))
}

#[derive(Serialize, Deserialize)]
struct DuoMiImageBody {
    model: String,
    prompt: String,
    #[serde(default = "default_duomi_size")]
    size: String,
    #[serde(default = "default_duomi_quality")]
    quality: String,
}

#[derive(Serialize, Deserialize)]
struct DuoMiImageEditBody {
    model: String,
    prompt: String,
    image_url: String,
}

#[derive(Serialize, Deserialize)]
struct DuoMiVideoBody {
    model: String,
    prompt: String,
    #[serde(default)]
    image_url: String,
    #[serde(default = "default_duomi_duration")]
    duration: i32,
}

#[derive(Serialize, Deserialize)]
struct DuoMiTaskResp {
    task_id: String,
    model: String,
    prompt: String,
}

fn default_duomi_size() -> String { "1024x1024".into() }
fn default_duomi_quality() -> String { "medium".into() }
fn default_duomi_duration() -> i32 { 5 }

/// 文生图（多米 API）
async fn ai_duomi_image(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(body): Json<DuoMiImageBody>,
) -> Result<Json<DuoMiTaskResp>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let task_id = s
        .duomi
        .create_image(&body.model, &body.prompt, &body.size, &body.quality)
        .await
        .map_err(|e| AppError::Ai(anyhow::anyhow!("{}", e)))?;
    Ok(Json(DuoMiTaskResp {
        task_id,
        model: body.model,
        prompt: body.prompt,
    }))
}

/// 图生图（多米 API）
async fn ai_duomi_image_edit(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(body): Json<DuoMiImageEditBody>,
) -> Result<Json<DuoMiTaskResp>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let task_id = s
        .duomi
        .create_image_edit(&body.model, &body.prompt, &body.image_url)
        .await
        .map_err(|e| AppError::Ai(anyhow::anyhow!("{}", e)))?;
    Ok(Json(DuoMiTaskResp {
        task_id,
        model: body.model,
        prompt: body.prompt,
    }))
}

/// 文生视频（多米 API）
async fn ai_duomi_video(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(body): Json<DuoMiVideoBody>,
) -> Result<Json<DuoMiTaskResp>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let task_id = s
        .duomi
        .create_video(&body.model, &body.prompt, &body.image_url, body.duration)
        .await
        .map_err(|e| AppError::Ai(anyhow::anyhow!("{}", e)))?;
    Ok(Json(DuoMiTaskResp {
        task_id,
        model: body.model,
        prompt: body.prompt,
    }))
}

/// 查询多米任务（图片/视频）
async fn ai_duomi_query_task(
    State(s): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    // 先尝试统一查询
    match s.duomi.query_task(&task_id).await {
        Ok(r) => return Ok(Json(serde_json::to_value(&r).unwrap_or_default())),
        Err(_) => {}
    }
    // 降级到视频查询
    match s.duomi.query_video(&task_id).await {
        Ok(r) => Ok(Json(serde_json::to_value(&r).unwrap_or_default())),
        Err(e) => Err(AppError::Ai(anyhow::anyhow!("查询任务失败: {}", e))),
    }
}

async fn ai_story_image(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Json(body): Json<StoryImageBody>,
) -> Result<Json<ProjectArtifact>, AppError> {
    let (_, project) = require_project(&s, &headers, project_id).await?;
    let artifacts = s
        .artifacts
        .latest_all(project_id)
        .await
        .map_err(AppError::Storage)?;
    let readme = artifacts
        .iter()
        .find(|a| a.kind == ArtifactKind::Readme)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    let character_setup = artifacts
        .iter()
        .find(|a| a.kind == ArtifactKind::CharacterSetup)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    let outline = artifacts
        .iter()
        .find(|a| a.kind == ArtifactKind::Outline)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    let side_dishes = artifacts
        .iter()
        .find(|a| a.kind == ArtifactKind::SideDishes)
        .map(|a| a.content.clone())
        .unwrap_or_default();

    if readme.trim().is_empty() {
        return Err(AppError::Storage(bookflow_storage::StorageError::Conflict(
            "先生成 README，再生成小说配图".into(),
        )));
    }

    let size = body.size.unwrap_or_else(|| "2:3".into());
    let quality = body.quality.unwrap_or_else(|| "high".into());
    let author_name = body
        .author_name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    let show_author = body.show_author.unwrap_or(false) && author_name.is_some();

    let prompt = build_story_image_prompt(
        &project.title,
        &project.track,
        &readme,
        &character_setup,
        &outline,
        &side_dishes,
        author_name.as_deref(),
    );
    let generated =
        s.ai.generate_image(&prompt, &size, &quality)
            .await
            .map_err(AppError::Ai)?;
    let payload = serde_json::to_string(&story_image_artifact_from_generated(
        generated,
        project.title.clone(),
        Some(size),
        author_name,
        show_author,
    ))
    .map_err(|e| AppError::Ai(anyhow::anyhow!("序列化图片产物失败: {e}")))?;
    let artifact = s
        .artifacts
        .save(project_id, ArtifactKind::StoryImage, &payload)
        .await
        .map_err(AppError::Storage)?;
    Ok(Json(artifact))
}

async fn ai_book_summary_stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
    Query(q): Query<BookSummaryQuery>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let chapters = s
        .chapters
        .list_by_project(project_id)
        .await
        .map_err(AppError::Storage)?;
    let chapter_sources = build_chapter_sources(chapters);
    if chapter_sources.is_empty() {
        return Err(AppError::Storage(
            bookflow_storage::StorageError::Conflict("先生成至少一章正文，再汇总".into()),
        ));
    }
    let from = q.from.unwrap_or(0).min(chapter_sources.len());
    let rx = stream_book_summary_chapters(&s.ai, chapter_sources, from);
    let artifacts = s.artifacts.clone();
    Ok(sse_from_stream(rx, move |full| async move {
        artifacts
            .save(project_id, ArtifactKind::BookSummary, &full)
            .await
            .map(|_| ())
            .map_err(|e| format!("{e:#}"))
    }))
}

#[derive(Deserialize)]
struct BookSummaryQuery {
    #[serde(default)]
    from: Option<usize>,
}

async fn ai_book_polish_stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(project_id): Path<Uuid>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, AppError> {
    require_project(&s, &headers, project_id).await?;
    let artifacts = s
        .artifacts
        .latest_all(project_id)
        .await
        .map_err(AppError::Storage)?;
    let summary = artifacts
        .iter()
        .find(|a| a.kind == ArtifactKind::BookSummary)
        .map(|a| a.content.clone())
        .unwrap_or_default();
    if summary.trim().is_empty() {
        return Err(AppError::Storage(bookflow_storage::StorageError::Conflict(
            "先生成全书汇总，再做优化升华".into(),
        )));
    }
    let rx = stream_book_polish(&s.ai, &summary).await;
    let artifact_repo = s.artifacts.clone();
    Ok(sse_from_stream(rx, move |full| async move {
        artifact_repo
            .save(project_id, ArtifactKind::BookPolished, &full)
            .await
            .map(|_| ())
            .map_err(|e| format!("{e:#}"))
    }))
}

/// 从 artifacts 里取角色设定（最新版本）
async fn load_character_setup(s: &AppState, project_id: Uuid) -> String {
    s.artifacts
        .latest_all(project_id)
        .await
        .ok()
        .and_then(|list| {
            list.into_iter()
                .find(|a| a.kind == ArtifactKind::CharacterSetup)
                .map(|a| a.content)
        })
        .unwrap_or_default()
}

fn take_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn story_image_artifact_from_generated(
    generated: GeneratedImage,
    title_text: String,
    cover_size: Option<String>,
    author_name: Option<String>,
    show_author: bool,
) -> StoryImageArtifact {
    StoryImageArtifact {
        model: generated.model,
        prompt: generated.prompt,
        mime_type: generated.mime_type,
        data_url: generated.data_url,
        title_text,
        cover_size,
        author_name,
        show_author,
    }
}

fn build_story_image_prompt(
    title: &str,
    track: &str,
    readme: &str,
    character_setup: &str,
    outline: &str,
    side_dishes: &str,
    author_name: Option<&str>,
) -> String {
    // 多米 gpt-image-2 限制 prompt ≤ 5000 字符，各节截断保总长可控
    let truncate = |s: &str, max: usize| -> String {
        let s = s.trim();
        if s.chars().count() > max {
            format!("{}…（下略）", s.chars().take(max).collect::<String>())
        } else {
            s.to_string()
        }
    };
    let author_line = author_name
        .filter(|n| !n.trim().is_empty())
        .map(|n| format!("\n作者署名：{n}（放在封面角落）"))
        .unwrap_or_default();
    format!(
        "中文短篇小说封面配图：竖版构图、电影感光影、强情绪强冲突、人物关系明确。\
书名「{title}」醒目放在画面上方三分之一处（大字），\
画面聚焦最具戏剧性的一幕，突出主角表情和身份张力。\
禁止：英文水印、中文书名以外的任何文字、拼贴风、低幼漫画。{author_line}\n\
赛道：{track}\n\
README：{readme}\n\
角色：{character_setup}\n\
大纲：{outline}\n\
配套封面提示词：{side_dishes}\n\
优先执行配套里的封面描述，否则聚焦最强冲突一幕。",
        title = title,
        author_line = author_line,
        track = track,
        readme = truncate(readme, 500),
        character_setup = truncate(character_setup, 500),
        outline = truncate(outline, 500),
        side_dishes = truncate(side_dishes, 400),
    )
}

fn looks_like_chapter_heading(title: &str) -> bool {
    if !title.starts_with('第') {
        return false;
    }
    matches!(title.find('章'), Some(pos) if pos > 0 && pos <= 8)
}

/// 按章构建整合源：每章一个独立字符串（含 `# 第N章 标题` 开头），跳过空正文章节，按 idx 排序。
/// 全书汇总逐章处理时用，避免一次性整本请求过重。
fn build_chapter_sources(mut chapters: Vec<Chapter>) -> Vec<String> {
    chapters.sort_by_key(|chapter| chapter.idx);
    chapters
        .into_iter()
        .filter_map(|chapter| {
            let body = chapter.body.trim().to_string();
            if body.is_empty() {
                None
            } else {
                let title = chapter.title.trim();
                let heading = if title.is_empty() {
                    format!("# 第{}章", chapter.idx)
                } else if looks_like_chapter_heading(title) {
                    format!("# {}", title)
                } else {
                    format!("# 第{}章 {}", chapter.idx, title)
                };
                Some(format!("{heading}\n\n{body}"))
            }
        })
        .collect()
}

fn build_full_book_source(chapters: Vec<Chapter>) -> Option<String> {
    let parts = build_chapter_sources(chapters);
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::{build_full_book_source, looks_like_chapter_heading, review_stage_priority};
    use bookflow_domain::Chapter;
    use uuid::Uuid;

    #[test]
    fn chapter_heading_detection_accepts_prefixed_titles() {
        assert!(looks_like_chapter_heading("第1章 替嫁"));
        assert!(looks_like_chapter_heading("第12章"));
        assert!(looks_like_chapter_heading("第十章 暗涌"));
        assert!(!looks_like_chapter_heading("替嫁之夜"));
    }

    #[test]
    fn build_full_book_source_sorts_and_skips_empty_bodies() {
        let project_id = Uuid::new_v4();
        let chapters = vec![
            Chapter {
                id: Uuid::new_v4(),
                project_id,
                idx: 2,
                title: "第2章 第二章".into(),
                beats: vec![],
                body: "第二章正文".into(),
                word_count: 5,
                updated_at: chrono::Utc::now(),
            },
            Chapter {
                id: Uuid::new_v4(),
                project_id,
                idx: 1,
                title: "  ".into(),
                beats: vec![],
                body: "第一章正文".into(),
                word_count: 5,
                updated_at: chrono::Utc::now(),
            },
            Chapter {
                id: Uuid::new_v4(),
                project_id,
                idx: 3,
                title: "第三章".into(),
                beats: vec![],
                body: "   ".into(),
                word_count: 0,
                updated_at: chrono::Utc::now(),
            },
            Chapter {
                id: Uuid::new_v4(),
                project_id,
                idx: 0,
                title: "序章".into(),
                beats: vec![],
                body: "序章正文".into(),
                word_count: 4,
                updated_at: chrono::Utc::now(),
            },
        ];

        let full = build_full_book_source(chapters);

        assert_eq!(
            full,
            Some(
                "# 第0章 序章\n\n序章正文\n\n# 第1章\n\n第一章正文\n\n# 第2章 第二章\n\n第二章正文"
                    .into()
            )
        );
    }

    #[test]
    fn build_full_book_source_keeps_numbered_heading_when_title_missing_prefix() {
        let chapter = Chapter {
            id: Uuid::nil(),
            project_id: Uuid::nil(),
            idx: 3,
            title: "替嫁".into(),
            beats: vec![],
            body: "正文".into(),
            word_count: 2,
            updated_at: chrono::Utc::now(),
        };

        let full = build_full_book_source(vec![chapter]).unwrap();

        assert!(full.starts_with("# 第3章 替嫁"));
    }

    #[test]
    fn review_stage_priority_orders_72h_before_24h_before_7d() {
        assert!(review_stage_priority("72h") < review_stage_priority("24h"));
        assert!(review_stage_priority("24h") < review_stage_priority("7d"));
    }
}
