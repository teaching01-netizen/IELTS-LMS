use sqlx::MySqlPool;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct WebsocketLeaseRepository {
    pool: MySqlPool,
}

#[derive(Clone, Debug)]
pub struct WebsocketLease {
    pub token: String,
}

impl WebsocketLeaseRepository {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn acquire(
        &self,
        instance_id: &str,
        user_id: &str,
        schedule_id: Option<&str>,
        global_cap: i64,
        user_cap: i64,
        schedule_cap: i64,
    ) -> Result<Option<WebsocketLease>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM websocket_connection_leases WHERE expires_at <= NOW()")
            .execute(&mut *tx)
            .await?;
        let active: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM websocket_connection_leases WHERE expires_at > NOW() FOR UPDATE",
        )
        .fetch_one(&mut *tx)
        .await?;
        if active >= global_cap {
            tx.rollback().await?;
            return Ok(None);
        }
        let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM websocket_connection_leases WHERE user_id=? AND expires_at > NOW() FOR UPDATE")
        .bind(user_id).fetch_one(&mut *tx).await?;
        if user_count >= user_cap {
            tx.rollback().await?;
            return Ok(None);
        }
        if let Some(schedule) = schedule_id {
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM websocket_connection_leases WHERE schedule_id=? AND expires_at > NOW() FOR UPDATE")
                .bind(schedule).fetch_one(&mut *tx).await?;
            if count >= schedule_cap {
                tx.rollback().await?;
                return Ok(None);
            }
        }
        let token = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO websocket_connection_leases (lease_token, instance_id, user_id, schedule_id, heartbeat_at, expires_at) VALUES (?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 60 SECOND))")
            .bind(&token).bind(instance_id).bind(user_id).bind(schedule_id).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(Some(WebsocketLease { token }))
    }

    pub async fn release(&self, token: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM websocket_connection_leases WHERE lease_token=?")
            .bind(token)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn heartbeat(&self, token: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE websocket_connection_leases SET heartbeat_at=NOW(), expires_at=DATE_ADD(NOW(), INTERVAL 60 SECOND) WHERE lease_token=?")
            .bind(token).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn cleanup_expired(&self) -> Result<u64, sqlx::Error> {
        Ok(
            sqlx::query("DELETE FROM websocket_connection_leases WHERE expires_at <= NOW()")
                .execute(&self.pool)
                .await?
                .rows_affected(),
        )
    }
}
