use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdaptiveRoute {
    Lower,
    Higher,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RoutingError {
    #[error("routing policy is missing minimumCorrectForHigher")]
    MissingThreshold,
    #[error("routing policy threshold is outside the supported integer range")]
    InvalidThreshold,
    #[error("routing policy requires a positive operational question count")]
    InvalidOperationalQuestionCount,
    #[error("routing policy threshold must be between 1 and the operational question count")]
    ThresholdOutOfRange,
    #[error("raw correct must be between 0 and the operational question count")]
    RawCorrectOutOfRange,
}

pub trait AdaptiveRoutingPolicy {
    fn choose_route(
        &self,
        raw_correct: i32,
        operational_questions: i32,
        config: &Value,
    ) -> Result<AdaptiveRoute, RoutingError>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PracticeThresholdRouting;

impl AdaptiveRoutingPolicy for PracticeThresholdRouting {
    fn choose_route(
        &self,
        raw_correct: i32,
        operational_questions: i32,
        config: &Value,
    ) -> Result<AdaptiveRoute, RoutingError> {
        if operational_questions <= 0 {
            return Err(RoutingError::InvalidOperationalQuestionCount);
        }

        let threshold = config
            .get("minimumCorrectForHigher")
            .and_then(Value::as_i64)
            .ok_or(RoutingError::MissingThreshold)
            .and_then(|value| i32::try_from(value).map_err(|_| RoutingError::InvalidThreshold))?;
        if !(1..=operational_questions).contains(&threshold) {
            return Err(RoutingError::ThresholdOutOfRange);
        }
        if !(0..=operational_questions).contains(&raw_correct) {
            return Err(RoutingError::RawCorrectOutOfRange);
        }

        Ok(if raw_correct >= threshold {
            AdaptiveRoute::Higher
        } else {
            AdaptiveRoute::Lower
        })
    }
}
