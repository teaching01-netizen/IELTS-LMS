use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    Json,
};
use ielts_backend_application::auth::AuthService;
use chrono::Utc;
use ielts_backend_application::proctoring::{ProctoringError, ProctoringService};
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::schedule::{
    AlertAckRequest, AttemptCommandRequest, CompleteExamRequest, ExtendSectionRequest,
    ProctorPresence, ProctorPresenceRequest, ProctorSessionDetail, ProctorSessionSummary,
    SessionAuditLog,
};
use ielts_backend_infrastructure::actor_context::ActorContext;
use sqlx::query_scalar;
use uuid::Uuid;

use crate::{
    http::{
        auth::{AuthenticatedUser, VerifiedCsrf},
        request_id::RequestId,
        response::{ApiError, ApiResponse},
    },
    state::AppState,
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveModeQuery {
    pub schedule_id: Option<Uuid>,
}

pub async fn list_sessions(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
) -> Result<ApiResponse<Vec<ProctorSessionSummary>>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Proctor])?;
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let sessions = service.list_sessions(state.live_mode_enabled).await?;
    let sessions = if principal.user.role == UserRole::Admin {
        sessions
    } else {
        let allowed = assigned_schedule_ids(&state, &principal.user.id, "proctor").await?;
        sessions
            .into_iter()
            .filter(|session| allowed.contains(&session.schedule.id))
            .collect()
    };
    state
        .telemetry
        .observe_db_operation("proctor.list_sessions", started.elapsed());
    Ok(ApiResponse::success_with_request_id(sessions, request_id.0))
}

pub async fn get_session(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(schedule_id): Path<Uuid>,
) -> Result<ApiResponse<ProctorSessionDetail>, ApiError> {
    authorize_schedule(&state, &principal, schedule_id).await?;
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let detail = service
        .get_session_detail(schedule_id, state.live_mode_enabled)
        .await?;
    state
        .telemetry
        .observe_db_operation("proctor.get_session_detail", started.elapsed());
    for alert in &detail.alerts {
        if !alert.is_acknowledged {
            let latency = Utc::now()
                .signed_duration_since(alert.timestamp)
                .to_std()
                .unwrap_or_default();
            state.telemetry.observe_violation_to_alert(latency);
        }
    }
    Ok(ApiResponse::success_with_request_id(detail, request_id.0))
}

pub async fn refresh_presence(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(schedule_id): Path<Uuid>,
    Json(req): Json<ProctorPresenceRequest>,
) -> Result<ApiResponse<Vec<ProctorPresence>>, ApiError> {
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let presence = service
        .record_presence(
            &ctx,
            schedule_id,
            &principal.user.id,
            &principal.display_name(),
            req,
        )
        .await?;
    state
        .telemetry
        .observe_db_operation("proctor.record_presence", started.elapsed());
    Ok(ApiResponse::success_with_request_id(presence, request_id.0))
}

pub async fn end_section_now(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(schedule_id): Path<Uuid>,
    Json(req): Json<AttemptCommandRequest>,
) -> Result<ApiResponse<ielts_backend_domain::schedule::ExamSessionRuntime>, ApiError> {
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let runtime = service
        .end_section_now(&ctx, schedule_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("proctor.end_section_now", started.elapsed());
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "schedule_runtime".to_owned(),
        id: schedule_id.to_string(),
        revision: i64::from(runtime.revision),
        event: "end_section_now".to_owned(),
    });
    Ok(ApiResponse::success_with_request_id(runtime, request_id.0))
}

pub async fn extend_section(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(schedule_id): Path<Uuid>,
    Json(req): Json<ExtendSectionRequest>,
) -> Result<ApiResponse<ielts_backend_domain::schedule::ExamSessionRuntime>, ApiError> {
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let runtime = service
        .extend_section(&ctx, schedule_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("proctor.extend_section", started.elapsed());
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "schedule_runtime".to_owned(),
        id: schedule_id.to_string(),
        revision: i64::from(runtime.revision),
        event: "extend_section".to_owned(),
    });
    Ok(ApiResponse::success_with_request_id(runtime, request_id.0))
}

pub async fn complete_exam(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(schedule_id): Path<Uuid>,
    Json(req): Json<CompleteExamRequest>,
) -> Result<ApiResponse<ielts_backend_domain::schedule::ExamSessionRuntime>, ApiError> {
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let runtime = service
        .complete_exam(&ctx, schedule_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("proctor.complete_exam", started.elapsed());
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "schedule_runtime".to_owned(),
        id: schedule_id.to_string(),
        revision: i64::from(runtime.revision),
        event: "complete_exam".to_owned(),
    });
    Ok(ApiResponse::success_with_request_id(runtime, request_id.0))
}

pub async fn warn_attempt(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path((schedule_id, attempt_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<AttemptCommandRequest>,
) -> Result<ApiResponse<ielts_backend_domain::schedule::StudentSessionSummary>, ApiError> {
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let session = service
        .warn_attempt(&ctx, schedule_id, attempt_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("proctor.warn_attempt", started.elapsed());
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "schedule_roster".to_owned(),
        id: schedule_id.to_string(),
        revision: 0,
        event: "attempt_changed".to_owned(),
    });
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "attempt".to_owned(),
        id: attempt_id.to_string(),
        revision: 0,
        event: "attempt_changed".to_owned(),
    });
    Ok(ApiResponse::success_with_request_id(session, request_id.0))
}

pub async fn pause_attempt(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path((schedule_id, attempt_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<AttemptCommandRequest>,
) -> Result<ApiResponse<ielts_backend_domain::schedule::StudentSessionSummary>, ApiError> {
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let session = service
        .pause_attempt(&ctx, schedule_id, attempt_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("proctor.pause_attempt", started.elapsed());
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "schedule_roster".to_owned(),
        id: schedule_id.to_string(),
        revision: 0,
        event: "attempt_changed".to_owned(),
    });
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "attempt".to_owned(),
        id: attempt_id.to_string(),
        revision: 0,
        event: "attempt_changed".to_owned(),
    });
    Ok(ApiResponse::success_with_request_id(session, request_id.0))
}

pub async fn resume_attempt(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path((schedule_id, attempt_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<AttemptCommandRequest>,
) -> Result<ApiResponse<ielts_backend_domain::schedule::StudentSessionSummary>, ApiError> {
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let session = service
        .resume_attempt(&ctx, schedule_id, attempt_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("proctor.resume_attempt", started.elapsed());
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "schedule_roster".to_owned(),
        id: schedule_id.to_string(),
        revision: 0,
        event: "attempt_changed".to_owned(),
    });
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "attempt".to_owned(),
        id: attempt_id.to_string(),
        revision: 0,
        event: "attempt_changed".to_owned(),
    });
    Ok(ApiResponse::success_with_request_id(session, request_id.0))
}

pub async fn terminate_attempt(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path((schedule_id, attempt_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<AttemptCommandRequest>,
) -> Result<ApiResponse<ielts_backend_domain::schedule::StudentSessionSummary>, ApiError> {
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let session = service
        .terminate_attempt(&ctx, schedule_id, attempt_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("proctor.terminate_attempt", started.elapsed());
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "schedule_roster".to_owned(),
        id: schedule_id.to_string(),
        revision: 0,
        event: "attempt_changed".to_owned(),
    });
    state.live_updates.publish(ielts_backend_domain::schedule::LiveUpdateEvent {
        kind: "attempt".to_owned(),
        id: attempt_id.to_string(),
        revision: 0,
        event: "attempt_changed".to_owned(),
    });
    Ok(ApiResponse::success_with_request_id(session, request_id.0))
}

pub async fn acknowledge_alert(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(alert_id): Path<Uuid>,
    Json(req): Json<AlertAckRequest>,
) -> Result<ApiResponse<SessionAuditLog>, ApiError> {
    let schedule_id_str: String = sqlx::query_scalar(
        "SELECT schedule_id FROM session_audit_logs WHERE id = ?",
    )
    .bind(alert_id.to_string())
    .fetch_optional(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
    .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))?;
    let schedule_id: Uuid = Uuid::parse_str(&schedule_id_str)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "PARSE_ERROR", "Invalid schedule ID in audit log"))?;
    authorize_schedule(&state, &principal, schedule_id).await?;
    let ctx = crate::http::auth::actor_context_from_principal(&principal)
        .with_schedule_scope_id(schedule_id.to_string());
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let alert = service
        .acknowledge_alert(&ctx, alert_id, req)
        .await?;
    state
        .telemetry
        .observe_db_operation("proctor.acknowledge_alert", started.elapsed());
    Ok(ApiResponse::success_with_request_id(alert, request_id.0))
}

pub async fn live_mode(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Query(query): Query<LiveModeQuery>,
) -> Result<ApiResponse<ielts_backend_domain::schedule::DegradedLiveState>, ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Proctor])?;
    let service = ProctoringService::new(state.db_pool());
    let started = std::time::Instant::now();
    let snapshot = service
        .live_mode(query.schedule_id, state.live_mode_enabled)
        .await?;
    state
        .telemetry
        .observe_db_operation("proctor.live_mode", started.elapsed());
    Ok(ApiResponse::success_with_request_id(snapshot, request_id.0))
}

async fn authorize_schedule(
    state: &AppState,
    principal: &AuthenticatedUser,
    schedule_id: Uuid,
) -> Result<(), ApiError> {
    principal.require_one_of(&[UserRole::Admin, UserRole::Proctor])?;
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
            UserRole::Proctor,
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
    role: &str,
) -> Result<std::collections::HashSet<String>, ApiError> {
    let rows = query_scalar::<_, String>(
        r#"
        SELECT schedule_id
        FROM schedule_staff_assignments
        WHERE user_id = ?
          AND role = ?
          AND revoked_at IS NULL
        "#,
    )
    .bind(user_id)
    .bind(role)
    .fetch_all(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?;
    Ok(rows.into_iter().collect())
}

impl From<ProctoringError> for ApiError {
    fn from(err: ProctoringError) -> Self {
        match err {
            ProctoringError::Conflict(msg) => ApiError::new(StatusCode::CONFLICT, "CONFLICT", &msg),
            ProctoringError::NotFound => {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            }
            ProctoringError::Validation(msg) => {
                ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", &msg)
            }
            ProctoringError::Database(err) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                &err.to_string(),
            ),
        }
    }
}
