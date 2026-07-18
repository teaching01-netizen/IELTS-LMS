# Student Exam CSS Viewport Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inferred JavaScript viewport geometry with a CSS-owned fixed grid shell that cannot retain a stale height or origin after keyboard dismissal.

**Architecture:** The browser layout engine becomes the sole shell-geometry authority. `StudentApp` renders a fixed `inset: 0` three-row grid; header and footer are intrinsic grid rows and the workspace is the only flexible row. The viewport policy/controller and all geometry custom properties are removed atomically, while the viewport meta policy requests keyboard overlay behavior as a progressive enhancement.

**Tech Stack:** React 18, TypeScript, CSS Grid, Vitest/Testing Library, Playwright, ESLint

---

## File Map

- Modify `src/components/student/StudentApp.tsx`: stop installing the geometry controller, remove the inline height authority, and let CSS own the exam shell layout.
- Modify `src/components/student/StudentExamWorkspace.tsx`: attach the existing `student-exam-main` hook to the grid's flexible row.
- Modify `src/index.css`: replace measured height/top and sticky footer rules with the fixed three-row grid and root containment.
- Modify `src/components/student/examPageZoomGuard.ts`: request `interactive-widget=overlays-content` where supported while preserving zoom protections and exact cleanup.
- Modify `src/components/student/__tests__/StudentViewportCss.test.ts`: encode the CSS-only shell and prohibit geometry variables.
- Modify `src/components/student/__tests__/StudentApp.test.tsx`: replace state-machine lifecycle cases with a no-geometry-write integration regression.
- Modify `src/components/student/__tests__/examPageZoomGuard.test.ts`: encode the progressive overlay request.
- Delete `src/components/student/studentExamViewportPolicy.ts`: remove the obsolete inferred-geometry state machine.
- Delete `src/components/student/studentExamViewportController.ts`: remove viewport/focus listeners, timers, and CSS-variable publishing.
- Delete `src/components/student/__tests__/studentExamViewportPolicy.test.ts`: remove tests for deleted behavior.
- Delete `src/components/student/__tests__/studentExamViewportController.test.ts`: remove tests for deleted behavior.
- Modify `e2e/student-ipad-layout.spec.ts`: assert the grid shell boundary and both orientation layouts.
- Modify `docs/ux-invariants.md`: make CSS layout the only viewport owner.
- Modify `docs/failure-cases.md`: record why the inferred-geometry architecture was removed.

## Must Not Break

- Answer mutations, autosave, submission, timers, integrity events, and audit events are untouched.
- The viewport meta element is restored exactly on exam cleanup.
- Page zoom protection and media-specific zoom continue to work.
- Reading/listening/writing panes remain the only content scroll owners.
- Safe-area padding remains CSS-owned and is not double-counted.
- The migration is atomic: the JavaScript geometry controller and CSS-only shell never coexist in a committed production state.

### Task 1: Encode the CSS-Only Contract in Failing Tests

**Files:**
- Modify: `src/components/student/__tests__/StudentViewportCss.test.ts`
- Modify: `src/components/student/__tests__/examPageZoomGuard.test.ts`
- Modify: `src/components/student/__tests__/StudentApp.test.tsx:402-1175`

- [ ] **Step 1: Replace the measured-rectangle CSS test with the fixed-grid contract**

Replace the body of `StudentViewportCss.test.ts` with:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student exam CSS-owned viewport shell', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('uses one fixed grid constraint system without measured geometry', () => {
    const activeDocumentRule = css.match(
      /html\.student-exam-active,\s*body\.student-exam-active\s*\{([^}]*)\}/s,
    )?.[1];
    const shellRule = css.match(/\.student-exam-shell\s*\{([^}]*)\}/s)?.[1];
    const footerRule = css.match(/\.student-exam-footer\s*\{([^}]*)\}/s)?.[1];

    expect(activeDocumentRule).toBeDefined();
    expect(activeDocumentRule).toMatch(/overflow:\s*hidden\s*;/);
    expect(activeDocumentRule).not.toMatch(/--student-viewport-/);
    expect(activeDocumentRule).not.toMatch(/height:\s*(?:100v|var\()/);

    expect(shellRule).toBeDefined();
    expect(shellRule).toMatch(/position:\s*fixed\s*;/);
    expect(shellRule).toMatch(/inset:\s*0\s*;/);
    expect(shellRule).toMatch(/display:\s*grid\s*;/);
    expect(shellRule).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s*;/);
    expect(shellRule).not.toMatch(/--student-viewport-/);
    expect(shellRule).not.toMatch(/(?:^|;)\s*(?:height|top):/);

    expect(footerRule).toBeDefined();
    expect(footerRule).not.toMatch(/position:\s*(?:sticky|fixed)\s*;/);
    expect(css).not.toContain('--student-viewport-height');
    expect(css).not.toContain('--student-viewport-offset-top');
  });
});
```

- [ ] **Step 2: Change the viewport-meta assertion to overlay behavior**

In `examPageZoomGuard.test.ts`, change only the policy assertion:

```ts
expect(EXAM_VIEWPORT_CONTENT).toContain('interactive-widget=overlays-content');
expect(EXAM_VIEWPORT_CONTENT).not.toContain('interactive-widget=resizes-visual');
```

Keep the exact original-content restoration, created-element cleanup, and gesture tests unchanged.

- [ ] **Step 3: Replace geometry lifecycle tests with one no-state integration test**

Delete the viewport-specific test block beginning with `settles a reused tab...` and ending with
`rebases after a material window-width change...`. Retain the shared `installVisualViewportMock`
helper because the new regression dispatches hostile browser event sequences.

Insert this test where that block started:

```tsx
it('never writes shell geometry during reused-tab and keyboard viewport events', async () => {
  const visualViewport = installVisualViewportMock(640, 120);
  const root = document.documentElement;
  root.style.removeProperty('--student-viewport-height');
  root.style.removeProperty('--student-viewport-offset-top');

  try {
    const { container } = render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={createWritingAttemptSnapshot()}
        runtimeSnapshot={createWritingRuntimeSnapshot()}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: /writing response/i });
    const shell = container.querySelector<HTMLElement>('.student-exam-shell');
    expect(shell).not.toBeNull();
    expect(shell?.style.height).toBe('');

    act(() => {
      visualViewport.setHeight(900);
      visualViewport.setOffsetTop(0);
      visualViewport.dispatchResize();
      editor.focus();
      visualViewport.setHeight(560);
      visualViewport.setOffsetTop(180);
      visualViewport.dispatchResize();
      editor.blur();
      visualViewport.setHeight(900);
      visualViewport.dispatchResize();
      visualViewport.setOffsetTop(0);
      visualViewport.dispatchScroll();
    });

    expect(root.style.getPropertyValue('--student-viewport-height')).toBe('');
    expect(root.style.getPropertyValue('--student-viewport-offset-top')).toBe('');
    expect(shell?.style.height).toBe('');
    expect(shell?.style.top).toBe('');
  } finally {
    visualViewport.restore();
  }
});
```

- [ ] **Step 4: Run the new contract tests and verify RED**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/examPageZoomGuard.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  -t 'CSS-owned viewport|viewport policy|never writes shell geometry'
```

Expected: FAIL because the shell still contains measured height/top rules, the meta policy still
uses `resizes-visual`, and `StudentApp` still publishes viewport custom properties.

### Task 2: Replace the Viewport Subsystem Atomically

**Files:**
- Modify: `src/components/student/StudentApp.tsx`
- Modify: `src/components/student/StudentExamWorkspace.tsx`
- Modify: `src/index.css`
- Modify: `src/components/student/examPageZoomGuard.ts`
- Delete: `src/components/student/studentExamViewportPolicy.ts`
- Delete: `src/components/student/studentExamViewportController.ts`
- Delete: `src/components/student/__tests__/studentExamViewportPolicy.test.ts`
- Delete: `src/components/student/__tests__/studentExamViewportController.test.ts`
- Test: `src/components/student/__tests__/StudentViewportCss.test.ts`
- Test: `src/components/student/__tests__/StudentApp.test.tsx`
- Test: `src/components/student/__tests__/examPageZoomGuard.test.ts`

- [ ] **Step 1: Remove the controller and inline height authority from StudentApp**

Delete this import:

```ts
import { installStudentExamViewportController } from './studentExamViewportController';
```

Delete the entire effect that calls `installStudentExamViewportController`. Do not alter the
separate exam-active class lifecycle or `installExamPageZoomGuard` lifecycle.

Remove the `height` entry from `studentShellStyle`:

```ts
const studentShellStyle = {
  zoom: tabletMode ? 1 : uiState.accessibilitySettings.zoom,
  fontSize: studentTypography.rootFontSize,
  // keep every existing typography custom property unchanged
};
```

Change the active shell class from:

```tsx
className={`student-exam-shell flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900 transition-all ${
```

to:

```tsx
className={`student-exam-shell w-full bg-gray-50 font-sans text-gray-900 transition-all ${
```

Do not remove `h-screen` from non-exam loading, blocking, or terminal screens in this task.

- [ ] **Step 2: Mark the workspace as the flexible grid row**

In `StudentExamWorkspace.tsx`, change the main element to:

```tsx
<main
  id="main-content"
  className="student-exam-main flex-1 overflow-hidden relative flex flex-col"
  role="main"
>
```

Do not change the reading, listening, writing, or speaking children.

- [ ] **Step 3: Make CSS the single shell authority**

Replace the active root, shell, and footer rules in `src/index.css` with:

```css
html.student-exam-active,
body.student-exam-active {
  width: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}

.student-exam-shell {
  position: fixed;
  inset: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  overflow: hidden;
  overflow: clip;
  overscroll-behavior: none;
  touch-action: manipulation;
  padding-left: env(safe-area-inset-left, 0);
  padding-right: env(safe-area-inset-right, 0);
}

.student-exam-main,
.student-adaptive-workspace {
  min-height: 0;
  min-width: 0;
}

.student-exam-footer {
  left: 0;
  right: 0;
  padding-bottom: max(0.375rem, env(safe-area-inset-bottom, 0));
  padding-left: env(safe-area-inset-left, 0);
  padding-right: env(safe-area-inset-right, 0);
}
```

Preserve the existing `.student-adaptive-workspace`, pane, separator, question-stepper, and media
rules below this block. Do not add viewport-unit height fallbacks to the fixed shell.

- [ ] **Step 4: Change the progressive keyboard request**

Set the constant in `examPageZoomGuard.ts` to:

```ts
export const EXAM_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=overlays-content';
```

Do not change gesture prevention or cleanup behavior.

- [ ] **Step 5: Delete the obsolete geometry implementation and tests**

Delete these four files in the same patch/commit:

```text
src/components/student/studentExamViewportPolicy.ts
src/components/student/studentExamViewportController.ts
src/components/student/__tests__/studentExamViewportPolicy.test.ts
src/components/student/__tests__/studentExamViewportController.test.ts
```

Then prove there are no production references or custom-property writes:

```bash
rg -n 'studentExamViewport|--student-viewport-height|--student-viewport-offset-top' src
```

Expected: no matches. A match in a newly rewritten negative test is acceptable only if it is an
assertion string; production files must have zero matches.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/examPageZoomGuard.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  -t 'CSS-owned viewport|viewport policy|never writes shell geometry|page zoom|footer|keyboard'
```

Expected: all selected tests pass with zero unhandled errors.

- [ ] **Step 7: Run the complete affected component suites**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/examPageZoomGuard.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx
```

Expected: all three files pass.

- [ ] **Step 8: Commit the atomic architecture replacement**

```bash
git add \
  src/components/student/StudentApp.tsx \
  src/components/student/StudentExamWorkspace.tsx \
  src/index.css \
  src/components/student/examPageZoomGuard.ts \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/examPageZoomGuard.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  src/components/student/studentExamViewportPolicy.ts \
  src/components/student/studentExamViewportController.ts \
  src/components/student/__tests__/studentExamViewportPolicy.test.ts \
  src/components/student/__tests__/studentExamViewportController.test.ts
git commit -m "refactor(student): make CSS own the exam viewport shell"
```

### Task 3: Preserve Browser-Level Layout Coverage

**Files:**
- Modify: `e2e/student-ipad-layout.spec.ts`

- [ ] **Step 1: Add a helper that checks the fixed-grid shell contract**

Add below `expectExamChromeAlignedToViewport`:

```ts
async function expectCssOwnedExamShell(page: Page) {
  const shell = page.locator('.student-exam-shell');
  await expect(shell).toBeVisible();
  await expect(shell).toHaveCSS('position', 'fixed');
  await expect(shell).toHaveCSS('display', 'grid');

  const geometry = await shell.evaluate((element) => ({
    heightProperty: (element as HTMLElement).style.height,
    offsetProperty: document.documentElement.style.getPropertyValue(
      '--student-viewport-offset-top',
    ),
    measuredHeightProperty: document.documentElement.style.getPropertyValue(
      '--student-viewport-height',
    ),
  }));

  expect(geometry).toEqual({
    heightProperty: '',
    offsetProperty: '',
    measuredHeightProperty: '',
  });
}
```

- [ ] **Step 2: Use the helper in both orientation flows**

After each `openPreview` call in the existing Reading and Writing orientation tests, add:

```ts
await expectCssOwnedExamShell(page);
await expectExamChromeAlignedToViewport(page, /navigation|submission/i);
```

If the existing footer label is more specific, pass its existing accessible-name expression rather
than weakening the footer selector.

- [ ] **Step 3: Run the browser test**

Run:

```bash
npx playwright test e2e/student-ipad-layout.spec.ts --project=chromium
```

Expected: all iPad layout tests pass. If the backend E2E manifest is unavailable, record the exact
setup failure and run the production build plus component suites; do not claim the browser test
passed.

- [ ] **Step 4: Commit browser coverage**

```bash
git add e2e/student-ipad-layout.spec.ts
git commit -m "test(student): cover CSS-owned exam viewport shell"
```

### Task 4: Replace the Repository Memory

**Files:**
- Modify: `docs/ux-invariants.md`
- Modify: `docs/failure-cases.md`

- [ ] **Step 1: Rewrite the Student Exam Visible Viewport invariant**

Replace only that section in `docs/ux-invariants.md`. The new section must state:

```markdown
### Owning Module

The active exam shell rectangle and row layout are owned by `src/index.css`. `StudentApp` owns only
the exam-active lifecycle class and shell markup. No JavaScript module owns viewport geometry.

### Invariant

The browser layout engine is the sole shell-geometry authority. The fixed `inset: 0` shell is a
three-row grid: intrinsic header, `minmax(0, 1fr)` workspace, intrinsic footer. Student code never
persists viewport height, vertical origin, or keyboard visibility.
```

The `Must Not Break` list must explicitly prohibit viewport geometry custom properties,
`VisualViewport` layout writes, focus-based geometry, sticky/fixed footer overrides, root scrolling,
and user-agent/version branches. Preserve safe-area, pane scrolling, zoom guard, answer, autosave,
timer, integrity, and audit invariants.

Set regression protection to:

```markdown
- `src/components/student/__tests__/StudentApp.test.tsx`
- `src/components/student/__tests__/StudentViewportCss.test.ts`
- `src/components/student/__tests__/examPageZoomGuard.test.ts`
- `e2e/student-ipad-layout.spec.ts`
```

- [ ] **Step 2: Add a failure-case entry for the architecture replacement**

Add a new top entry in `docs/failure-cases.md` with these facts:

- Symptom: repeated keyboard-dismissal sequences could still leave header/footer displacement.
- Root cause: application persisted Visual Viewport measurements into layout-viewport CSS despite
  browser-controlled, incomplete event ordering.
- Fix: delete the geometry state machine and use one fixed `inset: 0` CSS grid.
- Guarantee: the application cannot persist stale shell geometry; keyboard-time resizing remains
  browser-controlled.
- Regression paths: the four files listed above.

Do not rewrite older entries; they remain useful evidence explaining why the architecture changed.

- [ ] **Step 3: Verify documentation consistency**

Run:

```bash
rg -n 'studentExamViewportPolicy|studentExamViewportController|--student-viewport-' \
  docs/ux-invariants.md docs/failure-cases.md
git diff --check
```

Expected: old filenames/custom properties appear only inside historical failure-case entries, not
in the current invariant. `git diff --check` exits zero.

- [ ] **Step 4: Commit repository memory**

```bash
git add docs/ux-invariants.md docs/failure-cases.md
git commit -m "docs(student): record CSS-owned viewport invariant"
```

### Task 5: Final Verification and Scope Audit

**Files:**
- Verify all files changed above

- [ ] **Step 1: Run the complete focused regression set**

```bash
npx vitest run \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/examPageZoomGuard.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  src/components/student/__tests__/StudentSplitPaneCss.test.ts \
  src/components/student/__tests__/StudentDialogCss.test.ts
```

Expected: all test files pass with zero unhandled errors.

- [ ] **Step 2: Lint every changed TypeScript/TSX file**

```bash
npx eslint \
  src/components/student/StudentApp.tsx \
  src/components/student/StudentExamWorkspace.tsx \
  src/components/student/examPageZoomGuard.ts \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/examPageZoomGuard.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  e2e/student-ipad-layout.spec.ts
```

Expected: zero errors. Report existing warnings separately without claiming they were introduced.

- [ ] **Step 3: Run the production build**

```bash
npm run build
```

Expected: Vite build exits zero.

- [ ] **Step 4: Run TypeScript and isolate repository baseline failures if necessary**

```bash
npx tsc --noEmit --pretty false > /tmp/student-css-viewport-tsc.log 2>&1
```

Expected target: exit zero. If the repository's known unrelated TypeScript baseline remains
nonzero, report the total and prove none reference the changed files:

```bash
rg -n 'StudentApp|examPageZoomGuard|StudentViewportCss|student-ipad-layout' \
  /tmp/student-css-viewport-tsc.log
```

Expected fallback: no diagnostics in changed files.

- [ ] **Step 5: Audit removal and diff scope**

```bash
rg -n 'studentExamViewport|--student-viewport-height|--student-viewport-offset-top' src || true
git diff --check main..HEAD
git status --short
git diff --stat main..HEAD
```

Expected:

- no production viewport subsystem/custom-property matches;
- clean diff check;
- clean worktree;
- changes limited to the approved student shell, tests, viewport meta policy, E2E coverage, and
  repository memory.

- [ ] **Step 6: Perform the manual-device handoff checklist**

Document that deployment verification must cover:

```text
1. Paste/open the exam URL in a reused iPad browser tab.
2. Focus an answer, type, then tap outside to dismiss the keyboard.
3. Focus an answer, type, then use the keyboard-hide control while focus remains.
4. Rotate portrait/landscape with keyboard closed and open.
5. Expand/collapse browser chrome.
6. Repeat in Safari and a Chromium-branded iPadOS browser.
7. Confirm header/footer restore without scrolling or refocusing.
```

This checklist is device evidence, not a substitute for automated verification.

## Completion Criteria

- The four viewport policy/controller production and test files are deleted.
- `StudentApp` installs no viewport geometry listener and publishes no shell height.
- `src/index.css` contains one fixed `inset: 0` three-row grid authority.
- No production source contains either viewport geometry custom property.
- Viewport metadata requests overlay behavior and restores prior metadata exactly.
- Focused component tests, lint, and build pass.
- Browser test result or exact environment blocker is reported.
- Current invariants and failure memory describe the CSS-only architecture.
- Manual device verification remains explicitly required before declaring the physical-device bug resolved.
