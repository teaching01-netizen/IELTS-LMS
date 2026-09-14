# Skill: Feedback, Status, and Empty States

## Purpose

Use `Alert`, `Badge`, `Indicator`, `EmptyMessage`, and related patterns to
communicate state at the correct information density.

## Component Roles

### Alert

Use for feedback requiring attention:

```text
success
warning
error
important information
```

Current Alert patterns support title, description, indicator, actions, and
action placement.

### Badge

Use for compact status/category metadata:

```text
Draft
Active
Beta
Admin
Paid
```

Do not put a paragraph inside a badge.

### Indicator

Use for lightweight status indication where surrounding context already
explains meaning.

### EmptyMessage

Use for meaningful absence.

A strong empty state answers, when relevant:

```text
What happened?
Why is there nothing here?
What can I do next?
```

## Decision Rules

If user attention is required:
→ Alert.

If state is compact metadata:
→ Badge.

If the visual status signal is tiny and contextual:
→ Indicator.

If a collection/result has no content:
→ EmptyMessage.

If an error blocks only one region:
→ show local feedback near that region rather than replacing the whole screen.

## Error Writing

Weak:

```text
Something went wrong.
```

Better, when known:

```text
Couldn't update the reservation.
Your existing reservation is unchanged.
Try again.
```

Be specific, local, and recoverable.

## Anti-Patterns

- alert for routine metadata;
- badge for long sentences;
- status conveyed only by color;
- full-page error for a small local request;
- empty state with no explanation or next action when one exists.

## Testing

Check:

- light/dark contrast;
- screen reader text;
- long messages;
- multiple actions;
- narrow layout;
- retry behavior;
- empty state transition after data appears.
