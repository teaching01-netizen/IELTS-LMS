use crate::state::AppState;
use chrono::Utc;
use ielts_backend_application::proctoring::ProctoringService;
use ielts_backend_domain::schedule::LiveUpdateEvent;
use ielts_backend_infrastructure::database_monitor::{
    inspect_storage_budget, StorageBudgetLevel, StorageBudgetSnapshot,
};
use ielts_backend_worker::jobs;
use std::time::{Duration, Instant};

pub mod coordinator;
pub use coordinator::{
    spawn_background_runtime_with_jobs, BackgroundJobs, BackgroundRequestLease,
    BackgroundRuntimeHandle, BackgroundWebsocketLease, CoordinatorConfig, WakeError,
};

const MAX_OUTBOX_BATCHES_PER_CYCLE: usize = 20;
const RUNTIME_RECONCILIATION_BATCH_SIZE: i64 = 250;

pub async fn spawn_activity_driven_background(
    state: AppState,
) -> Result<BackgroundRuntimeHandle, String> {
    let jobs = ApiBackgroundJobs::new(state.clone()).await?;
    let handle = spawn_background_runtime_with_jobs(
        CoordinatorConfig {
            mode: state.config.background_runtime_mode,
            grace: Duration::from_secs(state.config.background_idle_grace_secs),
            tick: Duration::from_millis(50),
            command_capacity: state.config.background_command_queue_cap,
            wake_timeout: Duration::from_millis(state.config.background_wake_timeout_ms),
        },
        jobs,
    );
    Ok(handle)
}

struct ApiBackgroundJobs {
    state: AppState,
    live_update_cursor: i64,
    last_live_update_at: Instant,
    last_runtime_at: Instant,
    last_worker_at: Instant,
    last_maintenance_at: Option<Instant>,
}

#[async_trait::async_trait]
trait BestEffortJobOperations {
    async fn run_outbox(&mut self) -> Result<(), String>;
    async fn run_grading_projection(&mut self) -> Result<(), String>;
    async fn inspect_storage(&mut self) -> Result<StorageBudgetSnapshot, String>;
    async fn run_retention(&mut self, level: StorageBudgetLevel) -> Result<(), String>;
    async fn run_media_cleanup(&mut self) -> Result<(), String>;
}

async fn run_best_effort_worker_jobs<J: BestEffortJobOperations>(jobs: &mut J) {
    if let Err(error) = jobs.run_outbox().await {
        tracing::error!(error = %error, "background outbox cycle failed");
    }
    if let Err(error) = jobs.run_grading_projection().await {
        tracing::error!(error = %error, "background grading projection cycle failed");
    }
}

async fn run_best_effort_maintenance_jobs<J: BestEffortJobOperations>(jobs: &mut J) {
    let storage_level = match jobs.inspect_storage().await {
        Ok(storage) => {
            if storage.level != StorageBudgetLevel::Normal {
                tracing::warn!(
                    level = storage.level.as_label(),
                    bytes = storage.total_bytes,
                    "storage budget threshold reached during background maintenance"
                );
            }
            storage.level
        }
        Err(error) => {
            tracing::error!(error = %error, "background storage inspection failed");
            StorageBudgetLevel::Normal
        }
    };

    if let Err(error) = jobs.run_retention(storage_level).await {
        tracing::error!(error = %error, "background retention cycle failed");
    }
    if let Err(error) = jobs.run_media_cleanup().await {
        tracing::error!(error = %error, "background media cleanup cycle failed");
    }
}

impl ApiBackgroundJobs {
    async fn new(state: AppState) -> Result<Self, String> {
        let live_update_cursor = match &state.live_update_bus {
            Some(bus) => bus
                .latest_sequence_id()
                .await
                .map_err(|error| error.to_string())?,
            None => 0,
        };
        let now = Instant::now();
        Ok(Self {
            state,
            live_update_cursor,
            last_live_update_at: now,
            last_runtime_at: now,
            last_worker_at: now,
            last_maintenance_at: None,
        })
    }

    async fn reconcile_runtime(&self) -> Result<(), String> {
        if !self.state.config.runtime_auto_advance_enabled {
            return Ok(());
        }
        loop {
            let outcomes = ProctoringService::new(self.state.db_pool())
                .reconcile_expired_sections_at_with_origin(
                    Utc::now(),
                    RUNTIME_RECONCILIATION_BATCH_SIZE,
                    &self.state.instance_id,
                )
                .await
                .map_err(|error| error.to_string())?;
            let reconciled_count = outcomes.len();
            for outcome in outcomes {
                let event = LiveUpdateEvent {
                    kind: "schedule_runtime".to_owned(),
                    id: outcome.schedule_id.to_string(),
                    revision: outcome.runtime_revision,
                    event: "auto_advance_section".to_owned(),
                };
                self.state.live_updates.publish(event.clone());
            }
            if reconciled_count < RUNTIME_RECONCILIATION_BATCH_SIZE as usize {
                break;
            }
        }
        Ok(())
    }

    async fn poll_live_updates(&mut self) -> Result<(), String> {
        let Some(bus) = &self.state.live_update_bus else {
            return Ok(());
        };
        let envelopes = bus
            .poll_after(self.live_update_cursor, 200, &self.state.instance_id)
            .await
            .map_err(|error| error.to_string())?;
        for envelope in envelopes {
            self.live_update_cursor = self.live_update_cursor.max(envelope.sequence_id);
            self.state.live_updates.publish(envelope.event);
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl BestEffortJobOperations for ApiBackgroundJobs {
    async fn run_outbox(&mut self) -> Result<(), String> {
        let pool = self.state.db_pool();
        for _ in 0..MAX_OUTBOX_BATCHES_PER_CYCLE {
            let report = jobs::outbox::run_once(
                pool.clone(),
                &self.state.config,
                &self.state.config.live_mode_notify_channel,
            )
            .await
            .map_err(|error| error.to_string())?;
            if report.claimed == 0 || report.published == 0 {
                break;
            }
        }
        Ok(())
    }

    async fn run_grading_projection(&mut self) -> Result<(), String> {
        jobs::grading_projection::run_once(self.state.db_pool(), &self.state.config)
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    async fn inspect_storage(&mut self) -> Result<StorageBudgetSnapshot, String> {
        inspect_storage_budget(
            &self.state.db_pool(),
            self.state.config.storage_budget_thresholds.clone(),
        )
        .await
        .map_err(|error| error.to_string())
    }

    async fn run_retention(&mut self, level: StorageBudgetLevel) -> Result<(), String> {
        jobs::retention::run_once_with_config_and_budget(
            self.state.db_pool(),
            &self.state.config,
            level,
        )
        .await
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    async fn run_media_cleanup(&mut self) -> Result<(), String> {
        jobs::media::run_once(self.state.db_pool())
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[async_trait::async_trait]
impl BackgroundJobs for ApiBackgroundJobs {
    async fn recover_critical(&mut self) -> Result<(), String> {
        self.reconcile_runtime().await?;
        self.last_runtime_at = Instant::now();
        Ok(())
    }

    async fn active_cycle(&mut self) {
        let now = Instant::now();
        let runtime_interval =
            Duration::from_millis(self.state.config.runtime_auto_advance_tick_ms.max(10));
        let live_interval =
            Duration::from_millis(self.state.config.live_update_poll_interval_ms.max(50));
        let worker_interval = Duration::from_secs(self.state.config.worker_fallback_interval_secs)
            .min(Duration::from_millis(
                self.state.config.grading_projection_interval_ms.max(1_000),
            ));
        let maintenance_interval =
            Duration::from_secs(self.state.config.worker_maintenance_interval_secs.max(60));

        if cycle_due(&mut self.last_runtime_at, runtime_interval, now) {
            if let Err(error) = self.reconcile_runtime().await {
                tracing::error!(error = %error, "background runtime reconciliation failed");
            }
        }
        if cycle_due(&mut self.last_live_update_at, live_interval, now) {
            if let Err(error) = self.poll_live_updates().await {
                tracing::error!(error = %error, "background live-update poll failed");
            }
        }
        if cycle_due(&mut self.last_worker_at, worker_interval, now) {
            run_best_effort_worker_jobs(self).await;
        }
        if self
            .last_maintenance_at
            .is_none_or(|last| now.duration_since(last) >= maintenance_interval)
        {
            self.last_maintenance_at = Some(now);
            run_best_effort_maintenance_jobs(self).await;
        }
    }
}

fn cycle_due(last_run_at: &mut Instant, interval: Duration, now: Instant) -> bool {
    if now.duration_since(*last_run_at) < interval {
        return false;
    }
    *last_run_at = now;
    true
}

#[cfg(test)]
mod tests {
    use super::{
        cycle_due, run_best_effort_maintenance_jobs, run_best_effort_worker_jobs,
        BestEffortJobOperations,
    };
    use async_trait::async_trait;
    use ielts_backend_infrastructure::database_monitor::{
        StorageBudgetLevel, StorageBudgetSnapshot,
    };
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct RecordingBestEffortJobs {
        calls: Vec<&'static str>,
        fail_outbox: bool,
        fail_storage_inspection: bool,
        fail_retention: bool,
        retention_level: Option<StorageBudgetLevel>,
    }

    #[async_trait]
    impl BestEffortJobOperations for RecordingBestEffortJobs {
        async fn run_outbox(&mut self) -> Result<(), String> {
            self.calls.push("outbox");
            if self.fail_outbox {
                Err("outbox unavailable".to_owned())
            } else {
                Ok(())
            }
        }

        async fn run_grading_projection(&mut self) -> Result<(), String> {
            self.calls.push("grading");
            Ok(())
        }

        async fn inspect_storage(&mut self) -> Result<StorageBudgetSnapshot, String> {
            self.calls.push("storage");
            if self.fail_storage_inspection {
                Err("storage inspection unavailable".to_owned())
            } else {
                Ok(StorageBudgetSnapshot {
                    total_bytes: 0,
                    level: StorageBudgetLevel::Warning,
                    largest_relations: Vec::new(),
                })
            }
        }

        async fn run_retention(&mut self, level: StorageBudgetLevel) -> Result<(), String> {
            self.calls.push("retention");
            self.retention_level = Some(level);
            if self.fail_retention {
                Err("retention unavailable".to_owned())
            } else {
                Ok(())
            }
        }

        async fn run_media_cleanup(&mut self) -> Result<(), String> {
            self.calls.push("media");
            Ok(())
        }
    }

    #[test]
    fn cycle_due_fires_at_boundary_and_resets_from_observed_time() {
        let started_at = Instant::now();
        let mut last_run_at = started_at;
        let interval = Duration::from_secs(5);

        assert!(!cycle_due(
            &mut last_run_at,
            interval,
            started_at + interval - Duration::from_millis(1)
        ));
        assert!(cycle_due(&mut last_run_at, interval, started_at + interval));
        assert_eq!(last_run_at, started_at + interval);
    }

    #[tokio::test]
    async fn outbox_failure_does_not_suppress_grading_projection() {
        let mut jobs = RecordingBestEffortJobs {
            fail_outbox: true,
            ..RecordingBestEffortJobs::default()
        };

        run_best_effort_worker_jobs(&mut jobs).await;

        assert_eq!(jobs.calls, vec!["outbox", "grading"]);
    }

    #[tokio::test]
    async fn storage_inspection_failure_uses_normal_retention_policy() {
        let mut jobs = RecordingBestEffortJobs {
            fail_storage_inspection: true,
            ..RecordingBestEffortJobs::default()
        };

        run_best_effort_maintenance_jobs(&mut jobs).await;

        assert_eq!(jobs.calls, vec!["storage", "retention", "media"]);
        assert_eq!(jobs.retention_level, Some(StorageBudgetLevel::Normal));
    }

    #[tokio::test]
    async fn retention_failure_does_not_suppress_media_cleanup() {
        let mut jobs = RecordingBestEffortJobs {
            fail_retention: true,
            ..RecordingBestEffortJobs::default()
        };

        run_best_effort_maintenance_jobs(&mut jobs).await;

        assert_eq!(jobs.calls, vec!["storage", "retention", "media"]);
        assert_eq!(jobs.retention_level, Some(StorageBudgetLevel::Warning));
    }
}
