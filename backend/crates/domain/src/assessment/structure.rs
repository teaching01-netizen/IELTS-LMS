use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdaptiveRole {
    None,
    Base,
    LowerBranch,
    HigherBranch,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AssessmentTool {
    Calculator,
    ReferenceSheet,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BlueprintModule {
    pub key: &'static str,
    pub title: &'static str,
    pub duration_seconds: i32,
    pub question_count: i32,
    pub pretest_count: i32,
    pub adaptive_role: AdaptiveRole,
    pub tools: Vec<AssessmentTool>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BlueprintSection {
    pub key: &'static str,
    pub title: &'static str,
    pub break_after_seconds: i32,
    pub modules: Vec<BlueprintModule>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AssessmentBlueprint {
    pub sections: Vec<BlueprintSection>,
}

impl AssessmentBlueprint {
    pub fn module(&self, section_key: &str, module_key: &str) -> Option<&BlueprintModule> {
        self.sections
            .iter()
            .find(|section| section.key == section_key)
            .and_then(|section| {
                section
                    .modules
                    .iter()
                    .find(|module| module.key == module_key)
            })
    }
}
