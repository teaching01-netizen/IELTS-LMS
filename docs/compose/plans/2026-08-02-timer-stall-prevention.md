# Timer Stall Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the runtime-backed student countdown advancing when answer activity or live-session updates replace runtime snapshots during an active exam.

**Architecture:** The countdown ticker remains owned by `StudentRuntimeProvider`, but its lifecycle is keyed only to whether runtime-backed exam timing is active. Each tick reads the current runtime deadline and clock offset through refs, so snapshot identity and offset smoothing cannot cancel the ticker. A focused provider regression test will simulate equal-revision snapshot churn with fake timers.

**Tech Stack:** React, TypeScript, Vitest, React Testing Library.

## Global Constraints

- Submitted exam answers are immutable.
- Autosave must be idempotent.
- Student-visible “saved/verified” state must match persisted reality.
- Timer fairness must not be bypassed by reload/refresh.
- Integrity and audit events must be append-only and traceable.
- Preserve unrelated existing worktree changes.
- Do not change server timing or attempt persistence behavior in this fix.

---

### Task 1: Decouple the runtime countdown ticker from snapshot churn

**Covers:** Approved timer-stall design: continuous runtime ticker, equal-revision snapshot resilience, regression coverage.

**Files:**
- Modify: `src/components/student/providers/StudentRuntimeProvider.tsx` around the runtime clock state/effects at lines 787 and 947-1023.
- Test: `src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx` near the runtime-backed display-time tests around lines 455-507.

**Interfaces:**
- Consumes: Existing `runtimeSnapshot`, `runtimeBacked`, `runtimeState.phase`, `clockOffsetMs`, and `resolveRuntimeDisplayRemainingSeconds` behavior.
- Produces: The same public provider state and display values, with the ticker continuing across runtime snapshot object replacements.

- [ ] **Step 1: Write the failing regression test**

  Extend the existing runtime-backed fake-timer harness. Start with a runtime deadline ten seconds in the future, then repeatedly rerender with newly allocated runtime snapshots carrying the same revision and deadline while advancing fake time in short increments. Assert that the displayed remaining time reaches the next visible second instead of staying at the original value. Keep the test focused on snapshot replacement; do not test WebSocket or persistence internals in this provider test.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run:

  ```bash
  npx vitest run src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx -t "runtime-backed"
  ```

  Expected: the new churn case fails before the implementation change because each new runtime object tears down the pending ticker timeout.

- [ ] **Step 3: Add refs for the ticker’s latest timing inputs**

  Keep refs synchronized with the latest `runtimeSnapshot` and `clockOffsetMs` values. The refs are only for the timer callback; existing render/state calculations remain unchanged.

- [ ] **Step 4: Change the runtime ticker effect dependencies**

  Keep the existing early return for non-runtime-backed or non-exam phases. Inside the effect, read the latest deadline and offset from the refs when calculating the next delay. Keep the immediate scheduling and cleanup behavior, but change the dependency list to:

  ```ts
  [runtimeBacked, runtimeState.phase]
  ```

  Do not include `runtimeSnapshot` or `clockOffsetMs` in this effect’s dependency list. Do not alter the non-runtime-backed timer in this task unless the focused test demonstrates a directly related regression.

- [ ] **Step 5: Run the focused test and verify it passes**

  Run:

  ```bash
  npx vitest run src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx -t "runtime-backed"
  ```

  Expected: the new churn regression and the existing runtime-backed timer tests pass.

- [ ] **Step 6: Run the relevant typecheck/lint or full provider test file**

  Run the repository’s documented validation command from `package.json`; at minimum run:

  ```bash
  npx vitest run src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx
  npx tsc --noEmit
  ```

  Expected: both commands exit successfully. If the repository’s TypeScript command differs, use the exact script declared in `package.json` and report it.

- [ ] **Step 7: Review the final diff for scope and invariants**

  Confirm only the provider, its focused regression test, and this plan changed. Confirm no attempt payload, answer persistence, runtime revision, deadline, or submission behavior was modified.

- [ ] **Step 8: Commit the focused implementation**

  ```bash
  git add src/components/student/providers/StudentRuntimeProvider.tsx src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx docs/compose/plans/2026-08-02-timer-stall-prevention.md
  git commit -m "fix: prevent runtime timer starvation"
  ```
