# Skill: Touch, Pointer, Hover, Drag, and Resize

## Purpose

Own pointer and touch ergonomics, hover treatment, drag handles, resize affordances, capture, and gesture alternatives.

## Use This Skill When

- Building resizable split panes, draggable items, hover actions, sliders, or tablet layouts.
- A resize divider is hard to discover or click.
- Hover-only interactions break on iPad.

## Goals

- Make targets easy to acquire.
- Separate visual thinness from hit-area size.
- Provide direct manipulation without making it mandatory.
- Avoid accidental drags.

## Mental Model

The visible control and the interactive target do not need the same size. A 1px divider can have a generous invisible hit zone and clear hover/active feedback.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Touch has no hover.
- Drag must have a fallback for important operations.

## Architecture

Pointer interactions use generous hitboxes, cursor changes, pressed/dragging state, pointer capture, and bounded values. Touch variants use larger targets and avoid edge conflicts.

## Best Practices

- For resize dividers, use a wide invisible hit target around a narrow visual separator.
- Show affordance on hover/focus/drag: cursor, handle, highlight, or subtle expansion.
- Use pointer capture during drag so the handle does not lose movement when the pointer leaves it.
- Set min/max panel sizes based on usable content, not arbitrary percentages.
- Provide reset/default-size behavior for complex resizable layouts.
- Avoid hover-revealed-only core actions; keep them discoverable on touch.

## Implementation Patterns

- Use pointer events to unify mouse/pen/touch when appropriate.
- Store split size in CSS variable/local state and persist only when useful.

## Decision Rules

- If a target looks visually thin → enlarge hit area invisibly.
- If drag is required for a critical task → add buttons/keyboard equivalent.
- If touch scrolling and horizontal dragging conflict → require deliberate handle contact and proper `touch-action`.

## States and Edge Cases

- Pointer leaves window.
- Touch scroll conflict.
- Pen input.
- Min/max reached.
- Narrow screen transform.
- Keyboard focus on handle.
- RTL split direction.

## Anti-Patterns

- 1px clickable divider.
- Hover as the only signal.
- Dragging without pointer capture.
- No min/max constraints.
- Resize cursor with no actual interaction feedback.

## Performance

- Update position with requestAnimationFrame/CSS vars if drag is heavy.
- Do not persist storage on every pointermove.

## Accessibility

- Resizable separators can use separator semantics and keyboard increments where important.
- Touch targets should be comfortably large.
- Do not rely on pointer precision.

## Testing

- Mouse, trackpad, touch, pen.
- Fast drag.
- Window leave.
- Keyboard resize.
- RTL.
- Min/max constraints.

## Production Checklist

- Hit target generous.
- Drag feedback obvious.
- Pointer capture used.
- Fallback exists.
- Constraints sensible.

## Review Heuristics

- Can a user discover the divider without instructions?
- Can it be grabbed quickly?
- What happens on iPad with touch and hardware keyboard?

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
