# Skill: Testing Apps SDK UI Interfaces

## Purpose

Verify behavior, accessibility, layout, theme, and integration without coupling
tests to internal implementation details.

## Testing Layers

```text
type/static checks
↓
unit/component behavior
↓
accessibility checks
↓
integration/user flows
↓
responsive/theme visual review
↓
production build smoke test
```

## What to Test

### Behavior

Test what users observe:

- click/keyboard action;
- selected state;
- validation;
- loading;
- success/error;
- open/close;
- retry;
- navigation.

Avoid asserting package-internal DOM structure unless it is part of public
behavior.

### Accessibility

Test:

- accessible names;
- labels/descriptions;
- keyboard operation;
- focus restoration;
- no obvious automated accessibility violations.

### Responsive

Test representative constrained widths and long content.

### Theme

Test light and dark. Include overlays and interactive states.

### Async

Test slow responses, errors, retries, duplicate clicks, and stale data.

## Visual Regression

Use visual regression for critical compositions where subtle changes matter,
especially:

- dense toolbars;
- forms;
- menus/popovers;
- selected/focus states;
- responsive breakpoints;
- theme variants.

Do not make pixel-perfect snapshots the only proof of correctness.

## Production Build

Always include at least one production build check because Tailwind scanning and
CSS bundling can differ from development.

## Anti-Patterns

- snapshots of huge DOM trees;
- asserting internal class names;
- testing only happy path;
- desktop-only screenshots;
- no keyboard tests;
- no dark-mode tests.

## Production Checklist

- [ ] typecheck
- [ ] production build
- [ ] primary user flow
- [ ] keyboard path
- [ ] accessibility checks
- [ ] light/dark
- [ ] narrow/wide
- [ ] loading/error
- [ ] critical visual regression if needed
