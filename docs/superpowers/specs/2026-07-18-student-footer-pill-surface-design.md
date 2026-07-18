# Student Footer Pill Surface Design

**Date:** 2026-07-18
**Status:** Approved for implementation planning
**Owner:** Student exam UI module

## Problem

The floating exam footer correctly avoids the previous viewport-row failure, but its reserved
workspace clearance exposes the shell's grey background. This creates a full-width grey tray behind
the pill, making the footer look like a second dock instead of a floating navigation control.

The pill also combines a visible grey border with a comparatively heavy shadow. Using both
structural and elevated treatments makes the surface visually heavier than the compact navigation
content requires.

## Decision

Keep the fixed floating footer architecture and its safety clearance, but change the visible
surface treatment:

- The workspace footer-clearance area uses the same white canvas as the exam content.
- The pill remains an opaque light surface so content cannot show through its controls.
- Remove the pill's explicit grey border.
- Replace the heavy single shadow with a subtle two-layer neutral elevation shadow.
- Keep the existing radius, width, safe-area insets, horizontal scrolling, and stacking isolation.

The footer reserve remains unchanged unless regression evidence proves it is larger than necessary.
Its purpose is functional: the final answer controls must not sit behind the pill.

## Ownership and Scope

`src/index.css` owns the entire correction. No React markup, footer actions, viewport metadata,
keyboard handling, answer state, autosave, submission, or timer behavior changes.

## Visual Contract

The visible bottom region must read as one continuous exam canvas with one floating object:

1. Exam content and reserved clearance share the same white background.
2. The pill is distinguished by spacing, shape, and soft elevation—not a grey tray.
3. The pill uses one elevation language. It must not combine a visible border with a heavy shadow.
4. No gradient, backdrop filter, glow, animation, or translucent dock is introduced.

## Accessibility and Compatibility

- Existing focus-visible states and button contrast remain unchanged.
- The correction uses ordinary background and box-shadow properties supported by all target
  browsers.
- High-contrast behavior remains controlled by the existing exam accessibility class.
- Safe-area and fixed-position behavior remain exactly as implemented by the floating-footer spec.

## Regression Protection

Extend `StudentViewportCss.test.ts` to assert that:

- the workspace declares an opaque white footer-clearance canvas;
- the footer has no explicit border;
- the footer keeps a low-alpha, layered elevation shadow;
- fixed positioning, safe-area insets, bottom reservation, and the pill radius remain intact.

## Non-Goals

- Removing or shrinking the footer reserve.
- Changing footer button colors, typography, progress, spacing, or navigation behavior.
- Changing the header or exam panel layout.
- Reintroducing an in-flow footer row or viewport JavaScript.
