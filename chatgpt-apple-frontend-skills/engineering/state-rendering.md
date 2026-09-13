# Skill: UI State Modeling and Rendering

## Purpose

Own explicit modeling of local, async, optimistic, transient, and failure states so screens do not become contradictory.

## Use This Skill When

- Building async forms, streaming content, uploads, autosave, navigation, or multi-step interactions.
- Many booleans control rendering.
- Race conditions or stale status appear.

## Goals

- Make impossible states impossible.
- Preserve user work.
- Give immediate feedback.
- Reconcile network truth without flicker.

## Mental Model

UI is a state machine whether you model it or not. Name states and transitions explicitly before adding conditionals.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Transient UI state and server data are different concerns.
- Optimistic feedback must have a rollback/recovery path.

## Architecture

Prefer state shapes such as:

```ts
type SaveState =
  | { status: "idle" }
  | { status: "saving"; requestId: string }
  | { status: "saved"; at: number }
  | { status: "error"; error: Error; retryable: boolean };
```

Avoid `isLoading + isError + isSaved + isDirty` combinations that can contradict each other.

## Best Practices

- Separate server cache from ephemeral UI state.
- Use request identity/cancellation to prevent stale results from overwriting newer intent.
- Preserve input drafts through recoverable errors.
- Use optimistic UI for reversible low-risk actions; be more conservative for irreversible or financial actions.
- Keep streaming states distinct from loading and complete.
- Represent empty as valid data when appropriate, not automatically as error.

## Implementation Patterns

- Reducer/state machine for multi-step interactions.
- Query library for server cache lifecycle.
- Local state for open/hover/focus/draft where ownership is local.

## Decision Rules

- If states can conflict → replace booleans with a union/state machine.
- If a user action is cheap and reversible → consider optimistic update.
- If failure has serious consequence → confirm server success before presenting completion.
- If a new request supersedes an old one → cancel or ignore stale completion.

## States and Edge Cases

- Offline.
- Slow network.
- Double-submit.
- Navigation during save.
- Retry.
- Partial streaming.
- Server validation.
- Conflict with newer data.

## Anti-Patterns

- Multiple unrelated loading spinners.
- Clearing form data on failure.
- Letting stale responses overwrite current input.
- Treating empty as broken.
- Disabling the whole page for a local request.

## Performance

- Keep high-frequency ephemeral state local.
- Batch updates naturally; avoid global stores for cursor/hover.
- Stream without rerendering unrelated page regions.

## Accessibility

- Announce meaningful async status without overwhelming screen readers.
- Maintain focus on errors; do not teleport focus for background completion.
- Errors must be associated with the relevant control.

## Testing

- Race-condition tests.
- Retry and offline tests.
- Rapid duplicate action tests.
- Navigation/remount draft preservation tests.
- Screen-reader status tests for long operations.

## Production Checklist

- State model explicit.
- Stale requests handled.
- Drafts protected.
- Optimistic rollback defined.
- Empty/error/loading distinct.

## Review Heuristics

- Can any combination of flags describe nonsense?
- What happens if the same action fires twice?
- What work can the user lose if the network fails now?

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
