# Skill: React Component Architecture

## Purpose

Design component boundaries that preserve usability, semantics, state ownership, reuse, and maintainability.

## Mental Model

A component should exist because it owns a coherent responsibility, not merely because a design file contains a rectangle.

Typical layers:

```text
semantic/native primitive
        ↓
UI primitive
        ↓
composite component
        ↓
feature component
        ↓
page / route
```

## Boundary Rules

Extract a component when at least one is true:

- interaction behavior repeats;
- accessibility behavior must stay consistent;
- the concept has a stable domain meaning;
- state transitions form a coherent unit;
- variants share semantics and anatomy;
- duplicated implementations are likely to drift.

Do not extract simply because two regions currently look similar.

## Ownership

A component should clearly own:

- its semantics;
- internal interaction state;
- internal focus behavior;
- local visual states;
- a small, deliberate public API.

It should not secretly own unrelated business state or page navigation unless that is its actual feature responsibility.

## Smart vs Dumb Is Too Crude

Prefer thinking in terms of ownership:

- rendering responsibility;
- state responsibility;
- data responsibility;
- side-effect responsibility;
- navigation responsibility.

Keep each boundary understandable.

## React Guidance

- Prefer composition over configuration explosions.
- Keep state as local as practical.
- Avoid mirroring props into state without a transition model.
- Avoid effects for pure derivation.
- Treat effects as synchronization with external systems.
- Preserve stable keys based on identity, not array position when identity exists.
- Keep event handling close to the behavior it represents.

## Example

```tsx
function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogRoot>
  );
}
```

A dialog abstraction should provide semantics, focus management, dismiss behavior, and layering. It should not know what business action the dialog confirms.

## Anti-Patterns

- 1000-line page components;
- giant prop bags passed through many levels;
- reusable “Card” abstractions with dozens of unrelated variants;
- coupling data fetching to low-level presentation primitives;
- effects used to recompute values available during render;
- state duplicated in parent and child;
- wrapper components that add no behavior, semantics, or styling contract.

## Review Heuristics

- Can I explain what this component owns in one sentence?
- Can state transitions be understood without reading distant files?
- Are semantics preserved by the abstraction?
- Would changing one feature cause unrelated primitives to change?
- Does the public API make invalid states difficult to represent?
