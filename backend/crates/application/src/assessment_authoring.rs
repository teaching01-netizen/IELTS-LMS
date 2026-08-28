use ielts_backend_domain::assessment::{
    AccessibilityMetadata, AnswerDefinition, ChoiceOption, Difficulty, QuestionKind,
    QuestionMetadata, QuestionRevision, SaveQuestionRevisionRequest, StructuredContent,
};
use ielts_backend_domain::exam_provider::{
    provider_for, QuestionValidationContext, ValidationIssue,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{FromRow, MySql, MySqlPool, Transaction};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum AssessmentAuthoringError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("assessment resource was not found")]
    NotFound,
    #[error("assessment revision conflict: {0}")]
    Conflict(String),
    #[error("assessment validation failed")]
    Validation(Vec<ValidationIssue>),
    #[error("assessment data is invalid: {0}")]
    InvalidData(String),
    #[error("assessment provider is not supported")]
    UnsupportedProvider,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentAuthoringShell {
    pub exam_id: String,
    pub provider_key: String,
    pub version_id: String,
    pub version_revision: i32,
    pub sections: Vec<AssessmentSectionShell>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentSectionShell {
    pub id: String,
    pub section_key: String,
    pub title: String,
    pub display_order: i32,
    pub duration_seconds: i32,
    pub break_after_seconds: i32,
    pub revision: i32,
    pub routing_policy: Option<AssessmentRoutingPolicyShell>,
    pub modules: Vec<AssessmentModuleShell>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentRoutingPolicyShell {
    pub id: String,
    pub base_module_id: String,
    pub lower_module_id: String,
    pub higher_module_id: String,
    pub policy_key: String,
    pub minimum_correct_for_higher: i32,
    pub operational_question_count: i32,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentModuleShell {
    pub id: String,
    pub module_key: String,
    pub title: String,
    pub display_order: i32,
    pub duration_seconds: i32,
    pub target_question_count: i32,
    pub adaptive_role: String,
    pub tool_policy: Value,
    pub revision: i32,
    pub questions: Vec<AssessmentQuestionSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionReadinessSummary {
    pub status: String,
    pub blocking_issue_count: usize,
    pub warning_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentQuestionSummary {
    pub exam_question_id: String,
    pub question_id: String,
    pub question_revision_id: String,
    pub display_order: i32,
    pub is_pretest: bool,
    pub question_type: QuestionKind,
    pub semantic_revision: i32,
    pub revision: i32,
    pub readiness: QuestionReadinessSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentQuestionDetail {
    pub exam_question_id: String,
    pub module_id: String,
    pub module_key: String,
    pub section_key: String,
    pub display_order: i32,
    pub is_pretest: bool,
    pub question: QuestionRevision,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentValidationReport {
    pub exam_id: String,
    pub version_id: String,
    pub version_revision: i32,
    pub valid: bool,
    pub errors: Vec<ValidationIssue>,
    pub warnings: Vec<ValidationIssue>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateQuestionRequest {
    pub destination_module_id: Option<String>,
    pub insert_after_exam_question_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderQuestionsRequest {
    pub expected_question_ids: Vec<String>,
    pub question_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BulkQuestionAction {
    Move { destination_module_id: String },
    Duplicate { destination_module_id: String },
    SetPretest { value: bool },
    Delete,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkQuestionRequest {
    pub question_ids: Vec<String>,
    pub action: BulkQuestionAction,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkQuestionResult {
    pub affected_question_ids: Vec<String>,
    pub created_question_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleTimingUpdate {
    pub module_id: String,
    pub duration_seconds: i32,
    pub expected_revision: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSectionDeliverySettingsRequest {
    pub expected_section_revision: i32,
    pub break_after_seconds: i32,
    pub module_timings: Vec<ModuleTimingUpdate>,
    pub minimum_correct_for_higher: i32,
    pub expected_routing_revision: i32,
}

#[derive(Debug, FromRow)]
struct ExamRow {
    id: String,
    provider_key: String,
    current_draft_version_id: Option<String>,
}

#[derive(Debug, FromRow)]
struct SectionRow {
    id: String,
    section_key: String,
    title: String,
    display_order: i32,
    duration_seconds: i32,
    break_after_seconds: i32,
    revision: i32,
}

#[derive(Debug, FromRow)]
struct RoutingPolicyRow {
    id: String,
    base_module_id: String,
    lower_module_id: String,
    higher_module_id: String,
    policy_key: String,
    policy_config: Value,
    revision: i32,
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
    revision: i32,
}

#[derive(Debug, FromRow)]
struct DetailRow {
    exam_question_id: String,
    module_id: String,
    module_key: String,
    section_key: String,
    display_order: i32,
    is_pretest: bool,
    revision_id: String,
    question_id: String,
    semantic_revision: i32,
    revision: i32,
    state: String,
    question_type: String,
    stimulus: Value,
    prompt: Value,
    answer_definition: Value,
    rationale: Value,
    metadata: Value,
    accessibility: Value,
}

pub struct AssessmentAuthoringService {
    pool: MySqlPool,
}

impl AssessmentAuthoringService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub async fn shell(
        &self,
        exam_id: &str,
    ) -> Result<AssessmentAuthoringShell, AssessmentAuthoringError> {
        let exam = self.exam(exam_id).await?;
        let version_id = exam
            .current_draft_version_id
            .ok_or(AssessmentAuthoringError::NotFound)?;
        let version_revision: i32 = sqlx::query_scalar(
            "SELECT revision FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE",
        )
        .bind(&version_id)
        .bind(exam_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AssessmentAuthoringError::NotFound)?;
        let sections = self.sections(&version_id).await?;
        let mut section_shells = Vec::with_capacity(sections.len());
        for section in sections {
            let modules = self.modules(&section.id).await?;
            let mut module_shells = Vec::with_capacity(modules.len());
            for module in modules {
                let questions = self.summaries(&module.id).await?;
                module_shells.push(AssessmentModuleShell {
                    id: module.id,
                    module_key: module.module_key,
                    title: module.title,
                    display_order: module.display_order,
                    duration_seconds: module.duration_seconds,
                    target_question_count: module.target_question_count,
                    adaptive_role: module.adaptive_role,
                    tool_policy: module.tool_policy,
                    revision: module.revision,
                    questions,
                });
            }
            let routing_policy = self.routing_policy(&section.id).await?;
            section_shells.push(AssessmentSectionShell {
                id: section.id,
                section_key: section.section_key,
                title: section.title,
                display_order: section.display_order,
                duration_seconds: section.duration_seconds,
                break_after_seconds: section.break_after_seconds,
                revision: section.revision,
                routing_policy,
                modules: module_shells,
            });
        }
        Ok(AssessmentAuthoringShell {
            exam_id: exam.id,
            provider_key: exam.provider_key,
            version_id,
            version_revision,
            sections: section_shells,
        })
    }

    pub async fn create_question(
        &self,
        module_id: &str,
        actor_id: &str,
    ) -> Result<AssessmentQuestionDetail, AssessmentAuthoringError> {
        let mut tx = self.pool.begin().await?;
        let version_id = lock_current_draft_for_module_tx(&mut tx, module_id).await?;
        let module: (String, String) = sqlx::query_as(
            "SELECT s.section_key, m.module_key FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
        )
        .bind(module_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AssessmentAuthoringError::NotFound)?;
        let next_order: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(display_order), -1) + 1 FROM assessment_exam_questions WHERE module_id = ?",
        )
        .bind(module_id)
        .fetch_one(&mut *tx)
        .await?;
        let question_id = Uuid::new_v4().to_string();
        let revision_id = Uuid::new_v4().to_string();
        let exam_question_id = Uuid::new_v4().to_string();
        let request = default_question(&module.0);
        let question_type = serde_json::to_value(request.question_type)?;
        sqlx::query(
            "INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)",
        )
        .bind(&question_id)
        .bind(actor_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by) VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&revision_id)
        .bind(&question_id)
        .bind(question_type.as_str().unwrap_or("single_choice"))
        .bind(serde_json::to_value(&request.stimulus)?)
        .bind(serde_json::to_value(&request.prompt)?)
        .bind(serde_json::to_value(&request.answer)?)
        .bind(serde_json::to_value(&request.rationale)?)
        .bind(serde_json::to_value(&request.metadata)?)
        .bind(serde_json::to_value(&request.accessibility)?)
        .bind(actor_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&exam_question_id)
        .bind(module_id)
        .bind(&question_id)
        .bind(&revision_id)
        .bind(next_order)
        .execute(&mut *tx)
        .await?;
        touch_draft_version_tx(&mut tx, &version_id).await?;
        tx.commit().await?;
        self.question(&exam_question_id).await
    }

    pub async fn save_question(
        &self,
        exam_question_id: &str,
        request: SaveQuestionRevisionRequest,
        actor_id: &str,
    ) -> Result<AssessmentQuestionDetail, AssessmentAuthoringError> {
        let revision_id: String = sqlx::query_scalar(
            "SELECT question_revision_id FROM assessment_exam_questions WHERE id = ?",
        )
        .bind(exam_question_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AssessmentAuthoringError::NotFound)?;
        self.update_revision(&revision_id, request, actor_id)
            .await?;
        self.question(exam_question_id).await
    }

    pub async fn list_questions(
        &self,
        module_id: &str,
    ) -> Result<Vec<AssessmentQuestionSummary>, AssessmentAuthoringError> {
        self.summaries(module_id).await
    }

    pub async fn save_question_revision(
        &self,
        revision_id: &str,
        request: SaveQuestionRevisionRequest,
        actor_id: &str,
    ) -> Result<QuestionRevision, AssessmentAuthoringError> {
        self.update_revision(revision_id, request, actor_id).await?;
        let exam_question_id: String = sqlx::query_scalar(
            "SELECT id FROM assessment_exam_questions WHERE question_revision_id = ?",
        )
        .bind(revision_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AssessmentAuthoringError::NotFound)?;
        Ok(self.question(&exam_question_id).await?.question)
    }

    pub async fn delete_question(
        &self,
        exam_question_id: &str,
    ) -> Result<(), AssessmentAuthoringError> {
        let mut tx = self.pool.begin().await?;
        let (version_id, module_id) =
            lock_current_draft_for_exam_question_tx(&mut tx, exam_question_id).await?;
        let result = sqlx::query("DELETE FROM assessment_exam_questions WHERE id = ?")
            .bind(exam_question_id)
            .execute(&mut *tx)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AssessmentAuthoringError::NotFound);
        }
        normalize_module_order_tx(&mut tx, &module_id).await?;
        touch_draft_version_tx(&mut tx, &version_id).await?;
        tx.commit().await?;
        Ok(())
    }

    async fn update_revision(
        &self,
        revision_id: &str,
        request: SaveQuestionRevisionRequest,
        actor_id: &str,
    ) -> Result<(), AssessmentAuthoringError> {
        let mut tx = self.pool.begin().await?;
        let version_id = lock_current_draft_for_revision_tx(&mut tx, revision_id).await?;
        let question_type = serde_json::to_value(request.question_type)?;
        let question_type = question_type.as_str().ok_or_else(|| {
            AssessmentAuthoringError::InvalidData("Invalid question type.".to_owned())
        })?;
        let result = sqlx::query(
            "UPDATE assessment_question_revisions SET question_type = ?, stimulus = ?, prompt = ?, answer_definition = ?, rationale = ?, metadata = ?, accessibility = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6), created_by = ? WHERE id = ? AND revision = ? AND state = 'draft'",
        )
        .bind(question_type)
        .bind(serde_json::to_value(&request.stimulus)?)
        .bind(serde_json::to_value(&request.prompt)?)
        .bind(serde_json::to_value(&request.answer)?)
        .bind(serde_json::to_value(&request.rationale)?)
        .bind(serde_json::to_value(&request.metadata)?)
        .bind(serde_json::to_value(&request.accessibility)?)
        .bind(actor_id)
        .bind(revision_id)
        .bind(request.revision)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            return Err(AssessmentAuthoringError::Conflict(
                "Question revision is stale or sealed".to_owned(),
            ));
        }
        touch_draft_version_tx(&mut tx, &version_id).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn question(
        &self,
        exam_question_id: &str,
    ) -> Result<AssessmentQuestionDetail, AssessmentAuthoringError> {
        let row = sqlx::query_as::<_, DetailRow>(
            "SELECT eq.id AS exam_question_id, m.id AS module_id, m.module_key, s.section_key, eq.display_order, eq.is_pretest, qr.id AS revision_id, qr.question_id, qr.semantic_revision, qr.revision, qr.state, qr.question_type, qr.stimulus, qr.prompt, qr.answer_definition, qr.rationale, qr.metadata, qr.accessibility FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE eq.id = ?",
        )
        .bind(exam_question_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AssessmentAuthoringError::NotFound)?;
        detail_from_row(row)
    }

    async fn questions_for_module(
        &self,
        module_id: &str,
    ) -> Result<Vec<AssessmentQuestionDetail>, AssessmentAuthoringError> {
        let rows = sqlx::query_as::<_, DetailRow>(
            "SELECT eq.id AS exam_question_id, m.id AS module_id, m.module_key, s.section_key, eq.display_order, eq.is_pretest, qr.id AS revision_id, qr.question_id, qr.semantic_revision, qr.revision, qr.state, qr.question_type, qr.stimulus, qr.prompt, qr.answer_definition, qr.rationale, qr.metadata, qr.accessibility FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE eq.module_id = ? ORDER BY eq.display_order, eq.id",
        )
        .bind(module_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(detail_from_row).collect()
    }

    pub async fn validate(
        &self,
        exam_id: &str,
    ) -> Result<AssessmentValidationReport, AssessmentAuthoringError> {
        let shell = self.shell(exam_id).await?;
        let provider = provider_for(&shell.provider_key)
            .ok_or(AssessmentAuthoringError::UnsupportedProvider)?;
        let blueprint = provider.blueprint();
        let mut errors = Vec::new();
        let mut warnings = Vec::new();
        for section in &shell.sections {
            let Some(blueprint_section) = blueprint
                .sections
                .iter()
                .find(|candidate| candidate.key == section.section_key)
            else {
                errors.push(structure_issue(
                    &section.section_key,
                    "Section is not part of the SAT provider blueprint.",
                ));
                continue;
            };
            let Some(base) = section
                .modules
                .iter()
                .find(|module| module.adaptive_role == "base")
            else {
                errors.push(structure_issue(
                    "base_module",
                    "Each section needs a base module.",
                ));
                continue;
            };
            if section.break_after_seconds < 0 {
                errors.push(structure_issue(
                    &format!("{}.break", section.section_key),
                    "Section break duration cannot be negative.",
                ));
            } else if section.break_after_seconds != blueprint_section.break_after_seconds {
                warnings.push(warning_issue(
                    "sat.delivery.nonstandard_break",
                    &format!("{}.break", section.section_key),
                    &format!(
                        "{} uses a {} minute break instead of the standard {} minutes.",
                        section.title,
                        section.break_after_seconds / 60,
                        blueprint_section.break_after_seconds / 60,
                    ),
                ));
            }
            for module in &section.modules {
                let blueprint_module = blueprint.module(&section.section_key, &module.module_key);
                let Some(blueprint_module) = blueprint_module else {
                    errors.push(structure_issue(
                        &format!("{}.{}", section.section_key, module.module_key),
                        "Module is not part of the SAT provider blueprint.",
                    ));
                    continue;
                };
                if module.duration_seconds <= 0 {
                    errors.push(structure_issue(
                        &format!("{}.{}.duration", section.section_key, module.module_key),
                        "SAT module duration must be greater than zero.",
                    ));
                } else if module.duration_seconds != blueprint_module.duration_seconds {
                    warnings.push(warning_issue(
                        "sat.delivery.nonstandard_timing",
                        &format!("{}.{}.duration", section.section_key, module.module_key),
                        &format!(
                            "{} uses {} minutes instead of the standard {} minutes.",
                            module.title,
                            module.duration_seconds / 60,
                            blueprint_module.duration_seconds / 60,
                        ),
                    ));
                }
                if module.target_question_count != blueprint_module.question_count {
                    errors.push(structure_issue(
                        &format!("{}.{}.target", section.section_key, module.module_key),
                        "Module target count does not match the SAT provider blueprint.",
                    ));
                }
                let count = i32::try_from(module.questions.len()).unwrap_or(i32::MAX);
                if count != module.target_question_count {
                    errors.push(structure_issue(
                        &format!("{}.{}", section.section_key, module.module_key),
                        "Module question count does not match its blueprint target.",
                    ));
                }
                let pretest_count = module
                    .questions
                    .iter()
                    .filter(|question| question.is_pretest)
                    .count();
                let expected_pretest_count =
                    usize::try_from(blueprint_module.pretest_count).unwrap_or(usize::MAX);
                if pretest_count != expected_pretest_count {
                    errors.push(structure_issue(
                        &format!("{}.{}.pretest", section.section_key, module.module_key),
                        &format!(
                            "{} requires exactly {} pretest item{}.",
                            module.title,
                            blueprint_module.pretest_count,
                            if blueprint_module.pretest_count == 1 {
                                ""
                            } else {
                                "s"
                            },
                        ),
                    ));
                }
                let question_details = self.questions_for_module(&module.id).await?;
                for detail in question_details {
                    let mut question_issues = provider.validate_question(
                        QuestionValidationContext {
                            section_key: &section.section_key,
                            module_key: &module.module_key,
                        },
                        &detail.question,
                    );
                    for mut issue in question_issues.drain(..) {
                        issue.path =
                            format!("examQuestion:{}:{}", detail.exam_question_id, issue.path);
                        if issue.blocking {
                            errors.push(issue);
                        } else {
                            warnings.push(issue);
                        }
                    }
                }
            }
            if section
                .modules
                .iter()
                .all(|module| module.adaptive_role != "lower_branch")
                || section
                    .modules
                    .iter()
                    .all(|module| module.adaptive_role != "higher_branch")
            {
                errors.push(structure_issue(
                    &format!("{}.routing", section.section_key),
                    "Each section needs lower and higher adaptive branches.",
                ));
            }
            if base.questions.is_empty() {
                errors.push(structure_issue(
                    &format!("{}.{}", section.section_key, base.module_key),
                    "The base module must contain questions.",
                ));
            }
            let lower = section
                .modules
                .iter()
                .find(|module| module.adaptive_role == "lower_branch");
            let higher = section
                .modules
                .iter()
                .find(|module| module.adaptive_role == "higher_branch");
            match (&section.routing_policy, lower, higher) {
                (Some(policy), Some(lower), Some(higher)) => {
                    if policy.base_module_id != base.id
                        || policy.lower_module_id != lower.id
                        || policy.higher_module_id != higher.id
                    {
                        errors.push(structure_issue(
                            &format!("{}.routing", section.section_key),
                            "Adaptive routing policy does not match the section module roles.",
                        ));
                    }
                    let operational_questions = blueprint
                        .module(&section.section_key, &base.module_key)
                        .map(|module| (module.question_count - module.pretest_count).max(1))
                        .unwrap_or(1);
                    if policy.minimum_correct_for_higher < 1
                        || policy.minimum_correct_for_higher > operational_questions
                    {
                        errors.push(structure_issue(
                            &format!("{}.routing.threshold", section.section_key),
                            &format!("Higher-route threshold must be between 1 and {operational_questions}."),
                        ));
                    }
                }
                (None, _, _) => errors.push(structure_issue(
                    &format!("{}.routing", section.section_key),
                    "Adaptive routing policy is missing.",
                )),
                _ => {}
            }
        }

        let ending_revision: Option<i32> = sqlx::query_scalar(
            "SELECT revision FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE",
        )
        .bind(&shell.version_id)
        .bind(&shell.exam_id)
        .fetch_optional(&self.pool)
        .await?;
        if ending_revision != Some(shell.version_revision) {
            return Err(AssessmentAuthoringError::Conflict(
                "The SAT draft changed while publish checks were running. Run the checks again."
                    .to_owned(),
            ));
        }

        Ok(AssessmentValidationReport {
            exam_id: shell.exam_id,
            version_id: shell.version_id,
            version_revision: shell.version_revision,
            valid: errors.is_empty(),
            errors,
            warnings,
        })
    }

    pub async fn initialize_sat_draft_tx(
        tx: &mut Transaction<'_, MySql>,
        exam_id: &str,
        actor_id: &str,
    ) -> Result<String, AssessmentAuthoringError> {
        let provider = provider_for("sat").ok_or(AssessmentAuthoringError::UnsupportedProvider)?;
        let blueprint = provider.blueprint();
        let version_number: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM exam_versions WHERE exam_id = ?",
        )
        .bind(exam_id)
        .fetch_one(&mut **tx)
        .await?;
        let version_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO exam_versions (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_draft, is_published, revision) VALUES (?, ?, ?, ?, ?, ?, TRUE, FALSE, 0)",
        )
        .bind(&version_id)
        .bind(exam_id)
        .bind(version_number)
        .bind(json!({"providerKey": "sat"}))
        .bind(json!({
            "providerKey": "sat",
            "scoreKind": "practice",
            "delivery": {
                "launchMode": "proctor_start",
                "transitionMode": "auto_with_proctor_override",
                "allowedExtensionMinutes": [5, 10]
            },
            "progression": {
                "autoSubmit": true,
                "lockAfterSubmit": true,
                "allowPause": true
            },
            "security": {
                "heartbeatIntervalSeconds": 15,
                "heartbeatMissThreshold": 3,
                "pauseOnOffline": true,
                "bufferAnswersOffline": true,
                "requireDeviceContinuityOnReconnect": true
            }
        }))
        .bind(actor_id)
        .execute(&mut **tx)
        .await?;
        for (section_index, section) in blueprint.sections.iter().enumerate() {
            let section_id = Uuid::new_v4().to_string();
            let section_duration = section
                .modules
                .first()
                .map(|module| module.duration_seconds * 2)
                .unwrap_or_default();
            sqlx::query(
                "INSERT INTO assessment_sections (id, exam_version_id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions, tool_policy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&section_id)
            .bind(&version_id)
            .bind(section.key)
            .bind(section.title)
            .bind(i32::try_from(section_index).unwrap_or(i32::MAX))
            .bind(section_duration)
            .bind(section.break_after_seconds)
            .bind(json!({"version": 1, "nodes": []}))
            .bind(json!([]))
            .execute(&mut **tx)
            .await?;
            let mut module_ids: Map<String, Value> = Map::new();
            for (module_index, module) in section.modules.iter().enumerate() {
                let module_id = Uuid::new_v4().to_string();
                module_ids.insert(module.key.to_owned(), Value::String(module_id.clone()));
                let tools = serde_json::to_value(&module.tools)?;
                sqlx::query(
                    "INSERT INTO assessment_modules (id, section_id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, instructions, tool_policy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(&module_id)
                .bind(&section_id)
                .bind(module.key)
                .bind(module.title)
                .bind(i32::try_from(module_index).unwrap_or(i32::MAX))
                .bind(module.duration_seconds)
                .bind(module.question_count)
                .bind(serde_json::to_value(module.adaptive_role)?.as_str().unwrap_or("none"))
                .bind(json!({"version": 1, "nodes": []}))
                .bind(tools)
                .execute(&mut **tx)
                .await?;
            }
            let base_id = module_ids
                .get("rw-m1")
                .or_else(|| module_ids.get("math-m1"));
            let lower_id = module_ids
                .get("rw-m2-lower")
                .or_else(|| module_ids.get("math-m2-lower"));
            let higher_id = module_ids
                .get("rw-m2-higher")
                .or_else(|| module_ids.get("math-m2-higher"));
            let (Some(base_id), Some(lower_id), Some(higher_id)) = (base_id, lower_id, higher_id)
            else {
                return Err(AssessmentAuthoringError::InvalidData(
                    "SAT blueprint is missing an adaptive branch.".to_owned(),
                ));
            };
            let threshold = section
                .modules
                .first()
                .map(|module| {
                    let operational = (module.question_count - module.pretest_count).max(1);
                    operational / 2 + 1
                })
                .unwrap_or(1);
            sqlx::query(
                "INSERT INTO assessment_routing_policies (id, section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config) VALUES (?, ?, ?, ?, ?, 'practice_threshold', ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&section_id)
            .bind(base_id.as_str().ok_or_else(|| AssessmentAuthoringError::InvalidData("Invalid base module id.".to_owned()))?)
            .bind(lower_id.as_str().ok_or_else(|| AssessmentAuthoringError::InvalidData("Invalid lower module id.".to_owned()))?)
            .bind(higher_id.as_str().ok_or_else(|| AssessmentAuthoringError::InvalidData("Invalid higher module id.".to_owned()))?)
            .bind(json!({"minimumCorrectForHigher": threshold}))
            .execute(&mut **tx)
            .await?;
        }
        let score_config = json!({
            "readingWriting": {"lower": practice_scores(27), "higher": practice_scores(27)},
            "math": {"lower": practice_scores(22), "higher": practice_scores(22)}
        });
        sqlx::query(
            "INSERT INTO assessment_scoring_policies (id, exam_version_id, policy_key, policy_config) VALUES (?, ?, 'practice', ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&version_id)
        .bind(score_config)
        .execute(&mut **tx)
        .await?;
        sqlx::query(
            "UPDATE exam_entities SET current_draft_version_id = ?, updated_at = NOW(), revision = revision + 1 WHERE id = ?",
        )
        .bind(&version_id)
        .bind(exam_id)
        .execute(&mut **tx)
        .await?;
        Ok(version_id)
    }

    pub async fn update_section_delivery_settings(
        &self,
        exam_id: &str,
        section_id: &str,
        request: UpdateSectionDeliverySettingsRequest,
    ) -> Result<AssessmentAuthoringShell, AssessmentAuthoringError> {
        if request.break_after_seconds < 0 {
            return Err(AssessmentAuthoringError::InvalidData(
                "Break duration cannot be negative.".to_owned(),
            ));
        }
        if request
            .module_timings
            .iter()
            .any(|timing| timing.duration_seconds <= 0)
        {
            return Err(AssessmentAuthoringError::InvalidData(
                "Every SAT module duration must be greater than zero.".to_owned(),
            ));
        }

        let mut tx = self.pool.begin().await?;
        let locked_version_id =
            lock_current_draft_for_section_tx(&mut tx, exam_id, section_id).await?;
        let owner: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT e.id, e.current_draft_version_id FROM assessment_sections s JOIN exam_versions v ON v.id = s.exam_version_id JOIN exam_entities e ON e.id = v.exam_id WHERE s.id = ? AND e.id = ? FOR UPDATE",
        )
        .bind(section_id)
        .bind(exam_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((_, draft_version_id)) = owner else {
            return Err(AssessmentAuthoringError::NotFound);
        };
        let section_version_id: String =
            sqlx::query_scalar("SELECT exam_version_id FROM assessment_sections WHERE id = ?")
                .bind(section_id)
                .fetch_one(&mut *tx)
                .await?;
        if draft_version_id.as_deref() != Some(section_version_id.as_str()) {
            return Err(AssessmentAuthoringError::Conflict(
                "Only the current SAT draft can be edited.".to_owned(),
            ));
        }

        let section_revision: i32 =
            sqlx::query_scalar("SELECT revision FROM assessment_sections WHERE id = ? FOR UPDATE")
                .bind(section_id)
                .fetch_one(&mut *tx)
                .await?;
        if section_revision != request.expected_section_revision {
            return Err(AssessmentAuthoringError::Conflict(
                "Section delivery settings changed while you were editing.".to_owned(),
            ));
        }

        let modules = sqlx::query_as::<_, ModuleRow>(
            "SELECT id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, tool_policy, revision FROM assessment_modules WHERE section_id = ? ORDER BY display_order FOR UPDATE",
        )
        .bind(section_id)
        .fetch_all(&mut *tx)
        .await?;
        if modules.len() != request.module_timings.len() {
            return Err(AssessmentAuthoringError::InvalidData(
                "Delivery settings must include every module in the section.".to_owned(),
            ));
        }
        for module in &modules {
            let timing = request
                .module_timings
                .iter()
                .find(|timing| timing.module_id == module.id)
                .ok_or_else(|| {
                    AssessmentAuthoringError::InvalidData(
                        "Delivery settings contain an unknown or missing module.".to_owned(),
                    )
                })?;
            if timing.expected_revision != module.revision {
                return Err(AssessmentAuthoringError::Conflict(
                    "Module timing changed while you were editing.".to_owned(),
                ));
            }
        }

        let base = modules
            .iter()
            .find(|module| module.adaptive_role == "base")
            .ok_or_else(|| {
                AssessmentAuthoringError::InvalidData("Base module is missing.".to_owned())
            })?;
        let lower = modules
            .iter()
            .find(|module| module.adaptive_role == "lower_branch")
            .ok_or_else(|| {
                AssessmentAuthoringError::InvalidData(
                    "Lower adaptive module is missing.".to_owned(),
                )
            })?;
        let higher = modules
            .iter()
            .find(|module| module.adaptive_role == "higher_branch")
            .ok_or_else(|| {
                AssessmentAuthoringError::InvalidData(
                    "Higher adaptive module is missing.".to_owned(),
                )
            })?;
        let blueprint = provider_for("sat")
            .ok_or(AssessmentAuthoringError::UnsupportedProvider)?
            .blueprint();
        let expected_pretest_count = blueprint
            .sections
            .iter()
            .flat_map(|section| section.modules.iter())
            .find(|module| module.key == base.module_key)
            .map(|module| module.pretest_count)
            .ok_or_else(|| {
                AssessmentAuthoringError::InvalidData(
                    "Base module is not part of the SAT provider blueprint.".to_owned(),
                )
            })?;
        let operational_questions = (base.target_question_count - expected_pretest_count).max(1);
        if request.minimum_correct_for_higher < 1
            || request.minimum_correct_for_higher > operational_questions
        {
            return Err(AssessmentAuthoringError::InvalidData(format!(
                "Higher-route threshold must be between 1 and {operational_questions} operational questions."
            )));
        }

        let routing = sqlx::query_as::<_, RoutingPolicyRow>(
            "SELECT id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision FROM assessment_routing_policies WHERE section_id = ? FOR UPDATE",
        )
        .bind(section_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AssessmentAuthoringError::InvalidData("Adaptive routing policy is missing.".to_owned()))?;
        if routing.revision != request.expected_routing_revision {
            return Err(AssessmentAuthoringError::Conflict(
                "Adaptive routing settings changed while you were editing.".to_owned(),
            ));
        }
        if routing.base_module_id != base.id
            || routing.lower_module_id != lower.id
            || routing.higher_module_id != higher.id
        {
            return Err(AssessmentAuthoringError::InvalidData(
                "Adaptive routing policy does not match the section module roles.".to_owned(),
            ));
        }

        for timing in &request.module_timings {
            let result = sqlx::query(
                "UPDATE assessment_modules SET duration_seconds = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND section_id = ? AND revision = ?",
            )
            .bind(timing.duration_seconds)
            .bind(&timing.module_id)
            .bind(section_id)
            .bind(timing.expected_revision)
            .execute(&mut *tx)
            .await?;
            if result.rows_affected() != 1 {
                return Err(AssessmentAuthoringError::Conflict(
                    "Module timing changed while you were editing.".to_owned(),
                ));
            }
        }

        let duration_for = |module_id: &str| -> Result<i32, AssessmentAuthoringError> {
            request
                .module_timings
                .iter()
                .find(|timing| timing.module_id == module_id)
                .map(|timing| timing.duration_seconds)
                .ok_or_else(|| {
                    AssessmentAuthoringError::InvalidData("Module timing is missing.".to_owned())
                })
        };
        let section_duration = duration_for(&base.id)?
            .saturating_add(duration_for(&lower.id)?.max(duration_for(&higher.id)?));
        let section_update = sqlx::query(
            "UPDATE assessment_sections SET duration_seconds = ?, break_after_seconds = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND revision = ?",
        )
        .bind(section_duration)
        .bind(request.break_after_seconds)
        .bind(section_id)
        .bind(request.expected_section_revision)
        .execute(&mut *tx)
        .await?;
        if section_update.rows_affected() != 1 {
            return Err(AssessmentAuthoringError::Conflict(
                "Section delivery settings changed while you were editing.".to_owned(),
            ));
        }

        let routing_update = sqlx::query(
            "UPDATE assessment_routing_policies SET policy_config = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
        )
        .bind(json!({"minimumCorrectForHigher": request.minimum_correct_for_higher}))
        .bind(&routing.id)
        .bind(request.expected_routing_revision)
        .execute(&mut *tx)
        .await?;
        if routing_update.rows_affected() != 1 {
            return Err(AssessmentAuthoringError::Conflict(
                "Adaptive routing settings changed while you were editing.".to_owned(),
            ));
        }

        touch_draft_version_tx(&mut tx, &locked_version_id).await?;
        tx.commit().await?;
        self.shell(exam_id).await
    }

    pub async fn seal_draft_tx(
        tx: &mut Transaction<'_, MySql>,
        version_id: &str,
    ) -> Result<(), AssessmentAuthoringError> {
        let revision_ids: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT eq.question_revision_id FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ?",
        )
        .bind(version_id)
        .fetch_all(&mut **tx)
        .await?;
        for revision_id in revision_ids {
            sqlx::query(
                "UPDATE assessment_question_revisions SET state = 'sealed', sealed_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND state = 'draft'",
            )
            .bind(revision_id)
            .execute(&mut **tx)
            .await?;
        }
        Ok(())
    }
}

fn default_question(section_key: &str) -> SaveQuestionRevisionRequest {
    let content = |text: &str| StructuredContent {
        version: 1,
        document: None,
        nodes: vec![ielts_backend_domain::assessment::ContentNode::Paragraph {
            id: Uuid::new_v4().to_string(),
            text: text.to_owned(),
        }],
    };
    SaveQuestionRevisionRequest {
        revision: 0,
        question_type: QuestionKind::SingleChoice,
        stimulus: StructuredContent {
            version: 1,
            document: None,
            nodes: Vec::new(),
        },
        prompt: content("New SAT question"),
        answer: AnswerDefinition::SingleChoice {
            options: ['A', 'B', 'C', 'D']
                .into_iter()
                .map(|label| ChoiceOption {
                    id: label.to_string(),
                    content: content("Enter answer choice"),
                })
                .collect(),
            correct_option_id: None,
        },
        rationale: StructuredContent {
            version: 1,
            document: None,
            nodes: Vec::new(),
        },
        metadata: QuestionMetadata {
            section_key: section_key.to_owned(),
            domain: None,
            skill: None,
            difficulty: Difficulty::Medium,
            tags: Vec::new(),
        },
        accessibility: AccessibilityMetadata {
            long_description: None,
        },
    }
}

fn detail_from_row(row: DetailRow) -> Result<AssessmentQuestionDetail, AssessmentAuthoringError> {
    let question_type = serde_json::from_value(Value::String(row.question_type))
        .map_err(|error| AssessmentAuthoringError::InvalidData(error.to_string()))?;
    let question = QuestionRevision {
        id: row.revision_id,
        question_id: row.question_id,
        semantic_revision: row.semantic_revision,
        revision: row.revision,
        state: row.state,
        question_type,
        stimulus: serde_json::from_value(row.stimulus).map_err(invalid_json)?,
        prompt: serde_json::from_value(row.prompt).map_err(invalid_json)?,
        answer: serde_json::from_value(row.answer_definition).map_err(invalid_json)?,
        rationale: serde_json::from_value(row.rationale).map_err(invalid_json)?,
        metadata: serde_json::from_value(row.metadata).map_err(invalid_json)?,
        accessibility: serde_json::from_value(row.accessibility).map_err(invalid_json)?,
    };
    Ok(AssessmentQuestionDetail {
        exam_question_id: row.exam_question_id,
        module_id: row.module_id,
        module_key: row.module_key,
        section_key: row.section_key,
        display_order: row.display_order,
        is_pretest: row.is_pretest,
        question,
    })
}

fn invalid_json(error: serde_json::Error) -> AssessmentAuthoringError {
    AssessmentAuthoringError::InvalidData(error.to_string())
}

fn structure_issue(path: &str, message: &str) -> ValidationIssue {
    ValidationIssue {
        code: "sat.structure.invalid",
        path: path.to_owned(),
        message: message.to_owned(),
        blocking: true,
    }
}

fn warning_issue(code: &'static str, path: &str, message: &str) -> ValidationIssue {
    ValidationIssue {
        code,
        path: path.to_owned(),
        message: message.to_owned(),
        blocking: false,
    }
}

fn practice_scores(count: i32) -> Value {
    let mut scores = Map::new();
    for raw in 0..=count {
        let score = 200 + (raw * 600 / count.max(1));
        scores.insert(raw.to_string(), Value::Number(score.into()));
    }
    Value::Object(scores)
}

impl AssessmentAuthoringService {
    async fn exam(&self, exam_id: &str) -> Result<ExamRow, AssessmentAuthoringError> {
        sqlx::query_as::<_, ExamRow>(
            "SELECT id, provider_key, current_draft_version_id FROM exam_entities WHERE id = ?",
        )
        .bind(exam_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AssessmentAuthoringError::NotFound)
    }

    async fn sections(
        &self,
        version_id: &str,
    ) -> Result<Vec<SectionRow>, AssessmentAuthoringError> {
        Ok(sqlx::query_as::<_, SectionRow>(
            "SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, revision FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order",
        )
        .bind(version_id)
        .fetch_all(&self.pool)
        .await?)
    }

    async fn modules(&self, section_id: &str) -> Result<Vec<ModuleRow>, AssessmentAuthoringError> {
        Ok(sqlx::query_as::<_, ModuleRow>(
            "SELECT id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, tool_policy, revision FROM assessment_modules WHERE section_id = ? ORDER BY display_order",
        )
        .bind(section_id)
        .fetch_all(&self.pool)
        .await?)
    }

    async fn routing_policy(
        &self,
        section_id: &str,
    ) -> Result<Option<AssessmentRoutingPolicyShell>, AssessmentAuthoringError> {
        let row = sqlx::query_as::<_, RoutingPolicyRow>(
            "SELECT id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision FROM assessment_routing_policies WHERE section_id = ?",
        )
        .bind(section_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let threshold = row
            .policy_config
            .get("minimumCorrectForHigher")
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok())
            .ok_or_else(|| {
                AssessmentAuthoringError::InvalidData(
                    "Routing policy is missing minimumCorrectForHigher.".to_owned(),
                )
            })?;
        let context: (String, String) = sqlx::query_as(
            "SELECT s.section_key, m.module_key FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ? AND s.id = ?",
        )
        .bind(&row.base_module_id)
        .bind(section_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AssessmentAuthoringError::NotFound)?;
        let blueprint = provider_for("sat")
            .ok_or(AssessmentAuthoringError::UnsupportedProvider)?
            .blueprint();
        let blueprint_module = blueprint.module(&context.0, &context.1).ok_or_else(|| {
            AssessmentAuthoringError::InvalidData(
                "Routing base module is not part of the SAT provider blueprint.".to_owned(),
            )
        })?;
        Ok(Some(AssessmentRoutingPolicyShell {
            id: row.id,
            base_module_id: row.base_module_id,
            lower_module_id: row.lower_module_id,
            higher_module_id: row.higher_module_id,
            policy_key: row.policy_key,
            minimum_correct_for_higher: threshold,
            operational_question_count: (blueprint_module.question_count
                - blueprint_module.pretest_count)
                .max(1),
            revision: row.revision,
        }))
    }

    async fn summaries(
        &self,
        module_id: &str,
    ) -> Result<Vec<AssessmentQuestionSummary>, AssessmentAuthoringError> {
        let context: (String, String) = sqlx::query_as(
            "SELECT s.section_key, m.module_key FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
        )
        .bind(module_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AssessmentAuthoringError::NotFound)?;
        let rows = sqlx::query_as::<_, DetailRow>(
            "SELECT eq.id AS exam_question_id, m.id AS module_id, m.module_key, s.section_key, eq.display_order, eq.is_pretest, qr.id AS revision_id, qr.question_id, qr.semantic_revision, qr.revision, qr.state, qr.question_type, qr.stimulus, qr.prompt, qr.answer_definition, qr.rationale, qr.metadata, qr.accessibility FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE eq.module_id = ? ORDER BY eq.display_order",
        )
        .bind(module_id)
        .fetch_all(&self.pool)
        .await?;
        let provider = provider_for("sat").ok_or(AssessmentAuthoringError::UnsupportedProvider)?;
        rows.into_iter()
            .map(|row| {
                let detail = detail_from_row(row)?;
                let issues = provider.validate_question(
                    QuestionValidationContext {
                        section_key: &context.0,
                        module_key: &context.1,
                    },
                    &detail.question,
                );
                let blocking_issue_count = issues.iter().filter(|issue| issue.blocking).count();
                let has_invalid = issues.iter().any(|issue| {
                    issue.blocking
                        && !issue.code.ends_with(".required")
                        && issue.code != "sat.choice.count"
                });
                let status = if blocking_issue_count == 0 {
                    "ready"
                } else if has_invalid {
                    "error"
                } else {
                    "incomplete"
                };
                Ok(AssessmentQuestionSummary {
                    exam_question_id: detail.exam_question_id,
                    question_id: detail.question.question_id,
                    question_revision_id: detail.question.id,
                    display_order: detail.display_order,
                    is_pretest: detail.is_pretest,
                    question_type: detail.question.question_type,
                    semantic_revision: detail.question.semantic_revision,
                    revision: detail.question.revision,
                    readiness: QuestionReadinessSummary {
                        status: status.to_owned(),
                        blocking_issue_count,
                        warning_count: 0,
                    },
                })
            })
            .collect()
    }
}

impl From<serde_json::Error> for AssessmentAuthoringError {
    fn from(error: serde_json::Error) -> Self {
        Self::InvalidData(error.to_string())
    }
}

impl AssessmentAuthoringService {
    pub async fn duplicate_question(
        &self,
        exam_question_id: &str,
        request: DuplicateQuestionRequest,
        actor_id: &str,
    ) -> Result<AssessmentQuestionDetail, AssessmentAuthoringError> {
        let mut tx = self.pool.begin().await?;
        let (version_id, source_module_id) =
            lock_current_draft_for_exam_question_tx(&mut tx, exam_question_id).await?;
        let destination_module_id = request
            .destination_module_id
            .unwrap_or_else(|| source_module_id.clone());
        ensure_same_section_tx(&mut tx, &source_module_id, &destination_module_id).await?;
        ensure_module_capacity_tx(&mut tx, &destination_module_id, 1).await?;
        let insert_order = if let Some(after_id) = request.insert_after_exam_question_id {
            sqlx::query_scalar::<_, i32>(
                "SELECT display_order + 1 FROM assessment_exam_questions WHERE id = ? AND module_id = ?",
            )
            .bind(after_id)
            .bind(&destination_module_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AssessmentAuthoringError::InvalidData("Insert position is not in the destination module.".to_owned()))?
        } else {
            sqlx::query_scalar::<_, i32>(
                "SELECT COALESCE(MAX(display_order), -1) + 1 FROM assessment_exam_questions WHERE module_id = ?",
            )
            .bind(&destination_module_id)
            .fetch_one(&mut *tx)
            .await?
        };
        sqlx::query(
            "UPDATE assessment_exam_questions SET display_order = display_order + 1 WHERE module_id = ? AND display_order >= ?",
        )
        .bind(&destination_module_id)
        .bind(insert_order)
        .execute(&mut *tx)
        .await?;
        let created = duplicate_question_tx(
            &mut tx,
            exam_question_id,
            &destination_module_id,
            insert_order,
            actor_id,
        )
        .await?;
        touch_draft_version_tx(&mut tx, &version_id).await?;
        tx.commit().await?;
        self.question(&created).await
    }

    pub async fn reorder_questions(
        &self,
        module_id: &str,
        request: ReorderQuestionsRequest,
    ) -> Result<Vec<AssessmentQuestionSummary>, AssessmentAuthoringError> {
        let mut tx = self.pool.begin().await?;
        let version_id = lock_current_draft_for_module_tx(&mut tx, module_id).await?;
        let existing: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM assessment_exam_questions WHERE module_id = ? ORDER BY display_order",
        )
        .bind(module_id)
        .fetch_all(&mut *tx)
        .await?;
        if existing != request.expected_question_ids {
            return Err(AssessmentAuthoringError::Conflict(
                "Question order changed while you were editing. The latest order was kept; refresh and try again.".to_owned(),
            ));
        }
        if existing.len() != request.question_ids.len() {
            return Err(AssessmentAuthoringError::Conflict(
                "Question order changed while you were editing. Refresh and try again.".to_owned(),
            ));
        }
        let mut expected = existing.clone();
        let mut requested = request.question_ids.clone();
        expected.sort();
        requested.sort();
        requested.dedup();
        if expected != requested {
            return Err(AssessmentAuthoringError::Conflict(
                "Question order contains missing or duplicate questions.".to_owned(),
            ));
        }
        sqlx::query(
            "UPDATE assessment_exam_questions SET display_order = display_order + 10000 WHERE module_id = ?",
        )
        .bind(module_id)
        .execute(&mut *tx)
        .await?;
        for (index, question_id) in request.question_ids.iter().enumerate() {
            sqlx::query(
                "UPDATE assessment_exam_questions SET display_order = ? WHERE id = ? AND module_id = ?",
            )
            .bind(i32::try_from(index).unwrap_or(i32::MAX))
            .bind(question_id)
            .bind(module_id)
            .execute(&mut *tx)
            .await?;
        }
        touch_draft_version_tx(&mut tx, &version_id).await?;
        tx.commit().await?;
        self.summaries(module_id).await
    }

    pub async fn bulk_questions(
        &self,
        request: BulkQuestionRequest,
        actor_id: &str,
    ) -> Result<BulkQuestionResult, AssessmentAuthoringError> {
        if request.question_ids.is_empty() {
            return Ok(BulkQuestionResult {
                affected_question_ids: Vec::new(),
                created_question_ids: Vec::new(),
            });
        }
        let mut unique = request.question_ids.clone();
        unique.sort();
        unique.dedup();
        if unique.len() != request.question_ids.len() {
            return Err(AssessmentAuthoringError::InvalidData(
                "Bulk selection contains duplicate question ids.".to_owned(),
            ));
        }
        let mut tx = self.pool.begin().await?;
        let first_question_id = request.question_ids.first().ok_or_else(|| {
            AssessmentAuthoringError::InvalidData("Bulk selection is empty.".to_owned())
        })?;
        let (version_id, _) =
            lock_current_draft_for_exam_question_tx(&mut tx, first_question_id).await?;
        let mut source_modules = Vec::new();
        for question_id in &request.question_ids {
            let module_id: String =
                sqlx::query_scalar("SELECT module_id FROM assessment_exam_questions WHERE id = ?")
                    .bind(question_id)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or(AssessmentAuthoringError::NotFound)?;
            if assessment_version_for_module_tx(&mut tx, &module_id).await? != version_id {
                return Err(AssessmentAuthoringError::InvalidData(
                    "Bulk actions cannot span SAT draft versions.".to_owned(),
                ));
            }
            if !source_modules.contains(&module_id) {
                source_modules.push(module_id);
            }
        }
        let mut created_question_ids = Vec::new();
        match &request.action {
            BulkQuestionAction::Delete => {
                for question_id in &request.question_ids {
                    sqlx::query("DELETE FROM assessment_exam_questions WHERE id = ?")
                        .bind(question_id)
                        .execute(&mut *tx)
                        .await?;
                }
                for module_id in &source_modules {
                    normalize_module_order_tx(&mut tx, module_id).await?;
                }
            }
            BulkQuestionAction::SetPretest { value } => {
                if *value {
                    for module_id in &source_modules {
                        let existing_pretest: i64 = sqlx::query_scalar(
                            "SELECT COUNT(*) FROM assessment_exam_questions WHERE module_id = ? AND is_pretest = TRUE",
                        )
                        .bind(module_id)
                        .fetch_one(&mut *tx)
                        .await?;
                        let mut newly_selected = 0_i64;
                        for question_id in &request.question_ids {
                            let row: (String, bool) = sqlx::query_as(
                                "SELECT module_id, is_pretest FROM assessment_exam_questions WHERE id = ?",
                            )
                            .bind(question_id)
                            .fetch_one(&mut *tx)
                            .await?;
                            if row.0 == *module_id && !row.1 {
                                newly_selected += 1;
                            }
                        }
                        if existing_pretest + newly_selected > 2 {
                            return Err(AssessmentAuthoringError::InvalidData(
                                "Each SAT module can have at most two pretest questions."
                                    .to_owned(),
                            ));
                        }
                    }
                }
                for question_id in &request.question_ids {
                    sqlx::query("UPDATE assessment_exam_questions SET is_pretest = ? WHERE id = ?")
                        .bind(*value)
                        .bind(question_id)
                        .execute(&mut *tx)
                        .await?;
                }
            }
            BulkQuestionAction::Move {
                destination_module_id,
            } => {
                if assessment_version_for_module_tx(&mut tx, destination_module_id).await?
                    != version_id
                {
                    return Err(AssessmentAuthoringError::InvalidData(
                        "Bulk actions cannot span SAT draft versions.".to_owned(),
                    ));
                }
                ensure_module_capacity_tx(
                    &mut tx,
                    destination_module_id,
                    request.question_ids.len(),
                )
                .await?;
                for source_module_id in &source_modules {
                    ensure_same_section_tx(&mut tx, source_module_id, destination_module_id)
                        .await?;
                }
                let mut next_order: i32 = sqlx::query_scalar(
                    "SELECT COALESCE(MAX(display_order), -1) + 1 FROM assessment_exam_questions WHERE module_id = ?",
                )
                .bind(destination_module_id)
                .fetch_one(&mut *tx)
                .await?;
                for question_id in &request.question_ids {
                    sqlx::query(
                        "UPDATE assessment_exam_questions SET module_id = ?, display_order = ? WHERE id = ?",
                    )
                    .bind(destination_module_id)
                    .bind(next_order)
                    .bind(question_id)
                    .execute(&mut *tx)
                    .await?;
                    next_order += 1;
                }
                for module_id in &source_modules {
                    if module_id != destination_module_id {
                        normalize_module_order_tx(&mut tx, module_id).await?;
                    }
                }
                normalize_module_order_tx(&mut tx, destination_module_id).await?;
            }
            BulkQuestionAction::Duplicate {
                destination_module_id,
            } => {
                if assessment_version_for_module_tx(&mut tx, destination_module_id).await?
                    != version_id
                {
                    return Err(AssessmentAuthoringError::InvalidData(
                        "Bulk actions cannot span SAT draft versions.".to_owned(),
                    ));
                }
                ensure_module_capacity_tx(
                    &mut tx,
                    destination_module_id,
                    request.question_ids.len(),
                )
                .await?;
                for source_module_id in &source_modules {
                    ensure_same_section_tx(&mut tx, source_module_id, destination_module_id)
                        .await?;
                }
                let mut next_order: i32 = sqlx::query_scalar(
                    "SELECT COALESCE(MAX(display_order), -1) + 1 FROM assessment_exam_questions WHERE module_id = ?",
                )
                .bind(destination_module_id)
                .fetch_one(&mut *tx)
                .await?;
                for question_id in &request.question_ids {
                    let created = duplicate_question_tx(
                        &mut tx,
                        question_id,
                        destination_module_id,
                        next_order,
                        actor_id,
                    )
                    .await?;
                    created_question_ids.push(created);
                    next_order += 1;
                }
            }
        }
        touch_draft_version_tx(&mut tx, &version_id).await?;
        tx.commit().await?;
        Ok(BulkQuestionResult {
            affected_question_ids: request.question_ids,
            created_question_ids,
        })
    }
}

async fn ensure_same_section_tx(
    tx: &mut Transaction<'_, MySql>,
    source_module_id: &str,
    destination_module_id: &str,
) -> Result<(), AssessmentAuthoringError> {
    let source_section: String =
        sqlx::query_scalar("SELECT section_id FROM assessment_modules WHERE id = ?")
            .bind(source_module_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or(AssessmentAuthoringError::NotFound)?;
    let destination_section: String =
        sqlx::query_scalar("SELECT section_id FROM assessment_modules WHERE id = ?")
            .bind(destination_module_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or(AssessmentAuthoringError::NotFound)?;
    if source_section != destination_section {
        return Err(AssessmentAuthoringError::InvalidData(
            "Questions can only be moved or duplicated within the same SAT section.".to_owned(),
        ));
    }
    Ok(())
}

async fn ensure_module_capacity_tx(
    tx: &mut Transaction<'_, MySql>,
    module_id: &str,
    additional: usize,
) -> Result<(), AssessmentAuthoringError> {
    let target: i32 =
        sqlx::query_scalar("SELECT target_question_count FROM assessment_modules WHERE id = ?")
            .bind(module_id)
            .fetch_optional(&mut **tx)
            .await?
            .ok_or(AssessmentAuthoringError::NotFound)?;
    let current: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM assessment_exam_questions WHERE module_id = ?")
            .bind(module_id)
            .fetch_one(&mut **tx)
            .await?;
    if current + i64::try_from(additional).unwrap_or(i64::MAX) > i64::from(target) {
        return Err(AssessmentAuthoringError::InvalidData(
            "This action would exceed the SAT module question target.".to_owned(),
        ));
    }
    Ok(())
}

async fn normalize_module_order_tx(
    tx: &mut Transaction<'_, MySql>,
    module_id: &str,
) -> Result<(), AssessmentAuthoringError> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM assessment_exam_questions WHERE module_id = ? ORDER BY display_order, id",
    )
    .bind(module_id)
    .fetch_all(&mut **tx)
    .await?;
    for (index, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE assessment_exam_questions SET display_order = ? WHERE id = ?")
            .bind(i32::try_from(index).unwrap_or(i32::MAX))
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

async fn duplicate_question_tx(
    tx: &mut Transaction<'_, MySql>,
    source_exam_question_id: &str,
    destination_module_id: &str,
    display_order: i32,
    actor_id: &str,
) -> Result<String, AssessmentAuthoringError> {
    let source = sqlx::query_as::<_, DetailRow>(
        "SELECT eq.id AS exam_question_id, m.id AS module_id, m.module_key, s.section_key, eq.display_order, eq.is_pretest, qr.id AS revision_id, qr.question_id, qr.semantic_revision, qr.revision, qr.state, qr.question_type, qr.stimulus, qr.prompt, qr.answer_definition, qr.rationale, qr.metadata, qr.accessibility FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE eq.id = ?",
    )
    .bind(source_exam_question_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(AssessmentAuthoringError::NotFound)?;
    let question_id = Uuid::new_v4().to_string();
    let revision_id = Uuid::new_v4().to_string();
    let exam_question_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)",
    )
    .bind(&question_id)
    .bind(actor_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by) VALUES (?, ?, 1, 0, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&revision_id)
    .bind(&question_id)
    .bind(&source.question_type)
    .bind(source.stimulus)
    .bind(source.prompt)
    .bind(source.answer_definition)
    .bind(source.rationale)
    .bind(source.metadata)
    .bind(source.accessibility)
    .bind(actor_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest) VALUES (?, ?, ?, ?, ?, FALSE)",
    )
    .bind(&exam_question_id)
    .bind(destination_module_id)
    .bind(&question_id)
    .bind(&revision_id)
    .bind(display_order)
    .execute(&mut **tx)
    .await?;
    Ok(exam_question_id)
}

async fn lock_current_draft_aggregate_tx(
    tx: &mut Transaction<'_, MySql>,
    exam_id: &str,
    version_id: &str,
) -> Result<(), AssessmentAuthoringError> {
    let exam_row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT current_draft_version_id FROM exam_entities WHERE id = ? FOR UPDATE",
    )
    .bind(exam_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((current_draft_version_id,)) = exam_row else {
        return Err(AssessmentAuthoringError::NotFound);
    };
    if current_draft_version_id.as_deref() != Some(version_id) {
        return Err(AssessmentAuthoringError::Conflict(
            "Only the current SAT draft can be edited.".to_owned(),
        ));
    }

    let draft_revision: Option<i32> = sqlx::query_scalar(
        "SELECT revision FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE FOR UPDATE",
    )
    .bind(version_id)
    .bind(exam_id)
    .fetch_optional(&mut **tx)
    .await?;
    if draft_revision.is_none() {
        return Err(AssessmentAuthoringError::Conflict(
            "Only the current SAT draft can be edited.".to_owned(),
        ));
    }
    Ok(())
}

async fn lock_current_draft_for_module_tx(
    tx: &mut Transaction<'_, MySql>,
    module_id: &str,
) -> Result<String, AssessmentAuthoringError> {
    let owner: Option<(String, String)> = sqlx::query_as(
        "SELECT e.id, v.id FROM assessment_modules m \
         JOIN assessment_sections s ON s.id = m.section_id \
         JOIN exam_versions v ON v.id = s.exam_version_id \
         JOIN exam_entities e ON e.id = v.exam_id WHERE m.id = ?",
    )
    .bind(module_id)
    .fetch_optional(&mut **tx)
    .await?;
    let (exam_id, version_id) = owner.ok_or(AssessmentAuthoringError::NotFound)?;
    lock_current_draft_aggregate_tx(tx, &exam_id, &version_id).await?;

    let locked_version_id: Option<String> = sqlx::query_scalar(
        "SELECT s.exam_version_id FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ? FOR UPDATE",
    )
    .bind(module_id)
    .fetch_optional(&mut **tx)
    .await?;
    if locked_version_id.as_deref() != Some(version_id.as_str()) {
        return Err(AssessmentAuthoringError::Conflict(
            "The SAT module changed while you were editing.".to_owned(),
        ));
    }
    Ok(version_id)
}

async fn lock_current_draft_for_exam_question_tx(
    tx: &mut Transaction<'_, MySql>,
    exam_question_id: &str,
) -> Result<(String, String), AssessmentAuthoringError> {
    let owner: Option<(String, String)> = sqlx::query_as(
        "SELECT e.id, v.id FROM assessment_exam_questions eq \
         JOIN assessment_modules m ON m.id = eq.module_id \
         JOIN assessment_sections s ON s.id = m.section_id \
         JOIN exam_versions v ON v.id = s.exam_version_id \
         JOIN exam_entities e ON e.id = v.exam_id WHERE eq.id = ?",
    )
    .bind(exam_question_id)
    .fetch_optional(&mut **tx)
    .await?;
    let (exam_id, version_id) = owner.ok_or(AssessmentAuthoringError::NotFound)?;
    lock_current_draft_aggregate_tx(tx, &exam_id, &version_id).await?;

    let locked: Option<(String, String)> = sqlx::query_as(
        "SELECT s.exam_version_id, m.id FROM assessment_exam_questions eq \
         JOIN assessment_modules m ON m.id = eq.module_id \
         JOIN assessment_sections s ON s.id = m.section_id WHERE eq.id = ? FOR UPDATE",
    )
    .bind(exam_question_id)
    .fetch_optional(&mut **tx)
    .await?;
    let (locked_version_id, module_id) = locked.ok_or(AssessmentAuthoringError::NotFound)?;
    if locked_version_id != version_id {
        return Err(AssessmentAuthoringError::Conflict(
            "The SAT question changed while you were editing.".to_owned(),
        ));
    }
    Ok((version_id, module_id))
}

async fn lock_current_draft_for_revision_tx(
    tx: &mut Transaction<'_, MySql>,
    revision_id: &str,
) -> Result<String, AssessmentAuthoringError> {
    let owner: Option<(String, String)> = sqlx::query_as(
        "SELECT e.id, v.id FROM assessment_question_revisions qr \
         JOIN assessment_exam_questions eq ON eq.question_revision_id = qr.id \
         JOIN assessment_modules m ON m.id = eq.module_id \
         JOIN assessment_sections s ON s.id = m.section_id \
         JOIN exam_versions v ON v.id = s.exam_version_id \
         JOIN exam_entities e ON e.id = v.exam_id WHERE qr.id = ?",
    )
    .bind(revision_id)
    .fetch_optional(&mut **tx)
    .await?;
    let (exam_id, version_id) = owner.ok_or(AssessmentAuthoringError::NotFound)?;
    lock_current_draft_aggregate_tx(tx, &exam_id, &version_id).await?;

    let locked_version_id: Option<String> = sqlx::query_scalar(
        "SELECT s.exam_version_id FROM assessment_question_revisions qr \
         JOIN assessment_exam_questions eq ON eq.question_revision_id = qr.id \
         JOIN assessment_modules m ON m.id = eq.module_id \
         JOIN assessment_sections s ON s.id = m.section_id WHERE qr.id = ? FOR UPDATE",
    )
    .bind(revision_id)
    .fetch_optional(&mut **tx)
    .await?;
    if locked_version_id.as_deref() != Some(version_id.as_str()) {
        return Err(AssessmentAuthoringError::Conflict(
            "The SAT question revision changed while you were editing.".to_owned(),
        ));
    }
    Ok(version_id)
}

async fn lock_current_draft_for_section_tx(
    tx: &mut Transaction<'_, MySql>,
    exam_id: &str,
    section_id: &str,
) -> Result<String, AssessmentAuthoringError> {
    let version_id: Option<String> = sqlx::query_scalar(
        "SELECT s.exam_version_id FROM assessment_sections s \
         JOIN exam_versions v ON v.id = s.exam_version_id WHERE s.id = ? AND v.exam_id = ?",
    )
    .bind(section_id)
    .bind(exam_id)
    .fetch_optional(&mut **tx)
    .await?;
    let version_id = version_id.ok_or(AssessmentAuthoringError::NotFound)?;
    lock_current_draft_aggregate_tx(tx, exam_id, &version_id).await?;

    let locked_version_id: Option<String> = sqlx::query_scalar(
        "SELECT exam_version_id FROM assessment_sections WHERE id = ? FOR UPDATE",
    )
    .bind(section_id)
    .fetch_optional(&mut **tx)
    .await?;
    if locked_version_id.as_deref() != Some(version_id.as_str()) {
        return Err(AssessmentAuthoringError::Conflict(
            "The SAT section changed while you were editing.".to_owned(),
        ));
    }
    Ok(version_id)
}

async fn assessment_version_for_module_tx(
    tx: &mut Transaction<'_, MySql>,
    module_id: &str,
) -> Result<String, AssessmentAuthoringError> {
    sqlx::query_scalar(
        "SELECT s.exam_version_id FROM assessment_modules m \
         JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
    )
    .bind(module_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(AssessmentAuthoringError::NotFound)
}

async fn touch_draft_version_tx(
    tx: &mut Transaction<'_, MySql>,
    version_id: &str,
) -> Result<(), AssessmentAuthoringError> {
    let updated = sqlx::query(
        "UPDATE exam_versions SET revision = revision + 1 WHERE id = ? AND is_draft = TRUE",
    )
    .bind(version_id)
    .execute(&mut **tx)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(AssessmentAuthoringError::Conflict(
            "The SAT draft changed while you were editing.".to_owned(),
        ));
    }
    Ok(())
}
