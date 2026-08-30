use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{ChoiceOption, QuestionKind, QuestionMetadata, StructuredContent};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DeliveredAnswerDefinition {
    SingleChoice {
        options: Vec<ChoiceOption>,
    },
    StudentProducedResponse {
        #[serde(rename = "normalizeFraction", alias = "normalize_fraction")]
        normalize_fraction: bool,
        #[serde(rename = "normalizeDecimal", alias = "normalize_decimal")]
        normalize_decimal: bool,
        #[serde(rename = "numericTolerance", alias = "numeric_tolerance")]
        numeric_tolerance: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeliveredQuestion {
    pub exam_question_id: String,
    pub question_id: String,
    pub display_order: i32,
    pub is_pretest: bool,
    pub question_type: QuestionKind,
    pub stimulus: StructuredContent,
    pub prompt: StructuredContent,
    pub answer: DeliveredAnswerDefinition,
    pub metadata: QuestionMetadata,
    pub accessibility: super::AccessibilityMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentDeliveryModule {
    pub id: String,
    pub module_key: String,
    pub title: String,
    pub display_order: i32,
    pub duration_seconds: i32,
    pub target_question_count: i32,
    pub adaptive_role: String,
    pub instructions: StructuredContent,
    pub tool_policy: Value,
    pub questions: Vec<DeliveredQuestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentDeliverySection {
    pub id: String,
    pub section_key: String,
    pub title: String,
    pub display_order: i32,
    pub duration_seconds: i32,
    pub break_after_seconds: i32,
    pub instructions: StructuredContent,
    pub modules: Vec<AssessmentDeliveryModule>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentModuleAttemptSnapshot {
    pub id: String,
    pub module_id: String,
    pub state: String,
    pub allocated_seconds: i32,
    pub available_at: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub paused_at: Option<DateTime<Utc>>,
    pub accumulated_paused_seconds: i32,
    pub extension_seconds: i32,
    pub deadline_at: Option<DateTime<Utc>>,
    pub remaining_seconds: i32,
    pub completion_reason: Option<String>,
    pub raw_correct: Option<i32>,
    pub operational_question_count: Option<i32>,
    pub tool_state: Value,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentResponseSnapshot {
    pub id: String,
    pub module_attempt_id: String,
    pub exam_question_id: String,
    pub response: Option<Value>,
    pub marked_for_review: bool,
    pub eliminated_options: Vec<String>,
    pub annotations: Value,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentAttemptSnapshot {
    pub id: String,
    pub module_attempts: Vec<AssessmentModuleAttemptSnapshot>,
    pub responses: Vec<AssessmentResponseSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentTimingSnapshot {
    pub authority: String,
    pub timing_model: String,
    pub stage_key: Option<String>,
    pub stage_status: Option<String>,
    pub server_now: DateTime<Utc>,
    pub deadline_at: Option<DateTime<Utc>>,
    pub remaining_seconds: i32,
    pub runtime_revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentDeliveryBootstrap {
    pub schedule_id: String,
    pub exam_id: String,
    pub provider_key: String,
    pub version_id: String,
    pub server_now: DateTime<Utc>,
    pub candidate_name: String,
    pub schedule_runtime_status: String,
    pub timing: AssessmentTimingSnapshot,
    pub proctor_status: String,
    pub proctor_note: Option<String>,
    pub device_fingerprint_hash: Option<String>,
    pub sections: Vec<AssessmentDeliverySection>,
    pub attempt: AssessmentAttemptSnapshot,
    pub result: Option<super::AssessmentResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssessmentResponseRequest {
    pub revision: i32,
    pub response: Option<Value>,
    pub marked_for_review: bool,
    pub eliminated_options: Vec<String>,
    pub annotations: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module_attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_revision: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_write_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssessmentModuleStartRequest {
    pub module_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssessmentModuleSubmitRequest {
    pub module_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssessmentSubmitRequest {
    pub submission_id: String,
}
