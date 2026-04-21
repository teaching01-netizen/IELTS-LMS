use std::{sync::Arc, time::Duration};

use ielts_backend_infrastructure::{
    config::AppConfig, pool::DatabasePool, rate_limit::{RateLimitConfig, RateLimiter}, telemetry::Telemetry,
};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use tokio::sync::Semaphore;

use crate::live_updates::LiveUpdateHub;

#[derive(Clone, Debug)]
pub struct BusyGates {
    pub student_entry: Arc<Semaphore>,
    pub student_session_summary: Arc<Semaphore>,
    pub student_session_version: Arc<Semaphore>,
    pub student_bootstrap: Arc<Semaphore>,
    pub retry_after_secs: u64,
}

impl BusyGates {
    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            student_entry: Arc::new(Semaphore::new(config.student_entry_max_concurrent)),
            student_session_summary: Arc::new(Semaphore::new(config.student_session_summary_max_concurrent)),
            student_session_version: Arc::new(Semaphore::new(config.student_session_version_max_concurrent)),
            student_bootstrap: Arc::new(Semaphore::new(config.student_bootstrap_max_concurrent)),
            retry_after_secs: config.server_busy_retry_after_secs,
        }
    }
}

#[derive(Clone, Debug)]
pub struct AppState {
    pub config: AppConfig,
    pub pool: DatabasePool,
    pub live_mode_enabled: bool,
    pub live_updates: LiveUpdateHub,
    pub telemetry: Telemetry,
    pub rate_limiter: RateLimiter,
    pub busy_gates: BusyGates,
}

impl AppState {
    pub fn new(config: AppConfig) -> Self {
        let live_mode_enabled = config.live_mode_enabled;
        let rate_limiter = RateLimiter::new(RateLimitConfig::new(1000, 60)); // Default permissive limit
        let busy_gates = BusyGates::from_config(&config);

        Self {
            config,
            pool: DatabasePool::placeholder(),
            live_mode_enabled,
            live_updates: LiveUpdateHub::new(),
            telemetry: Telemetry::new(),
            rate_limiter,
            busy_gates,
        }
    }

    pub fn with_pool(config: AppConfig, pool: MySqlPool) -> Self {
        let live_mode_enabled = config.live_mode_enabled;
        let rate_limiter = RateLimiter::new(RateLimitConfig::new(1000, 60)); // Default permissive limit
        let busy_gates = BusyGates::from_config(&config);

        Self {
            config,
            pool: DatabasePool::new(pool),
            live_mode_enabled,
            live_updates: LiveUpdateHub::new(),
            telemetry: Telemetry::new(),
            rate_limiter,
            busy_gates,
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
