# Skill: Visual Regression and State Matrix

## Purpose

Own screenshot-based verification across themes, states, content stress, and widths.

## Use This Skill When

- Maintaining a high-polish design system.
- Refactoring CSS/tokens.
- Preventing subtle spacing/focus/overflow regressions.

## Goals

- Detect unintended visual drift.
- Review all important states, not only happy desktop.
- Make design QA repeatable.

## Mental Model

A screenshot is useful only if the state is intentional and deterministic. Build a small state matrix that represents actual visual risk.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Capture interactions states deliberately.
- Do not approve noisy diffs blindly.

## Architecture

Each component/page gets representative stories across variant, state, theme, and width. Prioritize combinational risk rather than exhaustive Cartesian explosion.

## Best Practices

- Capture default, hover/focus where tooling allows, selected, disabled, loading, error, and long-content states where relevant.
- Capture light/dark and narrow/wide for major layout components.
- Freeze dates, random IDs, animations, and network timing.
- Include Thai/long-string fixtures for text-heavy surfaces.
- Review pixel diffs together with DOM/behavior tests.

## Implementation Patterns

- Golden stories in Storybook-like environment.
- Page-level screenshots for shell/layout interaction.
- PR diff artifacts grouped by component.

## Decision Rules

- If change is a token change → review representative components across all roles.
- If change touches layout primitives → broaden screenshot coverage.
- If diff is due to nondeterminism → fix determinism rather than raising thresholds.

## States and Edge Cases

- Font fallback.
- Scrollbar differences.
- Animation.
- Locale.
- Dark mode.
- Narrow viewport.
- High DPI differences.

## Anti-Patterns

- Huge screenshot suite with no ownership.
- Approving thousands of diffs after global CSS change without inspection.
- Only desktop screenshots.
- Ignoring focus states.

## Performance

- Keep suite representative.
- Parallelize capture.
- Avoid rendering every permutation unless risk justifies it.

## Accessibility

- Include visible focus and high-contrast checks beyond pixel snapshots.
- Visual regression cannot verify semantics.

## Testing

- Token-change broad review.
- Responsive widths.
- Long strings.
- Dark mode.
- Focus selected states.

## Production Checklist

- Fixtures deterministic.
- State matrix documented.
- High-risk global changes reviewed broadly.
- No silent baseline churn.

## Review Heuristics

- What visual failure would users notice but behavior tests miss?
- Are our fixtures representative of real stress?
- Did we inspect the diff or merely bless it?

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
