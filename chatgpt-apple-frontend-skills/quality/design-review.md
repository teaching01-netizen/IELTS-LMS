# Skill: Design Quality Review — Apple/ChatGPT-Level Craft Audit

## Purpose

Provide a repeatable expert review that finds hierarchy, interaction, readability, adaptive, and micro-craft issues before release.

## Use This Skill When

- A feature is functionally complete.
- The UI feels 'off' but bugs are not obvious.
- Before broad rollout or design-system migration.

## Goals

- Catch subtle friction.
- Separate taste issues from measurable usability issues.
- Ensure the system feels coherent across surfaces.

## Mental Model

Review from macro to micro. First verify task and hierarchy, then layout, then components, then state transitions, then pixel craft. Polishing the wrong hierarchy wastes time.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Review real content, not lorem ipsum.
- Review transitions between states, not only static screens.

## Architecture

Audit order:

```text
1. user goal / information hierarchy
2. navigation / task flow
3. layout / responsive behavior
4. typography / readability
5. action priority / affordance
6. states / feedback / errors
7. keyboard / touch / accessibility
8. motion / continuity
9. pixel-level alignment and optical polish
```

## Best Practices

- Inspect at normal distance before zooming into pixels.
- Use grayscale to test hierarchy.
- Temporarily remove shadows/radii to see whether structure still works.
- Resize continuously through tablet/narrow widths.
- Run keyboard-only and touch walkthroughs.
- Stress with long labels, empty/error/loading, and large text.
- Check scroll boundaries, sticky regions, overscroll, and focus restoration.

## Implementation Patterns

- Use severity levels: blocker, usability, consistency, polish.
- Record issue as observation → user impact → recommended principle, not subjective insult.

## Decision Rules

- If primary task is unclear → fix hierarchy before micro-polish.
- If visual density is high → reduce unnecessary containers before increasing spacing everywhere.
- If interaction is discoverability problem → improve affordance before adding tutorial copy.

## States and Edge Cases

- First use.
- Expert repeated use.
- Narrow iPad.
- Mobile keyboard.
- Long content.
- No data.
- Network failure.
- Reduced motion.

## Anti-Patterns

- Pixel critique before task critique.
- Calling preferences 'HIG' without explaining impact.
- Adding animation to compensate for unclear structure.
- Assuming desktop screenshot equals finished product.

## Performance

- Review performance while scrolling/typing; craft is lost if interactions lag.
- Check expensive effects in realistic content.

## Accessibility

- Keyboard, zoom, focus, target size, contrast, screen-reader labels are release criteria.
- Minimal aesthetic cannot override usability.

## Testing

- Manual task script.
- Screenshot matrix.
- Keyboard/touch run.
- Performance profile.
- Automated a11y baseline.

## Production Checklist

- Primary hierarchy correct.
- Responsive transitions intentional.
- Readability strong.
- State feedback complete.
- Micro-craft consistent.
- No accessibility regressions.

## Review Heuristics

- What is the most visually dominant element and should it be?
- What action is hardest to discover?
- Where does the interface feel fragile when resized?
- Which detail looks accidental rather than designed?

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
