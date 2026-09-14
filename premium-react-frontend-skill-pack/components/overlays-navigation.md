# Skill: Overlays, Navigation, Menus, and Layered UI

## Purpose

Build dialogs, popovers, menus, tooltips, drawers, sidebars, and navigation systems with correct focus, layering, dismissal, and responsive behavior.

## Mental Model

An overlay is not just a floating box. It changes interaction scope.

## Dialogs

Dialogs require:

- semantic dialog role/behavior;
- focus entry;
- focus containment when modal;
- escape handling when dismissible;
- focus restoration;
- background interaction prevention when modal;
- sensible scroll behavior;
- clear title and action hierarchy.

Do not use a modal for content that users need to reference while working in the underlying page.

## Popovers and Menus

Anchor visually and spatially to the invoking control.

Handle:

- viewport collision;
- keyboard navigation;
- outside interaction;
- escape;
- focus return;
- touch devices;
- long content.

## Tooltips

Use tooltips for concise supplementary explanations, not essential instructions.

Tooltips must not be the only way to discover critical functionality.

## Responsive Navigation

Desktop sidebar behavior should not automatically become the mobile behavior.

At narrow widths choose intentionally between:

- drawer;
- bottom navigation;
- compact top navigation;
- prioritized actions + overflow.

Preserve location awareness and current selection.

## Scroll and Layering

Avoid nested scroll traps.

A drawer/dialog should define whether:

- page scroll is locked;
- the overlay body scrolls;
- headers/footers remain sticky;
- safe-area insets are respected.

## Anti-Patterns

- dropdown menus clipped by parent overflow;
- dialogs wider than the device with fixed pixel widths;
- focus lost after close;
- several overlay systems with conflicting z-index rules;
- tooltips containing forms or major workflows;
- drawers that cover their own close affordance on small screens.
