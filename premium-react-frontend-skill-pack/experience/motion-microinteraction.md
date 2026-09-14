# Skill: Motion and Microinteraction

## Purpose

Use motion to communicate continuity, hierarchy, state, and direct manipulation without making the interface distracting or slow.

## Mental Model

Motion should answer one of these questions:

- where did this come from?
- where did this go?
- what changed?
- what is attached to what?
- did my action register?

If it answers none, it may be decorative noise.

## Principles

- keep common interaction motion brief;
- preserve spatial continuity;
- make motion interruptible;
- avoid animating every property;
- prefer transform/opacity when appropriate;
- use consistent duration/easing families;
- reduce distance before reducing duration when softening motion;
- respect reduced-motion preferences.

## Microinteraction Examples

Good uses:

- subtle button press;
- accordion expansion preserving context;
- drawer entering from its spatial origin;
- selected tab indicator moving between peers;
- drag handle activation;
- inline save confirmation;
- skeleton-to-content fade without layout jump.

## Premium Motion

Premium motion is often barely noticed.

It should feel:

- quick;
- physically coherent;
- not springy by default;
- not overshooting ordinary controls;
- not delaying input;
- consistent across the product.

## Decision Rules

If the transition happens many times per minute → make it especially short and quiet.

If a region changes location → preserve spatial context where possible.

If the user can issue another command during animation → the UI should remain responsive.

If the animation is needed to understand cause/effect → preserve a reduced-motion equivalent that still communicates change.

## Anti-Patterns

- long 400–700ms animations for routine controls;
- bounce on every click;
- animated gradients behind dense content;
- scroll hijacking;
- parallax in task-focused screens;
- staggered list entrances every time data refreshes;
- disabling interaction until decorative motion completes.
