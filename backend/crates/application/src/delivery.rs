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
    idempotency::{IdempotencyRecord, IdempotencyRepository},
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{MySqlConnection, MySqlPool};
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

        self.update_attempt(
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
        .await
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
        let attempt = if attempt.phase != phase {
            self.update_attempt(
                attempt.id,
                phase,
                attempt.current_module.clone(),
                attempt.current_question_id.clone(),
                attempt.answers.clone(),
                attempt.writing_answers.clone(),
                attempt.flags.clone(),
                attempt.violations_snapshot.clone(),
                attempt.integrity.clone(),
                attempt.recovery.clone(),
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

        let existing_max_seq: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(mutation_seq), 0) FROM student_attempt_mutations WHERE attempt_id = ? AND client_session_id = ?",
        )
        .bind(&req.attempt_id)
        .bind(&req.client_session_id)
        .fetch_one(tx.as_mut())
        .await?;

        if req
            .mutations
            .iter()
            .any(|mutation| mutation.seq <= existing_max_seq)
        {
            return Err(DeliveryError::Conflict(
                "Mutation sequence overlaps with an already accepted range.".to_owned(),
            ));
        }

        let mut answers = attempt.answers.clone();
        let mut writing_answers = attempt.writing_answers.clone();
        let mut flags = attempt.flags.clone();
        let mut current_question_id = attempt.current_question_id.clone();

        for mutation in &req.mutations {
            apply_mutation(
                mutation,
                &mut answers,
                &mut writing_answers,
                &mut flags,
                &mut current_question_id,
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
            attempt.recovery.clone(),
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
                answers = ?,
                writing_answers = ?,
                flags = ?,
                current_question_id = ?,
                recovery = ?,
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind(answers)
        .bind(writing_answers)
        .bind(flags)
        .bind(current_question_id)
        .bind(recovery)
        .bind(&req.attempt_id)
        .execute(tx.as_mut())
        .await?;

        attempt = sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
            .bind(&req.attempt_id)
            .fetch_one(tx.as_mut())
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
                submitted_at = NOW(),
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
            "#,
        )
        .bind("post-exam")
        .bind(recovery)
        .bind(&final_submission)
        .bind(&req.attempt_id)
        .execute(tx.as_mut())
        .await?;

        let attempt = sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
            .bind(&req.attempt_id)
            .fetch_one(tx.as_mut())
            .await?;

        let response = StudentSubmitResponse {
            attempt,
            submission_id,
            submitted_at: now,
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), 0)
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
        .bind(phase)
        .bind(current_module)
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
            "SELECT id, CAST(exam_id AS CHAR) as exam_id, CAST(exam_version_id AS CHAR) as exam_version_id, title, start_time, end_time, duration_minutes, CAST(created_by AS CHAR) as created_by, CAST(organization_id AS CHAR) as organization_id, created_at, updated_at, status FROM exam_schedules WHERE id = ?"
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

        serde_json::to_string(request)
            .map(Some)
            .map_err(|err| DeliveryError::Internal(format!("Failed to serialize request: {err}")))
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

fn apply_mutation(
    mutation: &MutationEnvelope,
    answers: &mut Value,
    writing_answers: &mut Value,
    flags: &mut Value,
    current_question_id: &mut Option<String>,
) -> Result<(), DeliveryError> {
    match mutation.mutation_type.as_str() {
        "answer" => {
            let question_id = required_string(&mutation.payload, "questionId")?;
            let next_answers = ensure_object(std::mem::take(answers));
            *current_question_id = Some(question_id.clone());
            *answers = Value::Object(set_value(
                next_answers,
                question_id,
                mutation
                    .payload
                    .get("value")
                    .cloned()
                    .unwrap_or(Value::Null),
            ));
        }
        "writing_answer" => {
            let task_id = required_string(&mutation.payload, "taskId")?;
            let next_writing_answers = ensure_object(std::mem::take(writing_answers));
            *current_question_id = Some(task_id.clone());
            *writing_answers = Value::Object(set_value(
                next_writing_answers,
                task_id,
                mutation
                    .payload
                    .get("value")
                    .cloned()
                    .unwrap_or(Value::String(String::new())),
            ));
        }
        "flag" => {
            let question_id = required_string(&mutation.payload, "questionId")?;
            let next_flags = ensure_object(std::mem::take(flags));
            *flags = Value::Object(set_value(
                next_flags,
                question_id,
                mutation
                    .payload
                    .get("value")
                    .cloned()
                    .unwrap_or(Value::Bool(false)),
            ));
        }
        _ => {}
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
        let mut answers = json!({});
        let mut writing_answers = json!({});
        let mut flags = json!({});
        let mut current_question_id = None;

        apply_mutation(
            &MutationEnvelope {
                id: "m1".to_owned(),
                seq: 1,
                timestamp: Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap(),
                mutation_type: "answer".to_owned(),
                payload: json!({"questionId": "q1", "value": "A"}),
            },
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut current_question_id,
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
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut current_question_id,
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
            &mut answers,
            &mut writing_answers,
            &mut flags,
            &mut current_question_id,
        )
        .expect("apply flag");

        assert_eq!(flags["q1"], true);
        assert_eq!(current_question_id.as_deref(), Some("task-1"));
    }
}
