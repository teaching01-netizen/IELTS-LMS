# Phase 01 — Loading Contract + Single Surface (PLAN ONLY)

> Workflow: ai-planning-workflow | Stage: PLAN ONLY — no source edits, no implementation.
> Parent: plans-sat-loading/overall-plan.md (read it first; this file builds on it).
> Scope: SAT student exam-mode loading-state contract only. No bootstrap handoff, no branch gating,
> no controller or reducer change — those belong to Phases 02, 03, 04.
> Root causes addressed: overall-plan R1-partial (two loading skins), R2-partial (competing
> role=status nodes from hidden Desmos prewarm).

## 1. Objective

Establish one SAT loading truth that Phases 02, 03, 04 can build on, with zero behavior change
outside the loading and aria contract:

1. Define SatLoadingKind (initial | module-refresh | finalizing) and make
   SatLoadingSurface the ONLY full-screen loader on the SAT student path.
2. Silence hidden Desmos prewarm: any Desmos tree that is not visible MUST be
   aria-hidden with NO live-region roles, so a loading screen never coexists with
   hidden role=status nodes.
3. Add regression tests proving (1) and (2). Keep every existing test green
   (preview reuse, calculator prewarm identity, coexistence, save status).

Explicit non-outcome: this phase does NOT remove the admin skeleton flash, does NOT gate
withCalculatorHost off loading or error branches, does NOT change bootstrap fetch count.
Those are Phase 02 and 03 work and MUST NOT be attempted here (same-file seam discipline, see section 5).

## 2. Dependencies

None. This is Wave 1, the root of the DAG:

```
Phase 01 (this file, no deps)
  -> Phase 02 (bootstrap) + Phase 03 (prewarm gating), independent of each other
  -> Phase 04 (convergence, needs 02 + 03)
  -> Phase 05 (verification, needs 01-04)
```

Phase 02 and 03 agents will read this file plus overall-plan.md plus the repo. Everything they need
from Phase 01 is the contract in section 3 and the file table in section 4.

## 3. Contracts and interfaces

### 3a. Proposed SatLoadingKind type (new, additive)

Location: src/features/student-delivery/ui/feedback/SatStateSurfaces.tsx
(extend the existing file; do NOT create a new feedback file — the single-surface rule
says all full-screen SAT states live in that file).

```ts
// SatStateSurfaces.tsx — ADD, do not rename existing exports.
export type SatLoadingKind = "initial" | "module-refresh" | "finalizing";

export const SAT_LOADING_LABELS: Record<SatLoadingKind, string> = {
  initial: "Loading Digital SAT…",
  "module-refresh": "Refreshing SAT module…",
  finalizing: "Finalizing SAT responses…",
};

export interface SatLoadingSurfaceProps {
  /** Semantic loading reason. Drives label default plus test hooks. */
  kind?: SatLoadingKind | undefined;
  /** Explicit label override. When omitted, falls back to SAT_LOADING_LABELS[kind ?? "initial"]. */
  label?: string | undefined;
}
```

Why kind plus optional label instead of label-only: Phases 02, 03, 04 need a semantic
hook to assert on (for example, no module-refresh spinner may replace valid UI in Phase 04)
without brittle string matching, while the existing call sites keep working
unchanged during migration (a label-only call means kind initial by default). The
autoSubmitted variant (Time expired — submitting your saved answers.) stays a
label override on kind finalizing, NOT a fourth kind — see section 7, edge case 5.

### 3b. Single-surface rule (normative; Phases 02 and 03 MUST respect it)

1. SatLoadingSurface (SAT skin: .sat-ui, var(--sat-*) tokens, existing spinner
   markup) is the ONLY component permitted to render a full-screen loading state on
   the SAT student path (SatStudentSessionRoute and its descendants).
2. AppLoadingSkeleton (src/components/ui/AppLoadingSkeleton.tsx) and
   LoadingSurface (src/components/ui/LoadingSurface.tsx) MUST NOT render
   mid-exam on the SAT path after this contract lands. Enforcement lands in
   Phase 02 with the parent gate; Phase 01 only defines the rule and makes the SAT surface
   kind-aware so Phase 02 has something to gate TO.
3. No new full-screen loader component may be introduced. Inline affordances
   (SatSubmissionOverlay, SatSaveStatus, SatControlBanner) are NOT
   full-screen loaders and are out of scope for this rule.
4. No visual redesign of the spinner, no token rename (overall-plan non-goals).
   The surface keeps its exact current DOM and CSS; only props plus data attributes are added.

Probe contract (additive, keeps e2e stable):

- SatLoadingSurface root keeps role=status plus aria-live=polite and gains
  data-sat-loading-kind={kind} (default initial) so tests and e2e can assert kind
  without string matching.
- Existing label strings are frozen: Loading Digital SAT…,
  Refreshing SAT module…, Finalizing SAT responses…,
  Time expired — submitting your saved answers. (The finalizing and refresh strings
  live in SatStudentSessionRoute.tsx:302-303,318 today; Phase 04 may centralize them
  onto SAT_LOADING_LABELS — Phase 01 MUST keep call-site strings as written and only
  add the kind prop alongside them later, in the owning phase.)

### 3c. Aria contract (normative; Phases 02 and 03 MUST respect it)

1. Exactly one role=status while loading. When a full-screen SAT loading
   surface is visible, the visible document MUST contain exactly one live-region
   loader node: the own role=status of the surface. Zero competing
   role=status or role=alert loader nodes may coexist (hidden Desmos
   Loading calculator…, hidden Paused by proctor, save banners are separate
   concerns — see scoping item 4 below).
2. Hidden trees are aria-silent. Any hidden DOM (keepAlive prewarm —
   SatFloatingTool.tsx:159-167,202-210 closed branches; inactive Desmos mode
   iframes) MUST be aria-hidden (already true on the floating-tool wrappers)
   AND MUST contain NO live-region roles (role=status, role=alert,
   aria-live) in the hidden subtree. aria-hidden=true alone is NOT
   sufficient: assistive tech and bots still enumerate live roles in hidden trees
   (this is the R2 bug), so the fix must suppress the roles themselves, not just hide them.
3. Visible Desmos keeps its live regions. The active, visible calculator
   loading veil (DesmosCalculator.tsx:87-104) and the visible paused veil
   (:105-116) keep role=status — they are the own loading truth of the calculator
   when the tool is open. The contract only silences them when hidden.
4. Scoping — what this contract does NOT govern (do not touch):
   SatSaveStatus.tsx:47,63 (role=status saving and offline states), SatControlFeedback.tsx:15
   (warning banner), SatSubmissionOverlay (:72), SatReviewPage.tsx:174,
   SatAnnotatedContent.tsx:145 — these are post-load inline, save, and overlay states,
   never co-mounted with the full-screen loader in the branches Phase 01 tests.
   Phase 05 verifies no cross-talk; Phase 01 tests assert only the
   surface-versus-hidden-Desmos invariant.

## 4. Affected and new files (exact paths)

| File | Change in Phase 01 |
|---|---|
| src/features/student-delivery/ui/feedback/SatStateSurfaces.tsx (67 lines today) | ADD SatLoadingKind, SAT_LOADING_LABELS, SatLoadingSurfaceProps; extend SatLoadingSurface signature to { kind?, label? } with backward-compatible default; add data-sat-loading-kind. ONLY file with production logic change. |
| src/features/student-delivery/ui/tools/DesmosCalculator.tsx (119 lines) | ADD hidden silence: accept optional silence prop; when true, NEITHER veil renders a live role (render aria-hidden plain divs or nothing). No other change. See section 5 step 3 for the exact sketch. |
| src/features/student-delivery/ui/tools/SatFloatingTool.tsx (274 lines) | PASS-THROUGH only if needed: both keepAlive-closed branches (:163-167 compact, :202-216 desktop) already set aria-hidden plus inert. Preferred outcome: NO touch — the silence flag originates in SatCalculatorPanel (see section 5 step 2). |
| src/features/student-delivery/ui/tools/SatCalculatorPanel.tsx (120 lines) | Wire hidden flag: when !open (closed and prewarm — the keepAlive path at :69,114), render DesmosCalculator with the silence prop set. When open, silence prop unset or false. No change to mode, radiogroup, geometry, or prewarm mounting logic. |
| src/features/student-delivery/ui/feedback/__tests__/SatLoadingSurface.test.tsx (NEW) | Contract tests for the surface (section 8). |
| src/features/student-delivery/ui/tools/__tests__/DesmosHiddenSilence.test.tsx (NEW) | Hidden-silence regression tests (section 8). |
| src/features/student-delivery/routes/SatStudentSessionRoute.tsx (502 lines) | READ-ONLY in Phase 01. Call sites at :118-122 (!data), :301-305 (submitting), :317-318 (refresh skew) are the future kind adopters — DO NOT EDIT here (Phases 02, 03, 04 own them). |
| src/features/student-delivery/routes/SatPreviewRoute.tsx (:37) | READ-ONLY. Preview reuses SatLoadingSurface with label Loading SAT draft preview… — must keep rendering after the signature change (backward-compat assertion in section 8). DO NOT EDIT. |
| src/components/ui/AppLoadingSkeleton.tsx, src/components/ui/LoadingSurface.tsx | READ-ONLY. The other skin — referenced by the contract, gated in Phase 02. DO NOT EDIT. |
| src/features/student/routes/StudentSessionRoute.tsx (:49-51) | READ-ONLY. Parent admin-skeleton branch — gated in Phase 02. DO NOT EDIT. |

No new stores. No backend change. No token rename. No IELTS, staff, or preview behavior change.

## 5. Step-by-step implementation (numbered, file-by-file)

Step 0 — Baseline (no edits). Run the scoped verification in section 9 once BEFORE
changing anything; record green baseline for the suites listed there.
Read SatStateSurfaces.tsx (all 67 lines), DesmosCalculator.tsx:56-119
(render plus both veils), SatCalculatorPanel.tsx:69-119 (prewarm and keepAlive wiring),
SatFloatingTool.tsx:156-216 (both closed branches) so the exact JSX targets below match.

Step 1 — SatStateSurfaces.tsx: add the kind contract (the only production logic change).
1a. Add the SatLoadingKind type plus SAT_LOADING_LABELS map plus SatLoadingSurfaceProps
    exactly as sketched in section 3a and section 6. Export all three (tests plus Phases 02 and 03 import them).
1b. Change signature { label }: { label: string } to { kind, label }: SatLoadingSurfaceProps.
    Resolve const resolvedKind = kind ?? initial and
    const resolvedLabel = label ?? SAT_LOADING_LABELS[resolvedKind].
    Render {resolvedLabel} in the existing <p> (:59) — markup and CSS untouched.
1c. Add data-sat-loading-kind={resolvedKind} to the root (:49-53, alongside
    existing role=status and aria-live=polite). Do NOT change role, live regions, or classNames.
1d. Keep the spinner div (:55-58 motion-reduce:hidden plus skeleton bars :60-63)
    byte-identical — no visual redesign.
1e. Typecheck: label becomes optional, so all existing call sites
    (SatStudentSessionRoute:120,302,318 plus SatPreviewRoute:37) still compile
    with zero edits. Verify with tsc --noEmit before proceeding.

Step 2 — Decide the hidden-silence mechanism (no code yet). The constraint:
SatFloatingTool receives opaque children: ReactNode — it cannot cheaply inject
a prop into DesmosCalculator two levels down. Therefore the silence flag MUST
originate in SatCalculatorPanel (which owns both open and the
DesmosCalculator element at :99-103), NOT in SatFloatingTool.
Recommended: const hidden = !open; in SatCalculatorPanel, passed as a silence prop
(name to be confirmed, see section 6) to DesmosCalculator.
SatFloatingTool needs NO change under this mechanism (its closed wrappers
already set aria-hidden=true plus inert plus hidden). If — and only if — the
implementation agent finds a hidden-live-role path that bypasses SatCalculatorPanel
(for example a compact-sheet branch rendering children outside the panel), a
pass-through prop may be added to SatFloatingTool, but children must not be cloned or replaced.

Step 3 — DesmosCalculator.tsx: silence live regions when hidden.
3a. Add optional prop, for example silenceLiveRegions?: boolean (default false).
    Document: set when the calculator tree is hidden (keepAlive prewarm while the
    tool is closed). Suppresses all live-region roles in the hidden subtree per
    the Phase 01 aria contract; visible behavior unchanged.
3b. Loading veil (:87-104): when silenceLiveRegions is true, render the veil
    WITHOUT role=status or aria-live (keep data-desmos-loading plus visual
    divs so prewarm-identity tests still find the tree), wrapped in an
    aria-hidden=true container — OR render nothing if !activeReady is purely
    a loading transient (preferred: keep the div, strip the roles — preserves DOM
    shape for keepAlive identity, see section 6 sketch).
3c. Paused veil (:105-116): same treatment — strip role=status,
    aria-live, and aria-atomic when silenced. (Paused plus hidden is rare — disabled
    while closed — but the contract is unconditional: NO live roles in hidden trees.)
3d. Visible path (silenceLiveRegions false or omitted) MUST be byte-identical JSX to
    today — all existing DesmosCalculator.test.tsx assertions (titles, block and hidden
    classes, Loading calculator… text present when visible, Paused by proctor
    text when visible plus disabled) keep passing unchanged.
3e. Do NOT change iframe mounting (:67-86), prewarmInactiveModes, refs,
    focus-blur effect (:44-51), or DESMOS_EMBED_URLS.

Step 4 — SatCalculatorPanel.tsx: wire the flag (thin wiring only).
4a. Compute const desmosHidden = !open; (covers both closed states: early return
    at :69 when no prewarm — unmounted, nothing to silence — and keepAlive at
    :106-119 when prewarmWhenClosed — hidden, must silence).
4b. Pass silenceLiveRegions={desmosHidden || undefined} (or ={desmosHidden})
    into the DesmosCalculator element at :99-103. Nothing else in this file changes:
    NOT the prewarmInactiveModes={prewarmWhenClosed || open} expression (:102),
    NOT the radiogroup (:77-97), NOT geometry, workspace, or mode logic, NOT the
    keepAlive={prewarmWhenClosed} prop (:114).
4c. Do NOT touch SatFloatingTool.tsx if 4a and 4b suffice (expected). The closed
    wrappers (:164 compact aria-hidden inert, :207-209 desktop
    aria-hidden hidden inert) already hide the tree; the panel flag removes the
    roles inside it.

Step 5 — Add kind at ZERO call sites. Deliberately: Phase 01 proves the surface
accepts kind via unit tests (section 8) but leaves all four call sites
(SatStudentSessionRoute:120,302,318, SatPreviewRoute:37) on label-only props.
Wiring kind values into route branches is
Phase 02, 03, 04 work (they own those branches and the bootstrap semantics). An
implementation agent that adds kind to route call sites in Phase 01
is violating the seam and must not do so.

Step 6 — Write the two new test files (section 8), then run section 9 verification.
Fix ONLY failures caused by the new props (for example a strict prop-type mock); any
failure in preview, coexistence, or save-status suites is a stop-and-investigate signal,
not something to resolve by editing the production code of those suites.

### What NOT to change (hard boundaries — violations fail review)

- SatStudentSessionRoute.tsx branches, calculatorWarmModule and fallbackCalculatorModule
  (:133-170), withCalculatorHost (:177-197), ensureDesmosPreconnect (:103-105):
  ALL Phase 03. Do not gate, unwrap, reorder, or add kind here.
- StudentSessionRoute.tsx:49-51 parent skeleton, useStudentSessionRouteData,
  assessmentDeliveryApi, useSatExamController bootstrap: ALL Phase 02 and 04. Do not touch.
- satRunnerReducer, satRuntimeSelectors, polling, candidateId identity: Phase 04. Do not touch.
- Submitting branch copy and pattern (:265-306), SatControlFeedback.tsx,
  SatSaveStatus.tsx, SatReviewPage.tsx, SatAnnotatedContent.tsx: do not touch.
- SatPreviewRoute.tsx, IELTS surfaces, staff workspace (products/sat): do not touch.
- No spinner CSS, no token rename, no new store, no backend or payload change.

## 6. Important code and pseudocode

Type plus surface (extends SatStateSurfaces.tsx:47-67; existing JSX preserved,
only the signature, root attrs, and label resolution change):

```tsx
// SatStateSurfaces.tsx — proposed addition (names normative except where noted).
export type SatLoadingKind = "initial" | "module-refresh" | "finalizing";

export const SAT_LOADING_LABELS: Record<SatLoadingKind, string> = {
  initial: "Loading Digital SAT…",       // matches route :120 today
  "module-refresh": "Refreshing SAT module…", // matches route :318 today
  finalizing: "Finalizing SAT responses…",     // matches route :303 default today
};

export interface SatLoadingSurfaceProps {
  kind?: SatLoadingKind | undefined;
  label?: string | undefined;
}

export function SatLoadingSurface({ kind = "initial", label }: SatLoadingSurfaceProps) {
  const resolvedLabel = label ?? SAT_LOADING_LABELS[kind];
  return (
    <div
      // existing className, role=status, aria-live=polite — all unchanged
      data-sat-loading-kind={kind} // new probe attr; everything else identical
    >
      // ... existing spinner plus label plus skeleton bars, unchanged ...
      <p>{resolvedLabel}</p>
      // ...
    </div>
  );
}
```

Desmos aria fix sketch (modifies DesmosCalculator.tsx:87-116 only):

```tsx
// DesmosCalculator.tsx — proposed prop plus veil change (prop name advisory;
// behavior normative: hidden means zero live roles in subtree).
export interface DesmosCalculatorProps {
  mode: DesmosCalculatorMode;
  disabled?: boolean;
  prewarmInactiveModes?: boolean;
  // Phase 01 aria contract: set when this tree is hidden (tool closed or
  // keepAlive prewarm). Strips live-region roles; visible output unchanged.
  silenceLiveRegions?: boolean | undefined;
}

// Loading veil — visible path (unchanged JSX):
// {!activeReady && !silenceLiveRegions ? (
//   <div role=status aria-live=polite data-desmos-loading>…Loading calculator…</div>
// ) : null}
// Loading veil — hidden path (aria-silent: same DOM shape, no live roles):
// {!activeReady && silenceLiveRegions ? (
//   <div aria-hidden=true data-desmos-loading>…visuals only…</div>
// ) : null}

// Paused veil — same pattern:
// {disabled && !silenceLiveRegions ? (
//   <div role=status aria-live=polite aria-atomic=true>…Paused by proctor</div>
// ) : null}
// {disabled && silenceLiveRegions ? (
//   <div aria-hidden=true>…Paused by proctor (no live role)…</div>
// ) : null}
```

Panel wiring sketch (modifies SatCalculatorPanel.tsx:99-103 only):

```tsx
// SatCalculatorPanel.tsx — one-line wiring (variable name advisory).
// const desmosHidden = !open;
// <DesmosCalculator
//   mode={mode}
//   disabled={disabled}
//   prewarmInactiveModes={prewarmWhenClosed || open}  // unchanged
//   silenceLiveRegions={desmosHidden || undefined}
// />
```

Alternative the implementation agent MUST NOT choose: gating iframe mounting
(prewarmInactiveModes, mountedModes, keepAlive) in Phase 01 — that is
Phase 03 ownership (host scoping). Phase 01 silences roles; iframes still mount.

## 7. Edge cases

1. Reduced motion. Spinner div is motion-reduce:hidden (SatStateSurfaces:56);
   skeleton bars are motion-reduce:animate-none. The kind extension MUST NOT
   alter these classes. Test sketch: render surface and assert role=status plus label
   still present (visual hiding is CSS-only; jsdom cannot assert it — assert DOM stability).
2. Compact sheet. SatFloatingTool compact-closed branch (:163-167) wraps
   children in a hidden aria-hidden inert div WITHOUT the desktop hidden attr.
   The panel-level silence flag covers BOTH presentations (it sits inside children,
   below the wrapper), so no presentation-specific logic is needed. Test BOTH (section 8).
3. Disabled and paused. DesmosCalculator disabled shows the Paused by proctor
   veil (:105-116, second role=status). Matrix: open-plus-disabled keeps ONE live role
   in the calculator (visible, correct); closed-plus-disabled has ZERO (silenced).
   Note: closed-plus-disabled arises only via keepAlive prewarm while blocked; the panel
   passes both disabled (from route :158) and the silence flag — silence wins for roles,
   visuals stay.
4. Both Desmos modes. prewarmInactiveModes mounts scientific plus graphing. The
   loading veil is singular (gated on activeReady = loadedModes.has(mode)),
   so silencing it once covers both iframes — but the test MUST render
   prewarmInactiveModes with neither iframe loaded and assert ZERO
   role=status (catches a future per-mode veil regression).
5. AutoSubmitted finalizing label. Route :303 uses a ternary
   (exam.autoSubmitted ? Time expired — … : Finalizing SAT responses…).
   This is a LABEL override on kind finalizing, not a new kind — Phase 01
   must not add a time-expired member to the union. Future Phase 04 may map it via
   a label override for the autoSubmitted case.
6. Preview reuse. SatPreviewRoute:37 renders
   SatLoadingSurface with label Loading SAT draft preview… (non-canonical
   label). Backward compat (optional label, default kind initial,
   data-sat-loading-kind=initial) keeps it compiling and rendering. Test asserts
   it (keeps staff preview green; no preview behavior change).
7. inert plus hidden interaction. Desktop closed wrapper sets
   hidden plus inert plus aria-hidden; hidden removes layout but does NOT remove AT
   enumeration of live roles in all screen-reader and bot pipelines — hence stripping roles,
   not relying on the wrapper. Do not resolve by removing hidden or inert (prewarm
   identity plus focus safety depend on them; SatCalculatorPanel.test.tsx:35-59
   asserts same-node survival).
8. Prewarm-identity preservation. SatCalculatorPanel.test.tsx:35-59
   (closed-to-open same iframe nodes) and DesmosCalculator.test.tsx:21-35
   (mode-switch mount retention) MUST keep passing unmodified. The silence approach
   (strip roles, keep divs) was chosen over conditional-unmount precisely to avoid
   breaking node identity. If either test breaks, the implementation is wrong —
   revert to role-stripping; do not update those tests.
9. Skeleton-bar aria-hidden. Surface :60-63 decorative bars are already
   aria-hidden=true — keep. New data-sat-loading-kind attr must not be
   placed on an aria-hidden subtree (place on root).

## 8. Tests

### New file 1: src/features/student-delivery/ui/feedback/__tests__/SatLoadingSurface.test.tsx

(Covers the contract; no existing file covers SatStateSurfaces — glob
**/*SatStateSurface* returns only the component itself.)

Assertion sketch — implementation agent expands to full RTL assertions:

- defaults to kind initial with the cold-open label and probe attr: render
  SatLoadingSurface with no props; getByRole status has text Loading Digital SAT…
  and attribute data-sat-loading-kind=initial.
- each kind renders its canonical label: it.each over initial, module-refresh,
  finalizing — render SatLoadingSurface with kind; expect getByRole status to have
  text SAT_LOADING_LABELS[kind].
- label overrides the canonical string but keeps the kind probe: render
  SatLoadingSurface kind finalizing with label Time expired — submitting your saved answers.;
  root has the override text and data-sat-loading-kind=finalizing.
- legacy label-only call still renders (backward compat for route plus preview call sites):
  render SatLoadingSurface with label Loading SAT draft preview…;
  expect getByRole status to have that text.
- exposes exactly one live region: container querySelectorAll for role=status has length 1.

### New file 2: src/features/student-delivery/ui/tools/__tests__/DesmosHiddenSilence.test.tsx

(Covers R2-partial; complements — never edits — DesmosCalculator.test.tsx (3 tests),
SatCalculatorPanel.test.tsx (4 tests including prewarm identity), SatFloatingCoexistence.test.tsx (6 tests).)

Assertion sketch — implementation agent expands; stub matchMedia false plus true for both presentations:

- visible calculator keeps its loading live region: render DesmosCalculator mode scientific;
  expect getByRole status to have text Loading calculator….
- silenced calculator exposes zero live roles (loading veil): render DesmosCalculator
  mode scientific with prewarmInactiveModes plus silenceLiveRegions; expect
  container querySelectorAll for role=status, role=alert, and aria-live to have length 0;
  expect container querySelector for data-desmos-loading to be present (tree preserved).
- silenced plus disabled exposes zero live roles (paused veil): render DesmosCalculator
  mode graphing with disabled plus silenceLiveRegions; expect zero live roles as above.
- closed prewarm panel composes to zero live roles (both presentations): render
  SatCalculatorPanel open false with prewarmWhenClosed under matchMedia false, then true;
  assert zero live roles AND both Desmos iframes still mounted.
- loading screen plus hidden prewarm yields exactly one role=status (the R2 regression):
  render SatLoadingSurface kind initial alongside SatCalculatorPanel with open false
  and prewarmWhenClosed; expect getAllByRole status to have length 1.

Base props for panel tests — copy from SatCalculatorPanel.test.tsx:5-11
(scheduleId, attemptId, moduleAttemptId, onClose) plus window.sessionStorage.clear() in
beforeEach. matchMedia stub — copy the same file section :17-32 block verbatim
(matches false for desktop, plus one run with matches true for compact).

### Existing suites to keep green (DO NOT EDIT these files in Phase 01)

- src/features/student-delivery/ui/tools/__tests__/DesmosCalculator.test.tsx — 3 tests
  (single-mode mount, mode-switch retention, paused focus). Visible path unchanged, so green as written.
- src/features/student-delivery/ui/tools/__tests__/SatCalculatorPanel.test.tsx — 4 tests
  (prewarm identity :35-59 is the tripwire — see section 7 item 8; unmount-on-close; mode persist; arrow keys).
- src/features/student-delivery/ui/tools/SatFloatingCoexistence.test.tsx — 6 tests
  (dialogs, keyboard grip, Escape, chrome tokens, compact sheet, closed-renders-nothing).
  Untouched if SatFloatingTool.tsx is untouched (expected).
- src/features/student-delivery/routes/__tests__/SatPreviewRoute.test.tsx — staff preview
  shell and adaptive-module test; exercises the preview SatLoadingSurface loading branch
  transiently. Backward-compat assertion covers it.
- src/features/student-delivery/ui/feedback/SatSaveStatus.test.tsx — save-status single-surface
  contract; out of scope, must stay green (proves no live-region cross-talk).
- src/hooks/__tests__/useDelayedLoading.test.ts — generic delayed-loading hook; unrelated,
  run to prove no shared-loading-utility regression.

## 9. Verification (scoped commands — run from repo root)

```bash
# 1. Baseline BEFORE edits (record), then re-run AFTER:
npx tsc --noEmit
# 2. Scoped unit tests (new plus existing — the Phase 01 gate):
npx vitest run src/features/student-delivery/ui/feedback/__tests__/SatLoadingSurface.test.tsx \
  src/features/student-delivery/ui/tools/__tests__/DesmosHiddenSilence.test.tsx \
  src/features/student-delivery/ui/tools/__tests__/DesmosCalculator.test.tsx \
  src/features/student-delivery/ui/tools/__tests__/SatCalculatorPanel.test.tsx \
  src/features/student-delivery/ui/tools/SatFloatingCoexistence.test.tsx \
  src/features/student-delivery/routes/__tests__/SatPreviewRoute.test.tsx \
  src/features/student-delivery/ui/feedback/SatSaveStatus.test.tsx
# 3. Lint touched areas only:
npx eslint src/features/student-delivery/ui/feedback/SatStateSurfaces.tsx \
  src/features/student-delivery/ui/tools/DesmosCalculator.tsx \
  src/features/student-delivery/ui/tools/SatCalculatorPanel.tsx \
  src/features/student-delivery/ui/tools/SatFloatingTool.tsx \
  src/features/student-delivery/ui/feedback/__tests__/SatLoadingSurface.test.tsx \
  src/features/student-delivery/ui/tools/__tests__/DesmosHiddenSilence.test.tsx
# 4. Full-suite sanity (optional but recommended before handoff):
npx vitest run src/features/student-delivery
```

jsdom notes: Desmos iframes never load in tests (no network) — loadedModes stays
empty, so veils render deterministically. window.innerWidth access in
SatCalculatorPanel:111 needs no stub when rendering closed (early return or
hidden shell); open-panel tests already rely on the existing matchMedia stub.
No e2e in Phase 01 (flicker and a11y e2e is Phase 05).

## 10. Definition of done (checkable — Phases 02 and 03 build on these)

- [ ] SatLoadingKind (initial | module-refresh | finalizing) plus SAT_LOADING_LABELS
      plus SatLoadingSurfaceProps exported from SatStateSurfaces.tsx; surface accepts
      { kind?, label? }, defaults kind to initial, resolves label via map, renders
      data-sat-loading-kind; spinner, CSS, and markup otherwise identical (no visual diff).
- [ ] All four existing call sites compile plus render UNCHANGED (zero edits to route and preview files):
      SatStudentSessionRoute:120,302,318 and SatPreviewRoute:37.
- [ ] Hidden Desmos emits ZERO live roles: DesmosCalculator silence prop exists, wired in
      SatCalculatorPanel for !open; new DesmosHiddenSilence.test.tsx passes including the
      loading-screen-plus-hidden-prewarm regression (exactly one role=status) for both presentations,
      both Desmos modes, and the disabled and paused matrix.
- [ ] New SatLoadingSurface.test.tsx passes (defaults, per-kind labels, override plus probe,
      legacy label-only compat, single-live-region count).
- [ ] Existing suites green UNMODIFIED: DesmosCalculator (3), SatCalculatorPanel (4, including
      prewarm identity), SatFloatingCoexistence (6), SatPreviewRoute, SatSaveStatus, useDelayedLoading.
- [ ] npx tsc --noEmit clean; scoped npx eslint clean on all touched files.
- [ ] No edits outside section 4 Change rows (reviewer checks git status — only 3 production files
      maximum plus 2 new test files).
- [ ] Contract Phases 02 and 03 MUST respect (normative handoff):
  1. SatLoadingSurface is the ONLY full-screen loader on the SAT student path; never add another,
     never render AppLoadingSkeleton or LoadingSurface mid-exam (Phase 02 enforces the parent gate).
  2. Route branches address the surface by kind (initial means cold open for !data;
     module-refresh means transient skew with no resolvable module; finalizing means
     phase submitting finalization) plus label override ONLY for the autoSubmitted Time expired variant.
  3. Exactly one role=status while loading; hidden trees (keepAlive prewarm or any future
     hidden tool) MUST be aria-hidden with NO live-region roles — silence via the
     silenceLiveRegions-style prop, never by relying on the wrapper alone.
  4. Error branches (SatErrorSurface role=alert) never co-mount a loading surface or a
     prewarmed tool host (Phase 03 enforces bare error branches; Phase 01 silence makes
     coexistence harmless in the interim).
  5. Label strings in section 3b are frozen; new loading copy goes through SAT_LOADING_LABELS.

(End of Phase 01 plan.)