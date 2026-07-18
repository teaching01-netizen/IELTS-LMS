# Student Exam CSS Viewport Shell Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Owner:** Student exam UI module

## Problem

The student exam shell must keep its header and footer attached to the browser tab while the exam
content scrolls independently. On touch devices, opening and dismissing the software keyboard has
repeatedly left the shell with a stale height or vertical origin. The visible result is a missing
header, a footer above a persistent white gap, or both.

The existing implementation tries to reconstruct a stable screen rectangle from
`window.visualViewport`, `window.innerHeight`, focus events, orientation events, optional Virtual
Keyboard geometry, timers, and historical measurements. Multiple browser event orders can describe
the same final screen, and some browsers omit the final event entirely. A state machine therefore
cannot prove that a stored rectangle is still correct.

This is an architecture problem, not another missing event case.

## Evidence and Root Cause

The viewport subsystem currently mixes two coordinate systems:

- CSS `position: fixed`, viewport units, and the initial containing block use browser layout
  geometry.
- `VisualViewport.height` and `VisualViewport.offsetTop` describe the currently visible portion of
  that layout viewport and can change independently during browser chrome, zoom, and keyboard
  transitions.

The application stores values from the second system and writes them back into the first through
`--student-viewport-height` and `--student-viewport-offset-top`. When the browser reports a partial,
late, reordered, or missing transition, the stored CSS rectangle persists after the browser has
already recovered.

Browser and OS combinations also choose different software-keyboard resize behaviors. The page
cannot force every historical browser to resize or overlay its viewports identically. The
application can, however, stop persisting an inferred rectangle after the browser changes.

## Decision

Replace the JavaScript viewport geometry subsystem with one CSS-owned fixed grid shell.

The browser layout engine becomes the only authority for the shell rectangle. The application will
not store, infer, publish, restore, or debounce viewport height or vertical-origin values.

Conceptually:

```css
.student-exam-shell {
  position: fixed;
  inset: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: clip;
}
```

The header occupies the first track, the exam workspace occupies the only flexible track, and the
footer occupies the final track. The middle track and its existing reading/listening/writing panes
remain the only content scroll owners.

## Guarantee Boundary

This design guarantees that application state cannot strand the shell at a stale height or origin:

- no remembered screen rectangle exists;
- no keyboard-open or keyboard-closed state exists;
- no focus event changes shell geometry;
- no delayed callback can rewrite shell geometry;
- no final viewport event is required for recovery.

The browser can still choose how its software keyboard affects the layout viewport. On a browser
that overlays the keyboard, the footer remains at the physical tab bottom behind the keyboard. On a
browser that resizes the layout viewport, the footer may temporarily appear above the keyboard. It
returns automatically when the browser restores the layout viewport because the application has no
stored height to clear.

Identical keyboard-time placement across every historical browser version is not a web-platform
guarantee and is outside this design's claim. Persistent application-created white space after the
browser returns to its normal viewport is inside the guarantee.

## Ownership and Boundaries

The student exam UI module owns this behavior.

### Production owners

- `src/components/student/StudentApp.tsx` owns the active exam shell markup and exam-only lifecycle.
- `src/index.css` owns the shell grid, root containment, safe-area padding, and scroll boundaries.
- `src/components/student/examPageZoomGuard.ts` owns the temporary exam viewport metadata and zoom
  policy.

### Removed owners

- `src/components/student/studentExamViewportPolicy.ts`
- `src/components/student/studentExamViewportController.ts`

Their associated unit tests are removed or replaced with structural CSS and integration tests.

No new viewport service or React state is introduced.

## Shell Structure

The exam shell has three explicit grid rows:

1. Header: intrinsic height, never a scroll container.
2. Main workspace: `minmax(0, 1fr)`, with `min-height: 0`; existing panes own vertical scrolling.
3. Footer: intrinsic height plus safe-area padding, never a scroll container.

The shell is fixed with `inset: 0` and does not declare `height`, `min-height`, `top`, or transform
values derived from JavaScript. `inset: 0` gives the browser one internally consistent constraint
set instead of combining a measured top with a separately measured height.

The current Tailwind `h-screen` utility is removed from the shell markup so it cannot introduce a
second height authority. Flexbox-only shell classes are removed or replaced where they conflict with
the grid skeleton.

## Root and Scrolling Rules

While the exam is active:

- `html` and `body` prevent root scrolling and overscroll chaining;
- neither root element receives a JavaScript-computed height;
- the fixed shell covers the containing block using `inset: 0`;
- the main grid track has `min-height: 0` and `overflow: hidden` or `clip`;
- reading, listening, and writing panes retain their existing `overflow: auto` behavior;
- header and footer never use `position: sticky` as a substitute for grid placement.

`overflow: clip` is preferred for the shell because the shell must not become a programmatically
scrollable container. A same-cascade `overflow: hidden` fallback may precede it if compatibility
testing requires one.

## Keyboard and Focus Behavior

Editable focus does not modify the shell.

- No `focusin` or `focusout` viewport handlers are installed.
- No attempt is made to infer whether the keyboard is open.
- No footer translation or keyboard-height padding is applied.
- The browser may pan the focused input into view within its own visual viewport.
- The existing pane scroll owners continue to make focused questions reachable.

The viewport metadata requests overlay behavior where a browser implements
`interactive-widget=overlays-content`. Unsupported browsers ignore the token and use their native
behavior. The CSS shell does not depend on support for that token.

## Browser Chrome, Rotation, Resize, and Zoom

Browser chrome expansion, tab reuse, rotation, split-screen resizing, and keyboard dismissal all
follow the same rule: the browser recomputes the fixed containing block and CSS grid. The
application performs no follow-up measurements.

The existing exam page-zoom guard remains responsible for disabling unsupported page zoom during
the exam and restoring the original viewport metadata afterward. Media-specific zoom and content
scrolling remain unchanged.

## Safe Areas

Safe-area padding remains CSS-owned:

- horizontal safe-area padding stays on the shell;
- bottom safe-area padding stays on the footer;
- safe-area values are never added to a JavaScript height;
- the footer's background extends through its safe-area padding.

This prevents double-counting the home-indicator inset.

## React Lifecycle

`StudentApp` continues to add and remove the exam-active root class for root containment. It no
longer installs a viewport controller when entering the exam phase.

Leaving the exam phase removes the exam-active class through the existing lifecycle cleanup. There
are no viewport CSS custom properties to remove and no timers or browser listeners to cancel.

## Failure Handling

There is deliberately no runtime viewport recovery path. If a browser renders its own viewport
incorrectly, the application must not compound that condition by retaining a second geometry model.

Unexpected layout behavior will be diagnosed using read-only telemetry or a standalone diagnostic
page that records browser-provided values. Diagnostics must never write shell geometry.

## Testing Strategy

### Structural CSS tests

Replace the current exact-tracked-rectangle assertion with tests proving:

- the shell uses `position: fixed` and `inset: 0`;
- the shell uses a three-row grid with `minmax(0, 1fr)`;
- the shell has no JavaScript viewport height or offset variables;
- root exam styles have no custom-property height authority;
- the footer is an in-flow grid item, not sticky or independently fixed;
- the main track and pane scroll ownership remain intact.

### StudentApp integration tests

Prove that:

- entering exam mode applies the shell and root active class;
- leaving exam mode restores root state;
- focus, blur, and synthetic Visual Viewport events do not add inline geometry;
- keyboard-like viewport sequences require no timers and cannot leave custom properties behind;
- answers, flags, navigation, autosave, and submission behavior are unchanged.

### Browser tests

Update the iPad layout test to assert header/footer grid placement in the normal viewport. Add a
keyboard-dismissal scenario where supported by the automation environment, but do not simulate
browser guarantees that Playwright cannot reproduce. Manual device verification must cover:

- pasting/opening an exam URL in a reused tab;
- tapping outside an input to dismiss the keyboard;
- using the keyboard-hide control while focus remains;
- rotating with the keyboard closed and open;
- expanding and collapsing browser chrome;
- Safari and Chromium-based tabs on iPadOS;
- a representative Android browser that resizes or overlays the keyboard.

## Migration Sequence

1. Add failing structural tests for the CSS-only shell and absence of viewport custom properties.
2. Change the shell markup and CSS to the fixed three-row grid.
3. Remove the viewport controller installation from `StudentApp`.
4. Delete the viewport policy and controller plus tests that encode inferred geometry.
5. Replace integration tests with no-state keyboard lifecycle regressions.
6. Update viewport invariants and failure-case documentation.
7. Run focused tests, lint, type checks for changed files, and browser layout tests.

The migration is atomic. The old geometry controller and new CSS shell must not operate together.

## Critical Invariants

- The browser layout engine is the sole shell-geometry authority.
- Student code must not persist viewport height, viewport origin, or keyboard visibility.
- Header and footer are non-scrolling grid rows.
- Only the main workspace and its panes scroll.
- The shell uses one constraint system: fixed positioning with `inset: 0`.
- Keyboard, focus, resize, orientation, and Visual Viewport events cannot write shell geometry.
- Exam viewport metadata is restored exactly when leaving the exam.
- Answer immutability, idempotent autosave, persisted saved state, timer fairness, and append-only
  integrity/audit behavior remain unchanged.

## Non-Goals

- Guaranteeing identical software-keyboard resize behavior across every browser and OS version.
- Creating a native app, PWA-only launch flow, or browser-support gate.
- Moving the footer above the software keyboard.
- Changing answer inputs, autosave, timers, submission, grading, proctoring, or exam navigation.
- Introducing user-agent or browser-version branches.

## Rollback

Rollback is a single revert of the atomic implementation commit. The deleted policy and controller
remain available in Git history, but no compatibility switch will keep both architectures active in
production.
