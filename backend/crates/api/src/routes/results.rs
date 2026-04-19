use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use ielts_backend_application::results::ResultsService;
use ielts_backend_domain::auth::UserRole;
use ielts_backend_infrastructure::{
    actor_context::ActorContext,
    rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult},
};
use uuid::Uuid;

use crate::{
    http::{
        auth::{AuthenticatedUser, VerifiedCsrf},
        request_id::RequestId,
        response::{ApiError, ApiResponse},
    },
    state::AppState,
};

pub async fn list_results(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
) -> Result<ApiResponse<Vec<ielts_backend_domain::grading::StudentResult>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Grader, UserRole::Proctor])?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal);
    let service = ResultsService::new(state.db_pool());
    let results = service.list_results(&ctx).await?;
    Ok(ApiResponse::success_with_request_id(results, request_id.0))
}

pub async fn get_result(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(result_id): Path<Uuid>,
) -> Result<ApiResponse<ielts_backend_domain::grading::StudentResult>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Grader, UserRole::Proctor])?;
    let service = ResultsService::new(state.db_pool());
    let result = service.get_result(result_id).await?;
    Ok(ApiResponse::success_with_request_id(result, request_id.0))
}

pub async fn analytics(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
) -> Result<ApiResponse<ielts_backend_domain::grading::ResultsAnalytics>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Grader, UserRole::Proctor])?;
    let service = ResultsService::new(state.db_pool());
    let analytics = service.analytics().await?;
    Ok(ApiResponse::success_with_request_id(
        analytics,
        request_id.0,
    ))
}

pub async fn export_results(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
) -> Result<ApiResponse<serde_json::Value>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Grader])?;

    // Apply per-user rate limiting for exports (expensive operation)
    let key = RateLimitKey::User(principal.user.id.clone());
    let config = RateLimitConfig::new(
        state.config.rate_limit_export_per_user,
        state.config.rate_limit_export_per_user_window_secs,
    );
    match state.rate_limiter.check_with_config(&key, &config).await {
        RateLimitResult::Allowed { .. } => {}
        RateLimitResult::Denied { retry_after } => {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!("Too many export attempts. Retry after {} seconds.", retry_after.as_secs()),
            ));
        }
    }
    let ctx = crate::http::auth::actor_context_from_principal(&principal);
    let service = ResultsService::new(state.db_pool());
    let export = service.export_results(&ctx).await?;
    Ok(ApiResponse::success_with_request_id(export, request_id.0))
}

pub async fn result_events(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(result_id): Path<Uuid>,
) -> Result<ApiResponse<Vec<ielts_backend_domain::grading::ReleaseEvent>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Grader, UserRole::Proctor])?;
    let service = ResultsService::new(state.db_pool());
    let events = service.get_events(result_id).await?;
    Ok(ApiResponse::success_with_request_id(events, request_id.0))
}
