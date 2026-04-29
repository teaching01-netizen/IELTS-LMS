use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use ielts_backend_application::auth::AuthService;
use ielts_backend_application::results::ResultsService;
use ielts_backend_domain::auth::UserRole;
use ielts_backend_infrastructure::rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult};
use sqlx::query_scalar;
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
    authorize_result_access(&state, &principal, result_id).await?;
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
                &format!(
                    "Too many export attempts. Retry after {} seconds.",
                    retry_after.as_secs()
                ),
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
    authorize_result_access(&state, &principal, result_id).await?;
    let service = ResultsService::new(state.db_pool());
    let events = service.get_events(result_id).await?;
    Ok(ApiResponse::success_with_request_id(events, request_id.0))
}

async fn authorize_result_access(
    state: &AppState,
    principal: &AuthenticatedUser,
    result_id: Uuid,
) -> Result<(), ApiError> {
    if principal.user.role == UserRole::Admin {
        return Ok(());
    }

    let schedule_id: String = query_scalar(
        r#"
        SELECT submissions.schedule_id
        FROM student_results results
        JOIN student_submissions submissions ON submissions.id = results.submission_id
        WHERE results.id = ?
        LIMIT 1
        "#,
    )
    .bind(result_id.to_string())
    .fetch_optional(&state.db_pool())
    .await
    .map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &err.to_string(),
        )
    })?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;

    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id from student_results join: {err}"),
        )
    })?;

    let required_role = match principal.user.role {
        UserRole::Grader => UserRole::Grader,
        UserRole::Proctor => UserRole::Proctor,
        _ => {
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "The authenticated user is not allowed to read this result.",
            ))
        }
    };

    AuthService::new(state.db_pool(), state.config.clone())
        .authorize_staff_schedule(
            &ielts_backend_application::auth::AuthenticatedSession {
                user: principal.user.clone(),
                session: principal.session.clone(),
            },
            schedule_id.to_string(),
            required_role,
        )
        .await
        .map(|_| ())
        .map_err(|_| {
            ApiError::new(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "The authenticated user is not assigned to this grading schedule.",
            )
        })
}
