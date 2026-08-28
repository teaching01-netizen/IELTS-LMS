use crate::assessment::{
    content::{ContentNode, StructuredContent},
    question::{AnswerDefinition, QuestionKind, QuestionRevision},
    structure::{
        AdaptiveRole, AssessmentBlueprint, AssessmentTool, BlueprintModule, BlueprintSection,
    },
};

use super::{ExamProvider, QuestionValidationContext, ValidationIssue};
use serde_json::Value;

pub struct SatProvider;

const READING_WRITING_DOMAINS: &[&str] = &[
    "information-and-ideas",
    "craft-and-structure",
    "expression-of-ideas",
    "standard-english-conventions",
];
const MATH_DOMAINS: &[&str] = &[
    "algebra",
    "advanced-math",
    "problem-solving-and-data-analysis",
    "geometry-and-trigonometry",
];

fn issue(code: &'static str, path: &str, message: &str) -> ValidationIssue {
    ValidationIssue {
        code,
        path: path.to_owned(),
        message: message.to_owned(),
        blocking: true,
    }
}

fn validate_rich_document(value: &Value, path: &str, issues: &mut Vec<ValidationIssue>) {
    match value {
        Value::Array(values) => {
            for (index, child) in values.iter().enumerate() {
                validate_rich_document(child, &format!("{path}[{index}]"), issues);
            }
        }
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("image") {
                let alt = object
                    .get("attrs")
                    .and_then(Value::as_object)
                    .and_then(|attrs| attrs.get("alt"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if alt.trim().is_empty() {
                    issues.push(issue(
                        "sat.accessibility.alt.required",
                        &format!("{path}.attrs.alt"),
                        "Images require alternative text.",
                    ));
                }
            }
            if let Some(content) = object.get("content") {
                validate_rich_document(content, &format!("{path}.content"), issues);
            }
        }
        _ => {}
    }
}

fn validate_content(content: &StructuredContent, path: &str, issues: &mut Vec<ValidationIssue>) {
    for (index, node) in content.nodes.iter().enumerate() {
        if let ContentNode::Image { alt, .. } = node {
            if alt.trim().is_empty() {
                issues.push(issue(
                    "sat.accessibility.alt.required",
                    &format!("{path}.nodes[{index}].alt"),
                    "Images require alternative text.",
                ));
            }
        }
    }
    if let Some(document) = content.document.as_ref() {
        validate_rich_document(document, &format!("{path}.document"), issues);
    }
}

fn validate_choice_answer(answer: &AnswerDefinition, issues: &mut Vec<ValidationIssue>) {
    let AnswerDefinition::SingleChoice {
        options,
        correct_option_id,
    } = answer
    else {
        return;
    };

    if options.len() != 4 {
        issues.push(issue(
            "sat.choice.count",
            "answer.options",
            "SAT multiple-choice questions require four answer choices.",
        ));
    }

    if correct_option_id.is_none() {
        issues.push(issue(
            "sat.correct_answer.required",
            "answer.correctOptionId",
            "Select the correct answer.",
        ));
    } else if !options
        .iter()
        .any(|option| Some(&option.id) == correct_option_id.as_ref())
    {
        issues.push(issue(
            "sat.correct_answer.invalid",
            "answer.correctOptionId",
            "The correct answer must reference one of the answer choices.",
        ));
    }

    for (index, option) in options.iter().enumerate() {
        validate_content(
            &option.content,
            &format!("answer.options[{index}].content"),
            issues,
        );
        if option.content.is_empty() {
            issues.push(issue(
                "sat.choice.content.required",
                &format!("answer.options[{index}].content"),
                "Answer choice content is required.",
            ));
        }
    }
}

fn validate_spr_answer(answer: &AnswerDefinition, issues: &mut Vec<ValidationIssue>) {
    let AnswerDefinition::StudentProducedResponse {
        accepted_responses, ..
    } = answer
    else {
        return;
    };

    if accepted_responses
        .iter()
        .all(|response| response.trim().is_empty())
    {
        issues.push(issue(
            "sat.spr.answer.required",
            "answer.acceptedResponses",
            "At least one accepted response is required.",
        ));
    }
}

pub fn valid_domain(section_key: &str, domain: &str) -> bool {
    match section_key {
        "reading-writing" => READING_WRITING_DOMAINS.contains(&domain),
        "math" => MATH_DOMAINS.contains(&domain),
        _ => false,
    }
}

impl ExamProvider for SatProvider {
    fn key(&self) -> &'static str {
        "sat"
    }

    fn blueprint(&self) -> AssessmentBlueprint {
        AssessmentBlueprint {
            sections: vec![
                BlueprintSection {
                    key: "reading-writing",
                    title: "Reading & Writing",
                    break_after_seconds: 600,
                    modules: vec![
                        BlueprintModule {
                            key: "rw-m1",
                            title: "Module 1",
                            duration_seconds: 32 * 60,
                            question_count: 27,
                            pretest_count: 2,
                            adaptive_role: AdaptiveRole::Base,
                            tools: vec![],
                        },
                        BlueprintModule {
                            key: "rw-m2-lower",
                            title: "Module 2 — Lower",
                            duration_seconds: 32 * 60,
                            question_count: 27,
                            pretest_count: 2,
                            adaptive_role: AdaptiveRole::LowerBranch,
                            tools: vec![],
                        },
                        BlueprintModule {
                            key: "rw-m2-higher",
                            title: "Module 2 — Higher",
                            duration_seconds: 32 * 60,
                            question_count: 27,
                            pretest_count: 2,
                            adaptive_role: AdaptiveRole::HigherBranch,
                            tools: vec![],
                        },
                    ],
                },
                BlueprintSection {
                    key: "math",
                    title: "Math",
                    break_after_seconds: 0,
                    modules: vec![
                        BlueprintModule {
                            key: "math-m1",
                            title: "Module 1",
                            duration_seconds: 35 * 60,
                            question_count: 22,
                            pretest_count: 2,
                            adaptive_role: AdaptiveRole::Base,
                            tools: vec![AssessmentTool::Calculator, AssessmentTool::ReferenceSheet],
                        },
                        BlueprintModule {
                            key: "math-m2-lower",
                            title: "Module 2 — Lower",
                            duration_seconds: 35 * 60,
                            question_count: 22,
                            pretest_count: 2,
                            adaptive_role: AdaptiveRole::LowerBranch,
                            tools: vec![AssessmentTool::Calculator, AssessmentTool::ReferenceSheet],
                        },
                        BlueprintModule {
                            key: "math-m2-higher",
                            title: "Module 2 — Higher",
                            duration_seconds: 35 * 60,
                            question_count: 22,
                            pretest_count: 2,
                            adaptive_role: AdaptiveRole::HigherBranch,
                            tools: vec![AssessmentTool::Calculator, AssessmentTool::ReferenceSheet],
                        },
                    ],
                },
            ],
        }
    }

    fn validate_question(
        &self,
        context: QuestionValidationContext<'_>,
        question: &QuestionRevision,
    ) -> Vec<ValidationIssue> {
        let mut issues = Vec::new();

        if question.prompt.is_empty() {
            issues.push(issue(
                "question.prompt.required",
                "prompt",
                "Question text is required.",
            ));
        }
        validate_content(&question.stimulus, "stimulus", &mut issues);
        validate_content(&question.prompt, "prompt", &mut issues);
        validate_content(&question.rationale, "rationale", &mut issues);

        if question.metadata.section_key != context.section_key {
            issues.push(issue(
                "sat.metadata.section.required",
                "metadata.sectionKey",
                "Question metadata must match its assessment section.",
            ));
        }
        match question.metadata.domain.as_deref() {
            None | Some("") => issues.push(issue(
                "sat.metadata.domain.required",
                "metadata.domain",
                "Choose the SAT domain for this question.",
            )),
            Some(domain) if !valid_domain(context.section_key, domain) => issues.push(issue(
                "sat.metadata.domain.invalid",
                "metadata.domain",
                "Choose a valid SAT domain for this section.",
            )),
            Some(_) => {}
        }
        if question
            .metadata
            .skill
            .as_deref()
            .is_none_or(|skill| skill.trim().is_empty())
        {
            issues.push(issue(
                "sat.metadata.skill.required",
                "metadata.skill",
                "Choose the SAT skill for this question.",
            ));
        }

        match (&question.question_type, &question.answer) {
            (QuestionKind::SingleChoice, AnswerDefinition::SingleChoice { .. }) => {
                validate_choice_answer(&question.answer, &mut issues);
            }
            (
                QuestionKind::StudentProducedResponse,
                AnswerDefinition::StudentProducedResponse { .. },
            ) => {
                if context.section_key != "math" {
                    issues.push(issue(
                        "sat.spr.math_only",
                        "questionType",
                        "Student-produced response is only supported in Math.",
                    ));
                }
                validate_spr_answer(&question.answer, &mut issues);
            }
            (QuestionKind::SingleChoice, _) => issues.push(issue(
                "sat.answer.kind_mismatch",
                "answer.kind",
                "The answer definition must match the question type.",
            )),
            (QuestionKind::StudentProducedResponse, _) => issues.push(issue(
                "sat.answer.kind_mismatch",
                "answer.kind",
                "The answer definition must match the question type.",
            )),
        }

        if context.section_key == "reading-writing"
            && question.question_type != QuestionKind::SingleChoice
        {
            issues.push(issue(
                "sat.rw.question_type",
                "questionType",
                "Reading & Writing questions must be multiple choice.",
            ));
        }

        issues
    }
}
