use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use sqlx::{Executor, MySql, MySqlConnection, MySqlPool};

#[derive(Debug, Clone)]
pub struct IdempotencyRecord {
    pub actor_id: String,
    pub route_key: String,
    pub idempotency_key: String,
    pub request_hash: String,
    pub response_status: i32,
    pub response_body: Value,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdempotencyLookupStatus {
    Replay,
    Created,
    Conflict,
}

#[derive(Clone)]
pub struct IdempotencyRepository {
    pool: MySqlPool,
    usable_hours: i64,
    submit_usable_hours: i64,
    violation_usable_hours: i64,
}

impl IdempotencyRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self::with_usable_hours(pool, 72)
    }

    pub fn with_usable_hours(pool: MySqlPool, usable_hours: i64) -> Self {
        Self {
            pool,
            usable_hours: usable_hours.max(1),
            submit_usable_hours: usable_hours.max(1),
            violation_usable_hours: usable_hours.max(1),
        }
    }

    pub fn with_ttl_policy(
        pool: MySqlPool,
        mutation_usable_hours: i64,
        submit_usable_hours: i64,
        violation_usable_hours: i64,
    ) -> Self {
        Self {
            pool,
            usable_hours: mutation_usable_hours.max(1),
            submit_usable_hours: submit_usable_hours.max(1),
            violation_usable_hours: violation_usable_hours.max(1),
        }
    }

    pub async fn lookup_with_executor<'e, E>(
        executor: E,
        actor_id: &str,
        route_key: &str,
        idempotency_key: &str,
    ) -> Result<Option<IdempotencyRecord>, sqlx::Error>
    where
        E: Executor<'e, Database = MySql>,
    {
        let row = sqlx::query_as::<_, IdempotencyRow>(
            r#"
            SELECT actor_id, route_key, idempotency_key, request_hash, response_status,
                   response_body, created_at, expires_at
            FROM idempotency_keys
            WHERE actor_id = ?
              AND route_key = ?
              AND idempotency_key = ?
              AND expires_at > NOW()
            "#,
        )
        .bind(actor_id)
        .bind(route_key)
        .bind(idempotency_key)
        .fetch_optional(executor)
        .await?;

        Ok(row.map(Into::into))
    }

    pub async fn lookup(
        &self,
        actor_id: &str,
        route_key: &str,
        idempotency_key: &str,
    ) -> Result<Option<IdempotencyRecord>, sqlx::Error> {
        Self::lookup_with_executor(&self.pool, actor_id, route_key, idempotency_key).await
    }

    pub async fn store_with_executor<'e, E>(
        &self,
        executor: E,
        actor_id: &str,
        route_key: &str,
        idempotency_key: &str,
        request_hash: &str,
        response_status: i32,
        response_body: &Value,
    ) -> Result<IdempotencyRecord, sqlx::Error>
    where
        E: Executor<'e, Database = MySql>,
    {
        let expires_at = self.default_expiry(route_key);
        sqlx::query(
            r#"
            INSERT INTO idempotency_keys (
                actor_id, route_key, idempotency_key, request_hash, response_status,
                response_body, created_at, expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)
            "#,
        )
        .bind(actor_id)
        .bind(route_key)
        .bind(idempotency_key)
        .bind(request_hash)
        .bind(response_status)
        .bind(response_body)
        .bind(expires_at)
        .execute(executor)
        .await?;

        // Return the record by reconstructing it from the input
        Ok(IdempotencyRecord {
            actor_id: actor_id.to_string(),
            route_key: route_key.to_string(),
            idempotency_key: idempotency_key.to_string(),
            request_hash: request_hash.to_string(),
            response_status,
            response_body: response_body.clone(),
            created_at: Utc::now(),
            expires_at,
        })
    }

    /// Serialize insert-or-replay on a concrete connection. Unlike a plain
    /// SELECT-before-INSERT, a concurrent insert of the same primary key is an
    /// expected race: the duplicate-key statement error is caught, the winning
    /// record is read back, and the fingerprint decides between Replay and
    /// Conflict. The caller's transaction stays usable (MySQL rolls back only
    /// the failed INSERT statement), and the caller still wins the authoritative
    /// serialization by holding its aggregate row lock before invoking this.
    pub async fn store_or_replay_with_connection(
        &self,
        connection: &mut MySqlConnection,
        actor_id: &str,
        route_key: &str,
        idempotency_key: &str,
        request_hash: &str,
        response_status: i32,
        response_body: Value,
    ) -> Result<(IdempotencyLookupStatus, IdempotencyRecord), sqlx::Error> {
        let insert_result = self
            .store_with_executor(
                &mut *connection,
                actor_id,
                route_key,
                idempotency_key,
                request_hash,
                response_status,
                &response_body,
            )
            .await;
        match insert_result {
            Ok(created) => Ok((IdempotencyLookupStatus::Created, created)),
            Err(error) => {
                let is_duplicate = error
                    .as_database_error()
                    .is_some_and(|database_error| database_error.is_unique_violation());
                if !is_duplicate {
                    return Err(error);
                }
                // A concurrent request inserted the same key between our read
                // and insert. Fetch the winning record and fingerprint-compare.
                let Some(existing) = Self::lookup_with_executor(
                    &mut *connection,
                    actor_id,
                    route_key,
                    idempotency_key,
                )
                .await?
                else {
                    // The winner was purged between our failed insert and this
                    // read; attempt the insert once more, then surface the raw
                    // error if a second writer wins the race again.
                    let created = self
                        .store_with_executor(
                            &mut *connection,
                            actor_id,
                            route_key,
                            idempotency_key,
                            request_hash,
                            response_status,
                            &response_body,
                        )
                        .await?;
                    return Ok((IdempotencyLookupStatus::Created, created));
                };
                if existing.request_hash == request_hash {
                    Ok((IdempotencyLookupStatus::Replay, existing))
                } else {
                    Ok((IdempotencyLookupStatus::Conflict, existing))
                }
            }
        }
    }

    pub async fn store_or_replay(
        &self,
        actor_id: &str,
        route_key: &str,
        idempotency_key: &str,
        request_hash: &str,
        response_status: i32,
        response_body: Value,
    ) -> Result<(IdempotencyLookupStatus, IdempotencyRecord), sqlx::Error> {
        if let Some(existing) =
            Self::lookup_with_executor(&self.pool, actor_id, route_key, idempotency_key).await?
        {
            if existing.request_hash == request_hash {
                return Ok((IdempotencyLookupStatus::Replay, existing));
            }

            return Ok((IdempotencyLookupStatus::Conflict, existing));
        }

        // Fast path: SELECT saw nothing, but a concurrent request may insert the
        // same primary key before our INSERT lands. Route through the
        // connection variant so the duplicate-key race becomes a deterministic
        // replay instead of a duplicate-key DATABASE_ERROR.
        let mut connection = self.pool.acquire().await?;
        self.store_or_replay_with_connection(
            &mut connection,
            actor_id,
            route_key,
            idempotency_key,
            request_hash,
            response_status,
            response_body,
        )
        .await
    }

    pub async fn purge_expired(&self, limit: i64) -> Result<u64, sqlx::Error> {
        self.purge_expired_with_grace_hours(limit, 24).await
    }

    pub async fn purge_expired_with_grace_hours(
        &self,
        limit: i64,
        grace_hours: i64,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            DELETE FROM idempotency_keys
            WHERE expires_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
            ORDER BY expires_at ASC
            LIMIT ?
            "#,
        )
        .bind(grace_hours.max(0))
        .bind(limit)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    pub fn default_expiry(&self, route_key: &str) -> DateTime<Utc> {
        let usable_hours = if route_key.contains("/submit") {
            self.submit_usable_hours
        } else if route_key.contains("violation") {
            self.violation_usable_hours
        } else {
            self.usable_hours
        };
        Utc::now() + Duration::hours(usable_hours)
    }
}

#[derive(sqlx::FromRow)]
struct IdempotencyRow {
    actor_id: String,
    route_key: String,
    idempotency_key: String,
    request_hash: String,
    response_status: i32,
    response_body: Value,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

impl From<IdempotencyRow> for IdempotencyRecord {
    fn from(value: IdempotencyRow) -> Self {
        Self {
            actor_id: value.actor_id,
            route_key: value.route_key,
            idempotency_key: value.idempotency_key,
            request_hash: value.request_hash,
            response_status: value.response_status,
            response_body: value.response_body,
            created_at: value.created_at,
            expires_at: value.expires_at,
        }
    }
}
