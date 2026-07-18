# Student Floating Footer Pill Design

**Date:** 2026-07-18
**Status:** Approved
**Owner:** Student exam UI module

## Problem

The student exam footer is currently the final row of the fixed exam-shell grid. On affected iPad
browser tabs, dismissing the software keyboard can leave that row below the visible screen even
though the header and fixed question-step controls remain visible. Earlier viewport measurement
and state-machine approaches were removed because browser keyboard events and viewport reports are
not consistent enough to reconstruct a durable screen rectangle.

The requested change is footer-only: replace the full-width in-flow bar with a floating bottom
navigation pill. Header behavior, exam panes, answer controls, timers, persistence, and submission
semantics must remain unchanged.

## Decision

The footer becomes a fixed floating overlay and no longer participates in shell track sizing.

- The exam shell changes from three rows to two: intrinsic header and flexible workspace.
- Every `.student-exam-footer` uses one fixed positioning contract.
- The pill is centered horizontally with bounded inline insets, a maximum width, rounded border,
  opaque background, and elevation.
- Bottom and horizontal insets include CSS safe-area values.
- The workspace reserves enough bottom padding for the maximum supported footer height so the pill
  does not cover the final answer controls.
- Existing horizontal scrolling inside objective and writing navigation remains native.
- No JavaScript reads viewport geometry or detects keyboard state.

The existing fixed previous/next question stepper is the relevant behavioral precedent: it remains
visible in the reported failure state while the in-flow footer does not. Moving the footer into the
same fixed overlay category removes the footer-row dependency without modifying the header or exam
workspace behavior.

## Ownership and Boundaries

Production ownership remains inside the student exam UI module:

- `src/index.css` owns shell rows, footer placement, safe areas, content reservation, and elevation.
- `src/components/student/StudentFooter.tsx` owns Reading and Listening navigation content.
- `src/components/student/StudentWriting.tsx` owns Writing task navigation content.

Both footer renderers keep the shared `.student-exam-footer` contract. No new viewport service,
React state, portal, resize observer, focus listener, timer, or browser-version branch is added.

## Layout Contract

Conceptually:

```css
.student-exam-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.student-exam-main {
  padding-block-end: var(--student-exam-footer-reserve);
}

.student-exam-footer {
  position: fixed;
  inset-inline: max(var(--student-exam-footer-gap), env(safe-area-inset-left));
  inset-block-end: max(var(--student-exam-footer-gap), env(safe-area-inset-bottom));
  max-inline-size: var(--student-exam-footer-max-width);
  margin-inline: auto;
  border-radius: 9999px;
  overflow: hidden;
}
```

Physical `left` and `right` fallbacks may precede logical inset declarations for older browser
versions. The pill uses an opaque background rather than relying on backdrop-filter support.

## Keyboard and Viewport Behavior

The application does not try to infer whether the keyboard is open.

- On overlay-keyboard browsers, the pill remains at the tab bottom behind the keyboard.
- On resize-keyboard browsers, the browser may temporarily place the fixed pill above the keyboard.
- When the keyboard closes, fixed positioning is recalculated by the browser without application
  state that can remain stale.
- Opening or pasting the exam URL into a reused tab requires no focus event to initialize geometry.

No web implementation can guarantee identical keyboard placement across every browser version.
This design guarantees that the footer has no separate remembered viewport rectangle and no
in-flow footer track that can create a persistent white region beneath it.

## Responsive and Accessibility Behavior

- The pill applies to Reading, Listening, and Writing on every supported screen size.
- A generous maximum width keeps it visually floating on wide displays.
- Minimum inline size is zero so the pill can shrink on narrow displays.
- Existing navigation order, button labels, `contentinfo` landmark labels, focus styles, answered
  state, flags, progress, and submission actions are unchanged.
- Wide navigation remains horizontally scrollable using native touch and keyboard scrolling.
- Reduced-motion preferences require no special handling because the pill does not animate.

## Critical Invariants

- Submitted answers remain immutable.
- Autosave remains idempotent and visible saved state still reflects persistence.
- Timer fairness, integrity events, and append-only audit behavior are untouched.
- Header markup and positioning are unchanged.
- The workspace and its panes remain the only exam-content scroll owners.
- The footer never writes or stores viewport height, offset, or keyboard visibility.
- Safe-area values are applied once by CSS.
- The final answer controls remain reachable and unobscured through reserved workspace space.

## Testing Strategy

1. Extend the structural viewport CSS test to require a two-row shell, fixed footer, safe-area
   insets, rounded pill, and workspace bottom reservation.
2. Keep representative Reading/Listening and Writing footer landmark/navigation tests green.
3. Add an integration assertion that both objective and Writing modes use the shared fixed-footer
   contract without changing their footer actions.
4. Update the iPad layout browser test to assert the pill is inset from the physical viewport edges
   and remains visible after the supported focus/blur sequence.
5. Record the changed invariant and failure case in repository documentation.

## Non-Goals

- Changing the header or preview-section selector.
- Moving the pill above every software keyboard.
- Reintroducing Visual Viewport measurements or keyboard lifecycle state.
- Redesigning question buttons, task buttons, progress calculations, or submission dialogs.
- Changing exam persistence, timing, integrity, grading, or proctoring behavior.

## Rollback

The change is isolated to the footer layout contract and associated tests/docs. A single revert can
restore the in-flow footer row without requiring data or runtime migration.
