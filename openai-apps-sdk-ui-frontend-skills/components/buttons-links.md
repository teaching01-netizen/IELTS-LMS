# Skill: Buttons and Links

## Purpose

Implement actions and navigation using Apps SDK UI button/link components with
clear hierarchy and correct states.

## Button Mental Model

Use `Button` for actions.

Current Button concepts include:

```text
color
variant
size
gutterSize
iconSize
pill
uniform
block
disabled
inert
loading
selected
optical alignment
```

Verify exact installed props before implementation.

## Action Hierarchy

A view should rarely contain several equally prominent primary actions.

Prefer:

```tsx
<div className="flex gap-2">
  <Button color="primary">Save</Button>
  <Button variant="soft" color="secondary">Cancel</Button>
</div>
```

## Loading

Use built-in loading behavior when available:

```tsx
<Button loading={isSaving}>Save</Button>
```

The current component prevents interaction by default during loading through
its inert behavior unless explicitly overridden.

## Disabled vs Inert

```text
disabled
→ action unavailable
→ visual disabled treatment appropriate

inert
→ interaction blocked
→ appearance may intentionally remain normal
```

Do not conflate them.

## Icon-Only Buttons

Use an accessible name:

```tsx
<Button aria-label="Delete item" uniform>
  <Delete />
</Button>
```

Do not rely on tooltip text as the accessible name.

## Links

Use `TextLink`/link-oriented components for navigation.

Current TextLink behavior includes:

- normal link semantics;
- router integration;
- external-link handling;
- underline/primary styling options.

Do not implement navigation with clickable spans.

## Decision Rules

If it mutates state:
→ Button.

If it navigates:
→ link component.

If action is destructive:
→ use clear language and appropriate danger treatment.

If icon-only meaning is not obvious:
→ accessible name + optional tooltip.

## Anti-Patterns

- three primary buttons side by side;
- button for navigation;
- link for submit/mutation;
- manual spinner layered over a button;
- tiny icon hit targets;
- disabled state implemented only with opacity.

## Testing

Verify:

- keyboard activation;
- loading duplicate-submit prevention;
- disabled/inert distinction;
- focus-visible;
- long labels;
- block/full-width layout;
- link routing and external behavior.
