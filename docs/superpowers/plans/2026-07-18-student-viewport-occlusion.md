# Student Viewport Occlusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the full student exam shell anchored after both blur-based and retained-focus software-keyboard dismissal, with the footer behind the keyboard while it is visible.

**Architecture:** Split the pure viewport policy's trusted height from its live visual origin and separate editable focus from keyboard occlusion. The browser controller normalizes optional keyboard intersection data, but Visual Viewport geometry remains the portable fallback. CSS stays a passive consumer of the policy's published height and offset.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, CSS custom properties, Visual Viewport API, optional Virtual Keyboard API.

---

## File Map

- Modify `src/components/student/studentExamViewportPolicy.ts`: own closed height, live offset,
  keyboard phase, focus state, topology, and pinch transitions.
- Modify `src/components/student/__tests__/studentExamViewportPolicy.test.ts`: reproduce both
  `IMG_1111` dismissal sequences and preserve existing state-machine invariants.
- Modify `src/components/student/studentExamViewportController.ts`: normalize optional keyboard
  intersection height and use the policy's closed height as the measurement fallback.
- Modify `src/components/student/__tests__/studentExamViewportController.test.ts`: exercise blur,
  retained-focus recovery, Virtual Keyboard zero geometry, fallbacks, and cleanup through the browser
  adapter.
- Modify `src/components/student/__tests__/StudentApp.test.tsx`: assert the CSS custom properties for
  both user-reported dismissal paths through the installed controller.
- Modify `docs/ux-invariants.md`: replace rectangle-coupled rules with independent height, origin,
  focus, and occlusion rules.
- Modify `docs/failure-cases.md`: append the `IMG_1111` follow-up root cause and regression coverage.

No production changes are planned for `StudentApp.tsx`, `src/index.css`, viewport meta handling,
answer persistence, submission, timers, integrity, audit, or grading.

### Task 1: Reproduce both dismissal failures in the pure policy

**Files:**
- Modify: `src/components/student/__tests__/studentExamViewportPolicy.test.ts`
- Test: `src/components/student/__tests__/studentExamViewportPolicy.test.ts`

- [ ] **Step 1: Extend the measurement helper with optional keyboard geometry**

Add the nullable default so every policy fixture explicitly represents engines without the optional
Virtual Keyboard API:

```ts
const sample = (
  visualHeight: number | null,
  options: Partial<StudentExamViewportMeasurement> = {},
): StudentExamViewportMeasurement => ({
  visualHeight,
  layoutHeight: 900,
  offsetTop: 0,
  layoutWidth: 1024,
  scale: 1,
  keyboardHeight: null,
  ...options,
});
```

- [ ] **Step 2: Replace the old blur expectation with the live-origin regression**

Use the production event order and assert that focusout does not restore the old offset:

```ts
it('keeps the live visual origin while tap-outside keyboard recovery settles', () => {
  let state = createStudentExamViewportPolicy(sample(900));
  state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
  state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-entered' });
  state = reduceStudentExamViewportPolicy(state, {
    type: 'measurement-received',
    measurement: sample(560, { offsetTop: 180 }),
  });
  state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-left' });
  state = reduceStudentExamViewportPolicy(state, {
    type: 'measurement-received',
    measurement: sample(900, { offsetTop: 180 }),
  });

  expect(state.publishedRect).toEqual({ height: 900, offsetTop: 180 });
  expect(state.keyboardPhase).toBe('clear');

  state = reduceStudentExamViewportPolicy(state, {
    type: 'measurement-received',
    measurement: sample(900, { offsetTop: 0 }),
  });

  expect(state.publishedRect).toEqual({ height: 900, offsetTop: 0 });
});
```

- [ ] **Step 3: Add retained-focus keyboard-hide recovery**

```ts
it('accepts recovered growth when the keyboard hides but focus remains', () => {
  let state = createStudentExamViewportPolicy(sample(900));
  state = reduceStudentExamViewportPolicy(state, { type: 'recovery-finished' });
  state = reduceStudentExamViewportPolicy(state, { type: 'editable-focus-entered' });
  state = reduceStudentExamViewportPolicy(state, {
    type: 'measurement-received',
    measurement: sample(560, { offsetTop: 180 }),
  });
  state = reduceStudentExamViewportPolicy(state, {
    type: 'measurement-received',
    measurement: sample(950, { layoutHeight: 950, offsetTop: 180 }),
  });

  expect(state.editableFocusActive).toBe(true);
  expect(state.keyboardPhase).toBe('armed');
  expect(state.publishedRect).toEqual({ height: 950, offsetTop: 180 });

  state = reduceStudentExamViewportPolicy(state, {
    type: 'measurement-received',
    measurement: sample(950, { layoutHeight: 950, offsetTop: 0 }),
  });

  expect(state.publishedRect).toEqual({ height: 950, offsetTop: 0 });
});
```

- [ ] **Step 4: Run the two tests and verify RED**

Run:

```bash
npx vitest run src/components/student/__tests__/studentExamViewportPolicy.test.ts \
  -t 'live visual origin|keyboard hides but focus remains'
```

Expected: both tests fail against the old policy. The tap-outside test receives offset `0` instead
of `180`, and the retained-focus test receives height `900` instead of `950` or lacks the new state
fields.

### Task 2: Separate height, origin, focus, and occlusion in the pure policy

**Files:**
- Modify: `src/components/student/studentExamViewportPolicy.ts`
- Modify: `src/components/student/__tests__/studentExamViewportPolicy.test.ts`
- Test: `src/components/student/__tests__/studentExamViewportPolicy.test.ts`

- [ ] **Step 1: Define independent lifecycle types and state**

Replace keyboard-specific viewport modes with an orthogonal keyboard phase:

```ts
export interface StudentExamViewportMeasurement {
  visualHeight: number | null;
  layoutHeight: number;
  offsetTop: number;
  layoutWidth: number;
  scale: number;
  keyboardHeight: number | null;
}

export type StudentExamViewportMode =
  | 'bootstrapping'
  | 'stable'
  | 'pinch-active'
  | 'topology-recovery';

export type StudentExamKeyboardPhase = 'clear' | 'armed' | 'occluding' | 'recovering';

export interface StudentExamViewportPolicyState {
  mode: StudentExamViewportMode;
  keyboardPhase: StudentExamKeyboardPhase;
  editableFocusActive: boolean;
  closedHeight: number;
  liveOffsetTop: number;
  publishedRect: StudentExamViewportRect;
  layoutWidth: number;
  modeBeforePinch: Exclude<StudentExamViewportMode, 'pinch-active'> | null;
}
```

- [ ] **Step 2: Add focused helpers for accepting height and publishing live origin**

Implement helpers with one responsibility each:

```ts
function publish(
  state: StudentExamViewportPolicyState,
  height: number,
  offsetTop: number,
): StudentExamViewportPolicyState {
  return {
    ...state,
    liveOffsetTop: offsetTop,
    publishedRect: { height, offsetTop },
  };
}

function acceptClosedHeight(
  state: StudentExamViewportPolicyState,
  height: number,
  offsetTop: number,
  layoutWidth: number,
): StudentExamViewportPolicyState {
  return {
    ...publish(state, height, offsetTop),
    closedHeight: height,
    layoutWidth,
  };
}
```

- [ ] **Step 3: Implement measurement transition precedence**

The `measurement-received` branch must apply this order:

```ts
if (rect === null || !hasNativeScale(measurement) || state.mode === 'pinch-active') {
  return state;
}

const width = finitePositive(measurement.layoutWidth) ?? state.layoutWidth;
const keyboardPositive =
  measurement.keyboardHeight !== null && measurement.keyboardHeight > 0;
const keyboardExplicitlyClear = measurement.keyboardHeight === 0;

if (state.mode === 'bootstrapping' || state.mode === 'topology-recovery') {
  return acceptClosedHeight(state, rect.height, rect.offsetTop, width);
}

if (rect.height >= state.closedHeight) {
  return {
    ...acceptClosedHeight(state, rect.height, rect.offsetTop, width),
    keyboardPhase: state.editableFocusActive ? 'armed' : 'clear',
  };
}

if (keyboardPositive) {
  return {
    ...publish(state, state.closedHeight, rect.offsetTop),
    keyboardPhase: 'occluding',
  };
}

if (state.keyboardPhase === 'clear') {
  return acceptClosedHeight(state, rect.height, rect.offsetTop, width);
}

if (keyboardExplicitlyClear) {
  return {
    ...publish(state, state.closedHeight, rect.offsetTop),
    keyboardPhase: state.editableFocusActive ? 'armed' : 'recovering',
  };
}

if (state.keyboardPhase === 'armed') {
  return {
    ...publish(state, state.closedHeight, rect.offsetTop),
    keyboardPhase: 'occluding',
  };
}

return {
  ...publish(state, state.closedHeight, rect.offsetTop),
  keyboardPhase: state.keyboardPhase,
};
```

The implementation may extract the final phase selection into a named pure helper, but it must not
allow `keyboardHeight: 0` to lower `closedHeight`.

- [ ] **Step 4: Implement focus, recovery, topology, and pinch events**

Use these exact state rules:

```ts
case 'editable-focus-entered':
  return {
    ...state,
    editableFocusActive: true,
    keyboardPhase: state.keyboardPhase === 'occluding' ? 'occluding' : 'armed',
  };

case 'editable-focus-left':
  return {
    ...state,
    editableFocusActive: false,
    keyboardPhase: 'recovering',
  };

case 'bootstrap-recovery-started':
  return state.mode === 'pinch-active'
    ? state
    : { ...state, mode: 'bootstrapping', modeBeforePinch: null };

case 'topology-recovery-started':
  return state.mode === 'pinch-active'
    ? state
    : {
        ...state,
        mode: 'topology-recovery',
        keyboardPhase: state.editableFocusActive ? 'armed' : 'clear',
        modeBeforePinch: null,
      };
```

Pinch start freezes `publishedRect`; pinch finish restores `modeBeforePinch`; `recovery-finished`
only changes bootstrapping/topology mode to stable and never clears keyboard recovery protection.

- [ ] **Step 5: Update existing policy assertions for independent state**

Replace old `keyboard-active`/`keyboard-recovery` mode assertions with `keyboardPhase` assertions.
Change the persistent smaller-recovery expected origin from the stored baseline to the live sample:

```ts
expect(state.keyboardPhase).toBe('recovering');
expect(state.publishedRect).toEqual({ height: 900, offsetTop: 10 });
```

Retain the existing bootstrap/topology, stable browser-chrome, focus-transfer, invalid geometry, and
pinch expectations.

- [ ] **Step 6: Run all policy tests and verify GREEN**

Run:

```bash
npx vitest run src/components/student/__tests__/studentExamViewportPolicy.test.ts
```

Expected: all policy tests pass, including the two new production sequences.

- [ ] **Step 7: Commit the pure state-machine change**

```bash
git add src/components/student/studentExamViewportPolicy.ts \
  src/components/student/__tests__/studentExamViewportPolicy.test.ts
git commit -m "fix(student): separate viewport height and origin"
```

### Task 3: Pass optional keyboard intersection through the browser adapter

**Files:**
- Modify: `src/components/student/studentExamViewportController.ts`
- Modify: `src/components/student/__tests__/studentExamViewportController.test.ts`
- Test: `src/components/student/__tests__/studentExamViewportController.test.ts`

- [ ] **Step 1: Add controller regressions for both event orders**

Add tests that install the controller, focus a real input, mutate the Visual Viewport mock, dispatch
events, and assert:

```ts
expect(root.style.getPropertyValue('--student-viewport-height')).toBe('900px');
expect(root.style.getPropertyValue('--student-viewport-offset-top')).toBe('180px');
```

after `focusout -> 900/180`, followed by offset `0`; and:

```ts
expect(document.activeElement).toBe(input);
expect(root.style.getPropertyValue('--student-viewport-height')).toBe('950px');
expect(root.style.getPropertyValue('--student-viewport-offset-top')).toBe('180px');
```

after retained-focus growth from `560/180` to `950/180`.

- [ ] **Step 2: Add a Virtual Keyboard zero-geometry safety test**

Install a mock with mutable `boundingRect.height`. Drive positive height while the visual viewport is
small, then set it to zero while the visual height remains below the closed height:

```ts
virtualKeyboard.setHeight(320);
visualViewport.setHeight(560);
virtualKeyboard.dispatchGeometryChange();

virtualKeyboard.setHeight(0);
visualViewport.setHeight(820);
virtualKeyboard.dispatchGeometryChange();

expect(root.style.getPropertyValue('--student-viewport-height')).toBe('900px');
```

- [ ] **Step 3: Run the controller regressions and verify RED**

Run:

```bash
npx vitest run src/components/student/__tests__/studentExamViewportController.test.ts \
  -t 'tap-outside|retained-focus|zero keyboard geometry'
```

Expected: failures show the old baseline offset, ignored retained-focus growth, and missing keyboard
intersection data.

- [ ] **Step 4: Normalize Virtual Keyboard bounding height**

Replace the event-only type with:

```ts
type VirtualKeyboardEventTarget = Pick<
  EventTarget,
  'addEventListener' | 'removeEventListener'
> & {
  readonly boundingRect?: Pick<DOMRectReadOnly, 'height'>;
};
```

Add a nullable nonnegative reader and publish it with every measurement:

```ts
function finiteOptionalNonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

return {
  visualHeight,
  layoutHeight: innerHeight ?? clientHeight ?? fallbackHeight,
  offsetTop: visualHeight === null ? 0 : finiteNonNegative(visualViewport?.offsetTop),
  layoutWidth: innerWidth ?? clientWidth ?? fallbackWidth,
  scale: visualHeight === null ? 1 : (finitePositive(visualViewport?.scale) ?? 1),
  keyboardHeight: finiteOptionalNonNegative(virtualKeyboard?.boundingRect?.height),
};
```

- [ ] **Step 5: Use `closedHeight` as the controller fallback**

Change policy measurement fallback wiring from the removed trusted rectangle:

```ts
measurement: readMeasurement(policy.closedHeight, policy.layoutWidth),
```

Keep the existing bounded observation, event listeners, pinch guard, duplicate-publication guard,
and cleanup behavior unchanged.

- [ ] **Step 6: Run the controller suite and verify GREEN**

Run:

```bash
npx vitest run src/components/student/__tests__/studentExamViewportController.test.ts
```

Expected: all controller tests pass with listener cleanup still asserted.

- [ ] **Step 7: Commit the adapter change**

```bash
git add src/components/student/studentExamViewportController.ts \
  src/components/student/__tests__/studentExamViewportController.test.ts
git commit -m "fix(student): recover keyboard geometry with retained focus"
```

### Task 4: Prove both sequences through StudentApp

**Files:**
- Modify: `src/components/student/__tests__/StudentApp.test.tsx`
- Test: `src/components/student/__tests__/StudentApp.test.tsx`

- [ ] **Step 1: Correct the existing blur recovery expectation**

In `restores the trusted footer after keyboard dismissal and rejects a stale smaller viewport`,
assert that the protected height follows the live origin instead of restoring zero:

```ts
expect(root.style.getPropertyValue('--student-viewport-height')).toBe('900px');
expect(root.style.getPropertyValue('--student-viewport-offset-top')).toBe('20px');
```

Then drive `900/180` and `900/0` to reproduce the final tap-outside recovery and assert both values.

- [ ] **Step 2: Add retained-focus growth integration coverage**

Render a writing attempt, focus its textbox, drive `560/180`, then `950/180` without blurring:

```ts
expect(document.activeElement).toBe(editor);
expect(root.style.getPropertyValue('--student-viewport-height')).toBe('950px');
expect(root.style.getPropertyValue('--student-viewport-offset-top')).toBe('180px');
```

Drive offset zero and assert the header/footer shell rectangle becomes `950/0` while the editor
remains focused.

- [ ] **Step 3: Run the focused StudentApp tests**

Run:

```bash
npx vitest run src/components/student/__tests__/StudentApp.test.tsx \
  -t 'reused tab|keyboard dismissal|keyboard-hide|viewport top offset|pinch|orientation|window-width'
```

Expected: all selected integration tests pass.

- [ ] **Step 4: Commit the integration memory**

```bash
git add src/components/student/__tests__/StudentApp.test.tsx
git commit -m "test(student): cover both keyboard dismissal paths"
```

### Task 5: Update repository memory and run broad verification

**Files:**
- Modify: `docs/ux-invariants.md`
- Modify: `docs/failure-cases.md`
- Test: `src/components/student/__tests__/studentExamViewportPolicy.test.ts`
- Test: `src/components/student/__tests__/studentExamViewportController.test.ts`
- Test: `src/components/student/__tests__/StudentApp.test.tsx`
- Test: `src/components/student/__tests__/StudentViewportCss.test.ts`
- Test: `src/components/student/__tests__/examPageZoomGuard.test.ts`

- [ ] **Step 1: Update the visible-viewport invariant**

Record these rules in `docs/ux-invariants.md`:

```md
- Closed shell height and live visual origin have independent trust rules.
- Focus arms keyboard shrink protection but does not prove keyboard visibility.
- Every valid native-scale offset is followed during keyboard occlusion and recovery.
- Recovered growth is accepted even when editable focus remains.
- A zero optional keyboard intersection never authorizes a smaller stale height.
```

- [ ] **Step 2: Add the `IMG_1111` follow-up failure case**

Document the two user-confirmed dismissal paths, the focus/keyboard coupling root cause, the split
height/origin model, and the exact policy/controller/StudentApp regression files.

- [ ] **Step 3: Run the complete viewport regression set**

Run:

```bash
npx vitest run \
  src/components/student/__tests__/studentExamViewportPolicy.test.ts \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/examPageZoomGuard.test.ts \
  -t 'viewport|footer|keyboard|pinch|orientation|topology|reused tab|cleanup|interactive-widget|browser-chrome|editable focus|invalid|window-width'
```

Expected: all selected viewport tests pass; unrelated StudentApp tests may be reported as skipped by
the name filter.

- [ ] **Step 4: Run lint on every changed TypeScript file**

Run:

```bash
npx eslint \
  src/components/student/studentExamViewportPolicy.ts \
  src/components/student/studentExamViewportController.ts \
  src/components/student/__tests__/studentExamViewportPolicy.test.ts \
  src/components/student/__tests__/studentExamViewportController.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx
```

Expected: zero errors. Report any pre-existing warnings separately.

- [ ] **Step 5: Check TypeScript and isolate changed-file errors**

Run:

```bash
npx tsc --noEmit --pretty false 2>&1 | tee /tmp/student-viewport-tsc.log
rg -n 'studentExamViewportPolicy|studentExamViewportController|StudentApp\.test' \
  /tmp/student-viewport-tsc.log || true
```

Expected: the repository may retain known baseline type errors, but the filtered output contains no
errors from changed viewport files.

- [ ] **Step 6: Check repository hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended documentation changes remain before the final commit.

- [ ] **Step 7: Commit repository memory**

```bash
git add docs/ux-invariants.md docs/failure-cases.md
git commit -m "docs(student): separate keyboard focus from occlusion"
```

- [ ] **Step 8: Re-run the focused regression command on final HEAD**

Repeat Task 5 Step 3 after the documentation commit. Expected: the same viewport regression set
passes on the exact final commit.
