# Skill: Component API Design

## Purpose

Define predictable, type-safe component contracts that stay ergonomic as the product grows.

## Use This Skill When

- Designing new reusable components.
- A component has many flags, magic defaults, or awkward callbacks.
- Teams are forking components because the API cannot express valid needs.

## Goals

- Make common usage obvious.
- Prevent invalid combinations.
- Preserve native HTML capabilities.
- Keep future extension possible without speculative abstractions.

## Mental Model

The public props of a component are a product for developers. Optimize for valid states, clear ownership, and composability.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Prefer semantic variants over styling escape hatches.
- Forward native attributes when they remain valid for the underlying element.

## Architecture

Separate behavior props, semantic variant props, content slots, and low-level escape hatches. Escape hatches should be rare and clearly named.

## Best Practices

- Use discriminated unions when variants require different props.
- Name events after user intent (`onDismiss`, `onValueChange`) rather than implementation (`onIconClick`).
- Do not expose internal DOM structure through brittle selectors as part of the API.
- Make defaults match the safest and most common product behavior.
- Prefer `children`, named slots, or subcomponents for rich composition.
- Avoid accepting raw style values for properties governed by the design system.

## Implementation Patterns

- Use `asChild`/polymorphism sparingly; semantics must remain clear.
- Use controlled values for shared state and local default values only when self-contained behavior is intended.

## Decision Rules

- If props can create an invalid state → encode the restriction in types or split APIs.
- If callers regularly need `className` hacks for a valid use case → revisit the semantic API.
- If only one caller needs a peculiar variant → do not promote it globally until the need is understood.

## States and Edge Cases

- Undefined/null.
- Async callbacks.
- Ref forwarding.
- Nested interactive content.
- Disabled vs aria-disabled.
- Form submission semantics.

## Anti-Patterns

- `primary`, `blue`, `rounded`, `shadow` as unrelated flags.
- Callback names tied to DOM implementation.
- Components that swallow native events unexpectedly.
- Styling APIs that bypass tokens.

## Performance

- API convenience should not require expensive abstraction layers.
- Avoid render-prop patterns that rerender large trees on every local state tick.

## Accessibility

- Semantics must survive polymorphism.
- Disabled behavior must be correct for keyboard and assistive tech.
- Public APIs should make accessible labels straightforward.

## Testing

- Type tests for invalid combinations.
- DOM behavior tests for forwarded attributes.
- Contract tests for callbacks and disabled behavior.

## Production Checklist

- Defaults documented.
- Invalid combinations impossible or guarded.
- Native props preserved where safe.
- Events semantic.
- Escape hatches minimal.

## Review Heuristics

- Can a developer guess the happy-path API without docs?
- Are prop names about user intent?
- Does the API expose design decisions rather than CSS implementation?

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
