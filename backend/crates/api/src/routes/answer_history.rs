use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
};
use ielts_backend_application::answer_history::{AnswerHistoryError, AnswerHistoryService};
use ielts_backend_application::auth::AuthService;
use ielts_backend_domain::answer_history::{AnswerHistoryExportFormat, AnswerHistoryTargetType};
use ielts_backend_domain::auth::UserRole;
use sqlx::query_scalar;
use uuid::Uuid;

use crate::{
    http::{
        auth::AuthenticatedUser,
        request_id::RequestId,
        response::{ApiError, ApiResponse},
    },
    state::AppState,
};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailQuery {
    pub target_type: Option<AnswerHistoryTargetType>,
    pub cursor: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportQuery {
    pub target_type: AnswerHistoryTargetType,
    pub target_id: String,
    pub format: AnswerHistoryExportFormat,
}

pub async fn get_overview(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(submission_id): Path<Uuid>,
) -> Result<ApiResponse<ielts_backend_domain::answer_history::AnswerHistoryOverview>, ApiError> {
    let schedule_id = schedule_id_for_submission(&state, submission_id).await?;
    authorize_schedule(&state, &principal, schedule_id).await?;

    let service = AnswerHistoryService::new(state.db_pool());
    let overview = service.get_overview(submission_id).await?;
    Ok(ApiResponse::success_with_request_id(overview, request_id.0))
}

pub async fn get_overview_by_attempt(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(attempt_id): Path<Uuid>,
) -> Result<ApiResponse<ielts_backend_domain::answer_history::AnswerHistoryOverview>, ApiError> {
    let schedule_id = schedule_id_for_attempt(&state, attempt_id).await?;
    authorize_schedule(&state, &principal, schedule_id).await?;

    let service = AnswerHistoryService::new(state.db_pool());
    let overview = service.get_overview_by_attempt(attempt_id).await?;
    Ok(ApiResponse::success_with_request_id(overview, request_id.0))
}

pub async fn get_target_detail_by_attempt(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path((attempt_id, target_id)): Path<(Uuid, String)>,
    Query(query): Query<DetailQuery>,
) -> Result<ApiResponse<ielts_backend_domain::answer_history::AnswerHistoryTargetDetail>, ApiError>
{
    let schedule_id = schedule_id_for_attempt(&state, attempt_id).await?;
    authorize_schedule(&state, &principal, schedule_id).await?;

    let service = AnswerHistoryService::new(state.db_pool());
    let detail = service
        .get_target_detail_by_attempt(
            attempt_id,
            query
                .target_type
                .unwrap_or(AnswerHistoryTargetType::Objective),
            &target_id,
            query.cursor,
            query.limit.unwrap_or(200),
        )
        .await?;

    Ok(ApiResponse::success_with_request_id(detail, request_id.0))
}

pub async fn get_target_detail(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path((submission_id, target_id)): Path<(Uuid, String)>,
    Query(query): Query<DetailQuery>,
) -> Result<ApiResponse<ielts_backend_domain::answer_history::AnswerHistoryTargetDetail>, ApiError>
{
    let schedule_id = schedule_id_for_submission(&state, submission_id).await?;
    authorize_schedule(&state, &principal, schedule_id).await?;

    let service = AnswerHistoryService::new(state.db_pool());
    let detail = service
        .get_target_detail(
            submission_id,
            query
                .target_type
                .unwrap_or(AnswerHistoryTargetType::Objective),
            &target_id,
            query.cursor,
            query.limit.unwrap_or(200),
        )
        .await?;

    Ok(ApiResponse::success_with_request_id(detail, request_id.0))
}

pub async fn export_target(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(submission_id): Path<Uuid>,
    Query(query): Query<ExportQuery>,
) -> Result<ApiResponse<ielts_backend_domain::answer_history::AnswerHistoryExport>, ApiError> {
    let schedule_id = schedule_id_for_submission(&state, submission_id).await?;
    authorize_schedule(&state, &principal, schedule_id).await?;

    let service = AnswerHistoryService::new(state.db_pool());
    let exported = service
        .export_target(
            submission_id,
            query.target_type,
            &query.target_id,
            query.format,
        )
        .await?;

    Ok(ApiResponse::success_with_request_id(exported, request_id.0))
}

async fn schedule_id_for_submission(
    state: &AppState,
    submission_id: Uuid,
) -> Result<Uuid, ApiError> {
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

    Uuid::parse_str(&schedule_id).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "PARSE_ERROR",
            "Invalid schedule ID",
        )
    })
}

async fn schedule_id_for_attempt(state: &AppState, attempt_id: Uuid) -> Result<Uuid, ApiError> {
    let schedule_id: String = query_scalar("SELECT schedule_id FROM student_attempts WHERE id = ?")
        .bind(attempt_id.to_string())
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

    Uuid::parse_str(&schedule_id).map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "PARSE_ERROR",
            "Invalid schedule ID",
        )
    })
}

async fn authorize_schedule(
    state: &AppState,
    principal: &AuthenticatedUser,
    schedule_id: Uuid,
) -> Result<(), ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::AdminObserver,
        UserRole::Grader,
        UserRole::Proctor,
    ])?;

    if matches!(
        principal.user.role,
        UserRole::Admin | UserRole::AdminObserver
    ) {
        return Ok(());
    }

    let role = if principal.user.role == UserRole::Proctor {
        UserRole::Proctor
    } else {
        UserRole::Grader
    };

    AuthService::new(state.db_pool(), state.config.clone())
        .authorize_staff_schedule(
            &ielts_backend_application::auth::AuthenticatedSession {
                user: principal.user.clone(),
                session: principal.session.clone(),
            },
            schedule_id.to_string(),
            role,
        )
        .await
        .map(|_| ())
        .map_err(|_| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))
}

impl From<AnswerHistoryError> for ApiError {
    fn from(err: AnswerHistoryError) -> Self {
        match err {
            AnswerHistoryError::NotFound => {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            }
            AnswerHistoryError::Validation(msg) => {
                ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", &msg)
            }
            AnswerHistoryError::Database(err) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                &err.to_string(),
            ),
        }
    }
}
