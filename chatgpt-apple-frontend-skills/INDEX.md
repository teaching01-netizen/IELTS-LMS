# ChatGPT / Apple-Quality React Frontend Skill Pack

## Goal

Build a production React frontend with the **clarity, restraint, adaptability, interaction quality, and craft** associated with mature products such as ChatGPT and Apple software, without cloning their proprietary branding or interface pixel-for-pixel.

The desired feeling is:

- content-first rather than chrome-first;
- quiet, confident visual hierarchy;
- a small number of strong primitives;
- generous but disciplined spacing;
- readable typography;
- subtle depth and material separation;
- obvious interaction states;
- fast perceived response;
- excellent keyboard, pointer, and touch behavior;
- layouts that survive iPad, phone, desktop, zoom, localization, and long content;
- micro-interactions that communicate state instead of showing off.

## Mental Model

Treat the frontend as a layered system:

```text
product intent
    ↓
information architecture
    ↓
interaction model
    ↓
design primitives
    ↓
semantic tokens
    ↓
React primitives
    ↓
composite components
    ↓
feature surfaces
    ↓
responsive + accessibility + motion
    ↓
testing + visual review
```

A high-end interface is not created by adding blur, shadows, gradients, or animation. It comes from reducing ambiguity, making every state deliberate, preserving context, and keeping hundreds of small decisions consistent.

## Skill Map

| Skill | Owns | Depends on |
|---|---|---|
| `foundations/design-philosophy.md` | Quality bar and visual/interaction principles | — |
| `foundations/design-tokens.md` | Primitive and semantic token architecture | design philosophy |
| `foundations/color-materials.md` | Surfaces, contrast, borders, depth | tokens |
| `foundations/typography-readability.md` | Type hierarchy and reading comfort | tokens |
| `foundations/spacing-layout.md` | Spacing rhythm, grids, density | tokens |
| `foundations/iconography.md` | Icon semantics and sizing | tokens |
| `foundations/motion-system.md` | Motion tokens and choreography | tokens |
| `engineering/react-component-architecture.md` | Component boundaries and layers | foundations |
| `engineering/component-api-design.md` | Stable public component APIs | component architecture |
| `engineering/state-rendering.md` | UI state machines and async rendering | architecture |
| `engineering/css-architecture.md` | CSS layers, scoping, responsive styling | tokens |
| `engineering/frontend-performance.md` | Runtime and perceived performance | architecture |
| `components/actions-buttons.md` | Button/action family | tokens, component API |
| `components/forms-inputs.md` | Inputs, fields, validation | tokens, accessibility |
| `components/navigation-sidebar.md` | Sidebar/navigation shells | IA, responsive |
| `components/toolbars-controls.md` | Toolbars and action groups | actions, responsive |
| `components/overlays-modality.md` | Popovers, dialogs, sheets | focus, motion |
| `components/content-surfaces.md` | Cards, panels, grouped content | materials, spacing |
| `components/composer-input.md` | Chat-style rich composer / command entry | forms, state |
| `components/feedback-status.md` | Toasts, inline status, progress | state |
| `experience/information-architecture.md` | Hierarchy and progressive disclosure | design philosophy |
| `experience/interaction-model.md` | Selection, actions, feedback, reversibility | IA |
| `experience/keyboard-focus.md` | Keyboard model and focus continuity | accessibility |
| `experience/touch-pointer.md` | Pointer/hover/drag/touch ergonomics | interaction |
| `experience/responsive-adaptive.md` | Desktop/tablet/mobile/window adaptation | layout |
| `experience/loading-empty-error.md` | Non-happy-path experience | state |
| `experience/accessibility.md` | WCAG-minded interaction and semantics | all UI |
| `quality/testing.md` | Behavior, a11y, integration tests | all |
| `quality/visual-regression.md` | Screenshot/state matrix verification | all UI |
| `quality/design-review.md` | HIG-style craft audit | all |
| `quality/implementation-workflow.md` | How an AI/dev team applies the pack | all |

## Recommended Implementation Order

1. Define product hierarchy with `information-architecture`.
2. Establish `design-philosophy`, tokens, typography, color/materials, spacing, icons, motion.
3. Set React architecture, component API rules, CSS architecture, and state modeling.
4. Build primitives before feature-specific components.
5. Build navigation and major content surfaces.
6. Add responsive adaptation, keyboard/focus, touch/pointer, and accessibility.
7. Implement non-happy states and perceived-performance behavior.
8. Add behavior tests and visual-regression coverage.
9. Run `design-review` before calling the frontend polished.

## Shared Principles

- **Do not clone branding.** Borrow transferable interaction principles; use your own identity, palette, font licensing, icons, and copy.
- **Restraint is a feature.** If a visual effect is not helping hierarchy, affordance, state, or continuity, remove it.
- **One dominant action per region.** Secondary and tertiary controls should visually recede.
- **Content gets the contrast.** Chrome should be quieter than the content it supports.
- **State must be visible.** Hover, press, focus, selected, disabled, loading, dirty, error, success, and destructive states must be intentional.
- **Adaptive does not mean scaled down.** Recompose layouts at constrained widths.
- **Preserve context.** Avoid unnecessary page changes and modals for simple tasks.
- **Respect user input.** Never lose typed text, scroll position, selection, or focus without a strong reason.
- **Fast feedback first.** Give immediate local feedback, then reconcile with network results.
- **Craft lives at the edges.** Overflow, long labels, IME composition, virtual keyboards, safe areas, reduced motion, zoom, and interruption reveal the real quality of the system.

## Visual Direction

The default visual language should be:

```text
neutral surfaces
+ semantic contrast
+ restrained accent
+ low-noise borders
+ shallow elevation
+ moderate radii
+ compact but breathable controls
+ readable type
+ smooth state transitions
```

Avoid the common “AI app” failure mode of excessive gradients, glass blur, glowing borders, giant radii, and animation on every state change.

## Definition of Done

A surface is production-ready when:

- the primary task is obvious within a few seconds;
- spacing and type hierarchy are consistent;
- every interactive element has visible hover/focus/pressed/disabled behavior where applicable;
- keyboard-only use is coherent;
- touch targets remain usable on tablet/phone;
- resizing does not create clipped or unreachable UI;
- long and localized content does not destroy layout;
- async operations preserve context and input;
- loading/error/empty states are designed;
- reduced motion works;
- automated tests cover critical interaction contracts;
- screenshot review includes narrow, medium, and wide states;
- the UI looks intentional without relying on ornamental effects.

## External Reference Principle

Current Apple guidance emphasizes adaptable hierarchy, familiar controls, progressive disclosure, safe-area awareness, and readable content. OpenAI brand guidance emphasizes restrained, human-centered visual language and careful use of proprietary brand assets. Use those ideas as quality references, not as permission to copy protected assets.
