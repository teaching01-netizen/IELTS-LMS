use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentModuleState {
    NotStarted,
    Active,
    Review,
    Submitted,
    Locked,
}

impl AssessmentModuleState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotStarted => "not_started",
            Self::Active => "active",
            Self::Review => "review",
            Self::Submitted => "submitted",
            Self::Locked => "locked",
        }
    }

    pub fn accepts_response(self) -> bool {
        matches!(self, Self::Active | Self::Review)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModuleAttempt {
    pub id: String,
    pub attempt_id: String,
    pub module_id: String,
    pub state: AssessmentModuleState,
    pub allocated_seconds: i32,
    pub started_at: Option<String>,
    pub review_started_at: Option<String>,
    pub submitted_at: Option<String>,
    pub locked_at: Option<String>,
    pub raw_correct: Option<i32>,
    pub operational_question_count: Option<i32>,
    pub tool_state: Value,
    pub revision: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionResponse {
    pub id: String,
    pub module_attempt_id: String,
    pub exam_question_id: String,
    pub response: Option<Value>,
    pub marked_for_review: bool,
    pub eliminated_options: Vec<String>,
    pub annotations: Value,
    pub revision: i32,
}
