# Skill: Loading, Empty, Error, Offline, and Partial States

## Purpose

Own all non-happy-path surfaces and the continuity between them.

## Use This Skill When

- Any feature fetches, streams, uploads, saves, or may contain no data.
- A product shows generic spinners or blank screens.
- Errors replace user context.

## Goals

- Keep layout stable.
- Tell users what they can do next.
- Distinguish no-data from failure.
- Preserve previously useful content when refreshing.

## Mental Model

Non-happy states are normal product states, not exceptions. Design them with the same hierarchy as success.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Do not replace useful stale content with a spinner during background refresh.
- Errors should offer recovery when possible.

## Architecture

Each data region defines initial loading, refreshing, empty-valid, partial, error-recoverable, error-blocking, and offline behavior.

## Best Practices

- Use skeletons only when they approximate stable final geometry.
- Prefer inline progress for local operations.
- Keep last-known content visible during background refresh unless stale content is unsafe.
- Empty state copy should explain what belongs here and offer the next useful action.
- Error messages should be specific enough to choose a response without exposing internals.
- Partial success should render what is available and identify what failed.

## Implementation Patterns

- State boundary per meaningful region.
- Retry control near the failure.
- Offline indicator persistent but nonblocking when cached work remains possible.

## Decision Rules

- If content is already available → refresh in place.
- If first load has known structure → skeleton may help.
- If duration is tiny/unknown and layout is simple → avoid flashing spinner.
- If empty is expected → treat it as content, not error.

## States and Edge Cases

- First load.
- Background refresh.
- Offline.
- Partial data.
- Permission denied.
- Timeout.
- Rate limit.
- Retry succeeds.
- Long-running stream.

## Anti-Patterns

- Full-page spinner for local request.
- Blank empty state.
- Generic 'Something went wrong' with no recovery.
- Skeletons that do not match final layout.
- Clearing useful data during refresh.

## Performance

- Avoid expensive skeleton animation across large pages.
- Do not start many duplicate requests from remount churn.

## Accessibility

- Loading/status announcements restrained.
- Retry buttons named.
- Errors not conveyed by color only.
- Skeletons ignored by assistive tech when decorative.

## Testing

- Slow network.
- Offline.
- Retry.
- Partial response.
- Cached/stale content.
- Screen-reader announcement.

## Production Checklist

- Every region defines non-happy states.
- Retry available when meaningful.
- Useful content preserved.
- Empty actionable.
- No spinner flicker.

## Review Heuristics

- What does the user see if the network disappears mid-task?
- Can they keep working?
- Does the failure state preserve enough context to recover?

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
