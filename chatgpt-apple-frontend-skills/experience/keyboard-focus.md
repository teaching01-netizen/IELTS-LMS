# Skill: Keyboard, Focus, and Shortcut Continuity

## Purpose

Own tab order, focus-visible styling, focus restoration, roving focus, shortcuts, and keyboard continuity across dynamic UI.

## Use This Skill When

- Building dialogs, sidebars, toolbars, menus, editors, split views, or power-user workflows.
- Focus disappears after rerenders.
- Keyboard users need excessive tabbing.

## Goals

- Make every core action reachable.
- Keep focus location predictable.
- Use shortcuts without hijacking typing.
- Restore focus after temporary layers.

## Mental Model

Focus is the keyboard user's cursor. Losing it is equivalent to moving the mouse pointer somewhere random.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- DOM order should match logical reading/action order.
- Only implement roving focus for true composite widgets.

## Architecture

Define global tab sequence through semantic DOM order. Components own local arrow-key behavior only when their ARIA/native interaction model calls for it.

## Best Practices

- Use `:focus-visible` with a clearly visible ring.
- Do not remove outlines without a replacement.
- When a modal closes, return focus to its opener or next logical location.
- When deleting the focused item, move focus to a meaningful sibling/container.
- Shortcuts should not fire while users type unless explicitly designed for the editor.
- Display shortcuts in menus/tooltips where discoverability matters.

## Implementation Patterns

- Use refs for focus restoration, not routine visual state.
- Central shortcut registry only when many features need conflict resolution.

## Decision Rules

- If a widget follows a standard keyboard pattern → implement that pattern.
- If arrow navigation would surprise users → use normal Tab behavior.
- If a shortcut conflicts with browser/OS conventions → choose another.

## States and Edge Cases

- Item removed.
- Overlay closed.
- Route changes.
- Virtualized list.
- Disabled item.
- IME/editor focus.
- Mobile hardware keyboard.

## Anti-Patterns

- Programmatically focusing on every render.
- Positive `tabindex` ordering.
- Global single-letter shortcuts while typing.
- Focus ring hidden for aesthetic reasons.
- Focus landing behind a modal.

## Performance

- Avoid state updates on every key when native behavior suffices.
- Shortcut handling should be scoped and unsubscribed cleanly.

## Accessibility

- Meet expected keyboard patterns.
- Focus indicator visible with sufficient contrast.
- No keyboard traps outside intentional modal behavior.

## Testing

- Full keyboard walkthrough.
- Focus restoration tests.
- Delete-focused-item test.
- Shortcut conflict tests.
- Screen-reader + keyboard smoke test.

## Production Checklist

- Tab order logical.
- Focus visible.
- Overlay restoration correct.
- No accidental traps.
- Shortcuts scoped.

## Review Heuristics

- After every dynamic action, where is focus?
- Can a keyboard user complete the primary task with reasonable effort?
- Are shortcuts discoverable and safe?

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
