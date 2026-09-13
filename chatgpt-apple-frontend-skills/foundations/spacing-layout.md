# Skill: Spacing, Layout, and Density

## Purpose

Define spatial rhythm, alignment, grids, container behavior, density modes, and how layouts express relationships.

## Use This Skill When

- Building page shells, split views, forms, cards, settings screens, or responsive content.
- The UI feels inconsistent even though components look individually correct.

## Goals

- Create predictable rhythm.
- Use alignment to communicate hierarchy.
- Make density deliberate.
- Avoid fragile pixel layouts.

## Mental Model

Spacing is relational. The distance between two objects should say whether they belong together, are peers, or are separate groups.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Prefer a small spacing scale with intentional exceptions.
- Use container-aware layout before device-name breakpoints.

## Architecture

Compose layout from primitives:

```text
Stack      vertical rhythm
Inline     horizontal groups
Cluster    wrapping action groups
Grid       repeated structured content
Sidebar    navigation + content
Split      resizable peer panes
Frame      readable max-width content
```

Feature components should use these patterns instead of inventing local spacing systems.

## Best Practices

- Use tighter spacing within a group and larger spacing between groups.
- Align labels, headings, and content edges consistently across a surface.
- Prefer `gap` over child margins for component-owned spacing.
- Use logical properties so RTL adaptation is natural.
- Use `minmax()`, `clamp()`, flex wrapping, and container queries for resilient layout.
- Define compact/comfortable density only when the product truly needs both.
- Respect viewport safe-area insets for edge controls on mobile/tablet.

## Implementation Patterns

- Build `Stack`, `Inline`, and `Frame` layout primitives.
- Use grid for two-dimensional alignment; flex for one-dimensional flow.
- Use `min-width: 0` on flex/grid children that must shrink.

## Decision Rules

- If spacing is repeated in 3+ places with the same semantic relationship → tokenize or create a layout primitive.
- If a layout changes because its container narrows → use a container query.
- If content becomes unreadable before the page is technically 'mobile' → recompose at that content threshold.
- If horizontal actions no longer fit → wrap or collapse secondary actions; do not shrink targets.

## States and Edge Cases

- Split panes.
- Very long sidebars.
- Browser zoom.
- Soft keyboard.
- Safe areas.
- RTL.
- Small landscape phone.
- iPad multitasking widths.

## Anti-Patterns

- Magic-number absolute positioning for primary layout.
- Margins leaking out of components.
- Breakpoint logic based only on device names.
- Shrinking controls below usable sizes to preserve one row.
- Nested grids with inconsistent gutters.

## Performance

- Avoid layout thrash from JS measuring on every resize.
- Prefer CSS layout primitives and `ResizeObserver` only when actual measurement is required.

## Accessibility

- Reflow must preserve reading and focus order.
- Zoom should not force two-dimensional scrolling for ordinary pages.
- Touch target dimensions must not collapse in compact layout.

## Testing

- Resize continuously, not only at preset screenshots.
- Test zoom and text scaling.
- Test with longest localization.
- Test sidebar collapsed/expanded and split-pane extremes.

## Production Checklist

- Shared spacing scale.
- Alignment edges consistent.
- Responsive thresholds content-driven.
- Overflow behavior explicit.
- No unreachable controls at constrained widths.

## Review Heuristics

- Do related things look related before reading labels?
- Are there too many different gutter values?
- Does the layout gracefully pass through every width between desktop and tablet?

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
