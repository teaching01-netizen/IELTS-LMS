use axum::{
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;
use ielts_backend_application::auth::{AuthService, StudentAccess};
use ielts_backend_application::delivery::{DeliveryError, DeliveryService};
use ielts_backend_domain::auth::UserRole;
use ielts_backend_domain::attempt::{
    StudentBootstrapRequest, StudentHeartbeatRequest, StudentMutationBatchRequest,
    StudentHeartbeatResponse, StudentMutationBatchResponse, StudentPrecheckRequest,
    StudentSessionContext, StudentSessionQuery, StudentSubmitRequest, StudentSubmitResponse,
    StudentAuditLogRequest,
};
use serde_json::{json, Value};
use sqlx::query_scalar;
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
    let access = authorize_student(&state, &principal, schedule_id).await?;
    let service = DeliveryService::new(state.db_pool());
    let started = Instant::now();
    
    let wcode = if !access.wcode.is_empty() {
        Some(access.wcode.clone())
    } else {
        None
    };
    
    let mut session = service
        .get_session_context(schedule_id, wcode, access.legacy_student_key.clone(), None)
        .await?;

    if query.refresh_attempt_credential.unwrap_or(false) {
        let attempt = session.attempt.as_ref().ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "NOT_FOUND",
                "Student attempt not found for this session.",
            )
        })?;

        let fallback_client_session_id = attempt
            .integrity
            .get("clientSessionId")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned);

        let client_session_id = query
            .client_session_id
            .clone()
            .or(fallback_client_session_id)
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "VALIDATION_ERROR",
                    "clientSessionId is required to refresh attempt credentials.",
                )
            })?;

        let auth_service = AuthService::new(state.db_pool(), state.config.clone());
        session.attempt_credential = Some(
            auth_service
                .issue_attempt_token(
                    &ielts_backend_application::auth::AuthenticatedSession {
                        user: principal.user.clone(),
                        session: principal.session.clone(),
                    },
                    schedule_id.to_string(),
                    attempt.id.clone(),
                    client_session_id,
                    None,
                    None,
                )
                .await
                .map_err(map_auth_error)?,
        );
    }
    state
        .telemetry
        .observe_db_operation("delivery.get_session_context", started.elapsed());
    Ok(ApiResponse::success_with_request_id(session, request_id.0))
}

pub async fn save_precheck(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AuthenticatedUser,
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
    let access = authorize_student(&state, &principal, schedule_id).await?;
    let service = DeliveryService::new(state.db_pool());
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
        state.config.rate_limit_student_bootstrap_per_user_window_secs,
    );
    match state.rate_limiter.check_with_config(&key, &config).await {
        RateLimitResult::Allowed { .. } => {}
        RateLimitResult::Denied { retry_after } => {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!("Too many bootstrap attempts. Retry after {} seconds.", retry_after.as_secs()),
            ));
        }
    }
    let access = authorize_student(&state, &principal, schedule_id).await?;
    let service = DeliveryService::new(state.db_pool());
    let started = Instant::now();
    
    let wcode = if !access.wcode.is_empty() {
        Some(access.wcode.clone())
    } else {
        None
    };

    let client_session_id = req.client_session_id.clone();
    
    let mut session = service
        .bootstrap(
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
        )
        .await?;
    let auth_service = AuthService::new(state.db_pool(), state.config.clone());
    let attempt = session.attempt.as_ref().ok_or_else(|| {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Missing student attempt context.")
    })?;
    session.attempt_credential = Some(
        auth_service
            .issue_attempt_token(
                &ielts_backend_application::auth::AuthenticatedSession {
                    user: principal.user.clone(),
                    session: principal.session.clone(),
                },
                schedule_id.to_string(),
                attempt.id.clone(),
                client_session_id,
                None,
                None,
            )
            .await
            .map_err(map_auth_error)?,
    );
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
    Json(mut req): Json<StudentMutationBatchRequest>,
) -> Result<ApiResponse<StudentMutationBatchResponse>, ApiError> {
    let attempt_id = principal.authorization.claims.attempt_id.clone();
    let claims_schedule_id = principal.authorization.claims.schedule_id.clone();
    let claims_client_session_id = principal.authorization.claims.client_session_id.clone();

    // Apply per-attempt rate limiting for mutations
    let key = RateLimitKey::Attempt(attempt_id.clone());
    let config = RateLimitConfig::new(
        state.config.rate_limit_mutation_per_attempt,
        state.config.rate_limit_mutation_per_attempt_window_secs,
    ).with_burst(50); // Allow burst for reconnect replay
    match state.rate_limiter.check_with_config(&key, &config).await {
        RateLimitResult::Allowed { .. } => {}
        RateLimitResult::Denied { retry_after } => {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!("Too many mutation attempts. Retry after {} seconds.", retry_after.as_secs()),
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

    if req.mutations.len() > state.config.max_mutations_per_batch {
        return Err(ApiError::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
            &format!(
                "Mutation batch exceeds the maximum of {} mutations.",
                state.config.max_mutations_per_batch
            ),
        ));
    }

    let contains_violation = req
        .mutations
        .iter()
        .any(|mutation| mutation.mutation_type.as_str() == "violation");

    for mutation in &req.mutations {
        match mutation.mutation_type.as_str() {
            "writing_answer" => {
                if let Some(value) = mutation.payload.get("value").and_then(Value::as_str) {
                    if value.chars().count() > state.config.max_writing_answer_chars {
                        return Err(ApiError::new(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "VALIDATION_ERROR",
                            &format!(
                                "Writing answers must be at most {} characters.",
                                state.config.max_writing_answer_chars
                            ),
                        ));
                    }
                }
            }
            "answer" => {
                if let Some(value) = mutation.payload.get("value").and_then(Value::as_str) {
                    if value.chars().count() > state.config.max_text_answer_chars {
                        return Err(ApiError::new(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "VALIDATION_ERROR",
                            &format!(
                                "Text answers must be at most {} characters.",
                                state.config.max_text_answer_chars
                            ),
                        ));
                    }
                }
            }
            _ => {}
        }
    }

    req.attempt_id = attempt_id.clone();
    req.client_session_id = claims_client_session_id;
    req.student_key = load_attempt_student_key(&state, &attempt_id)
        .await?;
    let service = DeliveryService::new(state.db_pool());
    let started = Instant::now();
    let mut result = service
        .apply_mutation_batch(schedule_id, req, extract_idempotency_key(&headers)?)
        .await?;
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

    if contains_violation {
        state
            .live_updates
            .publish(ielts_backend_domain::schedule::LiveUpdateEvent {
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
    ).with_burst(20); // Small burst allowance
    match state.rate_limiter.check_with_config(&key, &config).await {
        RateLimitResult::Allowed { .. } => {}
        RateLimitResult::Denied { retry_after } => {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!("Too many heartbeat attempts. Retry after {} seconds.", retry_after.as_secs()),
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
    req.student_key = load_attempt_student_key(&state, &attempt_id)
        .await?;
    let service = DeliveryService::new(state.db_pool());
    let started = Instant::now();
    let event_type = req.event_type.clone();
    let attempt = service.record_heartbeat(schedule_id, req).await?;
    let auth_service = AuthService::new(state.db_pool(), state.config.clone());
    state
        .telemetry
        .observe_db_operation("delivery.record_heartbeat", started.elapsed());
    if event_type != "heartbeat" {
        let event = match event_type.as_str() {
            "disconnect" => "network_disconnected",
            "reconnect" => "network_reconnected",
            "lost" => "heartbeat_lost",
            _ => "student_network",
        };
        state
            .live_updates
            .publish(ielts_backend_domain::schedule::LiveUpdateEvent {
                kind: "schedule_alert".to_owned(),
                id: schedule_id.to_string(),
                revision: 0,
                event: event.to_owned(),
            });
    }
    Ok(ApiResponse::success_with_request_id(
        StudentHeartbeatResponse {
            attempt,
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
    match state.rate_limiter.check_with_config(&key, &config).await {
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
    .execute(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?;

    if req.action_type == "VIOLATION_DETECTED" {
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
            let allowed = matches!(
                severity.as_str(),
                "low" | "medium" | "high" | "critical"
            );
            if allowed {
                let violation_id = Uuid::new_v4();
                sqlx::query(
                    r#"
                    INSERT INTO student_violation_events (
                        id, schedule_id, attempt_id, violation_type, severity, description, payload, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                    "#,
                )
                .bind(violation_id.to_string())
                .bind(schedule_id.to_string())
                .bind(&attempt_id)
                .bind(&violation_type)
                .bind(&severity)
                .bind(&description)
                .bind(payload_value.clone())
                .execute(&state.db_pool())
                .await
                .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?;

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
                .execute(&state.db_pool())
                .await
                .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?;
            }
        }
    }

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
        state
            .live_updates
            .publish(ielts_backend_domain::schedule::LiveUpdateEvent {
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
    Json(mut req): Json<StudentSubmitRequest>,
) -> Result<ApiResponse<StudentSubmitResponse>, ApiError> {
    let attempt_id = principal.authorization.claims.attempt_id.clone();
    let claims_schedule_id = principal.authorization.claims.schedule_id.clone();

    // Apply strict per-attempt rate limiting for submit (idempotency enforcement)
    let key = RateLimitKey::Attempt(attempt_id.clone());
    let config = RateLimitConfig::new(
        state.config.rate_limit_submit_per_attempt,
        state.config.rate_limit_submit_per_attempt_window_secs,
    );
    match state.rate_limiter.check_with_config(&key, &config).await {
        RateLimitResult::Allowed { .. } => {}
        RateLimitResult::Denied { retry_after } => {
            return Err(ApiError::new(
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                &format!("Too many submit attempts. Retry after {} seconds.", retry_after.as_secs()),
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
    req.attempt_id = attempt_id.clone();
    req.student_key = load_attempt_student_key(&state, &attempt_id)
        .await?;
    let service = DeliveryService::new(state.db_pool());
    let started = Instant::now();
    let mut submission = service
        .submit_attempt(schedule_id, req, extract_idempotency_key(&headers)?)
        .await?;
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
    Ok(ApiResponse::success_with_request_id(
        submission,
        request_id.0,
    ))
}

impl From<DeliveryError> for ApiError {
    fn from(err: DeliveryError) -> Self {
        match err {
            DeliveryError::Conflict { message, reason } => {
                let api = ApiError::new(StatusCode::CONFLICT, "CONFLICT", &message);
                match reason {
                    Some(reason) => api.with_details(json!({ "reason": reason.as_str() })),
                    None => api,
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

async fn authorize_student(
    state: &AppState,
    principal: &AuthenticatedUser,
    schedule_id: Uuid,
) -> Result<StudentAccess, ApiError> {
    AuthService::new(state.db_pool(), state.config.clone())
        .authorize_student_schedule(
            &ielts_backend_application::auth::AuthenticatedSession {
                user: principal.user.clone(),
                session: principal.session.clone(),
            },
            schedule_id,
        )
        .await
        .map_err(|_| {
            ApiError::new(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "The authenticated student is not enrolled for this schedule.",
            )
        })
}

fn access_key(access: &StudentAccess) -> String {
    access
        .legacy_student_key
        .clone()
        .unwrap_or_else(|| format!("student-{}-{}", access.registration_id, access.student_id))
}

async fn load_attempt_student_key(state: &AppState, attempt_id: &str) -> Result<String, ApiError> {
    query_scalar("SELECT student_key FROM student_attempts WHERE id = ?")
        .bind(attempt_id)
        .fetch_optional(&state.db_pool())
        .await
        .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))
}

async fn load_attempt_candidate_name(state: &AppState, attempt_id: &str) -> Result<String, ApiError> {
    query_scalar("SELECT candidate_name FROM student_attempts WHERE id = ?")
        .bind(attempt_id)
        .fetch_optional(&state.db_pool())
        .await
        .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found"))
}

fn map_auth_error(error: ielts_backend_application::auth::AuthError) -> ApiError {
    match error {
        ielts_backend_application::auth::AuthError::Database(err) => {
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string())
        }
        ielts_backend_application::auth::AuthError::InvalidCredentials
        | ielts_backend_application::auth::AuthError::Unauthorized => {
            ApiError::new(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", "Authentication is required for this route.")
        }
        ielts_backend_application::auth::AuthError::Forbidden => {
            ApiError::new(StatusCode::FORBIDDEN, "FORBIDDEN", "The authenticated user is not allowed to access this route.")
        }
        ielts_backend_application::auth::AuthError::Conflict(message) => {
            ApiError::new(StatusCode::CONFLICT, "CONFLICT", &message)
        }
        ielts_backend_application::auth::AuthError::Validation(message) => {
            ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", &message)
        }
    }
}
