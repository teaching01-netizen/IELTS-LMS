# Skill: Touch, Density, and Overflow

## Purpose

Make compact ChatGPT-style interfaces usable on touch devices and narrow
containers without sacrificing information hierarchy.

## Touch Target Rule

Separate:

```text
visual icon size
```

from:

```text
interactive target size
```

A small icon can live inside a comfortably sized control.

## Density

Optimize for:

```text
useful information per visual area
```

not:

```text
minimum possible pixels
```

Density is good when:

- hierarchy is obvious;
- targets remain usable;
- labels remain understandable;
- scanning remains easy.

## Overflow

Treat overflow deliberately.

Text:

```text
wrap by default
truncate only with a product reason
```

Code/tables:

```text
intentional horizontal scroll may be appropriate
```

Actions:

```text
wrap, stack, or use overflow menu based on frequency and importance
```

Do not hide important actions merely to keep one row.

## Mobile/Tablet Concerns

Check:

- touch feedback;
- safe-area insets where relevant;
- sticky elements;
- scroll containment;
- overscroll;
- virtual keyboard;
- popover collision;
- drag handles if any;
- landscape orientation.

## Decision Rules

If action is frequent/important:
→ keep it visible.

If action is rare:
→ overflow menu may be appropriate.

If one row forces tiny targets:
→ reflow instead of shrinking.

If truncation hides essential meaning:
→ wrap or provide another full-value path.

## Anti-Patterns

- 20px click targets;
- hover-only controls;
- `overflow-hidden` masking content;
- fixed desktop toolbar on narrow screens;
- icon overload with no labels;
- clipping focused controls behind sticky elements.

## Testing

Test phone-like width, tablet width, touch simulation, long labels, virtual
keyboard, zoom, and landscape layout.
