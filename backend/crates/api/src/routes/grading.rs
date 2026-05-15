use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    Json,
};
use ielts_backend_application::auth::AuthService;
use ielts_backend_application::grading::{GradingError, GradingService};
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::grading::{
    ActorActionRequest, GradingScheduleObjectiveOverride, GradingSession, GradingSessionDetail,
    ObjectiveOverrideDeleteRequest, ObjectiveOverrideUpsertRequest, ReleaseEvent,
    ReleaseNowRequest, ReviewDraft, SaveReviewDraftRequest, ScheduleReleaseRequest,
    SectionSubmission, StartReviewRequest, StudentResult, SubmissionReviewSummary,
    WritingTaskSubmission,
};
use serde::Deserialize;
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetailQuery {
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListQuery {
    pub limit: Option<u64>,
}

fn grading_service(state: &AppState) -> GradingService {
    GradingService::with_sync_on_read_fallback(
        state.db_pool(),
        state.config.grading_sync_on_read_fallback,
    )
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveOverrideMutationResponse {
    pub override_row: Option<GradingScheduleObjectiveOverride>,
    pub deleted: Option<bool>,
    pub regrade_report: ielts_backend_application::grading::ObjectiveAutoGradingBackfillReport,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveLatestDraftRegradeRequest {
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveLatestDraftRegradeResponse {
    pub draft_version_id: String,
    pub regrade_report: ielts_backend_application::grading::ObjectiveAutoGradingBackfillReport,
}

pub async fn list_sessions(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Query(query): Query<SessionListQuery>,
) -> Result<ApiResponse<Vec<GradingSession>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Grader])?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal);
    let service = grading_service(&state);
    let started = Instant::now();
    let limit = query.limit.unwrap_or(200).clamp(1, 500);
    let db_limit = if principal.user.role == UserRole::Admin {
        limit
    } else {
        500
    };
    let sessions = service.list_sessions(&ctx, db_limit).await?;
    let sessions = if principal.user.role == UserRole::Admin {
        sessions
    } else {
        let allowed = assigned_schedule_ids(&state, &principal.user.id).await?;
        sessions
            .into_iter()
            .filter(|session| allowed.contains(&session.schedule_id))
            .take(limit as usize)
            .collect()
    };
    state
        .telemetry
        .observe_db_operation("grading.list_sessions", started.elapsed());
    Ok(ApiResponse::success_with_request_id(sessions, request_id.0))
}

pub async fn list_objective_overrides(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(schedule_id): Path<Uuid>,
) -> Result<ApiResponse<Vec<GradingScheduleObjectiveOverride>>, ApiError> {
    authorize_schedule_for_overrides(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = Instant::now();
    let rows = service
        .list_schedule_objective_overrides(&ctx, schedule_id)
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.list_objective_overrides", started.elapsed());
    Ok(ApiResponse::success_with_request_id(rows, request_id.0))
}

pub async fn upsert_objective_override(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path((schedule_id, question_id)): Path<(Uuid, String)>,
    Json(req): Json<ObjectiveOverrideUpsertRequest>,
) -> Result<ApiResponse<ObjectiveOverrideMutationResponse>, ApiError> {
    authorize_schedule_for_overrides(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = Instant::now();
    let (row, report) = service
        .upsert_schedule_objective_override(
            &ctx,
            &principal.display_name(),
            schedule_id,
            question_id,
            req,
        )
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.upsert_objective_override", started.elapsed());
    Ok(ApiResponse::success_with_request_id(
        ObjectiveOverrideMutationResponse {
            override_row: Some(row),
            deleted: None,
            regrade_report: report,
        },
        request_id.0,
    ))
}

pub async fn delete_objective_override(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path((schedule_id, question_id)): Path<(Uuid, String)>,
    Json(req): Json<ObjectiveOverrideDeleteRequest>,
) -> Result<ApiResponse<ObjectiveOverrideMutationResponse>, ApiError> {
    authorize_schedule_for_overrides(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = Instant::now();
    let (report, deleted) = service
        .delete_schedule_objective_override(
            &ctx,
            &principal.display_name(),
            schedule_id,
            question_id,
            req,
        )
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.delete_objective_override", started.elapsed());
    Ok(ApiResponse::success_with_request_id(
        ObjectiveOverrideMutationResponse {
            override_row: None,
            deleted: Some(deleted),
            regrade_report: report,
        },
        request_id.0,
    ))
}

pub async fn regrade_objective_latest_draft(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(schedule_id): Path<Uuid>,
    Json(req): Json<ObjectiveLatestDraftRegradeRequest>,
) -> Result<ApiResponse<ObjectiveLatestDraftRegradeResponse>, ApiError> {
    principal.require_one_of(&[UserRole::Admin])?;

    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = Instant::now();
    let (report, draft_version_id) = service
        .regrade_schedule_objectives_from_latest_draft(&ctx, &principal.display_name(), schedule_id, req.reason)
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.objective_regrade_latest_draft", started.elapsed());
    Ok(ApiResponse::success_with_request_id(
        ObjectiveLatestDraftRegradeResponse {
            draft_version_id,
            regrade_report: report,
        },
        request_id.0,
    ))
}

pub async fn get_session(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Query(query): Query<SessionDetailQuery>,
    Path(session_id): Path<Uuid>,
) -> Result<ApiResponse<GradingSessionDetail>, ApiError> {
    authorize_schedule(&state, &principal, session_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(session_id.to_string());
    let page = query.page.unwrap_or(1);
    let page_size = query.page_size.unwrap_or(25);
    let service = grading_service(&state);
    let started = Instant::now();
    let detail = service
        .get_session_detail_page(&ctx, session_id, page, page_size)
        .await?;
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
) -> Result<ApiResponse<SubmissionReviewSummary>, ApiError> {
    let schedule_id: String =
        query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&state.db_pool())
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    &err.to_string(),
                )
            })?
            .ok_or_else(|| {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            })?;
    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id in student_submissions: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = Instant::now();
    let bundle = service.get_submission_summary(&ctx, submission_id).await?;
    state
        .telemetry
        .observe_db_operation("grading.get_submission_summary", started.elapsed());
    Ok(ApiResponse::success_with_request_id(bundle, request_id.0))
}

pub async fn get_submission_sections(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(submission_id): Path<Uuid>,
) -> Result<ApiResponse<Vec<SectionSubmission>>, ApiError> {
    let schedule_id: String =
        query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&state.db_pool())
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    &err.to_string(),
                )
            })?
            .ok_or_else(|| {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            })?;
    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id in student_submissions: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = Instant::now();
    let sections = service.get_submission_sections(&ctx, submission_id).await?;
    state
        .telemetry
        .observe_db_operation("grading.get_submission_sections", started.elapsed());
    Ok(ApiResponse::success_with_request_id(sections, request_id.0))
}

pub async fn get_submission_writing_tasks(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(submission_id): Path<Uuid>,
) -> Result<ApiResponse<Vec<WritingTaskSubmission>>, ApiError> {
    let schedule_id: String =
        query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&state.db_pool())
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    &err.to_string(),
                )
            })?
            .ok_or_else(|| {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            })?;
    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id in student_submissions: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = Instant::now();
    let writing_tasks = service
        .get_submission_writing_tasks(&ctx, submission_id)
        .await?;
    state
        .telemetry
        .observe_db_operation("grading.get_submission_writing_tasks", started.elapsed());
    Ok(ApiResponse::success_with_request_id(
        writing_tasks,
        request_id.0,
    ))
}

pub async fn start_review(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(submission_id): Path<Uuid>,
    Json(req): Json<StartReviewRequest>,
) -> Result<ApiResponse<ReviewDraft>, ApiError> {
    let schedule_id: String =
        query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&state.db_pool())
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    &err.to_string(),
                )
            })?
            .ok_or_else(|| {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            })?;
    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id in student_submissions: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = Instant::now();
    let draft = service.start_review(&ctx, submission_id, req).await?;
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
    let schedule_id: String =
        query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&state.db_pool())
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    &err.to_string(),
                )
            })?
            .ok_or_else(|| {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            })?;
    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id in student_submissions: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let service = grading_service(&state);
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
    let schedule_id: String =
        query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&state.db_pool())
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    &err.to_string(),
                )
            })?
            .ok_or_else(|| {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            })?;
    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id in student_submissions: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = Instant::now();
    let draft = service.save_review_draft(&ctx, submission_id, req).await?;
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
    let schedule_id: String =
        query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&state.db_pool())
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    &err.to_string(),
                )
            })?
            .ok_or_else(|| {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            })?;
    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id in student_submissions: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
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
    let schedule_id: String =
        query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&state.db_pool())
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    &err.to_string(),
                )
            })?
            .ok_or_else(|| {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            })?;
    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id in student_submissions: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
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
    let schedule_id: String =
        query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&state.db_pool())
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    &err.to_string(),
                )
            })?
            .ok_or_else(|| {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            })?;
    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id in student_submissions: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = std::time::Instant::now();
    let result = service.release_now(&ctx, submission_id, req).await?;
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
    let schedule_id: String =
        query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&state.db_pool())
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    &err.to_string(),
                )
            })?
            .ok_or_else(|| {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            })?;
    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id in student_submissions: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = std::time::Instant::now();
    let draft = service.schedule_release(&ctx, submission_id, req).await?;
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
    let schedule_id: String =
        query_scalar("SELECT schedule_id FROM student_submissions WHERE id = ?")
            .bind(submission_id.to_string())
            .fetch_optional(&state.db_pool())
            .await
            .map_err(|err| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "DATABASE_ERROR",
                    &err.to_string(),
                )
            })?
            .ok_or_else(|| {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            })?;
    let schedule_id = Uuid::parse_str(&schedule_id).map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATA_INTEGRITY_ERROR",
            &format!("Invalid schedule_id in student_submissions: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = grading_service(&state);
    let started = std::time::Instant::now();
    let draft = service.reopen_review(&ctx, submission_id, req).await?;
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
    let schedule_id: String = query_scalar(
        r#"
        SELECT submissions.schedule_id
        FROM release_events events
        JOIN student_submissions submissions ON submissions.id = events.submission_id
        WHERE events.result_id = ?
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
            &format!("Invalid schedule_id from release_events join: {err}"),
        )
    })?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let service = grading_service(&state);
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

async fn authorize_schedule_for_overrides(
    state: &AppState,
    principal: &AuthenticatedUser,
    schedule_id: Uuid,
) -> Result<(), ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Grader, UserRole::Proctor])?;
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
            principal.user.role.clone(),
        )
        .await
        .map(|_| ())
        .map_err(|_| {
            ApiError::new(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "The authenticated user is not assigned to this schedule.",
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
        WHERE user_id = ?
          AND role = 'grader'
          AND revoked_at IS NULL
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.db_pool())
    .await
    .map_err(|err| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &err.to_string(),
        )
    })?;
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
