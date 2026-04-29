use std::time::Instant;

use ielts_backend_infrastructure::{
    config::AppConfig, database_monitor::StorageBudgetLevel, idempotency::IdempotencyRepository,
    outbox::OutboxRepository,
};
use sqlx::MySqlPool;

#[derive(Debug, Clone, Copy, Default)]
pub struct RetentionRunReport {
    pub cache_rows: u64,
    pub idempotency_rows: u64,
    pub user_sessions_rows: u64,
    pub heartbeat_rows: u64,
    pub mutation_rows: u64,
    pub outbox_rows: u64,
    pub duration_ms: u64,
}

impl RetentionRunReport {
    pub fn total_rows(self) -> u64 {
        self.cache_rows
            + self.idempotency_rows
            + self.user_sessions_rows
            + self.heartbeat_rows
            + self.mutation_rows
            + self.outbox_rows
    }
}

#[tracing::instrument(skip(pool))]
pub async fn run_once(pool: MySqlPool) -> Result<RetentionRunReport, sqlx::Error> {
    run_once_with_config(pool, &AppConfig::default()).await
}

#[tracing::instrument(skip(pool, config))]
pub async fn run_once_with_config(
    pool: MySqlPool,
    config: &AppConfig,
) -> Result<RetentionRunReport, sqlx::Error> {
    run_once_with_config_and_budget(pool, config, StorageBudgetLevel::Normal).await
}

#[tracing::instrument(skip(pool, config))]
pub async fn run_once_with_config_and_budget(
    pool: MySqlPool,
    config: &AppConfig,
    storage_budget_level: StorageBudgetLevel,
) -> Result<RetentionRunReport, sqlx::Error> {
    let started = Instant::now();
    let idempotency = IdempotencyRepository::new(pool.clone());
    let outbox = OutboxRepository::new(pool.clone());
    let cleanup_batch_limit = cleanup_batch_limit(config, storage_budget_level);
    let cache_grace_hours = cache_grace_hours(config, storage_budget_level);

    let cache_rows = sqlx::query(
        r#"
        DELETE FROM shared_cache_entries
        WHERE cache_key IN (
            SELECT cache_key
            FROM (
                SELECT cache_key
                FROM shared_cache_entries
                WHERE (invalidated_at IS NOT NULL AND invalidated_at < DATE_SUB(NOW(), INTERVAL ? HOUR))
                   OR (expires_at IS NOT NULL AND expires_at < DATE_SUB(NOW(), INTERVAL ? HOUR))
                ORDER BY COALESCE(invalidated_at, expires_at) ASC
                LIMIT ?
            ) AS cache_keys_to_delete
        )
        "#,
    )
    .bind(cache_grace_hours)
    .bind(cache_grace_hours)
    .bind(cleanup_batch_limit)
    .execute(&pool)
    .await?
    .rows_affected();
    let idempotency_rows = idempotency
        .purge_expired_with_grace_hours(
            cleanup_batch_limit,
            config.retention_idempotency_grace_hours,
        )
        .await?;
    let user_sessions_rows = sqlx::query(
        r#"
        DELETE FROM user_sessions
        WHERE last_seen_at < DATE_SUB(NOW(), INTERVAL ? DAY)
          AND (
              revoked_at IS NOT NULL
              OR expires_at < NOW()
              OR idle_timeout_at < NOW()
          )
        ORDER BY last_seen_at ASC
        LIMIT ?
        "#,
    )
    .bind(config.retention_user_session_days.max(0))
    .bind(cleanup_batch_limit)
    .execute(&pool)
    .await?
    .rows_affected();
    let heartbeat_rows = sqlx::query(
        r#"
        DELETE FROM student_heartbeat_events
        WHERE server_received_at < DATE_SUB(NOW(), INTERVAL ? DAY)
          AND schedule_id IN (
              SELECT id
              FROM exam_schedules
              WHERE status <> 'live'
          )
        ORDER BY server_received_at ASC
        LIMIT ?
        "#,
    )
    .bind(config.retention_heartbeat_days.max(0))
    .bind(cleanup_batch_limit)
    .execute(&pool)
    .await?
    .rows_affected();
    let mutation_rows = sqlx::query(
        r#"
        DELETE FROM student_attempt_mutations
        WHERE COALESCE(applied_at, server_received_at) < DATE_SUB(NOW(), INTERVAL ? DAY)
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
    .bind(config.retention_mutation_days.max(0))
    .bind(cleanup_batch_limit)
    .execute(&pool)
    .await?
    .rows_affected();
    let outbox_rows = outbox.purge_published(cleanup_batch_limit).await?;

    Ok(RetentionRunReport {
        cache_rows,
        idempotency_rows,
        user_sessions_rows,
        heartbeat_rows,
        mutation_rows,
        outbox_rows,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

fn cleanup_batch_limit(config: &AppConfig, storage_budget_level: StorageBudgetLevel) -> i64 {
    let base = config.retention_cleanup_batch_limit.max(1);
    match storage_budget_level {
        StorageBudgetLevel::Normal | StorageBudgetLevel::Warning => base,
        StorageBudgetLevel::HighWater => base.saturating_mul(2),
        StorageBudgetLevel::Critical => base.saturating_mul(5),
    }
}

fn cache_grace_hours(config: &AppConfig, storage_budget_level: StorageBudgetLevel) -> i64 {
    match storage_budget_level {
        StorageBudgetLevel::Normal => config.retention_shared_cache_grace_hours.max(0),
        StorageBudgetLevel::Warning => config.retention_shared_cache_grace_hours.min(1).max(0),
        StorageBudgetLevel::HighWater | StorageBudgetLevel::Critical => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn high_storage_pressure_increases_cleanup_batch_limit() {
        let config = AppConfig {
            retention_cleanup_batch_limit: 100,
            ..AppConfig::default()
        };

        assert_eq!(
            cleanup_batch_limit(&config, StorageBudgetLevel::Normal),
            100
        );
        assert_eq!(
            cleanup_batch_limit(&config, StorageBudgetLevel::HighWater),
            200
        );
        assert_eq!(
            cleanup_batch_limit(&config, StorageBudgetLevel::Critical),
            500
        );
    }

    #[test]
    fn high_storage_pressure_drops_cache_grace_to_zero() {
        let config = AppConfig {
            retention_shared_cache_grace_hours: 24,
            ..AppConfig::default()
        };

        assert_eq!(cache_grace_hours(&config, StorageBudgetLevel::Normal), 24);
        assert_eq!(cache_grace_hours(&config, StorageBudgetLevel::Warning), 1);
        assert_eq!(cache_grace_hours(&config, StorageBudgetLevel::HighWater), 0);
        assert_eq!(cache_grace_hours(&config, StorageBudgetLevel::Critical), 0);
    }
}
