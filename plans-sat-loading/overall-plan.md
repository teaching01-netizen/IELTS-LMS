# SAT Student Loading UI + State — Overall Plan

> Workflow: ai-planning-workflow | Stage: PLAN ONLY (no implementation yet)
> Scope: SAT student exam-mode loading/state only: StudentSessionRoute, SatStudentSessionRoute,
>   useSatExamController, satRunnerReducer, SatStateSurfaces, SatCalculatorPanel/DesmosCalculator/
>   SatFloatingTool, useStudentSessionRouteData (read-mostly), LoadingSurface/AppLoadingSkeleton.
> Out of scope: staff workspace (products/sat), IELTS surfaces, backend scoring/timing, auth,
>   persistence engine internals. No backend contract change. No spinner visual redesign.
> Prior input: root-cause audit 2026-09-11 (read-only, no edits made).

## 1. Goal

One SAT loading truth, no forced spinners, no duplicate live regions:

- Exactly ONE visible loading surface at any moment on the SAT student path, always in the
  SAT visual system (.sat-ui tokens, SatLoadingSurface), never the grey admin AppLoadingSkeleton mid-exam.
- No full-screen spinner for transient reconciliations that already have valid UI (poll refresh,
  one-frame data/state skew, hidden Desmos prewarm).
- Loading appears only when genuinely blocked: no bootstrap yet / no module resolved /
  submitting-finalizing with no fallback. Everything else holds previous valid UI or shows a
  targeted inline affordance.
- Screen readers hear each loading event exactly once (single role=status; hidden prewarm emits none).
- Fix the latent identity bug (state.candidateId holds attemptId) while touching the runner.

Non-goals:
- No visual redesign of the spinner; no token rename; no new stores; no payload change.
- No change to save-status / error / break / complete semantics.
- No IELTS / staff / preview behavior change (preview keeps its own controller).

## 2. Verified current state (root causes this plan fixes)

R1. Two stacked loaders: parent StudentSessionRoute.tsx:49-51 renders admin LoadingSurface
    (which renders AppLoadingSkeleton, grey bg-gray-50), then mounts SatStudentSessionRoute whose
    !data branch (:118-122) renders SAT SatLoadingSurface (.sat-ui spinner). Waterfall: parent
    static+live (2 fetches in useStudentSessionRouteData.loadStudentData) then child bootstrap()
    again (3rd fetch, useSatExamController.ts:189-207, data=null initial). Every open shows
    skeleton, unmount, spinner — different skins back-to-back.
R2. Calculator prewarm on every branch: SatStudentSessionRoute.tsx:133-197 computes
    fallbackCalculatorModule (ANY module with calculator) and withCalculatorHost() wraps ALL
    returns (:204,213,231,255,270,301,308,318,331,370,400), including loading/error/submitting.
    With prewarmWhenClosed (SatCalculatorPanel:69,102,114 -> DesmosCalculator:26-28,67-86), both
    scientific+graphing iframes mount eager+hidden via keepAlive (SatFloatingTool:159-167,202-210),
    each exposing role=status Loading calculator (DesmosCalculator:87-104). Full-screen spinner
    plus 2 hidden live regions coexist; bandwidth spent prewarming Desmos on error screens.
R3. Forced Refreshing SAT module from split truth: data (useState Bootstrap|null) and state
    (useReducer satRunnerReducer, phases loading/directions/module/review/submitting/break/complete)
    advance independently — applyPayload->setData vs bootstrapLoaded/routeToModule/showDirections
    ->dispatch in separate effects (controller :357-362, :899-909) or after await in
    submitModule (:639-728). Any frame with phase=module|review but unresolvable
    stateModule/Attempt/Section hits :317-318 full-screen spinner; :307-316 yields
    SAT state unavailable error for any other non-module/review phase (transient included).
    Polling refresh(false) (:226-274) calls applyPayload with no phase dispatch, widening skew window.
R4. Polling churn: controller :150-162 does setData(newObj)+setSnapshotReceivedAt(Date.now()) on
    every accepted poll; mergeAuthoritativeTiming often returns a new object, so even unchanged
    payloads re-render, recompute serverClockOffsetMs (:841-843) and remainingSeconds (:852-859);
    state.phase in poll-effect deps (:274) tears down and resets backoff cadence on phase change.
R5. Identity bug: useSatExamController.ts:69-72 and :105 call createSatRunnerState(scheduleId,
    attemptId) where the 2nd param is candidateId (satRunnerReducer.ts:59-61). Latent today (only
    carried through newWorkingState) but must be fixed with runner work.
R6. Two submitting languages: final module phase=submitting gets full-screen spinner/alert
    (route :265-306); mid-exam isSubmitting gets inline SatSubmissionOverlay (:410) + inert shell.
    Both correct per phase but visually two patterns; copy also diverges.

## 3. Architecture

Evolve, do not rebuild. One direction: contract -> bootstrap -> gates -> convergence.

Layer 0 — Loading contract (types + single surface).
  SatLoadingKind: initial | module-refresh | finalizing. SatLoadingSurface stays the ONLY
  full-screen loader; hidden prewarm never emits role=status.
Layer 1 — Bootstrap chain (parent to child handoff).
  Parent owns auth/static/live; child owns delivery bootstrap. Child accepts snapshot seed and
  dedupes the 3rd fetch; parent never shows the admin skeleton for providerKey=sat past auth.
Layer 2 — Shell gates (route render branches).
  calculatorHost + Desmos prewarm mount ONLY where exam chrome can exist. Error/loading branches
  render bare (no hidden tools).
Layer 3 — Runner convergence (controller + reducer).
  data+phase advance atomically where possible; transient skew holds previous UI. Polling skips
  identical revisions. Identity bug fixed. Submitting speaks one language.

Rules:
- Route branches never mount hidden interactive/tool trees under a full-screen loader or error.
- Hidden DOM (keepAlive prewarm) must be aria-hidden with NO live-region roles.
- Polling never replaces valid UI with a spinner; it patches in place.
- state.candidateId becomes trustworthy; no new stores; no payload change.

## 4. Phases

Phase 01 — Loading contract + single surface. Objective: define SatLoadingKind, single-surface
  rule, silence hidden Desmos live regions, add regression tests. Owns: feedback/SatStateSurfaces,
  tools/DesmosCalculator, tools/SatFloatingTool, tests. No deps.
Phase 02 — Bootstrap waterfall. Objective: remove skeleton-to-spinner double-take: SAT-skinned
  first paint, seed or dedupe child bootstrap, parent gates admin skeleton for SAT. Owns:
  student/routes/StudentSessionRoute (SAT branch), useStudentSessionRouteData (read-mostly,
  expose seed), useSatExamController bootstrap effect, assessmentDeliveryApi (read-mostly).
  Depends on 01.
Phase 03 — Tool prewarm gating. Objective: scope withCalculatorHost/prewarm to branches where
  exam chrome exists; bare loading/error branches. Owns: SatStudentSessionRoute branches + host,
  SatCalculatorPanel. Depends on 01. Independent of 02 (seam: 03 owns ONLY host/branch wrapping,
  02 owns ONLY bootstrap props/seed in the same file; main agent serializes merges).
Phase 04 — Runner convergence + calm polling. Objective: atomic data+phase transitions,
  hold-previous-UI on transient skew, skip-identical polls, fix candidateId identity. Owns:
  useSatExamController, satRunnerReducer, satRuntimeSelectors (read). Depends on 02 + 03.
Phase 05 — Submitting language + verification. Objective: unify submitting copy/pattern, full
  regression (tests/typecheck/lint/build, a11y single-live-region, e2e flicker check). Owns:
  submitting branch + repo-wide verification. Depends on 01-04.

Dependency DAG:
  Phase 01 (contract, no deps)
    -> Phase 02 (bootstrap) + Phase 03 (prewarm gating), independent of each other
    -> Phase 04 (convergence, needs 02 bootstrap shape + 03 host scoping)
    -> Phase 05 (verification, needs 01-04)

Parallelizable: 02 + 03 after 01 completes (disjoint ownership, seam-disciplined).
Never parallel: 04 with 02/03 (same controller/route truth); 05 with anything.

## 5. Execution order (waves)

Wave 1: Phase 01.
Wave 2: Phase 02 + Phase 03 (parallel, seam-disciplined).
Wave 3: Phase 04.
Wave 4: Phase 05.

Phase completion gate (each wave): implementation finished -> tests/typecheck/lint pass ->
phase DoD satisfied -> Main Agent verifies -> unlock next wave. Failures return to the owning
implementation agent; no premature unlock.

## 6. Completion criteria (overall DoD)

1. Cold SAT open shows exactly one loading surface in SAT skin; no admin skeleton flash
   (route tests + e2e).
2. Poll/bootstrap refresh never swaps valid exam UI for a full-screen spinner; transient skew
   holds previous frame or shows targeted inline affordance.
3. Loading/error/submitting branches contain zero hidden Desmos iframes and zero competing
   role=status nodes (exactly one live region while loading).
4. state.candidateId equals the candidateId prop in all phases incl. identity reset; existing
   reducer tests + new identity test pass.
5. tsc, eslint on touched areas, affected vitest suites, and SAT e2e smoke pass; no
   IELTS/staff/preview regression.
6. No backend contract change; no new store; no spinner visual redesign beyond contract.