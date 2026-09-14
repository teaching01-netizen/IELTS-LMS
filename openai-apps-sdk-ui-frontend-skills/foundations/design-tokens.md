# Skill: Design Tokens

## Purpose

Use Apps SDK UI token layers correctly and keep custom UI compatible with theme
and design-system changes.

## Mental Model

The styling system conceptually has three levels:

```text
primitive variables
      ↓
semantic variables
      ↓
component variables
      ↓
UI components
```

Application UI should normally consume semantic meaning rather than raw
palette values.

## Core Principles

### Prefer semantic intent

Good:

```tsx
<div className="bg-surface text-default border-default">
```

Weak:

```tsx
<div className="bg-white text-black border-gray-200">
```

Semantic styling survives theme changes.

### Do not create aliases without meaning

Weak:

```css
--my-gray: ...;
--my-button-blue: ...;
```

Useful product tokens describe real domain concepts:

```css
--exam-score-pass: ...;
--editor-selection: ...;
--timer-warning: ...;
```

### Component APIs beat direct component-token manipulation

If a component prop expresses a supported state or variant, use it before
editing CSS variables directly.

## Decision Rules

If styling represents general UI meaning:
→ semantic token.

If styling represents one component's supported variant:
→ component prop.

If styling represents a true product concept:
→ app token can be appropriate.

If styling is a one-off arbitrary color:
→ challenge whether it is needed.

## Best Practices

- Centralize product-specific tokens.
- Name tokens by intent, not hue.
- Test tokens in both themes.
- Avoid mapping every raw Apps SDK UI primitive to a duplicate app variable.
- Do not consume private/internal token names if not part of supported styling
  contracts.
- Prefer token-backed utilities where available.

## Anti-Patterns

```css
--app-gray-1
--app-gray-2
--app-gray-3
```

when the UI really needs semantic roles such as surface, border, and secondary
text.

## Accessibility

Token usage must still produce sufficient contrast. "It is a system token" is
not proof that a custom token combination is accessible.

## Testing

Verify:

- light theme;
- dark theme;
- hover/focus/selected combinations;
- disabled/invalid states;
- text over custom product surfaces.

## Production Checklist

- [ ] semantic role used where possible
- [ ] no unnecessary palette hardcoding
- [ ] app tokens represent real product concepts
- [ ] both themes verified
- [ ] component props preferred over token overrides
