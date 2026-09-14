# Skill: Selection Controls

## Purpose

Choose and implement `Select`, `RadioGroup`, `Checkbox`, `Switch`,
`SegmentedControl`, `Slider`, `TagInput`, and related selection patterns.

## Decision Matrix

```text
independent yes/no choice     → Checkbox
immediate on/off setting      → Switch
one of few visible options    → RadioGroup
compact mode/view choice      → SegmentedControl
many options                  → Select
multiple selected tags/tokens → TagInput or multi-select
continuous numeric value      → Slider
```

## Select

Current Select capabilities include:

- custom trigger rendering;
- custom option rendering;
- descriptions/tooltips;
- actions;
- grouped options;
- multiple selection;
- conditional search for larger option sets.

Do not rebuild a searchable dropdown before checking whether `Select` already
covers the use case.

## RadioGroup

Prefer when:

- the option set is small;
- comparing options matters;
- choices should stay visible.

Do not use a 20-item radio group.

## Switch

A switch usually represents a setting whose state changes immediately.

Avoid pairing a switch with a separate "Save this switch" mental model unless
the product explicitly batches settings.

## Checkbox

Use when options are independently selectable or for explicit opt-in/selection.

## SegmentedControl

Use for a small number of compact, mutually exclusive modes such as:

```text
List | Grid
Day | Week | Month
Preview | Code
```

Keep the option count low.

## Slider

Use only when a continuous/relative adjustment is easier than exact text entry.
Provide a visible value when users need precision.

## Decision Rules

If users need to compare all options:
→ RadioGroup.

If choices are numerous:
→ Select.

If binary state applies immediately:
→ Switch.

If binary selection is part of form submission:
→ Checkbox is often clearer.

If exact numeric precision matters:
→ consider Input rather than Slider, or pair them.

## Accessibility

- label every group;
- preserve keyboard interaction;
- do not use color alone for selected state;
- ensure selected/current state is perceivable;
- keep touch targets usable.

## Testing

Test keyboard selection, disabled options, long option labels, narrow layouts,
multiple selection, clearing/resetting, and controlled value updates.
