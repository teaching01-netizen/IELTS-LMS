# Student Visible Viewport Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the student exam header and footer aligned with a vertically shifted iPad visual viewport and eliminate the matching blank area below the footer.

**Architecture:** `StudentApp` will extend its existing exam-phase visual-viewport lifecycle to publish a non-negative top offset without changing the protected height lock. Shared student CSS will fix the complete exam shell to that offset, so the header and footer remain ordinary flex children while only the existing workspace panes scroll.

**Tech Stack:** React 19, TypeScript, CSS custom properties, Visual Viewport API, Vitest, Testing Library, Playwright

---

### Task 1: Track the visible viewport top edge

**Files:**
- Modify: `src/components/student/__tests__/StudentApp.test.tsx:172-213`
- Modify: `src/components/student/__tests__/StudentApp.test.tsx:630-695`
- Modify: `src/components/student/StudentApp.tsx:365-456`

- [ ] **Step 1: Extend the visual viewport test double**

Change the existing helper so tests can set and dispatch changes to `offsetTop`:

```tsx
function installVisualViewportMock(initialHeight: number, initialOffsetTop = 0) {
  const visualViewportTarget = new EventTarget();
  let height = initialHeight;
  let offsetTop = initialOffsetTop;
  let scale = 1;
  const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');

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
      addEventListener: visualViewportTarget.addEventListener.bind(visualViewportTarget),
      removeEventListener: visualViewportTarget.removeEventListener.bind(visualViewportTarget),
    },
  });

  return {
    setHeight(nextHeight: number) {
      height = nextHeight;
    },
    setOffsetTop(nextOffsetTop: number) {
      offsetTop = nextOffsetTop;
    },
    setScale(nextScale: number) {
      scale = nextScale;
    },
    dispatchResize() {
      visualViewportTarget.dispatchEvent(new Event('resize'));
    },
    dispatchScroll() {
      visualViewportTarget.dispatchEvent(new Event('scroll'));
    },
    restore() {
      if (originalVisualViewport) {
        Object.defineProperty(window, 'visualViewport', originalVisualViewport);
      } else {
        Reflect.deleteProperty(window, 'visualViewport');
      }
    },
  };
}
```

- [ ] **Step 2: Write the failing offset regression test**

Add this test beside the existing tablet viewport-height tests:

```tsx
it('tracks the visual viewport top offset without rebasing the protected tablet height', async () => {
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const originalMatchMedia = window.matchMedia;
  const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(window.navigator, 'maxTouchPoints');
  const visualViewport = installVisualViewportMock(900);

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  window.matchMedia = vi.fn(createMatchMediaMock(true)) as unknown as typeof window.matchMedia;
  Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, value: 5 });

  try {
    const { unmount } = render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={createWritingAttemptSnapshot()}
        runtimeSnapshot={createWritingRuntimeSnapshot()}
      />,
    );

    const root = document.documentElement;
    await waitFor(() => {
      expect(root.style.getPropertyValue('--student-viewport-height')).toBe('900px');
      expect(root.style.getPropertyValue('--student-viewport-offset-top')).toBe('0px');
    });

    act(() => {
      visualViewport.setOffsetTop(164);
      visualViewport.dispatchScroll();
    });

    expect(root.style.getPropertyValue('--student-viewport-height')).toBe('900px');
    expect(root.style.getPropertyValue('--student-viewport-offset-top')).toBe('164px');

    unmount();
    expect(root.style.getPropertyValue('--student-viewport-offset-top')).toBe('');
  } finally {
    visualViewport.restore();
    window.matchMedia = originalMatchMedia;
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeight);
    }
    if (originalMaxTouchPoints) {
      Object.defineProperty(window.navigator, 'maxTouchPoints', originalMaxTouchPoints);
    } else {
      Reflect.deleteProperty(window.navigator, 'maxTouchPoints');
    }
  }
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npm test -- --run src/components/student/__tests__/StudentApp.test.tsx -t "tracks the visual viewport top offset"
```

Expected: FAIL because `--student-viewport-offset-top` is empty after render and after the simulated visual viewport scroll.

- [ ] **Step 4: Publish and clean up the viewport offset**

In the exam viewport effect in `StudentApp.tsx`, replace `applyViewportHeight` with this rectangle publisher and pass the live offset through both height branches:

```tsx
const applyViewportRect = (height: number, offsetTop: number) => {
  root.style.setProperty('--student-viewport-height', `${Math.max(0, Math.round(height))}px`);
  root.style.setProperty(
    '--student-viewport-offset-top',
    `${Math.max(0, Math.round(offsetTop))}px`,
  );
};

const updateViewportHeight = () => {
  const visualViewport = window.visualViewport;
  const nextViewportHeight = Math.round(visualViewport?.height ?? window.innerHeight);
  const nextViewportOffsetTop = visualViewport?.offsetTop ?? 0;
  if (!tabletViewportSessionLocked) {
    applyViewportRect(nextViewportHeight, nextViewportOffsetTop);
    return;
  }

  if (lockedViewportHeightRef.current === null) {
    lockedViewportHeightRef.current = stableViewportHeight;
  } else {
    stableViewportHeight = lockedViewportHeightRef.current;
  }

  applyViewportRect(stableViewportHeight, nextViewportOffsetTop);
};
```

Add the matching cleanup next to the existing height-property cleanup:

```tsx
root.style.removeProperty('--student-viewport-height');
root.style.removeProperty('--student-viewport-offset-top');
```

- [ ] **Step 5: Run the focused StudentApp test file and verify GREEN**

Run:

```bash
npm test -- --run src/components/student/__tests__/StudentApp.test.tsx
```

Expected: PASS, including the new offset test and the existing keyboard, pinch, orientation, and grow-only height tests.

- [ ] **Step 6: Commit the viewport-state change**

```bash
git add src/components/student/StudentApp.tsx src/components/student/__tests__/StudentApp.test.tsx
git commit -m "fix(student): track visible viewport top offset"
```

### Task 2: Anchor the complete exam shell

**Files:**
- Create: `src/components/student/__tests__/StudentViewportCss.test.ts`
- Modify: `src/index.css:219-229`

- [ ] **Step 1: Write the failing CSS contract test**

Create `StudentViewportCss.test.ts` with:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('student exam visible viewport CSS', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8');

  it('fixes the exam shell to the tracked visual viewport top edge', () => {
    const shellRule = css.match(/\.student-exam-shell\s*\{([^}]*)\}/s)?.[1];

    expect(shellRule).toBeDefined();
    expect(shellRule).toMatch(/position:\s*fixed\s*;/);
    expect(shellRule).toMatch(/top:\s*var\(--student-viewport-offset-top,\s*0px\)\s*;/);
    expect(shellRule).toMatch(/left:\s*0\s*;/);
    expect(shellRule).toMatch(/right:\s*0\s*;/);
    expect(shellRule).toMatch(
      /height:\s*max\(var\(--student-viewport-height,\s*100dvh\),\s*100dvh\)\s*;/,
    );
  });
});
```

- [ ] **Step 2: Run the CSS contract test and verify RED**

Run:

```bash
npm test -- --run src/components/student/__tests__/StudentViewportCss.test.ts
```

Expected: FAIL because `.student-exam-shell` does not yet declare `position`, `top`, `left`, or `right`.

- [ ] **Step 3: Fix the shell to the tracked visible rectangle**

Add the positioning declarations at the start of the existing `.student-exam-shell` rule in `src/index.css`:

```css
.student-exam-shell {
  position: fixed;
  top: var(--student-viewport-offset-top, 0px);
  left: 0;
  right: 0;
  height: max(var(--student-viewport-height, 100dvh), 100dvh);
  min-height: 0;
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: manipulation;
  padding-left: env(safe-area-inset-left, 0);
  padding-right: env(safe-area-inset-right, 0);
}
```

Do not fix `StudentHeader` or `StudentFooter` independently. They remain the shell's non-scrolling flex children, which avoids overlaying the main workspace.

- [ ] **Step 4: Run viewport and layout unit tests and verify GREEN**

Run:

```bash
npm test -- --run \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/StudentApp.test.tsx \
  src/components/student/__tests__/StudentFooterRepresentative.test.tsx \
  src/components/student/__tests__/StudentSplitPaneCss.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the shell contract**

```bash
git add src/index.css src/components/student/__tests__/StudentViewportCss.test.ts
git commit -m "fix(student): anchor exam shell to visible viewport"
```

### Task 3: Strengthen layout memory and iPad coverage

**Files:**
- Modify: `e2e/student-ipad-layout.spec.ts:10-18`
- Modify: `e2e/student-ipad-layout.spec.ts:75-110`
- Modify: `docs/ux-invariants.md`

- [ ] **Step 1: Replace the permissive footer helper with an aligned exam-chrome helper**

Replace `expectFooterInsideViewport` with:

```ts
async function expectExamChromeAlignedToViewport(page: Page, footerLabel: RegExp) {
  const header = page.getByRole('banner');
  const footer = page.getByRole('contentinfo', { name: footerLabel });
  await expect(header).toBeVisible();
  await expect(footer).toBeVisible();

  const headerBox = await header.boundingBox();
  const footerBox = await footer.boundingBox();
  const viewport = page.viewportSize();
  expect(headerBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs(headerBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(footerBox!.bottom - viewport!.height)).toBeLessThanOrEqual(1);
}
```

Replace each objective-exam call from:

```ts
await expectFooterInsideViewport(page, /question navigation and progress/i);
```

to:

```ts
await expectExamChromeAlignedToViewport(page, /question navigation and progress/i);
```

Replace each writing call from:

```ts
await expectFooterInsideViewport(page, /writing task navigation and submission/i);
```

to:

```ts
await expectExamChromeAlignedToViewport(page, /writing task navigation and submission/i);
```

- [ ] **Step 2: Add the viewport invariant to repository memory**

Append this focused section to `docs/ux-invariants.md`:

```markdown
## Student Exam Visible Viewport

### Owning Module

The active exam viewport rectangle is owned by `StudentApp` and the shared student shell CSS in `src/index.css`.

### Invariant

During an active exam, the complete student shell is fixed to the visible browser viewport. The shell tracks the Visual Viewport API's vertical offset while retaining the protected tablet height contract. Header and footer remain non-scrolling flex children; reading, listening, and writing panes own content scrolling.

### Must Not Break

- Browser chrome movement must not hide the header or leave blank space below the footer.
- Software-keyboard shrinkage must not rebase the protected iPad exam height.
- Safe-area padding, split-pane scrolling, native dialog positioning, and the exam page-zoom guard remain active.
- Viewport custom properties and active classes are removed when leaving the exam phase.
- Answer persistence, submission, timer, integrity, and audit behavior are unaffected.

### Regression Protection

- `src/components/student/__tests__/StudentApp.test.tsx`
- `src/components/student/__tests__/StudentViewportCss.test.ts`
- `e2e/student-ipad-layout.spec.ts`
```

- [ ] **Step 3: Run the iPad layout regression when the backend fixture is available**

Run:

```bash
npx playwright test e2e/student-ipad-layout.spec.ts --project=chromium
```

Expected: PASS for portrait and landscape Reading/Writing checks, with header top and footer bottom aligned to the emulated viewport. If the local Rust/MySQL fixture cannot start, report that environmental blocker separately; do not weaken the assertions.

- [ ] **Step 4: Commit the strengthened repository memory**

```bash
git add e2e/student-ipad-layout.spec.ts docs/ux-invariants.md
git commit -m "test(student): guard visible exam viewport chrome"
```

### Task 4: Complete verification

**Files:**
- Verify: `src/components/student/StudentApp.tsx`
- Verify: `src/index.css`
- Verify: `src/components/student/__tests__/StudentApp.test.tsx`
- Verify: `src/components/student/__tests__/StudentViewportCss.test.ts`
- Verify: `e2e/student-ipad-layout.spec.ts`
- Verify: `docs/ux-invariants.md`

- [ ] **Step 1: Run all focused regression tests**

```bash
npm test -- --run \
  src/components/student/__tests__/StudentApp.test.tsx \
  src/components/student/__tests__/StudentViewportCss.test.ts \
  src/components/student/__tests__/StudentFooterRepresentative.test.tsx \
  src/components/student/__tests__/StudentSplitPaneCss.test.ts
```

Expected: PASS with no failed tests.

- [ ] **Step 2: Run static checks**

```bash
npm run typecheck
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Check patch hygiene and scope**

```bash
git diff --check HEAD~3..HEAD
git status --short
git log -4 --oneline
```

Expected: no whitespace errors; the working tree is clean; commits are limited to viewport tracking, shell positioning, tests, and UX memory.

- [ ] **Step 4: Review the dangerous-area invariants explicitly**

Confirm from the final diff that no code in answer persistence, autosave, session recovery, submission, timer, integrity events, audit events, grading, permissions, or payments changed. Confirm that the only production changes are viewport custom-property publication/cleanup and `.student-exam-shell` positioning.
