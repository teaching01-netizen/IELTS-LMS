use chrono::{Duration, Utc};
use ielts_backend_domain::schedule::DegradedLiveState;
use sqlx::MySqlPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct LiveModeService {
    pool: MySqlPool,
}

impl LiveModeService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn snapshot(
        &self,
        live_mode_enabled: bool,
        schedule_id: Option<Uuid>,
    ) -> Result<DegradedLiveState, sqlx::Error> {
        if !live_mode_enabled {
            return Ok(DegradedLiveState {
                degraded: false,
                reason: Some("live-mode-disabled".to_owned()),
            });
        }

        let threshold = Utc::now() - Duration::seconds(15);
        let count: i64 = if let Some(schedule_id) = schedule_id {
            sqlx::query_scalar(
                r#"
                SELECT COUNT(*)
                FROM outbox_events
                WHERE aggregate_kind = 'schedule_runtime'
                  AND aggregate_id = ?
                  AND published_at IS NULL
                  AND created_at < ?
                "#,
            )
            .bind(schedule_id.to_string())
            .bind(threshold)
            .fetch_one(&self.pool)
            .await?
        } else {
            sqlx::query_scalar(
                "SELECT COUNT(*) FROM outbox_events WHERE published_at IS NULL AND created_at < ?",
            )
            .bind(threshold)
            .fetch_one(&self.pool)
            .await?
        };

        if count > 0 {
            Ok(DegradedLiveState {
                degraded: true,
                reason: Some("outbox-backlog".to_owned()),
            })
        } else {
            Ok(DegradedLiveState {
                degraded: false,
                reason: None,
            })
        }
    }
}
