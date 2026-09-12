# Phase 02 — Shell & Header Hierarchy (one focal point · ambient save · overflow menu)

## 1. Objective

Make the app frame calm and single-purpose:

1. **Header** collapses to: back · title block (title + one subtitle line) · **Preview** · **Release** · one `···` overflow menu · ≤ 1 status element. The Build/Overview/Issues segmented control, the progress text + `Progress` bar, the lifecycle badge, and the `Manage` menu are removed from the persistent header and relocated (see 5.3).
2. **Autosave becomes ambient**: no explicit Save control anywhere in the shell; the status slot shows only transient `Saving…/✓ Saved` and persistent exceptional states.
3. **Overflow menu** (`···`) becomes the home for exam-level secondary actions: **Load sample exam** (restores the currently dead `SampleExamLoadDialog` trigger and the e2e contract), **Import from workbook**, **Exam overview**, **Issues**, **Keyboard shortcuts**.
4. **Scroll architecture** is made explicit and fixed (header fixed, navigator fixed header/search/filter + scrolling list, canvas scrolls).

## 2. Dependencies

- Requires: Phase 01 tokens (measure + type scale + spacing).
- Blocks: Phase 04 (canvas consumes the header contract), Phase 05 (inspector mounts in the shell), Phase 07 (keyboard/palette polish).
- Owns: `spine/SpineHeader.tsx`, `spine/SpineLayout.tsx`, `AuthoringWorkspace.tsx` (**header/menu/overview wiring only**), `spine/SaveCluster.tsx` (visibility policy only), header tests.
- Does not own: `SpineQuestionView.tsx` (Phase 04 removes its `Save now`), `QuestionQueueRail.tsx` (Phase 03), `spine.css` token block (Phase 01).

## 3. Current state (verified)

```text
SpineHeader (spine/SpineHeader.tsx, 174 lines) persistent controls, left→right:
  [back] [title + Draft badge + "18 of 27 questions authored" + Progress bar]
  [Questions (compact only)] [Build|Overview|Issues segmented] [saveSlot] [Manage ▾] [Preview] [Release]
SpineLayout (spine/SpineLayout.tsx, 37 lines): header / banner / queue / main / footer slots
SpineSaveFooter (spine/SpineSaveFooter.tsx): SaveCluster + "Carry metadata" + primary "Save & Next"
AuthoringWorkspace wiring: header saveSlot=<SaveCluster>, onModeChange handles build/overview/issues,
  onOpenWorkbookImport, onOpenFullPreview, onOpenRelease, onBack, onOpenQueue
Dead code: SampleExamLoadDialog mounted at AuthoringWorkspace.tsx:1176, no opener exists.
E2E contract: e2e/sat-product-workspace.spec.ts:291 expects
  button "More authoring actions" → menuitem "Load sample exam"; line 296 expects
  text "147 of 147 questions authored" after loading.
```

## 4. Behavioral contract

- Every existing header action keeps a reachable path with the **same accessible name** where a test pins it: `Release`, `Open the full SAT preview`, `Import from workbook`.
- `workspaceMode` state and its three panes keep working. Overview and Issues move from a segmented control into the overflow menu; selecting them does exactly what `onModeChange` does today (including `openIssues()` flush-then-validate).
- `flushBeforeNavigation` still guards Preview, Release, back, workbook import — unchanged.
- Save truth is unchanged: one `SaveCluster`, one vocabulary, error = Retry button, conflict = Review button, offline = persistent amber.
- New: `Saved` is **transient** (auto-hides), `Saving…` is transient, exceptional states persist. No control disappears that carries an unresolved error.
- **Decision: the header does NOT own a readiness affordance.** Readiness lives in the canvas question header (Phase 04), next to the question it describes. The app header carries the exam-level **issue count** only, as a badge on the overflow menu item Review issues. Rationale: one readiness control, one place (AC-06); a header-level readiness pill would be a second, redundant status channel. Consequence: no readiness slot prop is introduced.

## 5. Design decisions

- **5.1 Header = 4 persistent controls.** `‹ Exams` · title block · `Preview` · `Release`, plus `···` (5th control, but a container for rare actions rather than a competing action) and one status slot. Rationale: spec §4/§18/AC-04. The `···` is visually quieter than Preview/Release.
- **5.2 Title block = title + exactly one subtitle line.** `Reading & Writing · Module 1` + lifecycle word appended only when it carries information (`Draft` for never-published, `Published` when the draft equals the published version, `Unpublished changes` otherwise). No numeric progress in the header. Rationale: spec §4 ("Do not permanently display Draft / 147 of 147 / progress bar / saved state unless the state requires attention"). Progress remains available in the navigator header (Phase 03) and the overview pane.
  - **Decision: keep a numeric progress readout, but move it into the navigator header** (`27 questions` → Phase 03 renders `18 of 27 authored` when the module is incomplete). Reason: the operator's §19 warns against status noise, but §47 requires the user to see how much work remains. The navigator is where "where am I / how much is left" belongs.
  - **Decision: delete the `Progress` bar** from the header. The exam-wide bar duplicates the navigator count and the overview pane. Reason: spec §19 ("would anything become confusing if you removed this?" — no).
- **5.3 Overview / Issues relocation.** Both become overflow-menu items (`Exam overview`, `Review issues`). Rationale: spec §1/§48 (kill competing navigation layers). The Issues pane stays the same component; only its entry point changes. The keyboard path stays (`?` help updated in Phase 07).
  - Note for the implementing agent: `workspaceMode` still drives the navigator slot; the segmented control is deleted, not hidden.
- **5.4 Save visibility policy (new component contract).**
  ```text
  status      header slot                 footer slot         persistence
  saved       "✓ Saved" (fades ~1.5s)     "Saved" quiet text   transient
  unsaved     "Editing…"                 "Editing…"           transient
  saving      "Saving…"                  "Saving…"            transient
  offline     "Offline · saved here"     same, amber          persistent
  error       "Not saved — Retry" btn    same, red            persistent
  conflict    "Changed elsewhere — Review" persistent
  ```
  Implementation: a small `useTransientFlag(status, 'saved', 1500)` hook inside `SaveCluster` — the component keeps its exact DOM contract (`role="status"`, labels from `SAVE_CLUSTER_LABELS`) so `SaveCluster.test.tsx` keeps passing; only the *rendering window* changes.
  - **Decision: the header slot renders only when status ≠ saved-and-faded.** When faded, the header shows nothing (no empty box). Reason: spec §4.
  - **Decision: the footer keeps a permanent, quiet `Saved` line.** Reason: the footer is the "this question is committed" anchor next to Save & Next; removing it entirely would make the primary action feel unanchored. This is a deliberate, documented divergence from "make saving invisible everywhere".
- **5.5 Overflow menu uses `SatMenu`** (`src/products/sat/ui/Menu.tsx`) — already Radix-based with a static fallback, roving focus, Escape restore, `separatorBefore`, `destructive`. Trigger: `compact` + `label="More authoring actions"` + `MoreHorizontal` icon. Rationale: satisfies the existing e2e selector (S16) and reuses a tested primitive instead of adding a new one.
  Menu items (order matters):
  ```text
  Exam overview
  Review issues            (badge count when > 0)
  ───────────
  Import from workbook
  Load sample exam…        (disabled when the draft already has questions unless explicitly allowed)
  ───────────
  Keyboard shortcuts
  ```
  - `Load sample exam…` opens the existing `SampleExamLoadDialog` with its existing confirm flow (it replaces the draft; the dialog already states that). Disable it when `loadSampleExam.isPending` or `isMutating`.
- **5.6 Status slot placement.** Right of Release, before `···`, min-width reserved so the header does not reflow when the label changes (prevents layout shift — spec §45). Use a fixed 96px slot at ≥1024px.
- **5.7 Fixed scroll architecture** (spec §14/§30):
  ```text
  .sat-spine                  height: 100dvh; overflow: hidden   (already true)
  .sat-spine__body            min-height: 0; overflow: hidden    (already true)
  .sat-spine__queue           fixed; internal list scrolls      (Phase 03 makes header/search/filter fixed)
  .sat-spine__main            overflow-y: auto                  (already true)
  ```
  Phase 02 adds one missing piece: the header must not scroll with the canvas. `SpineLayout` already places `header` outside `.sat-spine__main`; verify and add a comment asserting the invariant. Also add `overscroll-behavior: contain` to `.sat-spine__main` and `.sat-spine__queue` so a scroll gesture cannot chain between panes.

## 6. Detailed TODOs

### 6.1 SpineHeader rewrite

- [ ] **2.1** Replace the header body with the 4-control layout. Keep the component's exported prop interface `backwards compatible` where possible; new optional props:
  ```ts
  export interface SpineHeaderProps {
    examTitle: string;
    sectionTitle: string | null;
    moduleTitle: string | null;
    lifecycleState?: SpineLifecycleState;      // keep
    saveSlot?: ReactNode;                       // keep
    previewDisabled: boolean;                   // keep
    onOpenFullPreview: () => void;              // keep
    onOpenRelease: () => void;                  // keep
    onOpenQueue: () => void;                    // DEPRECATED - Phase 04 removes it
    onBack: () => void;                         // keep
    /** NEW — overflow menu */
    onOpenOverview: () => void;
    onOpenIssues: () => void;
    issueCount: number;
    onOpenWorkbookImport: () => void;
    workbookImportDisabled: boolean;
    onOpenSampleExam: () => void;
    sampleExamDisabled: boolean;
    onOpenShortcuts: () => void;
  }
  ```
  Removed props (and every call site): `authored`, `target`, `progressPct`, `errorCount`, `workspaceMode`, `onModeChange`, `releaseHref`. **`onOpenQueue` is kept but deprecated** (see the next bullet) so the shell keeps working until Phase 04 adds the canvas-level Questions button.
  - `errorCount` is superseded by `issueCount` feeding the menu badge.
  - `onOpenQueue` was the compact-viewport escape hatch. Replacement: the canvas header (Phase 04) exposes a `Questions` button at ≤900px; Phase 02 keeps a temporary `onOpenQueue` prop so the shell is not broken mid-initiative. **Mark it deprecated with a TODO naming Phase 04 as the removal owner.**
- [ ] **2.2** Header markup (target):
  ```tsx
  <header className="shrink-0 border-b border-border bg-card">
    <div className="mx-auto flex min-h-16 w-full max-w-[1200px] items-center gap-3 px-5 sm:px-6">
      <button aria-label="Back to SAT Exam Library" …>{ArrowLeft}<span className="hidden lg:inline">Exams</span></button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] font-semibold tracking-tight">{examTitle}</h1>
        <p className="truncate text-xs text-muted-foreground">{sectionTitle} · {moduleTitle}{lifecycleSuffix}</p>
      </div>
      {saveSlot}                           {/* SaveCluster, transient */}
      <button aria-label="Open the full SAT preview">Preview</button>
      <button>Release</button>             {/* primary */}
      <SatMenu compact label="More authoring actions" icon={MoreHorizontal} items={…} />
    </div>
  </header>
  ```
  Header height 64px (`min-h-16`) per spec §3.
- [ ] **2.3** Keep `lifecycleSuffix` logic truthful: derive from the existing `lifecycleState` prop; never claim "Published" from a draft-only signal.
- [ ] **2.4** Delete the `Progress` import and usage. Confirm no other file imports `Progress` for authoring (grep).
- [ ] **2.5** Delete the Build/Overview/Issues segmented control and the `Manage` menu; route their actions through the overflow menu.

### 6.2 AuthoringWorkspace header wiring

- [ ] **2.6** Update the `<SpineHeader …>` call site:
  - drop `authored/target/progressPct/errorCount/workspaceMode/onModeChange/releaseHref`;
  - add `onOpenOverview={() => setWorkspaceMode("overview")}`;
  - add `onOpenIssues={() => { setQuestionListOpen(false); void openIssues(); }}` (identical to today's `issues` branch);
  - add `issueCount={totalErrors}`;
  - add `onOpenSampleExam={() => setSampleDialogOpen(true)}` — **this is the S16 repair**;
  - add `sampleExamDisabled={loadSampleExam.isPending}` (the dialog itself already warns about replacing an existing draft, see 6.3);
  - add `onOpenShortcuts={() => setShortcutHelpOpen(true)}`;
  - keep `workbookImportDisabled={!shell}` and `onOpenWorkbookImport`.
- [ ] **2.7** Remove the now-unused `totalAuthored/totalTarget/progressPct/totalErrors` computations **only if** nothing else consumes them. Verified consumers today: header progress (removed) and `ExamOverviewPane` (uses its own `buildExamOverview(shell.sections)`). Keep `totalAuthored` because `SampleExamLoadDialog` takes `existingQuestionCount` and `SatWorkbookImportSheet` takes `existingQuestionCount`. Keep `totalErrors` for `issueCount`. Delete only `totalTarget` and `progressPct` if unused after the edit (grep before deleting).
- [ ] **2.8** Overview mode: when `workspaceMode === "overview"` the navigator slot renders `ExamOverviewPane` (unchanged). Ensure the overflow item is marked `current` while active (`SatMenuItem.current`) so the menu communicates state (spec §15 principle: don't describe what the UI already shows — here the pane is off-screen, so the check is warranted).
- [ ] **2.9** Issues mode: same treatment; add a numeric badge to the menu item label when `totalErrors > 0` (`Review issues (3)`) — this replaces the old red badge in the header without adding permanent chrome.

### 6.3 Sample exam flow (S16 repair)

- [ ] **2.10** Verify `SampleExamLoadDialog` props and copy: it already warns that loading replaces the draft and shows `existingQuestionCount`. Keep it as-is; do not change copy (it is owned by the import lane).
- [ ] **2.11** `handleLoadSampleExam` already: flushes, refetches the shell, loads the sample, resets selection to the first module/question, closes the dialog. Keep unchanged.
- [ ] **2.12** After load, the e2e expectation `147 of 147 questions authored` must render. Phase 03 renders that string in the navigator header for the exam/module scope; **Phase 02 must therefore not delete the string's only source** — the workspace still has `totalAuthored/totalTarget` available. Add a TODO in Phase 03 to render exactly `{authored} of {target} questions authored` in the navigator header so the e2e selector survives.
  - Guard: Phase 02 keeps a `data-testid="authoring-progress"` element? **No** — do not add test-only chrome. Instead Phase 03's navigator header renders the string as real UI text.

### 6.4 SaveCluster transient policy

- [ ] **2.13** Add a transient window to `SaveCluster`:
  ```tsx
  // New optional prop, default true (footer behaviour unchanged when false).
  transientSaved?: boolean;   // when true, hide the cluster ~1500ms after entering "saved"
  ```
  Implementation detail: a `useEffect` + `useState<boolean>` "visible" flag driven by `status`; when `status === "saved"` and `transientSaved`, start a 1500ms timer → `visible = false`; any other status → `visible = true` immediately. Reduced-motion: no fade animation, just show/hide.
  - `role="status"` stays mounted when hidden (`aria-hidden` on the inner content, or render `null` but keep a sibling live region) — **decision: render the text but hide visually via `opacity-0` with `aria-hidden="true"`**, so screen readers are not re-announced on every save. Document this in the component comment.
  - Preserve `SAVE_CLUSTER_LABELS` exports exactly (tests import it).
- [ ] **2.14** Wire `transientSaved` on the header instance only; the footer instance keeps the permanent label.
- [ ] **2.15** Extend `SaveCluster.test.tsx`: add "hides the saved label after the transient window (fake timers)" and "keeps error/offline/conflict persistent regardless of the window". Use `vi.useFakeTimers()`.

### 6.5 Scroll architecture

- [ ] **2.16** Add to `spine.css` (append-only; Phase 01 owns the token block):
  ```css
  .sat-spine__main,
  .sat-spine__queue {
    overscroll-behavior: contain;
  }
  ```
- [ ] **2.17** Add a comment to `SpineLayout` stating the invariant: "header is outside every scroll container; the navigator list is the only scrolling child of the queue; the canvas is the only scrolling child of main." No behaviour change expected — verify by reading the DOM order.

## 7. File-by-file plan

- **CHANGE** `src/features/exam-authoring/ui/spine/SpineHeader.tsx` — rewrite body; new props; delete progress/segmented/manage.
- **CHANGE** `src/features/exam-authoring/ui/spine/SaveCluster.tsx` — transient policy prop.
- **CHANGE** `src/features/exam-authoring/ui/spine/SpineLayout.tsx` — invariant comment only.
- **CHANGE** `src/features/exam-authoring/ui/AuthoringWorkspace.tsx` — header call site, overflow handlers, sample-exam opener, removal of dead progress computations.
- **CHANGE** `src/features/exam-authoring/ui/spine/spine.css` — append `overscroll-behavior` block only.
- **CHANGE** tests: `spine/__tests__/SpineHeader.test.tsx`, `spine/__tests__/SpineHeaderManage.test.tsx`, `spine/__tests__/SaveCluster.test.tsx`, `spine/__tests__/SpineOverlays.test.tsx`, `ui/__tests__/AuthoringWorkspace.test.tsx`.
- **VERIFY (no change)** `SampleExamLoadDialog.tsx`, `SatWorkbookImportSheet.tsx`, `ExamOverviewPane.tsx`, `IssuesPane` (inside AuthoringWorkspace).

## 8. Test changes (explicit, with reasons)

| Test | Change | Why |
|---|---|---|
| `SpineHeader.test.tsx` | Replace the progress assertions with: title renders, subtitle renders, `Preview`/`Release` reachable, `More authoring actions` opens a menu with the 6 items, `issueCount` badge appears only when > 0 | Header no longer carries progress; new contract is the menu |
| `SpineHeaderManage.test.tsx` | Rewrite as "overflow menu — one job per item": workbook import reachable, overview/issues reachable, sample exam reachable | `Manage` no longer exists; its job moved |
| `SaveCluster.test.tsx` | Add transient + persistence cases (6.15) | New visibility policy |
| `SpineOverlays.test.tsx` | Update "keeps import, preview, and release actions reachable in the spine header" to the new names (no `Authoring view` group, no `Manage`) | Those controls are intentionally gone |
| `AuthoringWorkspace.test.tsx` | Same selector updates + add "opening Load sample exam from the overflow menu shows the dialog" | S16 regression guard |

## 9. Error / edge matrix

| Condition | Expected | Handling |
|---|---|---|
| Save error while the user is in the overflow menu | Error stays visible after menu closes | status slot is outside the menu |
| Offline | amber persistent label, no fade | `transientSaved` only affects `saved` |
| Conflict | persistent "Changed elsewhere — Review" button | unchanged handler |
| Overflow menu opened twice quickly | one menu | `SatMenu` owns open state |
| Sample exam loaded on a non-empty draft | dialog warning shown first | existing dialog copy |
| Sample exam while a save is pending | flush first | existing `flushBeforeNavigation` in `handleLoadSampleExam` |
| `issueCount = 0` | no badge, no "0 issues" text | AC-07 |
| ≤900px viewport | header keeps back/title/Preview/Release/menu; no Questions button yet (Phase 04 adds it) | temporary `onOpenQueue` prop retained |

## 10. Test strategy & gate

```bash
npx vitest run src/features/exam-authoring
npx eslint src/features/exam-authoring
npx vite build
grep -rn "Save now" src/features/exam-authoring            # header/footer scope only; question view still has it until Phase 04
grep -rn "Authoring view" src/features/exam-authoring/ui/spine        # expect 0
grep -rn 'label="Manage"' src/features/exam-authoring/ui/spine      # expect 0
grep -rn "Progress" src/features/exam-authoring/ui/spine    # expect 0 after this phase
```

## 11. Definition of done

- [ ] Header renders exactly: back · title/subtitle · status slot · Preview · Release · `···`.
- [ ] Overflow menu reaches: Exam overview · Review issues · Import from workbook · Load sample exam · Keyboard shortcuts.
- [ ] `Load sample exam` opens the dialog (S16 fixed) and the e2e selector string exists.
- [ ] No `Save now` in the header; `Saved` fades; error/offline/conflict persist.
- [ ] No `Progress` import or Build/Overview/Issues segmented control remains.
- [ ] Authoring vitest green with the updated + new assertions; eslint clean; build passes.
- [ ] `plans/authoring-redesign/phase-02-verification-log.md` written.

