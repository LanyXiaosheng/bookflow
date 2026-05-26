use std::sync::Arc;
use tokio_cron_scheduler::{Job, JobScheduler};

use crate::AppState;

pub async fn start(state: Arc<AppState>) {
    let scheduler = JobScheduler::new().await.unwrap();

    let sync_state = state.clone();
    let sync_job = Job::new_async("0 0 */6 * * *", move |_uuid, _lock| {
        let s = sync_state.clone();
        Box::pin(async move {
            if let Err(e) = run_sync(&s).await {
                tracing::error!("Sync job failed: {}", e);
            }
        })
    }).unwrap();

    scheduler.add(sync_job).await.unwrap();
    scheduler.start().await.unwrap();

    tracing::info!("Scheduler started (sync every 6 hours)");
}

async fn run_sync(state: &AppState) -> anyhow::Result<()> {
    let accounts = sqlx::query_as::<_, (i32, String, Option<String>)>(
        "SELECT id, platform, cookie FROM accounts WHERE cookie IS NOT NULL"
    )
    .fetch_all(&state.db)
    .await?;

    for (account_id, platform, cookie) in accounts {
        let Some(cookie) = cookie else { continue };

        match platform.as_str() {
            "fanqie" => {
                tracing::info!("Syncing fanqie account {}", account_id);
                sync_fanqie(state, account_id, &cookie).await?;
            }
            "douyin" => {
                tracing::info!("Syncing douyin account {} (not implemented)", account_id);
            }
            _ => {}
        }
    }

    Ok(())
}

async fn sync_fanqie(state: &AppState, account_id: i32, cookie: &str) -> anyhow::Result<()> {
    use crate::crawler::FanqieClient;

    let client = FanqieClient::new(cookie.to_string());
    let works = client.fetch_all_works().await?;

    for w in &works {
        let existing = sqlx::query_as::<_, (i32,)>(
            "SELECT id FROM works WHERE platform = 'fanqie' AND platform_id = $1"
        )
        .bind(&w.platform_id)
        .fetch_optional(&state.db)
        .await?;

        let work_id = if let Some((id,)) = existing {
            sqlx::query(
                "UPDATE works SET title = $1, word_count = $2, category = $3, \
                 update_time = to_timestamp($4) WHERE id = $5"
            )
            .bind(&w.title)
            .bind(w.word_count)
            .bind(&w.category)
            .bind(w.update_time.map(|t| t as f64))
            .bind(id)
            .execute(&state.db)
            .await?;
            id
        } else {
            let (id,) = sqlx::query_as::<_, (i32,)>(
                "INSERT INTO works (account_id, platform, platform_id, item_id, title, \
                 word_count, category, sign_status, create_time, update_time) \
                 VALUES ($1, 'fanqie', $2, $3, $4, $5, $6, $7, to_timestamp($8), to_timestamp($9)) \
                 RETURNING id"
            )
            .bind(account_id)
            .bind(&w.platform_id)
            .bind(&w.item_id)
            .bind(&w.title)
            .bind(w.word_count)
            .bind(&w.category)
            .bind(w.sign_status)
            .bind(w.create_time.map(|t| t as f64))
            .bind(w.update_time.map(|t| t as f64))
            .fetch_one(&state.db)
            .await?;
            id
        };

        if w.is_data_show {
            if let Ok(stats) = client.fetch_work_stats(&w.platform_id).await {
                sqlx::query(
                    "INSERT INTO work_stats (work_id, read_count, show_count, click_rate, \
                     digg_count, comment_count, shelf_count, pay_rate, popularity_score) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
                )
                .bind(work_id)
                .bind(stats.read_count)
                .bind(stats.show_count)
                .bind(stats.click_rate)
                .bind(stats.digg_count)
                .bind(stats.comment_count)
                .bind(stats.shelf_count)
                .bind(stats.pay_rate)
                .bind(stats.popularity_score)
                .execute(&state.db)
                .await?;
            }
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }
    }

    tracing::info!("Synced {} fanqie works", works.len());
    Ok(())
}
