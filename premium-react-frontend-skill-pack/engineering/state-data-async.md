# Skill: UI State, Data, and Async Behavior

## Purpose

Design state ownership and async transitions so the UI feels immediate, stable, understandable, and recoverable.

## State Categories

Distinguish:

- server state;
- URL/navigation state;
- form state;
- component interaction state;
- ephemeral visual state;
- derived state.

Do not put every kind of state into one global store.

## Principles

- Derive what can be derived.
- Preserve server-state semantics such as stale/fresh/error/retry.
- Keep URL-worthy state in the URL when users should share, reload, or navigate it.
- Keep temporary interaction state local.
- Prevent duplicate submissions.
- Prefer explicit transition states over ambiguous booleans.

## Async UX Model

For an async action, define:

```text
idle
→ pending
→ success | error
→ recover / retry / continue
```

Decide whether optimistic updates are safe.

### Optimistic UI

Use when:

- failure is uncommon;
- rollback is understandable;
- the action is reversible or low-risk;
- immediate feedback materially improves flow.

Avoid for high-risk financial, destructive, or legally significant actions unless the confirmation model is carefully designed.

## Loading

Prefer preserving existing content during refresh when possible.

Use skeletons when the structure is known and waiting would otherwise leave a blank unstable region.

Use spinners for compact indeterminate operations, not entire page composition.

## Error Recovery

Errors should answer:

- what failed;
- whether user data was preserved;
- what the user can do next;
- whether retry is available.

## Anti-Patterns

- replacing the whole page with a spinner for minor refetches;
- clearing useful content during refresh;
- optimistic deletion with no rollback strategy;
- multiple independent booleans that allow impossible state combinations;
- storing derived values and then synchronizing them with effects.
