# Student Footer Content Underlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let exam panes continue behind the fixed footer pill while preserving enough end-of-scroll clearance for all Reading, Listening, and Writing content.

**Architecture:** Remove footer padding from the shell-level main track. Define one typed student-module style constant for bottom padding and scroll padding, then merge it into every footer-adjacent scroll owner after existing component styles.

**Tech Stack:** React 18, TypeScript, CSS, Vitest, Testing Library

---

### Task 1: Encode the Underlay Ownership Contract

**Files:**
- Modify: `src/components/student/__tests__/StudentViewportCss.test.ts`
- Create: `src/components/student/__tests__/StudentFooterOverlayLayout.test.ts`

- [ ] **Step 1: Require a full-height main workspace**

Change `StudentViewportCss.test.ts` to require that `.student-exam-main` does not declare
`padding-block-end` while keeping all fixed footer, safe-area, radius, and surface assertions.

- [ ] **Step 2: Require one shared clearance owner**

Create a structural test that checks for
`src/components/student/studentFooterOverlayLayout.ts`, requires it to define both
`paddingBottom` and `scrollPaddingBottom` from `--student-exam-footer-reserve`, and requires
`StudentQuestionPanel.tsx`, `StudentReading.tsx`, `StudentListening.tsx`, and `StudentWriting.tsx` to
consume `STUDENT_FOOTER_SCROLL_CLEARANCE_STYLE`.

- [ ] **Step 3: Run both tests and verify RED**

```bash
npx vitest run \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/StudentFooterOverlayLayout.test.ts
```

Expected: FAIL because main still reserves footer space and the shared layout module does not exist.

### Task 2: Move Clearance Into Scroll Owners

**Files:**
- Create: `src/components/student/studentFooterOverlayLayout.ts`
- Modify: `src/index.css`
- Modify: `src/components/student/StudentQuestionPanel.tsx`
- Modify: `src/components/student/StudentReading.tsx`
- Modify: `src/components/student/StudentListening.tsx`
- Modify: `src/components/student/StudentWriting.tsx`

- [ ] **Step 1: Create the typed style contract**

Export a `React.CSSProperties`-compatible constant with physical bottom padding and scroll padding,
both using `var(--student-exam-footer-reserve)`.

- [ ] **Step 2: Remove main-level reserve**

Delete only `padding-block-end: var(--student-exam-footer-reserve)` from `.student-exam-main`.
Keep the reserve custom property because the fixed question stepper and scroll owners consume it.

- [ ] **Step 3: Apply clearance after existing styles**

Merge the shared constant last into:

- objective `StudentQuestionPanel` scroll container;
- Reading passage scroll container;
- Listening material scroll container;
- Writing prompt scroll container;
- Writing response textarea.

Do not change element order, handlers, zoom data attributes, or footer markup.

- [ ] **Step 4: Run the Task 1 tests and verify GREEN**

Run the Task 1 command. Expected: both test files pass.

### Task 3: Verify Rendered Scroll Clearance

**Files:**
- Modify: `src/components/student/__tests__/StudentWriting.a11y.test.tsx`
- Modify: `src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx`
- Modify: `src/components/student/__tests__/StudentQuestionExperience.test.tsx`

- [ ] **Step 1: Assert Writing prompt and editor styles**

Render Writing and assert that the prompt's nearest zoom-scroll owner and the writing textbox have
`padding-bottom` and `scroll-padding-bottom` set to the shared reserve variable.

- [ ] **Step 2: Assert Reading and Listening styles**

Use existing representative renders to assert the Reading passage pane, Listening material pane,
and objective question pane expose the same two inline style properties.

- [ ] **Step 3: Run the affected component tests**

```bash
npx vitest run \
  src/components/student/__tests__/StudentWriting.a11y.test.tsx \
  src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx \
  src/components/student/__tests__/StudentQuestionExperience.test.tsx
```

Expected: all selected tests pass.

### Task 4: Update Memory and Verify

**Files:**
- Modify: `docs/ux-invariants.md`
- Modify: `docs/failure-cases.md`
- Modify: `e2e/student-ipad-layout.spec.ts`

- [ ] **Step 1: Update the overlay invariant**

Document that main-level reserve is forbidden and each scroll owner owns its end clearance.

- [ ] **Step 2: Add browser geometry assertion**

Assert that `.student-exam-main` reaches the viewport bottom behind the inset footer while the
footer remains visible and fixed.

- [ ] **Step 3: Run focused verification**

```bash
npx vitest run \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/StudentFooterOverlayLayout.test.ts \
  src/components/student/__tests__/StudentFooterRepresentative.test.tsx \
  src/components/student/__tests__/StudentWriting.a11y.test.tsx \
  src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx \
  src/components/student/__tests__/StudentQuestionExperience.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 4: Run static and production checks**

```bash
npx eslint \
  src/components/student/studentFooterOverlayLayout.ts \
  src/components/student/StudentQuestionPanel.tsx \
  src/components/student/StudentReading.tsx \
  src/components/student/StudentListening.tsx \
  src/components/student/StudentWriting.tsx \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/StudentFooterOverlayLayout.test.ts \
  e2e/student-ipad-layout.spec.ts
npm run build
```

Expected: zero lint errors and a successful production build.
