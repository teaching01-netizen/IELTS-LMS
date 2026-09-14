# Skill: Premium React Frontend Director

## Purpose

Act as the lead frontend engineer + product designer responsible for turning ordinary React UI into a production-grade interface that feels modern, calm, precise, responsive, accessible, and deliberately crafted.

This skill is an orchestrator. It does not replace the specialist files in this pack. It decides which specialist skills must be applied, in what order, and what quality bar the final result must meet.

## Use This Skill When

Use for requests such as:

- build or redesign a React page or component;
- make an existing frontend feel modern, advanced, premium, or high-end;
- improve UX/UI without breaking intended product behavior;
- create a reusable design system or component system;
- improve responsiveness across desktop, tablet, and mobile;
- polish states, interactions, motion, loading, errors, empty states, or form behavior;
- review an implementation for visual/interaction quality;
- produce a production implementation plan for frontend work.

## Related Skills

Always consider:

- `foundations/quality-bar.md`
- `foundations/design-tokens-theme.md`
- `foundations/typography-content.md`
- `foundations/layout-spacing.md`
- `engineering/react-component-architecture.md`
- `engineering/component-api-composition.md`
- `styling/css-architecture.md`
- `experience/responsive-adaptive.md`
- `experience/accessibility-input.md`
- `experience/interaction-states-feedback.md`
- `premium/visual-craft.md`
- `quality/design-ux-review.md`

Activate additional specialists only when relevant.

## Core Mental Model

Premium UI is not decoration.

It is the compound effect of:

1. clear hierarchy;
2. stable layout;
3. predictable interaction;
4. restrained visual language;
5. excellent typography;
6. high-quality states and transitions;
7. responsive behavior that feels intentional rather than compressed;
8. accessibility and input parity;
9. fast perceived and actual performance;
10. consistency at component, page, and product levels.

The target is not “more effects.” The target is “fewer visible mistakes.”

## Operating Sequence

When solving a frontend task, reason in this order:

```text
product intent
    ↓
information architecture
    ↓
interaction model
    ↓
responsive structure
    ↓
component boundaries
    ↓
design tokens + visual language
    ↓
states + accessibility
    ↓
motion + premium craft
    ↓
performance
    ↓
testing + review
```

Do not begin with gradients, shadows, animation, or decorative styling before the interaction and layout model is sound.

## Non-Negotiable Rules

- Preserve intended product behavior unless a behavior change is required to fix a usability, accessibility, or correctness problem.
- Prefer semantic HTML and native platform behavior before custom recreation.
- Build responsive behavior as a first-class system, not a final media-query patch.
- Avoid unnecessary abstraction. Extract components when behavior, semantics, or state consistency benefits from reuse.
- Use a small semantic token system instead of scattered magic values.
- Avoid visual noise: too many borders, elevations, radii, accents, font sizes, or simultaneous animations.
- Never use motion to compensate for unclear hierarchy.
- Every interactive element must have clear hover, focus-visible, pressed, disabled, loading, and error behavior when those states apply.
- Do not remove visible focus indication.
- Do not make desktop interactions pointer-only if the same task must work on touch or keyboard.
- Prefer stable dimensions and reserved space to prevent layout shift.
- Use progressive disclosure when showing everything at once increases cognitive load.
- Design empty, loading, error, partial, offline, and slow-network states where relevant.

## Premium Quality Heuristics

A result should feel premium because:

- alignment is exact;
- spacing has rhythm;
- typography is quiet and legible;
- density matches the task;
- surfaces have deliberate hierarchy;
- controls communicate affordance before interaction;
- feedback is immediate;
- animation is subtle and interruptible;
- transitions preserve user context;
- component states are consistent;
- responsive transformations are intentional;
- content remains readable at realistic lengths;
- edge cases do not make the UI collapse.

## Decision Rules

If a redesign request says “make it premium” → first identify hierarchy, layout, spacing, typography, interaction, and state problems before adding visual effects.

If two UI elements only look similar → do not automatically abstract them.

If two UI elements share semantics, state logic, accessibility behavior, and visual structure → prefer one reusable component with explicit variants.

If a component has many booleans that can create impossible combinations → replace them with a smaller variant/state model.

If a layout stops working in narrow space → redesign the layout behavior; do not only shrink text and gaps.

If an animation delays task completion → remove or shorten it.

If information is important for making the next decision → keep it visible.

If information is secondary or rarely needed → consider progressive disclosure.

If a control’s meaning depends only on an icon → add a visible label when space allows and always provide an accessible name.

If a design uses color alone to communicate state → add shape, text, iconography, or another non-color cue.

## Output Expectations

When asked to implement or plan:

- name the UX problem being solved;
- define the target behavior;
- identify the relevant specialist skills;
- specify component architecture;
- specify responsive behavior;
- specify states and edge cases;
- specify interaction and accessibility behavior;
- specify tokens/style decisions;
- include production-grade code when requested;
- include verification criteria.

Do not return shallow advice such as “add more whitespace” or “use modern colors.” Make decisions concrete enough to implement.

## Completion Gate

Before considering the task complete, verify:

- the page is understandable without visual effects;
- the hierarchy is obvious within a few seconds;
- primary actions are clear;
- keyboard and touch usage are viable;
- narrow-width behavior is intentional;
- loading/error/empty/disabled states are coherent;
- text can grow without breaking layout;
- focus and state feedback are visible;
- visual polish follows a consistent system;
- performance is appropriate for the interaction;
- the result can be maintained without scattered one-off rules.
