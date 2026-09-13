# Skill: Iconography

## Purpose

Own icon semantics, sizing, optical alignment, stroke consistency, labels, and interaction use.

## Use This Skill When

- Adding toolbars, navigation, compact actions, statuses, or empty-state illustrations.
- The app has mixed icon sets or ambiguous unlabeled controls.

## Goals

- Make icons immediately legible.
- Maintain one visual language.
- Avoid requiring users to memorize custom glyphs.
- Keep icon alignment visually balanced.

## Mental Model

Icons are compressed language. Use them where recognition is faster than reading; use text where meaning would otherwise be guessed.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Icon meaning must be stable across the product.
- Optical alignment can differ slightly from mathematical centering.

## Architecture

Use one primary icon family and a small controlled set of product-specific symbols. Wrap icons in a common `Icon` primitive that controls size, stroke/fill conventions, and accessibility defaults.

## Best Practices

- Use text labels for uncommon, destructive, or high-consequence actions.
- Standardize icon sizes by context, not per component whim.
- Keep icon buttons' hit targets larger than the visual glyph.
- Use selected variants consistently rather than mixing filled/outlined semantics arbitrarily.
- Mirror directional icons in RTL where meaning is spatial.

## Implementation Patterns

- `Icon` is decorative by default when adjacent visible text names the action.
- Icon-only buttons require an accessible name and often a tooltip for pointer users.

## Decision Rules

- If users may not recognize the icon without training → add text.
- If two actions have similar glyphs → prefer labels or stronger semantic separation.
- If the glyph is decorative → hide from assistive technology.

## States and Edge Cases

- RTL.
- High contrast.
- Tiny dense toolbar.
- Selected/active.
- Disabled.
- Loading replacement.
- Badge overlay.

## Anti-Patterns

- Mixing different stroke weights.
- Using emoji as production control icons.
- Tiny 14px hit targets.
- Relying on tooltip as the only accessible name.
- Using brand logos as generic UI icons.

## Performance

- Prefer SVG sprites/components over many raster assets.
- Avoid dynamically importing dozens of separate icon chunks for a single toolbar.

## Accessibility

- Accessible names belong to controls, not decorative glyphs.
- Status icons need text/screen-reader context if meaning is not otherwise present.

## Testing

- Icon-only button a11y tests.
- RTL snapshots.
- High-contrast visual checks.
- Compare optical alignment in real control sizes.

## Production Checklist

- One primary icon family.
- Stable semantics.
- Icon-only actions named.
- Targets sufficiently large.
- RTL behavior reviewed.

## Review Heuristics

- Would a first-time user understand each icon?
- Are similar icons used for different concepts?
- Does the icon look centered next to real text, not just in a bounding box?

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
