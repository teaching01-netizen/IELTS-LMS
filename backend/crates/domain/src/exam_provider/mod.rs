mod registry;
mod sat;

pub use registry::provider_for;
pub use sat::{
    valid_domain as valid_sat_domain, valid_skill as valid_sat_skill, ADVANCED_MATH_SKILLS,
    ALGEBRA_SKILLS, CRAFT_AND_STRUCTURE_SKILLS, EXPRESSION_OF_IDEAS_SKILLS, GEOMETRY_SKILLS,
    INFORMATION_AND_IDEAS_SKILLS, MATH_DOMAINS, PROBLEM_SOLVING_SKILLS, READING_WRITING_DOMAINS,
    STANDARD_ENGLISH_CONVENTIONS_SKILLS,
};

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
