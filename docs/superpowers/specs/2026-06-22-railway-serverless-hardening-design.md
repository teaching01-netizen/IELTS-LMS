# Railway Serverless Hardening Design

## Status

Approved for local implementation on 2026-06-22. Do not push to `origin/main`
until the user separately authorizes it.

## Context and confirmed baseline

The Railway serverless branch is merged locally into `main`, which is three
commits ahead of `origin/main`. The backend workspace compiles and 138 unit
tests pass. The MySQL-backed proctor contract suite cannot run in the current
environment because no reachable `TEST_DATABASE_URL` is available. Docker is
also unavailable locally.

The production audit confirmed five failure modes:

1. API startup and post-idle requests synchronously run timer reconciliation,
   outbox draining, grading projection, live-update polling, and maintenance.
2. Failed outbox events become immediately eligible again without a retry
   budget or delay.
3. Timer state commits before its cross-instance live-update intent is durable.
4. Runtime wake commands use an unbounded queue and have no caller deadline.
5. Rust and the container script parse `BACKGROUND_RUNTIME_MODE` differently.

## Invariants

- Persisted timer deadlines remain the source of truth across sleep, restart,
  and reload.
- A committed timer transition always creates a durable, replayable event in
  the same database transaction.
- API admission never depends on retention, media cleanup, grading projection,
  or draining an arbitrary backlog.
- Wake coordination has bounded memory, bounded wait time, and explicit
  overload behavior.
- Poison events cannot monopolize outbox selection indefinitely.
- Continuous mode remains backward compatible and is the rollback mode.
- Existing submitted-answer immutability, autosave idempotency, and append-only
  audit behavior are unchanged.

## Architecture

### Critical wake path

The background coordinator exposes a bounded command channel. The first real
request after quiescence waits only for critical recovery:

1. reconcile expired runtime sections;
2. ensure each committed transition has durable outbox intent;
3. return admission success.

The request-side wait has a configured upper bound. A full queue or elapsed
deadline fails closed with `503 Service Unavailable`; it cannot grow memory
without limit.

Startup binds the listener after constructing state and the coordinator, but it
does not run noncritical backlog or maintenance work before listening. Critical
timer recovery remains the first-request gate so stale timer state is never
served after wake.

### Best-effort background work

Outbox delivery, grading projection, cross-instance live-update polling,
retention, storage inspection, and media cleanup run only in active cycles.
Their errors are logged and measured independently. They do not fail request
admission or prevent startup. Final quiescence performs a bounded critical
reconciliation pass; best-effort failures keep their own retry schedule rather
than keeping the whole runtime permanently active.

### Durable timer events

The proctoring application transaction inserts the existing append-only audit
records and an outbox event for every runtime transition before commit. The API
coordinator no longer attempts to manufacture durability after the transition.
The worker publishes durable events idempotently using the existing outbox
identity and claim token rules. Existing in-process publication may remain as a
latency optimization, but correctness must not depend on it.

### Outbox retry policy

Failed outbox rows receive a future retry timestamp derived from bounded
exponential backoff and a maximum-attempt terminal state. Claim selection
excludes rows whose retry time is in the future or whose terminal state is set.
The policy covers:

- first failure;
- maximum-attempt boundary;
- zero/invalid configuration normalization;
- concurrent claimers;
- malformed poison payloads;
- successful retry after a transient failure.

No deletion is introduced. Terminal failures remain traceable for operations
and manual replay.

### Configuration parity

The container script trims and lowercases `BACKGROUND_RUNTIME_MODE` before
choosing whether to launch the standalone worker. Accepted values match the
Rust parser. Unknown values resolve to continuous mode in both layers.

## Component boundaries

- `application::proctoring` owns atomic timer state and durable transition
  intent.
- `api::background` owns admission gating, lifecycle, scheduling, and
  backpressure; it does not own retry semantics.
- `infrastructure::outbox` owns claim eligibility and retry persistence.
- `worker::jobs::outbox` owns event processing and classifies success/failure.
- `backend/Dockerfile` owns process topology only.

These dependencies preserve `api -> application -> domain`; infrastructure
implements persistence behavior and is not imported through another module's
internals.

## Error handling and observability

- Distinguish critical recovery failures from best-effort job failures in logs.
- Record queue-full, wake-timeout, recovery-duration, outbox-retry, and terminal
  outbox-failure counters.
- Include request ID, runtime mode, instance ID, schedule ID where available,
  outbox event ID, attempt count, and next retry timestamp.
- Never report a request as admitted when critical timer reconciliation failed.

## Test strategy

Use red-green-refactor for each behavior:

1. bounded queue rejects overload and wake wait times out;
2. maintenance/grading failure does not reject request admission;
3. critical recovery failure still rejects admission;
4. poison events become temporarily ineligible and eventually terminal;
5. transient events become claimable after the retry boundary;
6. runtime transition transaction contains durable event intent;
7. live-bus failure cannot erase the durable transition event;
8. mode parsing covers uppercase, whitespace, aliases, invalid, and empty input;
9. existing continuous and activity-driven lifecycle tests remain green.

Verification gates are workspace compilation, affected unit tests, available
contract tests, format checks scoped to changed Rust files, shell syntax checks,
and Docker build when Docker is available.

## Deployment and rollback

Deploy only after explicit user authorization. Roll back operationally by
setting `BACKGROUND_RUNTIME_MODE=continuous` and redeploying. Code rollback is
`git revert` of the local hardening commits. Database changes, if required for
retry timestamps or terminal state, must be additive and safe for the old
continuous worker during a rolling deploy.

## Known verification gaps

- MySQL contract behavior remains unconfirmed locally until a reachable test
  database is provided.
- The production Docker image remains unconfirmed locally until Docker is
  available.
- Railway sleep/wake timing requires a real Railway deployment and cannot be
  claimed from unit tests.
