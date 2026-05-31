use bookflow_domain::{NewSeed, Score, Seed, Tier};
use sqlx::{postgres::PgPoolOptions, PgPool};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("sqlx error: {0}")]
    Sqlx(#[from] sqlx::Error),
}

pub type Result<T> = std::result::Result<T, StorageError>;

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
}

fn parse_tier(s: &str) -> Tier {
    match s {
        "greenlight" => Tier::Greenlight,
        "backlog" => Tier::Backlog,
        _ => Tier::Reject,
    }
}
