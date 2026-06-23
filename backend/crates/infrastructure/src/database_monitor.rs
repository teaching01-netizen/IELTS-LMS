use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::Value;
use sqlx::MySqlPool;

#[derive(Clone, Debug)]
pub struct OutboxBacklogSnapshot {
    pub pending_count: u64,
    pub oldest_age_seconds: i64,
    pub terminal_count: u64,
    pub oldest_terminal_age_seconds: i64,
}

#[derive(Clone, Debug)]
pub struct RelationSize {
    pub relation_name: String,
    pub total_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StorageBudgetThresholds {
    pub warning_bytes: u64,
    pub high_water_bytes: u64,
    pub critical_bytes: u64,
}

impl Default for StorageBudgetThresholds {
    fn default() -> Self {
        Self {
            warning_bytes: 750 * 1024 * 1024,
            high_water_bytes: 850 * 1024 * 1024,
            critical_bytes: 950 * 1024 * 1024,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StorageBudgetLevel {
    Normal,
    Warning,
    HighWater,
    Critical,
}

impl StorageBudgetLevel {
    pub fn as_label(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Warning => "warning",
            Self::HighWater => "high_water",
            Self::Critical => "critical",
        }
    }

    pub fn as_severity_code(self) -> i64 {
        match self {
            Self::Normal => 0,
            Self::Warning => 1,
            Self::HighWater => 2,
            Self::Critical => 3,
        }
    }
}

#[derive(Clone, Debug)]
pub struct StorageBudgetSnapshot {
    pub total_bytes: u64,
    pub level: StorageBudgetLevel,
    pub largest_relations: Vec<RelationSize>,
}

#[derive(Clone, Debug, Default)]
pub struct GradingProjectionSnapshot {
    pub lag_seconds: i64,
    pub cycle_duration_seconds: f64,
    pub schedule_rows_processed_total: u64,
    pub submission_rows_processed_total: u64,
    pub section_rows_processed_total: u64,
    pub writing_task_rows_processed_total: u64,
    pub failures_total: u64,
}

pub async fn ping_database(pool: &MySqlPool) -> Result<Duration, sqlx::Error> {
    let started = Instant::now();
    sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(pool)
        .await?;
    Ok(started.elapsed())
}

pub async fn inspect_outbox_backlog(
    pool: &MySqlPool,
) -> Result<OutboxBacklogSnapshot, sqlx::Error> {
    let row = sqlx::query_as::<_, OutboxBacklogRow>(
        r#"
        SELECT
            COUNT(CASE WHEN failed_at IS NULL THEN 1 END) AS pending_count,
            COALESCE(
                TIMESTAMPDIFF(
                    SECOND,
                    MIN(CASE WHEN failed_at IS NULL THEN created_at END),
                    NOW()
                ),
                0
            ) AS oldest_age_seconds,
            COUNT(CASE WHEN failed_at IS NOT NULL THEN 1 END) AS terminal_count,
            COALESCE(
                TIMESTAMPDIFF(
                    SECOND,
                    MIN(CASE WHEN failed_at IS NOT NULL THEN failed_at END),
                    NOW()
                ),
                0
            ) AS oldest_terminal_age_seconds
        FROM outbox_events
        WHERE published_at IS NULL
        "#,
    )
    .fetch_one(pool)
    .await?;

    Ok(OutboxBacklogSnapshot {
        pending_count: row.pending_count.max(0) as u64,
        oldest_age_seconds: row.oldest_age_seconds.max(0),
        terminal_count: row.terminal_count.max(0) as u64,
        oldest_terminal_age_seconds: row.oldest_terminal_age_seconds.max(0),
    })
}

pub async fn inspect_storage_budget(
    pool: &MySqlPool,
    thresholds: StorageBudgetThresholds,
) -> Result<StorageBudgetSnapshot, sqlx::Error> {
    // Note: pg_database_size is PostgreSQL-specific
    // MySQL equivalent: SELECT SUM(data_length + index_length) FROM information_schema.tables WHERE table_schema = DATABASE()
    let total_bytes = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT CAST(COALESCE(SUM(COALESCE(data_length, 0) + COALESCE(index_length, 0)), 0) AS SIGNED)
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        "#,
    )
    .fetch_one(pool)
    .await?
    .max(0) as u64;

    // Note: pg_statio_user_tables is PostgreSQL-specific
    // MySQL equivalent: SELECT table_name, data_length + index_length FROM information_schema.tables
    let largest_relations = sqlx::query_as::<_, RelationSizeRow>(
        r#"
        SELECT
            table_name AS relation_name,
            CAST((COALESCE(data_length, 0) + COALESCE(index_length, 0)) AS SIGNED) AS total_bytes
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
        ORDER BY (data_length + index_length) DESC
        LIMIT 5
        "#,
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| RelationSize {
        relation_name: row.relation_name,
        total_bytes: row.total_bytes.max(0) as u64,
    })
    .collect();

    let level = if total_bytes >= thresholds.critical_bytes {
        StorageBudgetLevel::Critical
    } else if total_bytes >= thresholds.high_water_bytes {
        StorageBudgetLevel::HighWater
    } else if total_bytes >= thresholds.warning_bytes {
        StorageBudgetLevel::Warning
    } else {
        StorageBudgetLevel::Normal
    };

    Ok(StorageBudgetSnapshot {
        total_bytes,
        level,
        largest_relations,
    })
}

pub async fn inspect_grading_projection_snapshot(
    pool: &MySqlPool,
) -> Result<GradingProjectionSnapshot, sqlx::Error> {
    let payload = sqlx::query_scalar::<_, Value>(
        r#"
        SELECT payload
        FROM shared_cache_entries
        WHERE cache_key = 'grading_projection_state_v1'
          AND invalidated_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
        "#,
    )
    .fetch_optional(pool)
    .await?;

    let Some(payload) = payload else {
        return Ok(GradingProjectionSnapshot::default());
    };

    let state: GradingProjectionStateRow = serde_json::from_value(payload).unwrap_or_default();
    Ok(GradingProjectionSnapshot {
        lag_seconds: state
            .last_cycle
            .as_ref()
            .map(|cycle| cycle.lag_seconds)
            .unwrap_or(0),
        cycle_duration_seconds: state
            .last_cycle
            .as_ref()
            .map(|cycle| cycle.duration_seconds)
            .unwrap_or(0.0),
        schedule_rows_processed_total: state.totals.schedule_rows_synced,
        submission_rows_processed_total: state.totals.submission_rows_synced,
        section_rows_processed_total: state.totals.section_rows_synced,
        writing_task_rows_processed_total: state.totals.writing_task_rows_synced,
        failures_total: state.failures_total,
    })
}

#[derive(sqlx::FromRow)]
struct OutboxBacklogRow {
    pending_count: i64,
    oldest_age_seconds: i64,
    terminal_count: i64,
    oldest_terminal_age_seconds: i64,
}

#[derive(sqlx::FromRow)]
struct RelationSizeRow {
    relation_name: String,
    total_bytes: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GradingProjectionStateRow {
    totals: GradingProjectionTotalsRow,
    failures_total: u64,
    last_cycle: Option<GradingProjectionCycleRow>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GradingProjectionTotalsRow {
    schedule_rows_synced: u64,
    submission_rows_synced: u64,
    section_rows_synced: u64,
    writing_task_rows_synced: u64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GradingProjectionCycleRow {
    duration_seconds: f64,
    lag_seconds: i64,
}
