use std::time::Duration;

use ielts_backend_application::proctoring::ProctoringService;
use ielts_backend_domain::schedule::LiveUpdateEvent;

use crate::state::AppState;

pub fn spawn_runtime_auto_advance(state: AppState) -> Option<tokio::task::JoinHandle<()>> {
    if !state.config.runtime_auto_advance_enabled {
        return None;
    }

    let tick_ms = state.config.runtime_auto_advance_tick_ms.max(10);
    let Some(pool) = state.db_pool_opt() else {
        return None;
    };

    Some(tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(tick_ms));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        interval.tick().await;

        let service = ProctoringService::new(pool);
        loop {
            interval.tick().await;

            match service.auto_advance_expired_sections(250).await {
                Ok(outcomes) => {
                    for outcome in outcomes {
                        state.live_updates.publish(LiveUpdateEvent {
                            kind: "schedule_runtime".to_owned(),
                            id: outcome.schedule_id.to_string(),
                            revision: outcome.runtime_revision,
                            event: "auto_advance_section".to_owned(),
                        });
                    }
                }
                Err(error) => {
                    tracing::warn!(error = %error, "runtime auto-advance tick failed");
                }
            }
        }
    }))
}

