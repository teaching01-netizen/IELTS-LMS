use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    Json,
};
use ielts_backend_application::scheduling::{SchedulingError, SchedulingService};
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::attempt::StudentRegistrationRequest;
use ielts_backend_domain::schedule::{
    CreateScheduleRequest, ExamSchedule, ExamSessionRuntime, RuntimeCommandRequest,
    UpdateScheduleRequest,
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

pub async fn list_schedules(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
) -> Result<ApiResponse<Vec<ExamSchedule>>, ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
        UserRole::Grader,
    ])?;
    let ctx = principal.actor_context();
    let service = SchedulingService::new(state.db_pool());
    let schedules = service.list_schedules(&ctx).await?;
    Ok(ApiResponse::success_with_request_id(
        schedules,
        request_id.0,
    ))
}

pub async fn create_schedule(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Json(req): Json<CreateScheduleRequest>,
) -> Result<ApiResponse<ExamSchedule>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = SchedulingService::new(state.db_pool());
    let schedule = service.create_schedule(&ctx, req).await?;
    Ok(ApiResponse::success_with_request_id(schedule, request_id.0))
}

pub async fn get_schedule(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<ApiResponse<ExamSchedule>, ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
        UserRole::Grader,
    ])?;
    let ctx = principal.actor_context();
    let service = SchedulingService::new(state.db_pool());
    let schedule = service.get_schedule(&ctx, id).await?;
    Ok(ApiResponse::success_with_request_id(schedule, request_id.0))
}

pub async fn update_schedule(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateScheduleRequest>,
) -> Result<ApiResponse<ExamSchedule>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = SchedulingService::new(state.db_pool());
    let schedule = service.update_schedule(&ctx, id, req).await?;
    Ok(ApiResponse::success_with_request_id(schedule, request_id.0))
}

pub async fn delete_schedule(
    State(state): State<AppState>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Builder])?;
    let ctx = principal.actor_context();
    let service = SchedulingService::new(state.db_pool());
    service.delete_schedule(&ctx, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_runtime(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<ApiResponse<ExamSessionRuntime>, ApiError> {
    principal.require_one_of(&[
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
        UserRole::Grader,
    ])?;
    let ctx = principal.actor_context();
    let service = SchedulingService::new(state.db_pool());
    let runtime = service.get_runtime(&ctx, id).await?;
    Ok(ApiResponse::success_with_request_id(runtime, request_id.0))
}

pub async fn apply_runtime_command(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(id): Path<Uuid>,
    Json(req): Json<RuntimeCommandRequest>,
) -> Result<ApiResponse<ExamSessionRuntime>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Proctor])?;
    let ctx = principal.actor_context();
    let service = SchedulingService::new(state.db_pool());
    let event = match req.action {
        ielts_backend_domain::schedule::RuntimeCommandAction::StartRuntime => "start_runtime",
        ielts_backend_domain::schedule::RuntimeCommandAction::PauseRuntime => "pause_runtime",
        ielts_backend_domain::schedule::RuntimeCommandAction::ResumeRuntime => "resume_runtime",
        ielts_backend_domain::schedule::RuntimeCommandAction::EndRuntime => "complete_runtime",
    };
    let runtime = service.apply_runtime_command(&ctx, id, req).await?;
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "schedule_runtime".to_owned(),
        id: id.to_string(),
        revision: i64::from(runtime.revision),
        event: event.to_owned(),
    });
    Ok(ApiResponse::success_with_request_id(runtime, request_id.0))
}

pub async fn create_student_registration(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(schedule_id): Path<Uuid>,
    Json(req): Json<StudentRegistrationRequest>,
) -> Result<ApiResponse<ielts_backend_domain::attempt::StudentRegistrationResponse>, ApiError> {
    principal.require_one_of(&[
        UserRole::Student,
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
    ])?;
    let ctx = principal.actor_context();
    let service = SchedulingService::new(state.db_pool());
    
    // Use the authenticated user's ID for registration
    let user_id = Uuid::parse_str(&principal.user.id)
        .map_err(|_| ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", "Invalid user ID format"))?;
    
    let registration = service
        .create_student_registration(
            &ctx,
            schedule_id,
            req.wcode,
            req.email,
            req.student_name,
            user_id,
        )
        .await?;

    Ok(ApiResponse::success_with_request_id(
        ielts_backend_domain::attempt::StudentRegistrationResponse {
            registration_id: registration.id.to_string(),
            wcode: registration.wcode,
            email: registration.email,
            student_name: registration.student_name,
            access_state: registration.access_state,
        },
        request_id.0,
    ))
}

impl From<SchedulingError> for ApiError {
    fn from(err: SchedulingError) -> Self {
        match err {
            SchedulingError::Conflict(msg) => ApiError::new(StatusCode::CONFLICT, "CONFLICT", &msg),
            SchedulingError::NotFound => {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            }
            SchedulingError::Validation(msg) => {
                ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", &msg)
            }
            SchedulingError::Database(err) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                &err.to_string(),
            ),
        }
    }
}
