use bookflow_domain::{
    count_chars, Beat, Chapter, NewSeed, PendingProjectReview, Project, ProjectReview,
    ProjectStatus, ReviewResult, ReviewStage, Score, Seed, Tier,
};
use sqlx::{postgres::{PgPoolOptions, PgRow}, types::Json, PgPool, Row};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("sqlx error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
}

pub type Result<T> = std::result::Result<T, StorageError>;

const REVIEW_STAGE_PENDING_ORDER_SQL: &str = r#"
    CASE stage
        WHEN '72h' THEN 0
        WHEN '24h' THEN 1
        WHEN '7d' THEN 2
        ELSE 9
    END
"#;

const REVIEW_STAGE_RECENCY_ORDER_SQL: &str = r#"
    CASE stage
        WHEN '7d' THEN 0
        WHEN '72h' THEN 1
        WHEN '24h' THEN 2
        ELSE 9
    END
"#;

pub async fn pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .connect(database_url)
        .await?;
    Ok(pool)
}

pub async fn migrate(pool: &PgPool) -> Result<()> {
    sqlx::migrate!("../../migrations").run(pool).await
        .map_err(|e| StorageError::Sqlx(sqlx::Error::Migrate(Box::new(e))))?;
    Ok(())
}

#[derive(Clone)]
pub struct SeedRepo {
    pool: PgPool,
}

impl SeedRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn insert(&self, ns: &NewSeed) -> Result<Seed> {
        let id = Uuid::new_v4();
        let total = ns.score.total();
        let tier = match Tier::from_total(total) {
            Tier::Greenlight => "greenlight",
            Tier::Backlog => "backlog",
            Tier::Reject => "reject",
        };
        let row = sqlx::query!(
            r#"
            INSERT INTO seeds
              (id, title, track, score_title, score_opening, score_slap,
               score_emotion, score_twist, score_hook, score_finish, tier)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            RETURNING id, title, track,
                      score_title, score_opening, score_slap,
                      score_emotion, score_twist, score_hook, score_finish,
                      total_score AS "total_score!: i32",
                      tier, created_at
            "#,
            id,
            ns.title,
            ns.track,
            ns.score.title,
            ns.score.opening,
            ns.score.slap,
            ns.score.emotion,
            ns.score.twist,
            ns.score.hook,
            ns.score.finish,
            tier,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(Seed {
            id: row.id,
            title: row.title,
            track: row.track,
            score: Score {
                title: row.score_title,
                opening: row.score_opening,
                slap: row.score_slap,
                emotion: row.score_emotion,
                twist: row.score_twist,
                hook: row.score_hook,
                finish: row.score_finish,
            },
            total_score: row.total_score,
            tier: parse_tier(&row.tier),
            created_at: row.created_at,
        })
    }

    pub async fn get(&self, id: Uuid) -> Result<Seed> {
        let row = sqlx::query!(
            r#"
            SELECT id, title, track,
                   score_title, score_opening, score_slap,
                   score_emotion, score_twist, score_hook, score_finish,
                   total_score AS "total_score!: i32",
                   tier, created_at
            FROM seeds
            WHERE id = $1
            "#,
            id,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(Seed {
            id: row.id,
            title: row.title,
            track: row.track,
            score: Score {
                title: row.score_title,
                opening: row.score_opening,
                slap: row.score_slap,
                emotion: row.score_emotion,
                twist: row.score_twist,
                hook: row.score_hook,
                finish: row.score_finish,
            },
            total_score: row.total_score,
            tier: parse_tier(&row.tier),
            created_at: row.created_at,
        })
    }

    pub async fn list(&self) -> Result<Vec<Seed>> {
        let rows = sqlx::query!(
            r#"
            SELECT id, title, track,
                   score_title, score_opening, score_slap,
                   score_emotion, score_twist, score_hook, score_finish,
                   total_score AS "total_score!: i32",
                   tier, created_at
            FROM seeds
            ORDER BY created_at DESC
            "#
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| Seed {
                id: r.id,
                title: r.title,
                track: r.track,
                score: Score {
                    title: r.score_title,
                    opening: r.score_opening,
                    slap: r.score_slap,
                    emotion: r.score_emotion,
                    twist: r.score_twist,
                    hook: r.score_hook,
                    finish: r.score_finish,
                },
                total_score: r.total_score,
                tier: parse_tier(&r.tier),
                created_at: r.created_at,
            })
            .collect())
    }

    /// 同 (title,track) 已存在 → Some(seed)；否则 None
    pub async fn find_by_title_track(&self, title: &str, track: &str) -> Result<Option<Seed>> {
        let row = sqlx::query!(
            r#"
            SELECT id, title, track,
                   score_title, score_opening, score_slap,
                   score_emotion, score_twist, score_hook, score_finish,
                   total_score AS "total_score!: i32",
                   tier, created_at
            FROM seeds
            WHERE title = $1 AND track = $2
            ORDER BY created_at DESC
            LIMIT 1
            "#,
            title,
            track,
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|r| Seed {
            id: r.id,
            title: r.title,
            track: r.track,
            score: Score {
                title: r.score_title,
                opening: r.score_opening,
                slap: r.score_slap,
                emotion: r.score_emotion,
                twist: r.score_twist,
                hook: r.score_hook,
                finish: r.score_finish,
            },
            total_score: r.total_score,
            tier: parse_tier(&r.tier),
            created_at: r.created_at,
        }))
    }

    /// 删除 seed；若已被 project 立项则返回 Conflict 由调用层处理
    pub async fn delete(&self, id: Uuid) -> Result<()> {
        let project_count = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "n!: i64" FROM projects WHERE seed_id = $1"#,
            id
        )
        .fetch_one(&self.pool)
        .await?;
        if project_count > 0 {
            return Err(StorageError::Conflict(format!(
                "seed {id} 已被 {project_count} 个项目立项，先删项目再删种子"
            )));
        }
        let n = sqlx::query!("DELETE FROM seeds WHERE id = $1", id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if n == 0 {
            return Err(StorageError::NotFound(format!("seed {id}")));
        }
        Ok(())
    }
}

fn parse_tier(s: &str) -> Tier {
    match s {
        "greenlight" => Tier::Greenlight,
        "backlog" => Tier::Backlog,
        _ => Tier::Reject,
    }
}

fn parse_status(s: &str) -> ProjectStatus {
    ProjectStatus::parse(s).unwrap_or(ProjectStatus::Writing)
}

#[derive(Clone)]
pub struct ProjectRepo {
    pool: PgPool,
}

impl ProjectRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// 从 seed 立项创建 project，title/track 从 seed 拷贝（前端可改但 v0.3 先这么定）
    pub async fn create_from_seed(&self, seed_id: Uuid) -> Result<Project> {
        let row = sqlx::query!(
            r#"
            INSERT INTO projects (seed_id, title, track)
            SELECT id, title, track FROM seeds WHERE id = $1
            RETURNING id, seed_id, title, track, status, created_at, updated_at
            "#,
            seed_id
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::NotFound(format!("seed {seed_id}")))?;

        Ok(Project {
            id: row.id,
            seed_id: row.seed_id,
            title: row.title,
            track: row.track,
            status: parse_status(&row.status),
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }

    pub async fn list(&self, status: Option<ProjectStatus>) -> Result<Vec<Project>> {
        let rows = sqlx::query!(
            r#"
            SELECT id, seed_id, title, track, status, created_at, updated_at
            FROM projects
            WHERE $1::text IS NULL OR status = $1
            ORDER BY updated_at DESC
            "#,
            status.map(|s| s.as_str().to_string()),
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| Project {
                id: r.id,
                seed_id: r.seed_id,
                title: r.title,
                track: r.track,
                status: parse_status(&r.status),
                created_at: r.created_at,
                updated_at: r.updated_at,
            })
            .collect())
    }

    pub async fn get(&self, id: Uuid) -> Result<Project> {
        let row = sqlx::query!(
            r#"
            SELECT id, seed_id, title, track, status, created_at, updated_at
            FROM projects WHERE id = $1
            "#,
            id
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::NotFound(format!("project {id}")))?;

        Ok(Project {
            id: row.id,
            seed_id: row.seed_id,
            title: row.title,
            track: row.track,
            status: parse_status(&row.status),
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }

    pub async fn update_status(&self, id: Uuid, to: ProjectStatus) -> Result<Project> {
        let row = sqlx::query!(
            r#"
            UPDATE projects SET status = $2 WHERE id = $1
            RETURNING id, seed_id, title, track, status, created_at, updated_at
            "#,
            id,
            to.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::NotFound(format!("project {id}")))?;

        Ok(Project {
            id: row.id,
            seed_id: row.seed_id,
            title: row.title,
            track: row.track,
            status: parse_status(&row.status),
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }

    /// 硬删项目；chapters / project_artifacts / project_reviews 走 ON DELETE CASCADE
    pub async fn delete(&self, id: Uuid) -> Result<()> {
        let n = sqlx::query!("DELETE FROM projects WHERE id = $1", id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if n == 0 {
            return Err(StorageError::NotFound(format!("project {id}")));
        }
        Ok(())
    }

    /// 项目状态分桶计数，给 dashboard 用
    pub async fn counts_by_status(&self) -> Result<Vec<(String, i64)>> {
        let rows = sqlx::query!(
            r#"
            SELECT status, COUNT(*) AS "n!: i64"
            FROM projects GROUP BY status
            "#
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| (r.status, r.n)).collect())
    }
}

#[derive(Clone)]
pub struct ChapterRepo {
    pool: PgPool,
}

impl ChapterRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_by_project(&self, project_id: Uuid) -> Result<Vec<Chapter>> {
        let rows = sqlx::query!(
            r#"
            SELECT id, project_id, idx, title,
                   beats AS "beats: Json<Vec<Beat>>",
                   body, word_count, updated_at
            FROM chapters
            WHERE project_id = $1
            ORDER BY idx ASC
            "#,
            project_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| Chapter {
                id: r.id,
                project_id: r.project_id,
                idx: r.idx,
                title: r.title,
                beats: r.beats.0,
                body: r.body,
                word_count: r.word_count,
                updated_at: r.updated_at,
            })
            .collect())
    }

    pub async fn get(&self, id: Uuid) -> Result<Chapter> {
        let r = sqlx::query!(
            r#"
            SELECT id, project_id, idx, title,
                   beats AS "beats: Json<Vec<Beat>>",
                   body, word_count, updated_at
            FROM chapters WHERE id = $1
            "#,
            id
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::NotFound(format!("chapter {id}")))?;

        Ok(Chapter {
            id: r.id,
            project_id: r.project_id,
            idx: r.idx,
            title: r.title,
            beats: r.beats.0,
            body: r.body,
            word_count: r.word_count,
            updated_at: r.updated_at,
        })
    }

    /// 自动取下一个 idx，title 默认空
    pub async fn create(&self, project_id: Uuid, title: &str) -> Result<Chapter> {
        let r = sqlx::query!(
            r#"
            INSERT INTO chapters (project_id, idx, title)
            VALUES (
                $1,
                COALESCE(
                    (SELECT MAX(idx) + 1 FROM chapters WHERE project_id = $1),
                    1
                )::SMALLINT,
                $2
            )
            RETURNING id, project_id, idx, title,
                      beats AS "beats: Json<Vec<Beat>>",
                      body, word_count, updated_at
            "#,
            project_id,
            title,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(Chapter {
            id: r.id,
            project_id: r.project_id,
            idx: r.idx,
            title: r.title,
            beats: r.beats.0,
            body: r.body,
            word_count: r.word_count,
            updated_at: r.updated_at,
        })
    }

    /// 项目总字数（按章节 word_count 聚合，跟前端口径一致）
    pub async fn total_words(&self, project_id: Uuid) -> Result<i64> {
        let row = sqlx::query!(
            r#"
            SELECT COALESCE(SUM(word_count), 0) AS "total!: i64"
            FROM chapters WHERE project_id = $1
            "#,
            project_id,
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.total)
    }

    pub async fn update_body(&self, id: Uuid, title: &str, body: &str) -> Result<Chapter> {
        let wc = count_chars(body);
        let r = sqlx::query!(
            r#"
            UPDATE chapters SET title = $2, body = $3, word_count = $4
            WHERE id = $1
            RETURNING id, project_id, idx, title,
                      beats AS "beats: Json<Vec<Beat>>",
                      body, word_count, updated_at
            "#,
            id,
            title,
            body,
            wc,
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::NotFound(format!("chapter {id}")))?;

        Ok(Chapter {
            id: r.id,
            project_id: r.project_id,
            idx: r.idx,
            title: r.title,
            beats: r.beats.0,
            body: r.body,
            word_count: r.word_count,
            updated_at: r.updated_at,
        })
    }

    pub async fn update_beats(&self, id: Uuid, beats: &[Beat]) -> Result<Chapter> {
        let r = sqlx::query!(
            r#"
            UPDATE chapters SET beats = $2
            WHERE id = $1
            RETURNING id, project_id, idx, title,
                      beats AS "beats: Json<Vec<Beat>>",
                      body, word_count, updated_at
            "#,
            id,
            Json(beats) as _,
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| StorageError::NotFound(format!("chapter {id}")))?;

        Ok(Chapter {
            id: r.id,
            project_id: r.project_id,
            idx: r.idx,
            title: r.title,
            beats: r.beats.0,
            body: r.body,
            word_count: r.word_count,
            updated_at: r.updated_at,
        })
    }
}

// === AI 候选历史草稿 ===

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SeedDraft {
    pub id: Uuid,
    pub track: String,
    pub title: String,
    pub score: Score,
    pub total_score: i32,
    pub why_buy: String,
    pub batch_id: Uuid,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone)]
pub struct NewSeedDraft {
    pub track: String,
    pub title: String,
    pub score: Score,
    pub why_buy: String,
}

#[derive(Clone)]
pub struct SeedDraftRepo {
    pool: PgPool,
}

impl SeedDraftRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn insert_batch(&self, drafts: &[NewSeedDraft]) -> Result<Vec<SeedDraft>> {
        if drafts.is_empty() {
            return Ok(Vec::new());
        }
        let batch_id = Uuid::new_v4();
        let mut tx = self.pool.begin().await?;
        let mut out = Vec::with_capacity(drafts.len());
        for d in drafts {
            let total = d.score.total();
            let row = sqlx::query!(
                r#"
                INSERT INTO ai_seed_drafts (track, title, score, total_score, why_buy, batch_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, track, title, score AS "score: Json<Score>", total_score, why_buy, batch_id, created_at
                "#,
                d.track,
                d.title,
                serde_json::to_value(&d.score).unwrap(),
                total,
                d.why_buy,
                batch_id,
            )
            .fetch_one(&mut *tx)
            .await?;
            out.push(SeedDraft {
                id: row.id,
                track: row.track,
                title: row.title,
                score: row.score.0,
                total_score: row.total_score,
                why_buy: row.why_buy,
                batch_id: row.batch_id,
                created_at: row.created_at,
            });
        }
        tx.commit().await?;
        Ok(out)
    }

    /// 按 track 拉历史草稿；不传 track 拉全部
    pub async fn list(&self, track: Option<&str>, limit: i64) -> Result<Vec<SeedDraft>> {
        let rows = sqlx::query!(
            r#"
            SELECT id, track, title, score AS "score: Json<Score>", total_score, why_buy, batch_id, created_at
            FROM ai_seed_drafts
            WHERE $1::text IS NULL OR track = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#,
            track,
            limit,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|r| SeedDraft {
            id: r.id,
            track: r.track,
            title: r.title,
            score: r.score.0,
            total_score: r.total_score,
            why_buy: r.why_buy,
            batch_id: r.batch_id,
            created_at: r.created_at,
        }).collect())
    }
}

// === 项目产物：README / 大纲 / 发布稿 / 配套 ===

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    Readme,
    Outline,
    PublishPost,
    SideDishes,
    BookSummary,
    BookPolished,
    CharacterSetup,
}

impl ArtifactKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ArtifactKind::Readme => "readme",
            ArtifactKind::Outline => "outline",
            ArtifactKind::PublishPost => "publish_post",
            ArtifactKind::SideDishes => "side_dishes",
            ArtifactKind::BookSummary => "book_summary",
            ArtifactKind::BookPolished => "book_polished",
            ArtifactKind::CharacterSetup => "character_setup",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "readme" => Some(Self::Readme),
            "outline" => Some(Self::Outline),
            "publish_post" => Some(Self::PublishPost),
            "side_dishes" => Some(Self::SideDishes),
            "book_summary" => Some(Self::BookSummary),
            "book_polished" => Some(Self::BookPolished),
            "character_setup" => Some(Self::CharacterSetup),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProjectArtifact {
    pub id: Uuid,
    pub project_id: Uuid,
    pub kind: ArtifactKind,
    pub version: i32,
    pub content: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone)]
pub struct ProjectReviewRepo {
    pool: PgPool,
}

impl ProjectReviewRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn list_by_project(&self, project_id: Uuid) -> Result<Vec<ProjectReview>> {
        let rows = sqlx::query(&format!(
            r#"
            SELECT id, project_id, stage, published_at, data_recorded,
                   read_count, completion_rate, engagement_count,
                   overall_result, title_result, hook_result, emotion_result,
                   success_reason, failure_reason, continue_track,
                   reusable_conclusion, next_action, created_at, updated_at
            FROM project_reviews
            WHERE project_id = $1
            ORDER BY
                {REVIEW_STAGE_PENDING_ORDER_SQL},
                published_at ASC
            "#,
        ))
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(map_project_review).collect()
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn upsert(
        &self,
        project_id: Uuid,
        stage: ReviewStage,
        published_at: chrono::DateTime<chrono::Utc>,
        data_recorded: bool,
        read_count: Option<i64>,
        completion_rate: Option<f64>,
        engagement_count: Option<i64>,
        overall_result: Option<&str>,
        title_result: Option<&str>,
        hook_result: Option<&str>,
        emotion_result: Option<&str>,
        success_reason: Option<&str>,
        failure_reason: Option<&str>,
        continue_track: Option<&str>,
        reusable_conclusion: Option<&str>,
        next_action: Option<&str>,
    ) -> Result<ProjectReview> {
        let row = sqlx::query(
            r#"
            INSERT INTO project_reviews (
                project_id, stage, published_at, data_recorded,
                read_count, completion_rate, engagement_count,
                overall_result, title_result, hook_result, emotion_result,
                success_reason, failure_reason, continue_track,
                reusable_conclusion, next_action
            )
            VALUES (
                $1, $2, $3, $4,
                $5, $6, $7,
                $8, $9, $10, $11,
                $12, $13, $14,
                $15, $16
            )
            ON CONFLICT (project_id, stage) DO UPDATE SET
                published_at = EXCLUDED.published_at,
                data_recorded = EXCLUDED.data_recorded,
                read_count = EXCLUDED.read_count,
                completion_rate = EXCLUDED.completion_rate,
                engagement_count = EXCLUDED.engagement_count,
                overall_result = EXCLUDED.overall_result,
                title_result = EXCLUDED.title_result,
                hook_result = EXCLUDED.hook_result,
                emotion_result = EXCLUDED.emotion_result,
                success_reason = EXCLUDED.success_reason,
                failure_reason = EXCLUDED.failure_reason,
                continue_track = EXCLUDED.continue_track,
                reusable_conclusion = EXCLUDED.reusable_conclusion,
                next_action = EXCLUDED.next_action,
                updated_at = NOW()
            RETURNING id, project_id, stage, published_at, data_recorded,
                      read_count, completion_rate, engagement_count,
                      overall_result, title_result, hook_result, emotion_result,
                      success_reason, failure_reason, continue_track,
                      reusable_conclusion, next_action, created_at, updated_at
            "#,
        )
        .bind(project_id)
        .bind(stage.as_str())
        .bind(published_at)
        .bind(data_recorded)
        .bind(read_count)
        .bind(completion_rate)
        .bind(engagement_count)
        .bind(overall_result)
        .bind(title_result)
        .bind(hook_result)
        .bind(emotion_result)
        .bind(success_reason)
        .bind(failure_reason)
        .bind(continue_track)
        .bind(reusable_conclusion)
        .bind(next_action)
        .fetch_one(&self.pool)
        .await?;

        map_project_review(row)
    }

    pub async fn pending_list(&self) -> Result<Vec<PendingProjectReview>> {
        let rows = sqlx::query(&format!(
            r#"
            WITH stage_targets AS (
                SELECT p.id AS project_id,
                       p.title,
                       p.status,
                       p.track,
                       p.published_at,
                       stage.stage
                FROM projects p
                JOIN (
                    VALUES ('72h', INTERVAL '72 hours'),
                           ('24h', INTERVAL '24 hours'),
                           ('7d', INTERVAL '7 days')
                ) AS stage(stage, due_after)
                  ON p.published_at IS NOT NULL
                 AND p.published_at + stage.due_after <= NOW()
                WHERE p.status = 'published'
            ),
            latest_results AS (
                SELECT DISTINCT ON (project_id)
                       project_id,
                       overall_result
                FROM project_reviews
                WHERE overall_result IS NOT NULL
                ORDER BY project_id,
                         {REVIEW_STAGE_RECENCY_ORDER_SQL},
                         updated_at DESC
            )
            SELECT st.project_id,
                   st.title,
                   st.status,
                   st.stage,
                   st.published_at,
                   st.track,
                   COALESCE(SUM(c.word_count), 0) AS total_words,
                   COALESCE(pr.data_recorded, FALSE) AS data_recorded,
                   lr.overall_result AS last_review_result
            FROM stage_targets st
            LEFT JOIN project_reviews pr
              ON pr.project_id = st.project_id
             AND pr.stage = st.stage
            LEFT JOIN chapters c
              ON c.project_id = st.project_id
            LEFT JOIN latest_results lr
              ON lr.project_id = st.project_id
            WHERE pr.id IS NULL
            GROUP BY st.project_id, st.title, st.status, st.stage, st.published_at, st.track,
                     pr.data_recorded, lr.overall_result
            ORDER BY
                {REVIEW_STAGE_PENDING_ORDER_SQL_ST},
                st.published_at ASC
            "#,
            REVIEW_STAGE_PENDING_ORDER_SQL_ST = REVIEW_STAGE_PENDING_ORDER_SQL.replace("stage", "st.stage"),
        ))
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(PendingProjectReview {
                    project_id: row.get("project_id"),
                    title: row.get("title"),
                    status: parse_status(row.get::<&str, _>("status")),
                    stage: parse_review_stage(row.get("stage"))?,
                    published_at: row.get("published_at"),
                    track: row.get("track"),
                    total_words: row.get("total_words"),
                    data_recorded: row.get("data_recorded"),
                    last_review_result: parse_review_result(
                        row.get::<Option<String>, _>("last_review_result").as_deref(),
                    )?,
                })
            })
            .collect()
    }
}

fn map_project_review(row: PgRow) -> Result<ProjectReview> {
    Ok(ProjectReview {
        id: row.get("id"),
        project_id: row.get("project_id"),
        stage: parse_review_stage(row.get("stage"))?,
        published_at: row.get("published_at"),
        data_recorded: row.get("data_recorded"),
        read_count: row.get("read_count"),
        completion_rate: row.get("completion_rate"),
        engagement_count: row.get("engagement_count"),
        overall_result: parse_review_result(
            row.get::<Option<String>, _>("overall_result").as_deref(),
        )?,
        title_result: row.get("title_result"),
        hook_result: row.get("hook_result"),
        emotion_result: row.get("emotion_result"),
        success_reason: row.get("success_reason"),
        failure_reason: row.get("failure_reason"),
        continue_track: row.get("continue_track"),
        reusable_conclusion: row.get("reusable_conclusion"),
        next_action: row.get("next_action"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn parse_review_stage(stage: &str) -> Result<ReviewStage> {
    ReviewStage::parse(stage).ok_or_else(|| {
        StorageError::Conflict(format!("invalid persisted review stage: {stage}"))
    })
}

fn parse_review_result(result: Option<&str>) -> Result<Option<ReviewResult>> {
    result
        .map(|value| {
            ReviewResult::parse(value).ok_or_else(|| {
                StorageError::Conflict(format!("invalid persisted review result: {value}"))
            })
        })
        .transpose()
}

#[cfg(test)]
fn review_stage_recency_rank(stage: &str) -> i32 {
    match stage {
        "7d" => 0,
        "72h" => 1,
        "24h" => 2,
        _ => 9,
    }
}

#[derive(Clone)]
pub struct ArtifactRepo {
    pool: PgPool,
}

impl ArtifactRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// 写入新版本：当前 (project_id, kind) 最大 version + 1
    pub async fn save(
        &self,
        project_id: Uuid,
        kind: ArtifactKind,
        content: &str,
    ) -> Result<ProjectArtifact> {
        let row = sqlx::query!(
            r#"
            INSERT INTO project_artifacts (project_id, kind, version, content)
            VALUES (
                $1,
                $2,
                COALESCE((SELECT MAX(version) FROM project_artifacts WHERE project_id = $1 AND kind = $2), 0) + 1,
                $3
            )
            RETURNING id, project_id, kind, version, content, created_at
            "#,
            project_id,
            kind.as_str(),
            content,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(ProjectArtifact {
            id: row.id,
            project_id: row.project_id,
            kind: ArtifactKind::parse(&row.kind).unwrap_or(ArtifactKind::Readme),
            version: row.version,
            content: row.content,
            created_at: row.created_at,
        })
    }

    /// 取某 project 所有 kind 的「最新版本」
    pub async fn latest_all(&self, project_id: Uuid) -> Result<Vec<ProjectArtifact>> {
        let rows = sqlx::query!(
            r#"
            SELECT DISTINCT ON (kind)
                id, project_id, kind, version, content, created_at
            FROM project_artifacts
            WHERE project_id = $1
            ORDER BY kind, version DESC
            "#,
            project_id,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| ProjectArtifact {
            id: r.id,
            project_id: r.project_id,
            kind: ArtifactKind::parse(&r.kind).unwrap_or(ArtifactKind::Readme),
            version: r.version,
            content: r.content,
            created_at: r.created_at,
        }).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::ArtifactKind;
    use super::ReviewResult;
    use super::ReviewStage;
    use super::{parse_review_result, parse_review_stage, review_stage_recency_rank};

    #[test]
    fn artifact_kind_parses_summary_and_polish() {
        assert_eq!(
            ArtifactKind::parse("book_summary"),
            Some(ArtifactKind::BookSummary)
        );
        assert_eq!(
            ArtifactKind::parse("book_polished"),
            Some(ArtifactKind::BookPolished)
        );
        assert_eq!(
            ArtifactKind::parse("character_setup"),
            Some(ArtifactKind::CharacterSetup)
        );
        assert_eq!(ArtifactKind::BookSummary.as_str(), "book_summary");
        assert_eq!(ArtifactKind::BookPolished.as_str(), "book_polished");
        assert_eq!(ArtifactKind::CharacterSetup.as_str(), "character_setup");
    }

    #[test]
    fn review_stage_parse_and_string_roundtrip() {
        assert_eq!(ReviewStage::parse("24h"), Some(ReviewStage::H24));
        assert_eq!(ReviewStage::parse("72h"), Some(ReviewStage::H72));
        assert_eq!(ReviewStage::parse("7d"), Some(ReviewStage::D7));
        assert_eq!(ReviewStage::H24.as_str(), "24h");
        assert_eq!(ReviewStage::H72.as_str(), "72h");
        assert_eq!(ReviewStage::D7.as_str(), "7d");
    }

    #[test]
    fn review_stage_serde_matches_db_contract() {
        let encoded = serde_json::to_string(&ReviewStage::H24).unwrap();
        assert_eq!(encoded, "\"24h\"");
        let decoded: ReviewStage = serde_json::from_str("\"72h\"").unwrap();
        assert_eq!(decoded, ReviewStage::H72);
    }

    #[test]
    fn persisted_review_values_fail_fast_when_invalid() {
        assert!(parse_review_stage("bad-stage").is_err());
        assert!(parse_review_result(Some("bad-result")).is_err());
        assert_eq!(
            parse_review_result(Some("爆")).unwrap(),
            Some(ReviewResult::Explode)
        );
        assert_eq!(parse_review_result(None).unwrap(), None);
    }

    #[test]
    fn latest_review_result_prefers_stage_recency_over_update_time() {
        assert!(review_stage_recency_rank("7d") < review_stage_recency_rank("72h"));
        assert!(review_stage_recency_rank("72h") < review_stage_recency_rank("24h"));
    }
}
