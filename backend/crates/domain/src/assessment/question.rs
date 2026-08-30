use serde::{Deserialize, Serialize};

use super::content::StructuredContent;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuestionKind {
    SingleChoice,
    StudentProducedResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceOption {
    pub id: String,
    pub content: StructuredContent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AnswerDefinition {
    SingleChoice {
        options: Vec<ChoiceOption>,
        #[serde(rename = "correctOptionId", alias = "correct_option_id")]
        correct_option_id: Option<String>,
    },
    StudentProducedResponse {
        #[serde(rename = "acceptedResponses", alias = "accepted_responses")]
        accepted_responses: Vec<String>,
        #[serde(rename = "normalizeFraction", alias = "normalize_fraction")]
        normalize_fraction: bool,
        #[serde(rename = "normalizeDecimal", alias = "normalize_decimal")]
        normalize_decimal: bool,
        #[serde(rename = "numericTolerance", alias = "numeric_tolerance")]
        numeric_tolerance: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Difficulty {
    Easy,
    Medium,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionMetadata {
    pub section_key: String,
    pub domain: Option<String>,
    pub skill: Option<String>,
    pub difficulty: Difficulty,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityMetadata {
    pub long_description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionRevision {
    pub id: String,
    pub question_id: String,
    pub semantic_revision: i32,
    pub revision: i32,
    pub state: String,
    pub question_type: QuestionKind,
    pub stimulus: StructuredContent,
    pub prompt: StructuredContent,
    pub answer: AnswerDefinition,
    pub rationale: StructuredContent,
    pub metadata: QuestionMetadata,
    pub accessibility: AccessibilityMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveQuestionRevisionRequest {
    pub revision: i32,
    pub question_type: QuestionKind,
    pub stimulus: StructuredContent,
    pub prompt: StructuredContent,
    pub answer: AnswerDefinition,
    pub rationale: StructuredContent,
    pub metadata: QuestionMetadata,
    pub accessibility: AccessibilityMetadata,
}
