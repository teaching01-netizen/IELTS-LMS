# Skill: Toolbars and Compact Controls

## Purpose

Own action grouping, toolbar density, overflow, narrow-space behavior, labels, and control priority.

## Use This Skill When

- A feature has next/back, flag, zoom, highlight, settings, or utility controls.
- Toolbar breaks in narrow panes.
- Too many equal icons create clutter.

## Goals

- Keep frequent actions immediately available.
- Collapse secondary actions predictably.
- Maintain a stable control order.
- Support pointer and touch.

## Mental Model

A toolbar is an action hierarchy. It is not a storage shelf for every possible command.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Keep navigation controls spatially consistent.
- Do not hide a high-frequency action behind overflow only to make a screenshot cleaner.

## Architecture

Group by task: navigation, primary manipulation, secondary tools, status. Use separators/spacing only when groups need distinction.

## Best Practices

- Prioritize controls by frequency and consequence.
- At narrow widths, keep primary navigation/actions visible and move secondary actions to an overflow menu.
- Use labels where icons are ambiguous.
- Do not let controls overlap content when wrapping; deliberately choose wrap, collapse, or scroll.
- Maintain a minimum hit area even in compact visual density.
- Use roving tabindex only for true composite toolbar semantics; otherwise normal tab order may be clearer.

## Implementation Patterns

- `Toolbar` owns grouping/overflow; individual controls own semantics.
- Measure overflow only when CSS cannot represent the desired priority behavior.

## Decision Rules

- If a control is used nearly every task → keep visible.
- If a control is infrequent but important → overflow with a clear label.
- If next/back no longer fit beside status → separate spatial regions rather than shrinking them.

## States and Edge Cases

- Very narrow pane.
- Touch.
- Keyboard.
- Disabled next/back.
- Overflow open.
- Long localized labels.
- Zoomed text.

## Anti-Patterns

- Random icon order per screen.
- Shrinking controls until targets are tiny.
- Using icon-only for unclear concepts.
- Wrapping into two lines unintentionally.
- Overflow menu that hides the current state of a toggle.

## Performance

- Avoid expensive dynamic measurement on every frame.
- Use CSS priority/collapse where possible.

## Accessibility

- Visible focus.
- Accessible names.
- Stateful controls expose pressed/selected semantics.
- Logical keyboard order.

## Testing

- Resize through collapse threshold.
- Touch target test.
- Keyboard order.
- Stateful control screen-reader test.
- Localization stress.

## Production Checklist

- Primary controls stay visible.
- Overflow deterministic.
- Targets usable.
- Control order stable.
- No accidental wrap.

## Review Heuristics

- Which three actions matter most here?
- If the toolbar loses 30% width, what remains?
- Can a user understand every icon without trial and error?

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
