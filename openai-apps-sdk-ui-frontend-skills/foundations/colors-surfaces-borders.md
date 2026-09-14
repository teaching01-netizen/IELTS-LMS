# Skill: Colors, Surfaces, and Borders

## Purpose

Create clear hierarchy and containment using the design system's semantic
colors, surfaces, borders, and restrained emphasis.

## Mental Model

Color communicates:

```text
hierarchy
interaction
selection
status
danger
emphasis
```

It is not decoration by default.

## Hierarchy

Prefer a foreground hierarchy such as:

```text
primary/default content
    ↓
secondary supporting content
    ↓
tertiary metadata
```

Do not make every label equally dark.

## Surfaces

Use surfaces to explain containment, not to generate card-on-card-on-card
decoration.

Prefer:

```text
surface
├── header
├── content groups
└── actions
```

over:

```text
card
├── card
│   ├── card
│   └── card
└── card
```

## Borders

Use borders when they clarify:

- input boundaries;
- overlay boundaries;
- section separation;
- focus/selected state;
- important containment.

Do not border every small information block.

## Status Color

Status color should remain understandable without color alone. Pair color with
text, iconography, or state labels as appropriate.

## Decision Rules

If spacing alone communicates grouping:
→ do not add a border.

If a surface is already visually separate:
→ avoid another nested card.

If information is secondary:
→ reduce foreground emphasis before adding more decoration to primary content.

If an alert/status uses color:
→ ensure text/icon semantics also communicate meaning.

## Anti-Patterns

- hardcoded white/black surfaces;
- decorative gradients as default hierarchy;
- many saturated accent colors competing on one screen;
- dense nested borders;
- using subtle gray text for required critical information.

## Testing

Review with:

- light theme;
- dark theme;
- grayscale/squint test;
- high zoom;
- error/success/warning states;
- long text.

## Review Heuristics

Ask:

- Can I tell what is primary without reading every word?
- Does each border explain a relationship?
- Could one layer of surface/card be removed?
- Is color carrying information that should also exist in text or structure?
