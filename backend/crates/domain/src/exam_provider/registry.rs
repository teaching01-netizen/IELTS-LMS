use super::{sat::SatProvider, ExamProvider};

static SAT: SatProvider = SatProvider;

pub fn provider_for(provider_key: &str) -> Option<&'static dyn ExamProvider> {
    match provider_key {
        "sat" => Some(&SAT),
        _ => None,
    }
}
