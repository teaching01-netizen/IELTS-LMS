use chrono::{DateTime, Duration, Utc};
use ielts_backend_domain::assessment::{
    AnswerDefinition, AssessmentAttemptSnapshot, AssessmentDeliveryBootstrap,
    AssessmentDeliveryModule, AssessmentDeliverySection, AssessmentModuleAttemptSnapshot,
    AssessmentModuleStartRequest, AssessmentModuleSubmitRequest, AssessmentResponseRequest,
    AssessmentResponseSnapshot, AssessmentResult, AssessmentRoute, AssessmentSectionResult,
    AssessmentSubmitRequest, AssessmentTimingSnapshot, DeliveredAnswerDefinition,
    DeliveredQuestion, QuestionKind, ScoreKind,
};
use ielts_backend_domain::exam_provider::provider_for;
use serde_json::{json, Value};
use sqlx::{FromRow, MySql, MySqlPool, Transaction};
use std::collections::BTreeMap;
use thiserror::Error;
use uuid::Uuid;

use crate::adaptive_routing::{AdaptiveRoute, AdaptiveRoutingPolicy, PracticeThresholdRouting};
use crate::assessment_scoring::{score_section, total_score};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssessmentDeliveryConflictReason {
    ResponseRevisionMismatch,
    ModuleNotActive,
    ModuleMismatch,
    DeadlineExpired,
    RuntimeNotLive,
    RuntimePaused,
    AttemptProctorBlocked,
    TimeoutRecoveryClosed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SatRuntimeTimingGate {
    LegacyAttempt,
    CohortStageV2,
    CohortSectionV3,
}

impl SatRuntimeTimingGate {
    fn uses_personal_module_deadline(self) -> bool {
        !matches!(self, Self::CohortStageV2)
    }
}

impl AssessmentDeliveryConflictReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ResponseRevisionMismatch => "RESPONSE_REVISION_MISMATCH",
            Self::ModuleNotActive => "MODULE_NOT_ACTIVE",
            Self::ModuleMismatch => "MODULE_MISMATCH",
            Self::DeadlineExpired => "DEADLINE_EXPIRED",
            Self::RuntimeNotLive => "RUNTIME_NOT_LIVE",
            Self::RuntimePaused => "RUNTIME_PAUSED",
            Self::AttemptProctorBlocked => "ATTEMPT_PROCTOR_BLOCKED",
            Self::TimeoutRecoveryClosed => "TIMEOUT_RECOVERY_CLOSED",
        }
    }
}

#[derive(Debug, Error)]
pub enum AssessmentDeliveryError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("assessment delivery resource was not found")]
    NotFound,
    #[error("assessment delivery conflict: {0}")]
    Conflict(String),
    #[error("assessment delivery conflict ({reason:?}): {message}")]
    StructuredConflict {
        reason: AssessmentDeliveryConflictReason,
        message: String,
    },
    #[error("a newer student session owns this attempt")]
    ActiveSessionSuperseded,
    #[error("assessment delivery request is invalid: {0}")]
    Validation(String),
    #[error("assessment provider is not supported")]
    UnsupportedProvider,
    #[error("assessment data is invalid: {0}")]
    InvalidData(String),
}

#[derive(Debug, FromRow)]
struct ScheduleBindingRow {
    schedule_id: String,
    exam_id: String,
    provider_key: String,
    published_version_id: String,
}

#[derive(Debug, FromRow)]
struct SectionRow {
    id: String,
    section_key: String,
    title: String,
    display_order: i32,
    duration_seconds: i32,
    break_after_seconds: i32,
    instructions: Value,
}

#[derive(Debug, FromRow)]
struct ModuleRow {
    id: String,
    module_key: String,
    title: String,
    display_order: i32,
    duration_seconds: i32,
    target_question_count: i32,
    adaptive_role: String,
    instructions: Value,
    tool_policy: Value,
}

#[derive(Debug, FromRow)]
struct QuestionRow {
    exam_question_id: String,
    question_id: String,
    display_order: i32,
    is_pretest: bool,
    question_type: String,
    stimulus: Value,
    prompt: Value,
    answer_definition: Value,
    metadata: Value,
    accessibility: Value,
}

#[derive(Debug, FromRow)]
struct ModuleAttemptRow {
    id: String,
    module_id: String,
    state: String,
    allocated_seconds: i32,
    available_at: Option<DateTime<Utc>>,
    started_at: Option<DateTime<Utc>>,
    paused_at: Option<DateTime<Utc>>,
    accumulated_paused_seconds: i32,
    extension_seconds: i32,
    completion_reason: Option<String>,
    raw_correct: Option<i32>,
    operational_question_count: Option<i32>,
    tool_state: Value,
    revision: i32,
}

#[derive(Debug, FromRow)]
struct ResponseRow {
    id: String,
    module_attempt_id: String,
    exam_question_id: String,
    response: Option<Value>,
    marked_for_review: bool,
    eliminated_options: Value,
    annotations: Value,
    revision: i32,
}

#[derive(Debug, FromRow)]
struct ActiveModuleRow {
    id: String,
    module_id: String,
    state: String,
    allocated_seconds: i32,
    available_at: Option<DateTime<Utc>>,
    started_at: Option<DateTime<Utc>>,
    paused_at: Option<DateTime<Utc>>,
    accumulated_paused_seconds: i32,
    extension_seconds: i32,
    completion_reason: Option<String>,
}

#[derive(Debug, FromRow)]
struct ScoringRow {
    is_pretest: bool,
    answer_definition: Value,
    response: Option<Value>,
}

#[derive(Debug, FromRow)]
struct NextModuleRow {
    id: String,
    section_id: String,
    section_key: String,
    module_key: String,
    duration_seconds: i32,
    adaptive_role: String,
    tool_policy: Value,
}

#[derive(Debug, FromRow)]
struct AttemptControlRow {
    candidate_name: String,
    proctor_status: String,
    proctor_note: Option<String>,
    device_fingerprint_hash: Option<String>,
}

#[derive(Debug, FromRow)]
struct RuntimeTimingProjectionRow {
    runtime_status: String,
    timing_model: String,
    current_stage_key: Option<String>,
    runtime_revision: i32,
    stage_status: Option<String>,
    stage_actual_start_at: Option<DateTime<Utc>>,
    stage_paused_at: Option<DateTime<Utc>>,
    stage_planned_duration_minutes: Option<i32>,
    stage_extension_minutes: Option<i32>,
    stage_accumulated_paused_seconds: Option<i32>,
    server_now: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct RoutingPolicyRow {
    section_id: String,
    base_module_id: String,
    lower_module_id: String,
    higher_module_id: String,
    policy_key: String,
    policy_config: Value,
    revision: i32,
}

#[derive(Debug, Clone)]
pub struct SatTimeoutOutcome {
    pub schedule_id: String,
    pub attempt_id: String,
}

#[derive(Debug, FromRow)]
struct SubmissionAttemptRow {
    id: String,
    schedule_id: String,
    exam_id: String,
    published_version_id: String,
    candidate_id: String,
    candidate_name: String,
    candidate_email: String,
    cohort_name: String,
}

#[derive(Debug, FromRow)]
struct ScoreModuleRow {
    section_key: String,
    module_key: String,
    adaptive_role: String,
    state: String,
    raw_correct: Option<i32>,
    operational_question_count: Option<i32>,
    target_question_count: i32,
}

#[derive(Debug, FromRow)]
struct AssessmentResultRow {
    id: String,
    submission_id: String,
    provider_key: String,
    total_score: Option<i32>,
    score_payload: Value,
}

#[derive(Debug, FromRow)]
struct AssessmentSectionResultRow {
    section_key: String,
    route: Option<String>,
    raw_correct: i32,
    operational_question_count: i32,
    scaled_score: Option<i32>,
    details: Value,
}

#[derive(Debug, Default)]
struct SectionScoreAccumulator {
    raw_correct: i32,
    operational_question_count: i32,
    target_question_count: i32,
    route: Option<AssessmentRoute>,
    modules: Vec<Value>,
}

pub struct AssessmentDeliveryService {
    pool: MySqlPool,
}

impl AssessmentDeliveryService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn ensure_active_writer(
        &self,
        schedule_id: &str,
        attempt_id: &str,
        client_session_id: &str,
    ) -> Result<(), AssessmentDeliveryError> {
        let mut tx = self.pool.begin().await?;
        crate::delivery::claim_provider_attempt_writer_in_tx(
            &mut *tx,
            attempt_id,
            schedule_id,
            client_session_id,
        )
        .await?;

        let active_client_session_id: Option<Option<String>> = sqlx::query_scalar(
            "SELECT active_client_session_id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",
        )
        .bind(attempt_id)
        .bind(schedule_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(active_client_session_id) = active_client_session_id else {
            return Err(AssessmentDeliveryError::NotFound);
        };
        if active_client_session_id.as_deref() != Some(client_session_id) {
            return Err(AssessmentDeliveryError::ActiveSessionSuperseded);
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn bootstrap(
        &self,
        schedule_id: &str,
        attempt_id: &str,
    ) -> Result<AssessmentDeliveryBootstrap, AssessmentDeliveryError> {
        let binding = self.schedule_binding(schedule_id).await?;
        self.ensure_attempt_binding(&binding, attempt_id).await?;
        self.reconcile_attempt_timeout(schedule_id, attempt_id, Utc::now())
            .await?;
        let (sections, base_module) = self.load_assessment(&binding.published_version_id).await?;
        let existing: Vec<ModuleAttemptRow> = sqlx::query_as(
            "SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds, completion_reason, raw_correct, operational_question_count, tool_state, revision FROM assessment_module_attempts WHERE attempt_id = ? ORDER BY created_at, id",
        )
        .bind(attempt_id)
        .fetch_all(&self.pool)
        .await?;
        if existing.is_empty() {
            self.insert_module_attempt(attempt_id, &base_module, None)
                .await?;
        }
        self.bootstrap_payload(binding, attempt_id, sections).await
    }

    pub async fn start_module(
        &self,
        schedule_id: &str,
        attempt_id: &str,
        request: AssessmentModuleStartRequest,
    ) -> Result<AssessmentDeliveryBootstrap, AssessmentDeliveryError> {
        let binding = self.schedule_binding(schedule_id).await?;
        self.ensure_attempt_binding(&binding, attempt_id).await?;
        self.reconcile_attempt_timeout(schedule_id, attempt_id, Utc::now())
            .await?;
        let mut tx = self.pool.begin().await?;
        self.ensure_attempt_can_work_tx(&mut tx, schedule_id, attempt_id)
            .await?;
        let module = sqlx::query_as::<_, ActiveModuleRow>(
            "SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds, completion_reason FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? FOR UPDATE",
        )
        .bind(attempt_id)
        .bind(&request.module_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AssessmentDeliveryError::NotFound)?;
        let timing_gate = self
            .ensure_module_matches_runtime_stage_tx(&mut tx, schedule_id, &module.module_id, None)
            .await?;
        if module.state == "active" && module.started_at.is_some() {
            tx.commit().await?;
            let (sections, _) = self.load_assessment(&binding.published_version_id).await?;
            return self.bootstrap_payload(binding, attempt_id, sections).await;
        }
        if module.state != "not_started" {
            return Err(AssessmentDeliveryError::Conflict(
                "This SAT module cannot be started in its current state.".to_owned(),
            ));
        }
        let now: DateTime<Utc> = sqlx::query_scalar("SELECT UTC_TIMESTAMP(6)")
            .fetch_one(&mut *tx)
            .await?;
        if timing_gate.uses_personal_module_deadline()
            && module.available_at.is_some_and(|available| now < available)
        {
            return Err(AssessmentDeliveryError::Conflict(
                "This SAT module is not available until the scheduled break ends.".to_owned(),
            ));
        }
        let result = sqlx::query(
            "UPDATE assessment_module_attempts SET state = 'active', available_at = COALESCE(available_at, ?), started_at = ?, paused_at = NULL, revision = revision + 1 WHERE id = ? AND state = 'not_started'",
        )
        .bind(now)
        .bind(now)
        .bind(&module.id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            return Err(AssessmentDeliveryError::Conflict(
                "The SAT module was started by another request. Refresh and continue.".to_owned(),
            ));
        }
        // `student_attempts.current_module` remains the legacy IELTS compatibility field.
        // SAT position is authoritative in `assessment_module_attempts` and projected from there.
        let phase_rows =
            crate::delivery::mark_provider_attempt_exam_phase_in_tx(&mut *tx, attempt_id).await?;
        if phase_rows != 1 {
            return Err(AssessmentDeliveryError::NotFound);
        }
        tx.commit().await?;
        let (sections, _) = self.load_assessment(&binding.published_version_id).await?;
        self.bootstrap_payload(binding, attempt_id, sections).await
    }

    pub async fn save_response(
        &self,
        schedule_id: &str,
        attempt_id: &str,
        exam_question_id: &str,
        request: AssessmentResponseRequest,
    ) -> Result<AssessmentResponseSnapshot, AssessmentDeliveryError> {
        self.save_response_at(
            schedule_id,
            attempt_id,
            exam_question_id,
            Utc::now(),
            request,
        )
        .await
    }

    pub async fn save_response_at(
        &self,
        schedule_id: &str,
        attempt_id: &str,
        exam_question_id: &str,
        server_received_at: DateTime<Utc>,
        request: AssessmentResponseRequest,
    ) -> Result<AssessmentResponseSnapshot, AssessmentDeliveryError> {
        validate_assessment_response_request(&request)?;
        let binding = self.schedule_binding(schedule_id).await?;
        self.ensure_attempt_binding(&binding, attempt_id).await?;
        let mut tx = self.pool.begin().await?;
        self.ensure_attempt_can_work_tx(&mut tx, schedule_id, attempt_id)
            .await?;
        let active = sqlx::query_as::<_, ActiveModuleRow>(
            "SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds, completion_reason FROM assessment_module_attempts WHERE attempt_id = ? AND state IN ('active', 'review') ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        )
        .bind(attempt_id)
        .fetch_optional(&mut *tx)
        .await?;
        let (active, timeout_recovery) = if let Some(active) = active {
            if request
                .module_attempt_id
                .as_deref()
                .is_some_and(|id| id != active.id)
            {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::ModuleMismatch,
                    message: "Response module attempt does not match the active SAT module."
                        .to_owned(),
                });
            }
            (active, false)
        } else {
            let module_attempt_id = request.module_attempt_id.as_deref().ok_or_else(|| {
                AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::ModuleNotActive,
                    message: "There is no active SAT module.".to_owned(),
                }
            })?;
            let finalized = sqlx::query_as::<_, ActiveModuleRow>(
                "SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds, completion_reason FROM assessment_module_attempts WHERE id = ? AND attempt_id = ? FOR UPDATE",
            )
            .bind(module_attempt_id)
            .bind(attempt_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::ModuleMismatch,
                message: "Response module attempt does not belong to this SAT attempt."
                    .to_owned(),
            })?;
            if finalized.state != "locked"
                || finalized.completion_reason.as_deref() != Some("time_expired")
            {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::ModuleNotActive,
                    message: "The SAT module is finalized and does not accept responses."
                        .to_owned(),
                });
            }
            self.ensure_timeout_response_recovery_tx(
                &mut tx,
                schedule_id,
                attempt_id,
                &finalized,
                server_received_at,
                &request,
            )
            .await?;
            (finalized, true)
        };
        if !timeout_recovery {
            let timing_gate = self
                .ensure_module_matches_runtime_stage_tx(
                    &mut tx,
                    schedule_id,
                    &active.module_id,
                    Some(server_received_at),
                )
                .await?;
            if timing_gate.uses_personal_module_deadline() {
                ensure_module_response_admitted(&active, server_received_at)?;
            }
        }
        let belongs: Option<String> = sqlx::query_scalar(
            "SELECT id FROM assessment_exam_questions WHERE id = ? AND module_id = ?",
        )
        .bind(exam_question_id)
        .bind(&active.module_id)
        .fetch_optional(&mut *tx)
        .await?;
        if belongs.is_none() {
            return Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::ModuleMismatch,
                message: "Question does not belong to the active SAT module.".to_owned(),
            });
        }
        let existing = sqlx::query_as::<_, ResponseRow>(
            "SELECT id, module_attempt_id, exam_question_id, response, marked_for_review, eliminated_options, annotations, revision FROM assessment_question_responses WHERE module_attempt_id = ? AND exam_question_id = ? FOR UPDATE",
        )
        .bind(&active.id)
        .bind(exam_question_id)
        .fetch_optional(&mut *tx)
        .await?;
        let response_id = existing
            .as_ref()
            .map(|row| row.id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if let Some(existing_row) = existing.as_ref() {
            if response_row_matches_request(existing_row, &request)? {
                let snapshot = response_snapshot(existing.expect("existing response row"))?;
                if timeout_recovery {
                    self.repair_timeout_finalized_module_tx(&mut tx, attempt_id, &active)
                        .await?;
                }
                tx.commit().await?;
                return Ok(snapshot);
            }
        }
        let current_revision = existing.as_ref().map(|row| row.revision);
        match current_revision {
            Some(revision) if revision != request.revision => {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::ResponseRevisionMismatch,
                    message: "Question response revision is stale.".to_owned(),
                });
            }
            None if request.revision != 0 => {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::ResponseRevisionMismatch,
                    message: "Question response must start at revision zero.".to_owned(),
                });
            }
            _ => {}
        }
        let eliminated = json!(request.eliminated_options);
        if existing.is_some() {
            sqlx::query(
                "UPDATE assessment_question_responses SET response = ?, marked_for_review = ?, eliminated_options = ?, annotations = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND revision = ?",
            )
            .bind(request.response)
            .bind(request.marked_for_review)
            .bind(eliminated)
            .bind(request.annotations)
            .bind(&response_id)
            .bind(request.revision)
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query(
                "INSERT INTO assessment_question_responses (id, module_attempt_id, exam_question_id, response, marked_for_review, eliminated_options, annotations, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
            )
            .bind(&response_id)
            .bind(&active.id)
            .bind(exam_question_id)
            .bind(request.response)
            .bind(request.marked_for_review)
            .bind(eliminated)
            .bind(request.annotations)
            .execute(&mut *tx)
            .await?;
        }
        let row = sqlx::query_as::<_, ResponseRow>(
            "SELECT id, module_attempt_id, exam_question_id, response, marked_for_review, eliminated_options, annotations, revision FROM assessment_question_responses WHERE id = ?",
        )
        .bind(&response_id)
        .fetch_one(&mut *tx)
        .await?;
        if timeout_recovery {
            self.repair_timeout_finalized_module_tx(&mut tx, attempt_id, &active)
                .await?;
        }
        tx.commit().await?;
        response_snapshot(row)
    }

    pub async fn submit_module(
        &self,
        schedule_id: &str,
        attempt_id: &str,
        request: AssessmentModuleSubmitRequest,
    ) -> Result<AssessmentDeliveryBootstrap, AssessmentDeliveryError> {
        let binding = self.schedule_binding(schedule_id).await?;
        self.ensure_attempt_binding(&binding, attempt_id).await?;
        self.reconcile_attempt_timeout(schedule_id, attempt_id, Utc::now())
            .await?;
        let mut tx = self.pool.begin().await?;
        self.ensure_attempt_can_work_tx(&mut tx, schedule_id, attempt_id)
            .await?;
        let active = sqlx::query_as::<_, ActiveModuleRow>(
            "SELECT ma.id, ma.module_id, ma.state, ma.allocated_seconds, ma.available_at, ma.started_at, ma.paused_at, ma.accumulated_paused_seconds, ma.extension_seconds, ma.completion_reason FROM assessment_module_attempts ma WHERE ma.attempt_id = ? AND ma.module_id = ? FOR UPDATE",
        )
        .bind(attempt_id)
        .bind(&request.module_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AssessmentDeliveryError::NotFound)?;

        if matches!(active.state.as_str(), "submitted" | "locked") {
            tx.commit().await?;
            let (sections, _) = self.load_assessment(&binding.published_version_id).await?;
            return self.bootstrap_payload(binding, attempt_id, sections).await;
        }
        if !matches!(active.state.as_str(), "active" | "review") {
            return Err(AssessmentDeliveryError::Conflict(
                "This SAT module is not active.".to_owned(),
            ));
        }
        let timing_gate = self
            .ensure_module_matches_runtime_stage_tx(&mut tx, schedule_id, &active.module_id, None)
            .await?;
        if timing_gate.uses_personal_module_deadline() {
            ensure_module_workable(&active, Utc::now())?;
        }
        self.finalize_module_tx(&mut tx, attempt_id, &active, "student_submit")
            .await?;
        tx.commit().await?;
        let (sections, _) = self.load_assessment(&binding.published_version_id).await?;
        self.bootstrap_payload(binding, attempt_id, sections).await
    }

    pub async fn complete_assessment(
        &self,
        schedule_id: &str,
        attempt_id: &str,
        request: AssessmentSubmitRequest,
    ) -> Result<AssessmentResult, AssessmentDeliveryError> {
        let binding = self.schedule_binding(schedule_id).await?;
        self.ensure_attempt_binding(&binding, attempt_id).await?;
        let mut tx = self.pool.begin().await?;

        let existing_submission_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM student_submissions WHERE attempt_id = ? FOR UPDATE",
        )
        .bind(attempt_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(submission_id) = existing_submission_id.as_deref() {
            if let Some(result) = self.load_result_tx(&mut tx, submission_id).await? {
                tx.commit().await?;
                return Ok(result);
            }
        }

        let attempt = sqlx::query_as::<_, SubmissionAttemptRow>(
            "SELECT id, schedule_id, exam_id, published_version_id, candidate_id, candidate_name, candidate_email, cohort_name FROM student_attempts WHERE id = ? FOR UPDATE",
        )
        .bind(attempt_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AssessmentDeliveryError::NotFound)?;

        let module_rows = sqlx::query_as::<_, ScoreModuleRow>(
            "SELECT s.section_key, m.module_key, m.adaptive_role, ma.state, ma.raw_correct, ma.operational_question_count, m.target_question_count FROM assessment_module_attempts ma JOIN assessment_modules m ON m.id = ma.module_id JOIN assessment_sections s ON s.id = m.section_id WHERE ma.attempt_id = ? ORDER BY s.display_order, m.display_order",
        )
        .bind(attempt_id)
        .fetch_all(&mut *tx)
        .await?;
        if module_rows.is_empty() {
            return Err(AssessmentDeliveryError::Conflict(
                "The SAT attempt has no module submissions.".to_owned(),
            ));
        }
        if module_rows
            .iter()
            .any(|row| !matches!(row.state.as_str(), "submitted" | "locked"))
        {
            return Err(AssessmentDeliveryError::Conflict(
                "All SAT modules must be submitted before finalization.".to_owned(),
            ));
        }

        let scoring_policy: Value = sqlx::query_scalar(
            "SELECT policy_config FROM assessment_scoring_policies WHERE exam_version_id = ?",
        )
        .bind(&binding.published_version_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            AssessmentDeliveryError::Validation("SAT scoring policy is missing.".to_owned())
        })?;

        let mut aggregates: BTreeMap<String, SectionScoreAccumulator> = BTreeMap::new();
        for row in &module_rows {
            let aggregate = aggregates.entry(row.section_key.clone()).or_default();
            aggregate.raw_correct += row.raw_correct.unwrap_or_default();
            aggregate.operational_question_count +=
                row.operational_question_count.unwrap_or_default();
            aggregate.target_question_count = aggregate
                .target_question_count
                .max(row.target_question_count);
            if let Some(route) = route_from_adaptive_role(&row.adaptive_role) {
                if let Some(existing_route) = aggregate.route {
                    if existing_route != route {
                        return Err(AssessmentDeliveryError::InvalidData(
                            "Multiple adaptive branches were submitted for one SAT section."
                                .to_owned(),
                        ));
                    }
                } else {
                    aggregate.route = Some(route);
                }
            }
            aggregate.modules.push(json!({
                "moduleKey": row.module_key,
                "state": row.state,
                "rawCorrect": row.raw_correct,
                "operationalQuestionCount": row.operational_question_count,
            }));
        }

        let mut section_results = Vec::with_capacity(aggregates.len());
        for (section_key, aggregate) in aggregates {
            let max_raw = aggregate.target_question_count.max(1);
            let normalized_raw = if aggregate.operational_question_count > 0 {
                let numerator = i64::from(aggregate.raw_correct.max(0)) * i64::from(max_raw);
                let denominator = i64::from(aggregate.operational_question_count);
                i32::try_from((numerator + denominator / 2) / denominator)
                    .unwrap_or(max_raw)
                    .clamp(0, max_raw)
            } else {
                0
            };
            let route = aggregate.route.unwrap_or(AssessmentRoute::Lower);
            let adaptive_route = match route {
                AssessmentRoute::Lower => AdaptiveRoute::Lower,
                AssessmentRoute::Higher => AdaptiveRoute::Higher,
            };
            let scaled_score = score_section(
                &scoring_policy,
                &section_key,
                adaptive_route,
                normalized_raw,
            )
            .map_err(|error| AssessmentDeliveryError::InvalidData(error.to_string()))?;
            section_results.push(AssessmentSectionResult {
                section_key,
                route: aggregate.route,
                raw_correct: aggregate.raw_correct,
                operational_question_count: aggregate.operational_question_count,
                scaled_score,
                details: json!({
                    "normalizedRawCorrect": normalized_raw,
                    "modules": aggregate.modules,
                }),
            });
        }

        let reading_writing_score = section_results
            .iter()
            .find(|section| section.section_key == "reading-writing")
            .and_then(|section| section.scaled_score);
        let math_score = section_results
            .iter()
            .find(|section| section.section_key == "math")
            .and_then(|section| section.scaled_score);
        let total = total_score(reading_writing_score, math_score);
        let score_payload = json!({
            "providerKey": "sat",
            "scoreKind": "practice",
            "totalScore": total,
            "sections": section_results,
        });

        let submission_id =
            existing_submission_id.unwrap_or_else(|| request.submission_id.trim().to_owned());
        if submission_id.is_empty() || submission_id.len() > 36 {
            return Err(AssessmentDeliveryError::Validation(
                "submissionId must contain between one and 36 characters.".to_owned(),
            ));
        }
        let conflicting_attempt: Option<String> = sqlx::query_scalar(
            "SELECT attempt_id FROM student_submissions WHERE id = ? FOR UPDATE",
        )
        .bind(&submission_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(conflicting_attempt) = conflicting_attempt {
            if conflicting_attempt != attempt.id {
                return Err(AssessmentDeliveryError::Conflict(
                    "submissionId is already bound to another attempt.".to_owned(),
                ));
            }
        } else {
            sqlx::query(
                "INSERT INTO student_submissions (id, attempt_id, schedule_id, exam_id, published_version_id, provider_key, student_id, student_name, student_email, cohort_name, submitted_at, time_spent_seconds, grading_status, section_statuses) VALUES (?, ?, ?, ?, ?, 'sat', ?, ?, ?, ?, CURRENT_TIMESTAMP(6), 0, 'submitted', ?)",
            )
            .bind(&submission_id)
            .bind(&attempt.id)
            .bind(&attempt.schedule_id)
            .bind(&attempt.exam_id)
            .bind(&attempt.published_version_id)
            .bind(&attempt.candidate_id)
            .bind(&attempt.candidate_name)
            .bind(&attempt.candidate_email)
            .bind(&attempt.cohort_name)
            .bind(json!({
                "reading-writing": "auto_graded",
                "math": "auto_graded",
            }))
            .execute(&mut *tx)
            .await?;
        }

        let result_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO assessment_results (id, submission_id, provider_key, total_score, score_payload, release_status) VALUES (?, ?, 'sat', ?, ?, 'ready_to_release')",
        )
        .bind(&result_id)
        .bind(&submission_id)
        .bind(total)
        .bind(&score_payload)
        .execute(&mut *tx)
        .await?;
        let persisted_sections: Vec<AssessmentSectionResult> = serde_json::from_value(
            score_payload
                .get("sections")
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new())),
        )
        .map_err(|error| AssessmentDeliveryError::InvalidData(error.to_string()))?;
        for section in &persisted_sections {
            sqlx::query(
                "INSERT INTO assessment_section_results (id, assessment_result_id, section_key, route, raw_correct, operational_question_count, scaled_score, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&result_id)
            .bind(&section.section_key)
            .bind(section.route.map(|route| match route {
                AssessmentRoute::Lower => "lower",
                AssessmentRoute::Higher => "higher",
            }))
            .bind(section.raw_correct)
            .bind(section.operational_question_count)
            .bind(section.scaled_score)
            .bind(&section.details)
            .execute(&mut *tx)
            .await?;
        }

        let final_submission = json!({
            "submissionId": submission_id,
            "providerKey": "sat",
            "assessmentResultId": result_id,
            "submittedAt": Utc::now(),
        });
        let sealed_rows =
            crate::delivery::seal_provider_attempt_in_tx(&mut *tx, &attempt.id, &final_submission)
                .await?;
        if sealed_rows != 1 {
            return Err(AssessmentDeliveryError::NotFound);
        }
        tx.commit().await?;

        Ok(AssessmentResult {
            id: result_id,
            submission_id,
            provider_key: "sat".to_owned(),
            total_score: total,
            score_payload,
            score_kind: ScoreKind::Practice,
            sections: persisted_sections,
        })
    }

    async fn load_result_tx(
        &self,
        tx: &mut Transaction<'_, MySql>,
        submission_id: &str,
    ) -> Result<Option<AssessmentResult>, AssessmentDeliveryError> {
        let Some(result) = sqlx::query_as::<_, AssessmentResultRow>(
            "SELECT id, submission_id, provider_key, total_score, score_payload FROM assessment_results WHERE submission_id = ?",
        )
        .bind(submission_id)
        .fetch_optional(&mut **tx)
        .await?
        else {
            return Ok(None);
        };
        let sections = sqlx::query_as::<_, AssessmentSectionResultRow>(
            "SELECT section_key, route, raw_correct, operational_question_count, scaled_score, details FROM assessment_section_results WHERE assessment_result_id = ? ORDER BY section_key",
        )
        .bind(&result.id)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|section| AssessmentSectionResult {
            section_key: section.section_key,
            route: section.route.as_deref().and_then(parse_route),
            raw_correct: section.raw_correct,
            operational_question_count: section.operational_question_count,
            scaled_score: section.scaled_score,
            details: section.details,
        })
        .collect();
        Ok(Some(AssessmentResult {
            id: result.id,
            submission_id: result.submission_id,
            provider_key: result.provider_key,
            total_score: result.total_score,
            score_payload: result.score_payload,
            score_kind: ScoreKind::Practice,
            sections,
        }))
    }

    async fn load_result(
        &self,
        attempt_id: &str,
    ) -> Result<Option<AssessmentResult>, AssessmentDeliveryError> {
        let submission_id: Option<String> =
            sqlx::query_scalar("SELECT id FROM student_submissions WHERE attempt_id = ?")
                .bind(attempt_id)
                .fetch_optional(&self.pool)
                .await?;
        let Some(submission_id) = submission_id else {
            return Ok(None);
        };
        let mut tx = self.pool.begin().await?;
        let result = self.load_result_tx(&mut tx, &submission_id).await?;
        tx.commit().await?;
        Ok(result)
    }

    async fn schedule_binding(
        &self,
        schedule_id: &str,
    ) -> Result<ScheduleBindingRow, AssessmentDeliveryError> {
        sqlx::query_as::<_, ScheduleBindingRow>(
            "SELECT s.id AS schedule_id, s.exam_id, e.provider_key, s.published_version_id FROM exam_schedules s JOIN exam_entities e ON e.id = s.exam_id WHERE s.id = ?",
        )
        .bind(schedule_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AssessmentDeliveryError::NotFound)
    }

    async fn ensure_attempt_binding(
        &self,
        binding: &ScheduleBindingRow,
        attempt_id: &str,
    ) -> Result<(), AssessmentDeliveryError> {
        if binding.provider_key != "sat" {
            return Err(AssessmentDeliveryError::UnsupportedProvider);
        }
        if provider_for(&binding.provider_key).is_none() {
            return Err(AssessmentDeliveryError::UnsupportedProvider);
        }
        let attempt: Option<(String, String, String)> =
            sqlx::query_as("SELECT id, schedule_id, exam_id FROM student_attempts WHERE id = ?")
                .bind(attempt_id)
                .fetch_optional(&self.pool)
                .await?;
        let Some((id, schedule_id, exam_id)) = attempt else {
            return Err(AssessmentDeliveryError::NotFound);
        };
        if id != attempt_id || schedule_id != binding.schedule_id || exam_id != binding.exam_id {
            return Err(AssessmentDeliveryError::Validation(
                "Attempt does not belong to this SAT schedule.".to_owned(),
            ));
        }
        Ok(())
    }

    pub async fn preview_sections(
        &self,
        version_id: &str,
    ) -> Result<Vec<AssessmentDeliverySection>, AssessmentDeliveryError> {
        let (sections, _) = self.load_assessment_content(version_id).await?;
        Ok(sections)
    }

    async fn load_assessment(
        &self,
        version_id: &str,
    ) -> Result<(Vec<AssessmentDeliverySection>, NextModuleRow), AssessmentDeliveryError> {
        let (sections, first_base) = self.load_assessment_content(version_id).await?;
        Ok((
            sections,
            first_base.ok_or(AssessmentDeliveryError::NotFound)?,
        ))
    }

    async fn load_assessment_content(
        &self,
        version_id: &str,
    ) -> Result<(Vec<AssessmentDeliverySection>, Option<NextModuleRow>), AssessmentDeliveryError>
    {
        let section_rows = sqlx::query_as::<_, SectionRow>(
            "SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order",
        )
        .bind(version_id)
        .fetch_all(&self.pool)
        .await?;
        let mut sections = Vec::with_capacity(section_rows.len());
        let mut first_base: Option<NextModuleRow> = None;
        for section in section_rows {
            let module_rows = sqlx::query_as::<_, ModuleRow>(
                "SELECT id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, instructions, tool_policy FROM assessment_modules WHERE section_id = ? ORDER BY display_order",
            )
            .bind(&section.id)
            .fetch_all(&self.pool)
            .await?;
            let mut modules = Vec::with_capacity(module_rows.len());
            for module in module_rows {
                if module.adaptive_role == "base" && first_base.is_none() {
                    first_base = Some(NextModuleRow {
                        id: module.id.clone(),
                        section_id: section.id.clone(),
                        section_key: section.section_key.clone(),
                        module_key: module.module_key.clone(),
                        duration_seconds: module.duration_seconds,
                        adaptive_role: module.adaptive_role.clone(),
                        tool_policy: module.tool_policy.clone(),
                    });
                }
                let question_rows = sqlx::query_as::<_, QuestionRow>(
                    "SELECT eq.id AS exam_question_id, eq.question_id, eq.display_order, eq.is_pretest, qr.question_type, qr.stimulus, qr.prompt, qr.answer_definition, qr.metadata, qr.accessibility FROM assessment_exam_questions eq JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE eq.module_id = ? ORDER BY eq.display_order",
                )
                .bind(&module.id)
                .fetch_all(&self.pool)
                .await?;
                let questions = question_rows
                    .into_iter()
                    .map(delivered_question)
                    .collect::<Result<Vec<_>, _>>()?;
                modules.push(AssessmentDeliveryModule {
                    id: module.id,
                    module_key: module.module_key,
                    title: module.title,
                    display_order: module.display_order,
                    duration_seconds: module.duration_seconds,
                    target_question_count: module.target_question_count,
                    adaptive_role: module.adaptive_role,
                    instructions: serde_json::from_value(module.instructions)
                        .map_err(invalid_data)?,
                    tool_policy: module.tool_policy,
                    questions,
                });
            }
            sections.push(AssessmentDeliverySection {
                id: section.id,
                section_key: section.section_key,
                title: section.title,
                display_order: section.display_order,
                duration_seconds: section.duration_seconds,
                break_after_seconds: section.break_after_seconds,
                instructions: serde_json::from_value(section.instructions).map_err(invalid_data)?,
                modules,
            });
        }
        Ok((sections, first_base))
    }

    async fn bootstrap_payload(
        &self,
        binding: ScheduleBindingRow,
        attempt_id: &str,
        sections: Vec<AssessmentDeliverySection>,
    ) -> Result<AssessmentDeliveryBootstrap, AssessmentDeliveryError> {
        let result = self.load_result(attempt_id).await?;
        let control = self.attempt_control(attempt_id).await?;
        let mut attempt = self.attempt_snapshot(attempt_id).await?;
        let (schedule_runtime_status, timing) = self
            .assessment_timing_snapshot(&binding.schedule_id, &attempt)
            .await?;
        if timing.timing_model == "cohort_stage_v2" {
            for module in &mut attempt.module_attempts {
                if matches!(module.state.as_str(), "active" | "review") {
                    module.deadline_at = timing.deadline_at;
                    module.remaining_seconds = timing.remaining_seconds;
                }
            }
        }
        Ok(AssessmentDeliveryBootstrap {
            schedule_id: binding.schedule_id,
            exam_id: binding.exam_id,
            provider_key: binding.provider_key,
            version_id: binding.published_version_id,
            server_now: timing.server_now,
            candidate_name: control.candidate_name,
            schedule_runtime_status,
            timing,
            proctor_status: control.proctor_status,
            proctor_note: control.proctor_note,
            device_fingerprint_hash: control.device_fingerprint_hash,
            sections,
            attempt,
            result,
        })
    }

    async fn attempt_control(
        &self,
        attempt_id: &str,
    ) -> Result<AttemptControlRow, AssessmentDeliveryError> {
        sqlx::query_as::<_, AttemptControlRow>(
            "SELECT candidate_name, COALESCE(proctor_status, 'active') AS proctor_status, proctor_note, JSON_UNQUOTE(JSON_EXTRACT(integrity, '$.deviceFingerprintHash')) AS device_fingerprint_hash FROM student_attempts WHERE id = ?",
        )
        .bind(attempt_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AssessmentDeliveryError::NotFound)
    }

    async fn attempt_snapshot(
        &self,
        attempt_id: &str,
    ) -> Result<AssessmentAttemptSnapshot, AssessmentDeliveryError> {
        let now = Utc::now();
        let module_rows = sqlx::query_as::<_, ModuleAttemptRow>(
            "SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds, completion_reason, raw_correct, operational_question_count, tool_state, revision FROM assessment_module_attempts WHERE attempt_id = ? ORDER BY created_at, id",
        )
        .bind(attempt_id)
        .fetch_all(&self.pool)
        .await?;
        let modules = module_rows
            .into_iter()
            .map(|row| {
                let remaining_seconds = module_remaining_seconds(
                    row.started_at,
                    row.paused_at,
                    row.allocated_seconds,
                    row.extension_seconds,
                    row.accumulated_paused_seconds,
                    now,
                );
                let deadline_at = match (row.started_at, row.paused_at) {
                    (Some(started_at), None) => {
                        let total_seconds = i64::from(
                            row.allocated_seconds
                                .saturating_add(row.extension_seconds)
                                .max(0),
                        )
                        .saturating_add(i64::from(row.accumulated_paused_seconds.max(0)));
                        Some(started_at + Duration::seconds(total_seconds))
                    }
                    _ => None,
                };
                AssessmentModuleAttemptSnapshot {
                    id: row.id,
                    module_id: row.module_id,
                    state: row.state,
                    allocated_seconds: row.allocated_seconds,
                    available_at: row.available_at,
                    started_at: row.started_at,
                    paused_at: row.paused_at,
                    accumulated_paused_seconds: row.accumulated_paused_seconds,
                    extension_seconds: row.extension_seconds,
                    deadline_at,
                    remaining_seconds,
                    completion_reason: row.completion_reason,
                    raw_correct: row.raw_correct,
                    operational_question_count: row.operational_question_count,
                    tool_state: row.tool_state,
                    revision: row.revision,
                }
            })
            .collect();
        let responses = sqlx::query_as::<_, ResponseRow>(
            "SELECT ar.id, ar.module_attempt_id, ar.exam_question_id, ar.response, ar.marked_for_review, ar.eliminated_options, ar.annotations, ar.revision FROM assessment_question_responses ar JOIN assessment_module_attempts ma ON ma.id = ar.module_attempt_id WHERE ma.attempt_id = ? ORDER BY ar.updated_at, ar.id",
        )
        .bind(attempt_id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(response_snapshot)
        .collect::<Result<Vec<_>, _>>()?;
        Ok(AssessmentAttemptSnapshot {
            id: attempt_id.to_owned(),
            module_attempts: modules,
            responses,
        })
    }

    async fn insert_module_attempt(
        &self,
        attempt_id: &str,
        module: &NextModuleRow,
        available_at: Option<DateTime<Utc>>,
    ) -> Result<(), AssessmentDeliveryError> {
        let mut tx = self.pool.begin().await?;
        self.insert_module_attempt_tx(&mut tx, attempt_id, module, available_at)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn insert_module_attempt_tx(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt_id: &str,
        module: &NextModuleRow,
        available_at: Option<DateTime<Utc>>,
    ) -> Result<(), AssessmentDeliveryError> {
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?",
        )
        .bind(attempt_id)
        .bind(&module.id)
        .fetch_optional(&mut **tx)
        .await?;
        if existing.is_some() {
            return Ok(());
        }
        sqlx::query(
            "INSERT INTO assessment_module_attempts (id, attempt_id, module_id, state, allocated_seconds, available_at, started_at, tool_state) VALUES (?, ?, ?, 'not_started', ?, ?, NULL, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(attempt_id)
        .bind(&module.id)
        .bind(module.duration_seconds)
        .bind(available_at)
        .bind(&module.tool_policy)
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn assessment_timing_snapshot(
        &self,
        schedule_id: &str,
        attempt: &AssessmentAttemptSnapshot,
    ) -> Result<(String, AssessmentTimingSnapshot), AssessmentDeliveryError> {
        let runtime = sqlx::query_as::<_, RuntimeTimingProjectionRow>(
            r#"
            SELECT
                r.status AS runtime_status,
                r.timing_model,
                r.current_section_key AS current_stage_key,
                r.revision AS runtime_revision,
                rs.status AS stage_status,
                rs.actual_start_at AS stage_actual_start_at,
                rs.paused_at AS stage_paused_at,
                rs.planned_duration_minutes AS stage_planned_duration_minutes,
                rs.extension_minutes AS stage_extension_minutes,
                rs.accumulated_paused_seconds AS stage_accumulated_paused_seconds,
                UTC_TIMESTAMP(6) AS server_now
            FROM exam_session_runtimes r
            LEFT JOIN exam_session_runtime_sections rs
              ON rs.runtime_id = r.id
             AND rs.section_key = r.current_section_key
            WHERE r.schedule_id = ?
            "#,
        )
        .bind(schedule_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(runtime) = runtime else {
            let server_now: DateTime<Utc> = sqlx::query_scalar("SELECT UTC_TIMESTAMP(6)")
                .fetch_one(&self.pool)
                .await?;
            return Ok((
                "not_started".to_owned(),
                AssessmentTimingSnapshot {
                    authority: "legacy_attempt".to_owned(),
                    timing_model: "legacy_section_v1".to_owned(),
                    stage_key: None,
                    stage_status: None,
                    server_now,
                    deadline_at: None,
                    remaining_seconds: 0,
                    runtime_revision: 0,
                },
            ));
        };

        if matches!(
            runtime.timing_model.as_str(),
            "cohort_stage_v2" | "cohort_section_v3"
        ) {
            let remaining_seconds = match (
                runtime.stage_actual_start_at,
                runtime.stage_planned_duration_minutes,
            ) {
                (Some(started_at), Some(planned_minutes)) => compute_stage_remaining_seconds(
                    started_at,
                    runtime.stage_paused_at,
                    planned_minutes,
                    runtime.stage_extension_minutes.unwrap_or(0),
                    runtime.stage_accumulated_paused_seconds.unwrap_or(0),
                    runtime.server_now,
                ),
                _ => 0,
            };
            let deadline_at = if runtime.stage_status.as_deref() == Some("live")
                && runtime.stage_paused_at.is_none()
            {
                runtime.stage_actual_start_at.map(|started_at| {
                    let duration_seconds = i64::from(
                        runtime
                            .stage_planned_duration_minutes
                            .unwrap_or(0)
                            .saturating_add(runtime.stage_extension_minutes.unwrap_or(0)),
                    )
                    .saturating_mul(60)
                    .saturating_add(i64::from(
                        runtime.stage_accumulated_paused_seconds.unwrap_or(0).max(0),
                    ));
                    started_at + Duration::seconds(duration_seconds)
                })
            } else {
                None
            };
            if runtime.runtime_status == "live"
                && runtime.stage_status.as_deref() == Some("live")
                && runtime.stage_paused_at.is_none()
                && deadline_at.is_none()
            {
                tracing::error!(
                    schedule_id = schedule_id,
                    runtime_revision = runtime.runtime_revision,
                    stage_key = ?runtime.current_stage_key,
                    stage_started_at = ?runtime.stage_actual_start_at,
                    stage_planned_duration_minutes = ?runtime.stage_planned_duration_minutes,
                    "cohort timing invariant violated: live SAT stage has no authoritative deadline"
                );
            }
            return Ok((
                runtime.runtime_status,
                AssessmentTimingSnapshot {
                    authority: "cohort_runtime".to_owned(),
                    timing_model: runtime.timing_model,
                    stage_key: runtime.current_stage_key,
                    stage_status: runtime.stage_status,
                    server_now: runtime.server_now,
                    deadline_at,
                    remaining_seconds,
                    runtime_revision: runtime.runtime_revision,
                },
            ));
        }

        let active = attempt
            .module_attempts
            .iter()
            .rev()
            .find(|module| matches!(module.state.as_str(), "active" | "review"));
        Ok((
            runtime.runtime_status,
            AssessmentTimingSnapshot {
                authority: "legacy_attempt".to_owned(),
                timing_model: runtime.timing_model,
                stage_key: runtime.current_stage_key,
                stage_status: runtime.stage_status,
                server_now: runtime.server_now,
                deadline_at: active.and_then(|module| module.deadline_at),
                remaining_seconds: active.map(|module| module.remaining_seconds).unwrap_or(0),
                runtime_revision: runtime.runtime_revision,
            },
        ))
    }

    async fn ensure_timeout_response_recovery_tx(
        &self,
        tx: &mut Transaction<'_, MySql>,
        schedule_id: &str,
        attempt_id: &str,
        module: &ActiveModuleRow,
        server_received_at: DateTime<Utc>,
        request: &AssessmentResponseRequest,
    ) -> Result<(), AssessmentDeliveryError> {
        if module.state != "locked" || module.completion_reason.as_deref() != Some("time_expired") {
            return Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::ModuleNotActive,
                message: "Only a timeout-finalized SAT module can recover an admitted response."
                    .to_owned(),
            });
        }

        let submission_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM student_submissions WHERE attempt_id = ?)",
        )
        .bind(attempt_id)
        .fetch_one(&mut **tx)
        .await?;
        if submission_exists {
            return Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::TimeoutRecoveryClosed,
                message: "The SAT result is already finalized; timeout recovery is closed."
                    .to_owned(),
            });
        }

        let downstream_started: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM assessment_module_attempts downstream
                JOIN assessment_modules dm ON dm.id = downstream.module_id
                JOIN assessment_sections ds ON ds.id = dm.section_id
                JOIN assessment_modules cm ON cm.id = ?
                JOIN assessment_sections cs ON cs.id = cm.section_id
                WHERE downstream.attempt_id = ?
                  AND (
                    ds.display_order > cs.display_order
                    OR (ds.display_order = cs.display_order AND dm.display_order > cm.display_order)
                  )
                  AND downstream.state <> 'not_started'
            )
            "#,
        )
        .bind(&module.module_id)
        .bind(attempt_id)
        .fetch_one(&mut **tx)
        .await?;
        if downstream_started {
            return Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::TimeoutRecoveryClosed,
                message: "A later SAT module has already started; timeout recovery is closed."
                    .to_owned(),
            });
        }

        let timing_model: Option<String> = sqlx::query_scalar(
            "SELECT timing_model FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
        )
        .bind(schedule_id)
        .fetch_optional(&mut **tx)
        .await?;
        let timing_model = timing_model.as_deref().unwrap_or("legacy_section_v1");
        if matches!(timing_model, "cohort_stage_v2" | "cohort_section_v3") {
            let module_identity: Option<(String, String)> = sqlx::query_as(
                "SELECT s.section_key, m.adaptive_role FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
            )
            .bind(&module.module_id)
            .fetch_optional(&mut **tx)
            .await?;
            let Some((section_key, adaptive_role)) = module_identity else {
                return Err(AssessmentDeliveryError::NotFound);
            };
            let expected_stage_key = if timing_model == "cohort_stage_v2" {
                sat_runtime_stage_key(&section_key, &adaptive_role)?
            } else {
                section_key
            };
            if request
                .stage_key
                .as_deref()
                .is_some_and(|stage_key| stage_key != expected_stage_key)
            {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::ModuleMismatch,
                    message: "Response stage identity does not match its SAT section.".to_owned(),
                });
            }
            let stage: Option<(Option<DateTime<Utc>>, i32, i32, i32)> = sqlx::query_as(
                r#"
                SELECT rs.actual_start_at, rs.planned_duration_minutes,
                       rs.extension_minutes, rs.accumulated_paused_seconds
                FROM exam_session_runtime_sections rs
                JOIN exam_session_runtimes r ON r.id = rs.runtime_id
                WHERE r.schedule_id = ? AND rs.section_key = ?
                FOR UPDATE
                "#,
            )
            .bind(schedule_id)
            .bind(&expected_stage_key)
            .fetch_optional(&mut **tx)
            .await?;
            let Some((Some(started_at), planned_minutes, extension_minutes, paused_seconds)) =
                stage
            else {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::ModuleMismatch,
                    message: "The authoritative SAT cohort clock is unavailable for recovery."
                        .to_owned(),
                });
            };
            let section_deadline = stage_deadline_at(
                started_at,
                planned_minutes,
                extension_minutes,
                paused_seconds,
            );
            if server_received_at > section_deadline {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::DeadlineExpired,
                    message: "The SAT response reached the server after the cohort deadline."
                        .to_owned(),
                });
            }
            if timing_model == "cohort_section_v3" {
                let Some(module_started_at) = module.started_at else {
                    return Err(AssessmentDeliveryError::StructuredConflict {
                        reason: AssessmentDeliveryConflictReason::RuntimeNotLive,
                        message: "The SAT module never started.".to_owned(),
                    });
                };
                let module_deadline = module_started_at
                    + Duration::seconds(
                        i64::from(
                            module
                                .allocated_seconds
                                .saturating_add(module.extension_seconds)
                                .max(0),
                        )
                        .saturating_add(i64::from(module.accumulated_paused_seconds.max(0))),
                    );
                if server_received_at > module_deadline {
                    return Err(AssessmentDeliveryError::StructuredConflict {
                        reason: AssessmentDeliveryConflictReason::DeadlineExpired,
                        message: "The SAT response reached the server after the module ended."
                            .to_owned(),
                    });
                }
            }
        } else {
            let Some(started_at) = module.started_at else {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::RuntimeNotLive,
                    message: "The SAT module never started.".to_owned(),
                });
            };
            let duration_seconds = i64::from(
                module
                    .allocated_seconds
                    .saturating_add(module.extension_seconds)
                    .max(0),
            )
            .saturating_add(i64::from(module.accumulated_paused_seconds.max(0)));
            let deadline = started_at + Duration::seconds(duration_seconds);
            if server_received_at > deadline {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::DeadlineExpired,
                    message: "The SAT response reached the server after the module ended."
                        .to_owned(),
                });
            }
        }

        Ok(())
    }

    async fn repair_timeout_finalized_module_tx(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt_id: &str,
        module: &ActiveModuleRow,
    ) -> Result<(), AssessmentDeliveryError> {
        let rows = sqlx::query_as::<_, ScoringRow>(
            "SELECT eq.is_pretest, qr.answer_definition, ar.response FROM assessment_exam_questions eq JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id LEFT JOIN assessment_question_responses ar ON ar.module_attempt_id = ? AND ar.exam_question_id = eq.id WHERE eq.module_id = ? ORDER BY eq.display_order",
        )
        .bind(&module.id)
        .bind(&module.module_id)
        .fetch_all(&mut **tx)
        .await?;
        let (raw_correct, operational_count) = score_scoring_rows(&rows);
        let persisted_score: (Option<i32>, Option<i32>) = sqlx::query_as(
            "SELECT raw_correct, operational_question_count FROM assessment_module_attempts WHERE id = ? FOR UPDATE",
        )
        .bind(&module.id)
        .fetch_one(&mut **tx)
        .await?;
        if persisted_score != (Some(raw_correct), Some(operational_count)) {
            let update = sqlx::query(
                "UPDATE assessment_module_attempts SET raw_correct = ?, operational_question_count = ?, revision = revision + 1 WHERE id = ? AND state = 'locked' AND completion_reason = 'time_expired'",
            )
            .bind(raw_correct)
            .bind(operational_count)
            .bind(&module.id)
            .execute(&mut **tx)
            .await?;
            if update.rows_affected() != 1 {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::TimeoutRecoveryClosed,
                    message: "The timeout-finalized SAT module changed before recovery completed."
                        .to_owned(),
                });
            }
        }

        let module_identity: Option<(String, String)> = sqlx::query_as(
            "SELECT s.id, m.adaptive_role FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
        )
        .bind(&module.module_id)
        .fetch_optional(&mut **tx)
        .await?;
        let Some((section_id, adaptive_role)) = module_identity else {
            return Err(AssessmentDeliveryError::NotFound);
        };
        if adaptive_role != "base" {
            return Ok(());
        }

        let policy = sqlx::query_as::<_, RoutingPolicyRow>(
            "SELECT section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision FROM assessment_routing_policies WHERE section_id = ?",
        )
        .bind(&section_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AssessmentDeliveryError::Validation(
            "Adaptive routing policy is missing during timeout recovery.".to_owned(),
        ))?;
        if policy.base_module_id != module.module_id {
            return Err(AssessmentDeliveryError::InvalidData(
                "Adaptive routing policy base module does not match timeout recovery module."
                    .to_owned(),
            ));
        }
        let route = PracticeThresholdRouting
            .choose_route(raw_correct, operational_count, &policy.policy_config)
            .map_err(|error| AssessmentDeliveryError::Validation(error.to_string()))?;
        let (selected_module_id, selected_route) = match route {
            AdaptiveRoute::Lower => (&policy.lower_module_id, "lower"),
            AdaptiveRoute::Higher => (&policy.higher_module_id, "higher"),
        };
        let decision: Option<(String, String)> = sqlx::query_as(
            "SELECT id, selected_module_id FROM assessment_route_decisions WHERE attempt_id = ? AND section_id = ? FOR UPDATE",
        )
        .bind(attempt_id)
        .bind(&section_id)
        .fetch_optional(&mut **tx)
        .await?;
        let Some((decision_id, previous_module_id)) = decision else {
            return Err(AssessmentDeliveryError::InvalidData(
                "Timeout-finalized SAT base module is missing its routing decision.".to_owned(),
            ));
        };

        if previous_module_id != *selected_module_id {
            let previous_attempt: Option<(String, String)> = sqlx::query_as(
                "SELECT id, state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? FOR UPDATE",
            )
            .bind(attempt_id)
            .bind(&previous_module_id)
            .fetch_optional(&mut **tx)
            .await?;
            if previous_attempt
                .as_ref()
                .is_some_and(|(_, state)| state != "not_started")
            {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::TimeoutRecoveryClosed,
                    message: "The adaptive SAT branch already started before recovery completed."
                        .to_owned(),
                });
            }
            let selected_attempt: Option<(String, String)> = sqlx::query_as(
                "SELECT id, state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? FOR UPDATE",
            )
            .bind(attempt_id)
            .bind(selected_module_id)
            .fetch_optional(&mut **tx)
            .await?;
            if selected_attempt
                .as_ref()
                .is_some_and(|(_, state)| state != "not_started")
            {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::TimeoutRecoveryClosed,
                    message: "The corrected adaptive SAT branch is already in progress.".to_owned(),
                });
            }

            if selected_attempt.is_none() {
                let selected = sqlx::query_as::<_, NextModuleRow>(
                    "SELECT m.id, m.section_id, s.section_key, m.module_key, m.duration_seconds, m.adaptive_role, m.tool_policy FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
                )
                .bind(selected_module_id)
                .fetch_optional(&mut **tx)
                .await?
                .ok_or(AssessmentDeliveryError::NotFound)?;
                if let Some((previous_attempt_id, _)) = previous_attempt.as_ref() {
                    let retarget = sqlx::query(
                        "UPDATE assessment_module_attempts SET module_id = ?, allocated_seconds = ?, tool_state = ?, revision = revision + 1 WHERE id = ? AND state = 'not_started'",
                    )
                    .bind(&selected.id)
                    .bind(selected.duration_seconds)
                    .bind(&selected.tool_policy)
                    .bind(previous_attempt_id)
                    .execute(&mut **tx)
                    .await?;
                    if retarget.rows_affected() != 1 {
                        return Err(AssessmentDeliveryError::StructuredConflict {
                            reason: AssessmentDeliveryConflictReason::TimeoutRecoveryClosed,
                            message: "The pending SAT branch changed before it could be repaired."
                                .to_owned(),
                        });
                    }
                } else {
                    let now: DateTime<Utc> = sqlx::query_scalar("SELECT UTC_TIMESTAMP(6)")
                        .fetch_one(&mut **tx)
                        .await?;
                    self.insert_module_attempt_tx(tx, attempt_id, &selected, Some(now))
                        .await?;
                }
            } else if let Some((previous_attempt_id, _)) = previous_attempt.as_ref() {
                let selected_attempt_id = &selected_attempt
                    .as_ref()
                    .expect("selected attempt checked above")
                    .0;
                if previous_attempt_id != selected_attempt_id {
                    let deleted = sqlx::query(
                        "DELETE FROM assessment_module_attempts WHERE id = ? AND state = 'not_started'",
                    )
                    .bind(previous_attempt_id)
                    .execute(&mut **tx)
                    .await?;
                    if deleted.rows_affected() != 1 {
                        return Err(AssessmentDeliveryError::StructuredConflict {
                            reason: AssessmentDeliveryConflictReason::TimeoutRecoveryClosed,
                            message: "The obsolete SAT branch changed before recovery completed."
                                .to_owned(),
                        });
                    }
                }
            }
        }

        sqlx::query(
            "UPDATE assessment_route_decisions SET selected_module_id = ?, selected_route = ?, raw_correct = ?, operational_question_count = ?, policy_key = ?, policy_revision = ?, policy_config = ? WHERE id = ?",
        )
        .bind(selected_module_id)
        .bind(selected_route)
        .bind(raw_correct)
        .bind(operational_count)
        .bind(&policy.policy_key)
        .bind(policy.revision)
        .bind(&policy.policy_config)
        .bind(&decision_id)
        .execute(&mut **tx)
        .await?;

        tracing::info!(
            attempt_id = attempt_id,
            module_attempt_id = module.id,
            raw_correct = raw_correct,
            operational_question_count = operational_count,
            selected_module_id = selected_module_id,
            "repaired SAT timeout finalization after a pre-deadline response"
        );
        Ok(())
    }

    async fn ensure_module_matches_runtime_stage_tx(
        &self,
        tx: &mut Transaction<'_, MySql>,
        schedule_id: &str,
        module_id: &str,
        admitted_at: Option<DateTime<Utc>>,
    ) -> Result<SatRuntimeTimingGate, AssessmentDeliveryError> {
        let runtime: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT timing_model, current_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
        )
        .bind(schedule_id)
        .fetch_optional(&mut **tx)
        .await?;
        let Some((timing_model, current_stage_key)) = runtime else {
            return Ok(SatRuntimeTimingGate::LegacyAttempt);
        };
        let timing_gate = match timing_model.as_str() {
            "cohort_stage_v2" => SatRuntimeTimingGate::CohortStageV2,
            "cohort_section_v3" => SatRuntimeTimingGate::CohortSectionV3,
            _ => return Ok(SatRuntimeTimingGate::LegacyAttempt),
        };

        let module: Option<(String, String)> = sqlx::query_as(
            "SELECT s.section_key, m.adaptive_role FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
        )
        .bind(module_id)
        .fetch_optional(&mut **tx)
        .await?;
        let Some((section_key, adaptive_role)) = module else {
            return Err(AssessmentDeliveryError::NotFound);
        };
        let expected_stage_key = match timing_gate {
            SatRuntimeTimingGate::CohortStageV2 => {
                sat_runtime_stage_key(&section_key, &adaptive_role)?
            }
            SatRuntimeTimingGate::CohortSectionV3 => section_key,
            SatRuntimeTimingGate::LegacyAttempt => unreachable!("legacy timing returned above"),
        };
        if current_stage_key.as_deref() != Some(expected_stage_key.as_str()) {
            tracing::warn!(
                schedule_id = schedule_id,
                module_id = module_id,
                timing_model = timing_model,
                expected_stage_key = expected_stage_key,
                active_stage_key = ?current_stage_key,
                "SAT module request rejected because the cohort timing stage does not match"
            );
            return Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::ModuleMismatch,
                message: format!(
                    "SAT section `{expected_stage_key}` is not active for this cohort."
                ),
            });
        }
        let stage: Option<(
            String,
            Option<DateTime<Utc>>,
            Option<DateTime<Utc>>,
            i32,
            i32,
            i32,
            DateTime<Utc>,
        )> = sqlx::query_as(
            r#"
            SELECT rs.status, rs.actual_start_at, rs.paused_at, rs.planned_duration_minutes,
                   rs.extension_minutes, rs.accumulated_paused_seconds, UTC_TIMESTAMP(6)
            FROM exam_session_runtime_sections rs
            JOIN exam_session_runtimes r ON r.id = rs.runtime_id
            WHERE r.schedule_id = ? AND rs.section_key = ?
            FOR UPDATE
            "#,
        )
        .bind(schedule_id)
        .bind(&expected_stage_key)
        .fetch_optional(&mut **tx)
        .await?;
        let Some((
            stage_status,
            started_at,
            paused_at,
            planned_minutes,
            extension_minutes,
            paused_seconds,
            server_now,
        )) = stage
        else {
            return Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::ModuleMismatch,
                message: "The authoritative SAT section clock is missing.".to_owned(),
            });
        };
        if paused_at.is_some() {
            return Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::RuntimePaused,
                message: "The SAT cohort clock is paused.".to_owned(),
            });
        }
        if stage_status != "live" {
            return Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::RuntimeNotLive,
                message: "The SAT section is not live.".to_owned(),
            });
        }
        let Some(started_at) = started_at else {
            return Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::RuntimeNotLive,
                message: "The SAT section clock has not started.".to_owned(),
            });
        };
        let deadline = stage_deadline_at(
            started_at,
            planned_minutes,
            extension_minutes,
            paused_seconds,
        );
        let cutoff_time = admitted_at.unwrap_or(server_now);
        let expired = if admitted_at.is_some() {
            cutoff_time > deadline
        } else {
            cutoff_time >= deadline
        };
        if expired {
            return Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::DeadlineExpired,
                message: "The SAT section clock has expired.".to_owned(),
            });
        }
        Ok(timing_gate)
    }

    async fn ensure_attempt_can_work_tx(
        &self,
        tx: &mut Transaction<'_, MySql>,
        schedule_id: &str,
        attempt_id: &str,
    ) -> Result<(), AssessmentDeliveryError> {
        let runtime_status: Option<String> = sqlx::query_scalar(
            "SELECT status FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
        )
        .bind(schedule_id)
        .fetch_optional(&mut **tx)
        .await?;
        match runtime_status.as_deref() {
            Some("live") => {}
            Some("paused") => {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::RuntimePaused,
                    message: "The SAT session is paused by the proctor.".to_owned(),
                });
            }
            _ => {
                return Err(AssessmentDeliveryError::StructuredConflict {
                    reason: AssessmentDeliveryConflictReason::RuntimeNotLive,
                    message: "The SAT session has not been started by the proctor.".to_owned(),
                });
            }
        }
        let control = sqlx::query_as::<_, AttemptControlRow>(
            "SELECT candidate_name, COALESCE(proctor_status, 'active') AS proctor_status, proctor_note, JSON_UNQUOTE(JSON_EXTRACT(integrity, '$.deviceFingerprintHash')) AS device_fingerprint_hash FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",
        )
        .bind(attempt_id)
        .bind(schedule_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(AssessmentDeliveryError::NotFound)?;
        match control.proctor_status.as_str() {
            "paused" => Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::AttemptProctorBlocked,
                message: "Your SAT attempt is paused by the proctor.".to_owned(),
            }),
            "terminated" => Err(AssessmentDeliveryError::StructuredConflict {
                reason: AssessmentDeliveryConflictReason::AttemptProctorBlocked,
                message: "Your SAT attempt has been terminated by the proctor.".to_owned(),
            }),
            _ => Ok(()),
        }
    }

    async fn finalize_module_tx(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt_id: &str,
        active: &ActiveModuleRow,
        completion_reason: &str,
    ) -> Result<Option<NextModuleRow>, AssessmentDeliveryError> {
        let rows = sqlx::query_as::<_, ScoringRow>(
            "SELECT eq.is_pretest, qr.answer_definition, ar.response FROM assessment_exam_questions eq JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id LEFT JOIN assessment_question_responses ar ON ar.module_attempt_id = ? AND ar.exam_question_id = eq.id WHERE eq.module_id = ? ORDER BY eq.display_order",
        )
        .bind(&active.id)
        .bind(&active.module_id)
        .fetch_all(&mut **tx)
        .await?;
        let (raw_correct, operational_count) = score_scoring_rows(&rows);
        let lock_module = matches!(
            completion_reason,
            "time_expired" | "proctor_end" | "proctor_terminate"
        );
        let state = if lock_module { "locked" } else { "submitted" };
        let update = sqlx::query(
            "UPDATE assessment_module_attempts SET state = ?, submitted_at = CURRENT_TIMESTAMP(6), locked_at = CASE WHEN ? THEN CURRENT_TIMESTAMP(6) ELSE locked_at END, paused_at = NULL, completion_reason = ?, raw_correct = ?, operational_question_count = ?, revision = revision + 1 WHERE id = ? AND state IN ('not_started', 'active', 'review')",
        )
        .bind(state)
        .bind(lock_module)
        .bind(completion_reason)
        .bind(raw_correct)
        .bind(operational_count)
        .bind(&active.id)
        .execute(&mut **tx)
        .await?;
        if update.rows_affected() != 1 {
            return Err(AssessmentDeliveryError::Conflict(
                "The SAT module was already finalized by another request.".to_owned(),
            ));
        }

        let current_section: (String, i32) = sqlx::query_as(
            "SELECT s.id, s.break_after_seconds FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
        )
        .bind(&active.module_id)
        .fetch_one(&mut **tx)
        .await?;
        let next = self
            .next_module(
                tx,
                attempt_id,
                &active.id,
                &active.module_id,
                raw_correct,
                operational_count,
            )
            .await?;
        if let Some(next_module) = next.as_ref() {
            let now: DateTime<Utc> = sqlx::query_scalar("SELECT UTC_TIMESTAMP(6)")
                .fetch_one(&mut **tx)
                .await?;
            let cohort_timed: bool = sqlx::query_scalar(
                r#"
                SELECT EXISTS(
                    SELECT 1
                    FROM student_attempts sa
                    JOIN exam_session_runtimes r ON r.schedule_id = sa.schedule_id
                    WHERE sa.id = ? AND r.timing_model IN ('cohort_stage_v2', 'cohort_section_v3')
                )
                "#,
            )
            .bind(attempt_id)
            .fetch_one(&mut **tx)
            .await?;
            let available_at = Some(if cohort_timed {
                now
            } else {
                next_module_available_at(
                    now,
                    &current_section.0,
                    &next_module.section_id,
                    current_section.1,
                )
            });
            self.insert_module_attempt_tx(tx, attempt_id, next_module, available_at)
                .await?;
            // Do not write SAT module keys into the legacy IELTS `current_module` field.
            // The active SAT module is derived from `assessment_module_attempts`.
        }
        Ok(next)
    }

    async fn next_module(
        &self,
        tx: &mut Transaction<'_, MySql>,
        attempt_id: &str,
        base_module_attempt_id: &str,
        module_id: &str,
        raw_correct: i32,
        operational_questions: i32,
    ) -> Result<Option<NextModuleRow>, AssessmentDeliveryError> {
        let current: Option<(String, String, i32, String, String)> = sqlx::query_as(
            "SELECT s.id, s.section_key, s.display_order, m.adaptive_role, s.exam_version_id FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
        )
        .bind(module_id)
        .fetch_optional(&mut **tx)
        .await?;
        let Some((section_id, _section_key, section_order, adaptive_role, version_id)) = current
        else {
            return Err(AssessmentDeliveryError::NotFound);
        };

        if adaptive_role == "base" {
            let policy = sqlx::query_as::<_, RoutingPolicyRow>(
                "SELECT section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision FROM assessment_routing_policies WHERE section_id = ?",
            )
            .bind(&section_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or_else(|| AssessmentDeliveryError::Validation(
                "Adaptive routing policy is missing.".to_owned(),
            ))?;
            if policy.base_module_id != module_id {
                return Err(AssessmentDeliveryError::InvalidData(
                    "Adaptive routing policy base module does not match the submitted module."
                        .to_owned(),
                ));
            }
            let route = PracticeThresholdRouting
                .choose_route(raw_correct, operational_questions, &policy.policy_config)
                .map_err(|error| AssessmentDeliveryError::Validation(error.to_string()))?;
            let (selected_module_id, route_name) = match route {
                AdaptiveRoute::Lower => (&policy.lower_module_id, "lower"),
                AdaptiveRoute::Higher => (&policy.higher_module_id, "higher"),
            };
            sqlx::query(
                "INSERT INTO assessment_route_decisions (id, attempt_id, section_id, base_module_attempt_id, base_module_id, selected_module_id, selected_route, raw_correct, operational_question_count, policy_key, policy_revision, policy_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(attempt_id)
            .bind(&policy.section_id)
            .bind(base_module_attempt_id)
            .bind(&policy.base_module_id)
            .bind(selected_module_id)
            .bind(route_name)
            .bind(raw_correct)
            .bind(operational_questions)
            .bind(&policy.policy_key)
            .bind(policy.revision)
            .bind(&policy.policy_config)
            .execute(&mut **tx)
            .await?;
            return sqlx::query_as::<_, NextModuleRow>(
                "SELECT m.id, m.section_id, s.section_key, m.module_key, m.duration_seconds, m.adaptive_role, m.tool_policy FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
            )
            .bind(selected_module_id)
            .fetch_optional(&mut **tx)
            .await
            .map_err(AssessmentDeliveryError::from);
        }

        let next_section_id: Option<String> = sqlx::query_scalar(
            "SELECT id FROM assessment_sections WHERE exam_version_id = ? AND display_order > ? ORDER BY display_order LIMIT 1",
        )
        .bind(version_id)
        .bind(section_order)
        .fetch_optional(&mut **tx)
        .await?;
        let Some(next_section_id) = next_section_id else {
            return Ok(None);
        };
        sqlx::query_as::<_, NextModuleRow>(
            "SELECT m.id, m.section_id, s.section_key, m.module_key, m.duration_seconds, m.adaptive_role, m.tool_policy FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.section_id = ? AND m.adaptive_role = 'base' ORDER BY m.display_order LIMIT 1",
        )
        .bind(next_section_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(AssessmentDeliveryError::from)
    }

    async fn reconcile_attempt_timeout(
        &self,
        schedule_id: &str,
        attempt_id: &str,
        as_of: DateTime<Utc>,
    ) -> Result<bool, AssessmentDeliveryError> {
        let mut tx = self.pool.begin().await?;

        // Lock order invariant: cohort runtime first, then the student's module attempts.
        // This matches proctor/runtime transitions and avoids runtime<->attempt deadlock cycles.
        let runtime: Option<(String, String, String, Option<String>)> = sqlx::query_as(
            "SELECT id, status, timing_model, current_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
        )
        .bind(schedule_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((runtime_id, runtime_status, timing_model, current_stage_key)) = runtime else {
            tx.commit().await?;
            return Ok(false);
        };
        let cohort_timed = matches!(
            timing_model.as_str(),
            "cohort_stage_v2" | "cohort_section_v3"
        );
        let current_stage_order = if cohort_timed {
            match current_stage_key.as_deref() {
                Some(stage_key) => sqlx::query_scalar::<_, i32>(
                    "SELECT section_order FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ?",
                )
                .bind(&runtime_id)
                .bind(stage_key)
                .fetch_optional(&mut *tx)
                .await?,
                None => None,
            }
        } else {
            None
        };

        let mut changed = false;
        let mut should_complete_assessment = false;
        for _ in 0..32 {
            let module_attempt = sqlx::query_as::<_, ActiveModuleRow>(
                "SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds, completion_reason FROM assessment_module_attempts WHERE attempt_id = ? AND state IN ('not_started', 'active', 'review') ORDER BY created_at, id LIMIT 1 FOR UPDATE",
            )
            .bind(attempt_id)
            .fetch_optional(&mut *tx)
            .await?;
            let Some(module_attempt) = module_attempt else {
                break;
            };

            let expired = if timing_model == "cohort_stage_v2" {
                if matches!(runtime_status.as_str(), "completed" | "cancelled") {
                    true
                } else {
                    let module: Option<(String, String)> = sqlx::query_as(
                        "SELECT s.section_key, m.adaptive_role FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
                    )
                    .bind(&module_attempt.module_id)
                    .fetch_optional(&mut *tx)
                    .await?;
                    let Some((section_key, adaptive_role)) = module else {
                        return Err(AssessmentDeliveryError::NotFound);
                    };
                    let expected_stage_key = sat_runtime_stage_key(&section_key, &adaptive_role)?;
                    let expected_stage: Option<(
                        i32, String, Option<DateTime<Utc>>, Option<DateTime<Utc>>, i32, i32, i32,
                    )> = sqlx::query_as(
                        "SELECT section_order, status, actual_start_at, paused_at, planned_duration_minutes, extension_minutes, accumulated_paused_seconds FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? FOR UPDATE",
                    )
                    .bind(&runtime_id)
                    .bind(&expected_stage_key)
                    .fetch_optional(&mut *tx)
                    .await?;
                    let Some((
                        expected_order,
                        stage_status,
                        started_at,
                        paused_at,
                        planned_minutes,
                        extension_minutes,
                        paused_seconds,
                    )) = expected_stage
                    else {
                        return Err(AssessmentDeliveryError::Conflict(format!(
                            "SAT runtime stage `{expected_stage_key}` is missing."
                        )));
                    };

                    match (current_stage_key.as_deref(), current_stage_order) {
                        (Some(_), Some(current_order)) if expected_order < current_order => true,
                        (Some(current_key), Some(_)) if current_key == expected_stage_key => {
                            if runtime_status == "paused" || paused_at.is_some() {
                                false
                            } else {
                                match (stage_status.as_str(), started_at) {
                                    ("completed", _) => true,
                                    ("live", Some(started_at)) => {
                                        compute_stage_remaining_seconds(
                                            started_at,
                                            paused_at,
                                            planned_minutes,
                                            extension_minutes,
                                            paused_seconds,
                                            as_of,
                                        ) <= 0
                                    }
                                    _ => false,
                                }
                            }
                        }
                        _ => false,
                    }
                }
            } else if timing_model == "cohort_section_v3" {
                if matches!(runtime_status.as_str(), "completed" | "cancelled") {
                    true
                } else {
                    let section_key: Option<String> = sqlx::query_scalar(
                        "SELECT s.section_key FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
                    )
                    .bind(&module_attempt.module_id)
                    .fetch_optional(&mut *tx)
                    .await?;
                    let Some(section_key) = section_key else {
                        return Err(AssessmentDeliveryError::NotFound);
                    };
                    let section_stage: Option<(
                        i32, String, Option<DateTime<Utc>>, Option<DateTime<Utc>>, i32, i32, i32,
                    )> = sqlx::query_as(
                        "SELECT section_order, status, actual_start_at, paused_at, planned_duration_minutes, extension_minutes, accumulated_paused_seconds FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? FOR UPDATE",
                    )
                    .bind(&runtime_id)
                    .bind(&section_key)
                    .fetch_optional(&mut *tx)
                    .await?;
                    let Some((
                        section_order,
                        stage_status,
                        started_at,
                        stage_paused_at,
                        planned_minutes,
                        extension_minutes,
                        paused_seconds,
                    )) = section_stage
                    else {
                        return Err(AssessmentDeliveryError::Conflict(format!(
                            "SAT section clock `{section_key}` is missing."
                        )));
                    };

                    match (current_stage_key.as_deref(), current_stage_order) {
                        (Some(_), Some(current_order)) if section_order < current_order => true,
                        (Some(current_key), Some(_)) if current_key == section_key => {
                            if runtime_status == "paused" || stage_paused_at.is_some() {
                                false
                            } else {
                                let section_expired = match (stage_status.as_str(), started_at) {
                                    ("completed", _) => true,
                                    ("live", Some(started_at)) => {
                                        compute_stage_remaining_seconds(
                                            started_at,
                                            stage_paused_at,
                                            planned_minutes,
                                            extension_minutes,
                                            paused_seconds,
                                            as_of,
                                        ) <= 0
                                    }
                                    _ => false,
                                };
                                section_expired
                                    || (module_attempt.state == "active"
                                        && module_attempt.paused_at.is_none()
                                        && module_remaining_seconds(
                                            module_attempt.started_at,
                                            module_attempt.paused_at,
                                            module_attempt.allocated_seconds,
                                            module_attempt.extension_seconds,
                                            module_attempt.accumulated_paused_seconds,
                                            as_of,
                                        ) <= 0)
                            }
                        }
                        // A break or an earlier section is active. A future-section module remains pending.
                        _ => false,
                    }
                }
            } else {
                matches!(runtime_status.as_str(), "completed" | "cancelled")
                    || (module_attempt.state == "active"
                        && module_attempt.paused_at.is_none()
                        && module_remaining_seconds(
                            module_attempt.started_at,
                            module_attempt.paused_at,
                            module_attempt.allocated_seconds,
                            module_attempt.extension_seconds,
                            module_attempt.accumulated_paused_seconds,
                            as_of,
                        ) <= 0)
            };

            if !expired {
                break;
            }

            let next = self
                .finalize_module_tx(&mut tx, attempt_id, &module_attempt, "time_expired")
                .await?;
            changed = true;
            if next.is_none() {
                should_complete_assessment = true;
                break;
            }
        }

        tx.commit().await?;
        if should_complete_assessment {
            let _ = self
                .complete_assessment(
                    schedule_id,
                    attempt_id,
                    AssessmentSubmitRequest {
                        submission_id: attempt_id.to_owned(),
                    },
                )
                .await?;
        }
        Ok(changed)
    }

    pub async fn reconcile_expired_modules_at(
        &self,
        as_of: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<SatTimeoutOutcome>, AssessmentDeliveryError> {
        // Runtime reconciliation can run on multiple API/worker instances.
        // Use a MySQL named lock so only one instance advances expired SAT state
        // at a time. This keeps timeout transitions deterministic under scale-out.
        let mut lock_connection = self.pool.acquire().await?;
        let acquired: Option<i64> =
            sqlx::query_scalar("SELECT GET_LOCK('ielts_sat_runtime_reconciliation', 0)")
                .fetch_one(&mut *lock_connection)
                .await?;
        if acquired.unwrap_or(0) != 1 {
            return Ok(Vec::new());
        }

        let reconciliation_result = async {
        let rows: Vec<(String, String)> = sqlx::query_as(
            r#"
            SELECT ma.attempt_id, sa.schedule_id
            FROM assessment_module_attempts ma
            JOIN student_attempts sa ON sa.id = ma.attempt_id
            JOIN exam_entities e ON e.id = sa.exam_id
            JOIN assessment_modules m ON m.id = ma.module_id
            JOIN assessment_sections s ON s.id = m.section_id
            JOIN exam_session_runtimes r ON r.schedule_id = sa.schedule_id
            LEFT JOIN exam_session_runtime_sections current_rs
              ON current_rs.runtime_id = r.id
             AND current_rs.section_key = r.current_section_key
            LEFT JOIN exam_session_runtime_sections expected_rs
              ON expected_rs.runtime_id = r.id
             AND expected_rs.section_key = CONCAT(s.section_key, CASE WHEN m.adaptive_role = 'base' THEN ':m1' ELSE ':m2' END)
            LEFT JOIN exam_session_runtime_sections section_rs
              ON section_rs.runtime_id = r.id
             AND section_rs.section_key = s.section_key
            WHERE e.provider_key = 'sat'
              AND ma.state IN ('not_started', 'active', 'review')
              AND (
                    (r.timing_model = 'legacy_section_v1'
                     AND ma.state = 'active'
                     AND ma.started_at IS NOT NULL
                     AND ma.paused_at IS NULL
                     AND ? >= DATE_ADD(ma.started_at, INTERVAL (ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds) SECOND))
                 OR (r.timing_model = 'cohort_stage_v2'
                     AND (
                          r.status IN ('completed', 'cancelled')
                          OR (current_rs.section_order IS NOT NULL
                              AND expected_rs.section_order IS NOT NULL
                              AND expected_rs.section_order < current_rs.section_order)
                          OR (r.status = 'live'
                              AND r.current_section_key = expected_rs.section_key
                              AND expected_rs.status = 'live'
                              AND expected_rs.actual_start_at IS NOT NULL
                              AND expected_rs.paused_at IS NULL
                              AND ? >= DATE_ADD(expected_rs.actual_start_at, INTERVAL ((expected_rs.planned_duration_minutes + expected_rs.extension_minutes) * 60 + expected_rs.accumulated_paused_seconds) SECOND))
                     ))
                 OR (r.timing_model = 'cohort_section_v3'
                     AND (
                          r.status IN ('completed', 'cancelled')
                          OR (current_rs.section_order IS NOT NULL
                              AND section_rs.section_order IS NOT NULL
                              AND section_rs.section_order < current_rs.section_order)
                          OR (r.status = 'live'
                              AND r.current_section_key = section_rs.section_key
                              AND section_rs.status = 'live'
                              AND section_rs.actual_start_at IS NOT NULL
                              AND section_rs.paused_at IS NULL
                              AND (
                                   ? >= DATE_ADD(section_rs.actual_start_at, INTERVAL ((section_rs.planned_duration_minutes + section_rs.extension_minutes) * 60 + section_rs.accumulated_paused_seconds) SECOND)
                                   OR (ma.state = 'active'
                                       AND ma.started_at IS NOT NULL
                                       AND ma.paused_at IS NULL
                                       AND ? >= DATE_ADD(ma.started_at, INTERVAL (ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds) SECOND))
                              ))
                     ))
              )
            ORDER BY COALESCE(ma.started_at, ma.created_at), ma.id
            LIMIT ?
            "#,
        )
        .bind(as_of)
        .bind(as_of)
        .bind(as_of)
        .bind(as_of)
        .bind(limit.max(1))
        .fetch_all(&self.pool)
        .await?;
        let mut outcomes = Vec::new();
        for (attempt_id, schedule_id) in rows {
            if self
                .reconcile_attempt_timeout(&schedule_id, &attempt_id, as_of)
                .await?
            {
                outcomes.push(SatTimeoutOutcome {
                    schedule_id,
                    attempt_id,
                });
            }
        }
        Ok(outcomes)
        }.await;

        match sqlx::query_scalar::<_, Option<i64>>(
            "SELECT RELEASE_LOCK('ielts_sat_runtime_reconciliation')",
        )
        .fetch_one(&mut *lock_connection)
        .await
        {
            Ok(Some(1) | Some(0) | None) => {}
            Ok(Some(lock_state)) => {
                tracing::warn!(
                    lock_state,
                    "unexpected SAT reconciliation lock release state"
                );
            }
            Err(error) => {
                tracing::warn!(error = %error, "failed releasing SAT reconciliation lock");
            }
        }

        reconciliation_result
    }

    pub async fn terminate_attempt(
        &self,
        schedule_id: &str,
        attempt_id: &str,
        reason: Option<&str>,
    ) -> Result<(), AssessmentDeliveryError> {
        let binding = self.schedule_binding(schedule_id).await?;
        self.ensure_attempt_binding(&binding, attempt_id).await?;
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE assessment_module_attempts SET state = 'locked', locked_at = COALESCE(locked_at, CURRENT_TIMESTAMP(6)), paused_at = NULL, completion_reason = COALESCE(completion_reason, 'proctor_terminate'), revision = revision + 1 WHERE attempt_id = ? AND state IN ('not_started', 'active', 'review')",
        )
        .bind(attempt_id)
        .execute(&mut *tx)
        .await?;
        let final_submission = json!({"providerKey": "sat", "terminated": true, "reason": reason});
        let sealed_rows = crate::delivery::terminate_provider_attempt_in_tx(
            &mut *tx,
            attempt_id,
            schedule_id,
            &final_submission,
        )
        .await?;
        if sealed_rows != 1 {
            return Err(AssessmentDeliveryError::NotFound);
        }
        tx.commit().await?;
        Ok(())
    }
}

fn score_scoring_rows(rows: &[ScoringRow]) -> (i32, i32) {
    rows.iter().fold((0_i32, 0_i32), |(correct, count), row| {
        if row.is_pretest {
            return (correct, count);
        }
        let is_correct = parse_answer(&row.answer_definition)
            .map(|answer| response_is_correct(&answer, row.response.as_ref()))
            .unwrap_or(false);
        (correct + i32::from(is_correct), count + 1)
    })
}

fn next_module_available_at(
    now: DateTime<Utc>,
    current_section_id: &str,
    next_section_id: &str,
    break_after_seconds: i32,
) -> DateTime<Utc> {
    if current_section_id == next_section_id {
        now
    } else {
        now + Duration::seconds(i64::from(break_after_seconds.max(0)))
    }
}

fn sat_runtime_stage_key(
    section_key: &str,
    adaptive_role: &str,
) -> Result<String, AssessmentDeliveryError> {
    let suffix = match adaptive_role {
        "base" => "m1",
        "lower_branch" | "higher_branch" => "m2",
        other => {
            return Err(AssessmentDeliveryError::InvalidData(format!(
                "SAT module adaptive role `{other}` has no cohort timing stage."
            )))
        }
    };
    Ok(format!("{section_key}:{suffix}"))
}

fn stage_deadline_at(
    started_at: DateTime<Utc>,
    planned_duration_minutes: i32,
    extension_minutes: i32,
    accumulated_paused_seconds: i32,
) -> DateTime<Utc> {
    let duration_seconds = i64::from(
        planned_duration_minutes
            .saturating_add(extension_minutes)
            .max(0),
    )
    .saturating_mul(60)
    .saturating_add(i64::from(accumulated_paused_seconds.max(0)));
    started_at + Duration::seconds(duration_seconds)
}

fn compute_stage_remaining_seconds(
    started_at: DateTime<Utc>,
    paused_at: Option<DateTime<Utc>>,
    planned_duration_minutes: i32,
    extension_minutes: i32,
    accumulated_paused_seconds: i32,
    now: DateTime<Utc>,
) -> i32 {
    let total = i64::from(
        planned_duration_minutes
            .saturating_add(extension_minutes)
            .max(0),
    )
    .saturating_mul(60);
    let time_base = paused_at.unwrap_or(now);
    let elapsed = (time_base - started_at)
        .num_seconds()
        .max(0)
        .saturating_sub(i64::from(accumulated_paused_seconds.max(0)));
    (total - elapsed).clamp(0, total) as i32
}

fn module_remaining_seconds(
    started_at: Option<DateTime<Utc>>,
    paused_at: Option<DateTime<Utc>>,
    allocated_seconds: i32,
    extension_seconds: i32,
    accumulated_paused_seconds: i32,
    now: DateTime<Utc>,
) -> i32 {
    let total = allocated_seconds.saturating_add(extension_seconds).max(0);
    let Some(started_at) = started_at else {
        return total;
    };
    let time_base = paused_at.unwrap_or(now);
    let elapsed = (time_base - started_at)
        .num_seconds()
        .max(0)
        .saturating_sub(i64::from(accumulated_paused_seconds.max(0)));
    (i64::from(total) - elapsed).clamp(0, i64::from(total)) as i32
}

fn validate_assessment_response_request(
    request: &AssessmentResponseRequest,
) -> Result<(), AssessmentDeliveryError> {
    if request.revision < 0 {
        return Err(AssessmentDeliveryError::Validation(
            "Response revision cannot be negative.".to_owned(),
        ));
    }
    if request
        .runtime_revision
        .is_some_and(|runtime_revision| runtime_revision < 0)
    {
        return Err(AssessmentDeliveryError::Validation(
            "Runtime revision cannot be negative.".to_owned(),
        ));
    }
    if let Some(module_attempt_id) = request.module_attempt_id.as_deref() {
        let trimmed = module_attempt_id.trim();
        if trimmed.is_empty() || trimmed.len() > 64 {
            return Err(AssessmentDeliveryError::Validation(
                "moduleAttemptId must contain between 1 and 64 characters.".to_owned(),
            ));
        }
    }
    if let Some(stage_key) = request.stage_key.as_deref() {
        let trimmed = stage_key.trim();
        if trimmed.is_empty() || trimmed.len() > 128 {
            return Err(AssessmentDeliveryError::Validation(
                "stageKey must contain between 1 and 128 characters.".to_owned(),
            ));
        }
    }
    if let Some(client_write_id) = request.client_write_id.as_deref() {
        let trimmed = client_write_id.trim();
        if trimmed.is_empty() || trimmed.len() > 128 {
            return Err(AssessmentDeliveryError::Validation(
                "clientWriteId must contain between 1 and 128 characters.".to_owned(),
            ));
        }
    }
    Ok(())
}

fn ensure_module_response_admitted(
    module: &ActiveModuleRow,
    server_received_at: DateTime<Utc>,
) -> Result<(), AssessmentDeliveryError> {
    if !matches!(module.state.as_str(), "active" | "review") {
        return Err(AssessmentDeliveryError::StructuredConflict {
            reason: AssessmentDeliveryConflictReason::ModuleNotActive,
            message: "The SAT module is not active.".to_owned(),
        });
    }
    let Some(started_at) = module.started_at else {
        return Err(AssessmentDeliveryError::StructuredConflict {
            reason: AssessmentDeliveryConflictReason::RuntimeNotLive,
            message: "The SAT module has not been started.".to_owned(),
        });
    };
    if module.paused_at.is_some() {
        return Err(AssessmentDeliveryError::StructuredConflict {
            reason: AssessmentDeliveryConflictReason::RuntimePaused,
            message: "The SAT module is paused by the proctor.".to_owned(),
        });
    }
    let total_seconds = i64::from(
        module
            .allocated_seconds
            .saturating_add(module.extension_seconds)
            .max(0),
    )
    .saturating_add(i64::from(module.accumulated_paused_seconds.max(0)));
    let deadline = started_at + Duration::seconds(total_seconds);
    if server_received_at > deadline {
        return Err(AssessmentDeliveryError::StructuredConflict {
            reason: AssessmentDeliveryConflictReason::DeadlineExpired,
            message: "The SAT module timer has expired.".to_owned(),
        });
    }
    Ok(())
}

fn ensure_module_workable(
    module: &ActiveModuleRow,
    now: DateTime<Utc>,
) -> Result<(), AssessmentDeliveryError> {
    if !matches!(module.state.as_str(), "active" | "review") {
        return Err(AssessmentDeliveryError::Conflict(
            "The SAT module is not active.".to_owned(),
        ));
    }
    if module.started_at.is_none() {
        return Err(AssessmentDeliveryError::Conflict(
            "The SAT module has not been started.".to_owned(),
        ));
    }
    if module.paused_at.is_some() {
        return Err(AssessmentDeliveryError::Conflict(
            "The SAT module is paused by the proctor.".to_owned(),
        ));
    }
    if module_remaining_seconds(
        module.started_at,
        module.paused_at,
        module.allocated_seconds,
        module.extension_seconds,
        module.accumulated_paused_seconds,
        now,
    ) <= 0
    {
        return Err(AssessmentDeliveryError::Conflict(
            "The SAT module timer has expired.".to_owned(),
        ));
    }
    Ok(())
}

fn delivered_question(row: QuestionRow) -> Result<DeliveredQuestion, AssessmentDeliveryError> {
    let question_type: QuestionKind = serde_json::from_value(Value::String(row.question_type))
        .map_err(|error| AssessmentDeliveryError::InvalidData(error.to_string()))?;
    let answer: AnswerDefinition = serde_json::from_value(row.answer_definition)
        .map_err(|error| AssessmentDeliveryError::InvalidData(error.to_string()))?;
    let delivered_answer = match answer {
        AnswerDefinition::SingleChoice { options, .. } => {
            DeliveredAnswerDefinition::SingleChoice { options }
        }
        AnswerDefinition::StudentProducedResponse {
            normalize_fraction,
            normalize_decimal,
            numeric_tolerance,
            ..
        } => DeliveredAnswerDefinition::StudentProducedResponse {
            normalize_fraction,
            normalize_decimal,
            numeric_tolerance,
        },
    };
    Ok(DeliveredQuestion {
        exam_question_id: row.exam_question_id,
        question_id: row.question_id,
        display_order: row.display_order,
        is_pretest: row.is_pretest,
        question_type,
        stimulus: serde_json::from_value(row.stimulus).map_err(invalid_data)?,
        prompt: serde_json::from_value(row.prompt).map_err(invalid_data)?,
        answer: delivered_answer,
        metadata: serde_json::from_value(row.metadata).map_err(invalid_data)?,
        accessibility: serde_json::from_value(row.accessibility).map_err(invalid_data)?,
    })
}

fn parse_answer(value: &Value) -> Result<AnswerDefinition, AssessmentDeliveryError> {
    serde_json::from_value(value.clone()).map_err(invalid_data)
}

fn response_is_correct(answer: &AnswerDefinition, response: Option<&Value>) -> bool {
    let Some(response) = response.and_then(Value::as_str) else {
        return false;
    };
    match answer {
        AnswerDefinition::SingleChoice {
            correct_option_id, ..
        } => correct_option_id.as_deref() == Some(response),
        AnswerDefinition::StudentProducedResponse {
            accepted_responses,
            normalize_fraction,
            normalize_decimal,
            numeric_tolerance,
        } => accepted_responses.iter().any(|accepted| {
            response_matches(
                accepted,
                response,
                *normalize_fraction,
                *normalize_decimal,
                numeric_tolerance.as_deref(),
            )
        }),
    }
}

fn response_matches(
    accepted: &str,
    response: &str,
    normalize_fraction: bool,
    normalize_decimal: bool,
    tolerance: Option<&str>,
) -> bool {
    if normalize_fraction || normalize_decimal {
        if let (Some(accepted_number), Some(response_number)) = (
            parse_numeric_response(accepted, normalize_fraction),
            parse_numeric_response(response, normalize_fraction),
        ) {
            let explicit_tolerance = tolerance
                .and_then(|value| value.parse::<f64>().ok())
                .filter(|value| value.is_finite() && *value >= 0.0)
                .unwrap_or(0.0);
            let scale = accepted_number.abs().max(response_number.abs()).max(1.0);
            let floating_point_floor = f64::EPSILON * scale * 8.0;
            return (accepted_number - response_number).abs()
                <= explicit_tolerance.max(floating_point_floor);
        }
    }
    accepted.trim().eq_ignore_ascii_case(response.trim())
}

fn parse_numeric_response(value: &str, allow_fraction: bool) -> Option<f64> {
    let value = value.trim();
    if allow_fraction {
        if let Some((numerator, denominator)) = value.split_once('/') {
            if denominator.contains('/') {
                return None;
            }
            let numerator = numerator.parse::<f64>().ok()?;
            let denominator = denominator.parse::<f64>().ok()?;
            if !numerator.is_finite() || !denominator.is_finite() || denominator == 0.0 {
                return None;
            }
            return Some(numerator / denominator);
        }
    }
    value.parse::<f64>().ok().filter(|value| value.is_finite())
}

fn response_row_matches_request(
    row: &ResponseRow,
    request: &AssessmentResponseRequest,
) -> Result<bool, AssessmentDeliveryError> {
    let eliminated_options: Vec<String> =
        serde_json::from_value(row.eliminated_options.clone()).map_err(invalid_data)?;
    Ok(row.response == request.response
        && row.marked_for_review == request.marked_for_review
        && eliminated_options == request.eliminated_options
        && row.annotations == request.annotations)
}

fn response_snapshot(
    row: ResponseRow,
) -> Result<AssessmentResponseSnapshot, AssessmentDeliveryError> {
    Ok(AssessmentResponseSnapshot {
        id: row.id,
        module_attempt_id: row.module_attempt_id,
        exam_question_id: row.exam_question_id,
        response: row.response,
        marked_for_review: row.marked_for_review,
        eliminated_options: serde_json::from_value(row.eliminated_options).map_err(invalid_data)?,
        annotations: row.annotations,
        revision: row.revision,
    })
}

fn route_from_adaptive_role(adaptive_role: &str) -> Option<AssessmentRoute> {
    match adaptive_role {
        "lower_branch" => Some(AssessmentRoute::Lower),
        "higher_branch" => Some(AssessmentRoute::Higher),
        _ => None,
    }
}

fn parse_route(route: &str) -> Option<AssessmentRoute> {
    match route {
        "lower" => Some(AssessmentRoute::Lower),
        "higher" => Some(AssessmentRoute::Higher),
        _ => None,
    }
}

fn invalid_data(error: serde_json::Error) -> AssessmentDeliveryError {
    AssessmentDeliveryError::InvalidData(error.to_string())
}

#[cfg(test)]
mod sat_runtime_tests {
    use super::*;
    use chrono::TimeZone;

    fn active_module(
        state: &str,
        started_at: Option<DateTime<Utc>>,
        paused_at: Option<DateTime<Utc>>,
    ) -> ActiveModuleRow {
        ActiveModuleRow {
            id: "attempt-module-1".to_owned(),
            module_id: "module-1".to_owned(),
            state: state.to_owned(),
            allocated_seconds: 120,
            available_at: None,
            started_at,
            paused_at,
            accumulated_paused_seconds: 0,
            extension_seconds: 0,
            completion_reason: None,
        }
    }

    fn choice_answer(correct: &str) -> Value {
        json!({
            "kind": "single_choice",
            "options": [],
            "correct_option_id": correct,
        })
    }

    #[test]
    fn timer_does_not_run_before_explicit_start() {
        let now = Utc.with_ymd_and_hms(2026, 8, 28, 1, 0, 0).unwrap();
        assert_eq!(module_remaining_seconds(None, None, 120, 30, 0, now), 150);
    }

    #[test]
    fn timer_freezes_while_paused_and_includes_extensions() {
        let start = Utc.with_ymd_and_hms(2026, 8, 28, 1, 0, 0).unwrap();
        let paused = start + Duration::seconds(40);
        let later = start + Duration::seconds(100);
        assert_eq!(
            module_remaining_seconds(Some(start), Some(paused), 120, 30, 0, later),
            110
        );
    }

    #[test]
    fn accumulated_pause_time_is_not_charged_again_after_resume() {
        let start = Utc.with_ymd_and_hms(2026, 8, 28, 1, 0, 0).unwrap();
        let now = start + Duration::seconds(100);
        assert_eq!(
            module_remaining_seconds(Some(start), None, 120, 0, 30, now),
            50
        );
    }

    #[test]
    fn exact_deadline_is_expired() {
        let start = Utc.with_ymd_and_hms(2026, 8, 28, 1, 0, 0).unwrap();
        let deadline = start + Duration::seconds(150);
        assert_eq!(
            module_remaining_seconds(Some(start), None, 120, 30, 0, deadline),
            0
        );
    }

    #[test]
    fn workable_guard_rejects_unstarted_paused_and_expired_modules() {
        let start = Utc.with_ymd_and_hms(2026, 8, 28, 1, 0, 0).unwrap();
        assert!(ensure_module_workable(&active_module("not_started", None, None), start).is_err());
        assert!(
            ensure_module_workable(&active_module("active", Some(start), Some(start)), start)
                .is_err()
        );
        assert!(ensure_module_workable(
            &active_module("active", Some(start), None),
            start + Duration::seconds(120)
        )
        .is_err());
    }

    #[test]
    fn scoring_excludes_pretest_items_from_raw_and_operational_counts() {
        let rows = vec![
            ScoringRow {
                is_pretest: true,
                answer_definition: choice_answer("A"),
                response: Some(json!("A")),
            },
            ScoringRow {
                is_pretest: false,
                answer_definition: choice_answer("B"),
                response: Some(json!("B")),
            },
            ScoringRow {
                is_pretest: false,
                answer_definition: choice_answer("C"),
                response: Some(json!("D")),
            },
        ];
        assert_eq!(score_scoring_rows(&rows), (1, 2));
    }

    #[test]
    fn student_response_scoring_normalizes_equivalent_fractions_and_decimals() {
        assert!(response_matches("1/2", "0.5", true, true, None));
        assert!(response_matches("-2/4", "-.5", true, true, None));
        assert!(response_matches("3/4", "0.75", true, true, None));
    }

    #[test]
    fn student_response_scoring_rejects_invalid_fraction_and_respects_tolerance() {
        assert!(!response_matches("1/0", "0", true, true, None));
        assert!(!response_matches("2/3", ".6667", true, true, None));
        assert!(response_matches("2/3", ".6667", true, true, Some("0.0001")));
    }

    #[test]
    fn same_section_branch_has_no_break_but_next_section_uses_configured_break() {
        let now = Utc.with_ymd_and_hms(2026, 8, 28, 1, 0, 0).unwrap();
        assert_eq!(next_module_available_at(now, "rw", "rw", 420), now);
        assert_eq!(
            next_module_available_at(now, "rw", "math", 420),
            now + Duration::seconds(420)
        );
    }
}
