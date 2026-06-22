use std::time::Duration;

use ielts_backend_infrastructure::{
    config::AppConfig,
    distributed_rate_limit::DistributedRateLimiter,
    live_update_bus::LiveUpdateBusRepository,
    pool::DatabasePool,
    rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult, RateLimiter},
    telemetry::Telemetry,
};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use uuid::Uuid;

use crate::{background::BackgroundRuntimeHandle, live_updates::LiveUpdateHub};

#[derive(Clone, Debug)]
pub struct AppState {
    pub config: AppConfig,
    pub pool: DatabasePool,
    pub live_mode_enabled: bool,
    pub live_updates: LiveUpdateHub,
    pub telemetry: Telemetry,
    pub rate_limiter: RateLimiter,
    pub distributed_rate_limiter: Option<DistributedRateLimiter>,
    pub live_update_bus: Option<LiveUpdateBusRepository>,
    pub instance_id: String,
    pub background_runtime: Option<BackgroundRuntimeHandle>,
}

impl AppState {
    pub fn new(config: AppConfig) -> Self {
        let live_mode_enabled = config.live_mode_enabled;
        let rate_limiter = RateLimiter::with_bucket_cap(
            RateLimitConfig::new(1000, 60),
            config.rate_limiter_bucket_cap,
        ); // Default permissive limit

        Self {
            live_updates: LiveUpdateHub::with_config(&config),
            config,
            pool: DatabasePool::placeholder(),
            live_mode_enabled,
            telemetry: Telemetry::new(),
            rate_limiter,
            distributed_rate_limiter: None,
            live_update_bus: None,
            instance_id: format!("api-{}", Uuid::new_v4()),
            background_runtime: None,
        }
    }

    pub fn with_pool(config: AppConfig, pool: MySqlPool) -> Self {
        let live_mode_enabled = config.live_mode_enabled;
        let pool_for_state = pool.clone();
        let pool_for_distributed_limiter = pool.clone();
        let rate_limiter = RateLimiter::with_bucket_cap(
            RateLimitConfig::new(1000, 60),
            config.rate_limiter_bucket_cap,
        ); // Default permissive limit

        Self {
            live_updates: LiveUpdateHub::with_config(&config),
            config,
            pool: DatabasePool::new(pool_for_state),
            live_mode_enabled,
            telemetry: Telemetry::new(),
            rate_limiter,
            distributed_rate_limiter: Some(DistributedRateLimiter::new(
                pool_for_distributed_limiter,
            )),
            live_update_bus: Some(LiveUpdateBusRepository::new(pool)),
            instance_id: format!("api-{}", Uuid::new_v4()),
            background_runtime: None,
        }
    }

    pub fn with_background_runtime(mut self, handle: BackgroundRuntimeHandle) -> Self {
        self.background_runtime = Some(handle);
        self
    }

    pub async fn from_config(config: AppConfig) -> Result<Self, sqlx::Error> {
        match config.database_url.as_ref() {
            Some(database_url) => {
                let pool = MySqlPoolOptions::new()
                    .max_connections(config.db_pool_max_connections)
                    .acquire_timeout(Duration::from_millis(config.db_pool_acquire_timeout_ms))
                    .idle_timeout(Some(Duration::from_secs(config.db_pool_idle_timeout_secs)))
                    .connect(database_url)
                    .await?;

                Ok(Self::with_pool(config, pool))
            }
            None => Ok(Self::new(config)),
        }
    }

    pub fn db_pool(&self) -> MySqlPool {
        self.pool
            .inner()
            .expect("Database pool not initialized")
            .clone()
    }

    pub fn db_pool_opt(&self) -> Option<MySqlPool> {
        self.pool.inner().cloned()
    }

    pub async fn check_exam_rate_limit(
        &self,
        route_key: &str,
        key: &RateLimitKey,
        config: &RateLimitConfig,
    ) -> RateLimitResult {
        if let Some(distributed) = &self.distributed_rate_limiter {
            match distributed.check_with_config(route_key, key, config).await {
                Ok(result) => return result,
                Err(error) => {
                    tracing::warn!(
                        error = %error,
                        route_key = route_key,
                        "distributed rate limit failed; falling back to local limiter"
                    );
                }
            }
        }

        self.rate_limiter.check_with_config(key, config).await
    }

    pub fn publish_live_update(&self, event: ielts_backend_domain::schedule::LiveUpdateEvent) {
        self.live_updates.publish(event.clone());
        let Some(bus) = self.live_update_bus.clone() else {
            return;
        };

        let instance_id = self.instance_id.clone();
        tokio::spawn(async move {
            if let Err(error) = bus.enqueue(&instance_id, &event).await {
                tracing::warn!(error = %error, "failed to enqueue live update event");
            }
        });
    }
}
