# Load and Failure Testing Spec (plan sections 116-117)

## Load (116)

The existing k6 suite (`k6/`) already covers the required backend
profiles against the Rust API. Each profile must be re-run against
the Go API before cutover, on a dedicated tenant and schedule, with
the same thresholds:

- start-exam propagation (200 students, max under 2s);
- section transition (200 students, max under 2s);
- submit storm (200 students, p95 under 2s, max under 10s, plus
  `submittedAt`, answers, and `finalSubmission` verification);
- resume after browser close (100 students, identity + prior state
  survive via new `clientSessionId`);
- auto-submit on proctor complete (200 students).

New versus existing: the k6 scripts currently drive the V1 mutation
batch endpoint. Before the Go cutover run, add a V2 batch profile
mirroring the UI adapter (lease/control epochs, write ids, versions)
at 500 students or higher when the target requires it, measuring
latency, pool waits, lock waits, CPU, memory, DB QPS, deadlocks, and
worker lag. Grading-projection drain and outbox drain are observed
during the storm, not as separate scripts.

Safety: `K6_CONFIRM_PROD=true` plus a dedicated E2E tenant and
schedule per run. Results attach to the cutover ticket.

## Failure (117)

Explicitly test, each with expected outcome:

- DB disconnect: API `/readyz` fails, client outbox queues, no
  answer loss within the exam window; recovery replays idempotently.
- DB slow query: lock-wait arithmetic holds, `WithTxRetry` bounds
  retries, no unbounded queue growth.
- API restart during response batch: in-flight tx rolls back,
  client retries with the same write id (exact replay or clean
  accept, never a duplicate).
- Worker restart: 60s outbox leases re-claim, no event processed
  twice observably (idempotent consumers).
- Websocket instance restart: leases expire, clients re-acquire,
  state re-syncs via snapshot, never via socket replay.
- Network retry after committed submit: same submission id + hash
  returns the stored receipt (submit-vs-submit test pins this).
- Network retry before committed submit: clean accept, single
  receipt.
- Browser refresh with pending answer: IndexedDB outbox survives,
  flush resumes after bootstrap.
- Proctor action during reconnect: pause/resume bumps control
  epoch; in-flight batches go stale and rebase (pause-vs-response
  test pins this).
- SAT provisional completion after API crash: provisional rows
  persist (`submitted`, `post-exam`, NULL timestamps); the watchdog
  scores and seals on recovery, never fabricates.

Unit-pinned cases reference the sqlmock suites; the rest require a
running environment and attach to the same cutover ticket as load.
