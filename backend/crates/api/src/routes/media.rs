use axum::{
    body::Bytes,
    extract::{Extension, Path, State},
    http::{header, HeaderMap, StatusCode},
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
    let service = MediaService::new(state.db_pool(), state.media_object_store.clone())?;
    let upload = service
        .create_upload_intent(req, &principal.session.csrf_token)
        .await?;
    Ok(ApiResponse::success_with_request_id(upload, request_id.0))
}

pub async fn upload_asset(
    State(state): State<AppState>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(asset_id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
        UserRole::Grader,
        UserRole::Student,
    ])?;
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream");
    let service = MediaService::new(state.db_pool(), state.media_object_store.clone())?;
    service.store_upload(asset_id, content_type, body).await?;
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
    let service = MediaService::new(state.db_pool(), state.media_object_store.clone())?;
    let asset = service.complete_upload(asset_id, req).await?;
    Ok(ApiResponse::success_with_request_id(asset, request_id.0))
}

pub async fn get_asset(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(asset_id): Path<Uuid>,
) -> Result<ApiResponse<MediaAsset>, ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
        UserRole::Grader,
        UserRole::Student,
    ])?;
    let service = MediaService::new(state.db_pool(), state.media_object_store.clone())?;
    let asset = service.get_asset(asset_id).await?;
    Ok(ApiResponse::success_with_request_id(asset, request_id.0))
}

pub async fn get_asset_content(
    State(state): State<AppState>,
    principal: AuthenticatedUser,
    Path(asset_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
        UserRole::Grader,
        UserRole::Student,
    ])?;
    let service = MediaService::new(state.db_pool(), state.media_object_store.clone())?;
    let (content_type, bytes) = service.get_asset_content(asset_id).await?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "private, max-age=300")
        .body(axum::body::Body::from(bytes))
        .map_err(|error| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "MEDIA_RESPONSE_ERROR",
                &error.to_string(),
            )
        })
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
            MediaError::Storage(err) => ApiError::new(
                StatusCode::BAD_GATEWAY,
                "MEDIA_STORAGE_ERROR",
                &err.to_string(),
            ),
            MediaError::InvalidUpload(message) => {
                ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "INVALID_MEDIA", &message)
            }
        }
    }
}
