# SAT Selection, Existing Highlights, and Math Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student can reopen and remove an existing SAT highlight on iPad, and SAT Math uses the same app-owned text selection and annotation menu as Reading and Writing.

**Architecture:** Keep annotation state and mutation in `useSatAnnotationSurface`, rendering and gesture capture in `SatAnnotatedContent`, and capability decisions in `satToolPolicy`. Math receives the existing annotation capability; the shell must receive its real section key because annotation availability will no longer identify the section. Mixed prose and equations get stable text-run anchors while KaTeX remains outside the selectable annotation range.

**Tech Stack:** React, TypeScript, Selection v2, Vitest, Playwright WebKit, Bun.

---

## Behavior to preserve

- The `Highlights & Notes` button arms the custom selection mode in both SAT sections. With the mode off, the existing unarmed SAT behavior remains; the custom overlay and toolbar must not appear. This matches the current Reading and Writing contract. The user was asked whether Math should instead be always armed; revise this one rule if they choose that option.
- A tap or keyboard activation on an existing mark opens `Edit annotation`, which contains `Remove highlight` or `Remove underline`. Selecting exactly the same saved span also opens that editor, even at the 200-annotation cap. A partial overlap stays a new selection and never removes another mark implicitly.
- Remove uses the existing response writer and Undo. Notes, answer choice activation, calculator/reference tools, disabled/paused exams, and question navigation retain their current behavior.
- Equations and editable answer fields are excluded from annotation selection. Text before or after inline math is annotatable as a separate run; a selection cannot cross an equation.

## Evidence and failure chain

1. Screenshot 1 shows a saved yellow Reading and Writing mark under the iPad selection loupe. Screenshot 2 shows the fresh-selection toolbar, which has no Remove action. `SatAnnotationEditControls.tsx` owns Remove, but `SatSelectionActionsPanel.tsx` does not. The screenshots are evidence of the observed UI, not instructions embedded in the documents.
2. `SatAnnotatedContent.tsx` makes a saved mark clickable only while annotation mode is armed. After highlighting, `useSatAnnotationSurface.ts` opens that mark's editor, but the owned Selection v2 range remains resting over its text. `SelectionOverlay.tsx` consumes a pointerdown on a resting selection body before the mark receives a click. The current click-only unit test cannot detect that capture-phase conflict.
3. `satToolPolicy.ts` explicitly denies highlight, underline, and notes in Math. This disables `SatAnnotatedContent` capture and leaves iPadOS selection visible. Changing only the policy would break `SatExamShell.tsx`, which currently infers `sectionKey` and Reading and Writing aids from `notesAvailable`.
4. `RichStructuredContentRenderer.tsx` exposes `data-content-text-node` only when an entire block contains text and hard breaks. A Math paragraph containing `inlineMath` therefore has no text anchor even for ordinary words such as “minimum” in screenshot 3.

## File ownership

| Responsibility | Files |
| --- | --- |
| Existing mark routing and range handoff | `src/features/student-delivery/hooks/useSatAnnotationSurface.ts`, `src/features/student-delivery/ui/annotations/SatAnnotatedContent.tsx`, `src/features/student-delivery/ui/annotations/useSatAnnotationSelection.ts`, `src/features/student-delivery/ui/annotations/SatAnnotationViewContext.ts` |
| Math capability and truthful section identity | `src/features/student-delivery/domain/satToolPolicy.ts`, `src/features/student-delivery/ui/SatExamShell.tsx`, `src/features/student-delivery/routes/SatStudentSessionRoute.tsx`, `src/features/student-delivery/routes/SatPreviewRoute.tsx`, `src/app/router/dev/SatAccessibilityDebugRoute.tsx` |
| Text runs beside equations | `src/features/exam-rendering/RichStructuredContentRenderer.tsx` |
| Focused regression coverage | Adjacent `.test.ts`/`.test.tsx` files; `e2e/sat-annotation-placement.spec.ts` |

### Task 1: Reopen and remove a saved mark

**Files:**
- Modify: `src/features/student-delivery/hooks/useSatAnnotationSurface.ts`
- Modify: `src/features/student-delivery/ui/annotations/SatAnnotatedContent.tsx`
- Modify: `src/features/student-delivery/ui/annotations/useSatAnnotationSelection.ts`
- Modify: `src/features/student-delivery/ui/annotations/SatAnnotationViewContext.ts`
- Test: `src/features/student-delivery/ui/annotations/SatAnnotationFlow.test.tsx`
- Test: `src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx`
- Test: `e2e/sat-annotation-placement.spec.ts`

- [ ] **Step 1: Add a failing journey test.** In `SatAnnotationFlow.test.tsx`, create a highlight using the existing `highlight(container, 'Several', 'Yellow')` helper. Close the edit toolbar, select the same saved phrase again with `selectStimulusText`, assert that `Edit annotation` opens with `Remove highlight`, click Remove, assert the mark disappears, then click Undo and assert it returns. Add a second case where a partial overlap raises `Selected text actions` and does not offer Remove. Assert an unarmed mark stays decorative.
- [ ] **Step 2: Run the focused test and record the failing assertion.**

  ```bash
  bunx vitest run src/features/student-delivery/ui/annotations/SatAnnotationFlow.test.tsx
  ```

- [ ] **Step 3: Route an exact saved span to its editor in `useSatAnnotationSurface.ts`.** Use the current question's `annotations` and compare `nodeId`, `startOffset`, `endOffset`, and `exact`; prefer a highlight if a highlight and underline share the span. Keep the existing `interaction.selectionCaptured(anchor)` path for every other selection. For the exact match, set `editingMarkId` and call `interaction.selectionToolsDismissed()`; do not create a second mutation path. Define one lookup and reuse it for the cap check in Step 3a:

  ```ts
  const findExactMark = useCallback((anchor: SatTextAnchor): SatTextAnnotation | null => {
    const matches = annotations?.annotations.filter((item) =>
      item.anchor.nodeId === anchor.nodeId &&
      item.anchor.startOffset === anchor.startOffset &&
      item.anchor.endOffset === anchor.endOffset &&
      item.anchor.exact === anchor.exact
    ) ?? [];
    return matches.find((item) => item.kind === 'highlight') ?? matches[0] ?? null;
  }, [annotations]);

  onSelectionCaptured: (anchor: SatTextAnchor) => {
    if (!annotationModeEnabled || !writable) return;
    const matching = findExactMark(anchor);
    if (matching) {
      setEditingMarkId(matching.id);
      interaction.selectionToolsDismissed();
      return;
    }
    interaction.selectionCaptured(anchor);
  },
  ```

  Include `findExactMark` and `writable` in that `useMemo` dependency list. This matching rule must not treat a partial overlap as the saved mark.

- [ ] **Step 3a: Keep existing marks editable at the annotation cap.** `useSatAnnotationSelection.reportAnchor` currently rejects every captured span once the count is 200, before the surface can recognize an existing mark. Extend `SatAnnotationView` with `isExistingAnchor?: (anchor: SatTextAnchor) => boolean`, supply `isExistingAnchor: (anchor) => findExactMark(anchor) !== null` from the surface, and change the report guard as follows. Add both cases to `SatAnnotatedContent.test.tsx`. Direct mark taps must also continue to work at the cap.

  ```ts
  if (annotationCount >= SAT_ANNOTATION_LIMIT && !view.isExistingAnchor?.(anchor)) {
    flashLimitNotice();
    return;
  }
  reportSelection.current?.(anchor);
  ```

  Include `view.isExistingAnchor` in the `reportAnchor` callback dependencies.
  Make the adjacent `reportAnchor` diagnostic use the same predicate, so it reports the existing-mark path as delivered rather than rejected at the cap.

- [ ] **Step 4: Retire the owned range when mark editing takes over.** In `SatAnnotatedContent.tsx`, call `touchSelection.dismiss()` in a layout effect when `view.activeAnnotationId` becomes non-null. This leaves the persistent ink visible, releases the Selection v2 body from pointer arbitration, and allows the mark's existing tap/keyboard handler to receive the next activation. Keep the selection alive while a fresh-selection toolbar is merely dismissed, because `SelectionOverlay` intentionally supports reactivation of an unchanged range.

  ```ts
  useLayoutEffect(() => {
    if (view.activeAnnotationId !== null) touchSelection.dismiss();
  }, [touchSelection.dismiss, view.activeAnnotationId]);
  ```

- [ ] **Step 5: Add a pointer-path regression.** In `SatAnnotatedContent.test.tsx`, exercise pointerdown, pointerup, and click on a saved mark after the editor has closed; verify that the mark opens the editor and a dragged gesture still reports a new selection. In `e2e/sat-annotation-placement.spec.ts`, use its existing iPad WebKit project and a real `locator.tap()` after highlighting: close tools, tap the mark, assert `Remove highlight` is visible, remove, and Undo. A test that dispatches only `click` is insufficient for this bug.
- [ ] **Step 6: Run the two focused suites and the WebKit case.**

  ```bash
  bunx vitest run src/features/student-delivery/ui/annotations/SatAnnotationFlow.test.tsx src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx
  bunx playwright test --config playwright.sat-annotations.config.ts --project webkit-ipad
  ```

  Expected: the exact-mark and touch-tap scenarios pass; partial overlaps still show the fresh-selection actions.

### Task 2: Give Math the existing annotation capability without turning on Reading and Writing aids

**Files:**
- Modify: `src/features/student-delivery/domain/satToolPolicy.ts`
- Modify: `src/features/student-delivery/ui/SatExamShell.tsx`
- Modify: `src/features/student-delivery/routes/SatStudentSessionRoute.tsx`
- Modify: `src/features/student-delivery/routes/SatPreviewRoute.tsx`
- Modify: `src/app/router/dev/SatAccessibilityDebugRoute.tsx`
- Modify: `src/features/student-delivery/domain/satHelpContent.ts`
- Modify: `src/features/student-delivery/domain/satInteractionState.ts` (stale Math-only comment)
- Modify: `src/features/student-delivery/ui/shell/SatExamTopBar.tsx` (stale Reading and Writing-only comment)
- Test: `src/features/student-delivery/domain/satToolPolicy.test.ts`
- Test: `src/features/student-delivery/domain/__tests__/satInteractionReducer.test.ts`
- Test: `src/features/student-delivery/ui/SatExamShell.test.tsx`
- Test: `src/features/student-delivery/ui/question/SatQuestionRenderer.test.tsx`

- [ ] **Step 1: Change the policy tests first.** Math should return `{ highlight: true, underline: true, notes: true, lineReader: false, passageExpand: false }` with or without calculator/reference capability. Update the reducer test that currently says Math cannot arm annotation; a Math context with the new policy must arm and capture. Keep a separate no-capability context proving the reducer still refuses annotation when all three flags are false.
- [ ] **Step 2: Run those tests and confirm the old policy fails.**

  ```bash
  bunx vitest run src/features/student-delivery/domain/satToolPolicy.test.ts src/features/student-delivery/domain/__tests__/satInteractionReducer.test.ts
  ```

- [ ] **Step 3: Change only the three annotation flags in `resolveSatExamToolPolicy`.** Preserve Math's `lineReader: false` and `passageExpand: false`, and preserve its module-gated calculator and reference sheet. Update comments in `satToolPolicy.ts`, `satInteractionState.ts`, `SatExamTopBar.tsx`, and the touched shell/hook files that claim annotations are Reading and Writing only.

  ```ts
  highlight: true,
  underline: true,
  notes: true,
  lineReader: readingWriting,
  passageExpand: readingWriting,
  ```

- [ ] **Step 4: Make `SatExamShell` receive `sectionKey: SatSectionKey` explicitly.** Pass it from the student route (`state.sectionKey`), staff preview (`sectionKey(preview.section.sectionKey)`), and accessibility harness (`math ? 'math' : 'reading-writing'`). In the shell, use `props.sectionKey` for `interactionCtx.sectionKey`; use `props.sectionKey === 'reading-writing'` for `lineReader`, `passageExpand`, the More menu's line reader availability, its shortcut callback, and the rendered `SatLineReader`. Keep `notesAvailable` for annotations and Notes only. Update the shell test fixture and cases that used `notesAvailable: false` to stand for Math.

  ```ts
  const readingWriting = props.sectionKey === 'reading-writing';
  const notesAvailable = props.notesAvailable ?? true;
  ```

  Replace the existing `interactionCtx.sectionKey` expression with `props.sectionKey`, replace its `lineReader` and `passageExpand` values with `readingWriting`, and include `props.sectionKey` in the memo dependencies.

- [ ] **Step 5: Verify the complete write path.** `SatQuestionRenderer` already derives `enabled` from policy. `useSatExamController.setAnnotations` uses the same policy, so it should now accept Math annotations and call the existing persistence save. Add a renderer test for Math prompt, supporting material, and choice text roots; a shell test for Math's Highlights/Notes controls with calculator/reference still present and line reader absent; and a controller or route test proving a Math annotation reaches `setAnnotations` and survives question navigation. Update the SAT help copy that says Highlights are found only in Reading and Writing.
- [ ] **Step 6: Run focused tests.**

  ```bash
  bunx vitest run src/features/student-delivery/domain/satToolPolicy.test.ts src/features/student-delivery/domain/__tests__/satInteractionReducer.test.ts src/features/student-delivery/ui/SatExamShell.test.tsx src/features/student-delivery/ui/question/SatQuestionRenderer.test.tsx
  ```

  Expected: Math can arm and save annotations; its calculator/reference capability and Reading and Writing-only aids remain correct.

### Task 3: Anchor words next to inline equations

**Files:**
- Modify: `src/features/exam-rendering/RichStructuredContentRenderer.tsx`
- Test: `src/features/exam-rendering/__tests__/StructuredContentRenderer.test.tsx`
- Test: `src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx`

- [ ] **Step 1: Add a failing mixed-paragraph fixture.** Use a version 2 paragraph with a stable `attrs.id`, text `The graph of `, an `inlineMath` child, and text ` has its minimum at which point?`. Assert both prose runs have `data-content-text-node`, stable distinct IDs, and `renderText` receives the text and offsets of each run. Assert `[role="math"]` is outside those text-run roots. Also assert pure-text paragraphs retain their original `data-content-text-node` ID so saved Reading and Writing anchors are not migrated.
- [ ] **Step 2: Run the renderer test and confirm the mixed fixture fails.**

  ```bash
  bunx vitest run src/features/exam-rendering/__tests__/StructuredContentRenderer.test.tsx
  ```

- [ ] **Step 3: Extend only the mixed-content branch of `RichNode.textChildren`.** Keep today's pure-text branch byte-for-byte in its IDs and offsets. For a mixed paragraph or heading, group adjacent `text`/`hardBreak` children into runs; wrap each run in a span with `data-content-text-node` set to `${nodeId}::text-run-${firstChildIndex}`; pass that run's text, ID, and offsets to `renderText` while retaining authored marks. Render each inline equation through its existing `RichNode` path between runs. A text run's root must never contain KaTeX DOM, and no selection anchor may span across runs. Use the first child index, not a random ID, so the same delivered content re-renders to the same persisted anchor.

  ```tsx
  if (renderText && nodeId && !annotatable) {
    const inline = node.content ?? [];
    const parts: ReactNode[] = [];
    let index = 0;
    while (index < inline.length) {
      const first = index;
      const child = inline[index]!;
      if (child.type !== 'text' && child.type !== 'hardBreak') {
        parts.push(<RichNode key={`mixed-${first}`} node={child} renderText={renderText} enlarge={enlarge} />);
        index += 1;
        continue;
      }
      const run: RichTextNode[] = [];
      while (index < inline.length && (inline[index]!.type === 'text' || inline[index]!.type === 'hardBreak')) {
        run.push(inline[index]!);
        index += 1;
      }
      const runId = `${nodeId}::text-run-${first}`;
      const blockText = textFromNodes(run);
      let offset = 0;
      parts.push(<span key={`mixed-${first}`} data-content-text-node={runId}>
        {run.map((part, partIndex) => {
          if (part.type === 'hardBreak') return <br key={partIndex} />;
          const text = part.text ?? '';
          const startOffset = offset;
          offset += text.length;
          return <span key={partIndex}>{applyMarks(part, renderText({ nodeId: runId, blockText, text, startOffset }))}</span>;
        })}
      </span>);
    }
    return parts;
  }
  ```

  Place this branch before the existing `if (!annotatable || !renderText) return children('text-block')` check. Keep equations rendered by `RichNode` and keep pure-text blocks on their current branch.
- [ ] **Step 4: Add a `SatAnnotatedContent` test for a mixed Math prompt.** Select `minimum`, capture a `prompt:` anchor, apply a highlight, re-render from saved annotations, and assert the mark returns. Try a range crossing the inline equation and assert `captureSatTextRange` returns null. Keep the existing `[role="math"]` exclusion in `satTextSelection.ts` and `useSatAnnotationSelection.ts`.
- [ ] **Step 5: Run both tests.**

  ```bash
  bunx vitest run src/features/exam-rendering/__tests__/StructuredContentRenderer.test.tsx src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx
  ```

  Expected: surrounding prose is anchored; equations remain rendered and excluded.

### Task 4: Verify real selection ownership and regression safety

**Files:**
- Modify: `src/app/router/dev/SatAccessibilityDebugRoute.tsx` (give its Math prompt a mixed prose/inline-math fixture for the browser scenario)
- Test: `e2e/sat-annotation-placement.spec.ts`
- Verify: `src/components/student/__tests__/StudentQuestionCalloutCss.test.ts`

- [ ] **Step 1: Extend the existing browser suite, not a second gesture implementation.** Open `/__dev/sat-accessibility?mode=math&ownedTouchSelection=1`, arm Highlights & Notes, and capture a plain Math word and a word following the inline equation using the suite's range helper. In the iPad WebKit project, assert the relevant root has `data-student-selection-owner="app"` and `data-student-owned-touch-selection="true"`, its computed `-webkit-user-select` is `none`, the app's `Selected text actions` toolbar appears, and the native `window.getSelection()` is empty after capture. Highlight the word, use a real Playwright tap on the resulting mark, remove it, and Undo. Assert an equation cannot produce an annotation anchor and the student-produced answer field remains editable. The range helper checks the capture contract; the physical iPad check in Step 3 checks the actual finger drag and OS callout.
- [ ] **Step 2: Run the browser suite on all configured projects.**

  ```bash
  bun run e2e:sat-annotations
  ```

  Expected: Chromium desktop, touch Chromium, and iPad WebKit pass. The WebKit project checks browser behavior but cannot prove that physical iPadOS never draws its native popover.

- [ ] **Step 3: Test on a physical iPad in the live student route.** In Reading and Writing, highlight text, close tools, tap the saved mark, Remove, and Undo. In Math, arm Highlights & Notes and repeat on plain prose and prose next to an inline equation in portrait and landscape. Verify the native Copy/Look Up/Share menu does not appear during an owned gesture, the custom toolbar stays reachable, handle dragging works, answer choices do not activate from a selection drag, and calculator/reference plus answer inputs still work. Capture one before/after screen recording or screenshots for the regression record.
- [ ] **Step 4: Finish with project checks and inspect only this change's diff.**

  ```bash
  bun run typecheck
  bun run lint
  bun run build
  git diff --check
  git diff -- src/features/student-delivery src/features/exam-rendering src/app/router/dev/SatAccessibilityDebugRoute.tsx e2e/sat-annotation-placement.spec.ts
  ```

  Expected: all commands pass. Preserve the working tree's unrelated pre-existing edits; stage or commit only files intentionally changed for this fix.

## Self-review

- Each reported symptom has a task: mark reopen and Remove in Task 1; Math policy, custom menu, and persistence in Task 2; Math words next to equations in Task 3; iPadOS ownership in Task 4.
- The plan changes one ownership boundary for each cause and reuses the current Remove/Undo writer. It does not add a second delete command to the fresh-selection toolbar.
- `sectionKey` is explicit before Math annotation capability is enabled, so Math does not accidentally inherit line reader or passage expansion.
- Browser tests check the owned-selection markers and real pointer path; physical iPad QA is still required for the OS popover itself.
