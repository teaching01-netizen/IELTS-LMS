use axum::{
    extract::{Extension, State},
    http::{header::CONTENT_TYPE, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    http::{
        request_id::RequestId,
        response::{self, SuccessResponse},
    },
    state::AppState,
};
use ielts_backend_infrastructure::database_monitor::{
    inspect_grading_projection_snapshot, inspect_outbox_backlog, inspect_storage_budget,
    ping_database,
};
use ielts_backend_infrastructure::telemetry::ProcessMemoryProfile;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HealthData {
    status: &'static str,
    live_mode_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessData {
    status: &'static str,
    database: &'static str,
    live_mode_enabled: bool,
}

pub async fn healthz(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
) -> Json<SuccessResponse<HealthData>> {
    response::json(
        HealthData {
            status: "ok",
            live_mode_enabled: state.live_mode_enabled,
        },
        request_id.0,
    )
}

pub async fn readyz(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
) -> Json<SuccessResponse<ReadinessData>> {
    let (database, status) = if let Some(pool) = state.db_pool_opt() {
        match ping_database(&pool).await {
            Ok(duration) => {
                state
                    .telemetry
                    .observe_db_operation("health.readyz", duration);
                ("ready", "ready")
            }
            Err(error) => {
                tracing::warn!(error = %error, "database readiness check failed");
                ("error", "degraded")
            }
        }
    } else {
        (state.pool.readiness_label(), "ready")
    };

    response::json(
        ReadinessData {
            status,
            database,
            live_mode_enabled: state.live_mode_enabled,
        },
        request_id.0,
    )
}

pub async fn metrics(
    State(state): State<AppState>,
) -> Result<([(axum::http::header::HeaderName, &'static str); 1], String), StatusCode> {
    if !state.config.prometheus_enabled {
        return Err(StatusCode::NOT_FOUND);
    }

    update_process_memory_profile_telemetry(&state, process_memory_profile());
    let rate_limiter_buckets = state.rate_limiter.bucket_count().await;
    state
        .telemetry
        .set_rate_limiter_bucket_count(rate_limiter_buckets);

    if let Some(pool) = state.db_pool_opt() {
        if let Ok(backlog) = inspect_outbox_backlog(&pool).await {
            state.telemetry.observe_outbox_backlog(
                backlog.pending_count,
                backlog.oldest_age_seconds,
                backlog.terminal_count,
                backlog.oldest_terminal_age_seconds,
            );
        }

        if let Ok(storage) =
            inspect_storage_budget(&pool, state.config.storage_budget_thresholds.clone()).await
        {
            state.telemetry.observe_storage_budget(
                storage.total_bytes,
                storage.level.as_label(),
                storage.level.as_severity_code(),
            );
        }

        if let Ok(projection) = inspect_grading_projection_snapshot(&pool).await {
            state.telemetry.sync_grading_projection_metrics(&projection);
        }
    }

    let body = state
        .telemetry
        .render()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        [(CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        body,
    ))
}

#[cfg(target_os = "linux")]
fn process_memory_profile() -> Option<ProcessMemoryProfile> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    parse_proc_status_memory_profile(&status)
}

#[cfg(not(target_os = "linux"))]
fn process_memory_profile() -> Option<ProcessMemoryProfile> {
    None
}

fn update_process_memory_profile_telemetry(
    state: &AppState,
    memory_profile: Option<ProcessMemoryProfile>,
) {
    if let Some(memory_profile) = memory_profile {
        state.telemetry.set_process_memory_profile(&memory_profile);
        return;
    }

    #[cfg(target_os = "linux")]
    {
        state
            .telemetry
            .observe_process_memory_profile_collection_failure();
    }
}

#[cfg(any(target_os = "linux", test))]
fn parse_proc_status_memory_profile(status: &str) -> Option<ProcessMemoryProfile> {
    Some(ProcessMemoryProfile {
        resident_bytes: parse_proc_status_kilobytes(status, "VmRSS:")?,
        resident_high_water_mark_bytes: parse_proc_status_kilobytes(status, "VmHWM:")?,
        virtual_memory_bytes: parse_proc_status_kilobytes(status, "VmSize:")?,
        heap_bytes: parse_proc_status_kilobytes(status, "VmData:")?,
        swap_bytes: parse_proc_status_kilobytes(status, "VmSwap:")?,
    })
}

#[cfg(any(target_os = "linux", test))]
fn parse_proc_status_kilobytes(status: &str, field: &str) -> Option<u64> {
    for line in status.lines() {
        let Some(value) = line.strip_prefix(field) else {
            continue;
        };
        let kilobytes: u64 = value.trim().split_whitespace().next()?.parse().ok()?;
        return Some(kilobytes.saturating_mul(1024));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        metrics, parse_proc_status_memory_profile, update_process_memory_profile_telemetry,
    };
    use crate::state::AppState;
    use axum::{extract::State, http::header::CONTENT_TYPE};
    use ielts_backend_infrastructure::config::AppConfig;

    #[test]
    fn parses_memory_profile_from_proc_status_fixture() {
        let fixture = "\
Name:\ttest\n\
VmSize:\t   2048 kB\n\
VmHWM:\t    128 kB\n\
VmRSS:\t    100 kB\n\
VmData:\t    64 kB\n\
VmSwap:\t    12 kB\n";
        let profile = parse_proc_status_memory_profile(fixture).expect("parse memory profile");

        assert_eq!(profile.resident_bytes, 100 * 1024);
        assert_eq!(profile.resident_high_water_mark_bytes, 128 * 1024);
        assert_eq!(profile.virtual_memory_bytes, 2048 * 1024);
        assert_eq!(profile.heap_bytes, 64 * 1024);
        assert_eq!(profile.swap_bytes, 12 * 1024);
    }

    #[test]
    fn parse_memory_profile_returns_none_when_required_field_missing() {
        let fixture = "\
Name:\ttest\n\
VmSize:\t   2048 kB\n\
VmHWM:\t    128 kB\n\
VmRSS:\t    100 kB\n\
VmData:\t    64 kB\n";
        assert!(parse_proc_status_memory_profile(fixture).is_none());
    }

    #[tokio::test]
    async fn metrics_returns_ok_even_when_memory_profile_collection_fails() {
        let mut config = AppConfig::default();
        config.prometheus_enabled = true;
        let state = AppState::new(config);

        update_process_memory_profile_telemetry(&state, None);

        let (headers, body) = metrics(State(state)).await.expect("metrics response");
        assert_eq!(headers[0].0, CONTENT_TYPE);
        assert_eq!(headers[0].1, "text/plain; version=0.0.4; charset=utf-8");
        assert!(body.contains("# HELP"));

        #[cfg(target_os = "linux")]
        assert!(body.contains("backend_process_memory_profile_collection_failures_total 1"));
    }
}
