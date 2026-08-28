use chrono::{DateTime, Duration, Utc};
use ielts_backend_domain::assessment::{
    AnswerDefinition, AssessmentAttemptSnapshot, AssessmentDeliveryBootstrap,
    AssessmentDeliveryModule, AssessmentDeliverySection, AssessmentModuleAttemptSnapshot,
    AssessmentModuleStartRequest, AssessmentModuleSubmitRequest, AssessmentResponseRequest,
    AssessmentResponseSnapshot, AssessmentResult, AssessmentRoute, AssessmentSectionResult,
    AssessmentSubmitRequest, DeliveredAnswerDefinition, DeliveredQuestion, QuestionKind, ScoreKind,
};
use ielts_backend_domain::exam_provider::provider_for;
use serde_json::{json, Value};
use sqlx::{FromRow, MySql, MySqlPool, Transaction};
use std::collections::BTreeMap;
use thiserror::Error;
use uuid::Uuid;

use crate::adaptive_routing::{AdaptiveRoute, AdaptiveRoutingPolicy, PracticeThresholdRouting};
use crate::assessment_scoring::{score_section, total_score};

#[derive(Debug, Error)]
pub enum AssessmentDeliveryError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("assessment delivery resource was not found")]
    NotFound,
    #[error("assessment delivery conflict: {0}")]
    Conflict(String),
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
    proctor_status: String,
    proctor_note: Option<String>,
    device_fingerprint_hash: Option<String>,
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
            "SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? FOR UPDATE",
        )
        .bind(attempt_id)
        .bind(&request.module_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AssessmentDeliveryError::NotFound)?;
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
        let now = Utc::now();
        if module.available_at.is_some_and(|available| now < available) {
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
        sqlx::query(
            "UPDATE student_attempts SET phase = 'exam', updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1 WHERE id = ?",
        )
        .bind(attempt_id)
        .execute(&mut *tx)
        .await?;
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
        let binding = self.schedule_binding(schedule_id).await?;
        self.ensure_attempt_binding(&binding, attempt_id).await?;
        self.reconcile_attempt_timeout(schedule_id, attempt_id, Utc::now())
            .await?;
        let mut tx = self.pool.begin().await?;
        self.ensure_attempt_can_work_tx(&mut tx, schedule_id, attempt_id)
            .await?;
        let active = sqlx::query_as::<_, ActiveModuleRow>(
            "SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds FROM assessment_module_attempts WHERE attempt_id = ? AND state IN ('active', 'review') ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        )
        .bind(attempt_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AssessmentDeliveryError::Conflict("There is no active SAT module.".to_owned()))?;
        ensure_module_workable(&active, Utc::now())?;
        let belongs: Option<String> = sqlx::query_scalar(
            "SELECT id FROM assessment_exam_questions WHERE id = ? AND module_id = ?",
        )
        .bind(exam_question_id)
        .bind(&active.module_id)
        .fetch_optional(&mut *tx)
        .await?;
        if belongs.is_none() {
            return Err(AssessmentDeliveryError::Validation(
                "Question does not belong to the active module.".to_owned(),
            ));
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
        let current_revision = existing.as_ref().map(|row| row.revision);
        match current_revision {
            Some(revision) if revision != request.revision => {
                return Err(AssessmentDeliveryError::Conflict(
                    "Question response is stale.".to_owned(),
                ));
            }
            None if request.revision != 0 => {
                return Err(AssessmentDeliveryError::Conflict(
                    "Question response does not start at revision zero.".to_owned(),
                ));
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
            "SELECT ma.id, ma.module_id, ma.state, ma.allocated_seconds, ma.available_at, ma.started_at, ma.paused_at, ma.accumulated_paused_seconds, ma.extension_seconds FROM assessment_module_attempts ma WHERE ma.attempt_id = ? AND ma.module_id = ? FOR UPDATE",
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
        ensure_module_workable(&active, Utc::now())?;
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
        sqlx::query(
            "UPDATE student_attempts SET phase = 'post-exam', final_submission = ?, submitted_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1 WHERE id = ?",
        )
        .bind(final_submission)
        .bind(&attempt.id)
        .execute(&mut *tx)
        .await?;
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

    async fn load_assessment(
        &self,
        version_id: &str,
    ) -> Result<(Vec<AssessmentDeliverySection>, NextModuleRow), AssessmentDeliveryError> {
        let section_rows = sqlx::query_as::<_, SectionRow>(
            "SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order",
        )
        .bind(version_id)
        .fetch_all(&self.pool)
        .await?;
        let mut sections = Vec::with_capacity(section_rows.len());
        let mut first_base: Option<NextModuleRow> = None;
        for section in section_rows {
            let module_rows = sqlx::query_as::<_, ModuleRow>(
                "SELECT id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, tool_policy FROM assessment_modules WHERE section_id = ? ORDER BY display_order",
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
                modules,
            });
        }
        Ok((
            sections,
            first_base.ok_or(AssessmentDeliveryError::NotFound)?,
        ))
    }

    async fn bootstrap_payload(
        &self,
        binding: ScheduleBindingRow,
        attempt_id: &str,
        sections: Vec<AssessmentDeliverySection>,
    ) -> Result<AssessmentDeliveryBootstrap, AssessmentDeliveryError> {
        let result = self.load_result(attempt_id).await?;
        let control = self.attempt_control(attempt_id).await?;
        let schedule_runtime_status: Option<String> =
            sqlx::query_scalar("SELECT status FROM exam_session_runtimes WHERE schedule_id = ?")
                .bind(&binding.schedule_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(AssessmentDeliveryBootstrap {
            schedule_id: binding.schedule_id,
            exam_id: binding.exam_id,
            provider_key: binding.provider_key,
            version_id: binding.published_version_id,
            server_now: Utc::now(),
            schedule_runtime_status: schedule_runtime_status
                .unwrap_or_else(|| "not_started".to_owned()),
            proctor_status: control.proctor_status,
            proctor_note: control.proctor_note,
            device_fingerprint_hash: control.device_fingerprint_hash,
            sections,
            attempt: self.attempt_snapshot(attempt_id).await?,
            result,
        })
    }

    async fn attempt_control(
        &self,
        attempt_id: &str,
    ) -> Result<AttemptControlRow, AssessmentDeliveryError> {
        sqlx::query_as::<_, AttemptControlRow>(
            "SELECT COALESCE(proctor_status, 'active') AS proctor_status, proctor_note, JSON_UNQUOTE(JSON_EXTRACT(integrity, '$.deviceFingerprintHash')) AS device_fingerprint_hash FROM student_attempts WHERE id = ?",
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
                let deadline_at = if row.started_at.is_some() && row.paused_at.is_none() {
                    Some(now + Duration::seconds(i64::from(remaining_seconds.max(0))))
                } else {
                    None
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
                return Err(AssessmentDeliveryError::Conflict(
                    "The SAT session is paused by the proctor.".to_owned(),
                ));
            }
            _ => {
                return Err(AssessmentDeliveryError::Conflict(
                    "The SAT session has not been started by the proctor.".to_owned(),
                ));
            }
        }
        let control = sqlx::query_as::<_, AttemptControlRow>(
            "SELECT COALESCE(proctor_status, 'active') AS proctor_status, proctor_note, JSON_UNQUOTE(JSON_EXTRACT(integrity, '$.deviceFingerprintHash')) AS device_fingerprint_hash FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",
        )
        .bind(attempt_id)
        .bind(schedule_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(AssessmentDeliveryError::NotFound)?;
        match control.proctor_status.as_str() {
            "paused" => Err(AssessmentDeliveryError::Conflict(
                "Your SAT attempt is paused by the proctor.".to_owned(),
            )),
            "terminated" => Err(AssessmentDeliveryError::Conflict(
                "Your SAT attempt has been terminated by the proctor.".to_owned(),
            )),
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
            "UPDATE assessment_module_attempts SET state = ?, submitted_at = CURRENT_TIMESTAMP(6), locked_at = CASE WHEN ? THEN CURRENT_TIMESTAMP(6) ELSE locked_at END, paused_at = NULL, completion_reason = ?, raw_correct = ?, operational_question_count = ?, revision = revision + 1 WHERE id = ? AND state IN ('active', 'review')",
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
            let now = Utc::now();
            let available_at = Some(next_module_available_at(
                now,
                &current_section.0,
                &next_module.section_id,
                current_section.1,
            ));
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
        let active = sqlx::query_as::<_, ActiveModuleRow>(
            "SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds FROM assessment_module_attempts WHERE attempt_id = ? AND state = 'active' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        )
        .bind(attempt_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(active) = active else {
            tx.commit().await?;
            return Ok(false);
        };
        if active.paused_at.is_some()
            || module_remaining_seconds(
                active.started_at,
                active.paused_at,
                active.allocated_seconds,
                active.extension_seconds,
                active.accumulated_paused_seconds,
                as_of,
            ) > 0
        {
            tx.commit().await?;
            return Ok(false);
        }
        let next = self
            .finalize_module_tx(&mut tx, attempt_id, &active, "time_expired")
            .await?;
        tx.commit().await?;
        if next.is_none() {
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
        Ok(true)
    }

    pub async fn reconcile_expired_modules_at(
        &self,
        as_of: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<SatTimeoutOutcome>, AssessmentDeliveryError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT ma.attempt_id, sa.schedule_id FROM assessment_module_attempts ma JOIN student_attempts sa ON sa.id = ma.attempt_id JOIN exam_entities e ON e.id = sa.exam_id WHERE e.provider_key = 'sat' AND ma.state = 'active' AND ma.started_at IS NOT NULL AND ma.paused_at IS NULL AND ? >= DATE_ADD(ma.started_at, INTERVAL (ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds) SECOND) ORDER BY ma.started_at LIMIT ?",
        )
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
        sqlx::query(
            "UPDATE student_attempts SET phase = 'post-exam', final_submission = ?, submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP(6)), updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1 WHERE id = ? AND schedule_id = ?",
        )
        .bind(json!({"providerKey": "sat", "terminated": true, "reason": reason}))
        .bind(attempt_id)
        .bind(schedule_id)
        .execute(&mut *tx)
        .await?;
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
        let accepted_number = accepted.parse::<f64>();
        let response_number = response.parse::<f64>();
        if let (Ok(accepted_number), Ok(response_number)) = (accepted_number, response_number) {
            let allowed = tolerance
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(0.0);
            return (accepted_number - response_number).abs() <= allowed;
        }
    }
    accepted.trim().eq_ignore_ascii_case(response.trim())
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
    fn same_section_branch_has_no_break_but_next_section_uses_configured_break() {
        let now = Utc.with_ymd_and_hms(2026, 8, 28, 1, 0, 0).unwrap();
        assert_eq!(next_module_available_at(now, "rw", "rw", 420), now);
        assert_eq!(
            next_module_available_at(now, "rw", "math", 420),
            now + Duration::seconds(420)
        );
    }
}
