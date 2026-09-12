# Phase 08 — Final Integration & Verification

## 1. Objective

Prove the initiative shipped what it claimed, on the real repository, and route any failure back to the owning phase. This phase writes **no product code**; it produces evidence and, when needed, repair instructions.

## 2. Dependencies

- Requires: Phases 01–07 verified.
- Blocks: nothing (terminal phase).
- Owns: `plans/authoring-redesign/phase-08-verification-log.md` and repair routing only.

## 3. Verification sequence

### 3.1 Gate (mechanical)

```bash
# 1. unit + component tests, authoring scope
npx vitest run src/features/exam-authoring

# 2. full frontend suite (catch cross-surface regressions: .sat-ui, IELTS, builder)
npx vitest run

# 3. lint (authoring scope first, then repo)
npx eslint src/features/exam-authoring
npx eslint .

# 4. production build
npx vite build
```

Record: command, exit code, pass/fail counts, and any pre-existing failures with a note that they predate the initiative (compare against the Phase-01 baseline run).

**Known baseline limitation (must be restated in the log):** `npx tsc --noEmit` heap-OOMs (exit 134) in this repo before and after; the Playwright runner is blocked by an unrelated backend compile error (`e2e/TEST_STATUS.md` §1). Neither is caused by this initiative; both are recorded as environment limitations, not passes.

### 3.2 Acceptance criteria audit (AC-01 … AC-20)

For each criterion, produce a **grep or test reference** — not an opinion.

| AC | Evidence command / test |
|---|---|
| AC-01 | `grep -rn "SpineStageNav\|SpineStep\|useStageCollapse" src/features/exam-authoring` → 0 |
| AC-02 | `grep -rn "spine-card" src/features/exam-authoring/ui/spine` → only `ReleaseGateCard`; count `<div className=".*border.*rounded` in the canvas ≤ 2 |
| AC-03 | `grep -n "spine-measure\|spine-rail\|spine-inspector" src/features/exam-authoring/ui/spine/spine.css` + `spineTokens.test.ts` |
| AC-04 | `SpineHeader.test.tsx` control inventory |
| AC-05 | `grep -rn "Save now" src/features/exam-authoring` → 0; `SaveCluster.test.tsx` transient case |
| AC-06 | `ReadinessControl.test.tsx` + `AuthoringWorkspace.test.tsx` issue-jump case |
| AC-07 | `QuestionFilterMenu.test.tsx` zero-count case; `grep -rn "Errors 0\|0 issues" src/features/exam-authoring` → 0 |
| AC-08 | `QuestionQueueRail.test.tsx` row contract; `grep -rn 'getByText("Current")' src/features/exam-authoring` → 0 |
| AC-09 | `grep -rn "Duplicate" src/features/exam-authoring/ui/spine` → menu-only usages |
| AC-10 | `ComposerToolbar.test.tsx` default-control count + menu names |
| AC-11 | `grep -rn "Classification" src/features/exam-authoring/ui/spine/SpineQuestionView.tsx` → 0 |
| AC-12 | `spineColorSemantics.test.ts` offender list empty |
| AC-13 | `grep -rn "uppercase tracking" src/features/exam-authoring/ui/spine` → 0 section labels |
| AC-14 | `AuthoringWorkspace.test.tsx` keyboard cases + `ShortcutHelpDialog` map parity test |
| AC-15 | `AuthoringWorkspace.test.tsx` "only the active editor mounts" + navigator scroll containment assertion |
| AC-16 | existing autosave durability/offline tests + navigation flush tests (unchanged, must stay green) |
| AC-17 | `ReleaseGateCard.test.tsx` + `ReleaseReadinessParity.test.tsx` (unchanged) |
| AC-18 | `a11y.test.tsx` + static checklist in the log |
| AC-19 | `git diff --stat` filtered to forbidden paths → empty |
| AC-20 | 3.1 gate results |

### 3.3 Scope proof

```bash
git diff --stat -- src/products/sat src/features/student-delivery backend api src/features/student src/features/proctor src/features/admin
# expect: empty output for the initiative's commits/edits
git diff --stat -- src/features/exam-authoring src/index.css
# expect: only the owned files
```

⚠️ This worktree contains many unrelated in-flight modifications. The scope proof must therefore be run as a **path-filtered diff against the pre-initiative state of the owned files**, not against `HEAD`. Practical method: capture `md5` of the forbidden paths at Phase 01 start (baseline manifest) and compare at Phase 08. **Phase 01 must create `plans/authoring-redesign/baseline-manifest.txt`** with `find <forbidden paths> -type f | sort | xargs md5sum` output. If Phase 01 did not, Phase 08 reconstructs it from the git index for untouched paths and documents the limitation.

### 3.4 E2E selector audit (static)

The Playwright runner is unavailable; perform a selector-by-selector audit of the authoring specs against the new UI:

```bash
grep -n "getByRole\|getByText\|getByLabel\|getByTestId" e2e/sat-product-workspace.spec.ts \
  e2e/exam-builder-workflow.spec.ts e2e/exam-builder-full-cycle.spec.ts e2e/staff-draft-durability.spec.ts
```

For every selector, record: exists / renamed / removed, with the source line proving it. Required outcomes:

| Selector | Required state |
|---|---|
| `button "More authoring actions"` | exists (Phase 02) |
| `menuitem /Load sample exam/` | exists (Phase 02) |
| `text "147 of 147 questions authored"` | exists (Phase 03 navigator header) |
| `button "Release"` | exists (Phase 02) |
| `text "Ready to publish"` | unchanged (release page, out of scope) |
| `button "Publish"` | unchanged |

If a spec must change, the change is justified in the log and limited to selectors that no longer exist by design.

### 3.5 Cross-phase integration checks

- [ ] **I-1** Header ↔ canvas: readiness, save, preview, release all reachable; no duplicate controls.
- [ ] **I-2** Navigator ↔ canvas: selection, per-row Duplicate/Delete, reorder, empty slots.
- [ ] **I-3** Inspector ↔ canvas: classification edits autosave; issue jumps land on the right field; closing the inspector preserves the canvas scroll.
- [ ] **I-4** Editor ↔ canvas: math/image/table inserts survive autosave and question switching; answer options serialize unchanged.
- [ ] **I-5** Palette ↔ everything: every command maps to a handler that works; no command is a dead end.
- [ ] **I-6** Keyboard: the full map works with no overlay open and is inert with one open.
- [ ] **I-7** Durability: type → navigate away → return; offline edit → reconnect; conflict path; all unchanged from baseline.
- [ ] **I-8** 147-question scale: load the sample exam (via the restored menu item) and measure: shell interactive, first paint of the navigator, question switch latency, editor input latency. Record numbers; compare to the Phase-01 baseline if one was captured, otherwise record absolute values and flag the missing baseline.
- [ ] **I-9** Release path end to end: readiness blockers enumerated, publish blocked while blocking issues exist, publish succeeds when clean (against the test backend if available; otherwise static proof via `releaseSelectors` tests).

### 3.6 Residual-risk register

Write down, explicitly:

- anything the spec asked for that was **deliberately omitted** (per-row Replace, per-row Preview, link control, collapsible sections, virtualisation if not needed) with the reason;
- anything deferred to a later initiative (real e2e run, visual regression, dark-mode-specific tuning of new surfaces);
- anything that could regress under load (navigator rendering with 147 rows — the Phase 07 decision, if virtualisation was skipped, must be justified with the measured paint time).

## 4. Repair routing

| Failure | Owning phase |
|---|---|
| Token/measure/CSS contract test | 01 |
| Header/menu/save-visibility | 02 |
| Navigator rows/filter/row menu | 03 |
| Canvas sections/readiness/inline errors | 04 |
| Inspector/layout/classification jump | 05 |
| Editor toolbar/context/answer rows | 06 |
| Palette/keyboard/motion/loading/a11y | 07 |
| Cross-cutting or ambiguous | Main Agent decides and re-sequences |

A repair is complete only when the phase's own gate re-runs green **and** the Phase-08 gate re-runs green.

## 5. Definition of done

- [ ] 3.1 gate results recorded with raw output.
- [ ] AC table filled with evidence for all 20 criteria.
- [ ] Scope proof recorded (with the worktree caveat).
- [ ] E2E selector audit table complete.
- [ ] I-1 … I-9 recorded, each with a command or a test name.
- [ ] Residual-risk register written.
- [ ] `plans/authoring-redesign/phase-08-verification-log.md` committed to the plan tree (not to git).
- [ ] Initiative declared complete **only** if every AC has evidence and no repair is outstanding.

