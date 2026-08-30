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

const INFORMATION_AND_IDEAS_SKILLS: &[&str] = &[
    "Central Ideas and Details",
    "Command of Evidence — Textual",
    "Command of Evidence — Quantitative",
    "Inferences",
];
const CRAFT_AND_STRUCTURE_SKILLS: &[&str] = &[
    "Words in Context",
    "Text Structure and Purpose",
    "Cross-Text Connections",
];
const EXPRESSION_OF_IDEAS_SKILLS: &[&str] = &["Rhetorical Synthesis", "Transitions"];
const STANDARD_ENGLISH_CONVENTIONS_SKILLS: &[&str] = &["Boundaries", "Form, Structure, and Sense"];
const ALGEBRA_SKILLS: &[&str] = &[
    "Linear Equations in One Variable",
    "Linear Functions",
    "Linear Equations in Two Variables",
    "Systems of Two Linear Equations",
    "Linear Inequalities",
];
const ADVANCED_MATH_SKILLS: &[&str] = &[
    "Equivalent Expressions",
    "Nonlinear Equations in One Variable",
    "Systems of Equations in Two Variables",
    "Nonlinear Functions",
];
const PROBLEM_SOLVING_SKILLS: &[&str] = &[
    "Ratios, Rates, Proportional Relationships, and Units",
    "Percentages",
    "One-Variable Data",
    "Two-Variable Data",
    "Probability and Conditional Probability",
    "Inference from Sample Statistics and Margin of Error",
    "Evaluating Statistical Claims",
];
const GEOMETRY_SKILLS: &[&str] = &[
    "Area and Volume",
    "Lines, Angles, and Triangles",
    "Right Triangles and Trigonometry",
    "Circles",
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
                let attrs = object.get("attrs").and_then(Value::as_object);
                let alt = attrs
                    .and_then(|attrs| attrs.get("alt"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let asset_id = attrs
                    .and_then(|attrs| attrs.get("assetId"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let src = attrs
                    .and_then(|attrs| attrs.get("src"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if asset_id.trim().is_empty() && src.trim().is_empty() {
                    issues.push(issue(
                        "sat.media.source.required",
                        &format!("{path}.attrs.assetId"),
                        "Images require an uploaded asset or source URL.",
                    ));
                }
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
        if let ContentNode::Image { asset_id, alt, .. } = node {
            if asset_id.trim().is_empty() {
                issues.push(issue(
                    "sat.media.source.required",
                    &format!("{path}.nodes[{index}].assetId"),
                    "Images require an uploaded asset or source URL.",
                ));
            }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SatSprResponseError {
    Characters,
    Length,
    Format,
    DenominatorZero,
}

impl SatSprResponseError {
    fn code(self) -> &'static str {
        match self {
            Self::Characters => "sat.spr.characters",
            Self::Length => "sat.spr.length",
            Self::Format => "sat.spr.format",
            Self::DenominatorZero => "sat.spr.denominator_zero",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::Characters => {
                "Use only digits, a decimal point, a fraction bar, or a leading minus sign."
            }
            Self::Length => {
                "SAT responses allow at most 5 characters, or 6 including a leading minus sign."
            }
            Self::Format => "Enter an integer, decimal, or fraction such as 12, .5, or 3/4.",
            Self::DenominatorZero => "A fraction denominator cannot be zero.",
        }
    }
}

fn validate_spr_response(response: &str) -> Result<(), SatSprResponseError> {
    let value = response.trim();
    let negative = value.starts_with('-');
    let max_len = if negative { 6 } else { 5 };
    if value.len() > max_len {
        return Err(SatSprResponseError::Length);
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || matches!(byte, b'-' | b'.' | b'/'))
    {
        return Err(SatSprResponseError::Characters);
    }
    if value.matches('-').count() > 1 || (value.contains('-') && !negative) {
        return Err(SatSprResponseError::Format);
    }
    let unsigned = value.strip_prefix('-').unwrap_or(value);
    if unsigned.is_empty() || (unsigned.contains('/') && unsigned.contains('.')) {
        return Err(SatSprResponseError::Format);
    }
    if let Some((numerator, denominator)) = unsigned.split_once('/') {
        if numerator.is_empty()
            || denominator.is_empty()
            || denominator.contains('/')
            || !numerator.bytes().all(|byte| byte.is_ascii_digit())
            || !denominator.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(SatSprResponseError::Format);
        }
        if denominator.bytes().all(|byte| byte == b'0') {
            return Err(SatSprResponseError::DenominatorZero);
        }
        return Ok(());
    }
    let decimal_ok = if let Some((whole, fraction)) = unsigned.split_once('.') {
        !whole.contains('.')
            && !fraction.is_empty()
            && whole.bytes().all(|byte| byte.is_ascii_digit())
            && fraction.bytes().all(|byte| byte.is_ascii_digit())
    } else {
        unsigned.bytes().all(|byte| byte.is_ascii_digit())
    };
    if decimal_ok {
        Ok(())
    } else {
        Err(SatSprResponseError::Format)
    }
}

fn validate_spr_answer(answer: &AnswerDefinition, issues: &mut Vec<ValidationIssue>) {
    let AnswerDefinition::StudentProducedResponse {
        accepted_responses, ..
    } = answer
    else {
        return;
    };
    let non_empty: Vec<_> = accepted_responses
        .iter()
        .enumerate()
        .filter(|(_, response)| !response.trim().is_empty())
        .collect();
    if non_empty.is_empty() {
        issues.push(issue(
            "sat.spr.answer.required",
            "answer.acceptedResponses",
            "At least one accepted response is required.",
        ));
    } else if accepted_responses
        .first()
        .is_none_or(|response| response.trim().is_empty())
    {
        issues.push(issue(
            "sat.spr.primary.required",
            "answer.acceptedResponses[0]",
            "Enter a primary SAT response before adding equivalents.",
        ));
    }
    for (index, response) in non_empty {
        if let Err(error) = validate_spr_response(response) {
            issues.push(issue(
                error.code(),
                &format!("answer.acceptedResponses[{index}]"),
                error.message(),
            ));
        }
    }
}

pub fn valid_domain(section_key: &str, domain: &str) -> bool {
    match section_key {
        "reading-writing" => READING_WRITING_DOMAINS.contains(&domain),
        "math" => MATH_DOMAINS.contains(&domain),
        _ => false,
    }
}

fn valid_skill(domain: &str, skill: &str) -> bool {
    let skills = match domain {
        "information-and-ideas" => INFORMATION_AND_IDEAS_SKILLS,
        "craft-and-structure" => CRAFT_AND_STRUCTURE_SKILLS,
        "expression-of-ideas" => EXPRESSION_OF_IDEAS_SKILLS,
        "standard-english-conventions" => STANDARD_ENGLISH_CONVENTIONS_SKILLS,
        "algebra" => ALGEBRA_SKILLS,
        "advanced-math" => ADVANCED_MATH_SKILLS,
        "problem-solving-and-data-analysis" => PROBLEM_SOLVING_SKILLS,
        "geometry-and-trigonometry" => GEOMETRY_SKILLS,
        _ => return false,
    };
    skills.contains(&skill)
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
        match question.metadata.skill.as_deref() {
            None | Some("") => issues.push(issue(
                "sat.metadata.skill.required",
                "metadata.skill",
                "Choose the SAT skill for this question.",
            )),
            Some(skill)
                if question
                    .metadata
                    .domain
                    .as_deref()
                    .is_none_or(|domain| !valid_skill(domain, skill)) =>
            {
                issues.push(issue(
                    "sat.metadata.skill.invalid",
                    "metadata.skill",
                    "Choose a skill that belongs to the selected SAT domain.",
                ))
            }
            Some(_) => {}
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
