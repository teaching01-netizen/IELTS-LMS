pub mod mutation_batch;
pub mod ports;
pub mod session_context;
pub mod submit_attempt;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use ielts_backend_domain::{
    attempt::{
        AttemptPhase, HeartbeatEventType, ModuleType, MutationCommand, MutationEnvelope,
        MutationType, StudentAttempt, StudentBootstrapRequest, StudentHeartbeatRequest,
        StudentMutationBatchRequest, StudentMutationBatchResponse, StudentPrecheckRequest,
        StudentSessionContext, StudentSubmitRequest, StudentSubmitResponse,
    },
    exam::ExamVersion,
    schedule::{ExamSchedule, ExamSessionRuntime},
};
use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    auth::sha256_hex,
    config::AppConfig,
    idempotency::{IdempotencyLookupStatus, IdempotencyRecord, IdempotencyRepository},
    live_mode::LiveModeService,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{MySql, MySqlConnection, MySqlPool, QueryBuilder};
use std::collections::{HashMap, HashSet};
use thiserror::Error;
use uuid::{fmt::Hyphenated, Uuid};

use crate::auth::{AuthService, AuthenticatedSession};
use crate::scheduling::SchedulingService;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryConflictReason {
    ObjectiveLocked,
    SectionMismatch,
    AttemptProctorBlocked,
    BaseRevisionMismatch,
    AttemptSubmitted,
    FinalFlushRequired,
    FinalPayloadHashMismatch,
}

impl DeliveryConflictReason {
    pub fn as_str(self) -> &'static str {
        match self {
            DeliveryConflictReason::ObjectiveLocked => "OBJECTIVE_LOCKED",
            DeliveryConflictReason::SectionMismatch => "SECTION_MISMATCH",
            DeliveryConflictReason::AttemptProctorBlocked => "ATTEMPT_PROCTOR_BLOCKED",
            DeliveryConflictReason::BaseRevisionMismatch => "BASE_REVISION_MISMATCH",
            DeliveryConflictReason::AttemptSubmitted => "ATTEMPT_SUBMITTED",
            DeliveryConflictReason::FinalFlushRequired => "FINAL_FLUSH_REQUIRED",
            DeliveryConflictReason::FinalPayloadHashMismatch => "FINAL_PAYLOAD_HASH_MISMATCH",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MutationBatchResponseMode {
    Full,
    Ack,
}

#[derive(Error, Debug)]
pub enum DeliveryError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Conflict: {message}")]
    Conflict {
        message: String,
        reason: Option<DeliveryConflictReason>,
        latest_revision: Option<i32>,
        server_accepted_through_seq: Option<i64>,
        active_session_id: Option<String>,
    },
    #[error("Not found")]
    NotFound,
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

impl DeliveryError {
    pub(crate) fn conflict(message: impl Into<String>) -> Self {
        DeliveryError::Conflict {
            message: message.into(),
            reason: None,
            latest_revision: None,
            server_accepted_through_seq: None,
            active_session_id: None,
        }
    }

    pub(crate) fn conflict_reason(
        reason: DeliveryConflictReason,
        message: impl Into<String>,
    ) -> Self {
        DeliveryError::Conflict {
            message: message.into(),
            reason: Some(reason),
            latest_revision: None,
            server_accepted_through_seq: None,
            active_session_id: None,
        }
    }

    pub fn conflict_reason_code(&self) -> Option<&'static str> {
        match self {
            DeliveryError::Conflict {
                reason: Some(reason),
                ..
            } => Some(reason.as_str()),
            _ => None,
        }
    }
}

pub struct DeliveryService {
    pool: MySqlPool,
    auth_service: Option<AuthService>,
    final_submit_grace_seconds: i64,
}

impl DeliveryService {
    pub fn new(pool: MySqlPool) -> Self {
        Self {
            pool,
            auth_service: None,
            final_submit_grace_seconds: 15,
        }
    }

    pub fn with_auth(pool: MySqlPool, config: AppConfig) -> Self {
        let final_submit_grace_seconds = config.final_submit_grace_seconds;
        let auth_service = AuthService::new(pool.clone(), config);
        Self {
            pool,
            auth_service: Some(auth_service),
            final_submit_grace_seconds,
        }
    }

    pub fn with_runtime_tuning(
        pool: MySqlPool,
        _idempotency_usable_hours: i64,
        _submit_idempotency_usable_hours: i64,
        _violation_idempotency_usable_hours: i64,
        _heartbeat_min_write_interval_secs: u64,
    ) -> Self {
        let mut service = Self::new(pool);
        service.final_submit_grace_seconds = 15;
        service
    }

    pub fn with_auth_runtime_tuning(
        pool: MySqlPool,
        config: AppConfig,
        _idempotency_usable_hours: i64,
        _submit_idempotency_usable_hours: i64,
        _violation_idempotency_usable_hours: i64,
        _heartbeat_min_write_interval_secs: u64,
    ) -> Self {
        let mut service = Self::with_auth(pool, config.clone());
        service.final_submit_grace_seconds = config.final_submit_grace_seconds;
        service
    }

    fn auth_service(&self) -> Result<&AuthService, DeliveryError> {
        self.auth_service
            .as_ref()
            .ok_or_else(|| DeliveryError::Internal("Auth service is not configured.".to_owned()))
    }

    pub async fn get_session_context(
        &self,
        schedule_id: Uuid,
        wcode: Option<String>,
        student_key: Option<String>,
        candidate_id: Option<String>,
    ) -> Result<StudentSessionContext, DeliveryError> {
        let schedule = self.load_schedule(schedule_id).await?;
        let version = self
            .load_version(schedule.published_version_id.clone())
            .await?;
        let runtime = self.load_runtime(schedule_id).await?;

        let attempt = if let Some(wcode) = wcode {
            self.load_attempt_by_wcode(schedule_id.to_string(), &wcode)
                .await?
        } else if let Some(student_key) = student_key {
            self.load_attempt_by_student_key(schedule_id.to_string(), &student_key)
                .await?
        } else if let Some(candidate_id) = candidate_id {
            let derived = derive_student_key(schedule_id, &candidate_id);
            self.load_attempt_by_student_key(schedule_id.to_string(), &derived)
                .await?
        } else {
            None
        };

        let degraded_live_mode = LiveModeService::new(self.pool.clone())
            .snapshot(true, Some(schedule_id))
            .await
            .map(|state| state.degraded)
            .map_err(DeliveryError::Database)?;

        Ok(StudentSessionContext {
            schedule,
            version,
            runtime,
            attempt,
            attempt_credential: None,
            degraded_live_mode,
        })
    }

    pub async fn get_session_context_with_attempt_credential(
        &self,
        schedule_id: Uuid,
        wcode: Option<String>,
        student_key: Option<String>,
        candidate_id: Option<String>,
        principal: &AuthenticatedSession,
        client_session_id: Option<String>,
    ) -> Result<StudentSessionContext, DeliveryError> {
        let mut session = self
            .get_session_context(schedule_id, wcode, student_key, candidate_id)
            .await?;
        self.attach_attempt_credential(
            schedule_id,
            &mut session,
            principal,
            client_session_id,
            "clientSessionId is required to refresh attempt credentials.",
        )
        .await?;
        Ok(session)
    }

    pub async fn get_static_session_context(
        &self,
        schedule_id: Uuid,
    ) -> Result<ielts_backend_domain::attempt::StudentStaticSessionContext, DeliveryError> {
        let session = self
            .get_session_context(schedule_id, None, None, None)
            .await?;
        Ok(ielts_backend_domain::attempt::StudentStaticSessionContext {
            schedule: session.schedule,
            version: session.version,
            degraded_live_mode: session.degraded_live_mode,
        })
    }

    pub async fn get_live_session_context(
        &self,
        schedule_id: Uuid,
        wcode: Option<String>,
        student_key: Option<String>,
        candidate_id: Option<String>,
    ) -> Result<ielts_backend_domain::attempt::StudentLiveSessionContext, DeliveryError> {
        let session = self
            .get_session_context(schedule_id, wcode, student_key, candidate_id)
            .await?;
        Ok(ielts_backend_domain::attempt::StudentLiveSessionContext {
            runtime: session.runtime,
            attempt: session.attempt,
            degraded_live_mode: session.degraded_live_mode,
        })
    }

    pub async fn persist_precheck(
        &self,
        schedule_id: Uuid,
        req: StudentPrecheckRequest,
        idempotency_key: Option<String>,
    ) -> Result<StudentAttempt, DeliveryError> {
        let repository = self.idempotency_repository();
        let route_key = precheck_route_key(schedule_id);
        let request_hash = self.idempotency_request_hash(&req, idempotency_key.as_ref())?;
        if let Some(response) = self
            .lookup_idempotent_response(
                &repository,
                &req.student_key,
                &route_key,
                idempotency_key.as_deref(),
                request_hash.as_deref(),
            )
            .await?
        {
            return Ok(response);
        }

        let has_device_fingerprint = req.device_fingerprint_hash.is_some();
        let schedule = self.load_schedule(schedule_id).await?;
        let version = self
            .load_version(schedule.published_version_id.clone())
            .await?;
        let runtime = self.load_runtime(schedule_id).await?;
        let attempt = self
            .get_or_create_attempt(
                &schedule,
                &version,
                runtime.as_ref(),
                req.wcode.as_deref(),
                &req.student_key,
                &req.candidate_id,
                &req.candidate_name,
                &req.candidate_email,
            )
            .await?;

        let mut integrity = ensure_object(attempt.integrity.clone().into());
        integrity.insert("preCheck".to_owned(), req.pre_check);
        integrity.insert(
            "deviceFingerprintHash".to_owned(),
            req.device_fingerprint_hash
                .map(Value::String)
                .unwrap_or(Value::Null),
        );
        integrity.insert(
            "clientSessionId".to_owned(),
            Value::String(req.client_session_id.to_string()),
        );
        integrity.insert(
            "lastHeartbeatStatus".to_owned(),
            Value::String("idle".to_owned()),
        );

        let phase = determine_phase(
            runtime.as_ref(),
            true,
            attempt.submitted_at.is_some(),
            Some(attempt.phase),
        );

        let updated = self
            .update_attempt_preserving_revision(
                attempt.id,
                phase,
                attempt.current_module.clone(),
                attempt.current_question_id.clone(),
                attempt.answers.clone().into(),
                attempt.writing_answers.clone().into(),
                attempt.flags.clone().into(),
                attempt.violations_snapshot.clone().into(),
                Value::Object(integrity),
                merge_recovery(
                    attempt.recovery.clone().into(),
                    json!({
                        "lastRecoveredAt": Value::Null,
                        "lastPersistedAt": Value::Null,
                        "pendingMutationCount": 0,
                        "syncState": "idle",
                        "serverAcceptedThroughSeq": 0
                    }),
                ),
                attempt.final_submission.clone(),
                attempt.submitted_at,
            )
            .await?;

        if let Some(idempotency_key) = idempotency_key.as_deref() {
            let response_body = serde_json::to_value(&updated).map_err(|err| {
                DeliveryError::Internal(format!(
                    "Failed to serialize idempotent precheck response: {err}"
                ))
            })?;
            let request_hash = request_hash
                .as_deref()
                .expect("request hash present when idempotency key exists");
            let (status, record) = repository
                .store_or_replay(
                    &req.student_key,
                    &route_key,
                    idempotency_key,
                    request_hash,
                    200,
                    response_body,
                )
                .await?;
            if status == IdempotencyLookupStatus::Conflict {
                return Err(DeliveryError::conflict(
                    "Idempotency-Key does not match the original request.".to_owned(),
                ));
            }
            if status == IdempotencyLookupStatus::Replay {
                // A concurrent identical request already persisted this
                // precheck and recorded its audit event. Replay its stored
                // response instead of recording a duplicate audit event.
                return deserialize_idempotent_response(&record);
            }
        }

        // The idempotency record is committed before the audit event so a
        // concurrent replay of the same key can never double-record the
        // audit (audit events are append-only and must stay singular). A
        // crash between the two INSERTs means the retry replays with no
        // audit ever written — accepted trade-off (append-only/no-duplicates
        // invariant takes priority), consistent with the non-transactional
        // flow.
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
        .bind(&updated.candidate_name)
        .bind("STUDENT_PRECHECK")
        .bind(&updated.id)
        .bind(json!({
            "clientSessionId": req.client_session_id,
            "hasDeviceFingerprint": has_device_fingerprint
        }))
        .execute(&self.pool)
        .await?;

        Ok(updated)
    }

    #[tracing::instrument(skip(self, req), fields(schedule_id = %schedule_id))]
    pub async fn bootstrap(
        &self,
        schedule_id: Uuid,
        req: StudentBootstrapRequest,
    ) -> Result<StudentSessionContext, DeliveryError> {
        let schedule = self.load_schedule(schedule_id).await?;
        let version = self
            .load_version(schedule.published_version_id.clone())
            .await?;
        let runtime = self.load_runtime(schedule_id).await?;
        let attempt = self
            .get_or_create_attempt(
                &schedule,
                &version,
                runtime.as_ref(),
                req.wcode.as_deref(),
                &req.student_key,
                &req.candidate_id,
                &req.candidate_name,
                &req.candidate_email,
            )
            .await?;

        let has_precheck = attempt
            .integrity
            .pre_check
            .as_ref()
            .and_then(|value| value.get("completedAt"))
            .and_then(Value::as_str)
            .is_some();
        let phase = determine_phase(
            runtime.as_ref(),
            has_precheck,
            attempt.submitted_at.is_some(),
            Some(attempt.phase),
        );
        let client_session_id_value = Value::String(req.client_session_id.to_string());

        let needs_client_session_id_in_integrity = attempt.integrity.client_session_id.is_none();
        let next_integrity = if needs_client_session_id_in_integrity {
            let mut integrity = ensure_object(attempt.integrity.clone().into());
            integrity.insert(
                "clientSessionId".to_owned(),
                client_session_id_value.clone(),
            );
            Value::Object(integrity)
        } else {
            attempt.integrity.clone().into()
        };

        let needs_client_session_id_in_recovery = attempt.recovery.client_session_id.is_none();
        let next_recovery = if needs_client_session_id_in_recovery {
            merge_recovery(
                attempt.recovery.clone().into(),
                json!({ "clientSessionId": req.client_session_id }),
            )
        } else {
            attempt.recovery.clone().into()
        };

        let attempt = if attempt.phase != phase
            || needs_client_session_id_in_integrity
            || needs_client_session_id_in_recovery
        {
            self.update_attempt_preserving_revision(
                attempt.id,
                phase,
                attempt.current_module.clone(),
                attempt.current_question_id.clone(),
                attempt.answers.clone().into(),
                attempt.writing_answers.clone().into(),
                attempt.flags.clone().into(),
                attempt.violations_snapshot.clone().into(),
                next_integrity,
                next_recovery,
                attempt.final_submission.clone(),
                attempt.submitted_at,
            )
            .await?
        } else {
            attempt
        };

        Ok(StudentSessionContext {
            schedule,
            version,
            runtime,
            attempt: Some(attempt),
            attempt_credential: None,
            degraded_live_mode: LiveModeService::new(self.pool.clone())
                .snapshot(true, Some(schedule_id))
                .await
                .map(|state| state.degraded)
                .map_err(DeliveryError::Database)?,
        })
    }

    pub async fn bootstrap_with_attempt_credential(
        &self,
        schedule_id: Uuid,
        req: StudentBootstrapRequest,
        principal: &AuthenticatedSession,
    ) -> Result<StudentSessionContext, DeliveryError> {
        let client_session_id = Some(req.client_session_id.clone());
        let mut session = self.bootstrap(schedule_id, req).await?;
        self.attach_attempt_credential(
            schedule_id,
            &mut session,
            principal,
            client_session_id,
            "clientSessionId is required to issue attempt credentials.",
        )
        .await?;
        Ok(session)
    }

    async fn attach_attempt_credential(
        &self,
        schedule_id: Uuid,
        session: &mut StudentSessionContext,
        principal: &AuthenticatedSession,
        client_session_id: Option<String>,
        missing_client_session_message: &str,
    ) -> Result<(), DeliveryError> {
        let attempt = session.attempt.as_ref().ok_or(DeliveryError::NotFound)?;
        let fallback_client_session_id = attempt.integrity.client_session_id.clone();
        let client_session_id = client_session_id
            .or(fallback_client_session_id)
            .ok_or_else(|| DeliveryError::Validation(missing_client_session_message.to_owned()))?;

        let token = self
            .auth_service()?
            .issue_attempt_token(
                principal,
                schedule_id.to_string(),
                attempt.id.clone(),
                client_session_id,
                None,
                None,
            )
            .await
            .map_err(|err| {
                DeliveryError::Internal(format!("Unable to issue attempt token: {err}"))
            })?;
        session.attempt_credential = Some(token);
        Ok(())
    }

    #[tracing::instrument(
        skip(self, req),
        fields(schedule_id = %schedule_id, attempt_id = %req.attempt_id)
    )]
    pub async fn apply_mutation_batch(
        &self,
        schedule_id: Uuid,
        req: StudentMutationBatchRequest,
        _response_mode: MutationBatchResponseMode,
        idempotency_key: Option<String>,
    ) -> Result<StudentMutationBatchResponse, DeliveryError> {
        if req.mutations.is_empty() {
            return Err(DeliveryError::Validation(
                "Mutation batch must contain at least one mutation.".to_owned(),
            ));
        }

        validate_batch_sequences(&req.mutations)?;
        validate_batch_mutation_ids(&req.mutations)?;

        let repository = self.idempotency_repository();
        let route_key = mutation_batch_route_key(schedule_id);
        // BEX-033: the hash must be deterministic across replays of the same
        // HTTP body. The route stamps `timestamp: Utc::now()` onto every
        // envelope while parsing (routes/student.rs
        // `parse_mutation_batch_request`), so hashing the request as-is would
        // make every replay look like a hash mismatch (409). The batch helper
        // strips the server-stamped timestamp before hashing.
        let request_hash = self.batch_idempotency_request_hash(&req, idempotency_key.as_ref())?;
        if let Some(response) = self
            .lookup_idempotent_response(
                &repository,
                &req.student_key,
                &route_key,
                idempotency_key.as_deref(),
                request_hash.as_deref(),
            )
            .await?
        {
            return Ok(response);
        }

        let mut tx = self.pool.begin().await?;
        let mut attempt = self
            .load_attempt_by_id_for_update(tx.as_mut(), req.attempt_id.clone())
            .await?
            .ok_or(DeliveryError::NotFound)?;
        if attempt.schedule_id != schedule_id.to_string() || attempt.student_key != req.student_key
        {
            return Err(DeliveryError::Validation(
                "Attempt does not belong to the provided schedule or student key.".to_owned(),
            ));
        }
        if let Some(response) = self
            .lookup_idempotent_response_on_connection(
                tx.as_mut(),
                &req.student_key,
                &route_key,
                idempotency_key.as_deref(),
                request_hash.as_deref(),
            )
            .await?
        {
            return Ok(response);
        }

        let runtime_gate = sqlx::query_as::<_, RuntimeGateRow>(
            "SELECT id, status, current_section_key, waiting_for_next_section FROM exam_session_runtimes WHERE schedule_id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(tx.as_mut())
        .await?;
        let now = Utc::now();
        let post_submit_grace_active = attempt
            .submitted_at
            .as_ref()
            .map(|submitted_at| {
                is_within_post_submit_grace_window(
                    submitted_at.to_owned(),
                    now,
                    self.final_submit_grace_seconds,
                )
            })
            .unwrap_or(false);
        let objective_mutation_gate = if post_submit_grace_active {
            ObjectiveMutationGate::allow()
        } else {
            objective_mutation_gate(runtime_gate.as_ref(), Some(attempt.proctor_status))
        };
        let active_section_key = if post_submit_grace_active {
            None
        } else {
            runtime_gate
                .as_ref()
                .and_then(|gate| gate.current_section_key.as_deref())
        };
        let transition_grace_section_keys = if post_submit_grace_active {
            HashSet::new()
        } else if let Some(runtime_gate) = runtime_gate.as_ref() {
            self.load_recently_completed_section_keys_for_grace(tx.as_mut(), &runtime_gate.id, now)
                .await?
        } else {
            HashSet::new()
        };

        let version = self
            .load_version(attempt.published_version_id.clone())
            .await?;
        let answer_schema = build_answer_schema(&version.content_snapshot)?;
        let writing_task_ids = build_writing_task_ids(&version.config_snapshot);

        let existing_max_seq: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(mutation_seq), 0) FROM student_attempt_mutations WHERE attempt_id = ? AND client_session_id = ?",
        )
        .bind(&req.attempt_id)
        .bind(&req.client_session_id)
        .fetch_one(tx.as_mut())
        .await?;

        let mut lookup_existing = QueryBuilder::<MySql>::new(
            "SELECT client_mutation_id, mutation_type, payload FROM student_attempt_mutations WHERE attempt_id = ",
        );
        lookup_existing.push_bind(&req.attempt_id);
        lookup_existing.push(" AND client_session_id = ");
        lookup_existing.push_bind(&req.client_session_id);
        lookup_existing.push(" AND client_mutation_id IN (");
        {
            let mut separated = lookup_existing.separated(", ");
            for mutation in &req.mutations {
                separated.push_bind(&mutation.id);
            }
        }
        lookup_existing.push(")");
        let existing_identities: Vec<ExistingMutationIdentityRow> = lookup_existing
            .build_query_as::<ExistingMutationIdentityRow>()
            .fetch_all(tx.as_mut())
            .await?;
        let existing_by_id: HashMap<String, (MutationType, Value)> = existing_identities
            .into_iter()
            .map(|row| (row.client_mutation_id, (row.mutation_type, row.payload)))
            .collect();

        let mut answers: Value = attempt.answers.clone().into();
        let mut writing_answers: Value = attempt.writing_answers.clone().into();
        let mut flags: Value = attempt.flags.clone().into();
        let mut violations_snapshot: Value = attempt.violations_snapshot.clone().into();
        let has_precheck = attempt
            .integrity
            .pre_check
            .as_ref()
            .and_then(|value| value.get("completedAt"))
            .and_then(Value::as_str)
            .is_some();
        let mut phase = derive_authoritative_phase(
            runtime_gate.as_ref(),
            has_precheck,
            attempt.submitted_at.is_some(),
            attempt.phase,
        );
        let mut current_module = active_section_key
            .and_then(ModuleType::from_section_key)
            .unwrap_or_else(|| attempt.current_module.clone());
        let mut current_question_id = attempt.current_question_id.clone();
        let mut recovery: Value = attempt.recovery.clone().into();

        let mut new_mutations: Vec<&MutationEnvelope> = Vec::new();
        for mutation in &req.mutations {
            let mutation_type = mutation.mutation_type();
            let payload_json = mutation.payload_json();
            if let Some((existing_type, existing_payload)) = existing_by_id.get(&mutation.id) {
                if existing_type != &mutation_type || existing_payload != &payload_json {
                    return Err(DeliveryError::Validation(
                        "Mutation id already exists with different contents.".to_owned(),
                    ));
                }
                continue;
            }
            new_mutations.push(mutation);
        }

        if new_mutations.is_empty() {
            let response = StudentMutationBatchResponse {
                attempt: Some(attempt.clone()),
                applied_mutation_count: 0,
                server_accepted_through_seq: existing_max_seq,
                revision: attempt.revision,
                accepted_in_grace: false,
                refreshed_attempt_credential: None,
            };

            self.store_idempotent_response(
                tx.as_mut(),
                &repository,
                &req.student_key,
                &route_key,
                idempotency_key.as_deref(),
                request_hash.as_deref(),
                &response,
            )
            .await?;

            tx.commit().await?;
            return Ok(response);
        }

        if attempt.submitted_at.is_some() && !post_submit_grace_active {
            return Err(DeliveryError::Conflict {
                message: "Attempt is already sealed and no longer accepts new mutations."
                    .to_owned(),
                reason: Some(DeliveryConflictReason::AttemptSubmitted),
                latest_revision: Some(attempt.revision),
                server_accepted_through_seq: Some(existing_max_seq),
                active_session_id: None,
            });
        }

        // Base-revision conflict gate (BEX-003 / BEX-032).
        //
        // A NEW mutation batch must not be allowed to silently overwrite
        // answers that a newer revision already accepted. Any command whose
        // `baseRevision` is strictly BELOW the attempt's current revision
        // means the batch was composed from stale state (e.g. a second client
        // session that never saw the first session's writes), so the whole
        // batch is rejected atomically with `BASE_REVISION_MISMATCH` — no
        // partial state is persisted.
        //
        // Tolerance rule: a command is accepted when its base is EQUAL TO OR
        // ABOVE the current revision. Equal-per-position is intentionally NOT
        // required because the allowed frontend pipelines intrabatch bases:
        // `StudentAttemptRepository#flushMutationQueue` composes one chunk
        // with baseRevision N, N+1, ... (N = last seen server revision)
        // while the server advances the attempt revision exactly once per
        // accepted batch. A flush that raced a pushed snapshot (or a client
        // slightly ahead of the server) therefore legitimately sends bases
        // strictly above the current revision and must still be accepted.
        //
        // The gate runs AFTER the idempotent-replay shortcuts and the
        // in-batch dedupe short-circuit above, so replayed batches (BEX-033)
        // and retries whose commands are already persisted keep returning
        // their cached/successful response instead of a 409. Only commands
        // NOT yet persisted (`new_mutations`) are scored. Commands without a
        // baseRevision claim (`base_revision: None` — legacy envelopes) are
        // not scored: they carry no stale-base signal to enforce.
        if let Some(stale) = new_mutations.iter().find(|mutation| {
            mutation
                .base_revision
                .is_some_and(|base_revision| base_revision < attempt.revision)
        }) {
            let active_session_id = self
                .load_active_mutation_session_id(tx.as_mut(), &req.attempt_id)
                .await?;
            return Err(DeliveryError::Conflict {
                message: format!(
                    "Mutation batch is based on revision {} but the attempt is at revision {}; \
                     reload the latest answers and re-flush from the current revision.",
                    stale.base_revision.unwrap_or_default(),
                    attempt.revision
                ),
                reason: Some(DeliveryConflictReason::BaseRevisionMismatch),
                latest_revision: Some(attempt.revision),
                server_accepted_through_seq: Some(existing_max_seq),
                active_session_id,
            });
        }

        let mut applied_mutation_count: usize = 0;
        for mutation in &new_mutations {
            let applied = apply_mutation(
                mutation,
                &answer_schema,
                &writing_task_ids,
                objective_mutation_gate,
                active_section_key,
                &transition_grace_section_keys,
                &mut answers,
                &mut writing_answers,
                &mut flags,
                &mut violations_snapshot,
                &mut phase,
                &mut current_module,
                &mut current_question_id,
                &mut recovery,
            )?;
            if applied {
                applied_mutation_count = applied_mutation_count.saturating_add(1);
            }
        }

        let server_accepted_through_seq =
            existing_max_seq + i64::try_from(new_mutations.len()).unwrap_or(i64::MAX);
        let recovery = if post_submit_grace_active {
            merge_recovery(
                recovery,
                json!({
                    "lastPersistedAt": now,
                    "pendingMutationCount": 0,
                    "syncState": "saved",
                    "serverAcceptedThroughSeq": server_accepted_through_seq,
                    "clientSessionId": req.client_session_id.clone(),
                    "postSubmitGraceAcceptedAt": now,
                    "postSubmitGraceLastAppliedMutationCount": applied_mutation_count,
                }),
            )
        } else {
            merge_recovery(
                recovery,
                json!({
                    "lastPersistedAt": now,
                    "pendingMutationCount": 0,
                    "syncState": "saved",
                    "serverAcceptedThroughSeq": server_accepted_through_seq,
                    "clientSessionId": req.client_session_id.clone()
                }),
            )
        };

        let final_submission = if post_submit_grace_active {
            Some(merge_post_submit_submission_snapshot(
                attempt.final_submission.clone(),
                &answers,
                &writing_answers,
                &flags,
                now,
                applied_mutation_count,
                self.final_submit_grace_seconds,
                server_accepted_through_seq,
            ))
        } else {
            attempt.final_submission.clone()
        };

        let mut next_seq = existing_max_seq;
        for mutation in &new_mutations {
            next_seq = next_seq.saturating_add(1);
            sqlx::query(
                r#"
                INSERT INTO student_attempt_mutations (
                    id, attempt_id, schedule_id, client_session_id, mutation_type,
                    client_mutation_id, mutation_seq, payload, client_timestamp,
                    server_received_at, applied_revision, applied_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW())
                "#,
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&req.attempt_id)
            .bind(schedule_id.to_string())
            .bind(&req.client_session_id)
            .bind(mutation.mutation_type())
            .bind(&mutation.id)
            .bind(next_seq)
            .bind(mutation.payload_json())
            .bind(mutation.timestamp)
            .bind(attempt.revision + 1)
            .execute(tx.as_mut())
            .await?;
        }

        sqlx::query(
            r#"
            UPDATE student_attempts
            SET
                phase = ?,
                current_module = ?,
                answers = ?,
                writing_answers = ?,
                flags = ?,
                violations_snapshot = ?,
                current_question_id = ?,
                recovery = ?,
                final_submission = ?,
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(phase)
        .bind(current_module)
        .bind(answers)
        .bind(writing_answers)
        .bind(flags)
        .bind(violations_snapshot)
        .bind(current_question_id)
        .bind(recovery)
        .bind(final_submission)
        .bind(&req.attempt_id)
        .execute(tx.as_mut())
        .await?;

        attempt =
            sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
                .bind(&req.attempt_id)
                .fetch_one(tx.as_mut())
                .await?;

        let mut mutation_types: HashSet<MutationType> = HashSet::new();
        for mutation in &new_mutations {
            mutation_types.insert(mutation.mutation_type());
        }
        let mut mutation_types: Vec<String> = mutation_types
            .into_iter()
            .map(|mutation_type| mutation_type.as_str().to_owned())
            .collect();
        mutation_types.sort();

        let seq_from = Some(existing_max_seq.saturating_add(1));
        let seq_to = Some(server_accepted_through_seq);

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
        .bind(&attempt.candidate_name)
        .bind("STUDENT_MUTATION_BATCH")
        .bind(&attempt.id)
        .bind(json!({
            "requestedCount": req.mutations.len(),
            "appliedCount": applied_mutation_count,
            "seqFrom": seq_from,
            "seqTo": seq_to,
            "types": mutation_types,
            "phase": attempt.phase,
            "currentModule": attempt.current_module,
            "currentQuestionId": attempt.current_question_id,
            "clientSessionId": req.client_session_id
        }))
        .execute(tx.as_mut())
        .await?;

        let response = StudentMutationBatchResponse {
            attempt: Some(attempt.clone()),
            applied_mutation_count,
            server_accepted_through_seq,
            revision: attempt.revision,
            accepted_in_grace: post_submit_grace_active,
            refreshed_attempt_credential: None,
        };

        self.store_idempotent_response(
            tx.as_mut(),
            &repository,
            &req.student_key,
            &route_key,
            idempotency_key.as_deref(),
            request_hash.as_deref(),
            &response,
        )
        .await?;

        tx.commit().await?;

        Ok(response)
    }

    /// Identifies the client session that most recently persisted a mutation
    /// for this attempt — the "active writer" whose accepted answers a stale
    /// batch/submit would otherwise silently overwrite. Returns `None` when
    /// the attempt has no accepted mutations yet. Ordered by
    /// `applied_revision` (the attempt revision after the batch applied,
    /// strictly increasing because every accepted batch bumps the revision
    /// exactly once) rather than wall-clock `applied_at`, so the "most
    /// recent" writer is the one that owns the highest accepted revision.
    async fn load_active_mutation_session_id(
        &self,
        conn: &mut MySqlConnection,
        attempt_id: &str,
    ) -> Result<Option<String>, DeliveryError> {
        let client_session_id: Option<String> = sqlx::query_scalar(
            r#"
            SELECT client_session_id
            FROM student_attempt_mutations
            WHERE attempt_id = ? AND applied_at IS NOT NULL
            ORDER BY applied_revision DESC
            LIMIT 1
            "#,
        )
        .bind(attempt_id)
        .fetch_optional(conn)
        .await?
        .flatten();
        Ok(client_session_id)
    }

    async fn load_recently_completed_section_keys_for_grace(
        &self,
        conn: &mut MySqlConnection,
        runtime_id: &str,
        now: DateTime<Utc>,
    ) -> Result<HashSet<String>, DeliveryError> {
        let rows = sqlx::query_as::<_, RuntimeSectionGraceRow>(
            r#"
            SELECT section_key, actual_end_at
            FROM exam_session_runtime_sections
            WHERE runtime_id = ? AND status = 'completed' AND actual_end_at IS NOT NULL
            "#,
        )
        .bind(runtime_id)
        .fetch_all(conn)
        .await?;

        Ok(rows
            .into_iter()
            .filter(|row| {
                now <= row.actual_end_at + ChronoDuration::seconds(self.final_submit_grace_seconds)
            })
            .map(|row| row.section_key)
            .collect())
    }

    pub async fn record_heartbeat(
        &self,
        schedule_id: Uuid,
        req: StudentHeartbeatRequest,
    ) -> Result<StudentAttempt, DeliveryError> {
        let attempt = if let Some(attempt_id) = req.attempt_id {
            self.load_attempt_by_id(attempt_id).await?
        } else {
            self.load_attempt_by_student_key(schedule_id.to_string(), &req.student_key)
                .await?
        }
        .ok_or(DeliveryError::NotFound)?;

        if attempt.schedule_id != schedule_id.to_string() {
            return Err(DeliveryError::Validation(
                "Attempt does not belong to the provided schedule.".to_owned(),
            ));
        }

        let now = Utc::now();
        let mut integrity = ensure_object(attempt.integrity.clone().into());
        integrity.insert(
            "lastHeartbeatAt".to_owned(),
            Value::String(now.to_rfc3339()),
        );
        integrity.insert(
            "lastHeartbeatStatus".to_owned(),
            Value::String(match req.event_type {
                HeartbeatEventType::Disconnect | HeartbeatEventType::Lost => "lost".to_owned(),
                _ => "ok".to_owned(),
            }),
        );
        integrity.insert(
            "clientSessionId".to_owned(),
            Value::String(req.client_session_id.to_string()),
        );
        if matches!(
            req.event_type,
            HeartbeatEventType::Disconnect | HeartbeatEventType::Lost
        ) {
            integrity.insert(
                "lastDisconnectAt".to_owned(),
                Value::String(now.to_rfc3339()),
            );
        }
        if req.event_type == HeartbeatEventType::Reconnect {
            integrity.insert(
                "lastReconnectAt".to_owned(),
                Value::String(now.to_rfc3339()),
            );
        }

        let heartbeat_status = match req.event_type {
            HeartbeatEventType::Disconnect | HeartbeatEventType::Lost => "lost",
            _ => "ok",
        };
        let disconnect_at = matches!(
            req.event_type,
            HeartbeatEventType::Disconnect | HeartbeatEventType::Lost
        )
        .then_some(now);
        let reconnect_at = (req.event_type == HeartbeatEventType::Reconnect).then_some(now);

        // Heartbeats — including network transitions (Disconnect/Lost/Reconnect) —
        // are presence/metadata updates: they must never increment the answer
        // revision (BEX-050/BEX-051) or in-flight mutation batches composed
        // against the current revision would be rejected as stale. All event
        // types therefore go through update_attempt_heartbeat, which writes
        // ONLY `integrity`/`updated_at`. A blind full-row UPDATE here could
        // revert answers that a mutation batch committed between the read
        // above and this write (BEX-003); the loaded attempt is only used for
        // its integrity blob and the response is re-read from the row.
        let updated = self
            .update_attempt_heartbeat(attempt.id, Value::Object(integrity))
            .await?;

        sqlx::query(
            r#"
            INSERT INTO student_attempt_presence (
                attempt_id, schedule_id, client_session_id, last_heartbeat_at,
                last_heartbeat_status, last_disconnect_at, last_reconnect_at
            )
            VALUES (?, ?, ?, NOW(), ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                schedule_id = VALUES(schedule_id),
                client_session_id = VALUES(client_session_id),
                last_heartbeat_at = VALUES(last_heartbeat_at),
                last_heartbeat_status = VALUES(last_heartbeat_status),
                last_disconnect_at = COALESCE(VALUES(last_disconnect_at), last_disconnect_at),
                last_reconnect_at = COALESCE(VALUES(last_reconnect_at), last_reconnect_at),
                updated_at = NOW()
            "#,
        )
        .bind(&updated.id)
        .bind(schedule_id.to_string())
        .bind(req.client_session_id.to_string())
        .bind(heartbeat_status)
        .bind(disconnect_at)
        .bind(reconnect_at)
        .execute(&self.pool)
        .await?;

        if req.event_type != HeartbeatEventType::Heartbeat {
            let action_type = match req.event_type {
                HeartbeatEventType::Disconnect => "NETWORK_DISCONNECTED",
                HeartbeatEventType::Reconnect => "NETWORK_RECONNECTED",
                HeartbeatEventType::Lost => "HEARTBEAT_LOST",
                HeartbeatEventType::Heartbeat => "STUDENT_NETWORK",
            };
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
            .bind(&updated.candidate_name)
            .bind(action_type)
            .bind(&updated.id)
            .bind(json!({
                "eventType": req.event_type,
                "clientTimestamp": req.client_timestamp,
                "payload": req.payload
            }))
            .execute(&self.pool)
            .await?;
        }

        if req.event_type != HeartbeatEventType::Heartbeat {
            sqlx::query(
                r#"
                INSERT INTO student_heartbeat_events (
                    id, attempt_id, schedule_id, event_type, payload, client_timestamp, server_received_at
                )
                VALUES (?, ?, ?, ?, ?, ?, NOW())
                "#,
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&updated.id)
            .bind(schedule_id.to_string())
            .bind(req.event_type)
            .bind(&req.payload)
            .bind(req.client_timestamp)
            .execute(&self.pool)
            .await?;
        }

        Ok(updated)
    }

    #[tracing::instrument(
        skip(self, req),
        fields(schedule_id = %schedule_id, attempt_id = %req.attempt_id)
    )]
    pub async fn submit_attempt(
        &self,
        schedule_id: Uuid,
        req: StudentSubmitRequest,
        idempotency_key: Option<String>,
    ) -> Result<StudentSubmitResponse, DeliveryError> {
        let repository = self.idempotency_repository();
        let route_key = submit_route_key(schedule_id);
        let request_hash = self.idempotency_request_hash(&req, idempotency_key.as_ref())?;
        if let Some(response) = self
            .lookup_idempotent_response(
                &repository,
                &req.student_key,
                &route_key,
                idempotency_key.as_deref(),
                request_hash.as_deref(),
            )
            .await?
        {
            return Ok(response);
        }

        let mut tx = self.pool.begin().await?;
        let attempt = self
            .load_attempt_by_id_for_update(tx.as_mut(), req.attempt_id.clone())
            .await?
            .ok_or(DeliveryError::NotFound)?;
        if attempt.schedule_id != schedule_id.to_string() || attempt.student_key != req.student_key
        {
            return Err(DeliveryError::Validation(
                "Attempt does not belong to the provided schedule or student key.".to_owned(),
            ));
        }
        if let Some(response) = self
            .lookup_idempotent_response_on_connection(
                tx.as_mut(),
                &req.student_key,
                &route_key,
                idempotency_key.as_deref(),
                request_hash.as_deref(),
            )
            .await?
        {
            return Ok(response);
        }

        if !matches!(attempt.phase, AttemptPhase::Exam | AttemptPhase::PostExam) {
            return Err(DeliveryError::conflict(
                "Attempt cannot be submitted before the exam starts.".to_owned(),
            ));
        }

        let schedule_status: Option<String> =
            sqlx::query_scalar("SELECT status FROM exam_schedules WHERE id = ?")
                .bind(schedule_id.to_string())
                .fetch_optional(tx.as_mut())
                .await?;
        if schedule_status.as_deref() == Some("cancelled") {
            return Err(DeliveryError::conflict(
                "Cancelled schedules cannot accept submissions.".to_owned(),
            ));
        }

        let runtime_gate = sqlx::query_as::<_, RuntimeGateRow>(
            "SELECT id, status, current_section_key, waiting_for_next_section FROM exam_session_runtimes WHERE schedule_id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(tx.as_mut())
        .await?;
        match runtime_gate.as_ref().map(|row| row.status.as_str()) {
            Some("live") | Some("paused") | Some("completed") => {}
            Some("not_started") | None => {
                return Err(DeliveryError::Validation(
                    "Exam runtime has not started.".to_owned(),
                ));
            }
            Some("cancelled") => {
                return Err(DeliveryError::conflict(
                    "Cancelled schedules cannot accept submissions.".to_owned(),
                ));
            }
            Some(_) => {
                return Err(DeliveryError::Validation(
                    "Invalid runtime status.".to_owned(),
                ));
            }
        }

        if let Some(submitted_at) = attempt.submitted_at {
            let response = build_submit_response(attempt, submitted_at);
            self.store_idempotent_response(
                tx.as_mut(),
                &repository,
                &req.student_key,
                &route_key,
                idempotency_key.as_deref(),
                request_hash.as_deref(),
                &response,
            )
            .await?;
            tx.commit().await?;
            return Ok(response);
        }

        if let Some(last_seen_revision) = req.last_seen_revision {
            if attempt.revision != last_seen_revision {
                let active_session_id = self
                    .load_active_mutation_session_id(tx.as_mut(), &attempt.id)
                    .await?;
                return Err(DeliveryError::Conflict {
                    message: "Attempt revision is stale.".to_owned(),
                    reason: Some(DeliveryConflictReason::BaseRevisionMismatch),
                    latest_revision: Some(attempt.revision),
                    server_accepted_through_seq: None,
                    active_session_id,
                });
            }
        }

        if req.client_final_seq.is_none()
            && req.server_accepted_through_seq.is_none()
            && req.final_answer_patch.is_none()
        {
            return Err(DeliveryError::conflict_reason(
                DeliveryConflictReason::FinalFlushRequired,
                "Submit requires final flush metadata (seq values or final patch).",
            ));
        }

        let version = self
            .load_version(attempt.published_version_id.clone())
            .await?;
        let answer_schema = build_answer_schema(&version.content_snapshot)?;

        let mut final_answers = req
            .answers
            .clone()
            .unwrap_or_else(|| attempt.answers.clone().into());
        let mut final_writing_answers = req
            .writing_answers
            .clone()
            .unwrap_or_else(|| attempt.writing_answers.clone().into());
        let mut final_flags = req
            .flags
            .clone()
            .unwrap_or_else(|| attempt.flags.clone().into());

        if let Some(final_patch) = req.final_answer_patch.as_ref() {
            apply_final_answer_patch(
                final_patch,
                &mut final_answers,
                &mut final_writing_answers,
                &mut final_flags,
            )?;
        }

        let completion = compute_answer_completion(&answer_schema, &final_answers);
        let unanswered_submission_policy_is_block = version
            .config_snapshot
            .get("progression")
            .and_then(Value::as_object)
            .and_then(|progression| progression.get("unansweredSubmissionPolicy"))
            .and_then(Value::as_str)
            .map(|policy| policy.eq_ignore_ascii_case("block"))
            .unwrap_or(false);
        if unanswered_submission_policy_is_block
            && runtime_gate.as_ref().map(|row| row.status.as_str()) == Some("live")
            && completion.answered_slots < completion.total_slots
        {
            return Err(DeliveryError::Validation(
                "Runtime is live and unanswered submission policy is set to block.".to_owned(),
            ));
        }

        if let Some(expected_hash) = req.final_client_snapshot_hash.as_deref() {
            let canonical = serde_json::to_string(&json!({
                "answers": final_answers,
                "writingAnswers": final_writing_answers,
                "flags": final_flags
            }))
            .map_err(|err| {
                DeliveryError::Internal(format!(
                    "Failed to serialize final snapshot for hash verification: {err}"
                ))
            })?;
            let computed_hash = sha256_hex(&canonical);
            if computed_hash != expected_hash {
                return Err(DeliveryError::conflict_reason(
                    DeliveryConflictReason::FinalPayloadHashMismatch,
                    "Final payload hash mismatch.",
                ));
            }
        }

        let now = Utc::now();
        let submission_id = req
            .submission_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("submission-{}", Uuid::new_v4().simple()));
        let replay_incomplete = match (req.client_final_seq, req.server_accepted_through_seq) {
            (Some(client_final_seq), Some(server_accepted_through_seq)) => {
                server_accepted_through_seq < client_final_seq
            }
            (Some(client_final_seq), None) => client_final_seq > 0,
            _ => false,
        };
        let final_submission = json!({
            "submissionId": submission_id,
            "submittedAt": now,
            "answers": final_answers,
            "writingAnswers": final_writing_answers,
            "flags": final_flags,
            "finalFlush": {
                "clientFinalSeq": req.client_final_seq,
                "serverAcceptedThroughSeq": req.server_accepted_through_seq,
                "replayIncomplete": replay_incomplete,
                "finalPatchApplied": req.final_answer_patch.is_some()
            }
        });
        let recovery = merge_recovery(
            attempt.recovery.clone().into(),
            json!({
                "lastPersistedAt": now,
                "pendingMutationCount": 0,
                "syncState": "saved"
            }),
        );

        sqlx::query(
            r#"
            UPDATE student_attempts
            SET
                phase = ?,
                recovery = ?,
                final_submission = ?,
                submitted_at = ?,
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(AttemptPhase::PostExam)
        .bind(recovery)
        .bind(&final_submission)
        .bind(now)
        .bind(&req.attempt_id)
        .execute(tx.as_mut())
        .await?;

        let attempt =
            sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
                .bind(&req.attempt_id)
                .fetch_one(tx.as_mut())
                .await?;

        let submitted_at = attempt.submitted_at.unwrap_or(now);
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
        .bind(&attempt.candidate_name)
        .bind("STUDENT_SUBMIT")
        .bind(&attempt.id)
        .bind(json!({
            "submissionId": submission_id,
            "submittedAt": submitted_at,
            "answerCompletion": {
                "answeredSlots": completion.answered_slots,
                "totalSlots": completion.total_slots,
                "unansweredSlots": completion.total_slots.saturating_sub(completion.answered_slots)
            }
        }))
        .execute(tx.as_mut())
        .await?;

        let response = StudentSubmitResponse {
            attempt,
            submission_id,
            submitted_at,
            refreshed_attempt_credential: None,
        };

        self.store_idempotent_response(
            tx.as_mut(),
            &repository,
            &req.student_key,
            &route_key,
            idempotency_key.as_deref(),
            request_hash.as_deref(),
            &response,
        )
        .await?;

        tx.commit().await?;

        Ok(response)
    }

    #[allow(clippy::too_many_arguments)]
    async fn get_or_create_attempt(
        &self,
        schedule: &ExamSchedule,
        version: &ExamVersion,
        runtime: Option<&ExamSessionRuntime>,
        wcode: Option<&str>,
        student_key: &str,
        candidate_id: &str,
        candidate_name: &str,
        candidate_email: &str,
    ) -> Result<StudentAttempt, DeliveryError> {
        if let Some(attempt) = self
            .load_attempt_by_student_key(schedule.id.clone(), student_key)
            .await?
        {
            return Ok(attempt);
        }

        let registration = self
            .load_registration_by_student_key(schedule.id.clone(), student_key)
            .await?;
        let phase = determine_phase(runtime, false, false, None);
        let current_module = first_enabled_module(&version.config_snapshot);
        let phase_for_insert = phase.clone();
        let current_module_for_insert = current_module.clone();
        let now = Utc::now();

        let attempt_id = Uuid::new_v4();
        let insert_result = sqlx::query(
            r#"
            INSERT INTO student_attempts (
                id, schedule_id, registration_id, wcode, student_key, organization_id, exam_id, published_version_id,
                exam_title, candidate_id, candidate_name, candidate_email, phase, current_module,
                answers, writing_answers, flags, violations_snapshot, integrity, recovery,
                created_at, updated_at, revision
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 0)
            "#,
        )
        .bind(attempt_id.to_string())
        .bind(&schedule.id)
        .bind(registration.as_ref().map(|value| value.registration_id.clone()))
        .bind(wcode.unwrap_or(""))
        .bind(student_key)
        .bind(&schedule.organization_id)
        .bind(&schedule.exam_id)
        .bind(&schedule.published_version_id)
        .bind(&schedule.exam_title)
        .bind(candidate_id)
        .bind(candidate_name)
        .bind(candidate_email)
        .bind(phase_for_insert)
        .bind(current_module_for_insert)
        .bind(json!({}))
        .bind(json!({}))
        .bind(json!({}))
        .bind(json!([]))
        .bind(json!({
            "preCheck": null,
            "deviceFingerprintHash": null,
            "lastDisconnectAt": null,
            "lastReconnectAt": null,
            "lastHeartbeatAt": null,
            "lastHeartbeatStatus": "idle"
        }))
        .bind(json!({
            "lastRecoveredAt": null,
            "lastLocalMutationAt": null,
            "lastPersistedAt": null,
            "pendingMutationCount": 0,
            "syncState": "idle",
            "serverAcceptedThroughSeq": 0
        }))
        .execute(&self.pool)
        .await;

        // Two concurrent prechecks can race the UNIQUE (schedule_id,
        // student_key) constraint: one INSERT wins, the other must adopt the
        // winner's row instead of surfacing a duplicate-key error as a 500.
        if let Err(err) = insert_result {
            if is_duplicate_key(&err) {
                if let Some(existing) = self
                    .load_attempt_by_student_key(schedule.id.clone(), student_key)
                    .await?
                {
                    return Ok(existing);
                }
            }
            return Err(err.into());
        }

        sqlx::query(
            r#"
            INSERT INTO session_audit_logs (
                id, schedule_id, actor, action_type, target_student_id, payload, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NOW())
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&schedule.id)
        .bind(candidate_name)
        .bind("STUDENT_ATTEMPT_CREATED")
        .bind(attempt_id.to_string())
        .bind(json!({
            "candidateId": candidate_id,
            "candidateEmail": candidate_email,
            "wcode": wcode.unwrap_or(""),
            "currentModule": current_module,
            "phase": phase
        }))
        .execute(&self.pool)
        .await?;

        sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
            .bind(attempt_id.to_string())
            .fetch_one(&self.pool)
            .await
            .map_err(DeliveryError::from)
    }

    #[allow(clippy::too_many_arguments)]
    /// Full-row pass-through UPDATE that preserves the attempt `revision`.
    /// Callers must pass every column from a value freshly read off the row
    /// (precheck/bootstrap pass through the just-loaded attempt). Known
    /// limitation: if a mutation batch commits between the caller's read and
    /// this write, the pass-through values would clobber the batch's accepted
    /// answers (BEX-003). Acceptable for precheck/bootstrap, which run at
    /// session start before concurrent mutation batches are in flight;
    /// heartbeats must use `update_attempt_heartbeat` instead, which writes
    /// only `integrity`/`updated_at`. The duplicate-key adoption path in
    /// `get_or_create_attempt` also feeds this full-row pass-through, so a
    /// same-key/different-payload RACE could briefly clobber the attempt row
    /// with the 409-returning request's integrity before the conflict is
    /// discovered — benign for identical payloads (the tested case),
    /// pre-existing wrinkle.
    async fn update_attempt_preserving_revision(
        &self,
        attempt_id: String,
        phase: AttemptPhase,
        current_module: ModuleType,
        current_question_id: Option<String>,
        answers: Value,
        writing_answers: Value,
        flags: Value,
        violations_snapshot: Value,
        integrity: Value,
        recovery: Value,
        final_submission: Option<Value>,
        submitted_at: Option<DateTime<Utc>>,
    ) -> Result<StudentAttempt, DeliveryError> {
        sqlx::query(
            r#"
            UPDATE student_attempts
            SET
                phase = ?,
                current_module = ?,
                current_question_id = ?,
                answers = ?,
                writing_answers = ?,
                flags = ?,
                violations_snapshot = ?,
                integrity = ?,
                recovery = ?,
                final_submission = ?,
                submitted_at = ?,
                updated_at = NOW()
            WHERE id = ?
            "#,
        )
        .bind(phase)
        .bind(current_module)
        .bind(current_question_id)
        .bind(answers)
        .bind(writing_answers)
        .bind(flags)
        .bind(violations_snapshot)
        .bind(integrity)
        .bind(recovery)
        .bind(final_submission)
        .bind(submitted_at)
        .bind(attempt_id.to_string())
        .execute(&self.pool)
        .await?;

        sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
            .bind(attempt_id.to_string())
            .fetch_one(&self.pool)
            .await
            .map_err(DeliveryError::from)
    }

    /// Heartbeat presence updates are metadata-only. Unlike
    /// `update_attempt_preserving_revision`, this writes ONLY `integrity` and
    /// `updated_at` — never answers/writing_answers/flags/violations/
    /// recovery/revision — so a heartbeat that races a mutation-batch commit
    /// cannot revert answers the batch just accepted (BEX-003). The row is
    /// re-read for the response.
    async fn update_attempt_heartbeat(
        &self,
        attempt_id: String,
        integrity: Value,
    ) -> Result<StudentAttempt, DeliveryError> {
        sqlx::query(
            r#"
            UPDATE student_attempts
            SET
                integrity = ?,
                updated_at = NOW()
            WHERE id = ?
            "#,
        )
        .bind(integrity)
        .bind(attempt_id.to_string())
        .execute(&self.pool)
        .await?;

        sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
            .bind(attempt_id.to_string())
            .fetch_one(&self.pool)
            .await
            .map_err(DeliveryError::from)
    }

    async fn load_schedule(&self, schedule_id: Uuid) -> Result<ExamSchedule, DeliveryError> {
        sqlx::query_as::<_, ExamSchedule>("SELECT * FROM exam_schedules WHERE id = ?")
            .bind(schedule_id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DeliveryError::NotFound)
    }

    async fn load_version(&self, version_id: String) -> Result<ExamVersion, DeliveryError> {
        sqlx::query_as::<_, ExamVersion>(
            "SELECT id, CAST(exam_id AS CHAR) as exam_id, version_number, CAST(parent_version_id AS CHAR) as parent_version_id, content_snapshot, config_snapshot, validation_snapshot, CAST(created_by AS CHAR) as created_by, created_at, publish_notes, is_draft, is_published, revision FROM exam_versions WHERE id = ?"
        )
            .bind(&version_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(DeliveryError::NotFound)
    }

    async fn load_runtime(
        &self,
        schedule_id: Uuid,
    ) -> Result<Option<ExamSessionRuntime>, DeliveryError> {
        let actor = ActorContext::new(Uuid::nil().to_string(), ActorRole::Admin);
        SchedulingService::new(self.pool.clone())
            .get_runtime(&actor, schedule_id)
            .await
            .map(Some)
            .or_else(|err| match err {
                crate::scheduling::SchedulingError::NotFound => Ok(None),
                crate::scheduling::SchedulingError::Database(error) => {
                    Err(DeliveryError::Database(error))
                }
                crate::scheduling::SchedulingError::Conflict(message) => {
                    Err(DeliveryError::conflict(message))
                }
                crate::scheduling::SchedulingError::Validation(message) => {
                    Err(DeliveryError::Validation(message))
                }
            })
    }

    async fn load_attempt_by_student_key(
        &self,
        schedule_id: String,
        student_key: &str,
    ) -> Result<Option<StudentAttempt>, DeliveryError> {
        sqlx::query_as::<_, StudentAttempt>(
            "SELECT * FROM student_attempts WHERE schedule_id = ? AND student_key = ?",
        )
        .bind(&schedule_id)
        .bind(student_key)
        .fetch_optional(&self.pool)
        .await
        .map_err(DeliveryError::from)
    }

    async fn load_attempt_by_wcode(
        &self,
        schedule_id: String,
        wcode: &str,
    ) -> Result<Option<StudentAttempt>, DeliveryError> {
        sqlx::query_as::<_, StudentAttempt>(
            "SELECT * FROM student_attempts WHERE schedule_id = ? AND wcode = ?",
        )
        .bind(&schedule_id)
        .bind(wcode)
        .fetch_optional(&self.pool)
        .await
        .map_err(DeliveryError::from)
    }

    async fn load_registration_by_student_key(
        &self,
        schedule_id: String,
        student_key: &str,
    ) -> Result<Option<AttemptRegistrationRow>, DeliveryError> {
        sqlx::query_as::<_, AttemptRegistrationRow>(
            r#"
            SELECT id AS registration_id, user_id
            FROM schedule_registrations
            WHERE schedule_id = ?
              AND student_key = ?
            LIMIT 1
            "#,
        )
        .bind(&schedule_id)
        .bind(student_key)
        .fetch_optional(&self.pool)
        .await
        .map_err(DeliveryError::from)
    }

    async fn load_attempt_by_id(
        &self,
        attempt_id: String,
    ) -> Result<Option<StudentAttempt>, DeliveryError> {
        sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
            .bind(&attempt_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(DeliveryError::from)
    }

    async fn load_attempt_by_id_for_update(
        &self,
        connection: &mut MySqlConnection,
        attempt_id: String,
    ) -> Result<Option<StudentAttempt>, DeliveryError> {
        sqlx::query_as::<_, StudentAttempt>(
            "SELECT * FROM student_attempts WHERE id = ? FOR UPDATE",
        )
        .bind(&attempt_id)
        .fetch_optional(connection)
        .await
        .map_err(DeliveryError::from)
    }

    fn idempotency_repository(&self) -> IdempotencyRepository {
        IdempotencyRepository::new(self.pool.clone())
    }

    fn idempotency_request_hash<T: Serialize>(
        &self,
        request: &T,
        idempotency_key: Option<&String>,
    ) -> Result<Option<String>, DeliveryError> {
        if idempotency_key.is_none() {
            return Ok(None);
        }

        let serialized = serde_json::to_string(request).map_err(|err| {
            DeliveryError::Internal(format!("Failed to serialize request: {err}"))
        })?;
        Ok(Some(sha256_hex(&serialized)))
    }

    /// Deterministic request hash for mutation batches (BEX-033).
    ///
    /// The route stamps `timestamp: Utc::now()` onto every `MutationEnvelope`
    /// while parsing the HTTP payload, so serializing the
    /// request directly would yield a different hash for two byte-identical
    /// bodies and every replay would be misclassified as a hash mismatch
    /// (409 "Idempotency-Key does not match the original request."). The
    /// timestamp is a server-side reception artifact (persisted as
    /// `client_timestamp`, not part of the client-authored idempotency
    /// identity), so it is stripped before hashing. All client-authored
    /// fields — envelope id/seq/command/base_revision and the request-level
    /// attempt/student/session — are covered, so the same key with a
    /// genuinely different batch still hashes differently and conflicts.
    fn batch_idempotency_request_hash(
        &self,
        request: &StudentMutationBatchRequest,
        idempotency_key: Option<&String>,
    ) -> Result<Option<String>, DeliveryError> {
        if idempotency_key.is_none() {
            return Ok(None);
        }

        let mut value = serde_json::to_value(request).map_err(|err| {
            DeliveryError::Internal(format!("Failed to serialize request: {err}"))
        })?;
        if let Some(mutations) = value.get_mut("mutations").and_then(Value::as_array_mut) {
            for mutation in mutations {
                if let Some(object) = mutation.as_object_mut() {
                    object.remove("timestamp");
                }
            }
        }
        // serde_json::Map is a BTreeMap, so `to_string` is key-ordered and the
        // serialization is stable across processes and replays.
        let serialized = serde_json::to_string(&value).map_err(|err| {
            DeliveryError::Internal(format!("Failed to serialize request: {err}"))
        })?;
        Ok(Some(sha256_hex(&serialized)))
    }

    async fn lookup_idempotent_response<T>(
        &self,
        repository: &IdempotencyRepository,
        actor_id: &str,
        route_key: &str,
        idempotency_key: Option<&str>,
        request_hash: Option<&str>,
    ) -> Result<Option<T>, DeliveryError>
    where
        T: DeserializeOwned,
    {
        let Some(idempotency_key) = idempotency_key else {
            return Ok(None);
        };
        let request_hash = request_hash.expect("request hash present when idempotency key exists");
        let Some(record) = repository
            .lookup(actor_id, route_key, idempotency_key)
            .await?
        else {
            return Ok(None);
        };

        if record.request_hash != request_hash {
            return Err(DeliveryError::conflict(
                "Idempotency-Key does not match the original request.".to_owned(),
            ));
        }

        Ok(Some(deserialize_idempotent_response(&record)?))
    }

    async fn store_idempotent_response<T>(
        &self,
        connection: &mut MySqlConnection,
        repository: &IdempotencyRepository,
        actor_id: &str,
        route_key: &str,
        idempotency_key: Option<&str>,
        request_hash: Option<&str>,
        response: &T,
    ) -> Result<(), DeliveryError>
    where
        T: Serialize,
    {
        let Some(idempotency_key) = idempotency_key else {
            return Ok(());
        };
        let request_hash = request_hash.expect("request hash present when idempotency key exists");
        let response_body = serde_json::to_value(response).map_err(|err| {
            DeliveryError::Internal(format!("Failed to serialize idempotent response: {err}"))
        })?;
        repository
            .store_with_executor(
                connection,
                actor_id,
                route_key,
                idempotency_key,
                request_hash,
                200,
                &response_body,
            )
            .await?;
        Ok(())
    }

    async fn lookup_idempotent_response_on_connection<T>(
        &self,
        connection: &mut MySqlConnection,
        actor_id: &str,
        route_key: &str,
        idempotency_key: Option<&str>,
        request_hash: Option<&str>,
    ) -> Result<Option<T>, DeliveryError>
    where
        T: DeserializeOwned,
    {
        let Some(idempotency_key) = idempotency_key else {
            return Ok(None);
        };
        let request_hash = request_hash.expect("request hash present when idempotency key exists");
        let Some(record) = IdempotencyRepository::lookup_with_executor(
            connection,
            actor_id,
            route_key,
            idempotency_key,
        )
        .await?
        else {
            return Ok(None);
        };

        if record.request_hash != request_hash {
            return Err(DeliveryError::conflict(
                "Idempotency-Key does not match the original request.".to_owned(),
            ));
        }

        Ok(Some(deserialize_idempotent_response(&record)?))
    }
}

fn derive_student_key(schedule_id: Uuid, candidate_id: &str) -> String {
    format!("student-{schedule_id}-{candidate_id}")
}

fn is_duplicate_key(err: &sqlx::Error) -> bool {
    // sqlx reports the MySQL numeric code (1062) on older versions and the
    // SQLSTATE (23000) on newer ones; accept both.
    match err {
        sqlx::Error::Database(db_err) => {
            matches!(db_err.code().as_deref(), Some("1062") | Some("23000"))
        }
        _ => false,
    }
}

fn mutation_batch_route_key(schedule_id: Uuid) -> String {
    format!("POST:/api/v1/student/sessions/{schedule_id}/mutations:batch")
}

fn precheck_route_key(schedule_id: Uuid) -> String {
    format!("POST:/api/v1/student/sessions/{schedule_id}/precheck")
}

fn submit_route_key(schedule_id: Uuid) -> String {
    format!("POST:/api/v1/student/sessions/{schedule_id}/submit")
}

pub(crate) async fn auto_submit_schedule_attempts_in_tx(
    connection: &mut MySqlConnection,
    schedule_id: Uuid,
    completion_reason: &str,
) -> Result<(), DeliveryError> {
    let pending_attempts = sqlx::query_as::<_, StudentAttempt>(
        "SELECT * FROM student_attempts WHERE schedule_id = ? AND submitted_at IS NULL FOR UPDATE",
    )
    .bind(schedule_id.to_string())
    .fetch_all(&mut *connection)
    .await?;

    if pending_attempts.is_empty() {
        return Ok(());
    }

    let now = Utc::now();
    for attempt in pending_attempts {
        let submission_id = format!("submission-{}", Uuid::new_v4().simple());
        let final_submission = json!({
            "submissionId": submission_id,
            "submittedAt": now,
            "answers": attempt.answers,
            "writingAnswers": attempt.writing_answers,
            "flags": attempt.flags,
            "completionReason": completion_reason,
            "autoSubmission": true,
            "proctorStatus": attempt.proctor_status.as_str(),
            "submissionPolicy": "forced_auto_submit"
        });
        let recovery = merge_recovery(
            attempt.recovery.clone().into(),
            json!({
                "lastPersistedAt": now,
                "pendingMutationCount": 0,
                "syncState": "saved"
            }),
        );

        sqlx::query(
            r#"
            UPDATE student_attempts
            SET
                phase = ?,
                recovery = ?,
                final_submission = ?,
                submitted_at = ?,
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(AttemptPhase::PostExam)
        .bind(recovery)
        .bind(&final_submission)
        .bind(now)
        .bind(&attempt.id)
        .execute(&mut *connection)
        .await?;
    }

    Ok(())
}

pub async fn finalize_pending_schedule_attempts(
    pool: &MySqlPool,
    schedule_id: Uuid,
    completion_reason: &str,
    _batch_size: i64,
) -> Result<(), DeliveryError> {
    let mut tx = pool.begin().await?;
    auto_submit_schedule_attempts_in_tx(tx.as_mut(), schedule_id, completion_reason).await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn force_finalize_attempt_if_pending(
    pool: &MySqlPool,
    schedule_id: Uuid,
    attempt_id: Uuid,
    completion_reason: &str,
) -> Result<(), DeliveryError> {
    let mut tx = pool.begin().await?;
    let pending_attempt = sqlx::query_as::<_, StudentAttempt>(
        "SELECT * FROM student_attempts WHERE id = ? AND schedule_id = ? AND submitted_at IS NULL FOR UPDATE",
    )
    .bind(attempt_id.to_string())
    .bind(schedule_id.to_string())
    .fetch_optional(tx.as_mut())
    .await?;

    let Some(attempt) = pending_attempt else {
        tx.commit().await?;
        return Ok(());
    };

    let now = Utc::now();
    let submission_id = format!("submission-{}", Uuid::new_v4().simple());
    let final_submission = json!({
        "submissionId": submission_id,
        "submittedAt": now,
        "answers": attempt.answers,
        "writingAnswers": attempt.writing_answers,
        "flags": attempt.flags,
        "completionReason": completion_reason,
        "autoSubmission": true,
        "proctorStatus": attempt.proctor_status.as_str(),
        "submissionPolicy": "forced_auto_submit"
    });
    let recovery = merge_recovery(
        attempt.recovery.clone().into(),
        json!({
            "lastPersistedAt": now,
            "pendingMutationCount": 0,
            "syncState": "saved"
        }),
    );

    sqlx::query(
        r#"
        UPDATE student_attempts
        SET
            phase = ?,
            recovery = ?,
            final_submission = ?,
            submitted_at = ?,
            updated_at = NOW(),
            revision = revision + 1
        WHERE id = ?
        "#,
    )
    .bind(AttemptPhase::PostExam)
    .bind(recovery)
    .bind(&final_submission)
    .bind(now)
    .bind(attempt_id.to_string())
    .execute(tx.as_mut())
    .await?;

    tx.commit().await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct AttemptRegistrationRow {
    registration_id: Hyphenated,
    user_id: Option<Hyphenated>,
}

fn deserialize_idempotent_response<T>(record: &IdempotencyRecord) -> Result<T, DeliveryError>
where
    T: DeserializeOwned,
{
    serde_json::from_value(record.response_body.clone()).map_err(|err| {
        DeliveryError::Internal(format!("Cached idempotent response was invalid: {err}"))
    })
}

fn build_submit_response(
    attempt: StudentAttempt,
    submitted_at: DateTime<Utc>,
) -> StudentSubmitResponse {
    StudentSubmitResponse {
        submission_id: attempt
            .final_submission
            .as_ref()
            .and_then(|value| value.get("submissionId"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("submission-{}", attempt.id)),
        attempt,
        submitted_at,
        refreshed_attempt_credential: None,
    }
}

fn determine_phase(
    runtime: Option<&ExamSessionRuntime>,
    has_precheck: bool,
    submitted: bool,
    previous_phase: Option<AttemptPhase>,
) -> AttemptPhase {
    if submitted {
        return AttemptPhase::PostExam;
    }

    match runtime.map(|snapshot| snapshot.status.clone()) {
        Some(
            ielts_backend_domain::schedule::RuntimeStatus::Live
            | ielts_backend_domain::schedule::RuntimeStatus::Paused,
        ) => AttemptPhase::Exam,
        Some(
            ielts_backend_domain::schedule::RuntimeStatus::Completed
            | ielts_backend_domain::schedule::RuntimeStatus::Cancelled,
        ) => {
            if previous_phase == Some(AttemptPhase::Exam) {
                AttemptPhase::Exam
            } else {
                AttemptPhase::PostExam
            }
        }
        _ if has_precheck => AttemptPhase::Lobby,
        _ => AttemptPhase::PreCheck,
    }
}

fn first_enabled_module(config_snapshot: &Value) -> ModuleType {
    for (section_key, module) in [
        ("listening", ModuleType::Listening),
        ("reading", ModuleType::Reading),
        ("writing", ModuleType::Writing),
        ("speaking", ModuleType::Speaking),
    ] {
        if config_snapshot
            .get("sections")
            .and_then(|sections| sections.get(section_key))
            .and_then(|section| section.get("enabled"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return module;
        }
    }

    ModuleType::Listening
}

fn validate_batch_sequences(mutations: &[MutationEnvelope]) -> Result<(), DeliveryError> {
    let mut seen = std::collections::BTreeSet::new();
    for mutation in mutations {
        if !seen.insert(mutation.seq) {
            return Err(DeliveryError::Validation(
                "Mutation batch contains duplicate sequence values.".to_owned(),
            ));
        }
    }
    Ok(())
}

fn validate_batch_mutation_ids(mutations: &[MutationEnvelope]) -> Result<(), DeliveryError> {
    let mut seen = std::collections::BTreeSet::new();
    for mutation in mutations {
        if mutation.id.trim().is_empty() {
            return Err(DeliveryError::Validation(
                "Mutation id cannot be empty.".to_owned(),
            ));
        }
        if !seen.insert(mutation.id.as_str()) {
            return Err(DeliveryError::Validation(
                "Mutation batch contains duplicate mutation ids.".to_owned(),
            ));
        }
    }
    Ok(())
}

fn validate_contiguous_sequences(
    existing_max_seq: i64,
    mutations: &[MutationEnvelope],
) -> Result<(), DeliveryError> {
    let mut seqs: Vec<i64> = mutations.iter().map(|mutation| mutation.seq).collect();
    seqs.sort_unstable();

    let Some(&first) = seqs.first() else {
        return Err(DeliveryError::Validation(
            "Mutation batch must contain at least one mutation.".to_owned(),
        ));
    };
    if first != existing_max_seq + 1 {
        return Err(DeliveryError::conflict(
            "Mutation sequence must continue from the last accepted value.".to_owned(),
        ));
    }

    for window in seqs.windows(2) {
        let [left, right] = window else { continue };
        if *right != *left + 1 {
            return Err(DeliveryError::conflict(
                "Mutation sequence must be contiguous.".to_owned(),
            ));
        }
    }

    Ok(())
}

#[derive(sqlx::FromRow)]
struct RuntimeGateRow {
    id: String,
    status: String,
    current_section_key: Option<String>,
    waiting_for_next_section: bool,
}

#[derive(sqlx::FromRow)]
struct RuntimeSectionGraceRow {
    section_key: String,
    actual_end_at: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct ExistingMutationIdentityRow {
    client_mutation_id: String,
    mutation_type: MutationType,
    payload: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ObjectiveMutationGate {
    allowed: bool,
    reason: Option<DeliveryConflictReason>,
}

impl ObjectiveMutationGate {
    fn allow() -> Self {
        Self {
            allowed: true,
            reason: None,
        }
    }

    fn block(reason: DeliveryConflictReason) -> Self {
        Self {
            allowed: false,
            reason: Some(reason),
        }
    }
}

fn objective_mutation_gate(
    runtime: Option<&RuntimeGateRow>,
    proctor_status: Option<ielts_backend_domain::attempt::ProctorStatus>,
) -> ObjectiveMutationGate {
    if matches!(
        proctor_status,
        Some(ielts_backend_domain::attempt::ProctorStatus::Paused)
            | Some(ielts_backend_domain::attempt::ProctorStatus::Terminated)
    ) {
        return ObjectiveMutationGate::block(DeliveryConflictReason::AttemptProctorBlocked);
    }

    if let Some(runtime) = runtime {
        if runtime.waiting_for_next_section {
            return ObjectiveMutationGate::block(DeliveryConflictReason::ObjectiveLocked);
        }
        if matches!(
            runtime.status.as_str(),
            "paused" | "completed" | "cancelled"
        ) {
            return ObjectiveMutationGate::block(DeliveryConflictReason::ObjectiveLocked);
        }
    }

    ObjectiveMutationGate::allow()
}

fn derive_authoritative_phase(
    runtime_gate: Option<&RuntimeGateRow>,
    has_precheck: bool,
    submitted: bool,
    previous_phase: AttemptPhase,
) -> AttemptPhase {
    if submitted {
        return AttemptPhase::PostExam;
    }

    match runtime_gate.map(|gate| gate.status.as_str()) {
        Some("live" | "paused") => AttemptPhase::Exam,
        Some("completed" | "cancelled") => {
            if previous_phase == AttemptPhase::Exam {
                AttemptPhase::Exam
            } else {
                AttemptPhase::PostExam
            }
        }
        _ if has_precheck => AttemptPhase::Lobby,
        _ => AttemptPhase::PreCheck,
    }
}

#[derive(Debug, Clone)]
enum AnswerConstraint {
    Text,
    Enum(HashSet<String>),
    MultiChoice {
        allowed: HashSet<String>,
        max: usize,
    },
    ArrayText {
        max_len: usize,
    },
    EnumArray {
        allowed: HashSet<String>,
        max_len: usize,
    },
}

#[derive(Debug, Clone)]
struct AnswerSchema {
    constraints: HashMap<String, AnswerConstraint>,
    sections: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy)]
struct AnswerCompletion {
    answered_slots: usize,
    total_slots: usize,
}

fn is_answered_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(values) => values.iter().any(is_answered_value),
        _ => true,
    }
}

fn slots_for_constraint(constraint: &AnswerConstraint) -> usize {
    match constraint {
        AnswerConstraint::ArrayText { max_len } => *max_len,
        AnswerConstraint::EnumArray { max_len, .. } => *max_len,
        AnswerConstraint::MultiChoice { max, .. } => *max,
        AnswerConstraint::Text | AnswerConstraint::Enum(_) => 1,
    }
}

fn answered_slots_for_constraint(constraint: &AnswerConstraint, value: Option<&Value>) -> usize {
    match constraint {
        AnswerConstraint::Text | AnswerConstraint::Enum(_) => {
            value.map_or(0, |v| usize::from(is_answered_value(v)))
        }
        AnswerConstraint::MultiChoice { max, .. } => {
            let Some(Value::Array(values)) = value else {
                return 0;
            };
            values
                .iter()
                .filter(|entry| is_answered_value(entry))
                .take(*max)
                .count()
        }
        AnswerConstraint::ArrayText { max_len } | AnswerConstraint::EnumArray { max_len, .. } => {
            let Some(Value::Array(values)) = value else {
                return 0;
            };
            (0..*max_len)
                .filter(|index| values.get(*index).is_some_and(is_answered_value))
                .count()
        }
    }
}

fn compute_answer_completion(schema: &AnswerSchema, answers: &Value) -> AnswerCompletion {
    let mut total_slots = 0usize;
    let mut answered_slots = 0usize;

    for (key, constraint) in &schema.constraints {
        total_slots += slots_for_constraint(constraint);
        let value = answers.get(key);
        answered_slots += answered_slots_for_constraint(constraint, value);
    }

    AnswerCompletion {
        answered_slots,
        total_slots,
    }
}

fn build_writing_task_ids(config_snapshot: &Value) -> HashSet<String> {
    let mut ids = HashSet::new();
    if let Some(tasks) = config_snapshot
        .get("sections")
        .and_then(|sections| sections.get("writing"))
        .and_then(|writing| writing.get("tasks"))
        .and_then(Value::as_array)
    {
        for task in tasks {
            if let Some(id) = task
                .get("id")
                .or_else(|| task.get("taskId"))
                .and_then(Value::as_str)
            {
                ids.insert(id.to_owned());
            }
        }
    }
    if ids.is_empty() {
        ids.insert("task1".to_owned());
        ids.insert("task2".to_owned());
    }
    ids
}

fn build_answer_schema(content_snapshot: &Value) -> Result<AnswerSchema, DeliveryError> {
    let mut constraints: HashMap<String, AnswerConstraint> = HashMap::new();
    let mut sections: HashMap<String, String> = HashMap::new();

    if let Some(passages) = content_snapshot
        .get("reading")
        .and_then(|reading| reading.get("passages"))
        .and_then(Value::as_array)
    {
        for passage in passages {
            if let Some(blocks) = passage.get("blocks").and_then(Value::as_array) {
                for block in blocks {
                    index_block(block, "reading", &mut constraints, &mut sections)?;
                }
            }
        }
    }

    if let Some(parts) = content_snapshot
        .get("listening")
        .and_then(|listening| listening.get("parts"))
        .and_then(Value::as_array)
    {
        for part in parts {
            if let Some(blocks) = part.get("blocks").and_then(Value::as_array) {
                for block in blocks {
                    index_block(block, "listening", &mut constraints, &mut sections)?;
                }
            }
        }
    }

    Ok(AnswerSchema {
        constraints,
        sections,
    })
}

fn index_block(
    block: &Value,
    section_key: &str,
    constraints: &mut HashMap<String, AnswerConstraint>,
    sections: &mut HashMap<String, String>,
) -> Result<(), DeliveryError> {
    if register_sub_answer_tree_constraints(block, section_key, constraints, sections)? {
        return Ok(());
    }

    let Some(block_type) = block.get("type").and_then(Value::as_str) else {
        return Ok(());
    };
    let block_id = block
        .get("id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    match block_type {
        "TFNG" | "CLOZE" | "MATCHING" | "MAP" | "SHORT_ANSWER" => {
            let Some(questions) = block.get("questions").and_then(Value::as_array) else {
                return Ok(());
            };
            let mut allowed_heading_values: Option<HashSet<String>> = None;
            if block_type == "MATCHING" {
                if let Some(headings) = block.get("headings").and_then(Value::as_array) {
                    let mut values = HashSet::new();
                    for (index, _heading) in headings.iter().enumerate() {
                        values.insert(matching_heading_value(index));
                    }
                    if !values.is_empty() {
                        allowed_heading_values = Some(values);
                    }
                }
            }
            for question in questions {
                let Some(id) = question.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let constraint = match block_type {
                    "TFNG" => {
                        // Legacy fixtures may only provide `id` for TFNG questions.
                        // Keep those permissive to avoid contract drift while strict TFNG
                        // validation still applies when full question metadata is present.
                        let is_legacy_minimal = question
                            .as_object()
                            .map(|obj| obj.len() == 1 && obj.contains_key("id"))
                            .unwrap_or(false);
                        if is_legacy_minimal {
                            AnswerConstraint::Text
                        } else {
                            let mode = block.get("mode").and_then(Value::as_str).unwrap_or("TFNG");
                            let allowed: HashSet<String> = match mode {
                                "YNNG" => {
                                    ["Y", "N", "NG"].into_iter().map(|v| v.to_owned()).collect()
                                }
                                _ => ["T", "F", "NG"].into_iter().map(|v| v.to_owned()).collect(),
                            };
                            AnswerConstraint::Enum(allowed)
                        }
                    }
                    "MATCHING" => allowed_heading_values
                        .clone()
                        .map(AnswerConstraint::Enum)
                        .unwrap_or(AnswerConstraint::Text),
                    _ => AnswerConstraint::Text,
                };
                constraints.insert(id.to_owned(), constraint);
                register_section(sections, id, section_key)?;
            }
        }
        "SENTENCE_COMPLETION" | "NOTE_COMPLETION" => {
            let Some(questions) = block.get("questions").and_then(Value::as_array) else {
                return Ok(());
            };
            for question in questions {
                let Some(id) = question.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let blanks = question.get("blanks").and_then(Value::as_array);
                let max_len = blanks.map(|value| value.len()).unwrap_or(0);
                constraints.insert(id.to_owned(), AnswerConstraint::ArrayText { max_len });
                register_section(sections, id, section_key)?;
                if let Some(blanks) = blanks {
                    for blank in blanks {
                        if let Some(blank_id) = blank.get("id").and_then(Value::as_str) {
                            register_section(sections, &format!("{id}:{blank_id}"), section_key)?;
                        }
                    }
                }
            }
        }
        "MULTI_MCQ" => {
            let Some(block_id) = block_id else {
                return Ok(());
            };
            let mut allowed = HashSet::new();
            let mut correct_count = 0usize;
            if let Some(options) = block.get("options").and_then(Value::as_array) {
                for option in options {
                    if option
                        .get("isCorrect")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                    {
                        correct_count += 1;
                    }
                    if let Some(id) = option.get("id").and_then(Value::as_str) {
                        allowed.insert(id.to_owned());
                    }
                }
            }
            register_section(sections, &block_id, section_key)?;
            constraints.insert(
                block_id,
                AnswerConstraint::MultiChoice {
                    allowed,
                    max: correct_count.max(1),
                },
            );
        }
        "SINGLE_MCQ" => {
            if let Some(questions) = block.get("questions").and_then(Value::as_array) {
                if !questions.is_empty() {
                    for question in questions {
                        let Some(question_id) = question.get("id").and_then(Value::as_str) else {
                            continue;
                        };
                        let mut allowed = HashSet::new();
                        if let Some(options) = question.get("options").and_then(Value::as_array) {
                            for option in options {
                                if let Some(id) = option.get("id").and_then(Value::as_str) {
                                    allowed.insert(id.to_owned());
                                }
                            }
                        }
                        register_section(sections, question_id, section_key)?;
                        constraints.insert(question_id.to_owned(), AnswerConstraint::Enum(allowed));
                    }
                    return Ok(());
                }
            }

            let Some(block_id) = block_id else {
                return Ok(());
            };
            let mut allowed = HashSet::new();
            if let Some(options) = block.get("options").and_then(Value::as_array) {
                for option in options {
                    if let Some(id) = option.get("id").and_then(Value::as_str) {
                        allowed.insert(id.to_owned());
                    }
                }
            }
            register_section(sections, &block_id, section_key)?;
            constraints.insert(block_id, AnswerConstraint::Enum(allowed));
        }
        "DIAGRAM_LABELING" => {
            let Some(block_id) = block_id else {
                return Ok(());
            };
            let labels = block.get("labels").and_then(Value::as_array);
            let max_len = labels.map(|value| value.len()).unwrap_or(0);
            register_section(sections, &block_id, section_key)?;
            if let Some(labels) = labels {
                for label in labels {
                    if let Some(label_id) = label.get("id").and_then(Value::as_str) {
                        register_section(sections, &format!("{block_id}:{label_id}"), section_key)?;
                    }
                }
            }
            constraints.insert(block_id, AnswerConstraint::ArrayText { max_len });
        }
        "FLOW_CHART" => {
            let Some(block_id) = block_id else {
                return Ok(());
            };
            let steps = block.get("steps").and_then(Value::as_array);
            let max_len = steps.map(|value| value.len()).unwrap_or(0);
            register_section(sections, &block_id, section_key)?;
            if let Some(steps) = steps {
                for step in steps {
                    if let Some(step_id) = step.get("id").and_then(Value::as_str) {
                        register_section(sections, &format!("{block_id}:{step_id}"), section_key)?;
                    }
                }
            }
            constraints.insert(block_id, AnswerConstraint::ArrayText { max_len });
        }
        "TABLE_COMPLETION" => {
            let Some(block_id) = block_id else {
                return Ok(());
            };
            let cells = block.get("cells").and_then(Value::as_array);
            let max_len = cells.map(|value| value.len()).unwrap_or(0);
            register_section(sections, &block_id, section_key)?;
            if let Some(cells) = cells {
                for cell in cells {
                    if let Some(cell_id) = cell.get("id").and_then(Value::as_str) {
                        register_section(sections, &format!("{block_id}:{cell_id}"), section_key)?;
                    }
                }
            }
            constraints.insert(block_id, AnswerConstraint::ArrayText { max_len });
        }
        "CLASSIFICATION" => {
            let Some(block_id) = block_id else {
                return Ok(());
            };
            let items = block.get("items").and_then(Value::as_array);
            let max_len = items.map(|value| value.len()).unwrap_or(0);
            let mut allowed = HashSet::new();
            if let Some(categories) = block.get("categories").and_then(Value::as_array) {
                for category in categories.iter().filter_map(Value::as_str) {
                    allowed.insert(category.to_owned());
                }
            }
            register_section(sections, &block_id, section_key)?;
            if let Some(items) = items {
                for item in items {
                    if let Some(item_id) = item.get("id").and_then(Value::as_str) {
                        register_section(sections, &format!("{block_id}:{item_id}"), section_key)?;
                    }
                }
            }
            constraints.insert(block_id, AnswerConstraint::EnumArray { allowed, max_len });
        }
        "MATCHING_FEATURES" => {
            let Some(block_id) = block_id else {
                return Ok(());
            };
            let features = block.get("features").and_then(Value::as_array);
            let max_len = features.map(|value| value.len()).unwrap_or(0);
            let mut allowed = HashSet::new();
            if let Some(options) = block.get("options").and_then(Value::as_array) {
                for option in options.iter().filter_map(Value::as_str) {
                    allowed.insert(option.to_owned());
                }
            }
            register_section(sections, &block_id, section_key)?;
            if let Some(features) = features {
                for feature in features {
                    if let Some(feature_id) = feature.get("id").and_then(Value::as_str) {
                        register_section(
                            sections,
                            &format!("{block_id}:{feature_id}"),
                            section_key,
                        )?;
                    }
                }
            }
            constraints.insert(block_id, AnswerConstraint::EnumArray { allowed, max_len });
        }
        _ => {}
    }

    Ok(())
}

fn register_sub_answer_tree_constraints(
    block: &Value,
    section_key: &str,
    constraints: &mut HashMap<String, AnswerConstraint>,
    sections: &mut HashMap<String, String>,
) -> Result<bool, DeliveryError> {
    let enabled = block
        .get("subAnswerModeEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !enabled {
        return Ok(false);
    }

    let Some(block_id) = block.get("id").and_then(Value::as_str) else {
        return Ok(false);
    };
    let Some(roots) = block.get("answerTree").and_then(Value::as_array) else {
        return Ok(false);
    };
    if roots.is_empty() {
        return Ok(false);
    }

    for root in roots {
        let Some(root_id) = root.get("id").and_then(Value::as_str) else {
            continue;
        };
        let mut stack: Vec<&Value> = vec![root];
        while let Some(node) = stack.pop() {
            let children = node.get("children").and_then(Value::as_array);
            let is_leaf = children.map(|entries| entries.is_empty()).unwrap_or(true);
            if is_leaf {
                let Some(node_id) = node.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let question_id = format!("{block_id}::tree::{root_id}::{node_id}");
                constraints.insert(question_id.clone(), AnswerConstraint::Text);
                register_section(sections, &question_id, section_key)?;
                continue;
            }

            if let Some(children) = children {
                for child in children {
                    stack.push(child);
                }
            }
        }
    }

    Ok(true)
}

fn matching_heading_value(index: usize) -> String {
    match index {
        0 => "i".to_owned(),
        1 => "ii".to_owned(),
        2 => "iii".to_owned(),
        3 => "iv".to_owned(),
        4 => "v".to_owned(),
        5 => "vi".to_owned(),
        6 => "vii".to_owned(),
        7 => "viii".to_owned(),
        8 => "ix".to_owned(),
        9 => "x".to_owned(),
        10 => "xi".to_owned(),
        11 => "xii".to_owned(),
        _ => index.to_string(),
    }
}

fn register_section(
    sections: &mut HashMap<String, String>,
    key: &str,
    section_key: &str,
) -> Result<(), DeliveryError> {
    let Some(existing) = sections.insert(key.to_owned(), section_key.to_owned()) else {
        return Ok(());
    };

    if existing == section_key {
        return Ok(());
    }

    Err(DeliveryError::Validation(
        "Question identifiers must be unique across sections.".to_owned(),
    ))
}

fn validate_answer_value(
    constraint: &AnswerConstraint,
    value: &Value,
) -> Result<(), DeliveryError> {
    match constraint {
        AnswerConstraint::Text => match value {
            Value::Null | Value::String(_) => Ok(()),
            _ => Err(DeliveryError::Validation(
                "Answer value must be a string (or null).".to_owned(),
            )),
        },
        AnswerConstraint::Enum(allowed) => match value {
            Value::Null => Ok(()),
            Value::String(text) => {
                if text.is_empty() || allowed.is_empty() || allowed.contains(text) {
                    Ok(())
                } else {
                    Err(DeliveryError::Validation(
                        "Answer value is not valid for this question.".to_owned(),
                    ))
                }
            }
            _ => Err(DeliveryError::Validation(
                "Answer value must be a string (or null).".to_owned(),
            )),
        },
        AnswerConstraint::MultiChoice { allowed, max } => match value {
            Value::Null => Ok(()),
            Value::Array(values) => {
                if values.len() > *max {
                    return Err(DeliveryError::Validation(
                        "Too many selections for this question.".to_owned(),
                    ));
                }
                let mut seen = HashSet::new();
                for entry in values {
                    let Some(text) = entry.as_str() else {
                        return Err(DeliveryError::Validation(
                            "Selections must be strings.".to_owned(),
                        ));
                    };
                    if !seen.insert(text) {
                        return Err(DeliveryError::Validation(
                            "Selections must be unique.".to_owned(),
                        ));
                    }
                    if !allowed.is_empty() && !allowed.contains(text) {
                        return Err(DeliveryError::Validation(
                            "Selection is not valid for this question.".to_owned(),
                        ));
                    }
                }
                Ok(())
            }
            _ => Err(DeliveryError::Validation(
                "Answer value must be an array (or null).".to_owned(),
            )),
        },
        AnswerConstraint::ArrayText { max_len } => match value {
            Value::Null => Ok(()),
            Value::Array(values) => {
                if *max_len > 0 && values.len() > *max_len {
                    return Err(DeliveryError::Validation(
                        "Answer array is longer than expected.".to_owned(),
                    ));
                }
                for entry in values {
                    if !(entry.is_string() || entry.is_null()) {
                        return Err(DeliveryError::Validation(
                            "Answer array values must be strings (or null).".to_owned(),
                        ));
                    }
                }
                Ok(())
            }
            _ => Err(DeliveryError::Validation(
                "Answer value must be an array (or null).".to_owned(),
            )),
        },
        AnswerConstraint::EnumArray { allowed, max_len } => match value {
            Value::Null => Ok(()),
            Value::Array(values) => {
                if *max_len > 0 && values.len() > *max_len {
                    return Err(DeliveryError::Validation(
                        "Answer array is longer than expected.".to_owned(),
                    ));
                }
                for entry in values {
                    match entry {
                        Value::Null => continue,
                        Value::String(text) => {
                            if !text.is_empty() && !allowed.is_empty() && !allowed.contains(text) {
                                return Err(DeliveryError::Validation(
                                    "Answer value is not valid for this question.".to_owned(),
                                ));
                            }
                        }
                        _ => {
                            return Err(DeliveryError::Validation(
                                "Answer array values must be strings (or null).".to_owned(),
                            ));
                        }
                    }
                }
                Ok(())
            }
            _ => Err(DeliveryError::Validation(
                "Answer value must be an array (or null).".to_owned(),
            )),
        },
    }
}

fn apply_mutation(
    mutation: &MutationEnvelope,
    answer_schema: &AnswerSchema,
    writing_task_ids: &HashSet<String>,
    objective_mutation_gate: ObjectiveMutationGate,
    active_section_key: Option<&str>,
    transition_grace_section_keys: &HashSet<String>,
    answers: &mut Value,
    writing_answers: &mut Value,
    flags: &mut Value,
    violations_snapshot: &mut Value,
    _phase: &mut AttemptPhase,
    _current_module: &mut ModuleType,
    current_question_id: &mut Option<String>,
    recovery: &mut Value,
) -> Result<bool, DeliveryError> {
    match &mutation.command {
        MutationCommand::Answer(payload)
        | MutationCommand::SetScalar(payload)
        | MutationCommand::SetChoice(payload) => {
            if !objective_mutation_gate.allowed {
                return Err(DeliveryError::conflict_reason(
                    objective_mutation_gate
                        .reason
                        .unwrap_or(DeliveryConflictReason::ObjectiveLocked),
                    "Objective mutations are currently locked.",
                ));
            }
            let question_id = payload.question_id.clone();
            if !answer_schema.constraints.contains_key(&question_id) {
                tracing::warn!(
                    mutation_id = %mutation.id,
                    mutation_type = mutation.mutation_type().as_str(),
                    question_id = %question_id,
                    "mutation references unknown questionId; accepting but ignoring apply"
                );
                return Ok(false);
            }
            enforce_section_membership(
                active_section_key,
                transition_grace_section_keys,
                &question_id,
                answer_schema,
            )?;
            let value = payload.value.clone();
            let constraint = answer_schema.constraints.get(&question_id).ok_or_else(|| {
                DeliveryError::Validation("Mutation references an unknown `questionId`.".to_owned())
            })?;
            validate_answer_value(constraint, &value)?;
            let next_answers = ensure_object(std::mem::take(answers));
            *current_question_id = Some(question_id.clone());
            *answers = Value::Object(set_value(next_answers, question_id, value));
            Ok(true)
        }
        MutationCommand::ClearScalar(payload) | MutationCommand::ClearChoice(payload) => {
            if !objective_mutation_gate.allowed {
                return Err(DeliveryError::conflict_reason(
                    objective_mutation_gate
                        .reason
                        .unwrap_or(DeliveryConflictReason::ObjectiveLocked),
                    "Objective mutations are currently locked.",
                ));
            }
            let question_id = payload.question_id.clone();
            if !answer_schema.constraints.contains_key(&question_id) {
                tracing::warn!(
                    mutation_id = %mutation.id,
                    mutation_type = mutation.mutation_type().as_str(),
                    question_id = %question_id,
                    "mutation references unknown questionId; accepting but ignoring apply"
                );
                return Ok(false);
            }
            enforce_section_membership(
                active_section_key,
                transition_grace_section_keys,
                &question_id,
                answer_schema,
            )?;
            let constraint = answer_schema.constraints.get(&question_id).ok_or_else(|| {
                DeliveryError::Validation("Mutation references an unknown `questionId`.".to_owned())
            })?;
            validate_answer_value(constraint, &Value::Null)?;
            let next_answers = ensure_object(std::mem::take(answers));
            *current_question_id = Some(question_id.clone());
            *answers = Value::Object(set_value(next_answers, question_id, Value::Null));
            Ok(true)
        }
        MutationCommand::SetSlot(payload) => {
            if !objective_mutation_gate.allowed {
                return Err(DeliveryError::conflict_reason(
                    objective_mutation_gate
                        .reason
                        .unwrap_or(DeliveryConflictReason::ObjectiveLocked),
                    "Objective mutations are currently locked.",
                ));
            }
            let question_id = payload.question_id.clone();
            if !answer_schema.constraints.contains_key(&question_id) {
                tracing::warn!(
                    mutation_id = %mutation.id,
                    mutation_type = mutation.mutation_type().as_str(),
                    question_id = %question_id,
                    "mutation references unknown questionId; accepting but ignoring apply"
                );
                return Ok(false);
            }
            enforce_section_membership(
                active_section_key,
                transition_grace_section_keys,
                &question_id,
                answer_schema,
            )?;
            let slot_index = usize::try_from(payload.slot_index).unwrap_or(usize::MAX);
            let value = payload.value.clone();
            let constraint = answer_schema.constraints.get(&question_id).ok_or_else(|| {
                DeliveryError::Validation("Mutation references an unknown `questionId`.".to_owned())
            })?;
            set_array_slot_answer(answers, &question_id, slot_index, value, constraint)?;
            *current_question_id = Some(question_id);
            Ok(true)
        }
        MutationCommand::ClearSlot(payload) => {
            if !objective_mutation_gate.allowed {
                return Err(DeliveryError::conflict_reason(
                    objective_mutation_gate
                        .reason
                        .unwrap_or(DeliveryConflictReason::ObjectiveLocked),
                    "Objective mutations are currently locked.",
                ));
            }
            let question_id = payload.question_id.clone();
            if !answer_schema.constraints.contains_key(&question_id) {
                tracing::warn!(
                    mutation_id = %mutation.id,
                    mutation_type = mutation.mutation_type().as_str(),
                    question_id = %question_id,
                    "mutation references unknown questionId; accepting but ignoring apply"
                );
                return Ok(false);
            }
            enforce_section_membership(
                active_section_key,
                transition_grace_section_keys,
                &question_id,
                answer_schema,
            )?;
            let slot_index = usize::try_from(payload.slot_index).unwrap_or(usize::MAX);
            let constraint = answer_schema.constraints.get(&question_id).ok_or_else(|| {
                DeliveryError::Validation("Mutation references an unknown `questionId`.".to_owned())
            })?;
            set_array_slot_answer(answers, &question_id, slot_index, Value::Null, constraint)?;
            *current_question_id = Some(question_id);
            Ok(true)
        }
        MutationCommand::WritingAnswer(payload) | MutationCommand::SetEssayText(payload) => {
            if !objective_mutation_gate.allowed {
                return Err(DeliveryError::conflict_reason(
                    objective_mutation_gate
                        .reason
                        .unwrap_or(DeliveryConflictReason::ObjectiveLocked),
                    "Objective mutations are currently locked.",
                ));
            }
            let task_id = payload.task_id.clone();
            if !writing_task_ids.contains(&task_id) {
                tracing::warn!(
                    mutation_id = %mutation.id,
                    mutation_type = "writing_answer",
                    task_id = %task_id,
                    "mutation references unknown taskId; accepting but ignoring apply"
                );
                return Ok(false);
            }
            if let Some(active_section_key) = active_section_key {
                if active_section_key != "writing"
                    && !transition_grace_section_keys.contains("writing")
                {
                    return Err(DeliveryError::conflict_reason(
                        DeliveryConflictReason::SectionMismatch,
                        "Mutation belongs to an inactive section.",
                    ));
                }
            }
            let value = payload.value.clone();
            if !matches!(value, Value::String(_) | Value::Null) {
                return Err(DeliveryError::Validation(
                    "Writing answers must be a string (or null).".to_owned(),
                ));
            }
            let next_writing_answers = ensure_object(std::mem::take(writing_answers));
            *current_question_id = Some(task_id.clone());
            *writing_answers = Value::Object(set_value(next_writing_answers, task_id, value));
            Ok(true)
        }
        MutationCommand::ClearEssayText(payload) => {
            if !objective_mutation_gate.allowed {
                return Err(DeliveryError::conflict_reason(
                    objective_mutation_gate
                        .reason
                        .unwrap_or(DeliveryConflictReason::ObjectiveLocked),
                    "Objective mutations are currently locked.",
                ));
            }
            let task_id = payload.task_id.clone();
            if !writing_task_ids.contains(&task_id) {
                tracing::warn!(
                    mutation_id = %mutation.id,
                    mutation_type = mutation.mutation_type().as_str(),
                    task_id = %task_id,
                    "mutation references unknown taskId; accepting but ignoring apply"
                );
                return Ok(false);
            }
            if let Some(active_section_key) = active_section_key {
                if active_section_key != "writing"
                    && !transition_grace_section_keys.contains("writing")
                {
                    return Err(DeliveryError::conflict_reason(
                        DeliveryConflictReason::SectionMismatch,
                        "Mutation belongs to an inactive section.",
                    ));
                }
            }
            let next_writing_answers = ensure_object(std::mem::take(writing_answers));
            *current_question_id = Some(task_id.clone());
            *writing_answers = Value::Object(set_value(next_writing_answers, task_id, Value::Null));
            Ok(true)
        }
        MutationCommand::Flag(payload) => {
            if !objective_mutation_gate.allowed {
                return Err(DeliveryError::conflict_reason(
                    objective_mutation_gate
                        .reason
                        .unwrap_or(DeliveryConflictReason::ObjectiveLocked),
                    "Objective mutations are currently locked.",
                ));
            }
            let question_id = payload.question_id.clone();
            if !answer_schema.sections.contains_key(&question_id) {
                tracing::warn!(
                    mutation_id = %mutation.id,
                    mutation_type = "flag",
                    question_id = %question_id,
                    "mutation references unknown questionId; accepting but ignoring apply"
                );
                return Ok(false);
            }
            enforce_section_membership(
                active_section_key,
                transition_grace_section_keys,
                &question_id,
                answer_schema,
            )?;
            let flag_value = payload.value.as_bool().ok_or_else(|| {
                DeliveryError::Validation("Flag values must be boolean.".to_owned())
            })?;
            let next_flags = ensure_object(std::mem::take(flags));
            *flags = Value::Object(set_value(next_flags, question_id, Value::Bool(flag_value)));
            Ok(true)
        }
        MutationCommand::Position(payload) => {
            // Client position is telemetry only. Never treat it as authoritative state.
            let next_phase = payload.phase;
            let next_module = payload.current_module;
            let parsed_question_id = payload.current_question_id.clone();
            if let Some(ref value) = parsed_question_id {
                let known_objective = answer_schema.sections.contains_key(value);
                let known_writing = writing_task_ids.contains(value);
                if !(known_objective || known_writing) {
                    tracing::warn!(
                        mutation_id = %mutation.id,
                        mutation_type = "position",
                        current_question_id = value,
                        "position references unknown currentQuestionId; accepting but ignoring apply"
                    );
                    return Ok(false);
                }
            }
            *recovery = merge_recovery(
                std::mem::take(recovery),
                json!({
                    "clientPosition": {
                        "phase": next_phase,
                        "currentModule": next_module,
                        "currentQuestionId": parsed_question_id,
                        "at": mutation.timestamp,
                    }
                }),
            );
            Ok(true)
        }
        MutationCommand::Violation(payload) => {
            // Payloads vary; apply only when the client includes an authoritative snapshot.
            if let Some(snapshot) = payload.violations.as_ref() {
                let snapshot =
                    serde_json::to_value(snapshot).unwrap_or_else(|_| Value::Array(Vec::new()));
                *violations_snapshot =
                    merge_violations_snapshot(violations_snapshot, &snapshot, 500)?;
            } else {
                tracing::warn!(
                    mutation_id = %mutation.id,
                    "violation mutation missing `violations` snapshot; skipping apply"
                );
            }
            Ok(true)
        }
        MutationCommand::Precheck(_)
        | MutationCommand::Network(_)
        | MutationCommand::Heartbeat(_)
        | MutationCommand::DeviceFingerprint(_)
        | MutationCommand::Sync(_) => {
            tracing::warn!(
                mutation_id = %mutation.id,
                mutation_type = mutation.mutation_type().as_str(),
                "mutation type is accepted as telemetry only; stored but not applied"
            );
            Ok(false)
        }
    }
}

fn apply_final_answer_patch(
    patch: &Value,
    answers: &mut Value,
    writing_answers: &mut Value,
    flags: &mut Value,
) -> Result<(), DeliveryError> {
    let Some(patch_map) = patch.as_object() else {
        return Err(DeliveryError::Validation(
            "finalAnswerPatch must be a JSON object.".to_owned(),
        ));
    };

    if let Some(next_answers) = patch_map.get("answers") {
        if !next_answers.is_object() {
            return Err(DeliveryError::Validation(
                "finalAnswerPatch.answers must be an object.".to_owned(),
            ));
        }
        *answers = merge_object_values(answers, next_answers);
    }
    if let Some(next_writing_answers) = patch_map.get("writingAnswers") {
        if !next_writing_answers.is_object() {
            return Err(DeliveryError::Validation(
                "finalAnswerPatch.writingAnswers must be an object.".to_owned(),
            ));
        }
        *writing_answers = merge_object_values(writing_answers, next_writing_answers);
    }
    if let Some(next_flags) = patch_map.get("flags") {
        if !next_flags.is_object() {
            return Err(DeliveryError::Validation(
                "finalAnswerPatch.flags must be an object.".to_owned(),
            ));
        }
        *flags = merge_object_values(flags, next_flags);
    }

    Ok(())
}

fn merge_object_values(base: &Value, patch: &Value) -> Value {
    let mut merged = ensure_object(base.clone());
    if let Some(patch_map) = patch.as_object() {
        for (key, value) in patch_map {
            merged.insert(key.clone(), value.clone());
        }
    }
    Value::Object(merged)
}

fn is_within_post_submit_grace_window(
    submitted_at: DateTime<Utc>,
    now: DateTime<Utc>,
    grace_seconds: i64,
) -> bool {
    if grace_seconds <= 0 {
        return false;
    }
    let deadline = submitted_at + ChronoDuration::seconds(grace_seconds);
    now <= deadline
}

fn merge_post_submit_submission_snapshot(
    existing: Option<Value>,
    answers: &Value,
    writing_answers: &Value,
    flags: &Value,
    now: DateTime<Utc>,
    applied_mutation_count: usize,
    grace_window_seconds: i64,
    server_accepted_through_seq: i64,
) -> Value {
    let mut merged = ensure_object(existing.unwrap_or_else(|| json!({})));
    merged.insert("answers".to_owned(), answers.clone());
    merged.insert("writingAnswers".to_owned(), writing_answers.clone());
    merged.insert("flags".to_owned(), flags.clone());

    let mut grace_merge = merged
        .get("graceMerge")
        .cloned()
        .map(ensure_object)
        .unwrap_or_default();
    let merge_count = grace_merge
        .get("mergeCount")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .saturating_add(1);
    let applied_total = grace_merge
        .get("appliedMutationTotal")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        .saturating_add(i64::try_from(applied_mutation_count).unwrap_or(i64::MAX));
    if !grace_merge.contains_key("firstAcceptedAt") {
        grace_merge.insert(
            "firstAcceptedAt".to_owned(),
            Value::String(now.to_rfc3339()),
        );
    }
    grace_merge.insert("acceptedInGrace".to_owned(), Value::Bool(true));
    grace_merge.insert("lastAcceptedAt".to_owned(), Value::String(now.to_rfc3339()));
    grace_merge.insert("mergeCount".to_owned(), Value::from(merge_count));
    grace_merge.insert(
        "lastAppliedMutationCount".to_owned(),
        Value::from(i64::try_from(applied_mutation_count).unwrap_or(i64::MAX)),
    );
    grace_merge.insert(
        "appliedMutationTotal".to_owned(),
        Value::from(applied_total),
    );
    grace_merge.insert(
        "graceWindowSeconds".to_owned(),
        Value::from(grace_window_seconds.max(0)),
    );
    merged.insert("graceMerge".to_owned(), Value::Object(grace_merge));

    let mut final_flush = merged
        .get("finalFlush")
        .cloned()
        .map(ensure_object)
        .unwrap_or_default();
    final_flush.insert(
        "serverAcceptedThroughSeq".to_owned(),
        Value::from(server_accepted_through_seq),
    );
    let client_final_seq = final_flush
        .get("clientFinalSeq")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    if client_final_seq > 0 {
        let replay_incomplete = server_accepted_through_seq < client_final_seq;
        final_flush.insert(
            "replayIncomplete".to_owned(),
            Value::Bool(replay_incomplete),
        );
        if !replay_incomplete {
            final_flush.insert(
                "replayCompletedAt".to_owned(),
                Value::String(now.to_rfc3339()),
            );
        }
    }
    merged.insert("finalFlush".to_owned(), Value::Object(final_flush));

    Value::Object(merged)
}

fn merge_recovery(existing: Value, patch: Value) -> Value {
    let mut base = ensure_object(existing);
    if let Some(patch_map) = patch.as_object() {
        for (key, value) in patch_map {
            base.insert(key.clone(), value.clone());
        }
    }
    Value::Object(base)
}

fn ensure_object(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

fn set_value(mut object: Map<String, Value>, key: String, value: Value) -> Map<String, Value> {
    object.insert(key, value);
    object
}

fn set_array_slot_answer(
    answers: &mut Value,
    question_id: &str,
    slot_index: usize,
    slot_value: Value,
    constraint: &AnswerConstraint,
) -> Result<(), DeliveryError> {
    let mut next_answers = ensure_object(std::mem::take(answers));
    let existing_value = next_answers
        .remove(question_id)
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let mut array = match existing_value {
        Value::Array(values) => values,
        Value::Null => Vec::new(),
        _ => {
            return Err(DeliveryError::Validation(
                "Slot mutation requires an array-backed answer field.".to_owned(),
            ));
        }
    };
    while array.len() <= slot_index {
        array.push(Value::Null);
    }
    array[slot_index] = slot_value;
    let updated_value = Value::Array(array);
    validate_answer_value(constraint, &updated_value)?;
    next_answers.insert(question_id.to_owned(), updated_value);
    *answers = Value::Object(next_answers);
    Ok(())
}

fn enforce_section_membership(
    active_section_key: Option<&str>,
    transition_grace_section_keys: &HashSet<String>,
    question_id: &str,
    answer_schema: &AnswerSchema,
) -> Result<(), DeliveryError> {
    let expected = answer_schema
        .sections
        .get(question_id)
        .map(String::as_str)
        .ok_or_else(|| {
            DeliveryError::Validation("Mutation references an unknown `questionId`.".to_owned())
        })?;
    if let Some(active_section_key) = active_section_key {
        if expected != active_section_key {
            if transition_grace_section_keys.contains(expected) {
                return Ok(());
            }
            return Err(DeliveryError::conflict_reason(
                DeliveryConflictReason::SectionMismatch,
                format!(
                    "Mutation section mismatch for question `{question_id}` (expected `{expected}`, active `{active_section_key}`)."
                ),
            ));
        }
    }
    Ok(())
}

fn merge_violations_snapshot(
    existing_snapshot: &Value,
    incoming_snapshot: &Value,
    cap: usize,
) -> Result<Value, DeliveryError> {
    let existing = existing_snapshot.as_array().cloned().unwrap_or_default();
    let incoming = incoming_snapshot.as_array().cloned().unwrap_or_default();

    let mut merged: HashMap<String, Value> = HashMap::new();
    for violation in existing.into_iter().chain(incoming) {
        let Some(id) = violation.get("id").and_then(Value::as_str) else {
            continue;
        };
        if id.trim().is_empty() {
            continue;
        }
        merged.insert(id.to_owned(), violation);
    }

    let mut values: Vec<Value> = merged.into_values().collect();
    values.sort_by_key(|value| violation_timestamp_key(value));

    if values.len() > cap {
        values = values.into_iter().rev().take(cap).collect();
        values.sort_by_key(|value| violation_timestamp_key(value));
    }

    Ok(Value::Array(values))
}

fn violation_timestamp_key(value: &Value) -> i128 {
    let Some(raw) = value.get("timestamp").and_then(Value::as_str) else {
        return 0;
    };
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|parsed| parsed.timestamp_millis() as i128)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use ielts_backend_domain::attempt::MutationCommand;
    use ielts_backend_domain::schedule::RuntimeStatus;
    use serde_json::json;

    fn runtime_with_status(status: RuntimeStatus) -> ExamSessionRuntime {
        let now = Utc::now();
        ExamSessionRuntime {
            id: "runtime-1".to_owned(),
            schedule_id: "schedule-1".to_owned(),
            exam_id: "exam-1".to_owned(),
            status,
            plan_snapshot: Vec::new(),
            actual_start_at: None,
            actual_end_at: None,
            active_section_key: None,
            current_section_key: None,
            current_section_remaining_seconds: 0,
            current_section_deadline_at: None,
            server_now: now,
            waiting_for_next_section: false,
            is_overrun: false,
            total_paused_seconds: 0,
            created_at: now,
            updated_at: now,
            revision: 0,
            sections: Vec::new(),
        }
    }

    fn command(mutation_type: MutationType, payload: Value) -> MutationCommand {
        serde_json::from_value(json!({
            "mutationType": mutation_type.as_str(),
            "payload": payload
        }))
        .expect("valid mutation command")
    }

    #[test]
    fn build_writing_task_ids_supports_legacy_task_id_field() {
        let config_snapshot = json!({
            "sections": {
                "writing": {
                    "tasks": [
                        { "taskId": "task-1" },
                        { "taskId": "task-2" }
                    ]
                }
            }
        });

        let ids = build_writing_task_ids(&config_snapshot);
        assert!(ids.contains("task-1"));
        assert!(ids.contains("task-2"));
    }

    #[test]
    fn build_writing_task_ids_prefers_explicit_id_and_falls_back_to_task_id() {
        let config_snapshot = json!({
            "sections": {
                "writing": {
                    "tasks": [
                        { "id": "task1", "taskId": "legacy-task-1" },
                        { "taskId": "task2" }
                    ]
                }
            }
        });

        let ids = build_writing_task_ids(&config_snapshot);
        assert!(ids.contains("task1"));
        assert!(ids.contains("task2"));
        assert!(!ids.contains("legacy-task-1"));
    }

    #[test]
    fn determine_phase_follows_lifecycle_progression() {
        assert_eq!(
            determine_phase(None, false, false, None),
            AttemptPhase::PreCheck
        );
        assert_eq!(
            determine_phase(None, true, false, None),
            AttemptPhase::Lobby
        );

        let live = runtime_with_status(RuntimeStatus::Live);
        assert_eq!(
            determine_phase(Some(&live), false, false, None),
            AttemptPhase::Exam
        );

        let paused = runtime_with_status(RuntimeStatus::Paused);
        assert_eq!(
            determine_phase(Some(&paused), true, false, None),
            AttemptPhase::Exam
        );

        let completed = runtime_with_status(RuntimeStatus::Completed);
        assert_eq!(
            determine_phase(Some(&completed), true, false, Some(AttemptPhase::Exam)),
            AttemptPhase::Exam
        );
        assert_eq!(
            determine_phase(Some(&completed), true, false, Some(AttemptPhase::Lobby)),
            AttemptPhase::PostExam
        );

        assert_eq!(
            determine_phase(None, true, true, None),
            AttemptPhase::PostExam
        );
    }

    #[test]
    fn objective_mutation_gate_blocks_when_runtime_or_proctor_disallow() {
        let base = RuntimeGateRow {
            id: "runtime-1".to_owned(),
            status: "paused".to_owned(),
            current_section_key: Some("reading".to_owned()),
            waiting_for_next_section: false,
        };
        let paused_gate = objective_mutation_gate(
            Some(&base),
            Some(ielts_backend_domain::attempt::ProctorStatus::Active),
        );
        assert!(!paused_gate.allowed);
        assert_eq!(
            paused_gate.reason,
            Some(DeliveryConflictReason::ObjectiveLocked)
        );

        let live = RuntimeGateRow {
            status: "live".to_owned(),
            ..base
        };
        let live_gate = objective_mutation_gate(
            Some(&live),
            Some(ielts_backend_domain::attempt::ProctorStatus::Active),
        );
        assert!(live_gate.allowed);

        let blocked_by_proctor = objective_mutation_gate(
            Some(&live),
            Some(ielts_backend_domain::attempt::ProctorStatus::Paused),
        );
        assert!(!blocked_by_proctor.allowed);
        assert_eq!(
            blocked_by_proctor.reason,
            Some(DeliveryConflictReason::AttemptProctorBlocked)
        );
    }

    #[test]
    fn validate_batch_mutation_ids_rejects_empty_or_duplicate_ids() {
        let base = MutationEnvelope {
            id: "m1".to_owned(),
            seq: 1,
            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
            command: command(
                MutationType::Answer,
                json!({"questionId": "q1", "value": "A"}),
            ),
            base_revision: None,
        };

        let empty = MutationEnvelope {
            id: "   ".to_owned(),
            seq: 2,
            ..base.clone()
        };
        assert!(matches!(
            validate_batch_mutation_ids(&[base.clone(), empty]),
            Err(DeliveryError::Validation(_))
        ));

        let dup = MutationEnvelope {
            id: "m1".to_owned(),
            seq: 2,
            ..base.clone()
        };
        assert!(matches!(
            validate_batch_mutation_ids(&[base, dup]),
            Err(DeliveryError::Validation(_))
        ));
    }

    #[test]
    fn apply_mutation_tracks_current_question_and_separates_writing_answers() {
        let answer_schema = AnswerSchema {
            constraints: HashMap::from_iter([(
                "q1".to_owned(),
                AnswerConstraint::Enum(
                    ["A", "B", "C", "D"]
                        .into_iter()
                        .map(|value| value.to_owned())
                        .collect(),
                ),
            )]),
            sections: HashMap::from_iter([("q1".to_owned(), "reading".to_owned())]),
        };
        let writing_task_ids: HashSet<String> = ["task-1".to_owned()].into_iter().collect();

        let mut answers = json!({});
        let mut writing_answers = json!({});
        let mut flags = json!({});
        let mut violations_snapshot = json!([]);
        let mut phase = AttemptPhase::Exam;
        let mut current_module = ModuleType::Reading;
        let mut current_question_id = None;
        let mut recovery = json!({});

        assert!(apply_mutation(
            &MutationEnvelope {
                id: "m1".to_owned(),
                seq: 1,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
                command: command(
                    MutationType::Answer,
                    json!({"questionId": "q1", "value": "A"})
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            Some("reading"),
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("apply answer"));

        assert_eq!(answers["q1"], "A");
        assert_eq!(writing_answers, json!({}));
        assert_eq!(current_question_id.as_deref(), Some("q1"));

        assert!(apply_mutation(
            &MutationEnvelope {
                id: "m2".to_owned(),
                seq: 2,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 5).unwrap(),
                command: command(
                    MutationType::WritingAnswer,
                    json!({"taskId": "task-1", "value": "Draft 1"}),
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            Some("writing"),
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("apply writing answer"));

        assert_eq!(answers["q1"], "A");
        assert_eq!(writing_answers["task-1"], "Draft 1");
        assert_eq!(current_question_id.as_deref(), Some("task-1"));

        assert!(apply_mutation(
            &MutationEnvelope {
                id: "m3".to_owned(),
                seq: 3,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 10).unwrap(),
                command: command(
                    MutationType::Flag,
                    json!({"questionId": "q1", "value": true})
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            Some("reading"),
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("apply flag"));

        assert_eq!(flags["q1"], true);
        assert_eq!(current_question_id.as_deref(), Some("task-1"));
    }

    #[test]
    fn validate_contiguous_sequences_rejects_gaps() {
        let base = MutationEnvelope {
            id: "m".to_owned(),
            seq: 0,
            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
            command: command(
                MutationType::Answer,
                json!({"questionId": "q1", "value": "A"}),
            ),
            base_revision: None,
        };
        let mut a = base.clone();
        a.seq = 2;
        let mut b = base.clone();
        b.seq = 4;
        let err = validate_contiguous_sequences(1, &[a, b]).unwrap_err();
        assert!(matches!(err, DeliveryError::Conflict { .. }));
    }

    #[test]
    fn apply_mutation_records_position_as_telemetry() {
        let answer_schema = AnswerSchema {
            constraints: HashMap::from_iter([("q1".to_owned(), AnswerConstraint::Text)]),
            sections: HashMap::from_iter([("q1".to_owned(), "reading".to_owned())]),
        };
        let writing_task_ids: HashSet<String> = ["task1".to_owned()].into_iter().collect();
        let mut answers = json!({});
        let mut writing_answers = json!({});
        let mut flags = json!({});
        let mut violations_snapshot = json!([]);
        let mut phase = AttemptPhase::PreCheck;
        let mut current_module = ModuleType::Listening;
        let mut current_question_id = None;
        let mut recovery = json!({});

        assert!(apply_mutation(
            &MutationEnvelope {
                id: "m-pos".to_owned(),
                seq: 1,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
                command: command(
                    MutationType::Position,
                    json!({"phase":"exam","currentModule":"reading","currentQuestionId":"q1"}),
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            None,
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("apply position"));

        assert_eq!(phase, AttemptPhase::PreCheck);
        assert_eq!(current_module, ModuleType::Listening);
        assert_eq!(current_question_id, None);
        assert_eq!(recovery["clientPosition"]["phase"], "exam");
        assert_eq!(recovery["clientPosition"]["currentModule"], "reading");
        assert_eq!(recovery["clientPosition"]["currentQuestionId"], "q1");
    }

    #[test]
    fn apply_mutation_ignores_unknown_question_and_task_ids() {
        let answer_schema = AnswerSchema {
            constraints: HashMap::from_iter([("q1".to_owned(), AnswerConstraint::Text)]),
            sections: HashMap::from_iter([("q1".to_owned(), "reading".to_owned())]),
        };
        let writing_task_ids: HashSet<String> = HashSet::new();

        let mut answers = json!({"q1": "A"});
        let mut writing_answers = json!({});
        let mut flags = json!({"q1": true});
        let mut violations_snapshot = json!([]);
        let mut phase = AttemptPhase::Exam;
        let mut current_module = ModuleType::Reading;
        let mut current_question_id = Some("q1".to_owned());
        let mut recovery = json!({});

        let applied = apply_mutation(
            &MutationEnvelope {
                id: "m-unknown-answer".to_owned(),
                seq: 1,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
                command: command(
                    MutationType::Answer,
                    json!({"questionId": "q2", "value": "B"}),
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            Some("reading"),
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("unknown answer accepted");
        assert!(!applied);
        assert_eq!(answers, json!({"q1": "A"}));
        assert_eq!(current_question_id.as_deref(), Some("q1"));

        let applied = apply_mutation(
            &MutationEnvelope {
                id: "m-unknown-flag".to_owned(),
                seq: 2,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 1).unwrap(),
                command: command(
                    MutationType::Flag,
                    json!({"questionId": "q2", "value": false}),
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            Some("reading"),
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("unknown flag accepted");
        assert!(!applied);
        assert_eq!(flags, json!({"q1": true}));

        let applied = apply_mutation(
            &MutationEnvelope {
                id: "m-unknown-writing".to_owned(),
                seq: 3,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 2).unwrap(),
                command: command(
                    MutationType::WritingAnswer,
                    json!({"taskId": "task-unknown", "value": "Draft"}),
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            Some("writing"),
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("unknown writing accepted");
        assert!(!applied);
        assert_eq!(writing_answers, json!({}));

        let applied = apply_mutation(
            &MutationEnvelope {
                id: "m-unknown-position".to_owned(),
                seq: 4,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 3).unwrap(),
                command: command(
                    MutationType::Position,
                    json!({"phase":"exam","currentModule":"reading","currentQuestionId":"q2"}),
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            None,
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("unknown position accepted");
        assert!(!applied);
        assert_eq!(recovery, json!({}));
    }

    #[test]
    fn apply_mutation_accepts_reading_slot_ids_for_position_and_flags() {
        let answer_schema = AnswerSchema {
            constraints: HashMap::from_iter([(
                "sentence-1".to_owned(),
                AnswerConstraint::ArrayText { max_len: 1 },
            )]),
            sections: HashMap::from_iter([
                ("sentence-1".to_owned(), "reading".to_owned()),
                ("sentence-1:blank-1".to_owned(), "reading".to_owned()),
            ]),
        };
        let writing_task_ids: HashSet<String> = HashSet::new();
        let mut answers = json!({});
        let mut writing_answers = json!({});
        let mut flags = json!({});
        let mut violations_snapshot = json!([]);
        let mut phase = AttemptPhase::Exam;
        let mut current_module = ModuleType::Reading;
        let mut current_question_id = Some("sentence-1:blank-1".to_owned());
        let mut recovery = json!({});

        assert!(apply_mutation(
            &MutationEnvelope {
                id: "m-pos-slot".to_owned(),
                seq: 1,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
                command: command(
                    MutationType::Position,
                    json!({
                        "phase": "exam",
                        "currentModule": "reading",
                        "currentQuestionId": "sentence-1:blank-1"
                    }),
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            Some("reading"),
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("slot position should be accepted"));

        assert!(apply_mutation(
            &MutationEnvelope {
                id: "m-flag-slot".to_owned(),
                seq: 2,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 1).unwrap(),
                command: command(
                    MutationType::Flag,
                    json!({
                        "questionId": "sentence-1:blank-1",
                        "value": true
                    }),
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            Some("reading"),
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("slot flag should be accepted"));

        assert_eq!(
            recovery["clientPosition"]["currentQuestionId"],
            "sentence-1:blank-1",
        );
        assert_eq!(flags["sentence-1:blank-1"], true);
    }

    #[test]
    fn apply_mutation_supports_command_style_set_and_clear_operations() {
        let answer_schema = AnswerSchema {
            constraints: HashMap::from_iter([
                (
                    "sentence-1".to_owned(),
                    AnswerConstraint::ArrayText { max_len: 2 },
                ),
                (
                    "q1".to_owned(),
                    AnswerConstraint::Enum(
                        ["A", "B", "C"]
                            .into_iter()
                            .map(|value| value.to_owned())
                            .collect(),
                    ),
                ),
            ]),
            sections: HashMap::from_iter([
                ("sentence-1".to_owned(), "reading".to_owned()),
                ("q1".to_owned(), "reading".to_owned()),
            ]),
        };
        let writing_task_ids: HashSet<String> = ["task1".to_owned()].into_iter().collect();
        let mut answers = json!({});
        let mut writing_answers = json!({});
        let mut flags = json!({});
        let mut violations_snapshot = json!([]);
        let mut phase = AttemptPhase::Exam;
        let mut current_module = ModuleType::Reading;
        let mut current_question_id = None;
        let mut recovery = json!({});

        assert!(apply_mutation(
            &MutationEnvelope {
                id: "m-slot".to_owned(),
                seq: 1,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
                command: command(
                    MutationType::SetSlot,
                    json!({"questionId": "sentence-1", "slotIndex": 1, "value": "fox"}),
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            Some("reading"),
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("set slot"));
        assert_eq!(answers["sentence-1"][1], "fox");

        assert!(apply_mutation(
            &MutationEnvelope {
                id: "m-choice".to_owned(),
                seq: 2,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 1).unwrap(),
                command: command(
                    MutationType::SetChoice,
                    json!({"questionId": "q1", "value": "B"})
                ),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            Some("reading"),
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("set choice"));
        assert_eq!(answers["q1"], "B");

        assert!(apply_mutation(
            &MutationEnvelope {
                id: "m-clear-essay".to_owned(),
                seq: 3,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 2).unwrap(),
                command: command(MutationType::ClearEssayText, json!({"taskId": "task1"})),
                base_revision: None,
            },
            &answer_schema,
            &writing_task_ids,
            ObjectiveMutationGate::allow(),
            Some("writing"),
            &HashSet::new(),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("clear essay"));
        assert_eq!(writing_answers["task1"], Value::Null);
    }

    #[test]
    fn build_answer_schema_indexes_reading_slot_ids_for_position_and_flags() {
        let schema = build_answer_schema(&json!({
            "reading": {
                "passages": [{
                    "blocks": [
                        {
                            "id": "sentence-block",
                            "type": "SENTENCE_COMPLETION",
                            "questions": [{
                                "id": "sentence-1",
                                "blanks": [{ "id": "blank-1" }]
                            }]
                        },
                        {
                            "id": "diagram-block",
                            "type": "DIAGRAM_LABELING",
                            "labels": [{ "id": "label-1" }]
                        }
                    ]
                }]
            }
        }))
        .expect("schema");

        assert!(schema.constraints.contains_key("sentence-1"));
        assert!(!schema.constraints.contains_key("sentence-1:blank-1"));
        assert_eq!(
            schema
                .sections
                .get("sentence-1:blank-1")
                .map(String::as_str),
            Some("reading"),
        );
        assert_eq!(
            schema
                .sections
                .get("diagram-block:label-1")
                .map(String::as_str),
            Some("reading"),
        );
    }

    #[test]
    fn build_answer_schema_uses_roman_values_for_matching_headings() {
        let schema = build_answer_schema(&json!({
            "reading": {
                "passages": [{
                    "blocks": [
                        {
                            "id": "matching-block",
                            "type": "MATCHING",
                            "headings": [
                                { "id": "heading-a", "text": "A" },
                                { "id": "heading-b", "text": "B" },
                                { "id": "heading-c", "text": "C" }
                            ],
                            "questions": [
                                { "id": "q1", "paragraphLabel": "A" }
                            ]
                        }
                    ]
                }]
            }
        }))
        .expect("schema");

        let constraint = schema
            .constraints
            .get("q1")
            .expect("matching question constraint");
        match constraint {
            AnswerConstraint::Enum(allowed) => {
                assert!(allowed.contains("i"));
                assert!(allowed.contains("ii"));
                assert!(allowed.contains("iii"));
                assert!(!allowed.contains("heading-a"));
            }
            other => panic!("expected enum constraint, found {other:?}"),
        }
    }

    #[test]
    fn build_answer_schema_indexes_sub_answer_tree_leaf_ids() {
        let schema = build_answer_schema(&json!({
            "reading": {
                "passages": [{
                    "blocks": [{
                        "id": "tree-block",
                        "type": "SHORT_ANSWER",
                        "subAnswerModeEnabled": true,
                        "answerTree": [{
                            "id": "root-a",
                            "children": [{
                                "id": "leaf-a",
                                "acceptedAnswers": ["cat"]
                            }, {
                                "id": "leaf-b",
                                "acceptedAnswers": ["dog"]
                            }]
                        }],
                        "questions": [{
                            "id": "legacy-q1",
                            "prompt": "Legacy prompt"
                        }]
                    }]
                }]
            }
        }))
        .expect("schema");

        assert!(schema
            .constraints
            .contains_key("tree-block::tree::root-a::leaf-a"));
        assert!(schema
            .constraints
            .contains_key("tree-block::tree::root-a::leaf-b"));
        assert!(!schema.constraints.contains_key("legacy-q1"));
        assert_eq!(
            schema
                .sections
                .get("tree-block::tree::root-a::leaf-a")
                .map(String::as_str),
            Some("reading"),
        );
    }

    #[test]
    fn build_answer_schema_indexes_single_mcq_question_level_constraints() {
        let schema = build_answer_schema(&json!({
            "reading": {
                "passages": [{
                    "blocks": [{
                        "id": "single-block",
                        "type": "SINGLE_MCQ",
                        "questions": [
                            {
                                "id": "single-q1",
                                "options": [
                                    { "id": "opt-a" },
                                    { "id": "opt-b" }
                                ]
                            },
                            {
                                "id": "single-q2",
                                "options": [
                                    { "id": "opt-c" },
                                    { "id": "opt-d" }
                                ]
                            }
                        ]
                    }]
                }]
            }
        }))
        .expect("schema");

        assert!(schema.constraints.contains_key("single-q1"));
        assert!(schema.constraints.contains_key("single-q2"));
        assert!(!schema.constraints.contains_key("single-block"));

        match schema.constraints.get("single-q1") {
            Some(AnswerConstraint::Enum(allowed)) => {
                assert!(allowed.contains("opt-a"));
                assert!(allowed.contains("opt-b"));
            }
            other => panic!("expected enum constraint for single-q1, found {other:?}"),
        }

        assert_eq!(
            schema.sections.get("single-q1").map(String::as_str),
            Some("reading"),
        );
        assert_eq!(
            schema.sections.get("single-q2").map(String::as_str),
            Some("reading"),
        );
    }

    #[test]
    fn build_answer_schema_keeps_legacy_single_mcq_block_constraint() {
        let schema = build_answer_schema(&json!({
            "reading": {
                "passages": [{
                    "blocks": [{
                        "id": "legacy-single",
                        "type": "SINGLE_MCQ",
                        "stem": "Choose one",
                        "options": [
                            { "id": "opt-a" },
                            { "id": "opt-b" }
                        ]
                    }]
                }]
            }
        }))
        .expect("schema");

        assert!(schema.constraints.contains_key("legacy-single"));
        assert!(!schema.constraints.contains_key("single-q1"));
    }

    #[test]
    fn build_answer_schema_derives_multi_mcq_limit_and_completion_from_marked_options() {
        let schema = build_answer_schema(&json!({
            "listening": {
                "parts": [{
                    "blocks": [{
                        "id": "multi-1",
                        "type": "MULTI_MCQ",
                        "requiredSelections": 4,
                        "options": [
                            { "id": "A", "isCorrect": true },
                            { "id": "B", "isCorrect": false },
                            { "id": "C", "isCorrect": true },
                            { "id": "D", "isCorrect": false }
                        ]
                    }]
                }]
            }
        }))
        .expect("schema");

        let constraint = schema
            .constraints
            .get("multi-1")
            .expect("multi choice constraint");
        match constraint {
            AnswerConstraint::MultiChoice { allowed, max } => {
                assert_eq!(*max, 2);
                assert_eq!(allowed.len(), 4);
                assert!(allowed.contains("A"));
                assert!(allowed.contains("C"));
            }
            other => panic!("expected multi choice constraint, found {other:?}"),
        }

        let submitted_ids = json!(["A", "C"]);
        validate_answer_value(constraint, &submitted_ids).expect("real option IDs remain valid");
        assert_eq!(submitted_ids, json!(["A", "C"]));
        assert!(validate_answer_value(constraint, &json!(["A", "B", "C"])).is_err());

        let completion = compute_answer_completion(&schema, &json!({ "multi-1": ["A", "C"] }));
        assert_eq!(completion.total_slots, 2);
        assert_eq!(completion.answered_slots, 2);
    }

    #[test]
    fn build_answer_schema_uses_one_safe_slot_when_multi_mcq_has_no_marked_options() {
        let schema = build_answer_schema(&json!({
            "reading": {
                "passages": [{
                    "blocks": [{
                        "id": "malformed-multi",
                        "type": "MULTI_MCQ",
                        "requiredSelections": 4,
                        "options": [
                            { "id": "A", "isCorrect": false },
                            { "id": "B", "isCorrect": false }
                        ]
                    }]
                }]
            }
        }))
        .expect("schema");

        match schema.constraints.get("malformed-multi") {
            Some(AnswerConstraint::MultiChoice { max, .. }) => assert_eq!(*max, 1),
            other => panic!("expected multi choice constraint, found {other:?}"),
        }
        let completion = compute_answer_completion(&schema, &json!({}));
        assert_eq!(completion.total_slots, 1);
    }

    #[test]
    fn compute_answer_completion_counts_required_slots_across_constraint_types() {
        let schema = AnswerSchema {
            constraints: HashMap::from_iter([
                ("q1".to_owned(), AnswerConstraint::Text),
                (
                    "multi-1".to_owned(),
                    AnswerConstraint::MultiChoice {
                        allowed: HashSet::new(),
                        max: 2,
                    },
                ),
                (
                    "sentence-1".to_owned(),
                    AnswerConstraint::ArrayText { max_len: 2 },
                ),
                (
                    "classify-1".to_owned(),
                    AnswerConstraint::EnumArray {
                        allowed: HashSet::new(),
                        max_len: 3,
                    },
                ),
            ]),
            sections: HashMap::new(),
        };

        let answers = json!({
            "q1": "A",
            "multi-1": ["opt-a"],
            "sentence-1": ["filled", ""],
            "classify-1": [null, "category", " "]
        });

        let completion = compute_answer_completion(&schema, &answers);
        assert_eq!(completion.total_slots, 1 + 2 + 2 + 3);
        assert_eq!(completion.answered_slots, 1 + 1 + 1 + 1);
    }

    #[test]
    fn mutation_command_deserialization_rejects_missing_required_fields() {
        let parsed: Result<MutationCommand, _> = serde_json::from_value(json!({
            "mutationType": "SetSlot",
            "payload": { "questionId": "q1" }
        }));
        assert!(parsed.is_err());
    }

    #[test]
    fn mutation_command_deserialization_accepts_telemetry_mutations() {
        let parsed: MutationCommand = serde_json::from_value(json!({
            "mutationType": "network",
            "payload": { "status": "online", "rttMs": 24 }
        }))
        .expect("shape accepted");
        assert!(matches!(parsed, MutationCommand::Network(_)));
    }

    #[test]
    fn post_submit_grace_window_allows_only_within_configured_duration() {
        let submitted_at = Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap();
        let inside = submitted_at + chrono::Duration::minutes(4) + chrono::Duration::seconds(59);
        let outside = submitted_at + chrono::Duration::minutes(5) + chrono::Duration::seconds(1);

        assert!(is_within_post_submit_grace_window(
            submitted_at,
            inside,
            300
        ));
        assert!(!is_within_post_submit_grace_window(
            submitted_at,
            outside,
            300
        ));
    }

    #[test]
    fn merge_post_submit_submission_snapshot_marks_grace_acceptance_and_replay_completion() {
        let now = Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap();
        let existing = json!({
            "submissionId": "submission-1",
            "submittedAt": "2026-01-10T09:00:00Z",
            "answers": {"q1": "old"},
            "writingAnswers": {"task1": "old"},
            "flags": {"q1": false},
            "finalFlush": {
                "clientFinalSeq": 10,
                "serverAcceptedThroughSeq": 7,
                "replayIncomplete": true
            }
        });

        let merged = merge_post_submit_submission_snapshot(
            Some(existing),
            &json!({"q1": "new"}),
            &json!({"task1": "new"}),
            &json!({"q1": true}),
            now,
            3,
            300,
            11,
        );

        assert_eq!(merged["answers"]["q1"], "new");
        assert_eq!(merged["writingAnswers"]["task1"], "new");
        assert_eq!(merged["flags"]["q1"], true);
        assert_eq!(merged["graceMerge"]["acceptedInGrace"], true);
        assert_eq!(merged["graceMerge"]["lastAppliedMutationCount"], 3);
        assert_eq!(merged["finalFlush"]["replayIncomplete"], false);
        assert_eq!(merged["finalFlush"]["replayCompletedAt"], now.to_rfc3339());
    }
}
