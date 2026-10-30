# IELTS fast, safe section transitions — low-level implementation plan

Status: implementation and local verification completed 2026-10-30 (uncommitted). Steps 2–6 are implemented. Local real-expiry browser checks pass in Chromium (3.323s expiry-to-first-usable-frame) and WebKit (4.028s); both preserve full duration and delayed-candidate fairness. Outstanding: production baseline trace (step 1) and staged load (step 7), which require production/staging access. Deviations: boundary refresh stays in `StudentApp` (1s healthy cadence under the flag) instead of moving into `useStudentSessionRouteData`; `flushPending({ boundary: true })` asserts the engine invariant only for section-boundary callers, so reconnect flushes keep their old semantics; no media prefetch. Also fixed: `useStudentSubmissionOrchestration` aborted its cancellation signal on StrictMode's dev remount, which silently disabled client module submits on the dev server. `e2e/ielts-personal-timing.spec.ts` passes 4/6 with the flag both on and off; `:626` and `:781` fail identically on clean `HEAD` 927cea40, so they predate this work.

## 1. Decision and change boundary

Use the existing `ielts_cohort_personal_v2` model: staff controls room release, pause, resume, and termination; each candidate starts a released section when ready and receives their full configured duration. Prepare locally before expiry, overlap preparation with outgoing answer delivery, and retain the server's 3-second response-save grace. Do not make one candidate wait for every other browser.

The normal transition is:

`prepare locally ahead of time → freeze outgoing input and flush → wait for server eligibility → mount and validate next surface → activate once → refresh authoritative state`

Preparation and answer flushing overlap. Activation waits for both; the working clock never starts merely because preflight completed.

### Verified repository facts

All paths below are relative to the repository root.

| Existing file / symbol | Verified responsibility |
| --- | --- |
| `backend/go/internal/schedules/service.go`: `PersistIeltsTimingChoice` | `IELTS_PERSONAL_TIMING=true` selects `ielts_cohort_personal_v2` for newly created IELTS schedules. Existing sessions retain their stored timing model. |
| `backend/go/internal/runtime/timingmodel.go` | Distinguishes legacy IELTS personal v1, cohort personal v2, and other provider models. |
| `backend/go/internal/attempts/service.go`: `ResponseSaveGrace`, `ensureQuestionAdmittedForProvider` | 3-second server arrival window; personal timeline, pause, and module ownership enforce answer writability. |
| `backend/go/internal/proctor/reconcile.go`: `planSectionAdvance`, `startSectionEffect` | Room advance waits for grace and authored gap. V2 releases the room section without waiting for the cohort readiness barrier. |
| `backend/go/internal/runtime/cohort_readiness.go`: `ReadyCohortSection` | Existing idempotent readiness entry; dispatches personal models separately from legacy cohort readiness. |
| `backend/go/internal/runtime/ielts_personal.go`: `readyIELTSPersonalSectionInTx` | Authenticated attempt lock, previous-section checks, room release, preparation expiry, readiness signals, persisted activation and deadline. |
| `backend/go/cmd/api/handlers_cohort_readiness.go`: `ieltsCohortReadyHandler` | Existing `POST /api/v1/student/sessions/{scheduleID}/sections/{sectionKey}/ready` validates student identity and accepts readiness booleans. |
| `backend/go/cmd/api/student_context.go`: `projectIELTSPersonalRuntime` | Derives candidate-specific current section, expected start, preparation window, and deadline. |
| `src/components/student/StudentApp.tsx` | Connects readiness, expiry refresh, submission, and transition surfaces. Currently owns an additional boundary refresh backoff loop. |
| `src/features/student/hooks/useIeltsCohortReadiness.ts` | Storage probe, current DOM/audio checks, readiness request, and 1/2/4/8-second jittered backoff. |
| `src/components/student/useStudentSubmissionOrchestration.ts` | Module submission deduplication, flush barrier, bounded retries, and final attempt submission. |
| `src/components/student/providers/StudentAttemptProvider.tsx`: `flushPending` | Waits for V2 acceptances/recovery, flushes one durability engine, and checks pending count and attempt identity. |
| `src/shared/durability/DurableResponseEngine.ts` | Sole response-ordering/delivery owner; already exposes `assertBoundarySettled`, including blocked and quarantined work. |
| `src/features/student/hooks/useStudentSessionRouteData.ts` | Loads/hydrates the published static snapshot, coordinates live refresh and recovery polling. |
| `backend/go/internal/background/runner.go`, `idle.go` | Section reconciliation currently shares hot-cycle execution with outbox work; activity-driven lifecycle and drain own recurring job lifetime. |

### Material distinctions and unknowns

- Verified: the production environment pasted in chat omitted `IELTS_PERSONAL_TIMING`. Unknown: deployed binary, platform-injected variables, and the affected schedule's stored model. Before rollout, inspect that schedule and runtime in a read-only query. Do not conclude its model from the environment alone.
- Verified: static content is hydrated from the published snapshot. Unknown: exact current server filtering and media authorization guarantees for future sections. Preflight must use already-authorized material only and must not expand delivery permissions. Hiding downloaded questions does not secure them.
- Verified: personal activation assigns start/deadline using database time. Guarantee a full *assigned* duration and exclude preparation before activation. Response transmission, a hidden tab, or a disconnected browser can still consume elapsed time after a committed start. Do not claim zero visible time loss across arbitrary network failure or reset the clock on retry.
- Inferred: serial waits and backoff can explain the reported delay. No production trace establishes their individual contributions.

### Scope

Include IELTS V2 automatic section transitions, safe preparation, durability gating, bounded readiness retries, authoritative timing projection, boundary refresh coordination, measurement, and failure testing. Preserve authored gaps, accommodations, existing recovery rules, and proctor authority.

Exclude live timing-model conversion, SAT/ACT policy changes, reducing grace, late-answer scoring changes, new infrastructure, replacement durability engines, and new question-delivery permissions. Keep existing manual-submit timing policy; optimize automatic expiry first.

## 2. Requirements and acceptance criteria

| ID | Requirement and observable acceptance | Enforcement owner |
| --- | --- | --- |
| FR-1 | During the final 15 seconds of an active section, prepare its immediate enabled successor once per context. No `/ready` activation is sent by preflight. No future questions become newly accessible. | Proposed local preparation hook |
| FR-2 | At expiry, freeze outgoing edits and run the existing draft commit/durability/transport barrier immediately. Preparation may run concurrently. | Existing runtime blocking and submission orchestration |
| FR-3 | Request next-section activation only after the outgoing barrier succeeds, the room has released it, the personal save grace and gap have elapsed, and the next surface passes final readiness checks. | Client orchestration plus independent server eligibility checks |
| FR-4 | A ready candidate starts without waiting for another candidate. Persist `deadline_at - started_at` equal to the complete configured duration including existing extension/accommodation rules. | Existing V2 timeline transaction |
| FR-5 | Healthy-but-not-ready responses do not cause exponential retry backoff. A readiness-changing event prompts a coalesced immediate check. | Existing readiness hook |
| FR-6 | Refresh, lost notification, lost response, process restart, and duplicate readiness requests recover the committed state without a second start or extended duration. | Timeline transaction, existing live channel, refresh/poll fallback |
| ERR-1 | Paused, cancelled, terminated, stale-device, and unauthorized operations never activate a new section. Storage/content/audio failure stays preparing; preparation expiry remains unable. | Existing handler identity and domain guards |
| ERR-2 | An unsaved, blocked, or quarantined outgoing answer cannot be represented as successfully saved. Keep draft evidence and show an actionable recovery state. | Durability engine and submission barrier |
| PERF-1 | Initial target: p95 expiry-to-next-section-usable <=5 seconds for warmed V2 clients with zero authored gap, successful outgoing saves inside grace, healthy storage, <=200 ms request RTT, no staff pause, and no intentional preparation failure. Measure outside-profile cases separately. | Browser end-to-end measurements |

Invariants:

- INV-1: database time and persisted personal timeline own the working clock; preflight owns no clock.
- INV-2: preserve the 3-second server-arrival cutoff; no automatic relabeling of rejected late work as scored answers.
- INV-3: a candidate has at most one working section at a time. An outgoing completed timeline may remain save-writable during its existing grace, but the new V2 activation must not precede that grace's end.
- INV-4: duplicate activation returns identical stored times. Late or out-of-order responses cannot move the UI backward or cross attempt/recovery identities.
- INV-5: pause/termination/recovery serialization keeps the established lock order. No extra schedule-wide lock or all-candidate readiness query is added to personal activation.
- INV-6: a local probe or client boolean is a readiness declaration, never authorization to access or write a section.
- INV-7: enabling/disabling rollout does not reinterpret already-running schedules.

## 3. State owners and lifecycle

| State | Owner / source of truth | Mutation rule |
| --- | --- | --- |
| Room release, pause, completion, authored gap | Existing runtime/section database rows | Existing proctor/reconciler transactions |
| Candidate section preparing/active/completed/unable | `ielts_attempt_section_timelines` | Existing readiness, control, recovery, and expiry paths; unique `(attempt_id, section_key)` |
| Answer intent, ordering, acknowledgements, retained evidence | Existing V2 durability engine and server response records | Existing write identities, lease/control epochs, and writability checks |
| Local preflight result | New small hook; ephemeral | Key by attempt, published version, successor section, and current control/recovery context; invalidate on context change |
| Outgoing flush result | Existing submission orchestrator | Key by outgoing section and current attempt/control context; never reuse another section's result |
| Transition presentation | Derived in `StudentApp` from those owners | Do not store a second authoritative timer or a persistent transition record |

Proposed frontend derived phases:

| Phase | Guard / next event | Result |
| --- | --- | --- |
| Active | <=15 seconds remain | Prepare successor without changing current module or sending activation |
| Saving | Authoritative expiry | Freeze inputs, commit drafts, flush; continue local preparation |
| Waiting | Barrier succeeds, but eligibility/release/gap not satisfied | Show waiting state and use coalesced boundary refresh |
| Preparing | Eligible and barrier succeeded | Mount next workspace in blocked state, validate painted DOM/storage/audio |
| Starting | Ready request in flight | One request; do not create a client clock |
| Active next | Authoritative response/snapshot confirms activation | Render next section against returned server deadline |
| Attention | Barrier terminal failure, fenced identity, or unable | Preserve evidence, show existing recovery/staff action; do not claim saved |

These are presentation phases, not new database states. Preserve the existing four-state timeline schema.

## 4. Exact function-level design

### 4.1 Server eligibility and projection

Edit existing `readyIELTSPersonalSectionInTx` in `backend/go/internal/runtime/ielts_personal.go` and `projectIELTSPersonalRuntime` in `backend/go/cmd/api/student_context.go`.

For V2 subsequent sections, compute:

`eligibleAt = max(previousPersonalDeadline + ResponseSaveGrace + previousAuthoredGap, roomSectionRelease)`

No room release means not eligible. First section retains its existing room-release behavior. Preserve historical V1 semantics explicitly rather than silently applying V2 policy to it.

Proposed new pure helper in `backend/go/internal/runtime/ielts_transition_policy.go`:

```go
func IELTSNextSectionEligibleAt(
    previousDeadline time.Time,
    gapMinutes int,
    roomRelease *time.Time,
) (time.Time, bool)
```

Inputs must already pass existing timing validation. Return `(zero, false)` when no room release exists. This helper owns the V2 time arithmetic only; it takes no locks, writes no rows, and performs no authorization. Both mutation and projection call it so displayed expectations and activation permission agree. Do not make the frontend reproduce this formula.

Projection currently reads personal start/expected fields but must additionally read the room section's `actual_start_at` as a separate field to compute V2 eligibility. Do not confuse the personal start with room release. If release is unknown, do not advertise a speculative `nextSectionStartAt` as permission to start.

Retain the existing transaction/locking order in readiness: shared schedule boundary, authenticated attempt lock, shared runtime control lock, existing timeline row lock. Re-read authoritative state on every retry. Reuse the existing direct-active insert and persisted-time readback when all guards pass. Every competing mutation must still acquire the existing compatible locks.

For an existing preparing row, use the authoritative eligible time consistently for preparation expiry; do not expire preparation while the room has not yet released the section. Test pause/resume and delayed room release against stored expectations. If adjustment is necessary, update only preparing rows under the same transaction, never active start/deadline values.

Keep the existing `/ready` request shape and `CohortReadiness` response. Reuse `ExpectedStartAt`, `PreparationEndsAt`, `Status`, and `ServerNow`; no new endpoint or schema is required. Extend the hook's existing local `Readiness` TypeScript interface to describe these already-supported optional JSON fields. Continue returning typed existing bad-request/conflict/not-found errors. A valid request waiting for release/grace is `preparing`, not a transport failure.

The client save barrier remains an official-client sequencing rule, not proof supplied to the server. The server independently enforces time, ownership, identity, and section write permissions. No client-supplied `saved=true` may bypass these checks.

### 4.2 Make the existing answer barrier decisive

In `src/components/student/providers/StudentAttemptProvider.tsx`, strengthen existing `flushPending(): Promise<boolean>` at the current success point:

1. Retain acceptance wait, recovery wait, identity-generation checks, one-engine single-flight flush, and final identity check.
2. After `await engine.flush()`, call existing `engine.assertBoundarySettled()` before returning success. Pending count alone excludes blocked/quarantined work and is insufficient for a transition barrier.
3. Preserve the existing exception-to-blocked handling in `runStudentSubmissionBarrier`; no caller may treat an assertion failure as success. Exercise ordinary background flush callers as regressions because the same function is shared.

Reuse `createStudentSubmissionCommands().flushBarrier()` and existing draft commit methods. Do not create another outbox, answer cache, sequence owner, or flush implementation. Do not change final submission semantics.

In `useStudentSubmissionOrchestration.ts`, expose an additive result describing which outgoing section's barrier has completed, or a narrowly scoped callback with the same data. Proposed return field:

```ts
boundarySave: {
  sectionKey: ModuleType;
  status: 'saving' | 'saved' | 'attention';
} | null
```

Bind this result to the current attempt/context inside the existing orchestrator; reset on attempt/control/recovery changes. It is evidence from this client execution only, not durable server state. Repeated boundary triggers share the existing canonical fingerprint. Do not dispatch `submitModule` twice.

### 4.3 Local preparation

Proposed new `src/features/student/hooks/useIeltsSectionPreparation.ts` owns one successor's preparation. Extract existing section-content validation from `StudentApp.tsx` into proposed `src/features/student/application/ieltsSectionPreparation.ts`, and reuse it at both preflight and final readiness.

Proposed helper contract:

```ts
isIeltsSectionContentAvailable(state: ExamState, sectionKey: ModuleType): boolean
```

The existing implementation is the initial body; preserve its checks. The hook receives attempt identity, published-version identity, successor section, eligibility to preflight, and already-authorized content. It returns pending/ready/failed local preparation state and a retry trigger. Start once when remaining time enters the 15-second window; if late mounting skips that window, start immediately at transition.

Move/reuse `verifyAnswerStorage` rather than duplicating the IndexedDB write/read/delete probe. Cache success only for the current context; invalidate on storage error, identity/version/control/recovery change, and page lifecycle recovery. Final readiness must still verify the current mounted surface; a previous in-memory validation does not prove a later render succeeded.

Use the existing static snapshot loaded by `useStudentSessionRouteData`; do not refetch the whole exam for every transition. Preflight must never call `/ready`, change current module, render focusable future inputs, play audio, or start a timer. Prefetch media only if the current delivery authorization already permits it; otherwise defer that resource. Limit work to one successor, cancel listeners on cleanup, and stop speculative work if the foreground save path is failing.

### 4.4 One readiness retry owner

Edit `src/features/student/hooks/useIeltsCohortReadiness.ts` and its call in `StudentApp.tsx`.

Add backward-compatible optional hook inputs for the V2 path: activation permission and local preparation result. Existing legacy cohort callers retain their current handshake unless explicitly enabled for the new local retry behavior.

- V2 `activationAllowed` requires the matching outgoing barrier to be saved, or first-section entry with no outgoing section. Reload must rerun the existing durability barrier after recovery; do not infer success from an absent ephemeral flag.
- Keep two animation frames before final DOM readiness declaration. Verify `#main-content`, exam shell, section content, durable store, and listening readiness as appropriate. Do not assume a DOM shell means the desired section has mounted.
- At most one `/ready` request in flight. Coalesce readiness, online, visibility, and runtime-change triggers; a queued trigger causes one follow-up after the current request completes.
- Healthy pending responses retry at approximately 1 second with bounded jitter, not 1/2/4/8-second exponential waits. If `ExpectedStartAt` is in the future, schedule against server-adjusted time and retain a bounded fallback because pause/release may change it.
- Transient transport failures use bounded 1/2/4/8-second backoff; successful responses reset failure count. Terminal auth/device/attempt errors stop the loop and use existing recovery handling. Do not classify every HTTP conflict as retryable without inspecting its existing reason/code.
- A content/audio/storage readiness change prompts a coalesced immediate retry. Remove listeners and invalidate responses on cleanup/context change.
- `unable` stops; `completed` refreshes; `startedAt` refreshes authoritative state. Do not stop permanently if the post-start refresh fails or resolves without applying the expected active timeline. Continue read-only recovery until confirmed; duplicate `/ready` remains idempotent.

### 4.5 Coordinate expiry refresh and presentation

`StudentApp.tsx` currently has a separate 500 ms → 8 second personal-boundary refresh loop. Replace that ownership with a single coalesced boundary-refresh driver in the existing route refresh/coordinator path (`useStudentSessionRouteData.ts`). Reuse its existing refresh implementation and request deduplication; do not add a second live channel.

Proposed additive refresh reason: `ielts_section_boundary`. While a V2 transition is unresolved, perform an immediate authoritative refresh on expiry, room notification, reconnect, or successful activation; permit one in-flight refresh and one queued follow-up. Keep a 1-second boundary fallback when healthy. On errors, back off and retain the connection recovery surface. Exit boundary mode as soon as authoritative activation/terminal state is applied; steady polling resumes its existing policy.

Wire the barrier result to readiness permission. If server projection moves to the successor while saving is pending, preparation may continue but inputs and activation stay blocked. Use one existing transition surface: saving while unsaved work remains, preparing/waiting afterward, and attention on a non-retryable barrier failure. Preserve accessible status announcements and move focus once after successful section activation, not on each poll.

### 4.6 Worker scheduling: isolate section reconciliation

Edit existing `backend/go/internal/background/runner.go`, `idle.go`, and config tests. Extract the section-reconciliation block from `runHotCycle` into proposed `runSectionReconcileCycle(ctx) error`. It reads database UTC time, calls existing `ReconcileExpiredSections`, and records duration/errors.

Run that cycle in one independent, sequential loop managed by `Runner.run`, using existing `RuntimeAutoAdvanceTickMs` (1,000 ms in the supplied environment). Perform an initial sweep on activation. Clamp invalid/nonpositive values to the existing 1,000 ms default and prevent sub-250 ms scheduling; test the chosen clamp. No overlapping goroutines or catch-up storm after a slow sweep. Preserve bounded work contexts and lifecycle join behavior.

Remove section reconciliation from normal hot cycles to avoid duplicate periodic scans. Explicitly call the extracted cycle from `Drain` before pending-work checks so removing it from hot work does not weaken shutdown/parking correctness. Do not alter `RuntimeAutoAdvanceEnabled` semantics in this change: that field also appears unused today; authored `autoSubmit` remains the existing business-policy gate. Document the discrepancy rather than introducing a second accidental policy switch.

This prevents outbox/maintenance duration from postponing section checks. Outbox delivery can still lag: preserve durable wakeups, and let boundary refresh recover current state without waiting for notification delivery. Keep `WORKER_FALLBACK_INTERVAL_SECS=2` for other hot work. Preserve timeout-only CLI behavior and activity-driven idle behavior; no recurring jobs when the lifecycle is parked.

## 5. Algorithms and transaction boundaries

```text
Browser, V2 automatic expiry:
  identify outgoing section and successor from existing enabled-section order
  when remaining <= 15s: prepare authorized successor resources locally
  at zero:
    freeze outgoing editing via existing runtime blocking
    start existing flushBarrier (deduplicated)
    continue preparation in parallel
    refresh authoritative state through the single boundary refresh owner
  if barrier blocked/fails:
    retain drafts; retry transient failures using existing policy
    on persistent/fenced failure show attention; do not activate successor
  after barrier success and server eligibility:
    mount successor in blocked workspace
    validate current surface and readiness
    send existing ready request
    apply/refetch authoritative active timeline, then unlock

Server, V2 readiness transaction:
  establish authenticated attempt and current device identity
  acquire existing locks in existing order
  reject terminal/controlled-end/recovery-invalid state as today
  if section already active: return its persisted timeline
  if earlier section still working / room unreleased / paused:
    return preparing, without assigning a working clock
  calculate authoritative eligibleAt with shared helper
  if now < eligibleAt: return preparing and ExpectedStartAt
  enforce existing preparation expiry and all readiness signals
  insert active timeline once or conditionally activate preparing timeline
  read stored started_at and deadline_at; preserve existing audit/invalidation
  commit; return stored result
```

The server does not call the browser flush endpoint or trust a preflight token. The client does not write server deadlines. Keep all existing row changes and necessary audit/outbox work in their owning transactions. Notification delivery is after commit and cannot be the correctness gate.

## 6. Implementation sequence and completion gates

1. **Baseline and metrics.** Inspect the affected production timing model read-only when access is available. Use existing `src/utils/studentObservability.ts` events to record expiry, barrier completion/failure, first readiness request, activation observed, and first usable frame. Correlate with server reconcile duration and timeline times. Add low-cardinality phase/reason metrics only; no answers, tokens, or question text. Verify where custom browser metric events are actually collected before relying on them for production p95; if no collector is wired, export them in the test harness first and add a minimal existing observability integration for rollout. Gate: a baseline trace separates saving, release, readiness, and delivery.
2. **Durability barrier.** Strengthen provider success with existing engine assertion; add blocked/quarantined/identity-switch tests. Gate: an empty send queue cannot incorrectly prove a successful save.
3. **Server timing contract.** Add the shared V2 helper, readiness guards, and matching projection; keep old models unchanged. Extend existing personal readiness, projection/API MySQL, and grace tests. Gate: early/duplicate/paused/recovered operations cannot allocate an incorrect clock.
4. **Preparation.** Extract content/probe reuse and add one local hook. Add fake-timer/lifecycle tests. Gate: preflight sends no activation request, does not mutate current module, and performs no newly unauthorized download.
5. **Orchestration/UI.** Expose barrier status, wire activation permission, separate successful pending retry cadence from failure backoff, and consolidate boundary refresh. Gate: healthy transition cannot be delayed by the old 8-second pending backoff; failure is explicit and drafts survive.
6. **Worker isolation.** Extract and independently schedule section reconciliation; update drain/config/lifecycle tests. Gate: a blocked outbox cycle cannot stall section reconciliation and parking still joins all jobs.
7. **Connected verification and rollout.** Extend the existing IELTS browser scenario and add a real expiry measurement. Run isolated MySQL concurrency/recovery tests, then staged load. Gate: all invariants and latency criteria hold with recorded artifacts.

All proposed new files must be created in the named existing directories. Existing files above are inspected edit targets; suggested new function/type names are design proposals, not claims that those symbols already exist.

## 7. Worked traces

### Normal, zero authored gap

Initial: room uses V2, candidate A's reading deadline is `D`; candidate B is slow; writing has not been released. All identities are current.

1. `D-15s`: A validates already-delivered writing data and probes storage. No readiness mutation or writing start occurs.
2. `D`: A's reading input freezes; drafts commit and V2 flush begins. Writing preparation remains concurrent.
3. `D+0.2s` illustrative: final reading write is acknowledged. Barrier settles; no working clock starts yet.
4. `D+3s`: response grace ends. The room reconciler releases writing on its next sweep. B's readiness is irrelevant to A.
5. After release: A refreshes, mounts the blocked writing workspace, validates it, and calls `/ready` once.
6. Server transaction stores writing start `S` and deadline `S + fullWritingDuration`. Browser confirms the timeline and unlocks.

Final: reading answers remain attached to reading; writing starts once; assigned writing duration is intact; no waiting for B. Times in this trace are illustrative, not measured performance.

### Committed answer response lost; duplicate activation and pause

1. A's final answer commits during grace; its HTTP acknowledgement is lost. The engine retains the same write identity and retries/reconciles; the client does not declare saved merely because the network send completed.
2. Existing deduplication/recovery finds the committed response. The barrier becomes saved only when the engine's settled invariant succeeds. No command is relabeled to writing.
3. A sends writing readiness while staff pauses. Existing runtime/control locks determine one ordering: pause first means no activation; activation first means pause freezes that persisted timeline according to existing pause rules.
4. An activation response is lost. Retrying `/ready` returns the same stored times, never a fresh allocation. Refresh recovers state after reconnect.
5. Resume shifts the existing timeline according to the established pause policy; retry does not add extra working time.

If the final answer never reached the server before cutoff, preserve it as existing local/unscored evidence and show attention. Do not promise automatic scoring beyond the cutoff, erase it, or silently advance as if saved.

## 8. Verification matrix and commands

| Requirement / invariant | Tests and concrete assertions |
| --- | --- |
| FR-1, INV-6 | New preparation hook tests: one successor/context; no `/ready`, future input, audio playback, or added content permission; context cancellation and storage failure invalidate readiness. |
| FR-2/3, ERR-2 | Extend submission/orchestration and provider tests: deferred flush blocks activation; blocked/quarantined work with pending count zero still blocks; identity change discards old completion; failed barrier preserves drafts and shows attention. |
| FR-3, INV-1/2/3 | Extend `ielts_personal_ready_test.go` and new helper tests: just before/at grace, nonzero gap, early/late/unreleased room section, extra time, and previous deadline still in future. Projection expectation equals mutation eligibility. |
| FR-4, INV-4 | Existing persisted-time/read-only-retry tests plus real MySQL two-candidate scenario: A starts despite B's failure; exact configured duration; concurrent readiness creates one timeline/start/audit effect. |
| FR-5 | Extend readiness hook tests: repeated successful preparing responses stay bounded near 1 second; network failures back off; success resets; event storms yield one in-flight plus at most one queued follow-up; failed refresh remains recoverable. |
| ERR-1, INV-5 | MySQL barriers for readiness vs room pause, candidate pause, termination, and recovery takeover; wrong candidate/device cannot activate; paused preparation and unable behavior remain correct. |
| FR-6, INV-7 | Restart worker before due sweep; restart API after activation commit; replay request; drop/reorder notifications and snapshots; hidden/offline tab returns through authoritative refresh; no second start or clock reset; stored timing models retain their meaning across rollout. |
| Worker change | Extend `background` lifecycle/idle tests: slow outbox does not block reconcile, initial sweep, sequential job execution, invalid tick clamping, timeout-only compatibility, cancellation/join, final drain sweep, and no parked periodic work. |
| Legacy regression | Preserve `cohort_stage_v2`, `cohort_section_v3`, IELTS personal V1, SAT/ACT, final submission, authored autoSubmit=false, manual staff controls, and existing attempt continuity tests. |
| PERF-1 | Browser test measures actual expiry → usable next question. Use one intentionally delayed candidate; verify A latency and B fairness separately. Test Chromium and at least WebKit for storage/audio/lifecycle behavior. |

Existing frontend suites to extend:

- `src/features/student/hooks/__tests__/useIeltsCohortReadiness.test.tsx`
- `src/components/student/__tests__/useStudentSubmissionOrchestration.test.tsx`
- `src/features/student/application/exam-session/__tests__/submissionCommands.test.ts`
- `src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx`
- `src/shared/durability/__tests__/DurableResponseEngine.preservation.test.ts`

Existing backend/browser foundations:

- `backend/go/internal/runtime/ielts_personal_ready_test.go`
- `backend/go/internal/runtime/cohort_readiness_test.go`
- `backend/go/internal/proctor/reconcile_plan_test.go`
- `backend/go/internal/background/lifecycle_test.go`, `idle_test.go`, `sectionreconcile_fanout_test.go`
- `backend/go/cmd/api/ielts_statement_budget_mysql_test.go`, `ielts_rowfirst_equivalence_mysql_test.go`, `exam_continuity_mysql_test.go`
- `e2e/ielts-personal-timing.spec.ts`: already tests multi-candidate personal timing, but helpers directly open room sections; add a real automatic expiry/reconciler scenario so SQL fixture manipulation cannot masquerade as proof of transition latency.
- `k6/prod-section-transition-200.js`: existing load-script foundation, not proof of browser usability or automatic expiry; inspect its staff-triggered control flow before reusing metrics. Use an isolated staging adaptation for real expiry/readiness, never production fixtures by default.

Commands from repository root, proposed for implementation verification:

```sh
bunx vitest run src/features/student/hooks/__tests__/useIeltsCohortReadiness.test.tsx src/components/student/__tests__/useStudentSubmissionOrchestration.test.tsx src/features/student/application/exam-session/__tests__/submissionCommands.test.ts
bunx vitest run src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx src/shared/durability
bun run typecheck
bun run lint
bun run build
bunx playwright test e2e/ielts-personal-timing.spec.ts --project=chromium
```

Also run new preparation/provider suites and the WebKit-compatible portion of browser coverage. The current multi-candidate spec intentionally skips non-Chromium; add a separate cross-browser transition test instead of claiming existing coverage runs there. Playwright's existing configuration starts migration/API/worker/frontend services and requires its isolated backend fixture environment.

From `backend/go`:

```sh
go test ./internal/runtime ./internal/proctor ./internal/background ./internal/attempts ./internal/schedules
go test -race ./internal/runtime ./internal/proctor ./internal/background
go test ./cmd/api -run 'TestIELTS|TestExamContinuity' -count=1
```

Supply an isolated fully migrated `TEST_MYSQL_DSN` for database tests; skipped MySQL tests are missing evidence, not a pass. Use deterministic barriers or database-controlled timing for races; do not prove concurrency with arbitrary sleeps. Full protocol tests must validate existing write identities, recovery/control fencing, and actual persisted answers, not just mocked callbacks.

### Baseline checks actually executed during planning

- Frontend focused command above: **3 files / 16 tests passed**.
- `go test ./internal/proctor ./internal/runtime ./internal/background -run 'TestIELTS|TestCohortReadiness|TestCohortStartLead|TestLifecycle|TestTimeoutReconcileCycleUsesTheProvidedServerInstant' -count=1`: **all three packages passed**.
- No new implementation tests, production traces, MySQL concurrency tests, browser runs, or load tests were executed. Baseline success does not validate this proposed design.

### Implementation verification (2026-10-30)

- `bun run typecheck`: passed.
- `bun run test:run`: 853 files passed; 7,409 tests passed, 2 skipped.
- `bun run build`: passed.
- `bun run lint`: passed with 0 errors and 1,012 existing warnings.
- `go test ./internal/runtime ./internal/proctor ./internal/background ./internal/attempts ./internal/schedules`: passed.
- `go test -race ./internal/runtime ./internal/proctor ./internal/background`: passed.
- `TEST_MYSQL_DSN=... go test ./cmd/api -run 'TestIELTSFastTransition' -count=1 -v`: both eligibility/projection and concurrent-readiness tests passed on isolated local MySQL.
- `e2e/ielts-fast-transitions.spec.ts`: fresh-seed Chromium and WebKit runs passed. The 5-second assertion uses expiry-to-first-usable-frame; Playwright's later polling observation is intentionally not the timing endpoint.
- Local readiness load: 200 candidates, 0 failures, `/ready` p95 232 ms. This is not the staged load run.
- No production baseline trace or staging load was available in this environment.

## 9. Rollout, limitations, and extension boundary

Deploy compatible server guards/projections first, then the client. Initially enable the preparation/coordinator path only for V2 in staging; use one proposed client build flag `VITE_IELTS_FAST_TRANSITIONS` defaulting off for rollout, with validated environment typing. This is a build-time switch requiring redeployment, not a remotely mutable emergency toggle. Gate performance behavior only; never use the flag to bypass server timing or answer protection.

After staging verification, enable `IELTS_PERSONAL_TIMING=true` for newly created pilot IELTS rooms and verify their persisted choice. Do not mass-update existing schedules or runtime rows. Increase pilot size only after actual p95, save refusals, retained-evidence counts, refresh/readiness request volume, and database pool/lock waits are reviewed.

With a 1-second healthy readiness cadence, unresolved candidates add roughly `N` readiness requests/second plus boundary refresh traffic; single-flight coordination bounds concurrency per tab but not the room's aggregate burst. Compare statement counts and DB pool waits against existing IELTS statement-budget/throughput tests. Do not infer capacity from the 5-second target. Spread fallback timers with small jitter, stop promptly on activation, and retain error backoff.

Rollback triggers: acknowledged response mismatch/loss, duplicate or shortened timeline, unauthorized section access, broken pause/recovery behavior, or materially worse tail latency/DB contention. Disable the fast client build path or revert its deployment; disable *new-room* V2 selection if necessary. Continue honoring stored V2 models and current schema for rooms already running. Do not roll back to a binary unable to read their timing model, and do not convert their model in flight.

Keep grace at 3 seconds and fallback at 2 seconds initially. Wire the existing 1,000 ms runtime tick to the independent reconciler only after baseline tests are in place. A fully deadline-scheduled system is deferred: the isolated periodic reconciler plus immediate boundary refresh is simpler and keeps database recovery intact. Reconsider deadline scheduling only if measured sweep cost or scheduling lag misses the target.

No new schema is planned. Do not edit historical migrations. If implementation reveals a genuinely missing server fence, specify and test an additive contract/migration before proceeding rather than embedding a browser-only authorization workaround.

One realistic extension: if an additional readiness check becomes necessary, add its local predicate at the preparation/readiness boundary and its server eligibility guard only if it represents a trusted enforceable rule; the durability engine and room scheduler should remain unchanged. A future requirement for zero elapsed time before the browser acknowledges a start would require a separately designed, bounded start-confirmation protocol. It is not supplied by retries and is not part of this latency improvement.
