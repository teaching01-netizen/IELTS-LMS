use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use ielts_backend_application::assessment_delivery::{
    AssessmentDeliveryError, AssessmentDeliveryService,
};
use ielts_backend_domain::assessment::{
    AssessmentDeliveryBootstrap, AssessmentModuleStartRequest, AssessmentModuleSubmitRequest,
    AssessmentResponseRequest, AssessmentResponseSnapshot, AssessmentResult,
    AssessmentSubmitRequest,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    http::{
        auth::AttemptPrincipal,
        request_id::RequestId,
        response::{ApiError, ApiResponse},
    },
    state::AppState,
};

fn map_error(error: AssessmentDeliveryError) -> ApiError {
    match error {
        AssessmentDeliveryError::Database(error) => ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &error.to_string(),
        ),
        AssessmentDeliveryError::NotFound => ApiError::new(
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
            "Assessment delivery resource not found.",
        ),
        AssessmentDeliveryError::Conflict(message) => {
            ApiError::new(StatusCode::CONFLICT, "ASSESSMENT_CONFLICT", &message)
        }
        AssessmentDeliveryError::TerminalizationConflict {
            message,
            outcome,
            reason,
            terminalization_id,
            latest_revision,
        } => ApiError::new(StatusCode::CONFLICT, "ASSESSMENT_CONFLICT", &message).with_details(
            json!({
                "outcome": outcome,
                "reason": reason,
                "terminalizationId": terminalization_id,
                "latestRevision": latest_revision,
            }),
        ),
        AssessmentDeliveryError::StructuredConflict { reason, message } => {
            ApiError::new(StatusCode::CONFLICT, "ASSESSMENT_CONFLICT", &message)
                .with_details(json!({ "reason": reason.as_str() }))
        }
        AssessmentDeliveryError::ActiveSessionSuperseded => ApiError::new(
            StatusCode::CONFLICT,
            "ACTIVE_SESSION_SUPERSEDED",
            "A newer student session owns this attempt.",
        )
        .with_details(json!({ "reason": "ACTIVE_SESSION_SUPERSEDED" })),
        AssessmentDeliveryError::Validation(message) => ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            &message,
        ),
        AssessmentDeliveryError::UnsupportedProvider => ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "UNSUPPORTED_PROVIDER",
            "The assessment provider is not supported.",
        ),
        AssessmentDeliveryError::InvalidData(message) => ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_ASSESSMENT",
            &message,
        ),
    }
}

fn ensure_schedule(principal: &AttemptPrincipal, schedule_id: &str) -> Result<String, ApiError> {
    if principal.authorization.claims.schedule_id != schedule_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "Attempt credential does not match the schedule.",
        ));
    }
    Ok(principal.authorization.claims.attempt_id.clone())
}

async fn ensure_active_writer(
    state: &AppState,
    principal: &AttemptPrincipal,
    schedule_id: &str,
) -> Result<String, ApiError> {
    let attempt_id = ensure_schedule(principal, schedule_id)?;
    AssessmentDeliveryService::new(state.db_pool())
        .ensure_active_writer(
            schedule_id,
            &attempt_id,
            &principal.authorization.claims.client_session_id,
        )
        .await
        .map_err(map_error)?;
    Ok(attempt_id)
}

pub async fn bootstrap(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AttemptPrincipal,
    Path(schedule_id): Path<Uuid>,
) -> Result<ApiResponse<AssessmentDeliveryBootstrap>, ApiError> {
    let schedule_id = schedule_id.to_string();
    let attempt_id = ensure_schedule(&principal, &schedule_id)?;
    let payload = AssessmentDeliveryService::new(state.db_pool())
        .bootstrap(&schedule_id, &attempt_id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(payload, request_id.0))
}

pub async fn save_response(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AttemptPrincipal,
    Path((schedule_id, exam_question_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<AssessmentResponseRequest>,
) -> Result<ApiResponse<AssessmentResponseSnapshot>, ApiError> {
    let server_received_at = Utc::now();
    let schedule_id = schedule_id.to_string();
    let attempt_id = ensure_active_writer(&state, &principal, &schedule_id).await?;
    let payload = AssessmentDeliveryService::new(state.db_pool())
        .save_response_at(
            &schedule_id,
            &attempt_id,
            &exam_question_id.to_string(),
            server_received_at,
            request,
        )
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(payload, request_id.0))
}

pub async fn start_module(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AttemptPrincipal,
    Path(schedule_id): Path<Uuid>,
    Json(request): Json<AssessmentModuleStartRequest>,
) -> Result<ApiResponse<AssessmentDeliveryBootstrap>, ApiError> {
    let schedule_id = schedule_id.to_string();
    let attempt_id = ensure_active_writer(&state, &principal, &schedule_id).await?;
    let payload = AssessmentDeliveryService::new(state.db_pool())
        .start_module(&schedule_id, &attempt_id, request)
        .await
        .map_err(map_error)?;
    let revision = payload
        .attempt
        .module_attempts
        .iter()
        .map(|module| i64::from(module.revision))
        .max()
        .unwrap_or(0);
    state.publish_live_update(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "attempt".to_owned(),
        id: attempt_id.clone(),
        revision,
        event: "sat_module_started".to_owned(),
    });
    state.publish_live_update(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "schedule_roster".to_owned(),
        id: schedule_id,
        revision,
        event: "sat_module_started".to_owned(),
    });
    Ok(ApiResponse::success_with_request_id(payload, request_id.0))
}

pub async fn submit_module(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AttemptPrincipal,
    Path(schedule_id): Path<Uuid>,
    Json(request): Json<AssessmentModuleSubmitRequest>,
) -> Result<ApiResponse<AssessmentDeliveryBootstrap>, ApiError> {
    let schedule_id = schedule_id.to_string();
    let attempt_id = ensure_active_writer(&state, &principal, &schedule_id).await?;
    let payload = AssessmentDeliveryService::new(state.db_pool())
        .submit_module(&schedule_id, &attempt_id, request)
        .await
        .map_err(map_error)?;
    let revision = payload
        .attempt
        .module_attempts
        .iter()
        .map(|module| i64::from(module.revision))
        .max()
        .unwrap_or(0);
    state.publish_live_update(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "attempt".to_owned(),
        id: attempt_id,
        revision,
        event: "sat_module_submitted".to_owned(),
    });
    state.publish_live_update(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "schedule_roster".to_owned(),
        id: schedule_id,
        revision,
        event: "sat_module_submitted".to_owned(),
    });
    Ok(ApiResponse::success_with_request_id(payload, request_id.0))
}

pub async fn submit_assessment(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AttemptPrincipal,
    Path(schedule_id): Path<Uuid>,
    Json(request): Json<AssessmentSubmitRequest>,
) -> Result<ApiResponse<AssessmentResult>, ApiError> {
    let schedule_id = schedule_id.to_string();
    let attempt_id = ensure_active_writer(&state, &principal, &schedule_id).await?;
    let payload = AssessmentDeliveryService::new(state.db_pool())
        .complete_assessment(&schedule_id, &attempt_id, request)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(payload, request_id.0))
}
