# Phase 03 — Tool prewarm gating (SAT student loading)

Stage: PLAN ONLY — no source edits in this phase. Implementation-grade plan.
Overall plan: plans-sat-loading/overall-plan.md (R2). Depends on Phase 01 contract; independent of Phase 02.

## 1. Objective

Scope withCalculatorHost / Desmos prewarm so hidden calculator trees mount ONLY on branches where exam chrome can exist. All bare branches (loading, error, submitting-finalizing, terminal, state-unavailable) render bare: zero hidden Desmos iframes, zero competing role=status nodes — exactly one live region while loading.

Fix R2 without changing open-tool behavior in module/review:

- Loading branch + refreshing-module branch + both submitting branches + every error/terminal branch stop mounting calculatorHost.
- Prewarm eligibility becomes an explicit predicate (calculator-capable module context exists AND phase allows exam chrome), instead of any-module-anywhere-has-a-calculator.
- keepAlive / prewarmWhenClosed plumbing survives only on eligible branches; the open to close to reopen node-identity contract (unit + e2e) stays green.
- Reference behavior untouched (it already has no prewarm — see section 3 asymmetry note).

## 2. Dependencies (Phase 01 contract — assumptions)

Phase 01 (Loading contract + single surface) is defined in plans-sat-loading/phase-01-loading-contract.md (Wave 1 root; overall-plan.md is the parent). This phase ASSUMES that contract lands as specified and must rebase if implementation diverges:

1. A1 - SatLoadingKind: initial OR module-refresh OR finalizing union plus SAT_LOADING_LABELS map plus data-sat-loading-kind probe attr, all exported from src/features/student-delivery/ui/feedback/SatStateSurfaces.tsx (Phase 01 sections 3a/6). Phase 03 does not define or extend them; it only maps branches to kinds for test labels (B1/B9 initial vs module-refresh, B7b finalizing) and adopts Phase 01 label strings verbatim.
2. A2 - Single-surface rule: SatLoadingSurface remains the ONLY full-screen loader; hidden prewarm never emits role=status. Concretely Phase 01 is expected to silence the two hidden live regions inside DesmosCalculator.tsx (:87-104 role=status data-desmos-loading overlay, and :105-116 role=status Paused by proctor veil). Phase 03 assumes that when SatFloatingTool renders the keepAlive-closed tree (hidden + inert + aria-hidden, SatFloatingTool.tsx:163-167,202-210), those inner nodes emit NO live region. Phase 01 implements this via a silenceLiveRegions-style prop originating in SatCalculatorPanel (const desmosHidden = !open, passed to DesmosCalculator; SatFloatingTool untouched) — i.e. the silencing is INTERNAL to the panel, so Phase 03 needs NO prop passthrough: not mounting the host on bare branches composes with (not duplicates) the Phase 01 silence on eligible branches.
3. A3 - Branch-label contract: loading surfaces accept a kind-derived label; Phase 03 keeps existing literal labels (Loading Digital SAT..., Refreshing SAT module..., Finalizing SAT responses... / time-expired variant) unless Phase 01 renames them, in which case Phase 03 adopts the Phase 01 labels verbatim.
4. A4 - Regression tests from Phase 01 covering hidden-Desmos-emits-no-role=status exist; Phase 03 adds branch-matrix tests (section 9) that compose with them, not duplicate them.

Seam with Phase 02 (bootstrap waterfall — independent, parallel-safe):

- Phase 03 owns ONLY host/branch wrapping in src/features/student-delivery/routes/SatStudentSessionRoute.tsx: the calculatorWarm computation (:133-155), calculatorHost (:159-170), withCalculatorHost (:177-197), and which return uses it vs returns bare JSX.
- Phase 02 owns ONLY bootstrap props/seed in the same file: the SatStudentSessionRouteProps seed fields (:34-45, attemptSnapshot etc.), the useSatExamController call (:63-73), and the !data early branch (:118-122). Main agent serializes merges; Phase 03 must not touch prop names, seed plumbing, or the parent StudentSessionRoute.tsx:91-117 SAT branch.

## 3. Current state — verified by inspection

### 3.1 Route file under change

src/features/student-delivery/routes/SatStudentSessionRoute.tsx (502 lines). Full branch list:

- B0 :107-117 error AND !data renders SatErrorSurface SAT delivery unavailable. Host-wrapped: NO (early return before host, already bare).
- B1 :118-122 !data renders SatLoadingSurface Loading Digital SAT. NO (already bare).
- B2 :123-125 data.result OR phase complete renders SatCompleteScreen. NO (already bare).
- B3 :126-128 proctorStatus terminated renders SatTerminatedScreen. NO (already bare).
- B4 :129-131 scheduleRuntimeStatus completed/cancelled renders SatTerminatedScreen. NO (already bare).
- B5a :203-211 phase directions, section-wait renders SatBreakScreen waiting. YES (:204) — KEEP iff eligible.
- B5b :212-219 phase directions, break-wait renders SatBreakScreen. YES (:213) — KEEP iff eligible.
- B5c :231-250 phase directions default renders SatDirectionsScreen (+ terminal-recovery secondary action). YES (:231) — KEEP iff eligible.
- B6 :253-264 phase break renders SatBreakScreen. YES (:255) — STRIP (see section 5).
- B7a :270-299 phase submitting + error renders role=alert retry-finalization panel. YES (:270) — STRIP.
- B7b :301-305 phase submitting no error renders SatLoadingSurface finalizing. YES (:301) — STRIP.
- B8 :307-316 phase not in module/review renders SatErrorSurface SAT state unavailable. YES (:308) — STRIP.
- B9 :317-319 module/review but !stateModule/Attempt/Section renders SatLoadingSurface Refreshing SAT module. YES (:318) — STRIP.
- B10 :331-363 phase review renders SatReviewPage + banners/overlays. YES (:331) — KEEP.
- B11 :370-378 module, question unresolvable renders SatErrorSurface SAT question unavailable. YES (:370) — STRIP.
- B12 :400-501 phase module happy path renders SatExamShell + question + reference panel. YES (:400) — KEEP.

Calculator computation (:133-170): currentCalculatorModule (:133-138, only module/review + capability flag + stateModule); pendingCalculatorModule (:139-142, controller pendingModule via findCurrentModule with calculator cap); fallbackCalculatorModule (:143-145, ANY module in ANY section with calculator — the R2 root cause); warm resolution (:146-155, current ?? pending ?? fallback, synthetic prewarm:moduleId id when no real attempt exists); host (:159-170, always prewarmWhenClosed, open only when module + activeTools.calculator); withCalculatorHost (:177-197, wraps content + lease-conflict notice + host).

Why this prewarms everywhere: fallbackCalculatorModule is non-null for every exam containing any math module (virtually all SAT exams), so calculatorModuleAttemptId is non-null (prewarm:moduleId synthetic fallback at :155) on EVERY branch below :133 — including B7a/B7b/B8/B9/B11 full-screen loader/error branches. prewarmWhenClosed (:167) then forces SatCalculatorPanel:69,102,114 to DesmosCalculator:26-28,67-86 eager both-modes + SatFloatingTool:159-167,202-210 keepAlive hidden tree = 2 hidden Desmos iframes (https://www.desmos.com/testing/collegeboard/scientific?embed and .../graphing?embed — do NOT change URLs) + up to 2 hidden role=status nodes coexisting with the visible loader (Phase 01 silences the inner ones; Phase 03 removes the iframes from bare branches entirely). Also note :103-105 ensureDesmosPreconnect() on mount (DNS preconnect link) — cheap, keep as-is; it is not an iframe and is out of scope.

### 3.2 Tool chain (do NOT redesign)

- src/features/student-delivery/ui/tools/SatCalculatorPanel.tsx (120 lines): :19,31 prewarmWhenClosed=false default; :69 if not open and not prewarmWhenClosed return null; :99-103 prewarmInactiveModes = prewarmWhenClosed OR open; :107-119 SatFloatingTool keepAlive = prewarmWhenClosed.
- src/features/student-delivery/ui/tools/DesmosCalculator.tsx (119 lines): :26-28 initial mountedModes = both when prewarming; :33-42 effect adds both modes; :67-86 iframe map (loading=eager when prewarming); :87-104 loading overlay live region; :105-116 paused veil live region. No URL/geometry/drag changes.
- src/features/student-delivery/ui/tools/SatFloatingTool.tsx (274 lines): :28 keepAlive; :159 closed + not keepAlive returns null (reference path); :161-191 compact branch — closed + keepAlive renders div.hidden aria-hidden inert data-sat-tool-window data-sat-tool-presentation=compact-sheet STILL containing children (the Desmos iframes) (:163-167); :202-210 desktop closed + keepAlive renders hidden dialog-less node with children. Implication: gating must happen ABOVE the panel (route does not render host at all on bare branches) — fixing the inner hidden tree alone is insufficient (iframes would still mount).
- Reference asymmetry (intentional, keep): SatReferenceSheetPanel.tsx (37 lines) passes NO keepAlive, so closed unmounts (:159 null path). It additionally mounts only inside the B12 module shell (:490-499, gated on state.toolCapabilities.referenceSheet). So reference already satisfies the bare-branch rule; Phase 03 changes nothing about reference.

### 3.3 Existing tests that constrain the change

- src/features/student-delivery/ui/tools/__tests__/SatCalculatorPanel.test.tsx — prewarm identity contract: closed + prewarmWhenClosed mounts both frames hidden; closed to open reveals the SAME nodes (toBe(before)); without prewarm, close unmounts. Must stay green.
- src/features/student-delivery/ui/tools/__tests__/DesmosCalculator.test.tsx — lazy single-mode default; activated embed stays mounted on switch; paused veil. Must stay green.
- src/features/student-delivery/ui/tools/SatFloatingCoexistence.test.tsx — two dialogs coexist non-modal; keyboard grip; Escape; chrome tokens; compact sheet; closed + not keepAlive renders nothing. Must stay green.
- e2e/sat-student-accessibility.spec.ts:222-254 — Calculator is fully prewarmed before first open and reveals the same ready Desmos frames: on a math module, data-desmos-both-modes-ready becomes true pre-open, node identity survives open, mode switch shows no loader. Must stay green — prewarm must still happen in module context (B12 closed-calculator state).
- No route-level test file exists for SatStudentSessionRoute (glob src/features/student-delivery/routes/__tests__/ contains only SatPreviewRoute.test.tsx); Phase 03 adds one (section 8). Debug route src/app/router/dev/SatAccessibilityDebugRoute.tsx:185-202 uses prewarmWhenClosed in exam chrome — unaffected.

## 4. Affected / new files

- src/features/student-delivery/routes/SatStudentSessionRoute.tsx — ONLY source file changed: predicate + host computation + per-branch wrap/unwrap (sections 5-6). No prop/seed changes (Phase 02 seam).
- src/features/student-delivery/routes/__tests__/SatStudentSessionRoute.prewarm.test.tsx — NEW branch-matrix tests (section 9).
- src/features/student-delivery/ui/tools/SatCalculatorPanel.tsx — READ-ONLY. No change (not rendering the panel at all = no prewarm).
- src/features/student-delivery/ui/tools/DesmosCalculator.tsx — READ-ONLY. No change (Phase 01 owns live regions).
- src/features/student-delivery/ui/tools/SatFloatingTool.tsx — READ-ONLY. No change (keepAlive semantics preserved for eligible branches, compact path included).
- src/features/student-delivery/ui/tools/SatReferenceSheetPanel.tsx — READ-ONLY. No change.
- src/app/router/dev/SatAccessibilityDebugRoute.tsx — READ-ONLY. No change.

## 5. Contracts / interfaces

### 5.1 Host-mount rule (normative)

The route mounts calculatorHost IFF canPrewarmCalculator is true. Bare branches return their surface JSX directly (no withCalculatorHost, no host element, no hidden tool tree of any kind). Eligible branches keep withCalculatorHost(...) exactly as today (including the lease-conflict notice behavior).

Eligible phases/branches (host MAY mount):

- B12 module (:400) — always eligible when a calculator-capable module context exists. open = (phase === module AND activeTools.calculator) unchanged: closed = hidden prewarm tree, open = visible dialog. Preserves the e2e prewarm-identity contract.
- B10 review (:331) — eligible under the same predicate (review keeps the warm tree so return-to-module is instant; host renders with open=false hidden tree in review since open requires phase === module).
- B5a/B5b/B5c directions (:204/:213/:231) — eligible IFF the pending module is calculator-capable (math directions about to start a math module). Only case where prewarm-before-first-open pays off without wasting bandwidth on R+W directions.

Bare branches (host MUST NOT mount — return JSX directly): B6 break, B7a submitting-error, B7b submitting-loading, B8 state-unavailable, B9 refreshing-module, B11 question-unavailable. B0/B1/B2/B3/B4 are already bare (early returns above the host computation) and stay as-is.

### 5.2 Prewarm eligibility predicate (normative)

Location: SatStudentSessionRoute.tsx, replaces :133-155 computation. Inputs already in scope: state, data, exam (controller). Returns the module whose attempt id (real or synthetic) scopes geometry/workspace keys, or null when no host may mount.

Truth table (phase x context -> host):

- module + current module calculator-capable: YES (open per activeTools), real stateModuleAttempt.id.
- module + current module NOT calculator-capable: NO host.
- review + reviewed module calculator-capable: YES (hidden warm tree, open=false), real attempt id.
- review + not calculator-capable: NO host.
- directions + pending module calculator-capable: YES (hidden warm tree), real attempt id if started else prewarm-colon-pendingModuleId.
- directions + pending module null or not calculator-capable: NO host.
- break / submitting / loading / error / terminated / complete, any context: NO host.

Rules: (1) module/review warm the live module (real attempt id preferred). (2) directions warms ONLY the pending module, and only if IT is calculator-capable. (3) every other phase: null, no prewarm. (4) no cross-exam fallback scan — if neither current nor pending qualifies, result is null.

### 5.3 Fallback-module decision (remove — justification)

Remove fallbackCalculatorModule (:143-145) entirely. Justification:

1. It is the R2 root cause: scanning ALL sections for ANY calculator module makes the host non-null on branches with no calculator context (R+W modules, errors, submitting).
2. It warms the WRONG module: geometry/workspace keys are per-module-attempt (satToolGeometryKey(scheduleId, attemptId, moduleAttemptId, calculator), calculatorWorkspaceKey(...)); a fallback math module's warmed iframes sit under a prewarm-colon-otherModuleId key while the student works an R+W module — zero hit rate, pure bandwidth cost (2 Desmos embeds) on every error/loading screen.
3. Legitimate prewarm needs are covered without it: module/review use the live module; directions use the pending module (the module about to start — the only future context with predictable payoff, matching the e2e prewarmed-before-first-open scenario which runs in math context).
4. Narrower alternative considered and rejected: restricting fallback to same-section still warms math Desmos during R+W modules of a math section and still fires on error branches. Phase-gating alone without fallback removal would still prewarm on B5c R+W directions and B6 break. Both changes are needed; neither alone suffices.

### 5.4 Bare-branch rule (normative)

A bare branch MUST satisfy all three: (1) returned JSX contains no calculatorHost / withCalculatorHost wrapper. (2) rendered DOM contains ZERO iframe[data-desmos-mode] and zero [data-sat-trusted-tool=desmos] subtrees. (3) rendered DOM contains EXACTLY ONE role=status node while loading (the surface's own), zero while showing role=alert error surfaces (B7a/B8/B11 use role=alert — no competing status).

### 5.5 What does NOT change

- open semantics: open = (state.phase === module AND state.activeTools.calculator) verbatim.
- disabled computation (exam.blocked OR exam.isSubmitting OR persistenceInteractionBlocked) verbatim — paused/disabled behavior (Desmos veil) unchanged on eligible branches.
- prewarmWhenClosed still passed unconditionally WHEN the host mounts; gating is done by not mounting the host, not by flipping the prop (keeps panel/floating-tool contracts intact).
- Desmos embed URLs, geometry persistence (satToolGeometryKey), workspace store (calculatorWorkspaceKey), drag/resize/keyboard, compact bottom-sheet presentation, reference panel, ensureDesmosPreconnect, lease-conflict notice content. No backend change.

## 6. Step-by-step implementation

All edits in src/features/student-delivery/routes/SatStudentSessionRoute.tsx only. Keep line anchors stable where possible so Phase 02 parallel diff merges cleanly.

Step 1 - Replace the warm-module computation (:133-155). Delete fallbackCalculatorModule (:143-145). Introduce the predicate from 5.2 (name: resolveCalculatorPrewarmModule or inline equivalent) implementing the truth table: current = same as todays currentCalculatorModule (:133-138), unchanged. pending = same as todays pendingCalculatorModule (:139-142), but consumed ONLY when state.phase === directions. warmModule = (phase module/review) ? current : (phase directions) ? pending : null. moduleAttemptId: prefer real attempt (stateModuleAttempt.id when current; findAttemptForModule(data, warmModule.id) otherwise); synthetic prewarm-colon-id ONLY for the directions+pending case (documented; see edge E7). Break/submitting/loading yields null, hence no host.

Step 2 - Gate host creation (:159-170). calculatorHost stays structurally identical (same props incl. prewarmWhenClosed, same key sat-calculator-warm-host) but is now null on all bare phases by construction (Step 1 yields null). No new props.

Step 3 - Rewire branches per the table (mechanical, one branch at a time): B5a section-wait :204-210 KEEP withCalculatorHost (hidden warm tree only when pending math module; R+W waits render bare automatically via predicate). B5b break-wait :212-218 KEEP withCalculatorHost (same). B5c directions :231-250 KEEP withCalculatorHost (same; terminal-recovery secondary action untouched). B6 break :255-263 STRIP to return SatBreakScreen directly (bare; timer-only screen, no tools). B7a submitting+error :270-299 STRIP to return div role=alert directly (bare; retry panel only; Phase 05 owns copy). B7b submitting-loading :301-305 STRIP to return SatLoadingSurface directly (bare; single live region). B8 state-unavailable :308-315 STRIP to return SatErrorSurface directly (bare). B9 refreshing-module :317-319 STRIP to return SatLoadingSurface Refreshing SAT module directly (bare; single live region). B10 review :331-362 KEEP withCalculatorHost (hidden warm tree preserved). B11 question-unavailable :370-377 STRIP to return SatErrorSurface directly (bare). B12 module :400-501 KEEP withCalculatorHost (open + prewarm unchanged; reference panel block :490-499 untouched).

withCalculatorHost itself (:177-197) is kept for the KEEP branches (it also renders the SatLeaseConflictNotice for non-module phases — B5/B10 still need that path; stripping the wrapper on bare branches also removes the notice there, which is correct: a full-screen loader/error must not compete with a lease banner; the notice reappears when exam chrome exists).

Step 4 - Compact-sheet sanity. No code change: not mounting the host means neither the desktop hidden node (:202-210) nor the compact hidden node (:163-167) exists on bare branches, on any viewport. Verify via test at 639px width (section 9, case C6).

Step 5 - Self-review diff. git diff --stat must show exactly one source file (SatStudentSessionRoute.tsx) + one new test file. No changes to Desmos URLs, geometry store, floating tool, reference, controller, reducer, parent route, or backend.

## 7. Important code / pseudocode

Predicate + wiring sketch (illustrative — implementer adapts to file style; Phase 01 label renames, if any, take precedence):

```tsx
// --- replaces :133-155 ---
const currentCalculatorModule =
  (state.phase === 'module' || state.phase === 'review') &&
  state.toolCapabilities.calculator &&
  exam.stateModule
    ? exam.stateModule
    : null;
const pendingCalculatorModule =
  exam.pendingModule && resolveSatToolCapabilities(exam.pendingModule.toolPolicy).calculator
    ? exam.pendingModule
    : null;

// NEW: phase-gated eligibility. No fallback scan (R2 fix — see 5.3).
const prewarmEligibleModule =
  state.phase === 'module' || state.phase === 'review'
    ? currentCalculatorModule
    : state.phase === 'directions'
      ? pendingCalculatorModule
      : null;

const prewarmAttempt = prewarmEligibleModule
  ? findAttemptForModule(data, prewarmEligibleModule.id)
  : undefined;
const calculatorModuleAttemptId =
  currentCalculatorModule && exam.stateModuleAttempt
    ? exam.stateModuleAttempt.id
    : (prewarmAttempt?.id ??
      (state.phase === 'directions' && prewarmEligibleModule
        ? 'prewarm:' + prewarmEligibleModule.id
        : null));

// --- host (:159-170) unchanged structurally; null on bare branches by construction ---
const calculatorHost = calculatorModuleAttemptId ? (
  <SatCalculatorPanel
    key='sat-calculator-warm-host'
    open={state.phase === 'module' && state.activeTools.calculator}
    scheduleId={scheduleId}
    attemptId={attemptId}
    moduleAttemptId={calculatorModuleAttemptId}
    disabled={calculatorDisabled}
    prewarmWhenClosed
    onClose={commands.closeTool}
  />
) : null;

// --- bare-branch example (B9, :317-319): was withCalculatorHost(...) ---
if (!exam.stateModule || !exam.stateModuleAttempt || !exam.stateSection) {
  return <SatLoadingSurface label='Refreshing SAT module...' />;
}
// --- eligible-branch example (B12, :400) unchanged ---
return withCalculatorHost(<>{/* shell */}</>);
```

Why gating by not-mounting instead of prewarmWhenClosed={eligible}: flipping the prop to false on bare branches would still mount SatCalculatorPanel closed-to-null path (harmless today, since :69 returns null) but leaves a mount point that future edits can re-prewarm accidentally, and still evaluates workspace/geometry hooks per render. Not mounting is total: zero iframes, zero observers, zero keys — and it is directly assertable in tests (queryByTitle(/Desmos/) returns null).

## 8. Edge cases

- E1 Directions before first module (pending null). Bootstrap may resolve data before the controller derives pendingModule (findCurrentModule(data), controller :423). Predicate yields null, hence bare directions. Correct: nothing calculator-capable is known yet; host mounts on the next render once pending resolves (no remount loop — host key is stable).
- E2 R+W directions / R+W module. Pending/current module lacks calculator cap, hence pendingCalculatorModule / currentCalculatorModule null, hence bare. Correct AND bandwidth-saving: no Desmos fetch for reading modules. Covered by test C3.
- E3 Break between sections (B6). Stripped even though a math module may follow. Justification: break screens are timer-only full-viewport surfaces; prewarming 2 Desmos embeds during a long break wastes bandwidth and risks stale geometry keys; directions (B5) re-warms before entry.
- E4 Review (B10). Host kept hidden (open=false since open requires module). Returning to the module reveals the same nodes (identity preserved — no unmount between review and module because both branches mount the host with the same key + same real attempt id).
- E5 Submitting-finalizing (B7a/B7b). Bare. Timer/persistence recovery continues underneath (controller-owned); retry button works without tools. Copy unification is Phase 05 job — do not touch copy here.
- E6 Terminated / completed (B2/B3/B4). Already bare (early returns above host computation); no action. Confirms the pattern for B6-B9-B11.
- E7 prewarm-colon-moduleId synthetic id (directions case only). Persists post-change ONLY for directions+pending-calc. Consequence: geometry/workspace keys under a synthetic id are orphaned once the real attempt starts — acceptable (matches todays behavior for that case) and bounded to one module. Do NOT extend synthetic ids to any other phase. Tests assert bare branches never produce a prewarm host (assert via zero iframes, not key internals).
- E8 Compact bottom-sheet (639px or less / 560px height or less). Closed-keepAlive compact tree (:163-167) contains iframes; gating above the panel removes it on bare branches at all widths. Test C6 renders a bare branch with compact matchMedia and asserts zero iframes.
- E9 Disabled / paused (proctor pause, isSubmitting, superseded/terminal persistence). calculatorDisabled computation unchanged; on eligible branches the paused veil still shows when open. On bare branches there is no host to veil — correct (full-screen surface owns the message). Do not add a veil to bare branches.
- E10 Lease-conflict notice. withCalculatorHost also renders SatLeaseConflictNotice for non-module phases. Stripping bare branches removes the notice there too — intended (single-surface rule: loader/error owns the screen). Module/review/directions keep it.
- E11 Rapid phase oscillation (directions to module to review). Host key (sat-calculator-warm-host) is constant; moduleAttemptId transitions prewarm-colon-id to real attempt id on module start, which remounts once (new geometry scope — correct, geometry is per-module-attempt). No per-render key churn; no effect-loop risk.
- E12 Math exam with calculator disabled by policy mid-exam. Capability flags come from state.toolCapabilities / module toolPolicy; if turned off, predicate yields null, hence host unmounts (keepAlive tree discarded, matching todays close-without-prewarm path). Re-enable re-prewarms. Acceptable and consistent with toggle semantics.

## 9. Tests

New file: src/features/student-delivery/routes/__tests__/SatStudentSessionRoute.prewarm.test.tsx.

Setup pattern (no existing route test to copy — model on SatCalculatorPanel.test.tsx harness): mock useSatExamController (vi.mock with path ../../hooks/useSatExamController) to drive state.phase, state.toolCapabilities, exam.stateModule/pendingModule/stateModuleAttempt, exam.isSubmitting/blocked, plus minimal data (sections/modules with toolPolicy, attempts). Stub matchMedia false (desktop) except C6. Use the REAL SatCalculatorPanel / DesmosCalculator / SatFloatingTool (no mocks — assert real iframes). Desmos network never resolves in jsdom; assert on iframe presence/absence + hidden state, not load completion. Coexists with Phase 01 DesmosHiddenSilence.test.tsx (interim: silence makes hidden roles harmless; post-Phase-03: bare branches have no hidden tree at all — the matrix C-cases plus the Phase 01 exactly-one-status regression must BOTH pass).

Branch matrix (each case: render route at the target phase, then assert):

- C1 submitting, no error (B7b): NO host. getByRole(status) count == 1; queryByTitle(/Desmos calculator/) null; trusted-tool probe null.
- C2 submitting + error (B7a): NO host. getByRole(alert) present; zero role=status; zero Desmos iframes.
- C3 directions, pending R+W module no calc (B5c): NO host. Directions content present; zero Desmos iframes.
- C4 directions, pending math module with calc (B5c): YES host. Zero or one visible dialog (closed = hidden tree); BOTH Desmos iframes present (prewarm works where eligible).
- C5 module, calculator closed (B12): YES host. Both iframes present hidden; open via activeTools.calculator=true yields getByRole(dialog, Calculator) visible; node identity across rerender (toBe).
- C6 B7b with compact matchMedia (matches=true): NO host. Zero Desmos iframes (compact hidden tree also gone).
- C7 break (B6): NO host. Break content present; zero Desmos iframes.
- C8 refreshing-module (B9: module phase, stateModule null): NO host. Exactly one role=status; zero Desmos iframes.
- C9 review math (B10): YES host. Review content + hidden warm tree (both iframes), no visible calculator dialog.
- C10 question-unavailable (B11): NO host. role=alert error; zero Desmos iframes.
- C11 state-unavailable (B8): NO host. Error surface; zero Desmos iframes.
- C12 module R+W no calc cap (B12): NO host. Shell present; zero Desmos iframes (fallback-removal proof).

Keep-green (run, do not modify unless Phase 01 changed shared fixtures): SatCalculatorPanel.test.tsx (prewarm identity); DesmosCalculator.test.tsx; SatFloatingCoexistence.test.tsx; SatDirectionsScreen.test.tsx, SatTransitionScreens.test.tsx, src/features/student-delivery/ui/break/* (branch surfaces).

## 10. Verification

```bash
# Typecheck + lint (touched areas)
pnpm exec tsc --noEmit
pnpm exec eslint src/features/student-delivery/routes/ src/features/student-delivery/ui/tools/

# Unit: new matrix + keep-green suites
pnpm vitest run src/features/student-delivery/routes/__tests__/SatStudentSessionRoute.prewarm.test.tsx
pnpm vitest run src/features/student-delivery/ui/tools/__tests__/SatCalculatorPanel.test.tsx src/features/student-delivery/ui/tools/__tests__/DesmosCalculator.test.tsx src/features/student-delivery/ui/tools/SatFloatingCoexistence.test.tsx

# Broader student-delivery regression (no IELTS/staff/preview change expected)
pnpm vitest run src/features/student-delivery

# E2E prewarm identity (must stay green — proves open/prewarm preserved in module)
pnpm exec playwright test --config playwright.sat-a11y.config.ts -g "prewarmed before first open"

# Manual DOM audit (dev harness, math module): on submitting/refreshing branches confirm
# document.querySelectorAll('iframe[data-desmos-mode]').length === 0 and
# document.querySelectorAll('[role="status"]').length === 1
```

## 11. Definition of done

1. B6/B7a/B7b/B8/B9/B11 return bare JSX (no withCalculatorHost); grep for withCalculatorHost( in SatStudentSessionRoute.tsx shows only the definition + B5a/B5b/B5c, B10, B12 call sites.
2. fallbackCalculatorModule is gone (grep fallbackCalculatorModule yields zero hits); no cross-exam module scan remains in the route.
3. Bare branches render ZERO hidden Desmos iframes (iframe[data-desmos-mode] absent) and ZERO competing role=status (exactly one live region on loading branches C1/C8; zero on alert branches C2/C10/C11) — proven by C1-C3, C6-C8, C10-C12.
4. Module (C5) + review (C9) + directions-with-pending-calc (C4) preserve open + prewarm behavior: both iframes mount hidden while closed, open reveals the same nodes, mode switch shows no loader; unit suites + e2e prewarmed-before-first-open green.
5. Seam respected: diff touches ONLY SatStudentSessionRoute.tsx host/branch wrapping (+ new test file). No bootstrap prop/seed rename, no controller/reducer change, no Desmos URL change, no geometry/drag/resize change, no reference change, no backend change.
6. tsc --noEmit, eslint on touched areas, and the src/features/student-delivery vitest run pass; no IELTS/staff/preview regression.

