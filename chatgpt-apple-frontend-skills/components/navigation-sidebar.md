# Skill: Navigation and Sidebar

## Purpose

Own global/section navigation, sidebar width, selection state, collapse behavior, responsive transformation, and overflow.

## Use This Skill When

- Building an app shell similar in restraint to ChatGPT or modern Apple productivity apps.
- Sidebar feels cramped, hidden, or requires too many clicks.
- Desktop and iPad behavior diverge.

## Goals

- Keep current location obvious.
- Expose frequent destinations with low effort.
- Adapt side navigation to narrow windows without losing access.
- Avoid wasting horizontal space.

## Mental Model

Navigation is persistent orientation, not a decorative menu. It should answer: where am I, what can I go to, and what remains available when the window narrows?

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Selected state must be stronger than hover.
- Collapse should preserve task context.

## Architecture

Desktop:
```text
┌──────── sidebar ────────┬──────── content ─────────┐
│ primary nav             │                          │
│ module/section list     │                          │
│ utility/account         │                          │
└─────────────────────────┴──────────────────────────┘
```

Tablet/narrow: transform to overlay/sheet or compact rail based on actual available width and task frequency.

## Best Practices

- Give sidebar enough width for meaningful labels; do not force unnecessary truncation.
- Keep module/section switching one action away when it is a frequent workflow.
- Use subtle selected fill + text/icon emphasis; hover should not look selected.
- Preserve scroll position within long nav lists.
- Allow collapse only if it creates useful content space.
- When sidebar becomes overlay, restore focus to the opener on close.
- Use sticky bottom utilities sparingly and ensure content remains scrollable.

## Implementation Patterns

- Use a width token plus min/max constraints.
- For resizable sidebars, provide a visible/hoverable drag affordance and keyboard-accessible fallback if resizing is important.

## Decision Rules

- If navigation is used constantly → keep it persistently visible where space allows.
- If width is constrained but navigation is secondary → convert to temporary sheet.
- If labels are essential for comprehension → do not replace them with icons merely to save width.

## States and Edge Cases

- Collapsed.
- Overlay open.
- Long labels.
- Long navigation list.
- Selected + hovered.
- Keyboard focus.
- RTL.
- Split-screen iPad.
- Mobile safe area.

## Anti-Patterns

- Icon-only sidebar for unfamiliar destinations.
- Selected state that disappears on hover.
- Two-click module switching for a core workflow.
- Sidebar content hidden behind fixed footer.
- Tiny resize target.

## Performance

- Virtualize only extremely long navigation trees.
- Keep open/close transitions transform-based.
- Do not recalculate layout in JS on every drag frame if CSS variables can drive it.

## Accessibility

- Navigation landmarks.
- Correct `aria-current`.
- Focus restoration for overlays.
- Keyboard access to primary destinations.

## Testing

- Resize width extremes.
- Narrow overlay behavior.
- Long labels.
- Keyboard nav.
- RTL.
- Selected state snapshots.

## Production Checklist

- Current location obvious.
- Frequent destinations one action away.
- Narrow adaptation defined.
- Overflow safe.
- Focus restore correct.

## Review Heuristics

- Can a user tell location without reading every item?
- Does collapse actually help?
- What happens at 700–900px split-screen widths?

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
