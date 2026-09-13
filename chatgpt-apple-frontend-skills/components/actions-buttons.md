# Skill: Actions and Buttons

## Purpose

Own button hierarchy, semantics, destructive actions, icon actions, loading states, and action grouping.

## Use This Skill When

- Implementing primary/secondary/ghost/destructive actions.
- A page has too many visually equal buttons.
- Icon buttons are unclear.
- Loading buttons shift or double-submit.

## Goals

- Make the next action obvious.
- Preserve native button semantics.
- Prevent accidental destructive actions.
- Keep state changes stable and accessible.

## Mental Model

Buttons express **action priority**, not visual decoration. A region should rarely contain multiple equally dominant actions.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Use `<button>` for actions and `<a>` for navigation.
- Do not disable actions merely to hide validation explanations.

## Architecture

Provide a small variant family: primary, secondary, ghost, danger; plus icon-button as a separate ergonomic primitive. Size variants change padding/height, not semantic importance.

## Best Practices

- Use one primary action per local decision region.
- Keep destructive styling proportional to risk; not every delete needs a modal, but consequences must be clear.
- Loading state must preserve button width and prevent unintended duplicate activation.
- Pressed state should be visible without large motion.
- Disabled state must remain readable and explainable when necessary.
- Icon-only buttons require stable accessible names.

## Implementation Patterns

- Support leading/trailing icons through explicit slots.
- Use a progress indicator only when the action lasts long enough to need it; otherwise a subtle pending state is enough.

## Decision Rules

- If clicking navigates → link.
- If clicking changes current state → button.
- If action is reversible and low-risk → prefer undo over confirmation.
- If destructive and difficult to recover → add confirmation or stronger friction.

## States and Edge Cases

- Hover.
- Focus-visible.
- Pressed.
- Disabled.
- aria-disabled.
- Loading.
- Success acknowledgement.
- Long label.
- Icon-only.
- Touch.

## Anti-Patterns

- Clickable `<div>`.
- Two primary buttons beside each other.
- Button text changing so much that layout jumps.
- Disabling a button with no reason.
- Tiny icon buttons.

## Performance

- Avoid mounting expensive spinners for sub-200ms operations.
- Keep hover/press CSS-only where possible.

## Accessibility

- Visible focus ring.
- Accessible name.
- Native keyboard activation.
- Do not trap focus after action unless a modal opens.

## Testing

- Keyboard activation.
- Double-click/loading.
- Disabled semantics.
- Long localization.
- Visual snapshots for all states.

## Production Checklist

- Semantics correct.
- Priority clear.
- Loading width stable.
- Destructive path reviewed.
- Focus visible.
- Targets usable.

## Review Heuristics

- Which action wins visually?
- Can a user predict consequence from the label?
- Does loading preserve context and prevent duplicates?

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
