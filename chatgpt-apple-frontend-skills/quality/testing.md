# Skill: Frontend Testing Strategy

## Purpose

Own the testing pyramid for components, interaction contracts, accessibility, async states, and feature workflows.

## Use This Skill When

- Defining CI coverage.
- Adding a new design-system component.
- Refactoring UI without changing behavior.
- Bugs repeatedly escape in edge states.

## Goals

- Test behavior rather than implementation.
- Cover state transitions and failure paths.
- Protect accessibility contracts.
- Keep tests fast enough to run routinely.

## Mental Model

The most valuable UI tests exercise what users can observe and do. Internal class names and component implementation are weak contracts.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Critical user flows deserve integration tests.
- Visual tests complement behavior tests; they do not replace them.

## Architecture

Use unit tests for pure logic, component tests for interactive contracts, integration tests for feature flows, and a small number of end-to-end tests for critical journeys.

## Best Practices

- Query elements by role/name rather than class selectors.
- Test keyboard interaction for complex widgets.
- Test loading/error/retry, not only success.
- Include long content and narrow viewport cases where behavior changes.
- Mock network at the boundary, not deep implementation internals.
- Keep visual regression state stories deterministic.

## Implementation Patterns

- Reusable test helpers for keyboard, viewport, and async states.
- Contract suite for every primitive family.

## Decision Rules

- If a bug is behavioral and user-visible → add a regression test at the lowest meaningful level.
- If a test breaks during harmless refactor → it is probably coupled to implementation.
- If behavior depends on real browser layout/focus → use browser component/E2E testing.

## States and Edge Cases

- Race conditions.
- Retry.
- Focus restoration.
- IME where testable.
- Responsive collapse.
- Optimistic rollback.
- Unmount/remount.

## Anti-Patterns

- Snapshotting huge DOM trees.
- Testing internal state directly.
- E2E for every tiny variant.
- Ignoring keyboard because click test passes.

## Performance

- Keep most tests below full E2E.
- Parallelize expensive browser tests.
- Avoid arbitrary sleeps.

## Accessibility

- Automated accessibility checks at component and critical-page level.
- Manual checks still required for semantics and usability.

## Testing

- Primitive contracts.
- Feature integration.
- Critical E2E.
- A11y automation.
- Responsive behavior.
- Failure paths.

## Production Checklist

- Critical flows covered.
- No arbitrary sleeps.
- Queries user-centric.
- Failure states tested.
- Keyboard covered.

## Review Heuristics

- Would this test still pass after internal refactor?
- Does it prove a user-visible contract?
- Which failure path is currently untested?

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
