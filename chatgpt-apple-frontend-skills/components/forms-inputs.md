# Skill: Forms and Inputs

## Purpose

Own text fields, text areas, selects, validation, labels, help text, error placement, autosave, and form submission behavior.

## Use This Skill When

- Building settings, authoring tools, authentication, filters, or data-entry flows.
- Users paste rich/math text.
- Validation feels noisy or fields lose work.

## Goals

- Make entry fast and forgiving.
- Preserve pasted/user-authored content.
- Associate errors with the right control.
- Handle keyboard and mobile input correctly.

## Mental Model

A form is a conversation: label → input → feedback → correction → completion. Minimize ambiguity and protect user effort.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Persistent labels beat placeholder-only labeling.
- Validation timing should help rather than punish.

## Architecture

Build `Field` composition around native inputs: label, control, description, error, optional trailing/leading affordance. Complex editors are separate components but follow the same feedback contract.

## Best Practices

- Use explicit labels and examples for format-sensitive fields.
- Validate on submit and after a field becomes meaningfully dirty; avoid aggressive red errors on first keystroke.
- Preserve selection/caret during formatting transformations.
- Respect IME composition; do not parse/transform mid-composition.
- For paste normalization, keep an undo path and avoid silent destructive conversion.
- Show autosave state quietly near the relevant document rather than with global toasts for every keystroke.
- On mobile, use correct `inputmode`, autocomplete, and virtual-keyboard-safe layout.

## Implementation Patterns

- Use schema validation for data shape and domain validation for business rules.
- Use `aria-describedby` to connect help/error content.
- Use inline validation for specific field problems and summary only for complex multi-field submit failures.

## Decision Rules

- If formatting can be inferred safely and reversibly → auto-normalize.
- If conversion could change meaning → preview or ask rather than silently rewriting.
- If an error can only be known server-side → keep the user's input and show the server message at the field/form level.

## States and Edge Cases

- Empty.
- Focused.
- Filled.
- Invalid.
- Disabled.
- Readonly.
- Loading options.
- Server error.
- IME.
- Paste.
- Autofill.
- Mobile keyboard.
- Very long value.

## Anti-Patterns

- Placeholder as label.
- Clearing input after failed submit.
- Formatting on every keypress in a way that moves caret.
- Toast-only form errors.
- Disabling submit with no explanation.

## Performance

- Debounce expensive remote validation.
- Do not rerender the entire form on each keystroke when using heavy editors.
- Lazy-load rich editor code if not immediately needed.

## Accessibility

- Every field has an accessible name.
- Errors programmatically associated.
- Focus first invalid control on submit only when helpful.
- Do not use color alone for validation.

## Testing

- Keyboard submit.
- Screen-reader label/error.
- Autofill.
- IME.
- Paste/undo.
- Mobile viewport with keyboard.
- Server validation retry.

## Production Checklist

- Labels persistent.
- Input preserved on failure.
- IME safe.
- Paste path reversible.
- Error association correct.
- Mobile keyboard tested.

## Review Heuristics

- What happens to a user's half-finished work if the request fails?
- Can a keyboard-only user complete the form?
- Does automatic formatting preserve meaning and caret?

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
