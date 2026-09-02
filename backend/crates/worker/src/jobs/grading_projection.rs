use std::time::Instant;

use chrono::{DateTime, Duration, Utc};
use ielts_backend_application::grading::{
    GradingError, GradingProjectionRequest, GradingService, ProjectionCursor,
};
use ielts_backend_infrastructure::config::AppConfig;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::MySqlPool;

const PROJECTION_STATE_CACHE_KEY: &str = "grading_projection_state_v1";

#[derive(Debug, Clone, Default)]
pub struct GradingProjectionRunReport {
    pub enabled: bool,
    pub schedule_rows_synced: u64,
    pub submission_rows_synced: u64,
    pub section_rows_synced: u64,
    pub writing_task_rows_synced: u64,
    pub affected_schedules: u64,
    pub lag_seconds: i64,
    pub duration_ms: u64,
    pub failures_total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GradingProjectionState {
    /// Retained for observability/backward compatibility; stream progress is
    /// tracked independently below.
    pub watermark: Option<DateTime<Utc>>,
    pub schedule_cursor: Option<ProjectionCursor>,
    pub attempt_cursor: Option<ProjectionCursor>,
    pub totals: GradingProjectionTotals,
    pub failures_total: u64,
    pub last_cycle: Option<GradingProjectionCycleSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GradingProjectionTotals {
    pub schedule_rows_synced: u64,
    pub submission_rows_synced: u64,
    pub section_rows_synced: u64,
    pub writing_task_rows_synced: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradingProjectionCycleSnapshot {
    pub recorded_at: DateTime<Utc>,
    pub duration_seconds: f64,
    pub lag_seconds: i64,
    pub schedule_rows_synced: u64,
    pub submission_rows_synced: u64,
    pub section_rows_synced: u64,
    pub writing_task_rows_synced: u64,
    pub affected_schedules: u64,
}

pub async fn run_once(
    pool: MySqlPool,
    config: &AppConfig,
) -> Result<GradingProjectionRunReport, sqlx::Error> {
    if !config.grading_projection_enabled {
        return Ok(GradingProjectionRunReport {
            enabled: false,
            ..GradingProjectionRunReport::default()
        });
    }

    let started = Instant::now();
    // The projection writes are idempotent, while the checkpoint uses an
    // optimistic compare-and-swap. Concurrent workers may replay a batch, but
    // only the worker that observed the current revision can advance progress.
    let (mut state, checkpoint_revision) = load_projection_state(&pool).await?;
    let now = Utc::now();
    let bootstrap_after = if state.watermark.is_none() {
        Some(now - Duration::hours(config.grading_projection_bootstrap_window_hours.max(0)))
    } else {
        None
    };

    let service = GradingService::new(pool.clone());
    let projection = service
        .run_projection_cycle(GradingProjectionRequest {
            schedule_cursor: state.schedule_cursor.clone(),
            attempt_cursor: state.attempt_cursor.clone(),
            watermark: state.watermark,
            bootstrap_after,
            batch_size: Some(config.grading_projection_batch_size.max(1)),
        })
        .await
        .map_err(grading_error_to_sqlx)?;

    state.schedule_cursor = projection.next_schedule_cursor.or(state.schedule_cursor);
    state.attempt_cursor = projection.next_attempt_cursor.or(state.attempt_cursor);
    state.watermark = projection.next_watermark.or(state.watermark);
    state.totals.schedule_rows_synced = state
        .totals
        .schedule_rows_synced
        .saturating_add(projection.schedule_rows_synced);
    state.totals.submission_rows_synced = state
        .totals
        .submission_rows_synced
        .saturating_add(projection.submission_rows_synced);
    state.totals.section_rows_synced = state
        .totals
        .section_rows_synced
        .saturating_add(projection.section_rows_synced);
    state.totals.writing_task_rows_synced = state
        .totals
        .writing_task_rows_synced
        .saturating_add(projection.writing_task_rows_synced);

    let lag_seconds = state
        .watermark
        .map(|watermark| now.signed_duration_since(watermark).num_seconds().max(0))
        .unwrap_or(0);

    state.last_cycle = Some(GradingProjectionCycleSnapshot {
        recorded_at: now,
        duration_seconds: started.elapsed().as_secs_f64(),
        lag_seconds,
        schedule_rows_synced: projection.schedule_rows_synced,
        submission_rows_synced: projection.submission_rows_synced,
        section_rows_synced: projection.section_rows_synced,
        writing_task_rows_synced: projection.writing_task_rows_synced,
        affected_schedules: projection.affected_schedule_ids.len() as u64,
    });

    save_projection_state(&pool, &state, checkpoint_revision).await?;

    Ok(GradingProjectionRunReport {
        enabled: true,
        schedule_rows_synced: projection.schedule_rows_synced,
        submission_rows_synced: projection.submission_rows_synced,
        section_rows_synced: projection.section_rows_synced,
        writing_task_rows_synced: projection.writing_task_rows_synced,
        affected_schedules: projection.affected_schedule_ids.len() as u64,
        lag_seconds,
        duration_ms: started.elapsed().as_millis() as u64,
        failures_total: state.failures_total,
    })
}

pub async fn record_failure(pool: &MySqlPool) -> Result<u64, sqlx::Error> {
    for _ in 0..3 {
        let (mut state, checkpoint_revision) = load_projection_state(pool).await?;
        state.failures_total = state.failures_total.saturating_add(1);
        match save_projection_state(pool, &state, checkpoint_revision).await {
            Ok(()) => return Ok(state.failures_total),
            Err(sqlx::Error::Protocol(message)) if message == "projection checkpoint changed" => {
                continue;
            }
            Err(error) => return Err(error),
        }
    }
    Err(sqlx::Error::Protocol(
        "projection checkpoint changed".to_owned(),
    ))
}

fn grading_error_to_sqlx(error: GradingError) -> sqlx::Error {
    match error {
        GradingError::Database(error) => error,
        other => sqlx::Error::Protocol(other.to_string()),
    }
}

async fn load_projection_state(
    pool: &MySqlPool,
) -> Result<(GradingProjectionState, i64), sqlx::Error> {
    // Checkpoint state is durable state, not an expiring cache entry. Reading
    // through cache TTL/invalidation would silently reset a cursor.
    let row = sqlx::query_as::<_, (Value, i64)>(
        "SELECT payload, revision FROM shared_cache_entries WHERE cache_key = ?",
    )
    .bind(PROJECTION_STATE_CACHE_KEY)
    .fetch_optional(pool)
    .await?;

    let Some((payload, revision)) = row else {
        return Ok((GradingProjectionState::default(), 0));
    };

    Ok((
        serde_json::from_value(payload).unwrap_or_default(),
        revision,
    ))
}

async fn save_projection_state(
    pool: &MySqlPool,
    state: &GradingProjectionState,
    expected_revision: i64,
) -> Result<(), sqlx::Error> {
    let payload = serde_json::to_value(state).unwrap_or_else(|_| Value::Null);
    let result = if expected_revision == 0 {
        sqlx::query(
            r#"
            INSERT INTO shared_cache_entries (
                cache_key, payload, revision, invalidated_at, expires_at, created_at, updated_at
            )
            VALUES (?, ?, 1, NULL, NULL, NOW(), NOW())
            ON DUPLICATE KEY UPDATE payload = IF(revision = 0, VALUES(payload), payload)
            "#,
        )
        .bind(PROJECTION_STATE_CACHE_KEY)
        .bind(payload)
        .execute(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            UPDATE shared_cache_entries
            SET payload = ?, revision = revision + 1,
                invalidated_at = NULL, expires_at = NULL, updated_at = NOW()
            WHERE cache_key = ? AND revision = ?
            "#,
        )
        .bind(payload)
        .bind(PROJECTION_STATE_CACHE_KEY)
        .bind(expected_revision)
        .execute(pool)
        .await?
    };

    if expected_revision > 0 && result.rows_affected() != 1 {
        return Err(sqlx::Error::Protocol(
            "projection checkpoint changed".to_owned(),
        ));
    }
    if expected_revision == 0 && result.rows_affected() == 0 {
        let revision: i64 =
            sqlx::query_scalar("SELECT revision FROM shared_cache_entries WHERE cache_key = ?")
                .bind(PROJECTION_STATE_CACHE_KEY)
                .fetch_one(pool)
                .await?;
        if revision != 0 {
            return Err(sqlx::Error::Protocol(
                "projection checkpoint changed".to_owned(),
            ));
        }
    }
    Ok(())
}
