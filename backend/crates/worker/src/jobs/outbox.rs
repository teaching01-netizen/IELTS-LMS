use std::time::Instant;

use ielts_backend_application::delivery::finalize_pending_schedule_attempts;
use ielts_backend_infrastructure::config::AppConfig;
use ielts_backend_infrastructure::outbox::{OutboxEvent, OutboxRepository, RetryDisposition};
use serde::Deserialize;
use sqlx::MySqlPool;
use uuid::Uuid;

const OUTBOX_CLAIM_LEASE_SECONDS: i64 = 60;
const AUTO_SUBMIT_EVENT_FAMILY: &str = "auto_submit_schedule_attempts_requested";

#[derive(Debug, Clone, Copy, Default)]
pub struct OutboxRunReport {
    pub claimed: u64,
    pub published: u64,
    pub wakeups_notified: u64,
    pub failed: u64,
    pub terminal_failures: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutoSubmitSchedulePayload {
    schedule_id: String,
    completion_reason: Option<String>,
    batch_size: Option<i64>,
}

#[tracing::instrument(skip(pool, notify_channel), fields(notify_channel = notify_channel))]
pub async fn run_once(
    pool: MySqlPool,
    config: &AppConfig,
    notify_channel: &str,
) -> Result<OutboxRunReport, sqlx::Error> {
    let started = Instant::now();
    let repository = OutboxRepository::new(pool.clone());
    let worker_id = format!("worker-{}", std::process::id());
    let events = repository
        .claim_batch(100, &worker_id, OUTBOX_CLAIM_LEASE_SECONDS)
        .await?;
    if events.is_empty() {
        return Ok(OutboxRunReport {
            duration_ms: started.elapsed().as_millis() as u64,
            ..OutboxRunReport::default()
        });
    }

    let claimed = events.len() as u64;
    let claim_token = events
        .first()
        .and_then(|event| event.claim_token.clone())
        .unwrap_or_default();

    let mut publishable_ids = Vec::new();
    let mut published_events = Vec::new();
    let mut failed = 0_u64;
    let mut terminal_failures = 0_u64;

    for event in &events {
        if claim_token.is_empty() {
            failed += 1;
            continue;
        }
        match process_event(&pool, config, event).await {
            Ok(()) => {
                publishable_ids.push(event.id);
                published_events.push(event.clone());
            }
            Err(error_message) => {
                failed += 1;
                let disposition = repository
                    .mark_failed(
                        &claim_token,
                        event.id,
                        event.publish_attempts,
                        &error_message,
                    )
                    .await?;
                if disposition == RetryDisposition::Terminal {
                    terminal_failures += 1;
                }
            }
        }
    }

    let published = if publishable_ids.is_empty() || claim_token.is_empty() {
        0
    } else {
        repository
            .mark_published(&claim_token, &publishable_ids)
            .await?
    };
    failed += (publishable_ids.len() as u64).saturating_sub(published);

    let wakeups_notified = match repository
        .notify_published(&published_events, notify_channel)
        .await
    {
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
        failed,
        terminal_failures,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

async fn process_event(
    pool: &MySqlPool,
    config: &AppConfig,
    event: &OutboxEvent,
) -> Result<(), String> {
    if event.event_family != AUTO_SUBMIT_EVENT_FAMILY {
        return Ok(());
    }

    let payload: AutoSubmitSchedulePayload = serde_json::from_value(event.payload.clone())
        .map_err(|error| format!("invalid auto-submit payload: {error}"))?;
    let schedule_id = Uuid::parse_str(payload.schedule_id.trim())
        .map_err(|error| format!("invalid schedule id in auto-submit payload: {error}"))?;
    let completion_reason = payload
        .completion_reason
        .unwrap_or_else(|| "runtime_completed".to_owned());
    let batch_size = payload
        .batch_size
        .unwrap_or(config.auto_submit_batch_size)
        .max(1);

    finalize_pending_schedule_attempts(pool, schedule_id, &completion_reason, batch_size)
        .await
        .map_err(|error| format!("auto-submit finalization failed: {error}"))?;
    Ok(())
}
