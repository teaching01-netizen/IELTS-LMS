# Student Footer Viewport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render tablet objective-exam navigation and progress in one compact footer row without Finish, and prevent blank space below that footer when the iPad viewport grows.

**Architecture:** `StudentFooter` continues to own navigation presentation and obtains counts from `examAdapterService`, but it removes submission UI and separates the scrollable navigation area from a fixed progress count. The shared exam height contract uses CSS `max()` so the protected JavaScript height still rejects temporary shrinkage while `100dvh` lets the shell fill a taller visible viewport.

**Tech Stack:** React, TypeScript, Tailwind CSS, CSS dynamic viewport units, Vitest, Testing Library

---

### Task 1: Characterize the compact objective footer

**Files:**
- Modify: `src/components/student/__tests__/StudentFooterRepresentative.test.tsx`
- Modify: `src/components/student/StudentFooter.tsx`

- [ ] **Step 1: Write the failing layout regression test**

Add a test that renders two questions, queries the navigation row by `data-testid="student-footer-row"`, and asserts that the row contains the `0/2` progress text while no button named `Finish` exists.

```tsx
it('keeps overall progress in the question row and omits the Finish button', () => {
  render(<StudentFooter questions={questions} currentQuestionId="q1" onNavigate={() => {}} answers={{}} onSubmit={() => {}} />);
  const row = screen.getByTestId('student-footer-row');
  expect(within(row).getByText('0/2')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /finish/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --run src/components/student/__tests__/StudentFooterRepresentative.test.tsx`

Expected: FAIL because `student-footer-row` does not exist.

- [ ] **Step 3: Implement the one-row footer**

In `StudentFooter.tsx`, remove the separate top progress/Finish row. Add `data-testid="student-footer-row"` to the remaining row, make its navigation groups a `min-w-0 flex-1 overflow-x-auto` child, and render the existing `{answeredCount}/{totalQuestions}` chip as a non-scrolling `flex-shrink-0` child on the right. Do not render Finish in `tabletMode`; retain it beside the count outside tablet mode to preserve manual submission. Keep all existing question and part button behavior unchanged.

- [ ] **Step 4: Run the focused footer tests**

Run: `npm test -- --run src/components/student/__tests__/StudentFooterRepresentative.test.tsx src/components/student/__tests__/StudentQuestionExperience.test.tsx`

Expected: PASS.

### Task 2: Allow the protected exam viewport to grow

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/student/StudentApp.tsx`
- Modify: `src/components/student/__tests__/StudentApp.test.tsx`

- [ ] **Step 1: Write the failing viewport regression test**

Extend the iPad viewport tests with a case that starts with a protected height of `900px`, increases the dynamic viewport to `1000px`, and verifies the shell exposes the CSS height expression that can grow to `100dvh` without changing the protected custom property.

```tsx
expect(root.style.getPropertyValue('--student-viewport-height')).toBe('900px');
expect(screen.getByTestId('student-app-shell')).toHaveStyle({
  height: 'max(var(--student-viewport-height, 100dvh), 100dvh)',
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --run src/components/student/__tests__/StudentApp.test.tsx`

Expected: FAIL because the shell currently uses `var(--student-viewport-height, 100dvh)` directly.

- [ ] **Step 3: Implement the grow-only effective height contract**

Change the `StudentApp` inline shell height and the active `html`, `body`, and `.student-exam-shell` CSS height declarations to:

```css
height: max(var(--student-viewport-height, 100dvh), 100dvh);
```

Do not change the JavaScript viewport lock: it remains the protected lower bound that prevents keyboard and pinch shrinkage.

- [ ] **Step 4: Run viewport and footer regression tests**

Run: `npm test -- --run src/components/student/__tests__/StudentApp.test.tsx src/components/student/__tests__/StudentFooterRepresentative.test.tsx src/components/student/__tests__/StudentQuestionExperience.test.tsx`

Expected: PASS.

### Task 3: Verify the complete change

**Files:**
- Verify: `src/components/student/StudentFooter.tsx`
- Verify: `src/components/student/StudentApp.tsx`
- Verify: `src/index.css`
- Verify: `src/components/student/__tests__/StudentFooterRepresentative.test.tsx`
- Verify: `src/components/student/__tests__/StudentApp.test.tsx`

- [ ] **Step 1: Run static checks**

Run: `npm run typecheck`

Expected: exit code 0. If the repository has no `typecheck` script, run `npm run build` and expect exit code 0.

- [ ] **Step 2: Check patch hygiene**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 3: Review scope**

Run: `git diff -- src/components/student/StudentFooter.tsx src/components/student/StudentApp.tsx src/index.css src/components/student/__tests__/StudentFooterRepresentative.test.tsx src/components/student/__tests__/StudentApp.test.tsx`

Expected: only the footer layout, effective viewport height, and their regression tests changed; answer counting, navigation, autosave, submission, timer, and audit logic are untouched.
