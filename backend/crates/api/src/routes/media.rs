use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use ielts_backend_application::media::{MediaError, MediaService};
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::grading::{
    CompleteUploadRequest, MediaAsset, UploadIntent, UploadIntentRequest,
};
use ielts_backend_infrastructure::object_store::LocalObjectStore;
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
    let service = MediaService::new(
        state.db_pool(),
        LocalObjectStore::from_base_url(&state.config.media_base_url),
    );
    let upload = service.create_upload_intent(req).await?;
    Ok(ApiResponse::success_with_request_id(upload, request_id.0))
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
    let service = MediaService::new(
        state.db_pool(),
        LocalObjectStore::from_base_url(&state.config.media_base_url),
    );
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
    let service = MediaService::new(
        state.db_pool(),
        LocalObjectStore::from_base_url(&state.config.media_base_url),
    );
    let asset = service.get_asset(asset_id).await?;
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
        }
    }
}
