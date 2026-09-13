# Skill: Accessibility

## Purpose

Own semantic HTML, keyboard access, focus, contrast, zoom/reflow, labels, announcements, reduced motion, and inclusive interaction.

## Use This Skill When

- Building any user-facing surface.
- Creating custom controls.
- Adding drag, editors, dialogs, charts, or rich status.

## Goals

- Use native semantics first.
- Keep core workflows operable without a mouse.
- Support zoom and assistive technology.
- Make accessibility part of component correctness.

## Mental Model

Accessible implementation is usually simpler when semantics are chosen before styling. Start with the native element whose behavior already matches the task.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- ARIA supplements semantics; it does not replace correct HTML.
- A visually minimal interface must not become semantically minimal.

## Architecture

Accessibility responsibilities live at the lowest layer that owns the interaction. Primitives provide semantics; composites provide keyboard/focus patterns; features provide meaningful names/instructions.

## Best Practices

- Use `<button>` for actions and `<a>` for navigation.
- Use form labels and descriptions programmatically connected to controls.
- Maintain visible focus and logical DOM order.
- Ensure zoom/reflow without clipping critical content.
- Use live regions sparingly for async changes users need to know.
- Respect reduced motion and forced colors.
- Provide non-drag alternatives for important operations.
- Test with real screen-reader/keyboard workflows, not only automated scanners.

## Implementation Patterns

- Native controls first.
- Headless accessible primitives for complex widgets when mature and well-tested.
- Central focus-ring token and shared visually-hidden utility.

## Decision Rules

- If native element matches behavior → use it.
- If custom widget is needed → implement the complete expected keyboard/focus semantics.
- If status change is visually obvious but not programmatically exposed → add a restrained live announcement.

## States and Edge Cases

- Zoom 200–400%.
- Screen reader.
- Keyboard only.
- Reduced motion.
- Forced colors.
- RTL.
- Large text.
- Touch with assistive features.

## Anti-Patterns

- Clickable divs.
- Outline none.
- ARIA role without keyboard behavior.
- Placeholder-only labels.
- Color-only errors.
- Auto-focus that steals user context.

## Performance

- Accessible native controls are usually more performant than custom recreation.
- Avoid excessive live region churn during streaming.

## Accessibility

- Use automated a11y checks plus manual keyboard and screen-reader testing.
- Document known exceptions and rationale.

## Testing

- Automated axe-like scan.
- Keyboard walkthrough.
- Screen-reader smoke test.
- Zoom/reflow.
- Reduced motion.
- Forced colors.

## Production Checklist

- Semantic elements used.
- Names/labels correct.
- Focus visible.
- Keyboard complete.
- Zoom works.
- Announcements restrained.

## Review Heuristics

- What happens with CSS off?
- Can the task be completed without precise pointing?
- Does every custom behavior have equivalent semantics?

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
