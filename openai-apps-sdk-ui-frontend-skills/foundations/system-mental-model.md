# Skill: Apps SDK UI System Mental Model

## Purpose

Define how to reason about the design system before implementation.

## Mental Model

Use the highest meaningful layer:

```text
feature/page
    ↓
composite application component
    ↓
Apps SDK UI primitive
    ↓
semantic/component token
    ↓
primitive token
```

Do not start with raw CSS and work upward.

## Core Principles

### Semantics before appearance

Identify the interaction first, then choose the component.

### Existing primitive before custom primitive

Custom controls require you to recreate:

- keyboard behavior;
- focus behavior;
- ARIA semantics;
- loading/disabled states;
- responsive styling;
- theme behavior;
- future maintenance.

### Semantic token before primitive palette

Prefer meaning such as:

```text
surface
default text
secondary text
subtle border
danger
success
```

over a specific raw color.

### Composition before abstraction

First compose real UI with existing primitives. Extract app-level abstractions
only when a stable domain concept or repeated behavior exists.

## CSS Escalation Ladder

Use this order:

```text
1. existing component prop
2. documented component composition
3. semantic Tailwind utility
4. semantic CSS variable
5. small application CSS rule
6. app-level wrapper
7. custom primitive
```

Steps 6–7 require justification.

## Decision Rules

If Apps SDK UI already owns the interaction:
→ do not rebuild it.

If custom behavior is purely product/domain behavior:
→ wrap the public component API.

If the need is only visual spacing:
→ prefer layout utilities over component source changes.

If you need raw primitive values repeatedly:
→ first check whether a semantic token already represents the intent.

## Architecture

Separate:

```text
domain logic
interaction state
design-system primitive
layout
theme/tokens
```

A feature component may coordinate them, but should not redefine the underlying
control behavior.

## Anti-Patterns

- Copying library source into the app.
- Creating `MyButton`, `MyInput`, `MySelect` solely to rename props.
- Styling against generated internal DOM selectors.
- Building a parallel private token system.
- Hardcoding desktop dimensions around reusable controls.
- Treating Apps SDK UI as visual inspiration rather than the implementation
  foundation.

## Review Heuristics

Ask:

- Are we solving a domain problem or recreating a design-system problem?
- Which layer should own this decision?
- Can the same result be expressed with a documented prop?
- Would a future package upgrade break this implementation?
