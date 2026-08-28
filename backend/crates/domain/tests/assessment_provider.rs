use ielts_backend_domain::assessment::{
    content::{ContentNode, StructuredContent},
    question::{
        AccessibilityMetadata, AnswerDefinition, ChoiceOption, Difficulty, QuestionKind,
        QuestionMetadata, QuestionRevision,
    },
};
use ielts_backend_domain::exam_provider::{provider_for, QuestionValidationContext};

fn content(text: &str) -> StructuredContent {
    StructuredContent {
        version: 1,
        document: None,
        nodes: vec![ContentNode::Paragraph {
            id: "node-1".to_owned(),
            text: text.to_owned(),
        }],
    }
}

fn metadata(section_key: &str) -> QuestionMetadata {
    QuestionMetadata {
        section_key: section_key.to_owned(),
        domain: Some(
            if section_key == "math" {
                "algebra"
            } else {
                "information-and-ideas"
            }
            .to_owned(),
        ),
        skill: Some("test-skill".to_owned()),
        difficulty: Difficulty::Medium,
        tags: Vec::new(),
    }
}

fn revision(
    question_type: QuestionKind,
    answer: AnswerDefinition,
    section_key: &str,
) -> QuestionRevision {
    QuestionRevision {
        id: "revision-1".to_owned(),
        question_id: "question-1".to_owned(),
        semantic_revision: 1,
        revision: 0,
        state: "draft".to_owned(),
        question_type,
        stimulus: content("Stimulus"),
        prompt: content("Prompt"),
        answer,
        rationale: content("Rationale"),
        metadata: metadata(section_key),
        accessibility: AccessibilityMetadata {
            long_description: None,
        },
    }
}

#[test]
fn sat_blueprint_exposes_both_sections_and_all_adaptive_modules() {
    let provider = provider_for("sat").expect("SAT provider");
    let blueprint = provider.blueprint();

    assert_eq!(blueprint.sections.len(), 2);
    assert_eq!(blueprint.sections[0].modules.len(), 3);
    assert_eq!(blueprint.sections[1].modules.len(), 3);
    assert_eq!(blueprint.sections[0].modules[0].question_count, 27);
    assert_eq!(blueprint.sections[1].modules[0].question_count, 22);
    assert_eq!(blueprint.sections[0].break_after_seconds, 600);
}

#[test]
fn sat_provider_rejects_student_produced_response_in_reading_and_writing() {
    let provider = provider_for("sat").expect("SAT provider");
    let question = revision(
        QuestionKind::StudentProducedResponse,
        AnswerDefinition::StudentProducedResponse {
            accepted_responses: vec!["4".to_owned()],
            normalize_fraction: true,
            normalize_decimal: true,
            numeric_tolerance: None,
        },
        "reading-writing",
    );

    let issues = provider.validate_question(
        QuestionValidationContext {
            section_key: "reading-writing",
            module_key: "rw-m1",
        },
        &question,
    );

    assert!(issues
        .iter()
        .any(|issue| issue.code == "sat.rw.question_type"));
    assert!(issues.iter().any(|issue| issue.code == "sat.spr.math_only"));
}

#[test]
fn sat_provider_accepts_four_choice_reading_and_writing_question() {
    let provider = provider_for("sat").expect("SAT provider");
    let options = ["a", "b", "c", "d"]
        .into_iter()
        .map(|id| ChoiceOption {
            id: id.to_owned(),
            content: content(id),
        })
        .collect();
    let question = revision(
        QuestionKind::SingleChoice,
        AnswerDefinition::SingleChoice {
            options,
            correct_option_id: Some("b".to_owned()),
        },
        "reading-writing",
    );

    let issues = provider.validate_question(
        QuestionValidationContext {
            section_key: "reading-writing",
            module_key: "rw-m1",
        },
        &question,
    );

    assert!(issues.is_empty(), "unexpected issues: {issues:?}");
}

#[test]
fn sat_provider_validates_alt_text_inside_rich_document() {
    let provider = provider_for("sat").expect("SAT provider");
    let options = ["a", "b", "c", "d"]
        .into_iter()
        .map(|id| ChoiceOption {
            id: id.to_owned(),
            content: content(id),
        })
        .collect();
    let mut question = revision(
        QuestionKind::SingleChoice,
        AnswerDefinition::SingleChoice {
            options,
            correct_option_id: Some("b".to_owned()),
        },
        "reading-writing",
    );
    question.stimulus = StructuredContent {
        version: 2,
        nodes: Vec::new(),
        document: Some(serde_json::json!({
            "type": "doc",
            "content": [{ "type": "image", "attrs": { "assetId": "asset-1", "alt": "" } }]
        })),
    };

    let issues = provider.validate_question(
        QuestionValidationContext {
            section_key: "reading-writing",
            module_key: "rw-m1",
        },
        &question,
    );

    assert!(issues
        .iter()
        .any(|issue| issue.code == "sat.accessibility.alt.required"));
}

#[test]
fn rich_document_text_is_not_treated_as_empty() {
    let rich = StructuredContent {
        version: 2,
        nodes: Vec::new(),
        document: Some(serde_json::json!({
            "type": "doc",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] }]
        })),
    };
    assert!(!rich.is_empty());
}
