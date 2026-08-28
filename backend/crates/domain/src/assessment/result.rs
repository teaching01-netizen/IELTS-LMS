use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentRoute {
    Lower,
    Higher,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScoreKind {
    Practice,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentSectionResult {
    pub section_key: String,
    pub route: Option<AssessmentRoute>,
    pub raw_correct: i32,
    pub operational_question_count: i32,
    pub scaled_score: Option<i32>,
    pub details: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentResult {
    pub id: String,
    pub submission_id: String,
    pub provider_key: String,
    pub total_score: Option<i32>,
    pub score_payload: Value,
    pub score_kind: ScoreKind,
    pub sections: Vec<AssessmentSectionResult>,
}
