use chrono::{DateTime, Utc};
use ielts_backend_domain::schedule::LiveUpdateEvent;
use serde_json::Value;
use sqlx::{MySql, MySqlPool, Transaction};

#[derive(Debug, Clone)]
pub struct LiveUpdateBusRepository {
    pool: MySqlPool,
}

#[derive(Debug, Clone)]
pub struct LiveUpdateEnvelope {
    pub sequence_id: i64,
    pub origin_instance_id: String,
    pub event: LiveUpdateEvent,
}

impl LiveUpdateBusRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn enqueue(
        &self,
        origin_instance_id: &str,
        event: &LiveUpdateEvent,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO live_update_events (
                origin_instance_id,
                event_kind,
                event_target_id,
                event_revision,
                event_name,
                event_payload,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NOW())
            "#,
        )
        .bind(origin_instance_id)
        .bind(&event.kind)
        .bind(&event.id)
        .bind(event.revision)
        .bind(&event.event)
        .bind(Value::Null)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn enqueue_in_tx(
        tx: &mut Transaction<'_, MySql>,
        origin_instance_id: &str,
        event: &LiveUpdateEvent,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO live_update_events (
                origin_instance_id,
                event_kind,
                event_target_id,
                event_revision,
                event_name,
                event_payload,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NOW())
            "#,
        )
        .bind(origin_instance_id)
        .bind(&event.kind)
        .bind(&event.id)
        .bind(event.revision)
        .bind(&event.event)
        .bind(Value::Null)
        .execute(tx.as_mut())
        .await?;
        Ok(())
    }

    pub async fn poll_after(
        &self,
        last_sequence_id: i64,
        limit: i64,
        local_instance_id: &str,
    ) -> Result<Vec<LiveUpdateEnvelope>, sqlx::Error> {
        let rows = sqlx::query_as::<_, LiveUpdateRow>(
            r#"
            SELECT
                sequence_id,
                origin_instance_id,
                event_kind,
                event_target_id,
                event_revision,
                event_name,
                event_payload,
                created_at
            FROM live_update_events
            WHERE sequence_id > ?
              AND origin_instance_id <> ?
            ORDER BY sequence_id ASC
            LIMIT ?
            "#,
        )
        .bind(last_sequence_id.max(0))
        .bind(local_instance_id)
        .bind(limit.max(1))
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| LiveUpdateEnvelope {
                sequence_id: row.sequence_id,
                origin_instance_id: row.origin_instance_id,
                event: LiveUpdateEvent {
                    kind: row.event_kind,
                    id: row.event_target_id,
                    revision: row.event_revision,
                    event: row.event_name,
                },
            })
            .collect())
    }

    pub async fn latest_sequence_id(&self) -> Result<i64, sqlx::Error> {
        let value: Option<i64> =
            sqlx::query_scalar("SELECT MAX(sequence_id) FROM live_update_events")
                .fetch_one(&self.pool)
                .await?;
        Ok(value.unwrap_or(0))
    }

    pub async fn purge_older_than_hours(
        &self,
        retention_hours: i64,
        limit: i64,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            DELETE FROM live_update_events
            WHERE created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
            ORDER BY sequence_id ASC
            LIMIT ?
            "#,
        )
        .bind(retention_hours.max(1))
        .bind(limit.max(1))
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }
}

#[derive(sqlx::FromRow)]
struct LiveUpdateRow {
    sequence_id: i64,
    origin_instance_id: String,
    event_kind: String,
    event_target_id: String,
    event_revision: i64,
    event_name: String,
    #[allow(dead_code)]
    event_payload: Value,
    #[allow(dead_code)]
    created_at: DateTime<Utc>,
}
