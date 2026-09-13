# Skill: Design Tokens

## Purpose

Own the token architecture that converts visual decisions into stable, semantic, themeable frontend primitives.

## Use This Skill When

- Creating a design system.
- Replacing scattered hard-coded colors/spacing/radii.
- Supporting light/dark themes.
- Building components that should be reskinned without rewriting CSS.

## Goals

- Separate raw values from semantic usage.
- Keep component code free from arbitrary visual literals.
- Allow theme evolution without feature churn.
- Make design review traceable to named roles.

## Mental Model

A token is a **decision boundary**, not just a constant. Primitive tokens describe available values. Semantic tokens describe intent. Component tokens describe controlled exceptions.

## Core Principles

- Feature code consumes semantic tokens, not palette numbers.
- Keep the scale small enough to learn.
- Do not create a token for every one-off value.
- Name by role, not appearance.
- Aliases should flow one direction: primitive → semantic → component.

## Architecture

```text
primitive
  color.neutral.0
  color.neutral.1000
  space.1
  radius.md
      ↓
semantic
  surface.canvas
  surface.raised
  text.primary
  border.subtle
  action.primary
      ↓
component
  button.primary.bg
  sidebar.item.selected.bg
```

CSS custom properties should expose semantic tokens at the runtime theme boundary.

## Best Practices

- Use numeric scales for primitives and role names for consuming tokens.
- Keep typography tokens split into family, size, line-height, weight, and tracking when independent adjustment matters.
- Provide motion duration/easing tokens instead of literal transitions in component CSS.
- Represent focus ring, border width, overlay opacity, and elevation as tokens.
- Document which tokens are public design-system API and which are internal.
- Version breaking semantic changes just like code APIs.

## Implementation Patterns

- Expose semantic CSS variables on `:root` and theme scopes.
- Prefer component tokens only when a component cannot cleanly map to shared semantic roles.
- Use TypeScript token names or generated types when tokens are also consumed in JS.

## Decision Rules

- If a value describes *what it is used for* → semantic token.
- If it describes a reusable raw step → primitive token.
- If only one component needs a special case and the distinction is intentional → component token.
- If two raw values are visually close and not semantically distinct → consolidate.

## States and Edge Cases

- Light/dark.
- High contrast.
- Compact density.
- Touch density.
- Brand accent changes.
- Nested theme scopes.
- System forced colors.

## Anti-Patterns

- Components reading `--blue-500` directly.
- Tokens named after current appearance like `light-gray-text`.
- Twenty near-identical spacing steps.
- Duplicating semantic tokens per component without need.
- Changing token meaning silently.

## Performance

- CSS variables keep theme switching cheap.
- Avoid JS-driven theme recalculation for ordinary styling.
- Generate static token artifacts at build time when possible.

## Accessibility

- Semantic color tokens must preserve contrast across themes.
- Focus tokens cannot disappear in dark mode or forced-colors mode.
- Density tokens cannot shrink interactive targets below usable sizes.

## Testing

- Snapshot generated token output.
- Contrast-test semantic foreground/background pairs.
- Theme-switch component stories.
- Lint direct raw palette usage in feature CSS.

## Reference Implementation

```css
:root {
  --color-neutral-0: #fff;
  --color-neutral-1000: #0f0f10;

  --surface-canvas: var(--color-neutral-0);
  --surface-raised: color-mix(in srgb, var(--color-neutral-0) 96%, var(--color-neutral-1000));
  --text-primary: var(--color-neutral-1000);
  --text-secondary: color-mix(in srgb, var(--text-primary) 62%, transparent);
  --border-subtle: color-mix(in srgb, var(--text-primary) 12%, transparent);

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;

  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;

  --motion-fast: 120ms;
  --motion-standard: 180ms;
  --ease-out: cubic-bezier(.2,.8,.2,1);
}
```

## Production Checklist

- Primitive scale defined.
- Semantic roles defined.
- No direct feature literals for governed values.
- Dark theme parity.
- Focus and status colors reviewed.
- Token naming documented.

## Review Heuristics

- Can a designer explain a token by role without quoting its hex value?
- Can the accent color change without editing feature components?
- Are two tokens truly different decisions or accidental duplication?

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
