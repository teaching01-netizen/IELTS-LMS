use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
};
use ielts_backend_application::assessment_release::{
    AssessmentReleaseError, AssessmentReleaseService, AssessmentReleaseState,
};
use ielts_backend_domain::auth::UserRole;

use crate::{
    http::{
        auth::AuthenticatedUser,
        request_id::RequestId,
        response::{ApiError, ApiResponse},
    },
    state::AppState,
};

fn map_error(error: AssessmentReleaseError) -> ApiError {
    match error {
        AssessmentReleaseError::Database(error) => ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &error.to_string(),
        ),
        AssessmentReleaseError::NotFound => ApiError::new(
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
            "Assessment release not found.",
        ),
        AssessmentReleaseError::Invariant(message) => ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "ASSESSMENT_RELEASE_INVARIANT",
            &message,
        ),
        AssessmentReleaseError::UnsupportedProvider => ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "UNSUPPORTED_PROVIDER",
            "Assessment release is only available for SAT exams.",
        ),
    }
}

pub async fn get_release_state(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(exam_id): Path<String>,
) -> Result<ApiResponse<AssessmentReleaseState>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::AdminObserver, UserRole::Builder])?;
    let ctx = principal.actor_context();
    ielts_backend_application::builder::BuilderService::new(state.db_pool())
        .get_exam(&ctx, exam_id.clone())
        .await
        .map_err(ApiError::from)?;
    let release = AssessmentReleaseService::new(state.db_pool())
        .get(&exam_id)
        .await
        .map_err(map_error)?;
    Ok(ApiResponse::success_with_request_id(release, request_id.0))
}
