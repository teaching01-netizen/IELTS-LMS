# Skill: Frontend Performance and Perceived Speed

## Purpose

Own runtime responsiveness, bundle discipline, rendering cost, input latency, loading sequencing, and perceived speed.

## Use This Skill When

- The app has heavy editors, long lists, charts, streaming output, or many routes.
- Interactions feel sluggish despite fast APIs.
- A polished redesign adds visual effects or bundle weight.

## Goals

- Keep input immediate.
- Render useful content early.
- Avoid unnecessary main-thread work.
- Make loading transitions stable rather than flashy.

## Mental Model

Users experience latency, not benchmarks. Optimize the path from intent → visible acknowledgement → usable completion.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Perceived speed starts with immediate local feedback.
- Measure before introducing complexity such as memoization or virtualization.

## Architecture

Budget performance by route and interaction. Separate initial-load cost, interaction cost, scroll cost, and background work.

## Best Practices

- Code-split large route-specific modules.
- Keep controlled text input paths light.
- Virtualize only genuinely long lists where DOM cost is material.
- Avoid rerendering whole page shells for local state.
- Reserve layout space for async content to reduce layout shift.
- Defer non-critical analytics/decoration.
- Use optimistic local acknowledgement for reversible actions.

## Implementation Patterns

- Profile React commits before adding memoization.
- Use web workers for CPU-heavy transformations when justified.
- Use `content-visibility` or virtualization carefully for large static regions.

## Decision Rules

- If user input lags → fix synchronous work before network optimization.
- If a dependency is large and used on one route → lazy-load it.
- If virtualization breaks accessibility or find-in-page for modest lists → prefer normal DOM.

## States and Edge Cases

- Low-end mobile.
- Background/resume.
- Slow font load.
- Huge pasted content.
- Long conversations.
- Multiple open panels.
- Streaming data.

## Anti-Patterns

- Animating expensive filters.
- Memoizing everything.
- Virtualizing short lists.
- Blocking initial render on non-critical data.
- Loading spinners that replace stable content.

## Performance

- Track INP-like interaction latency, layout shift, route load, and long tasks.
- Keep bundle budgets visible in CI when practical.

## Accessibility

- Performance optimization must not destroy semantic order or keyboard navigation.
- Skeletons need meaningful accessible status, not noisy repeated announcements.

## Testing

- Performance profile on realistic content.
- Input latency smoke test.
- Bundle diff on major PRs.
- Low-end throttling check.
- Scroll profiling.

## Production Checklist

- Critical interaction fast.
- No avoidable layout shift.
- Heavy routes split.
- No expensive decorative scroll effects.
- Performance measured with real content.

## Review Heuristics

- What is the slowest user-perceived interaction?
- Are we optimizing measured cost or aesthetic suspicion?
- Does the loading state preserve context?

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
