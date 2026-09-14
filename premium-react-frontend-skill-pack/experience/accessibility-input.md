# Skill: Accessibility, Keyboard, Pointer, and Touch

## Purpose

Ensure every important workflow is perceivable, operable, understandable, and robust across input methods and assistive technologies.

## Principles

- Prefer native semantics.
- Use ARIA to fill semantic gaps, not to recreate native elements unnecessarily.
- Preserve visible focus.
- Ensure keyboard order follows interaction and reading order.
- Avoid hover-only content for essential tasks.
- Provide accessible names for icon-only controls.
- Associate labels, descriptions, errors, and fields correctly.
- Ensure target sizes are usable on touch.
- Never communicate important state with color alone.

## Focus

Focus is part of navigation state.

Manage it explicitly when:

- opening/closing modal dialogs;
- adding/removing major regions;
- changing steps in a wizard;
- navigating complex composite widgets.

Restore focus to a sensible origin after overlays close.

## Keyboard

Use expected keyboard behavior for complex widgets rather than inventing new patterns.

Do not make every element tabbable inside widgets where roving focus or native semantics are more appropriate.

## Reduced Motion

Respect user preference.

Reduced motion should remove or greatly simplify non-essential spatial transitions while preserving necessary feedback.

## Zoom/Reflow

At high zoom:

- content must remain operable;
- essential controls cannot become unreachable;
- text must not overlap;
- fixed regions must not consume the whole viewport.

## Anti-Patterns

- click handlers on non-interactive elements;
- removing outlines globally;
- hidden focus behind sticky headers;
- keyboard traps;
- custom select widgets without full keyboard behavior;
- tooltips as the only accessible name;
- contrast sacrificed for “subtle” aesthetics.

## Testing

At minimum:

- tab through the workflow;
- test Shift+Tab;
- test escape/dismiss behavior;
- test screen-reader naming relationships where relevant;
- test touch target usability;
- test reduced motion;
- test zoom/reflow.
