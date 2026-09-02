use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use ielts_backend_application::assessment_access_links::{
    AccessDistributionOverview, AccessLinkActivity, AccessLinkMember, AssessmentAccessLink,
    AssessmentAccessLinkError, AssessmentAccessLinkService, CreateAssessmentAccessLinkRequest,
    DuplicateAssessmentAccessLinkRequest, PublicAssessmentAccessLink,
    SetAccessLinkLifecycleRequest, UpdateAssessmentAccessLinkRequest,
};
use ielts_backend_domain::auth::UserRole;

use crate::{
    http::{
        auth::{AuthenticatedUser, VerifiedCsrf},
        request_id::RequestId,
        response::{ApiError, ApiResponse},
    },
    state::AppState,
};

fn map_error(error: AssessmentAccessLinkError) -> ApiError {
    match error {
        AssessmentAccessLinkError::Database(error) => ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &error.to_string(),
        ),
        AssessmentAccessLinkError::Scheduling(error) => ApiError::from(error),
        AssessmentAccessLinkError::NotFound => ApiError::new(
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
            "Student Link not found.",
        ),
        AssessmentAccessLinkError::Conflict(message) => {
            ApiError::new(StatusCode::CONFLICT, "ACCESS_LINK_CONFLICT", &message)
        }
        AssessmentAccessLinkError::Validation(message) => ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "ACCESS_LINK_VALIDATION_ERROR",
            &message,
        ),
        AssessmentAccessLinkError::Unavailable(message) => {
            ApiError::new(StatusCode::FORBIDDEN, "ACCESS_LINK_UNAVAILABLE", &message)
        }
    }
}

async fn require_exam_staff(
    state: &AppState,
    principal: &AuthenticatedUser,
    exam_id: &str,
) -> Result<(), ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    ielts_backend_application::builder::BuilderService::new(state.db_pool())
        .get_exam(&ctx, exam_id.to_owned())
        .await
        .map(|_| ())
        .map_err(ApiError::from)
}

async fn require_link_staff(
    state: &AppState,
    principal: &AuthenticatedUser,
    link_id: &str,
) -> Result<AssessmentAccessLink, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let service = AssessmentAccessLinkService::new(state.db_pool());
    let link = service.get(link_id).await.map_err(map_error)?;
    require_exam_staff(state, principal, &link.exam_id).await?;
    Ok(link)
}

async fn require_exam_read_staff(
    state: &AppState,
    principal: &AuthenticatedUser,
    exam_id: &str,
) -> Result<(), ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::AdminObserver, UserRole::Builder])?;
    let ctx = principal.actor_context();
    ielts_backend_application::builder::BuilderService::new(state.db_pool())
        .get_exam(&ctx, exam_id.to_owned())
        .await
        .map(|_| ())
        .map_err(ApiError::from)
}

async fn require_link_read_staff(
    state: &AppState,
    principal: &AuthenticatedUser,
    link_id: &str,
) -> Result<AssessmentAccessLink, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::AdminObserver, UserRole::Builder])?;
    let service = AssessmentAccessLinkService::new(state.db_pool());
    let link = service.get(link_id).await.map_err(map_error)?;
    require_exam_read_staff(state, principal, &link.exam_id).await?;
    Ok(link)
}

pub async fn get_exam_overview(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<String>,
) -> Result<ApiResponse<AccessDistributionOverview>, ApiError> {
    require_exam_read_staff(&state, &principal, &exam_id).await?;
    let overview = AssessmentAccessLinkService::new(state.db_pool())
        .overview(&exam_id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(overview, request_id.0))
}

pub async fn list_exam_links(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<String>,
) -> Result<ApiResponse<Vec<AssessmentAccessLink>>, ApiError> {
    require_exam_read_staff(&state, &principal, &exam_id).await?;
    let links = AssessmentAccessLinkService::new(state.db_pool())
        .list_for_exam(&exam_id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(links, request_id.0))
}

pub async fn create_exam_link(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(exam_id): Path<String>,
    Json(request): Json<CreateAssessmentAccessLinkRequest>,
) -> Result<ApiResponse<AssessmentAccessLink>, ApiError> {
    require_exam_staff(&state, &principal, &exam_id).await?;
    let ctx = principal.actor_context();
    let link = AssessmentAccessLinkService::new(state.db_pool())
        .create(&ctx, &exam_id, request)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(link, request_id.0))
}

pub async fn get_link(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(link_id): Path<String>,
) -> Result<ApiResponse<AssessmentAccessLink>, ApiError> {
    let link = require_link_read_staff(&state, &principal, &link_id).await?;
    Ok(ApiResponse::success_with_request_id(link, request_id.0))
}

pub async fn update_link(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(link_id): Path<String>,
    Json(request): Json<UpdateAssessmentAccessLinkRequest>,
) -> Result<ApiResponse<AssessmentAccessLink>, ApiError> {
    require_link_staff(&state, &principal, &link_id).await?;
    let link = AssessmentAccessLinkService::new(state.db_pool())
        .update(&link_id, request)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(link, request_id.0))
}

pub async fn set_link_lifecycle(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(link_id): Path<String>,
    Json(request): Json<SetAccessLinkLifecycleRequest>,
) -> Result<ApiResponse<AssessmentAccessLink>, ApiError> {
    require_link_staff(&state, &principal, &link_id).await?;
    let link = AssessmentAccessLinkService::new(state.db_pool())
        .set_lifecycle(&link_id, request)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(link, request_id.0))
}

pub async fn duplicate_link(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(link_id): Path<String>,
    Json(request): Json<DuplicateAssessmentAccessLinkRequest>,
) -> Result<ApiResponse<AssessmentAccessLink>, ApiError> {
    require_link_staff(&state, &principal, &link_id).await?;
    let ctx = principal.actor_context();
    let link = AssessmentAccessLinkService::new(state.db_pool())
        .duplicate(&ctx, &link_id, request)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(link, request_id.0))
}

pub async fn list_link_members(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(link_id): Path<String>,
) -> Result<ApiResponse<Vec<AccessLinkMember>>, ApiError> {
    require_link_read_staff(&state, &principal, &link_id).await?;
    let members = AssessmentAccessLinkService::new(state.db_pool())
        .list_members(&link_id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(members, request_id.0))
}

pub async fn list_link_activity(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(link_id): Path<String>,
) -> Result<ApiResponse<Vec<AccessLinkActivity>>, ApiError> {
    require_link_read_staff(&state, &principal, &link_id).await?;
    let activity = AssessmentAccessLinkService::new(state.db_pool())
        .activity(&link_id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(activity, request_id.0))
}

pub async fn get_public_link(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(link_id): Path<String>,
) -> Result<ApiResponse<PublicAssessmentAccessLink>, ApiError> {
    let link = AssessmentAccessLinkService::new(state.db_pool())
        .public_link(&link_id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(link, request_id.0))
}
