# Skill: React Component Architecture

## Purpose

Own component boundaries, layering, composition, state ownership, and separation between reusable UI and product features.

## Use This Skill When

- Creating a component library.
- Refactoring duplicated feature UI.
- A component has too many props or knows too much product state.
- Design-system primitives and feature code are entangled.

## Goals

- Keep primitives reusable without becoming generic abstractions.
- Keep feature behavior close to domain state.
- Make accessibility behavior consistent.
- Enable independent testing and replacement.

## Mental Model

A React component should have a clear **reason to change**. Split by responsibility and interaction boundary, not by arbitrary line count.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Composition beats configuration explosion.
- Reusable UI owns interaction mechanics; features own domain meaning.

## Architecture

Use layers:

```text
ui/primitives       Button, TextField, IconButton, Surface
ui/composites       Dialog, Toolbar, FormField, SidebarItem
features/<domain>   domain-specific composition + state
pages/routes         data boundary + page composition
```

Data fetching and domain decisions should not leak into low-level primitives.

## Best Practices

- Use native HTML elements as the base whenever possible.
- Keep controlled/uncontrolled behavior explicit; do not accidentally support both.
- Co-locate small local state with the component that owns the interaction.
- Lift state only when multiple peers need the same source of truth.
- Prefer children/slots for structural composition over dozens of visual flags.
- Expose refs only when focus/measurement/interoperability truly requires them.
- Avoid component wrappers that add no semantic, behavioral, or styling responsibility.

## Implementation Patterns

- Compound components for coordinated structures.
- Render props only for behavior that cannot be expressed cleanly with composition.
- Context for stable subtree-wide state, not rapidly changing global app data.

## Decision Rules

- If behavior must stay identical across many features → put it in reusable UI.
- If meaning is domain-specific → keep it in the feature layer.
- If a component has many booleans that create impossible combinations → model variants or split components.
- If two things only look similar today but behave differently → do not prematurely unify them.

## States and Edge Cases

- Suspense/loading.
- Server/client boundary.
- Portal content.
- Error boundaries.
- Unmount/remount preserving draft state.
- Strict Mode.
- IME composition.

## Anti-Patterns

- God components.
- Prop drilling through unrelated layers instead of better ownership.
- Global state for local hover/open state.
- Design-system components importing feature modules.
- Boolean prop explosion.

## Performance

- Avoid rerendering large subtrees for cursor/hover state.
- Memoize only after measuring or when identity stability is part of an API contract.
- Keep expensive editors/visualizations isolated.

## Accessibility

- Primitives preserve native semantics.
- Focus and ARIA behavior belong to the component that owns the interaction.
- Do not require feature teams to reconstruct keyboard mechanics.

## Testing

- Unit-test interaction contracts.
- Integration-test composed feature behavior.
- A11y-test primitives once, then critical compositions again.
- Test remount/persistence for draft-heavy components.

## Reference Implementation

```tsx
type ButtonProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      {...props}
      className={cx("Button", `Button--${variant}`, `Button--${size}`, className)}
    />
  );
}
```

## Production Checklist

- Layer boundaries enforced.
- No feature imports in primitives.
- State ownership documented.
- Interaction behavior testable.
- No impossible prop combinations.

## Review Heuristics

- What specific responsibility would make this component change?
- Could this primitive be used in another feature without importing domain knowledge?
- Would splitting reduce coupling or only create indirection?

## Conflict Resolution

When guidance conflicts, use this order:

```text
correctness
→ user safety
→ accessibility
→ product behavior
→ design-system consistency
→ performance
→ visual polish
→ implementation convenience
```
