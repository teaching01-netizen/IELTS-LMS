# Skill: Color, Surfaces, Materials, and Depth

## Purpose

Define how color, borders, translucency, elevation, and surface separation communicate structure without visual noise.

## Use This Skill When

- Designing page backgrounds, panels, sidebars, cards, overlays, selected rows, or dark mode.
- A UI feels too flat or too 'boxy'.
- Teams are adding shadows or glass inconsistently.

## Goals

- Create clear layering with minimal decoration.
- Preserve text contrast.
- Make selection/action/status colors semantically stable.
- Avoid trendy glass effects that reduce readability.

## Mental Model

Depth is information. A surface should become visually distinct because it occupies a different interaction layer, not because every container needs decoration.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Borders separate peers; shadows indicate overlap/elevation; background shifts indicate grouping.
- Translucency is optional and must preserve legibility.

## Architecture

Use a shallow hierarchy:

```text
canvas
└─ grouped region
   └─ raised/interactive surface
      └─ overlay / modal
```

Most screens should need only two or three surface levels.

## Best Practices

- Use near-neutral surfaces for large areas and reserve saturated color for meaning.
- Prefer subtle background difference or spacing before drawing a border around everything.
- Keep border contrast low but detectable; use stronger borders for focused/selected/invalid states.
- Use shadow only when an element overlaps content or needs separation from scrolling content.
- In dark mode, avoid pure black/white extremes for large surfaces unless the product intentionally demands them.
- Translucent materials must fall back to opaque surfaces when contrast is uncertain.

## Implementation Patterns

- Define `canvas`, `subtle`, `raised`, `overlay` surfaces.
- Define text hierarchy separately from surface hierarchy.
- Use selected-state background plus text/icon change; do not rely on color hue alone.

## Decision Rules

- If two regions are adjacent peers → use spacing or border.
- If one region floats above another → elevation may be appropriate.
- If transparency makes text/background unpredictable → use opaque material.
- If accent appears in more than a few unrelated regions → reduce it.

## States and Edge Cases

- Dark mode.
- High contrast.
- Wallpaper/image behind app.
- Sticky headers over scrolling content.
- Nested panels.
- Selected + focused + hovered simultaneously.

## Anti-Patterns

- Heavy drop shadows on every card.
- Transparent text on variable backgrounds.
- Selection indicated only by faint gray.
- Using brand color for every icon.
- Nested translucent panes creating muddy contrast.

## Performance

- Large blur filters are expensive; minimize area and animation.
- Avoid animating box-shadow blur radius during scrolling.
- Prefer opacity/transform for temporary overlay transitions.

## Accessibility

- Verify semantic contrast combinations.
- Focus outline must remain visible over every surface.
- Do not use color as the only error/success cue.

## Testing

- Contrast checks in light/dark.
- Screenshot selected/hover/focus combinations.
- Forced-colors smoke test.
- Scroll sticky surfaces over varied content.

## Production Checklist

- Surface levels limited and named.
- Accent use restrained.
- Overlay contrast stable.
- No unnecessary blur.
- Focus visible on all surfaces.

## Review Heuristics

- Can a user explain the layering without seeing a shadow?
- Are boxes being used instead of spacing?
- Does dark mode preserve hierarchy rather than simply invert colors?

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
