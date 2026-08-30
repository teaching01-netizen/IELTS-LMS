use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StructuredContent {
    pub version: u8,
    #[serde(default)]
    pub nodes: Vec<ContentNode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document: Option<Value>,
}

impl StructuredContent {
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
            && self
                .document
                .as_ref()
                .is_none_or(|document| !document_has_meaningful_content(document))
    }
}

fn document_has_meaningful_content(value: &Value) -> bool {
    match value {
        Value::String(value) => !value.trim().is_empty(),
        Value::Array(values) => values.iter().any(document_has_meaningful_content),
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("image") {
                return true;
            }
            if matches!(
                object.get("type").and_then(Value::as_str),
                Some("inlineMath" | "blockMath")
            ) {
                return object
                    .get("attrs")
                    .and_then(Value::as_object)
                    .and_then(|attrs| attrs.get("latex"))
                    .and_then(Value::as_str)
                    .is_some_and(|latex| !latex.trim().is_empty());
            }
            object
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|text| !text.trim().is_empty())
                || object
                    .get("content")
                    .is_some_and(document_has_meaningful_content)
        }
        _ => false,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentNode {
    Paragraph {
        id: String,
        text: String,
    },
    Heading {
        id: String,
        level: u8,
        text: String,
    },
    Equation {
        id: String,
        latex: String,
        display: bool,
    },
    Image {
        id: String,
        #[serde(rename = "assetId", alias = "asset_id")]
        asset_id: String,
        alt: String,
        caption: Option<String>,
    },
    Table {
        id: String,
        rows: Vec<Vec<String>>,
    },
}
