# Skill: Responsive and Adaptive UX

## Purpose

Make interfaces work intentionally across desktop, laptop, tablet, foldable, and phone-sized spaces without treating smaller screens as compressed desktop.

## Mental Model

Responsive design is behavior adaptation, not only pixel adaptation.

For every region ask:

- what must remain visible;
- what may move;
- what may collapse;
- what may become scrollable;
- what may move into overflow;
- what interaction changes on touch;
- what requires a different composition entirely.

## Priority Model

Classify content/actions:

1. essential now;
2. important but deferrable;
3. secondary/reference;
4. rare/advanced.

Narrow layouts should preserve priority, not merely shrink everything.

## Common Transformations

```text
wide split pane    → stacked sections / switcher / drawer
large toolbar      → core actions + overflow
sidebar nav        → drawer / compact nav
wide data table    → responsive row cards / horizontal strategy
multi-column form  → single column
persistent detail  → drill-in detail view
```

## Tablet

Tablet deserves its own thought process.

It may have:

- touch input;
- desktop-like width;
- split-screen multitasking;
- portrait and landscape changes;
- external keyboard or trackpad.

Do not assume “tablet = large phone.”

## Touch

- increase hit areas;
- avoid hover dependence;
- allow comfortable spacing around destructive/adjacent actions;
- ensure drag handles are discoverable and large enough;
- provide non-drag alternatives when dragging is essential to completion.

## Testing Matrix

Test:

- narrow phone portrait;
- common phone landscape if relevant;
- tablet portrait;
- tablet split view;
- laptop width;
- very wide desktop;
- 200% zoom.

## Anti-Patterns

- hiding essential actions because width is narrow;
- horizontally scrolling an entire page because one component is too wide;
- tiny text on mobile;
- fixed sidebars that consume half the viewport;
- drag-only resize affordances with tiny handles;
- breakpoint-by-device-name architecture.
