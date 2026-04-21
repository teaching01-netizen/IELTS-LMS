use axum::http::{header::RETRY_AFTER, HeaderValue, StatusCode};
use serde_json::json;
use uuid::Uuid;

use crate::http::response::ApiError;
use crate::state::AppState;
use ielts_backend_infrastructure::auth::sha256_hex;

pub fn server_busy(request_id: &str, retry_after_secs: u64, gate: &'static str) -> ApiError {
    let retry_after_value = HeaderValue::from_str(&retry_after_secs.to_string())
        .unwrap_or_else(|_| HeaderValue::from_static("2"));

    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "SERVER_BUSY",
        "High traffic. Retrying shortly.",
    )
    .with_request_id(request_id.to_owned())
    .with_details(json!({
        "retryAfterSeconds": retry_after_secs,
        "gate": gate,
    }))
    .with_header(RETRY_AFTER, retry_after_value)
}

pub fn server_busy_from_state(
    state: &AppState,
    request_id: &str,
    gate: &'static str,
    schedule_id: Option<Uuid>,
    candidate_id: Option<&str>,
) -> ApiError {
    let retry_after_secs = state.busy_gates.retry_after_secs;
    state.telemetry.inc_server_busy(gate);

    let schedule_id = schedule_id.map(|id| id.to_string());
    let candidate_id_hash = candidate_id
        .filter(|value| !value.trim().is_empty())
        .map(sha256_hex);

    tracing::warn!(
        request_id = %request_id,
        schedule_id = schedule_id.as_deref().unwrap_or(""),
        candidate_id_hash = candidate_id_hash.as_deref().unwrap_or(""),
        gate = gate,
        retry_after_seconds = retry_after_secs,
        "SERVER_BUSY"
    );

    server_busy(request_id, retry_after_secs, gate)
}
