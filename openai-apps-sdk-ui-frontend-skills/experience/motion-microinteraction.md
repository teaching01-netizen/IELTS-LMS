# Skill: Motion and Microinteraction

## Purpose

Use motion to explain state change and create continuity without distracting
users or making the interface feel performative.

## Mental Model

Motion should answer:

```text
What changed?
Where did it come from?
What is interactive?
What completed?
```

It should not merely answer:

```text
How can we make this look expensive?
```

## Good Uses

- popover/menu appearance;
- selection transition;
- loading/progress feedback;
- content insertion/removal;
- success confirmation;
- state transition between related views.

## Craft Principles

Premium interaction comes from:

```text
immediate feedback
stable layout
short predictable transitions
correct interruption behavior
consistent easing
focus continuity
no unnecessary movement
```

## Reduced Motion

Respect `prefers-reduced-motion`.

When reducing motion:

- preserve state clarity;
- replace movement with instant/fade transitions when appropriate;
- never hide information behind animation completion.

## Decision Rules

If motion clarifies state:
→ use restrained transition.

If motion delays task completion:
→ shorten/remove it.

If the user may repeat the action frequently:
→ make the interaction fast and non-fatiguing.

If layout shift is noticeable:
→ stabilize geometry before adding animation.

## Anti-Patterns

- bouncing/pulsing everything;
- long page transitions inside task flows;
- spring overshoot on text/forms;
- animation for every hover;
- using movement instead of visible state semantics.

## Testing

- rapid repeated interactions;
- interrupted transitions;
- reduced motion;
- slow device;
- keyboard navigation during/after animation;
- dynamic content height changes.
