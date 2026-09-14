# Skill: Theming and Dark Mode

## Purpose

Implement theme behavior using Apps SDK UI's documented theme mechanism and
avoid light-only custom styling.

## Mental Model

The document theme is expressed through `data-theme`:

```html
<html data-theme="dark">
```

or:

```html
<html data-theme="light">
```

Theme scopes may also be nested.

## Theme Helpers

Current package patterns include:

```tsx
import {
  applyDocumentTheme,
  getDocumentTheme,
  useDocumentTheme,
} from "@openai/apps-sdk-ui/theme";
```

Use package helpers instead of duplicating root-attribute observation logic.

## Core Principles

- Semantic tokens should do most theme adaptation automatically.
- Do not assume white background or black text.
- Product-specific assets and custom surfaces must be tested in both themes.
- Theme persistence belongs to application state/preferences, not random
  individual components.

## Decision Rules

If custom styling uses a semantic token:
→ prefer it over explicit `dark:` overrides.

If a product color must change between themes:
→ define a semantic/product token or deliberate theme variant.

If a nested surface intentionally uses a different theme:
→ use scoped `data-theme` only with a clear reason.

## Dark-Mode Verification

Check:

- text hierarchy;
- surface separation;
- borders;
- inputs;
- disabled controls;
- hover;
- focus;
- selected states;
- alerts;
- popovers/menus;
- code blocks;
- transparent images/icons.

## Anti-Patterns

```tsx
<div className="bg-white text-black">
```

for a normal application surface.

Other failures:

- separate hand-built dark theme disconnected from Apps SDK UI;
- only testing screenshots in light mode;
- logos/transparent images disappearing on dark surfaces;
- custom shadows that become muddy or invisible.

## Testing

At minimum:

```text
light
dark
theme switch while screen is mounted
nested overlay
focused control
disabled control
error state
```

## Production Checklist

- [ ] root theme mechanism uses documented pattern
- [ ] semantic tokens dominate normal styling
- [ ] both themes visually reviewed
- [ ] custom product colors verified
- [ ] assets work on both themes
- [ ] focus states remain visible
