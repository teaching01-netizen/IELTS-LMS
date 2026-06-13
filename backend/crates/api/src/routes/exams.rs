use axum::{
    extract::{Extension, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use ielts_backend_application::builder::{BuilderError, BuilderService};
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::exam::{
    CreateExamRequest, ExamEntity, ExamValidationSummary, ExamVersion, ExamVersionSummary,
    PublishExamRequest, SaveDraftRequest, UpdateExamRequest,
};
use ielts_backend_infrastructure::authorization::AuthorizationService;
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

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExamEntityWithPermissions {
    #[serde(flatten)]
    pub exam: ExamEntity,
    pub can_edit: bool,
    pub can_publish: bool,
    pub can_delete: bool,
}

fn to_exam_with_permissions(
    ctx: &ielts_backend_infrastructure::actor_context::ActorContext,
    exam: ExamEntity,
) -> ExamEntityWithPermissions {
    // NOTE: Exam routes already enforce staff-only access (Admin/Builder).
    // We still include explicit permission flags because the frontend relies on them
    // to enable/disable publish workflows (e.g., "Create New Exam Copy").
    let can_modify = matches!(
        ctx.role,
        ielts_backend_infrastructure::actor_context::ActorRole::Admin
            | ielts_backend_infrastructure::actor_context::ActorRole::AdminObserver
            | ielts_backend_infrastructure::actor_context::ActorRole::Builder
    ) || exam
        .organization_id
        .as_ref()
        .is_some_and(|org_id| AuthorizationService::can_modify_exam_content(ctx, org_id.clone()));

    ExamEntityWithPermissions {
        exam,
        can_edit: can_modify,
        can_publish: can_modify,
        can_delete: can_modify,
    }
}

pub async fn list_exams(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
) -> Result<ApiResponse<Vec<ExamEntityWithPermissions>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let exams = service.list_exams(&ctx).await?;
    let response = exams
        .into_iter()
        .map(|exam| to_exam_with_permissions(&ctx, exam))
        .collect();
    Ok(ApiResponse::success_with_request_id(response, request_id.0))
}

pub async fn create_exam(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Json(req): Json<CreateExamRequest>,
) -> Result<ApiResponse<ExamEntityWithPermissions>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let exam = service.create_exam(&ctx, req).await?;
    Ok(ApiResponse::success_with_request_id(
        to_exam_with_permissions(&ctx, exam),
        request_id.0,
    ))
}

pub async fn get_exam(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<ApiResponse<ExamEntityWithPermissions>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let exam = service.get_exam(&ctx, id.to_string()).await?;
    Ok(ApiResponse::success_with_request_id(
        to_exam_with_permissions(&ctx, exam),
        request_id.0,
    ))
}

pub async fn update_exam(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateExamRequest>,
) -> Result<ApiResponse<ExamEntityWithPermissions>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let exam = service.update_exam(&ctx, id.to_string(), req).await?;
    Ok(ApiResponse::success_with_request_id(
        to_exam_with_permissions(&ctx, exam),
        request_id.0,
    ))
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
    headers: HeaderMap,
    Path(version_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = BuilderService::new(state.db_pool());
    let started = Instant::now();
    let version = service.get_version(&ctx, version_id.to_string()).await?;
    state
        .telemetry
        .observe_db_operation("builder.get_version", started.elapsed());

    let etag = version_etag(&version);
    if if_none_match_matches(&headers, &etag) {
        let mut response = StatusCode::NOT_MODIFIED.into_response();
        apply_version_cache_headers(response.headers_mut(), &etag);
        return Ok(response);
    }

    let mut response =
        Json(ApiResponse::success_with_request_id(version, request_id.0)).into_response();
    apply_version_cache_headers(response.headers_mut(), &etag);
    Ok(response)
}

fn version_etag(version: &ExamVersion) -> String {
    format!(
        r#""exam-version:{}:{}:{}:{}""#,
        version.id, version.revision, version.is_draft, version.is_published
    )
}

fn if_none_match_matches(headers: &HeaderMap, etag: &str) -> bool {
    headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .split(',')
                .any(|candidate| candidate.trim() == etag || candidate.trim() == "*")
        })
}

fn apply_version_cache_headers(headers: &mut HeaderMap, etag: &str) {
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=0, must-revalidate"),
    );
    if let Ok(value) = HeaderValue::from_str(etag) {
        headers.insert(header::ETAG, value);
    }
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
    state.telemetry.observe_publish_validation(
        if validation.can_publish {
            "ok"
        } else {
            "blocked"
        },
        duration,
    );
    Ok(ApiResponse::success_with_request_id(
        validation,
        request_id.0,
    ))
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
