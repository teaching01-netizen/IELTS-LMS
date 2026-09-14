# Skill: Forms and Text Inputs

## Purpose

Build accessible forms with `Input`, `Textarea`, labels, descriptions,
validation, and robust async submission behavior.

## Input Concepts

Current `Input` supports concepts such as:

```text
variant
size
gutterSize
startAdornment
endAdornment
disabled
invalid
autoSelect
autofill-extension behavior
optical alignment
```

Use built-in adornment APIs instead of absolute-position hacks.

## Form Anatomy

```text
label
↓
optional help/description
↓
control
↓
validation/error
```

Example:

```tsx
<label htmlFor="email">Email</label>

<Input
  id="email"
  invalid={Boolean(error)}
  aria-describedby={error ? "email-error" : undefined}
/>

{error && (
  <p id="email-error" className="text-sm text-danger">
    {error}
  </p>
)}
```

The design system can provide visual invalid state, but the application still
owns meaningful error text and semantic relationships.

## Placeholder Rule

Placeholder is an example/hint, not a durable label.

Do not rely on:

```tsx
<Input placeholder="Email" />
```

as the only identification when a visible/programmatic label is needed.

## Adornments

Good:

```tsx
<Input
  startAdornment={<SearchIcon />}
  endAdornment={<ClearButton />}
/>
```

Prefer documented spacing props before negative-margin or absolute-position
customizations.

## Validation Timing

Choose based on task:

- on submit for complex validation;
- on blur for field-level feedback;
- on change after a field has already been invalid;
- immediate only when feedback truly helps.

Avoid showing errors before the user has had a reasonable chance to enter data.

## Decision Rules

Short one-line text:
→ Input.

Long freeform text:
→ Textarea.

Structured fixed options:
→ selection control, not text input.

If validation error exists:
→ visual invalid state + explanatory text.

If a form submits asynchronously:
→ model pending and retry behavior.

## Edge Cases

Cover:

- empty;
- whitespace-only;
- very long input;
- pasted content;
- autofill;
- IME/composition;
- disabled;
- read-only if applicable;
- server validation;
- lost network;
- duplicate submit.

## Anti-Patterns

- placeholder-only labels;
- validation by red border alone;
- disabling paste;
- clearing user input after server error;
- absolute-position adornments when component APIs exist.

## Testing

- keyboard tab order;
- screen-reader label relationship;
- invalid announcement/association;
- long values;
- autofill;
- paste;
- submit pending/error/retry.
