# Skill: Content Surfaces, Panels, and Cards

## Purpose

Own grouping containers, cards, panels, inspectors, reading surfaces, selected rows, and surface density.

## Use This Skill When

- Designing dashboards, settings, results, passages, conversation content, or side inspectors.
- Everything is becoming a rounded card.

## Goals

- Express grouping with the minimum container chrome.
- Keep reading surfaces calm.
- Make interactive cards distinguishable from static groups.

## Mental Model

A surface is justified when it adds a meaningful boundary: interaction, grouping, scrolling, elevation, or background context.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Whitespace is often a better separator than another card.
- Clickable cards require obvious affordance and correct semantics.

## Architecture

Provide a few surface primitives: `Section`, `Panel`, `Card`, `ReadingFrame`, `InsetGroup`. Each has a specific purpose, not just a different radius/shadow.

## Best Practices

- Use flat sections for ordinary page grouping.
- Use panels when a region has independent scrolling, controls, or background.
- Use cards for repeated peer objects or clearly clickable summaries.
- Constrain long-form reading width inside wide panels.
- Use separators inside dense lists instead of individually boxed rows when appropriate.
- Avoid nested rounded corners unless layers truly nest.

## Implementation Patterns

- Surface variant maps to semantic elevation/grouping roles.
- Use container queries so inner content adapts to panel width.

## Decision Rules

- If removing the border/background keeps grouping clear → remove it.
- If the whole surface is clickable → use link/button semantics or a single clear interactive target, not nested competing clicks.
- If content is long-form → prioritize measure and padding over decorative framing.

## States and Edge Cases

- Selected.
- Hover.
- Focused descendant.
- Long content.
- Narrow panel.
- Independent scroll.
- Empty.
- Dark mode.

## Anti-Patterns

- Card soup.
- Nested shadows.
- Clickable div cards with nested buttons.
- Fixed heights clipping variable text.
- Excessive padding reducing information density.

## Performance

- Avoid huge shadow/blur regions.
- Use containment only after testing effects on sticky/positioned descendants.

## Accessibility

- Interactive surfaces require correct semantics and focus indication.
- Reading surfaces maintain contrast and zoom behavior.

## Testing

- Nested interactive content tests.
- Narrow container snapshots.
- Long content overflow.
- Selected/focus visual combinations.

## Production Checklist

- Every surface has a purpose.
- No card soup.
- Reading width controlled.
- Interactive semantics valid.
- Overflow explicit.

## Review Heuristics

- What boundary is this rectangle communicating?
- Would spacing alone be clearer?
- Does this panel still work at half its current width?

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
