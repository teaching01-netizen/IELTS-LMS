use ielts_backend_domain::grading::{
    ObjectiveGradingAudit, ObjectiveIntegrityIssueCode, ObjectiveIntegrityStatus,
};
use serde_json::Value;
use std::collections::HashMap;

pub(crate) const AMBIGUOUS_SECTION_MAPPING: &str = "__ambiguous__";

pub(crate) fn answer_key_issue(
    correct_answer: Option<&Value>,
    accepted_answers: Option<&Value>,
    resolved_answers: &[String],
    scoring_rule: &str,
) -> Option<ObjectiveIntegrityIssueCode> {
    if correct_answer.is_some_and(|value| !value.is_string()) {
        return Some(ObjectiveIntegrityIssueCode::InvalidAnswerKey);
    }
    if let Some(value) = accepted_answers {
        let Some(values) = value.as_array() else {
            return Some(ObjectiveIntegrityIssueCode::InvalidAnswerKey);
        };
        if values.iter().any(|entry| !entry.is_string()) {
            return Some(ObjectiveIntegrityIssueCode::InvalidAnswerKey);
        }
    }
    if resolved_answers.is_empty() {
        return Some(ObjectiveIntegrityIssueCode::MissingAnswerKey);
    }
    if resolved_answers.iter().any(|answer| {
        !student_answer_obeys_scoring_rule(&Value::String(answer.clone()), scoring_rule)
    }) {
        return Some(ObjectiveIntegrityIssueCode::AnswerKeyViolatesScoringRule);
    }
    None
}

pub(crate) fn student_answer_is_malformed(value: &Value) -> bool {
    match value {
        Value::Null | Value::String(_) => false,
        Value::Array(values) => values.iter().any(student_answer_is_malformed),
        Value::Bool(_) | Value::Number(_) | Value::Object(_) => true,
    }
}

pub(crate) fn answer_is_blank(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(text) => text.trim().is_empty(),
        Value::Array(values) => values.is_empty() || values.iter().all(answer_is_blank),
        Value::Bool(_) | Value::Number(_) | Value::Object(_) => false,
    }
}

pub(crate) fn student_answer_obeys_scoring_rule(value: &Value, scoring_rule: &str) -> bool {
    let Some(max_words) = max_word_count(scoring_rule) else {
        return true;
    };
    let values = strict_text_values(value);
    if values.len() != 1 {
        return false;
    }
    values[0].split_whitespace().count() <= max_words
}

pub(crate) fn issue_message(code: ObjectiveIntegrityIssueCode) -> &'static str {
    match code {
        ObjectiveIntegrityIssueCode::MissingAnswerKey => {
            "The published question has no usable answer key."
        }
        ObjectiveIntegrityIssueCode::InvalidAnswerKey => "The answer key has an invalid shape.",
        ObjectiveIntegrityIssueCode::AnswerKeyViolatesScoringRule => {
            "The configured answer key violates its scoring rule."
        }
        ObjectiveIntegrityIssueCode::UnsupportedQuestionType => {
            "The question type has no supported grader."
        }
        ObjectiveIntegrityIssueCode::DuplicateQuestionId => {
            "The published section contains a duplicate question ID."
        }
        ObjectiveIntegrityIssueCode::UnknownStudentAnswerId => {
            "The submission contains an answer ID absent from the published question map."
        }
        ObjectiveIntegrityIssueCode::AnswerPayloadTypeInvalid => {
            "The submitted answer has an unsupported JSON shape."
        }
        ObjectiveIntegrityIssueCode::SectionMappingUnavailable => {
            "The published question-to-section map could not be constructed."
        }
        ObjectiveIntegrityIssueCode::SectionMappingAmbiguous => {
            "The answer ID maps to more than one objective section."
        }
        ObjectiveIntegrityIssueCode::SubmissionMergeIncomplete => {
            "The final submission does not prove that all answer mutations were acknowledged."
        }
        ObjectiveIntegrityIssueCode::GradingSourceStale => {
            "The stored grading result was produced from an obsolete grading source."
        }
        ObjectiveIntegrityIssueCode::ManualOverrideStale => {
            "The manual override was produced from an obsolete grading source."
        }
    }
}

pub(crate) fn attach_answer_mapping_issues(
    results: &mut Value,
    raw_answers: &Value,
    answer_sections: &HashMap<String, String>,
) {
    let Some(integrity) = results.get("integrity").cloned() else {
        return;
    };
    let Ok(mut audit) = serde_json::from_value::<ObjectiveGradingAudit>(integrity) else {
        return;
    };
    let answer_map = raw_answers.as_object();
    let mut unknown_answer_ids = answer_map
        .into_iter()
        .flat_map(|answers| answers.keys())
        .filter(|question_id| {
            !answer_sections.contains_key(*question_id)
                || answer_sections.get(*question_id).map(String::as_str)
                    == Some(AMBIGUOUS_SECTION_MAPPING)
        })
        .cloned()
        .collect::<Vec<_>>();
    unknown_answer_ids.sort();
    unknown_answer_ids.dedup();
    let has_unavailable_mapping = answer_sections.is_empty()
        && (audit.expected_question_count > 0
            || answer_map.is_some_and(|answers| !answers.is_empty()));
    let has_ambiguous_mapping = unknown_answer_ids.iter().any(|question_id| {
        answer_sections.get(question_id).map(String::as_str) == Some(AMBIGUOUS_SECTION_MAPPING)
    });
    if unknown_answer_ids.is_empty() && !has_unavailable_mapping {
        return;
    }

    let issue_code = if has_unavailable_mapping {
        ObjectiveIntegrityIssueCode::SectionMappingUnavailable
    } else if has_ambiguous_mapping {
        ObjectiveIntegrityIssueCode::SectionMappingAmbiguous
    } else {
        ObjectiveIntegrityIssueCode::UnknownStudentAnswerId
    };
    audit.unknown_answer_ids = unknown_answer_ids;
    audit.unknown_answer_count = audit
        .unknown_answer_ids
        .len()
        .try_into()
        .unwrap_or(u32::MAX);
    if !audit.issue_codes.contains(&issue_code) {
        audit.issue_codes.push(issue_code);
    }
    audit.integrity_status = ObjectiveIntegrityStatus::NeedsRecheck;
    if let Ok(value) = serde_json::to_value(&audit) {
        if let Some(payload) = results.as_object_mut() {
            payload.insert("integrity".to_owned(), value);
            payload.insert(
                "unknownStudentAnswerIds".to_owned(),
                Value::Array(
                    audit
                        .unknown_answer_ids
                        .iter()
                        .cloned()
                        .map(Value::String)
                        .collect(),
                ),
            );
        }
    }
}

pub(crate) fn objective_results_are_verified(results: &Value) -> bool {
    results
        .get("integrity")
        .and_then(|integrity| integrity.get("integrityStatus"))
        .and_then(Value::as_str)
        == Some("verified")
}

pub(crate) fn set_grading_source_version(results: &mut Value, source_version_id: &str) {
    let Some(integrity) = results.get_mut("integrity") else {
        return;
    };
    let Ok(mut audit) = serde_json::from_value::<ObjectiveGradingAudit>(integrity.clone()) else {
        return;
    };
    audit.grading_source_version_id = source_version_id.to_owned();
    if let Ok(value) = serde_json::to_value(audit) {
        *integrity = value;
    }
}

pub(crate) fn validate_release_integrity(
    results: &[Value],
) -> Result<(), ObjectiveIntegrityIssueCode> {
    for result in results {
        let Some(integrity) = result.get("integrity") else {
            return Err(ObjectiveIntegrityIssueCode::GradingSourceStale);
        };
        let Ok(audit) = serde_json::from_value::<ObjectiveGradingAudit>(integrity.clone()) else {
            return Err(ObjectiveIntegrityIssueCode::GradingSourceStale);
        };
        if audit.validate().is_err() {
            return Err(ObjectiveIntegrityIssueCode::GradingSourceStale);
        }
        if audit.integrity_status != ObjectiveIntegrityStatus::Verified {
            return Err(audit
                .issue_codes
                .first()
                .copied()
                .unwrap_or(ObjectiveIntegrityIssueCode::GradingSourceStale));
        }
    }
    Ok(())
}

pub(crate) fn validate_release_integrity_for_source(
    results: &[Value],
    expected_source_version_id: &str,
) -> Result<(), ObjectiveIntegrityIssueCode> {
    validate_release_integrity(results)?;
    for result in results {
        let Some(integrity) = result.get("integrity") else {
            return Err(ObjectiveIntegrityIssueCode::GradingSourceStale);
        };
        let Ok(audit) = serde_json::from_value::<ObjectiveGradingAudit>(integrity.clone()) else {
            return Err(ObjectiveIntegrityIssueCode::GradingSourceStale);
        };
        if audit.grading_source_version_id != expected_source_version_id {
            return Err(ObjectiveIntegrityIssueCode::GradingSourceStale);
        }
    }
    Ok(())
}

fn max_word_count(scoring_rule: &str) -> Option<usize> {
    match scoring_rule.trim().to_ascii_uppercase().as_str() {
        "ONE_WORD" => Some(1),
        "TWO_WORDS" => Some(2),
        "THREE_WORDS" => Some(3),
        _ => None,
    }
}

fn strict_text_values(value: &Value) -> Vec<String> {
    match value {
        Value::String(text) => vec![text.clone()],
        Value::Array(values) => values.iter().flat_map(strict_text_values).collect(),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::Object(_) => Vec::new(),
    }
}
