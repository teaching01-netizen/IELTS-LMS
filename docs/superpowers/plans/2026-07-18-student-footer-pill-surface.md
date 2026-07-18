# Student Footer Pill Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the visible grey footer tray while preserving the fixed floating pill and its unobscured-content reserve.

**Architecture:** Keep the existing two-row shell, fixed footer, and safe-area geometry. Change only the CSS surface treatment: make the reserved workspace area white, remove the pill border, and replace its heavy shadow with a subtle layered elevation shadow.

**Tech Stack:** CSS, Vitest

---

### Task 1: Encode the Surface Contract

**Files:**
- Modify: `src/components/student/__tests__/StudentViewportCss.test.ts`

- [ ] **Step 1: Add failing surface assertions**

Require the main rule to contain an opaque white background. Require the footer rule to omit an
explicit border and use a comma-separated layered shadow whose alpha values remain below `0.15`.
Keep all existing fixed-position, radius, safe-area, and reserve assertions.

- [ ] **Step 2: Run the test and verify RED**

```bash
npx vitest run src/components/student/__tests__/StudentViewportCss.test.ts
```

Expected: FAIL because the main clearance is transparent and the pill still has a grey border and
single `0.2` alpha shadow.

### Task 2: Refine the Footer Surface

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Apply the minimal surface correction**

Set `.student-exam-main` to the existing white exam-canvas color. Remove the footer border and use:

```css
box-shadow:
  0 1px 2px rgba(9, 30, 66, 0.08),
  0 8px 24px rgba(9, 30, 66, 0.12);
```

Do not change footer reserve, positioning, radius, safe-area insets, or React markup.

- [ ] **Step 2: Run the structural test and verify GREEN**

```bash
npx vitest run src/components/student/__tests__/StudentViewportCss.test.ts
```

Expected: PASS.

### Task 3: Verify and Record the Correction

**Files:**
- Modify: `docs/failure-cases.md`

- [ ] **Step 1: Extend the footer failure note**

Record that reserved overlay clearance must visually continue the exam canvas and that the pill uses
one subtle elevation language rather than a grey tray plus border and heavy shadow.

- [ ] **Step 2: Run focused footer tests**

```bash
npx vitest run \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/StudentFooterRepresentative.test.tsx \
  src/components/student/__tests__/StudentWriting.a11y.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 3: Run static and production checks**

```bash
npx eslint src/components/student/__tests__/StudentViewportCss.test.ts
npm run build
```

Expected: both commands exit zero.
