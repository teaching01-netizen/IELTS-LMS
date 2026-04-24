use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use ielts_backend_application::builder::{BuilderError, BuilderService};
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::exam::{
    CreateExamRequest, ExamEntity, ExamValidationSummary, ExamVersion, ExamVersionSummary,
    PublishExamRequest, SaveDraftRequest, UpdateExamRequest,
};
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

pub async fn list_exams(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
) -> Result<ApiResponse<Vec<ExamEntity>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let exams = service.list_exams(&ctx).await?;
    Ok(ApiResponse::success_with_request_id(exams, request_id.0))
}

pub async fn create_exam(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Json(req): Json<CreateExamRequest>,
) -> Result<ApiResponse<ExamEntity>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let exam = service.create_exam(&ctx, req).await?;
    Ok(ApiResponse::success_with_request_id(exam, request_id.0))
}

pub async fn get_exam(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<ApiResponse<ExamEntity>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let exam = service.get_exam(&ctx, id.to_string()).await?;
    Ok(ApiResponse::success_with_request_id(exam, request_id.0))
}

pub async fn update_exam(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateExamRequest>,
) -> Result<ApiResponse<ExamEntity>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let exam = service.update_exam(&ctx, id.to_string(), req).await?;
    Ok(ApiResponse::success_with_request_id(exam, request_id.0))
}

pub async fn save_draft(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(exam_id): Path<Uuid>,
    Json(req): Json<SaveDraftRequest>,
) -> Result<ApiResponse<ExamVersion>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let version = service.save_draft(&ctx, exam_id.to_string(), req).await?;
    Ok(ApiResponse::success_with_request_id(version, request_id.0))
}

pub async fn publish_exam(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(exam_id): Path<Uuid>,
    Json(req): Json<PublishExamRequest>,
) -> Result<ApiResponse<ExamVersion>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let started = Instant::now();
    let version = service.publish_exam(&ctx, exam_id.to_string(), req).await?;
    state
        .telemetry
        .observe_db_operation("builder.publish_exam", started.elapsed());
    Ok(ApiResponse::success_with_request_id(version, request_id.0))
}

pub async fn get_version(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(version_id): Path<Uuid>,
) -> Result<ApiResponse<ExamVersion>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let version = service.get_version(&ctx, version_id.to_string()).await?;
    Ok(ApiResponse::success_with_request_id(version, request_id.0))
}

pub async fn list_versions(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<Uuid>,
) -> Result<ApiResponse<Vec<ExamVersion>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let versions = service.list_versions(&ctx, exam_id.to_string()).await?;
    Ok(ApiResponse::success_with_request_id(versions, request_id.0))
}

pub async fn list_version_summaries(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<Uuid>,
) -> Result<ApiResponse<Vec<ExamVersionSummary>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let versions = service
        .list_version_summaries(&ctx, exam_id.to_string())
        .await?;
    Ok(ApiResponse::success_with_request_id(versions, request_id.0))
}

pub async fn list_events(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<Uuid>,
) -> Result<ApiResponse<Vec<ielts_backend_domain::exam::ExamEvent>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let events = service.list_events(&ctx, exam_id.to_string()).await?;
    Ok(ApiResponse::success_with_request_id(events, request_id.0))
}

pub async fn delete_exam(
    State(state): State<AppState>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    service.delete_exam(&ctx, id.to_string()).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_validation(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<Uuid>,
) -> Result<ApiResponse<ExamValidationSummary>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let started = Instant::now();
    let validation = service.validate_exam(&ctx, exam_id.to_string()).await?;
    let duration = started.elapsed();
    state
        .telemetry
        .observe_db_operation("builder.validate_exam", duration);
    state
        .telemetry
        .observe_publish_validation(if validation.can_publish { "ok" } else { "blocked" }, duration);
    Ok(ApiResponse::success_with_request_id(validation, request_id.0))
}

impl From<BuilderError> for ApiError {
    fn from(err: BuilderError) -> Self {
        match err {
            BuilderError::Conflict(msg) => ApiError::new(StatusCode::CONFLICT, "CONFLICT", &msg),
            BuilderError::NotFound => {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            }
            BuilderError::Validation(msg) => {
                ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", &msg)
            }
            BuilderError::Database(err) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                &err.to_string(),
            ),
        }
    }
}
