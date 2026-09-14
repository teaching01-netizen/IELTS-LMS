# Skill: Design Tokens and Theme System

## Purpose

Create the visual foundation that lets the product stay coherent while still supporting light/dark themes, responsive density, component variants, and future iteration.

## Mental Model

Separate raw values from semantic roles.

```text
raw palette / scale
      ↓
semantic roles
      ↓
component tokens
      ↓
component styles
```

Components should mostly consume semantic roles, not hard-coded values.

## Token Families

Use a deliberately small system for:

- color;
- typography;
- spacing;
- radii;
- border widths;
- elevation;
- motion duration/easing;
- z-index layers;
- breakpoints or container thresholds;
- control heights;
- icon sizes;
- content widths.

## Example

```css
:root {
  --surface-canvas: #fff;
  --surface-raised: #fff;
  --surface-muted: #f6f7f8;

  --text-primary: #161719;
  --text-secondary: #5f6368;
  --text-disabled: #9aa0a6;

  --border-subtle: color-mix(in srgb, currentColor 10%, transparent);
  --border-strong: color-mix(in srgb, currentColor 20%, transparent);

  --action-primary: #246bfd;
  --focus-ring: #5b8cff;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
}
```

Exact values are product-specific; the important pattern is semantic ownership.

## Theme Rules

- Theme the semantic layer, not every component independently.
- Avoid dark mode built by inverting colors.
- Re-evaluate elevation, contrast, borders, and imagery per theme.
- Ensure interactive states remain distinguishable in every theme.
- Avoid a theme API that leaks dozens of arbitrary component internals.

## Component Tokens

Introduce component tokens only when a component genuinely needs local semantic decisions.

Example:

```css
.button {
  --button-bg: var(--action-primary);
  --button-fg: var(--text-on-action);
  --button-radius: var(--radius-md);
}
```

Do not create component tokens for values that are already clear shared roles.

## Decision Rules

If the same literal value appears repeatedly but serves different semantic roles → do not merge solely because the value matches today.

If two roles must change together across all themes → consider one semantic token.

If a component requires many one-off theme overrides → the semantic token layer is probably missing the right roles.

If every component introduces its own radius and spacing scale → stop and simplify.

## Anti-Patterns

- `--blue-500` directly in product components;
- dozens of indistinguishable grays;
- per-page theme constants;
- random radii;
- shadows copied from design files without elevation meaning;
- hard-coded z-index values scattered across CSS;
- separate dark-mode overrides for every selector.

## Testing

Verify:

- light and dark themes;
- high contrast needs;
- focus visibility;
- disabled state contrast;
- token fallback behavior;
- component screenshots across themes;
- no unreadable foreground/background token pairings.
