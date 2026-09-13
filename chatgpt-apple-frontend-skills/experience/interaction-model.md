# Skill: Interaction Model

## Purpose

Own how selection, activation, navigation, editing, confirmation, undo, and system feedback work consistently across the product.

## Use This Skill When

- Defining new interactions.
- Different screens use different click/select/edit conventions.
- Users accidentally trigger actions.
- The UI looks polished but feels unpredictable.

## Goals

- Make behavior transferable from one surface to another.
- Reduce destructive mistakes.
- Preserve directness.
- Use reversible actions.

## Mental Model

Consistency is behavioral before it is visual. Similar-looking things should respond similarly; different consequences should look and behave differently.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Direct manipulation should have immediate feedback.
- Prefer undo/recovery over confirmation for reversible actions.

## Architecture

Define product-wide conventions for row selection, link navigation, inline edit, menus, destructive actions, drag, save, and back/forward behavior.

## Best Practices

- Separate selection from activation when both exist.
- Make hover indicate affordance, not merely decoration.
- Keep Back/Next behavior stable in multi-step flows.
- Use inline editing when context benefits from staying in place.
- Provide clear commit/cancel rules for edits.
- Do not make drag the only way to perform an important action.

## Implementation Patterns

- Use explicit selected state + keyboard equivalent.
- Use optimistic interaction for reversible changes with undo.
- Use command menus as accelerators for expert users.

## Decision Rules

- If an action is reversible → perform directly and offer undo.
- If irreversible/high-consequence → confirmation or friction.
- If users need to compare context while editing → inline/panel rather than full modal.
- If gesture is non-obvious → provide visible controls too.

## States and Edge Cases

- Double click.
- Touch where hover does not exist.
- Keyboard only.
- Interrupted edit.
- Network conflict.
- Selection across pagination/virtualization.

## Anti-Patterns

- Single-click sometimes selects and sometimes opens with no cue.
- Hover-only controls required for core tasks.
- Confirmation dialogs for trivial actions.
- Drag-only reorder with no alternative.

## Performance

- Keep local feedback CSS-driven and cheap.
- Avoid high-frequency global state for pointer movement.

## Accessibility

- Every pointer interaction needs keyboard/touch equivalent when applicable.
- Selected and focused states must remain distinguishable.

## Testing

- Cross-surface consistency tests.
- Keyboard/touch walkthrough.
- Undo path.
- Interrupted edit recovery.
- Double activation.

## Production Checklist

- Selection rules consistent.
- Activation consequence predictable.
- Recovery path defined.
- Gesture alternatives present.
- Feedback immediate.

## Review Heuristics

- Would behavior learned on one screen transfer here?
- Can users recover from mistakes?
- Does touch expose the same capability as hover?

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
