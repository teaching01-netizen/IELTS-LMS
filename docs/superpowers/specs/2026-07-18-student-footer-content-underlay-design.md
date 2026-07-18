# Student Footer Content Underlay Design

**Date:** 2026-07-18
**Status:** Approved for implementation planning
**Owner:** Student exam UI module

## Problem

The fixed footer pill is visually cleaner than the former full-width footer, but the exam workspace
still reserves its height at the shell level. That shortens every pane and creates a permanent
full-width empty band behind the pill. The result does not read like a true overlay.

The requested reference is Instagram's iPhone bottom-navigation placement: content occupies the
screen behind the navigation surface. The requested scope is placement only. The IELTS pill remains
solid white; no colorful glass or Instagram visual branding is introduced.

## Decision

Remove the footer reserve from `.student-exam-main` and move equivalent clearance into the actual
Reading, Listening, and Writing scroll owners.

- The workspace and split panes extend to the bottom of the shell behind the fixed footer.
- Each scroll owner receives bottom padding and `scroll-padding-bottom` equal to
  `--student-exam-footer-reserve`.
- The padding travels with that pane's scrollable content, allowing its final passage, answer, or
  writing line to scroll completely above the pill.
- The pill's fixed position, solid surface, elevation, radius, safe-area insets, width, and controls
  remain unchanged.

This removes the permanent page-level band while preserving reachability at the end of each pane.

## Ownership and Boundaries

The student exam UI module owns the change:

- `src/index.css` stops reserving footer space on the main shell track.
- A module-local footer layout contract owns the shared scroll-clearance style.
- `StudentQuestionPanel` applies it to objective question panes.
- `StudentReading` applies it to the passage pane.
- `StudentListening` applies it to the material pane.
- `StudentWriting` applies it to the prompt pane and writing editor.

Speaking does not render this footer and is out of scope.

## Shared Scroll-Clearance Contract

Create one module-local, typed React style constant:

```ts
export const STUDENT_FOOTER_SCROLL_CLEARANCE_STYLE = {
  paddingBottom: 'var(--student-exam-footer-reserve)',
  scrollPaddingBottom: 'var(--student-exam-footer-reserve)',
} satisfies React.CSSProperties;
```

Components merge this after existing zoom and typography styles so the footer clearance is not
overridden by responsive padding utilities. A shared constant prevents Reading, Listening, and
Writing from drifting to different reserve values.

## Content and Scrolling Behavior

- At ordinary scroll positions, content may be visible behind the pill, matching a true overlay.
- At the end of a pane, its internal bottom padding provides enough space to lift the last content
  above the pill.
- `scroll-padding-bottom` keeps focus navigation and `scrollIntoView` operations aware of the
  overlay clearance where supported.
- Each pane remains its own scroll owner; root and shell scrolling remain disabled.
- Existing zoom-scroll anchoring continues to use the same elements.

## Visual Contract

- No permanent full-width footer band remains.
- The footer remains the current solid white pill with subtle shadow.
- Content, pane backgrounds, dividers, and scrollbars continue beneath the pill.
- No glass, gradient, blur, translucency, animation, or Instagram iconography is added.

## Accessibility and Critical Invariants

- Final answer controls and writing text remain reachable above the footer.
- Focused inputs must not be hidden solely because the fixed pill overlaps the viewport.
- Footer landmark labels, navigation order, focus states, and touch targets are unchanged.
- Submitted-answer immutability, autosave idempotency, saved-state truth, timer fairness, and
  append-only integrity/audit behavior are untouched.
- No viewport measurement, keyboard state, focus listener, resize timer, or browser branch is added.

## Testing Strategy

1. Change the structural CSS test to prohibit main-level footer padding.
2. Add a unit test for the shared scroll-clearance style.
3. Extend representative component tests to assert the shared clearance on objective questions,
   Reading passage, Listening material, Writing prompt, and Writing editor.
4. Keep footer landmark/navigation tests and the production build green.
5. Update the iPad browser test to assert that the workspace reaches behind the pill while the pill
   remains inset and visible.

## Non-Goals

- Changing the footer surface, colors, shadow, radius, or navigation content.
- Removing per-pane end clearance.
- Changing pane widths, splitters, content zoom, or answer rendering.
- Moving the footer above the software keyboard.
- Reintroducing shell-level footer track sizing.
