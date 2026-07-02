---
phase: task-6-question-navigator-dialog
reviewed: 2026-07-02T12:15:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/components/student/QuestionNavigator.tsx
  - src/components/student/StudentListening.tsx
  - src/components/student/__tests__/StudentQuestionExperience.test.tsx
findings:
  critical: 0
  warning: 5
  info: 1
  total: 6
status: issues_found
---

# Phase Task-6: Code Review Report — QuestionNavigator Dialog Conversion

**Reviewed:** 2026-07-02T12:15:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

This diff converts QuestionNavigator from a div-based modal (`<div role="dialog">`) to a native `<dialog>` element, adds a cleanup effect for proper teardown, and bundles two unrelated changes: a refactor in StudentListening.tsx (replacing a raw property check with `isInstructionReferencePlacement()`) and a new test for instruction-placed listening diagrams.

The core dialog conversion is functionally correct — the dialog opens on mount, closes on unmount, and the parent's conditional rendering (`{showNavigator ? <QuestionNavigator /> : null}`) drives the lifecycle. However, there are five quality issues: an architectural inconsistency with the other dialog conversions, a lifecycle double-fire bug, a redundant CSS class, scope creep from unrelated changes, and missing test coverage for the dialog itself. No critical/blocker issues were found.

## Structural Findings (fallow)

None provided.

## Narrative Findings (AI reviewer)

### Strengths

- **Clean architectural choice**: Using mount/unmount to drive dialog lifecycle is simpler than the `isOpen` prop pattern used by HelpModal/AccessibilitySettings, and works well with the parent's `{showNavigator ? ... : null}` conditional rendering.
- **Good cleanup guard**: The `if (dialog.open) { dialog.close(); }` guard in the cleanup prevents errors when the browser has already closed the dialog (e.g., via ESC).
- **Accessible markup preserved**: `aria-labelledby="question-navigator-title"` correctly links to the heading, `aria-label` on the close button is present, and focus trapping is handled natively by `<dialog>`.
- **Tailwind v4 `backdrop:` variant used correctly**: In Tailwind v4, `backdrop:bg-black/50` targets `::backdrop`, which is the correct pseudo-element for dialog backdrops.
- **Unrelated StudentListening.tsx change is correct**: `!isInstructionReferencePlacement(block)` is functionally equivalent to `block.referenceImagePlacement !== 'instruction'` for the already-filtered `DiagramLabelingBlock` array, but uses the proper utility function.

---

## Warnings

### WR-01: Cleanup double-fires `onClose` when X button is clicked

**File:** `src/components/student/QuestionNavigator.tsx:82-96`

**Issue:** The close button's `onClick={onClose}` calls `onCloseNavigator()` directly (updating parent state to `showNavigator = false`), which unmounts the component. The cleanup effect then runs and calls `dialog.close()` because `dialog.open` is still `true` (the button click did not close the dialog natively). The browser fires a `close` event from `dialog.close()`, which routes back to the React `onClose` handler, calling `onCloseNavigator()` a second time.

The second call is currently idempotent (`setShowNavigator(false)` when already `false`), but this creates a fragile pattern — any future side effects in the close handler (analytics, timers, state machine transitions) would fire twice.

**Sequence:**
1. User clicks X button → `onClick={onClose}` → `onCloseNavigator()` → `setShowNavigator(false)`
2. React unmounts `QuestionNavigator` → cleanup runs
3. `dialog.open` is `true` → `dialog.close()` called → browser fires `close` event
4. `onClose` handler fires → `onCloseNavigator()` called again (no-op now, but fragile)

**Fix:** Change the X button to close the dialog natively instead of calling the prop directly:

```tsx
<button
  onClick={() => dialogRef.current?.close()}
  className="p-2 md:p-2.5 text-gray-500 hover:bg-gray-100 rounded-md"
  aria-label="Close question navigator"
>
  <X size={18} />
</button>
```

This way: button click → `dialog.close()` → browser fires `close` event → `onClose` fires once → cleanup sees `dialog.open === false` → guard prevents double close.

---

### WR-02: Architectural inconsistency with other dialog conversions

**File:** `src/components/student/QuestionNavigator.tsx:32-45`

**Issue:** The other dialogs converted in Tasks 2–5 (HelpModal, AccessibilitySettings, ExitConfirm, TimeExtension) all follow the same pattern: they accept an `isOpen` prop and use `useEffect([isOpen])` to sync the dialog's open state with React state. QuestionNavigator uses a fundamentally different pattern — no `isOpen` prop, mount/unmount-driven lifecycle, and `useEffect([], [])` with cleanup.

While both patterns work, the inconsistency makes the codebase harder to maintain and reason about. A developer familiar with the HelpModal pattern would expect QuestionNavigator to follow the same convention.

**Why it matters:** AGENTS.md states: "Prefer module-local changes over cross-cutting edits." The architectural inconsistency is a cross-cutting concern that future contributors will have to understand.

**Fix:** Either:
- (a) Add an `isOpen` prop and use the `useEffect([isOpen])` pattern to match other dialogs (requires changing the parent's conditional rendering to always render the component), OR
- (b) Document the mount/unmount pattern as the preferred approach for conditionally-rendered dialogs and ensure future dialogs follow the same choice consistently.

---

### WR-03: Redundant `backdrop:bg-black/50` class

**File:** `src/components/student/QuestionNavigator.tsx:83`

**Issue:** The dialog element has `backdrop:bg-black/50` in its className, but the global CSS in `src/index.css` (lines 114–116) already sets `dialog::backdrop { background: rgba(0, 0, 0, 0.5); }` via `@layer base`. The Tailwind class generates an identical rule, creating dead CSS output. None of the other converted dialogs (HelpModal, AccessibilitySettings) include this class — they rely on the global styles.

**Fix:** Remove `backdrop:bg-black/50` from the dialog's className:

```tsx
className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col p-0"
```

---

### WR-04: Unrelated changes bundled in this commit

**Files:** `src/components/student/StudentListening.tsx:152`, `src/components/student/__tests__/StudentQuestionExperience.test.tsx:2339-2402`

**Issue:** The diff includes two changes unrelated to Task 6 (QuestionNavigator dialog conversion):
1. `StudentListening.tsx` — refactors `block.referenceImagePlacement !== 'instruction'` to `!isInstructionReferencePlacement(block)`
2. `StudentQuestionExperience.test.tsx` — adds a new test for instruction-placed listening diagrams

These are correct changes but belong in a separate commit. AGENTS.md states: "Prefer module-local changes over cross-cutting edits," and the implementation plan specifies each task should be a separate commit.

**Why it matters:** Bundling unrelated changes makes git bisect harder, obscures the intent of each commit, and complicates rollback if one change causes a regression.

**Fix:** Revert these two files from this commit and land them in a separate commit with an appropriate message (e.g., `refactor(listening): use isInstructionReferencePlacement utility`).

---

### WR-05: No dedicated test for the dialog conversion

**Files:** `src/components/student/__tests__/` (no QuestionNavigator test exists)

**Issue:** Task 6, Step 3 of the plan says "Run existing QuestionNavigator tests," but no QuestionNavigator test file exists. The `StudentExamWorkspace.test.tsx` mocks the entire component. There is no test that verifies:
- The dialog opens when the component mounts
- The dialog closes when the component unmounts
- ESC key closes the dialog and calls `onClose`
- The close button calls `onClose`

**Why it matters:** The dialog lifecycle (showModal/close/cleanup) is the core behavior of this conversion. Without test coverage, regressions in the lifecycle management won't be caught.

**Fix:** Add a focused test file `src/components/student/__tests__/QuestionNavigator.test.tsx` that verifies:
- Dialog is open after mount
- Clicking the close button calls `onClose`
- ESC key fires the dialog's close event
- Cleanup closes the dialog on unmount

---

## Info

### IN-01: Missing `type="button"` on close button

**File:** `src/components/student/QuestionNavigator.tsx:91`

**Issue:** The close button lacks `type="button"`:
```tsx
<button onClick={onClose} className="..." aria-label="Close question navigator">
```

The HelpModal's close button (Task 2) includes `type="button"`. While this button is not inside a `<form>` and the omission is functionally harmless, it's inconsistent with the established pattern and violates HTML best practice (buttons default to `type="submit"`).

**Fix:** Add `type="button"`:
```tsx
<button type="button" onClick={onClose} className="..." aria-label="Close question navigator">
```

---

## Requirement Checklist (Task 6)

| Requirement | Status | Notes |
|---|---|---|
| Convert to `<dialog>` element | ✅ Done | `<div role="dialog">` replaced with `<dialog>` |
| Add `useRef` + `useEffect` for showModal/close | ✅ Done | Cleanup added (not in plan, but correct improvement) |
| Add `aria-labelledby` for screen reader | ✅ Done | Links to `question-navigator-title` heading |
| Add `onClose` handler | ✅ Done | Wired to `onCloseNavigator` via parent |
| Verify tests pass | ⚠️ Partial | 11 pre-existing failures (not caused by this diff); no QuestionNavigator-specific tests exist |

---

## Assessment

**Ready to merge?** Yes, with fixes (WR-01 and WR-04 recommended, others optional).

**Reasoning:** The core dialog conversion is functionally correct and meets all Task 6 requirements. The pre-existing test failures (11) are unchanged by this diff. The issues found are code quality concerns (double-fire lifecycle, architectural inconsistency, redundant CSS, scope creep) rather than correctness or security problems. WR-01 (double-fire) should be fixed to prevent fragile close-handler patterns. WR-04 (scope creep) should be split into a separate commit per project conventions. The remaining warnings are improvements that can be addressed incrementally.

---

_Reviewed: 2026-07-02T12:15:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
