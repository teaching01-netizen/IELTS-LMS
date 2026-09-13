# Skill: Feedback, Status, Toasts, Progress, and Undo

## Purpose

Own how the UI acknowledges actions, communicates background work, errors, completion, and reversible changes.

## Use This Skill When

- Adding save confirmations, sync state, uploads, background jobs, destructive undo, or errors.
- The app uses toasts for everything.

## Goals

- Place feedback near the action when possible.
- Avoid notification fatigue.
- Make long-running state understandable.
- Prefer recovery over blame.

## Mental Model

Feedback should answer: did my action register, what is happening now, did it work, and what can I do if it did not?

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Local feedback beats global toast for local problems.
- Success should often be quiet.

## Architecture

Use inline state for field/component feedback, persistent status for ongoing document/system state, toast for transient cross-context confirmation, and dialog only for blocking decisions.

## Best Practices

- Acknowledge clicks immediately through pressed/pending state.
- Use toast for low-risk, transient, nonessential messages.
- Use inline error when the user must act in a specific place.
- Use undo for reversible destructive actions instead of repeated confirmation.
- Progress indicators should be determinate when real progress is known.
- Do not show and hide success so quickly that users cannot perceive it.

## Implementation Patterns

- Central toast queue with deduplication.
- Inline async status component with `aria-live` used sparingly.
- Undo action retains enough state for restoration.

## Decision Rules

- If the user must fix something → inline.
- If completion is expected and visually evident → no toast needed.
- If destructive action is reversible → optimistic remove + undo.
- If operation exceeds a few seconds → show persistent progress/status.

## States and Edge Cases

- Multiple simultaneous jobs.
- Offline.
- Retry.
- Undo expiration.
- Background success after navigation.
- Screen-reader announcement queue.

## Anti-Patterns

- Toast for validation errors.
- Success toast after every autosave.
- Infinite spinner with no context.
- Error message with no recovery action.
- Announcements on every tiny background state change.

## Performance

- Deduplicate repeated notifications.
- Avoid mounting complex toast trees for frequent autosaves.

## Accessibility

- Use polite live regions for important asynchronous state.
- Do not steal focus for non-blocking notifications.
- Provide text, not color alone.

## Testing

- Announcement behavior.
- Toast queue/dedupe.
- Undo timing.
- Offline retry.
- Long-running progress.

## Production Checklist

- Feedback locality correct.
- No toast spam.
- Recovery actions present.
- Announcements restrained.
- Undo reliable.

## Review Heuristics

- Could the user see the result without a notification?
- If an error appears, is the next action obvious?
- Are we announcing too much to assistive technology?

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
