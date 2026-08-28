use crate::adaptive_routing::AdaptiveRoute;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ScoringError {
    #[error("assessment section is not supported by the scoring policy")]
    UnknownSection,
    #[error("configured score is missing for the raw score and route")]
    MissingScore,
    #[error("configured score is outside the supported integer range")]
    InvalidScore,
}

fn section_field(section_key: &str) -> Result<&'static str, ScoringError> {
    match section_key {
        "reading-writing" => Ok("readingWriting"),
        "math" => Ok("math"),
        _ => Err(ScoringError::UnknownSection),
    }
}

fn route_field(route: AdaptiveRoute) -> &'static str {
    match route {
        AdaptiveRoute::Lower => "lower",
        AdaptiveRoute::Higher => "higher",
    }
}

pub fn score_section(
    policy: &serde_json::Value,
    section_key: &str,
    route: AdaptiveRoute,
    raw_correct: i32,
) -> Result<Option<i32>, ScoringError> {
    let section = section_field(section_key)?;
    let score = policy
        .get(section)
        .and_then(|value| value.get(route_field(route)))
        .and_then(|value| value.get(raw_correct.to_string()))
        .and_then(serde_json::Value::as_i64)
        .ok_or(ScoringError::MissingScore)?;

    i32::try_from(score)
        .map(Some)
        .map_err(|_| ScoringError::InvalidScore)
}

pub fn total_score(reading_writing: Option<i32>, math: Option<i32>) -> Option<i32> {
    reading_writing
        .zip(math)
        .map(|(reading_writing, math)| reading_writing + math)
}
