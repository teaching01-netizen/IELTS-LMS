use crate::state::AppState;
use chrono::Utc;
use ielts_backend_application::proctoring::ProctoringService;
use ielts_backend_domain::schedule::LiveUpdateEvent;
use ielts_backend_infrastructure::{
    config::BackgroundRuntimeMode,
    database_monitor::{inspect_storage_budget, StorageBudgetLevel},
};
use ielts_backend_worker::jobs;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};

const MAX_OUTBOX_BATCHES_PER_CYCLE: usize = 20;
const RUNTIME_RECONCILIATION_BATCH_SIZE: i64 = 250;

#[async_trait::async_trait]
pub trait BackgroundJobs: Send + 'static {
    async fn recover(&mut self) -> Result<(), String>;
    async fn active_cycle(&mut self) -> Result<(), String>;
}

enum BackgroundCommand {
    Activate(oneshot::Sender<Result<(), String>>),
    RequestStarted(oneshot::Sender<Result<(), String>>),
    RequestFinished,
    WebsocketOpened,
    WebsocketClosed,
}

#[derive(Clone, Debug)]
pub struct BackgroundRuntimeHandle {
    commands: mpsc::UnboundedSender<BackgroundCommand>,
}

impl BackgroundRuntimeHandle {
    pub async fn activate(&self) -> Result<(), String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.commands
            .send(BackgroundCommand::Activate(reply_tx))
            .map_err(|_| "background runtime is unavailable".to_owned())?;
        reply_rx
            .await
            .map_err(|_| "background runtime stopped during activation".to_owned())?
    }

    pub async fn request_started(&self) -> Result<(), String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.commands
            .send(BackgroundCommand::RequestStarted(reply_tx))
            .map_err(|_| "background runtime is unavailable".to_owned())?;
        reply_rx
            .await
            .map_err(|_| "background runtime stopped during request activation".to_owned())?
    }

    pub fn request_finished(&self) {
        let _ = self.commands.send(BackgroundCommand::RequestFinished);
    }

    pub fn websocket_opened(&self) {
        let _ = self.commands.send(BackgroundCommand::WebsocketOpened);
    }

    pub fn websocket_closed(&self) {
        let _ = self.commands.send(BackgroundCommand::WebsocketClosed);
    }
}

pub fn spawn_background_runtime_with_jobs<J>(
    mode: BackgroundRuntimeMode,
    grace: Duration,
    tick: Duration,
    mut jobs: J,
) -> BackgroundRuntimeHandle
where
    J: BackgroundJobs,
{
    let (command_tx, mut command_rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        let now = Instant::now();
        let mut window = ActivityWindow::new(mode, grace, now);
        let mut active = mode == BackgroundRuntimeMode::Continuous;
        let mut interval = tokio::time::interval(tick.max(Duration::from_millis(1)));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        interval.tick().await;

        loop {
            if !active {
                let Some(command) = command_rx.recv().await else {
                    break;
                };
                match command {
                    BackgroundCommand::Activate(reply) => match jobs.recover().await {
                        Ok(()) => {
                            window.record_activity(Instant::now());
                            active = true;
                            let _ = reply.send(Ok(()));
                        }
                        Err(error) => {
                            let _ = reply.send(Err(error));
                        }
                    },
                    BackgroundCommand::WebsocketOpened => {
                        window.websocket_opened();
                        match jobs.recover().await {
                            Ok(()) => {
                                window.record_activity(Instant::now());
                                active = true;
                            }
                            Err(error) => {
                                tracing::error!(error = %error, "background websocket activation failed");
                            }
                        }
                    }
                    BackgroundCommand::RequestStarted(reply) => match jobs.recover().await {
                        Ok(()) => {
                            window.record_activity(Instant::now());
                            window.request_started();
                            active = true;
                            let _ = reply.send(Ok(()));
                        }
                        Err(error) => {
                            let _ = reply.send(Err(error));
                        }
                    },
                    BackgroundCommand::RequestFinished => {
                        window.request_finished(Instant::now());
                    }
                    BackgroundCommand::WebsocketClosed => window.websocket_closed(Instant::now()),
                }
                continue;
            }

            tokio::select! {
                command = command_rx.recv() => {
                    let Some(command) = command else {
                        break;
                    };
                    match command {
                        BackgroundCommand::Activate(reply) => {
                            window.record_activity(Instant::now());
                            let _ = reply.send(Ok(()));
                        }
                        BackgroundCommand::WebsocketOpened => {
                            window.websocket_opened();
                            window.record_activity(Instant::now());
                        }
                        BackgroundCommand::RequestStarted(reply) => {
                            window.record_activity(Instant::now());
                            window.request_started();
                            let _ = reply.send(Ok(()));
                        }
                        BackgroundCommand::RequestFinished => {
                            window.request_finished(Instant::now());
                        }
                        BackgroundCommand::WebsocketClosed => {
                            window.websocket_closed(Instant::now())
                        }
                    }
                }
                _ = interval.tick() => {
                    let now = Instant::now();
                    if window.should_run(now) {
                        if let Err(error) = jobs.active_cycle().await {
                            tracing::error!(error = %error, "background active cycle failed");
                        }
                        continue;
                    }

                    match jobs.recover().await {
                        Ok(()) => {
                            if !window.should_run(Instant::now()) {
                                active = false;
                                tracing::info!("background runtime quiescent");
                            }
                        }
                        Err(error) => {
                            tracing::error!(error = %error, "background final recovery failed; keeping runtime active");
                            window.record_activity(Instant::now());
                        }
                    }
                }
            }
        }
    });

    BackgroundRuntimeHandle {
        commands: command_tx,
    }
}

pub async fn spawn_activity_driven_background(
    state: AppState,
) -> Result<BackgroundRuntimeHandle, String> {
    let jobs = ApiBackgroundJobs::new(state.clone()).await?;
    let handle = spawn_background_runtime_with_jobs(
        state.config.background_runtime_mode,
        Duration::from_secs(state.config.background_idle_grace_secs),
        Duration::from_millis(50),
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
                .reconcile_expired_sections_at(Utc::now(), RUNTIME_RECONCILIATION_BATCH_SIZE)
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
                if let Some(bus) = &self.state.live_update_bus {
                    bus.enqueue(&self.state.instance_id, &event)
                        .await
                        .map_err(|error| error.to_string())?;
                }
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

    async fn run_worker_cycle(&self) -> Result<(), String> {
        let pool = self.state.db_pool();
        for _ in 0..MAX_OUTBOX_BATCHES_PER_CYCLE {
            let report = jobs::outbox::run_once(
                pool.clone(),
                &self.state.config,
                &self.state.config.live_mode_notify_channel,
            )
            .await
            .map_err(|error| error.to_string())?;
            if report.claimed == 0 {
                break;
            }
        }
        jobs::grading_projection::run_once(pool, &self.state.config)
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    async fn run_maintenance(&self) -> Result<(), String> {
        let pool = self.state.db_pool();
        let storage =
            inspect_storage_budget(&pool, self.state.config.storage_budget_thresholds.clone())
                .await
                .map_err(|error| error.to_string())?;
        jobs::retention::run_once_with_config_and_budget(
            pool.clone(),
            &self.state.config,
            storage.level,
        )
        .await
        .map_err(|error| error.to_string())?;
        jobs::media::run_once(pool)
            .await
            .map_err(|error| error.to_string())?;
        if storage.level != StorageBudgetLevel::Normal {
            tracing::warn!(
                level = storage.level.as_label(),
                bytes = storage.total_bytes,
                "storage budget threshold reached during background maintenance"
            );
        }
        Ok(())
    }

    async fn recover_all(&mut self) -> Result<(), String> {
        self.reconcile_runtime().await?;
        self.run_worker_cycle().await?;
        self.poll_live_updates().await?;
        let now = Instant::now();
        let maintenance_interval =
            Duration::from_secs(self.state.config.worker_maintenance_interval_secs.max(60));
        if self
            .last_maintenance_at
            .is_none_or(|last| now.duration_since(last) >= maintenance_interval)
        {
            self.run_maintenance().await?;
            self.last_maintenance_at = Some(Instant::now());
        }
        let completed_at = Instant::now();
        self.last_live_update_at = completed_at;
        self.last_runtime_at = completed_at;
        self.last_worker_at = completed_at;
        Ok(())
    }
}

#[async_trait::async_trait]
impl BackgroundJobs for ApiBackgroundJobs {
    async fn recover(&mut self) -> Result<(), String> {
        self.recover_all().await
    }

    async fn active_cycle(&mut self) -> Result<(), String> {
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
            self.reconcile_runtime().await?;
        }
        if cycle_due(&mut self.last_live_update_at, live_interval, now) {
            self.poll_live_updates().await?;
        }
        if cycle_due(&mut self.last_worker_at, worker_interval, now) {
            self.run_worker_cycle().await?;
        }
        if self
            .last_maintenance_at
            .is_none_or(|last| now.duration_since(last) >= maintenance_interval)
        {
            self.run_maintenance().await?;
            self.last_maintenance_at = Some(Instant::now());
        }
        Ok(())
    }
}

#[derive(Debug)]
pub struct ActivityWindow {
    mode: BackgroundRuntimeMode,
    grace: Duration,
    last_activity_at: Instant,
    websocket_count: usize,
    request_count: usize,
}

impl ActivityWindow {
    pub fn new(mode: BackgroundRuntimeMode, grace: Duration, now: Instant) -> Self {
        Self {
            mode,
            grace,
            last_activity_at: now,
            websocket_count: 0,
            request_count: 0,
        }
    }

    pub fn record_activity(&mut self, now: Instant) {
        self.last_activity_at = now;
    }

    pub fn websocket_opened(&mut self) {
        self.websocket_count = self.websocket_count.saturating_add(1);
    }

    pub fn websocket_closed(&mut self, now: Instant) {
        self.websocket_count = self.websocket_count.saturating_sub(1);
        self.record_activity(now);
    }

    pub fn request_started(&mut self) {
        self.request_count = self.request_count.saturating_add(1);
    }

    pub fn request_finished(&mut self, now: Instant) {
        self.request_count = self.request_count.saturating_sub(1);
        self.record_activity(now);
    }

    pub fn should_run(&self, now: Instant) -> bool {
        self.mode == BackgroundRuntimeMode::Continuous
            || self.websocket_count > 0
            || self.request_count > 0
            || now.duration_since(self.last_activity_at) < self.grace
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
    use super::{spawn_background_runtime_with_jobs, ActivityWindow, BackgroundJobs};
    use async_trait::async_trait;
    use ielts_backend_infrastructure::config::BackgroundRuntimeMode;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::time::{Duration, Instant};

    #[derive(Clone, Default)]
    struct FakeJobs {
        recoveries: Arc<AtomicUsize>,
        active_cycles: Arc<AtomicUsize>,
        fail_recovery: bool,
    }

    #[async_trait]
    impl BackgroundJobs for FakeJobs {
        async fn recover(&mut self) -> Result<(), String> {
            self.recoveries.fetch_add(1, Ordering::SeqCst);
            if self.fail_recovery {
                Err("database unavailable".to_owned())
            } else {
                Ok(())
            }
        }

        async fn active_cycle(&mut self) -> Result<(), String> {
            self.active_cycles.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    #[test]
    fn activity_driven_window_quiesces_at_the_grace_boundary() {
        let started_at = Instant::now();
        let window = ActivityWindow::new(
            BackgroundRuntimeMode::ActivityDriven,
            Duration::from_secs(60),
            started_at,
        );

        assert!(window.should_run(started_at + Duration::from_secs(59)));
        assert!(!window.should_run(started_at + Duration::from_secs(60)));
    }

    #[test]
    fn continuous_window_never_quiesces() {
        let started_at = Instant::now();
        let window = ActivityWindow::new(
            BackgroundRuntimeMode::Continuous,
            Duration::from_secs(60),
            started_at,
        );

        assert!(window.should_run(started_at + Duration::from_secs(60 * 60)));
    }

    #[test]
    fn websocket_holds_window_open_and_new_activity_restarts_grace() {
        let started_at = Instant::now();
        let mut window = ActivityWindow::new(
            BackgroundRuntimeMode::ActivityDriven,
            Duration::from_secs(60),
            started_at,
        );

        window.websocket_opened();
        assert!(window.should_run(started_at + Duration::from_secs(600)));
        window.websocket_closed(started_at + Duration::from_secs(600));
        assert!(window.should_run(started_at + Duration::from_secs(659)));
        assert!(!window.should_run(started_at + Duration::from_secs(660)));

        let reactivated_at = started_at + Duration::from_secs(601);
        window.record_activity(reactivated_at);
        assert!(window.should_run(reactivated_at + Duration::from_secs(59)));
        assert!(!window.should_run(reactivated_at + Duration::from_secs(60)));
    }

    #[test]
    fn in_flight_request_holds_window_open_until_completion() {
        let started_at = Instant::now();
        let mut window = ActivityWindow::new(
            BackgroundRuntimeMode::ActivityDriven,
            Duration::from_secs(60),
            started_at,
        );

        window.request_started();
        assert!(window.should_run(started_at + Duration::from_secs(600)));
        window.request_finished(started_at + Duration::from_secs(600));
        assert!(window.should_run(started_at + Duration::from_secs(659)));
        assert!(!window.should_run(started_at + Duration::from_secs(660)));
    }

    #[test]
    fn cycle_due_fires_at_boundary_and_resets_from_observed_time() {
        let started_at = Instant::now();
        let mut last_run_at = started_at;
        let interval = Duration::from_secs(5);

        assert!(!super::cycle_due(
            &mut last_run_at,
            interval,
            started_at + interval - Duration::from_millis(1)
        ));
        assert!(super::cycle_due(
            &mut last_run_at,
            interval,
            started_at + interval
        ));
        assert_eq!(last_run_at, started_at + interval);
    }

    #[tokio::test]
    async fn activation_waits_for_recovery_and_idle_runs_a_final_recovery() {
        let jobs = FakeJobs::default();
        let observed = jobs.clone();
        let runtime = spawn_background_runtime_with_jobs(
            BackgroundRuntimeMode::ActivityDriven,
            Duration::from_millis(20),
            Duration::from_millis(5),
            jobs,
        );

        runtime.activate().await.expect("first recovery succeeds");
        assert_eq!(observed.recoveries.load(Ordering::SeqCst), 1);

        tokio::time::sleep(Duration::from_millis(45)).await;
        assert_eq!(observed.recoveries.load(Ordering::SeqCst), 2);
        let cycles_after_idle = observed.active_cycles.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(
            observed.active_cycles.load(Ordering::SeqCst),
            cycles_after_idle,
            "active cycles must stop after quiescence"
        );

        runtime.activate().await.expect("wake recovery succeeds");
        assert_eq!(observed.recoveries.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn activation_reports_recovery_failure() {
        let jobs = FakeJobs {
            fail_recovery: true,
            ..FakeJobs::default()
        };
        let runtime = spawn_background_runtime_with_jobs(
            BackgroundRuntimeMode::ActivityDriven,
            Duration::from_millis(20),
            Duration::from_millis(5),
            jobs,
        );

        let error = runtime
            .activate()
            .await
            .expect_err("recovery must fail closed");
        assert_eq!(error, "database unavailable");
    }
}
