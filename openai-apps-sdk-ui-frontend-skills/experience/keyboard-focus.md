# Skill: Keyboard and Focus Management

## Purpose

Preserve predictable keyboard operation and focus continuity across forms,
menus, popovers, tooltips, async updates, and dynamic content.

## Mental Model

Focus is part of application state.

Users should not wonder:

```text
Where did focus go?
Why did Tab skip this?
Why did the overlay close and leave me nowhere?
```

## Core Principles

- visible `focus-visible`;
- logical DOM/tab order;
- no positive `tabIndex` choreography;
- restore focus after dismissing overlays when appropriate;
- move focus only for a concrete interaction reason;
- preserve library focus behavior for Menu/Popover.

## Overlay Rules

Menu and Popover have different keyboard models.

Do not override focus behavior just to make them visually interchangeable.

For nested overlays, test Escape handling and focus restoration at each layer.

## Dynamic Content

If async content appears:

- do not steal focus automatically unless the new content requires immediate
  interaction;
- use status/live-region patterns for important non-focus feedback where
  appropriate;
- preserve user position during background refreshes.

## Decision Rules

If an overlay is opened from a trigger:
→ expect a meaningful close/restoration path.

If focus is being moved in an effect:
→ justify exactly why.

If visual order differs greatly from DOM order:
→ fix layout/structure rather than forcing tab order.

## Anti-Patterns

- `tabIndex={1}`, `2`, `3`;
- focus ring removed;
- focus reset to document body after close;
- opening a tooltip on focus that traps focus;
- critical Menu item action available only by hover.

## Testing

Use keyboard only:

```text
Tab
Shift+Tab
Enter
Space
Escape
Arrow keys where component semantics require them
```

Test open/close, nested overlays, disabled controls, validation errors, and
post-submit behavior.
