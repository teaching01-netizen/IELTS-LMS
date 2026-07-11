# Student Dialog Centering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every native modal dialog in the student exam centered in the viewport.

**Architecture:** Repair the shared native-dialog CSS contract in `src/index.css` because Tailwind preflight removed the user-agent automatic margins. Protect the contract with a focused stylesheet regression test and document the student UI invariant.

**Tech Stack:** React 19, Tailwind CSS 4, native HTML dialog, Vitest, Playwright

---

### Task 1: Protect the shared dialog positioning contract

**Files:**
- Create: `src/components/student/__tests__/StudentDialogCss.test.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Write the failing stylesheet test**

Read `src/index.css`, extract the `dialog[open]` rule, and assert that it contains `margin: auto`.

- [ ] **Step 2: Verify the test fails for the reported regression**

Run `npm run test:run -- src/components/student/__tests__/StudentDialogCss.test.ts`. Expect one failed assertion because the rule does not restore automatic margins.

- [ ] **Step 3: Restore native centering**

Add `margin: auto;` to the existing `dialog[open]` base rule without changing dialog dimensions, lifecycle, or component markup.

- [ ] **Step 4: Verify focused behavior**

Run the new CSS test together with Question Navigator and Accessibility Settings tests. Expect all tests to pass.

### Task 2: Record and validate the invariant

**Files:**
- Modify: `docs/ux-invariants.md`

- [ ] **Step 1: Document ownership and must-not-break behavior**

Add a Student Exam Dialog Positioning section naming the shared stylesheet, native-dialog consumers, viewport-centering invariant, and regression test.

- [ ] **Step 2: Run repository checks**

Run `npm run typecheck` and `npm run build`; both must exit successfully. Run the focused Playwright tablet geometry check if its local fixture is runnable.

