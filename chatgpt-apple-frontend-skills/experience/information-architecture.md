# Skill: Information Architecture and Progressive Disclosure

## Purpose

Own screen hierarchy, navigation depth, grouping, labels, task flow, and what is visible by default.

## Use This Skill When

- Redesigning a page with many controls.
- Users cannot find core settings.
- Important actions are buried behind multiple clicks.
- A screen feels crowded.

## Goals

- Match structure to user tasks.
- Keep frequent/important actions visible.
- Hide complexity, not capability.
- Use labels users already understand.

## Mental Model

Start from user decisions and frequency, not component inventory. Ask what the user needs to know or do *next*, then shape the page around that sequence.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Progressive disclosure should reduce clutter without adding unnecessary navigation.
- Frequent tasks deserve low interaction cost.

## Architecture

Model each surface as primary task, supporting information, secondary actions, advanced options. Use visual hierarchy and disclosure levels that match these roles.

## Best Practices

- Keep high-frequency controls directly visible.
- Group settings by user mental model, not backend schema.
- Use headings that name goals or concepts, not implementation jargon.
- Avoid putting core module/section switching behind nested menus.
- Reveal advanced controls near the context where they matter.
- Use search/command affordances only as accelerators, not as the only path to discoverability.

## Implementation Patterns

- Write a task-frequency matrix.
- Create an information hierarchy before pixel design.
- Use progressive sections, disclosure rows, and contextual panels.

## Decision Rules

- If an action is used every session → visible.
- If used occasionally and has low urgency → secondary placement/overflow.
- If advanced and risky → disclose contextually with explanation.
- If the user must remember a hidden setting's existence → hiding it may be wrong.

## States and Edge Cases

- First-time user.
- Expert user.
- Narrow screen.
- No data.
- Permission-restricted option.
- Very large module count.

## Anti-Patterns

- Organizing by database entities.
- Everything behind kebab menus.
- Repeated accordions that hide the whole interface.
- Two-click access for primary mode switching.
- Using icons instead of understandable labels.

## Performance

- Good IA reduces rendering complexity by avoiding simultaneous heavy regions.
- Do not eagerly render hidden complex panels.

## Accessibility

- Heading hierarchy semantic.
- Hidden content remains keyboard/screen-reader coherent when disclosed.
- Do not rely on hover-only discovery.

## Testing

- Task walkthroughs.
- First-click tests.
- Keyboard discovery.
- Narrow layout hierarchy review.
- Analytics validation when available.

## Production Checklist

- Primary task explicit.
- Frequent actions visible.
- Groups match mental model.
- Advanced controls disclosed sensibly.
- Labels plain.

## Review Heuristics

- Can a user predict where a setting lives?
- How many actions to reach the most common next step?
- What did we hide purely for aesthetics?

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
