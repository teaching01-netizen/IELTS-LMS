# E2E test plan: SAT section-boundary admission and break handoff

Status: proposed, 2026-10-31.
Code under test: `597e08c3 fix(sat): enforce section transition admission`.
Predecessor plans:
- `docs/plans/2026-10-29-sat-break-boundary-low-level.md` (close ack → break row → break surface)
- `docs/plans/2026-10-23-sat-go-db-low-level-performance.md` (pool sizing, entry budget, k6 gates)

Scope: `sat_personal_v1` only. IELTS and cohort/legacy SAT timing are out of scope.

---

## 1. Why this suite exists

The unit suites pin the new code in isolation and all pass. They cannot catch the
failure this change is meant to prevent: a **synchronized transition wave** where
thousands of students hit the same endpoints inside the same few seconds, on a
finite MySQL pool, while the browser is holding a short server-issued offer lead.

Three production-shaped failures motivate the suite:

| Failure | Trigger | What the student sees |
| --- | --- | --- |
| Break offer expires before the confirm lands | Module 2 close wave saturates the API pool; `breaks/{id}/start` holds a connection past the old 3 s lead | "Your break could not be started. Please ask your proctor for help." after four missed offers |
| Break-end refresh convoy | Every break in a cohort ends within seconds and each refresh completes the break under row locks | Break timer hits 0, Math does not start, all clients retry at the same second |
| Pool starvation between start and close waves | Starts and closes both reserve half the pool; saves/state reads get the remainder | Saves and lifecycle reads stall or 503 during the boundary even though the transition itself succeeds |

The existing break-boundary spec covers only the **handoff** (close ack → break
surface). It does not assert the 6 s lead, break end, retry behavior, or any
concurrency property. This plan closes that gap.

---

## 2. System under test

```
Vite (3000) ──► Go API (4000) ──► MySQL (3306)
                   │
                   └── Go worker ──► MySQL (sweeps due modules/breaks)
```

Playwright owns the lifecycle: `playwright.config.ts` starts coedit, API, worker
and Vite, applies migrations, then runs `e2e/global-setup.ts`. The break-boundary
config (`playwright.sat-break-boundary.config.ts`) forces `SAT_ACCESS_CODE_START=false`
so the open access link can be joined without a code.

### Code paths under test

| ID | Change | File / symbol | Observable surface |
| --- | --- | --- | --- |
| C1 | First break offer asks for a 6 s lead | `src/features/student-delivery/hooks/useSatBreakEntry.ts` — `FIRST_OFFER_LEAD_SECONDS`, `decideSatBreakEntryStep` | `POST .../breaks/{breakId}/start` body `leadSeconds: 6`; row `entry_starts_at` |
| C2 | Break start/enter/visible use the 1.5 s entry budget and retryable mapping | `backend/go/cmd/api/handlers_delivery.go` — `deliveryStartBreakHandler`, `deliveryEnterBreakHandler`, `deliveryMarkBreakVisibleHandler`; `query_timeout.go` — `DefaultEntryTimeout`, `writeEntryError` | `503` + `Retry-After: 1` + `details.retryAfterSeconds`; no 500; latency ≤ ~1.5 s |
| C3 | Break end first refresh is jittered 0–1.5 s | `src/features/student-delivery/hooks/useSatExamController.ts` — `SAT_BREAK_END_FIRST_READ_JITTER_MS` | first `GET .../state` after break end; Math module activation |
| C4 | Starts reserve half the pool, closes a quarter | `backend/go/internal/delivery/sat_start_code_admission.go` — `satStartActiveWorkerLimit`; `sat_close_admission.go` — `satCloseActiveLimit` | `db_pool_max_open`, admission metrics, 503 ratio under load |
| C5 | Queued starts are admitted FIFO with direct handoff, cancel-safe | `sat_start_code_admission.go` — `satStartWorkerWaiter`, `releaseStartWorkerLocked`, `cancelStartWorkerWaiter` | every start admitted exactly once; no leaked slots after aborted clients |

### Existing coverage that must keep passing

- `e2e/sat-break-boundary.spec.ts` — close ack carries `personalBreaks`; break surface mounts within 1.5 s; no "Preparing Math…" stall; bounded pull when the projection is missing.
- `backend/go/internal/delivery/sat_start_code_admission_test.go` — FIFO, cancel, deadline, pool-share unit tests.
- `backend/go/cmd/api/sat_start_code_http_mysql_test.go` — real HTTP wave against MySQL at 2 / 200 / 600 / 2 000 users.
- `backend/go/cmd/api/sat_entry_db_timeout_mysql_test.go` — a pool of 1 returns a retryable timeout, never a 500.

---

## 3. Test levels

| Level | Runtime | What it proves | Gate |
| --- | --- | --- | --- |
| L1 browser functional | Playwright, Chromium, real API/worker/MySQL | The student-visible contract: lead, arm, confirm, break, break end, Math, reload | Required on every PR touching SAT delivery |
| L2 API concurrency | Go `httptest` + real MySQL (`cmd/api` package) | Admission fairness, fail-fast, pool sharing, no slot leak, no duplicate commits | Required for `sat_start_code_admission.go` / `sat_close_admission.go` |
| L3 browser fault injection | Playwright `page.route` | The client contract for 503/`Retry-After`: auto-retry, retry notice after 3, no lockout | Required for break endpoints |
| L4 scale qualification | k6 against staging | 2 000-candidate entry/close/break waves on the target topology | Release gate, not per-PR |

L1 and L3 share one config (the break-boundary config). L2 is a Go test; L4 is
`k6/sat-module-entry-2000.js` + `k6/sat-recovery-close-2000.js` plus a break
scenario added in §7.

---

## 4. Environment and fixtures

### Required environment

```bash
# backend/.env or shell
TEST_DATABASE_URL="mysql://root:root@127.0.0.1:3306/ielts_e2e"   # dedicated DB
METRICS_TOKEN="..."                                             # for /metrics assertions
```

- MySQL 8.4+ must be running; `go run ./cmd/migrate` runs automatically in the
  Playwright web server command.
- Local ports 3000 (Vite), 4000 (API), 1235 (coedit) must be free.
- `TEST_DATABASE_URL` is mandatory: `playwright.sat-break-boundary.config.ts`
  refuses to start without it.
- The base config starts the worker with `WORKER_MAINTENANCE_INTERVAL_SECS=1`, so
  due breaks/modules complete within ~1 s without a proctor action.

### Fixture strategy

- One published SAT room per test file run, with 1-minute modules and a
  1-minute break (`seedSatRoom` in `e2e/sat-break-boundary.spec.ts`).
- Students join the same room via `/join/{linkId}` in separate browser contexts
  (no shared cookies). Each context gets a deterministic `Math.random` stub so
  the break-end jitter is predictable per student.
- Every run uses a unique `stamp` (`Date.now().toString(36)`) in exam/email
  names; teardown deletes attempt artifacts and the schedule
  (`removeStartedStudentArtifacts`), so reruns are idempotent.
- Serial execution (`workers: 1`, `test.describe.configure({ mode: "serial" })`
  where a room is shared). Never share a mutable attempt across test files.

### Measurement sources (in priority order)

1. **Server rows** — `assessment_attempt_breaks`, `assessment_module_attempts`,
   `student_attempts`, `assessment_route_decisions`. Server timestamps are the
   authority; browser clocks are only used for ordering.
2. **HTTP observations** — Playwright `page.on("request"/"response")` captures
   URL, body, status, headers and monotonic timing. Bodies are redacted of
   credentials before being attached as artifacts.
3. **Client traces** — an init script records break phase transitions, first
   break-end refresh, close acks, and `student-observability-metric` events.
4. **Backend metrics** — `/metrics` with `Authorization: Bearer $METRICS_TOKEN`:
   `sat_close_admission_total`, `sat_close_admission_wait_seconds`,
   `sat_start_code_admission_waiter_total`, `sat_transition_service_seconds`,
   `db_pool_in_use`, `db_pool_wait_count`.

---

## 5. L1 browser test cases

All cases run in `e2e/sat-break-boundary.spec.ts` (extend the existing file) with
`playwright.sat-break-boundary.config.ts`. Per-test timeout 420 s; the module and
break durations are the real 1-minute clocks.

### E2E-BRK-01 — First offer carries a 6 s lead and confirms once

**Setup:** one student, open access link, `SAT_ACCESS_CODE_START=false`.

**Steps**
1. Join; wait for Reading & Writing Module 1 to end; assert Module 2 starts with a fresh window and no break (existing assertion).
2. Wait for Module 2 to end and the break surface to mount.
3. Capture every `POST .../breaks/{id}/start`, `.../breaks/enter`, `.../breaks/visible` request with body/status.
4. Wait until the break timer is counting down.

**Assertions**
- Exactly **one** `start` before the first `enter`; body is `{ controlEpoch: <int>, leadSeconds: 6 }`.
  `leadSeconds` must be the literal 6 — not omitted, not 3.
- `start` returns 200; the response break has `state: "armed"`, `entryStartsAt` in the future.
- DB: `TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), entry_starts_at)` immediately
  after the response is **5.4–6.3 s** (network + decode margin).
- `enter` is called once and returns 200; `entry_confirmed_at` is set; DB `starts_at = entry_starts_at`
  and `deadline_at = starts_at + duration_seconds`.
- `visible` is called once, after `starts_at`, and returns 200; `entry_entered_at` is set.
- Phase sequence starts `preparing` then `active`; `ending` never appears; no
  "Preparing Math…" heading before the break actually completes.
- Zero 4xx/5xx on the three break endpoints.
- The offer → active transition completes within `lead + 1.5 s`.

**Artifacts:** request log JSON, break row snapshot, phase trace.

---

### E2E-BRK-02 — Break end refreshes after bounded jitter and enters Math exactly once

**Setup:** continue the E2E-BRK-01 student (or a fresh one with the same seed).

**Steps**
1. Record `break.deadline_at` from the DB.
2. Install a deterministic `Math.random` stub (`value = 0.75` → expected first
   read delay 1 125 ms) before the page loads.
3. Wait for the break phase to leave `active` (countdown reaches zero / surface
   swaps to the next module).
4. Capture the first `GET .../state` after that moment.

**Assertions**
- The first refresh is **not earlier than the break deadline** (server clock; allow 250 ms skew).
- Delay from observed break end to first refresh is within **expected ± 400 ms**
  and in absolute terms **0–2 000 ms**.
- The refresh loop makes at most 8 reads / 20 s; no unbounded polling.
- DB: break `state = "completed"` with exactly one `completed_at`; no second
  completion timestamp; `assessment_module_attempts` for Math Module 1 is
  `active` (or `offered` then active) within 10 s.
- Math's first answerable frame is visible; exam timer is running.
- Exactly one `/modules/close` after the break end (the transition close), and
  no additional `breaks/{id}/start` after the break became `active`.
- `sat_break_boundary_pull` is absent on the happy path (the close ack carried
  the row).

**Artifacts:** phase trace with timestamps, refresh log, DB snapshot.

---

### E2E-BRK-03 — Reload during an armed/active break preserves the offer and clock

**Setup:** E2E-BRK-01 student; reload while the break is `armed` or `active`.

**Steps**
1. Reload `page` once the break surface is visible and the timer is counting.
2. Wait for the break surface to return.
3. Continue until Math starts.

**Assertions**
- No new `start` request after reload (the server already armed the break).
- `entry_starts_at`, `starts_at`, `deadline_at` and `entry_generation` are byte-identical
  before and after reload.
- The visible countdown resumes at the remaining time, never resets to the full
  break duration (allow ≤ 2 s skew).
- Math still starts and is answerable; no proctor action needed.
- If the reload lands in the 0–1.5 s break-end jitter window, the jitter applies
  once, not once per reload.

---

### E2E-BRK-04 — A 503 on `breaks/start` auto-recovers without a lockout

**Setup:** one student at the break surface. Intercept `**/breaks/*/start`.

**Steps**
1. Fulfil the first two `start` calls locally with
   `503 { code: "SERVICE_UNAVAILABLE", details: { retryAfterSeconds: 1 } }` and
   header `Retry-After: 1`.
2. Let the third call reach the real server.
3. Variant: fail the first four calls, then let the fifth through.

**Assertions**
- The UI never shows "Your break could not be started. Please ask your proctor for help."
  during the first two failures, and auto-retries at least 1 s apart.
- After three consecutive failures the retry notice appears **and** preparation
  keeps retrying (the notice is not terminal).
- The real server call returns 200 and the break activates; the student reaches Math.
- No `BREAK_RETRY_EXHAUSTED` / `ADMISSION_CLOSED` path is hit in the two-failure variant.
- The client does not fire overlapping `start` requests (one flight per break revision).

---

### E2E-BRK-05 — Three students cross the same boundary together

**Setup:** three browser contexts joined to the same room within ~3 s of each
other, so their Module 2 windows end together. Deterministic `Math.random` =
`0.0`, `0.5`, `0.9` for the three contexts.

**Assertions (per student)**
- Break surface mounts within 1.5 s of its close ack.
- Exactly one `start` with `leadSeconds: 6`; one `enter`; one `visible`; all 200.
- No terminal break error and no visible retry notice.
- Break row completed; Math active; first answerable frame visible within 15 s
  of that student's break end.

**Assertions (cohort)**
- Three distinct break rows, three distinct Math module attempts, zero duplicate
  `completed_at`.
- First break-end refresh offsets match the injected jitter values within ±400 ms
  and are spread (the three offsets must not all fall in one 100 ms bucket).
- No 5xx in the whole wave; any 503 must carry `Retry-After: 1` and be followed
  by a successful retry.
- Backend `/metrics` after the wave: `sat_close_admission_total` has at least one
  `admitted` sample; `db_pool_wait_count` did not grow without bound (record the
  delta, assert < 50 for three students).

This is the browser-shaped load test. It is intentionally small: it proves the
protocol is re-entrant, not that the topology is sized.

---

## 6. L2 API concurrency test cases (Go, real MySQL)

Add to `backend/go/cmd/api` beside `sat_start_code_http_mysql_test.go`. Run with
`-p 1` (one package at a time) as the rest of the MySQL suites do.

### E2E-ADM-01 — Constrained-pool start wave: FIFO, exactly-once, no 500

`db.SetMaxOpenConns(4)`, so starts reserve 2 slots and closes 1.

- Seed `N = 16` admitted candidates with bearer tokens (reuse the existing
  `newCodeStartFixture` / `admit` / `IssueAttemptToken` helpers).
- Fire all 16 `start` requests concurrently; record arrival order and per-request latency.
- Assert: all 16 eventually return 200; exactly 16 module attempts are active;
  no duplicate starts; no 500; any 503 is retryable and the request is retried.
- Assert the first 2 to arrive are admitted first (FIFO): grant order follows
  arrival order within the resolution of the harness.
- Abort half of a second wave while queued, then fire a third wave: the third
  wave must still be admitted (no leaked slots from cancelled waiters).
- Run the wave with `db.SetMaxOpenConns(2)` as well: 1 start slot, and the
  queued requests must not hold a DB connection.

### E2E-ADM-02 — Constrained-pool close wave: reads stay alive

`db.SetMaxOpenConns(8)` → close limit 2.

- Seed `N = 12` attempts at a module deadline (or call close with
  `alreadyClosed` replays).
- Fire all 12 closes concurrently together with 20 `state` reads and 20 saves.
- Assert: at most 2 closes execute concurrently (instrument with a counter around
  the close service or assert via `sat_close_admission_wait_seconds` / timing);
  excess closes return `503` + `Retry-After` + `retryAfterSeconds`; **every**
  lifecycle read returns 200 within 2 s; no 500; no deadlock.
- Retry the rejected closes: all succeed and the module attempts reach the same
  terminal state exactly once.
- Assert `db_pool_in_use` never exceeds `DB_POOL_MAX_CONNECTIONS` and
  `db_pool_wait_count` returns to baseline after the wave.

### E2E-ADM-03 — Break endpoints honour the 1.5 s budget under saturation

- Hold a row lock on the attempt's `assessment_attempt_breaks` row from a second
  connection (`SELECT ... FOR UPDATE`), or use a test hook that blocks the break
  service.
- Fire `start`, `enter`, `visible` concurrently.
- Assert each resolves in **≤ 2 s**, with `503`/`Retry-After: 1` rather than a
  hung connection or a 500.
- Release the lock; retry returns 200 and the break transitions correctly.
- While blocked, `GET .../state` and `POST .../responses/{id}` still return 200
  inside their budgets (the bulkhead keeps reads alive).

### E2E-ADM-04 — Existing 2 000-user wave stays green

Re-run `TestSATStartCodeHTTPWaveMySQL` with `SAT_CODE_LOAD_USERS=200`, then 600,
then 2 000 on the target topology. Record p50/p95/p99, MySQL row-lock waits and
pool gauges. This is the regression gate for the FIFO rewrite.

---

## 7. L4 scale qualification (staging only)

Not part of the per-PR gate. Run only against an isolated staging schedule.

1. `k6/sat-module-entry-2000.js` — 2 000 synchronized entries; `K6_MODE=initial`,
   then `adaptive`. Gate: checks `rate==1`, `sat_handoff_ms p(99)<5000`.
2. `k6/sat-recovery-close-2000.js` — 2 000 pre-deadline saves, jittered closes,
   idempotent replay. Gate: zero unexpected 5xx, zero lost saves.
3. **New** `k6/sat-break-wave.js` — 2 000 attempts at the same break boundary:
   arm with `leadSeconds=6`, confirm, hold the break, then release at the
   deadline. Metrics: `sat_break_arm_ms`, `sat_break_confirm_ms`,
   `sat_break_end_visible_ms`, `sat_break_lockout_total` (must stay 0), and the
   API's `sat_close_admission_total{outcome="rejected"}` ratio (must stay < 1 %).
4. Record the topology: `DB_POOL_MAX_API`, `DB_POOL_MAX_CONNECTIONS`, MySQL
   version, instance size, `SHED_MODE=exam`, `VERSION_CACHE=on`.
5. Local laptop numbers are diagnostics only; the gate is the staging run.

---

## 8. Timing budgets and tolerances

| Measurement | Budget | Rationale |
| --- | --- | --- |
| Close ack → break surface mounted | < 1 500 ms | Existing handoff contract |
| Arm → active | lead (6 s) + 1 500 ms | One entry timeout of slack |
| `start`/`enter`/`visible` under saturation | ≤ 2 000 ms | 1.5 s server budget + 0.5 s transport |
| Break end → first refresh | 0–2 000 ms | 0–1.5 s jitter + 0.5 s timer/transport |
| Break end → Math first answerable frame | < 10 000 ms | Worker sweep 1 s + entry budget + render |
| `state`/save under close wave | < 2 000 ms p95 | Pool quarter reserved for reads |
| Any request in the wave | < 5 000 ms | No unbounded connection hold |

Tolerances are deliberately asymmetric (favor false negatives over false
positives): a missed regression costs a rerun; a flaky green hides a production
stall.

---

## 9. Evidence and artifacts

Every L1/L3 test attaches on failure (and on `--trace on` always):

- `trace.zip` (Playwright), screenshot, video on failure.
- `network.json`: filtered request log (URL, method, status, `Retry-After`,
  request body with tokens/cookies removed, monotonic timestamps).
- `phase-trace.json`: `preparing|active|ending` transitions, timer texts,
  break-end timestamp, first-refresh timestamp, metrics events.
- `db-snapshot.json`: break row, module attempts, route decisions, terminalization.
- `metrics.txt`: the five metric families from `/metrics` after the test.

CI command:

```bash
bunx playwright test --config playwright.sat-break-boundary.config.ts \
  --project=chromium --trace on --reporter=line,json
```

The JSON report is uploaded with the trace artifacts. Do **not** enable retries
for this suite in CI (`retries: 0`); a flake here is a finding, not noise.

---

## 10. Isolation and flake control

- **Real clocks only.** Do not use `page.clock` to fast-forward: module and break
  deadlines live in MySQL (`UTC_TIMESTAMP(6)`), so a mocked browser clock
  desynchronizes the UI from the server and produces false failures. Keep
  1-minute modules and accept the ~4-minute test duration.
- **One room per file.** A schedule can be terminalized by a test; never share it
  across files. Within a file, `seedSatRoom` per describe block.
- **Serial mode** for the multi-student wave; joining three contexts in parallel
  is fine, but assertions and teardown run serially.
- **Deterministic jitter** via `Math.random` stub per context. Document the stub
  in the test; do not stub `crypto.randomUUID` (used for close IDs).
- **No retries** locally or in CI. If a test flaps, capture the trace and fix the
  assertion or the product; do not add `test.describe.configure({ retries })`.
- **Cleanup is best-effort.** `removeStartedStudentArtifacts` deletes terminalization,
  route decisions, breaks, module attempts, access links and the schedule. If it
  fails, the unique `stamp` keeps the next run isolated.

---

## 11. Implementation order

1. **Extract shared helpers** — move `seedSatRoom`, `joinStudent`, `readTrace`
   and `installBreakTrace` from `e2e/sat-break-boundary.spec.ts` into
   `e2e/support/satBreakFixtures.ts`; add `installTransitionTrace` (request log +
   phase timestamps + deterministic random). No behavior change; the existing
   two tests must still pass.
2. **E2E-BRK-01** — add the lead/confirm assertions to the existing happy-path
   test (cheapest, highest signal). Run it.
3. **E2E-BRK-02 + 03** — add break-end and reload tests. Run them.
4. **E2E-BRK-04** — route-interception test for the 503 contract.
5. **E2E-BRK-05** — three-student wave with deterministic jitter.
6. **E2E-ADM-01…03** — Go MySQL tests in `cmd/api`; run with `-p 1`.
7. **E2E-ADM-04** — re-run the existing 2 000-user wave on staging; record numbers.
8. **Docs** — update `e2e/TEST_STATUS.md` with the new spec inventory and the
   command in §9.

Each step lands with its test run and artifacts; do not batch steps 2–6 into one
unverified change.

---

## 12. Exit criteria

The change is e2e-verified when all of the following hold on a clean
`TEST_DATABASE_URL` database:

- [ ] E2E-BRK-01…05 pass with zero retries.
- [ ] E2E-ADM-01…03 pass with `-p 1` against MySQL 8.4.
- [ ] The existing `sat-break-boundary` tests still pass unchanged.
- [ ] `go test ./cmd/api/ ./internal/delivery/ -count=1` passes.
- [ ] `bunx playwright test --config playwright.sat-break-boundary.config.ts --project=chromium --list` shows the new tests.
- [ ] The staging k6 break wave reports `sat_break_lockout_total == 0` and
      `sat_close_admission_total{outcome="rejected"} < 1 %`.
- [ ] No test relies on a mocked browser clock for server-owned deadlines.

---

## 13. Execution log (2026-10-31)

Implemented and run on an isolated MySQL 9.6 instance (port 3307) with a
freshly migrated `ielts_e2e` database. CI still targets MySQL 8.4; the
assertions do not depend on the 9.x-only behavior.

| Run | Result |
| --- | --- |
| `sat-break-boundary` happy path with the new lead/entry/break-end assertions | 1 passed (3.3 m) |
| Projection-gap test + 503-retry test | 2 passed (4.7 m) |
| Three-student wave | 1 passed (2.5 m) |
| Projection-gap test after removing the extra full-document observer | 1 passed (2.5 m) |
| `TestSATBreakEntryDatabaseTimeoutIsRetryableMySQL` | PASS; `start`, `enter`, `visible` each returned 503 + `Retry-After: 1` at 1 500–1 501 ms |

Two implementation findings from the run:

1. A second full-document `MutationObserver` in the trace measurably slowed the
   close → break handoff (4 068 ms against the 1 500 ms budget). The trace now
   polls the phase every 100 ms instead; instrumentation must not perturb the
   latency it measures.
2. A single all-in-one suite run could not be captured because another session
   began editing `src/features/exam-authoring` and
   `src/features/student-delivery` mid-run (moving `satProvider`'s
   `studentResponse` module to `@shared/sat/studentResponse`). That produced a
   Vite module-resolution failure and an HMR reset that cleared the client
   trace. The individual results above are from a stable tree; rerun the full
   suite once the concurrent refactor lands.

## 14. Out of scope and known follow-ups

- **`breaks/visible` response size** (the earlier fix #4) — changing the API
  between browser and server is a separate contract change; not covered here.
- **Multi-process admission** — the Go bulkheads are process-local; the plan
  measures one API process. Horizontal scaling needs the durable slot table's
  cross-process behavior, which is a separate topology test.
- **Proctor re-arm UX** — out of scope; E2E-BRK-04 asserts only that the student
  is *not* forced into it on transient 503s.
- **IELTS paths** — untouched.
