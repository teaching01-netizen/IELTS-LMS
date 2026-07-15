# Student Highlight Question, Writing, and Eraser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make question and Writing prompt text highlightable and expose Erase as a direct header control.

**Architecture:** Keep `StudentUIProvider` as the single tool-mode owner and reuse the existing surface-scoped V2 engine. UI changes stay in the student header; question and Writing changes opt only non-answer copy into stable highlight surfaces, leaving every answer control outside or rejected by the existing surface resolver.

**Tech Stack:** React 19, TypeScript, Vitest/Testing Library, Playwright, Tailwind CSS.

---

### Task 1: Direct Erase Control and Writing Context

**Files:**
- Modify: `src/components/student/StudentHeader.tsx`
- Modify: `src/components/student/StudentApp.tsx`
- Modify: `src/components/student/providers/StudentUIProvider.tsx`
- Modify: `src/components/student/studentHighlightToolContext.ts`
- Test: `src/components/student/__tests__/StudentHeaderHighlightHint.test.tsx`
- Test: `src/components/student/__tests__/studentHighlightToolContext.test.ts`

- [ ] **Step 1: Write failing header and context tests**

Assert that a native `Erase highlights` button is visible without opening the color disclosure, has `min-h-11`, exposes `aria-pressed`, calls its handler, and is absent from the palette. Change the context expectation to:

```ts
expect(isStudentHighlightToolContextActive({ ...base, module: 'writing' })).toBe(true);
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run src/components/student/__tests__/StudentHeaderHighlightHint.test.tsx src/components/student/__tests__/studentHighlightToolContext.test.ts
```

Expected: failures because Erase is palette-only and Writing is currently ineligible.

- [ ] **Step 3: Implement the smallest control/state change**

Keep Highlight and its color disclosure together; add a separate native button:

```tsx
<button
  type="button"
  onClick={onToggleEraseMode}
  className="flex min-h-11 items-center gap-1.5 rounded-sm border px-2.5 ..."
  aria-label="Erase highlights"
  aria-pressed={highlightToolMode === 'erase'}
>
  <Eraser size={16} aria-hidden="true" />
  <span className="hidden md:inline">Erase</span>
</button>
```

Expose `toggleEraseMode()` from `StudentUIProvider` so pressing active Erase returns to `off`; wire it through `StudentApp`. Remove Erase from the color panel, rename the disclosure to `Choose highlight color`, decouple header visibility from `onOpenNavigator`, and include `writing` in `isStudentHighlightToolContextActive`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 1 command and expect all selected tests to pass.

### Task 2: Writing Prompt Highlight Surface

**Files:**
- Modify: `src/components/student/StudentExamWorkspace.tsx`
- Modify: `src/components/student/StudentWriting.tsx`
- Test: `src/components/student/__tests__/StudentWriting.a11y.test.tsx`
- Test: `src/components/student/__tests__/StudentExamWorkspace.test.tsx`

- [ ] **Step 1: Write a failing prompt-boundary test**

Render Writing with highlighting enabled and assert:

```ts
expect(screen.getByTestId('writing-task-prompt').querySelector('[data-student-highlightable="true"]')).not.toBeNull();
expect(screen.getByRole('textbox', { name: /writing answer/i })).not.toHaveAttribute('data-student-highlightable');
```

Also assert workspace propagation of `highlightEnabled`, `highlightColor`, and `highlightClassName` into the Writing branch.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run src/components/student/__tests__/StudentWriting.a11y.test.tsx src/components/student/__tests__/StudentExamWorkspace.test.tsx
```

Expected: failure because the prompt is raw text/HTML and Writing receives no highlight props.

- [ ] **Step 3: Implement prompt-only highlighting**

Pass the existing highlight props from `StudentExamWorkspace` to `StudentWriting`. Preserve the outer prompt test-id and render only the prompt through:

```tsx
<RichTextHighlighter
  content={currentPrompt}
  contentType={currentPromptContainsMarkup ? 'html' : 'text'}
  enabled={highlightEnabled}
  highlightColor={highlightColor}
  highlightClassName={highlightClassName}
  highlightSurfaceId={`writing:prompt:${currentTask.id}`}
/>
```

Do not wrap or modify the textarea. Remove the now-unused prompt sanitizer import/value.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 2 command and expect all selected tests to pass.

### Task 3: Real Question-Side Highlight Surfaces

**Files:**
- Modify: `src/components/student/QuestionRenderer.tsx`
- Modify: `src/components/student/StudentQuestionBlockSection.tsx`
- Modify: `src/components/student/SubAnswerTreeQuestionList.tsx`
- Test: `src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx`
- Test: `src/components/student/__tests__/highlightPersistence.test.tsx`

- [ ] **Step 1: Write failing interaction and propagation tests**

Replace marker-only assertions with a selection-port test that supplies a question prompt selection in `highlight` mode, completes it, and expects:

```ts
expect(container.querySelector('mark[data-highlighted="true"]')).not.toBeNull();
expect(screen.getByRole('textbox')).not.toHaveAttribute('data-student-highlightable');
```

Add a sub-answer-tree assertion that its root prompt receives `highlightEnabled`, color, and a stable block/root-scoped surface ID.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx src/components/student/__tests__/highlightPersistence.test.tsx
```

Expected: failures for marker-only/direct labels and the unpropagated tree-question path.

- [ ] **Step 3: Implement stable question copy surfaces**

Pass explicit `highlightSurfaceId` values to question-copy `FormattedText` instances using block/question/slot identity, for example:

```tsx
<FormattedText
  as="span"
  text={q.prompt}
  highlightEnabled={highlightEnabled}
  highlightColor={highlightColor}
  highlightSurfaceId={`question:${block.id}:${q.id}:prompt`}
/>
```

Convert direct non-answer labels that currently only spread `selectableTextProps` into `FormattedText` surfaces. Remove misleading `data-student-highlightable` markers from elements without a V2 hook. Propagate highlight props through `StudentQuestionBlockSection` into `SubAnswerTreeQuestionList` and give each tree prompt a stable semantic surface ID. Inputs, selects, radio/checkbox controls, and flag buttons remain outside highlight surfaces.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 3 command and expect all selected tests to pass.

### Task 4: End-to-End Regression and Verification

**Files:**
- Modify: `e2e/student-ipad-layout.spec.ts`

- [ ] **Step 1: Extend the failing E2E scenario**

Assert that Erase is visible before opening the color palette, Reading question copy can produce a mark, and the Writing header/prompt exposes the same tools while the writing textarea remains unmarked.

- [ ] **Step 2: Run targeted verification**

Run:

```bash
npx vitest run src/components/student/__tests__/StudentHeaderHighlightHint.test.tsx src/components/student/__tests__/studentHighlightToolContext.test.ts src/components/student/__tests__/StudentWriting.a11y.test.tsx src/components/student/__tests__/StudentExamWorkspace.test.tsx src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx src/components/student/__tests__/highlightPersistence.test.tsx
npm run typecheck
npm run lint
npm run build
```

Expected: every command exits 0. Run the Playwright scenario when the configured browser/runtime is available:

```bash
npx playwright test e2e/student-ipad-layout.spec.ts
```

- [ ] **Step 3: Review invariants**

Confirm submitted answers and Writing draft behavior are unchanged; highlight persistence remains source-hash scoped; answer controls are excluded; blocked/submission contexts still reset the tool; no new dependency or persistence schema was added.

