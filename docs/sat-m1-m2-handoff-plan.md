# SAT Module 1 → Module 2 handoff under load — implementation plan

| | |
|---|---|
| Status | Implemented locally (2026-10-04). Default remains `server_start`; enable `client_start` for newly started personal runtimes after rollout gates pass. |
| Scope | Digital SAT, `sat_personal_v1` timing model (default for every new SAT schedule: `SAT_PERSONAL_TIMING=on`, `backend/go/internal/schedules/service.go:272-302`). |
| Relation to `docs/plan1.md` | Replaces §1 (module closure) with a bounded design. §2 (stale-state ordering) is already covered by `regressesAttemptState` (`src/features/student-delivery/hooks/useSatExamController.ts:325-329`). §3 (branch content fence) is implemented (`backend/go/internal/delivery/service.go:754-762`); Phase 2 tightens it. |

## 1. Summary

Implementation and rollout guidance: [SAT handoff runbook](runbooks/sat-module-handoff.md). Local validation covers the Go suite, race checks, student unit suites, real MySQL close/start races, delayed V2 writes, late evidence, raw content fences, gzip, and the browser transition. N=400 staging acceptance, shared-IP check-in capacity, and real exam-network timing remain deployment gates; local tests do not establish those results.

### Local validation (2026-10-04)

| Gate | Evidence |
|---|---|
| G1 | Student/durability/application/domain suites: 803 passed, 2 skipped before the additional regressions; subsequent focused regressions pass, including authoritative closure of offline intent, reload, and usable Module 2 controls. `bun run typecheck` and `bun run build` pass. |
| G2 | `go test ./...` passes. Race checks pass for delivery, attempts, runtime, schedules, and telemetry. Migrations through 0075 and MySQL race tests pass on an isolated MySQL 9.6 instance; the deployment’s MySQL 8 environment remains a rollout check. A real V2 write five seconds after expiry is acknowledged before a racing close. |
| G3 | Playwright: delayed final batch, offline at zero (evidence uploaded; Module 2 save acknowledged), and reload during handoff pass with the stored runtime mode asserted as `client_start`. Existing full transition through break/completion also passes in `server_start`. |
| G4/G5 | The N=400 k6 harness parses via `k6 inspect`; staging load, score verification at N, and first-frame timing acceptance remain pending. HTTP receipt in k6 is a proxy; use the browser first-answerable-frame metric for A1. |
| G6 | Raw higher/lower branch routes pass in both modes, including bootstrap/state/entry/V1 content fences. Start content gzip fixtures transfer about 880 bytes versus about 2,166 bytes JSON. Measure representative full-module transfer size on the exam network before rollout. |

The proctor Start path shares the configured runtime service. Authoritative closed-module projections preserve unsent drafts even when routing happened while the device was offline; receiving a write refusal is not required to retain the evidence.

When many students reach the end of Module 1 together:

1. **Module 2 time is lost.** The server starts the Module 2 clock when it finalizes Module 1. Under load, the student needs seconds to tens of seconds before Module 2 is on screen.
2. **Module 2 can be locked completely.** If the final Module 1 save arrives after the 3-second save window, the browser's answer engine treats the whole attempt as closed. The Module 2 exam area becomes `inert` while its clock runs.
3. **Module 2 can be chosen from incomplete answers.** Answers saved after the 3-second window are left out of the score that picks the harder or easier Module 2.

The fix has three parts:

- **Module 2's clock starts when the student actually receives Module 2.** The browser starts it with `StartModule`; a server backstop starts it if the browser never does.
- **Module 1 is routed only after the browser confirms its final answers, or after a bounded window W.**
- **A rejected save only affects the module it belongs to.**

## 2. Acceptance criteria

`N` = 400 students on one shared Wi-Fi network, so every request leaves through one public IP and one uplink (decision D4).

| ID | Criterion |
|---|---|
| A1 | At N synchronized students, p99 of (Module 2 allotment − remaining seconds at the first answerable Module 2 frame) ≤ 2 s. |
| A2 | Every Module 1 answer whose save reaches the server before `deadline + W` is included in the score that selects Module 2. |
| A3 | A rejected Module 1 save never blocks the Module 2 screen or Module 2 saves. |
| A4 | Exactly one route decision and one Module 2 row per attempt, even with duplicate or racing requests. |
| A5 | No student response contains content for an unselected branch, or for a branch module whose clock has not started. |
| A6 | A Module 1 answer arriving after W is never silently dropped. It is preserved, and flagged when it would have changed the route. |

## 3. Current behavior (evidence)

```text
T          M1 clock 0 → input frozen → await persistence.flush() → one /state read     (useSatExamController.ts:1496-1500)
T..T+3s    server still accepts M1 writes (SATSaveGrace = 3 s)                           (attempts/service.go:31, :691-695)
T+3s+q     reconciler: score → route → lock M1 → INSERT M2 'active', started_at = NOW()  (start_submit.go:956-979, :1025-1030)
           ← M2 clock starts here
...        browser learns via socket nudge, or the recovery poll (10–20 s live / 7.5–15 s offline)  (satPollCadence.ts)
           /state → unknown M2 module → full /bootstrap (2nd reconcile + projection + content)      (useSatExamController.ts:443-457)
           ← student sees M2 here
```

| ID | Finding | Evidence | Effect |
|---|---|---|---|
| F1 | M2 clock starts at server finalization, not at delivery. | `insertActiveModuleAttemptTx` (`start_submit.go:1025-1030`), called from `finalizeModuleTx` (`:976`). Branch content is withheld until routed (`service.go:738-762`), so every browser needs `/state` plus `/bootstrap` after routing. No faster re-check exists after the post-flush read; `timeoutTransitionPending` changes no cadence. | Discovery, the request herd, and the content download are all charged to M2. |
| F2 | A late M1 save locks M2. | `DEADLINE_EXPIRED` and `ATTEMPT_NOT_WRITABLE` are whole-attempt terminal conflicts (`DurableResponseEngine.ts:2702-2714`). The engine quarantines all pending writes and enters a sticky `conflict_terminal` (`:1872-1880`), which clears only when the quarantine is empty (`:2200-2219`). New saves are refused (`:678-684`, `:869`); new epochs are refused (`:638-639`). The engine is attempt-scoped and survives M1→M2 (`useSatResponsePersistence.ts:326-335`). `failureKind` `'expired'`/`'terminal'` → `persistenceInteractionBlocked` (`SatStudentSessionRoute.tsx:261-262`, `:742-743`) → `inert` (`SatExamShell.tsx:596-597`). | M2 is unusable until reload or proctor help, while its clock runs. |
| F3 | The route can use incomplete M1 answers. | 3-second window (`attempts/service.go:31`). The route is threshold-based: `rawCorrect >= minimumCorrectForHigher` (`start_submit.go:1409-1412`). Timeout recovery is closed once a route exists (`service.go:2144-2152`); for M1 the route is written in the same transaction as the lock. | A last-second correct answer that arrives late can flip the student to the wrong M2. |
| F4 | Finalization is serial. | The personal lane collects up to 2500 candidates and reconciles them one by one (`reconcile.go:474-579`, `:424-457`). Each pass is about 20 statements in one locking transaction. | The last students wait tens of seconds on "time's up". |
| F5 | Legacy `cohort_section_v3` cap = M1 + longer branch. | `schedules/service.go:638-647`; schedules with a NULL `sat_timing_model` still use it (`:692-707`). | Every handoff second is subtracted from M2. Out of scope beyond the preflight check (Phase 0.2). |

What already exists and is reused:

- The personal `StartModule` already starts a `not_started` module with `started_at` = DB time, using a conditional update (`start_submit.go:153-204`).
- `StartModuleOfferAck(needContent)` already returns the module's content (`:81-91`).
- `uq_assessment_route_decision UNIQUE (attempt_id, section_id)` (migration `0033`) and the unique `(attempt_id, module_id)` key already enforce one route and one M2 per attempt.
- The V2 write path and the reconciler both lock the `student_attempts` row first (`attempts/service.go:211` via `lockAttempt`; `reconcile.go:91-93`). Writes and finalization for one attempt are therefore strictly serialized.

## 4. Target design

### 4.1 Invariants

| ID | Invariant | Enforced by |
|---|---|---|
| I1 | A module's clock starts no earlier than the moment the server hands that module to the student, or `available_at + G` (auto-start backstop). | Only two writers set `started_at` for a routed M2: `StartModule` and the backstop. Both use `WHERE state='not_started'`. |
| I2 | M1 is scored and routed only after (a) an accepted close request, (b) `deadline + W`, or (c) a proctor action. No M1 write is accepted after the route. | The close transaction and the reconciler both lock the attempt row first. The write gate ends at `deadline + W` or when M1 is locked. |
| I3 | One route decision and one M2 row per attempt. | `uq_assessment_route_decision`; unique `(attempt_id, module_id)`; the M1 conditional update `state IN ('not_started','active','review')` (`start_submit.go:916`). |
| I4 | A save rejection for module X affects only module X's drafts and UI. | Batches are scoped per module attempt in the engine; module-level server rejections carry a reason. |
| I5 | Branch content is never in a student response before that branch's clock starts. | Content fence keyed on module state (Phase 2.5). |
| I6 | An answer that arrives after the window is preserved and auditable, never applied to the score automatically. | Phase 5 evidence table and route-change check. |

### 4.2 Target flow (`sat_handoff_mode = client_start`)

```mermaid
sequenceDiagram
  participant B as Browser
  participant API as Delivery API
  participant DB as MySQL
  participant W as Worker
  Note over B: M1 reaches 0 (server time): input frozen
  B->>API: POST responses:batch (M1 scope only, all unconfirmed M1 answers)
  API->>DB: lock attempt → apply writes (accepted until deadline+W)
  B->>API: POST modules/close {M1, manifest}
  API->>DB: lock attempt → verify manifest → score → route → lock M1 → INSERT M2 not_started (available_at=now, auto_start_at=now+G)
  API-->>B: closed + next module (no M2 content)
  B->>API: POST modules/start {M2, needContent}
  API->>DB: lock attempt → M2 not_started→active, started_at=NOW()
  API-->>B: ack + M2 content
  Note over B: M2 painted; clock ≈ full allotment
  W-->>DB: backstop: route at deadline+W if no close; start M2 at auto_start_at if no StartModule
```

### 4.3 Module-attempt states (personal, `client_start`)

```text
M1: active ──(close accepted | deadline+W | proctor)──► locked   [score + route decision + M2 insert in the same tx]
M2: not_started{available_at=t_route, auto_start_at=t_route+G} ──(StartModule | auto-start)──► active{started_at} ──► (existing expiry)
```

### 4.4 Decisions and rejected alternatives

| Choice | Why | Rejected alternative |
|---|---|---|
| The browser starts M2 (`StartModule`), with a server backstop. | Only the response transfer is charged to M2. The backstop bounds a dead browser to G. Reuses the existing single-operation start. | **Fixed future start (`started_at = now + K`).** Still loses time whenever discovery takes longer than K, which is exactly the high-load case. It also leaks K seconds of pre-reading. |
| A separate `modules/close` endpoint in `delivery`. | `finalizeModuleTx` lives in `delivery`; `attempts` cannot import `delivery`. Keeps the V2 write algorithm free of routing logic. Matches the `docs/plan1.md` §1 close-request shape. | **A "close" flag on `responses:batch`.** Needs a cross-package callback inside the write transaction and mixes two concerns. |
| A bounded window W for the personal model only. | `SATSaveGrace` also drives the cohort section advance (`proctor/reconcile.go:307`) and the cohort expiry branches. Widening it there would subtract time from M2 under the shared cap. | **Widen `SATSaveGrace` globally.** |
| Route at `deadline + W` without a close, and flag late answers. | A dead browser cannot hold the route forever. Late evidence makes the rare miss visible. | **Hold the route until the browser closes (`plan1` §1).** Strands attempts and needs manual recovery for every offline device. |
| No credit-back from browser-reported paint time. | — | Browser-controlled timestamps are not trustworthy. |

## 5. Work plan

Releases:

- **R1:** Phase 1 and Phase 4.1. Safe with today's server and client contracts.
- **R2:** Phases 2 and 3, behind a per-runtime flag; they share a migration and a client release.
- **R3:** Phase 4.2–4.5 and Phase 5.

### Phase 0 — Baseline and preflight (no code)

0.1 **Baseline load run.** Add the scenario `k6/sat-m1-m2-handoff.js`, starting from `k6/sat-module-entry-2000.js`. N students reach M1 zero together, each with 1–3 answers changed in the last 2 s. Record:

- p50/p99 of final-batch acknowledgement time relative to the deadline;
- the count of `DEADLINE_EXPIRED` / `ATTEMPT_NOT_WRITABLE` at the M1 boundary;
- deadline → `assessment_route_decisions.created_at`;
- route → first answerable M2 frame (`sat_first_answerable_frame_at`, `useSatExamController.ts:1386-1389`).

Output: the proposed W (decision D1) and the baseline values for every release gate in §11.

0.2 **Preflight for legacy timing.** Before each exam day:

```sql
SELECT id, start_time FROM exam_schedules
WHERE provider_key = 'sat' AND status = 'scheduled' AND sat_timing_model IS NULL;
```

Setting `sat_timing_model = 'sat_personal_v1'` on these rows is safe before Start: the choice is read only at runtime Start (`schedules/service.go:692-707`).

### Phase 1 — Module-scoped save rejections (fixes F2) — R1

1.1 **Server: give module-level rejections a reason** (additive; old clients ignore it).

- `attempts/service.go:668-696` (`ensureQuestionAdmittedForProvider`) and `delivery/service.go:2043-2066` (`ensureSaveModuleAdmitted`) set `Details.reason`:
  - `MODULE_UNASSIGNED` (`:669-671`);
  - `MODULE_CLOSED` (`:672-674`);
  - `MODULE_NOT_STARTED` (`:684-686`);
  - `MODULE_DEADLINE_EXPIRED` (`:693-695`).
- Also include `questionId` and `moduleId`.
- HTTP codes and error codes stay unchanged.

1.2 **Engine** (`src/shared/durability/DurableResponseEngine.ts`; provider-neutral, the new behavior is opt-in):

- New option `scopeOf?: (questionId: string) => string | null`. SAT passes the question's module attempt id; IELTS/ACT pass nothing, so their behavior is unchanged.
- The drain claims each chunk from a single scope (`:1703-1705`), so a batch never mixes M1 and M2 commands.
- On a terminal conflict whose `details.reason` is one of the four `MODULE_*` values and whose batch has a scope:
  - quarantine that scope's in-flight and outbox commands (kept, archived, tombstoned as today);
  - add the scope to `closedScopes`, so later commands for it are quarantined locally without being sent;
  - do **not** set `conflict_terminal`; set `saved_locally` with `lastError = "MODULE_CLOSED:<scope>"`;
  - emit the durability event `module_scope_closed { scope, reason, count }`.
- Without a reason (old server), behavior stays exactly as today. Guessing from the message could misread an attempt-level close.
- New method `getScopeManifest(scope)` returns `{questionId, writeId, clientVersion}[]` for the latest write of every question in the scope that is acknowledged or pending (not blocked). It is used by Phase 3.

1.3 **Hook** (`src/features/student-delivery/hooks/useSatResponsePersistence.ts:253-298`):

- Build `scopeOf` from the bootstrap: question → module attempt id.
- Map `MODULE_CLOSED:<scope>` to a new non-blocking value, `failureKind = 'module_closed'`, plus `closedModuleAttemptId`.
- `'expired'` stays only for attempt-level reasons.

1.4 **Route/UI** (`SatStudentSessionRoute.tsx:261-262`, `:749-760`):

- `persistenceInteractionBlocked` keeps `superseded | terminal | expired` and excludes `module_closed`.
- Add a non-blocking notice: "1 Module 1 answer was not confirmed before time ended. It is kept on this device; your proctor can review it."

1.5 **Tests:**

- Engine: a batch scoped to M1 rejected with `DEADLINE_EXPIRED` + `MODULE_DEADLINE_EXPIRED` → M1 commands quarantined; a later M2 command is sent and acknowledged; status reaches `synced`.
- Engine: the same rejection without a reason → `conflict_terminal`, as today.
- Engine: a batch never contains two scopes.
- Route: `module_closed` on M1 while M2 is active → the shell is not blocked.
- Server: each of the four gates returns its reason.

Done when: A3 holds in unit tests and in the Phase 0 scenario (0 blocked M2 screens).

### Phase 2 — M2 clock starts on entry (fixes F1) — R2

2.1 **Migration `0074_sat_module_handoff.sql`** (expand only; all columns nullable):

- `assessment_module_attempts.auto_start_at TIMESTAMP(6) NULL`, plus `INDEX (state, auto_start_at, id)`.
- `exam_session_runtimes.sat_handoff_mode VARCHAR(32) NULL` (`server_start` | `client_start`; NULL = `server_start`).
- `assessment_route_decisions.route_basis VARCHAR(32) NULL` and `late_answer_count INT NULL` (used by Phase 3).

2.2 **Capture the mode at runtime Start** (`runtime/service.go:336-363`), from config `SAT_HANDOFF_MODE` (default `server_start`), only for `sat_personal_v1`. A live runtime never changes mode.

2.3 **`finalizeModuleTx`** (`start_submit.go:956-979`): personal, same section, `client_start` → insert M2 `not_started` with `available_at = now` and `auto_start_at = now + G`. This is a new helper next to `insertModuleAttemptTx` (`:1431-1436`). The `server_start` path is unchanged. Route decision, M1 lock and M2 insert stay in one transaction.

2.4 **Fix the existing auto-activation (required).** `reconcile.go:173-180` currently starts *any* `not_started` row whose `available_at <= NOW()`. That would start M2 at the next read and defeat this phase. Change the predicate to `COALESCE(auto_start_at, available_at) <= UTC_TIMESTAMP(6)`; break→next-M1 rows have a NULL `auto_start_at` and keep today's behavior. The existing `pendingBreak` guard (`:166-172`) and the live-runtime guard (`:143`) stay. Add a candidate scan for due rows to the personal sweep, alongside the break scan (`reconcile.go:530-573`):

```sql
state = 'not_started' AND auto_start_at <= ? AND paused_at IS NULL
```

It uses the new index.

2.5 **Content fence** (`service.go:754-762`): when the runtime is in `client_start` mode, a branch module counts as opened only if its attempt `State != "not_started"`. M2 content then arrives only through `StartModuleOfferAck(needContent)` (`start_submit.go:81-91`, `sat_entry_state.go:196`), which starts the clock in the same request. Extend `branch_content_test.go` with: routed + `not_started` → withheld; `active` → delivered.

2.6 **StartModule for M2:**

- No new start logic is needed (`start_submit.go:153-204`).
- Prepare the response content before the start transaction where possible. Sections are cached per version (`service.go:366`), so the time after commit is only serialization.
- `StartModule` bumps `control_epoch` (`:195` → `:709`). The browser adopts it via `adoptControlEpoch` (`useSatExamController.ts:905-906`), which requires an idle engine (`DurableResponseEngine.ts:653`). That holds after a confirmed close; otherwise the existing `CONTROL_EPOCH_STALE` recovery applies.

2.7 **Browser entry decision** (`application/satEntry.ts:201-234`):

- Add the case `adaptive-handoff` → `shouldStart`, when all of these hold:
  - the previous module in the same section is final;
  - the pending module is the routed branch;
  - its state is `not_started`;
  - `available_at <= serverNow`;
  - the runtime is live, the proctor has not paused it, and there is no attempt-level persistence block.
- Update the "initial Module 1 only" comments in `useSatModuleEntry.ts:26-34` and `useSatExamController.ts:1055-1058`.
- `startPendingModule` already sends `needContent` (`useSatExamController.ts:961`) and emits `sat_module_advance` (`:988-992`).

2.8 **Avoid a pointless bootstrap.** In `refresh` (`useSatExamController.ts:446-454`), do not fall back to a full bootstrap for an unknown module whose attempt is `not_started`; its content comes from `StartModule`.

2.9 **UI:** the transition screen shows "Module 2 is ready — starting" with no running clock. The proctor roster (`proctor/sessions.go` projection) shows "Starting Module 2" for a routed `not_started` M2.

2.10 **Tests:**

- `finalizeModuleTx` in `client_start` inserts `not_started` + `auto_start_at`.
- Reconcile does **not** start M2 before `auto_start_at`, and does start it after.
- `StartModule` racing the auto-start → one `started_at`; the loser returns the current state (`start_submit.go:173-175`).
- Raw `/bootstrap` and `/state` before start contain no M2 content.
- Browser: `adaptive-handoff` decision table; the M2 countdown at first paint equals the allotment ± transfer.
- Real-MySQL test following `cmd/api/sat_v2_completion_mysql_test.go`.

2.11 **Compression for shared Wi-Fi (D4):** gzip the JSON responses of the assessment-delivery read and module routes (`bootstrap`, `state`, `entry-state`, `modules/start`, `modules/close`). Use the standard middleware on that route group only; WebSocket and streaming routes are untouched. Verify `Content-Encoding: gzip` and the compressed size of a `StartModule` ack with content.

### Phase 3 — Route only from complete M1 answers (fixes F3) — R2

3.1 **Close window W (personal only; a maximum, not a fixed delay):**

- Routing happens **as soon as** the browser's close request is accepted, which is normally one round trip after zero. W is only the longest the server waits for a browser that never confirms (offline, crashed, old bundle).
- Add `attempts.ModuleCloseWindow(timingModel, handoffMode string) time.Duration`. It returns W for `sat_personal_v1` runtimes in `client_start` mode, and `SATSaveGrace` (3 s) otherwise, so a runtime with the flag off keeps today's timing exactly.
- W comes from config `SAT_PERSONAL_CLOSE_WINDOW_SECS`, default 15 (decision D1).
- Replace the personal-path uses: `attempts/service.go:691-692`, `delivery/service.go:2063`, `reconcile.go:141` (per attempt, by timing model), `reconcile.go:487`, `reconcile.go:641`.
- Cohort and proctor uses stay on `SATSaveGrace`.
- Keep `save_gate_boundary_test.go`, parameterized over both values: both write gates and the reconciler must still end at the same instant.

3.2 **`POST /api/v1/assessment-delivery/schedules/{scheduleID}/modules/close`.** Attempt bearer, `TierWrites`, next to `modules/start` (`cmd/api/main.go:621`). Request/response contract in §7. Server transaction `delivery.CloseModule`:

1. Bearer/schedule binding, SAT provider, writer-session fence (`enforceWriterSessionTx`), as `startModuleWithResponse` does (`start_submit.go:99-140`).
2. Lock in reconciler order: attempt `FOR UPDATE` → runtime `FOR SHARE` → M1 module row `FOR UPDATE` (`reconcile.go:91-108`, `:583-602`).
3. M1 already `locked`/`submitted` → return the current state (idempotent; no second event).
4. DB now < M1 deadline → `409 MODULE_NOT_EXPIRED { deadlineAt, serverNow }`. The browser retries at that deadline.
5. Verify the manifest:

   ```sql
   SELECT question_id, client_version FROM attempt_responses_v2
   WHERE attempt_id = ? AND module_id = ? AND question_id IN (...)
   ```

   - Every manifest entry needs a row with `client_version >= entry.clientVersion`; otherwise `409 CLOSE_WRITES_PENDING { questionIds }`.
   - Entries not in M1 → `400`.
   - The read runs under the attempt lock, so no write can interleave.
6. Call `finalizeModuleTx(..., "time_expired")` with `route_basis = 'client_confirmed'` and `late_answer_count` (see 3.3). M2 is inserted per the runtime mode (Phase 2.3).
7. Append the module event in the transaction (`appendModuleEventsTx`) and publish it after commit, as the reconciler does (`reconcile.go:278-289`).

3.3 **Route audit:**

- `finalizeModuleTx` gains a `basis` argument: `client_confirmed`, `window_closed` (reconciler), `proctor_end`, `proctor_terminate`, or `room_completed`.
- It computes `late_answer_count` from `attempt_responses_v2` rows of M1 with `updated_at` after the M1 deadline.
- Both are stored on `assessment_route_decisions`.

3.4 **Browser close flow** (replaces `useSatExamController.ts:1495-1500`):

- At M1 expiry: freeze input (existing), flush the M1 scope, then POST close with `getScopeManifest(M1)`.
- Handle `MODULE_NOT_EXPIRED` (retry at the returned deadline) and `CLOSE_WRITES_PENDING` (flush the listed questions, retry).
- Retry transport errors with 0.5–1 s jitter until `deadline + W`.
- On success, commit the returned state; the Phase 2.7 decision then calls `StartModule(M2)`.

3.5 **Fallback discovery** (browser offline or close refused): schedule `/state` reads at `deadline + W + jitter(0–1 s)`, then backoff 1 s, 2 s, 3 s until M1 is final, then resume the normal poll. `/state` reconciles on read (`service.go:351-358`), so each browser finalizes its own attempt in parallel.

3.6 **Tests:**

- An answer clicked 0.5 s before zero whose save is delayed beyond 3 s but within W → included in `raw_correct`; the route matches.
- Close before the deadline → `MODULE_NOT_EXPIRED`.
- Manifest missing a write → `CLOSE_WRITES_PENDING`; succeeds after flush.
- Two closes, close racing the reconciler at `deadline + W`, close racing a proctor end → one decision and one M2. The loser returns the current state.
- A write after close → `MODULE_CLOSED` (module-scoped, Phase 1).
- The cohort model still uses 3 s (`proctor/reconcile_plan_test.go:218-235` unchanged).

### Phase 4 — Capacity and operations (F4) — 4.1 in R1, rest in R3

4.1 **Bounded-parallel personal lane** (`reconcile.go:424-457`):

- Run candidates with concurrency `SAT_RECONCILE_CONCURRENCY` (default 4, at most `DB_POOL_MAX_WORKER − 2`).
- Keep "continue after failure" and first-error semantics (`reconcile_batch_test.go:15-43`).
- This is safe because the request path already reconciles different attempts concurrently under the same lock order (attempt → runtime `FOR SHARE` → module rows).

4.2 **Metrics** (existing telemetry helpers; no answer content, no PII):

| Name | Labels | Meaning |
|---|---|---|
| `sat_module_close_total` | `basis`, `outcome` | Close results. |
| `sat_route_lag_seconds` | `basis` | `route_decision.created_at − M1 deadline`. |
| `sat_m2_start_lag_seconds` | `starter=client\|auto` | `M2.started_at − route_decision.created_at`. |
| `sat_m2_auto_start_total` | — | Backstop starts. |
| `sat_module_scoped_rejection_total` | `reason` | Phase 1 reasons at the gate. |
| `sat_close_writes_pending_total` | — | Manifest mismatches. |
| `sat_late_answer_evidence_total` | `would_change_route` | Phase 5. |
| Browser: `sat_first_answerable_frame_at` (existing) | + `m2AllotmentDeltaSeconds` | Allotment minus remaining at first frame. |

4.3 **Alerts** (initial thresholds; tune from Phase 0):

- `sat_route_lag_seconds` p99 > W + 5 s;
- `sat_m2_start_lag_seconds{starter=client}` p99 > 5 s;
- auto-starts > 1% of routes;
- module-scoped rejections > 0.5% of closes;
- any `would_change_route=true`.

4.4 **Proctor runbook:**

- "Starting Module 2" lasting longer than G → the backstop started M2; check the student's device.
- "Late Module 1 answer" flag → review per decision D3.
- Logs carry `attempt_id`, `module_attempt_id`, `close_id`, `route_basis`, `late_answer_count`, `selected_route`.

4.5 **Legacy cohort:** keep the Phase 0.2 preflight in the exam-day checklist (decision D5).

### Phase 5 — Late-answer evidence (after W) — R3

5.1 **Migration `0075_sat_late_answer_evidence.sql`:** table `assessment_late_answer_evidence` with columns:

- `id`, `attempt_id`, `module_attempt_id`, `question_id`;
- `response JSON`, `client_received_at`, `server_received_at`;
- `would_change_route BOOLEAN`, `reviewed_at`, `reviewed_by`;
- unique `(module_attempt_id, question_id)`.

5.2 **`POST …/modules/late-evidence`:** the browser uploads quarantined M1 drafts scoped `MODULE_CLOSED` once. The evidence is stored only and never applied to responses.

5.3 **Route-change check:** rescore M1 with the evidence overlaid on `attempt_responses_v2`, using the stored `policy_config` from `assessment_route_decisions`. Set `would_change_route` when `chooseAdaptiveRoute` (`start_submit.go:1377-1413`) returns a different route.

5.4 **When `would_change_route` is true:** record a proctor alert for review. No re-route is offered (decision D3); the scored route stands.

## 6. Schema changes

| Migration | Change | Old code + new schema |
|---|---|---|
| `0074_sat_module_handoff.sql` | `assessment_module_attempts.auto_start_at` + index; `exam_session_runtimes.sat_handoff_mode`; `assessment_route_decisions.route_basis`, `late_answer_count` | Safe: nullable columns that old code does not read. |
| `0075_sat_late_answer_evidence.sql` | New table | Safe. |

New code must not run against the old schema: deploy migrations first (startup migrations) or in the same release.

## 7. API contract

**`POST /api/v1/assessment-delivery/schedules/{scheduleID}/modules/close`**

```json
{
  "moduleId": "…",
  "moduleAttemptId": "…",
  "closeId": "uuid",
  "answers": [{ "questionId": "…", "writeId": "…", "clientVersion": 4 }]
}
```

| Result | Body |
|---|---|
| `200` | `{ "closed": true, "routeBasis": "client_confirmed" \| "window_closed" \| …, "nextModule": { "moduleId", "moduleAttemptId", "state", "availableAt" } \| null, "serverNow", "controlEpoch" }`. No M2 content. |
| `409 MODULE_NOT_EXPIRED` | `{ deadlineAt, serverNow }` |
| `409 CLOSE_WRITES_PENDING` | `{ questionIds: [...] }` |
| `400` | Manifest entry outside M1. |
| Existing writer-fence / proctor errors | Unchanged codes. |

**Module-level save rejections** (existing codes, new `details.reason`):

| Code | `details.reason` | Engine handling |
|---|---|---|
| `ATTEMPT_NOT_WRITABLE` | `MODULE_UNASSIGNED`, `MODULE_CLOSED`, `MODULE_NOT_STARTED` | Scope-quarantine. |
| `DEADLINE_EXPIRED` | `MODULE_DEADLINE_EXPIRED` | Scope-quarantine. |
| Any, without a reason | — | As today (attempt-level). |

**`StartModule` for M2:** existing endpoint and payload (`moduleId`, `needContent`, `controlEpoch`).

## 8. Concurrency and failure analysis

| Scenario | Outcome | Mechanism |
|---|---|---|
| Close vs reconciler at `deadline + W` | One route. The loser sees M1 `locked` and returns the state. | Both lock the attempt row first; M1 conditional update (`start_submit.go:916`). |
| Close vs the same browser's late batch | Batch first → the manifest passes. Close first → the batch gets `MODULE_CLOSED` (module-scoped). | Attempt row lock. The manifest lists only writes the browser already sent before zero. |
| Duplicate close (lost response) | Same state returned; no duplicate event. | Step 3.2.3. |
| Close before the deadline (clock skew) | `MODULE_NOT_EXPIRED`; retry at the server deadline. | DB time inside the transaction. |
| `StartModule(M2)` vs auto-start | One `started_at`. | `WHERE state='not_started'` in both. |
| Proctor pauses during W or the handoff | M1 deadline frozen; close returns `MODULE_NOT_EXPIRED`; no auto-start while paused; `StartModule` refused. | Existing pause accounting, `ensureAttemptCanWorkTx`, auto-start requires a live runtime. |
| Proctor ends the section during W | Existing `proctor_end` finalize; close returns the state. | Unchanged. |
| Device takeover during W | The old device's close fails the writer fence; the new device recovers and closes. | Existing lease/writer fence. |
| Browser crashes after the final batch, before close | Route at `deadline + W` from complete saved answers; M2 auto-starts at G. | Backstops. |
| Server crashes mid-close | Transaction rolls back; the browser retries. | Single transaction. |
| Commit succeeds, response lost | Retry returns the state. | Idempotent close. |
| Reload during the handoff | Bootstrap shows M1 `locked` and M2 `not_started` → `StartModule`. | Phase 2.7 decision. |
| Offline at zero | Answers in the local checkpoint; route at `deadline + W`; late answers → `MODULE_CLOSED` → evidence (Phase 5). | Phases 1 and 5. |
| Synchronized herd at zero | Closes and starts run in parallel per attempt (API pool), not serialized behind the worker. | Request-path routing; Phase 4.1. |

**Trust limit (unchanged in kind):** the server cannot prove when a click happened. A modified browser can change M1 answers until `deadline + W`. Keep W as the smallest value that meets A2 at N (decision D1). `late_answer_count` makes such writes auditable.

## 9. Compatibility and rollout

| | Server old | Server new, `server_start` | Server new, `client_start` |
|---|---|---|---|
| **Browser old** | Today | Today (reasons ignored; W default 3 s) | No close → route at `deadline + W`; M2 starts at G (waiting, no lost M2 time); F2 lock still possible (old engine) |
| **Browser new** | Close → 404 → fallback reads; M2 `active` → existing path; module reasons absent → attempt-level handling | Close works; M2 `active` → existing path | Full design |

Order:

1. **R1:** Phase 1 server reasons + Phase 4.1. Then the R1 browser.
2. **Migration `0074`.**
3. **R2 server**, default mode `server_start`, W = 3.
4. **R2 browser.**
5. **Run the Phase 0 scenario on staging with real MySQL;** set W.
6. **Turn on `SAT_HANDOFF_MODE=client_start`** for runtimes started at least one exam window after the R2 browser deploy, so no student is still on the old bundle.

Rollback: set `SAT_HANDOFF_MODE=server_start`. This affects only new runtimes. Running runtimes keep their mode, and the auto-start backstop guarantees M2 starts even with a rolled-back browser. Change W only between exams; lowering it mid-exam rejects writes the browser expects to be accepted.

## 10. Observability

See Phase 4.2–4.4. Every new log line carries identities only:

- `attempt_id`, `module_attempt_id`, `close_id`;
- `route_basis`, `selected_route`, `late_answer_count`;
- reason codes.

Never answer text.

## 11. Test and release gates

| Gate | Level | Pass |
|---|---|---|
| G1 | Unit (engine, hook, route, satEntry) | Phase 1.5, 2.10, 3.6 cases green. |
| G2 | Go sqlmock + real MySQL | Close/start/backstop races produce one route and one M2; fence tests pass. |
| G3 | Playwright | `e2e/sat-transition-flow.spec.ts`, extended with: delayed final batch, offline at zero, reload during the handoff. |
| G4 | k6 at N (`k6/sat-m1-m2-handoff.js`) | A1 (≤ 2 s p99), A3 (0 blocked), A4 (0 duplicates), route-lag p99 ≤ W + 2 s, M2 start-lag p99 ≤ 3 s. |
| G5 | Answer correctness at N | Every answer acknowledged before `deadline + W` is in `raw_correct`. Compare browser-captured answers with the route decision, reusing the pattern of `load-runner/e2e/prod-load/student-answer-capture.ts` and `grading-verifier.ts`. |
| G6 | Raw responses | No unstarted or unselected branch content (extend `cmd/api/student_branch_raw_routes_test.go`). |

## 12. Decisions

| ID | Decision | Resolution |
|---|---|---|
| D1 | W (close window, personal only) | 15 s **maximum**, configurable via `SAT_PERSONAL_CLOSE_WINDOW_SECS`. A confirmed close routes immediately, with no waiting. Only browsers that never confirm wait up to W. |
| D2 | G (M2 auto-start backstop) | 60 s (`SAT_M2_AUTO_START_SECS`). |
| D3 | Re-route when late evidence would flip the route | No re-route. The flag is for review only. |
| D4 | Target concurrency N | 400 students on one shared Wi-Fi (one public IP, one uplink). See §12.1. |
| D5 | Legacy `cohort_section_v3` schedules | Move them to `sat_personal_v1` before Start (preflight 0.2) rather than changing cohort timing. |

### 12.1 Shared Wi-Fi consequences (D4)

- **Per-IP rate limits.** All 400 students share one bucket for limits keyed by IP (`httpx.ClientIPKey`, trusted-proxy `X-Forwarded-For`).
  - The global backstop (`main.go:492`, `RATE_LIMIT_BACKSTOP_PER_MIN`, default 30000/min) covers all traffic. The handoff adds about 4 requests per student (≈1600 in a few seconds), which is within the limit.
  - Student check-in (`RATE_LIMIT_STUDENT_CHECKIN_PER_MIN`, default 1200/min) is tight for 400 simultaneous entries with retries. Raise it to at least 3000 for a 400-student room. This is an exam-entry setting, outside this change.
  - The answer, state, start and close routes key by attempt (`attemptKey`, `main.go:958-961`), so they are not shared.
- **One uplink.** After Phase 2 the only transfer charged to the M2 clock is the `StartModule` response with M2 content. The API sends uncompressed JSON (no compression middleware in `cmd/api`). Phase 2.11 adds gzip to the assessment-delivery read and start responses.
- **Load test.** k6 from one machine reproduces one-IP behavior. Run the gate at N = 400.

## 13. Out of scope

- Changing cohort-model timing (only the preflight check).
- IELTS and ACT. The engine change is opt-in via `scopeOf`.
- The break → Math Module 1 handoff. It has the same server-starts-the-clock shape (`reconcile.go:172-189`), but the browser already pulls at break end (`useSatExamController.ts:1464-1474`). `client_start` can be extended to it later with the same mechanism.
