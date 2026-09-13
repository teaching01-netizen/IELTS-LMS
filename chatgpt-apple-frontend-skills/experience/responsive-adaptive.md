# Skill: Responsive and Adaptive Layout

## Purpose

Own behavior across phone, tablet, desktop, split-screen, resizable windows, orientation changes, zoom, and container widths.

## Use This Skill When

- Building interfaces that must work on iPhone, iPad, Android, desktop, or browser split view.
- Desktop scaling is being used as the mobile strategy.

## Goals

- Recompose rather than shrink.
- Preserve primary actions.
- Respect safe areas and virtual keyboards.
- Keep reading and navigation coherent at every width.

## Mental Model

Responsive design is not a set of devices. It is a set of layout capability thresholds driven by content and interaction needs.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Container width often matters more than viewport width.
- Do not remove capability just because space is constrained.

## Architecture

Think in modes:

```text
wide: persistent navigation + full toolbar + multi-pane
medium: narrower nav / selective collapse / optional split
compact: temporary nav + stacked content + bottom/inline actions
```

Choose transitions based on when the actual content stops working.

## Best Practices

- Use container queries for panels/components embedded in variable shells.
- At compact widths, stack or transform rather than squeeze.
- Keep next/back/submit reachable even when secondary tools move to overflow.
- Handle iPad split-screen widths as first-class states.
- Use safe-area insets for edge controls.
- Account for virtual keyboard reducing visual viewport height.
- Test orientation and dynamic browser UI on mobile.

## Implementation Patterns

- CSS-first adaptive layout.
- Use JS only for behavior that genuinely changes, not just style.
- Compose different surface arrangements from the same semantic components.

## Decision Rules

- If a row no longer fits with usable targets → wrap, collapse secondary controls, or recompose.
- If a reading column becomes too wide → cap measure.
- If a sidebar consumes too much of the content area → transform to overlay/rail.
- If a two-pane workflow remains essential on tablet → keep split view until each pane reaches its minimum usable width.

## States and Edge Cases

- 320px width.
- Foldables.
- Landscape phone.
- iPad split view.
- Desktop narrow window.
- 200% zoom.
- Virtual keyboard.
- Safe-area notch/home indicator.

## Anti-Patterns

- Desktop UI scaled down.
- Breakpoint names tied to specific devices.
- Hiding core controls on mobile.
- Fixed viewport heights that break with browser chrome.
- Horizontal scrolling entire app.

## Performance

- Avoid JS resize loops.
- Use CSS grid/flex/container queries.
- Lazy-mount secondary panes on compact layouts only if state is preserved.

## Accessibility

- Reflow must preserve logical order.
- Zoom should remain usable.
- Touch targets remain usable.
- Orientation changes should not lose focus/input.

## Testing

- Continuous resize.
- Device emulation + real tablet/phone when possible.
- Zoom.
- Keyboard open.
- RTL.
- Large text.

## Production Checklist

- Wide/medium/compact behavior defined.
- No core capability lost.
- Safe areas handled.
- Keyboard handled.
- No accidental app-wide horizontal scroll.

## Review Heuristics

- At what width does the *task* break, not the screenshot?
- What becomes overlay vs persistent?
- Can users still reach the primary action with the keyboard open?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```
