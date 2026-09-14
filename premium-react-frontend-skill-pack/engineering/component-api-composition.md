# Skill: Component API and Composition

## Purpose

Create React component APIs that remain flexible without becoming ambiguous or impossible to maintain.

## Principles

- Prefer a small semantic API.
- Use variants for real design-system decisions.
- Use composition for content structure.
- Forward appropriate native attributes.
- Preserve native event semantics.
- Avoid mutually contradictory booleans.

## Example

Prefer:

```tsx
type AlertProps = {
  tone?: "info" | "success" | "warning" | "danger";
  title: React.ReactNode;
  children?: React.ReactNode;
};
```

over:

```tsx
type AlertProps = {
  success?: boolean;
  warning?: boolean;
  error?: boolean;
  blue?: boolean;
  compact?: boolean;
  rounded?: boolean;
};
```

The first API expresses intent. The second allows contradictory states.

## Composition Patterns

Use children/slots when consumers need structural freedom.

Use explicit props when the content has stable semantics.

Use compound components when parts share coordinated state and semantics.

Use render props or callbacks only when consumers need behavioral control that composition cannot express cleanly.

## Native Attribute Support

For controls, inherit appropriate platform attributes:

```tsx
type ButtonProps = {
  variant?: "primary" | "secondary" | "quiet";
  size?: "sm" | "md" | "lg";
} & React.ButtonHTMLAttributes<HTMLButtonElement>;
```

Avoid swallowing `aria-*`, `data-*`, form attributes, or event handlers without a strong reason.

## Controlled vs Uncontrolled

Support controlled state when parent coordination is important.

Support uncontrolled state when the component is self-contained and a default is enough.

If both are supported, define behavior clearly and avoid switching modes after mount.

## Decision Rules

If the API needs many booleans → model a finite variant/state space.

If consumers repeatedly need to break the abstraction → the API boundary is wrong.

If a prop exposes styling internals rather than product intent → reconsider it.

If a component only forwards props and class names with no semantic contract → it may not need to exist.

## Anti-Patterns

- `isPrimary`, `isDanger`, `isGhost`, `isLink` together;
- arbitrary `padding`, `margin`, `fontSize` props on every component;
- passing entire fetched objects when only a small view model is needed;
- variant APIs that encode individual pages instead of reusable behaviors;
- hidden global state dependencies.
