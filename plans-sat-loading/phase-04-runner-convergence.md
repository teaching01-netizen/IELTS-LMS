# Phase 04 — Runner convergence + calm polling (PLAN ONLY)

> Stage: PLAN ONLY — do NOT edit source code, do NOT implement.
> Depends on: Phase 02 (bootstrap shape) + Phase 03 (host scoping).
> Fixes overall-plan R3 (split truth / forced Refreshing), R4 (polling churn), R5 (identity bug).
> Scope: SAT student exam-mode only. No timing semantics change, no persistence engine change, no payload change.

Inspected (real paths + lines):
- controller `src/features/student-delivery/hooks/useSatExamController.ts` (1052 lines, full read)
- reducer `src/features/student-delivery/application/satRunnerReducer.ts` (248 lines, full read)
- selectors `src/features/student-delivery/application/satRuntimeSelectors.ts` (98 lines, full read)
- timing `src/features/student-delivery/domain/satTiming.ts` (123 lines, full read)
- route `src/features/student-delivery/routes/SatStudentSessionRoute.tsx` (502 lines; gates at :107-122, :123-131, :199-251, :253-264, :265-306, :307-319)
- contracts/gateway/tests: contracts/assessmentDelivery.ts, infrastructure/satDeliveryGateway.ts (thin alias over assessmentDeliveryApi),
  api/assessmentDeliveryApi.ts:179-192 (bootstrap + If-None-Match), bootstrapEtag.ts, __tests__/bootstrapEtag.test.ts,
  application/__tests__/satRunnerReducer.test.ts, domain/satTiming.test.ts,
  hooks/__tests__/useSatExamController.identity.test.tsx, hooks/__tests__/sat-finalization-recovery.test.tsx,
  hooks/__tests__/sat-cohort-clock.test.tsx

## 1. Objective

Eliminate the split-truth loading flashes on the SAT student path without touching clock semantics:

1. Atomic data+phase commits. Data (useState bootstrap|null at controller :73)
   and state (useReducer satRunnerReducer at :69-72) must advance in the same React batch wherever the
   next phase is computable from the just-received payload. No committed frame may pair a new payload with an
   old phase (or vice versa) when the transition was knowable synchronously.
2. Hold-previous-UI on transient skew. The route gate at SatStudentSessionRoute.tsx:307-319 must not swap
   valid exam UI for a full-screen spinner (Refreshing SAT module at :317-318) or the
   SAT state unavailable error (:307-316) on a one-frame data/state mismatch when a previous valid frame exists.
   Polling must patch in place, never replace valid UI with a spinner.
3. Calm polling. Identical polls must be no-ops: no setData(newObj), no setSnapshotReceivedAt(Date.now()),
   no clock recompute, no backoff reset. Fix the poll-effect dep that tears down the cadence on every phase change.
4. Trustworthy identity. Fix createSatRunnerState(scheduleId, attemptId) to pass candidateId
   at the two call sites (:69-72 initializer, :105 reset), incl. the reset path.

Non-goals / hard constraints (from overall plan):
- No timing semantics change: mergeAuthoritativeTiming (satTiming.ts:7-23), personalModuleRemainingSeconds
  (:52-70), snapshotRemainingSeconds (:25-34), breakRemainingSeconds (:72-88), timingForAttempt (:90-103),
  useAuthoritativeDeadlineClock inputs, deadlines, runtimeRevision ordering — untouched. A new pure equality
  helper is allowed; clock math is not.
- No persistence engine change: useSatResponsePersistence (hydrate/flush/save/submit/lease) untouched;
  hydrateBootstrap(payload) (:164) stays a post-commit sync call, never a phase driver.
- No payload change: AssessmentDeliveryBootstrap (contracts/assessmentDelivery.ts:65-80) and gateway signatures
  (application/ports/SatDeliveryGateway.ts) untouched. ETag/304 handling stays additive.
- No submitting visual/copy unification (Phase 05 owns SatStudentSessionRoute.tsx:265-306 language).
- No host/prewarm moves (Phase 03 owns withCalculatorHost + calculatorWarmModule at route :133-197).

## 2. Dependencies — what Phase 04 assumes from Phase 02 + Phase 03

Phase 04 must land after 02 and 03 (never parallel — same controller/route truth). It assumes only the seams below;
if 02/03 land with different prop names, Phase 04 adapts at the seam without changing its contracts.

### Assumes from Phase 02 (bootstrap waterfall)

- Parent (student/routes/StudentSessionRoute) no longer shows the admin skeleton for providerKey=sat past auth,
  and exposes a seed (likely attemptSnapshot/runtimeSnapshot or an explicit initialBootstrapSeed) to
  SatStudentSessionRoute to useSatExamController.
- Child bootstrap effect (controller :189-207) accepts that seed and dedupes the 3rd fetch (seed path vs
  satDeliveryGateway.bootstrap(scheduleId, attemptId) path), but keeps the commit seam intact:
  - applyPayload(payload): boolean (or its Phase-02 successor, e.g. commitBootstrap) still returns
    false for stale identity / revision regression and true when accepted.
  - refresh(surfaceError, ifNoneMatch?) (:170-187) keeps its signature and its 304-is-null rule
    (hasBackendStatusCode(loadError, 304) returns null, :176-177).
- Phase 04 therefore builds its commit layer above whatever fetch source Phase 02 provides: both the seed path
  and the gateway path must funnel through the same atomic commitPayloadAndRoute (Step 2 below). If Phase 02 has not
  landed, Phase 04 still applies verbatim to the gateway path; the seed branch is then a no-op passthrough.
- Phase 04 does NOT own: parent skeleton gating, useStudentSessionRouteData seed exposure,
  assessmentDeliveryApi fetch internals. It only reads them.

### Assumes from Phase 03 (tool prewarm gating)

- Route :133-197 host computation (currentCalculatorModule / pendingCalculatorModule / fallbackCalculatorModule to
  calculatorWarmModule / calculatorModuleAttemptId / calculatorHost) and withCalculatorHost (:177-197) are owned
  by Phase 03. Phase 03 guarantees: loading/error branches render bare (no hidden Desmos iframes, no competing
  role=status); exam-chrome branches keep the scoped host.
- Phase 04 therefore:
  - touches the route gate only at :307-319 (hold-previous-UI), never the host computation or the
    withCalculatorHost definition;
  - requires its skew fallback (Refreshing SAT module) to render bare per the Phase 01/03 single-surface
    contract (no host wrapper) — or, if Phase 03 mandates host-on-loading, to follow Phase 03 final rule explicitly;
  - requires a held previous frame to keep its own already-mounted host (do not remount/unmount the calculator on skew).

### Assumes from Phase 01 (loading contract)

- SatLoadingKind: initial | module-refresh | finalizing + single-surface rule + silenced hidden Desmos live regions
  already exist. Phase 04 fallback spinner uses the contract module-refresh kind/label and emits no new live region.

## 3. Affected / new files

| File | Change | Ownership note |
|---|---|---|
| src/features/student-delivery/hooks/useSatExamController.ts | PRIMARY. Identity fix (2 lines); new commit + equality layer; poll-loop dep fix; atomic transitions in bootstrap / poll-reconcile / startPendingModule / submitModule / terminal recovery / finalizeAssessment path; stable snapshotReceivedAt; expose skew-hold affordance values | Do not change timing math, persistence wiring, gateway calls |
| src/features/student-delivery/application/satRunnerReducer.ts | Identity fix companion (no signature change) + recover migration note/assertion; no transition-semantics change | createSatRunnerState(scheduleId, candidateId) stays; :59-61 unchanged |
| src/features/student-delivery/routes/SatStudentSessionRoute.tsx | Gate-only change at :307-319: hold-previous-UI with bounded fallback; everything before :307 and host computation untouched | Do not move withCalculatorHost; do not touch submitting branch :265-306 |
| src/features/student-delivery/application/satBootstrapEquality.ts | NEW. Pure payload-equality helper (isEquivalentBootstrap(prev, next)); no clock logic | Preferred over editing satTiming.ts (keeps timing file semantics-frozen) |
| src/features/student-delivery/application/satRuntimeSelectors.ts | READ-ONLY. Reuse moduleForAttempt / findActiveAttempt / findPendingAttempt / findAttemptForModule / sectionForModule / matchesFinalModuleState; no edits expected | If a selector gap is found, add a pure selector here + unit test, no behavior change |
| src/features/student-delivery/domain/satTiming.ts | READ-ONLY (frozen). mergeAuthoritativeTiming stays the revision guard; Phase 04 only calls it | No edits |
| Tests (extend + new files) | Extend application/__tests__/satRunnerReducer.test.ts; new hooks/__tests__/useSatExamController.convergence.test.tsx; keep identity, finalization-recovery, cohort-clock, timing, bootstrapEtag suites green | See Section 8 |

## 4. Contracts / interfaces

### C1 — Atomic data+phase update rule

> Whenever the next runner phase is computable from the just-accepted payload and the pre-commit state,
> setData and dispatch must occur in the same synchronous tick (same handler, auto-batched), computed from
> the payload argument (never from stale data state after an await).

Concretely:
- Introduce one commit entry point in the controller (name TBD by implementer, e.g. commitPayloadAndRoute).
  It takes (payload, hint, preState) where hint is one of bootstrap | poll | startModule | submitModule | terminal
  and preState is the state snapshot at commit time (via ref — see Step 2). It returns accepted/changed/dispatched.
- Internals in order: (1) identity guard (payload.scheduleId/attempt.id vs props + generation — existing :139-145);
  (2) revision guard (incoming runtimeRevision < current rejects — existing :146-156, keep);
  (3) NEW equality short-circuit (C3) returning no-change without touching snapshotReceivedAt;
  (4) setData(merged) + setResult/setError/hydrateBootstrap as today (:161-164);
  (5) compute at most one phase action from (preState, payload, hint) and dispatch it synchronously.
  Steps 4-5 run back-to-back in the same tick so React 18+ batches them into one render — no intermediate
  new-data/old-phase frame from this commit.
- All post-await call sites funnel through it: bootstrap effect (:189-207), poll tick (:244-267),
  startPendingModule (:461-483), submitModule (:639-728), terminal-result effect (:374-389), submit-error
  recovery path (:679-712), retryFinalization rescue (:749-771). Effects that today do
  applyPayload in one effect and dispatch in a separate effect (:357-362 directions auto-route,
  :899-909 finalized-module guard) become idempotent reconcilers: they may still exist as safety nets for
  externally-driven data changes (e.g. Phase-02 seed swap), but the primary path no longer needs them, so the
  skew window collapses to zero on the paths Phase 04 controls. Reconcilers must be pure functions of
  (data, state) and dispatch at most one action per (dataVersion, phase, moduleKey) key (guard with a ref to
  avoid double-dispatch under StrictMode double-effects).
- hydrateModuleResponses(payload, module) (:298-335) runs after the routeToModule dispatch in the same tick
  (same as startModuleFrom :337-354 does today), batching per-response hydrateResponse dispatches with the route
  dispatch. Its revision guard (currentRev >= response.revision skips, :312-316) is kept.
- What is deliberately NOT atomic: user-answer dispatches (setAnswer/toggleReview/etc :919-977) — local-only,
  never pair with setData. Persistence callbacks (hydrateBootstrap, visible-drafts effect :797-835) stay
  post-commit syncs, never phase drivers.

### C2 — Hold-previous-UI rule for transient skew

> While stateModule is unresolvable but a previous valid exam frame exists, keep rendering the previous frame
> (plus an optional inline non-modal affordance). Full-screen surfaces are bounded fallbacks only.

Definitions:
- Resolvable = existing memos at :773-790 succeed: state.phase in module/review AND
  stateModule = sections.flatMap(modules).find(moduleKey === state.moduleKey) non-null AND
  stateModuleAttempt = findAttemptForModule(data, stateModule.id) defined AND
  stateSection = sectionForModule(data, stateModule.id) non-null. (Note the memos key modules by
  moduleKey (:778) while attempts key by id — skew arises when a new payload renames/rebases either side
  one tick before the phase catches up.)
- Previous valid frame = a ref (e.g. lastValidFrameRef) holding the last render
  (phase, moduleKey, questionIndex, dataVersionId, timingRevision, renderedAt) for which the branch rendered
  module/review content (route :330+ / :400+). Updated only on successful module/review renders, cleared on identity
  change (:94-106), terminal phases (complete/terminated), and explicit exit.
- Rule (route :307-319 replacement):
  1. If state.phase in module/review but unresolvable AND lastValidFrameRef.current exists AND
     age below SKEW_HOLD_MS (proposed 1500ms; implementer validates against poll cadence :235-243 — must exceed one
     poll interval jitter window but stay well under the 60s almost-up banner :1019): render the held frame content
     (the same module/review branch the previous render produced — implement by early-returning the cached
     element or by rendering from held data+state refs; do NOT advance question index or clock
     from stale values — clocks keep reading from live exam.remainingSeconds where available, falling back to the
     held value only if live is 0-due-to-skew).
  2. Else if unresolvable AND (no held frame OR hold expired): render the bounded fallback
     SatLoadingSurface label Refreshing SAT module (bare, per Phase 01/03 contract — no calculator host
     unless Phase 03 final rule says otherwise). This preserves today :317-318 UX for genuine module resolution
     failures (e.g. payload truly lacks the module).
  3. SAT state unavailable (:307-316) becomes unreachable for transient skew: it renders only when
     state.phase is not module/review AND no earlier branch claimed the phase — i.e. phase === loading with
     data present (bootstrap committed data but bootstrapLoaded not yet dispatched — a less-than-one-frame window that
     C1 closes) or an invariant violation. It must never render while a held frame exists. Implementer adds a comment
     at the branch stating this invariant.
  4. Timers during hold: the held frame shows the last good countdown; the timeout auto-submit effect (Step 6) is
     explicitly disabled while unresolvable (no submit from a held frame).
- Why a ref, not state: holding must not itself trigger renders or reset clocks. The hold is a render-time fallback,
  not a state transition.

### C3 — Poll-skip rule (revision/ETag equality: no setData, no clock reset)

> A poll that carries no new information must leave all clock inputs untouched:
> data ref, snapshotReceivedAt, derived serverClockOffsetMs (:841-843), remainingSeconds (:852-859).

Layers (in order):
1. HTTP 304 — already correct: refresh catches 304 and returns null (:176-177), no setData. Keep. Note the
   current poll tick (:259-266) passes pollEtagRef.current as ifNoneMatch but never sets it from a real
   response header (it reads (payload as etag?: unknown).etag, which the typed bootstrap payload never carries —
   AssessmentDeliveryBootstrap has no etag field). Phase 04 does not fix the gateway; it documents this as a
   known dead-store and relies on layer 2 instead. (If Phase 02 wires createBootstrapCache into the controller,
   that cache 304-to-cached-payload path must also funnel through the layer-2 equality check — a 304-derived cached
   object is still a new ref and must not reset the clock.)
2. NEW — deep-equality short-circuit inside the commit path (before setData / setSnapshotReceivedAt):
   skip when ALL hold:
   - next.timing.runtimeRevision === current.timing.runtimeRevision, AND
   - next.versionId === current.versionId AND next.serverNow within clock-tolerance (proposed: skip clock-touch
     unless |Date.parse(next.serverNow) - Date.parse(current.serverNow)| > 1000ms — serverNow advances every poll
     and must not by itself defeat the skip; document the chosen threshold), AND
   - attempt slices equal: moduleAttempts same length with same (id, moduleId, state, revision, startedAt,
     pausedAt, remainingSeconds, deadlineAt, availableAt, completionReason) per entry, AND
   - responses revisions equal per examQuestionId (length + each (examQuestionId, revision)), AND
   - proctorStatus / proctorNote / scheduleRuntimeStatus / deviceFingerprintHash equal, AND
   - result id equal (both null or same id).
   Sections/modules/questions are version-immutable per bootstrap revision — excluded from comparison (besides
   versionId) to keep the check O(attempts + responses). Implement as pure isEquivalentBootstrap(prev, next)
   in the NEW satBootstrapEquality.ts with unit tests (see Section 8). On skip: return no-change from the commit
   (and surface as null from refresh-equivalent, exactly like 304), do not call setData, setSnapshotReceivedAt,
   setResult, hydrateBootstrap, and do not dispatch.
3. Stable snapshotReceivedAt: move setSnapshotReceivedAt(Date.now()) (:161) behind the skip — it fires only
   on accepted+changed payloads. Additionally, when only serverNow advanced but everything else is equal (layer-2
   near-miss), the implementer must still update data.serverNow WITHOUT touching snapshotReceivedAt (patch the
   field in place or preserve the old timestamp — detail the exact predicate; the goal is serverClockOffsetMs stability).
   If this in-place patch proves risky, the fallback is: accept the payload but preserve the old snapshotReceivedAt.
   Either way the invariant is: identical-or-clock-only polls never move snapshotReceivedAt.
4. No mergeAuthoritativeTiming-induced churn: mergeAuthoritativeTiming(current timing, payload.timing)
   (:157) returns a new object in most equal-revision cases (only the older-revision path returns current).
   The equality check in layer 2 runs before merge, so merge never sees an identical poll. Do not change merge itself.
5. Poll-effect dep fix (controller :274): remove state.phase from the poll loop dep array. The loop must be
   stable across phase transitions (otherwise every directions-to-module-to-review transition tears down the timer and
   resets the full-jitter backoff :235-243, causing a poll burst exactly when the UI is most skew-sensitive). Replace
   the state.phase complete early-return (:231) with a ref read (phaseRef.current complete, synced
   via a tiny effect or during commit) so the loop body stays mounted. Keep [liveSocketConnected, refresh] (+
   identity generation) as the only deps. The two auxiliary refresh triggers (:276-289 —
   runtimeSnapshot revision and attemptUpdateToken) are kept as-is; they already funnel through the skip,
   so duplicate triggers become cheap no-ops.

### C4 — candidateId fix

- satRunnerReducer.ts:59-61: createSatRunnerState(scheduleId: string, candidateId: string) — signature is
  CORRECT, unchanged.
- Controller :69-72: useReducer(satRunnerReducer, createSatRunnerState(scheduleId, attemptId)) must pass
  candidateId. Controller :105 (identity-reset effect): dispatch recover with
  createSatRunnerState(scheduleId, attemptId) must pass candidateId.
- Migration note: the recover branch (:166-177) migrates legacy snapshots lacking activeTools — orthogonal to
  identity; the fix must preserve it (fresh loading states carry no activeTools, so the branch is a passthrough
  for them; in-flight module/review states recovered via terminal paths at :379-388, :572-581, :687-696 already
  spread the correct candidateId prop — verify each still does after the fix).
- No stored wrong value survives reload: grep confirms only two createSatRunnerState call sites (controller :71,
  :105; tests use literal ids). The wrong candidateId lived only in memory (state.candidateId for fresh
  loading states, carried into newWorkingState via state.candidateId at :148-149). No persistence migration
  needed — document this finding so reviewers do not ask for one. The writer identity
  (configureSatDeliveryAttempt(scheduleId, attemptId, candidateId) at :112-118) already uses the correct prop
  and is unaffected.

## 5. Step-by-step implementation (ordered)

Implement in this order. Each step is independently reviewable; steps 1-2 are prerequisites for 3-6.

### Step 0 — Baseline + reproduction scaffolding (no prod change)

1. Run the green baseline with npx vitest run on satRunnerReducer.test.ts, satTiming.test.ts,
   useSatExamController.identity.test.tsx, sat-finalization-recovery.test.tsx, sat-cohort-clock.test.tsx — record pass state.
2. Add failing-first scaffolding for the new convergence suite (all mocked at the gateway/persistence seam, following
   the existing vi.mock gateway + vi.mock useSatResponsePersistence
   pattern from useSatExamController.identity.test.tsx:33-47): skew-hold render test, poll-skip test
   (assert data ref + snapshotReceivedAt-derived clock stable), timeout-during-skew test, identity test.
   Land these as failing tests first (TDD), then implement steps 1-6 to green them.

### Step 1 — Identity fix + migration note (R5)

Files: useSatExamController.ts (:69-72, :105), satRunnerReducer.ts (comment only).
1. :71 createSatRunnerState(scheduleId, attemptId) becomes createSatRunnerState(scheduleId, candidateId).
2. :105 same swap inside the identity-reset effect. Keep the dep array
   [attemptId, candidateId, identityKey, scheduleId] (:106) as-is (identityKey already folds all three).
3. In satRunnerReducer.ts above createSatRunnerState (:59), add a 3-line comment: candidateId is the route
   candidate prop, never the attempt id — see controller call sites. newWorkingState (:148-149) and terminal
   recover states propagate it; recover migration (:166-177) is orthogonal.
4. Verify: existing identity test file + new identity assertions (T1) pass; grep shows zero remaining
   createSatRunnerState(scheduleId, attemptId) in prod code.

### Step 2 — Commit layer: combined applyPayload+dispatch (R3 core)

File: useSatExamController.ts (:137-207, :357-362, :899-909).
1. Add a phaseRef (synced each render) and a dataRef (synced with data)
   so post-await commits compute the route decision from the pre-commit snapshot without adding state/data
   to callback deps (avoids the hydrateModuleResponses :334 [state] dep churn pattern spreading further).
2. Extract the existing :139-164 guards into a payload-accept helper (identity + revision guards unchanged), then implement
   commitPayloadAndRoute(payload, hint) per C1:
   - bootstrap hint: after accept, dispatch bootstrapLoaded with payload.versionId
     iff pre-state phase is loading (mirrors reducer guard :192), in the same tick as setData.
   - poll hint: after accept, run the lightweight reconciler: if payload carries result and pre-state is not
     complete, dispatch terminal recover (same shape as :379-388, using the payload versionId/result.id);
     else if the pre-state module attempt matchesFinalModuleState and a different pending module
     exists (same predicate as :900-908), dispatch showDirections; else dispatch nothing. Polling with no phase
     implication stays data-only — but now data-only and phase-correct in one tick.
   - startModule/submitModule/terminal hints: compute the target action from the payload argument (not from data
     state) and dispatch synchronously after setData (moves the decision earlier; see Step 6 for exact mappings).
3. Keep applyPayload as a thin wrapper or inline it — implementer choice, but all call sites in Steps 4-6 must call the combined function, never bare
   setData + later dispatch.
4. Demote the two split effects to safety-net reconcilers (keep, do not delete — they cover Phase-02 seed swaps and any
   gateway path that bypasses commit): :357-362 (directions-to-module auto-route) and :899-909 (finalized-to-directions).
   Add per-effect dedupe refs keyed on (versionId, runtimeRevision, phase, moduleKey) so StrictMode double-invoke
   cannot double-dispatch; each reconciler dispatches at most one action and only when its predicate holds on the
   current (data, state).
5. Add regression tests: bootstrap commits data+directions in one render (no intermediate SAT state unavailable);
   poll carrying a finalized module dispatches showDirections synchronously (T2).

### Step 3 — Transient-skew guard in the route gate (R3 surface)

File: SatStudentSessionRoute.tsx (:307-319 only).
1. Add lastValidFrameRef (+ optional held data/state refs or cached element) updated only on
   successful module (:400+) / review (:330+) renders; cleared on identity change (key the route content by
   scheduleId:attemptId:candidateId or reset in an effect on those props), on complete/terminated branches
   (:123-131), and on unmount.
2. Replace :307-319 with the C2 three-tier logic (hold, then bounded Refreshing fallback, then restricted
   SAT state unavailable). Hold window SKEW_HOLD_MS (default 1500ms, document tuning against poll cadence).
   The fallback keeps today label/copy (Refreshing SAT module) and renders bare (no withCalculatorHost)
   per Phase 01/03 unless Phase 03 final rule dictates otherwise — state the choice in a code comment citing the phase.
3. Restrict :307-316 (SAT state unavailable) with an explicit guard + comment: reachable only when no held frame
   exists (genuine invariant, not skew). Add a dev-only warn-or-observability emit on hitting it (follow
   existing emitStudentObservabilityMetric usage in the controller :561/:752 — route-side emit is optional; at
   minimum leave a comment so Phase 05 audit can find the branch).
4. Tests: skew-hold render test (T3) drives state=module + unresolvable payload for 1 frame (e.g. module list
   momentarily empty) and asserts previous question UI persists (no Refreshing, no SAT state unavailable);
   then asserts fallback appears only after hold expiry with no valid frame, and never while a held frame is fresh.

### Step 4 — Poll equality short-circuit + stable snapshotReceivedAt (R4 core)

Files: NEW satBootstrapEquality.ts; controller :137-168, :841-859 (read-only usage).
1. Implement isEquivalentBootstrap(prev, next): boolean per C3-layer-2 predicate (revision + versionId + serverNow-tolerance + attempt slices + response revisions +
   proctor/schedule/result ids). Pure, no imports from timing/persistence. Unit-test exhaustively (T4).
2. Wire into the commit path before setData: on equivalent return no-change
   (and surface as null from refresh-equivalent, mirroring the 304 path) with zero state writes. On near-miss
   (only serverNow advanced beyond tolerance — decide per implementer: either full accept with preserved
   snapshotReceivedAt, or in-place serverNow patch), never advance snapshotReceivedAt for clock-only movement.
3. Move setSnapshotReceivedAt(Date.now()) (:161) strictly behind the change gate. Document that
   serverClockOffsetMs (:841-843) and both countdowns (:849-859) therefore hold still across identical polls.
4. Leave mergeAuthoritativeTiming untouched; the skip runs before it. Leave the 304 catch (:176-177) untouched.
   Document the dead-store finding (pollEtagRef reads .etag off a payload type that has none, :262-263) in a
   code comment — do NOT rewire the gateway in this phase (Phase 02 owns fetch/ETag plumbing).
5. Tests: identical-poll no-op test asserting data referential stability (or at least snapshotReceivedAt-derived
   remainingSeconds stability) across 3 consecutive identical refresh(false) resolutions; 304 test asserting
   null + no clock touch (T5).

### Step 5 — Effect-dep fix for the poll loop (R4 cadence)

File: useSatExamController.ts (:224-289).
1. Remove state.phase from the poll effect deps (:274 becomes [liveSocketConnected, refresh] + identity generation via
   refresh closure over renderIdentityGeneration). Replace the :231
   if (state.phase complete) return with if (phaseRef.current complete) return (+ re-check inside
   tick before each refresh(false) so an in-flight cadence stops promptly after terminal commit without
   remounting the loop).
2. Keep backoff/jitter/offline semantics (:235-257) byte-for-byte; keep pollFailuresRef reset discipline
   (success to 0, failure +1). Keep ETag pass-through (:259) as-is (dead-store documented, not fixed here).
3. Keep the auxiliary triggers (:276-289) unchanged — they now hit the equality short-circuit and become cheap.
4. Test: phase-change-does-not-reset-poll-cadence (T6) — advance directions-to-module-to-review and assert the poll
   timer was not torn down (e.g. bootstrap call count follows wall-clock cadence, not phase count) and no spinner
   appears on poll.

### Step 6 — submitModule / startPendingModule / terminal-path atomicity (R3 tails)

Files: useSatExamController.ts (:337-354, :374-389, :461-483, :555-600, :639-728, :749-771).
1. startPendingModule (:461-483): replace applyPayload(payload) + startModuleFrom(payload) with one
   commitPayloadAndRoute(payload, startModule+moduleId) that sets data and dispatches routeToModule
   (+ hydrates responses) in the same tick. Error path (:474-479) unchanged (generation-guarded setError).
2. submitModule (:639-728): compute the post-submit decision from the next payload argument (already done for
   nextAttempt/nextModule at :657-658 — keep that, but move the dispatch into the same tick as the data commit):
   - no pending module: dispatch submit then finalizeAssessment (existing :660-665, now atomic with data);
   - section change: startBreak (:671-675); else: showDirections (:677). All three dispatch synchronously with
     setData(next).
   - Submit-error recovery (:679-712): the refresh(false) rescue + recover-to-complete (:687-696) or
     showDirections (:709) likewise commits atomically; the final setError (:713) stays generation-guarded.
   - Keep isSubmitting bracketing (:645/715) and calculator-workspace clearing (:652-656, :704-708) order; keep
     finalizationInFlightRef singleflight (:557-558) and stable submissionId=attemptId (:567-569).
3. Terminal-result effect (:374-389) and directions-terminal recovery (:602-637, :730-743): route through the same commit
   (payload with result + all attempts final recovers to complete); keep the recovery-key dedupe
   (finalizationRecoveryKeyRef :622/:637, defect-2 release on failure :630) and retryFinalization (:749-771)
   idempotence (state.phase in submitting-or-recovery + singleflight, rescue-via-refresh :763).
4. Timeout auto-submit effect (:880-897) hardening (no semantics change): add an explicit resolvability guard —
   if stateModule or stateModuleAttempt missing (skew), return without submitting and without clearing
   timeoutSubmissionKeyRef (today :888-893 clears the key when remainingSeconds > 0 but returns early on missing
   module — preserve exactly that, and add a comment that skew frames must not consume the key). The key stays
   moduleId:attemptId-scoped (:888) so a resolved frame with remainingSeconds === 0 still submits exactly once.
5. hydrateModuleResponses dep note: it closes over state (:334) — acceptable post-commit (revision-guarded), but
   the implementer must confirm the primary route dispatch does not depend on its output (it does not — route uses
   module.questions ids + timingForAttempt).

### Step 7 — Clean-up + docs

1. Remove or update any stale comment that describes polling as calls applyPayload with no phase dispatch once the
   reconciler lands; leave a pointer comment at the old split-effect sites (:357, :899) explaining the commit-first /
   reconciler-second arrangement for future readers.
2. Confirm no new store, no new gateway method, no contract field, no spinner copy change beyond the hold logic.
3. Update this plan file Divergences appendix (implementer appends, not rewrites) if any pseudocode name differs
   (e.g. commitPayloadAndRoute vs applyPayloadAndRoute), so Phase 05 audits the real seam.

## 6. Important code / pseudocode

### 6.1 Equality check (NEW src/features/student-delivery/application/satBootstrapEquality.ts)

```ts
import type { AssessmentDeliveryBootstrap } from "../contracts/assessmentDelivery";

// Clock-only movement must not defeat the skip: serverNow advances every poll.
// Tolerance default 1000ms — implementer validates against the 500ms now tick
// (controller :214) so sub-second serverNow drift never resets the clock.
export const SERVER_NOW_SKIP_TOLERANCE_MS = 1000;

export function isEquivalentBootstrap(
  prev: AssessmentDeliveryBootstrap | null,
  next: AssessmentDeliveryBootstrap,
): boolean {
  if (!prev) return false;
  if (prev.timing.runtimeRevision !== next.timing.runtimeRevision) return false;
  if (prev.versionId !== next.versionId) return false;
  if (Math.abs(Date.parse(next.serverNow) - Date.parse(prev.serverNow)) > SERVER_NOW_SKIP_TOLERANCE_MS) return false;
  if (
    prev.proctorStatus !== next.proctorStatus ||
    prev.proctorNote !== next.proctorNote ||
    prev.scheduleRuntimeStatus !== next.scheduleRuntimeStatus ||
    prev.deviceFingerprintHash !== next.deviceFingerprintHash ||
    (prev.result == null ? null : prev.result.id) !== (next.result == null ? null : next.result.id)
  ) return false;
  if (prev.attempt.id !== next.attempt.id) return false;
  if (!sameAttempts(prev, next) || !sameResponseRevisions(prev, next)) return false;
  return true;
}

function sameAttempts(prev: AssessmentDeliveryBootstrap, next: AssessmentDeliveryBootstrap): boolean {
  const a = prev.attempt.moduleAttempts, b = next.attempt.moduleAttempts;
  if (a.length !== b.length) return false;
  return a.every((m, i) => {
    const n = b[i];
    return (
      m.id === n.id && m.moduleId === n.moduleId && m.state === n.state && m.revision === n.revision &&
      m.startedAt === n.startedAt && m.pausedAt === n.pausedAt &&
      m.remainingSeconds === n.remainingSeconds && m.deadlineAt === n.deadlineAt &&
      m.availableAt === n.availableAt && m.completionReason === n.completionReason
    );
  });
}

function sameResponseRevisions(prev: AssessmentDeliveryBootstrap, next: AssessmentDeliveryBootstrap): boolean {
  const a = prev.attempt.responses, b = next.attempt.responses;
  if (a.length !== b.length) return false;
  return a.every((r, i) =>
    r.examQuestionId === b[i].examQuestionId && r.revision === b[i].revision,
  );
}
```

Notes: order-sensitive comparison is intentional (backend preserves attempt/response order; a reorder is treated as a
change — safe direction). Sections/modules/questions excluded (immutable per versionId). Response bodies excluded
beyond revision (bodies hydrate via hydrateResponse, revision-guarded at controller :312-316 — a body-only change
with bumped revision is correctly treated as changed).

### 6.2 Atomic commit sketch (controller)

```ts
// Illustrative — implementer fits to existing callback/effect structure.
const commitPayloadAndRoute = useCallback((payload, hint) => {
  // 1. identity guard (existing :139-145, generation + scheduleId + attempt.id)
  if (identityGenerationRef.current !== renderIdentityGeneration) return null;
  if (payload.scheduleId !== scheduleId || payload.attempt.id !== attemptId) return null;

  const current = dataRef.current; // synced ref, avoids adding data to deps
  const incomingRevision = payload.timing ? payload.timing.runtimeRevision : 0;
  const currentRevision = current && current.timing ? current.timing.runtimeRevision : 0;
  if (incomingRevision < currentRevision) return null;              // stale guard (existing)
  if (current && isEquivalentBootstrap(current, payload)) return null; // NEW skip (C3) — zero writes

  // 2. merge timing exactly as today (:157-158), then commit data + phase together (batched)
  const timing = mergeAuthoritativeTiming(current ? current.timing : null, payload.timing);
  const merged = timing === payload.timing ? payload : Object.assign({}, payload, { timing });
  const preState = phaseStateRef.current; // (phase, moduleKey) snapshot pre-commit
  setData(merged);
  setSnapshotReceivedAt(Date.now());   // ONLY on changed payloads (moved behind the skip)
  setResult(payload.result);
  setError(null);
  hydrateBootstrap(payload);

  // 3. at most one phase action, computed from (preState, merged, hint)
  const action = decideRouteAction(preState, merged, hint); // pure helper
  if (action) dispatch(action);
  if (action && action.type === "routeToModule" && merged) {
    const mod = moduleForAttempt(merged, findAttemptForModule(merged, actionModuleId(action)));
    if (mod) hydrateModuleResponses(merged, mod); // same tick, batched (existing startModuleFrom pattern)
  }
  return merged;
}, [attemptId, hydrateBootstrap, renderIdentityGeneration, scheduleId]);

function decideRouteAction(preState, payload, hint) {
  switch (hint.kind) {
    case "bootstrap": return preState.phase === "loading"
      ? { type: "bootstrapLoaded", assessmentId: payload.versionId } : null;
    case "poll": {
      if (payload.result && preState.phase !== "complete")
        return { type: "recover", state: { phase: "complete", scheduleId: scheduleId, candidateId: candidateId, assessmentId: payload.versionId, resultId: payload.result.id } };
      if ((preState.phase === "module" || preState.phase === "review") && ("moduleKey" in preState)) {
        const attempt = findAttemptForModule(payload, resolveModuleId(payload, preState.moduleKey));
        if (attempt && matchesFinalModuleState(attempt.state)) {
          const next = moduleForAttempt(payload, findPendingAttempt(payload));
          if (next && next.moduleKey !== preState.moduleKey) return { type: "showDirections" };
        }
      }
      return null;
    }
    case "startModule": return null; // routeToModule for hint.moduleId (section via sectionForModule + timingForAttempt + tool policy)
    case "submitModule": return null; // submit-to-finalize | startBreak | showDirections, from payload (existing :657-678 logic, moved earlier)
    case "terminal": return null; // recover-to-complete, existing :379-388 shape
    default: return null;
  }
}
```

refresh becomes: bootstrap then commitPayloadAndRoute(payload, poll-hint), returning
null on 304 / stale / equivalent (callers already treat null as no-change: poll tick :259-266, submit rescue :681,
retry rescue :763).

### 6.3 Gate sketch (route :307-319 replacement)

```tsx
// Route render, after the submitting branch (:265-306), replacing :307-319:
if (state.phase !== "module" && state.phase !== "review") {
  // Invariant (Phase 04): with atomic commits this is reachable only for
  // phase=loading+data-present (under one frame) or a genuine invariant violation —
  // never for transient module/review skew (which holds below). No held frame
  // may exist here; if it does, prefer the hold (defensive order: check hold first).
  if (heldFrame && heldFrameFresh) return heldFrame.element;
  return <SatErrorSurface title="SAT state unavailable" />;
}
if (!exam.stateModule || !exam.stateModuleAttempt || !exam.stateSection) {
  if (heldFrame && heldFrameFresh) {
    return heldFrame.element; // optional inline sync affordance, no role=status
  }
  return <SatLoadingSurface label="Refreshing SAT module..." />; // bare per Phase 01/03 contract
}
// existing review (:330+) / module (:400+) branches; on entering them, refresh lastValidFrameRef.
```

Implementer decides the hold vessel (cached element vs data+state refs re-rendered through the same branches);
either is acceptable if: (a) no new network/tool mount occurs during hold, (b) clocks do not reset, (c) hold expires
boundedly (SKEW_HOLD_MS).

## 7. Edge cases (must-handle list)

1. Timeout auto-submit during skew (:880-897). While unresolvable, the effect must neither submit nor consume
   timeoutSubmissionKeyRef. Submit fires only from a resolved frame whose remainingSeconds === 0 with an
   un-paused attempt, keyed once per (moduleId:attemptId). A skew frame that looks like 0 (missing attempt gives
   personalModuleRemainingSeconds fallback 0 at :849-851) must not submit — the added resolvability guard covers this.
2. Pause / freeze (blocked :984-986, pausedAt :893, cohort pause defect-9 :844-859). Poll-skip must not freeze
   unfreeze detection: pause-state transitions change pausedAt/stageStatus/remainingSeconds — not equivalent —
   accepted. Clock math untouched; hold frames never override a live paused banner/overlay.
3. Break / directions transitions (:485-553 auto-starts, :253-264 break branch, :199-251 directions branch).
   Atomic commits change only when the dispatch fires (same tick), not whether: auto-start predicates
   (shouldAutoStartInitialModule / shouldAutoStartNextSectionAfterBreak) and break timers
   (pendingBreakSeconds / pendingSectionWaitSeconds :431-459) unchanged. Poll reconciler dispatches
   showDirections only under the existing :900-908 predicate — never spuriously from a mid-module poll.
4. Terminal recovery + retryFinalization (:374-389, :602-637, :730-771, route :220-230/265-300). Poll-carried
   result still recovers to-complete (now synchronously in the poll commit); failed finalization still surfaces
   the retry panel (Phase 05 owns copy) with singleflight (finalizationInFlightRef) + stable
   submissionId=attemptId + recovery-key release on failure (:630). Poll-skip never skips a new result id
   (result id is in the equality predicate).
5. Identity change mid-flight / generation guards (:85-106, :140, :463, :643, :752). Every post-await commit
   re-checks identityGenerationRef.current === generation; late payloads from the previous
   (scheduleId, attemptId, candidateId) are dropped (existing identity test covers attempt swap — extend to
   candidate swap, T8). The reset effect clears data/result/error/isSubmitting/isStarting/autoSubmitted/
   answersRecorded + all auto-start/finalization refs + recovers to fresh loading (fixed candidateId) — and must
   also clear the new hold/commit dedupe refs added in this phase.
6. 304 handling (:176-177, gateway :176-192, bootstrapEtag.ts). 304 returns null, zero writes, failures not
   incremented beyond existing discipline. The poll ETag dead-store (:262-263) is documented, not fixed here.
7. Out-of-order payloads / runtimeRevision guard (:146-156, timing :12). Older runtimeRevision never clobbers
   newer (existing). Equal-revision races resolve via equality skip (identical) or accept-then-reconcile (differing) —
   both idempotent under StrictMode. The reconciler dedupe keys prevent double-dispatch when two in-flight polls
   resolve in the same tick.
8. Question-index / response integrity during hold. Hold renders the cached frame read-only w.r.t. navigation:
   answer/review/eliminate/annotation dispatches still target live state (unchanged); if the user answers during a
   sub-second hold, the live dispatch wins and the hold is discarded on the next resolved render (held element is
   replaced, not merged). Persistence saves continue against stateModuleAttempt.id from the last resolved frame —
   acceptable because hold is bounded and the attempt id is stable across skew (moduleKey-to-id mapping, not attempt swap).
9. Break veil / help / shortcuts transient UI (route :76-101). Ephemeral overlays reset on activeQuestionIndex
   change (:94-101) — hold must not reset them (hold is not navigation) nor leak them past hold expiry.
10. Calculator host during hold (Phase 03 seam). Held frame keeps its mounted host; fallback Refreshing mounts
    none. No prewarm trigger fires from hold logic (ensureDesmosPreconnect once at :103-105, unchanged).

## 8. Tests

Extend in place; one new file plus one new unit file. All controller tests reuse the established mock pattern
(vi.mock satDeliveryGateway + useSatResponsePersistence + useSatIntegrityControl, fake timers where cadence matters).

- T1 — Reducer identity + transition tests (extend
  src/features/student-delivery/application/__tests__/satRunnerReducer.test.ts):
  - createSatRunnerState sched,cand has candidateId cand (not attempt-shaped); fresh state phase loading.
  - Full lifecycle preserves the fixed id: bootstrapLoaded to moduleStarted/routeToModule to reviewModule to
    startBreak to routeToModule to submit to completed asserts candidateId cand at every step (catches
    newWorkingState :148-149 regressions).
  - recover migration still backfills activeTools from legacy activeTool for module/review snapshots.
- T2 — Commit atomicity tests (new hooks/__tests__/useSatExamController.convergence.test.tsx):
  - Bootstrap resolves data+directions in one update: after bootstrap resolves, first settled render already shows
    state.phase directions with data non-null (assert no intermediate render with data and phase loading
    — e.g. via a render-spy counting branch hits).
  - Poll carrying a finalized current module + different pending module dispatches showDirections synchronously
    (no second tick needed).
- T3 — Skew-hold tests (same new file, or route-level test if the hold lives in the route — implementer places
  alongside the code, e.g. routes/__tests__/SatStudentSessionRoute.skew.test.tsx):
  - From a rendered module frame, deliver an unresolvable tick (module list momentarily not containing
    state.moduleKey); assert the question UI persists, and neither Refreshing SAT module nor
    SAT state unavailable appears while the hold is fresh; assert bounded fallback appears only after hold expiry
    with no recovery, and that a recovered payload restores live content without remount churn.
- T4 — Equality unit tests (new application/__tests__/satBootstrapEquality.test.ts):
  - Identical payload (fresh clone, new refs) gives equivalent (covers the always-new-object fetch reality).
  - Changed runtimeRevision, changed attempt (state/revision/remainingSeconds/deadlineAt/pausedAt), changed
    response revision, changed proctor/schedule/result gives not equivalent.
  - serverNow drift within tolerance gives equivalent; beyond tolerance gives not equivalent (documents threshold).
  - Reordered attempts/responses gives not equivalent (safe direction). Empty-to-nonempty sections with same versionId
    gives equivalent (sections excluded by design).
- T5 — Poll-skip + 304 tests (new convergence file):
  - Three consecutive identical refresh(false) resolutions give data ref stable (or single setData), and the
    remainingSeconds display does not jump (fake timers: advance 3s of polls, assert countdown advances only by
    wall-clock, never resets to snapshot value).
  - 304 rejection from bootstrap gives refresh null, no error set when surfaceError=false, error set
    when surfaceError=true for non-304 (existing behavior locked).
- T6 — Poll-cadence stability test: drive directions-to-module-to-review transitions with fake timers; assert the poll
  interval is not torn down per phase (gateway bootstrap cadence follows wall-clock; no burst after each transition).
- T7 — Timeout-during-skew test: resolved frame with remainingSeconds === 0 submits once (existing keyed behavior);
  unresolvable frame with derived 0 does NOT call submitModule; when the payload recovers still at 0, submit fires
  exactly once.
- T8 — Identity-mid-flight test (extend useSatExamController.identity.test.tsx pattern): swap candidateId
  mid-bootstrap; assert late first-identity payload dropped, state.candidateId equals the new prop after reset
  (covers the :105 reset path, not just attempt swap).
- Keep-green suites (must pass unmodified, or with only additive changes): satRunnerReducer.test.ts,
  domain/satTiming.test.ts (timing frozen), hooks/__tests__/useSatExamController.identity.test.tsx,
  hooks/__tests__/sat-finalization-recovery.test.tsx (submit-to-complete, retry idempotence, poll-recovery to complete),
  hooks/__tests__/sat-cohort-clock.test.tsx (deadline/offset math), __tests__/bootstrapEtag.test.ts.

## 9. Verification (commands)

From the repo root (/Users/rd-cream/Downloads/remix_-ielts-proctoring-system):

```bash
# typecheck (must be clean)
npm run typecheck

# lint touched areas (must be clean; adjust paths to the real diff)
npx eslint src/features/student-delivery/hooks/useSatExamController.ts \
  src/features/student-delivery/application/satRunnerReducer.ts \
  src/features/student-delivery/application/satBootstrapEquality.ts \
  src/features/student-delivery/routes/SatStudentSessionRoute.tsx

# affected unit suites (must be green, incl. the new convergence + equality suites)
npx vitest run \
  src/features/student-delivery/application/__tests__/satRunnerReducer.test.ts \
  src/features/student-delivery/application/__tests__/satBootstrapEquality.test.ts \
  src/features/student-delivery/domain/satTiming.test.ts \
  src/features/student-delivery/hooks/__tests__/useSatExamController.identity.test.tsx \
  src/features/student-delivery/hooks/__tests__/useSatExamController.convergence.test.tsx \
  src/features/student-delivery/hooks/__tests__/sat-finalization-recovery.test.tsx \
  src/features/student-delivery/hooks/__tests__/sat-cohort-clock.test.tsx \
  src/features/student-delivery/__tests__/bootstrapEtag.test.ts

# full student-delivery scope (regression sweep before handoff to Phase 05)
npx vitest run src/features/student-delivery
```

Manual / Phase-05-prep checks (no new infra in this phase):
- Throttle the bootstrap endpoint (or mock a 1-frame empty-module payload) and step through
  directions-to-module-to-poll-to-submit: valid exam UI never swaps to full-screen spinner mid-poll; skew holds then resolves.
- Screen-reader spot check: exactly one role=status while the bounded fallback shows; none while holding.
- Confirm no IELTS / staff / preview surface changed (useSatPreviewController untouched).

## 10. Definition of done

1. No full-screen spinner on poll. With valid exam UI mounted, any number of consecutive polls (identical, 304, or
   revision-equal) leaves the module/review content mounted; spinners appear only for genuine blocking states
   (no bootstrap yet / no module resolved with no held frame / finalizing with no fallback).
2. Transient skew never shows SAT state unavailable when a previous frame is valid. The :307-316 branch is
   provably unreachable while lastValidFrameRef is fresh (code comment + T3 test). One-frame data/state mismatches
   hold previous UI (bounded by SKEW_HOLD_MS); only prolonged/unresolvable-with-no-history falls back to the bare
   Refreshing SAT module surface.
3. Polling is calm. Identical polls perform zero state writes: no setData, no setSnapshotReceivedAt, no clock
   recompute (T5); phase transitions do not reset the poll cadence/backoff (T6). serverClockOffsetMs and both
   countdowns hold still across no-change polls.
4. candidateId trustworthy incl. reset path. state.candidateId === candidateId prop in all phases (T1), including
   after identity reset (attempt/candidate swap mid-flight, T8); grep shows no prod createSatRunnerState with attemptId.
5. Atomic commits. Bootstrap / poll-reconcile / start / submit / terminal paths each commit data+phase in one tick
   (T2); the demoted split effects fire only as idempotent safety nets (dedupe-keyed, single-action).
6. Timeout/pause/break/terminal semantics preserved. T7 + keep-green finalization/clock suites pass; no deadline,
   auto-submit-once, pause-freeze, break-wait, singleflight-retry, or stable-submissionId behavior changed.
7. Constraints held. No contract field added/removed, no gateway signature changed, no timing-math edit
   (git diff stat shows no satTiming.ts prod change), no persistence-engine edit, no submitting-copy change,
   no host/prewarm move. Typecheck + lint + affected suites green.
8. Seam documented for Phase 05. Section 11 names the exact seam; any implementer deviation is appended to this file
   Divergences note (not silently diverged).

## 11. Exact seam Phase 05 will verify

Phase 05 (submitting language + repo-wide verification) owns everything Phase 04 explicitly did not:

- Submitting unification (SatStudentSessionRoute.tsx:265-306 + SatSubmissionOverlay + terminal-recovery copy
  at route :220-230 and controller answersRecorded/recoveryNeedsRetry :730-743/:992-996): Phase 04 only makes the
  arrival at submitting atomic (submit-to-finalize dispatch in the same tick); it must not alter copy, pattern, or
  retry affordance. Phase 05 asserts one submitting language and verifies the atomic arrival did not change which branch
  renders when.
- Single-live-region + no-flicker audit: Phase 05 re-runs the a11y check (exactly one role=status while loading;
  hidden prewarm silent per Phase 01/03) and the flicker e2e (cold open to one SAT-skinned surface; poll to no spinner;
  skew to hold). Phase 04 exit artifact for this is: T3 + T5 + T6 green, and the hold/fallback branches clearly marked
  with Phase 04 comments citing this plan.
- Full regression: npm run typecheck, eslint on touched areas, full student-delivery vitest scope, SAT e2e
  smoke, and IELTS/staff/preview no-regression. Phase 04 hands off with the Section 9 commands green on its own scope.
- Seam symbols (names may differ per Step-7 Divergences note; Phase 05 greps for the real ones):
  commitPayloadAndRoute | applyPayloadAndRoute, isEquivalentBootstrap, SKEW_HOLD_MS,
  lastValidFrameRef, phaseRef/dataRef, SERVER_NOW_SKIP_TOLERANCE_MS.
  If Phase 05 cannot find these (or their documented renames), Phase 04 is not done.

## Appendix — Line-ref index (grounding)

- Initializer + reset identity bug: controller :69-72, :105 to reducer :59-61.
- Split truth: :137-168 (applyPayload), :189-207 (bootstrap to-dispatch bootstrapLoaded), :357-362
  (directions auto-route), :639-728 (submitModule awaits then dispatches :660/:671/:677/:687/:709),
  :899-909 (finalized-module guard), route :307-319 (spinner/error).
- Polling churn: :150-162 (always-new-object + clock reset), :226-274 (poll loop; :274 deps incl. state.phase),
  :276-289 (aux triggers), :841-859 (offset + countdowns recompute on every poll).
- Clock/persistence seams: satTiming.ts:7-23 (merge), :52-70 (personal countdown), :72-88 (break);
  hydrateBootstrap :164; visible-drafts sync :797-835; persistence.save :919-977.
- Terminal/retry/timeout: :374-389 (terminal-to-complete), :555-600 (finalizeAssessment singleflight),
  :602-637 (directions terminal recovery), :730-771 (recoveryNeedsRetry/retryFinalization),
  :880-897 (timeout auto-submit, keyed once), :992-996 (autoSubmitted/answersRecorded).
- Route branches: :107-122 (error/loading), :123-131 (complete/terminated), :133-197 (calculator host — Phase 03),
  :199-251 (directions), :253-264 (break), :265-306 (submitting — Phase 05), :307-319 (THIS PHASE gate),
  :330-410+ (review/module content).

## Appendix — Divergences (implementer appends; planner leaves blank)

- (none yet — implementer records renames/deviations here, e.g. commit helper name, tolerance value, hold vessel choice).
- Phase 04 implementation (2026-09-11): commit helper real name is `acceptPayloadAndRoute(payload, hint)`
  (not `commitPayloadAndRoute`/`applyPayloadAndRoute`); legacy `applyPayload(payload)` kept as a thin
  poll-hint wrapper so the Phase-02 successor-name contract holds. `SKEW_HOLD_MS = 1500`, hold vessel is a
  cached-element `lastValidFrameRef` (+ `heldFrame`/`heldFrameFresh` render reads), refs are
  `dataRef`/`stateRef`/`phaseRef`, tolerance is `SERVER_NOW_SKIP_TOLERANCE_MS = 1000` (re-exported through
  the controller for the clock-only no-clock-touch patch). Test-only seam: `commitForTest` (poll-hint commit,
  no prod callers). Fallback renders BARE per Phase 01/03 contract (no `withCalculatorHost`).
  `pollEtagRef` dead-store documented-not-fixed via code comment (payload type has no `etag`).
