# Phase 3 — Protected controls, navigation, and overlays

Status: planned. Depends on: [Phase 2](phase-02-adaptive-workspace.md). Next: [Phase 4](phase-04-modules-journey.md).

## Result

All question families use consistent controls with native keyboard semantics, deterministic selection UI, correct answer identity, and a single reliable commit path.

## File ownership

- Controls: `src/components/student/ProtectedInput.tsx`, `ProtectedChoiceInput.tsx`, `ProtectedSelect.tsx`, `protectedAnswerControlLifecycle.ts`; proposed `ProtectedExamSelect.tsx`.
- Rendering: `QuestionRenderer.tsx`, `StudentQuestionBlockSection.tsx`, `StudentQuestionText.tsx`, `StudentQuestionNumber.tsx`, `TableCompletionSlotCell.tsx`, `SubAnswerTreeQuestionList.tsx`.
- Navigation: `StudentFooter.tsx`, `QuestionNavigator.tsx`, `WritingTaskNavigator.tsx`, `layout/CompactQuestionNavigation.tsx`, `layout/studentQuestionNavigation.ts`.
- Tools: `StudentHeader.tsx`, `layout/CompactStudentHeader.tsx`, `layout/StudentToolsSheet.tsx`.
- Existing application commands and `DraftCommitPort` remain the mutation/flush owners.

## P3.1 — Build a renderer-to-answer contract table

Inventory every select/input/choice call site in the supported question types. For each, record the displayed label, persisted scalar/array value, answer/root ID, slot ID/index/count, empty-value representation, and applicable cardinality. Preserve existing `commitAnswerChange` and `updateIndexedAnswer` metadata in `QuestionRenderer`.

Keep display numbers and values distinct. Roman heading labels, category strings, option IDs, and grouped question IDs must not become interchangeable just because their UI now shares one component.

## P3.2 — Align questions and controls

1. Use the number/content/flag grid with an independently sized flag target. Reserve its space even when state changes.
2. Use native labeled radio/checkbox controls within full-row hit targets. A click on row text/whitespace activates once. The flag/elimination button is a sibling outside the label activation area.
3. Preserve multi-select limits and partial-completion rules. At the maximum, explain the existing restriction accessibly; never discard an existing choice to accept a new one silently.
4. Apply common typography/focus to inline blanks, tables, maps, and nested subanswer trees. Give local two-dimensional content an accessible overflow region; no whole-question clipping.

## P3.3 — Introduce a value-oriented protected select

The proposed public API accepts a string value, stable options, labels/descriptions, disabled state, and `onValueChange(value)`. It does not require a fabricated React change event or an HTMLSelectElement ref.

Define three separate values:

- **Committed value:** the current answer in the existing application/draft path.
- **Highlighted option:** the option keyboard navigation is pointing at while open.
- **Latest committed ref:** the immediately readable local value for lifecycle commits before React renders again.

On commit: validate against permitted options/empty value, set the latest ref, update the live-answer registry, call the existing answer command once, and close. This remains synchronous for UI feedback; persistence completion follows the existing adapter. Highlight/typeahead does not commit. Escape closes without mutation.

The existing lifecycle registry accepts an `HTMLElement`, so register the control root/trigger with a callback that reads the latest committed ref. Do not redesign the registry solely because the control is no longer a native select. Preserve pagehide/visibility/freeze/blur coverage, while ensuring a focus move into the option portal cannot commit the highlighted-but-unselected value. Unregister on unmount.

Empty value needs explicit handling: preserve the ability to clear where the old select allowed it. If the installed primitive disallows an empty item value, provide a separate clear action mapped directly to the application's empty value. Do not reserve a magic string that could collide with an authored option ID.

## P3.4 — Use one controller with two presentations

Use the installed Radix selection primitive for wide/standard anchored menus and the existing dialog pattern for the phone choice sheet when space requires it. Verify the installed API locally during implementation. No new dropdown package is needed.

Both presentations share the same validated committed value and options. If the viewport changes while the menu is open, close it and preserve the last committed answer; do not silently commit a highlighted option or replace the answer controller.

Placement/focus rules:

- Label and description remain associated with trigger and selected answer.
- Menus fit available visible width/height, scroll long lists, and account for the software keyboard.
- Enter/Space commits an option; arrows/Home/End/typeahead operate within the primitive's documented selection pattern; Escape cancels.
- Closing returns focus to the visible trigger unless a phase change requires a different destination.
- A portal in an existing modal uses the correct modal container; it is not hidden behind the dialog or outside its allowed focus scope.
- Exam typography and contrast variables reach the portal via a scoped theme class/root.

Keep native `ProtectedSelect` until all callers have migrated. Delete its production implementation only after confirming no remaining callers and migrating its meaningful tests.

## P3.5 — Consolidate navigator state

Extend the existing `layout/studentQuestionNavigation.ts` helpers rather than duplicating grouped-root logic. One derived view model must drive footer chips, compact previous/current/next, and the question sheet.

For each navigable item, expose its stable target, display range, answered/partial/unanswered status, current status, flag status, and availability. Preserve grouped deduplication and totals from the existing content facade.

Navigation sequence: commit active draft if needed → execute existing navigation command → reveal destination pane → focus/scroll to the stable destination. This does not add a network wait to ordinary navigation, except where an existing section-transition barrier requires one.

At first/last item, disable previous/next appropriately. Do not convert the last Next action into Submit. The submit action remains separate and authorized by existing delivery policy.

## P3.6 — Complete tools and modal behavior

Keep Questions and primary pane switching reachable at every size. Move secondary tools into the existing sheet with accessible names and state. Do not require hover tooltips to explain an otherwise unlabeled control.

Use one open-overlay owner where the current shell already coordinates tools. Close transient menus on phase change, proctor block, or route exit. Ensure menu → sheet → dialog focus restoration does not reopen an old overlay. Destructive submit confirmation defaults to the safe focus destination and cannot be activated twice while pending.

## Targeted test cases

| Case | Assertion |
| --- | --- |
| Select option then immediately submit/pagehide | Exactly one intended answer value enters the existing command path |
| Highlight another option then Escape | Persisted value is unchanged |
| Clear valid answer | Empty value persists and progress updates correctly |
| Old hydration after newer local choice | Older value cannot rescue over the newer answer |
| Duplicate option labels, distinct IDs | Correct ID selected; no label-based identity |
| Flag/eliminate within an answer row | Selection does not change |
| Partial grouped answer and current+flagged item | Same states in all navigator presentations |
| Hidden pane/disabled tool | No focusable or activatable hidden control |

Run existing tests plus the proposed new `ProtectedExamSelect` suite once implemented:

```sh
npm run test:run -- src/components/student/__tests__/ProtectedInput.test.tsx src/components/student/__tests__/ProtectedChoiceInput.test.tsx src/components/student/__tests__/ProtectedSelect.test.tsx src/components/student/__tests__/StudentFooterRepresentative.test.tsx src/components/student/layout/__tests__/CompactQuestionNavigation.test.tsx src/features/student/application/exam-session/__tests__/answerCommands.test.ts
npm run typecheck
```

Rename/migrate the native-select suite when its owner is retired, rather than leaving a command pointing at a removed file. Rewrite required accessibility E2E assertions to fail if controls/dialogs are absent; execution remains a later release gate under the code-only restriction.

## Commit boundaries and exit gate

Suggested commits: question geometry; protected value adapter and tests; migrated select callers; shared navigator states; tool/focus integration. Exit when all families retain their answer contracts, cancel/clear/commit behavior is tested, and no custom control bypasses existing protection or submission flushes.
