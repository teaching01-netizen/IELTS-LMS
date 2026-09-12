# Phase 3 record — protected controls, navigation, overlays (2026-09-12)

Evidence record for [phase-03-controls-navigation.md](phase-03-controls-navigation.md).

## Implemented

| Subtask | State | Evidence |
| --- | --- | --- |
| P3.1 Renderer-to-answer contract table | Done | [phase-03-answer-contract-table.md](phase-03-answer-contract-table.md): every answer-control call site inventoried (12 families across `QuestionRenderer`, `TableCompletionSlotCell`, `SubAnswerTreeQuestionList`), with shared invariants (display numbers ≠ answer identity; one mutation path; empty = `''`; flag state separate), select value/label discipline, and metadata preservation |
| P3.2 Row-geometry audit | Done (4 fixes) | Same document, audit section: (1) inline blanks moved from `text-sm` to the shared `--student-control-font-size` token; (2) MULTI_MCQ limit is no longer silent — counter is an `aria-live` status described-by every option, limit-reached state explains the remedy; (3) tree leaf flags get `flex-shrink-0` so wrapping prompts can't compress the hit area; (4) the eliminate/restore toggle joins the `student-touch-target` contract (was a sub-44px text button). Grid/hit-target/overflow checks for the remaining families passed with no changes |
| P3.3 Value-oriented protected select | Done | New `src/components/student/ProtectedExamSelect.tsx`: string value in/out, stable options with labels/descriptions/disabled, `onValueChange(value)` — no fabricated change events, no HTMLSelectElement. Committed / highlighted / latest-ref values kept distinct: arrows and typeahead never commit; Escape and outside-contact close without mutation; the latest-committed ref is the synchronous truth, so a focusout inside the option portal can never commit a highlighted-but-unselected value. Duplicate-commit guard resets when the parent replaces the answer (hydration cannot rescue over newer input, and a deliberate re-pick still flows). Lifecycle registry still receives a real element (the control root) with pagehide/visibility/freeze coverage preserved; unregistered on unmount. Empty value: Radix-only clear sentinel is intercepted before commit (never collides with authored option IDs); the compact sheet's clear action maps directly to the application's empty string |
| P3.4 One controller, two presentations | Done | Wide/standard: Radix Select anchored popper (`position="popper"`, collision-aware, scrollable, `sideOffset`) from the installed `radix-ui` package — no new dependency. Phone/compact: inline choice sheet (dialog-pattern styling) on the same controller with `aria-selected`, cancel, and Escape/outside-contact closing; commits return focus to the trigger. Presentation chosen per pane: `selectSheetPresentation` threaded `StudentMaterialWithQuestionPane` (derives `isCompact` from the P2 layout mode) → `StudentQuestionPanel` → `StudentQuestionBlockSection` (memo comparator updated) → `QuestionRenderer`. Viewport-open semantics: closing never commits; the answer controller is untouched |
| P3.3 caller migration | Done | `QuestionRenderer.tsx`: the three raw `<select>` elements (matching headings, classification categories, matching features) — which bypassed the lifecycle registry entirely — now use `ProtectedExamSelect` with stable option values (roman numerals for headings; authored strings otherwise) and unchanged `commitAnswerChange`/`updateIndexedAnswer` metadata. `ProtectedSelect.tsx` retained (zero production callers existed before; the component remains for parity until the plan's removal step confirms no callers, per the plan's own instruction to keep it until callers migrate — its only remaining references are its own suite) |
| P3.5 One navigator view model | Done | `layout/studentQuestionNavigation.ts` extended with `getStudentQuestionNavigationViewModel`: per-item stable target, facade number label, group identity, current (group-key match), answered/partial, flag; summary (total/answered/fully/partial/flagged/unanswered) and prev/next availability. Grouped-root deduplication lives here only — `StudentFooter` chips, `CompactQuestionNavigation`, and `QuestionNavigator` all consume it (footer's duplicate `dedupeGroupedScoringSlots` and the navigator's inline copy deleted). Chips now mark the whole grouped slot current exactly like the compact nav (one prior inconsistency fixed); compact nav accepts optional `answers`/`flags` from the footer. Submit stays separate from Next in every presentation |
| P3.6 tools/modals | Pre-existing, verified intact | `StudentToolsSheet` (focus trap, Escape, restore), `QuestionNavigator` dialog focus restoration — unchanged; exam tools behavior untouched per the standing constraint |
| Keyboard-only gate (exit) | Done | New `StudentKeyboardOnlyPath.test.tsx` (text: Tab→type→commit; choice: Tab→Space; select: Tab→Enter→arrows→Enter commit and Escape cancel) and `QuestionNavigatorKeyboard.test.tsx` (chip focus → Enter navigates) |

## Targeted suite coverage (new)

`ProtectedExamSelect.test.tsx` (13 tests): commit-once, highlight-vs-selected,
Escape/no-mutation, clear→empty, duplicate labels select by ID, disabled option
cannot commit, Radix keyboard-only open/highlight/commit with focus semantics,
combobox ARIA, hydration guard reset, sheet open/clear/cancel/Escape/outside,
lifecycle registration + focusout-never-commits.

## Verification results (2026-09-12)

- `npm run typecheck` — 0 errors project-wide.
- Plan's exact targeted command (ProtectedInput/ProtectedChoiceInput/ProtectedSelect/
  StudentFooterRepresentative/CompactQuestionNavigation/answerCommands): **6 files / 37 tests green**.
- New suites: ProtectedExamSelect 13/13, keyboard-only gate 5/5.
- Full student-component suite: **82 files / 558 tests, all green** (includes the three
  classification/matching tests updated to query the adapter's deterministic option ids
  instead of native `option` roles).
- P3.2 audit follow-up (same day): typecheck 0 errors; targeted suites 55/55
  (`StudentQuestionExperience` + `SubAnswerTreeQuestionList`, incl. the four new/updated
  audit tests); full student suite re-run green (82 files / 562 tests).
- Layout + provider suites: 232/233 (the 1 failure is the pre-existing, isolation-only
  `StudentNetworkProvider` timing flake documented in phase-02-record.md).

## Known failures NOT caused by this phase

- `src/test/architecture/student-exam-architecture.test.ts` — violation is
  `src/features/student/routes/StudentEntryRoute.tsx` (committed, unchanged since Sep 8;
  predates this phase; no Phase 3 file appears in any violation output).
- Other architecture suites continue to flag the parallel ACT ingestion work noted in
  phase-02-record.md.

## Test-environment note

`src/test/setup.ts` gained `hasPointerCapture`/`setPointerCapture`/`releasePointerCapture`
stubs (jsdom lacks the Pointer Capture API; Radix Select calls it at import/use time).
The compact sheet deliberately avoids Radix in tests' hot paths where noted: Radix's
open choreography is slow under jsdom (seconds per interaction), so the two desktop-menu
tests use the documented keyboard pattern and the value-semantics tests drive the
presentation-independent sheet synchronously — production code is identical for both.
