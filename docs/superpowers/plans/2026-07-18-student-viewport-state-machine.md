# Student Exam Viewport State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace focusout-driven viewport rebasing with a capability-based state machine that preserves the last trusted full viewport across persistent keyboard geometry while retaining reused-tab and real topology recovery.

**Architecture:** Extract rectangle trust decisions into a pure `studentExamViewportPolicy.ts` reducer and leave browser measurement, event wiring, bounded recovery, and CSS publication in `studentExamViewportController.ts`. Install the same policy for every active exam, declare the standards-based interactive-widget behavior explicitly, and retain layered CSS fallbacks for older engines.

**Tech Stack:** React 18, TypeScript, DOM `VisualViewport`/viewport meta APIs, Vitest, Testing Library, CSS custom properties.

---

## File Map

- Create `src/components/student/studentExamViewportPolicy.ts`: pure state, event, validation, and rectangle acceptance rules.
- Create `src/components/student/__tests__/studentExamViewportPolicy.test.ts`: table-driven browser lifecycle coverage.
- Modify `src/components/student/studentExamViewportController.ts`: browser adapter around the pure policy.
- Modify `src/components/student/__tests__/studentExamViewportController.test.ts`: persistent stale keyboard, fallback, topology, and cleanup regressions.
- Modify `src/components/student/StudentApp.tsx`: install the policy for every active exam without device-family gating.
- Modify `src/components/student/__tests__/StudentApp.test.tsx`: correct the integration contract from downward focusout rebase to trusted-baseline restoration.
- Modify `src/components/student/examPageZoomGuard.ts`: declare `interactive-widget=resizes-visual` during an exam.
- Modify `src/components/student/__tests__/examPageZoomGuard.test.ts`: assert the explicit interactive-widget policy and exact restoration.
- Modify `src/index.css`: add ordered `100vh` and `100dvh` fallbacks before the exact measured height.
- Modify `src/components/student/__tests__/StudentViewportCss.test.ts`: assert the fallback order and reject competing bounds.
- Modify `docs/ux-invariants.md` and `docs/failure-cases.md`: record the trusted-rectangle and focusout invariants.

### Task 1: Pure Viewport Trust Policy

**Files:**
- Create: `src/components/student/studentExamViewportPolicy.ts`
- Create: `src/components/student/__tests__/studentExamViewportPolicy.test.ts`

- [ ] **Step 1: Write the failing pure-policy tests**

Create tests that import the wished-for reducer API and express the required state transitions:

```ts
import { describe, expect, it } from 'vitest';
import {
  createStudentExamViewportPolicy,
  reduceStudentExamViewportPolicy,
  type StudentExamViewportMeasurement,
} from '../studentExamViewportPolicy';

const sample = (
  visualHeight: number | null,
  options: Partial<StudentExamViewportMeasurement> = {},
): StudentExamViewportMeasurement => ({
  visualHeight,
  layoutHeight: 900,
  offsetTop: 0,
  layoutWidth: 1024,
  scale: 1,
  ...options,
});

describe('studentExamViewportPolicy', () => {
  it('preserves the trusted pre-keyboard rectangle when dismissal geometry stays smaller', () => {
    let state = createStudentExamViewportPolicy(sample(900));
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-entered' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(560, { offsetTop: 100 }),
    });
    expect(state.publishedRect).toEqual({ height: 900, offsetTop: 100 });

    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-left' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(820, { offsetTop: 20 }),
    });
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });

    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(810, { offsetTop: 10 }),
    });

    expect(state.mode).toBe('keyboard-recovery');
    expect(state.publishedRect).toEqual({ height: 900, offsetTop: 0 });
  });

  it('accepts late growth after keyboard dismissal', () => {
    let state = createStudentExamViewportPolicy(sample(900));
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-entered' });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-left' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(950, { layoutHeight: 950 }),
    });
    expect(state.mode).toBe('stable');
    expect(state.publishedRect.height).toBe(950);
  });

  it('allows bidirectional bootstrap and topology recovery', () => {
    let state = createStudentExamViewportPolicy(sample(640, { offsetTop: 120 }));
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(900),
    });
    expect(state.publishedRect).toEqual({ height: 900, offsetTop: 0 });

    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, { type: 'topology-recovery-started' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(700, { layoutHeight: 700, layoutWidth: 768 }),
    });
    expect(state.publishedRect.height).toBe(700);
  });

  it('accepts ordinary browser-chrome shrink after the viewport is stable', () => {
    let state = createStudentExamViewportPolicy(sample(900));
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(840, { layoutHeight: 900, offsetTop: 10 }),
    });
    expect(state.publishedRect).toEqual({ height: 840, offsetTop: 10 });
  });

  it('retains one keyboard baseline across editable focus transfer', () => {
    let state = createStudentExamViewportPolicy(sample(900));
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-entered' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(560, { offsetTop: 100 }),
    });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-entered' });
    state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-left' });
    expect(state.publishedRect).toEqual({ height: 900, offsetTop: 0 });
  });

  it('ignores invalid and scaled measurements while retaining the last trusted rectangle', () => {
    let state = createStudentExamViewportPolicy(sample(900));
    state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(0, { layoutHeight: 0 }),
    });
    state = reduceStudentExamViewportPolicy(state, {
      type: 'measurement-received',
      measurement: sample(600, { scale: 1.4 }),
    });
    expect(state.publishedRect.height).toBe(900);
  });
});
```

- [ ] **Step 2: Run the pure-policy test and verify RED**

Run:

```bash
npx vitest run src/components/student/__tests__/studentExamViewportPolicy.test.ts --exclude '.worktrees/**'
```

Expected: FAIL because `studentExamViewportPolicy.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure reducer**

Create these public types and transitions:

```ts
export interface StudentExamViewportRect {
  height: number;
  offsetTop: number;
}

export interface StudentExamViewportMeasurement {
  visualHeight: number | null;
  layoutHeight: number;
  offsetTop: number;
  layoutWidth: number;
  scale: number;
}

export type StudentExamViewportMode =
  | 'bootstrapping'
  | 'stable'
  | 'keyboard-active'
  | 'keyboard-recovery'
  | 'pinch-active'
  | 'topology-recovery';

export interface StudentExamViewportPolicyState {
  mode: StudentExamViewportMode;
  trustedRect: StudentExamViewportRect;
  publishedRect: StudentExamViewportRect;
  keyboardBaseline: StudentExamViewportRect | null;
  layoutWidth: number;
  modeBeforePinch: Exclude<StudentExamViewportMode, 'pinch-active'> | null;
}

export type StudentExamViewportPolicyEvent =
  | { type: 'measurement-received'; measurement: StudentExamViewportMeasurement }
  | { type: 'editable-focus-entered' }
  | { type: 'editable-focus-left' }
  | { type: 'bootstrap-recovery-started' }
  | { type: 'topology-recovery-started' }
  | { type: 'pinch-started' }
  | { type: 'pinch-finished' }
  | { type: 'recovery-finished' };
```

Implement one finite/positive measurement normalizer. Prefer `visualHeight`; fall back to
`layoutHeight`. In `keyboard-active`, preserve baseline height but follow the valid visual
`offsetTop`. In `keyboard-recovery`, publish the complete baseline and accept only native-scale
geometry at or above that baseline. A recovery deadline stops the observation loop but leaves the
policy in `keyboard-recovery` while samples remain smaller; this makes the floor persistent across
late resize/scroll events. The first native-scale sample at or above the baseline becomes trusted,
clears the keyboard baseline, and returns to `stable`. In `bootstrapping`, `stable`, and
`topology-recovery`, accept valid native-scale geometry in either direction. `pinch-active` and
non-native scale retain the trusted rectangle.

- [ ] **Step 4: Run the pure-policy tests and verify GREEN**

Run the Step 2 command.

Expected: 6 tests pass.

- [ ] **Step 5: Commit the pure policy**

```bash
git add src/components/student/studentExamViewportPolicy.ts \
  src/components/student/__tests__/studentExamViewportPolicy.test.ts
git commit -m "refactor(student): model trusted viewport states"
```

### Task 2: Browser Controller Adapter and Persistent Keyboard Regression

**Files:**
- Modify: `src/components/student/studentExamViewportController.ts`
- Modify: `src/components/student/__tests__/studentExamViewportController.test.ts`

- [ ] **Step 1: Change controller tests to reproduce the persistent production failure**

Replace the incorrect `900 -> 560 -> focusout -> 820` expectation with:

```ts
it('keeps the trusted full height when keyboard dismissal geometry remains smaller', () => {
  const viewport = installMutableVisualViewport(900);
  const input = document.createElement('input');
  document.body.append(input);
  const cleanup = installStudentExamViewportController({
    targetWindow: window,
    targetDocument: document,
  });

  try {
    vi.advanceTimersByTime(1_600);
    input.focus();
    viewport.set(560, 100);
    viewport.dispatchResize();
    expect(
      document.documentElement.style.getPropertyValue('--student-viewport-height'),
    ).toBe('900px');

    input.blur();
    viewport.set(820, 20);
    vi.advanceTimersByTime(1_600);

    expect(
      document.documentElement.style.getPropertyValue('--student-viewport-height'),
    ).toBe('900px');
    expect(
      document.documentElement.style.getPropertyValue('--student-viewport-offset-top'),
    ).toBe('0px');
  } finally {
    cleanup();
    viewport.restore();
  }
});
```

Add these focused cases using the existing mutable viewport helper:

```ts
it('accepts late native-scale growth after keyboard dismissal', () => {
  const viewport = installMutableVisualViewport(900);
  const input = document.createElement('input');
  document.body.append(input);
  const cleanup = installStudentExamViewportController({
    targetWindow: window,
    targetDocument: document,
  });
  input.focus();
  input.blur();
  viewport.set(820, 20);
  vi.advanceTimersByTime(800);
  viewport.set(950, 0);
  vi.advanceTimersByTime(800);
  expect(
    document.documentElement.style.getPropertyValue('--student-viewport-height'),
  ).toBe('950px');
  cleanup();
  viewport.restore();
});

it('falls back to layout height when visual viewport geometry is invalid', () => {
  const viewport = installMutableVisualViewport(0);
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 777 });
  const cleanup = installStudentExamViewportController({
    targetWindow: window,
    targetDocument: document,
  });
  expect(
    document.documentElement.style.getPropertyValue('--student-viewport-height'),
  ).toBe('777px');
  cleanup();
  viewport.restore();
  if (originalInnerHeight) Object.defineProperty(window, 'innerHeight', originalInnerHeight);
});

it('allows a real orientation topology change to shrink the trusted viewport', () => {
  const viewport = installMutableVisualViewport(900);
  const cleanup = installStudentExamViewportController({
    targetWindow: window,
    targetDocument: document,
  });
  viewport.set(700, 0);
  window.dispatchEvent(new Event('orientationchange'));
  expect(
    document.documentElement.style.getPropertyValue('--student-viewport-height'),
  ).toBe('700px');
  cleanup();
  viewport.restore();
});
```

For optional virtual-keyboard cleanup, install an `EventTarget` as
`navigator.virtualKeyboard`, clean up the controller, change the viewport mock, dispatch
`geometrychange`, and assert the removed CSS properties remain empty. Restore the original property
descriptor in `finally`.

- [ ] **Step 2: Run controller tests and verify RED**

Run:

```bash
npx vitest run src/components/student/__tests__/studentExamViewportController.test.ts \
  -t 'trusted full height|late growth|fallback|topology|VirtualKeyboard' \
  --exclude '.worktrees/**'
```

Expected: persistent-height test FAILS with `820px`; new fallback/topology tests fail until the
controller delegates to the policy.

- [ ] **Step 3: Refactor the controller into a browser adapter**

Remove `protectHeight` from `StudentExamViewportControllerOptions`. Build each measurement with:

```ts
const finitePositive = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

const finiteNonNegative = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

const readMeasurement = (): StudentExamViewportMeasurement => {
  const visualHeight = finitePositive(visualViewport?.height);
  const innerHeight = finitePositive(targetWindow.innerHeight);
  const clientHeight = finitePositive(root.clientHeight);
  return {
    visualHeight,
    layoutHeight: innerHeight ?? clientHeight ?? policy.trustedRect.height,
    offsetTop: finiteNonNegative(visualViewport?.offsetTop) ?? 0,
    layoutWidth:
      finitePositive(targetWindow.innerWidth) ??
      finitePositive(root.clientWidth) ??
      policy.layoutWidth,
    scale: finitePositive(visualViewport?.scale) ?? 1,
  };
};
```

Keep one mutable policy state. Every browser event dispatches a semantic policy event followed by a
measurement when appropriate, and publication writes `policy.publishedRect` only when it changes.

Use semantic recovery calls:

```ts
startRecovery('bootstrap'); // install, pageshow, visible
startRecovery('topology');  // orientation or material layout-width change
startRecovery('keyboard');  // final editable focusout
```

The keyboard variant dispatches `editable-focus-left`; it never grants downward rebase permission.
The bounded frame loop only observes recovery and dispatches `recovery-finished` at the deadline.
For keyboard recovery, that event stops polling but deliberately does not clear the persistent
baseline floor. Later passive events remain protected until full-height geometry returns or a
bootstrap/topology recovery explicitly invalidates the baseline.
Window resize compares the current layout width with the policy width; a material width change starts
topology recovery, while height-only keyboard noise is only measured through the current state.

Feature-detect `navigator.virtualKeyboard` through a small local structural type and listen only for
`geometrychange`. Do not set `overlaysContent` and do not call `show()`/`hide()`.

- [ ] **Step 4: Run controller and pure-policy tests and verify GREEN**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/studentExamViewportPolicy.test.ts \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  --exclude '.worktrees/**'
```

Expected: all policy/controller tests pass.

- [ ] **Step 5: Commit the browser adapter**

```bash
git add src/components/student/studentExamViewportController.ts \
  src/components/student/__tests__/studentExamViewportController.test.ts
git commit -m "fix(student): preserve trusted viewport after keyboard"
```

### Task 3: Install Universally and Standardize Browser/CSS Fallbacks

**Files:**
- Modify: `src/components/student/StudentApp.tsx`
- Modify: `src/components/student/__tests__/StudentApp.test.tsx`
- Modify: `src/components/student/examPageZoomGuard.ts`
- Modify: `src/components/student/__tests__/examPageZoomGuard.test.ts`
- Modify: `src/index.css`
- Modify: `src/components/student/__tests__/StudentViewportCss.test.ts`

- [ ] **Step 1: Write failing integration, viewport-meta, and CSS contract tests**

Change the StudentApp dismissal test so a persistent `820px` sample leaves the height at `900px`
and restores offset `0px`. Add a later `950px` sample assertion to prove growth still works. Remove
`protectHeight` assumptions from controller installation tests and require the same behavior when
tablet/user-agent heuristics are false.

Extend the viewport-meta test:

```ts
expect(EXAM_VIEWPORT_CONTENT).toContain('interactive-widget=resizes-visual');
expect(viewport).toHaveAttribute('content', EXAM_VIEWPORT_CONTENT);
cleanup();
expect(viewport).toHaveAttribute('content', ORIGINAL_VIEWPORT_CONTENT);
```

Extend the CSS test to require ordered fallback declarations in both active-document and shell
rules:

```ts
expect(activeDocumentRule).toMatch(
  /height:\s*100vh;[\s\S]*height:\s*100dvh;[\s\S]*height:\s*var\(--student-viewport-height,\s*100dvh\);/,
);
expect(shellRule).toMatch(
  /height:\s*100vh;[\s\S]*height:\s*100dvh;[\s\S]*height:\s*var\(--student-viewport-height,\s*100dvh\);/,
);
expect(shellRule).not.toMatch(/(?:min-height:\s*[1-9]|height:\s*max\()/);
```

- [ ] **Step 2: Run the integration slice and verify RED**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/StudentApp.test.tsx \
  src/components/student/__tests__/examPageZoomGuard.test.ts \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  -t 'keyboard dismissal|browser heuristic|viewport policy|tracked visual viewport' \
  --exclude '.worktrees/**'
```

Expected: keyboard test still reports `820px`; viewport content lacks `interactive-widget`; CSS lacks
the ordered `100vh` fallback.

- [ ] **Step 3: Apply the universal installation and fallbacks**

In `StudentApp.tsx`, remove `shouldLockViewportForExamSession`,
`shouldLockViewportForKeyboard`, and `viewportLockForExamSessionRef`. Install the controller with:

```ts
return installStudentExamViewportController({
  targetWindow: window,
  targetDocument: document,
});
```

In `examPageZoomGuard.ts`, change the constant to:

```ts
export const EXAM_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-visual';
```

In both active-document and `.student-exam-shell` rules, declare:

```css
height: 100vh;
height: 100dvh;
height: var(--student-viewport-height, 100dvh);
```

Keep the measured value last and exact. Do not add a `max()`, positive minimum, or other viewport
height expression after it.

- [ ] **Step 4: Run the integration slice and verify GREEN**

Run the Step 2 command.

Expected: all selected StudentApp, meta, and CSS contract tests pass.

- [ ] **Step 5: Commit the integration and standards fallbacks**

```bash
git add src/components/student/StudentApp.tsx \
  src/components/student/__tests__/StudentApp.test.tsx \
  src/components/student/examPageZoomGuard.ts \
  src/components/student/__tests__/examPageZoomGuard.test.ts \
  src/index.css \
  src/components/student/__tests__/StudentViewportCss.test.ts
git commit -m "fix(student): standardize exam viewport recovery"
```

### Task 4: Update Repository Memory

**Files:**
- Modify: `docs/ux-invariants.md`
- Modify: `docs/failure-cases.md`

- [ ] **Step 1: Replace the incorrect focusout invariant**

Document these exact rules under Student Exam Visible Viewport:

```markdown
- Editable focus captures the last trusted full viewport rectangle.
- Keyboard-active and keyboard-recovery states may not replace that rectangle with a smaller sample.
- A recovery deadline ends observation; it does not make the final sample trustworthy.
- Bidirectional rebasing requires bootstrapping or independently evidenced topology recovery.
- Browser capability and lifecycle signals determine behavior; browser-family checks do not.
```

- [ ] **Step 2: Add the failure-case note**

Add a dated failure case describing `IMG_1109.PNG`, the persistent `900 -> 560 -> 820` sequence,
why the prior test encoded the bug, and the rule that focusout is an observation trigger rather than
permission to shrink.

- [ ] **Step 3: Check documentation hygiene**

Run:

```bash
rg -n 'focusout.*rebase in either direction' docs/ux-invariants.md docs/failure-cases.md
git diff --check
```

Expected: no placeholder or obsolete bidirectional-focusout rule; `git diff --check` exits zero.

- [ ] **Step 4: Commit repository memory**

```bash
git add docs/ux-invariants.md docs/failure-cases.md
git commit -m "docs(student): record trusted keyboard viewport"
```

### Task 5: Full Verification

**Files:**
- Verify all files changed in Tasks 1–4.

- [ ] **Step 1: Run the complete viewport regression slice**

```bash
npx vitest run \
  src/components/student/__tests__/studentExamViewportPolicy.test.ts \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/examPageZoomGuard.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  -t 'viewport|footer|keyboard|pinch|orientation|reused tab|cleanup|interactive-widget' \
  --exclude '.worktrees/**'
```

Expected: zero failed selected tests.

- [ ] **Step 2: Run lint on every changed TypeScript file**

```bash
npx eslint \
  src/components/student/studentExamViewportPolicy.ts \
  src/components/student/studentExamViewportController.ts \
  src/components/student/StudentApp.tsx \
  src/components/student/examPageZoomGuard.ts \
  src/components/student/__tests__/studentExamViewportPolicy.test.ts \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  src/components/student/__tests__/examPageZoomGuard.test.ts \
  src/components/student/__tests__/StudentViewportCss.test.ts
```

Expected: zero errors. Report existing warnings separately.

- [ ] **Step 3: Run TypeScript and distinguish baseline diagnostics**

```bash
npx tsc --noEmit --pretty false
```

Expected: no diagnostics in the changed viewport files. The repository currently has unrelated
pre-existing diagnostics; record them without claiming a repository-wide clean compile.

- [ ] **Step 4: Verify patch and branch state**

```bash
git diff --check origin/main..HEAD
git status --short
git log --oneline --reverse origin/main..HEAD
```

Expected: clean patch hygiene, clean worktree, and only the design/plan/implementation/memory commits
for this viewport correction.

- [ ] **Step 5: Publish only with explicit authorization**

Do not force-push. If direct `origin/main` publication is authorized, fetch first and require:

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git push origin HEAD:main
```

Expected: a fast-forward update only.
