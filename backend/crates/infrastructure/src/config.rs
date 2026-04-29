use std::env;

use crate::database_monitor::StorageBudgetThresholds;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppConfig {
    pub api_host: String,
    pub api_port: u16,
    pub live_mode_enabled: bool,
    pub database_url: Option<String>,
    pub database_direct_url: Option<String>,
    pub db_pool_max_connections: u32,
    pub db_pool_acquire_timeout_ms: u64,
    pub worker_poll_interval_ms: u64,
    pub worker_fallback_interval_secs: u64,
    pub prometheus_enabled: bool,
    pub otel_exporter_otlp_endpoint: Option<String>,
    pub worker_outbox_notify_channel: String,
    pub live_mode_notify_channel: String,
    pub storage_budget_thresholds: StorageBudgetThresholds,
    pub frontend_dist_dir: String,
    pub auth_session_cookie_name: String,
    pub auth_csrf_cookie_name: String,
    pub auth_cookie_secure: bool,
    pub auth_secret: String,
    pub session_absolute_lifetime_hours: i64,
    pub session_idle_timeout_staff_minutes: i64,
    pub session_idle_timeout_student_minutes: i64,
    pub attempt_token_ttl_minutes: i64,
    pub websocket_connection_cap: usize,
    pub websocket_connections_per_user_cap: usize,
    pub websocket_connections_per_schedule_cap: usize,
    pub websocket_outbound_queue_cap: usize,
    pub websocket_slow_client_disconnect_ms: u64,
    pub websocket_write_timeout_ms: u64,
    pub runtime_auto_advance_enabled: bool,
    pub runtime_auto_advance_tick_ms: u64,
    // Rate limiting configurations
    pub rate_limit_login_per_ip: u32,
    pub rate_limit_login_per_ip_window_secs: u64,
    pub rate_limit_login_per_account: u32,
    pub rate_limit_login_per_account_window_secs: u64,
    pub rate_limit_password_reset_per_ip: u32,
    pub rate_limit_password_reset_per_ip_window_secs: u64,
    pub rate_limit_student_entry_per_ip: u32,
    pub rate_limit_student_entry_per_ip_window_secs: u64,
    pub rate_limit_student_entry_per_schedule: u32,
    pub rate_limit_student_entry_per_schedule_window_secs: u64,
    pub rate_limit_student_bootstrap_per_user: u32,
    pub rate_limit_student_bootstrap_per_user_window_secs: u64,
    pub rate_limit_mutation_per_attempt: u32,
    pub rate_limit_mutation_per_attempt_window_secs: u64,
    pub rate_limit_heartbeat_per_attempt: u32,
    pub rate_limit_heartbeat_per_attempt_window_secs: u64,
    pub rate_limit_audit_per_attempt: u32,
    pub rate_limit_audit_per_attempt_window_secs: u64,
    pub rate_limit_submit_per_attempt: u32,
    pub rate_limit_submit_per_attempt_window_secs: u64,
    pub rate_limit_export_per_user: u32,
    pub rate_limit_export_per_user_window_secs: u64,
    pub rate_limiter_bucket_cap: usize,
    // Retention and cleanup policies
    pub retention_cleanup_batch_limit: i64,
    pub retention_shared_cache_grace_hours: i64,
    pub retention_idempotency_usable_hours: i64,
    pub retention_idempotency_grace_hours: i64,
    pub retention_heartbeat_days: i64,
    pub retention_mutation_days: i64,
    pub retention_user_session_days: i64,
    // Delivery request guardrails
    pub max_mutations_per_batch: usize,
    pub max_writing_answer_chars: usize,
    pub max_text_answer_chars: usize,
    // Master key credentials
    pub master_key_enabled: bool,
    pub master_key_username: String,
    pub master_key_password: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let default = Self::default();
        let global_rate_limit = env::var("RATE_LIMIT_GLOBAL")
            .ok()
            .and_then(|value| value.parse::<u32>().ok());

        Self {
            api_host: env::var("API_HOST").unwrap_or(default.api_host),
            api_port: resolve_api_port(
                env::var("API_PORT").ok().as_deref(),
                env::var("PORT").ok().as_deref(),
                default.api_port,
            ),
            live_mode_enabled: env::var("LIVE_MODE_ENABLED")
                .ok()
                .and_then(|value| parse_bool(&value))
                .unwrap_or(default.live_mode_enabled),
            database_url: env::var("DATABASE_URL").ok(),
            database_direct_url: env::var("DATABASE_DIRECT_URL")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            db_pool_max_connections: env::var("DB_POOL_MAX_CONNECTIONS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.db_pool_max_connections),
            db_pool_acquire_timeout_ms: env::var("DB_POOL_ACQUIRE_TIMEOUT_MS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.db_pool_acquire_timeout_ms),
            worker_poll_interval_ms: env::var("WORKER_POLL_INTERVAL_MS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.worker_poll_interval_ms),
            worker_fallback_interval_secs: env::var("WORKER_FALLBACK_INTERVAL_SECS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.worker_fallback_interval_secs),
            prometheus_enabled: env::var("PROMETHEUS_ENABLED")
                .ok()
                .and_then(|value| parse_bool(&value))
                .unwrap_or(default.prometheus_enabled),
            otel_exporter_otlp_endpoint: env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            worker_outbox_notify_channel: env::var("WORKER_OUTBOX_NOTIFY_CHANNEL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(default.worker_outbox_notify_channel),
            live_mode_notify_channel: env::var("LIVE_MODE_NOTIFY_CHANNEL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(default.live_mode_notify_channel),
            storage_budget_thresholds: StorageBudgetThresholds {
                warning_bytes: env::var("STORAGE_WARNING_BYTES")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(default.storage_budget_thresholds.warning_bytes),
                high_water_bytes: env::var("STORAGE_HIGH_WATER_BYTES")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(default.storage_budget_thresholds.high_water_bytes),
                critical_bytes: env::var("STORAGE_CRITICAL_BYTES")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(default.storage_budget_thresholds.critical_bytes),
            },
            frontend_dist_dir: env::var("FRONTEND_DIST_DIR")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(default.frontend_dist_dir),
            auth_session_cookie_name: env::var("AUTH_SESSION_COOKIE_NAME")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(default.auth_session_cookie_name),
            auth_csrf_cookie_name: env::var("AUTH_CSRF_COOKIE_NAME")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(default.auth_csrf_cookie_name),
            auth_cookie_secure: env::var("AUTH_COOKIE_SECURE")
                .ok()
                .and_then(|value| parse_bool(&value))
                .unwrap_or(default.auth_cookie_secure),
            auth_secret: env::var("AUTH_SECRET")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(default.auth_secret),
            session_absolute_lifetime_hours: env::var("SESSION_ABSOLUTE_LIFETIME_HOURS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.session_absolute_lifetime_hours),
            session_idle_timeout_staff_minutes: env::var("SESSION_IDLE_TIMEOUT_STAFF_MINUTES")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.session_idle_timeout_staff_minutes),
            session_idle_timeout_student_minutes: env::var("SESSION_IDLE_TIMEOUT_STUDENT_MINUTES")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.session_idle_timeout_student_minutes),
            attempt_token_ttl_minutes: env::var("ATTEMPT_TOKEN_TTL_MINUTES")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.attempt_token_ttl_minutes),
            websocket_connection_cap: env::var("WEBSOCKET_CONNECTION_CAP")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.websocket_connection_cap),
            websocket_connections_per_user_cap: env::var("WEBSOCKET_CONNECTIONS_PER_USER_CAP")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.websocket_connections_per_user_cap),
            websocket_connections_per_schedule_cap: env::var(
                "WEBSOCKET_CONNECTIONS_PER_SCHEDULE_CAP",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default.websocket_connections_per_schedule_cap),
            websocket_outbound_queue_cap: env::var("WEBSOCKET_OUTBOUND_QUEUE_CAP")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.websocket_outbound_queue_cap),
            websocket_slow_client_disconnect_ms: env::var("WEBSOCKET_SLOW_CLIENT_DISCONNECT_MS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.websocket_slow_client_disconnect_ms),
            websocket_write_timeout_ms: env::var("WEBSOCKET_WRITE_TIMEOUT_MS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.websocket_write_timeout_ms),
            runtime_auto_advance_enabled: env::var("RUNTIME_AUTO_ADVANCE_ENABLED")
                .ok()
                .and_then(|value| parse_bool(&value))
                .unwrap_or(default.runtime_auto_advance_enabled),
            runtime_auto_advance_tick_ms: env::var("RUNTIME_AUTO_ADVANCE_TICK_MS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.runtime_auto_advance_tick_ms),
            // Rate limiting env vars
            rate_limit_login_per_ip: resolve_rate_limit_count(
                env::var("RATE_LIMIT_LOGIN_PER_IP").ok().as_deref(),
                global_rate_limit,
                default.rate_limit_login_per_ip,
            ),
            rate_limit_login_per_ip_window_secs: env::var("RATE_LIMIT_LOGIN_PER_IP_WINDOW_SECS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.rate_limit_login_per_ip_window_secs),
            rate_limit_login_per_account: resolve_rate_limit_count(
                env::var("RATE_LIMIT_LOGIN_PER_ACCOUNT").ok().as_deref(),
                global_rate_limit,
                default.rate_limit_login_per_account,
            ),
            rate_limit_login_per_account_window_secs: env::var(
                "RATE_LIMIT_LOGIN_PER_ACCOUNT_WINDOW_SECS",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default.rate_limit_login_per_account_window_secs),
            rate_limit_password_reset_per_ip: resolve_rate_limit_count(
                env::var("RATE_LIMIT_PASSWORD_RESET_PER_IP").ok().as_deref(),
                global_rate_limit,
                default.rate_limit_password_reset_per_ip,
            ),
            rate_limit_password_reset_per_ip_window_secs: env::var(
                "RATE_LIMIT_PASSWORD_RESET_PER_IP_WINDOW_SECS",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default.rate_limit_password_reset_per_ip_window_secs),
            rate_limit_student_entry_per_ip: resolve_rate_limit_count(
                env::var("RATE_LIMIT_STUDENT_ENTRY_PER_IP").ok().as_deref(),
                global_rate_limit,
                default.rate_limit_student_entry_per_ip,
            ),
            rate_limit_student_entry_per_ip_window_secs: env::var(
                "RATE_LIMIT_STUDENT_ENTRY_PER_IP_WINDOW_SECS",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default.rate_limit_student_entry_per_ip_window_secs),
            rate_limit_student_entry_per_schedule: resolve_rate_limit_count(
                env::var("RATE_LIMIT_STUDENT_ENTRY_PER_SCHEDULE")
                    .ok()
                    .as_deref(),
                global_rate_limit,
                default.rate_limit_student_entry_per_schedule,
            ),
            rate_limit_student_entry_per_schedule_window_secs: env::var(
                "RATE_LIMIT_STUDENT_ENTRY_PER_SCHEDULE_WINDOW_SECS",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default.rate_limit_student_entry_per_schedule_window_secs),
            rate_limit_student_bootstrap_per_user: resolve_rate_limit_count(
                env::var("RATE_LIMIT_STUDENT_BOOTSTRAP_PER_USER")
                    .ok()
                    .as_deref(),
                global_rate_limit,
                default.rate_limit_student_bootstrap_per_user,
            ),
            rate_limit_student_bootstrap_per_user_window_secs: env::var(
                "RATE_LIMIT_STUDENT_BOOTSTRAP_PER_USER_WINDOW_SECS",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default.rate_limit_student_bootstrap_per_user_window_secs),
            rate_limit_mutation_per_attempt: resolve_rate_limit_count(
                env::var("RATE_LIMIT_MUTATION_PER_ATTEMPT").ok().as_deref(),
                global_rate_limit,
                default.rate_limit_mutation_per_attempt,
            ),
            rate_limit_mutation_per_attempt_window_secs: env::var(
                "RATE_LIMIT_MUTATION_PER_ATTEMPT_WINDOW_SECS",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default.rate_limit_mutation_per_attempt_window_secs),
            rate_limit_heartbeat_per_attempt: resolve_rate_limit_count(
                env::var("RATE_LIMIT_HEARTBEAT_PER_ATTEMPT").ok().as_deref(),
                global_rate_limit,
                default.rate_limit_heartbeat_per_attempt,
            ),
            rate_limit_heartbeat_per_attempt_window_secs: env::var(
                "RATE_LIMIT_HEARTBEAT_PER_ATTEMPT_WINDOW_SECS",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default.rate_limit_heartbeat_per_attempt_window_secs),
            rate_limit_audit_per_attempt: resolve_rate_limit_count(
                env::var("RATE_LIMIT_AUDIT_PER_ATTEMPT").ok().as_deref(),
                global_rate_limit,
                default.rate_limit_audit_per_attempt,
            ),
            rate_limit_audit_per_attempt_window_secs: env::var(
                "RATE_LIMIT_AUDIT_PER_ATTEMPT_WINDOW_SECS",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default.rate_limit_audit_per_attempt_window_secs),
            rate_limit_submit_per_attempt: resolve_rate_limit_count(
                env::var("RATE_LIMIT_SUBMIT_PER_ATTEMPT").ok().as_deref(),
                global_rate_limit,
                default.rate_limit_submit_per_attempt,
            ),
            rate_limit_submit_per_attempt_window_secs: env::var(
                "RATE_LIMIT_SUBMIT_PER_ATTEMPT_WINDOW_SECS",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default.rate_limit_submit_per_attempt_window_secs),
            rate_limit_export_per_user: resolve_rate_limit_count(
                env::var("RATE_LIMIT_EXPORT_PER_USER").ok().as_deref(),
                global_rate_limit,
                default.rate_limit_export_per_user,
            ),
            rate_limit_export_per_user_window_secs: env::var(
                "RATE_LIMIT_EXPORT_PER_USER_WINDOW_SECS",
            )
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(default.rate_limit_export_per_user_window_secs),
            rate_limiter_bucket_cap: env::var("RATE_LIMITER_BUCKET_CAP")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.rate_limiter_bucket_cap),
            retention_cleanup_batch_limit: env::var("RETENTION_CLEANUP_BATCH_LIMIT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.retention_cleanup_batch_limit),
            retention_shared_cache_grace_hours: env::var("RETENTION_SHARED_CACHE_GRACE_HOURS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.retention_shared_cache_grace_hours),
            retention_idempotency_usable_hours: env::var("RETENTION_IDEMPOTENCY_USABLE_HOURS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.retention_idempotency_usable_hours),
            retention_idempotency_grace_hours: env::var("RETENTION_IDEMPOTENCY_GRACE_HOURS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.retention_idempotency_grace_hours),
            retention_heartbeat_days: env::var("RETENTION_HEARTBEAT_DAYS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.retention_heartbeat_days),
            retention_mutation_days: env::var("RETENTION_MUTATION_DAYS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.retention_mutation_days),
            retention_user_session_days: env::var("RETENTION_USER_SESSION_DAYS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.retention_user_session_days),
            max_mutations_per_batch: env::var("MAX_MUTATIONS_PER_BATCH")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.max_mutations_per_batch),
            max_writing_answer_chars: env::var("MAX_WRITING_ANSWER_CHARS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.max_writing_answer_chars),
            max_text_answer_chars: env::var("MAX_TEXT_ANSWER_CHARS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(default.max_text_answer_chars),
            master_key_enabled: env::var("MASTER_KEY_ENABLED")
                .ok()
                .and_then(|value| parse_bool(&value))
                .unwrap_or(default.master_key_enabled),
            master_key_username: env::var("MASTER_KEY_USERNAME")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(default.master_key_username),
            master_key_password: env::var("MASTER_KEY_PASSWORD")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(default.master_key_password),
        }
        .with_resource_profile_from_env()
    }

    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.api_host, self.api_port)
    }

    /// Tune defaults for a single tiny instance.
    ///
    /// This keeps the same backend behavior while reducing memory, CPU, and disk pressure for
    /// deployments around 1 CPU, 1 GiB RAM, and 5 GiB disk.
    pub fn apply_low_resource_profile(&mut self) {
        self.db_pool_max_connections = self.db_pool_max_connections.min(3);
        self.worker_fallback_interval_secs = self.worker_fallback_interval_secs.max(60);
        self.websocket_connection_cap = self.websocket_connection_cap.min(100);
        self.websocket_connections_per_schedule_cap =
            self.websocket_connections_per_schedule_cap.min(100);
        self.rate_limiter_bucket_cap = self.rate_limiter_bucket_cap.min(1_000);
        self.retention_cleanup_batch_limit = self.retention_cleanup_batch_limit.min(200);
        self.retention_shared_cache_grace_hours = self.retention_shared_cache_grace_hours.min(1);
        self.retention_idempotency_usable_hours = self.retention_idempotency_usable_hours.min(24);
        self.retention_idempotency_grace_hours = self.retention_idempotency_grace_hours.min(6);
        self.retention_heartbeat_days = self.retention_heartbeat_days.min(1);
        self.retention_mutation_days = self.retention_mutation_days.min(7);
        self.retention_user_session_days = self.retention_user_session_days.min(7);
    }

    fn with_resource_profile_from_env(mut self) -> Self {
        if env::var("RESOURCE_PROFILE")
            .ok()
            .map(|value| value.trim().eq_ignore_ascii_case("low"))
            .unwrap_or(false)
        {
            self.apply_low_resource_profile();
        }

        self
    }
}

fn resolve_api_port(api_port: Option<&str>, port: Option<&str>, default_port: u16) -> u16 {
    api_port
        .and_then(|value| value.parse().ok())
        .or_else(|| port.and_then(|value| value.parse().ok()))
        .unwrap_or(default_port)
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            api_host: "0.0.0.0".to_owned(),
            api_port: 4000,
            live_mode_enabled: true,
            database_url: None,
            database_direct_url: None,
            db_pool_max_connections: 20,
            db_pool_acquire_timeout_ms: 3000,
            worker_poll_interval_ms: 1000,
            worker_fallback_interval_secs: 10,
            prometheus_enabled: true,
            otel_exporter_otlp_endpoint: None,
            worker_outbox_notify_channel: "backend_outbox_wakeup".to_owned(),
            live_mode_notify_channel: "backend_live_wakeup".to_owned(),
            storage_budget_thresholds: StorageBudgetThresholds::default(),
            frontend_dist_dir: "/app/frontend/dist".to_owned(),
            auth_session_cookie_name: "__Host-session".to_owned(),
            auth_csrf_cookie_name: "__Host-csrf".to_owned(),
            auth_cookie_secure: true,
            auth_secret: "dev-auth-secret-change-me".to_owned(),
            session_absolute_lifetime_hours: 12,
            session_idle_timeout_staff_minutes: 30,
            session_idle_timeout_student_minutes: 60,
            attempt_token_ttl_minutes: 15,
            websocket_connection_cap: 600,
            websocket_connections_per_user_cap: 5,
            websocket_connections_per_schedule_cap: 600,
            websocket_outbound_queue_cap: 16,
            websocket_slow_client_disconnect_ms: 200,
            websocket_write_timeout_ms: 200,
            runtime_auto_advance_enabled: true,
            runtime_auto_advance_tick_ms: 250,
            // Rate limiting defaults based on spec recommendations
            rate_limit_login_per_ip: 10,
            rate_limit_login_per_ip_window_secs: 60,
            rate_limit_login_per_account: 5,
            rate_limit_login_per_account_window_secs: 60,
            rate_limit_password_reset_per_ip: 3,
            rate_limit_password_reset_per_ip_window_secs: 300,
            rate_limit_student_entry_per_ip: 30,
            rate_limit_student_entry_per_ip_window_secs: 60,
            rate_limit_student_entry_per_schedule: 600,
            rate_limit_student_entry_per_schedule_window_secs: 600,
            rate_limit_student_bootstrap_per_user: 5,
            rate_limit_student_bootstrap_per_user_window_secs: 60,
            rate_limit_mutation_per_attempt: 100,
            rate_limit_mutation_per_attempt_window_secs: 60,
            rate_limit_heartbeat_per_attempt: 300,
            rate_limit_heartbeat_per_attempt_window_secs: 60,
            rate_limit_audit_per_attempt: 300,
            rate_limit_audit_per_attempt_window_secs: 60,
            rate_limit_submit_per_attempt: 5,
            rate_limit_submit_per_attempt_window_secs: 300,
            rate_limit_export_per_user: 3,
            rate_limit_export_per_user_window_secs: 300,
            rate_limiter_bucket_cap: 10_000,
            retention_cleanup_batch_limit: 1000,
            retention_shared_cache_grace_hours: 24,
            retention_idempotency_usable_hours: 72,
            retention_idempotency_grace_hours: 24,
            retention_heartbeat_days: 7,
            retention_mutation_days: 30,
            retention_user_session_days: 30,
            max_mutations_per_batch: 200,
            max_writing_answer_chars: 50_000,
            max_text_answer_chars: 512,
            master_key_enabled: false,
            master_key_username: "master".to_owned(),
            master_key_password: "".to_owned(),
        }
    }
}

fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn resolve_rate_limit_count(specific: Option<&str>, global: Option<u32>, default: u32) -> u32 {
    specific
        .and_then(|value| value.parse::<u32>().ok())
        .or(global)
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::{resolve_api_port, resolve_rate_limit_count, AppConfig};

    #[test]
    fn default_frontend_dist_dir_points_at_the_runtime_image_path() {
        assert_eq!(AppConfig::default().frontend_dist_dir, "/app/frontend/dist");
    }

    #[test]
    fn default_websocket_caps_support_six_hundred_student_exams() {
        let config = AppConfig::default();

        assert_eq!(config.websocket_connection_cap, 600);
        assert_eq!(config.websocket_connections_per_schedule_cap, 600);
        assert_eq!(config.websocket_connections_per_user_cap, 5);
    }

    #[test]
    fn default_cache_retention_windows_match_current_policy() {
        let config = AppConfig::default();

        assert_eq!(config.retention_cleanup_batch_limit, 1000);
        assert_eq!(config.retention_shared_cache_grace_hours, 24);
        assert_eq!(config.retention_idempotency_usable_hours, 72);
        assert_eq!(config.retention_idempotency_grace_hours, 24);
        assert_eq!(config.retention_heartbeat_days, 7);
        assert_eq!(config.retention_mutation_days, 30);
        assert_eq!(config.retention_user_session_days, 30);
        assert_eq!(config.rate_limiter_bucket_cap, 10_000);
    }

    #[test]
    fn low_resource_profile_reduces_backend_pressure() {
        let mut config = AppConfig::default();
        config.apply_low_resource_profile();

        assert_eq!(config.db_pool_max_connections, 3);
        assert_eq!(config.worker_fallback_interval_secs, 60);
        assert_eq!(config.websocket_connection_cap, 100);
        assert_eq!(config.websocket_connections_per_schedule_cap, 100);
        assert_eq!(config.rate_limiter_bucket_cap, 1_000);
        assert_eq!(config.retention_cleanup_batch_limit, 200);
        assert_eq!(config.retention_shared_cache_grace_hours, 1);
        assert_eq!(config.retention_idempotency_usable_hours, 24);
        assert_eq!(config.retention_idempotency_grace_hours, 6);
        assert_eq!(config.retention_heartbeat_days, 1);
        assert_eq!(config.retention_mutation_days, 7);
        assert_eq!(config.retention_user_session_days, 7);
    }

    #[test]
    fn api_port_prefers_api_port_env() {
        assert_eq!(resolve_api_port(Some("4100"), Some("4200"), 4000), 4100);
    }

    #[test]
    fn api_port_falls_back_to_port_env() {
        assert_eq!(resolve_api_port(None, Some("4300"), 4000), 4300);
    }

    #[test]
    fn global_rate_limit_applies_when_specific_limit_is_missing() {
        assert_eq!(resolve_rate_limit_count(None, Some(500), 30), 500);
    }

    #[test]
    fn specific_rate_limit_wins_over_global_limit() {
        assert_eq!(resolve_rate_limit_count(Some("25"), Some(500), 30), 25);
    }
}
