mod registry;
mod sat;

pub use registry::provider_for;

use crate::assessment::{question::QuestionRevision, structure::AssessmentBlueprint};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub code: &'static str,
    pub path: String,
    pub message: String,
    pub blocking: bool,
}

pub struct QuestionValidationContext<'a> {
    pub section_key: &'a str,
    pub module_key: &'a str,
}

pub trait ExamProvider: Send + Sync {
    fn key(&self) -> &'static str;
    fn blueprint(&self) -> AssessmentBlueprint;
    fn validate_question(
        &self,
        context: QuestionValidationContext<'_>,
        question: &QuestionRevision,
    ) -> Vec<ValidationIssue>;
}
