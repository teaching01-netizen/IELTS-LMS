# Local-Writer Answer Invariant Plan (No Rollback While Typing)

## Goal
Ensure the current tab treats local answer fields as authoritative during an active attempt so typed/selected content never disappears during backend refreshes.

The invariant for the active tab is:
- Never overwrite local `answers`, `writingAnswers`, or `flags` from an incoming same-attempt snapshot.
- Continue hydrating non-answer coordination fields from backend/runtime snapshots.
- Keep existing freshness and stale-snapshot protections in repository/provider layers.
- Apply this invariant per tab; cross-tab writer arbitration is not part of this change.

## Implementation Checklist (Updated 2026-05-01)
- [x] Same-attempt answer-field freeze implemented in `StudentRuntimeProvider` for `answers`, `writingAnswers`, and `flags`.
- [x] Proctor/runtime/non-answer hydration paths preserved for same-attempt updates.
- [x] Full answer hydration preserved for first hydration and new `attempt.id`.
- [x] Route hook now sets `attemptSnapshot` from reconciled repository state (refresh and initial load).
- [x] Out-of-order refresh protection implemented with epoch sequencing + freshness discard gate.
- [x] Dropped-mutation one-shot authoritative reconciliation implemented via `recovery.lastDroppedMutations`.
- [x] `student_refresh_stale_discard_total` metric emitted.
- [x] `student_attempt_dropped_mutation_total` metric emitted.
- [x] `student_answer_reconcile_from_server_total` metric emitted.
- [x] `student_runtime_revision_regression_total` metric emitted.
- [x] Required dimensions wired on these metrics: `version`, `scheduleId`, `attemptId`, `endpoint`, `statusCode`, `reason`, `syncState`.
- [x] Runtime-delivered rollout policy parsing added (`enabled`, `killSwitch`, `cohort`, `configFingerprint`) in session live payload handling.
- [x] Rollout policy wired through route -> app wrapper -> runtime provider to support mixed-version behavior.
- [x] Mixed-version safety test added (kill-switch path disables freeze and preserves legacy overwrite behavior).
- [x] Route hook race test added for stale/overlapping refresh responses.
- [x] Repository/provider dropped-mutation regression coverage added.
- [x] Targeted and broader affected Vitest suites pass.

## Remaining Operational Checklist
- [ ] Backend must actively provide rollout fields in `/v1/student/sessions/:scheduleId/live` for real cohort canary control.
- [ ] Production alert thresholds/rollback criteria still need to be configured in monitoring/ops.

## Gap Closures Delivered (TDD Follow-up, 2026-05-01)

- [x] **Dropped-mutation reconcile is now key-scoped instead of full-map overwrite**
  - Local drop summary now records affected keys (`affectedAnswers`, `affectedWritingAnswers`, `affectedFlags`).
  - Runtime reconcile applies server values only to affected keys; unrelated in-progress typing/selection remains local.
- [x] **Freshness ordering now treats revision presence as authoritative**
  - Revision-bearing snapshots cannot be displaced by revisionless snapshots using only `updatedAt`.
  - Eliminates mixed-shape stale apply where missing revision previously won via timestamp heuristics.
- [x] **Initial load resilience when live attempt is temporarily omitted**
  - If `/live` omits `attempt`, route hook first restores latest cached attempt for the same candidate instead of immediate bootstrap.
  - Prevents accidental attempt replacement/reset during transient live payload gaps.
- [x] **Equal-freshness tie handling hardened in attempt provider**
  - Removed timestamp tie-break authority.
  - Local state is retained only when mutation/divergence signals exist under equal accepted-seq / non-authoritative ties.

### TDD Regression Coverage Added

- [x] `StudentRuntimeProvider`:
  - dropped-mutation reconcile updates only targeted objective key and does not overwrite unrelated writing draft.
- [x] `useStudentSessionRouteData`:
  - rejects revisionless refresh snapshot when a revisioned snapshot is already applied.
  - reuses cached attempt when live attempt is temporarily absent and avoids immediate bootstrap.
- [x] `StudentAttemptProvider`:
  - equal-freshness behavior aligned with local-mutation-signal policy; existing stale rollback safeguards remain green.

## Gap Closures Delivered (TDD, 2026-05-01)

- [x] **Partial freshness apply (attempt/runtime split):** stale runtime dimension no longer forces whole-snapshot discard when attempt dimension is fresher.
- [x] **Repository write serialization:** `BackendStudentAttemptRepository.saveAttempt()` is now serialized per `attempt.id` to prevent concurrent duplicate mutation flushes.
- [x] **Timestamp authority removal on tie:** accepted-state preference no longer uses client-local timestamp tie-breakers (`updatedAt` / `lastPersistedAt`) when accepted sequence is equal.
- [x] **Regression tests added first (red), then implementation (green):**
  - `useStudentSessionRouteData.backend.test.tsx`: applies fresher attempt snapshot even when runtime freshness regresses.
  - `studentAttemptRepository.backend.test.ts`: serializes concurrent save calls to avoid duplicate mutation batches.
  - `studentAttemptRepository.test.ts`: incoming snapshot wins when accepted sequence is tied despite local newer timestamps.

## Gap Closures Delivered (TDD Follow-up 2, 2026-05-01)

- [x] **Dropped-mutation reconcile no longer deletes local answer keys when snapshot key is absent**
  - Targeted reconcile now preserves local value for missing snapshot keys instead of treating omission as an implicit delete.
  - Prevents sparse/partial payload shape from erasing in-progress typed/selected answers.
- [x] **Slot-scoped dropped-mutation reconciliation for array answers**
  - Repository dropped summary now captures `affectedAnswerSlots` (`questionId` + `slotIndex`) for dropped slot mutations.
  - Runtime reconcile applies only those dropped slots and preserves unrelated local slots in the same question.
- [x] **Flush guard prevents RAM pending-answer loss when durable mirror persistence fails**
  - `StudentAttemptProvider.flushPending()` now requires durable pending-mutation mirror to be current before calling repository save/clear paths.
  - If durable mirror write fails, flush aborts and keeps pending local edits intact (`syncState=error`), avoiding false successful clear.
- [x] **New red/green regression coverage for data-loss paths**
  - `StudentRuntimeProvider.test.tsx`: missing-key dropped reconcile keeps local answer.
  - `StudentRuntimeProvider.test.tsx`: dropped slot reconcile updates only targeted slot.
  - `studentAttemptRepository.backend.test.ts`: dropped slot mutation records slot-scoped reconcile metadata.
  - `StudentAttemptProvider.test.tsx`: flush does not clear RAM pending answers when durable persistence keeps failing.

## Scope
- In scope:
  - `StudentRuntimeProvider` same-attempt hydration behavior.
  - `useStudentSessionRouteData` snapshot ingestion alignment with reconciled repository state.
  - Unit/regression tests for provider, app behavior, and route hook.
- Out of scope:
  - CRDT or multi-writer merge architecture changes.
  - Cross-tab writer ownership/arbitration (lease/election/handoff) changes.
  - Public API/type/interface changes.

## Problem Statement
Incoming backend snapshots for the same `attempt.id` can currently rehydrate runtime answer fields and overwrite local in-progress edits. This causes disappearing/reverting text or choices while the user is actively answering.

## Target Behavior
1. If `attempt.id` is unchanged (same active attempt):
- Runtime hydration updates only non-answer fields:
  - phase/module/question position (under existing runtime-backed rules)
  - proctor status/note/warnings
  - violations merge
  - submitted/terminal state
  - sync-state fields
- Runtime hydration does not replace:
  - `answers`
  - `writingAnswers`
  - `flags`

2. If `attempt.id` changes (new attempt) or initial mount:
- Full hydration applies, including answer fields.

3. Session route data ingestion:
- After `saveAttempt(nextAttempt)`, `attemptSnapshot` is sourced from reconciled cached attempt (repository read-back), not raw backend object.

## Implementation Plan

### 1) Harden same-attempt hydration in `StudentRuntimeProvider`
File:
- `src/components/student/providers/StudentRuntimeProvider.tsx`

Changes:
- Introduce explicit same-attempt gating for answer-field hydration.
- Preserve current `hydrate_proctor` path unchanged for immediate warning/pause/termination propagation.
- In `hydrate_attempt` logic:
  - Keep updating non-answer fields and merged violations.
  - Skip replacing `answers`, `writingAnswers`, `flags` for same-attempt snapshots.
  - Allow full answer hydration for first hydration/new `attempt.id`.
- Update reducer equality checks so they no longer compare answer fields when same-attempt answer hydration is intentionally disabled.

Notes:
- Maintain existing `attemptSyncState` gating (`idle`/`saved`) and existing runtime-backed module/question precedence rules.
- Do not weaken terminal-state handling.

### 2) Align route hook snapshot with reconciled repository state
File:
- `src/features/student/hooks/useStudentSessionRouteData.ts`

Changes:
- In both refresh and initial load paths where live attempt exists:
  - map backend attempt -> `nextAttempt`
  - `await studentAttemptRepository.saveAttempt(nextAttempt)`
  - read reconciled attempt from repository (`getAttemptsByScheduleId` + id match or equivalent existing repository method)
  - `setAttemptSnapshot(reconciledAttempt ?? nextAttempt)`

Rationale:
- Repository reconciliation may preserve local-accepted state and replay pending local mutations. Parent `attemptSnapshot` should reflect that final state, not raw backend payload.

### 3) Preserve architecture constraints
- No CRDT migration.
- Keep local-first/per-tab writer behavior for answer fields in the current tab.
- Keep server-authoritative coordination for non-answer runtime/proctor fields.

## Test Plan

### A. Runtime provider invariants
File:
- `src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx`

Add/adjust tests:
1. Same-attempt refresh does not overwrite local objective `answers`.
2. Same-attempt refresh does not overwrite local `writingAnswers`.
3. Same-attempt refresh does not overwrite local `flags`.
4. Proctor pause/warning/termination still hydrates during same-attempt refresh.
5. New `attempt.id` still hydrates answers/writing/flags.
6. Sync-state transition guard: when state moves `saving -> saved`, subsequent same-attempt refresh still preserves local answer fields while non-answer fields hydrate.

### B. App-level regression tests
File:
- `src/components/student/__tests__/StudentApp.test.tsx`

Add/adjust tests simulating incoming snapshot refresh while user interacts:
1. Objective text input remains stable.
2. Writing editor content remains stable.
3. Choice selection (radio/checkbox/select) remains stable.

### C. Route hook regression
File:
- `src/features/student/hooks/__tests__/useStudentSessionRouteData.backend.test.tsx`

Add test to confirm:
- After refresh with backend attempt payload, exposed `attemptSnapshot` equals reconciled cached attempt (local-preserved answer fields if applicable), not stale raw payload.

### D. Existing suite reruns
Run:
- `npx vitest run src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx`
- `npx vitest run src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx`
- `npx vitest run src/services/__tests__/studentAttemptRepository.test.ts`
- `npx vitest run src/components/student/__tests__/StudentApp.test.tsx`
- `npx vitest run src/features/student/hooks/__tests__/useStudentSessionRouteData.backend.test.tsx`

## Acceptance Criteria
- No local answer rollback in active tab during same-attempt snapshot updates.
- Proctor controls and runtime progress continue updating promptly.
- New attempt context still hydrates complete answer state.
- Route hook returns reconciled snapshot state consistent with repository conflict-reconciliation logic.
- Target test suites pass.

## Risks and Mitigations
- Risk: legitimate remote answer updates from another tab/device are ignored in active tab.
  - Mitigation: accepted by policy for this change; applies only during same active attempt in current tab.
- Risk: parallel open tabs for the same attempt can temporarily diverge in answer-field state.
  - Mitigation: accepted for this phase; schedule a dedicated follow-up for cross-tab writer ownership if product policy requires strict single-writer semantics across tabs.
- Risk: reducer no-op checks become inconsistent with selective hydration.
  - Mitigation: update equality logic to match intentional partial hydration behavior.

## Rollout Notes
- Internal behavior change only.
- No migrations and no public API changes.
- Follow-up (separate plan): cross-tab writer ownership/arbitration if strict single-writer across tabs is required.

## Production Gap Addendum (2026-04-30)

This section captures production-only gaps identified after the initial plan draft.

### Critical Gaps

1) **SEV-1: Out-of-order refresh apply can regress runtime/attempt state**
- Gap:
  - `refreshBackendSessionSnapshot()` can be triggered concurrently by polling + websocket events.
  - A stale response can arrive after a newer response and still be applied.
- Why non-prod missed it:
  - Low latency and low event concurrency reduce response reordering.
- Production failure:
  - Pause/termination/section-advance can be briefly reverted client-side by stale payload apply.

2) **SEV-0: Silent divergence when server drops stale mutations**
- Gap:
  - Repository can prune/drop stale objective mutations (`SECTION_MISMATCH` / `OBJECTIVE_LOCKED` paths).
  - Same-attempt freeze of answer fields can keep stale local values visible after server drop.
- Why non-prod missed it:
  - Rare under low traffic and without real section-transition timing races.
- Production failure:
  - Student sees values that are no longer server-accepted, creating silent correctness drift.

### Required Plan Deltas

#### Delta A) Monotonic refresh apply gate (route hook)
File:
- `src/features/student/hooks/useStudentSessionRouteData.ts`

Changes:
- Add request sequencing guard (`refreshEpochRef`) and only apply the latest completed refresh result.
- Add stale-apply rejection based on monotonic freshness key:
  - Prefer backend revision when available.
  - Fallback to `attempt.updatedAt` timestamp ordering when revision is absent.
- Ensure stale refresh results do not call `setRuntimeSnapshot` / `setAttemptSnapshot`.

Outcome:
- Prevents stale payload overwrite under real concurrent refresh traffic.

#### Delta B) Dropped-mutation reconciliation path (no UI warning)
Files:
- `src/services/studentAttemptRepository.ts`
- `src/components/student/providers/StudentRuntimeProvider.tsx`

Changes:
- Keep same-attempt local-authoritative answer behavior by default.
- Add a narrow server-reconciliation exception when repository marks dropped mutations:
  - Use `attemptSnapshot.recovery.lastDroppedMutations` as trigger.
  - On new dropped-mutation marker for same attempt, allow one authoritative answer/flag/writing rehydrate from snapshot.
- Record telemetry/audit for reconciliation event.
- **Do not introduce student-facing UI warnings/banners/modals** for this path.

Outcome:
- Closes silent corruption risk without adding new UI interruption.

#### Delta C) Rollout safety for mixed client versions
Scope:
- Frontend deployment/runtime flags.

Changes:
- Ship under feature flag with cohort canary.
- Define rollback criteria before full rollout.
- Track old/new bundle behavior split during rollout window.

Outcome:
- Limits blast radius from mixed-version behavior differences.

#### Delta D) Observability minimums
Required metrics:
- `student_refresh_stale_discard_total`
- `student_attempt_dropped_mutation_total`
- `student_answer_reconcile_from_server_total`
- `student_runtime_revision_regression_total`

Required dimensions:
- `version`, `scheduleId`, `attemptId`, `endpoint`, `statusCode`, `reason`, `syncState`.

Alerts:
- Any runtime revision regression.
- Dropped mutation spikes above baseline.
- Non-zero server reconciliation events after steady state rollout.

### Test Plan Additions (Production-Race Coverage)

Add to existing test plan:

1. Route hook race test:
- Simulate two overlapping refreshes where older response resolves last.
- Assert older response is discarded and does not mutate runtime/attempt snapshots.

2. Repository + provider dropped-mutation test:
- Simulate `SECTION_MISMATCH`/`OBJECTIVE_LOCKED` prune with `lastDroppedMutations` update.
- Assert same-attempt flow performs one server reconciliation apply for answer fields.
- Assert no UI warning surface is introduced.

3. Mixed-version rollout safety test (integration/e2e or controlled harness):
- Validate behavior compatibility when one client behaves pre-delta and another post-delta.

## Production-First Audit Gap Report (Environment Drift / Real Traffic)

Date: 2026-04-30

### SEVERITY CLASSIFICATION

| Severity | Definition |
| --- | --- |
| SEV-0 | Silent corruption / irreversible bad state |
| SEV-1 | Production outage / hang / infinite retry trap |
| SEV-2 | Visible degradation / consistency window / capacity loss |
| SEV-3 | Latent production risk |

### CRITICAL BUGS (SEV-0 / SEV-1)

#### 1) `updatedAt` fallback is non-authoritative and can reject fresh server truth

- Severity:
  - SEV-0
- Why local/staging did not reveal it:
  - Single-machine clocks and low latency hide timestamp skew and local-write timestamp rewrite effects.
- Failure scenario (prod timeline):
  1. Freshness fallback uses `attempt.updatedAt` ordering when revision is absent.
  2. Client cache rewrites `updatedAt` on every local save.
  3. Client clock skew or frequent local saves make local state appear newer than backend state.
  4. Fresh backend attempt/proctor/terminal transitions get discarded as stale.
  5. Client continues with diverged local state and later conflicts/drops.
- Invariant violated:
  - Server-authoritative coordination state must converge in active session.
- Impact:
  - Silent divergence; potentially wrong final answer set and stale proctor state.
- Trigger conditions:
  - Any clock skew plus frequent local writes while fallback ordering is active.
- Probability in production:
  - Medium-high
- Confidence:
  - High
- Evidence:
  - Plan fallback to `updatedAt` ordering.
  - `LocalStorageStudentAttemptCache.saveAttempt()` overwrites `updatedAt` with `new Date().toISOString()`.

#### 2) Unsynchronized dual writers to `saveAttempt()` can race and drop mutations

- Severity:
  - SEV-0
- Why local/staging did not reveal it:
  - Low event concurrency rarely overlaps route refresh and interactive flush paths.
- Failure scenario (prod timeline):
  1. Route refresh calls `studentAttemptRepository.saveAttempt(nextAttempt)`.
  2. Interactive flush path concurrently calls `studentAttemptRepository.saveAttempt(persistedAttempt)`.
  3. Repository lacks a per-attempt mutex/singleflight around save/flush.
  4. One path conflicts (409), rebase/resends with new mutation IDs.
  5. Under section movement, prune path drops objective mutations.
- Invariant violated:
  - A mutation should be flushed once with deterministic ordering.
- Impact:
  - Silent answer loss and reconciliation churn.
- Trigger conditions:
  - Real user typing during poll/live refresh overlap under moderate latency.
- Probability in production:
  - Medium
- Confidence:
  - Medium-high
- Evidence:
  - `useStudentSessionRouteData.refreshBackendSessionSnapshot()` writes to repository.
  - `StudentAttemptProvider.flushPending()` also writes/flushed via repository.
  - `BackendStudentAttemptRepository.saveAttempt()` has no explicit lock and has prune path on 409 section conflicts.

#### 3) Refresh amplification can become retry storm under latency/burst

- Severity:
  - SEV-1
- Why local/staging did not reveal it:
  - Low fan-in and low tail latency hide overlap, queueing, and retries.
- Failure scenario (prod timeline):
  1. Websocket events trigger refresh directly.
  2. Poller triggers refresh every 10-20s in parallel timeline.
  3. No shared in-flight gate/abort across WS and poll refresh sources.
  4. API client retries requests by default (up to 3 retries with exponential backoff).
  5. Overload raises latency, causing more overlaps and retries.
- Invariant violated:
  - Refresh control-plane should remain bounded and backpressured.
- Impact:
  - Widespread degradation and partial outage of student live path.
- Trigger conditions:
  - Event burst plus p99 latency spike plus many concurrent students.
- Probability in production:
  - Medium-high
- Confidence:
  - High
- Evidence:
  - WS onEvent path triggers route refresh.
  - Polling path triggers route refresh.
  - Generic API retry policy retries non-4xx failures.

### ARCHITECTURAL WEAKNESSES (SEV-2 / SEV-3)

#### A) Cohort canary assumption without runtime cohort flag mechanism

- Severity:
  - SEV-2
- False assumption:
  - "Ship under feature flag with cohort canary" is directly feasible.
- Why it felt safe in non-prod:
  - Single-bundle testing hides lack of dynamic cohort assignment.
- Failure mode in prod:
  - Existing frontend feature flags are build-time env checks; behavior splits by bundle version, not intended cohort.
- Blast radius:
  - Whole frontend deployment slice.
- Observable symptoms:
  - Mixed behavior that cannot be targeted by cohort quickly.
- Time to detect / mitigate / resolve:
  - Detect: medium
  - Mitigate: medium
  - Resolve: medium

#### B) Reconciliation without clear user surface can still look like silent answer change

- Severity:
  - SEV-2
- False assumption:
  - Reconcile-on-drop with no UI warning is always acceptable.
- Why it felt safe in non-prod:
  - Drop paths are rare in low-contention tests.
- Failure mode in prod:
  - A one-shot authoritative rehydrate can visibly alter answers without immediate clarity for candidate/proctor.
- Blast radius:
  - Attempts encountering section-transition conflict windows.
- Observable symptoms:
  - "My answer changed" reports with hard-to-replay context.
- Time to detect / mitigate / resolve:
  - Detect: slow
  - Mitigate: medium
  - Resolve: high

#### C) Observability proposal incomplete for incident triage

- Severity:
  - SEV-3
- False assumption:
  - Proposed counters are sufficient.
- Why it felt safe in non-prod:
  - Unit/integration tests validate logic without incident diagnosis burden.
- Failure mode in prod:
  - Missing correlation dimensions and traces keep dashboards green while user path is degraded.
- Blast radius:
  - Multi-cohort diagnosis and rollback speed.
- Observable symptoms:
  - Low-confidence triage, long MTTR.
- Time to detect / mitigate / resolve:
  - Detect: slow
  - Mitigate: slow
  - Resolve: high

#### D) Test plan still under-covers production traffic shape

- Severity:
  - SEV-3
- False assumption:
  - Race unit tests represent production behavior.
- Why it felt safe in non-prod:
  - Synthetic tests rarely model realistic burst/skew/latency/cardinality.
- Failure mode in prod:
  - Latent concurrency and backpressure bugs emerge only in live exam surges.
- Blast radius:
  - Peak exam windows.
- Observable symptoms:
  - Intermittent stale state, conflict spikes, and unpredictable retries.
- Time to detect / mitigate / resolve:
  - Detect: medium
  - Mitigate: medium
  - Resolve: high

#### E) Local storage durability assumptions under quota/policy pressure

- Severity:
  - SEV-2
- False assumption:
  - Browser persistence is effectively durable for all exam environments.
- Why it felt safe in non-prod:
  - Developer machines rarely hit quota and policy restrictions.
- Failure mode in prod:
  - Pending mutation mirror writes fail; sync state enters error/offline cycles; reload loses unflushed local intent.
- Blast radius:
  - Managed devices, private mode, low-storage systems.
- Observable symptoms:
  - Pending count stuck, repeated sync error, missing post-reload edits.
- Time to detect / mitigate / resolve:
  - Detect: medium
  - Mitigate: medium
  - Resolve: medium

### INCIDENT AMPLIFICATION & METASTABILITY (Top 5)

#### 1) Retry storm on refresh path

- Blast radius:
  - High
- Likelihood:
  - High
- Recovery difficulty:
  - High
- Trigger:
  - Live-event burst plus latency spike.
- Propagation:
  - WS refresh overlap + polling + client retries -> backend saturation -> rising latency -> more retries.
- Steady degraded state:
  - High p99, stale snapshots, user-visible lag.
- Recovery path:
  - Backpressure refresh sources, cap retry budget, temporarily widen polling interval.
- Self-healing:
  - Weak

#### 2) Concurrent `saveAttempt` race cascade

- Blast radius:
  - High
- Likelihood:
  - Medium
- Recovery difficulty:
  - High
- Trigger:
  - Active typing while background refresh is writing.
- Propagation:
  - Duplicate flush -> 409 conflicts -> rebase/resend -> section mismatch prune -> dropped mutations.
- Steady degraded state:
  - Repeated conflicts and reconciliation churn.
- Recovery path:
  - Per-attempt mutex plus singleflight flush path.
- Self-healing:
  - Partial

#### 3) Timestamp-skew stale-state metastability

- Blast radius:
  - Medium-high
- Likelihood:
  - Medium
- Recovery difficulty:
  - High
- Trigger:
  - Client clock skew with `updatedAt` fallback ordering.
- Propagation:
  - Fresh snapshots discarded -> local drift persists -> future conflicts.
- Steady degraded state:
  - Client maintains "newer local" illusion.
- Recovery path:
  - Remove timestamp fallback; use server monotonic token only.
- Self-healing:
  - No

#### 4) Storage exhaustion sync degradation

- Blast radius:
  - Medium
- Likelihood:
  - Medium
- Recovery difficulty:
  - Medium
- Trigger:
  - Long offline answering + quota pressure.
- Propagation:
  - Durable write failures -> sync error -> reload data loss.
- Steady degraded state:
  - Persistent local sync errors.
- Recovery path:
  - Explicit storage budget handling and admission control.
- Self-healing:
  - Limited

#### 5) Mixed-version rollout inconsistency

- Blast radius:
  - Medium-high
- Likelihood:
  - Medium
- Recovery difficulty:
  - Medium-high
- Trigger:
  - Partial rollout with non-runtime canary mechanism.
- Propagation:
  - Old/new clients apply different hydration/reconcile semantics.
- Steady degraded state:
  - Nondeterministic user reports and support load.
- Recovery path:
  - Runtime cohort flag + rollback guardrails + version-fingerprint monitoring.
- Self-healing:
  - No

### RECOMMENDED FIXES

#### 1) Replace `updatedAt` fallback with monotonic server freshness token

- Mechanism:
  - Gate apply only by backend monotonic token (attempt `revision`; runtime monotonic revision/timestamp that client never rewrites).
- Where to apply:
  - `useStudentSessionRouteData.ts` refresh apply guard.
- Why it closes prod-vs-local gap:
  - Removes client clock and local-save rewrite drift from correctness decision.
- Tradeoffs:
  - Requires explicit behavior when token absent.
- Verification:
  - Clock skew tests (+/-10 minutes), overlapping refresh race tests.

#### 2) Add per-attempt singleflight/mutex for `saveAttempt` + mutation flush

- Mechanism:
  - Serialize repository writes and flushes per attempt ID.
- Where to apply:
  - `studentAttemptRepository.ts`.
- Why it closes prod-vs-local gap:
  - Eliminates concurrent duplicate flush and nondeterministic conflict handling.
- Tradeoffs:
  - Small latency increase under contention.
- Verification:
  - Stress test with concurrent refresh + typing; assert no duplicate submissions and deterministic seq progression.

#### 3) Add shared refresh backpressure and stale request cancellation

- Mechanism:
  - Coalesce concurrent refresh requests, cancel stale in-flight refreshes, enforce minimum refresh spacing.
- Where to apply:
  - `useStudentSessionRouteData.ts` and refresh callers.
- Why it closes prod-vs-local gap:
  - Prevents amplification under burst and tail latency.
- Tradeoffs:
  - Slightly delayed near-duplicate updates.
- Verification:
  - Burst simulation: WS spike + high latency + polling overlap.

#### 4) Use runtime-delivered canary flags plus explicit kill switch

- Mechanism:
  - Server-assigned cohort flag in live/static payload; client reads runtime config, not build-time env only.
- Where to apply:
  - Session payload contract + frontend route hook.
- Why it closes prod-vs-local gap:
  - Enables controlled partial rollout and fast rollback in mixed-version reality.
- Tradeoffs:
  - Extra config path and monitoring.
- Verification:
  - Controlled A/B rollout harness with mixed client versions.

#### 5) Add explicit reconcile audit + user consistency notice on authoritative overwrite

- Mechanism:
  - Emit event and surface a bounded notice only when server-authoritative answer rehydrate actually changes local-visible answers.
- Where to apply:
  - `StudentRuntimeProvider.tsx` and `StudentApp.tsx`.
- Why it closes prod-vs-local gap:
  - Prevents silent user-facing correctness drift.
- Tradeoffs:
  - Additional UX branch and messaging.
- Verification:
  - End-to-end dropped-mutation scenario with assertion on notice and telemetry event.

### MUST-HAVE OBSERVABILITY

#### Issue: non-authoritative timestamp freshness decisions

- Metric:
  - `student_refresh_discard_reason_total{reason}`
- Alert condition:
  - `reason in (timestamp_skew, stale_token_missing)` > 0 for 5m.
- Dashboard correlation:
  - Discard reasons vs revision progression vs mutation conflict rates.
- Required trace spans:
  - `student.refresh.fetch_live`
  - `student.refresh.apply_gate`
- Required log fields:
  - `attemptId`, `scheduleId`, `incomingRevision`, `appliedRevision`, `incomingUpdatedAt`, `localUpdatedAt`, `clientClockOffsetMs`
- Required dimensions:
  - `version`, `tenant/scheduleId`, `AZ`, `dependency`, `endpoint`, `statusCode`, `retryCount`, `queueLag`, `configFingerprint`

#### Issue: concurrent `saveAttempt` races

- Metric:
  - `student_attempt_save_concurrency_total`
  - `student_mutation_conflict_total{reason}`
  - `student_mutation_drop_total`
- Alert condition:
  - Conflict or drop rate > baseline + 3sigma for 10m.
- Dashboard correlation:
  - Save concurrency, 409 reasons, pending depth, answer commit latency.
- Required trace spans:
  - `studentAttempt.saveAttempt`
  - `studentAttempt.flushMutationQueue`
  - `studentAttempt.pruneDroppedMutations`
- Required log fields:
  - `attemptId`, `clientSessionId`, `pendingCount`, `conflictReason`, `latestRevision`, `droppedCount`
- Required dimensions:
  - `version`, `tenant/scheduleId`, `AZ`, `dependency`, `endpoint`, `statusCode`, `retryCount`, `queueLag`, `configFingerprint`

#### Issue: refresh amplification/retry storm

- Metric:
  - `student_refresh_inflight`
  - `student_refresh_trigger_total{source}`
  - `student_refresh_http_retry_total`
  - `student_refresh_latency_ms`
- Alert condition:
  - In-flight refresh > threshold and retry ratio > threshold for 5m.
- Dashboard correlation:
  - WS event rate, poll rate, refresh in-flight, backend 5xx/429, p99 live endpoint latency.
- Required trace spans:
  - `liveUpdates.onEvent`
  - `refreshBackendSessionSnapshot`
  - `apiClient.request`
- Required log fields:
  - `source`, `requestId`, `attemptId`, `durationMs`, `retryAttempt`, `httpStatus`
- Required dimensions:
  - `version`, `tenant/scheduleId`, `AZ`, `dependency`, `endpoint`, `statusCode`, `retryCount`, `queueLag`, `configFingerprint`

### ASSUMPTIONS MADE

1. Backend does not expose a strict monotonic runtime revision token in live payload.
   - Sensitivity: High
   - Information needed: authoritative live API monotonic fields for runtime and attempt.
2. Client clocks on exam devices can skew materially.
   - Sensitivity: High
   - Information needed: fleet time-sync policy and observed skew distribution.
3. `saveAttempt` can overlap concurrently from route hook and provider in real sessions.
   - Sensitivity: High
   - Information needed: production traces per `attemptId` showing overlap timing.
4. Frontend telemetry pipeline does not already emit all proposed counters/dimensions.
   - Sensitivity: Medium
   - Information needed: telemetry event inventory and dashboards.
5. Cohort-level runtime flag delivery is not currently implemented for this behavior.
   - Sensitivity: Medium
   - Information needed: remote-config/canary mechanism details.

### Special Audit Questions (Explicit Answers)

- What works in local but breaks in prod, specifically?
  - Timestamp fallback freshness and unsynchronized dual `saveAttempt` writers.
- What works at 10 req/min but fails at 500 req/sec?
  - Refresh fan-out plus retries plus concurrent mutation flush contention.
- What works with clean test data but fails with messy real data?
  - Dropped/locked mutation reconciliation and stale local overwrite heuristics.
- What breaks only during deploy, restart, or autoscaling?
  - Mixed client-version behavior without true runtime cohort gating.
- What becomes slow first, then unavailable second?
  - Live refresh path latency first, then mutation/refresh overload.
- What duplicates, reorders, or races under multi-instance execution?
  - Concurrent flush/rebase/prune paths and out-of-order snapshot applies.
- Which incidents become self-sustaining even after the trigger is gone?
  - Retry storm and stale-state metastability from incorrect freshness gate.
- Which dashboards would stay green while users are actually suffering?
  - Health and average-latency boards without per-attempt sync/conflict/drop visibility.
