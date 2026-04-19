use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{MySql, MySqlPool, Transaction};
use uuid::{fmt::Hyphenated, Uuid};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OutboxEvent {
    pub id: Hyphenated,
    pub aggregate_kind: String,
    pub aggregate_id: String,
    pub revision: i64,
    pub event_family: String,
    pub payload: Value,
    pub created_at: DateTime<Utc>,
    pub claimed_at: Option<DateTime<Utc>>,
    pub published_at: Option<DateTime<Utc>>,
    pub publish_attempts: i32,
    pub last_error: Option<String>,
}

#[derive(Clone)]
pub struct OutboxRepository {
    pool: MySqlPool,
}

impl OutboxRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn enqueue(
        &self,
        aggregate_kind: &str,
        aggregate_id: &str,
        revision: i64,
        event_family: &str,
        payload: &Value,
    ) -> Result<OutboxEvent, sqlx::Error> {
        let id = Uuid::new_v4().hyphenated();
        sqlx::query(
            r#"
            INSERT INTO outbox_events (
                id, aggregate_kind, aggregate_id, revision, event_family, payload,
                created_at, publish_attempts
            )
            VALUES (?, ?, ?, ?, ?, ?, NOW(), 0)
            "#,
        )
        .bind(id)
        .bind(aggregate_kind)
        .bind(aggregate_id)
        .bind(revision)
        .bind(event_family)
        .bind(payload)
        .execute(&self.pool)
        .await?;

        self.fetch_one(id).await
    }

    pub async fn enqueue_in_tx(
        tx: &mut Transaction<'_, MySql>,
        aggregate_kind: &str,
        aggregate_id: &str,
        revision: i64,
        event_family: &str,
        payload: &Value,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO outbox_events (
                id, aggregate_kind, aggregate_id, revision, event_family, payload,
                created_at, publish_attempts
            )
            VALUES (?, ?, ?, ?, ?, ?, NOW(), 0)
            "#,
        )
        .bind(Uuid::new_v4().hyphenated())
        .bind(aggregate_kind)
        .bind(aggregate_id)
        .bind(revision)
        .bind(event_family)
        .bind(payload)
        .execute(&mut **tx)
        .await?;

        Ok(())
    }

    pub async fn claim_batch(&self, limit: i64) -> Result<Vec<OutboxEvent>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        // Note: FOR UPDATE SKIP LOCKED is PostgreSQL-specific
        // MySQL equivalent: FOR UPDATE with NOWAIT or handle locking differently
        let events = sqlx::query_as::<_, OutboxEvent>(
            r#"
            SELECT *
            FROM outbox_events
            WHERE published_at IS NULL
              AND claimed_at IS NULL
            ORDER BY created_at ASC
            LIMIT ?
            FOR UPDATE
            "#,
        )
        .bind(limit)
        .fetch_all(&mut *tx)
        .await?;

        if events.is_empty() {
            tx.commit().await?;
            return Ok(Vec::new());
        }

        let ids: Vec<Hyphenated> = events.iter().map(|event| event.id).collect();
        let id_strs: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
        sqlx::query(
            "UPDATE outbox_events SET claimed_at = NOW(), publish_attempts = publish_attempts + 1 WHERE id IN (SELECT * FROM (SELECT ? FROM (SELECT ?) AS temp) AS temp)",
        )
        .bind(id_strs.join(","))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        self.fetch_many(&ids).await
    }

    pub async fn mark_published(&self, ids: &[Hyphenated]) -> Result<u64, sqlx::Error> {
        if ids.is_empty() {
            return Ok(0);
        }

        let id_strs: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
        let result = sqlx::query(
            "UPDATE outbox_events SET published_at = NOW(), last_error = NULL WHERE id IN (?)",
        )
        .bind(id_strs.join(","))
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    pub async fn notify_published(
        &self,
        events: &[OutboxEvent],
        _channel: &str,
    ) -> Result<u64, sqlx::Error> {
        // Note: pg_notify is PostgreSQL-specific
        // Real-time notifications will be handled by application-level polling or Redis pub/sub
        if events.is_empty() {
            return Ok(0);
        }

        Ok(events.len() as u64)
    }

    pub async fn mark_failed(&self, id: Hyphenated, message: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE outbox_events SET claimed_at = NULL, last_error = ? WHERE id = ?")
            .bind(message)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn purge_published(&self, limit: i64) -> Result<u64, sqlx::Error> {
        // Note: ctid is PostgreSQL-specific
        // MySQL equivalent: Use subquery with LIMIT
        let result = sqlx::query(
            r#"
            DELETE FROM outbox_events
            WHERE id IN (
                SELECT id
                FROM outbox_events
                WHERE published_at < DATE_SUB(NOW(), INTERVAL 72 HOUR)
                ORDER BY published_at ASC
                LIMIT ?
            )
            "#,
        )
        .bind(limit)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    async fn fetch_many(&self, ids: &[Hyphenated]) -> Result<Vec<OutboxEvent>, sqlx::Error> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let id_strs: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
        sqlx::query_as::<_, OutboxEvent>(
            "SELECT * FROM outbox_events WHERE id IN (?) ORDER BY created_at ASC",
        )
        .bind(id_strs.join(","))
        .fetch_all(&self.pool)
        .await
    }

    async fn fetch_one(&self, id: Hyphenated) -> Result<OutboxEvent, sqlx::Error> {
        sqlx::query_as::<_, OutboxEvent>(
            "SELECT * FROM outbox_events WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
    }
}
