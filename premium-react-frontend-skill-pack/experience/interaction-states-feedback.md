# Skill: Interaction States and Feedback

## Purpose

Make controls and workflows feel responsive, understandable, and premium by defining every meaningful state and transition.

## State Model

For each interactive component consider:

- default;
- hover;
- focus-visible;
- pressed/active;
- selected/toggled;
- disabled;
- loading;
- success;
- warning;
- error;
- read-only;
- drag/resize states if relevant.

Only implement states that apply, but never leave important states undefined.

## Feedback Timing

Immediate feedback should occur as close as possible to the user action.

Examples:

- button depresses immediately;
- selected item updates immediately;
- drag handle visibly activates at pointer down;
- save action shows pending state at the save control;
- validation appears next to the field.

## Hover

Hover may enrich discoverability but must not carry essential meaning.

Avoid large layout changes on hover.

## Pressed

Pressed state should feel tactile but restrained.

Use slight visual compression/tonal shift rather than dramatic movement.

## Focus

Focus-visible treatment should be easy to locate, not a barely visible shadow.

Do not make focus look identical to hover.

## Disabled

Use disabled only when the action genuinely cannot be performed.

If a user needs to understand why, provide an explanation nearby or on interaction when appropriate.

## Success Feedback

Avoid unnecessary celebration for routine actions.

Small acknowledgement is often enough:

- state change;
- check indicator;
- inline confirmation;
- subtle toast for non-local events.

## Anti-Patterns

- all feedback routed to toasts;
- controls with no pressed state;
- hover as the only indication of clickability;
- disabled buttons with invisible reason;
- success animation that blocks the next task;
- changing control size between states.
