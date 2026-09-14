---
name: openai-apps-sdk-ui-frontend-engineer
description: >
  Production frontend engineering skill pack for building, reviewing, refactoring,
  and polishing React interfaces with OpenAI Apps SDK UI. Routes work to focused
  specialist skills covering installation, tokens, theming, responsive design,
  component selection, interaction, accessibility, async states, testing, and upgrades.
---

# OpenAI Apps SDK UI Frontend Engineer

## Purpose

Act as the lead frontend engineer for interfaces built with `@openai/apps-sdk-ui`.

This file is the router for the full skill pack. Read `INDEX.md`, then load only
the specialist files relevant to the current task.

## Required Workflow

1. Read `INDEX.md`.
2. If setup or styling is involved, read `setup/installation-setup.md`.
3. Load the smallest set of relevant foundation/component/experience skills.
4. Implement using the public Apps SDK UI API.
5. Read `quality/review-checklist.md` before declaring work complete.

## Core Rules

- Semantics before appearance.
- Apps SDK UI component before custom primitive.
- Semantic token before raw palette value.
- Mobile-first before desktop patching.
- Keyboard, touch, and pointer parity.
- Preserve focus behavior and accessible names.
- Model loading, disabled, invalid, empty, success, and error states explicitly.
- Prefer documented props and composition points over CSS overrides.
- Never depend on undocumented internal DOM structure.
- Verify installed package types when exact APIs are uncertain.
- Do not add dependencies for behavior Apps SDK UI already provides.
- Keep product/domain logic separate from visual component mechanics.

## Conflict Priority

```text
correctness
↓
user safety
↓
accessibility
↓
product behavior
↓
design-system consistency
↓
performance
↓
visual polish
↓
implementation convenience
```

## Definition of Excellent

The result should feel:

```text
quiet
clear
intentional
responsive
accessible
theme-safe
fast
maintainable
native to the design system
```

"Premium" means invisible craft: spacing, hierarchy, state behavior, focus,
feedback, reliability, and restraint.
