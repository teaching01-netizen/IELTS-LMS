# Premium React Frontend Skill Pack

## Goal

Build and review React interfaces that feel modern, advanced, premium, and production-ready without sacrificing usability, accessibility, responsiveness, performance, or maintainability.

The pack treats premium quality as a system of engineering + design decisions rather than a collection of aesthetic tricks.

## Skill Map

| Skill | Owns | Depends on |
|---|---|---|
| `SKILL.md` | orchestration + final quality bar | all relevant skills |
| `foundations/quality-bar.md` | definition of premium product quality | — |
| `foundations/design-tokens-theme.md` | semantic visual primitives + theming | quality bar |
| `foundations/typography-content.md` | readability, hierarchy, content rhythm | tokens |
| `foundations/layout-spacing.md` | layout primitives, rhythm, density | tokens |
| `engineering/react-component-architecture.md` | component boundaries and ownership | quality bar |
| `engineering/component-api-composition.md` | reusable APIs and composition | component architecture |
| `engineering/state-data-async.md` | server/client/UI state and async UX | component architecture |
| `engineering/performance-rendering.md` | React/runtime performance | architecture |
| `styling/css-architecture.md` | cascade, layers, responsive CSS, state styling | tokens |
| `components/primitives-controls.md` | buttons, inputs, controls, affordance | tokens, accessibility |
| `components/overlays-navigation.md` | dialogs, menus, popovers, drawers, navigation | accessibility, responsive |
| `components/forms-validation.md` | forms, errors, validation, submission UX | controls, async state |
| `experience/responsive-adaptive.md` | desktop/tablet/mobile adaptation | layout, components |
| `experience/accessibility-input.md` | semantic, keyboard, focus, touch, AT | components |
| `experience/interaction-states-feedback.md` | hover/focus/pressed/loading/success/error | tokens, accessibility |
| `experience/motion-microinteraction.md` | purposeful motion and micro-feedback | interaction states |
| `premium/visual-craft.md` | depth, surfaces, detail, refinement | tokens, typography, layout |
| `premium/perceived-performance.md` | skeletons, optimistic UI, continuity | async state, performance |
| `quality/testing-visual-regression.md` | component, interaction, visual testing | implementation |
| `quality/design-ux-review.md` | final review heuristics and acceptance bar | all |

## Recommended Application Order

```text
quality bar
   ↓
design tokens + typography + layout
   ↓
React architecture + APIs + state
   ↓
CSS architecture
   ↓
responsive + accessibility
   ↓
component-specific behavior
   ↓
interaction states + motion
   ↓
visual craft + perceived performance
   ↓
testing + design/UX review
```

## Shared Principles

Every specialist follows these rules:

- correctness before polish;
- user safety before convenience;
- accessibility before visual fidelity;
- behavior before decoration;
- semantics before styling hacks;
- predictable state before clever abstraction;
- responsive adaptation before “shrink everything”;
- visual hierarchy before visual effects;
- real performance before ornamental animation;
- consistency before local optimization.

## Target Product Feeling

A successful implementation should feel:

- calm rather than busy;
- crisp rather than flashy;
- responsive rather than animated-for-animation’s-sake;
- dense enough for the task but never cramped;
- obvious without being simplistic;
- expressive without being inconsistent;
- crafted without looking over-designed.

## Suggested Pairings

For a new React component:

- component architecture;
- component API/composition;
- CSS architecture;
- accessibility/input;
- interaction states;
- testing.

For a page redesign:

- quality bar;
- typography/content;
- layout/spacing;
- responsive/adaptive;
- visual craft;
- design/UX review.

For a premium polish pass:

- interaction states;
- motion/microinteraction;
- visual craft;
- perceived performance;
- visual regression;
- design/UX review.

For a form-heavy product:

- controls;
- forms/validation;
- state/data/async;
- accessibility/input;
- responsive/adaptive.
