use ielts_backend_domain::assessment::{AnswerDefinition, ContentNode, DeliveredAnswerDefinition};
use serde_json::json;

#[test]
fn answer_definition_accepts_camel_case_and_serializes_camel_case() {
    let answer: AnswerDefinition = serde_json::from_value(json!({
        "kind": "single_choice",
        "options": [],
        "correctOptionId": "C"
    }))
    .expect("camelCase MCQ answer must deserialize");

    let value = serde_json::to_value(answer).expect("MCQ answer must serialize");
    assert_eq!(value["correctOptionId"], "C");
    assert!(value.get("correct_option_id").is_none());
}

#[test]
fn student_response_contract_accepts_camel_case_and_legacy_snake_case() {
    for value in [
        json!({
            "kind": "student_produced_response",
            "acceptedResponses": ["3/4"],
            "normalizeFraction": true,
            "normalizeDecimal": true,
            "numericTolerance": null
        }),
        json!({
            "kind": "student_produced_response",
            "accepted_responses": ["3/4"],
            "normalize_fraction": true,
            "normalize_decimal": true,
            "numeric_tolerance": null
        }),
    ] {
        let answer: AnswerDefinition =
            serde_json::from_value(value).expect("SPR answer contract must deserialize");
        let serialized = serde_json::to_value(answer).expect("SPR answer must serialize");
        assert_eq!(serialized["acceptedResponses"], json!(["3/4"]));
        assert_eq!(serialized["normalizeFraction"], true);
        assert_eq!(serialized["normalizeDecimal"], true);
        assert!(serialized.get("accepted_responses").is_none());
    }
}

#[test]
fn image_node_accepts_asset_id_in_camel_case_and_legacy_snake_case() {
    for value in [
        json!({"type":"image","id":"img","assetId":"asset-1","alt":"Chart","caption":null}),
        json!({"type":"image","id":"img","asset_id":"asset-1","alt":"Chart","caption":null}),
    ] {
        let node: ContentNode =
            serde_json::from_value(value).expect("image content node must deserialize");
        let serialized = serde_json::to_value(node).expect("image node must serialize");
        assert_eq!(serialized["assetId"], "asset-1");
        assert!(serialized.get("asset_id").is_none());
    }
}

#[test]
fn delivered_student_response_serializes_frontend_field_names() {
    let answer = DeliveredAnswerDefinition::StudentProducedResponse {
        normalize_fraction: true,
        normalize_decimal: true,
        numeric_tolerance: Some("0.01".to_owned()),
    };
    let value = serde_json::to_value(answer).expect("delivered answer must serialize");
    assert_eq!(value["normalizeFraction"], true);
    assert_eq!(value["normalizeDecimal"], true);
    assert_eq!(value["numericTolerance"], "0.01");
}
