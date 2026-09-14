# Skill: Design and UX Review

## Purpose

Perform the final product-quality pass after implementation and identify issues that code correctness alone will not catch.

## Review Order

Review in this order:

1. task clarity;
2. information hierarchy;
3. interaction model;
4. layout and responsive behavior;
5. accessibility/input behavior;
6. content/readability;
7. state completeness;
8. visual consistency;
9. motion;
10. premium craft details.

Do not spend time adjusting shadows before fixing unclear task flow.

## First-Glance Review

Within a few seconds, can a user answer:

- where am I?
- what is this page for?
- what should I do next?
- what is selected/current?
- what is the primary action?

## Interaction Review

For each control:

- is it obviously interactive?
- is the click/touch target sufficient?
- does it respond immediately?
- is focus visible?
- is keyboard behavior expected?
- is loading/error behavior defined?

## Layout Review

Check:

- alignment;
- spacing rhythm;
- width constraints;
- long text;
- empty content;
- awkward mid-width sizes;
- tablet split view;
- 200% zoom;
- sticky/scroll regions;
- overlay clipping.

## Visual Review

Look for:

- excessive borders;
- inconsistent radii;
- noisy color use;
- weak text contrast;
- inconsistent icon scale;
- accidental misalignment;
- shadows without hierarchy;
- repeated one-off values.

## Premium Craft Pass

Inspect slowly:

- hover timing;
- pressed state;
- focus transitions;
- skeleton stability;
- content replacement flicker;
- menu anchoring;
- drag/resize affordance;
- scroll shadows;
- empty-state transitions;
- icon optical alignment;
- truncation;
- error placement;
- focus restoration.

## Severity Model

Classify findings:

- P0: prevents completion, safety, major accessibility issue;
- P1: serious usability/confusion/responsive failure;
- P2: noticeable quality or consistency issue;
- P3: polish/detail improvement.

Fix higher-severity issues before cosmetic refinement.

## Final Acceptance Gate

Approve only when:

- key tasks are obvious;
- component behavior is coherent;
- desktop/tablet/mobile behavior is intentional;
- keyboard/touch usage works;
- error/loading/empty states are complete;
- visual hierarchy is calm and precise;
- motion supports understanding;
- no obvious one-off hacks remain;
- the interface feels like one product, not assembled fragments.
