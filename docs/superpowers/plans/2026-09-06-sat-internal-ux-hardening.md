# SAT Internal UX Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the SAT staff workspace against stale proctor actions, invalid scheduling, inaccessible menus/dialogs, undiscoverable access-link actions, and weak results filtering.

**Architecture:** Keep backend contracts, routes, and provider boundaries unchanged. Add pure scheduling validation, expose proctor freshness from the existing controller lifecycle, reuse Radix primitives for access-link menus/dialogs, and keep filtering as route-local derived state. Every behavior starts with a focused failing test.

**Tech Stack:** React, TypeScript, React Router, TanStack Query, Radix UI, Vitest, Testing Library, Playwright, ast-grep.

---

## Change-surface map

- Modify `src/products/sat/routes/SatSessionsRoute.tsx` for schedule validation and field feedback.
- Create `src/products/sat/routes/__tests__/scheduleValidation.test.ts` for the pure temporal validator.
- Modify `src/features/proctor/hooks/useProctorRouteController.ts` only if its existing refresh lifecycle cannot expose the required freshness state; otherwise derive freshness in `SatSessionRoomRoute.tsx`.
- Modify `src/products/sat/routes/SatSessionRoomRoute.tsx` for stale/read-only gating, last-update messaging, and action disabling.
- Modify `src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx` for degraded-state behavior.
- Modify `src/features/exam-authoring/ui/access-links/StudentLinksDashboard.tsx` for visible actions, Radix menu usage, and shared confirmation dialog usage.
- Create or extend `src/features/exam-authoring/ui/access-links/__tests__/StudentLinksDashboard.test.tsx` for keyboard/touch discoverability and revoke behavior.
- Modify `src/products/sat/routes/SatResultsRoute.tsx` for score-availability filters and differentiated empty states.
- Extend `src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx` for filtering.
- Modify `src/index.css` only for states required by the updated components; preserve existing SAT tokens and reduced-motion rules.
- Do not modify backend schemas, scoring logic, student delivery, or unrelated working-tree changes.

## Invariants

- A stale proctor view must never present high-impact mutations as safe to execute.
- Scheduling must never submit an end time at or before the start time.
- Entered form values survive validation and network failures.
- Destructive access-link revocation remains explicit and reversible only according to the existing backend contract.
- SAT result score semantics remain unchanged.
- Existing role and provider route boundaries remain unchanged.

---

### Task 1: Add the scheduling validation contract

**Files:**
- Create: `src/products/sat/routes/scheduleValidation.ts`
- Create: `src/products/sat/routes/__tests__/scheduleValidation.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests for required values, malformed dates, end-before-start, equal timestamps, and a valid range:

```ts
import { describe, expect, it } from 'vitest';
import { validateSatScheduleTimes } from '../scheduleValidation';

describe('validateSatScheduleTimes', () => {
  it('rejects missing values', () => {
    expect(validateSatScheduleTimes('', '')).toEqual({
      start: 'Choose a start time.',
      end: 'Choose an end time.',
    });
  });

  it('rejects an invalid date', () => {
    expect(validateSatScheduleTimes('not-a-date', '2026-09-01T10:00')).toEqual({
      start: 'Enter a valid start time.',
    });
  });

  it('rejects an end time that is not after the start', () => {
    expect(validateSatScheduleTimes('2026-09-01T10:00', '2026-09-01T10:00')).toEqual({
      end: 'End time must be after the start time.',
    });
  });

  it('accepts a valid range', () => {
    expect(validateSatScheduleTimes('2026-09-01T10:00', '2026-09-01T13:00')).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- --run src/products/sat/routes/__tests__/scheduleValidation.test.ts
```

Expected: FAIL because `scheduleValidation.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure validator**

Export a `SatScheduleTimeErrors` type and `validateSatScheduleTimes(start, end)` that returns only `start` and/or `end` messages. Parse with `new Date(value).getTime()` and compare timestamps only after both values are valid.

- [ ] **Step 4: Run the focused test**

Run the same command. Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/products/sat/routes/scheduleValidation.ts src/products/sat/routes/__tests__/scheduleValidation.test.ts
git commit -m "test: define SAT schedule time validation"
```

### Task 2: Integrate scheduling validation into the New Session form

**Files:**
- Modify: `src/products/sat/routes/SatSessionsRoute.tsx`
- Modify: `src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Add tests that open `New Session`, fill a start later than the end, submit, and assert an alert plus preserved values. Add a valid submission test asserting the existing mutation path remains unchanged.

```ts
it('explains an invalid session time range without clearing the form', async () => {
  renderRoute();
  fireEvent.click(screen.getByRole('button', { name: 'New Session' }));
  fireEvent.change(screen.getByLabelText('Session start time'), { target: { value: '2026-09-01T13:00' } });
  fireEvent.change(screen.getByLabelText('Session end time'), { target: { value: '2026-09-01T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('End time must be after the start time.');
  expect(screen.getByLabelText('Session start time')).toHaveValue('2026-09-01T13:00');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- --run src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx
```

Expected: FAIL because the current submit handler silently returns.

- [ ] **Step 3: Integrate validation**

Import the validator. Add `timeErrors` state to `NewSatSessionSheet`. On submit, calculate errors before building `ExamSchedule`; set errors and return when non-empty. Add `aria-invalid` and `aria-describedby` to the affected inputs, render field-level messages, and add a form-level `role="alert"` only when an error exists. Keep values intact. Clear each field’s error when it changes.

- [ ] **Step 4: Run focused tests**

```bash
npm test -- --run src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx
```

Expected: existing 2 tests plus the new validation test pass.

- [ ] **Step 5: Commit**

```bash
git add src/products/sat/routes/SatSessionsRoute.tsx src/products/sat/routes/__tests__/SatSessionsRoute.test.tsx
git commit -m "fix: validate SAT session time ranges"
```

### Task 3: Add proctor freshness state and mutation gating

**Files:**
- Inspect and possibly modify: `src/features/proctor/hooks/useProctorRouteController.ts`
- Modify: `src/products/sat/routes/SatSessionRoomRoute.tsx`
- Modify: `src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx`

- [ ] **Step 1: Map the existing refresh lifecycle**

Use AST and semantic inspection to identify the controller’s initial load, `reload`, polling, live-update, and error transitions. Prefer the existing controller as the source of truth. Do not create a second polling loop in the route.

- [ ] **Step 2: Write failing degraded-state tests**

Extend the controller mock with a freshness/degraded representation selected from the lifecycle inspection. Assert that a loaded session with a refresh error shows a stale warning, last-update text, Retry, and disabled high-impact actions. Assert that a healthy session keeps Start/Pause available.

- [ ] **Step 3: Run the tests to verify failure**

```bash
npm test -- --run src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx
```

Expected: FAIL because the current route only renders “Reconnecting” and does not disable actions.

- [ ] **Step 4: Implement the smallest source-of-truth change**

Expose `isStale`/`lastSuccessfulRefreshAt` or equivalent fields from the controller only if the lifecycle currently owns those facts. Set the timestamp after successful summary/detail refresh, preserve it across failed refreshes, and clear stale state after success. In `SatSessionRoomRoute`, render a persistent `role="alert"` warning with a human-readable timestamp and Retry. Pass a `disabled`/`blocked` prop into `SessionControls` and `StudentDetail`; disable Start, Pause, Resume, Add Time, Send Warning, End Attempt, Finish Session, and session extension while stale. Keep read-only roster/session data visible.

- [ ] **Step 5: Run focused tests**

```bash
npm test -- --run src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx
```

Expected: all session-room tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/proctor/hooks/useProctorRouteController.ts src/products/sat/routes/SatSessionRoomRoute.tsx src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx
git commit -m "fix: gate SAT proctor actions on stale data"
```

### Task 4: Replace access-link custom menu and confirmation behavior

**Files:**
- Modify: `src/features/exam-authoring/ui/access-links/StudentLinksDashboard.tsx`
- Modify or create: `src/features/exam-authoring/ui/access-links/__tests__/StudentLinksDashboard.test.tsx`
- Reuse: `src/products/sat/ui/ConfirmDialog.tsx` only if its API can be shared without introducing a reverse feature dependency; otherwise use the existing Radix dialog dependency locally.

- [ ] **Step 1: Write failing keyboard and visibility tests**

Test that row Copy/Share/More controls are visible in the rendered DOM without hover-only CSS assumptions, More opens a `menu`, Escape closes it, and revoke opens an `alertdialog` with the destructive action and accessible description.

- [ ] **Step 2: Run focused tests to verify failure**

```bash
npm test -- --run src/features/exam-authoring/ui/access-links/__tests__/StudentLinksDashboard.test.tsx
```

Expected: FAIL because the current menu is a styled `div` and the local confirmation dialog lacks complete focus behavior.

- [ ] **Step 3: Implement menu semantics and discoverability**

Use Radix DropdownMenu for row-level More actions, or extract a small shared menu wrapper if the existing SAT primitive cannot be imported in this direction. Add `aria-haspopup`, `aria-expanded`, labeled triggers, menu items, Escape/outside dismissal, and focus restoration. Remove `opacity-0` as the only discoverability mechanism; retain hover styling but keep actions available to touch and keyboard users.

- [ ] **Step 4: Implement the revoke dialog with complete focus behavior**

Use Radix AlertDialog with an explicit title, consequence description, Cancel, and `Revoke Link`. Ensure the dialog opens from the row trigger, focuses the safe/default control according to the existing dialog convention, traps focus, closes on Escape, and restores focus to the trigger. Preserve the current mutation and error handling.

- [ ] **Step 5: Run focused tests**

```bash
npm test -- --run src/features/exam-authoring/ui/access-links/__tests__/StudentLinksDashboard.test.tsx
```

Expected: all new interaction tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/exam-authoring/ui/access-links/StudentLinksDashboard.tsx src/features/exam-authoring/ui/access-links/__tests__/StudentLinksDashboard.test.tsx
# Include any shared primitive file only if it was changed.
git commit -m "fix: harden SAT student-link actions"
```

### Task 5: Add score-availability filters and truthful empty states

**Files:**
- Modify: `src/products/sat/routes/SatResultsRoute.tsx`
- Modify: `src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx`

- [ ] **Step 1: Write failing result-filter tests**

Add fixtures with one scored and one unscored result. Assert that All, Score available, and Score unavailable filter counts and rows correctly. Assert that a no-match filter says it found no matching results, while an empty dataset says no SAT results yet.

- [ ] **Step 2: Run focused tests to verify failure**

```bash
npm test -- --run src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx
```

Expected: FAIL because no score filter exists.

- [ ] **Step 3: Implement route-local derived filtering**

Add a small union type and state for `all | scored | unavailable`. Derive filtered results from the existing query data and search term. Render a labeled native button/radio-style control consistent with existing SAT segmented controls. Keep score labels and score calculations unchanged.

- [ ] **Step 4: Run focused tests**

```bash
npm test -- --run src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx
```

Expected: all result tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/products/sat/routes/SatResultsRoute.tsx src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx
git commit -m "feat: filter SAT results by score availability"
```

### Task 6: Audit and finish shared visual/accessibility states

**Files:**
- Modify: `src/index.css` only where required.
- Modify affected components from Tasks 2–5 if tests expose missing focus, disabled, or reduced-motion states.

- [ ] **Step 1: Add regression assertions for focus and reduced motion**

Confirm every new interactive control has a visible `:focus-visible` state, disabled state, readable contrast, and at least a 40px effective target where applicable. Confirm new dialogs/menus do not add animation that violates the existing reduced-motion rules.

- [ ] **Step 2: Run the SAT accessibility test configuration**

```bash
npx playwright test --config=playwright.sat-a11y.config.ts
```

Expected: no new keyboard, focus, or contrast failures.

- [ ] **Step 3: Commit any focused CSS/accessibility corrections**

```bash
git add src/index.css src/products/sat src/features/exam-authoring/ui/access-links
 git commit -m "fix: complete SAT interaction states"
```

### Task 7: Full verification and change-chain audit

**Files:**
- No intentional source changes; inspect all modified files.

- [ ] **Step 1: Re-run AST parse and interaction discovery**

```bash
for f in $(find src/products/sat src/features/exam-authoring/ui/access-links src/features/proctor/hooks -type f -name '*.tsx' -o -name '*.ts'); do
  ast-grep --lang tsx --pattern '$_' "$f" >/dev/null || exit 1
done
```

Then use AST queries to confirm the modified components, imports, exports, and route consumers resolve without dangling references.

- [ ] **Step 2: Run typecheck and lint**

```bash
npm run typecheck --if-present
npm run lint --if-present
```

Expected: exit code 0.

- [ ] **Step 3: Run the complete SAT unit suite**

```bash
npm test -- --run src/products/sat
```

Expected: all SAT tests pass, including new regression coverage.

- [ ] **Step 4: Run affected authoring/proctor tests**

```bash
npm test -- --run src/features/exam-authoring src/features/proctor
```

Expected: no regressions in shared consumers.

- [ ] **Step 5: Run relevant E2E workflows**

```bash
npx playwright test e2e/sat-product-workspace.spec.ts e2e/proctor-dashboard.spec.ts e2e/proctor-workflow.spec.ts --config=playwright.config.ts
```

Expected: SAT create/publish/access/session/result workflow passes and existing proctor workflows remain green.

- [ ] **Step 6: Audit the final diff and working tree**

```bash
git diff --check
git status --short
git diff --stat HEAD~5..HEAD
```

Confirm only the approved SAT hardening files and commits changed. Do not stage or revert the user’s pre-existing unrelated modifications.

- [ ] **Step 7: Final verification report**

Report changed files, AST checks, typecheck/lint output, unit/E2E results, and any remaining uncertainty. Do not claim completion if any critical verification fails.
