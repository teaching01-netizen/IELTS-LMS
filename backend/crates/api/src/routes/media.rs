use axum::{
    body::{Body, Bytes},
    extract::{Extension, Path, State},
    http::{header::CONTENT_TYPE, HeaderValue, StatusCode},
    response::Response,
    Json,
};
use ielts_backend_application::media::{MediaError, MediaService};
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::grading::{
    CompleteUploadRequest, MediaAsset, UploadIntent, UploadIntentRequest,
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

pub async fn create_upload(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Json(req): Json<UploadIntentRequest>,
) -> Result<ApiResponse<UploadIntent>, ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
        UserRole::Grader,
        UserRole::Student,
    ])?;
    let service = MediaService::new(state.db_pool());
    let ctx = principal.actor_context();
    let upload = service.create_upload_intent(&ctx, req).await?;
    Ok(ApiResponse::success_with_request_id(upload, request_id.0))
}

pub async fn upload_local_object(
    State(state): State<AppState>,
    principal: AuthenticatedUser,
    Path(asset_id): Path<Uuid>,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
        UserRole::Grader,
        UserRole::Student,
    ])?;
    MediaService::new(state.db_pool())
        .upload_local_object(&principal.actor_context(), asset_id, &body)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn complete_upload(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(asset_id): Path<Uuid>,
    Json(req): Json<CompleteUploadRequest>,
) -> Result<ApiResponse<MediaAsset>, ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
        UserRole::Grader,
        UserRole::Student,
    ])?;
    let service = MediaService::new(state.db_pool());
    let ctx = principal.actor_context();
    let asset = service.complete_upload(&ctx, asset_id, req).await?;
    Ok(ApiResponse::success_with_request_id(asset, request_id.0))
}

pub async fn download_asset(
    State(state): State<AppState>,
    principal: AuthenticatedUser,
    Path(asset_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::AdminObserver,
        UserRole::Builder,
        UserRole::Proctor,
        UserRole::Grader,
        UserRole::Student,
    ])?;
    let (content_type, bytes) = MediaService::new(state.db_pool())
        .read_local_object(&principal.actor_context(), asset_id)
        .await?;
    let mut response = Response::new(Body::from(bytes));
    if let Ok(value) = HeaderValue::from_str(&content_type) {
        response.headers_mut().insert(CONTENT_TYPE, value);
    }
    Ok(response)
}

pub async fn get_asset(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(asset_id): Path<Uuid>,
) -> Result<ApiResponse<MediaAsset>, ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::AdminObserver,
        UserRole::Builder,
        UserRole::Proctor,
        UserRole::Grader,
        UserRole::Student,
    ])?;
    let service = MediaService::new(state.db_pool());
    let ctx = principal.actor_context();
    let asset = service.get_asset(&ctx, asset_id).await?;
    Ok(ApiResponse::success_with_request_id(asset, request_id.0))
}

impl From<MediaError> for ApiError {
    fn from(err: MediaError) -> Self {
        match err {
            MediaError::NotFound => {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            }
            MediaError::Database(err) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                &err.to_string(),
            ),
            MediaError::Validation(message) => ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "VALIDATION_ERROR",
                &message,
            ),
            MediaError::ObjectStore(message) => ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "OBJECT_STORAGE_UNAVAILABLE",
                &message,
            ),
        }
    }
}
