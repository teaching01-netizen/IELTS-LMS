# Skill: Async States and Feedback

## Purpose

Design asynchronous interactions that remain stable, understandable,
recoverable, and resistant to duplicate actions.

## State Model

Every async action should deliberately consider:

```text
idle
↓
pending
↓
success
or
error
```

## Loading Scope

Use the smallest loading treatment that explains what is happening.

```text
button action
→ Button loading state

small generated text
→ ShimmerText where appropriate

whole content region
→ region-level placeholder/skeleton if needed
```

Do not replace the entire page with a spinner for a local request.

## Duplicate Submission

While a mutation is pending:

- prevent accidental duplicate submits;
- preserve the user's entered data;
- communicate progress;
- avoid visually disabling unrelated controls without reason.

## Error Recovery

Errors should be:

```text
specific
local
recoverable
```

Do not wipe successful/stale content simply because a refresh failed.

## Optimistic UI

Use optimistic updates when:

- failure is uncommon;
- rollback is understandable;
- action is reversible;
- latency improvement is meaningful.

Be cautious for:

```text
payments
destructive irreversible actions
security changes
critical submissions
```

## Decision Rules

If old data is still useful during refresh:
→ keep it visible.

If a local action fails:
→ show local error and retry path.

If optimistic failure would confuse or harm:
→ wait for confirmation.

If action is pending:
→ prevent duplicate mutation at the action boundary.

## Anti-Patterns

- global spinner for local save;
- clearing form on failed submit;
- fake success before irreversible server confirmation;
- generic "Something went wrong" with no recovery;
- disabling the entire screen during one small request.

## Testing

Test:

```text
slow response
success
server error
network loss
retry
double click
navigation during pending
stale refresh failure
```
