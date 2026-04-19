use std::time::Instant;

use ielts_backend_infrastructure::outbox::OutboxRepository;
use sqlx::MySqlPool;

#[derive(Debug, Clone, Copy, Default)]
pub struct OutboxRunReport {
    pub claimed: u64,
    pub published: u64,
    pub wakeups_notified: u64,
    pub failed: u64,
    pub duration_ms: u64,
}

#[tracing::instrument(skip(pool, notify_channel), fields(notify_channel = notify_channel))]
pub async fn run_once(pool: MySqlPool, notify_channel: &str) -> Result<OutboxRunReport, sqlx::Error> {
    let started = Instant::now();
    let repository = OutboxRepository::new(pool);
    let events = repository.claim_batch(100).await?;
    if events.is_empty() {
        return Ok(OutboxRunReport {
            duration_ms: started.elapsed().as_millis() as u64,
            ..OutboxRunReport::default()
        });
    }

    let claimed = events.len() as u64;
    let ids = events.iter().map(|event| event.id).collect::<Vec<_>>();
    let published = repository.mark_published(&ids).await?;
    let wakeups_notified = match repository.notify_published(&events, notify_channel).await {
        Ok(count) => count,
        Err(error) => {
            tracing::warn!(error = %error, channel = notify_channel, "failed to publish live wakeups");
            0
        }
    };

    Ok(OutboxRunReport {
        claimed,
        published,
        wakeups_notified,
        failed: claimed.saturating_sub(published),
        duration_ms: started.elapsed().as_millis() as u64,
    })
}
