use serde_json::Value;

/// Serializer for exam version content projections
///
/// Provides utilities for:
/// - Producing lossless editable content for builder mode
/// - Computing content sizes for metadata responses
/// - Transforming content based on projection type
pub struct VersionSerializer;

impl VersionSerializer {
    /// Calculate approximate serialized size of a JSON value in bytes.
    ///
    /// Useful for populating content_size_bytes in metadata responses.
    pub fn estimate_content_size(content: &Value) -> usize {
        serde_json::to_vec(content).map(|v| v.len()).unwrap_or(0)
    }

    /// Create lossless builder content from a full version.
    ///
    /// Builder and admin consumers edit answer keys, so every editable field
    /// must survive this projection. Redaction belongs in a dedicated,
    /// explicitly read-only projection.
    pub fn to_builder_content(content_snapshot: &Value, config_snapshot: &Value) -> (Value, Value) {
        (content_snapshot.clone(), config_snapshot.clone())
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
                    .filter(|k| {
                        ["reading", "listening", "writing", "speaking"].contains(&k.as_str())
                    })
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
    fn builder_projection_preserves_all_editable_answer_fields() {
        let input = json!({
            "questions": [{
                "id": "q1",
                "correctAnswer": "A",
                "acceptedAnswers": ["A", "B"],
                "answerRule": "ONE_WORD",
                "answerTree": [{"id": "leaf-1", "acceptedAnswers": ["A"]}]
            }]
        });

        let config = json!({"sections": {"reading": {"enabled": true}}});
        let (projected_content, projected_config) =
            VersionSerializer::to_builder_content(&input, &config);

        assert_eq!(projected_content, input);
        assert_eq!(projected_config, config);
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
