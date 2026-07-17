# Student Exam Page Zoom Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset and prevent native whole-page pinch zoom during active student exams without affecting non-exam pages or app-controlled accessibility/media zoom.

**Architecture:** A focused `examPageZoomGuard` utility owns the reversible viewport-meta mutation and Safari gesture listeners. `StudentApp` invokes the utility only while `effectivePhase === 'exam'`, keeping browser-policy mechanics out of answer, timer, and submission logic.

**Tech Stack:** TypeScript, React effects, DOM viewport metadata, Safari gesture events, Vitest, Testing Library

---

### Task 1: Build the reversible page zoom guard

**Files:**
- Create: `src/components/student/examPageZoomGuard.ts`
- Create: `src/components/student/__tests__/examPageZoomGuard.test.ts`

- [ ] **Step 1: Write failing viewport lifecycle tests**

Create tests that set the viewport content to `width=device-width, initial-scale=1.0`, install the guard, assert the exam policy is `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no`, call cleanup, and assert the original content is restored exactly. Add a second test for a document with no viewport tag and assert cleanup removes the tag created by the guard.

```ts
const cleanup = installExamPageZoomGuard(document);
expect(document.querySelector('meta[name="viewport"]')).toHaveAttribute(
  'content',
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
);
cleanup();
expect(viewport).toHaveAttribute('content', originalContent);
```

- [ ] **Step 2: Write failing gesture-boundary tests**

Dispatch cancelable `touchmove` events whose `touches` collections contain one and two entries. Assert the single-touch event is not prevented and the multi-touch event is prevented. Dispatch cancelable `gesturestart`, `gesturechange`, and `gestureend` events and assert each is prevented while the guard is installed and no longer prevented after cleanup.

- [ ] **Step 3: Run the new tests and verify failure**

Run: `npm test -- --run --exclude '.worktrees/**' src/components/student/__tests__/examPageZoomGuard.test.ts`

Expected: FAIL because `installExamPageZoomGuard` does not exist.

- [ ] **Step 4: Implement the utility**

Export `installExamPageZoomGuard(targetDocument: Document): () => void`. Store whether the viewport element existed and its exact original `content` value, apply the exam policy, add non-passive capture listeners for multi-touch `touchmove` and Safari gesture events, and return an idempotent cleanup that removes listeners and restores or removes the viewport element.

```ts
export const EXAM_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';

export function installExamPageZoomGuard(targetDocument: Document): () => void {
  // Snapshot viewport state, apply the exam policy, install guards, and return cleanup.
}
```

- [ ] **Step 5: Run the utility tests**

Run: `npm test -- --run --exclude '.worktrees/**' src/components/student/__tests__/examPageZoomGuard.test.ts`

Expected: PASS.

### Task 2: Integrate the guard with the exam lifecycle

**Files:**
- Modify: `src/components/student/StudentApp.tsx`
- Modify: `src/components/student/__tests__/StudentApp.test.tsx`

- [ ] **Step 1: Write the failing lifecycle regression test**

Render an exam-phase `StudentAppWrapper`, assert the viewport meta content equals the exam policy, unmount, and assert the original viewport content is restored. Use the existing wrapper fixtures; do not exercise answer or submission behavior.

```tsx
const originalContent = viewport.getAttribute('content');
const { unmount } = render(<StudentAppWrapper ... />);
expect(viewport).toHaveAttribute('content', EXAM_VIEWPORT_CONTENT);
unmount();
expect(viewport).toHaveAttribute('content', originalContent);
```

- [ ] **Step 2: Run the lifecycle test and verify failure**

Run: `npm test -- --run --exclude '.worktrees/**' src/components/student/__tests__/StudentApp.test.tsx -t "guards native page zoom only during the exam lifecycle"`

Expected: FAIL because `StudentApp` does not install the guard.

- [ ] **Step 3: Install the guard from `StudentApp`**

Import `installExamPageZoomGuard` and add an effect keyed by `effectivePhase`. Return immediately outside `exam`; inside `exam`, return the utility cleanup directly.

```tsx
useEffect(() => {
  if (effectivePhase !== 'exam') return;
  return installExamPageZoomGuard(document);
}, [effectivePhase]);
```

- [ ] **Step 4: Run focused lifecycle and viewport tests**

Run: `npm test -- --run --exclude '.worktrees/**' src/components/student/__tests__/examPageZoomGuard.test.ts src/components/student/__tests__/StudentApp.test.tsx -t "page zoom|effective tablet shell grow|viewport height stable"`

Expected: PASS.

### Task 3: Verify scope and quality

**Files:**
- Verify: `src/components/student/examPageZoomGuard.ts`
- Verify: `src/components/student/StudentApp.tsx`
- Verify: `src/components/student/__tests__/examPageZoomGuard.test.ts`
- Verify: `src/components/student/__tests__/StudentApp.test.tsx`

- [ ] **Step 1: Run all zoom-guard and footer viewport regressions**

Run: `npm test -- --run --exclude '.worktrees/**' src/components/student/__tests__/examPageZoomGuard.test.ts src/components/student/__tests__/StudentFooterRepresentative.test.tsx src/components/student/__tests__/StudentQuestionExperience.test.tsx src/components/student/__tests__/StudentApp.test.tsx -t "page zoom|effective tablet shell grow|keeps overall progress"`

Expected: PASS.

- [ ] **Step 2: Run scoped lint**

Run: `npx eslint src/components/student/examPageZoomGuard.ts src/components/student/StudentApp.tsx src/components/student/__tests__/examPageZoomGuard.test.ts src/components/student/__tests__/StudentApp.test.tsx`

Expected: no errors; existing warnings in untouched `StudentApp` areas may remain.

- [ ] **Step 3: Check patch hygiene and scope**

Run: `git diff --check && git diff --stat`

Expected: no whitespace errors; changes are limited to the zoom guard, lifecycle integration, tests, and approved documentation.
