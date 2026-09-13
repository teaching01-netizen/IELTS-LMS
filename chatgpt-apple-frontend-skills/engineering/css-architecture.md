# Skill: CSS Architecture

## Purpose

Own styling boundaries, cascade strategy, responsive rules, tokens, state selectors, and long-term maintainability.

## Use This Skill When

- Creating or refactoring application styling.
- Specificity wars appear.
- Responsive behavior is duplicated.
- Feature CSS overrides design-system internals.

## Goals

- Predictable cascade.
- Low specificity.
- Component-local responsibility.
- Theme and responsive behavior without brittle overrides.

## Mental Model

CSS is part of the architecture. Use the cascade intentionally rather than fighting it with ever-more-specific selectors.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Semantic tokens cross boundaries; component internals should not.
- Prefer state attributes/classes over DOM-shape-dependent selectors.

## Architecture

Suggested layers:

```css
@layer reset, tokens, base, components, utilities, overrides;
```

Keep feature styling close to feature components, while global layers own only truly global concerns.

## Best Practices

- Use CSS custom properties for themeable semantic values.
- Prefer class selectors and low specificity.
- Use data attributes for finite component state (`data-state='open'`).
- Use container queries when a component adapts to its available width.
- Use logical properties for inline/block dimensions and spacing.
- Explicitly manage stacking contexts for overlays and sticky chrome.
- Treat overflow as a design decision; never rely on accidental clipping.

## Implementation Patterns

- CSS Modules, scoped CSS, or a consistent CSS-in-JS approach are acceptable when they preserve clear ownership.
- Create small layout utilities only for genuinely cross-cutting patterns.

## Decision Rules

- If styling depends on component container width → container query.
- If a selector reaches through multiple component internals → expose a semantic API instead.
- If `!important` seems necessary → first inspect cascade layer/specificity/ownership.

## States and Edge Cases

- Nested scrolling.
- Sticky headers.
- Portals.
- RTL.
- Forced colors.
- Print if relevant.
- Zoom.
- Long content.
- Safe-area inset.

## Anti-Patterns

- Global descendant selectors targeting component markup.
- Deep selector chains.
- Arbitrary z-index escalation.
- Hard-coded theme colors in feature files.
- JavaScript breakpoints for purely visual changes.

## Performance

- CSS should handle layout/responsiveness before JS.
- Avoid expensive selectors across giant DOM trees.
- Minimize large-area filter/backdrop effects.

## Accessibility

- Focus styles must not be reset globally.
- Use logical properties for RTL.
- Respect reduced motion and forced colors.

## Testing

- Visual regression across breakpoints.
- Stylelint rules for tokens/specificity.
- RTL and forced-color snapshots.
- Overflow stress tests.

## Production Checklist

- Cascade layers defined.
- Token consumption enforced.
- No accidental horizontal overflow.
- z-index scale controlled.
- Focus styles protected.

## Review Heuristics

- Can you predict which rule wins without opening devtools?
- Does a component need to know its page to style correctly?
- Would markup refactoring silently break selectors?

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
