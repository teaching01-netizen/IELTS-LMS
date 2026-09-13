# Skill: Overlays, Popovers, Dialogs, and Sheets

## Purpose

Own temporary layers, modality, dismissal, focus management, placement, responsive transformation, and nested overlay rules.

## Use This Skill When

- Showing menus, confirmation, settings, contextual help, pickers, or focused tasks.
- The app overuses modals.
- Popover placement breaks near viewport edges.

## Goals

- Use the lightest layer that fits the task.
- Preserve context.
- Make dismissal predictable.
- Handle focus and small screens correctly.

## Mental Model

Modality has a cognitive cost. Use popovers for contextual lightweight choices, dialogs for decisions, and sheets for substantial narrow-screen tasks.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Every modal needs a clear exit.
- Do not stack modal layers casually.

## Architecture

Layer choice:

```text
tooltip  → brief explanation, no interaction
popover  → contextual choices / small controls
dialog   → explicit decision or focused short task
sheet    → larger temporary task, especially narrow screens
page     → deep, navigable, persistent work
```

## Best Practices

- Anchor popovers to the triggering control when spatial relationship matters.
- Flip/shift near viewport edges rather than clipping.
- On narrow screens, convert complex popovers into sheets.
- Trap focus only in truly modal dialogs/sheets.
- Restore focus to the opener on close when it still exists.
- Escape closes dismissible overlays; destructive confirmation should still have explicit buttons.
- Avoid modal dialogs for routine success/error feedback.

## Implementation Patterns

- Use a portal layer manager.
- Centralize z-index/elevation roles.
- Use `inert`/focus-management utilities for modal background when appropriate.

## Decision Rules

- If the user should continue interacting with the page → nonmodal popover.
- If outside interaction would corrupt the task → modal.
- If overlay content is large enough to require its own navigation → use page/sheet rather than oversized popover.

## States and Edge Cases

- Nested menu.
- Virtual keyboard.
- Viewport edge.
- RTL.
- Trigger unmounts.
- Escape.
- Backdrop click.
- Scroll lock.
- Reduced motion.

## Anti-Patterns

- Modal for every action.
- Popover wider than the viewport.
- Focus lost to body on close.
- Nested dialogs.
- Backdrop with no visible close path.

## Performance

- Mount heavy overlay contents lazily.
- Avoid continuous positioning work when closed.
- Use transform/opacity for transitions.

## Accessibility

- Focus trap for modal only.
- Correct dialog/menu semantics.
- Accessible title/name.
- Screen-reader background isolation.

## Testing

- Open/close focus tests.
- Escape/outside click.
- Viewport edge positioning.
- Mobile sheet adaptation.
- Nested menu keyboard behavior.

## Production Checklist

- Correct layer chosen.
- Focus lifecycle correct.
- Placement robust.
- Responsive form defined.
- No unnecessary nesting.

## Review Heuristics

- Could this be inline instead?
- Does the overlay interrupt a routine task?
- Where does focus go before, during, and after?

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
