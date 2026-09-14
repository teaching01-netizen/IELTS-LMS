# Skill: Accessibility

## Purpose

Ensure composition of Apps SDK UI components remains accessible even when the
underlying primitives provide strong defaults.

## Mental Model

A component library can provide accessible building blocks. The application can
still break accessibility through poor composition.

Verify:

```text
semantics
keyboard
focus
names
roles
relationships
contrast
motion
zoom
touch
```

## Native Semantics

Prefer native elements before ARIA recreation.

```text
action      → button
navigation  → anchor/link
heading     → heading
list        → list
form label  → label
```

Do not attach click behavior to `div` for convenience.

## Accessible Names

Every interactive control needs a name.

Icon-only example:

```tsx
<Button aria-label="Delete item" uniform>
  <Delete />
</Button>
```

Tooltip text is not a substitute for a proper accessible name.

## Form Relationships

Associate:

```text
label ↔ control
description ↔ control
error ↔ control
group label ↔ group
```

## Color

Do not communicate state using color alone.

## Zoom and Reflow

At increased browser zoom:

- content should remain usable;
- controls should not overlap;
- critical text should not disappear;
- horizontal scrolling should be intentional, not accidental.

## Motion

Respect reduced-motion preferences. Essential information must not depend on
animation.

## Decision Rules

If native semantics can express behavior:
→ use them.

If an ARIA role is being added to a div:
→ first ask whether the native element would be simpler.

If a visual requirement removes focus indication:
→ change the visual requirement.

## Anti-Patterns

- removing outlines globally;
- placeholder-only labels;
- hover-only essential actions;
- icon-only mystery buttons;
- color-only errors;
- inaccessible nested interactive controls.

## Testing

At minimum:

- keyboard-only pass;
- screen-reader spot check for critical flows;
- automated accessibility checks;
- zoom/reflow;
- dark-mode contrast;
- touch target review.

## Production Checklist

- [ ] semantic elements used
- [ ] all controls named
- [ ] labels/errors associated
- [ ] keyboard flow complete
- [ ] focus visible
- [ ] no hover-only critical behavior
- [ ] color not sole signal
- [ ] zoom/reflow usable
- [ ] reduced motion supported
