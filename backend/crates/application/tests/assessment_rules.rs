use ielts_backend_application::adaptive_routing::{
    AdaptiveRoute, AdaptiveRoutingPolicy, PracticeThresholdRouting, RoutingError,
};
use ielts_backend_application::assessment_scoring::{score_section, total_score, ScoringError};
use serde_json::json;

#[test]
fn practice_routing_selects_higher_at_the_configured_threshold() {
    let policy = PracticeThresholdRouting;
    let config = json!({ "minimumCorrectForHigher": 18 });

    let route = policy
        .choose_route(18, 25, &config)
        .expect("route at threshold");

    assert_eq!(route, AdaptiveRoute::Higher);
}

#[test]
fn practice_routing_selects_lower_below_the_configured_threshold() {
    let policy = PracticeThresholdRouting;
    let config = json!({ "minimumCorrectForHigher": 18 });

    let route = policy
        .choose_route(17, 25, &config)
        .expect("route below threshold");

    assert_eq!(route, AdaptiveRoute::Lower);
}

#[test]
fn practice_routing_rejects_a_missing_threshold() {
    let policy = PracticeThresholdRouting;

    let error = policy
        .choose_route(17, 25, &json!({}))
        .expect_err("missing threshold must fail");

    assert_eq!(error, RoutingError::MissingThreshold);
}

#[test]
fn practice_scoring_uses_the_selected_section_and_route_table() {
    let policy = json!({
        "readingWriting": {
            "lower": { "17": 500 },
            "higher": { "17": 600 }
        },
        "math": {
            "lower": { "18": 520 },
            "higher": { "18": 620 }
        }
    });

    let reading_writing = score_section(&policy, "reading-writing", AdaptiveRoute::Higher, 17)
        .expect("reading and writing score");
    let math = score_section(&policy, "math", AdaptiveRoute::Lower, 18).expect("math score");

    assert_eq!(reading_writing, Some(600));
    assert_eq!(math, Some(520));
    assert_eq!(total_score(reading_writing, math), Some(1120));
}

#[test]
fn practice_scoring_reports_missing_configured_score() {
    let error = score_section(
        &json!({ "readingWriting": { "higher": {} } }),
        "reading-writing",
        AdaptiveRoute::Higher,
        17,
    )
    .expect_err("missing score must fail");

    assert_eq!(error, ScoringError::MissingScore);
}

#[test]
fn practice_routing_rejects_threshold_above_operational_count() {
    let policy = PracticeThresholdRouting;
    let error = policy
        .choose_route(20, 20, &json!({ "minimumCorrectForHigher": 21 }))
        .expect_err("threshold above operational count must fail");
    assert_eq!(error, RoutingError::ThresholdOutOfRange);
}

#[test]
fn practice_routing_rejects_zero_threshold() {
    let policy = PracticeThresholdRouting;
    let error = policy
        .choose_route(0, 20, &json!({ "minimumCorrectForHigher": 0 }))
        .expect_err("zero threshold must fail");
    assert_eq!(error, RoutingError::ThresholdOutOfRange);
}

#[test]
fn practice_routing_rejects_invalid_operational_count() {
    let policy = PracticeThresholdRouting;
    let error = policy
        .choose_route(0, 0, &json!({ "minimumCorrectForHigher": 1 }))
        .expect_err("zero operational questions must fail");
    assert_eq!(error, RoutingError::InvalidOperationalQuestionCount);
}

#[test]
fn practice_routing_rejects_raw_correct_above_operational_count() {
    let policy = PracticeThresholdRouting;
    let error = policy
        .choose_route(21, 20, &json!({ "minimumCorrectForHigher": 12 }))
        .expect_err("raw score above operational count must fail");
    assert_eq!(error, RoutingError::RawCorrectOutOfRange);
}
