# Skill: CSS Architecture for Premium Interfaces

## Purpose

Structure CSS so visual behavior remains predictable, responsive, accessible, and easy to evolve.

## Mental Model

CSS is a dependency system involving:

- cascade;
- specificity;
- inheritance;
- formatting contexts;
- stacking contexts;
- intrinsic sizing;
- overflow;
- containment;
- media/container conditions;
- user preferences.

Treat it as architecture, not decoration.

## Core Rules

- Keep specificity intentionally low.
- Prefer classes/data attributes over deeply nested selectors.
- Use semantic custom properties.
- Prefer parent-owned layout via grid/flex/gap.
- Use logical properties when they improve internationalization.
- Use container queries when a component’s behavior depends on its own available space.
- Use media queries for viewport/environment concerns.
- Avoid fixed dimensions around dynamic content unless the dimension is part of the interaction contract.

## State Styling

Prefer explicit state hooks:

```css
.control[data-state="open"] { ... }
.control[data-invalid="true"] { ... }
.control:focus-visible { ... }
```

Avoid brittle selectors based on distant DOM structure.

## Layering

Define an explicit stacking model for:

- base content;
- sticky regions;
- dropdowns/popovers;
- dialogs;
- toasts;
- critical system overlays.

Avoid arbitrary `z-index: 999999`.

## Animation

Prefer transform/opacity for smooth visual transitions.

Avoid animating layout-heavy properties when the same result can be achieved without repeated reflow.

Respect `prefers-reduced-motion`.

## Responsive CSS

Start with intrinsic behavior where possible:

- `minmax()`;
- `clamp()`;
- flexible grid tracks;
- wrapping clusters;
- `max-inline-size`;
- container queries.

Use breakpoints when the interaction/layout model actually changes.

## Anti-Patterns

- `!important` as routine architecture;
- page-wide descendant selector chains;
- magic numbers repeated everywhere;
- hiding overflow to mask bugs;
- arbitrary negative margins;
- brittle nth-child layout logic;
- fixed pixel widths for all text containers;
- duplicated dark-mode selector trees.
