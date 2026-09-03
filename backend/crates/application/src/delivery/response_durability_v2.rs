use std::cmp::Ordering;

use chrono::{DateTime, Duration, Utc};
use ielts_backend_domain::durability_v2::*;
use ielts_backend_infrastructure::auth::{
    random_token, sha256_hex, sign_attempt_token, AttemptTokenClaims,
};
use ielts_backend_infrastructure::config::AppConfig;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{Map, Value};
use sqlx::{FromRow, MySql, MySqlPool, Transaction};
use thiserror::Error;
use uuid::Uuid;

use crate::delivery::{
    seal_attempt_in_tx, DeliveryError, SealAttemptCommand, TerminalizationActorKind,
};

const MAX_BATCH_COMMANDS: usize = 100;
const MAX_WRITE_ID_BYTES: usize = 64;
const MAX_QUESTION_ID_BYTES: usize = 255;
const MAX_REASON_BYTES: usize = 500;
const MAX_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_JSON_DEPTH: usize = 32;
const MAX_ARRAY_ITEMS: usize = 512;
const MAX_OBJECT_KEYS: usize = 256;
const MAX_STRING_BYTES: usize = 64 * 1024;
const RESPONSE_CLOSING_GRACE_SECONDS: i64 = 30;

#[derive(Debug, Error)]
pub enum DurabilityV2Error {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Attempt not found")]
    NotFound,
    #[error("Unauthorized: {0}")]
    Unauthorized(String),
    #[error("Validation failed: {0}")]
    Validation(String),
    #[error("Structured conflict: {code:?} - {message}")]
    StructuredConflict {
        code: DurabilityErrorCode,
        message: String,
        details: Option<Value>,
    },
}

#[derive(Debug, FromRow)]
pub struct AttemptV2Row {
    pub id: String,
    pub schedule_id: String,
    pub organization_id: Option<String>,
    pub user_id: Option<String>,
    pub exam_id: String,
    pub published_version_id: String,
    pub phase: String,
    pub delivery_status: Option<String>,
    pub protocol_version: Option<i32>,
    pub lease_epoch: Option<i64>,
    pub control_epoch: Option<i64>,
    pub response_revision: Option<i64>,
    pub answers: Value,
    pub writing_answers: Value,
    pub flags: Value,
    pub deadline_at: Option<DateTime<Utc>>,
    pub closing_grace_until: Option<DateTime<Utc>>,
    pub submitted_at: Option<DateTime<Utc>>,
    pub final_response_digest: Option<String>,
    pub active_client_session_id: Option<String>,
    pub proctor_status: Option<String>,
}

#[derive(Debug, FromRow)]
pub struct AttemptResponseV2Row {
    pub attempt_id: String,
    pub question_id: String,
    pub module_id: String,
    pub lease_epoch: i64,
    pub control_epoch: i64,
    pub client_version: i64,
    pub client_write_id: String,
    pub request_hash: String,
    pub response: Value,
    pub response_hash: String,
    pub server_revision: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct AttemptMutationV2Row {
    pub id: String,
    pub attempt_id: String,
    pub client_write_id: String,
    pub lease_epoch: i64,
    pub control_epoch: i64,
    pub question_id: String,
    pub client_version: i64,
    pub request_hash: String,
    pub response_hash: String,
    pub outcome: String,
    pub server_revision: i64,
    pub canonical_response: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
pub struct AttemptSubmissionV2Row {
    pub attempt_id: String,
    pub submission_id: String,
    pub lease_epoch: i64,
    pub control_epoch: i64,
    pub request_hash: String,
    pub expected_attempt_revision: i64,
    pub attempt_revision: i64,
    pub final_response_digest: String,
    pub receipt: Value,
    pub submitted_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct QuestionOwnershipRow {
    exam_question_id: String,
    question_id: String,
    module_id: String,
    section_key: String,
    adaptive_role: String,
    module_state: String,
}

#[derive(Debug, Clone)]
struct QuestionOwnership {
    module_id: String,
    section_key: Option<String>,
    adaptive_role: Option<String>,
    module_state: Option<String>,
    legacy_exam_question_id: Option<String>,
}

#[derive(Debug, FromRow)]
struct RuntimeWriteGateRow {
    id: String,
    status: String,
    timing_model: String,
    active_section_key: Option<String>,
    waiting_for_next_section: bool,
}

#[derive(Debug, FromRow)]
struct RuntimeSectionWriteGateRow {
    status: String,
    actual_start_at: Option<DateTime<Utc>>,
    paused_at: Option<DateTime<Utc>>,
    planned_duration_minutes: i32,
    extension_minutes: i32,
    accumulated_paused_seconds: i32,
    server_now: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy)]
struct RuntimeResponseWindow {
    deadline_at: DateTime<Utc>,
    closing_grace_until: DateTime<Utc>,
    server_now: DateTime<Utc>,
}

type RuntimeWriteScope = (
    Option<RuntimeWriteGateRow>,
    Option<RuntimeSectionWriteGateRow>,
);

#[derive(Debug, Default)]
struct AppliedCommands {
    acknowledgements: Vec<ResponseAcknowledgementV2>,
    attempt_revision: i64,
}

#[derive(Clone, Debug)]
pub struct ResponseDurabilityV2Service {
    pool: MySqlPool,
    config: AppConfig,
}

/// Canonicalize JSON recursively so object insertion order cannot change a hash.
pub fn canonicalize_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut keys: Vec<&String> = object.keys().collect();
            keys.sort();
            let mut canonical = Map::new();
            for key in keys {
                if let Some(child) = object.get(key) {
                    canonical.insert(key.clone(), canonicalize_json(child));
                }
            }
            Value::Object(canonical)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize_json).collect()),
        scalar => scalar.clone(),
    }
}

pub fn canonical_json<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    let value = serde_json::to_value(value)?;
    serde_json::to_string(&canonicalize_json(&value))
}

pub fn canonical_json_hash<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    Ok(sha256_hex(&canonical_json(value)?))
}

pub fn canonical_response_hash(payload: &ResponsePayload) -> Result<String, serde_json::Error> {
    canonical_json_hash(payload)
}

pub fn canonical_command_hash(command: &ResponseCommandV2) -> Result<String, serde_json::Error> {
    canonical_json_hash(command)
}

pub fn final_response_digest<I, Q, H>(responses: I) -> String
where
    I: IntoIterator<Item = (Q, H)>,
    Q: AsRef<str>,
    H: AsRef<str>,
{
    let mut ordered: Vec<(String, String)> = responses
        .into_iter()
        .map(|(question_id, response_hash)| {
            (
                question_id.as_ref().to_owned(),
                response_hash.as_ref().to_owned(),
            )
        })
        .collect();
    ordered.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));

    let mut material = String::new();
    for (question_id, response_hash) in ordered {
        material.push_str(&question_id.len().to_string());
        material.push(':');
        material.push_str(&question_id);
        material.push(':');
        material.push_str(&response_hash.len().to_string());
        material.push(':');
        material.push_str(&response_hash);
        material.push(';');
    }
    sha256_hex(&material)
}

/// Validate the response shape before it reaches either durable table.
pub fn validate_response_payload(payload: &ResponsePayload) -> Result<(), String> {
    let encoded = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    if encoded.len() > MAX_RESPONSE_BYTES {
        return Err(format!(
            "response payload exceeds the {} byte limit",
            MAX_RESPONSE_BYTES
        ));
    }
    validate_json_value(&payload.answer, 0)?;
    if payload.eliminated_options.len() > MAX_ARRAY_ITEMS {
        return Err("too many eliminated options".to_owned());
    }
    for option in &payload.eliminated_options {
        validate_text(option, "eliminated option", MAX_STRING_BYTES)?;
    }
    if payload.annotations.len() > MAX_ARRAY_ITEMS {
        return Err("too many annotations".to_owned());
    }
    for annotation in &payload.annotations {
        let object = annotation
            .as_object()
            .ok_or_else(|| "each annotation must be an object".to_owned())?;
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "each annotation must contain a string id".to_owned())?;
        validate_text(id, "annotation id", 255)?;
        if id.trim().is_empty() {
            return Err("annotation id cannot be empty".to_owned());
        }
        validate_json_value(annotation, 0)?;
    }
    Ok(())
}

fn validate_json_value(value: &Value, depth: usize) -> Result<(), String> {
    if depth > MAX_JSON_DEPTH {
        return Err("response JSON is too deeply nested".to_owned());
    }
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => Ok(()),
        Value::String(text) => validate_text(text, "response string", MAX_STRING_BYTES),
        Value::Array(items) => {
            if items.len() > MAX_ARRAY_ITEMS {
                return Err("response array contains too many items".to_owned());
            }
            for item in items {
                validate_json_value(item, depth + 1)?;
            }
            Ok(())
        }
        Value::Object(object) => {
            if object.len() > MAX_OBJECT_KEYS {
                return Err("response object contains too many fields".to_owned());
            }
            for (key, child) in object {
                validate_text(key, "response object key", 255)?;
                validate_json_value(child, depth + 1)?;
            }
            Ok(())
        }
    }
}

fn validate_text(value: &str, label: &str, max_bytes: usize) -> Result<(), String> {
    if value.len() > max_bytes {
        return Err(format!("{label} exceeds the {max_bytes} byte limit"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} contains control characters"));
    }
    Ok(())
}

fn validate_identifier(
    value: &str,
    label: &str,
    max_bytes: usize,
) -> Result<(), DurabilityV2Error> {
    if value.trim().is_empty() {
        return Err(DurabilityV2Error::Validation(format!(
            "{label} cannot be empty"
        )));
    }
    validate_text(value, label, max_bytes).map_err(DurabilityV2Error::Validation)
}

impl ResponseDurabilityV2Service {
    pub fn new(pool: MySqlPool, config: AppConfig) -> Self {
        Self { pool, config }
    }

    pub fn pool(&self) -> &MySqlPool {
        &self.pool
    }

    pub async fn save_responses_batch(
        &self,
        attempt_id: &str,
        claims: &AttemptTokenClaims,
        req: ResponseBatchRequestV2,
    ) -> Result<ResponseBatchResponseV2, DurabilityV2Error> {
        validate_identifier(attempt_id, "attempt id", 64)?;
        validate_batch_shape(&req.lease_epoch, &req.control_epoch, &req.commands)?;

        let mut tx = self.pool.begin().await?;
        let mut attempt = self.lock_attempt(&mut tx, attempt_id).await?;
        self.validate_attempt_identity(&attempt, claims, true)?;
        self.validate_token_session(&mut tx, &attempt, claims)
            .await?;
        let exact_replay = !req.commands.is_empty()
            && self
                .batch_is_exact_replay(&mut tx, attempt_id, &req.commands)
                .await?;
        if exact_replay {
            // A duplicate write may be replayed after a terminal/control
            // boundary, but only by a still-authorized token at the current
            // lease. New commands must pass the current request epochs below.
            self.validate_claim_lease(&attempt, claims, attempt.lease_epoch.unwrap_or(1))?;
        } else {
            self.validate_request_epochs(&attempt, claims, req.lease_epoch, req.control_epoch)?;
        }
        self.ensure_active_session(&mut tx, &attempt, claims)
            .await?;

        // Even an empty batch is a live-runtime probe. This keeps its
        // writability result on the same locked database clock as non-empty
        // batches; only an exact replay may bypass the runtime gate.
        let runtime_scope = if !exact_replay {
            Some(
                self.lock_runtime_write_gate(&mut tx, &attempt.schedule_id)
                    .await?,
            )
        } else {
            None
        };
        let runtime_window = runtime_scope
            .as_ref()
            .map(|(runtime, section)| {
                ensure_runtime_response_writable(runtime.as_ref(), section.as_ref())
            })
            .transpose()?;
        let now = runtime_window
            .map(|window| window.server_now)
            .unwrap_or_else(Utc::now);
        if let Some(window) = runtime_window {
            // Runtime section timing is authoritative for V2. Use the locked
            // projection for all subsequent writability checks in this tx,
            // rather than trusting a stale attempt-level deadline.
            attempt.deadline_at = Some(window.deadline_at);
            attempt.closing_grace_until = Some(window.closing_grace_until);
        }
        if req.commands.is_empty() {
            ensure_attempt_writable(&attempt, now)?;
        }
        // `apply_commands_tx` checks writability only for new write ids. An
        // exact retry remains replayable after a terminal boundary, while a
        // genuinely new command is still fenced inside the same transaction.
        let applied = self
            .apply_commands_tx(
                &mut tx,
                &attempt,
                req.lease_epoch,
                req.control_epoch,
                &req.commands,
                now,
                runtime_scope.as_ref(),
            )
            .await?;
        tx.commit().await?;

        Ok(ResponseBatchResponseV2 {
            attempt_revision: applied.attempt_revision,
            server_time: now,
            acknowledgements: applied.acknowledgements,
        })
    }

    pub async fn submit_attempt_v2(
        &self,
        attempt_id: &str,
        claims: &AttemptTokenClaims,
        req: SubmitAttemptV2Request,
    ) -> Result<SubmitAttemptV2Response, DurabilityV2Error> {
        validate_identifier(&req.submission_id, "submission id", 64)?;
        validate_batch_shape(&req.lease_epoch, &req.control_epoch, &req.final_commands)?;
        if req.expected_attempt_revision < 0 {
            return Err(DurabilityV2Error::Validation(
                "expectedAttemptRevision cannot be negative".to_owned(),
            ));
        }
        let request_hash = canonical_json_hash(&req)?;

        let mut tx = self.pool.begin().await?;
        let mut attempt = self.lock_attempt(&mut tx, attempt_id).await?;
        self.validate_attempt_identity(&attempt, claims, true)?;
        self.validate_token_session(&mut tx, &attempt, claims)
            .await?;

        let existing_sub = sqlx::query_as::<_, AttemptSubmissionV2Row>(
            "SELECT * FROM attempt_submissions_v2 WHERE attempt_id = ? FOR UPDATE",
        )
        .bind(attempt_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(existing) = existing_sub {
            if existing.submission_id == req.submission_id && existing.request_hash == request_hash
            {
                // A receipt replay is terminal-safe, but it still requires the
                // current lease. A token from a superseded session must not be
                // usable merely because it knows the old submission id.
                self.validate_claim_lease(&attempt, claims, attempt.lease_epoch.unwrap_or(1))?;
                let receipt: SubmitAttemptV2Response = serde_json::from_value(existing.receipt)?;
                tx.commit().await?;
                return Ok(receipt);
            }
            return Err(structured(
                DurabilityErrorCode::IdempotencyKeyReused,
                "Attempt already has a different submission receipt",
                Some(serde_json::json!({
                    "existingSubmissionId": existing.submission_id,
                })),
            ));
        }

        // A submission id is globally idempotent, not only idempotent per attempt.
        let submission_owner: Option<String> = sqlx::query_scalar(
            "SELECT attempt_id FROM attempt_submissions_v2 WHERE submission_id = ? FOR UPDATE",
        )
        .bind(&req.submission_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(owner) = submission_owner {
            return Err(structured(
                DurabilityErrorCode::IdempotencyKeyReused,
                "submissionId is already bound to another attempt",
                Some(serde_json::json!({ "existingAttemptId": owner })),
            ));
        }

        self.validate_request_epochs(&attempt, claims, req.lease_epoch, req.control_epoch)?;
        self.ensure_active_session(&mut tx, &attempt, claims)
            .await?;
        let current_revision = attempt.response_revision.unwrap_or(0);
        if req.expected_attempt_revision != current_revision {
            return Err(structured(
                DurabilityErrorCode::VersionCollision,
                "Submission expected a different attempt revision",
                Some(serde_json::json!({
                    "expectedAttemptRevision": req.expected_attempt_revision,
                    "currentAttemptRevision": current_revision,
                })),
            ));
        }

        let runtime_scope = Some(
            self.lock_runtime_write_gate(&mut tx, &attempt.schedule_id)
                .await?,
        );
        let runtime_window = runtime_scope
            .as_ref()
            .map(|(runtime, section)| {
                ensure_runtime_response_writable(runtime.as_ref(), section.as_ref())
            })
            .transpose()?;
        let now = runtime_window
            .map(|window| window.server_now)
            .unwrap_or_else(Utc::now);
        if let Some(window) = runtime_window {
            attempt.deadline_at = Some(window.deadline_at);
            attempt.closing_grace_until = Some(window.closing_grace_until);
        }
        ensure_attempt_writable(&attempt, now)?;
        let applied = self
            .apply_commands_tx(
                &mut tx,
                &attempt,
                req.lease_epoch,
                req.control_epoch,
                &req.final_commands,
                now,
                runtime_scope.as_ref(),
            )
            .await?;

        #[derive(Debug, FromRow)]
        struct ProjectionHashRow {
            question_id: String,
            response_hash: String,
        }
        let responses = sqlx::query_as::<_, ProjectionHashRow>(
            "SELECT question_id, response_hash FROM attempt_responses_v2 WHERE attempt_id = ?",
        )
        .bind(attempt_id)
        .fetch_all(&mut *tx)
        .await?;
        let final_response_digest = final_response_digest(
            responses
                .iter()
                .map(|row| (row.question_id.as_str(), row.response_hash.as_str())),
        );
        let submitted_at = now;
        let attempt_revision = applied.attempt_revision;

        // IELTS has no provider scoring step after a durability receipt, so use
        // the shared terminalization writer. SAT is different: its response
        // receipt is only provisional until the provider scorer persists the
        // assessment result. In particular, do not set submitted_at for SAT
        // here; migration 0043's legacy projection trigger would otherwise
        // manufacture a terminalization before scoring can run.
        let provider_key: Option<String> =
            sqlx::query_scalar("SELECT provider_key FROM exam_entities WHERE id = ?")
                .bind(&attempt.exam_id)
                .fetch_optional(&mut *tx)
                .await?;
        if provider_key.as_deref() == Some("sat") {
            let changed = sqlx::query(
                "UPDATE student_attempts
                 SET delivery_status = 'submitted',
                     phase = 'post-exam',
                     response_revision = ?,
                     final_response_digest = ?,
                     revision = revision + 1,
                     control_epoch = control_epoch + 1,
                     updated_at = CURRENT_TIMESTAMP(6)
                 WHERE id = ? AND submitted_at IS NULL
                   AND final_submission IS NULL
                   AND COALESCE(delivery_status, 'running') NOT IN ('terminated', 'locked', 'cancelled')",
            )
            .bind(attempt_revision)
            .bind(&final_response_digest)
            .bind(attempt_id)
            .execute(&mut *tx)
            .await?;
            if changed.rows_affected() != 1 {
                return Err(structured(
                    DurabilityErrorCode::AttemptNotWritable,
                    "SAT response receipt could not claim the provisional attempt state",
                    None,
                ));
            }
        } else {
            seal_attempt_in_tx(
                &mut tx,
                &SealAttemptCommand {
                    attempt_id: attempt.id.clone(),
                    schedule_id: attempt.schedule_id.clone(),
                    outcome: "submitted",
                    reason: "student_submit".to_owned(),
                    actor_kind: TerminalizationActorKind::Student,
                    actor_id: Some(claims.user_id.clone()),
                    proctor_note: None,
                    request_id: Uuid::new_v4().to_string(),
                    min_answer_revision: None,
                    effective_at: Some(submitted_at),
                    final_submission: Some(serde_json::json!({
                        "submissionId": req.submission_id,
                        "providerKey": provider_key,
                        "finalResponseDigest": final_response_digest,
                        "protocolVersion": 2,
                    })),
                },
            )
            .await
            .map_err(|error| match error {
                DeliveryError::Database(error) => DurabilityV2Error::Database(error),
                DeliveryError::Conflict { message, .. }
                | DeliveryError::TerminalizationConflict { message, .. }
                | DeliveryError::Validation(message)
                | DeliveryError::Internal(message) => DurabilityV2Error::Validation(message),
                DeliveryError::NotFound => DurabilityV2Error::NotFound,
            })?;

            // seal_attempt owns submitted_at/final_submission and therefore
            // must run first. Updating the V2 digest afterwards cannot trigger
            // the legacy terminalization compatibility trigger (OLD.submitted_at
            // is already non-null).
            let digest_update = sqlx::query(
                "UPDATE student_attempts
                 SET response_revision = ?, final_response_digest = ?,
                     revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6)
                 WHERE id = ? AND schedule_id = ?",
            )
            .bind(attempt_revision)
            .bind(&final_response_digest)
            .bind(&attempt.id)
            .bind(&attempt.schedule_id)
            .execute(&mut *tx)
            .await?;
            if digest_update.rows_affected() != 1 {
                return Err(DurabilityV2Error::NotFound);
            }
        }

        let receipt_response = SubmitAttemptV2Response {
            attempt_id: attempt_id.to_owned(),
            submission_id: req.submission_id.clone(),
            status: "submitted".to_owned(),
            attempt_revision,
            final_response_digest: final_response_digest.clone(),
            submitted_at,
            acknowledgements: applied.acknowledgements,
        };
        let receipt_json = serde_json::to_value(&receipt_response)?;

        sqlx::query(
            "INSERT INTO attempt_submissions_v2 (
                attempt_id, submission_id, lease_epoch, control_epoch,
                request_hash, expected_attempt_revision, attempt_revision,
                final_response_digest, receipt, submitted_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(attempt_id)
        .bind(&req.submission_id)
        .bind(req.lease_epoch)
        .bind(req.control_epoch)
        .bind(&request_hash)
        .bind(req.expected_attempt_revision)
        .bind(attempt_revision)
        .bind(&final_response_digest)
        .bind(&receipt_json)
        .bind(submitted_at)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(receipt_response)
    }

    pub async fn takeover_lease(
        &self,
        attempt_id: &str,
        claims: &AttemptTokenClaims,
        req: TakeoverLeaseRequest,
    ) -> Result<TakeoverLeaseResponse, DurabilityV2Error> {
        validate_identifier(&attempt_id, "attempt id", 64)?;
        validate_identifier(&req.client_session_id, "client session id", 36)?;
        validate_identifier(&req.reason, "takeover reason", MAX_REASON_BYTES)?;

        let mut tx = self.pool.begin().await?;
        let attempt = self.lock_attempt(&mut tx, attempt_id).await?;
        self.validate_attempt_identity(&attempt, claims, true)?;
        self.validate_token_session(&mut tx, &attempt, claims)
            .await?;
        let attempt_lease = attempt.lease_epoch.unwrap_or(1);
        // Takeover is the explicit exception to the active-session fence: a
        // freshly issued, signed attempt credential for the same candidate may
        // request ownership after another tab/device has become stale. The
        // attempt/schedule/user/tenant binding was already verified above.
        ensure_attempt_not_terminal(&attempt, Utc::now())?;

        let current_session = attempt.active_client_session_id.as_deref();
        let new_lease_epoch = if current_session == Some(req.client_session_id.as_str()) {
            attempt_lease
        } else {
            attempt_lease
                .checked_add(1)
                .ok_or_else(|| DurabilityV2Error::Validation("lease epoch overflow".to_owned()))?
        };

        let expires_at = Utc::now() + Duration::minutes(self.config.attempt_token_ttl_minutes);
        let token_id = random_token(24);
        sqlx::query(
            "INSERT INTO attempt_sessions (
                id, user_id, schedule_id, attempt_id, client_session_id, token_id,
                device_fingerprint_hash, issued_at, last_seen_at, expires_at
             ) VALUES (?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6), ?)
             ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                schedule_id = VALUES(schedule_id),
                token_id = VALUES(token_id),
                issued_at = VALUES(issued_at),
                last_seen_at = VALUES(last_seen_at),
                expires_at = VALUES(expires_at),
                revoked_at = NULL,
                revocation_reason = NULL",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&claims.user_id)
        .bind(&attempt.schedule_id)
        .bind(&attempt.id)
        .bind(&req.client_session_id)
        .bind(&token_id)
        .bind(expires_at)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "UPDATE attempt_sessions
             SET revoked_at = CURRENT_TIMESTAMP(6),
                 revocation_reason = 'response_durability_lease_takeover'
             WHERE attempt_id = ? AND client_session_id <> ? AND revoked_at IS NULL",
        )
        .bind(&attempt.id)
        .bind(&req.client_session_id)
        .execute(&mut *tx)
        .await?;

        if new_lease_epoch != attempt_lease
            || current_session != Some(req.client_session_id.as_str())
        {
            let changed = sqlx::query(
                "UPDATE student_attempts
                 SET lease_epoch = ?, active_client_session_id = ?,
                    revision = revision + 1,
                    updated_at = CURRENT_TIMESTAMP(6)
                 WHERE id = ?",
            )
            .bind(new_lease_epoch)
            .bind(&req.client_session_id)
            .bind(attempt_id)
            .execute(&mut *tx)
            .await?;
            if changed.rows_affected() != 1 {
                return Err(DurabilityV2Error::NotFound);
            }
        }

        let new_claims = AttemptTokenClaims {
            token_id,
            user_id: claims.user_id.clone(),
            schedule_id: attempt.schedule_id.clone(),
            attempt_id: attempt.id.clone(),
            client_session_id: req.client_session_id.clone(),
            exp: expires_at,
            lease_epoch: Some(new_lease_epoch),
            organization_id: claims.organization_id.clone(),
        };
        let new_token = sign_attempt_token(&self.config, &new_claims);

        tx.commit().await?;
        Ok(TakeoverLeaseResponse {
            attempt_id: attempt_id.to_owned(),
            client_session_id: req.client_session_id,
            lease_epoch: new_lease_epoch,
            expires_at,
            token: new_token,
        })
    }

    /// Authorized snapshot used by the V2 HTTP route. The transaction gives recovery a
    /// self-consistent epoch/revision pair and prevents a snapshot racing a takeover/write.
    pub async fn get_responses_snapshot_authorized(
        &self,
        attempt_id: &str,
        claims: &AttemptTokenClaims,
    ) -> Result<ResponseSnapshotV2, DurabilityV2Error> {
        let mut tx = self.pool.begin().await?;
        let attempt = self.lock_attempt(&mut tx, attempt_id).await?;
        self.validate_attempt_identity(&attempt, claims, true)?;
        self.validate_token_session(&mut tx, &attempt, claims)
            .await?;
        self.validate_claim_lease(&attempt, claims, attempt.lease_epoch.unwrap_or(1))?;
        let rows = self.load_projection_rows(&mut tx, attempt_id).await?;
        let snapshot = ResponseSnapshotV2 {
            attempt_id: attempt.id.clone(),
            protocol_version: attempt.protocol_version.unwrap_or(1),
            delivery_status: attempt
                .delivery_status
                .clone()
                .unwrap_or_else(|| "running".to_owned()),
            lease_epoch: attempt.lease_epoch.unwrap_or(1),
            control_epoch: attempt.control_epoch.unwrap_or(1),
            attempt_revision: attempt.response_revision.unwrap_or(0),
            deadline_at: attempt.deadline_at,
            closing_grace_until: attempt.closing_grace_until,
            responses: projection_acknowledgements(rows),
        };
        tx.commit().await?;
        Ok(snapshot)
    }

    /// Kept for application-level callers that predate the authenticated HTTP snapshot method.
    /// HTTP handlers must use `get_responses_snapshot_authorized`.
    pub async fn get_responses_snapshot(
        &self,
        attempt_id: &str,
    ) -> Result<Vec<ResponseAcknowledgementV2>, DurabilityV2Error> {
        let rows = sqlx::query_as::<_, AttemptResponseV2Row>(
            "SELECT * FROM attempt_responses_v2 WHERE attempt_id = ? ORDER BY question_id ASC",
        )
        .bind(attempt_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(projection_acknowledgements(rows))
    }

    async fn lock_attempt(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt_id: &str,
    ) -> Result<AttemptV2Row, DurabilityV2Error> {
        sqlx::query_as::<_, AttemptV2Row>("SELECT * FROM student_attempts WHERE id = ? FOR UPDATE")
            .bind(attempt_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or(DurabilityV2Error::NotFound)
    }

    async fn validate_token_session(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt: &AttemptV2Row,
        claims: &AttemptTokenClaims,
    ) -> Result<(), DurabilityV2Error> {
        let session: Option<(
            String,
            String,
            String,
            String,
            DateTime<Utc>,
            Option<DateTime<Utc>>,
        )> = sqlx::query_as(
            "SELECT user_id, schedule_id, attempt_id, client_session_id, expires_at, revoked_at
                 FROM attempt_sessions WHERE token_id = ? FOR UPDATE",
        )
        .bind(&claims.token_id)
        .fetch_optional(&mut **tx)
        .await?;
        let Some((
            user_id,
            schedule_id,
            session_attempt_id,
            client_session_id,
            expires_at,
            revoked_at,
        )) = session
        else {
            return Err(DurabilityV2Error::Unauthorized(
                "Attempt credential session is not recognized".to_owned(),
            ));
        };
        if revoked_at.is_some()
            || expires_at <= Utc::now()
            || user_id != claims.user_id
            || schedule_id != attempt.schedule_id
            || session_attempt_id != attempt.id
            || client_session_id != claims.client_session_id
        {
            return Err(DurabilityV2Error::Unauthorized(
                "Attempt credential session is not authorized".to_owned(),
            ));
        }
        Ok(())
    }

    fn validate_attempt_identity(
        &self,
        attempt: &AttemptV2Row,
        claims: &AttemptTokenClaims,
        require_v2: bool,
    ) -> Result<(), DurabilityV2Error> {
        if claims.attempt_id != attempt.id {
            return Err(DurabilityV2Error::Unauthorized(
                "Attempt binding mismatch".to_owned(),
            ));
        }
        if claims.schedule_id != attempt.schedule_id {
            return Err(DurabilityV2Error::Unauthorized(
                "Schedule binding mismatch".to_owned(),
            ));
        }
        if attempt.organization_id.as_deref() != claims.organization_id.as_deref() {
            return Err(DurabilityV2Error::Unauthorized(
                "Tenant mismatch".to_owned(),
            ));
        }
        match attempt.user_id.as_deref() {
            Some(user_id) if user_id == claims.user_id => {}
            Some(_) => {
                return Err(DurabilityV2Error::Unauthorized(
                    "User is not the owner of this attempt".to_owned(),
                ));
            }
            None if require_v2 => {
                return Err(DurabilityV2Error::Unauthorized(
                    "Attempt owner binding is missing".to_owned(),
                ));
            }
            None => {}
        }
        validate_identifier(&claims.client_session_id, "client session id", 36)?;
        if require_v2 && attempt.protocol_version.unwrap_or(1) != 2 {
            return Err(structured(
                DurabilityErrorCode::ProtocolVersionUnsupported,
                "The attempt is not enabled for response durability protocol v2",
                Some(serde_json::json!({
                    "protocolVersion": attempt.protocol_version.unwrap_or(1),
                })),
            ));
        }
        Ok(())
    }

    fn validate_request_epochs(
        &self,
        attempt: &AttemptV2Row,
        claims: &AttemptTokenClaims,
        lease_epoch: i64,
        control_epoch: i64,
    ) -> Result<(), DurabilityV2Error> {
        if lease_epoch <= 0 || control_epoch <= 0 {
            return Err(DurabilityV2Error::Validation(
                "leaseEpoch and controlEpoch must be positive".to_owned(),
            ));
        }
        let current_lease = attempt.lease_epoch.unwrap_or(1);
        self.validate_claim_lease(attempt, claims, current_lease)?;
        if lease_epoch != current_lease {
            return Err(structured(
                DurabilityErrorCode::LeaseFenced,
                "Request lease epoch is fenced by a newer session",
                Some(serde_json::json!({
                    "requestLeaseEpoch": lease_epoch,
                    "currentLeaseEpoch": current_lease,
                })),
            ));
        }
        let current_control = attempt.control_epoch.unwrap_or(1);
        if control_epoch != current_control {
            return Err(structured(
                DurabilityErrorCode::ControlEpochStale,
                "Command crossed a pause/resume control boundary",
                Some(serde_json::json!({
                    "requestControlEpoch": control_epoch,
                    "currentControlEpoch": current_control,
                })),
            ));
        }
        Ok(())
    }

    fn validate_claim_lease(
        &self,
        attempt: &AttemptV2Row,
        claims: &AttemptTokenClaims,
        current_lease: i64,
    ) -> Result<(), DurabilityV2Error> {
        if claims.lease_epoch != Some(current_lease) {
            return Err(lease_fenced(current_lease, claims.lease_epoch));
        }
        if let Some(active) = attempt.active_client_session_id.as_deref() {
            if active != claims.client_session_id {
                return Err(lease_fenced(current_lease, claims.lease_epoch));
            }
        }
        Ok(())
    }

    async fn ensure_active_session(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt: &AttemptV2Row,
        claims: &AttemptTokenClaims,
    ) -> Result<(), DurabilityV2Error> {
        if let Some(active) = attempt.active_client_session_id.as_deref() {
            if active != claims.client_session_id {
                return Err(lease_fenced(
                    attempt.lease_epoch.unwrap_or(1),
                    claims.lease_epoch,
                ));
            }
            return Ok(());
        }

        let claimed = sqlx::query(
            "UPDATE student_attempts
             SET active_client_session_id = ?, updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1
             WHERE id = ? AND active_client_session_id IS NULL",
        )
        .bind(&claims.client_session_id)
        .bind(&attempt.id)
        .execute(&mut **tx)
        .await?;
        if claimed.rows_affected() != 1 {
            return Err(lease_fenced(
                attempt.lease_epoch.unwrap_or(1),
                claims.lease_epoch,
            ));
        }
        Ok(())
    }

    async fn lock_runtime_write_gate(
        &self,
        tx: &mut Transaction<'_, MySql>,
        schedule_id: &str,
    ) -> Result<RuntimeWriteScope, DurabilityV2Error> {
        // Student response writers lock attempt -> runtime -> active section.
        // Proctor schedule controls acquire the same order, so a transition
        // cannot race a response against a stale section clock.
        let runtime = sqlx::query_as::<_, RuntimeWriteGateRow>(
            "SELECT id, status, timing_model, active_section_key, waiting_for_next_section FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
        )
        .bind(schedule_id)
        .fetch_optional(&mut **tx)
        .await?;

        let section = match runtime
            .as_ref()
            .and_then(|runtime| runtime.active_section_key.as_deref())
        {
            Some(section_key) => {
                let runtime_id = runtime
                    .as_ref()
                    .expect("runtime exists when active section is present")
                    .id
                    .as_str();
                sqlx::query_as::<_, RuntimeSectionWriteGateRow>(
                    r#"
                    SELECT status, actual_start_at, paused_at,
                           planned_duration_minutes, extension_minutes,
                           accumulated_paused_seconds, UTC_TIMESTAMP(6) AS server_now
                    FROM exam_session_runtime_sections
                    WHERE runtime_id = ? AND section_key = ?
                    FOR UPDATE
                    "#,
                )
                .bind(runtime_id)
                .bind(section_key)
                .fetch_optional(&mut **tx)
                .await?
            }
            None => None,
        };

        Ok((runtime, section))
    }

    async fn apply_commands_tx(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt: &AttemptV2Row,
        lease_epoch: i64,
        control_epoch: i64,
        commands: &[ResponseCommandV2],
        now: DateTime<Utc>,
        runtime_scope: Option<&RuntimeWriteScope>,
    ) -> Result<AppliedCommands, DurabilityV2Error> {
        let mut revision = attempt.response_revision.unwrap_or(0);
        let mut changed = false;
        let mut changed_count: i64 = 0;
        let mut answers = attempt.answers.clone();
        let mut writing_answers = attempt.writing_answers.clone();
        let mut flags = attempt.flags.clone();
        let mut acknowledgements = Vec::with_capacity(commands.len());

        for command in commands {
            validate_command(command)?;
            let request_hash = canonical_command_hash(command)?;

            let existing_write = sqlx::query_as::<_, AttemptMutationV2Row>(
                "SELECT * FROM attempt_mutations_v2 WHERE attempt_id = ? AND client_write_id = ? FOR UPDATE",
            )
            .bind(&attempt.id)
            .bind(&command.write_id)
            .fetch_optional(&mut **tx)
            .await?;
            if let Some(existing) = existing_write {
                if existing.request_hash != request_hash {
                    return Err(structured(
                        DurabilityErrorCode::IdempotencyKeyReused,
                        "writeId was reused with a different command",
                        Some(serde_json::json!({ "writeId": command.write_id })),
                    ));
                }
                let canonical: ResponsePayload =
                    serde_json::from_value(existing.canonical_response).unwrap_or_default();
                acknowledgements.push(ResponseAcknowledgementV2 {
                    write_id: existing.client_write_id,
                    question_id: existing.question_id,
                    client_version: existing.client_version,
                    outcome: ResponseOutcome::Duplicate,
                    server_revision: existing.server_revision,
                    canonical_response: canonical,
                    content_hash: format!("sha256:{}", existing.response_hash),
                });
                continue;
            }

            ensure_attempt_writable(attempt, now)?;
            let ownership = self
                .resolve_question_ownership(tx, attempt, &command.question_id)
                .await?;
            ensure_question_in_active_runtime(runtime_scope, &ownership)?;
            let response_hash = canonical_response_hash(&command.response)?;

            let existing_version = sqlx::query_as::<_, AttemptMutationV2Row>(
                "SELECT * FROM attempt_mutations_v2
                 WHERE attempt_id = ? AND lease_epoch = ? AND question_id = ? AND client_version = ?
                 FOR UPDATE",
            )
            .bind(&attempt.id)
            .bind(lease_epoch)
            .bind(&command.question_id)
            .bind(command.client_version)
            .fetch_optional(&mut **tx)
            .await?;
            if let Some(existing) = existing_version {
                return Err(structured(
                    DurabilityErrorCode::VersionCollision,
                    "Logical client version is already bound to another write",
                    Some(serde_json::json!({
                        "questionId": command.question_id,
                        "clientVersion": command.client_version,
                        "existingWriteId": existing.client_write_id,
                    })),
                ));
            }

            let current_projection = sqlx::query_as::<_, AttemptResponseV2Row>(
                "SELECT * FROM attempt_responses_v2
                 WHERE attempt_id = ? AND question_id = ? FOR UPDATE",
            )
            .bind(&attempt.id)
            .bind(&command.question_id)
            .fetch_optional(&mut **tx)
            .await?;

            let (outcome, canonical_response, server_revision, content_hash) =
                match current_projection {
                    Some(current) => {
                        let incoming_is_newer = lease_epoch > current.lease_epoch
                            || (lease_epoch == current.lease_epoch
                                && command.client_version > current.client_version);
                        match incoming_is_newer.cmp(&true) {
                            Ordering::Equal => {
                                revision = revision.checked_add(1).ok_or_else(|| {
                                    DurabilityV2Error::Validation(
                                        "attempt revision overflow".to_owned(),
                                    )
                                })?;
                                changed = true;
                                changed_count = changed_count.checked_add(1).ok_or_else(|| {
                                    DurabilityV2Error::Validation(
                                        "answer revision overflow".to_owned(),
                                    )
                                })?;
                                apply_projection_value(
                                    &mut answers,
                                    &mut writing_answers,
                                    &ownership.module_id,
                                    &command.question_id,
                                    command.response.answer.clone(),
                                );
                                set_json_object_value(
                                    &mut flags,
                                    &command.question_id,
                                    Value::Bool(command.response.marked_for_review),
                                );
                                (
                                    ResponseOutcome::Applied,
                                    command.response.clone(),
                                    revision,
                                    format!("sha256:{response_hash}"),
                                )
                            }
                            Ordering::Less => {
                                let canonical: ResponsePayload =
                                    serde_json::from_value(current.response).unwrap_or_default();
                                (
                                    ResponseOutcome::Superseded,
                                    canonical,
                                    current.server_revision,
                                    format!("sha256:{}", current.response_hash),
                                )
                            }
                            Ordering::Greater => unreachable!("boolean comparison is total"),
                        }
                    }
                    None => {
                        revision = revision.checked_add(1).ok_or_else(|| {
                            DurabilityV2Error::Validation("attempt revision overflow".to_owned())
                        })?;
                        changed = true;
                        changed_count = changed_count.checked_add(1).ok_or_else(|| {
                            DurabilityV2Error::Validation("answer revision overflow".to_owned())
                        })?;
                        apply_projection_value(
                            &mut answers,
                            &mut writing_answers,
                            &ownership.module_id,
                            &command.question_id,
                            command.response.answer.clone(),
                        );
                        set_json_object_value(
                            &mut flags,
                            &command.question_id,
                            Value::Bool(command.response.marked_for_review),
                        );
                        (
                            ResponseOutcome::Applied,
                            command.response.clone(),
                            revision,
                            format!("sha256:{response_hash}"),
                        )
                    }
                };

            if outcome == ResponseOutcome::Applied {
                sqlx::query(
                    "INSERT INTO attempt_responses_v2 (
                        attempt_id, question_id, module_id, lease_epoch, control_epoch,
                        client_version, client_write_id, request_hash, response,
                        response_hash, server_revision, updated_at
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))
                     ON DUPLICATE KEY UPDATE
                        module_id = VALUES(module_id),
                        lease_epoch = VALUES(lease_epoch),
                        control_epoch = VALUES(control_epoch),
                        client_version = VALUES(client_version),
                        client_write_id = VALUES(client_write_id),
                        request_hash = VALUES(request_hash),
                        response = VALUES(response),
                        response_hash = VALUES(response_hash),
                        server_revision = VALUES(server_revision),
                        updated_at = CURRENT_TIMESTAMP(6)",
                )
                .bind(&attempt.id)
                .bind(&command.question_id)
                .bind(&ownership.module_id)
                .bind(lease_epoch)
                .bind(control_epoch)
                .bind(command.client_version)
                .bind(&command.write_id)
                .bind(&request_hash)
                .bind(serde_json::to_value(&command.response)?)
                .bind(&response_hash)
                .bind(server_revision)
                .execute(&mut **tx)
                .await?;
                self.mirror_legacy_sat_response_tx(tx, attempt, &ownership, command, now)
                    .await?;
            }

            let mutation_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO attempt_mutations_v2 (
                    id, attempt_id, client_write_id, lease_epoch, control_epoch,
                    question_id, client_version, request_hash, response_hash,
                    outcome, server_revision, canonical_response, created_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&mutation_id)
            .bind(&attempt.id)
            .bind(&command.write_id)
            .bind(lease_epoch)
            .bind(control_epoch)
            .bind(&command.question_id)
            .bind(command.client_version)
            .bind(&request_hash)
            .bind(&response_hash)
            .bind(outcome.as_str())
            .bind(server_revision)
            .bind(serde_json::to_value(&canonical_response)?)
            .bind(now)
            .execute(&mut **tx)
            .await?;

            acknowledgements.push(ResponseAcknowledgementV2 {
                write_id: command.write_id.clone(),
                question_id: command.question_id.clone(),
                client_version: command.client_version,
                outcome,
                server_revision,
                canonical_response,
                content_hash,
            });
        }

        if changed {
            sqlx::query(
                "UPDATE student_attempts
                 SET response_revision = ?,
                     answer_revision = answer_revision + ?,
                     answers = ?, writing_answers = ?, flags = ?,
                     revision = revision + 1,
                     updated_at = CURRENT_TIMESTAMP(6)
                 WHERE id = ?",
            )
            .bind(revision)
            .bind(changed_count)
            .bind(answers)
            .bind(writing_answers)
            .bind(flags)
            .bind(&attempt.id)
            .execute(&mut **tx)
            .await?;
        }

        Ok(AppliedCommands {
            acknowledgements,
            attempt_revision: revision,
        })
    }

    async fn mirror_legacy_sat_response_tx(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt: &AttemptV2Row,
        ownership: &QuestionOwnership,
        command: &ResponseCommandV2,
        _now: DateTime<Utc>,
    ) -> Result<(), DurabilityV2Error> {
        let Some(exam_question_id) = ownership.legacy_exam_question_id.as_deref() else {
            return Ok(());
        };
        let module_attempt_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? FOR UPDATE",
        )
        .bind(&attempt.id)
        .bind(&ownership.module_id)
        .fetch_optional(&mut **tx)
        .await?;
        let Some(module_attempt_id) = module_attempt_id else {
            return Ok(());
        };

        let existing_response_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM assessment_question_responses
             WHERE module_attempt_id = ? AND exam_question_id = ? FOR UPDATE",
        )
        .bind(&module_attempt_id)
        .bind(exam_question_id)
        .fetch_optional(&mut **tx)
        .await?;
        let answer = if command.response.answer.is_null() {
            None
        } else {
            Some(command.response.answer.clone())
        };
        let eliminated_options = serde_json::to_value(&command.response.eliminated_options)?;
        let annotations = serde_json::to_value(&command.response.annotations)?;

        if let Some(response_id) = existing_response_id {
            sqlx::query(
                "UPDATE assessment_question_responses
                 SET response = ?, marked_for_review = ?, eliminated_options = ?, annotations = ?,
                     client_write_id = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6)
                 WHERE id = ?",
            )
            .bind(answer)
            .bind(command.response.marked_for_review)
            .bind(eliminated_options)
            .bind(annotations)
            .bind(&command.write_id)
            .bind(response_id)
            .execute(&mut **tx)
            .await?;
        } else {
            sqlx::query(
                "INSERT INTO assessment_question_responses
                 (id, module_attempt_id, exam_question_id, response, marked_for_review,
                  eliminated_options, annotations, client_write_id, revision)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&module_attempt_id)
            .bind(exam_question_id)
            .bind(answer)
            .bind(command.response.marked_for_review)
            .bind(eliminated_options)
            .bind(annotations)
            .bind(&command.write_id)
            .execute(&mut **tx)
            .await?;
        }
        Ok(())
    }

    async fn resolve_question_ownership(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt: &AttemptV2Row,
        question_id: &str,
    ) -> Result<QuestionOwnership, DurabilityV2Error> {
        let assessment_question = sqlx::query_as::<_, QuestionOwnershipRow>(
            "SELECT eq.id AS exam_question_id, eq.question_id, eq.module_id,
                    s.section_key, m.adaptive_role, ma.state AS module_state
             FROM assessment_exam_questions eq
             JOIN assessment_modules m ON m.id = eq.module_id
             JOIN assessment_sections s ON s.id = m.section_id
             JOIN assessment_module_attempts ma ON ma.module_id = eq.module_id
                                                AND ma.attempt_id = ?
             WHERE (eq.id = ? OR eq.question_id = ? OR ? LIKE CONCAT(eq.question_id, ':%'))
             ORDER BY CASE WHEN eq.id = ? OR eq.question_id = ? THEN 0 ELSE 1 END
             LIMIT 1",
        )
        .bind(&attempt.id)
        .bind(question_id)
        .bind(question_id)
        .bind(question_id)
        .bind(question_id)
        .bind(question_id)
        .fetch_optional(&mut **tx)
        .await?;

        if let Some(row) = assessment_question {
            let _ = &row.question_id;
            return Ok(QuestionOwnership {
                module_id: row.module_id,
                section_key: Some(row.section_key),
                adaptive_role: Some(row.adaptive_role),
                module_state: Some(row.module_state),
                legacy_exam_question_id: Some(row.exam_question_id),
            });
        }

        // IELTS legacy content is embedded in the immutable published version
        // snapshot. The config snapshot contains the writing task catalogue,
        // while the content snapshot contains objective question bodies; both
        // are part of the published version contract and must be searched.
        let snapshots: Option<(Value, Value)> = sqlx::query_as(
            "SELECT content_snapshot, config_snapshot FROM exam_versions WHERE id = ?",
        )
        .bind(&attempt.published_version_id)
        .fetch_optional(&mut **tx)
        .await?;
        if let Some((content_snapshot, config_snapshot)) = snapshots {
            for (snapshot, fallback_module) in [(&content_snapshot, None), (&config_snapshot, None)]
            {
                if let Some(module_id) =
                    find_question_module(snapshot, question_id, fallback_module)
                {
                    return Ok(QuestionOwnership {
                        section_key: legacy_module_section_key(&module_id),
                        module_id,
                        adaptive_role: None,
                        module_state: None,
                        legacy_exam_question_id: None,
                    });
                }
            }
        }

        Err(structured(
            DurabilityErrorCode::QuestionNotInAttempt,
            "Question is not part of the published attempt",
            Some(serde_json::json!({ "questionId": question_id })),
        ))
    }

    async fn batch_is_exact_replay(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt_id: &str,
        commands: &[ResponseCommandV2],
    ) -> Result<bool, DurabilityV2Error> {
        for command in commands {
            let request_hash = canonical_command_hash(command)?;
            let existing: Option<(String,)> = sqlx::query_as(
                "SELECT request_hash FROM attempt_mutations_v2
                 WHERE attempt_id = ? AND client_write_id = ? FOR UPDATE",
            )
            .bind(attempt_id)
            .bind(&command.write_id)
            .fetch_optional(&mut **tx)
            .await?;
            let Some((existing_hash,)) = existing else {
                return Ok(false);
            };
            if existing_hash != request_hash {
                return Err(structured(
                    DurabilityErrorCode::IdempotencyKeyReused,
                    "writeId was reused with a different command",
                    Some(serde_json::json!({ "writeId": command.write_id })),
                ));
            }
        }
        Ok(true)
    }

    async fn load_projection_rows(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt_id: &str,
    ) -> Result<Vec<AttemptResponseV2Row>, DurabilityV2Error> {
        Ok(sqlx::query_as::<_, AttemptResponseV2Row>(
            "SELECT * FROM attempt_responses_v2 WHERE attempt_id = ? ORDER BY question_id ASC",
        )
        .bind(attempt_id)
        .fetch_all(&mut **tx)
        .await?)
    }
}

fn set_json_object_value(document: &mut Value, key: &str, value: Value) {
    if !document.is_object() {
        *document = Value::Object(Map::new());
    }
    if let Some(object) = document.as_object_mut() {
        object.insert(key.to_owned(), value);
    }
}

fn is_writing_module(module_id: &str) -> bool {
    let normalized = module_id.trim().to_ascii_lowercase();
    normalized == "writing" || normalized.contains("writing")
}

fn apply_projection_value(
    answers: &mut Value,
    writing_answers: &mut Value,
    module_id: &str,
    question_id: &str,
    value: Value,
) {
    if is_writing_module(module_id) {
        set_json_object_value(writing_answers, question_id, value);
    } else {
        set_json_object_value(answers, question_id, value);
    }
}

fn validate_batch_shape(
    lease_epoch: &i64,
    control_epoch: &i64,
    commands: &[ResponseCommandV2],
) -> Result<(), DurabilityV2Error> {
    if *lease_epoch <= 0 || *control_epoch <= 0 {
        return Err(DurabilityV2Error::Validation(
            "leaseEpoch and controlEpoch must be positive".to_owned(),
        ));
    }
    if commands.len() > MAX_BATCH_COMMANDS {
        return Err(DurabilityV2Error::Validation(format!(
            "a response batch cannot contain more than {MAX_BATCH_COMMANDS} commands"
        )));
    }
    for command in commands {
        validate_command(command)?;
    }
    Ok(())
}

fn validate_command(command: &ResponseCommandV2) -> Result<(), DurabilityV2Error> {
    validate_identifier(&command.write_id, "write id", MAX_WRITE_ID_BYTES)?;
    validate_identifier(&command.question_id, "question id", MAX_QUESTION_ID_BYTES)?;
    if command.client_version <= 0 {
        return Err(structured(
            DurabilityErrorCode::InvalidResponse,
            "clientVersion must be strictly positive",
            None,
        ));
    }
    validate_response_payload(&command.response)
        .map_err(|message| structured(DurabilityErrorCode::InvalidResponse, &message, None))
}

fn ensure_runtime_response_writable(
    runtime: Option<&RuntimeWriteGateRow>,
    section: Option<&RuntimeSectionWriteGateRow>,
) -> Result<RuntimeResponseWindow, DurabilityV2Error> {
    let Some(runtime) = runtime else {
        return Err(structured(
            DurabilityErrorCode::AttemptNotWritable,
            "The exam runtime has not started a response window",
            None,
        ));
    };
    if runtime.status != "live" {
        return Err(structured(
            DurabilityErrorCode::AttemptNotWritable,
            "The exam runtime is not live",
            Some(serde_json::json!({ "runtimeStatus": runtime.status })),
        ));
    }
    if runtime.waiting_for_next_section {
        return Err(structured(
            DurabilityErrorCode::AttemptNotWritable,
            "The exam is waiting for the next section",
            None,
        ));
    }
    if runtime.active_section_key.is_none() {
        return Err(structured(
            DurabilityErrorCode::AttemptNotWritable,
            "The exam runtime has no active section",
            None,
        ));
    }

    let Some(section) = section else {
        return Err(structured(
            DurabilityErrorCode::AttemptNotWritable,
            "The authoritative response section is missing",
            None,
        ));
    };
    if section.status != "live" || section.paused_at.is_some() {
        return Err(structured(
            DurabilityErrorCode::AttemptNotWritable,
            "The active response section is paused or closed",
            Some(serde_json::json!({ "sectionStatus": section.status })),
        ));
    }
    let Some(started_at) = section.actual_start_at else {
        return Err(structured(
            DurabilityErrorCode::AttemptNotWritable,
            "The active response section has not started",
            None,
        ));
    };

    let duration_seconds = i64::from(
        section
            .planned_duration_minutes
            .saturating_add(section.extension_minutes)
            .max(0),
    )
    .saturating_mul(60)
    .saturating_add(i64::from(section.accumulated_paused_seconds.max(0)));
    let deadline_at = started_at + Duration::seconds(duration_seconds);
    let closing_grace_until = deadline_at + Duration::seconds(RESPONSE_CLOSING_GRACE_SECONDS);
    if section.server_now > closing_grace_until {
        return Err(structured(
            DurabilityErrorCode::AttemptNotWritable,
            "Attempt response deadline has passed",
            Some(serde_json::json!({
                "deadlineAt": deadline_at,
                "closingGraceUntil": closing_grace_until,
            })),
        ));
    }

    Ok(RuntimeResponseWindow {
        deadline_at,
        closing_grace_until,
        server_now: section.server_now,
    })
}

fn expected_runtime_stage_key(
    timing_model: &str,
    section_key: &str,
    adaptive_role: Option<&str>,
) -> Result<String, DurabilityV2Error> {
    if timing_model != "cohort_stage_v2" {
        return Ok(section_key.to_owned());
    }
    let suffix = match adaptive_role {
        Some("base") => "m1",
        Some("lower_branch" | "higher_branch") => "m2",
        Some(other) => {
            return Err(structured(
                DurabilityErrorCode::QuestionNotInAttempt,
                "Question module has no valid cohort timing stage",
                Some(serde_json::json!({ "adaptiveRole": other })),
            ));
        }
        None => {
            return Err(structured(
                DurabilityErrorCode::QuestionNotInAttempt,
                "Question module has no cohort timing identity",
                None,
            ));
        }
    };
    Ok(format!("{section_key}:{suffix}"))
}

fn ensure_question_in_active_runtime(
    runtime_scope: Option<&RuntimeWriteScope>,
    ownership: &QuestionOwnership,
) -> Result<(), DurabilityV2Error> {
    let Some((Some(runtime), Some(_section))) = runtime_scope else {
        return Err(structured(
            DurabilityErrorCode::AttemptNotWritable,
            "The question is outside the active response window",
            None,
        ));
    };

    if let Some(module_state) = ownership.module_state.as_deref() {
        if !matches!(module_state, "active" | "review") {
            return Err(structured(
                DurabilityErrorCode::AttemptNotWritable,
                "The question's module is not active",
                Some(serde_json::json!({ "moduleState": module_state })),
            ));
        }
    }

    let Some(target_section) = ownership.section_key.as_deref() else {
        return Err(structured(
            DurabilityErrorCode::QuestionNotInAttempt,
            "Question section could not be resolved",
            Some(serde_json::json!({ "moduleId": ownership.module_id })),
        ));
    };
    let expected = expected_runtime_stage_key(
        &runtime.timing_model,
        target_section,
        ownership.adaptive_role.as_deref(),
    )?;
    if runtime.active_section_key.as_deref() != Some(expected.as_str()) {
        return Err(structured(
            DurabilityErrorCode::QuestionNotInAttempt,
            "Question does not belong to the active response section",
            Some(serde_json::json!({
                "activeSectionKey": runtime.active_section_key,
                "questionSectionKey": target_section,
                "expectedStageKey": expected,
            })),
        ));
    }
    Ok(())
}

fn legacy_module_section_key(module_id: &str) -> Option<String> {
    match module_id.trim().to_ascii_lowercase().as_str() {
        "listening" | "reading" | "writing" | "speaking" => {
            Some(module_id.trim().to_ascii_lowercase())
        }
        _ => None,
    }
}

fn ensure_attempt_writable(
    attempt: &AttemptV2Row,
    now: DateTime<Utc>,
) -> Result<(), DurabilityV2Error> {
    let status = attempt.delivery_status.as_deref().unwrap_or("running");
    if matches!(
        status,
        "submitted" | "terminated" | "paused" | "locked" | "cancelled"
    ) || attempt.submitted_at.is_some()
        || attempt.phase == "post-exam"
        || attempt.proctor_status.as_deref() == Some("terminated")
    {
        return Err(structured(
            DurabilityErrorCode::AttemptNotWritable,
            "Attempt is closed or paused and does not accept new responses",
            Some(serde_json::json!({ "deliveryStatus": status })),
        ));
    }

    if let Some(deadline) = attempt.deadline_at {
        let grace_until = attempt.closing_grace_until.unwrap_or(deadline);
        if now > grace_until {
            return Err(structured(
                DurabilityErrorCode::AttemptNotWritable,
                "Attempt response deadline has passed",
                Some(serde_json::json!({
                    "deadlineAt": deadline,
                    "closingGraceUntil": grace_until,
                })),
            ));
        }
    }
    Ok(())
}

fn ensure_attempt_not_terminal(
    attempt: &AttemptV2Row,
    now: DateTime<Utc>,
) -> Result<(), DurabilityV2Error> {
    if attempt.submitted_at.is_some()
        || matches!(
            attempt.delivery_status.as_deref(),
            Some("submitted" | "terminated" | "locked" | "cancelled")
        )
        || attempt.phase == "post-exam"
        || attempt.proctor_status.as_deref() == Some("terminated")
    {
        return Err(structured(
            DurabilityErrorCode::AttemptNotWritable,
            "Attempt cannot be taken over after terminalization",
            None,
        ));
    }
    if let Some(deadline) = attempt.deadline_at {
        let grace_until = attempt.closing_grace_until.unwrap_or(deadline);
        if now > grace_until {
            return Err(structured(
                DurabilityErrorCode::AttemptNotWritable,
                "Attempt cannot be taken over after its closing grace period",
                None,
            ));
        }
    }
    Ok(())
}

fn structured(
    code: DurabilityErrorCode,
    message: &str,
    details: Option<Value>,
) -> DurabilityV2Error {
    DurabilityV2Error::StructuredConflict {
        code,
        message: message.to_owned(),
        details,
    }
}

fn lease_fenced(current_lease: i64, token_lease: Option<i64>) -> DurabilityV2Error {
    structured(
        DurabilityErrorCode::LeaseFenced,
        "Session credential lease is fenced by a newer session",
        Some(serde_json::json!({
            "tokenLeaseEpoch": token_lease,
            "currentLeaseEpoch": current_lease,
        })),
    )
}

fn projection_acknowledgements(rows: Vec<AttemptResponseV2Row>) -> Vec<ResponseAcknowledgementV2> {
    rows.into_iter()
        .map(|row| ResponseAcknowledgementV2 {
            write_id: row.client_write_id,
            question_id: row.question_id,
            client_version: row.client_version,
            outcome: ResponseOutcome::Applied,
            server_revision: row.server_revision,
            canonical_response: serde_json::from_value(row.response).unwrap_or_default(),
            content_hash: format!("sha256:{}", row.response_hash),
        })
        .collect()
}

fn target_id_matches(candidate: Option<&str>, requested: &str) -> bool {
    candidate.is_some_and(|value| {
        value == requested
            || requested
                .strip_prefix(value)
                .is_some_and(|suffix| suffix.starts_with(':'))
    })
}

fn find_question_module(
    value: &Value,
    requested_question_id: &str,
    module_hint: Option<&str>,
) -> Option<String> {
    match value {
        Value::Array(items) => items
            .iter()
            .find_map(|item| find_question_module(item, requested_question_id, module_hint)),
        Value::Object(object) => {
            let object_id = object.get("id").and_then(Value::as_str);
            let explicit_question_id = object
                .get("questionId")
                .or_else(|| object.get("examQuestionId"))
                .and_then(Value::as_str);
            let task_id = object.get("taskId").and_then(Value::as_str);
            let explicit_module = object
                .get("moduleId")
                .or_else(|| object.get("moduleKey"))
                .or_else(|| object.get("sectionKey"))
                .and_then(Value::as_str);
            let next_hint = explicit_module.or(module_hint);
            let resolved_module = next_hint.unwrap_or("legacy-module");

            // Writing tasks use taskId in content and id in configuration.
            // Question objects use id, questionId, or examQuestionId. Avoid
            // treating arbitrary container ids as deliverable targets by only
            // matching `id` on objects that look like a question/task.
            let looks_like_target = object.contains_key("type")
                || object.contains_key("stem")
                || object.contains_key("prompt")
                || object.contains_key("options")
                || object.contains_key("blanks")
                || object.contains_key("taskId")
                || object.contains_key("questionId")
                || object.contains_key("examQuestionId");
            if target_id_matches(explicit_question_id, requested_question_id)
                || target_id_matches(task_id, requested_question_id)
                || (looks_like_target && target_id_matches(object_id, requested_question_id))
            {
                return Some(resolved_module.to_owned());
            }

            if let Some(questions) = object.get("questions").and_then(Value::as_array) {
                for question in questions {
                    if let Some(question_object) = question.as_object() {
                        let matches = ["id", "questionId", "examQuestionId"]
                            .iter()
                            .map(|key| question_object.get(*key).and_then(Value::as_str))
                            .any(|value| target_id_matches(value, requested_question_id));
                        if matches {
                            return Some(resolved_module.to_owned());
                        }
                    }
                }
            }

            // Root section names are not represented as fields on their child
            // objects, so explicitly carry them as module identity while
            // descending through content/config snapshots.
            for section in ["listening", "reading", "writing", "speaking"] {
                if let Some(child) = object.get(section) {
                    if let Some(module) =
                        find_question_module(child, requested_question_id, Some(section))
                    {
                        return Some(module);
                    }
                }
            }

            object.iter().find_map(|(key, child)| {
                let child_hint =
                    if ["listening", "reading", "writing", "speaking"].contains(&key.as_str()) {
                        Some(key.as_str())
                    } else {
                        next_hint
                    };
                find_question_module(child, requested_question_id, child_hint)
            })
        }
        _ => None,
    }
}

#[allow(dead_code)]
fn deserialize_or_default<T: DeserializeOwned>(value: Value) -> T
where
    T: Default,
{
    serde_json::from_value(value).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime(status: &str, active_section_key: Option<&str>) -> RuntimeWriteGateRow {
        RuntimeWriteGateRow {
            id: "runtime-1".to_owned(),
            status: status.to_owned(),
            timing_model: "legacy_section_v1".to_owned(),
            active_section_key: active_section_key.map(ToOwned::to_owned),
            waiting_for_next_section: false,
        }
    }

    fn section(server_now: DateTime<Utc>) -> RuntimeSectionWriteGateRow {
        RuntimeSectionWriteGateRow {
            status: "live".to_owned(),
            actual_start_at: Some(server_now - Duration::minutes(5)),
            paused_at: None,
            planned_duration_minutes: 10,
            extension_minutes: 0,
            accumulated_paused_seconds: 0,
            server_now,
        }
    }

    #[test]
    fn runtime_response_window_requires_live_active_section() {
        let now = Utc::now();
        let live_section = section(now);

        for (status, active_section_key) in [
            ("not_started", Some("reading")),
            ("paused", Some("reading")),
            ("live", None),
        ] {
            let error = ensure_runtime_response_writable(
                Some(&runtime(status, active_section_key)),
                Some(&live_section),
            )
            .unwrap_err();
            assert!(matches!(
                error,
                DurabilityV2Error::StructuredConflict {
                    code: DurabilityErrorCode::AttemptNotWritable,
                    ..
                }
            ));
        }
    }

    #[test]
    fn runtime_response_window_allows_only_the_authoritative_grace_period() {
        let deadline = Utc::now();
        let mut response_section = section(deadline);
        response_section.actual_start_at = Some(deadline - Duration::minutes(10));
        response_section.server_now = deadline + Duration::seconds(RESPONSE_CLOSING_GRACE_SECONDS);
        let window = ensure_runtime_response_writable(
            Some(&runtime("live", Some("reading"))),
            Some(&response_section),
        )
        .expect("the grace boundary is inclusive");
        assert_eq!(window.closing_grace_until, response_section.server_now);

        response_section.server_now += Duration::microseconds(1);
        let error = ensure_runtime_response_writable(
            Some(&runtime("live", Some("reading"))),
            Some(&response_section),
        )
        .unwrap_err();
        assert!(matches!(
            error,
            DurabilityV2Error::StructuredConflict {
                code: DurabilityErrorCode::AttemptNotWritable,
                ..
            }
        ));
    }

    #[test]
    fn v2_question_ownership_must_match_active_section_and_module_state() {
        let live = runtime("live", Some("reading"));
        let live_section = section(Utc::now());
        let scope = (Some(live), Some(live_section));
        let ownership = QuestionOwnership {
            module_id: "reading".to_owned(),
            section_key: Some("reading".to_owned()),
            adaptive_role: None,
            module_state: Some("active".to_owned()),
            legacy_exam_question_id: None,
        };
        ensure_question_in_active_runtime(Some(&scope), &ownership)
            .expect("active question belongs to active section");

        let mut wrong_section = ownership.clone();
        wrong_section.section_key = Some("listening".to_owned());
        assert!(matches!(
            ensure_question_in_active_runtime(Some(&scope), &wrong_section),
            Err(DurabilityV2Error::StructuredConflict {
                code: DurabilityErrorCode::QuestionNotInAttempt,
                ..
            })
        ));

        let mut locked_module = ownership;
        locked_module.module_state = Some("locked".to_owned());
        assert!(matches!(
            ensure_question_in_active_runtime(Some(&scope), &locked_module),
            Err(DurabilityV2Error::StructuredConflict {
                code: DurabilityErrorCode::AttemptNotWritable,
                ..
            })
        ));
    }

    #[test]
    fn v2_cohort_stage_ownership_uses_the_module_stage_key() {
        assert_eq!(
            expected_runtime_stage_key("cohort_stage_v2", "reading-writing", Some("base")).unwrap(),
            "reading-writing:m1"
        );
        assert_eq!(
            expected_runtime_stage_key("cohort_stage_v2", "reading-writing", Some("higher_branch"))
                .unwrap(),
            "reading-writing:m2"
        );
    }
}
