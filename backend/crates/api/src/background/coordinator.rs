use ielts_backend_infrastructure::config::BackgroundRuntimeMode;
use std::fmt;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};

#[async_trait::async_trait]
pub trait BackgroundJobs: Send + 'static {
    async fn recover_critical(&mut self) -> Result<(), String>;
    async fn active_cycle(&mut self);
}

#[derive(Clone, Copy, Debug)]
pub struct CoordinatorConfig {
    pub mode: BackgroundRuntimeMode,
    pub grace: Duration,
    pub tick: Duration,
    pub command_capacity: usize,
    pub wake_timeout: Duration,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WakeError {
    QueueFull,
    TimedOut,
    Unavailable,
    Recovery(String),
}

impl fmt::Display for WakeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::QueueFull => formatter.write_str("background runtime queue is full"),
            Self::TimedOut => formatter.write_str("background runtime wake timed out"),
            Self::Unavailable => formatter.write_str("background runtime is unavailable"),
            Self::Recovery(error) => write!(formatter, "critical recovery failed: {error}"),
        }
    }
}

impl std::error::Error for WakeError {}

impl WakeError {
    pub fn as_label(&self) -> &'static str {
        match self {
            Self::QueueFull => "queue_full",
            Self::TimedOut => "timed_out",
            Self::Unavailable => "unavailable",
            Self::Recovery(_) => "recovery_failed",
        }
    }
}

enum BackgroundCommand {
    Wake(oneshot::Sender<Result<(), String>>),
}

struct ActiveCycleGuard(Arc<AtomicBool>);

impl Drop for ActiveCycleGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Clone, Debug)]
pub struct BackgroundRuntimeHandle {
    commands: mpsc::Sender<BackgroundCommand>,
    activity: Arc<Mutex<ActivityWindow>>,
    wake_timeout: Duration,
}

#[derive(Debug)]
pub struct BackgroundRequestLease {
    activity: Arc<Mutex<ActivityWindow>>,
}

impl Drop for BackgroundRequestLease {
    fn drop(&mut self) {
        self.activity
            .lock()
            .expect("background activity lock poisoned")
            .request_finished(Instant::now());
    }
}

#[derive(Debug)]
pub struct BackgroundWebsocketLease {
    activity: Arc<Mutex<ActivityWindow>>,
}

impl Drop for BackgroundWebsocketLease {
    fn drop(&mut self) {
        self.activity
            .lock()
            .expect("background activity lock poisoned")
            .websocket_closed(Instant::now());
    }
}

impl BackgroundRuntimeHandle {
    async fn wake(&self) -> Result<(), WakeError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.commands
            .try_send(BackgroundCommand::Wake(reply_tx))
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => WakeError::QueueFull,
                mpsc::error::TrySendError::Closed(_) => WakeError::Unavailable,
            })?;
        let reply = tokio::time::timeout(self.wake_timeout, reply_rx)
            .await
            .map_err(|_| WakeError::TimedOut)?
            .map_err(|_| WakeError::Unavailable)?;
        reply.map_err(WakeError::Recovery)
    }

    pub async fn activate(&self) -> Result<(), WakeError> {
        self.wake().await
    }

    pub async fn request_started(&self) -> Result<BackgroundRequestLease, WakeError> {
        self.wake().await?;
        self.activity
            .lock()
            .expect("background activity lock poisoned")
            .request_started(Instant::now());
        Ok(BackgroundRequestLease {
            activity: self.activity.clone(),
        })
    }

    pub fn websocket_opened(&self) -> BackgroundWebsocketLease {
        self.activity
            .lock()
            .expect("background activity lock poisoned")
            .websocket_opened(Instant::now());
        BackgroundWebsocketLease {
            activity: self.activity.clone(),
        }
    }
}

pub fn spawn_background_runtime_with_jobs<J>(
    config: CoordinatorConfig,
    jobs: J,
) -> BackgroundRuntimeHandle
where
    J: BackgroundJobs,
{
    let (command_tx, mut command_rx) = mpsc::channel(config.command_capacity.max(1));
    let activity = Arc::new(Mutex::new(ActivityWindow::new(
        config.mode,
        config.grace,
        Instant::now(),
    )));
    let actor_activity = activity.clone();
    let jobs = Arc::new(AsyncMutex::new(jobs));

    tokio::spawn(async move {
        let mut active = config.mode == BackgroundRuntimeMode::Continuous;
        let active_cycle_running = Arc::new(AtomicBool::new(false));
        let mut interval = tokio::time::interval(config.tick.max(Duration::from_millis(1)));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        interval.tick().await;

        loop {
            if !active {
                let Some(BackgroundCommand::Wake(reply)) = command_rx.recv().await else {
                    break;
                };
                if reply.is_closed() {
                    continue;
                }
                match jobs.lock().await.recover_critical().await {
                    Ok(()) => {
                        actor_activity
                            .lock()
                            .expect("background activity lock poisoned")
                            .record_activity(Instant::now());
                        active = true;
                        let _ = reply.send(Ok(()));
                    }
                    Err(error) => {
                        let _ = reply.send(Err(error));
                    }
                }
                continue;
            }

            tokio::select! {
                command = command_rx.recv() => {
                    let Some(BackgroundCommand::Wake(reply)) = command else {
                        break;
                    };
                    if reply.is_closed() {
                        continue;
                    }
                    actor_activity
                        .lock()
                        .expect("background activity lock poisoned")
                        .record_activity(Instant::now());
                    let _ = reply.send(Ok(()));
                }
                _ = interval.tick() => {
                    let now = Instant::now();
                    let should_run = actor_activity
                        .lock()
                        .expect("background activity lock poisoned")
                        .should_run(now);
                    if should_run {
                        if active_cycle_running
                            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                            .is_ok()
                        {
                            let jobs = jobs.clone();
                            let active_cycle_running = active_cycle_running.clone();
                            tokio::spawn(async move {
                                let _running_guard = ActiveCycleGuard(active_cycle_running);
                                jobs.lock().await.active_cycle().await;
                            });
                        }
                        continue;
                    }

                    if active_cycle_running.load(Ordering::Acquire) {
                        continue;
                    }

                    match jobs.lock().await.recover_critical().await {
                        Ok(()) => {
                            let should_stay_active = actor_activity
                                .lock()
                                .expect("background activity lock poisoned")
                                .should_run(Instant::now());
                            if !should_stay_active {
                                active = false;
                                tracing::info!("background runtime quiescent");
                            }
                        }
                        Err(error) => {
                            tracing::error!(error = %error, "background final recovery failed; keeping runtime active");
                            actor_activity
                                .lock()
                                .expect("background activity lock poisoned")
                                .record_activity(Instant::now());
                        }
                    }
                }
            }
        }
    });

    BackgroundRuntimeHandle {
        commands: command_tx,
        activity,
        wake_timeout: config.wake_timeout.max(Duration::from_millis(1)),
    }
}

#[derive(Debug)]
struct ActivityWindow {
    mode: BackgroundRuntimeMode,
    grace: Duration,
    last_activity_at: Instant,
    websocket_count: usize,
    request_count: usize,
}

impl ActivityWindow {
    fn new(mode: BackgroundRuntimeMode, grace: Duration, now: Instant) -> Self {
        Self {
            mode,
            grace,
            last_activity_at: now,
            websocket_count: 0,
            request_count: 0,
        }
    }

    fn record_activity(&mut self, now: Instant) {
        self.last_activity_at = now;
    }

    fn websocket_opened(&mut self, now: Instant) {
        self.websocket_count = self.websocket_count.saturating_add(1);
        self.record_activity(now);
    }

    fn websocket_closed(&mut self, now: Instant) {
        self.websocket_count = self.websocket_count.saturating_sub(1);
        self.record_activity(now);
    }

    fn request_started(&mut self, now: Instant) {
        self.request_count = self.request_count.saturating_add(1);
        self.record_activity(now);
    }

    fn request_finished(&mut self, now: Instant) {
        self.request_count = self.request_count.saturating_sub(1);
        self.record_activity(now);
    }

    fn should_run(&self, now: Instant) -> bool {
        self.mode == BackgroundRuntimeMode::Continuous
            || self.websocket_count > 0
            || self.request_count > 0
            || now.duration_since(self.last_activity_at) < self.grace
    }
}

#[cfg(test)]
mod tests {
    use super::{spawn_background_runtime_with_jobs, BackgroundJobs, CoordinatorConfig, WakeError};
    use async_trait::async_trait;
    use ielts_backend_infrastructure::config::BackgroundRuntimeMode;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::Notify;

    struct BlockingRecovery {
        started: Arc<Notify>,
        release: Arc<Notify>,
    }

    #[async_trait]
    impl BackgroundJobs for BlockingRecovery {
        async fn recover_critical(&mut self) -> Result<(), String> {
            self.started.notify_one();
            self.release.notified().await;
            Ok(())
        }

        async fn active_cycle(&mut self) {}
    }

    struct SlowRecovery;

    #[async_trait]
    impl BackgroundJobs for SlowRecovery {
        async fn recover_critical(&mut self) -> Result<(), String> {
            tokio::time::sleep(Duration::from_millis(100)).await;
            Ok(())
        }

        async fn active_cycle(&mut self) {}
    }

    struct ExpiredWakeRecovery {
        recoveries: usize,
        first_started: Arc<Notify>,
        release_first: Arc<Notify>,
        unexpected_recovery: Arc<Notify>,
    }

    #[async_trait]
    impl BackgroundJobs for ExpiredWakeRecovery {
        async fn recover_critical(&mut self) -> Result<(), String> {
            self.recoveries += 1;
            if self.recoveries == 1 {
                self.first_started.notify_one();
                self.release_first.notified().await;
            } else {
                self.unexpected_recovery.notify_one();
            }
            Err("database unavailable".to_owned())
        }

        async fn active_cycle(&mut self) {}
    }

    struct BlockingActiveCycle {
        active_started: Arc<Notify>,
        release: Arc<Notify>,
    }

    #[async_trait]
    impl BackgroundJobs for BlockingActiveCycle {
        async fn recover_critical(&mut self) -> Result<(), String> {
            Ok(())
        }

        async fn active_cycle(&mut self) {
            self.active_started.notify_one();
            self.release.notified().await;
        }
    }

    #[derive(Clone, Default)]
    struct CountingJobs {
        recoveries: Arc<AtomicUsize>,
        active_cycles: Arc<AtomicUsize>,
        fail_recovery: bool,
    }

    #[async_trait]
    impl BackgroundJobs for CountingJobs {
        async fn recover_critical(&mut self) -> Result<(), String> {
            self.recoveries.fetch_add(1, Ordering::SeqCst);
            if self.fail_recovery {
                Err("database unavailable".to_owned())
            } else {
                Ok(())
            }
        }

        async fn active_cycle(&mut self) {
            self.active_cycles.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn config(command_capacity: usize, wake_timeout: Duration) -> CoordinatorConfig {
        CoordinatorConfig {
            mode: BackgroundRuntimeMode::ActivityDriven,
            grace: Duration::from_secs(60),
            tick: Duration::from_millis(5),
            command_capacity,
            wake_timeout,
        }
    }

    #[tokio::test]
    async fn rejects_wake_when_bounded_command_queue_is_full() {
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let runtime = spawn_background_runtime_with_jobs(
            config(1, Duration::from_secs(1)),
            BlockingRecovery {
                started: started.clone(),
                release: release.clone(),
            },
        );

        let first_runtime = runtime.clone();
        let first = tokio::spawn(async move { first_runtime.activate().await });
        started.notified().await;

        let second_runtime = runtime.clone();
        let second = tokio::spawn(async move { second_runtime.activate().await });
        tokio::task::yield_now().await;

        assert_eq!(runtime.activate().await, Err(WakeError::QueueFull));

        release.notify_one();
        assert_eq!(first.await.unwrap(), Ok(()));
        assert_eq!(second.await.unwrap(), Ok(()));
    }

    #[tokio::test]
    async fn bounds_wait_for_slow_critical_recovery() {
        let runtime =
            spawn_background_runtime_with_jobs(config(1, Duration::from_millis(10)), SlowRecovery);

        assert_eq!(runtime.activate().await, Err(WakeError::TimedOut));
    }

    #[tokio::test]
    async fn timed_out_queued_wakes_do_not_run_recovery_after_callers_leave() {
        let first_started = Arc::new(Notify::new());
        let release_first = Arc::new(Notify::new());
        let unexpected_recovery = Arc::new(Notify::new());
        let runtime = spawn_background_runtime_with_jobs(
            config(8, Duration::from_millis(10)),
            ExpiredWakeRecovery {
                recoveries: 0,
                first_started: first_started.clone(),
                release_first: release_first.clone(),
                unexpected_recovery: unexpected_recovery.clone(),
            },
        );

        let first_runtime = runtime.clone();
        let first = tokio::spawn(async move { first_runtime.activate().await });
        first_started.notified().await;
        let second_runtime = runtime.clone();
        let second = tokio::spawn(async move { second_runtime.activate().await });

        assert_eq!(first.await.unwrap(), Err(WakeError::TimedOut));
        assert_eq!(second.await.unwrap(), Err(WakeError::TimedOut));

        release_first.notify_one();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), unexpected_recovery.notified())
                .await
                .is_err(),
            "an abandoned wake triggered another recovery"
        );
    }

    #[tokio::test]
    async fn wake_preempts_slow_best_effort_active_cycle() {
        let active_started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let runtime = spawn_background_runtime_with_jobs(
            CoordinatorConfig {
                mode: BackgroundRuntimeMode::ActivityDriven,
                grace: Duration::from_secs(60),
                tick: Duration::from_millis(1),
                command_capacity: 1,
                wake_timeout: Duration::from_millis(20),
            },
            BlockingActiveCycle {
                active_started: active_started.clone(),
                release: release.clone(),
            },
        );

        runtime.activate().await.expect("initial recovery succeeds");
        active_started.notified().await;

        assert_eq!(runtime.activate().await, Ok(()));
        release.notify_waiters();
    }

    #[tokio::test]
    async fn zero_capacity_is_normalized_and_activity_boundaries_are_saturating() {
        let now = std::time::Instant::now();
        let mut window = super::ActivityWindow::new(
            BackgroundRuntimeMode::ActivityDriven,
            Duration::from_secs(10),
            now,
        );

        window.request_finished(now);
        window.websocket_closed(now);
        assert!(window.should_run(now + Duration::from_secs(9)));
        assert!(!window.should_run(now + Duration::from_secs(10)));

        let _runtime =
            spawn_background_runtime_with_jobs(config(0, Duration::from_millis(10)), SlowRecovery);
    }

    #[test]
    fn request_and_websocket_leases_hold_activity_open() {
        let now = std::time::Instant::now();
        let mut window = super::ActivityWindow::new(
            BackgroundRuntimeMode::ActivityDriven,
            Duration::from_secs(10),
            now,
        );

        window.request_started(now);
        window.websocket_opened(now);
        assert!(window.should_run(now + Duration::from_secs(100)));

        window.request_finished(now + Duration::from_secs(100));
        assert!(window.should_run(now + Duration::from_secs(200)));

        window.websocket_closed(now + Duration::from_secs(200));
        assert!(window.should_run(now + Duration::from_secs(209)));
        assert!(!window.should_run(now + Duration::from_secs(210)));
    }

    #[tokio::test]
    async fn activation_waits_for_critical_recovery_and_idle_runs_final_recovery() {
        let jobs = CountingJobs::default();
        let observed = jobs.clone();
        let runtime = spawn_background_runtime_with_jobs(
            CoordinatorConfig {
                mode: BackgroundRuntimeMode::ActivityDriven,
                grace: Duration::from_millis(20),
                tick: Duration::from_millis(5),
                command_capacity: 8,
                wake_timeout: Duration::from_secs(1),
            },
            jobs,
        );

        runtime
            .activate()
            .await
            .expect("critical recovery succeeds");
        assert_eq!(observed.recoveries.load(Ordering::SeqCst), 1);

        tokio::time::sleep(Duration::from_millis(45)).await;
        assert_eq!(observed.recoveries.load(Ordering::SeqCst), 2);
        let cycles_after_idle = observed.active_cycles.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(
            observed.active_cycles.load(Ordering::SeqCst),
            cycles_after_idle
        );
    }

    #[tokio::test]
    async fn activation_reports_critical_recovery_failure() {
        let runtime = spawn_background_runtime_with_jobs(
            config(8, Duration::from_secs(1)),
            CountingJobs {
                fail_recovery: true,
                ..CountingJobs::default()
            },
        );

        assert_eq!(
            runtime.activate().await,
            Err(WakeError::Recovery("database unavailable".to_owned()))
        );
    }
}
