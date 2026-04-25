use std::time::Duration;

use ielts_backend_infrastructure::{
    config::AppConfig, pool::DatabasePool, rate_limit::{RateLimitConfig, RateLimiter}, telemetry::Telemetry,
};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;

use crate::live_updates::LiveUpdateHub;

#[derive(Clone, Debug)]
pub struct AppState {
    pub config: AppConfig,
    pub pool: DatabasePool,
    pub live_mode_enabled: bool,
    pub live_updates: LiveUpdateHub,
    pub telemetry: Telemetry,
    pub rate_limiter: RateLimiter,
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
        }
    }

    pub fn with_pool(config: AppConfig, pool: MySqlPool) -> Self {
        let live_mode_enabled = config.live_mode_enabled;
        let rate_limiter = RateLimiter::with_bucket_cap(
            RateLimitConfig::new(1000, 60),
            config.rate_limiter_bucket_cap,
        ); // Default permissive limit

        Self {
            live_updates: LiveUpdateHub::with_config(&config),
            config,
            pool: DatabasePool::new(pool),
            live_mode_enabled,
            telemetry: Telemetry::new(),
            rate_limiter,
        }
    }

    pub async fn from_config(config: AppConfig) -> Result<Self, sqlx::Error> {
        match config.database_url.as_ref() {
            Some(database_url) => {
                let pool = MySqlPoolOptions::new()
                    .max_connections(config.db_pool_max_connections)
                    .acquire_timeout(Duration::from_millis(config.db_pool_acquire_timeout_ms))
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
}
