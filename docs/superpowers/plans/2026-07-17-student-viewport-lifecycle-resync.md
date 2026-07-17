# Student Viewport Lifecycle Resynchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active iPad exam settle to the final visible viewport when opened in a reused tab and automatically restore its footer after the software keyboard closes.

**Architecture:** Extract viewport lifecycle ownership from `StudentApp` into one module-local controller. The controller publishes the exam shell CSS variables, preserves the protected tablet height during keyboard/pinch/ordinary resize events, and allows bounded baseline rebasing only during explicit lifecycle recovery cycles such as initial install, `pageshow`, visible-document restoration, and editable-control `focusout`.

**Tech Stack:** React 18, TypeScript, DOM Visual Viewport API, Vitest, Testing Library, CSS custom properties.

---

## File Map

- Create `src/components/student/studentExamViewportController.ts`: install, measure, settle, listen, and clean up the active exam viewport contract.
- Create `src/components/student/__tests__/studentExamViewportController.test.ts`: focused controller coverage for silent viewport settling, keyboard dismissal, and idempotent cleanup.
- Modify `src/components/student/StudentApp.tsx`: replace the accumulated inline viewport effect with controller installation.
- Modify `src/components/student/__tests__/StudentApp.test.tsx`: add user-level regressions for a reused tab and keyboard dismissal without a final resize/scroll event.
- Modify `docs/ux-invariants.md`: record lifecycle settling and its regression files as repository memory.

The viewport controller must not import answer, autosave, timer, submission, integrity, or audit modules. Its dependency direction remains `StudentApp -> studentExamViewportController -> browser DOM`.

### Task 1: Add the viewport controller with failure-first unit coverage

**Files:**
- Create: `src/components/student/studentExamViewportController.ts`
- Create: `src/components/student/__tests__/studentExamViewportController.test.ts`

- [ ] **Step 1: Write controller tests before the controller exists**

Create `src/components/student/__tests__/studentExamViewportController.test.ts` with a mutable `visualViewport` test double. Cover these exact cases:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStudentExamViewportController } from '../studentExamViewportController';

function installMutableVisualViewport(initialHeight: number, initialOffsetTop = 0) {
  const target = new EventTarget();
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  let height = initialHeight;
  let offsetTop = initialOffsetTop;
  let scale = 1;

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      get height() {
        return height;
      },
      get offsetTop() {
        return offsetTop;
      },
      get scale() {
        return scale;
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    },
  });

  return {
    set(nextHeight: number, nextOffsetTop: number, nextScale = 1) {
      height = nextHeight;
      offsetTop = nextOffsetTop;
      scale = nextScale;
    },
    dispatchResize() {
      target.dispatchEvent(new Event('resize'));
    },
    restore() {
      if (original) Object.defineProperty(window, 'visualViewport', original);
      else Reflect.deleteProperty(window, 'visualViewport');
    },
  };
}

describe('installStudentExamViewportController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.documentElement.classList.remove('student-exam-active');
    document.body.classList.remove('student-exam-active');
    document.documentElement.style.removeProperty('--student-viewport-height');
    document.documentElement.style.removeProperty('--student-viewport-offset-top');
    document.body.replaceChildren();
  });

  it('settles to a final reused-tab viewport even when no resize event fires', () => {
    const viewport = installMutableVisualViewport(640, 120);
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
      protectHeight: true,
    });

    expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('640px');
    expect(document.documentElement.style.getPropertyValue('--student-viewport-offset-top')).toBe('120px');

    viewport.set(900, 0);
    vi.advanceTimersByTime(500);

    expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('900px');
    expect(document.documentElement.style.getPropertyValue('--student-viewport-offset-top')).toBe('0px');
    cleanup();
    viewport.restore();
  });

  it('preserves keyboard shrinkage and rebases after editable focusout without a final resize', () => {
    const viewport = installMutableVisualViewport(900);
    const input = document.createElement('input');
    document.body.append(input);
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
      protectHeight: true,
    });
    vi.advanceTimersByTime(500);

    input.focus();
    viewport.set(560, 100);
    viewport.dispatchResize();
    vi.advanceTimersByTime(500);

    expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('900px');
    expect(document.documentElement.style.getPropertyValue('--student-viewport-offset-top')).toBe('100px');

    input.blur();
    viewport.set(820, 20);
    vi.advanceTimersByTime(500);

    expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('820px');
    expect(document.documentElement.style.getPropertyValue('--student-viewport-offset-top')).toBe('20px');
    cleanup();
    viewport.restore();
  });

  it('cancels delayed work and removes listeners and CSS state idempotently', () => {
    const viewport = installMutableVisualViewport(640, 120);
    const cleanup = installStudentExamViewportController({
      targetWindow: window,
      targetDocument: document,
      protectHeight: true,
    });

    viewport.set(900, 0);
    cleanup();
    cleanup();
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new Event('pageshow'));

    expect(document.documentElement.style.getPropertyValue('--student-viewport-height')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--student-viewport-offset-top')).toBe('');
    expect(document.documentElement).not.toHaveClass('student-exam-active');
    expect(document.body).not.toHaveClass('student-exam-active');
    viewport.restore();
  });
});
```

- [ ] **Step 2: Run the controller test and verify the RED state**

Run:

```bash
npx vitest run src/components/student/__tests__/studentExamViewportController.test.ts --exclude '.worktrees/**'
```

Expected: FAIL because `../studentExamViewportController` does not exist.

- [ ] **Step 3: Implement the bounded lifecycle controller**

Create `src/components/student/studentExamViewportController.ts` with this public interface and behavior:

```ts
export interface StudentExamViewportControllerOptions {
  targetWindow: Window;
  targetDocument: Document;
  protectHeight: boolean;
}

const SETTLE_DELAYS_MS = [80, 220, 420] as const;
const NATIVE_SCALE_TOLERANCE = 0.01;

function isEditableElement(value: EventTarget | Element | null): value is HTMLElement {
  return (
    value instanceof HTMLElement &&
    value.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  );
}

export function installStudentExamViewportController({
  targetWindow,
  targetDocument,
  protectHeight,
}: StudentExamViewportControllerOptions): () => void {
  const root = targetDocument.documentElement;
  const body = targetDocument.body;
  const scheduledTimers = new Set<number>();
  let scheduledFrame: number | null = null;
  let protectedHeight: number | null = null;
  let cycleAllowsRebase = false;
  let disposed = false;

  const applyViewportRect = (height: number, offsetTop: number) => {
    root.style.setProperty('--student-viewport-height', `${Math.max(0, Math.round(height))}px`);
    root.style.setProperty('--student-viewport-offset-top', `${Math.max(0, Math.round(offsetTop))}px`);
  };

  const measure = () => {
    if (disposed) return;
    const visualViewport = targetWindow.visualViewport;
    const nextHeight = Math.round(visualViewport?.height ?? targetWindow.innerHeight);
    const nextOffsetTop = visualViewport?.offsetTop ?? 0;
    const scale = visualViewport?.scale ?? 1;
    const editableFocused = isEditableElement(targetDocument.activeElement);
    const mayRebaseProtectedHeight =
      cycleAllowsRebase && !editableFocused && Math.abs(scale - 1) <= NATIVE_SCALE_TOLERANCE;

    if (!protectHeight || protectedHeight === null || mayRebaseProtectedHeight) {
      protectedHeight = nextHeight;
    }

    applyViewportRect(protectHeight ? protectedHeight : nextHeight, nextOffsetTop);
  };

  const clearScheduledWork = () => {
    if (scheduledFrame !== null) {
      targetWindow.cancelAnimationFrame(scheduledFrame);
      scheduledFrame = null;
    }
    for (const timer of scheduledTimers) targetWindow.clearTimeout(timer);
    scheduledTimers.clear();
  };

  const scheduleSettleCycle = (allowProtectedHeightRebase: boolean) => {
    if (disposed) return;
    cycleAllowsRebase ||= allowProtectedHeightRebase;
    clearScheduledWork();
    measure();

    scheduledFrame = targetWindow.requestAnimationFrame(() => {
      scheduledFrame = null;
      measure();
    });

    SETTLE_DELAYS_MS.forEach((delay, index) => {
      const timer = targetWindow.setTimeout(() => {
        scheduledTimers.delete(timer);
        measure();
        if (index === SETTLE_DELAYS_MS.length - 1) cycleAllowsRebase = false;
      }, delay);
      scheduledTimers.add(timer);
    });
  };

  const scheduleProtectedMeasurement = () => scheduleSettleCycle(false);
  const handleFocusOut = (event: FocusEvent) => {
    if (isEditableElement(event.target)) scheduleSettleCycle(true);
  };
  const handleVisibilityChange = () => {
    if (targetDocument.visibilityState === 'visible') scheduleSettleCycle(true);
  };
  const handleTouch = (event: TouchEvent) => {
    if (!protectHeight || event.type === 'touchstart' || event.type === 'touchmove') {
      if (!protectHeight || event.touches.length < 2) return;
    }
    scheduleProtectedMeasurement();
  };

  root.classList.add('student-exam-active');
  body.classList.add('student-exam-active');
  targetWindow.addEventListener('resize', scheduleProtectedMeasurement);
  targetWindow.addEventListener('orientationchange', scheduleProtectedMeasurement);
  targetWindow.addEventListener('pageshow', () => scheduleSettleCycle(true));
  targetWindow.visualViewport?.addEventListener('resize', scheduleProtectedMeasurement);
  targetWindow.visualViewport?.addEventListener('scroll', scheduleProtectedMeasurement);
  targetDocument.addEventListener('visibilitychange', handleVisibilityChange);
  targetDocument.addEventListener('focusout', handleFocusOut, true);
  targetDocument.addEventListener('touchstart', handleTouch, true);
  targetDocument.addEventListener('touchmove', handleTouch, true);
  targetDocument.addEventListener('touchend', handleTouch, true);
  targetDocument.addEventListener('touchcancel', handleTouch, true);
  scheduleSettleCycle(true);

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    disposed = true;
    clearScheduledWork();
    root.classList.remove('student-exam-active');
    body.classList.remove('student-exam-active');
    root.style.removeProperty('--student-viewport-height');
    root.style.removeProperty('--student-viewport-offset-top');
    targetWindow.removeEventListener('resize', scheduleProtectedMeasurement);
    targetWindow.removeEventListener('orientationchange', scheduleProtectedMeasurement);
    targetWindow.visualViewport?.removeEventListener('resize', scheduleProtectedMeasurement);
    targetWindow.visualViewport?.removeEventListener('scroll', scheduleProtectedMeasurement);
    targetDocument.removeEventListener('visibilitychange', handleVisibilityChange);
    targetDocument.removeEventListener('focusout', handleFocusOut, true);
    targetDocument.removeEventListener('touchstart', handleTouch, true);
    targetDocument.removeEventListener('touchmove', handleTouch, true);
    targetDocument.removeEventListener('touchend', handleTouch, true);
    targetDocument.removeEventListener('touchcancel', handleTouch, true);
  };
}
```

When implementing, store the `pageshow` callback in a named constant so cleanup removes the same listener reference. Keep ordinary resize/orientation/pinch cycles non-rebasing for protected tablets; only initial/lifecycle/focusout cycles may rebase.

- [ ] **Step 4: Run controller tests and type-check the controller files**

Run:

```bash
npx vitest run src/components/student/__tests__/studentExamViewportController.test.ts --exclude '.worktrees/**'
npx tsc --noEmit --pretty false 2>&1 | rg 'studentExamViewportController|StudentApp' || true
```

Expected: all controller tests PASS; no new TypeScript diagnostics mention the controller.

- [ ] **Step 5: Commit the controller and its tests**

```bash
git add src/components/student/studentExamViewportController.ts src/components/student/__tests__/studentExamViewportController.test.ts
git commit -m "fix(student): settle exam visual viewport lifecycle"
```

### Task 2: Wire the controller into StudentApp and lock both user regressions

**Files:**
- Modify: `src/components/student/StudentApp.tsx`
- Modify: `src/components/student/__tests__/StudentApp.test.tsx`

- [ ] **Step 1: Add a reused-tab regression test against the still-inline StudentApp effect**

Add a `StudentApp.test.tsx` case beside the existing viewport tests that configures locked iPad conditions, starts the mutable visual viewport at `640px / 120px`, renders a writing exam, silently changes it to `900px / 0px` without dispatching any event, and waits up to one second for the CSS properties to become `900px` and `0px`.

The key failure assertion is:

```ts
visualViewport.setHeight(900);
visualViewport.setOffsetTop(0);

await waitFor(
  () => {
    expect(root.style.getPropertyValue('--student-viewport-height')).toBe('900px');
    expect(root.style.getPropertyValue('--student-viewport-offset-top')).toBe('0px');
  },
  { timeout: 1_000 },
);
```

Use the same descriptor restoration and iPad environment cleanup already present in adjacent viewport tests.

- [ ] **Step 2: Add a keyboard-dismissal regression test against the still-inline StudentApp effect**

Add a second locked-iPad writing test. Render at `900px`, focus the writing response, emit a keyboard shrink to `560px / 100px`, verify the protected height stays `900px`, blur the editor, silently change the viewport to `820px / 20px`, and wait for the controller to restore both variables without a final resize or scroll event.

The central sequence is:

```ts
fireEvent.focus(editor);
act(() => {
  visualViewport.setHeight(560);
  visualViewport.setOffsetTop(100);
  visualViewport.dispatchResize();
});
expect(root.style.getPropertyValue('--student-viewport-height')).toBe('900px');

fireEvent.blur(editor);
visualViewport.setHeight(820);
visualViewport.setOffsetTop(20);

await waitFor(
  () => {
    expect(root.style.getPropertyValue('--student-viewport-height')).toBe('820px');
    expect(root.style.getPropertyValue('--student-viewport-offset-top')).toBe('20px');
  },
  { timeout: 1_000 },
);
```

- [ ] **Step 3: Run the two new tests and verify both fail for the intended reason**

Run:

```bash
npx vitest run src/components/student/__tests__/StudentApp.test.tsx -t 'settles a reused tab|restores the footer after keyboard dismissal' --exclude '.worktrees/**'
```

Expected: both FAIL because the current inline effect has no bounded initial settling and no editable `focusout` recovery.

- [ ] **Step 4: Replace the inline effect with the controller**

In `StudentApp.tsx`:

1. Import `installStudentExamViewportController` from `./studentExamViewportController`.
2. Remove `lockedViewportHeightRef` because protected-height ownership moves into the controller.
3. Keep `viewportLockForExamSessionRef` so the tablet protection decision remains stable for the whole exam.
4. When leaving exam phase, reset only `viewportLockForExamSessionRef`.
5. Replace the large viewport effect with:

```ts
useEffect(() => {
  if (effectivePhase !== 'exam') return;

  return installStudentExamViewportController({
    targetWindow: window,
    targetDocument: document,
    protectHeight: viewportLockForExamSessionRef.current === true,
  });
}, [effectivePhase]);
```

Do not depend on live `tabletMode`: reinstalling during a session would discard the protected-height baseline. The preceding session-lock effect establishes the immutable exam-session decision before this effect runs.

- [ ] **Step 5: Run the new user regressions and all focused viewport tests**

Run:

```bash
npx vitest run src/components/student/__tests__/StudentApp.test.tsx -t 'viewport|footer|pinch|orientation|keyboard dismissal|reused tab' --exclude '.worktrees/**'
```

Expected: the new reused-tab and keyboard-dismissal tests PASS; existing tablet height, top-offset, non-tablet, pinch, orientation, touch cleanup, and live heuristic tests remain PASS.

- [ ] **Step 6: Commit the StudentApp integration**

```bash
git add src/components/student/StudentApp.tsx src/components/student/__tests__/StudentApp.test.tsx
git commit -m "fix(student): resync footer after keyboard dismissal"
```

### Task 3: Update repository memory and verify the complete change

**Files:**
- Modify: `docs/ux-invariants.md`

- [ ] **Step 1: Update the viewport invariant**

Change the owning module list to include `src/components/student/studentExamViewportController.ts`. Add these requirements under the viewport invariant:

```markdown
- Initial exam entry, page restoration, and return to a visible tab must use bounded follow-up measurements so a late browser viewport-meta update cannot strand the shell at a stale rectangle.
- Editable-control focusout must start a bounded settle cycle so the footer returns after the keyboard closes even when no final resize or scroll event fires.
- Delayed settling must be canceled on cleanup and must never mutate non-exam pages.
```

Add `src/components/student/__tests__/studentExamViewportController.test.ts` to Regression Protection.

- [ ] **Step 2: Run focused controller, StudentApp, and CSS regression suites**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  --exclude '.worktrees/**'
```

Expected: controller and CSS tests PASS. If the complete `StudentApp.test.tsx` retains the known unrelated sibling-slot fixture failure, rerun the viewport filter from Task 2 and report that baseline failure separately; no viewport regression may remain.

- [ ] **Step 3: Run lint/type checks scoped to changed code and inspect the diff**

Run:

```bash
npx eslint \
  src/components/student/studentExamViewportController.ts \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  src/components/student/StudentApp.tsx \
  src/components/student/__tests__/StudentApp.test.tsx
npx tsc --noEmit --pretty false 2>&1 | tee /tmp/student-viewport-tsc.log
rg 'studentExamViewportController|StudentApp' /tmp/student-viewport-tsc.log || true
git diff --check
git status --short
```

Expected: ESLint and `git diff --check` PASS; no new TypeScript diagnostics point to changed viewport code. Existing repository-wide TypeScript diagnostics, if any, are reported as baseline rather than hidden.

- [ ] **Step 4: Commit the memory artifact**

```bash
git add docs/ux-invariants.md
git commit -m "docs(student): record viewport lifecycle recovery"
```

- [ ] **Step 5: Review final history and push the verified commits to `origin/main`**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git push origin HEAD:main
```

Expected: working tree clean, `origin/main` is an ancestor of `HEAD`, and the push succeeds without force.

## Plan Self-Review

- Spec coverage: initial silent settling, `pageshow`/visibility lifecycle recovery, focusout recovery, keyboard shrink protection, top-offset refresh, pinch/orientation baseline protection, cleanup, module ownership, regression tests, and documentation all map to explicit steps.
- Placeholder scan: no `TODO`, `TBD`, deferred implementation, or unnamed error-handling step remains.
- Type consistency: the installer is consistently named `installStudentExamViewportController`; options are `targetWindow`, `targetDocument`, and `protectHeight`; the two CSS properties match existing shell CSS and tests.
- Scope: no answer, persistence, submission, timer, grading, integrity, or audit behavior is changed.
