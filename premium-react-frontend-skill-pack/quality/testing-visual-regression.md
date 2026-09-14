# Skill: Frontend Testing and Visual Regression

## Purpose

Verify behavior, accessibility, responsiveness, and visual consistency without turning tests into implementation-detail locks.

## Test Layers

Use the smallest useful layer:

- unit tests for pure logic;
- component tests for interaction/state behavior;
- integration tests for feature flows;
- end-to-end tests for critical journeys;
- visual regression for appearance/state coverage;
- accessibility checks for common violations plus manual keyboard review.

## Component Test Targets

Test meaningful user-observable states:

- default;
- hover only when behavior changes materially;
- focus-visible;
- keyboard activation;
- loading;
- error;
- disabled;
- selected;
- long content;
- empty content.

## Visual Regression

Capture representative states, not every possible permutation.

Good targets:

- design-system primitives;
- key composite components;
- high-traffic pages;
- responsive breakpoints;
- light/dark themes if supported;
- error/loading states;
- overlays.

## Responsive Testing

Include width-specific behavior assertions when the interaction model changes, not only screenshots.

Examples:

- sidebar becomes drawer;
- toolbar moves actions to overflow;
- detail panel becomes a separate view.

## Accessibility Testing

Automated checks are necessary but insufficient.

Manually verify:

- keyboard traversal;
- focus order;
- focus restoration;
- visible focus;
- dialog/menu keyboard behavior;
- zoom/reflow;
- touch targets.

## Anti-Patterns

- snapshots of huge DOM trees;
- testing class names instead of behavior;
- visual baselines accepted without review;
- tests that mock away every meaningful integration;
- E2E coverage used for tiny pure logic;
- ignoring loading/error states because the happy path passes.
