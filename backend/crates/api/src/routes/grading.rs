use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use ielts_backend_application::auth::AuthService;
use ielts_backend_application::grading::{GradingError, GradingService};
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::grading::{
    ActorActionRequest, GradingSession, GradingSessionDetail, ReleaseEvent, ReleaseNowRequest,
    ReviewDraft, SaveReviewDraftRequest, ScheduleReleaseRequest, StartReviewRequest, StudentResult,
    SubmissionReviewBundle,
};
use ielts_backend_infrastructure::actor_context::ActorContext;
use sqlx::query_scalar;
use std::time::Instant;
use uuid::Uuid;

use crate::{
    http::{
        auth::{AuthenticatedUser, VerifiedCsrf},
        request_id::RequestId,
        response::{ApiError, ApiResponse},
    },
    state::AppState,
};

pub async fn list_sessions(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
) -> Result<ApiResponse<Vec<GradingSession>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Grader])?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal);
    let service = GradingService::new(state.db_pool());
    let started = Instant::now();
    let sessions = service.list_sessions(&ctx).await?;
    let sessions = if principal.user.role == UserRole::Admin {
        sessions
    } else {
        let allowed = assigned_schedule_ids(&state, &principal.user.id).await?;
        sessions
            .into_iter()
            .filter(|session| allowed.contains(&session.schedule_id))
            .collect()
    };
    state
        .telemetry
        .observe_db_operation("grading.list_sessions", started.elapsed());
    Ok(ApiResponse::success_with_request_id(sessions, request_id.0))
}

pub async fn get_session(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(session_id): Path<Uuid>,
) -> Result<ApiResponse<GradingSessionDetail>, ApiError> {
    authorize_schedule(&state, &principal, session_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(session_id.to_string());
    let service = GradingService::new(state.db_pool());
    let started = Instant::now();
    let detail = service.get_session_detail(&ctx, session_id).await?;
    state
        .telemetry
        .observe_db_operation("grading.get_session_detail", started.elapsed());
    Ok(ApiResponse::success_with_request_id(detail, request_id.0))
}

pub async fn get_submission(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(submission_id): Path<Uuid>,
) -> Result<ApiResponse<SubmissionReviewBundle>, ApiError> {
    let schedule_id: Uuid = query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
        .bind(submission_id)
        .fetch_optional(&state.db_pool())
        .await
        .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = GradingService::new(state.db_pool());
    let started = Instant::now();
    let bundle = service.get_submission_bundle(&ctx, submission_id).await?;
    state
        .telemetry
        .observe_db_operation("grading.get_submission_bundle", started.elapsed());
    Ok(ApiResponse::success_with_request_id(bundle, request_id.0))
}

pub async fn start_review(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(submission_id): Path<Uuid>,
    Json(req): Json<StartReviewRequest>,
) -> Result<ApiResponse<ReviewDraft>, ApiError> {
    let schedule_id: Uuid = query_scalar("SELECT schedule_id FROM student_submissions WHERE id = $1")
        .bind(submission_id)
        .fetch_optional(&state.db_pool())
        .await
        .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = GradingService::new(state.db_pool());
    let started = Instant::now();
    let draft = service
        .start_review(&ctx, submission_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.start_review", started.elapsed());
    Ok(ApiResponse::success_with_request_id(draft, request_id.0))
}

pub async fn get_review_draft(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(submission_id): Path<Uuid>,
) -> Result<ApiResponse<ReviewDraft>, ApiError> {
    let schedule_id: Uuid = query_scalar(
        "SELECT schedule_id FROM student_submissions WHERE id = $1",
    )
    .bind(submission_id)
    .fetch_optional(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let service = GradingService::new(state.db_pool());
    let started = Instant::now();
    let draft = service.get_review_draft(submission_id).await?;
    state
        .telemetry
        .observe_db_operation("grading.get_review_draft", started.elapsed());
    Ok(ApiResponse::success_with_request_id(draft, request_id.0))
}

pub async fn save_review_draft(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(submission_id): Path<Uuid>,
    Json(req): Json<SaveReviewDraftRequest>,
) -> Result<ApiResponse<ReviewDraft>, ApiError> {
    let schedule_id: Uuid = query_scalar(
        "SELECT schedule_id FROM student_submissions WHERE id = $1",
    )
    .bind(submission_id)
    .fetch_optional(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = GradingService::new(state.db_pool());
    let started = Instant::now();
    let draft = service
        .save_review_draft(&ctx, submission_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.save_review_draft", started.elapsed());
    Ok(ApiResponse::success_with_request_id(draft, request_id.0))
}

pub async fn mark_grading_complete(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(submission_id): Path<Uuid>,
    Json(req): Json<ActorActionRequest>,
) -> Result<ApiResponse<ReviewDraft>, ApiError> {
    let schedule_id: Uuid = query_scalar(
        "SELECT schedule_id FROM student_submissions WHERE id = $1",
    )
    .bind(submission_id)
    .fetch_optional(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = GradingService::new(state.db_pool());
    let started = Instant::now();
    let draft = service
        .mark_grading_complete(&ctx, submission_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.mark_grading_complete", started.elapsed());
    Ok(ApiResponse::success_with_request_id(draft, request_id.0))
}

pub async fn mark_ready_to_release(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(submission_id): Path<Uuid>,
    Json(req): Json<ActorActionRequest>,
) -> Result<ApiResponse<ReviewDraft>, ApiError> {
    let schedule_id: Uuid = query_scalar(
        "SELECT schedule_id FROM student_submissions WHERE id = $1",
    )
    .bind(submission_id)
    .fetch_optional(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = GradingService::new(state.db_pool());
    let started = Instant::now();
    let draft = service
        .mark_ready_to_release(&ctx, submission_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.mark_ready_to_release", started.elapsed());
    Ok(ApiResponse::success_with_request_id(draft, request_id.0))
}

pub async fn release_now(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(submission_id): Path<Uuid>,
    Json(req): Json<ReleaseNowRequest>,
) -> Result<ApiResponse<StudentResult>, ApiError> {
    let schedule_id: Uuid = query_scalar(
        "SELECT schedule_id FROM student_submissions WHERE id = $1",
    )
    .bind(submission_id)
    .fetch_optional(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = GradingService::new(state.db_pool());
    let started = std::time::Instant::now();
    let result = service
        .release_now(&ctx, submission_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.release_now", started.elapsed());
    Ok(ApiResponse::success_with_request_id(result, request_id.0))
}

pub async fn schedule_release(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(submission_id): Path<Uuid>,
    Json(req): Json<ScheduleReleaseRequest>,
) -> Result<ApiResponse<ReviewDraft>, ApiError> {
    let schedule_id: Uuid = query_scalar(
        "SELECT schedule_id FROM student_submissions WHERE id = $1",
    )
    .bind(submission_id)
    .fetch_optional(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = GradingService::new(state.db_pool());
    let started = std::time::Instant::now();
    let draft = service
        .schedule_release(&ctx, submission_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.schedule_release", started.elapsed());
    Ok(ApiResponse::success_with_request_id(draft, request_id.0))
}

pub async fn reopen_review(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(submission_id): Path<Uuid>,
    Json(req): Json<ActorActionRequest>,
) -> Result<ApiResponse<ReviewDraft>, ApiError> {
    let schedule_id: Uuid = query_scalar(
        "SELECT schedule_id FROM student_submissions WHERE id = ?",
    )
    .bind(submission_id)
    .fetch_optional(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = GradingService::new(state.db_pool());
    let started = std::time::Instant::now();
    let draft = service
        .reopen_review(&ctx, submission_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.reopen_review", started.elapsed());
    Ok(ApiResponse::success_with_request_id(draft, request_id.0))
}

pub async fn get_result_events(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(result_id): Path<Uuid>,
) -> Result<ApiResponse<Vec<ReleaseEvent>>, ApiError> {
    let schedule_id: Uuid = query_scalar(
        r#"
        SELECT submissions.schedule_id
        FROM release_events events
        JOIN student_submissions submissions ON submissions.id = events.submission_id
        WHERE events.result_id = $1
        LIMIT 1
        "#,
    )
    .bind(result_id)
    .fetch_optional(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let service = GradingService::new(state.db_pool());
    let started = Instant::now();
    let events = service.get_result_events(result_id).await?;
    state
        .telemetry
        .observe_db_operation("grading.get_result_events", started.elapsed());
    Ok(ApiResponse::success_with_request_id(events, request_id.0))
}

async fn authorize_schedule(
    state: &AppState,
    principal: &AuthenticatedUser,
    schedule_id: Uuid,
) -> Result<(), ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Grader])?;
    if principal.user.role == UserRole::Admin {
        return Ok(());
    }
    AuthService::new(state.db_pool(), state.config.clone())
        .authorize_staff_schedule(
            &ielts_backend_application::auth::AuthenticatedSession {
                user: principal.user.clone(),
                session: principal.session.clone(),
            },
            schedule_id.to_string(),
            UserRole::Grader,
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

async fn assigned_schedule_ids(
    state: &AppState,
    user_id: &str,
) -> Result<std::collections::HashSet<String>, ApiError> {
    let rows = query_scalar::<_, String>(
        r#"
        SELECT schedule_id
        FROM schedule_staff_assignments
        WHERE user_id = $1
          AND role = 'grader'
          AND revoked_at IS NULL
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?;
    Ok(rows.into_iter().collect())
}

impl From<GradingError> for ApiError {
    fn from(err: GradingError) -> Self {
        match err {
            GradingError::Conflict(msg) => ApiError::new(StatusCode::CONFLICT, "CONFLICT", &msg),
            GradingError::NotFound => {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            }
            GradingError::Validation(msg) => {
                ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", &msg)
            }
            GradingError::Database(err) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                &err.to_string(),
            ),
        }
    }
}
