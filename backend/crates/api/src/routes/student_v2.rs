use axum::{
    extract::{Path, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    Extension, Json,
};
use ielts_backend_application::delivery::response_durability_v2::{
    DurabilityV2Error, ResponseDurabilityV2Service,
};
use ielts_backend_domain::durability_v2::*;
use ielts_backend_infrastructure::auth::{verify_attempt_token, AttemptTokenClaims};

use crate::{
    http::{request_id::RequestId, response::ApiError},
    state::AppState,
};

fn extract_claims(headers: &HeaderMap, state: &AppState) -> Result<AttemptTokenClaims, ApiError> {
    let auth_header = headers
        .get(AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "Missing Authorization header",
            )
        })?;

    let token = auth_header.strip_prefix("Bearer ").unwrap_or(auth_header);

    verify_attempt_token(&state.config, token).map_err(|_| {
        ApiError::new(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "Invalid or expired attempt token",
        )
    })
}

fn map_durability_error(err: DurabilityV2Error, request_id: &str) -> ApiError {
    match err {
        DurabilityV2Error::NotFound => {
            ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Attempt not found")
                .with_request_id(request_id)
        }
        DurabilityV2Error::Unauthorized(msg) => {
            ApiError::new(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", &msg)
                .with_request_id(request_id)
        }
        DurabilityV2Error::Validation(msg) => {
            ApiError::new(StatusCode::BAD_REQUEST, "INVALID_RESPONSE", &msg)
                .with_request_id(request_id)
        }
        DurabilityV2Error::StructuredConflict {
            code,
            message,
            details,
        } => {
            let status = match code {
                DurabilityErrorCode::InvalidResponse
                | DurabilityErrorCode::QuestionNotInAttempt => StatusCode::BAD_REQUEST,
                DurabilityErrorCode::RateLimited => StatusCode::TOO_MANY_REQUESTS,
                DurabilityErrorCode::TemporaryUnavailable => StatusCode::SERVICE_UNAVAILABLE,
                DurabilityErrorCode::ProtocolVersionUnsupported => StatusCode::CONFLICT,
                _ => StatusCode::CONFLICT,
            };
            let mut api_err =
                ApiError::new(status, code.as_str(), &message).with_request_id(request_id);
            if let Some(d) = details {
                api_err = api_err.with_details(d);
            }
            api_err
        }
        DurabilityV2Error::Database(e) => ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "TEMPORARY_UNAVAILABLE",
            &e.to_string(),
        )
        .with_request_id(request_id),
        DurabilityV2Error::Serialization(e) => {
            ApiError::new(StatusCode::BAD_REQUEST, "INVALID_RESPONSE", &e.to_string())
                .with_request_id(request_id)
        }
    }
}

pub async fn save_responses_batch(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    Path(attempt_id): Path<String>,
    Json(payload): Json<ResponseBatchRequestV2>,
) -> Result<Json<ResponseBatchResponseV2>, ApiError> {
    let claims = extract_claims(&headers, &state)?;
    let service = ResponseDurabilityV2Service::new(state.db_pool().clone(), state.config.clone());

    let response = service
        .save_responses_batch(&attempt_id, &claims, payload)
        .await
        .map_err(|e| map_durability_error(e, &request_id.0))?;

    Ok(Json(response))
}

pub async fn submit_attempt_v2(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    Path(attempt_id): Path<String>,
    Json(payload): Json<SubmitAttemptV2Request>,
) -> Result<Json<SubmitAttemptV2Response>, ApiError> {
    let claims = extract_claims(&headers, &state)?;
    let service = ResponseDurabilityV2Service::new(state.db_pool().clone(), state.config.clone());

    let response = service
        .submit_attempt_v2(&attempt_id, &claims, payload)
        .await
        .map_err(|e| map_durability_error(e, &request_id.0))?;

    Ok(Json(response))
}

pub async fn takeover_lease(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    Path(attempt_id): Path<String>,
    Json(payload): Json<TakeoverLeaseRequest>,
) -> Result<Json<TakeoverLeaseResponse>, ApiError> {
    let claims = extract_claims(&headers, &state)?;
    let service = ResponseDurabilityV2Service::new(state.db_pool().clone(), state.config.clone());

    let response = service
        .takeover_lease(&attempt_id, &claims, payload)
        .await
        .map_err(|e| map_durability_error(e, &request_id.0))?;

    Ok(Json(response))
}

pub async fn get_responses_snapshot(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    headers: HeaderMap,
    Path(attempt_id): Path<String>,
) -> Result<Json<ResponseSnapshotV2>, ApiError> {
    let claims = extract_claims(&headers, &state)?;
    let service = ResponseDurabilityV2Service::new(state.db_pool().clone(), state.config.clone());

    let snapshot = service
        .get_responses_snapshot_authorized(&attempt_id, &claims)
        .await
        .map_err(|e| map_durability_error(e, &request_id.0))?;

    Ok(Json(snapshot))
}
