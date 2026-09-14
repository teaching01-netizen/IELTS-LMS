# Skill: React Rendering and Frontend Performance

## Purpose

Keep interaction responsive and visual stability high without premature micro-optimization.

## Mental Model

Performance work begins with measurement and architecture, not blanket memoization.

## Priorities

1. avoid unnecessary network work;
2. avoid unnecessary JavaScript;
3. avoid expensive render trees;
4. avoid layout instability;
5. avoid blocking the main thread;
6. optimize images/fonts/assets;
7. optimize only hot paths that measurement identifies.

## React Guidance

- Keep frequently changing state near the components that need it.
- Avoid lifting state unnecessarily.
- Do not memoize everything by default.
- Use memoization when a real render cost or referential-stability need exists.
- Virtualize genuinely large lists.
- Split code by meaningful product boundaries.
- Defer non-critical work.
- Avoid re-rendering huge trees for local hover/input state.

## Perceived Performance

Actual speed and perceived speed both matter.

Protect:

- immediate pressed feedback;
- stable skeleton dimensions;
- preserved content on revalidation;
- predictable progress;
- rapid acknowledgement of user actions.

## Layout Stability

Reserve dimensions for:

- images;
- avatars;
- async badges;
- toolbars;
- media;
- banners when possible.

Avoid content jumping when fonts or data arrive.

## Anti-Patterns

- thousands of hidden DOM nodes;
- rendering full lists that should be virtualized;
- expensive layout reads/writes on pointermove;
- heavy animation on layout properties;
- unbounded event listeners;
- loading huge component libraries for a few primitives;
- memoization that increases complexity without measurable benefit.

## Testing

Measure interaction under:

- slower CPU;
- slow network;
- large realistic datasets;
- repeated state changes;
- narrow devices;
- low-memory conditions when relevant.
