# Skill: Motion System and Micro-Interaction Timing

## Purpose

Define when motion is allowed, which properties move, timing/easing tokens, interruption behavior, and reduced-motion fallbacks.

## Use This Skill When

- Adding hover/press feedback, panels, dialogs, menus, list changes, loading transitions, or drag interactions.
- The app feels abrupt or excessively animated.

## Goals

- Make state changes understandable.
- Preserve spatial continuity.
- Keep interaction immediate.
- Support reduced motion.

## Mental Model

Motion is a state-transition explanation. The user should understand **what changed and where it went**. If motion does not answer that, it is likely decoration.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Animations must be interruptible.
- Frequent actions use faster motion than rare, large transitions.

## Architecture

Define categories:

```text
micro feedback   80–140ms
control state    120–180ms
popover/menu     140–220ms
panel/sheet      180–280ms
large context    only when truly useful
```

Durations are ranges, not laws; perceived distance and frequency matter.

## Best Practices

- Animate opacity and transform when possible.
- Keep hover feedback nearly immediate.
- Use spring-like motion only where physical continuity helps, not as a default personality layer.
- Do not delay click handling until an exit animation completes unless required for safety.
- When content size changes, prefer stable layout or targeted expansion rather than animating the whole page.
- Reduced-motion mode should remove travel/scale and retain simple opacity/state feedback when safe.

## Implementation Patterns

- Use CSS transitions for local deterministic states.
- Use a dedicated motion library only for orchestration, shared-layout transitions, or gesture-driven animation.
- Cancel obsolete async animations when state changes again.

## Decision Rules

- If the user performs the action many times per minute → make motion faster or remove it.
- If the transition changes spatial context → use movement to preserve origin/destination.
- If animation makes a user wait → shorten or decouple it.
- If reduced motion is requested → avoid parallax, large-scale zoom, and long travel.

## States and Edge Cases

- Rapid repeated clicks.
- Interrupted navigation.
- Content streaming.
- Reduced motion.
- Low-power device.
- Background tab/resume.
- Virtualized lists.

## Anti-Patterns

- Animating everything.
- Long 400–800ms UI transitions.
- Bouncy motion on serious workflows.
- Animating height across large DOM trees.
- Hover motion that shifts layout.

## Performance

- Prefer compositor-friendly properties.
- Keep large blur/shadow animations rare.
- Avoid layout-triggering animation in scrolling areas.

## Accessibility

- Respect `prefers-reduced-motion`.
- Do not use motion as the only indicator of change.
- Avoid flashing/flicker patterns.

## Testing

- Reduced-motion snapshots.
- Rapid-interaction tests.
- Check interrupted open/close sequences.
- Profile scrolling while animated surfaces are present.

## Production Checklist

- Motion tokens defined.
- No interaction waits for decoration.
- Reduced-motion path complete.
- Frequent actions fast.
- No layout-jank animation.

## Review Heuristics

- Does motion explain a relationship?
- Can the user reverse action mid-animation?
- Would the interface still be clear with motion disabled?

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
