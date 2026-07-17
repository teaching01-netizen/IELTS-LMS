# Student Question Touch-Callout Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppress the iOS long-press callout on non-editable student question copy while preserving native selection, Highlight/Erase, and answer-control editing.

**Architecture:** Add an explicit callout-protection opt-in to `FormattedText`, forward it through `HighlightableSurface`, and expose a small `StudentQuestionText` wrapper so question renderers cannot forget the semantic marker. CSS supplies the primary WebKit behavior; `StudentKeyboardProvider` supplies a narrowly targeted `contextmenu` fallback without emitting integrity violations.

**Tech Stack:** React 18, TypeScript, Tailwind/global CSS, Vitest, Testing Library.

---

### Task 1: Add the semantic question-copy marker

**Files:**
- Create: `src/components/student/StudentQuestionText.tsx`
- Modify: `src/components/student/FormattedText.tsx`
- Modify: `src/components/student/HighlightableSurface.tsx`
- Test: `src/components/student/__tests__/FormattedText.test.tsx`

- [ ] **Step 1: Write failing marker-forwarding tests**

Add tests that render `FormattedText` with `suppressTouchCallout` in both plain and `highlightEnabled` modes and assert that the rendered root has `data-student-question-callout-protected="true"`. The highlighted case must also continue to expose `style.userSelect === 'text'`.

```tsx
it.each([false, true])(
  'marks question copy when highlightEnabled=%s',
  (highlightEnabled) => {
    const { container } = render(
      <FormattedText
        as="span"
        text="Question copy"
        highlightEnabled={highlightEnabled}
        suppressTouchCallout
      />,
    );

    const copy = container.firstElementChild as HTMLElement;
    expect(copy).toHaveAttribute('data-student-question-callout-protected', 'true');
    if (highlightEnabled) expect(copy.style.userSelect).toBe('text');
  },
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/components/student/__tests__/FormattedText.test.tsx`

Expected: FAIL because `FormattedText` does not emit `data-student-question-callout-protected`.

- [ ] **Step 3: Implement the marker plumbing and wrapper**

Add `suppressTouchCallout?: boolean` to `FormattedTextProps`. Derive:

```tsx
const questionCalloutProtection = suppressTouchCallout
  ? { 'data-student-question-callout-protected': 'true' as const }
  : {};
```

Spread the marker onto the plain `Tag` in both the paragraph and single-line branches. Add `suppressTouchCallout?: boolean` to `HighlightableSurfaceProps` and emit the same data attribute on its `Tag`; pass the prop from the highlighted `FormattedText` branch.

Create the question-owned wrapper:

```tsx
import React from 'react';
import { FormattedText } from './FormattedText';

type StudentQuestionTextProps = React.ComponentProps<typeof FormattedText>;

export function StudentQuestionText(props: StudentQuestionTextProps) {
  return <FormattedText {...props} suppressTouchCallout />;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run src/components/student/__tests__/FormattedText.test.tsx`

Expected: PASS.

### Task 2: Opt all question-side copy into protection and add CSS

**Files:**
- Modify: `src/components/student/QuestionRenderer.tsx`
- Modify: `src/components/student/SubAnswerTreeQuestionList.tsx`
- Modify: `src/components/student/StudentReading.tsx`
- Modify: `src/components/student/StudentListening.tsx`
- Modify: `src/index.css`
- Test: `src/components/student/__tests__/StudentQuestionExperience.test.tsx`
- Create: `src/components/student/__tests__/StudentQuestionCalloutCss.test.ts`

- [ ] **Step 1: Write failing scope and CSS tests**

In `StudentQuestionExperience.test.tsx`, render a short-answer `QuestionRenderer` with `highlightEnabled`. Assert that the prompt has the marker, retains `style.userSelect === 'text'`, and its answer textbox has no marker and no marked ancestor.

In `StudentQuestionCalloutCss.test.ts`, read `src/index.css` and assert an exact selector for the marker and its text-formatting descendants containing `-webkit-touch-callout: none`, `-webkit-user-select: text`, and `user-select: text`. Also assert that the selector does not mention `input`, `textarea`, `select`, `button`, or `[contenteditable]`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/StudentQuestionExperience.test.tsx \
  src/components/student/__tests__/StudentQuestionCalloutCss.test.ts
```

Expected: FAIL because question copy is not marked and the CSS contract does not exist.

- [ ] **Step 3: Use `StudentQuestionText` at question-copy boundaries**

Replace question-copy `FormattedText` usage with `StudentQuestionText` in:

- every `FormattedText` call in `QuestionRenderer.tsx`;
- the tree root prompt in `SubAnswerTreeQuestionList.tsx`;
- only `renderBlockInstruction` in `StudentReading.tsx` and `StudentListening.tsx`.

Do not replace the passage/title `FormattedText` in `StudentReading.tsx`, Writing prompt rendering, or any answer control.

Add the primary CSS contract:

```css
[data-student-question-callout-protected="true"],
[data-student-question-callout-protected="true"] * {
  -webkit-touch-callout: none;
  -webkit-user-select: text;
  user-select: text;
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

### Task 3: Add the targeted `contextmenu` fallback

**Files:**
- Modify: `src/components/student/providers/StudentKeyboardProvider.tsx`
- Test: `src/components/student/providers/__tests__/StudentKeyboardProvider.test.tsx`

- [ ] **Step 1: Write failing fallback tests**

Extend the harness with a marked question-copy element. Add one test dispatching a cancelable bubbling `contextmenu` event on that element and asserting `defaultPrevented === true` with no violation. Add parameterized tests for the existing textarea and input controls asserting `defaultPrevented === false`.

- [ ] **Step 2: Run the provider test and verify RED**

Run: `npx vitest run src/components/student/providers/__tests__/StudentKeyboardProvider.test.tsx`

Expected: FAIL because marked question copy does not prevent the event.

- [ ] **Step 3: Implement the narrow fallback**

Add an event-target helper that accepts `HTMLElement` and text-node targets:

```ts
function isWithinQuestionCalloutProtectedText(target: EventTarget | null) {
  const element = target instanceof HTMLElement
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  return Boolean(element?.closest('[data-student-question-callout-protected="true"]'));
}
```

Change only the `contextmenu` handler:

```ts
const handleContextMenu = (event: MouseEvent) => {
  if (isWithinQuestionCalloutProtectedText(event.target)) {
    event.preventDefault();
  }
};
```

Do not stop propagation, call `handleViolation`, or write an audit event.

- [ ] **Step 4: Run the provider test and verify GREEN**

Run the command from Step 2.

Expected: PASS.

### Task 4: Record the invariant and run complete verification

**Files:**
- Modify: `docs/ux-invariants.md`
- Verify: student question, highlight, writing, translation-guard, and provider tests

- [ ] **Step 1: Update repository memory**

Under `Student Text Selection And Highlighting`, record that displayed question copy may suppress the WebKit touch callout only through the explicit marker, must retain `user-select: text`, and must not mark or inherit onto answer controls. Add the new CSS and provider tests to regression protection.

- [ ] **Step 2: Run focused regression verification**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/FormattedText.test.tsx \
  src/components/student/__tests__/StudentQuestionExperience.test.tsx \
  src/components/student/__tests__/StudentQuestionCalloutCss.test.ts \
  src/components/student/__tests__/StudentTranslationGuardCss.test.ts \
  src/components/student/__tests__/highlightPersistence.test.tsx \
  src/components/student/__tests__/StudentWriting.a11y.test.tsx \
  src/components/student/providers/__tests__/StudentKeyboardProvider.test.tsx
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run static verification**

Run:

```bash
npm run typecheck
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 4: Review final scope**

Inspect `git diff --` for only the files named in this plan. Confirm answer controls, answer mutation paths, persistence, submission, timers, and unrelated user changes are untouched.
