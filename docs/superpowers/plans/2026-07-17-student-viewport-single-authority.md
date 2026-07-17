# Student Viewport Single-Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active exam shell use one exact visual-viewport rectangle so its footer returns automatically after reused-tab navigation and keyboard dismissal.

**Architecture:** `studentExamViewportController.ts` becomes the only runtime height policy. CSS consumes the published height exactly; the controller accepts safe native-scale growth, protects keyboard/pinch/passive shrinkage, and uses a bounded 1.5-second recovery window for initial load and lifecycle restoration.

**Tech Stack:** React 18, TypeScript, Visual Viewport API, CSS custom properties, Vitest, Testing Library.

---

## File Map

- Modify `src/components/student/studentExamViewportController.ts`: own exact height growth, shrink protection, recovery sampling, interaction state, and cleanup.
- Modify `src/components/student/StudentApp.tsx`: consume the controller height exactly instead of applying a CSS lower bound.
- Modify `src/index.css`: make root, body, and shell exact consumers of `--student-viewport-height`.
- Modify `src/components/student/__tests__/studentExamViewportController.test.ts`: cover late recovery, safe growth, protected shrinkage, and cleanup.
- Modify `src/components/student/__tests__/StudentApp.test.tsx`: move dynamic-growth responsibility from CSS to the controller.
- Modify `src/components/student/__tests__/StudentViewportCss.test.ts`: prohibit a competing viewport-unit lower bound.
- Modify `docs/ux-invariants.md`: record the controller as the single viewport authority.

### Task 1: Lock the exact rectangle and late-recovery behavior with failing tests

**Files:**
- Modify: `src/components/student/__tests__/studentExamViewportController.test.ts`
- Modify: `src/components/student/__tests__/StudentApp.test.tsx`
- Modify: `src/components/student/__tests__/StudentViewportCss.test.ts`

- [ ] **Step 1: Make the CSS contract require the exact published height**

Replace the existing shell-height expectation in `StudentViewportCss.test.ts` and add root/body coverage:

```ts
it('fixes the exam shell to the exact tracked visual viewport rectangle', () => {
  const activeDocumentRule = css.match(
    /html\.student-exam-active,\s*body\.student-exam-active\s*\{([^}]*)\}/s,
  )?.[1];
  const shellRule = css.match(/\.student-exam-shell\s*\{([^}]*)\}/s)?.[1];

  expect(activeDocumentRule).toBeDefined();
  expect(activeDocumentRule).toMatch(
    /height:\s*var\(--student-viewport-height,\s*100dvh\)\s*;/,
  );
  expect(activeDocumentRule).not.toMatch(/height:\s*max\(/);

  expect(shellRule).toBeDefined();
  expect(shellRule).toMatch(/position:\s*fixed\s*;/);
  expect(shellRule).toMatch(/top:\s*var\(--student-viewport-offset-top,\s*0px\)\s*;/);
  expect(shellRule).toMatch(/left:\s*0\s*;/);
  expect(shellRule).toMatch(/right:\s*0\s*;/);
  expect(shellRule).toMatch(
    /height:\s*var\(--student-viewport-height,\s*100dvh\)\s*;/,
  );
  expect(shellRule).not.toMatch(/height:\s*max\(/);
});
```

- [ ] **Step 2: Extend controller tests beyond the old 420ms deadline**

Change the reused-tab test so the final viewport arrives silently at 800ms and is asserted after the
new 1.5-second window has observed it:

```ts
viewport.set(640, 120);
vi.advanceTimersByTime(800);
viewport.set(900, 0);
vi.advanceTimersByTime(800);

expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('900px');
expect(document.documentElement.style.getPropertyValue('--student-viewport-offset-top')).toBe('0px');
```

Change the keyboard test so the final `820px / 20px` rectangle arrives 800ms after `blur`, without a
resize or scroll event:

```ts
vi.advanceTimersByTime(1_600);
input.focus();
viewport.set(560, 100);
viewport.dispatchResize();

expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('900px');

input.blur();
vi.advanceTimersByTime(800);
viewport.set(820, 20);
vi.advanceTimersByTime(800);

expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('820px');
expect(document.documentElement.style.getPropertyValue('--student-viewport-offset-top')).toBe('20px');
```

Add a focused safe-growth/passive-shrink test:

```ts
it('accepts safe native-scale growth but protects passive shrinkage', () => {
  const viewport = installMutableVisualViewport(900);
  const cleanup = installStudentExamViewportController({
    targetWindow: window,
    targetDocument: document,
    protectHeight: true,
  });

  try {
    vi.advanceTimersByTime(1_600);
    viewport.set(1000, 0);
    viewport.dispatchResize();
    expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('1000px');

    viewport.set(620, 0);
    viewport.dispatchResize();
    expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('1000px');
  } finally {
    cleanup();
    viewport.restore();
  }
});
```

- [ ] **Step 3: Move StudentApp's growth expectation to the controller**

In `lets the effective tablet shell grow while keeping pinch shrink protection`, change the growth
assertions to:

```ts
expect(root.style.getPropertyValue('--student-viewport-height')).toBe('1000px');
expect(container.querySelector('.student-exam-shell')).toHaveStyle({
  height: 'var(--student-viewport-height, 100dvh)',
});
```

Keep the later pinch assertion at `1000px`, proving pinch shrink cannot overwrite the newly grown
baseline.

- [ ] **Step 4: Run the three focused files and verify RED**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  -t 'single-authority|tracked visual viewport|reused-tab|keyboard dismissal|native-scale growth|effective tablet shell' \
  --exclude '.worktrees/**'
```

Expected failures:

- CSS still contains `max(var(--student-viewport-height...), 100dvh)`.
- The old controller stops sampling after 420ms.
- Protected passive growth leaves the published height at `900px`.
- `StudentApp` still renders the `max()` inline height.

### Task 2: Implement the single-authority controller and exact CSS contract

**Files:**
- Modify: `src/components/student/studentExamViewportController.ts`
- Modify: `src/components/student/StudentApp.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Replace fixed settle delays with bounded recovery constants and state**

Use these controller constants and state fields:

```ts
const RECOVERY_WINDOW_MS = 1_500;
const FRAME_FALLBACK_MS = 16;
const PINCH_RELEASE_GUARD_MS = 500;
const NATIVE_SCALE_TOLERANCE = 0.01;

let scheduledFrame: number | null = null;
let pinchReleaseTimer: number | null = null;
let recoveryDeadline: number | null = null;
let protectedHeight: number | null = null;
let editableFocusActive = isEditableElement(targetDocument.activeElement);
let pinchActive = false;
let pinchGuardUntil = 0;
let lastPublishedHeight: number | null = null;
let lastPublishedOffsetTop: number | null = null;
let disposed = false;
```

Use `targetWindow.performance.now()` as the controller clock with `Date.now()` fallback.

- [ ] **Step 2: Make measurement own safe growth and recovery shrinkage**

Implement the measurement policy as:

```ts
const now = () => targetWindow.performance?.now() ?? Date.now();

const measure = () => {
  if (disposed) return;

  const nextHeight = Math.max(
    0,
    Math.round(visualViewport?.height ?? targetWindow.innerHeight),
  );
  const nextOffsetTop = Math.max(0, Math.round(visualViewport?.offsetTop ?? 0));
  const scale = visualViewport?.scale ?? 1;
  const editableFocused =
    editableFocusActive || isEditableElement(targetDocument.activeElement);
  const pinchProtected =
    pinchActive ||
    Math.abs(scale - 1) > NATIVE_SCALE_TOLERANCE ||
    now() < pinchGuardUntil;
  const recoveryActive = recoveryDeadline !== null && now() <= recoveryDeadline;

  if (!protectHeight || protectedHeight === null) {
    protectedHeight = nextHeight;
  } else if (!editableFocused && !pinchProtected) {
    const safeGrowth = nextHeight > protectedHeight;
    if (safeGrowth || recoveryActive) protectedHeight = nextHeight;
  }

  const effectiveHeight = protectHeight ? protectedHeight : nextHeight;
  if (
    effectiveHeight !== lastPublishedHeight ||
    nextOffsetTop !== lastPublishedOffsetTop
  ) {
    applyViewportRect(effectiveHeight, nextOffsetTop);
    lastPublishedHeight = effectiveHeight;
    lastPublishedOffsetTop = nextOffsetTop;
  }
};
```

- [ ] **Step 3: Implement a bounded recovery frame loop**

Use one cancelable frame at a time:

```ts
const scheduleFrame = (callback: () => void) => {
  if (hasAnimationFrame) return targetWindow.requestAnimationFrame(callback);
  return targetWindow.setTimeout(callback, FRAME_FALLBACK_MS);
};

const cancelScheduledFrame = () => {
  if (scheduledFrame === null) return;
  if (hasAnimationFrame) targetWindow.cancelAnimationFrame(scheduledFrame);
  else targetWindow.clearTimeout(scheduledFrame);
  scheduledFrame = null;
};

const runRecoveryFrame = () => {
  scheduledFrame = null;
  measure();
  if (!disposed && recoveryDeadline !== null && now() < recoveryDeadline) {
    scheduledFrame = scheduleFrame(runRecoveryFrame);
  } else {
    recoveryDeadline = null;
  }
};

const startRecoveryWindow = () => {
  if (disposed) return;
  recoveryDeadline = now() + RECOVERY_WINDOW_MS;
  measure();
  if (scheduledFrame === null) scheduledFrame = scheduleFrame(runRecoveryFrame);
};
```

This loop is active only during lifecycle recovery and ends at 1.5 seconds.

- [ ] **Step 4: Track editable and pinch interaction boundaries**

Add document focus listeners:

```ts
const handleFocusIn = (event: FocusEvent) => {
  if (isEditableElement(event.target)) editableFocusActive = true;
};

const handleFocusOut = (event: FocusEvent) => {
  if (!isEditableElement(event.target)) return;
  editableFocusActive = isEditableElement(event.relatedTarget);
  if (!editableFocusActive) startRecoveryWindow();
};
```

On multi-touch start/move, set `pinchActive = true`, clear recovery permission, cancel its frame,
and measure without rebasing. On touchend/cancel, clear `pinchActive`, set
`pinchGuardUntil = now() + PINCH_RELEASE_GUARD_MS`, measure, and schedule one timeout at the guard
deadline to measure safe growth. Clear an earlier guard timer before replacing it.

Use this implementation:

```ts
const cancelRecoveryWindow = () => {
  recoveryDeadline = null;
  cancelScheduledFrame();
};

const clearPinchReleaseTimer = () => {
  if (pinchReleaseTimer === null) return;
  targetWindow.clearTimeout(pinchReleaseTimer);
  pinchReleaseTimer = null;
};

const handleTouch = (event: TouchEvent) => {
  if (event.type === 'touchstart' || event.type === 'touchmove') {
    if (event.touches.length < 2) return;
    pinchActive = true;
    cancelRecoveryWindow();
    clearPinchReleaseTimer();
    measure();
    return;
  }

  if (event.touches.length >= 2) return;
  if (!pinchActive) {
    measure();
    return;
  }

  pinchActive = false;
  pinchGuardUntil = now() + PINCH_RELEASE_GUARD_MS;
  cancelRecoveryWindow();
  clearPinchReleaseTimer();
  measure();
  pinchReleaseTimer = targetWindow.setTimeout(() => {
    pinchReleaseTimer = null;
    measure();
  }, PINCH_RELEASE_GUARD_MS);
};
```

- [ ] **Step 5: Wire lifecycle and passive events**

Use these event policies:

```ts
const handlePassiveViewportChange = () => measure();
const handlePageShow = () => startRecoveryWindow();
const handleVisibilityChange = () => {
  if (targetDocument.visibilityState === 'visible') startRecoveryWindow();
};
const handleOrientationChange = () => {
  if (!pinchActive && now() >= pinchGuardUntil) startRecoveryWindow();
};
const handleViewportScrollEnd = () => {
  if (!editableFocusActive && !pinchActive && now() >= pinchGuardUntil) {
    startRecoveryWindow();
  }
};
```

Listen for window `resize` passively, window `orientationchange` as recovery, visual viewport
`resize`/`scroll` passively, visual viewport `scrollend` as recovery, document
`visibilitychange`, `focusin`, `focusout`, and the four touch events. Start one recovery window after
installing listeners.

Install them exactly as follows:

```ts
targetWindow.addEventListener('resize', handlePassiveViewportChange);
targetWindow.addEventListener('orientationchange', handleOrientationChange);
targetWindow.addEventListener('pageshow', handlePageShow);
visualViewport?.addEventListener('resize', handlePassiveViewportChange);
visualViewport?.addEventListener('scroll', handlePassiveViewportChange);
visualViewport?.addEventListener('scrollend', handleViewportScrollEnd);
targetDocument.addEventListener('visibilitychange', handleVisibilityChange);
targetDocument.addEventListener('focusin', handleFocusIn, true);
targetDocument.addEventListener('focusout', handleFocusOut, true);
targetDocument.addEventListener('touchstart', handleTouch, true);
targetDocument.addEventListener('touchmove', handleTouch, true);
targetDocument.addEventListener('touchend', handleTouch, true);
targetDocument.addEventListener('touchcancel', handleTouch, true);
startRecoveryWindow();
```

- [ ] **Step 6: Make cleanup cancel every owned resource**

Cleanup must:

```ts
disposed = true;
recoveryDeadline = null;
cancelScheduledFrame();
if (pinchReleaseTimer !== null) {
  targetWindow.clearTimeout(pinchReleaseTimer);
  pinchReleaseTimer = null;
}
```

Then remove all classes, CSS properties, and every listener including `scrollend`, `focusin`, and
`focusout`. Keep cleanup idempotent.

Use matching listener references:

```ts
targetWindow.removeEventListener('resize', handlePassiveViewportChange);
targetWindow.removeEventListener('orientationchange', handleOrientationChange);
targetWindow.removeEventListener('pageshow', handlePageShow);
visualViewport?.removeEventListener('resize', handlePassiveViewportChange);
visualViewport?.removeEventListener('scroll', handlePassiveViewportChange);
visualViewport?.removeEventListener('scrollend', handleViewportScrollEnd);
targetDocument.removeEventListener('visibilitychange', handleVisibilityChange);
targetDocument.removeEventListener('focusin', handleFocusIn, true);
targetDocument.removeEventListener('focusout', handleFocusOut, true);
targetDocument.removeEventListener('touchstart', handleTouch, true);
targetDocument.removeEventListener('touchmove', handleTouch, true);
targetDocument.removeEventListener('touchend', handleTouch, true);
targetDocument.removeEventListener('touchcancel', handleTouch, true);
```

- [ ] **Step 7: Remove the CSS height competitor**

In `StudentApp.tsx` set:

```ts
height: 'var(--student-viewport-height, 100dvh)',
```

In `src/index.css`, set both the active root/body rule and `.student-exam-shell` rule to:

```css
height: var(--student-viewport-height, 100dvh);
```

Keep `.student-exam-shell` fixed positioning, top offset, `min-height: 0`, overflow, touch action,
and safe-area padding unchanged.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  -t 'viewport|footer|pinch|orientation|keyboard dismissal|reused tab|native-scale growth|effective tablet shell' \
  --exclude '.worktrees/**'
```

Expected: controller, CSS, reused-tab, keyboard, growth, pinch, orientation, top-offset, cleanup, and
non-tablet tests PASS.

- [ ] **Step 9: Commit the tested fix**

```bash
git add \
  src/components/student/studentExamViewportController.ts \
  src/components/student/StudentApp.tsx \
  src/index.css \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  src/components/student/__tests__/StudentViewportCss.test.ts
git commit -m "fix(student): make visual viewport the shell authority"
```

### Task 3: Update repository memory, verify, and publish

**Files:**
- Modify: `docs/ux-invariants.md`

- [ ] **Step 1: Record the single-authority invariant**

Add this to Student Exam Visible Viewport:

```markdown
- `studentExamViewportController.ts` is the only active-exam height policy. CSS must consume
  `--student-viewport-height` exactly and must not combine it with `vh`, `dvh`, `lvh`, `svh`, a
  positive minimum height, or another lower bound.
- Protected sessions accept safe native-scale growth in the controller. Initial entry and editable
  focusout use a bounded recovery window that may rebase in either direction after keyboard/pinch
  guards clear.
```

- [ ] **Step 2: Run the full relevant verification**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  --exclude '.worktrees/**'
```

Expected: controller and CSS tests pass. The complete `StudentApp` file may retain the known unrelated
sibling-slot fixture failure; if so, rerun the viewport filter from Task 2 and report that baseline
failure separately.

- [ ] **Step 3: Run static checks and inspect the patch**

Run:

```bash
npx eslint \
  src/components/student/studentExamViewportController.ts \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  src/components/student/StudentApp.tsx \
  src/components/student/__tests__/StudentApp.test.tsx \
  src/components/student/__tests__/StudentViewportCss.test.ts
npx tsc --noEmit --pretty false 2>&1 | tee /tmp/student-viewport-single-authority-tsc.log
rg 'studentExamViewportController|StudentApp.tsx|StudentViewportCss' \
  /tmp/student-viewport-single-authority-tsc.log || true
git diff --check
git status --short
```

Expected: ESLint has no errors, patch hygiene passes, and no new TypeScript diagnostic names a changed
viewport file. Existing repository-wide diagnostics remain separately reported.

- [ ] **Step 4: Commit the memory artifact**

```bash
git add docs/ux-invariants.md
git commit -m "docs(student): require one viewport height authority"
```

- [ ] **Step 5: Fast-forward publish to origin/main**

Run:

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git push origin HEAD:main
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

Expected: a non-force fast-forward push succeeds and `origin/main` equals `HEAD`.

## Plan Self-Review

- Spec coverage: exact shell/root/body height, safe controller growth, protected shrink, late initial
  and focusout recovery, focus/pinch tracking, cleanup, fallback behavior, regression tests,
  repository memory, and publishing all map to explicit tasks.
- Placeholder scan: no deferred implementation or unnamed validation step remains.
- Type consistency: controller state and handlers use the same names throughout; the published CSS
  properties remain `--student-viewport-height` and `--student-viewport-offset-top`.
- Scope: no answer, autosave, timer, submission, grading, integrity, audit, or persistence behavior is
  modified.
