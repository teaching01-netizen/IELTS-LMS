# Skill: Perceived Performance and Continuity

## Purpose

Make the product feel fast and stable even when work is asynchronous or network-bound.

## Mental Model

Users judge speed from acknowledgement, continuity, and predictability—not only milliseconds.

## Principles

- acknowledge actions immediately;
- preserve context during refresh;
- reserve layout space;
- avoid blanking useful content;
- show progress only where it helps;
- keep skeleton geometry aligned with final content;
- avoid fake loading delays;
- avoid progress indicators that restart unnecessarily.

## Skeletons

Use when:

- the final structure is predictable;
- loading is long enough to be perceptible;
- layout stability matters.

Do not skeleton every tiny control.

Avoid shimmering large portions of a page continuously if a simpler stable placeholder works.

## Revalidation

When existing data is still useful:

- keep it visible;
- mark updating state subtly;
- replace only when fresh data arrives.

## Optimistic Feedback

Good candidates:

- favorites;
- toggles;
- lightweight preference updates;
- low-risk reordering.

Use rollback/error reconciliation.

## Transition Continuity

For page or panel transitions:

- keep anchors stable;
- preserve scroll when appropriate;
- preserve selection;
- avoid full-screen flashes;
- keep persistent navigation persistent.

## Anti-Patterns

- spinner replacing an entire data table during a tiny filter change;
- skeleton dimensions unlike final content;
- blocking toast saying “Loading…”;
- artificial minimum loading times;
- re-render flicker on every mutation;
- optimistic behavior for risky actions without recovery.
