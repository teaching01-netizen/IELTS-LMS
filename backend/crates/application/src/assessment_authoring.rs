use std::collections::{HashMap, HashSet};

use ielts_backend_domain::assessment::{
    AccessibilityMetadata, AnswerDefinition, AssessmentDeliverySection, AssessmentTool,
    ChoiceOption, Difficulty, QuestionKind, QuestionMetadata, QuestionRevision,
    SaveQuestionRevisionRequest, StructuredContent,
};
use ielts_backend_domain::exam_provider::{
    provider_for, QuestionValidationContext, ValidationIssue,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{FromRow, MySql, MySqlPool, QueryBuilder, Transaction};
use thiserror::Error;
use uuid::Uuid;

use crate::assessment_delivery::{AssessmentDeliveryError, AssessmentDeliveryService};

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
pub struct SatWorkbookUndoState {
    pub import_id: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SatWorkbookCommitResult {
    pub shell: AssessmentAuthoringShell,
    pub undo: SatWorkbookUndoState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentPreviewProjection {
    pub exam_id: String,
    pub provider_key: String,
    pub version_id: String,
    pub version_revision: i32,
    pub sections: Vec<AssessmentDeliverySection>,
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
    pub prompt_preview: String,
    pub answer_key_preview: Option<String>,
    pub domain: Option<String>,
    pub skill: Option<String>,
    pub difficulty: Difficulty,
    pub tags: Vec<String>,
    pub has_stimulus: bool,
    pub content_complexity: String,
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

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BulkMetadataPatch {
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default)]
    pub skill: Option<String>,
    #[serde(default)]
    pub difficulty: Option<Difficulty>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BulkQuestionAction {
    Move {
        #[serde(rename = "destinationModuleId", alias = "destination_module_id")]
        destination_module_id: String,
    },
    Duplicate {
        #[serde(rename = "destinationModuleId", alias = "destination_module_id")]
        destination_module_id: String,
    },
    SetPretest {
        value: bool,
    },
    PatchMetadata {
        patch: BulkMetadataPatch,
    },
    Delete,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BulkQuestionRequest {
    pub question_ids: Vec<String>,
    pub action: BulkQuestionAction,
    #[serde(default)]
    pub expected_revisions: HashMap<String, i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkQuestionResult {
    pub affected_question_ids: Vec<String>,
    pub created_question_ids: Vec<String>,
    pub updated_questions: Vec<AssessmentQuestionSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchQuestionDraft {
    pub question_type: QuestionKind,
    pub stimulus: StructuredContent,
    pub prompt: StructuredContent,
    pub answer: AnswerDefinition,
    pub rationale: StructuredContent,
    pub metadata: QuestionMetadata,
    pub accessibility: AccessibilityMetadata,
    #[serde(default)]
    pub is_pretest: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchCreateQuestionsRequest {
    pub questions: Vec<BatchQuestionDraft>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SampleExamModuleDraft {
    pub module_id: String,
    pub questions: Vec<BatchQuestionDraft>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadSampleExamRequest {
    pub expected_version_id: String,
    pub expected_version_revision: i32,
    pub modules: Vec<SampleExamModuleDraft>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCreateQuestionsResult {
    pub created_question_ids: Vec<String>,
    pub questions: Vec<AssessmentQuestionSummary>,
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
struct SampleModuleRow {
    id: String,
    section_key: String,
    module_key: String,
    target_question_count: i32,
}

struct SatWorkbookImportContext {
    import_id: String,
    staged_assets: Vec<crate::sat_workbook::SatWorkbookStagedAsset>,
}

struct PreparedSampleQuestion {
    question_id: String,
    revision_id: String,
    exam_question_id: String,
    module_id: String,
    display_order: i32,
    is_pretest: bool,
    question_type: String,
    stimulus: Value,
    prompt: Value,
    answer_definition: Value,
    rationale: Value,
    metadata: Value,
    accessibility: Value,
}

#[derive(Debug, FromRow)]
struct PublishedSectionCloneRow {
    id: String,
    section_key: String,
    title: String,
    display_order: i32,
    duration_seconds: i32,
    break_after_seconds: i32,
    instructions: Value,
    tool_policy: Value,
}

#[derive(Debug, FromRow)]
struct PublishedModuleCloneRow {
    id: String,
    section_id: String,
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
struct PublishedRoutingCloneRow {
    section_id: String,
    base_module_id: String,
    lower_module_id: String,
    higher_module_id: String,
    policy_key: String,
    policy_config: Value,
}

#[derive(Debug, FromRow)]
struct PublishedScoringCloneRow {
    policy_key: String,
    policy_config: Value,
}

#[derive(Debug, FromRow)]
struct PublishedQuestionCloneRow {
    source_module_id: String,
    source_revision_id: String,
    question_id: String,
    max_semantic_revision: i32,
    question_type: String,
    stimulus: Value,
    prompt: Value,
    answer_definition: Value,
    rationale: Value,
    metadata: Value,
    accessibility: Value,
    display_order: i32,
    is_pretest: bool,
}

struct PreparedDraftQuestionClone {
    revision_id: String,
    question_id: String,
    semantic_revision: i32,
    question_type: String,
    stimulus: Value,
    prompt: Value,
    answer_definition: Value,
    rationale: Value,
    metadata: Value,
    accessibility: Value,
}

struct PreparedDraftPlacementClone {
    exam_question_id: String,
    module_id: String,
    question_id: String,
    question_revision_id: String,
    display_order: i32,
    is_pretest: bool,
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

fn map_preview_delivery_error(error: AssessmentDeliveryError) -> AssessmentAuthoringError {
    match error {
        AssessmentDeliveryError::Database(error) => AssessmentAuthoringError::Database(error),
        AssessmentDeliveryError::NotFound => AssessmentAuthoringError::NotFound,
        AssessmentDeliveryError::UnsupportedProvider => {
            AssessmentAuthoringError::UnsupportedProvider
        }
        AssessmentDeliveryError::InvalidData(message)
        | AssessmentDeliveryError::Validation(message)
        | AssessmentDeliveryError::Conflict(message) => {
            AssessmentAuthoringError::InvalidData(message)
        }
        AssessmentDeliveryError::StructuredConflict { message, .. }
        | AssessmentDeliveryError::TerminalizationConflict { message, .. } => {
            AssessmentAuthoringError::InvalidData(message)
        }
        AssessmentDeliveryError::ActiveSessionSuperseded => AssessmentAuthoringError::InvalidData(
            "Preview projection unexpectedly encountered student-session state.".to_owned(),
        ),
    }
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

    pub async fn preview(
        &self,
        exam_id: &str,
    ) -> Result<AssessmentPreviewProjection, AssessmentAuthoringError> {
        let exam = self.exam(exam_id).await?;
        if exam.provider_key != "sat" {
            return Err(AssessmentAuthoringError::UnsupportedProvider);
        }
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
        let sections = AssessmentDeliveryService::new(self.pool.clone())
            .preview_sections(&version_id)
            .await
            .map_err(map_preview_delivery_error)?;
        Ok(AssessmentPreviewProjection {
            exam_id: exam.id,
            provider_key: exam.provider_key,
            version_id,
            version_revision,
            sections,
        })
    }

    pub async fn open_shell(
        &self,
        exam_id: &str,
        actor_id: &str,
    ) -> Result<AssessmentAuthoringShell, AssessmentAuthoringError> {
        let mut tx = self.pool.begin().await?;
        let exam: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT provider_key, current_draft_version_id, current_published_version_id FROM exam_entities WHERE id = ? FOR UPDATE",
        )
        .bind(exam_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((provider_key, current_draft_version_id, current_published_version_id)) = exam
        else {
            return Err(AssessmentAuthoringError::NotFound);
        };
        if provider_key != "sat" {
            return Err(AssessmentAuthoringError::UnsupportedProvider);
        }
        if current_draft_version_id.is_some() {
            tx.commit().await?;
            return self.shell(exam_id).await;
        }
        let published_version_id = current_published_version_id.ok_or_else(|| {
            AssessmentAuthoringError::InvalidData(
                "The SAT exam has neither an editable draft nor a published version to continue."
                    .to_owned(),
            )
        })?;
        let draft_version_id = Self::clone_published_sat_to_draft_tx(
            &mut tx,
            exam_id,
            &published_version_id,
            actor_id,
        )
        .await?;
        let updated = sqlx::query(
            "UPDATE exam_entities SET current_draft_version_id = ?, updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1 WHERE id = ? AND current_draft_version_id IS NULL",
        )
        .bind(&draft_version_id)
        .bind(exam_id)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AssessmentAuthoringError::Conflict(
                "The SAT draft changed while authoring was opening.".to_owned(),
            ));
        }
        sqlx::query(
            "INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, created_at) VALUES (?, ?, ?, ?, 'version_created', CURRENT_TIMESTAMP(6))",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(exam_id)
        .bind(&draft_version_id)
        .bind(actor_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.shell(exam_id).await
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

    pub async fn batch_create_questions(
        &self,
        module_id: &str,
        request: BatchCreateQuestionsRequest,
        actor_id: &str,
    ) -> Result<BatchCreateQuestionsResult, AssessmentAuthoringError> {
        const MAX_BATCH_SIZE: usize = 64;
        if request.questions.is_empty() {
            return Err(AssessmentAuthoringError::InvalidData(
                "Batch question creation requires at least one question.".to_owned(),
            ));
        }
        if request.questions.len() > MAX_BATCH_SIZE {
            return Err(AssessmentAuthoringError::InvalidData(
                "A batch can contain at most 64 questions.".to_owned(),
            ));
        }

        let mut questions = request.questions;
        for draft in &mut questions {
            draft.metadata.tags = normalize_tags(&draft.metadata.tags)?;
        }

        let mut tx = self.pool.begin().await?;
        let version_id = lock_current_draft_for_module_tx(&mut tx, module_id).await?;
        let module: (String, String) = sqlx::query_as(
            "SELECT s.section_key, m.module_key FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
        )
        .bind(module_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AssessmentAuthoringError::NotFound)?;
        ensure_module_capacity_tx(&mut tx, module_id, questions.len()).await?;

        let requested_pretests = questions
            .iter()
            .filter(|question| question.is_pretest)
            .count();
        let existing_pretests: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM assessment_exam_questions WHERE module_id = ? AND is_pretest = TRUE",
        )
        .bind(module_id)
        .fetch_one(&mut *tx)
        .await?;
        if existing_pretests + i64::try_from(requested_pretests).unwrap_or(i64::MAX) > 2 {
            return Err(AssessmentAuthoringError::InvalidData(
                "Each SAT module can have at most two pretest questions.".to_owned(),
            ));
        }

        let provider = provider_for("sat").ok_or(AssessmentAuthoringError::UnsupportedProvider)?;
        let mut validation_issues = Vec::new();
        for (index, draft) in questions.iter().enumerate() {
            if draft.metadata.section_key != module.0 {
                validation_issues.push(ValidationIssue {
                    code: "sat.metadata.section.required",
                    path: format!("questions.{index}.metadata.sectionKey"),
                    message: "Question metadata must match the destination SAT section.".to_owned(),
                    blocking: true,
                });
                continue;
            }
            let question = QuestionRevision {
                id: String::new(),
                question_id: String::new(),
                semantic_revision: 1,
                revision: 0,
                state: "draft".to_owned(),
                question_type: draft.question_type,
                stimulus: draft.stimulus.clone(),
                prompt: draft.prompt.clone(),
                answer: draft.answer.clone(),
                rationale: draft.rationale.clone(),
                metadata: draft.metadata.clone(),
                accessibility: draft.accessibility.clone(),
            };
            for mut issue in provider.validate_question(
                QuestionValidationContext {
                    section_key: &module.0,
                    module_key: &module.1,
                },
                &question,
            ) {
                issue.path = format!("questions.{index}.{}", issue.path);
                validation_issues.push(issue);
            }
        }
        if validation_issues.iter().any(|issue| issue.blocking) {
            return Err(AssessmentAuthoringError::Validation(validation_issues));
        }

        let mut next_order: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(display_order), -1) + 1 FROM assessment_exam_questions WHERE module_id = ?",
        )
        .bind(module_id)
        .fetch_one(&mut *tx)
        .await?;
        let mut created_question_ids = Vec::with_capacity(questions.len());
        for draft in questions {
            let question_id = Uuid::new_v4().to_string();
            let revision_id = Uuid::new_v4().to_string();
            let exam_question_id = Uuid::new_v4().to_string();
            let question_type = serde_json::to_value(draft.question_type)?;
            let question_type = question_type.as_str().ok_or_else(|| {
                AssessmentAuthoringError::InvalidData("Invalid question type.".to_owned())
            })?;
            sqlx::query(
                "INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)",
            )
            .bind(&question_id)
            .bind(actor_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by) VALUES (?, ?, 1, 0, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&revision_id)
            .bind(&question_id)
            .bind(question_type)
            .bind(serde_json::to_value(&draft.stimulus)?)
            .bind(serde_json::to_value(&draft.prompt)?)
            .bind(serde_json::to_value(&draft.answer)?)
            .bind(serde_json::to_value(&draft.rationale)?)
            .bind(serde_json::to_value(&draft.metadata)?)
            .bind(serde_json::to_value(&draft.accessibility)?)
            .bind(actor_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&exam_question_id)
            .bind(module_id)
            .bind(&question_id)
            .bind(&revision_id)
            .bind(next_order)
            .bind(draft.is_pretest)
            .execute(&mut *tx)
            .await?;
            created_question_ids.push(exam_question_id);
            next_order = next_order.checked_add(1).ok_or_else(|| {
                AssessmentAuthoringError::InvalidData("Question order overflowed.".to_owned())
            })?;
        }
        touch_draft_version_tx(&mut tx, &version_id).await?;
        tx.commit().await?;
        Ok(BatchCreateQuestionsResult {
            created_question_ids,
            questions: self.summaries(module_id).await?,
        })
    }

    pub async fn register_sat_workbook_preview(
        &self,
        exam_id: &str,
        preview: &crate::sat_workbook::SatWorkbookPreview,
        actor_id: &str,
    ) -> Result<(), AssessmentAuthoringError> {
        let shell = self.shell(exam_id).await?;
        if shell.provider_key != "sat" {
            return Err(AssessmentAuthoringError::UnsupportedProvider);
        }
        let asset_manifest = preview
            .assets
            .iter()
            .cloned()
            .map(|mut asset| {
                asset.data_base64 = None;
                asset
            })
            .collect::<Vec<_>>();
        sqlx::query(
            "UPDATE sat_workbook_imports SET state = 'expired', updated_at = CURRENT_TIMESTAMP(6) WHERE exam_id = ? AND created_by = ? AND state = 'previewed'",
        )
        .bind(exam_id)
        .bind(actor_id)
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "INSERT INTO sat_workbook_imports (id, exam_id, expected_version_id, expected_version_revision, asset_manifest, state, created_by, expires_at) VALUES (?, ?, ?, ?, ?, 'previewed', ?, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 1 DAY))",
        )
        .bind(&preview.import_id)
        .bind(exam_id)
        .bind(&shell.version_id)
        .bind(shell.version_revision)
        .bind(serde_json::to_value(asset_manifest)?)
        .bind(actor_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn commit_sat_workbook(
        &self,
        exam_id: &str,
        request: crate::sat_workbook::SatWorkbookCommitRequest,
        actor_id: &str,
    ) -> Result<SatWorkbookCommitResult, AssessmentAuthoringError> {
        if request.modules.len() != 6 {
            return Err(AssessmentAuthoringError::InvalidData(
                "A complete SAT workbook must contain all six modules.".to_owned(),
            ));
        }
        let shell = self.shell(exam_id).await?;
        if shell.version_id != request.expected_version_id
            || shell.version_revision != request.expected_version_revision
        {
            return Err(AssessmentAuthoringError::Conflict(
                "The SAT draft changed after this workbook was checked. Review the latest draft before importing.".to_owned(),
            ));
        }
        let mut seen = HashSet::with_capacity(request.modules.len());
        let mut modules = Vec::with_capacity(request.modules.len());
        for workbook_module in request.modules {
            if !seen.insert(workbook_module.module_key.clone()) {
                return Err(AssessmentAuthoringError::InvalidData(
                    "The workbook contains a duplicate SAT module.".to_owned(),
                ));
            }
            let destination = shell
                .sections
                .iter()
                .flat_map(|section| section.modules.iter().map(move |module| (section, module)))
                .find(|(_, module)| module.module_key == workbook_module.module_key)
                .ok_or_else(|| {
                    AssessmentAuthoringError::InvalidData(
                        "The workbook contains a module that is not part of this SAT draft."
                            .to_owned(),
                    )
                })?;
            if destination.0.section_key != workbook_module.section_key {
                return Err(AssessmentAuthoringError::InvalidData(
                    "The workbook module does not match its SAT section.".to_owned(),
                ));
            }
            modules.push(SampleExamModuleDraft {
                module_id: destination.1.id.clone(),
                questions: workbook_module.questions,
            });
        }
        let import_id = request.import_id.clone();
        let next_shell = self
            .replace_complete_sat_draft(
                exam_id,
                LoadSampleExamRequest {
                    expected_version_id: request.expected_version_id,
                    expected_version_revision: request.expected_version_revision,
                    modules,
                },
                actor_id,
                Some(SatWorkbookImportContext {
                    import_id: import_id.clone(),
                    staged_assets: request.assets,
                }),
            )
            .await?;
        Ok(SatWorkbookCommitResult {
            shell: next_shell,
            undo: SatWorkbookUndoState {
                import_id,
                available: true,
            },
        })
    }

    pub async fn sat_workbook_undo_state(
        &self,
        exam_id: &str,
    ) -> Result<Option<SatWorkbookUndoState>, AssessmentAuthoringError> {
        let row: Option<(String, Option<String>, Option<i32>, Option<String>, Option<i32>)> =
            sqlx::query_as(
                "SELECT i.id, i.imported_version_id, i.imported_version_revision, e.current_draft_version_id, v.revision FROM sat_workbook_imports i JOIN exam_entities e ON e.id = i.exam_id LEFT JOIN exam_versions v ON v.id = e.current_draft_version_id WHERE i.exam_id = ? AND i.state = 'committed' ORDER BY i.created_at DESC LIMIT 1",
            )
            .bind(exam_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(
            |(
                import_id,
                imported_version_id,
                imported_revision,
                current_version_id,
                current_revision,
            )| {
                SatWorkbookUndoState {
                    import_id,
                    available: imported_version_id == current_version_id
                        && imported_revision == current_revision,
                }
            },
        ))
    }

    pub async fn undo_sat_workbook_import(
        &self,
        exam_id: &str,
        import_id: &str,
        actor_id: &str,
    ) -> Result<AssessmentAuthoringShell, AssessmentAuthoringError> {
        let mut tx = self.pool.begin().await?;
        let exam: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT provider_key, current_draft_version_id FROM exam_entities WHERE id = ? FOR UPDATE",
        )
        .bind(exam_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((provider_key, current_draft_version_id)) = exam else {
            return Err(AssessmentAuthoringError::NotFound);
        };
        if provider_key != "sat" {
            return Err(AssessmentAuthoringError::UnsupportedProvider);
        }
        let import: Option<(Option<String>, Option<String>, Option<i32>, Option<Value>)> =
            sqlx::query_as(
                "SELECT checkpoint_version_id, imported_version_id, imported_version_revision, asset_ids FROM sat_workbook_imports WHERE id = ? AND exam_id = ? AND state = 'committed' FOR UPDATE",
            )
            .bind(import_id)
            .bind(exam_id)
            .fetch_optional(&mut *tx)
            .await?;
        let Some((checkpoint_version_id, imported_version_id, imported_revision, asset_ids)) =
            import
        else {
            return Err(AssessmentAuthoringError::Conflict(
                "This SAT workbook import can no longer be undone.".to_owned(),
            ));
        };
        let checkpoint_version_id = checkpoint_version_id.ok_or_else(|| {
            AssessmentAuthoringError::InvalidData(
                "The SAT workbook recovery checkpoint is missing.".to_owned(),
            )
        })?;
        let imported_version_id = imported_version_id.ok_or_else(|| {
            AssessmentAuthoringError::InvalidData(
                "The imported SAT draft reference is missing.".to_owned(),
            )
        })?;
        let imported_revision = imported_revision.ok_or_else(|| {
            AssessmentAuthoringError::InvalidData(
                "The imported SAT revision is missing.".to_owned(),
            )
        })?;
        if current_draft_version_id.as_deref() != Some(imported_version_id.as_str()) {
            return Err(AssessmentAuthoringError::Conflict(
                "The SAT changed after this import. Undo is no longer available.".to_owned(),
            ));
        }
        let current: Option<(i32, bool)> = sqlx::query_as(
            "SELECT revision, is_draft FROM exam_versions WHERE id = ? AND exam_id = ? FOR UPDATE",
        )
        .bind(&imported_version_id)
        .bind(exam_id)
        .fetch_optional(&mut *tx)
        .await?;
        if current != Some((imported_revision, true)) {
            return Err(AssessmentAuthoringError::Conflict(
                "The SAT was edited after this import. Undo is no longer available.".to_owned(),
            ));
        }
        let checkpoint_exists: Option<bool> = sqlx::query_scalar(
            "SELECT is_draft FROM exam_versions WHERE id = ? AND exam_id = ? AND is_published = FALSE FOR UPDATE",
        )
        .bind(&checkpoint_version_id)
        .bind(exam_id)
        .fetch_optional(&mut *tx)
        .await?;
        if checkpoint_exists != Some(false) {
            return Err(AssessmentAuthoringError::Conflict(
                "The SAT workbook recovery checkpoint is no longer available.".to_owned(),
            ));
        }
        sqlx::query("UPDATE exam_versions SET is_draft = FALSE WHERE id = ? AND is_draft = TRUE")
            .bind(&imported_version_id)
            .execute(&mut *tx)
            .await?;
        let restored = sqlx::query(
            "UPDATE exam_versions SET is_draft = TRUE WHERE id = ? AND exam_id = ? AND is_draft = FALSE AND is_published = FALSE",
        )
        .bind(&checkpoint_version_id)
        .bind(exam_id)
        .execute(&mut *tx)
        .await?;
        if restored.rows_affected() != 1 {
            return Err(AssessmentAuthoringError::Conflict(
                "The SAT workbook recovery checkpoint could not be restored.".to_owned(),
            ));
        }
        sqlx::query(
            "UPDATE exam_entities SET current_draft_version_id = ?, updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1 WHERE id = ?",
        )
        .bind(&checkpoint_version_id)
        .bind(exam_id)
        .execute(&mut *tx)
        .await?;
        let imported_asset_ids: Vec<String> = asset_ids
            .map(serde_json::from_value)
            .transpose()
            .map_err(|_| {
                AssessmentAuthoringError::InvalidData(
                    "The imported media recovery record is unreadable.".to_owned(),
                )
            })?
            .unwrap_or_default();
        if !imported_asset_ids.is_empty() {
            let mut orphan = QueryBuilder::<MySql>::new(
                "UPDATE media_assets SET upload_status = 'orphaned', delete_after_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 7 DAY), updated_at = CURRENT_TIMESTAMP(6) WHERE owner_kind = 'assessment_exam' AND owner_id = ",
            );
            orphan.push_bind(exam_id);
            orphan.push(" AND id IN (");
            {
                let mut ids = orphan.separated(", ");
                for asset_id in &imported_asset_ids {
                    ids.push_bind(asset_id);
                }
            }
            orphan.push(")");
            orphan.build().execute(&mut *tx).await?;
        }
        let updated = sqlx::query(
            "UPDATE sat_workbook_imports SET state = 'undone', undone_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND exam_id = ? AND state = 'committed'",
        )
        .bind(import_id)
        .bind(exam_id)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(AssessmentAuthoringError::Conflict(
                "The SAT workbook import was already undone.".to_owned(),
            ));
        }
        sqlx::query(
            "INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, payload, created_at) VALUES (?, ?, ?, ?, 'version_restored', ?, CURRENT_TIMESTAMP(6))",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(exam_id)
        .bind(&checkpoint_version_id)
        .bind(actor_id)
        .bind(json!({"reason":"sat_workbook_import_undo","importId":import_id}))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.shell(exam_id).await
    }

    pub async fn load_sample_exam(
        &self,
        exam_id: &str,
        request: LoadSampleExamRequest,
        actor_id: &str,
    ) -> Result<AssessmentAuthoringShell, AssessmentAuthoringError> {
        self.replace_complete_sat_draft(exam_id, request, actor_id, None)
            .await
    }

    async fn replace_complete_sat_draft(
        &self,
        exam_id: &str,
        mut request: LoadSampleExamRequest,
        actor_id: &str,
        import: Option<SatWorkbookImportContext>,
    ) -> Result<AssessmentAuthoringShell, AssessmentAuthoringError> {
        for module in &mut request.modules {
            for draft in &mut module.questions {
                draft.metadata.tags = normalize_tags(&draft.metadata.tags)?;
            }
        }
        let mut tx = self.pool.begin().await?;
        let exam: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT provider_key, current_draft_version_id FROM exam_entities WHERE id = ? FOR UPDATE",
        )
        .bind(exam_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((provider_key, current_draft_version_id)) = exam else {
            return Err(AssessmentAuthoringError::NotFound);
        };
        if provider_key != "sat" {
            return Err(AssessmentAuthoringError::UnsupportedProvider);
        }
        let version_id = current_draft_version_id.ok_or(AssessmentAuthoringError::NotFound)?;
        if version_id != request.expected_version_id {
            return Err(AssessmentAuthoringError::Conflict(
                "The SAT draft changed before the complete replacement could be applied. Refresh and try again."
                    .to_owned(),
            ));
        }
        let version_revision: Option<i32> = sqlx::query_scalar(
            "SELECT revision FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE FOR UPDATE",
        )
        .bind(&version_id)
        .bind(exam_id)
        .fetch_optional(&mut *tx)
        .await?;
        if version_revision != Some(request.expected_version_revision) {
            return Err(AssessmentAuthoringError::Conflict(
                "The SAT draft changed before the complete replacement could be applied. Refresh and try again."
                    .to_owned(),
            ));
        }

        let import_asset_ids = if let Some(import_context) = import.as_ref() {
            let import_row: Option<(String, i32, Value, String)> = sqlx::query_as(
                "SELECT expected_version_id, expected_version_revision, asset_manifest, created_by FROM sat_workbook_imports WHERE id = ? AND exam_id = ? AND state = 'previewed' AND expires_at > CURRENT_TIMESTAMP(6) FOR UPDATE",
            )
            .bind(&import_context.import_id)
            .bind(exam_id)
            .fetch_optional(&mut *tx)
            .await?;
            let Some((expected_version_id, expected_revision, manifest_value, created_by)) =
                import_row
            else {
                return Err(AssessmentAuthoringError::Conflict(
                    "This SAT workbook preview has expired or was already used. Check the workbook again before importing.".to_owned(),
                ));
            };
            if created_by != actor_id
                || expected_version_id != version_id
                || expected_revision != request.expected_version_revision
            {
                return Err(AssessmentAuthoringError::Conflict(
                    "The SAT workbook preview does not belong to the current draft session."
                        .to_owned(),
                ));
            }
            let manifest: Vec<crate::sat_workbook::SatWorkbookAsset> =
                serde_json::from_value(manifest_value).map_err(|_| {
                    AssessmentAuthoringError::InvalidData(
                        "The workbook asset manifest is unreadable.".to_owned(),
                    )
                })?;
            let staged = verify_staged_workbook_assets_tx(
                &mut tx,
                &import_context.import_id,
                &manifest,
                &import_context.staged_assets,
            )
            .await?;
            materialize_workbook_assets_in_modules(&mut request.modules, &staged)?;
            staged.into_values().collect::<Vec<_>>()
        } else {
            Vec::new()
        };

        let modules = sqlx::query_as::<_, SampleModuleRow>(
            "SELECT m.id, s.section_key, m.module_key, m.target_question_count FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ? ORDER BY s.display_order, m.display_order FOR UPDATE",
        )
        .bind(&version_id)
        .fetch_all(&mut *tx)
        .await?;
        if modules.len() != request.modules.len() {
            return Err(AssessmentAuthoringError::InvalidData(
                "Complete SAT replacement must contain every module exactly once.".to_owned(),
            ));
        }
        let mut requested_ids = HashSet::with_capacity(request.modules.len());
        for requested in &request.modules {
            if !requested_ids.insert(requested.module_id.as_str()) {
                return Err(AssessmentAuthoringError::InvalidData(
                    "Complete SAT replacement contains a duplicate module.".to_owned(),
                ));
            }
        }

        let provider = provider_for("sat").ok_or(AssessmentAuthoringError::UnsupportedProvider)?;
        let blueprint = provider.blueprint();
        let mut validation_issues = Vec::new();
        for module in &modules {
            let requested = request
                .modules
                .iter()
                .find(|candidate| candidate.module_id == module.id)
                .ok_or_else(|| {
                    AssessmentAuthoringError::InvalidData(
                        "Complete SAT replacement contains an unknown or missing module."
                            .to_owned(),
                    )
                })?;
            let expected_count = usize::try_from(module.target_question_count).map_err(|_| {
                AssessmentAuthoringError::InvalidData(
                    "SAT module target count cannot be negative.".to_owned(),
                )
            })?;
            if requested.questions.len() != expected_count {
                return Err(AssessmentAuthoringError::InvalidData(format!(
                    "{} requires exactly {} questions.",
                    module.module_key, module.target_question_count
                )));
            }
            let blueprint_module = blueprint
                .module(&module.section_key, &module.module_key)
                .ok_or_else(|| {
                    AssessmentAuthoringError::InvalidData(
                        "Sample exam target module is not part of the SAT blueprint.".to_owned(),
                    )
                })?;
            let pretest_count = requested
                .questions
                .iter()
                .filter(|question| question.is_pretest)
                .count();
            if pretest_count
                != usize::try_from(blueprint_module.pretest_count).unwrap_or(usize::MAX)
            {
                return Err(AssessmentAuthoringError::InvalidData(format!(
                    "{} requires exactly {} pretest questions.",
                    module.module_key, blueprint_module.pretest_count
                )));
            }
            for (index, draft) in requested.questions.iter().enumerate() {
                if draft.metadata.section_key != module.section_key {
                    validation_issues.push(ValidationIssue {
                        code: "sat.metadata.section.required",
                        path: format!(
                            "modules.{}.questions.{index}.metadata.sectionKey",
                            module.id
                        ),
                        message: "Question metadata must match the destination SAT section."
                            .to_owned(),
                        blocking: true,
                    });
                    continue;
                }
                let question = QuestionRevision {
                    id: String::new(),
                    question_id: String::new(),
                    semantic_revision: 1,
                    revision: 0,
                    state: "draft".to_owned(),
                    question_type: draft.question_type,
                    stimulus: draft.stimulus.clone(),
                    prompt: draft.prompt.clone(),
                    answer: draft.answer.clone(),
                    rationale: draft.rationale.clone(),
                    metadata: draft.metadata.clone(),
                    accessibility: draft.accessibility.clone(),
                };
                for mut issue in provider.validate_question(
                    QuestionValidationContext {
                        section_key: &module.section_key,
                        module_key: &module.module_key,
                    },
                    &question,
                ) {
                    issue.path = format!("modules.{}.questions.{index}.{}", module.id, issue.path);
                    validation_issues.push(issue);
                }
            }
        }
        if validation_issues.iter().any(|issue| issue.blocking) {
            return Err(AssessmentAuthoringError::Validation(validation_issues));
        }

        let checkpoint_version_id = if import.is_some() {
            Some(Self::checkpoint_sat_draft_tx(&mut tx, exam_id, &version_id, actor_id).await?)
        } else {
            None
        };

        let mut prepared = Vec::with_capacity(
            request
                .modules
                .iter()
                .map(|module| module.questions.len())
                .sum(),
        );
        for module in &modules {
            let requested = request
                .modules
                .iter()
                .find(|candidate| candidate.module_id == module.id)
                .ok_or_else(|| {
                    AssessmentAuthoringError::InvalidData(
                        "SAT module disappeared during replacement validation.".to_owned(),
                    )
                })?;
            for (index, draft) in requested.questions.iter().enumerate() {
                prepared.push(prepare_sample_question(
                    &module.id,
                    i32::try_from(index).map_err(|_| {
                        AssessmentAuthoringError::InvalidData(
                            "Question order overflowed.".to_owned(),
                        )
                    })?,
                    draft,
                )?);
            }
        }

        let mut previous_question_ids: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT eq.question_id FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ?",
        )
        .bind(&version_id)
        .fetch_all(&mut *tx)
        .await?;
        let mut delete_placements = QueryBuilder::<MySql>::new(
            "DELETE FROM assessment_exam_questions WHERE module_id IN (",
        );
        {
            let mut separated = delete_placements.separated(", ");
            for module in &modules {
                separated.push_bind(&module.id);
            }
        }
        delete_placements.push(")");
        delete_placements.build().execute(&mut *tx).await?;
        previous_question_ids.sort();
        previous_question_ids.dedup();
        delete_unreferenced_questions_tx(&mut tx, &previous_question_ids).await?;
        insert_prepared_sample_questions_tx(&mut tx, &prepared, actor_id).await?;
        touch_draft_version_tx(&mut tx, &version_id).await?;
        if let Some(import_context) = import.as_ref() {
            if !import_asset_ids.is_empty() {
                let mut promote = QueryBuilder::<MySql>::new(
                    "UPDATE media_assets SET owner_kind = 'assessment_exam', owner_id = ",
                );
                promote.push_bind(exam_id);
                promote.push(", delete_after_at = NULL, updated_at = CURRENT_TIMESTAMP(6) WHERE owner_kind = 'assessment_import' AND owner_id = ");
                promote.push_bind(&import_context.import_id);
                promote.push(" AND upload_status = 'finalized' AND id IN (");
                {
                    let mut ids = promote.separated(", ");
                    for asset_id in &import_asset_ids {
                        ids.push_bind(asset_id);
                    }
                }
                promote.push(")");
                let promoted = promote.build().execute(&mut *tx).await?;
                if promoted.rows_affected() != import_asset_ids.len() as u64 {
                    return Err(AssessmentAuthoringError::Conflict(
                        "A staged workbook image changed before import. Check the workbook again."
                            .to_owned(),
                    ));
                }
            }
            let post_revision: i32 =
                sqlx::query_scalar("SELECT revision FROM exam_versions WHERE id = ? FOR UPDATE")
                    .bind(&version_id)
                    .fetch_one(&mut *tx)
                    .await?;
            let checkpoint = checkpoint_version_id.as_deref().ok_or_else(|| {
                AssessmentAuthoringError::InvalidData(
                    "The workbook recovery checkpoint was not created.".to_owned(),
                )
            })?;
            let updated = sqlx::query(
                "UPDATE sat_workbook_imports SET checkpoint_version_id = ?, imported_version_id = ?, imported_version_revision = ?, asset_ids = ?, state = 'committed', updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND exam_id = ? AND state = 'previewed'",
            )
            .bind(checkpoint)
            .bind(&version_id)
            .bind(post_revision)
            .bind(serde_json::to_value(&import_asset_ids)?)
            .bind(&import_context.import_id)
            .bind(exam_id)
            .execute(&mut *tx)
            .await?;
            if updated.rows_affected() != 1 {
                return Err(AssessmentAuthoringError::Conflict(
                    "The SAT workbook import was already completed or expired.".to_owned(),
                ));
            }
            sqlx::query(
                "INSERT INTO exam_events (id, exam_id, version_id, actor_id, action, payload, created_at) VALUES (?, ?, ?, ?, 'version_created', ?, CURRENT_TIMESTAMP(6))",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(exam_id)
            .bind(checkpoint)
            .bind(actor_id)
            .bind(json!({"reason":"sat_workbook_import_checkpoint","importId":import_context.import_id}))
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        self.shell(exam_id).await
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
            "UPDATE assessment_question_revisions SET question_type = ?, stimulus = ?, prompt = ?, answer_definition = ?, rationale = ?, metadata = ?, accessibility = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6), updated_by = ? WHERE id = ? AND revision = ? AND state = 'draft'",
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
            } else if section.break_after_seconds % 60 != 0 {
                errors.push(structure_issue(
                    &format!("{}.break", section.section_key),
                    "SAT break duration must be a whole number of minutes; delivery never rounds assessment time.",
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
                if !sat_tool_policy_matches(&module.tool_policy, &blueprint_module.tools) {
                    errors.push(structure_issue(
                        &format!("{}.{}.tools", section.section_key, module.module_key),
                        if blueprint_module.tools.is_empty() {
                            "Reading and Writing modules do not permit Math calculator or reference tools."
                        } else {
                            "Math modules require both the calculator and reference sheet tools."
                        },
                    ));
                }
                if module.duration_seconds <= 0 {
                    errors.push(structure_issue(
                        &format!("{}.{}.duration", section.section_key, module.module_key),
                        "SAT module duration must be greater than zero.",
                    ));
                } else if module.duration_seconds % 60 != 0 {
                    errors.push(structure_issue(
                        &format!("{}.{}.duration", section.section_key, module.module_key),
                        "SAT module duration must be a whole number of minutes; delivery never rounds assessment time.",
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

    pub async fn clone_published_sat_to_draft_tx(
        tx: &mut Transaction<'_, MySql>,
        exam_id: &str,
        published_version_id: &str,
        actor_id: &str,
    ) -> Result<String, AssessmentAuthoringError> {
        Self::clone_sat_version_tx(
            tx,
            exam_id,
            published_version_id,
            actor_id,
            true,
            true,
            true,
        )
        .await
    }

    async fn checkpoint_sat_draft_tx(
        tx: &mut Transaction<'_, MySql>,
        exam_id: &str,
        draft_version_id: &str,
        actor_id: &str,
    ) -> Result<String, AssessmentAuthoringError> {
        Self::clone_sat_version_tx(tx, exam_id, draft_version_id, actor_id, false, false, false)
            .await
    }

    async fn clone_sat_version_tx(
        tx: &mut Transaction<'_, MySql>,
        exam_id: &str,
        source_version_id: &str,
        actor_id: &str,
        source_is_published: bool,
        target_is_draft: bool,
        reuse_existing_draft: bool,
    ) -> Result<String, AssessmentAuthoringError> {
        let source: Option<(i32, Value, Value)> = sqlx::query_as(
            "SELECT version_number, content_snapshot, config_snapshot FROM exam_versions WHERE id = ? AND exam_id = ? AND ((? = TRUE AND is_published = TRUE) OR (? = FALSE AND is_draft = TRUE)) FOR UPDATE",
        )
        .bind(source_version_id)
        .bind(exam_id)
        .bind(source_is_published)
        .bind(source_is_published)
        .fetch_optional(&mut **tx)
        .await?;
        let Some((_published_number, content_snapshot, config_snapshot)) = source else {
            return Err(AssessmentAuthoringError::InvalidData(
                "The published SAT version is unavailable for draft continuation.".to_owned(),
            ));
        };

        if reuse_existing_draft {
            let existing_draft: Option<String> = sqlx::query_scalar(
                "SELECT id FROM exam_versions WHERE exam_id = ? AND is_draft = TRUE LIMIT 1 FOR UPDATE",
            )
            .bind(exam_id)
            .fetch_optional(&mut **tx)
            .await?;
            if let Some(existing_draft) = existing_draft {
                return Ok(existing_draft);
            }
        }

        let next_version_number: i32 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM exam_versions WHERE exam_id = ?",
        )
        .bind(exam_id)
        .fetch_one(&mut **tx)
        .await?;
        let draft_version_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO exam_versions (id, exam_id, version_number, parent_version_id, content_snapshot, config_snapshot, validation_snapshot, created_by, is_draft, is_published, revision) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, FALSE, 0)",
        )
        .bind(&draft_version_id)
        .bind(exam_id)
        .bind(next_version_number)
        .bind(source_version_id)
        .bind(content_snapshot)
        .bind(config_snapshot)
        .bind(actor_id)
        .bind(target_is_draft)
        .execute(&mut **tx)
        .await?;

        let sections = sqlx::query_as::<_, PublishedSectionCloneRow>(
            "SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions, tool_policy FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order, id",
        )
        .bind(source_version_id)
        .fetch_all(&mut **tx)
        .await?;
        if sections.is_empty() {
            return Err(AssessmentAuthoringError::InvalidData(
                "The published SAT version has no assessment sections to continue editing."
                    .to_owned(),
            ));
        }
        let mut section_ids = HashMap::with_capacity(sections.len());
        for section in &sections {
            let new_section_id = Uuid::new_v4().to_string();
            section_ids.insert(section.id.clone(), new_section_id.clone());
            sqlx::query(
                "INSERT INTO assessment_sections (id, exam_version_id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions, tool_policy, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
            )
            .bind(&new_section_id)
            .bind(&draft_version_id)
            .bind(&section.section_key)
            .bind(&section.title)
            .bind(section.display_order)
            .bind(section.duration_seconds)
            .bind(section.break_after_seconds)
            .bind(&section.instructions)
            .bind(&section.tool_policy)
            .execute(&mut **tx)
            .await?;
        }

        let modules = sqlx::query_as::<_, PublishedModuleCloneRow>(
            "SELECT m.id, m.section_id, m.module_key, m.title, m.display_order, m.duration_seconds, m.target_question_count, m.adaptive_role, m.instructions, m.tool_policy FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ? ORDER BY s.display_order, m.display_order, m.id",
        )
        .bind(source_version_id)
        .fetch_all(&mut **tx)
        .await?;
        let mut module_ids = HashMap::with_capacity(modules.len());
        for module in &modules {
            let new_section_id = section_ids.get(&module.section_id).ok_or_else(|| {
                AssessmentAuthoringError::InvalidData(
                    "A published SAT module references an unknown section.".to_owned(),
                )
            })?;
            let new_module_id = Uuid::new_v4().to_string();
            module_ids.insert(module.id.clone(), new_module_id.clone());
            sqlx::query(
                "INSERT INTO assessment_modules (id, section_id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, instructions, tool_policy, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
            )
            .bind(&new_module_id)
            .bind(new_section_id)
            .bind(&module.module_key)
            .bind(&module.title)
            .bind(module.display_order)
            .bind(module.duration_seconds)
            .bind(module.target_question_count)
            .bind(&module.adaptive_role)
            .bind(&module.instructions)
            .bind(&module.tool_policy)
            .execute(&mut **tx)
            .await?;
        }

        let routing = sqlx::query_as::<_, PublishedRoutingCloneRow>(
            "SELECT rp.section_id, rp.base_module_id, rp.lower_module_id, rp.higher_module_id, rp.policy_key, rp.policy_config FROM assessment_routing_policies rp JOIN assessment_sections s ON s.id = rp.section_id WHERE s.exam_version_id = ?",
        )
        .bind(source_version_id)
        .fetch_all(&mut **tx)
        .await?;
        for policy in routing {
            let new_section_id = section_ids.get(&policy.section_id).ok_or_else(|| {
                AssessmentAuthoringError::InvalidData(
                    "A SAT routing policy references an unknown section.".to_owned(),
                )
            })?;
            let new_base_id = module_ids.get(&policy.base_module_id).ok_or_else(|| {
                AssessmentAuthoringError::InvalidData(
                    "A SAT routing policy references an unknown base module.".to_owned(),
                )
            })?;
            let new_lower_id = module_ids.get(&policy.lower_module_id).ok_or_else(|| {
                AssessmentAuthoringError::InvalidData(
                    "A SAT routing policy references an unknown lower module.".to_owned(),
                )
            })?;
            let new_higher_id = module_ids.get(&policy.higher_module_id).ok_or_else(|| {
                AssessmentAuthoringError::InvalidData(
                    "A SAT routing policy references an unknown higher module.".to_owned(),
                )
            })?;
            sqlx::query(
                "INSERT INTO assessment_routing_policies (id, section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(new_section_id)
            .bind(new_base_id)
            .bind(new_lower_id)
            .bind(new_higher_id)
            .bind(&policy.policy_key)
            .bind(&policy.policy_config)
            .execute(&mut **tx)
            .await?;
        }

        let scoring = sqlx::query_as::<_, PublishedScoringCloneRow>(
            "SELECT policy_key, policy_config FROM assessment_scoring_policies WHERE exam_version_id = ?",
        )
        .bind(source_version_id)
        .fetch_optional(&mut **tx)
        .await?;
        if let Some(scoring) = scoring {
            sqlx::query(
                "INSERT INTO assessment_scoring_policies (id, exam_version_id, policy_key, policy_config, revision) VALUES (?, ?, ?, ?, 0)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(&draft_version_id)
            .bind(&scoring.policy_key)
            .bind(&scoring.policy_config)
            .execute(&mut **tx)
            .await?;
        }

        let source_questions = sqlx::query_as::<_, PublishedQuestionCloneRow>(
            "SELECT m.id AS source_module_id, qr.id AS source_revision_id, eq.question_id, (SELECT MAX(r2.semantic_revision) FROM assessment_question_revisions r2 WHERE r2.question_id = eq.question_id) AS max_semantic_revision, qr.question_type, qr.stimulus, qr.prompt, qr.answer_definition, qr.rationale, qr.metadata, qr.accessibility, eq.display_order, eq.is_pretest FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE s.exam_version_id = ? ORDER BY s.display_order, m.display_order, eq.display_order, eq.id",
        )
        .bind(source_version_id)
        .fetch_all(&mut **tx)
        .await?;

        let mut revision_ids = HashMap::<String, String>::new();
        let mut next_semantic_by_question = HashMap::<String, i32>::new();
        let mut revisions = Vec::new();
        let mut placements = Vec::with_capacity(source_questions.len());
        for source in source_questions {
            let new_revision_id =
                if let Some(existing) = revision_ids.get(&source.source_revision_id) {
                    existing.clone()
                } else {
                    let next_semantic = next_semantic_by_question
                        .entry(source.question_id.clone())
                        .or_insert(source.max_semantic_revision.saturating_add(1));
                    let semantic_revision = *next_semantic;
                    *next_semantic = next_semantic.saturating_add(1);
                    let revision_id = Uuid::new_v4().to_string();
                    revisions.push(PreparedDraftQuestionClone {
                        revision_id: revision_id.clone(),
                        question_id: source.question_id.clone(),
                        semantic_revision,
                        question_type: source.question_type.clone(),
                        stimulus: source.stimulus.clone(),
                        prompt: source.prompt.clone(),
                        answer_definition: source.answer_definition.clone(),
                        rationale: source.rationale.clone(),
                        metadata: source.metadata.clone(),
                        accessibility: source.accessibility.clone(),
                    });
                    revision_ids.insert(source.source_revision_id.clone(), revision_id.clone());
                    revision_id
                };
            let new_module_id = module_ids.get(&source.source_module_id).ok_or_else(|| {
                AssessmentAuthoringError::InvalidData(
                    "A published SAT question references an unknown module.".to_owned(),
                )
            })?;
            placements.push(PreparedDraftPlacementClone {
                exam_question_id: Uuid::new_v4().to_string(),
                module_id: new_module_id.clone(),
                question_id: source.question_id,
                question_revision_id: new_revision_id,
                display_order: source.display_order,
                is_pretest: source.is_pretest,
            });
        }

        if !revisions.is_empty() {
            let mut revision_insert = QueryBuilder::<MySql>::new(
                "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by) ",
            );
            revision_insert.push_values(&revisions, |mut row, revision| {
                row.push_bind(&revision.revision_id)
                    .push_bind(&revision.question_id)
                    .push_bind(revision.semantic_revision)
                    .push_bind(0_i32)
                    .push_bind("draft")
                    .push_bind(&revision.question_type)
                    .push_bind(&revision.stimulus)
                    .push_bind(&revision.prompt)
                    .push_bind(&revision.answer_definition)
                    .push_bind(&revision.rationale)
                    .push_bind(&revision.metadata)
                    .push_bind(&revision.accessibility)
                    .push_bind(actor_id);
            });
            revision_insert.build().execute(&mut **tx).await?;
        }
        if !placements.is_empty() {
            let mut placement_insert = QueryBuilder::<MySql>::new(
                "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest) ",
            );
            placement_insert.push_values(&placements, |mut row, placement| {
                row.push_bind(&placement.exam_question_id)
                    .push_bind(&placement.module_id)
                    .push_bind(&placement.question_id)
                    .push_bind(&placement.question_revision_id)
                    .push_bind(placement.display_order)
                    .push_bind(placement.is_pretest);
            });
            placement_insert.build().execute(&mut **tx).await?;
        }

        Ok(draft_version_id)
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

#[derive(Debug, FromRow)]
struct StagedWorkbookMediaRow {
    id: String,
    content_type: String,
    file_name: String,
    size_bytes: Option<i64>,
    checksum_sha256: Option<String>,
}

async fn verify_staged_workbook_assets_tx(
    tx: &mut Transaction<'_, MySql>,
    import_id: &str,
    manifest: &[crate::sat_workbook::SatWorkbookAsset],
    staged_assets: &[crate::sat_workbook::SatWorkbookStagedAsset],
) -> Result<HashMap<String, String>, AssessmentAuthoringError> {
    if manifest.len() != staged_assets.len() {
        return Err(AssessmentAuthoringError::InvalidData(
            "Every embedded workbook image must finish staging before import.".to_owned(),
        ));
    }
    let mut requested = HashMap::with_capacity(staged_assets.len());
    for staged in staged_assets {
        if requested
            .insert(staged.key.clone(), staged.asset_id.clone())
            .is_some()
        {
            return Err(AssessmentAuthoringError::InvalidData(
                "The workbook contains a duplicate staged asset key.".to_owned(),
            ));
        }
    }
    if manifest.is_empty() {
        return Ok(requested);
    }
    let mut query = QueryBuilder::<MySql>::new(
        "SELECT id, content_type, file_name, size_bytes, checksum_sha256 FROM media_assets WHERE owner_kind = 'assessment_import' AND owner_id = ",
    );
    query.push_bind(import_id);
    query.push(" AND upload_status = 'finalized' AND id IN (");
    {
        let mut ids = query.separated(", ");
        for asset_id in requested.values() {
            ids.push_bind(asset_id);
        }
    }
    query.push(") FOR UPDATE");
    let rows = query
        .build_query_as::<StagedWorkbookMediaRow>()
        .fetch_all(&mut **tx)
        .await?;
    if rows.len() != manifest.len() {
        return Err(AssessmentAuthoringError::Conflict(
            "A staged workbook image is missing or no longer finalized.".to_owned(),
        ));
    }
    let by_id: HashMap<&str, &StagedWorkbookMediaRow> =
        rows.iter().map(|row| (row.id.as_str(), row)).collect();
    for asset in manifest {
        let asset_id = requested.get(&asset.key).ok_or_else(|| {
            AssessmentAuthoringError::InvalidData(format!(
                "Workbook image “{}” was not staged.",
                asset.key
            ))
        })?;
        let row = by_id.get(asset_id.as_str()).ok_or_else(|| {
            AssessmentAuthoringError::Conflict(format!(
                "Workbook image “{}” is no longer available.",
                asset.key
            ))
        })?;
        if row.content_type != asset.content_type
            || row.file_name != asset.file_name
            || row.size_bytes != i64::try_from(asset.size_bytes).ok()
            || row.checksum_sha256.as_deref() != Some(asset.checksum_sha256.as_str())
        {
            return Err(AssessmentAuthoringError::Conflict(format!(
                "Workbook image “{}” does not match the checked workbook.",
                asset.key
            )));
        }
    }
    Ok(requested)
}

fn materialize_workbook_assets_in_modules(
    modules: &mut [SampleExamModuleDraft],
    staged_assets: &HashMap<String, String>,
) -> Result<(), AssessmentAuthoringError> {
    for module in modules {
        for question in &mut module.questions {
            for content in [
                &mut question.stimulus,
                &mut question.prompt,
                &mut question.rationale,
            ] {
                materialize_workbook_assets_in_content(content, staged_assets)?;
            }
            if let AnswerDefinition::SingleChoice { options, .. } = &mut question.answer {
                for option in options {
                    materialize_workbook_assets_in_content(&mut option.content, staged_assets)?;
                }
            }
        }
    }
    Ok(())
}

fn materialize_workbook_assets_in_content(
    content: &mut StructuredContent,
    staged_assets: &HashMap<String, String>,
) -> Result<(), AssessmentAuthoringError> {
    let Some(document) = content.document.as_mut() else {
        return Ok(());
    };
    materialize_workbook_assets_in_json(document, staged_assets)
}

fn materialize_workbook_assets_in_json(
    value: &mut Value,
    staged_assets: &HashMap<String, String>,
) -> Result<(), AssessmentAuthoringError> {
    match value {
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("image") {
                let attrs = map
                    .get_mut("attrs")
                    .and_then(Value::as_object_mut)
                    .ok_or_else(|| {
                        AssessmentAuthoringError::InvalidData(
                            "Workbook image attributes are missing.".to_owned(),
                        )
                    })?;
                let key = attrs
                    .get("workbookKey")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .or_else(|| {
                        attrs
                            .get("assetId")
                            .and_then(Value::as_str)
                            .and_then(|value| value.strip_prefix("workbook:"))
                            .map(ToOwned::to_owned)
                    })
                    .ok_or_else(|| {
                        AssessmentAuthoringError::InvalidData(
                            "Workbook imports may only use images defined on the Assets sheet."
                                .to_owned(),
                        )
                    })?;
                let asset_id = staged_assets.get(&key).ok_or_else(|| {
                    AssessmentAuthoringError::InvalidData(format!(
                        "Workbook image “{key}” was not staged."
                    ))
                })?;
                attrs.insert("assetId".to_owned(), Value::String(asset_id.clone()));
                attrs.remove("workbookKey");
                attrs.remove("src");
            }
            for child in map.values_mut() {
                materialize_workbook_assets_in_json(child, staged_assets)?;
            }
        }
        Value::Array(values) => {
            for child in values {
                materialize_workbook_assets_in_json(child, staged_assets)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn default_question(section_key: &str) -> SaveQuestionRevisionRequest {
    let content = |text: &str| StructuredContent {
        version: 1,
        document: None,
        nodes: if text.is_empty() {
            Vec::new()
        } else {
            vec![ielts_backend_domain::assessment::ContentNode::Paragraph {
                id: Uuid::new_v4().to_string(),
                text: text.to_owned(),
            }]
        },
    };
    SaveQuestionRevisionRequest {
        revision: 0,
        question_type: QuestionKind::SingleChoice,
        stimulus: StructuredContent {
            version: 1,
            document: None,
            nodes: Vec::new(),
        },
        prompt: content(""),
        answer: AnswerDefinition::SingleChoice {
            options: ['A', 'B', 'C', 'D']
                .into_iter()
                .map(|label| ChoiceOption {
                    id: label.to_string(),
                    content: content(""),
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

fn normalize_tags(tags: &[String]) -> Result<Vec<String>, AssessmentAuthoringError> {
    const MAX_TAGS: usize = 24;
    const MAX_TAG_LENGTH: usize = 64;
    let mut normalized = Vec::with_capacity(tags.len().min(MAX_TAGS));
    for tag in tags {
        let value = tag.trim();
        if value.is_empty() {
            continue;
        }
        if value.chars().count() > MAX_TAG_LENGTH {
            return Err(AssessmentAuthoringError::InvalidData(
                "Question tags cannot exceed 64 characters.".to_owned(),
            ));
        }
        if !normalized
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(value))
        {
            normalized.push(value.to_owned());
        }
        if normalized.len() > MAX_TAGS {
            return Err(AssessmentAuthoringError::InvalidData(
                "A question can contain at most 24 tags.".to_owned(),
            ));
        }
    }
    Ok(normalized)
}

fn content_preview(content: &StructuredContent, max_chars: usize) -> String {
    fn visit(value: &Value, output: &mut String) {
        match value {
            Value::String(value) => {
                if !value.trim().is_empty() {
                    if !output.is_empty() {
                        output.push(' ');
                    }
                    output.push_str(value.trim());
                }
            }
            Value::Array(values) => values.iter().for_each(|value| visit(value, output)),
            Value::Object(object) => {
                if let Some(text) = object.get("text").and_then(Value::as_str) {
                    if !text.trim().is_empty() {
                        if !output.is_empty() {
                            output.push(' ');
                        }
                        output.push_str(text.trim());
                    }
                } else if let Some(attrs) = object.get("attrs").and_then(Value::as_object) {
                    for key in ["latex", "alt"] {
                        if let Some(value) = attrs.get(key).and_then(Value::as_str) {
                            if !value.trim().is_empty() {
                                if !output.is_empty() {
                                    output.push(' ');
                                }
                                output.push_str(value.trim());
                            }
                        }
                    }
                }
                if let Some(children) = object.get("content") {
                    visit(children, output);
                }
            }
            _ => {}
        }
    }
    let mut text = String::new();
    if let Some(document) = &content.document {
        visit(document, &mut text);
    } else {
        for node in &content.nodes {
            let value = match node {
                ielts_backend_domain::assessment::ContentNode::Paragraph { text, .. }
                | ielts_backend_domain::assessment::ContentNode::Heading { text, .. } => {
                    text.clone()
                }
                ielts_backend_domain::assessment::ContentNode::Equation { latex, .. } => {
                    latex.clone()
                }
                ielts_backend_domain::assessment::ContentNode::Image { alt, .. } => alt.clone(),
                ielts_backend_domain::assessment::ContentNode::Table { rows, .. } => rows
                    .iter()
                    .flat_map(|row| row.iter())
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" "),
            };
            if !value.trim().is_empty() {
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(value.trim());
            }
        }
    }
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    let mut preview: String = normalized
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect();
    preview.push('…');
    preview
}

fn answer_key_preview(answer: &AnswerDefinition) -> Option<String> {
    match answer {
        AnswerDefinition::SingleChoice {
            correct_option_id, ..
        } => correct_option_id.clone(),
        AnswerDefinition::StudentProducedResponse {
            accepted_responses, ..
        } => accepted_responses
            .iter()
            .map(|value| value.trim())
            .find(|value| !value.is_empty())
            .map(str::to_owned),
    }
}

fn question_content_complexity(question: &QuestionRevision) -> String {
    fn content_is_rich(content: &StructuredContent) -> bool {
        if content.nodes.iter().any(|node| {
            !matches!(
                node,
                ielts_backend_domain::assessment::ContentNode::Paragraph { .. }
            )
        }) {
            return true;
        }
        content.document.as_ref().is_some_and(|document| {
            if document
                .get("content")
                .and_then(Value::as_array)
                .is_some_and(|blocks| blocks.len() > 1)
            {
                return true;
            }
            fn rich(value: &Value) -> bool {
                match value {
                    Value::Array(values) => values.iter().any(rich),
                    Value::Object(object) => {
                        matches!(
                            object.get("type").and_then(Value::as_str),
                            Some(
                                "image"
                                    | "table"
                                    | "inlineMath"
                                    | "blockMath"
                                    | "heading"
                                    | "bulletList"
                                    | "orderedList"
                            )
                        ) || object
                            .get("marks")
                            .and_then(Value::as_array)
                            .is_some_and(|marks| !marks.is_empty())
                            || object.get("content").is_some_and(rich)
                    }
                    _ => false,
                }
            }
            rich(document)
        })
    }
    let answer_rich = match &question.answer {
        AnswerDefinition::SingleChoice { options, .. } => options
            .iter()
            .any(|option| content_is_rich(&option.content)),
        AnswerDefinition::StudentProducedResponse { .. } => false,
    };
    if content_is_rich(&question.stimulus)
        || content_is_rich(&question.prompt)
        || content_is_rich(&question.rationale)
        || answer_rich
    {
        "rich".to_owned()
    } else {
        "plain".to_owned()
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

fn sat_tool_policy_matches(tool_policy: &Value, expected: &[AssessmentTool]) -> bool {
    let expected: HashSet<&'static str> = expected
        .iter()
        .map(|tool| match tool {
            AssessmentTool::Calculator => "calculator",
            AssessmentTool::ReferenceSheet => "reference_sheet",
        })
        .collect();
    let actual: Option<HashSet<&str>> = match tool_policy {
        Value::Array(values) => values.iter().map(Value::as_str).collect(),
        Value::Object(values) => Some(
            values
                .iter()
                .filter(|(_, value)| !matches!(value, Value::Bool(false) | Value::Null))
                .map(|(key, _)| key.as_str())
                .collect(),
        ),
        _ => None,
    };
    actual.is_some_and(|actual| actual == expected)
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
                    question_id: detail.question.question_id.clone(),
                    question_revision_id: detail.question.id.clone(),
                    display_order: detail.display_order,
                    is_pretest: detail.is_pretest,
                    question_type: detail.question.question_type,
                    semantic_revision: detail.question.semantic_revision,
                    revision: detail.question.revision,
                    prompt_preview: content_preview(&detail.question.prompt, 180),
                    answer_key_preview: answer_key_preview(&detail.question.answer),
                    domain: detail.question.metadata.domain.clone(),
                    skill: detail.question.metadata.skill.clone(),
                    difficulty: detail.question.metadata.difficulty.clone(),
                    tags: detail.question.metadata.tags.clone(),
                    has_stimulus: !detail.question.stimulus.is_empty(),
                    content_complexity: question_content_complexity(&detail.question),
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
                updated_questions: Vec::new(),
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
            BulkQuestionAction::PatchMetadata { patch } => {
                if request.expected_revisions.len() != request.question_ids.len() {
                    return Err(AssessmentAuthoringError::InvalidData(
                        "Metadata bulk edits require an expected revision for every selected question."
                            .to_owned(),
                    ));
                }
                for question_id in &request.question_ids {
                    let row = sqlx::query_as::<_, DetailRow>(
                        "SELECT eq.id AS exam_question_id, m.id AS module_id, m.module_key, s.section_key, eq.display_order, eq.is_pretest, qr.id AS revision_id, qr.question_id, qr.semantic_revision, qr.revision, qr.state, qr.question_type, qr.stimulus, qr.prompt, qr.answer_definition, qr.rationale, qr.metadata, qr.accessibility FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id = eq.module_id JOIN assessment_sections s ON s.id = m.section_id JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE eq.id = ? FOR UPDATE",
                    )
                    .bind(question_id)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or(AssessmentAuthoringError::NotFound)?;
                    let mut detail = detail_from_row(row)?;
                    let expected_revision =
                        *request.expected_revisions.get(question_id).ok_or_else(|| {
                            AssessmentAuthoringError::InvalidData(
                                "Missing expected revision for a selected question.".to_owned(),
                            )
                        })?;
                    if detail.question.revision != expected_revision {
                        return Err(AssessmentAuthoringError::Conflict(
                            "A selected question changed while you were editing metadata. Refresh and try again."
                                .to_owned(),
                        ));
                    }
                    if let Some(domain) = &patch.domain {
                        detail.question.metadata.domain = Some(domain.clone());
                        if patch.skill.is_none() {
                            detail.question.metadata.skill = None;
                        }
                    }
                    if let Some(skill) = &patch.skill {
                        detail.question.metadata.skill = Some(skill.clone());
                    }
                    if let Some(difficulty) = &patch.difficulty {
                        detail.question.metadata.difficulty = difficulty.clone();
                    }
                    if let Some(tags) = &patch.tags {
                        detail.question.metadata.tags = normalize_tags(tags)?;
                    }
                    let provider =
                        provider_for("sat").ok_or(AssessmentAuthoringError::UnsupportedProvider)?;
                    let metadata_issues: Vec<_> = provider
                        .validate_question(
                            QuestionValidationContext {
                                section_key: &detail.section_key,
                                module_key: &detail.module_key,
                            },
                            &detail.question,
                        )
                        .into_iter()
                        .filter(|issue| issue.blocking && issue.path.starts_with("metadata."))
                        .collect();
                    if !metadata_issues.is_empty() {
                        return Err(AssessmentAuthoringError::Validation(metadata_issues));
                    }
                    let result = sqlx::query(
                        "UPDATE assessment_question_revisions SET metadata = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(6), created_by = ? WHERE id = ? AND revision = ? AND state = 'draft'",
                    )
                    .bind(serde_json::to_value(&detail.question.metadata)?)
                    .bind(actor_id)
                    .bind(&detail.question.id)
                    .bind(expected_revision)
                    .execute(&mut *tx)
                    .await?;
                    if result.rows_affected() != 1 {
                        return Err(AssessmentAuthoringError::Conflict(
                            "A selected question changed while metadata was being saved."
                                .to_owned(),
                        ));
                    }
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
        let mut refresh_modules = source_modules;
        if let BulkQuestionAction::Move {
            destination_module_id,
        }
        | BulkQuestionAction::Duplicate {
            destination_module_id,
        } = &request.action
        {
            if !refresh_modules.contains(destination_module_id) {
                refresh_modules.push(destination_module_id.clone());
            }
        }
        let mut updated_questions = Vec::new();
        for module_id in refresh_modules {
            updated_questions.extend(self.summaries(&module_id).await?);
        }
        Ok(BulkQuestionResult {
            affected_question_ids: request.question_ids,
            created_question_ids,
            updated_questions,
        })
    }
}

fn prepare_sample_question(
    module_id: &str,
    display_order: i32,
    draft: &BatchQuestionDraft,
) -> Result<PreparedSampleQuestion, AssessmentAuthoringError> {
    let question_type = serde_json::to_value(draft.question_type)?;
    let question_type = question_type
        .as_str()
        .ok_or_else(|| {
            AssessmentAuthoringError::InvalidData("Invalid sample question type.".to_owned())
        })?
        .to_owned();
    Ok(PreparedSampleQuestion {
        question_id: Uuid::new_v4().to_string(),
        revision_id: Uuid::new_v4().to_string(),
        exam_question_id: Uuid::new_v4().to_string(),
        module_id: module_id.to_owned(),
        display_order,
        is_pretest: draft.is_pretest,
        question_type,
        stimulus: serde_json::to_value(&draft.stimulus)?,
        prompt: serde_json::to_value(&draft.prompt)?,
        answer_definition: serde_json::to_value(&draft.answer)?,
        rationale: serde_json::to_value(&draft.rationale)?,
        metadata: serde_json::to_value(&draft.metadata)?,
        accessibility: serde_json::to_value(&draft.accessibility)?,
    })
}

async fn delete_unreferenced_questions_tx(
    tx: &mut Transaction<'_, MySql>,
    question_ids: &[String],
) -> Result<(), AssessmentAuthoringError> {
    if question_ids.is_empty() {
        return Ok(());
    }
    let mut builder = QueryBuilder::<MySql>::new(
        "DELETE q FROM assessment_questions q LEFT JOIN assessment_exam_questions eq ON eq.question_id = q.id WHERE eq.question_id IS NULL AND q.id IN (",
    );
    {
        let mut separated = builder.separated(", ");
        for question_id in question_ids {
            separated.push_bind(question_id);
        }
    }
    builder.push(")");
    builder.build().execute(&mut **tx).await?;
    Ok(())
}

async fn insert_prepared_sample_questions_tx(
    tx: &mut Transaction<'_, MySql>,
    rows: &[PreparedSampleQuestion],
    actor_id: &str,
) -> Result<(), AssessmentAuthoringError> {
    if rows.is_empty() {
        return Err(AssessmentAuthoringError::InvalidData(
            "Sample exam must contain questions.".to_owned(),
        ));
    }

    let mut questions = QueryBuilder::<MySql>::new(
        "INSERT INTO assessment_questions (id, provider_key, created_by) ",
    );
    questions.push_values(rows, |mut row, question| {
        row.push_bind(&question.question_id)
            .push_bind("sat")
            .push_bind(actor_id);
    });
    questions.build().execute(&mut **tx).await?;

    let mut revisions = QueryBuilder::<MySql>::new(
        "INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by) ",
    );
    revisions.push_values(rows, |mut row, question| {
        row.push_bind(&question.revision_id)
            .push_bind(&question.question_id)
            .push_bind(1_i32)
            .push_bind(0_i32)
            .push_bind("draft")
            .push_bind(&question.question_type)
            .push_bind(&question.stimulus)
            .push_bind(&question.prompt)
            .push_bind(&question.answer_definition)
            .push_bind(&question.rationale)
            .push_bind(&question.metadata)
            .push_bind(&question.accessibility)
            .push_bind(actor_id);
    });
    revisions.build().execute(&mut **tx).await?;

    let mut exam_questions = QueryBuilder::<MySql>::new(
        "INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest) ",
    );
    exam_questions.push_values(rows, |mut row, question| {
        row.push_bind(&question.exam_question_id)
            .push_bind(&question.module_id)
            .push_bind(&question.question_id)
            .push_bind(&question.revision_id)
            .push_bind(question.display_order)
            .push_bind(question.is_pretest);
    });
    exam_questions.build().execute(&mut **tx).await?;
    Ok(())
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

#[cfg(test)]
mod authoring_unit_tests {
    use super::*;
    use ielts_backend_domain::assessment::ContentNode;

    fn paragraph(text: &str) -> StructuredContent {
        StructuredContent {
            version: 1,
            nodes: vec![ContentNode::Paragraph {
                id: "p1".to_owned(),
                text: text.to_owned(),
            }],
            document: None,
        }
    }

    #[test]
    fn normalize_tags_trims_deduplicates_and_preserves_first_spelling() {
        let tags = vec![
            " algebra ".to_owned(),
            "ALGEBRA".to_owned(),
            "linear".to_owned(),
            "".to_owned(),
        ];
        assert_eq!(
            normalize_tags(&tags).expect("tags should normalize"),
            vec!["algebra".to_owned(), "linear".to_owned()]
        );
    }

    #[test]
    fn normalize_tags_rejects_oversized_values() {
        let tags = vec!["x".repeat(65)];
        assert!(matches!(
            normalize_tags(&tags),
            Err(AssessmentAuthoringError::InvalidData(_))
        ));
    }

    #[test]
    fn content_preview_collapses_whitespace_and_truncates_on_char_boundaries() {
        let content = paragraph("  SAT   prompt   with   emoji 🎯 and more words  ");
        assert_eq!(content_preview(&content, 18), "SAT prompt with e…");
    }

    #[test]
    fn default_question_is_an_actual_empty_slot() {
        let question = default_question("math");
        assert!(question.prompt.is_empty());
        let AnswerDefinition::SingleChoice {
            options,
            correct_option_id,
        } = question.answer
        else {
            panic!("default SAT question must be multiple choice")
        };
        assert_eq!(options.len(), 4);
        assert!(options.iter().all(|option| option.content.is_empty()));
        assert!(correct_option_id.is_none());
    }

    #[test]
    fn prepared_sample_question_preserves_identity_boundary_and_payload() {
        let draft = BatchQuestionDraft {
            question_type: QuestionKind::StudentProducedResponse,
            stimulus: paragraph("Sample stimulus"),
            prompt: paragraph("Sample prompt"),
            answer: AnswerDefinition::StudentProducedResponse {
                accepted_responses: vec!["5".to_owned()],
                normalize_fraction: true,
                normalize_decimal: true,
                numeric_tolerance: None,
            },
            rationale: paragraph("Sample rationale"),
            metadata: QuestionMetadata {
                section_key: "math".to_owned(),
                domain: Some("algebra".to_owned()),
                skill: Some("Linear Equations in One Variable".to_owned()),
                difficulty: Difficulty::Medium,
                tags: vec!["sample-sat".to_owned()],
            },
            accessibility: AccessibilityMetadata {
                long_description: None,
            },
            is_pretest: true,
        };
        let prepared = prepare_sample_question("module-1", 7, &draft).expect("prepare sample");
        assert_eq!(prepared.module_id, "module-1");
        assert_eq!(prepared.display_order, 7);
        assert!(prepared.is_pretest);
        assert_eq!(prepared.question_type, "student_produced_response");
        assert_eq!(prepared.prompt["nodes"][0]["text"], "Sample prompt");
        assert_ne!(prepared.question_id, prepared.revision_id);
        assert_ne!(prepared.question_id, prepared.exam_question_id);
    }

    #[test]
    fn bulk_action_accepts_frontend_destination_module_id() {
        let action: BulkQuestionAction = serde_json::from_value(json!({
            "type": "move",
            "destinationModuleId": "module-2"
        }))
        .expect("frontend bulk action must deserialize");
        match action {
            BulkQuestionAction::Move {
                destination_module_id,
            } => assert_eq!(destination_module_id, "module-2"),
            other => panic!("expected move action, got {other:?}"),
        }
    }

    #[test]
    fn content_complexity_detects_equations_without_flattening() {
        let mut request = default_question("math");
        request.prompt = StructuredContent {
            version: 1,
            nodes: vec![ContentNode::Equation {
                id: "e1".to_owned(),
                latex: "x^2=4".to_owned(),
                display: true,
            }],
            document: None,
        };
        let question = QuestionRevision {
            id: "revision".to_owned(),
            question_id: "question".to_owned(),
            semantic_revision: 1,
            revision: 0,
            state: "draft".to_owned(),
            question_type: request.question_type,
            stimulus: request.stimulus,
            prompt: request.prompt,
            answer: request.answer,
            rationale: request.rationale,
            metadata: request.metadata,
            accessibility: request.accessibility,
        };
        assert_eq!(question_content_complexity(&question), "rich");
    }
}
