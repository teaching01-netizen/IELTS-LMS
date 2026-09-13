# Skill: Implementation Workflow for AI / Engineering Agents

## Purpose

Define how an implementation agent should apply the skill pack without overbuilding or turning the redesign into an uncontrolled rewrite.

## Use This Skill When

- Handing this pack to another AI agent.
- Planning a design-system migration.
- Implementing a redesign while preserving product behavior.

## Goals

- Make incremental, reviewable changes.
- Preserve intended behavior.
- Build reusable foundations before polishing one page.
- Avoid speculative abstractions.

## Mental Model

Treat the redesign as a controlled systems migration: audit → tokens/primitives → high-value surfaces → adaptive/accessibility → verification.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Do not rewrite working domain logic for visual reasons.
- Every abstraction must solve a present repeated problem.

## Architecture

Recommended phases:

```text
Phase 0  audit current UI + behavior contracts
Phase 1  tokens / type / spacing / surfaces
Phase 2  core primitives
Phase 3  shell + navigation
Phase 4  feature components
Phase 5  responsive + keyboard + touch + a11y
Phase 6  non-happy states + performance
Phase 7  regression tests + design review
```

Each phase should leave the application functional.

## Best Practices

- Inventory existing components before creating replacements.
- Create compatibility wrappers only when they reduce migration risk.
- Migrate one high-value surface end-to-end to validate tokens/primitives.
- Delete obsolete styles/components after migration rather than running two systems indefinitely.
- Preserve behavior tests before visual refactor.
- Measure bundle/runtime impact of new libraries.
- Document exceptions rather than silently bypassing system rules.

## Implementation Patterns

- Use codemods only for mechanical safe changes.
- Use feature flags for large visual migrations when rollout risk matters.
- Keep design token changes isolated from unrelated feature work.

## Decision Rules

- If existing component behavior is correct but styling is inconsistent → restyle/refactor rather than rewrite.
- If three or more components repeat the same interaction mechanics → extract shared primitive/composite.
- If abstraction is needed only for hypothetical future variants → wait.
- If migration changes domain behavior unintentionally → stop and restore behavior contract.

## States and Edge Cases

- Mixed old/new UI.
- Feature flags.
- SSR/hydration.
- Third-party widgets.
- Legacy CSS specificity.
- Partial migration.
- Rollback.

## Anti-Patterns

- Big-bang rewrite.
- Introducing a new UI library for one component.
- Global CSS reset changes without regression review.
- Leaving duplicate token systems permanently.
- Refactoring backend/domain logic in the same visual PR.

## Performance

- Track bundle diffs.
- Avoid adding overlapping styling/runtime libraries.
- Profile before/after on major surfaces.

## Accessibility

- Accessibility parity is required during migration, not after.
- Do not regress semantics while replacing components.

## Testing

- Baseline behavior tests before refactor.
- Incremental visual screenshots.
- A11y scan per migrated surface.
- Rollback path for high-risk release.

## Production Checklist

- Behavior preserved.
- Foundations reused.
- Duplicate legacy code removed.
- Responsive/a11y included in each phase.
- No speculative complexity.

## Review Heuristics

- Did this change improve the system or only this screenshot?
- Can we ship after this phase?
- What old code becomes unnecessary now?

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
