# Skill: Design Philosophy — Quiet, Content-First Product UI

## Purpose

Own the product-wide design judgment that makes the interface feel calm, precise, premium, and obvious rather than merely styled.

## Use This Skill When

- Starting a redesign or new surface.
- Resolving visual disagreement between teams.
- Deciding whether a flourish improves or distracts.
- Reviewing whether a page feels 'premium' without knowing what to change.

## Goals

- Reduce cognitive load.
- Keep the product identity distinct while reaching an Apple/ChatGPT-level quality bar.
- Make controls discoverable without making chrome dominate.
- Create consistent rhythm across features.

## Mental Model

Think in terms of **signal-to-noise**. Every pixel either clarifies hierarchy, exposes an action, communicates state, protects readability, or consumes attention. Premium design usually comes from removing weak signals and strengthening the few that remain.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Use depth only to express layering or interactivity.
- Prefer a neutral base and let product content carry personality.

## Architecture

Use three conceptual layers:

```text
Content layer      → the thing the user came for
Interaction layer  → controls that manipulate or navigate content
Environment layer  → shell, background, navigation, persistent chrome
```

The content layer should normally have the strongest readable contrast. Persistent chrome should be visually quieter. Temporary interaction layers may elevate above both.

## Best Practices

- Limit simultaneous emphasis. On a normal screen, one region should feel primary, a few secondary, and the rest quiet.
- Use whitespace to group and separate before adding boxes, dividers, or background fills.
- Avoid visual novelty for standard tasks. Familiarity reduces learning cost.
- Use accent color sparingly for primary action, selection, focus, or meaningful status.
- Treat text density as a product decision. Large headings do not automatically create hierarchy.
- Make interactive states feel physically coherent: hover anticipates, press compresses or darkens, release resolves.
- Prefer persistent context over frequent modal interruption.

## Implementation Patterns

- Build pages from a restrained set of primitives rather than unique one-off cards.
- Use one shell/background system, one content surface system, and one overlay system.
- Use semantic emphasis levels: primary, secondary, tertiary, disabled — for both text and controls.

## Decision Rules

- If an effect does not communicate hierarchy, affordance, state, or continuity → remove it.
- If two regions compete visually → reduce the less important region before increasing the important one.
- If a user must learn a custom behavior for a standard action → prefer the standard behavior.
- If a surface feels flat → first improve grouping, spacing, and contrast; add shadow/blur only if layering still needs clarification.

## States and Edge Cases

- Empty content.
- Very dense expert workflows.
- Long translated labels.
- High-contrast mode.
- Dark mode.
- Reduced motion.
- Narrow split views.
- Touch-only use.

## Anti-Patterns

- Using blur as a synonym for premium.
- Large radii on every rectangle.
- Multiple accent colors with equal weight.
- Card-in-card-in-card nesting.
- Decorative gradients behind dense content.
- Hiding common actions just to make the screen look clean.

## Performance

- Visual effects must not force expensive repaints during routine scrolling.
- Avoid backdrop-filter across large continuously scrolling regions.
- Prefer static visual hierarchy over runtime-heavy decoration.

## Accessibility

- Never trade contrast, focus visibility, target size, or text legibility for aesthetic minimalism.
- Minimal UI still needs explicit labels when icon meaning is not universal.

## Testing

- Review a screen in grayscale to test hierarchy.
- Test with 200% zoom and increased text size.
- Run keyboard-only and touch-only walkthroughs.
- Capture narrow/wide screenshots and compare emphasis order.

## Production Checklist

- Primary task is obvious.
- No unnecessary ornamental layer.
- Chrome is quieter than content.
- One clear primary action per region.
- Focus and selected states are unmistakable.
- Layout remains coherent under stress.

## Review Heuristics

- What is the first thing the eye sees, and is it correct?
- What can be removed with no loss of comprehension?
- Does every border/background/shadow explain structure?
- Can a new user predict what is clickable?
- Does the interface still feel good with animation disabled?

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
