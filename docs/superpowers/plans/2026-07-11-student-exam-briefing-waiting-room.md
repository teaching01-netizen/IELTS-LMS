# Student Exam Briefing and Waiting Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace technical system-check UI with live exam information and a proctor-controlled waiting room for every production exam.

**Architecture:** Evolve the student pre-entry component into a shared briefing/waiting presentation while keeping its compatibility snapshot private and persisted. StudentApp routes completed pre-checks to lobby and relies on StudentRuntimeProvider's existing server hydration to advance lobby to exam when the runtime starts.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Playwright, Tailwind CSS.

---

### Task 1: Briefing and waiting presentation

**Files:**
- Modify: `src/components/student/PreCheck.tsx`
- Modify: `src/components/student/Lobby.tsx`
- Modify: `src/components/student/__tests__/PreCheck.test.tsx`
- Test: `src/components/student/__tests__/Lobby.test.tsx`

- [ ] Write failing tests for live enabled sections, configured total duration, approved copy, candidate/exam identity, CTA labels, hidden technical results, silent payload persistence, retry, and no student Start Exam control.
- [ ] Run the focused tests and confirm failures are caused by missing briefing/waiting behavior.
- [ ] Implement one shared semantic card presentation with `briefing` and `waiting` modes; preserve the silent check payload and submit error path.
- [ ] Run the focused component tests and confirm they pass.

### Task 2: Runtime phase integration

**Files:**
- Modify: `src/components/student/StudentApp.tsx`
- Modify: `src/components/student/providers/StudentRuntimeProvider.tsx` only if reload phase normalization requires it
- Modify: `src/components/student/__tests__/StudentProviderRuntime.test.tsx`
- Modify: `src/components/student/__tests__/StudentApp.test.tsx` only for focused render integration

- [ ] Write a failing integration test proving Continue persists pre-check, enters waiting with no workspace/start button, and a live runtime automatically enters the exam.
- [ ] Run the focused test and confirm the intended failure.
- [ ] Route completed production pre-checks to lobby for runtime-backed sessions and render the waiting presentation for runtime-backed lobby state.
- [ ] Ensure runtime hydration remains the only production transition from lobby to exam.
- [ ] Run provider and StudentApp tests.

### Task 3: Contracts and memory

**Files:**
- Modify: `e2e/support/studentUi.ts`
- Modify: `e2e/student-precheck.spec.ts`
- Modify: `docs/failure-cases.md`

- [ ] Update E2E selectors from system checking/start controls to briefing/waiting language without weakening runtime assertions.
- [ ] Document that technical checks are silent but still persisted, and that waiting is released only by proctor runtime state.
- [ ] Run targeted unit tests, typecheck, lint changed files, build, and the feasible focused E2E check.

## Acceptance Criteria

- [ ] Every production exam shows configured exam information before waiting.
- [ ] Total and per-section durations come from enabled exam settings.
- [ ] Continue persists the silent pre-check and enters the waiting room.
- [ ] The same UI shell shows waiting text and no student start control.
- [ ] Proctor runtime start automatically opens the exam and controls the timer.
- [ ] Focused regression tests, typecheck, lint, and build pass or any environmental blocker is reported.
