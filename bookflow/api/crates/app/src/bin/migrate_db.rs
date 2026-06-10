use anyhow::Context;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::from_path("../.env");
    let _ = dotenvy::dotenv();

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL 未设置")?;
    let pool = bookflow_storage::pool(&database_url)
        .await
        .context("连不上 db")?;
    bookflow_storage::migrate(&pool)
        .await
        .context("migration 失败")?;
    println!("database migrated");
    Ok(())
}
