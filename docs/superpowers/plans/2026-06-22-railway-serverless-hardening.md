# Railway Serverless Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Railway activity-driven mode bounded, failure-isolated, retry-safe, and transactionally durable without changing continuous-mode behavior.

**Architecture:** Extract a bounded coordinator from API job execution, gate requests only on persisted timer reconciliation, and run cleanup/projection/delivery as independent best-effort cycles. Persist timer live-update rows inside the timer transaction, add additive outbox retry scheduling, and normalize runtime mode identically in Rust and the container script.

**Tech Stack:** Rust 1.88, Tokio, Axum, SQLx/MySQL, Bash, Cargo tests.

---

## File map

- Create `backend/crates/api/src/background/coordinator.rs`: bounded lifecycle actor, wake deadline, activity window, and deterministic actor tests.
- Modify `backend/crates/api/src/background.rs`: API-owned critical recovery and isolated best-effort jobs.
- Modify `backend/crates/api/src/lib.rs`: construct the coordinator without blocking listener startup.
- Modify `backend/crates/api/src/router.rs`: map bounded queue/deadline failures to 503.
- Modify `backend/crates/api/src/state.rs`: coordinator handle integration only.
- Modify `backend/crates/application/src/proctoring.rs`: atomically insert durable live-update rows for timer transitions.
- Modify `backend/crates/api/src/runtime_auto_advance.rs`: pass the API instance identity to timer reconciliation.
- Modify `backend/crates/infrastructure/src/live_update_bus.rs`: add transaction-scoped enqueue API.
- Create `backend/migrations/0030_outbox_retry_policy.sql`: additive retry/terminal columns and claim index.
- Modify `backend/crates/infrastructure/src/outbox.rs`: retry eligibility and bounded retry disposition.
- Modify `backend/crates/worker/src/jobs/outbox.rs`: apply retry disposition and report terminal failures.
- Modify `backend/crates/infrastructure/src/config.rs`: bounded coordinator configuration.
- Modify `.env.example` and `backend/.env.example`: document new guardrails.
- Modify `backend/Dockerfile`: normalize runtime mode before process selection.
- Modify `docs/architecture/railway-serverless.md`: record critical/best-effort split, retry policy, and rollback.

### Task 1: Bounded coordinator

**Files:**
- Create: `backend/crates/api/src/background/coordinator.rs`
- Modify: `backend/crates/api/src/background.rs`
- Modify: `backend/crates/infrastructure/src/config.rs`
- Test: `backend/crates/api/src/background/coordinator.rs`

- [x] Write failing actor tests for queue saturation, wake timeout, critical recovery failure, zero-cap normalization, request lifetime, WebSocket lifetime, and quiescence boundary.
- [x] Run `cargo test -p ielts-backend-api background::coordinator --lib` and confirm failures identify the missing bounded API.
- [x] Introduce the narrow coordinator contract:

```rust
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

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum WakeError {
    #[error("background runtime queue is full")]
    QueueFull,
    #[error("background runtime wake timed out")]
    TimedOut,
    #[error("background runtime is unavailable")]
    Unavailable,
    #[error("critical recovery failed: {0}")]
    Recovery(String),
}
```

- [x] Use `mpsc::channel(config.command_capacity.max(1))`, `try_send`, and `tokio::time::timeout` so both memory and caller wait are bounded.
- [x] Keep `RequestFinished` and WebSocket notifications loss-tolerant but use saturating counters and a final critical recovery before quiescence.
- [x] Add `BACKGROUND_COMMAND_QUEUE_CAP` and `BACKGROUND_WAKE_TIMEOUT_MS` parsing with minimum value one and defaults 256/10,000.
- [x] Re-run the focused coordinator tests and expect all new boundary/adversarial cases to pass.

### Task 2: Separate critical recovery from best-effort jobs

**Files:**
- Modify: `backend/crates/api/src/background.rs`
- Modify: `backend/crates/api/src/lib.rs`
- Modify: `backend/crates/api/src/router.rs`
- Test: `backend/crates/api/src/router.rs`
- Test: `backend/crates/api/src/background.rs`

- [x] Write failing tests proving a critical failure returns 503 while grading/maintenance/live polling failures do not affect request admission.
- [x] Run `cargo test -p ielts-backend-api background router::tests --lib` and confirm the best-effort isolation test fails under the current coupled implementation.
- [x] Implement `recover_critical` as timer reconciliation only.
- [x] Implement `active_cycle` with independent error logging:

```rust
if cycle_due(&mut self.last_worker_at, worker_interval, now) {
    if let Err(error) = self.run_worker_cycle().await {
        tracing::error!(error = %error, "background worker cycle failed");
    }
}
```

- [x] Remove startup `background.activate().await`; attach the handle, bind, and let the first real request execute critical recovery.
- [x] Preserve probe bypass and return 503 for `QueueFull`, `TimedOut`, `Unavailable`, or `Recovery` without exposing internal error text.
- [x] Re-run focused API tests and expect critical-failure rejection plus best-effort admission.

### Task 3: Atomic durable timer live updates

**Files:**
- Modify: `backend/crates/infrastructure/src/live_update_bus.rs`
- Modify: `backend/crates/application/src/proctoring.rs`
- Modify: `backend/crates/api/src/background.rs`
- Modify: `backend/crates/api/src/runtime_auto_advance.rs`
- Test: `backend/tests/contracts/proctor_contract.rs`

- [x] Extend the wall-clock reconciliation contract test to assert that every committed transition inserts a `live_update_events` row with the matching schedule ID and runtime revision.
- [x] Run the specific contract test when MySQL is available; otherwise record `PoolTimedOut` as an environment blocker and continue with compile/unit evidence.
- [x] Add a transaction-scoped infrastructure API:

```rust
pub async fn enqueue_in_tx(
    tx: &mut Transaction<'_, MySql>,
    origin_instance_id: &str,
    event: &LiveUpdateEvent,
) -> Result<(), sqlx::Error>;
```

- [x] Pass `origin_instance_id` into auto-advance/reconciliation methods and insert the durable event before each transition transaction commits.
- [x] Keep local in-memory publication after successful reconciliation, remove the post-commit bus insert, and rely on bus polling only for other origins.
- [x] Add unit/type-level coverage for origin and revision propagation, then run application/API unit suites.

### Task 4: Poison-safe outbox retries

**Files:**
- Create: `backend/migrations/0030_outbox_retry_policy.sql`
- Modify: `backend/crates/infrastructure/src/outbox.rs`
- Modify: `backend/crates/worker/src/jobs/outbox.rs`
- Test: `backend/crates/infrastructure/src/outbox.rs`
- Test: `backend/crates/worker/tests/retention_smoke.rs`

- [x] Write failing pure tests for attempts 1, 2, maximum-1, maximum, and attempts above maximum. Expected delays are bounded exponential values and maximum attempts produce `Terminal`.
- [x] Run `cargo test -p ielts-backend-infrastructure outbox --lib` and confirm the retry-disposition API is missing.
- [x] Add nullable `next_attempt_at` and `failed_at` columns plus a pending-claim index using the repository's guarded migration convention.
- [x] Add the explicit policy:

```rust
pub const MAX_OUTBOX_ATTEMPTS: i32 = 8;
pub const MAX_OUTBOX_BACKOFF_SECONDS: i64 = 300;

pub enum RetryDisposition {
    RetryAfter(Duration),
    Terminal,
}
```

- [x] Change claim eligibility to require `failed_at IS NULL` and `next_attempt_at IS NULL OR next_attempt_at <= NOW()`.
- [x] Change `mark_failed` to clear the lease and atomically set either the next retry time or terminal failure timestamp based on the already-incremented `publish_attempts`.
- [x] Count terminal failures in `OutboxRunReport`; do not loop indefinitely when a batch has no published progress.
- [x] Add a regression test proving 100 poison rows cannot keep a later eligible row permanently unclaimable.

### Task 5: Runtime mode parity

**Files:**
- Modify: `backend/Dockerfile`
- Create: `backend/scripts/normalize-background-runtime-mode.sh`
- Test: `backend/scripts/test-normalize-background-runtime-mode.sh`

- [x] Write a shell test covering `activity_driven`, `activity-driven`, uppercase, surrounding whitespace, continuous, empty, and invalid input.
- [x] Run the test and confirm uppercase/whitespace cases fail against the current inline Docker logic.
- [x] Add a side-effect-free normalizer that outputs only `activity_driven` or `continuous`; unknown and empty values output `continuous`.
- [x] Copy the script into the image and use its result before deciding whether to launch `/app/worker`.
- [x] Run `bash -n` and the shell test; expect all cases to pass.

### Task 6: Documentation, full verification, and local commits

**Files:**
- Modify: `.env.example`
- Modify: `backend/.env.example`
- Modify: `docs/architecture/railway-serverless.md`
- Modify: this plan's checkboxes as tasks complete.

- [x] Document queue capacity, wake timeout, critical recovery, best-effort scheduling, retry terminal state, and continuous-mode rollback.
- [x] Run `cargo fmt --all -- --check`; compare failures to the recorded baseline and separate existing files from changed files.
- [x] Run `cargo check --workspace --all-targets`; expect exit 0.
- [x] Run API/application/infrastructure unit suites; baseline is 138 passing tests and the new count must be at least 138 with zero failures.
- [x] Run the proctor contract suite; if MySQL remains unavailable, report all failures as `PoolTimedOut` and do not claim contract verification.
- [x] Run the focused frontend lazy-version test to protect the previously merged `origin/main` work.
- [x] Run `bash -n` and runtime-mode shell tests.
- [x] Attempt `docker build -f backend/Dockerfile .`; if Docker remains unavailable, report the exact tooling blocker.
- [x] Perform security, performance, reliability, documentation, and diff reviews. Confirm no secret values, unbounded queues, infinite retry paths, or old-mode contract breaks remain.
- [x] Commit only scoped files locally. Do not push. Rollback is `git revert` of the hardening commits or operationally setting `BACKGROUND_RUNTIME_MODE=continuous`.
