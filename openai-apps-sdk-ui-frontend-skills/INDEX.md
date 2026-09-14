# OpenAI Apps SDK UI Frontend Skill Pack

## Goal

Build production React interfaces with OpenAI Apps SDK UI that feel coherent
inside ChatGPT-style surfaces while remaining accessible, responsive,
theme-safe, reliable, and maintainable.

The pack is deliberately decomposed into focused specialists rather than one
monolithic document.

## Mental Model

```text
installation + integration
          ↓
design-system foundations
          ↓
component selection + architecture
          ↓
component-specific behavior
          ↓
accessibility + responsive + async + motion craft
          ↓
testing + production review + upgrades
```

Treat Apps SDK UI as a set of **visual and behavioral contracts**, not a bag of
styled components.

## File Tree

```text
openai-apps-sdk-ui-frontend-skills/
├── SKILL.md
├── INDEX.md
├── setup/
│   ├── installation-setup.md
│   └── router-integration.md
├── foundations/
│   ├── system-mental-model.md
│   ├── design-tokens.md
│   ├── colors-surfaces-borders.md
│   ├── typography.md
│   ├── theming-dark-mode.md
│   └── responsive-layout.md
├── engineering/
│   ├── component-selection-composition.md
│   └── react-state-architecture.md
├── components/
│   ├── buttons-links.md
│   ├── forms-inputs.md
│   ├── selection-controls.md
│   ├── menu-popover-tooltip.md
│   ├── feedback-status-empty.md
│   ├── markdown-code-media.md
│   └── date-pickers.md
├── experience/
│   ├── accessibility.md
│   ├── keyboard-focus.md
│   ├── async-states.md
│   ├── motion-microinteraction.md
│   └── touch-density-overflow.md
└── quality/
    ├── testing.md
    ├── review-checklist.md
    └── upgrades-migrations.md
```

## Skill Map

| Skill | Responsibility | Depends on |
|---|---|---|
| installation-setup | package, Tailwind, CSS, smoke test | — |
| router-integration | provider and link semantics | installation |
| system-mental-model | architecture and escalation rules | installation |
| design-tokens | primitive/semantic/component token usage | system mental model |
| colors-surfaces-borders | hierarchy and containment | design tokens |
| typography | text scales and readable hierarchy | design tokens |
| theming-dark-mode | theme attribute and dark-mode behavior | tokens |
| responsive-layout | mobile-first adaptation | tokens |
| component-selection-composition | pick the correct primitive | foundations |
| react-state-architecture | state ownership and component contracts | selection |
| buttons-links | actions and navigation | selection, router |
| forms-inputs | text input and validation | accessibility |
| selection-controls | select/radio/switch/checkbox/slider | accessibility |
| menu-popover-tooltip | floating UI semantics | keyboard/focus |
| feedback-status-empty | alert/badge/indicator/empty states | colors, async |
| markdown-code-media | rich content and media | typography |
| date-pickers | date and range interactions | forms |
| accessibility | semantic inclusive UI | all components |
| keyboard-focus | focus flow and restoration | accessibility |
| async-states | pending/success/error/optimistic | React state |
| motion-microinteraction | meaningful motion | accessibility |
| touch-density-overflow | constrained surfaces and touch | responsive |
| testing | behavioral and visual verification | all |
| review-checklist | production acceptance gate | all |
| upgrades-migrations | safe package evolution | testing |

## Recommended Order for a New App

```text
installation
→ router integration if needed
→ system mental model
→ tokens
→ colors + typography + theming + responsive layout
→ component selection
→ React state architecture
→ component-specific skills
→ accessibility + keyboard/focus
→ async + motion + touch/overflow
→ testing
→ production review
```

## Component Selection Shortcut

```text
action                    → Button
navigation                → TextLink / ButtonLink
command list              → Menu
arbitrary floating panel  → Popover
brief supplementary help  → Tooltip
short text                → Input
long text                 → Textarea
many choices              → Select
visible single choice     → RadioGroup
boolean setting           → Switch
independent binary choice → Checkbox
small mode switch         → SegmentedControl
numeric range             → Slider
important feedback        → Alert
compact state/category    → Badge
lightweight status        → Indicator
empty result/content      → EmptyMessage
formatted content         → Markdown
source code               → CodeBlock
single date               → DatePicker
date interval             → DateRangePicker
```

## Shared Principles

Every specialist follows these rules:

- use native semantic elements;
- use Apps SDK UI before rebuilding a primitive;
- preserve documented interaction behavior;
- use semantic tokens;
- design narrow-first;
- never rely on hover alone for critical functionality;
- include long-content and localization pressure in layout thinking;
- distinguish disabled, loading, invalid, selected, and read-only/inert states;
- prefer local, recoverable failure states;
- keep abstractions domain-driven, not style-driven;
- verify public API and installed types before guessing.

## Completion Standard

Matching a screenshot is not enough. A feature is complete when its intended
behavior works across:

- narrow and wide containers;
- light and dark themes;
- pointer, touch, and keyboard;
- loading, invalid, disabled, empty, success, and error states where relevant;
- long text and localization;
- production build and type checking;
- current public Apps SDK UI APIs.
