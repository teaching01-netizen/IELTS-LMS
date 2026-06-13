use serde_json::Value;

/// Serializer for exam version content projections
///
/// Provides utilities for:
/// - Stripping answer-related fields for builder mode
/// - Computing content sizes for metadata responses
/// - Transforming content based on projection type
pub struct VersionSerializer;

impl VersionSerializer {
    /// Strip answer-related fields from content for builder mode.
    ///
    /// Removes: correctAnswer, acceptedAnswers, answerRule, answerTree
    /// This reduces payload size and prevents answers from being exposed
    /// in the builder UI where they shouldn't be visible.
    pub fn strip_answers_for_builder(content: &Value) -> Value {
        let mut result = content.clone();
        Self::strip_answers_recursive(&mut result);
        result
    }

    fn strip_answers_recursive(value: &mut Value) {
        match value {
            Value::Object(map) => {
                // Remove answer-related keys at this level
                map.remove("correctAnswer");
                map.remove("acceptedAnswers");
                map.remove("answerRule");
                map.remove("answerTree");

                // Recurse into remaining values
                for (_, v) in map.iter_mut() {
                    Self::strip_answers_recursive(v);
                }
            }
            Value::Array(arr) => {
                for item in arr.iter_mut() {
                    Self::strip_answers_recursive(item);
                }
            }
            _ => {}
        }
    }

    /// Calculate approximate serialized size of a JSON value in bytes.
    ///
    /// Useful for populating content_size_bytes in metadata responses.
    pub fn estimate_content_size(content: &Value) -> usize {
        serde_json::to_vec(content).map(|v| v.len()).unwrap_or(0)
    }

    /// Create builder content by stripping answers from a full version.
    pub fn to_builder_content(
        content_snapshot: &Value,
        config_snapshot: &Value,
    ) -> (Value, Value) {
        (
            Self::strip_answers_for_builder(content_snapshot),
            config_snapshot.clone(),
        )
    }

    /// Validate that content contains expected top-level keys.
    ///
    /// Returns Ok(true) if content is valid, Ok(false) if missing keys,
    /// Err if content is malformed.
    pub fn validate_content_structure(content: &Value) -> Result<bool, String> {
        match content {
            Value::Object(map) => {
                // Check for expected top-level keys (non-strict, just warnings)
                let has_reading = map.contains_key("reading");
                let has_listening = map.contains_key("listening");
                let has_writing = map.contains_key("writing");
                let has_speaking = map.contains_key("speaking");

                if !has_reading && !has_listening && !has_writing && !has_speaking {
                    return Ok(false);
                }

                Ok(true)
            }
            _ => Err("Content snapshot must be a JSON object".to_string()),
        }
    }

    /// Get a summary of content structure for logging/debugging.
    pub fn content_summary(content: &Value) -> Option<String> {
        match content {
            Value::Object(map) => {
                let sections: Vec<&str> = map
                    .keys()
                    .filter(|k| ["reading", "listening", "writing", "speaking"].contains(&k.as_str()))
                    .map(|k| k.as_str())
                    .collect();

                if sections.is_empty() {
                    None
                } else {
                    Some(format!("sections: [{}]", sections.join(", ")))
                }
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strip_answers_removes_correct_answer() {
        let input = json!({
            "questions": [
                {"id": "q1", "correctAnswer": "A", "acceptedAnswers": ["A", "B"]},
                {"id": "q2", "correctAnswer": "C"}
            ]
        });

        let result = VersionSerializer::strip_answers_for_builder(&input);

        assert!(result["questions"][0].get("correctAnswer").is_none());
        assert!(result["questions"][0].get("acceptedAnswers").is_none());
        assert!(result["questions"][1].get("correctAnswer").is_none());
        assert_eq!(result["questions"][0]["id"], "q1");
    }

    #[test]
    fn strip_answers_removes_answer_rule() {
        let input = json!({
            "blocks": [{
                "type": "SENTENCE_COMPLETION",
                "answerRule": {"type": "exact_match"},
                "questions": []
            }]
        });

        let result = VersionSerializer::strip_answers_for_builder(&input);

        assert!(result["blocks"][0].get("answerRule").is_none());
        assert_eq!(result["blocks"][0]["type"], "SENTENCE_COMPLETION");
    }

    #[test]
    fn strip_answers_preserves_other_fields() {
        let input = json!({
            "title": "Test",
            "content": "<p>HTML</p>",
            "correctAnswer": "X"
        });

        let result = VersionSerializer::strip_answers_for_builder(&input);

        assert_eq!(result["title"], "Test");
        assert_eq!(result["content"], "<p>HTML</p>");
        assert!(result.get("correctAnswer").is_none());
    }

    #[test]
    fn estimate_content_size_returns_positive() {
        let content = json!({"key": "value"});
        let size = VersionSerializer::estimate_content_size(&content);
        assert!(size > 0);
    }

    #[test]
    fn validate_content_structure_valid() {
        let content = json!({"reading": {}, "listening": {}});
        assert!(VersionSerializer::validate_content_structure(&content).unwrap());
    }

    #[test]
    fn validate_content_structure_empty() {
        let content = json!({});
        assert!(!VersionSerializer::validate_content_structure(&content).unwrap());
    }

    #[test]
    fn content_summary_returns_sections() {
        let content = json!({"reading": {}, "writing": {}});
        let summary = VersionSerializer::content_summary(&content);
        assert!(summary.is_some());
        assert!(summary.unwrap().contains("reading"));
    }
}
