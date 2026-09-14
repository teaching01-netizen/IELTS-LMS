# Skill: Forms and Validation UX

## Purpose

Create forms that reduce user effort, prevent errors, preserve entered data, and make recovery straightforward.

## Mental Model

A form is a guided task, not a pile of fields.

## Structure

- group fields by user intent;
- reveal advanced fields only when needed;
- preserve logical tab order;
- use fieldsets/legends where group semantics matter;
- keep primary action placement predictable.

## Validation

Prefer validation timing based on error cost.

- Do not show aggressive errors before the user has had a chance to enter a value.
- Validate on blur/change when immediate correction is useful.
- Validate on submit for cross-field and server rules.
- Keep server errors attached to the relevant field or action region when possible.

## Error Messages

Good errors are:

- specific;
- actionable;
- located near the problem;
- preserved until resolved;
- also summarized when a long form needs it.

Bad: “Invalid input.”

Better: “Use an email address like name@example.com.”

## Async Submission

During submission:

- prevent accidental duplicates;
- preserve field values;
- indicate progress at the action location;
- do not replace the entire page with unrelated loading UI;
- explain failure and allow retry.

## Destructive/High-Risk Actions

Use stronger confirmation when the action is:

- irreversible;
- expensive;
- security-sensitive;
- destructive to shared data.

Do not add confirmation dialogs to every ordinary action.

## Mobile

Use appropriate input types and keyboards.

Keep the focused field and its error visible when the on-screen keyboard changes viewport space.

## Anti-Patterns

- placeholder-only labels;
- clearing the form on server failure;
- validating every keystroke with red errors;
- disabled submit buttons with no explanation;
- using toast messages as the only field-error channel;
- huge multi-column forms on narrow screens.
