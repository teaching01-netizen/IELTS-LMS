# Skill: Layout, Spacing, and Density

## Purpose

Build strong page composition and component rhythm that remains stable across content sizes and device widths.

## Mental Model

Good layout uses a small number of reusable constraints rather than many local offsets.

Prefer:

```text
container
  → stack / cluster / grid / split
    → component
      → internal spacing
```

## Layout Primitives

Use predictable primitives:

- stack for vertical rhythm;
- cluster for inline groups;
- grid for repeated aligned content;
- split for two-region layouts;
- sidebar pattern for navigation/content;
- centered content container for readable pages;
- scroll region for intentionally bounded overflow.

## Spacing Rules

- Use a spacing scale.
- Let relationship determine distance: tighter means more related.
- Internal component spacing should be more consistent than page spacing.
- Avoid “margin archaeology” where every child owns arbitrary external margins.
- Prefer parent-owned `gap` for sibling spacing.

## Density

Density must match task type.

For focused reading → more whitespace and narrower measure.

For operational tools → tighter density with strong alignment.

For touch-heavy use → larger targets even if information density stays high.

## Responsive Layout

Do not reduce every value proportionally.

At narrow widths, consider structural change:

- two columns → one column;
- persistent sidebar → drawer/sheet;
- table → card/row representation;
- multi-action toolbar → prioritized actions + overflow;
- fixed metadata rail → inline metadata sections.

## Edge Cases

Always test:

- long headings;
- no content;
- unusually large datasets;
- one-item datasets;
- narrow split panes;
- browser zoom;
- safe-area insets;
- nested scroll areas;
- sticky elements near overflow containers.

## Anti-Patterns

- absolute positioning for primary layout;
- fixed heights around dynamic text;
- large empty hero spacing in task-oriented screens;
- excessive nested scroll containers;
- many breakpoints for tiny cosmetic differences;
- using `overflow: hidden` to conceal layout bugs.

## Production Checklist

- spacing scale is coherent;
- parent `gap` is preferred for sibling rhythm;
- content can expand;
- narrow-width behavior is deliberate;
- sticky regions do not trap content;
- scroll ownership is obvious;
- touch controls retain usable target size;
- no accidental clipping.
