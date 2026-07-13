use axum::{
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;
use ielts_backend_application::auth::{AuthService, StudentAccess};
use ielts_backend_application::delivery::{
    DeliveryConflictReason, DeliveryError, DeliveryService, MutationBatchResponseMode,
};
use ielts_backend_application::student_access::{
    StudentAccessRepository, StudentAccessRepositoryError,
};
use ielts_backend_domain::attempt::{
    HeartbeatEventType, MutationCommand, MutationEnvelope, QuestionIdMutationPayload,
    QuestionSlotIdMutationPayload, QuestionSlotValueMutationPayload, QuestionValueMutationPayload,
    StudentAuditLogRequest, StudentBootstrapRequest, StudentHeartbeatRequest,
    StudentHeartbeatResponse, StudentLiveSessionContext, StudentMutationBatchRequest,
    StudentMutationBatchResponse, StudentPrecheckRequest, StudentSessionContext,
    StudentSessionQuery, StudentStaticSessionContext, StudentSubmitRequest, StudentSubmitResponse,
    TaskIdMutationPayload, TaskValueMutationPayload,
};
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::schedule::AuditActionType;
use serde_json::{json, Value};
use std::time::Instant;
use uuid::Uuid;

use ielts_backend_infrastructure::rate_limit::{RateLimitConfig, RateLimitKey, RateLimitResult};

use crate::{
    http::{
        auth::{AttemptPrincipal, AuthenticatedUser, VerifiedCsrf},
        request_id::RequestId,
        response::{ApiError, ApiResponse},
    },
    state::AppState,
};

fn delivery_service(state: &AppState) -> DeliveryService {
    DeliveryService::with_auth_runtime_tuning(
        state.db_pool(),
        state.config.clone(),
        state.config.retention_idempotency_usable_hours,
        state.config.retention_idempotency_submit_usable_hours,
        state.config.retention_idempotency_violation_usable_hours,
        state.config.heartbeat_presence_min_write_interval_secs,
    )
}

fn student_access_repository(state: &AppState) -> StudentAccessRepository {
    StudentAccessRepository::new(state.db_pool())
}

const STUDENT_LIFECYCLE_SAMPLE_HEADER: &str = "x-student-lifecycle-sampled";
const STUDENT_FLUSH_CYCLE_ID_HEADER: &str = "x-student-flush-cycle-id";
const STUDENT_SUBMIT_CYCLE_ID_HEADER: &str = "x-student-submit-cycle-id";
const PREVIEW_CANDIDATE_NAME: &str = "Preview Candidate";

fn header_bool(headers: &HeaderMap, key: &str) -> bool {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn header_string(headers: &HeaderMap, key: &str) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

pub async fn get_student_session(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(schedule_id): Path<Uuid>,
    Query(query): Query<StudentSessionQuery>,
) -> Result<ApiResponse<StudentSessionContext>, ApiError> {
    principal.require_one_of(&[
        UserRole::Student,
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
    ])?;
    let access = authorize_student(
        &state,
        &principal,
        schedule_id,
        query.candidate_id.as_deref(),
    )
    .await?;
    let service = delivery_service(&state);
    let started = Instant::now();

    let wcode = if !access.wcode.is_empty() {
        Some(access.wcode.clone())
    } else {
        None
    };

    let session = if query.refresh_attempt_credential.unwrap_or(false) {
        service
            .get_session_context_with_attempt_credential(
                schedule_id,
                wcode,
                access.legacy_student_key.clone(),
                query.candidate_id.clone(),
                &ielts_backend_application::auth::AuthenticatedSession {
                    user: principal.user.clone(),
                    session: principal.session.clone(),
                },
                query.client_session_id.clone(),
            )
            .await?
    } else {
        service
            .get_session_context(
                schedule_id,
                wcode,
                access.legacy_student_key.clone(),
                query.candidate_id.clone(),
            )
            .await?
    };
    state
        .telemetry
        .observe_db_operation("delivery.get_session_context", started.elapsed());
    Ok(ApiResponse::success_with_request_id(session, request_id.0))
}

pub async fn get_student_static_session(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(schedule_id): Path<Uuid>,
) -> Result<ApiResponse<StudentStaticSessionContext>, ApiError> {
    principal.require_one_of(&[
        UserRole::Student,
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
    ])?;
    authorize_student(&state, &principal, schedule_id, None).await?;
    let service = delivery_service(&state);
    let started = Instant::now();
    let session = service.get_static_session_context(schedule_id).await?;
    state
        .telemetry
        .observe_db_operation("delivery.get_static_session_context", started.elapsed());
    Ok(ApiResponse::success_with_request_id(session, request_id.0))
}

pub async fn get_student_live_session(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    Path(schedule_id): Path<Uuid>,
    Query(query): Query<StudentSessionQuery>,
) -> Result<ApiResponse<StudentLiveSessionContext>, ApiError> {
    principal.require_one_of(&[
        UserRole::Student,
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
    ])?;

    let per_schedule_key = RateLimitKey::Custom(format!("student.live.schedule:{schedule_id}"));
    let per_schedule_config = RateLimitConfig::new(
        state.config.rate_limit_student_live_per_schedule,
        state
            .config
            .rate_limit_student_live_per_schedule_window_secs,
    );
    if let RateLimitResult::Denied { retry_after } = state
        .check_exam_rate_limit(
            "student.live.schedule",
            &per_schedule_key,
            &per_schedule_config,
        )
        .await
    {
        let retry_after_secs = retry_after.as_secs().max(1);
        return Err(
            ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!(
                    "Live session refresh is temporarily overloaded for this schedule. Retry after {retry_after_secs} seconds."
                ),
            )
            .with_details(json!({
                "scope": "schedule",
                "retryAfterSeconds": retry_after_secs,
            })),
        );
    }

    let global_key = RateLimitKey::Custom("student.live.global".to_owned());
    let global_config = RateLimitConfig::new(
        state.config.rate_limit_student_live_global,
        state.config.rate_limit_student_live_global_window_secs,
    )
    .with_burst(50);
    if let RateLimitResult::Denied { retry_after } = state
        .check_exam_rate_limit("student.live.global", &global_key, &global_config)
        .await
    {
        let retry_after_secs = retry_after.as_secs().max(1);
        return Err(
            ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!(
                    "Live session service is temporarily overloaded. Retry after {retry_after_secs} seconds."
                ),
            )
            .with_details(json!({
                "scope": "global",
                "retryAfterSeconds": retry_after_secs,
            })),
        );
    }

    let access = authorize_student(
        &state,
        &principal,
        schedule_id,
        query.candidate_id.as_deref(),
    )
    .await?;
    let service = delivery_service(&state);
    let started = Instant::now();

    let wcode = if !access.wcode.is_empty() {
        Some(access.wcode.clone())
    } else {
        None
    };

    let session = service
        .get_live_session_context(
            schedule_id,
            wcode,
            query.student_key.or(access.legacy_student_key.clone()),
            query.candidate_id,
        )
        .await?;
    state
        .telemetry
        .observe_db_operation("delivery.get_live_session_context", started.elapsed());
    Ok(ApiResponse::success_with_request_id(session, request_id.0))
}

#[derive(Debug, Clone, Copy, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HeartbeatResponseMode {
    Full,
    Ack,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatQuery {
    pub response_mode: Option<HeartbeatResponseMode>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApiMutationBatchRequest {
    attempt_id: String,
    mutations: Vec<ApiMutationCommand>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApiLegacyMutationBatchRequest {
    attempt_id: String,
    #[serde(default)]
    student_key: Option<String>,
    #[serde(default)]
    client_session_id: Option<String>,
    mutations: Vec<ApiLegacyMutationEnvelope>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiMutationCommand {
    mutation_id: String,
    base_revision: i32,
    #[serde(flatten)]
    command: ApiMutationCommandPayload,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiLegacyMutationEnvelope {
    id: String,
    #[serde(default)]
    seq: Option<i64>,
    #[serde(default)]
    timestamp: Option<chrono::DateTime<Utc>>,
    #[serde(default)]
    base_revision: Option<i32>,
    #[serde(flatten)]
    command: MutationCommand,
}

#[derive(Debug, serde::Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum ApiMutationCommandPayload {
    SetSlot {
        #[serde(rename = "questionId")]
        question_id: String,
        #[serde(rename = "slotIndex")]
        slot_index: u32,
        value: String,
    },
    ClearSlot {
        #[serde(rename = "questionId")]
        question_id: String,
        #[serde(rename = "slotIndex")]
        slot_index: u32,
    },
    SetScalar {
        #[serde(rename = "questionId")]
        question_id: String,
        value: String,
    },
    ClearScalar {
        #[serde(rename = "questionId")]
        question_id: String,
    },
    SetChoice {
        #[serde(rename = "questionId")]
        question_id: String,
        value: Value,
    },
    ClearChoice {
        #[serde(rename = "questionId")]
        question_id: String,
    },
    SetFlag {
        #[serde(rename = "questionId")]
        question_id: String,
        value: bool,
    },
    SetEssayText {
        #[serde(rename = "taskId")]
        task_id: String,
        value: String,
    },
    ClearEssayText {
        #[serde(rename = "taskId")]
        task_id: String,
    },
}

impl ApiMutationCommandPayload {
    fn command(&self) -> MutationCommand {
        match self {
            Self::SetSlot {
                question_id,
                slot_index,
                value,
            } => MutationCommand::SetSlot(QuestionSlotValueMutationPayload {
                question_id: question_id.clone(),
                slot_index: *slot_index,
                value: Value::String(value.clone()),
            }),
            Self::ClearSlot {
                question_id,
                slot_index,
            } => MutationCommand::ClearSlot(QuestionSlotIdMutationPayload {
                question_id: question_id.clone(),
                slot_index: *slot_index,
            }),
            Self::SetScalar { question_id, value } => {
                MutationCommand::SetScalar(QuestionValueMutationPayload {
                    question_id: question_id.clone(),
                    value: Value::String(value.clone()),
                })
            }
            Self::ClearScalar { question_id } => {
                MutationCommand::ClearScalar(QuestionIdMutationPayload {
                    question_id: question_id.clone(),
                })
            }
            Self::SetChoice { question_id, value } => {
                MutationCommand::SetChoice(QuestionValueMutationPayload {
                    question_id: question_id.clone(),
                    value: value.clone(),
                })
            }
            Self::ClearChoice { question_id } => {
                MutationCommand::ClearChoice(QuestionIdMutationPayload {
                    question_id: question_id.clone(),
                })
            }
            Self::SetFlag { question_id, value } => {
                MutationCommand::Flag(QuestionValueMutationPayload {
                    question_id: question_id.clone(),
                    value: Value::Bool(*value),
                })
            }
            Self::SetEssayText { task_id, value } => {
                MutationCommand::SetEssayText(TaskValueMutationPayload {
                    task_id: task_id.clone(),
                    value: Value::String(value.clone()),
                })
            }
            Self::ClearEssayText { task_id } => {
                MutationCommand::ClearEssayText(TaskIdMutationPayload {
                    task_id: task_id.clone(),
                })
            }
        }
    }
}

fn parse_mutation_batch_request(
    payload: Value,
) -> Result<(String, Vec<MutationEnvelope>), ApiError> {
    if let Ok(parsed_new) = serde_json::from_value::<ApiMutationBatchRequest>(payload.clone()) {
        let mutations = parsed_new
            .mutations
            .iter()
            .enumerate()
            .map(|(index, mutation)| MutationEnvelope {
                id: mutation.mutation_id.clone(),
                seq: (index + 1) as i64,
                timestamp: Utc::now(),
                command: mutation.command.command(),
                base_revision: Some(mutation.base_revision),
            })
            .collect();
        return Ok((parsed_new.attempt_id, mutations));
    }

    let parsed_legacy =
        serde_json::from_value::<ApiLegacyMutationBatchRequest>(payload).map_err(|err| {
            ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "VALIDATION_ERROR",
                &format!("Invalid mutation batch payload: {err}"),
            )
        })?;

    // Intentional: keep optional legacy keys accepted but unused here so older clients remain compatible.
    let _ = &parsed_legacy.student_key;
    let _ = &parsed_legacy.client_session_id;

    let mutations = parsed_legacy
        .mutations
        .into_iter()
        .enumerate()
        .map(|(index, mutation)| {
            let _legacy_client_timestamp = mutation.timestamp;
            let command = allowlisted_legacy_command(mutation.command)?;
            Ok(MutationEnvelope {
                id: mutation.id,
                seq: mutation.seq.unwrap_or((index + 1) as i64),
                timestamp: Utc::now(),
                command,
                base_revision: mutation.base_revision,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok((parsed_legacy.attempt_id, mutations))
}

fn allowlisted_legacy_command(command: MutationCommand) -> Result<MutationCommand, ApiError> {
    match command {
        MutationCommand::SetSlot(_)
        | MutationCommand::ClearSlot(_)
        | MutationCommand::SetScalar(_)
        | MutationCommand::ClearScalar(_)
        | MutationCommand::SetChoice(_)
        | MutationCommand::ClearChoice(_)
        | MutationCommand::SetEssayText(_)
        | MutationCommand::ClearEssayText(_) => Ok(command),
        other => Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            &format!(
                "Legacy mutation type `{}` is not allowed for mutation batch.",
                other.mutation_type().as_str()
            ),
        )),
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ApiSubmitRequest {
    attempt_id: String,
    last_seen_revision: i32,
    submission_id: String,
    #[serde(default)]
    client_final_seq: Option<i64>,
    #[serde(default)]
    server_accepted_through_seq: Option<i64>,
    #[serde(default)]
    final_answer_patch: Option<Value>,
    #[serde(default)]
    final_client_snapshot_hash: Option<String>,
}

pub async fn save_precheck(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    headers: HeaderMap,
    _csrf: VerifiedCsrf,
    Path(schedule_id): Path<Uuid>,
    Json(req): Json<StudentPrecheckRequest>,
) -> Result<ApiResponse<ielts_backend_domain::attempt::StudentAttempt>, ApiError> {
    principal.require_one_of(&[
        UserRole::Student,
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
    ])?;
    let access = authorize_student(
        &state,
        &principal,
        schedule_id,
        Some(req.candidate_id.as_str()),
    )
    .await?;
    let service = delivery_service(&state);
    let started = Instant::now();

    let wcode = if !access.wcode.is_empty() {
        Some(access.wcode.clone())
    } else {
        None
    };

    let attempt = service
        .persist_precheck(
            schedule_id,
            StudentPrecheckRequest {
                wcode,
                email: Some(access.email.clone()),
                student_key: access_key(&access),
                candidate_id: access.student_id.clone(),
                candidate_name: access.student_name.clone(),
                candidate_email: access.email.clone(),
                client_session_id: req.client_session_id,
                pre_check: req.pre_check,
                device_fingerprint_hash: req.device_fingerprint_hash,
            },
            extract_idempotency_key(&headers)?,
        )
        .await?;
    state
        .telemetry
        .observe_db_operation("delivery.persist_precheck", started.elapsed());
    Ok(ApiResponse::success_with_request_id(attempt, request_id.0))
}

pub async fn bootstrap_student_session(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
    _csrf: VerifiedCsrf,
    Path(schedule_id): Path<Uuid>,
    Json(req): Json<StudentBootstrapRequest>,
) -> Result<ApiResponse<StudentSessionContext>, ApiError> {
    principal.require_one_of(&[
        UserRole::Student,
        UserRole::Admin,
        UserRole::Builder,
        UserRole::Proctor,
    ])?;

    // Apply per-user rate limiting for bootstrap
    let key = RateLimitKey::User(principal.user.id.clone());
    let config = RateLimitConfig::new(
        state.config.rate_limit_student_bootstrap_per_user,
        state
            .config
            .rate_limit_student_bootstrap_per_user_window_secs,
    );
    match state
        .check_exam_rate_limit("student.bootstrap", &key, &config)
        .await
    {
        RateLimitResult::Allowed { .. } => {}
        RateLimitResult::Denied { retry_after } => {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!(
                    "Too many bootstrap attempts. Retry after {} seconds.",
                    retry_after.as_secs()
                ),
            ));
        }
    }
    let access = authorize_student(
        &state,
        &principal,
        schedule_id,
        Some(req.candidate_id.as_str()),
    )
    .await?;
    let service = delivery_service(&state);
    let started = Instant::now();

    let wcode = if !access.wcode.is_empty() {
        Some(access.wcode.clone())
    } else {
        None
    };

    let session = service
        .bootstrap_with_attempt_credential(
            schedule_id,
            StudentBootstrapRequest {
                wcode,
                email: Some(access.email.clone()),
                student_key: access_key(&access),
                candidate_id: access.student_id.clone(),
                candidate_name: access.student_name.clone(),
                candidate_email: access.email.clone(),
                client_session_id: req.client_session_id,
            },
            &ielts_backend_application::auth::AuthenticatedSession {
                user: principal.user.clone(),
                session: principal.session.clone(),
            },
        )
        .await?;
    state
        .telemetry
        .observe_db_operation("delivery.bootstrap", started.elapsed());
    Ok(ApiResponse::success_with_request_id(session, request_id.0))
}

pub async fn apply_mutation_batch(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AttemptPrincipal,
    headers: HeaderMap,
    Path((schedule_id, _batch)): Path<(Uuid, String)>,
    Json(payload): Json<Value>,
) -> Result<ApiResponse<StudentMutationBatchResponse>, ApiError> {
    let (request_attempt_id, request_mutations) = parse_mutation_batch_request(payload)?;
    let attempt_id = principal.authorization.claims.attempt_id.clone();
    let sampled_success_logs = header_bool(&headers, STUDENT_LIFECYCLE_SAMPLE_HEADER);
    let flush_cycle_id = header_string(&headers, STUDENT_FLUSH_CYCLE_ID_HEADER);
    let claims_schedule_id = principal.authorization.claims.schedule_id.clone();
    let claims_client_session_id = principal.authorization.claims.client_session_id.clone();

    // Apply per-attempt rate limiting for mutations
    let key = RateLimitKey::Attempt(attempt_id.clone());
    let config = RateLimitConfig::new(
        state.config.rate_limit_mutation_per_attempt,
        state.config.rate_limit_mutation_per_attempt_window_secs,
    )
    .with_burst(50); // Allow burst for reconnect replay
    match state
        .check_exam_rate_limit("student.mutation_batch", &key, &config)
        .await
    {
        RateLimitResult::Allowed { .. } => {}
        RateLimitResult::Denied { retry_after } => {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!(
                    "Too many mutation attempts. Retry after {} seconds.",
                    retry_after.as_secs()
                ),
            ));
        }
    }

    if claims_schedule_id != schedule_id.to_string() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "Attempt credential does not match the schedule.",
        ));
    }
    if request_attempt_id != attempt_id {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "Body attemptId does not match the route-authorized attempt.",
        ));
    }

    if request_mutations.len() > state.config.max_mutations_per_batch {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            &format!(
                "Mutation batch exceeds the maximum of {} mutations.",
                state.config.max_mutations_per_batch
            ),
        ));
    }

    let contains_violation = false;
    let req = StudentMutationBatchRequest {
        attempt_id: attempt_id.clone(),
        student_key: load_attempt_student_key(&state, &attempt_id).await?,
        client_session_id: claims_client_session_id,
        mutations: request_mutations,
    };
    let requested_mutation_count = req.mutations.len();
    let service = delivery_service(&state);
    let started = Instant::now();
    let mut result = match service
        .apply_mutation_batch(
            schedule_id,
            req,
            // Public student mutation API is operation-command + full response only.
            MutationBatchResponseMode::Full,
            extract_idempotency_key(&headers)?,
        )
        .await
    {
        Ok(result) => result,
        Err(err) => {
            if let DeliveryError::Conflict {
                reason: Some(DeliveryConflictReason::AttemptSubmitted),
                ..
            } = &err
            {
                state.telemetry.observe_post_submit_grace_rejected();
                state
                    .telemetry
                    .observe_student_answer_loss_risk("post_submit_grace_elapsed");
            }
            let expected_section_transition_conflict = matches!(
                &err,
                DeliveryError::Conflict {
                    reason: Some(
                        DeliveryConflictReason::SectionMismatch
                            | DeliveryConflictReason::ObjectiveLocked
                    ),
                    ..
                }
            );
            if expected_section_transition_conflict {
                tracing::info!(
                    event = "student_save_lifecycle",
                    stage = "flush",
                    status = "failed",
                    schedule_id = %schedule_id,
                    attempt_id = %attempt_id,
                    flush_cycle_id = flush_cycle_id.as_deref().unwrap_or("missing"),
                    error = %err
                );
            } else {
                tracing::warn!(
                    event = "student_save_lifecycle",
                    stage = "flush",
                    status = "failed",
                    schedule_id = %schedule_id,
                    attempt_id = %attempt_id,
                    flush_cycle_id = flush_cycle_id.as_deref().unwrap_or("missing"),
                    error = %err
                );
            }
            return Err(err.into());
        }
    };
    let auth_service = AuthService::new(state.db_pool(), state.config.clone());
    result.refreshed_attempt_credential = auth_service
        .maybe_refresh_attempt_token(&principal.authorization)
        .await
        .map_err(map_auth_error)?;
    let duration = started.elapsed();
    state
        .telemetry
        .observe_db_operation("delivery.apply_mutation_batch", duration);
    state
        .telemetry
        .observe_answer_commit("mutation_batch", duration);
    state.telemetry.observe_mutation_batch_persistence(
        requested_mutation_count,
        result.applied_mutation_count,
        result.applied_mutation_count,
    );
    if result.accepted_in_grace && result.applied_mutation_count > 0 {
        state.telemetry.observe_post_submit_grace_accepted();
    }
    if sampled_success_logs {
        tracing::info!(
            event = "student_save_lifecycle",
            stage = "flush",
            status = "succeeded",
            schedule_id = %schedule_id,
            attempt_id = %attempt_id,
            flush_cycle_id = flush_cycle_id.as_deref().unwrap_or("missing"),
            requested_mutation_count = requested_mutation_count,
            applied_mutation_count = result.applied_mutation_count,
            server_accepted_through_seq = result.server_accepted_through_seq,
            duration_ms = duration.as_millis() as u64
        );
    }

    if contains_violation {
        state.publish_live_update(ielts_backend_domain::schedule::LiveUpdateEvent {
            kind: "schedule_roster".to_owned(),
            id: schedule_id.to_string(),
            revision: 0,
            event: "violation_snapshot_changed".to_owned(),
        });
    }
    Ok(ApiResponse::success_with_request_id(result, request_id.0))
}

pub async fn record_heartbeat(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AttemptPrincipal,
    Path(schedule_id): Path<Uuid>,
    Query(query): Query<HeartbeatQuery>,
    Json(mut req): Json<StudentHeartbeatRequest>,
) -> Result<ApiResponse<StudentHeartbeatResponse>, ApiError> {
    let attempt_id = principal.authorization.claims.attempt_id.clone();
    let claims_schedule_id = principal.authorization.claims.schedule_id.clone();
    let claims_client_session_id = principal.authorization.claims.client_session_id.clone();

    // Apply per-attempt rate limiting for heartbeats (generous limit)
    let key = RateLimitKey::Attempt(attempt_id.clone());
    let config = RateLimitConfig::new(
        state.config.rate_limit_heartbeat_per_attempt,
        state.config.rate_limit_heartbeat_per_attempt_window_secs,
    )
    .with_burst(20); // Small burst allowance
    match state
        .check_exam_rate_limit("student.heartbeat", &key, &config)
        .await
    {
        RateLimitResult::Allowed { .. } => {}
        RateLimitResult::Denied { retry_after } => {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!(
                    "Too many heartbeat attempts. Retry after {} seconds.",
                    retry_after.as_secs()
                ),
            ));
        }
    }

    if claims_schedule_id != schedule_id.to_string() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "Attempt credential does not match the schedule.",
        ));
    }
    req.attempt_id = Some(attempt_id.clone());
    req.client_session_id = claims_client_session_id;
    req.student_key = load_attempt_student_key(&state, &attempt_id).await?;
    let service = delivery_service(&state);
    let started = Instant::now();
    let event_type = req.event_type.clone();
    let ack_only = event_type == HeartbeatEventType::Heartbeat
        && query.response_mode != Some(HeartbeatResponseMode::Full);
    let attempt = service.record_heartbeat(schedule_id, req).await?;
    let runtime = if query.response_mode == Some(HeartbeatResponseMode::Full) {
        service
            .get_live_session_context(schedule_id, None, None, None)
            .await?
            .runtime
    } else {
        None
    };
    let auth_service = AuthService::new(state.db_pool(), state.config.clone());
    state
        .telemetry
        .observe_db_operation("delivery.record_heartbeat", started.elapsed());
    if event_type != HeartbeatEventType::Heartbeat {
        let event = match event_type {
            HeartbeatEventType::Disconnect => "network_disconnected",
            HeartbeatEventType::Reconnect => "network_reconnected",
            HeartbeatEventType::Lost => "heartbeat_lost",
            HeartbeatEventType::Heartbeat => "student_network",
        };
        state.publish_live_update(ielts_backend_domain::schedule::LiveUpdateEvent {
            kind: "schedule_alert".to_owned(),
            id: schedule_id.to_string(),
            revision: 0,
            event: event.to_owned(),
        });
    }
    Ok(ApiResponse::success_with_request_id(
        StudentHeartbeatResponse {
            attempt: if ack_only { None } else { Some(attempt) },
            runtime,
            refreshed_attempt_credential: auth_service
                .maybe_refresh_attempt_token(&principal.authorization)
                .await
                .map_err(map_auth_error)?,
        },
        request_id.0,
    ))
}

pub async fn record_audit(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AttemptPrincipal,
    Path(schedule_id): Path<Uuid>,
    Json(req): Json<StudentAuditLogRequest>,
) -> Result<ApiResponse<()>, ApiError> {
    let attempt_id = principal.authorization.claims.attempt_id.clone();
    let claims_schedule_id = principal.authorization.claims.schedule_id.clone();

    // Apply per-attempt rate limiting for audits
    let key = RateLimitKey::Attempt(attempt_id.clone());
    let config = RateLimitConfig::new(
        state.config.rate_limit_audit_per_attempt,
        state.config.rate_limit_audit_per_attempt_window_secs,
    )
    .with_burst(30);
    match state
        .check_exam_rate_limit("student.audit", &key, &config)
        .await
    {
        RateLimitResult::Allowed { .. } => {}
        RateLimitResult::Denied { retry_after } => {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!(
                    "Too many audit attempts. Retry after {} seconds.",
                    retry_after.as_secs()
                ),
            ));
        }
    }

    if claims_schedule_id != schedule_id.to_string() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "Attempt credential does not match the schedule.",
        ));
    }

    let candidate_name = load_attempt_candidate_name(&state, &attempt_id).await?;

    let client_timestamp = req.client_timestamp.clone();

    let mut payload_map = serde_json::Map::new();
    if let Some(client_timestamp) = client_timestamp.as_ref() {
        payload_map.insert("clientTimestamp".to_owned(), json!(client_timestamp));
    }
    if let Some(payload) = req.payload {
        match payload {
            Value::Object(fields) => {
                for (key, value) in fields {
                    payload_map.insert(key, value);
                }
            }
            other => {
                payload_map.insert("payload".to_owned(), other);
            }
        }
    }
    let payload_value = Value::Object(payload_map);

    let map_db_error = |err: sqlx::Error| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &err.to_string(),
        )
    };

    let mut tx = state.db_pool().begin().await.map_err(map_db_error)?;

    sqlx::query(
        r#"
        INSERT INTO session_audit_logs (
            id, schedule_id, actor, action_type, target_student_id, payload, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(schedule_id.to_string())
    .bind(&candidate_name)
    .bind(&req.action_type)
    .bind(&attempt_id)
    .bind(payload_value.clone())
    .execute(tx.as_mut())
    .await
    .map_err(map_db_error)?;

    if matches!(req.action_type, AuditActionType::ViolationDetected) {
        let violation_id = violation_business_id_from_payload(&payload_value)?;
        let violation_type = payload_value
            .get("violationType")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let severity = payload_value
            .get("severity")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let description = payload_value
            .get("message")
            .or_else(|| payload_value.get("description"))
            .and_then(Value::as_str)
            .unwrap_or("Violation detected.")
            .to_owned();

        if let (Some(violation_type), Some(severity)) = (violation_type, severity) {
            let allowed = matches!(severity.as_str(), "low" | "medium" | "high" | "critical");
            if allowed {
                let event_id = Uuid::new_v4();
                let insert_result = sqlx::query(
                    r#"
                    INSERT INTO student_violation_events (
                        id, schedule_id, attempt_id, violation_id, violation_type, severity, description, payload, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
                    ON DUPLICATE KEY UPDATE id = id
                    "#,
                )
                .bind(event_id.to_string())
                .bind(schedule_id.to_string())
                .bind(&attempt_id)
                .bind(&violation_id)
                .bind(&violation_type)
                .bind(&severity)
                .bind(&description)
                .bind(payload_value.clone())
                .execute(tx.as_mut())
                .await
                .map_err(map_db_error)?;

                if insert_result.rows_affected() == 1 {
                    let violation_json = json!({
                        "id": violation_id,
                        "type": violation_type,
                        "severity": severity,
                        "timestamp": client_timestamp.unwrap_or_else(Utc::now),
                        "description": description
                    });
                    sqlx::query(
                        r#"
                        UPDATE student_attempts
                        SET
                            violations_snapshot = JSON_MERGE_PRESERVE(COALESCE(violations_snapshot, JSON_ARRAY()), ?),
                            updated_at = NOW(),
                            revision = revision + 1
                        WHERE id = ? AND schedule_id = ?
                        "#,
                    )
                    .bind(violation_json)
                    .bind(&attempt_id)
                    .bind(schedule_id.to_string())
                    .execute(tx.as_mut())
                    .await
                    .map_err(map_db_error)?;
                }
            }
        }
    }

    tx.commit().await.map_err(map_db_error)?;

    let publish_alert = matches!(
        req.action_type.as_str(),
        "HEARTBEAT_LOST"
            | "DEVICE_CONTINUITY_FAILED"
            | "NETWORK_DISCONNECTED"
            | "AUTO_ACTION"
            | "STUDENT_WARN"
            | "STUDENT_PAUSE"
            | "STUDENT_TERMINATE"
            | "VIOLATION_DETECTED"
    );
    if publish_alert {
        state.publish_live_update(ielts_backend_domain::schedule::LiveUpdateEvent {
            kind: "schedule_alert".to_owned(),
            id: schedule_id.to_string(),
            revision: 0,
            event: "alert_changed".to_owned(),
        });
    }

    Ok(ApiResponse::success_with_request_id((), request_id.0))
}

pub async fn submit_student_session(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AttemptPrincipal,
    headers: HeaderMap,
    Path(schedule_id): Path<Uuid>,
    Json(payload): Json<Value>,
) -> Result<ApiResponse<StudentSubmitResponse>, ApiError> {
    let api_req: ApiSubmitRequest = serde_json::from_value(payload).map_err(|err| {
        ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            &format!("Invalid submit payload: {err}"),
        )
    })?;
    let attempt_id = principal.authorization.claims.attempt_id.clone();
    let sampled_success_logs = header_bool(&headers, STUDENT_LIFECYCLE_SAMPLE_HEADER);
    let submit_cycle_id = header_string(&headers, STUDENT_SUBMIT_CYCLE_ID_HEADER);
    let claims_schedule_id = principal.authorization.claims.schedule_id.clone();
    let claims_client_session_id = principal.authorization.claims.client_session_id.clone();

    // Apply strict per-attempt rate limiting for submit (idempotency enforcement)
    let key = RateLimitKey::Attempt(attempt_id.clone());
    let config = RateLimitConfig::new(
        state.config.rate_limit_submit_per_attempt,
        state.config.rate_limit_submit_per_attempt_window_secs,
    );
    match state
        .check_exam_rate_limit("student.submit", &key, &config)
        .await
    {
        RateLimitResult::Allowed { .. } => {}
        RateLimitResult::Denied { retry_after } => {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!(
                    "Too many submit attempts. Retry after {} seconds.",
                    retry_after.as_secs()
                ),
            ));
        }
    }

    if claims_schedule_id != schedule_id.to_string() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "Attempt credential does not match the schedule.",
        ));
    }
    if api_req.attempt_id != attempt_id {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "Body attemptId does not match the route-authorized attempt.",
        ));
    }
    let idempotency_key = require_idempotency_key(&headers, "submit")?;
    let req = StudentSubmitRequest {
        attempt_id: attempt_id.clone(),
        student_key: load_attempt_student_key(&state, &attempt_id).await?,
        last_seen_revision: Some(api_req.last_seen_revision),
        submission_id: Some(api_req.submission_id.clone()),
        client_session_id: Some(claims_client_session_id),
        client_final_seq: api_req.client_final_seq,
        server_accepted_through_seq: api_req.server_accepted_through_seq,
        final_answer_patch: api_req.final_answer_patch.clone(),
        final_client_snapshot_hash: api_req.final_client_snapshot_hash.clone(),
        answers: None,
        writing_answers: None,
        flags: None,
    };
    let replay_incomplete = match (
        api_req.client_final_seq,
        api_req.server_accepted_through_seq,
    ) {
        (Some(client_final_seq), Some(server_accepted_through_seq)) => {
            server_accepted_through_seq < client_final_seq
        }
        (Some(client_final_seq), None) => client_final_seq > 0,
        _ => false,
    };
    if replay_incomplete {
        state
            .telemetry
            .observe_student_answer_loss_risk("pending_seq_gap");
        state.telemetry.observe_submit_replay_incomplete();
    }
    let service = delivery_service(&state);
    let started = Instant::now();
    let submit_result = service
        .submit_attempt(schedule_id, req, Some(idempotency_key))
        .await;
    let mut submission = match submit_result {
        Ok(submission) => {
            if api_req.final_answer_patch.is_some() {
                state.telemetry.observe_submit_final_patch_applied();
            }
            submission
        }
        Err(err) => {
            if let DeliveryError::Conflict {
                reason: Some(reason),
                ..
            } = &err
            {
                match reason {
                    DeliveryConflictReason::FinalFlushRequired => {
                        state.telemetry.observe_submit_missing_seq();
                        state
                            .telemetry
                            .observe_student_answer_loss_risk("final_flush_required");
                    }
                    DeliveryConflictReason::FinalPayloadHashMismatch => {
                        state
                            .telemetry
                            .observe_submit_final_snapshot_hash_mismatch();
                    }
                    _ => {}
                }
            }
            tracing::warn!(
                event = "student_save_lifecycle",
                stage = "submit",
                status = "failed",
                schedule_id = %schedule_id,
                attempt_id = %attempt_id,
                submit_cycle_id = submit_cycle_id.as_deref().unwrap_or("missing"),
                error = %err
            );
            return Err(err.into());
        }
    };
    let auth_service = AuthService::new(state.db_pool(), state.config.clone());
    submission.refreshed_attempt_credential = auth_service
        .maybe_refresh_attempt_token(&principal.authorization)
        .await
        .map_err(map_auth_error)?;
    let duration = started.elapsed();
    state
        .telemetry
        .observe_db_operation("delivery.submit_attempt", duration);
    state.telemetry.observe_answer_commit("submit", duration);
    if sampled_success_logs {
        tracing::info!(
            event = "student_save_lifecycle",
            stage = "submit",
            status = "succeeded",
            schedule_id = %schedule_id,
            attempt_id = %attempt_id,
            submit_cycle_id = submit_cycle_id.as_deref().unwrap_or("missing"),
            duration_ms = duration.as_millis() as u64
        );
    }
    Ok(ApiResponse::success_with_request_id(
        submission,
        request_id.0,
    ))
}

impl From<DeliveryError> for ApiError {
    fn from(err: DeliveryError) -> Self {
        match err {
            DeliveryError::Conflict {
                message,
                reason,
                latest_revision,
                server_accepted_through_seq,
                active_session_id,
            } => {
                let api = ApiError::new(StatusCode::CONFLICT, "CONFLICT", &message);
                let mut details = serde_json::Map::new();
                if let Some(reason) = reason {
                    details.insert("reason".to_owned(), json!(reason.as_str()));
                }
                if let Some(latest_revision) = latest_revision {
                    details.insert("latestRevision".to_owned(), json!(latest_revision));
                }
                if let Some(server_accepted_through_seq) = server_accepted_through_seq {
                    details.insert(
                        "serverAcceptedThroughSeq".to_owned(),
                        json!(server_accepted_through_seq),
                    );
                }
                if let Some(active_session_id) = active_session_id {
                    details.insert("activeSessionId".to_owned(), json!(active_session_id));
                }
                if details.is_empty() {
                    api
                } else {
                    api.with_details(Value::Object(details))
                }
            }
            DeliveryError::NotFound => {
                ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
            }
            DeliveryError::Validation(msg) => {
                ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", &msg)
            }
            DeliveryError::Internal(msg) => {
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", &msg)
            }
            DeliveryError::Database(err) => ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                &err.to_string(),
            ),
        }
    }
}

fn extract_idempotency_key(headers: &HeaderMap) -> Result<Option<String>, ApiError> {
    let Some(value) = headers.get("Idempotency-Key") else {
        return Ok(None);
    };
    let value = value.to_str().map_err(|_| {
        ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "Idempotency-Key header must be valid ASCII text.",
        )
    })?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "Idempotency-Key header cannot be empty.",
        ));
    }

    Ok(Some(trimmed.to_owned()))
}

fn require_idempotency_key(headers: &HeaderMap, operation: &str) -> Result<String, ApiError> {
    extract_idempotency_key(headers)?.ok_or_else(|| {
        ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            &format!("Idempotency-Key header is required for {operation} requests."),
        )
    })
}

async fn authorize_student(
    state: &AppState,
    principal: &AuthenticatedUser,
    schedule_id: Uuid,
    candidate_id: Option<&str>,
) -> Result<StudentAccess, ApiError> {
    let auth_service = AuthService::new(state.db_pool(), state.config.clone());
    if let Ok(access) = auth_service
        .authorize_student_schedule(
            &ielts_backend_application::auth::AuthenticatedSession {
                user: principal.user.clone(),
                session: principal.session.clone(),
            },
            schedule_id,
        )
        .await
    {
        return Ok(access);
    }

    if matches!(principal.user.role, UserRole::Admin | UserRole::Builder)
        && is_preview_runtime_schedule(state, schedule_id).await?
    {
        let normalized_candidate_id = normalize_candidate_id(candidate_id);
        let student_key = build_student_key(schedule_id, &normalized_candidate_id);
        return Ok(StudentAccess {
            registration_id: Uuid::nil(),
            wcode: String::new(),
            email: principal.user.email.clone(),
            student_id: normalized_candidate_id,
            student_name: principal
                .user
                .display_name
                .clone()
                .unwrap_or_else(|| PREVIEW_CANDIDATE_NAME.to_owned()),
            legacy_student_key: Some(student_key),
        });
    }

    Err(ApiError::new(
        StatusCode::FORBIDDEN,
        "FORBIDDEN",
        "The authenticated student is not enrolled for this schedule.",
    ))
}

fn normalize_candidate_id(candidate_id: Option<&str>) -> String {
    let fallback = "W000000";
    let Some(raw) = candidate_id else {
        return fallback.to_owned();
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return fallback.to_owned();
    }

    trimmed.to_owned()
}

fn build_student_key(schedule_id: Uuid, candidate_id: &str) -> String {
    format!("student-{schedule_id}-{candidate_id}")
}

async fn is_preview_runtime_schedule(
    state: &AppState,
    schedule_id: Uuid,
) -> Result<bool, ApiError> {
    student_access_repository(state)
        .is_preview_runtime_schedule(schedule_id)
        .await
        .map_err(map_student_access_error)
}

fn access_key(access: &StudentAccess) -> String {
    access
        .legacy_student_key
        .clone()
        .unwrap_or_else(|| format!("student-{}-{}", access.registration_id, access.student_id))
}

async fn load_attempt_student_key(state: &AppState, attempt_id: &str) -> Result<String, ApiError> {
    student_access_repository(state)
        .load_attempt_student_key(attempt_id)
        .await
        .map_err(map_student_access_error)
}

async fn load_attempt_candidate_name(
    state: &AppState,
    attempt_id: &str,
) -> Result<String, ApiError> {
    student_access_repository(state)
        .load_attempt_candidate_name(attempt_id)
        .await
        .map_err(map_student_access_error)
}

fn map_student_access_error(error: StudentAccessRepositoryError) -> ApiError {
    match error {
        StudentAccessRepositoryError::Database(err) => ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &err.to_string(),
        ),
        StudentAccessRepositoryError::NotFound => {
            ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found")
        }
    }
}

fn map_auth_error(error: ielts_backend_application::auth::AuthError) -> ApiError {
    match error {
        ielts_backend_application::auth::AuthError::Database(err) => ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &err.to_string(),
        ),
        ielts_backend_application::auth::AuthError::InvalidCredentials
        | ielts_backend_application::auth::AuthError::Unauthorized => ApiError::new(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "Authentication is required for this route.",
        ),
        ielts_backend_application::auth::AuthError::Forbidden => ApiError::new(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "The authenticated user is not allowed to access this route.",
        ),
        ielts_backend_application::auth::AuthError::Conflict(message) => {
            ApiError::new(StatusCode::CONFLICT, "CONFLICT", &message)
        }
        ielts_backend_application::auth::AuthError::Validation(message) => ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            &message,
        ),
    }
}

fn violation_business_id_from_payload(payload: &Value) -> Result<String, ApiError> {
    let Some(raw) = payload.get("violationId").and_then(Value::as_str) else {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "payload.violationId is required for VIOLATION_DETECTED.",
        ));
    };

    let violation_id = raw.trim();
    if violation_id.is_empty() {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            "payload.violationId must not be empty.",
        ));
    }

    Ok(violation_id.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mutation_batch_rejects_unknown_top_level_fields() {
        let payload = json!({
            "attemptId": "attempt-1",
            "mutations": [],
            "answers": { "q1": "A" }
        });

        let parsed = serde_json::from_value::<ApiMutationBatchRequest>(payload);
        assert!(parsed.is_err());
    }

    #[test]
    fn mutation_batch_rejects_unknown_command_type() {
        let payload = json!({
            "attemptId": "attempt-1",
            "mutations": [{
                "mutationId": "m-1",
                "baseRevision": 0,
                "type": "ReplaceAnswer",
                "questionId": "q1",
                "value": "A"
            }]
        });

        let parsed = serde_json::from_value::<ApiMutationBatchRequest>(payload);
        assert!(parsed.is_err());
    }

    #[test]
    fn mutation_batch_rejects_unknown_command_fields() {
        let payload = json!({
            "attemptId": "attempt-1",
            "mutations": [{
                "mutationId": "m-1",
                "baseRevision": 0,
                "type": "SetScalar",
                "questionId": "q1",
                "value": "A",
                "answers": ["A", "B"]
            }]
        });

        let parsed = serde_json::from_value::<ApiMutationBatchRequest>(payload);
        assert!(parsed.is_err());
    }

    #[test]
    fn mutation_batch_accepts_allowlisted_command_and_preserves_base_revision() {
        let payload = json!({
            "attemptId": "attempt-1",
            "mutations": [{
                "mutationId": "m-1",
                "baseRevision": 7,
                "type": "SetSlot",
                "questionId": "q1",
                "slotIndex": 2,
                "value": "wolf"
            }]
        });

        let parsed = serde_json::from_value::<ApiMutationBatchRequest>(payload).unwrap();
        assert_eq!(parsed.mutations.len(), 1);
        let command = &parsed.mutations[0];
        assert_eq!(command.base_revision, 7);
        match &command.command {
            ApiMutationCommandPayload::SetSlot {
                question_id,
                slot_index,
                value,
            } => {
                assert_eq!(question_id, "q1");
                assert_eq!(*slot_index, 2);
                assert_eq!(value, "wolf");
            }
            other => panic!("Expected SetSlot command, got {other:?}"),
        }
    }

    #[test]
    fn mutation_batch_accepts_set_flag_and_preserves_base_revision() {
        let payload = json!({
            "attemptId": "attempt-1",
            "mutations": [{
                "mutationId": "m-flag-1",
                "baseRevision": 7,
                "type": "SetFlag",
                "questionId": "q1",
                "value": true
            }]
        });

        let (attempt_id, mutations) = parse_mutation_batch_request(payload).unwrap();

        assert_eq!(attempt_id, "attempt-1");
        assert_eq!(mutations.len(), 1);
        assert_eq!(mutations[0].id, "m-flag-1");
        assert_eq!(mutations[0].base_revision, Some(7));
        assert_eq!(
            mutations[0].command,
            MutationCommand::Flag(QuestionValueMutationPayload {
                question_id: "q1".to_owned(),
                value: Value::Bool(true),
            })
        );
    }

    #[test]
    fn mutation_batch_set_flag_rejects_string_value() {
        let payload = json!({
            "attemptId": "attempt-1",
            "mutations": [{
                "mutationId": "m-flag-1",
                "baseRevision": 0,
                "type": "SetFlag",
                "questionId": "q1",
                "value": "true"
            }]
        });

        let parsed = serde_json::from_value::<ApiMutationBatchRequest>(payload);
        assert!(parsed.is_err());
    }

    #[test]
    fn mutation_batch_set_flag_rejects_unknown_command_fields() {
        let payload = json!({
            "attemptId": "attempt-1",
            "mutations": [{
                "mutationId": "m-flag-1",
                "baseRevision": 0,
                "type": "SetFlag",
                "questionId": "q1",
                "value": true,
                "answers": ["A", "B"]
            }]
        });

        let parsed = serde_json::from_value::<ApiMutationBatchRequest>(payload);
        assert!(parsed.is_err());
    }

    #[test]
    fn mutation_batch_legacy_rejects_non_allowlisted_command() {
        let payload = json!({
            "attemptId": "attempt-1",
            "mutations": [{
                "id": "m-1",
                "seq": 1,
                "mutationType": "violation",
                "payload": {}
            }]
        });

        let parsed = parse_mutation_batch_request(payload);
        assert!(parsed.is_err());
        let err = parsed.unwrap_err();
        assert_eq!(err.code, "VALIDATION_ERROR");
    }

    #[test]
    fn mutation_batch_legacy_accepts_allowlisted_command() {
        let payload = json!({
            "attemptId": "attempt-1",
            "mutations": [{
                "id": "m-1",
                "seq": 3,
                "baseRevision": 4,
                "mutationType": "SetSlot",
                "payload": {
                    "questionId": "q1",
                    "slotIndex": 2,
                    "value": "wolf"
                }
            }]
        });

        let parsed = parse_mutation_batch_request(payload).unwrap();
        assert_eq!(parsed.0, "attempt-1");
        assert_eq!(parsed.1.len(), 1);
        assert_eq!(parsed.1[0].id, "m-1");
        assert_eq!(parsed.1[0].seq, 3);
        assert_eq!(parsed.1[0].base_revision, Some(4));
        assert_eq!(parsed.1[0].mutation_type().as_str(), "SetSlot");
    }

    #[test]
    fn mutation_batch_legacy_ignores_client_timestamp() {
        let payload = json!({
            "attemptId": "attempt-1",
            "mutations": [{
                "id": "m-1",
                "seq": 1,
                "timestamp": "2000-01-01T00:00:00Z",
                "mutationType": "SetScalar",
                "payload": {
                    "questionId": "q1",
                    "value": "A"
                }
            }]
        });

        let parsed = parse_mutation_batch_request(payload).unwrap();
        assert_eq!(parsed.1.len(), 1);
        let legacy_client_time = chrono::DateTime::parse_from_rfc3339("2000-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(parsed.1[0].timestamp > legacy_client_time);
    }

    #[test]
    fn submit_request_rejects_legacy_snapshot_fields() {
        let payload = json!({
            "attemptId": "attempt-1",
            "lastSeenRevision": 11,
            "submissionId": "submit-1",
            "answers": {"q1": "A"}
        });

        let parsed = serde_json::from_value::<ApiSubmitRequest>(payload);
        assert!(parsed.is_err());
    }

    #[test]
    fn submit_request_accepts_final_patch_metadata() {
        let payload = json!({
            "attemptId": "attempt-1",
            "lastSeenRevision": 11,
            "submissionId": "submit-1",
            "clientFinalSeq": 13,
            "serverAcceptedThroughSeq": 12,
            "finalAnswerPatch": {
                "answers": {"q1": "A"},
                "writingAnswers": {"task1": "Essay"},
                "flags": {"q1": true}
            },
            "finalClientSnapshotHash": "abc123"
        });

        let parsed = serde_json::from_value::<ApiSubmitRequest>(payload).unwrap();
        assert_eq!(parsed.client_final_seq, Some(13));
        assert_eq!(parsed.server_accepted_through_seq, Some(12));
        assert!(parsed.final_answer_patch.is_some());
        assert_eq!(parsed.final_client_snapshot_hash.as_deref(), Some("abc123"));
    }

    #[test]
    fn require_idempotency_key_rejects_missing_header() {
        let headers = HeaderMap::new();
        let result = require_idempotency_key(&headers, "submit");
        assert!(result.is_err());
    }

    #[test]
    fn require_idempotency_key_accepts_present_header() {
        let mut headers = HeaderMap::new();
        headers.insert("Idempotency-Key", "submit-1".parse().unwrap());
        let result = require_idempotency_key(&headers, "submit");
        assert_eq!(result.unwrap(), "submit-1");
    }

    #[test]
    fn violation_business_id_from_payload_requires_field() {
        let payload = json!({
            "violationType": "TAB_SWITCH"
        });
        let err = violation_business_id_from_payload(&payload).unwrap_err();
        assert_eq!(err.code, "VALIDATION_ERROR");
    }

    #[test]
    fn violation_business_id_from_payload_rejects_blank() {
        let payload = json!({
            "violationId": "   "
        });
        let err = violation_business_id_from_payload(&payload).unwrap_err();
        assert_eq!(err.code, "VALIDATION_ERROR");
    }

    #[test]
    fn violation_business_id_from_payload_accepts_value() {
        let payload = json!({
            "violationId": "vio-123"
        });
        let id = violation_business_id_from_payload(&payload).unwrap();
        assert_eq!(id, "vio-123");
    }
}
