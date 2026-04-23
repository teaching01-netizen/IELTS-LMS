use chrono::{DateTime, Utc};
use ielts_backend_domain::{
    attempt::{
        MutationEnvelope, StudentAttempt, StudentBootstrapRequest, StudentHeartbeatRequest,
        StudentMutationBatchRequest, StudentMutationBatchResponse, StudentPrecheckRequest,
        StudentSessionContext, StudentSubmitRequest, StudentSubmitResponse,
    },
    exam::ExamVersion,
    schedule::{ExamSchedule, ExamSessionRuntime},
};
use ielts_backend_infrastructure::{
    actor_context::{ActorContext, ActorRole},
    auth::sha256_hex,
    idempotency::{IdempotencyRecord, IdempotencyRepository},
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{MySqlConnection, MySqlPool};
use std::collections::{HashMap, HashSet};
use thiserror::Error;
use uuid::{fmt::Hyphenated, Uuid};

use crate::scheduling::SchedulingService;

#[derive(Error, Debug)]
pub enum DeliveryError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Not found")]
    NotFound,
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

pub struct DeliveryService {
    pool: MySqlPool,
}

impl DeliveryService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn get_session_context(
        &self,
        schedule_id: Uuid,
        wcode: Option<String>,
        student_key: Option<String>,
        candidate_id: Option<String>,
    ) -> Result<StudentSessionContext, DeliveryError> {
        let schedule = self.load_schedule(schedule_id).await?;
        let version = self.load_version(schedule.published_version_id.clone()).await?;
        let runtime = self.load_runtime(schedule_id).await?;
        
        let attempt = if let Some(wcode) = wcode {
            self.load_attempt_by_wcode(schedule_id.to_string(), &wcode).await?
        } else if let Some(student_key) = student_key {
            self.load_attempt_by_student_key(schedule_id.to_string(), &student_key).await?
        } else if let Some(candidate_id) = candidate_id {
            let derived = derive_student_key(schedule_id, &candidate_id);
            self.load_attempt_by_student_key(schedule_id.to_string(), &derived).await?
        } else {
            None
        };

        Ok(StudentSessionContext {
            schedule,
            version,
            runtime,
            attempt,
            attempt_credential: None,
            degraded_live_mode: false,
        })
    }

    pub async fn persist_precheck(
        &self,
        schedule_id: Uuid,
        req: StudentPrecheckRequest,
    ) -> Result<StudentAttempt, DeliveryError> {
        let has_device_fingerprint = req.device_fingerprint_hash.is_some();
        let schedule = self.load_schedule(schedule_id).await?;
        let version = self.load_version(schedule.published_version_id.clone()).await?;
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

        let mut integrity = ensure_object(attempt.integrity.clone());
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

        let phase = determine_phase(runtime.as_ref(), true, attempt.submitted_at.is_some());

        let updated = self.update_attempt(
            attempt.id,
            phase,
            attempt.current_module.clone(),
            attempt.current_question_id.clone(),
            attempt.answers.clone(),
            attempt.writing_answers.clone(),
            attempt.flags.clone(),
            attempt.violations_snapshot.clone(),
            Value::Object(integrity),
            merge_recovery(
                attempt.recovery.clone(),
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
        let version = self.load_version(schedule.published_version_id.clone()).await?;
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
            .get("preCheck")
            .and_then(|value| value.get("completedAt"))
            .and_then(Value::as_str)
            .is_some();
        let phase = determine_phase(
            runtime.as_ref(),
            has_precheck,
            attempt.submitted_at.is_some(),
        );
        let client_session_id_value = Value::String(req.client_session_id.to_string());

        let needs_client_session_id_in_integrity = attempt
            .integrity
            .get("clientSessionId")
            .and_then(Value::as_str)
            .is_none();
        let next_integrity = if needs_client_session_id_in_integrity {
            let mut integrity = ensure_object(attempt.integrity.clone());
            integrity.insert("clientSessionId".to_owned(), client_session_id_value.clone());
            Value::Object(integrity)
        } else {
            attempt.integrity.clone()
        };

        let needs_client_session_id_in_recovery = attempt
            .recovery
            .get("clientSessionId")
            .and_then(Value::as_str)
            .is_none();
        let next_recovery = if needs_client_session_id_in_recovery {
            merge_recovery(
                attempt.recovery.clone(),
                json!({ "clientSessionId": req.client_session_id }),
            )
        } else {
            attempt.recovery.clone()
        };

        let attempt = if attempt.phase != phase
            || needs_client_session_id_in_integrity
            || needs_client_session_id_in_recovery
        {
            self.update_attempt(
                attempt.id,
                phase,
                attempt.current_module.clone(),
                attempt.current_question_id.clone(),
                attempt.answers.clone(),
                attempt.writing_answers.clone(),
                attempt.flags.clone(),
                attempt.violations_snapshot.clone(),
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
            degraded_live_mode: false,
        })
    }

    #[tracing::instrument(
        skip(self, req),
        fields(schedule_id = %schedule_id, attempt_id = %req.attempt_id)
    )]
    pub async fn apply_mutation_batch(
        &self,
        schedule_id: Uuid,
        req: StudentMutationBatchRequest,
        idempotency_key: Option<String>,
    ) -> Result<StudentMutationBatchResponse, DeliveryError> {
        if req.mutations.is_empty() {
            return Err(DeliveryError::Validation(
                "Mutation batch must contain at least one mutation.".to_owned(),
            ));
        }

        validate_batch_sequences(&req.mutations)?;

        let repository = self.idempotency_repository();
        let route_key = mutation_batch_route_key(schedule_id);
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
        let mut attempt = self
            .load_attempt_by_id_for_update(tx.as_mut(), req.attempt_id.clone())
            .await?
            .ok_or(DeliveryError::NotFound)?;
        if attempt.schedule_id != schedule_id.to_string() || attempt.student_key != req.student_key {
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
        if attempt.submitted_at.is_some() {
            return Err(DeliveryError::Conflict(
                "Submitted attempts can no longer accept mutations.".to_owned(),
            ));
        }

        let schedule_status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM exam_schedules WHERE id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(tx.as_mut())
        .await?;
        if schedule_status.as_deref() == Some("cancelled") {
            return Err(DeliveryError::Conflict(
                "Cancelled schedules can no longer accept mutations.".to_owned(),
            ));
        }

        let runtime_gate = sqlx::query_as::<_, RuntimeGateRow>(
            "SELECT status, actual_end_at, current_section_key, waiting_for_next_section FROM exam_session_runtimes WHERE schedule_id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(tx.as_mut())
        .await?;
        let proctor_status: Option<String> = sqlx::query_scalar(
            "SELECT proctor_status FROM student_attempts WHERE id = ?",
        )
        .bind(&req.attempt_id)
        .fetch_optional(tx.as_mut())
        .await?;
        let objective_mutations_allowed =
            objective_mutations_allowed(runtime_gate.as_ref(), proctor_status.as_deref());
        let active_section_key = runtime_gate
            .as_ref()
            .and_then(|gate| gate.current_section_key.as_deref());

        let version = self.load_version(attempt.published_version_id.clone()).await?;
        let answer_schema = build_answer_schema(&version.content_snapshot)?;
        let writing_task_ids = build_writing_task_ids(&version.config_snapshot);

        let existing_max_seq: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(mutation_seq), 0) FROM student_attempt_mutations WHERE attempt_id = ? AND client_session_id = ?",
        )
        .bind(&req.attempt_id)
        .bind(&req.client_session_id)
        .fetch_one(tx.as_mut())
        .await?;

        validate_contiguous_sequences(existing_max_seq, &req.mutations)?;

        let mut answers = attempt.answers.clone();
        let mut writing_answers = attempt.writing_answers.clone();
        let mut flags = attempt.flags.clone();
        let mut violations_snapshot = attempt.violations_snapshot.clone();
        let has_precheck = attempt
            .integrity
            .get("preCheck")
            .and_then(|value| value.get("completedAt"))
            .and_then(Value::as_str)
            .is_some();
        let mut phase = derive_authoritative_phase(
            runtime_gate.as_ref(),
            has_precheck,
            attempt.submitted_at.is_some(),
        );
        let mut current_module = active_section_key
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| attempt.current_module.clone());
        let mut current_question_id = attempt.current_question_id.clone();
        let mut recovery = attempt.recovery.clone();

        for mutation in &req.mutations {
            apply_mutation(
                mutation,
                &answer_schema,
                &writing_task_ids,
                objective_mutations_allowed,
                active_section_key,
                &mut answers,
                &mut writing_answers,
                &mut flags,
                &mut violations_snapshot,
                &mut phase,
                &mut current_module,
                &mut current_question_id,
                &mut recovery,
            )?;
        }

        let server_accepted_through_seq = req
            .mutations
            .iter()
            .map(|mutation| mutation.seq)
            .max()
            .unwrap_or(existing_max_seq);
        let now = Utc::now();
        let recovery = merge_recovery(
            recovery,
            json!({
                "lastPersistedAt": now,
                "pendingMutationCount": 0,
                "syncState": "saved",
                "serverAcceptedThroughSeq": server_accepted_through_seq,
                "clientSessionId": req.client_session_id.clone()
            }),
        );

        for mutation in &req.mutations {
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
            .bind(&mutation.mutation_type)
            .bind(&mutation.id)
            .bind(mutation.seq)
            .bind(&mutation.payload)
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
        .bind(&req.attempt_id)
        .execute(tx.as_mut())
        .await?;

        attempt = sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
            .bind(&req.attempt_id)
            .fetch_one(tx.as_mut())
            .await?;

        let seq_from = req.mutations.iter().map(|mutation| mutation.seq).min();
        let seq_to = req.mutations.iter().map(|mutation| mutation.seq).max();
        let mut mutation_types: HashSet<String> = HashSet::new();
        for mutation in &req.mutations {
            mutation_types.insert(mutation.mutation_type.clone());
        }
        let mut mutation_types: Vec<String> = mutation_types.into_iter().collect();
        mutation_types.sort();

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
            "count": req.mutations.len(),
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
            attempt,
            applied_mutation_count: req.mutations.len(),
            server_accepted_through_seq,
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
        let mut integrity = ensure_object(attempt.integrity.clone());
        integrity.insert(
            "lastHeartbeatAt".to_owned(),
            Value::String(now.to_rfc3339()),
        );
        integrity.insert(
            "lastHeartbeatStatus".to_owned(),
            Value::String(match req.event_type.as_str() {
                "disconnect" | "lost" => "lost".to_owned(),
                _ => "ok".to_owned(),
            }),
        );
        integrity.insert(
            "clientSessionId".to_owned(),
            Value::String(req.client_session_id.to_string()),
        );
        if req.event_type == "disconnect" || req.event_type == "lost" {
            integrity.insert(
                "lastDisconnectAt".to_owned(),
                Value::String(now.to_rfc3339()),
            );
        }
        if req.event_type == "reconnect" {
            integrity.insert(
                "lastReconnectAt".to_owned(),
                Value::String(now.to_rfc3339()),
            );
        }

        let updated = self
            .update_attempt(
                attempt.id,
                attempt.phase.clone(),
                attempt.current_module.clone(),
                attempt.current_question_id.clone(),
                attempt.answers.clone(),
                attempt.writing_answers.clone(),
                attempt.flags.clone(),
                attempt.violations_snapshot.clone(),
                Value::Object(integrity),
                attempt.recovery.clone(),
                attempt.final_submission.clone(),
                attempt.submitted_at,
            )
            .await?;

        if req.event_type != "heartbeat" {
            let action_type = match req.event_type.as_str() {
                "disconnect" => "NETWORK_DISCONNECTED",
                "reconnect" => "NETWORK_RECONNECTED",
                "lost" => "HEARTBEAT_LOST",
                _ => "STUDENT_NETWORK",
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

        if req.event_type != "heartbeat" {
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
            .bind(&req.event_type)
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
        if attempt.schedule_id != schedule_id.to_string() || attempt.student_key != req.student_key {
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

        if !matches!(attempt.phase.as_str(), "exam" | "post-exam") {
            return Err(DeliveryError::Conflict(
                "Attempt cannot be submitted before the exam starts.".to_owned(),
            ));
        }

        let schedule_status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM exam_schedules WHERE id = ?",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(tx.as_mut())
        .await?;
        if schedule_status.as_deref() == Some("cancelled") {
            return Err(DeliveryError::Conflict(
                "Cancelled schedules cannot accept submissions.".to_owned(),
            ));
        }

        let runtime_gate = sqlx::query_as::<_, RuntimeGateRow>(
            "SELECT status, actual_end_at FROM exam_session_runtimes WHERE schedule_id = ?",
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
                return Err(DeliveryError::Conflict(
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

        let version = self.load_version(attempt.published_version_id.clone()).await?;
        let unanswered_submission_policy = version
            .config_snapshot
            .get("progression")
            .and_then(|progression| progression.get("unansweredSubmissionPolicy"))
            .and_then(Value::as_str)
            .unwrap_or("confirm");
        let answer_schema = build_answer_schema(&version.content_snapshot)?;
        let completion = compute_answer_completion(&answer_schema, &attempt.answers);
        let runtime_status = runtime_gate.as_ref().map(|row| row.status.as_str());

        if unanswered_submission_policy == "block"
            && matches!(runtime_status, Some("live" | "paused"))
            && completion.total_slots > 0
            && completion.answered_slots < completion.total_slots
        {
            return Err(DeliveryError::Validation(format!(
                "All questions must be answered before submitting. {}/{} answered.",
                completion.answered_slots, completion.total_slots
            )));
        }

        let now = Utc::now();
        let submission_id = format!("submission-{}", Uuid::new_v4().simple());
        let final_submission = json!({
            "submissionId": submission_id,
            "submittedAt": now,
            "answers": attempt.answers,
            "writingAnswers": attempt.writing_answers,
            "flags": attempt.flags
        });
        let recovery = merge_recovery(
            attempt.recovery.clone(),
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
        .bind("post-exam")
        .bind(recovery)
        .bind(&final_submission)
        .bind(now)
        .bind(&req.attempt_id)
        .execute(tx.as_mut())
        .await?;

        let attempt = sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
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
        let phase = determine_phase(runtime, false, false);
        let current_module = first_enabled_module(&version.config_snapshot);
        let phase_for_insert = phase.clone();
        let current_module_for_insert = current_module.clone();
        let now = Utc::now();

        let attempt_id = Uuid::new_v4();
        sqlx::query(
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
        .await?;

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
    async fn update_attempt(
        &self,
        attempt_id: String,
        phase: String,
        current_module: String,
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
                updated_at = NOW(),
                revision = revision + 1
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

    async fn load_schedule(&self, schedule_id: Uuid) -> Result<ExamSchedule, DeliveryError> {
        sqlx::query_as::<_, ExamSchedule>(
            "SELECT * FROM exam_schedules WHERE id = ?"
        )
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
                    Err(DeliveryError::Conflict(message))
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

        let serialized = serde_json::to_string(request)
            .map_err(|err| DeliveryError::Internal(format!("Failed to serialize request: {err}")))?;
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
            return Err(DeliveryError::Conflict(
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
            return Err(DeliveryError::Conflict(
                "Idempotency-Key does not match the original request.".to_owned(),
            ));
        }

        Ok(Some(deserialize_idempotent_response(&record)?))
    }
}

fn derive_student_key(schedule_id: Uuid, candidate_id: &str) -> String {
    format!("student-{schedule_id}-{candidate_id}")
}

fn mutation_batch_route_key(schedule_id: Uuid) -> String {
    format!("POST:/api/v1/student/sessions/{schedule_id}/mutations:batch")
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
            "autoSubmission": true
        });
        let recovery = merge_recovery(
            attempt.recovery.clone(),
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
        .bind("post-exam")
        .bind(recovery)
        .bind(&final_submission)
        .bind(now)
        .bind(&attempt.id)
        .execute(&mut *connection)
        .await?;
    }

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
) -> String {
    if submitted {
        return "post-exam".to_owned();
    }

    match runtime.map(|snapshot| snapshot.status.clone()) {
        Some(
            ielts_backend_domain::schedule::RuntimeStatus::Live
            | ielts_backend_domain::schedule::RuntimeStatus::Paused,
        ) => "exam".to_owned(),
        Some(
            ielts_backend_domain::schedule::RuntimeStatus::Completed
            | ielts_backend_domain::schedule::RuntimeStatus::Cancelled,
        ) => "post-exam".to_owned(),
        _ if has_precheck => "lobby".to_owned(),
        _ => "pre-check".to_owned(),
    }
}

fn first_enabled_module(config_snapshot: &Value) -> String {
    for module in ["listening", "reading", "writing", "speaking"] {
        if config_snapshot
            .get("sections")
            .and_then(|sections| sections.get(module))
            .and_then(|section| section.get("enabled"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return module.to_owned();
        }
    }

    "listening".to_owned()
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
        return Err(DeliveryError::Conflict(
            "Mutation sequence must continue from the last accepted value.".to_owned(),
        ));
    }

    for window in seqs.windows(2) {
        let [left, right] = window else { continue };
        if *right != *left + 1 {
            return Err(DeliveryError::Conflict(
                "Mutation sequence must be contiguous.".to_owned(),
            ));
        }
    }

    Ok(())
}

#[derive(sqlx::FromRow)]
struct RuntimeGateRow {
    status: String,
    actual_end_at: Option<DateTime<Utc>>,
    current_section_key: Option<String>,
    waiting_for_next_section: bool,
}

fn objective_mutations_allowed(runtime: Option<&RuntimeGateRow>, proctor_status: Option<&str>) -> bool {
    let proctor_blocked = matches!(proctor_status, Some("paused" | "terminated"));
    if proctor_blocked {
        return false;
    }
    let Some(runtime) = runtime else {
        return false;
    };
    if runtime.waiting_for_next_section {
        return false;
    }
    if runtime
        .current_section_key
        .as_deref()
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
    {
        return false;
    }
    match runtime.status.as_str() {
        "live" | "paused" => true,
        _ => false,
    }
}

fn derive_authoritative_phase(
    runtime_gate: Option<&RuntimeGateRow>,
    has_precheck: bool,
    submitted: bool,
) -> String {
    if submitted {
        return "post-exam".to_owned();
    }

    match runtime_gate.map(|gate| gate.status.as_str()) {
        Some("live" | "paused") => "exam".to_owned(),
        Some("completed" | "cancelled") => "post-exam".to_owned(),
        _ if has_precheck => "lobby".to_owned(),
        _ => "pre-check".to_owned(),
    }
}

#[derive(Debug, Clone)]
enum AnswerConstraint {
    Text,
    Enum(HashSet<String>),
    MultiChoice { allowed: HashSet<String>, max: usize },
    ArrayText { max_len: usize },
    EnumArray { allowed: HashSet<String>, max_len: usize },
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
        AnswerConstraint::Text | AnswerConstraint::Enum(_) => value.map_or(0, |v| usize::from(is_answered_value(v))),
        AnswerConstraint::MultiChoice { max, .. } => {
            let Some(Value::Array(values)) = value else { return 0 };
            values
                .iter()
                .filter(|entry| is_answered_value(entry))
                .take(*max)
                .count()
        }
        AnswerConstraint::ArrayText { max_len } | AnswerConstraint::EnumArray { max_len, .. } => {
            let Some(Value::Array(values)) = value else { return 0 };
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
            if let Some(id) = task.get("id").and_then(Value::as_str) {
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

    Ok(AnswerSchema { constraints, sections })
}

fn index_block(
    block: &Value,
    section_key: &str,
    constraints: &mut HashMap<String, AnswerConstraint>,
    sections: &mut HashMap<String, String>,
) -> Result<(), DeliveryError> {
    let Some(block_type) = block.get("type").and_then(Value::as_str) else {
        return Ok(());
    };
    let block_id = block.get("id").and_then(Value::as_str).map(ToOwned::to_owned);

    match block_type {
        "TFNG" | "CLOZE" | "MATCHING" | "MAP" | "SHORT_ANSWER" => {
            let Some(questions) = block.get("questions").and_then(Value::as_array) else {
                return Ok(());
            };
            let mut allowed_heading_ids: Option<HashSet<String>> = None;
            if block_type == "MATCHING" {
                if let Some(headings) = block.get("headings").and_then(Value::as_array) {
                    let mut ids = HashSet::new();
                    for heading in headings {
                        if let Some(id) = heading.get("id").and_then(Value::as_str) {
                            ids.insert(id.to_owned());
                        }
                    }
                    if !ids.is_empty() {
                        allowed_heading_ids = Some(ids);
                    }
                }
            }
            for question in questions {
                let Some(id) = question.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let constraint = match block_type {
                    "TFNG" => {
                        let mode = block.get("mode").and_then(Value::as_str).unwrap_or("TFNG");
                        let allowed: HashSet<String> = match mode {
                            "YNNG" => ["Y", "N", "NG"].into_iter().map(|v| v.to_owned()).collect(),
                            _ => ["T", "F", "NG"].into_iter().map(|v| v.to_owned()).collect(),
                        };
                        AnswerConstraint::Enum(allowed)
                    }
                    "MATCHING" => allowed_heading_ids
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
                let max_len = question
                    .get("blanks")
                    .and_then(Value::as_array)
                    .map(|value| value.len())
                    .unwrap_or(0);
                constraints.insert(
                    id.to_owned(),
                    AnswerConstraint::ArrayText { max_len },
                );
                register_section(sections, id, section_key)?;
            }
        }
        "MULTI_MCQ" => {
            let Some(block_id) = block_id else { return Ok(()); };
            let required = block
                .get("requiredSelections")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            let mut allowed = HashSet::new();
            if let Some(options) = block.get("options").and_then(Value::as_array) {
                for option in options {
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
                    max: required.max(1),
                },
            );
        }
        "SINGLE_MCQ" => {
            let Some(block_id) = block_id else { return Ok(()); };
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
            let Some(block_id) = block_id else { return Ok(()); };
            let max_len = block
                .get("labels")
                .and_then(Value::as_array)
                .map(|value| value.len())
                .unwrap_or(0);
            register_section(sections, &block_id, section_key)?;
            constraints.insert(block_id, AnswerConstraint::ArrayText { max_len });
        }
        "FLOW_CHART" => {
            let Some(block_id) = block_id else { return Ok(()); };
            let max_len = block
                .get("steps")
                .and_then(Value::as_array)
                .map(|value| value.len())
                .unwrap_or(0);
            register_section(sections, &block_id, section_key)?;
            constraints.insert(block_id, AnswerConstraint::ArrayText { max_len });
        }
        "TABLE_COMPLETION" => {
            let Some(block_id) = block_id else { return Ok(()); };
            let max_len = block
                .get("cells")
                .and_then(Value::as_array)
                .map(|value| value.len())
                .unwrap_or(0);
            register_section(sections, &block_id, section_key)?;
            constraints.insert(block_id, AnswerConstraint::ArrayText { max_len });
        }
        "CLASSIFICATION" => {
            let Some(block_id) = block_id else { return Ok(()); };
            let max_len = block
                .get("items")
                .and_then(Value::as_array)
                .map(|value| value.len())
                .unwrap_or(0);
            let mut allowed = HashSet::new();
            if let Some(categories) = block.get("categories").and_then(Value::as_array) {
                for category in categories.iter().filter_map(Value::as_str) {
                    allowed.insert(category.to_owned());
                }
            }
            register_section(sections, &block_id, section_key)?;
            constraints.insert(
                block_id,
                AnswerConstraint::EnumArray { allowed, max_len },
            );
        }
        "MATCHING_FEATURES" => {
            let Some(block_id) = block_id else { return Ok(()); };
            let max_len = block
                .get("features")
                .and_then(Value::as_array)
                .map(|value| value.len())
                .unwrap_or(0);
            let mut allowed = HashSet::new();
            if let Some(options) = block.get("options").and_then(Value::as_array) {
                for option in options.iter().filter_map(Value::as_str) {
                    allowed.insert(option.to_owned());
                }
            }
            register_section(sections, &block_id, section_key)?;
            constraints.insert(
                block_id,
                AnswerConstraint::EnumArray { allowed, max_len },
            );
        }
        _ => {}
    }

    Ok(())
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

fn validate_answer_value(constraint: &AnswerConstraint, value: &Value) -> Result<(), DeliveryError> {
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
    objective_mutations_allowed: bool,
    active_section_key: Option<&str>,
    answers: &mut Value,
    writing_answers: &mut Value,
    flags: &mut Value,
    violations_snapshot: &mut Value,
    _phase: &mut String,
    _current_module: &mut String,
    current_question_id: &mut Option<String>,
    recovery: &mut Value,
) -> Result<(), DeliveryError> {
    match mutation.mutation_type.as_str() {
        "answer" => {
            let question_id = required_string(&mutation.payload, "questionId")?;
            if !objective_mutations_allowed {
                return Err(DeliveryError::Conflict(
                    "This session can no longer accept answer mutations.".to_owned(),
                ));
            }
            enforce_section_membership(active_section_key, &question_id, answer_schema)?;
            let value = mutation
                .payload
                .get("value")
                .ok_or_else(|| DeliveryError::Validation(
                    "Mutation payload is missing `value`.".to_owned(),
                ))?
                .clone();
            let constraint = answer_schema
                .constraints
                .get(&question_id)
                .ok_or_else(|| DeliveryError::Validation(
                    "Mutation references an unknown `questionId`.".to_owned(),
                ))?;
            validate_answer_value(constraint, &value)?;
            let next_answers = ensure_object(std::mem::take(answers));
            *current_question_id = Some(question_id.clone());
            *answers = Value::Object(set_value(
                next_answers,
                question_id,
                value,
            ));
        }
        "writing_answer" => {
            let task_id = required_string(&mutation.payload, "taskId")?;
            if !objective_mutations_allowed {
                return Err(DeliveryError::Conflict(
                    "This session can no longer accept writing mutations.".to_owned(),
                ));
            }
            if active_section_key.is_some_and(|value| value != "writing") {
                return Err(DeliveryError::Conflict(
                    "This session can no longer accept writing mutations for the current section."
                        .to_owned(),
                ));
            }
            if !writing_task_ids.contains(&task_id) {
                return Err(DeliveryError::Validation(
                    "Mutation references an unknown `taskId`.".to_owned(),
                ));
            }
            let value = mutation
                .payload
                .get("value")
                .ok_or_else(|| DeliveryError::Validation(
                    "Mutation payload is missing `value`.".to_owned(),
                ))?
                .clone();
            if !matches!(value, Value::String(_) | Value::Null) {
                return Err(DeliveryError::Validation(
                    "Writing answers must be a string (or null).".to_owned(),
                ));
            }
            let next_writing_answers = ensure_object(std::mem::take(writing_answers));
            *current_question_id = Some(task_id.clone());
            *writing_answers = Value::Object(set_value(
                next_writing_answers,
                task_id,
                value,
            ));
        }
        "flag" => {
            let question_id = required_string(&mutation.payload, "questionId")?;
            if !objective_mutations_allowed {
                return Err(DeliveryError::Conflict(
                    "This session can no longer accept flag mutations.".to_owned(),
                ));
            }
            if !answer_schema.constraints.contains_key(&question_id) {
                return Err(DeliveryError::Validation(
                    "Mutation references an unknown `questionId`.".to_owned(),
                ));
            }
            enforce_section_membership(active_section_key, &question_id, answer_schema)?;
            let value = mutation
                .payload
                .get("value")
                .ok_or_else(|| DeliveryError::Validation(
                    "Mutation payload is missing `value`.".to_owned(),
                ))?
                .clone();
            let flag_value = value
                .as_bool()
                .ok_or_else(|| DeliveryError::Validation(
                    "Flag values must be boolean.".to_owned(),
                ))?;
            let next_flags = ensure_object(std::mem::take(flags));
            *flags = Value::Object(set_value(
                next_flags,
                question_id,
                Value::Bool(flag_value),
            ));
        }
        "position" => {
            // Client position is telemetry only. Never treat it as authoritative state.
            let next_phase = required_string(&mutation.payload, "phase")?;
            match next_phase.as_str() {
                "pre-check" | "lobby" | "exam" | "post-exam" => {}
                _ => {
                    return Err(DeliveryError::Validation(
                        "Invalid `phase` value in position mutation.".to_owned(),
                    ));
                }
            }
            let next_module = required_string(&mutation.payload, "currentModule")?;
            match next_module.as_str() {
                "listening" | "reading" | "writing" | "speaking" => {}
                _ => {
                    return Err(DeliveryError::Validation(
                        "Invalid `currentModule` value in position mutation.".to_owned(),
                    ));
                }
            }

            let next_question_id = mutation
                .payload
                .get("currentQuestionId")
                .cloned()
                .unwrap_or(Value::Null);
            let parsed_question_id = match next_question_id {
                Value::Null => None,
                Value::String(value) => Some(value),
                _ => {
                    return Err(DeliveryError::Validation(
                        "`currentQuestionId` must be a string or null.".to_owned(),
                    ));
                }
            };
            if let Some(ref value) = parsed_question_id {
                let known_objective = answer_schema.constraints.contains_key(value);
                let known_writing = writing_task_ids.contains(value);
                if !(known_objective || known_writing) {
                    return Err(DeliveryError::Validation(
                        "Position mutation references an unknown `currentQuestionId`.".to_owned(),
                    ));
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
        }
        "violation" => {
            // Payloads vary; apply only when the client includes an authoritative snapshot.
            if let Some(snapshot) = mutation.payload.get("violations") {
                if snapshot.is_array() {
                    *violations_snapshot = merge_violations_snapshot(
                        violations_snapshot,
                        snapshot,
                        500,
                    )?;
                } else {
                    return Err(DeliveryError::Validation(
                        "`violations` must be an array when present.".to_owned(),
                    ));
                }
            } else {
                tracing::warn!(
                    mutation_id = %mutation.id,
                    "violation mutation missing `violations` snapshot; skipping apply"
                );
            }
        }
        other => {
            tracing::warn!(
                mutation_id = %mutation.id,
                mutation_type = other,
                "unrecognized mutation type; stored but not applied"
            );
        }
    }

    Ok(())
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

fn required_string(payload: &Value, field: &str) -> Result<String, DeliveryError> {
    payload
        .get(field)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| DeliveryError::Validation(format!("Mutation payload is missing `{field}`.")))
}

fn set_value(mut object: Map<String, Value>, key: String, value: Value) -> Map<String, Value> {
    object.insert(key, value);
    object
}

fn enforce_section_membership(
    active_section_key: Option<&str>,
    question_id: &str,
    answer_schema: &AnswerSchema,
) -> Result<(), DeliveryError> {
    let Some(active_section_key) = active_section_key else {
        return Err(DeliveryError::Conflict(
            "This session can no longer accept objective mutations.".to_owned(),
        ));
    };
    let expected = answer_schema
        .sections
        .get(question_id)
        .map(String::as_str)
        .ok_or_else(|| {
            DeliveryError::Validation(
                "Mutation references an unknown `questionId`.".to_owned(),
            )
        })?;
    if expected != active_section_key {
        return Err(DeliveryError::Conflict(
            "Mutation does not belong to the current section.".to_owned(),
        ));
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
            waiting_for_next_section: false,
            is_overrun: false,
            total_paused_seconds: 0,
            created_at: now,
            updated_at: now,
            revision: 0,
            sections: Vec::new(),
        }
    }

    #[test]
    fn determine_phase_follows_lifecycle_progression() {
        assert_eq!(determine_phase(None, false, false), "pre-check");
        assert_eq!(determine_phase(None, true, false), "lobby");

        let live = runtime_with_status(RuntimeStatus::Live);
        assert_eq!(determine_phase(Some(&live), false, false), "exam");

        let paused = runtime_with_status(RuntimeStatus::Paused);
        assert_eq!(determine_phase(Some(&paused), true, false), "exam");

        let completed = runtime_with_status(RuntimeStatus::Completed);
        assert_eq!(determine_phase(Some(&completed), true, false), "post-exam");

        assert_eq!(determine_phase(None, true, true), "post-exam");
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
        let writing_task_ids: HashSet<String> =
            ["task-1".to_owned()].into_iter().collect();

        let mut answers = json!({});
        let mut writing_answers = json!({});
        let mut flags = json!({});
        let mut violations_snapshot = json!([]);
        let mut phase = "exam".to_owned();
        let mut current_module = "reading".to_owned();
        let mut current_question_id = None;
        let mut recovery = json!({});

        apply_mutation(
            &MutationEnvelope {
                id: "m1".to_owned(),
                seq: 1,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
                mutation_type: "answer".to_owned(),
                payload: json!({"questionId": "q1", "value": "A"}),
            },
            &answer_schema,
            &writing_task_ids,
            true,
            Some("reading"),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("apply answer");

        assert_eq!(answers["q1"], "A");
        assert_eq!(writing_answers, json!({}));
        assert_eq!(current_question_id.as_deref(), Some("q1"));

        apply_mutation(
            &MutationEnvelope {
                id: "m2".to_owned(),
                seq: 2,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 5).unwrap(),
                mutation_type: "writing_answer".to_owned(),
                payload: json!({"taskId": "task-1", "value": "Draft 1"}),
            },
            &answer_schema,
            &writing_task_ids,
            true,
            Some("writing"),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("apply writing answer");

        assert_eq!(answers["q1"], "A");
        assert_eq!(writing_answers["task-1"], "Draft 1");
        assert_eq!(current_question_id.as_deref(), Some("task-1"));

        apply_mutation(
            &MutationEnvelope {
                id: "m3".to_owned(),
                seq: 3,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 10).unwrap(),
                mutation_type: "flag".to_owned(),
                payload: json!({"questionId": "q1", "value": true}),
            },
            &answer_schema,
            &writing_task_ids,
            true,
            Some("reading"),
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("apply flag");

        assert_eq!(flags["q1"], true);
        assert_eq!(current_question_id.as_deref(), Some("task-1"));
    }

    #[test]
    fn validate_contiguous_sequences_rejects_gaps() {
        let base = MutationEnvelope {
            id: "m".to_owned(),
            seq: 0,
            timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
            mutation_type: "answer".to_owned(),
            payload: json!({"questionId": "q1", "value": "A"}),
        };
        let mut a = base.clone();
        a.seq = 2;
        let mut b = base.clone();
        b.seq = 4;
        let err = validate_contiguous_sequences(1, &[a, b]).unwrap_err();
        assert!(matches!(err, DeliveryError::Conflict(_)));
    }

    #[test]
    fn apply_mutation_records_position_as_telemetry() {
        let answer_schema = AnswerSchema {
            constraints: HashMap::from_iter([("q1".to_owned(), AnswerConstraint::Text)]),
            sections: HashMap::from_iter([("q1".to_owned(), "reading".to_owned())]),
        };
        let writing_task_ids: HashSet<String> =
            ["task1".to_owned()].into_iter().collect();
        let mut answers = json!({});
        let mut writing_answers = json!({});
        let mut flags = json!({});
        let mut violations_snapshot = json!([]);
        let mut phase = "pre-check".to_owned();
        let mut current_module = "listening".to_owned();
        let mut current_question_id = None;
        let mut recovery = json!({});

        apply_mutation(
            &MutationEnvelope {
                id: "m-pos".to_owned(),
                seq: 1,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
                mutation_type: "position".to_owned(),
                payload: json!({"phase":"exam","currentModule":"reading","currentQuestionId":"q1"}),
            },
            &answer_schema,
            &writing_task_ids,
            false,
            None,
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut violations_snapshot,
            &mut phase,
            &mut current_module,
            &mut current_question_id,
            &mut recovery,
        )
        .expect("apply position");

        assert_eq!(phase, "pre-check");
        assert_eq!(current_module, "listening");
        assert_eq!(current_question_id, None);
        assert_eq!(recovery["clientPosition"]["phase"], "exam");
        assert_eq!(recovery["clientPosition"]["currentModule"], "reading");
        assert_eq!(recovery["clientPosition"]["currentQuestionId"], "q1");
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
}
