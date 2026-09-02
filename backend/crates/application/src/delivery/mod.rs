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
    outbox::OutboxRepository,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{MySql, MySqlConnection, MySqlPool, QueryBuilder, Transaction};
use std::collections::{HashMap, HashSet};
use thiserror::Error;
use uuid::{fmt::Hyphenated, Uuid};

use crate::auth::{AuthService, AuthenticatedSession};
use crate::scheduling::SchedulingService;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryConflictReason {
    ObjectiveLocked,
    DeadlineExpired,
    SectionMismatch,
    AttemptProctorBlocked,
    BaseRevisionMismatch,
    AttemptSubmitted,
    ActiveSessionSuperseded,
    FinalFlushRequired,
    FinalPayloadHashMismatch,
    InvalidMutation,
}

impl DeliveryConflictReason {
    pub fn as_str(self) -> &'static str {
        match self {
            DeliveryConflictReason::ObjectiveLocked => "OBJECTIVE_LOCKED",
            DeliveryConflictReason::DeadlineExpired => "DEADLINE_EXPIRED",
            DeliveryConflictReason::SectionMismatch => "SECTION_MISMATCH",
            DeliveryConflictReason::AttemptProctorBlocked => "ATTEMPT_PROCTOR_BLOCKED",
            DeliveryConflictReason::BaseRevisionMismatch => "BASE_REVISION_MISMATCH",
            DeliveryConflictReason::AttemptSubmitted => "ATTEMPT_SUBMITTED",
            DeliveryConflictReason::ActiveSessionSuperseded => "ACTIVE_SESSION_SUPERSEDED",
            DeliveryConflictReason::FinalFlushRequired => "FINAL_FLUSH_REQUIRED",
            DeliveryConflictReason::FinalPayloadHashMismatch => "FINAL_PAYLOAD_HASH_MISMATCH",
            DeliveryConflictReason::InvalidMutation => "INVALID_MUTATION",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MutationBatchResponseMode {
    Full,
    Ack,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TerminalizationActorKind {
    Student,
    Proctor,
    System,
}

impl TerminalizationActorKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Student => "student",
            Self::Proctor => "proctor",
            Self::System => "system",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SealAttemptCommand {
    pub attempt_id: String,
    pub schedule_id: String,
    pub outcome: &'static str,
    pub reason: String,
    pub actor_kind: TerminalizationActorKind,
    pub actor_id: Option<String>,
    pub proctor_note: Option<String>,
    pub request_id: String,
    pub min_answer_revision: Option<i32>,
    pub effective_at: Option<DateTime<Utc>>,
    pub final_submission: Option<Value>,
}

#[derive(Debug, Clone)]
pub(crate) struct SealAttemptResult {
    pub attempt: StudentAttempt,
    pub terminalization_id: String,
    pub outcome: String,
    pub reason: String,
    pub effective_at: DateTime<Utc>,
    pub recorded_at: DateTime<Utc>,
    pub snapshot: Value,
    pub created: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct TerminalizationRow {
    attempt_id: String,
    organization_id: Option<String>,
    terminalization_id: String,
    schedule_id: String,
    outcome: String,
    reason: String,
    actor_kind: String,
    actor_id: Option<String>,
    effective_at: DateTime<Utc>,
    recorded_at: DateTime<Utc>,
    answer_revision: i32,
    final_snapshot: Value,
    schedule_transition_id: Option<String>,
    request_id: String,
}

pub(crate) fn terminalization_intent_is_compatible(
    existing_outcome: &str,
    _existing_reason: &str,
    requested_outcome: &str,
    _requested_reason: &str,
) -> bool {
    existing_outcome == requested_outcome
}

fn build_terminal_snapshot(
    attempt_id: &str,
    schedule_id: &str,
    organization_id: Option<&str>,
    exam_id: &str,
    published_version_id: &str,
    provider_key: &str,
    answer_revision: i32,
    answers: Value,
    writing_answers: Value,
    flags: Value,
) -> Value {
    json!({
        "attemptId": attempt_id,
        "scheduleId": schedule_id,
        "organizationId": organization_id,
        "examId": exam_id,
        "publishedVersionId": published_version_id,
        "providerKey": provider_key,
        "answerRevision": answer_revision,
        "answers": answers,
        "writingAnswers": writing_answers,
        "flags": flags,
    })
}

fn sat_terminal_outcome_status(
    outcome: &str,
    actor_kind: TerminalizationActorKind,
) -> &'static str {
    match outcome {
        "terminated" if actor_kind == TerminalizationActorKind::Proctor => "invalidated_proctor",
        "terminated" => "invalidated_timeout",
        _ => "pending",
    }
}

async fn materialize_sat_terminal_result_in_tx(
    tx: &mut Transaction<'_, MySql>,
    attempt: &StudentAttempt,
    provider_key: &str,
    outcome: &str,
    reason: &str,
    actor_kind: TerminalizationActorKind,
    terminalization_id: &str,
    effective_at: DateTime<Utc>,
    snapshot: &Value,
) -> Result<(), DeliveryError> {
    if provider_key != "sat" {
        return Ok(());
    }

    let existing: Option<(String, String)> = sqlx::query_as(
        "SELECT id, outcome_status FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat' FOR UPDATE",
    )
    .bind(&attempt.id)
    .fetch_optional(&mut **tx)
    .await?;

    let outcome_status = sat_terminal_outcome_status(outcome, actor_kind);
    if let Some((result_id, existing_status)) = existing {
        if outcome == "terminated" && existing_status != outcome_status {
            sqlx::query("DELETE FROM assessment_section_results WHERE assessment_result_id = ?")
                .bind(&result_id)
                .execute(&mut **tx)
                .await?;
            sqlx::query(
                "UPDATE assessment_results SET submission_id = NULL, total_score = NULL, outcome_status = ?, release_status = 'invalidated', score_payload = ?, updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?",
            )
            .bind(outcome_status)
            .bind(json!({
                "providerKey": "sat",
                "outcomeStatus": outcome_status,
                "completionReason": reason,
                "terminalizationId": terminalization_id,
                "submittedAt": effective_at,
                "snapshot": snapshot,
            }))
            .bind(result_id)
            .execute(&mut **tx)
            .await?;
        }
        return Ok(());
    }

    sqlx::query(
        r#"
        INSERT INTO assessment_results (
            id, attempt_id, submission_id, provider_key, outcome_status,
            total_score, score_payload, release_status
        )
        VALUES (?, ?, NULL, 'sat', ?, NULL, ?, 'invalidated')
        "#,
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&attempt.id)
    .bind(outcome_status)
    .bind(json!({
        "providerKey": "sat",
        "outcomeStatus": outcome_status,
        "completionReason": reason,
        "terminalizationId": terminalization_id,
        "submittedAt": effective_at,
        "snapshot": snapshot,
    }))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Provider-neutral active-writer claim. Keeping every `student_attempts` update in this
/// module preserves a single physical writer while provider services retain their transaction.
pub(crate) async fn claim_provider_attempt_writer_in_tx(
    conn: &mut MySqlConnection,
    attempt_id: &str,
    schedule_id: &str,
    client_session_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE student_attempts SET active_client_session_id = ? WHERE id = ? AND schedule_id = ? AND active_client_session_id IS NULL AND submitted_at IS NULL AND COALESCE(proctor_status, 'active') <> 'terminated'",
    )
    .bind(client_session_id)
    .bind(attempt_id)
    .bind(schedule_id)
    .execute(conn)
    .await?;
    Ok(result.rows_affected())
}

/// Provider-neutral phase projection for a started assessment.
pub(crate) async fn mark_provider_attempt_exam_phase_in_tx(
    conn: &mut MySqlConnection,
    attempt_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE student_attempts SET phase = 'exam', updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1 WHERE id = ?",
    )
    .bind(attempt_id)
    .execute(conn)
    .await?;
    Ok(result.rows_affected())
}

pub(crate) async fn increment_provider_attempt_answer_revision_in_tx(
    conn: &mut MySqlConnection,
    attempt_id: &str,
    schedule_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE student_attempts SET answer_revision = answer_revision + 1, updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1 WHERE id = ? AND schedule_id = ?",
    )
    .bind(attempt_id)
    .bind(schedule_id)
    .execute(conn)
    .await?;
    Ok(result.rows_affected())
}

#[derive(Debug, sqlx::FromRow)]
struct TerminalModuleSnapshotRow {
    id: String,
    module_id: String,
    state: String,
    allocated_seconds: i32,
    started_at: Option<DateTime<Utc>>,
    submitted_at: Option<DateTime<Utc>>,
    locked_at: Option<DateTime<Utc>>,
    completion_reason: Option<String>,
    revision: i32,
}

#[derive(Debug, sqlx::FromRow)]
struct TerminalResponseSnapshotRow {
    id: String,
    module_attempt_id: String,
    exam_question_id: String,
    response: Option<Value>,
    marked_for_review: bool,
    eliminated_options: Value,
    annotations: Value,
    revision: i32,
}

async fn load_terminalization_in_tx(
    conn: &mut MySqlConnection,
    attempt_id: &str,
) -> Result<Option<TerminalizationRow>, DeliveryError> {
    sqlx::query_as::<_, TerminalizationRow>(
        "SELECT attempt_id, organization_id, terminalization_id, schedule_id, outcome, reason, actor_kind, actor_id, effective_at, recorded_at, answer_revision, final_snapshot, schedule_transition_id, request_id FROM attempt_terminalizations WHERE attempt_id = ? FOR UPDATE",
    )
    .bind(attempt_id)
    .fetch_optional(conn)
    .await
    .map_err(DeliveryError::from)
}

pub(crate) async fn lock_schedule_terminalization_scope_in_tx(
    conn: &mut MySqlConnection,
    schedule_id: &str,
) -> Result<(), DeliveryError> {
    let runtime: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT id, current_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
    )
    .bind(schedule_id)
    .fetch_optional(&mut *conn)
    .await?;
    if let Some((runtime_id, Some(section_key))) = runtime {
        sqlx::query(
            "SELECT id FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? FOR UPDATE",
        )
        .bind(runtime_id)
        .bind(section_key)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

pub(crate) async fn lock_attempt_terminalization_scope_in_tx(
    conn: &mut MySqlConnection,
    schedule_id: &str,
    attempt_id: &str,
) -> Result<(), DeliveryError> {
    // All attempt writers acquire the attempt row before the shared runtime
    // rows. This is the lock-order fence for student/proctor races.
    sqlx::query("SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")
        .bind(attempt_id)
        .bind(schedule_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(DeliveryError::NotFound)?;
    lock_schedule_terminalization_scope_in_tx(conn, schedule_id).await?;
    Ok(())
}

pub(crate) async fn lock_sat_modules_in_tx(
    conn: &mut MySqlConnection,
    attempt_id: &str,
    completion_reason: &str,
    effective_at: DateTime<Utc>,
) -> Result<(), DeliveryError> {
    sqlx::query(
        "UPDATE assessment_module_attempts SET state = 'locked', locked_at = COALESCE(locked_at, ?), paused_at = NULL, completion_reason = COALESCE(completion_reason, ?), revision = revision + 1 WHERE attempt_id = ? AND state IN ('not_started', 'active', 'review')",
    )
    .bind(effective_at)
    .bind(completion_reason)
    .bind(attempt_id)
    .execute(conn)
    .await?;
    Ok(())
}

fn terminalization_conflict(receipt: &TerminalizationRow, latest_revision: i32) -> DeliveryError {
    DeliveryError::TerminalizationConflict {
        message: format!(
            "Attempt is already terminalized as {} ({}).",
            receipt.outcome, receipt.reason
        ),
        outcome: receipt.outcome.clone(),
        reason: receipt.reason.clone(),
        terminalization_id: receipt.terminalization_id.clone(),
        latest_revision,
    }
}

fn default_final_submission(
    snapshot: &Value,
    outcome: &str,
    reason: &str,
    effective_at: DateTime<Utc>,
) -> Value {
    let mut projection = json!({
        "submissionId": format!("submission-{}", Uuid::new_v4().simple()),
        "submittedAt": effective_at,
        "answers": snapshot.get("answers").cloned().unwrap_or_else(|| json!({})),
        "writingAnswers": snapshot.get("writingAnswers").cloned().unwrap_or_else(|| json!({})),
        "flags": snapshot.get("flags").cloned().unwrap_or_else(|| json!({})),
        "completionReason": reason,
        "autoSubmission": outcome == "submitted" && reason != "student_submit",
    });
    if outcome == "terminated" {
        projection["terminated"] = json!(true);
    }
    projection
}

async fn build_server_terminal_snapshot(
    conn: &mut MySqlConnection,
    attempt: &StudentAttempt,
    provider_key: &str,
) -> Result<Value, DeliveryError> {
    let mut snapshot = build_terminal_snapshot(
        &attempt.id,
        &attempt.schedule_id,
        attempt.organization_id.as_deref(),
        &attempt.exam_id,
        &attempt.published_version_id,
        provider_key,
        attempt.answer_revision,
        attempt.answers.clone().into(),
        attempt.writing_answers.clone().into(),
        attempt.flags.clone().into(),
    );

    if provider_key == "sat" {
        let modules = sqlx::query_as::<_, TerminalModuleSnapshotRow>(
            "SELECT id, module_id, state, allocated_seconds, started_at, submitted_at, locked_at, completion_reason, revision FROM assessment_module_attempts WHERE attempt_id = ? ORDER BY created_at, id FOR UPDATE",
        )
        .bind(&attempt.id)
        .fetch_all(&mut *conn)
        .await?;
        let responses = sqlx::query_as::<_, TerminalResponseSnapshotRow>(
            "SELECT id, module_attempt_id, exam_question_id, response, marked_for_review, eliminated_options, annotations, revision FROM assessment_question_responses WHERE module_attempt_id IN (SELECT id FROM assessment_module_attempts WHERE attempt_id = ?) ORDER BY module_attempt_id, exam_question_id FOR UPDATE",
        )
        .bind(&attempt.id)
        .fetch_all(&mut *conn)
        .await?;
        snapshot["assessment"] = json!({
            "moduleAttempts": modules.into_iter().map(|module| json!({
                "id": module.id,
                "moduleId": module.module_id,
                "state": module.state,
                "allocatedSeconds": module.allocated_seconds,
                "startedAt": module.started_at,
                "submittedAt": module.submitted_at,
                "lockedAt": module.locked_at,
                "completionReason": module.completion_reason,
                "revision": module.revision,
            })).collect::<Vec<_>>(),
            "responses": responses.into_iter().map(|response| json!({
                "id": response.id,
                "moduleAttemptId": response.module_attempt_id,
                "examQuestionId": response.exam_question_id,
                "response": response.response,
                "markedForReview": response.marked_for_review,
                "eliminatedOptions": response.eliminated_options,
                "annotations": response.annotations,
                "revision": response.revision,
            })).collect::<Vec<_>>(),
        });
    }
    Ok(snapshot)
}

/// The sole database-owned terminal transition. Callers may perform provider-specific
/// materialization in the same transaction, but this function owns the terminal fact,
/// compatibility projection, and downstream notification.
pub(crate) async fn seal_attempt_in_tx(
    tx: &mut sqlx::Transaction<'_, MySql>,
    command: &SealAttemptCommand,
) -> Result<SealAttemptResult, DeliveryError> {
    let attempt = sqlx::query_as::<_, StudentAttempt>(
        "SELECT * FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",
    )
    .bind(&command.attempt_id)
    .bind(&command.schedule_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(DeliveryError::NotFound)?;

    if let Some(existing) = load_terminalization_in_tx(&mut **tx, &attempt.id).await? {
        if terminalization_intent_is_compatible(
            &existing.outcome,
            &existing.reason,
            command.outcome,
            &command.reason,
        ) {
            let provider_key: String =
                sqlx::query_scalar("SELECT provider_key FROM exam_entities WHERE id = ?")
                    .bind(&attempt.exam_id)
                    .fetch_optional(&mut **tx)
                    .await?
                    .unwrap_or_else(|| "legacy".to_owned());
            materialize_sat_terminal_result_in_tx(
                tx,
                &attempt,
                &provider_key,
                &existing.outcome,
                &existing.reason,
                if existing.actor_kind == "proctor" {
                    TerminalizationActorKind::Proctor
                } else {
                    TerminalizationActorKind::System
                },
                &existing.terminalization_id,
                existing.effective_at,
                &existing.final_snapshot,
            )
            .await?;
            return Ok(SealAttemptResult {
                attempt,
                terminalization_id: existing.terminalization_id,
                outcome: existing.outcome,
                reason: existing.reason,
                effective_at: existing.effective_at,
                recorded_at: existing.recorded_at,
                snapshot: existing.final_snapshot,
                created: false,
            });
        }
        return Err(terminalization_conflict(&existing, attempt.revision));
    }

    if !matches!(command.outcome, "submitted" | "terminated") {
        return Err(DeliveryError::Validation(
            "Terminalization outcome is not supported.".to_owned(),
        ));
    }
    if !matches!(
        command.reason.as_str(),
        "student_submit"
            | "sat_complete"
            | "time_expired"
            | "auto_stop"
            | "proctor_complete"
            | "proctor_end"
            | "proctor_force_submit"
            | "proctor_terminate"
            | "legacy_unknown"
    ) {
        return Err(DeliveryError::Validation(
            "Terminalization reason is not supported.".to_owned(),
        ));
    }
    if let Some(minimum) = command.min_answer_revision {
        if attempt.answer_revision < minimum {
            return Err(DeliveryError::Conflict {
                message: format!(
                    "Attempt answers are not persisted through the required revision (required {}, actual {}).",
                    minimum, attempt.answer_revision
                ),
                reason: Some(DeliveryConflictReason::BaseRevisionMismatch),
                latest_revision: Some(attempt.revision),
                server_accepted_through_seq: None,
                active_session_id: None,
            });
        }
    }

    let provider_key: String =
        sqlx::query_scalar("SELECT provider_key FROM exam_entities WHERE id = ?")
            .bind(&attempt.exam_id)
            .fetch_optional(&mut **tx)
            .await?
            .unwrap_or_else(|| "legacy".to_owned());
    let recorded_at: DateTime<Utc> = sqlx::query_scalar("SELECT UTC_TIMESTAMP(6)")
        .fetch_one(&mut **tx)
        .await?;
    let effective_at = command.effective_at.unwrap_or(recorded_at);
    if provider_key == "sat" && command.outcome == "terminated" {
        lock_sat_modules_in_tx(&mut **tx, &attempt.id, &command.reason, effective_at).await?;
    }
    let snapshot = build_server_terminal_snapshot(&mut **tx, &attempt, &provider_key).await?;
    let terminalization_id = Uuid::new_v4().to_string();
    let projection = command.final_submission.clone().unwrap_or_else(|| {
        default_final_submission(&snapshot, command.outcome, &command.reason, effective_at)
    });
    let mut projection = projection;
    if let Some(fields) = projection.as_object_mut() {
        fields.insert("submittedAt".to_owned(), json!(effective_at));
        fields.insert("completionReason".to_owned(), json!(&command.reason));
        fields.insert("terminalizationOutcome".to_owned(), json!(command.outcome));
        fields.insert("terminalizationId".to_owned(), json!(&terminalization_id));
        for key in ["answers", "writingAnswers", "flags", "providerKey"] {
            if let Some(value) = snapshot.get(key) {
                fields
                    .entry(key.to_owned())
                    .or_insert_with(|| value.clone());
            }
        }
        if command.outcome == "terminated" {
            fields.insert("terminated".to_owned(), json!(true));
        }
    }

    sqlx::query(
        r#"
        INSERT INTO attempt_terminalizations (
            attempt_id, organization_id, terminalization_id, schedule_id,
            outcome, reason, actor_kind, actor_id, effective_at, recorded_at,
            answer_revision, final_snapshot, request_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&attempt.id)
    .bind(&attempt.organization_id)
    .bind(&terminalization_id)
    .bind(&attempt.schedule_id)
    .bind(command.outcome)
    .bind(&command.reason)
    .bind(command.actor_kind.as_str())
    .bind(&command.actor_id)
    .bind(effective_at)
    .bind(recorded_at)
    .bind(attempt.answer_revision)
    .bind(&snapshot)
    .bind(&command.request_id)
    .execute(&mut **tx)
    .await?;

    let claim = if command.outcome == "terminated" {
        sqlx::query(
            "UPDATE student_attempts SET phase = 'post-exam', final_submission = ?, submitted_at = COALESCE(submitted_at, ?), proctor_status = 'terminated', proctor_note = COALESCE(?, proctor_note), proctor_updated_at = UTC_TIMESTAMP(6), proctor_updated_by = ?, updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ? AND schedule_id = ? AND submitted_at IS NULL AND phase <> 'post-exam'",
        )
        .bind(&projection)
        .bind(effective_at)
        .bind(&command.proctor_note)
        .bind(&command.actor_id)
        .bind(&attempt.id)
        .bind(&attempt.schedule_id)
        .execute(&mut **tx)
        .await?
    } else {
        sqlx::query(
            "UPDATE student_attempts SET phase = 'post-exam', final_submission = ?, submitted_at = COALESCE(submitted_at, ?), updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ? AND schedule_id = ? AND submitted_at IS NULL AND phase <> 'post-exam' AND COALESCE(proctor_status, 'active') <> 'terminated'",
        )
        .bind(&projection)
        .bind(effective_at)
        .bind(&attempt.id)
        .bind(&attempt.schedule_id)
        .execute(&mut **tx)
        .await?
    };
    if claim.rows_affected() != 1 {
        return Err(DeliveryError::Conflict {
            message: if command.outcome == "terminated" {
                "Attempt could not be claimed for proctor termination.".to_owned()
            } else {
                "Attempt is blocked by proctor termination.".to_owned()
            },
            reason: (command.outcome != "terminated")
                .then_some(DeliveryConflictReason::AttemptProctorBlocked),
            latest_revision: Some(attempt.revision),
            server_accepted_through_seq: None,
            active_session_id: None,
        });
    }

    materialize_sat_terminal_result_in_tx(
        tx,
        &attempt,
        &provider_key,
        command.outcome,
        &command.reason,
        command.actor_kind,
        &terminalization_id,
        effective_at,
        &snapshot,
    )
    .await?;

    OutboxRepository::enqueue_in_tx(
        tx,
        "attempt_terminalization",
        &attempt.id,
        i64::from(attempt.revision.saturating_add(1)),
        "attempt_terminalized",
        &json!({
            "terminalizationId": terminalization_id,
            "attemptId": attempt.id,
            "scheduleId": attempt.schedule_id,
            "organizationId": attempt.organization_id,
            "outcome": command.outcome,
            "reason": command.reason,
            "answerRevision": attempt.answer_revision,
        }),
    )
    .await?;

    let persisted_attempt =
        sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
            .bind(&attempt.id)
            .fetch_one(&mut **tx)
            .await?;
    Ok(SealAttemptResult {
        attempt: persisted_attempt,
        terminalization_id,
        outcome: command.outcome.to_owned(),
        reason: command.reason.clone(),
        effective_at,
        recorded_at,
        snapshot,
        created: true,
    })
}

/// Same authoritative writer path for proctor termination. Existing submitted timestamps are
/// preserved because termination may race an idempotent finalization replay.
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
    #[error("Terminalization conflict: {message}")]
    TerminalizationConflict {
        message: String,
        outcome: String,
        reason: String,
        terminalization_id: String,
        latest_revision: i32,
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

fn ensure_student_key_scope(actor: &ActorContext, student_key: &str) -> Result<(), DeliveryError> {
    if matches!(actor.role, ActorRole::Student)
        && actor.student_scope_key.as_deref() != Some(student_key)
    {
        return Err(DeliveryError::NotFound);
    }
    Ok(())
}

fn map_scheduling_error(error: crate::scheduling::SchedulingError) -> DeliveryError {
    match error {
        crate::scheduling::SchedulingError::Database(error) => DeliveryError::Database(error),
        crate::scheduling::SchedulingError::Conflict(message) => DeliveryError::conflict(message),
        crate::scheduling::SchedulingError::NotFound => DeliveryError::NotFound,
        crate::scheduling::SchedulingError::Validation(message) => {
            DeliveryError::Validation(message)
        }
    }
}

pub struct DeliveryService {
    pool: MySqlPool,
    auth_service: Option<AuthService>,
}

impl DeliveryService {
    pub fn new(pool: MySqlPool) -> Self {
        Self {
            pool,
            auth_service: None,
        }
    }

    pub fn with_auth(pool: MySqlPool, config: AppConfig) -> Self {
        let auth_service = AuthService::new(pool.clone(), config);
        Self {
            pool,
            auth_service: Some(auth_service),
        }
    }

    pub fn with_runtime_tuning(
        pool: MySqlPool,
        _idempotency_usable_hours: i64,
        _submit_idempotency_usable_hours: i64,
        _violation_idempotency_usable_hours: i64,
        _heartbeat_min_write_interval_secs: u64,
    ) -> Self {
        Self::new(pool)
    }

    pub fn with_auth_runtime_tuning(
        pool: MySqlPool,
        config: AppConfig,
        _idempotency_usable_hours: i64,
        _submit_idempotency_usable_hours: i64,
        _violation_idempotency_usable_hours: i64,
        _heartbeat_min_write_interval_secs: u64,
    ) -> Self {
        Self::with_auth(pool, config)
    }

    fn auth_service(&self) -> Result<&AuthService, DeliveryError> {
        self.auth_service
            .as_ref()
            .ok_or_else(|| DeliveryError::Internal("Auth service is not configured.".to_owned()))
    }

    async fn lock_runtime_write_gate_tx(
        &self,
        conn: &mut MySqlConnection,
        schedule_id: Uuid,
    ) -> Result<(Option<RuntimeGateRow>, Option<RuntimeSectionWriteGateRow>), DeliveryError> {
        // The caller must hold the attempt row first. This helper then locks
        // runtime -> active runtime section, preserving attempt -> runtime order.
        let runtime = sqlx::query_as::<_, RuntimeGateRow>(
            "SELECT id, status, current_section_key, waiting_for_next_section FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
        )
        .bind(schedule_id.to_string())
        .fetch_optional(&mut *conn)
        .await?;

        let section = match runtime
            .as_ref()
            .and_then(|runtime| runtime.current_section_key.as_deref())
        {
            Some(section_key) => {
                let runtime_id = runtime
                    .as_ref()
                    .map(|runtime| runtime.id.as_str())
                    .expect("runtime exists when current section key exists");
                sqlx::query_as::<_, RuntimeSectionWriteGateRow>(
                    r#"
                    SELECT
                        status,
                        actual_start_at,
                        paused_at,
                        planned_duration_minutes,
                        extension_minutes,
                        accumulated_paused_seconds,
                        UTC_TIMESTAMP(6) AS server_now
                    FROM exam_session_runtime_sections
                    WHERE runtime_id = ? AND section_key = ?
                    FOR UPDATE
                    "#,
                )
                .bind(runtime_id)
                .bind(section_key)
                .fetch_optional(&mut *conn)
                .await?
            }
            None => None,
        };

        Ok((runtime, section))
    }

    pub async fn get_session_context(
        &self,
        actor: &ActorContext,
        schedule_id: Uuid,
        wcode: Option<String>,
        student_key: Option<String>,
        candidate_id: Option<String>,
    ) -> Result<StudentSessionContext, DeliveryError> {
        let schedule = self.load_schedule(actor, schedule_id).await?;
        let version = self
            .load_version(schedule.published_version_id.clone())
            .await?;
        let runtime = self.load_runtime(actor, schedule_id).await?;

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
        if let Some(attempt) = attempt.as_ref() {
            ensure_student_key_scope(actor, &attempt.student_key)?;
        }

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
        actor: &ActorContext,
        schedule_id: Uuid,
        wcode: Option<String>,
        student_key: Option<String>,
        candidate_id: Option<String>,
        principal: &AuthenticatedSession,
        client_session_id: Option<String>,
    ) -> Result<StudentSessionContext, DeliveryError> {
        let mut session = self
            .get_session_context(actor, schedule_id, wcode, student_key, candidate_id)
            .await?;
        self.attach_attempt_credential(
            schedule_id,
            &mut session,
            principal,
            client_session_id,
            false,
            "clientSessionId is required to refresh attempt credentials.",
        )
        .await?;
        Ok(session)
    }

    pub async fn get_static_session_context(
        &self,
        actor: &ActorContext,
        schedule_id: Uuid,
    ) -> Result<ielts_backend_domain::attempt::StudentStaticSessionContext, DeliveryError> {
        let session = self
            .get_session_context(actor, schedule_id, None, None, None)
            .await?;
        Ok(ielts_backend_domain::attempt::StudentStaticSessionContext {
            schedule: session.schedule,
            version: session.version,
            degraded_live_mode: session.degraded_live_mode,
        })
    }

    pub async fn get_live_session_context(
        &self,
        actor: &ActorContext,
        schedule_id: Uuid,
        wcode: Option<String>,
        student_key: Option<String>,
        candidate_id: Option<String>,
    ) -> Result<ielts_backend_domain::attempt::StudentLiveSessionContext, DeliveryError> {
        let session = self
            .get_session_context(actor, schedule_id, wcode, student_key, candidate_id)
            .await?;
        Ok(ielts_backend_domain::attempt::StudentLiveSessionContext {
            runtime: session.runtime,
            attempt: session.attempt,
            degraded_live_mode: session.degraded_live_mode,
        })
    }

    pub async fn persist_precheck(
        &self,
        actor: &ActorContext,
        schedule_id: Uuid,
        req: StudentPrecheckRequest,
        idempotency_key: Option<String>,
    ) -> Result<StudentAttempt, DeliveryError> {
        ensure_student_key_scope(actor, &req.student_key)?;
        // Authorize the schedule before consulting idempotency storage. A replay
        // must not become an authorization bypass for another actor.
        let schedule = self.load_schedule(actor, schedule_id).await?;
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
        let version = self
            .load_version(schedule.published_version_id.clone())
            .await?;
        let runtime = self.load_runtime(actor, schedule_id).await?;
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
                &req.client_session_id,
            )
            .await?;
        if attempt.submitted_at.is_some()
            || attempt.proctor_status == ielts_backend_domain::attempt::ProctorStatus::Terminated
        {
            return Err(DeliveryError::Conflict {
                message: "Attempt is already terminal and cannot accept pre-check updates."
                    .to_owned(),
                reason: Some(DeliveryConflictReason::AttemptSubmitted),
                latest_revision: Some(attempt.revision),
                server_accepted_through_seq: None,
                active_session_id: None,
            });
        }

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
            .update_attempt(
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
                attempt.revision,
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
                return deserialize_idempotent_response(&record);
            }
        }

        Ok(updated)
    }

    #[tracing::instrument(skip(self, req), fields(schedule_id = %schedule_id))]
    pub async fn bootstrap(
        &self,
        actor: &ActorContext,
        schedule_id: Uuid,
        req: StudentBootstrapRequest,
    ) -> Result<StudentSessionContext, DeliveryError> {
        ensure_student_key_scope(actor, &req.student_key)?;
        let schedule = self.load_schedule(actor, schedule_id).await?;
        let version = self
            .load_version(schedule.published_version_id.clone())
            .await?;
        let runtime = self.load_runtime(actor, schedule_id).await?;
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
                &req.client_session_id,
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

        let attempt = if attempt.submitted_at.is_none()
            && attempt.proctor_status != ielts_backend_domain::attempt::ProctorStatus::Terminated
            && (attempt.phase != phase
                || needs_client_session_id_in_integrity
                || needs_client_session_id_in_recovery)
        {
            match self
                .update_attempt(
                    attempt.id.clone(),
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
                    attempt.revision,
                )
                .await
            {
                Ok(updated) => updated,
                Err(DeliveryError::Conflict { .. }) => self
                    .load_attempt_by_id(attempt.id)
                    .await?
                    .ok_or(DeliveryError::NotFound)?,
                Err(error) => return Err(error),
            }
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
        actor: &ActorContext,
        schedule_id: Uuid,
        req: StudentBootstrapRequest,
        principal: &AuthenticatedSession,
    ) -> Result<StudentSessionContext, DeliveryError> {
        let client_session_id = Some(req.client_session_id.clone());
        let mut session = self.bootstrap(actor, schedule_id, req).await?;
        self.attach_attempt_credential(
            schedule_id,
            &mut session,
            principal,
            client_session_id,
            true,
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
        claim_write_ownership: bool,
        missing_client_session_message: &str,
    ) -> Result<(), DeliveryError> {
        let attempt = session.attempt.as_ref().ok_or(DeliveryError::NotFound)?;
        let fallback_client_session_id = attempt.integrity.client_session_id.clone();
        let client_session_id = client_session_id
            .or(fallback_client_session_id)
            .ok_or_else(|| DeliveryError::Validation(missing_client_session_message.to_owned()))?;

        let active_client_session_id: Option<String> = sqlx::query_scalar(
            "SELECT active_client_session_id FROM student_attempts WHERE id = ?",
        )
        .bind(&attempt.id)
        .fetch_one(&self.pool)
        .await?;

        if !claim_write_ownership {
            if let Some(active_session_id) = active_client_session_id.as_ref() {
                if active_session_id != &client_session_id {
                    return Err(DeliveryError::Conflict {
                            message: "Attempt write credential has been superseded by a newer student session."
                                .to_owned(),
                            reason: Some(DeliveryConflictReason::ActiveSessionSuperseded),
                            latest_revision: Some(attempt.revision),
                            server_accepted_through_seq: None,
                            active_session_id: Some(active_session_id.clone()),
                        });
                }
            }
        }

        let token = self
            .auth_service()?
            .issue_attempt_token(
                principal,
                schedule_id.to_string(),
                attempt.id.clone(),
                client_session_id.clone(),
                None,
                None,
            )
            .await
            .map_err(|err| {
                DeliveryError::Internal(format!("Unable to issue attempt token: {err}"))
            })?;

        if claim_write_ownership || active_client_session_id.is_none() {
            sqlx::query(
                r#"
                    UPDATE student_attempts
                    SET active_client_session_id = ?,
                        integrity = JSON_SET(integrity, '$.clientSessionId', ?),
                        recovery = JSON_SET(recovery, '$.clientSessionId', ?),
                        updated_at = NOW()
                    WHERE id = ?
                    "#,
            )
            .bind(&client_session_id)
            .bind(&client_session_id)
            .bind(&client_session_id)
            .bind(&attempt.id)
            .execute(&self.pool)
            .await?;
        }

        session.attempt = Some(
            sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
                .bind(&attempt.id)
                .fetch_one(&self.pool)
                .await?,
        );
        session.attempt_credential = Some(token);
        Ok(())
    }

    pub async fn apply_mutation_batch(
        &self,
        schedule_id: Uuid,
        req: StudentMutationBatchRequest,
        response_mode: MutationBatchResponseMode,
        idempotency_key: Option<String>,
    ) -> Result<StudentMutationBatchResponse, DeliveryError> {
        self.apply_mutation_batch_at(schedule_id, req, Utc::now(), response_mode, idempotency_key)
            .await
    }

    #[tracing::instrument(
        skip(self, req),
        fields(schedule_id = %schedule_id, attempt_id = %req.attempt_id)
    )]
    pub async fn apply_mutation_batch_at(
        &self,
        schedule_id: Uuid,
        req: StudentMutationBatchRequest,
        server_received_at: DateTime<Utc>,
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
        // Lock the attempt before the runtime/section gate. Every attempt writer
        // follows this order so terminalization cannot race a stale mutation.
        let mut attempt = self
            .load_attempt_by_id_for_update(tx.as_mut(), req.attempt_id.clone())
            .await?
            .ok_or(DeliveryError::NotFound)?;
        let (runtime_gate, runtime_section_gate) = self
            .lock_runtime_write_gate_tx(tx.as_mut(), schedule_id)
            .await?;
        if attempt.schedule_id != schedule_id.to_string() || attempt.student_key != req.student_key
        {
            return Err(DeliveryError::Validation(
                "Attempt does not belong to the provided schedule or student key.".to_owned(),
            ));
        }

        let active_client_session_id: Option<String> = sqlx::query_scalar(
            "SELECT active_client_session_id FROM student_attempts WHERE id = ?",
        )
        .bind(&req.attempt_id)
        .fetch_one(tx.as_mut())
        .await?;
        match active_client_session_id {
            Some(active_session_id) if active_session_id != req.client_session_id => {
                return Err(DeliveryError::Conflict {
                    message:
                        "Attempt write credential has been superseded by a newer student session."
                            .to_owned(),
                    reason: Some(DeliveryConflictReason::ActiveSessionSuperseded),
                    latest_revision: Some(attempt.revision),
                    server_accepted_through_seq: None,
                    active_session_id: Some(active_session_id),
                });
            }
            None => {
                sqlx::query(
                            "UPDATE student_attempts SET active_client_session_id = ? WHERE id = ? AND active_client_session_id IS NULL",
                        )
                        .bind(&req.client_session_id)
                        .bind(&req.attempt_id)
                        .execute(tx.as_mut())
                        .await?;
            }
            _ => {}
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

        let now = Utc::now();
        let objective_mutation_gate = objective_mutation_gate(
            runtime_gate.as_ref(),
            runtime_section_gate.as_ref(),
            Some(attempt.proctor_status),
            server_received_at,
        );
        let active_section_key = runtime_gate
            .as_ref()
            .and_then(|gate| gate.current_section_key.as_deref());

        let version = self
            .load_version(attempt.published_version_id.clone())
            .await?;
        let answer_schema = build_answer_schema(&version.content_snapshot)?;
        let writing_task_ids = build_writing_task_ids(&version.config_snapshot);

        let existing_max_seq: i64 = sqlx::query_scalar(
                    "SELECT COALESCE(MAX(mutation_seq), 0) FROM student_attempt_mutations WHERE attempt_id = ?",
                )
                .bind(&req.attempt_id)
                .fetch_one(tx.as_mut())
                .await?;

        let mut lookup_existing = QueryBuilder::<MySql>::new(
            "SELECT client_mutation_id, mutation_type, payload, mutation_seq, applied_revision FROM student_attempt_mutations WHERE attempt_id = ",
        );
        lookup_existing.push_bind(&req.attempt_id);

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
        let existing_by_id: HashMap<String, (MutationType, Value, i64, Option<i32>)> =
            existing_identities
                .into_iter()
                .map(|row| {
                    (
                        row.client_mutation_id,
                        (
                            row.mutation_type,
                            row.payload,
                            row.mutation_seq,
                            row.applied_revision,
                        ),
                    )
                })
                .collect();
        let mut mutation_results_by_id: HashMap<
            String,
            ielts_backend_domain::attempt::StudentMutationResult,
        > = HashMap::with_capacity(req.mutations.len());

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
            if let Some((existing_type, existing_payload, existing_seq, applied_revision)) =
                existing_by_id.get(&mutation.id)
            {
                if existing_type != &mutation_type || existing_payload != &payload_json {
                    return Err(DeliveryError::Validation(
                        "Mutation id already exists with different contents.".to_owned(),
                    ));
                }
                mutation_results_by_id.insert(
                    mutation.id.clone(),
                    ielts_backend_domain::attempt::StudentMutationResult {
                        mutation_id: mutation.id.clone(),
                        status:
                            ielts_backend_domain::attempt::StudentMutationResultStatus::Duplicate,
                        server_seq: *existing_seq,
                        applied_revision: *applied_revision,
                    },
                );
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
                mutation_results: req
                    .mutations
                    .iter()
                    .filter_map(|mutation| mutation_results_by_id.get(&mutation.id).cloned())
                    .collect(),
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

        if attempt.submitted_at.is_some() {
            return Err(DeliveryError::Conflict {
                message: "Attempt is already sealed and no longer accepts new mutations."
                    .to_owned(),
                reason: Some(DeliveryConflictReason::AttemptSubmitted),
                latest_revision: Some(attempt.revision),
                server_accepted_through_seq: Some(existing_max_seq),
                active_session_id: None,
            });
        }

        let original_answers = answers.clone();
        let original_writing_answers = writing_answers.clone();
        let original_flags = flags.clone();
        let mut applied_mutation_count: usize = 0;
        for mutation in &new_mutations {
            let applied = apply_mutation(
                mutation,
                &answer_schema,
                &writing_task_ids,
                objective_mutation_gate,
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
            if applied {
                applied_mutation_count = applied_mutation_count.saturating_add(1);
            }
        }

        let answer_revision_delta = i32::from(
            answers != original_answers
                || writing_answers != original_writing_answers
                || flags != original_flags,
        );
        let server_accepted_through_seq =
            existing_max_seq + i64::try_from(new_mutations.len()).unwrap_or(i64::MAX);
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

        let final_submission = attempt.final_submission.clone();

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
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
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
            .bind(server_received_at)
            .bind(attempt.revision + 1)
            .execute(tx.as_mut())
            .await?;

            mutation_results_by_id.insert(
                mutation.id.clone(),
                ielts_backend_domain::attempt::StudentMutationResult {
                    mutation_id: mutation.id.clone(),
                    status: ielts_backend_domain::attempt::StudentMutationResultStatus::Applied,
                    server_seq: next_seq,
                    applied_revision: Some(attempt.revision + 1),
                },
            );
        }

        let update_result = sqlx::query(
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
                answer_revision = answer_revision + ?,
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ?
              AND revision = ?
              AND submitted_at IS NULL
              AND COALESCE(proctor_status, 'active') <> 'terminated'
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
        .bind(answer_revision_delta)
        .bind(&req.attempt_id)
        .bind(attempt.revision)
        .execute(tx.as_mut())
        .await?;
        if update_result.rows_affected() != 1 {
            return Err(DeliveryError::Conflict {
                message: "Attempt changed or is already terminal.".to_owned(),
                reason: Some(DeliveryConflictReason::InvalidMutation),
                latest_revision: None,
                server_accepted_through_seq: None,
                active_session_id: None,
            });
        }

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
            accepted_in_grace: false,
            mutation_results: req
                .mutations
                .iter()
                .filter_map(|mutation| mutation_results_by_id.get(&mutation.id).cloned())
                .collect(),
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
        let attempt_id = req.attempt_id.clone().or_else(|| None);
        let mut tx = self.pool.begin().await?;
        let attempt_id = if let Some(attempt_id) = attempt_id {
            attempt_id
        } else {
            sqlx::query_scalar::<_, String>(
                "SELECT id FROM student_attempts WHERE schedule_id = ? AND student_key = ? LIMIT 1",
            )
            .bind(schedule_id.to_string())
            .bind(&req.student_key)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(DeliveryError::NotFound)?
        };
        let mut attempt = self
            .load_attempt_by_id_for_update(tx.as_mut(), attempt_id)
            .await?
            .ok_or(DeliveryError::NotFound)?;
        if attempt.schedule_id != schedule_id.to_string() || attempt.student_key != req.student_key
        {
            return Err(DeliveryError::Validation(
                "Attempt does not belong to the provided schedule or student key.".to_owned(),
            ));
        }
        if attempt.submitted_at.is_some()
            || attempt.proctor_status == ielts_backend_domain::attempt::ProctorStatus::Terminated
        {
            return Err(DeliveryError::Conflict {
                message: "Attempt is already terminal and no longer accepts heartbeats.".to_owned(),
                reason: Some(DeliveryConflictReason::AttemptSubmitted),
                latest_revision: Some(attempt.revision),
                server_accepted_through_seq: None,
                active_session_id: None,
            });
        }
        let active_session_id: Option<String> = sqlx::query_scalar(
            "SELECT active_client_session_id FROM student_attempts WHERE id = ?",
        )
        .bind(&attempt.id)
        .fetch_one(&mut *tx)
        .await?;
        match active_session_id {
            Some(active_session_id) if active_session_id != req.client_session_id => {
                return Err(DeliveryError::Conflict {
                    message:
                        "Attempt write credential has been superseded by a newer student session."
                            .to_owned(),
                    reason: Some(DeliveryConflictReason::ActiveSessionSuperseded),
                    latest_revision: Some(attempt.revision),
                    server_accepted_through_seq: None,
                    active_session_id: Some(active_session_id),
                });
            }
            Some(_) => {}
            None => {
                sqlx::query("UPDATE student_attempts SET active_client_session_id = ?, integrity = JSON_SET(integrity, '$.clientSessionId', ?) WHERE id = ? AND active_client_session_id IS NULL")
                    .bind(&req.client_session_id)
                    .bind(&req.client_session_id)
                    .bind(&attempt.id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        // Older clients may omit mutation_id. Derive a stable legacy identity
        // instead of generating a fresh UUID, so a retried identical request
        // remains idempotent. New clients should always send mutation_id.
        let mutation_id = req.mutation_id.clone().unwrap_or_else(|| {
            let payload = req
                .payload
                .as_ref()
                .and_then(|value| serde_json::to_string(value).ok())
                .unwrap_or_default();
            sha256_hex(&format!(
                "legacy-heartbeat:{}:{}:{}:{}:{}",
                attempt.id,
                req.client_session_id,
                req.event_type.as_str(),
                req.client_timestamp.to_rfc3339(),
                payload,
            ))
        });
        let inserted = sqlx::query(
            r#"INSERT INTO student_heartbeat_events
               (id, attempt_id, schedule_id, mutation_id, event_type, payload, client_timestamp, server_received_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))
               ON DUPLICATE KEY UPDATE mutation_id = VALUES(mutation_id)"#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&attempt.id)
        .bind(schedule_id.to_string())
        .bind(&mutation_id)
        .bind(req.event_type.as_str())
        .bind(&req.payload)
        .bind(req.client_timestamp)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 0 {
            let existing: (String, Option<Value>, DateTime<Utc>) = sqlx::query_as(
                "SELECT event_type, payload, client_timestamp FROM student_heartbeat_events WHERE attempt_id = ? AND mutation_id = ?",
            )
            .bind(&attempt.id)
            .bind(&mutation_id)
            .fetch_one(&mut *tx)
            .await?;
            if existing.0 != req.event_type.as_str()
                || existing.1 != req.payload
                || existing.2 != req.client_timestamp
            {
                return Err(DeliveryError::Conflict {
                    message: "Heartbeat mutation_id was reused for a different event.".to_owned(),
                    reason: Some(DeliveryConflictReason::InvalidMutation),
                    latest_revision: Some(attempt.revision),
                    server_accepted_through_seq: None,
                    active_session_id: Some(req.client_session_id),
                });
            }
            tx.commit().await?;
            return Ok(attempt);
        }

        let now: DateTime<Utc> = sqlx::query_scalar("SELECT UTC_TIMESTAMP(6)")
            .fetch_one(&mut *tx)
            .await?;
        let heartbeat_status = match req.event_type {
            HeartbeatEventType::Disconnect | HeartbeatEventType::Lost => "lost",
            _ => "ok",
        };
        let mut integrity = ensure_object(attempt.integrity.clone().into());
        integrity.insert(
            "lastHeartbeatAt".to_owned(),
            Value::String(now.to_rfc3339()),
        );
        integrity.insert(
            "lastHeartbeatStatus".to_owned(),
            Value::String(heartbeat_status.to_owned()),
        );
        integrity.insert(
            "clientSessionId".to_owned(),
            Value::String(req.client_session_id.clone()),
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
        let changed = sqlx::query(
            "UPDATE student_attempts SET integrity = ?, updated_at = UTC_TIMESTAMP(6), revision = revision + ? WHERE id = ? AND submitted_at IS NULL AND proctor_status <> 'terminated'",
        )
        .bind(Value::Object(integrity))
        .bind(i32::from(req.event_type != HeartbeatEventType::Heartbeat))
        .bind(&attempt.id)
        .execute(&mut *tx)
        .await?;
        if changed.rows_affected() != 1 {
            return Err(DeliveryError::Conflict {
                message: "Attempt became terminal while the heartbeat was being recorded."
                    .to_owned(),
                reason: Some(DeliveryConflictReason::AttemptSubmitted),
                latest_revision: Some(attempt.revision),
                server_accepted_through_seq: None,
                active_session_id: None,
            });
        }

        let disconnect_at = matches!(
            req.event_type,
            HeartbeatEventType::Disconnect | HeartbeatEventType::Lost
        )
        .then_some(now);
        let reconnect_at = (req.event_type == HeartbeatEventType::Reconnect).then_some(now);
        sqlx::query(
            r#"INSERT INTO student_attempt_presence
               (attempt_id, schedule_id, client_session_id, last_heartbeat_at, last_heartbeat_status, last_disconnect_at, last_reconnect_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                 schedule_id = VALUES(schedule_id),
                 client_session_id = VALUES(client_session_id),
                 last_heartbeat_at = GREATEST(last_heartbeat_at, VALUES(last_heartbeat_at)),
                 last_heartbeat_status = VALUES(last_heartbeat_status),
                 last_disconnect_at = COALESCE(VALUES(last_disconnect_at), last_disconnect_at),
                 last_reconnect_at = COALESCE(VALUES(last_reconnect_at), last_reconnect_at),
                 updated_at = UTC_TIMESTAMP(6)"#,
        )
        .bind(&attempt.id)
        .bind(schedule_id.to_string())
        .bind(&req.client_session_id)
        .bind(now)
        .bind(heartbeat_status)
        .bind(disconnect_at)
        .bind(reconnect_at)
        .execute(&mut *tx)
        .await?;

        if req.event_type != HeartbeatEventType::Heartbeat {
            let action_type = match req.event_type {
                HeartbeatEventType::Disconnect => "NETWORK_DISCONNECTED",
                HeartbeatEventType::Reconnect => "NETWORK_RECONNECTED",
                HeartbeatEventType::Lost => "HEARTBEAT_LOST",
                HeartbeatEventType::Heartbeat => "STUDENT_NETWORK",
            };
            sqlx::query("INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))")
                .bind(Uuid::new_v4().to_string())
                .bind(schedule_id.to_string())
                .bind(&attempt.candidate_name)
                .bind(action_type)
                .bind(&attempt.id)
                .bind(json!({"eventType": req.event_type, "clientTimestamp": req.client_timestamp, "payload": req.payload}))
                .execute(&mut *tx)
                .await?;
        }
        attempt =
            sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
                .bind(&attempt.id)
                .fetch_one(&mut *tx)
                .await?;
        tx.commit().await?;
        Ok(attempt)
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
        self.submit_attempt_with_metadata(
            schedule_id,
            req,
            idempotency_key,
            Uuid::new_v4().to_string(),
            None,
        )
        .await
    }

    pub async fn submit_attempt_with_metadata(
        &self,
        schedule_id: Uuid,
        req: StudentSubmitRequest,
        idempotency_key: Option<String>,
        request_id: String,
        min_answer_revision: Option<i32>,
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
        let (runtime_gate, runtime_section_gate) = self
            .lock_runtime_write_gate_tx(tx.as_mut(), schedule_id)
            .await?;
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

        let active_client_session_id: Option<String> = sqlx::query_scalar(
            "SELECT active_client_session_id FROM student_attempts WHERE id = ?",
        )
        .bind(&req.attempt_id)
        .fetch_one(tx.as_mut())
        .await?;
        match active_client_session_id {
            Some(active_session_id)
                if req.client_session_id.as_deref() != Some(active_session_id.as_str()) =>
            {
                return Err(DeliveryError::Conflict {
                    message:
                        "Attempt write credential has been superseded by a newer student session."
                            .to_owned(),
                    reason: Some(DeliveryConflictReason::ActiveSessionSuperseded),
                    latest_revision: Some(attempt.revision),
                    server_accepted_through_seq: None,
                    active_session_id: Some(active_session_id),
                });
            }
            None => {
                sqlx::query(
                            "UPDATE student_attempts SET active_client_session_id = ? WHERE id = ? AND active_client_session_id IS NULL",
                        ).bind(req.client_session_id.as_deref())
                        .bind(&req.attempt_id)
                        .execute(tx.as_mut())
                        .await?;
            }
            _ => {}
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

        if attempt.submitted_at.is_some() {
            let sealed = seal_attempt_in_tx(
                &mut tx,
                &SealAttemptCommand {
                    attempt_id: req.attempt_id.clone(),
                    schedule_id: schedule_id.to_string(),
                    outcome: "submitted",
                    reason: "student_submit".to_owned(),
                    actor_kind: TerminalizationActorKind::Student,
                    actor_id: Some(req.student_key.clone()),
                    proctor_note: None,
                    request_id: request_id.clone(),
                    min_answer_revision: None,
                    effective_at: None,
                    final_submission: None,
                },
            )
            .await?;
            let response = build_submit_response(sealed.attempt, sealed.effective_at);
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
                return Err(DeliveryError::Conflict {
                    message: "Attempt revision is stale.".to_owned(),
                    reason: Some(DeliveryConflictReason::BaseRevisionMismatch),
                    latest_revision: Some(attempt.revision),
                    server_accepted_through_seq: None,
                    active_session_id: None,
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

        let persisted_answers: Value = attempt.answers.clone().into();
        let persisted_writing_answers: Value = attempt.writing_answers.clone().into();
        let persisted_flags: Value = attempt.flags.clone().into();
        let final_payload_changes_scored_state = final_answers != persisted_answers
            || final_writing_answers != persisted_writing_answers
            || final_flags != persisted_flags;
        if final_payload_changes_scored_state {
            let write_gate = objective_mutation_gate(
                runtime_gate.as_ref(),
                runtime_section_gate.as_ref(),
                Some(attempt.proctor_status),
                runtime_section_gate
                    .as_ref()
                    .map(|section| section.server_now)
                    .unwrap_or_else(Utc::now),
            );
            if !write_gate.allowed {
                return Err(DeliveryError::conflict_reason(
                    write_gate
                        .reason
                        .unwrap_or(DeliveryConflictReason::ObjectiveLocked),
                    "Final answer payload cannot change scored content outside the active timed section.",
                ));
            }
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
        let answer_revision_delta = i32::from(final_payload_changes_scored_state);
        sqlx::query(
            r#"
            UPDATE student_attempts
            SET
                answers = ?,
                writing_answers = ?,
                flags = ?,
                recovery = ?,
                answer_revision = answer_revision + ?,
                updated_at = UTC_TIMESTAMP(6),
                revision = revision + 1
            WHERE id = ? AND schedule_id = ?
            "#,
        )
        .bind(&final_answers)
        .bind(&final_writing_answers)
        .bind(&final_flags)
        .bind(recovery)
        .bind(answer_revision_delta)
        .bind(&req.attempt_id)
        .bind(schedule_id.to_string())
        .execute(tx.as_mut())
        .await?;

        let sealed = seal_attempt_in_tx(
            &mut tx,
            &SealAttemptCommand {
                attempt_id: req.attempt_id.clone(),
                schedule_id: schedule_id.to_string(),
                outcome: "submitted",
                reason: "student_submit".to_owned(),
                actor_kind: TerminalizationActorKind::Student,
                actor_id: Some(req.student_key.clone()),
                proctor_note: None,
                request_id,
                min_answer_revision,
                effective_at: None,
                final_submission: Some(final_submission),
            },
        )
        .await?;
        let attempt = sealed.attempt;
        let submitted_at = sealed.effective_at;
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
        client_session_id: &str,
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
        let attempt_id = Uuid::new_v4();
        let mut tx = self.pool.begin().await?;
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
            "clientSessionId": client_session_id,
            "lastDisconnectAt": null,
            "lastReconnectAt": null,
            "lastHeartbeatAt": null,
            "lastHeartbeatStatus": "idle"
        }))
        .bind(json!({
            "clientSessionId": client_session_id,
            "lastRecoveredAt": null,
            "lastLocalMutationAt": null,
            "lastPersistedAt": null,
            "pendingMutationCount": 0,
            "syncState": "idle",
            "serverAcceptedThroughSeq": 0
        }))
        .execute(&mut *tx)
        .await;

        if let Err(error) = insert_result {
            let unique_violation = error
                .as_database_error()
                .is_some_and(|database_error| database_error.is_unique_violation());
            tx.rollback().await?;
            if unique_violation {
                if let Some(attempt) = self
                    .load_attempt_by_student_key(schedule.id.clone(), student_key)
                    .await?
                {
                    return Ok(attempt);
                }
            }
            return Err(DeliveryError::from(error));
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
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

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
        expected_revision: i32,
    ) -> Result<StudentAttempt, DeliveryError> {
        let result = sqlx::query(
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
              AND revision = ?
              AND submitted_at IS NULL
              AND COALESCE(proctor_status, 'active') <> 'terminated'
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
        .bind(expected_revision)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() != 1 {
            return Err(DeliveryError::conflict(
                "Attempt changed or is already terminal.".to_owned(),
            ));
        }

        sqlx::query_as::<_, StudentAttempt>("SELECT * FROM student_attempts WHERE id = ?")
            .bind(attempt_id.to_string())
            .fetch_one(&self.pool)
            .await
            .map_err(DeliveryError::from)
    }

    #[allow(clippy::too_many_arguments)]
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

    async fn load_schedule(
        &self,
        actor: &ActorContext,
        schedule_id: Uuid,
    ) -> Result<ExamSchedule, DeliveryError> {
        SchedulingService::new(self.pool.clone())
            .get_schedule(actor, schedule_id)
            .await
            .map_err(map_scheduling_error)
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
        actor: &ActorContext,
        schedule_id: Uuid,
    ) -> Result<Option<ExamSessionRuntime>, DeliveryError> {
        SchedulingService::new(self.pool.clone())
            .get_runtime(actor, schedule_id)
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
    tx: &mut Transaction<'_, MySql>,
    schedule_id: Uuid,
    completion_reason: &str,
) -> Result<(), DeliveryError> {
    let pending_attempts = sqlx::query_as::<_, StudentAttempt>(
        "SELECT * FROM student_attempts WHERE schedule_id = ? AND submitted_at IS NULL FOR UPDATE",
    )
    .bind(schedule_id.to_string())
    .fetch_all(&mut **tx)
    .await?;
    lock_schedule_terminalization_scope_in_tx(&mut **tx, &schedule_id.to_string()).await?;

    // Keep a durable wake-up for deployments where finalization is delegated
    // to the worker. The in-transaction seal below still makes completion
    // visible immediately; a later worker replay is idempotent. This request is
    // emitted even when the schedule currently has no attempts so a completion
    // observed by a worker is represented durably.
    let request_exists: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM outbox_events WHERE aggregate_kind = 'schedule' AND aggregate_id = ? AND event_family = 'auto_submit_schedule_attempts_requested')",
    )
    .bind(schedule_id.to_string())
    .fetch_one(&mut **tx)
    .await?;
    if request_exists == 0 {
        OutboxRepository::enqueue_in_tx(
            tx,
            "schedule",
            &schedule_id.to_string(),
            0,
            "auto_submit_schedule_attempts_requested",
            &json!({
                "scheduleId": schedule_id,
                "completionReason": completion_reason,
            }),
        )
        .await?;
    }

    for attempt in pending_attempts {
        let provider_key: Option<String> =
            sqlx::query_scalar("SELECT provider_key FROM exam_entities WHERE id = ?")
                .bind(&attempt.exam_id)
                .fetch_optional(&mut **tx)
                .await?;
        let outcome = if provider_key.as_deref() == Some("sat")
            || attempt.proctor_status.as_str() == "terminated"
        {
            "terminated"
        } else {
            "submitted"
        };
        let final_submission = json!({
            "submissionId": format!("submission-{}", Uuid::new_v4().simple()),
            "completionReason": completion_reason,
            "autoSubmission": true,
            "proctorStatus": attempt.proctor_status.as_str(),
            "submissionPolicy": "forced_auto_submit"
        });
        seal_attempt_in_tx(
            tx,
            &SealAttemptCommand {
                attempt_id: attempt.id.clone(),
                schedule_id: schedule_id.to_string(),
                outcome,
                reason: completion_reason.to_owned(),
                actor_kind: TerminalizationActorKind::System,
                actor_id: None,
                proctor_note: None,
                request_id: Uuid::new_v4().to_string(),
                min_answer_revision: None,
                effective_at: None,
                final_submission: Some(final_submission),
            },
        )
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
    auto_submit_schedule_attempts_in_tx(&mut tx, schedule_id, completion_reason).await?;
    tx.commit().await?;
    Ok(())
}

/// Repairs SAT terminalizations created by an older writer or interrupted deployment.
/// The repair is provider-scoped and idempotent because the result has a unique
/// `(attempt_id, provider_key)` identity.
pub async fn repair_sat_terminal_results(
    pool: &MySqlPool,
    batch_size: i64,
) -> Result<u64, DeliveryError> {
    let mut tx = pool.begin().await?;
    let attempts = sqlx::query_as::<_, StudentAttempt>(
        r#"
        SELECT a.*
        FROM student_attempts a
        JOIN exam_entities e ON e.id = a.exam_id
        JOIN attempt_terminalizations t ON t.attempt_id = a.id
        LEFT JOIN assessment_results ar
            ON ar.attempt_id = a.id
           AND ar.provider_key = 'sat'
        WHERE a.phase = 'post-exam'
          AND e.provider_key = 'sat'
          AND ar.id IS NULL
        ORDER BY a.updated_at ASC, a.id ASC
        LIMIT ?
        FOR UPDATE
        "#,
    )
    .bind(batch_size.max(1))
    .fetch_all(&mut *tx)
    .await?;

    let mut repaired = 0_u64;
    for attempt in attempts {
        let receipt = load_terminalization_in_tx(&mut *tx, &attempt.id)
            .await?
            .ok_or_else(|| {
                DeliveryError::Internal(
                    "SAT terminal result repair found an attempt without its receipt.".to_owned(),
                )
            })?;
        let actor_kind = if receipt.actor_kind == "proctor" {
            TerminalizationActorKind::Proctor
        } else if receipt.actor_kind == "student" {
            TerminalizationActorKind::Student
        } else {
            TerminalizationActorKind::System
        };
        let provider_key = "sat";
        materialize_sat_terminal_result_in_tx(
            &mut tx,
            &attempt,
            provider_key,
            &receipt.outcome,
            &receipt.reason,
            actor_kind,
            &receipt.terminalization_id,
            receipt.effective_at,
            &receipt.final_snapshot,
        )
        .await?;
        repaired = repaired.saturating_add(1);
    }

    tx.commit().await?;
    Ok(repaired)
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
    .fetch_optional(&mut *tx)
    .await?;
    if pending_attempt.is_some() {
        lock_schedule_terminalization_scope_in_tx(&mut *tx, &schedule_id.to_string()).await?;
    }

    let Some(attempt) = pending_attempt else {
        tx.commit().await?;
        return Ok(());
    };

    seal_attempt_in_tx(
        &mut tx,
        &SealAttemptCommand {
            attempt_id: attempt.id,
            schedule_id: schedule_id.to_string(),
            outcome: "terminated",
            reason: completion_reason.to_owned(),
            actor_kind: TerminalizationActorKind::Proctor,
            actor_id: None,
            proctor_note: None,
            request_id: Uuid::new_v4().to_string(),
            min_answer_revision: None,
            effective_at: None,
            final_submission: Some(json!({
                "submissionId": format!("submission-{}", Uuid::new_v4().simple()),
                "completionReason": completion_reason,
                "terminated": true,
                "autoSubmission": true,
                "submissionPolicy": "forced_auto_submit"
            })),
        },
    )
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

#[derive(Debug, Clone, sqlx::FromRow)]
struct RuntimeGateRow {
    id: String,
    status: String,
    current_section_key: Option<String>,
    waiting_for_next_section: bool,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct RuntimeSectionWriteGateRow {
    status: String,
    actual_start_at: Option<DateTime<Utc>>,
    paused_at: Option<DateTime<Utc>>,
    planned_duration_minutes: i32,
    extension_minutes: i32,
    accumulated_paused_seconds: i32,
    server_now: DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct ExistingMutationIdentityRow {
    client_mutation_id: String,
    mutation_type: MutationType,
    payload: Value,
    mutation_seq: i64,
    applied_revision: Option<i32>,
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
    section: Option<&RuntimeSectionWriteGateRow>,
    proctor_status: Option<ielts_backend_domain::attempt::ProctorStatus>,
    server_received_at: DateTime<Utc>,
) -> ObjectiveMutationGate {
    if matches!(
        proctor_status,
        Some(ielts_backend_domain::attempt::ProctorStatus::Paused)
            | Some(ielts_backend_domain::attempt::ProctorStatus::Terminated)
    ) {
        return ObjectiveMutationGate::block(DeliveryConflictReason::AttemptProctorBlocked);
    }

    let Some(runtime) = runtime else {
        return ObjectiveMutationGate::block(DeliveryConflictReason::ObjectiveLocked);
    };
    if runtime.waiting_for_next_section || runtime.status != "live" {
        return ObjectiveMutationGate::block(DeliveryConflictReason::ObjectiveLocked);
    }

    let Some(section) = section else {
        return ObjectiveMutationGate::block(DeliveryConflictReason::ObjectiveLocked);
    };
    if section.status != "live" || section.paused_at.is_some() {
        return ObjectiveMutationGate::block(DeliveryConflictReason::ObjectiveLocked);
    }

    let Some(started_at) = section.actual_start_at else {
        return ObjectiveMutationGate::block(DeliveryConflictReason::ObjectiveLocked);
    };
    let duration_seconds = i64::from(
        section
            .planned_duration_minutes
            .saturating_add(section.extension_minutes),
    )
    .saturating_mul(60)
    .saturating_add(i64::from(section.accumulated_paused_seconds.max(0)));
    let deadline = started_at + ChronoDuration::seconds(duration_seconds.max(0));
    if server_received_at > deadline {
        return ObjectiveMutationGate::block(DeliveryConflictReason::DeadlineExpired);
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
                return Ok(false);
            }

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
                return Ok(false);
            }

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
                return Ok(false);
            }

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
                return Ok(false);
            }

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
                return Ok(false);
            }

            if let Some(active_section_key) = active_section_key {
                if active_section_key != "writing" {
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
                return Ok(false);
            }

            if let Some(active_section_key) = active_section_key {
                if active_section_key != "writing" {
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
                return Ok(false);
            }

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
            provider_key: "ielts".to_owned(),
            status,
            plan_snapshot: Vec::new(),
            timing_model: "legacy_section_v1".to_owned(),
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
    fn objective_mutation_gate_enforces_runtime_section_deadline_and_proctor_state() {
        let server_now = Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap();
        let live_section = RuntimeSectionWriteGateRow {
            status: "live".to_owned(),
            actual_start_at: Some(Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap()),
            paused_at: None,
            planned_duration_minutes: 10,
            extension_minutes: 0,
            accumulated_paused_seconds: 0,
            server_now,
        };
        let paused = RuntimeGateRow {
            id: "runtime-1".to_owned(),
            status: "paused".to_owned(),
            current_section_key: Some("reading".to_owned()),
            waiting_for_next_section: false,
        };
        let paused_gate = objective_mutation_gate(
            Some(&paused),
            Some(&live_section),
            Some(ielts_backend_domain::attempt::ProctorStatus::Active),
            server_now,
        );
        assert!(!paused_gate.allowed);
        assert_eq!(
            paused_gate.reason,
            Some(DeliveryConflictReason::ObjectiveLocked)
        );

        let live = RuntimeGateRow {
            status: "live".to_owned(),
            ..paused
        };
        let live_gate = objective_mutation_gate(
            Some(&live),
            Some(&live_section),
            Some(ielts_backend_domain::attempt::ProctorStatus::Active),
            server_now,
        );
        assert!(live_gate.allowed);

        let expired_section = RuntimeSectionWriteGateRow {
            actual_start_at: Some(Utc.with_ymd_and_hms(2026, 1, 10, 8, 54, 59).unwrap()),
            ..live_section.clone()
        };
        let expired_gate = objective_mutation_gate(
            Some(&live),
            Some(&expired_section),
            Some(ielts_backend_domain::attempt::ProctorStatus::Active),
            server_now,
        );
        assert!(!expired_gate.allowed);
        assert_eq!(
            expired_gate.reason,
            Some(DeliveryConflictReason::DeadlineExpired)
        );

        let blocked_by_proctor = objective_mutation_gate(
            Some(&live),
            Some(&live_section),
            Some(ielts_backend_domain::attempt::ProctorStatus::Paused),
            server_now,
        );
        assert!(!blocked_by_proctor.allowed);
        assert_eq!(
            blocked_by_proctor.reason,
            Some(DeliveryConflictReason::AttemptProctorBlocked)
        );

        let missing_runtime = objective_mutation_gate(
            None,
            None,
            Some(ielts_backend_domain::attempt::ProctorStatus::Active),
            server_now,
        );
        assert!(!missing_runtime.allowed);
    }

    #[test]
    fn objective_mutation_gate_uses_trusted_ingress_time_across_processing_delay() {
        let live = RuntimeGateRow {
            id: "runtime-1".to_owned(),
            status: "live".to_owned(),
            current_section_key: Some("reading".to_owned()),
            waiting_for_next_section: false,
        };
        let section = RuntimeSectionWriteGateRow {
            status: "live".to_owned(),
            actual_start_at: Some(Utc.with_ymd_and_hms(2026, 1, 10, 9, 0, 0).unwrap()),
            paused_at: None,
            planned_duration_minutes: 5,
            extension_minutes: 0,
            accumulated_paused_seconds: 0,
            server_now: Utc.with_ymd_and_hms(2026, 1, 10, 9, 6, 0).unwrap(),
        };
        let at_deadline = Utc.with_ymd_and_hms(2026, 1, 10, 9, 5, 0).unwrap();
        let after_deadline = at_deadline + ChronoDuration::milliseconds(1);

        let admitted = objective_mutation_gate(
            Some(&live),
            Some(&section),
            Some(ielts_backend_domain::attempt::ProctorStatus::Active),
            at_deadline,
        );
        assert!(admitted.allowed);

        let rejected = objective_mutation_gate(
            Some(&live),
            Some(&section),
            Some(ielts_backend_domain::attempt::ProctorStatus::Active),
            after_deadline,
        );
        assert!(!rejected.allowed);
        assert_eq!(
            rejected.reason,
            Some(DeliveryConflictReason::DeadlineExpired)
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
    fn terminalization_intent_compatibility_only_accepts_same_outcome() {
        assert!(terminalization_intent_is_compatible(
            "submitted",
            "student_submit",
            "submitted",
            "student_submit"
        ));
        assert!(terminalization_intent_is_compatible(
            "submitted",
            "student_submit",
            "submitted",
            "time_expired"
        ));
        assert!(!terminalization_intent_is_compatible(
            "submitted",
            "student_submit",
            "terminated",
            "proctor_terminate"
        ));
        assert!(!terminalization_intent_is_compatible(
            "terminated",
            "proctor_terminate",
            "submitted",
            "student_submit"
        ));
    }

    #[test]
    fn terminal_snapshot_contains_only_server_owned_attempt_state() {
        let snapshot = build_terminal_snapshot(
            "attempt-1",
            "schedule-1",
            Some("org-1"),
            "exam-1",
            "version-1",
            "ielts",
            7,
            json!({"q1": "answer"}),
            json!({"task1": "essay"}),
            json!({"q1": true}),
        );

        assert_eq!(snapshot["attemptId"], "attempt-1");
        assert_eq!(snapshot["scheduleId"], "schedule-1");
        assert_eq!(snapshot["organizationId"], "org-1");
        assert_eq!(snapshot["examId"], "exam-1");
        assert_eq!(snapshot["publishedVersionId"], "version-1");
        assert_eq!(snapshot["providerKey"], "ielts");
        assert_eq!(snapshot["answerRevision"], 7);
        assert_eq!(snapshot["answers"]["q1"], "answer");
        assert_eq!(snapshot["writingAnswers"]["task1"], "essay");
        assert_eq!(snapshot["flags"]["q1"], true);
        assert!(snapshot.get("clientSnapshot").is_none());
    }
}
