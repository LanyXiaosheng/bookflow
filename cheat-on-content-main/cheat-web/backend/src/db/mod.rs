pub mod models;

use sqlx::PgPool;

pub async fn init(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}
