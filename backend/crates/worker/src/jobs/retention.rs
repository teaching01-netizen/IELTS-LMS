use std::time::Instant;

use ielts_backend_infrastructure::{idempotency::IdempotencyRepository, outbox::OutboxRepository};
use sqlx::MySqlPool;

const CLEANUP_BATCH_LIMIT: i64 = 1000;

#[derive(Debug, Clone, Copy, Default)]
pub struct RetentionRunReport {
    pub cache_rows: u64,
    pub idempotency_rows: u64,
    pub heartbeat_rows: u64,
    pub mutation_rows: u64,
    pub outbox_rows: u64,
    pub duration_ms: u64,
}

impl RetentionRunReport {
    pub fn total_rows(self) -> u64 {
        self.cache_rows
            + self.idempotency_rows
            + self.heartbeat_rows
            + self.mutation_rows
            + self.outbox_rows
    }
}

#[tracing::instrument(skip(pool))]
pub async fn run_once(pool: MySqlPool) -> Result<RetentionRunReport, sqlx::Error> {
    let started = Instant::now();
    let idempotency = IdempotencyRepository::new(pool.clone());
    let outbox = OutboxRepository::new(pool.clone());

    let cache_rows = sqlx::query(
        r#"
        DELETE FROM shared_cache_entries
        WHERE cache_key IN (
            SELECT cache_key
            FROM (
                SELECT cache_key
                FROM shared_cache_entries
                WHERE (invalidated_at IS NOT NULL AND invalidated_at < NOW() - INTERVAL 24 HOUR)
                   OR (expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL 24 HOUR)
                ORDER BY COALESCE(invalidated_at, expires_at) ASC
                LIMIT ?
            ) AS cache_keys_to_delete
        )
        "#,
    )
    .bind(CLEANUP_BATCH_LIMIT)
    .execute(&pool)
    .await?
    .rows_affected();
    let idempotency_rows = idempotency.purge_expired(CLEANUP_BATCH_LIMIT).await?;
    let heartbeat_rows = sqlx::query(
        r#"
        DELETE FROM student_heartbeat_events
        WHERE server_received_at < NOW() - INTERVAL 7 DAY
          AND schedule_id IN (
              SELECT id
              FROM exam_schedules
              WHERE status <> 'live'
          )
        ORDER BY server_received_at ASC
        LIMIT ?
        "#,
    )
    .bind(CLEANUP_BATCH_LIMIT)
    .execute(&pool)
    .await?
    .rows_affected();
    let mutation_rows = sqlx::query(
        r#"
        DELETE FROM student_attempt_mutations
        WHERE COALESCE(applied_at, server_received_at) < NOW() - INTERVAL 30 DAY
          AND (
              attempt_id IN (
                  SELECT id
                  FROM student_attempts
                  WHERE submitted_at IS NOT NULL
              )
              OR schedule_id IN (
                  SELECT id
                  FROM exam_schedules
                  WHERE status IN ('completed', 'cancelled')
              )
          )
        ORDER BY COALESCE(applied_at, server_received_at) ASC
        LIMIT ?
        "#,
    )
    .bind(CLEANUP_BATCH_LIMIT)
    .execute(&pool)
    .await?
    .rows_affected();
    let outbox_rows = outbox.purge_published(CLEANUP_BATCH_LIMIT).await?;

    Ok(RetentionRunReport {
        cache_rows,
        idempotency_rows,
        heartbeat_rows,
        mutation_rows,
        outbox_rows,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}
