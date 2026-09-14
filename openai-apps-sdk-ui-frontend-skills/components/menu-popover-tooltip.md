# Skill: Menu, Popover, and Tooltip

## Purpose

Use floating UI according to its semantic interaction model rather than visual
appearance.

## Critical Distinction

```text
structured list of commands → Menu
arbitrary contextual UI     → Popover
brief supplementary help    → Tooltip
```

## Menu

Use for commands such as:

```text
Rename
Duplicate
Move
Delete
```

Current Menu primitives include patterns such as:

```text
Menu.Trigger
Menu.Content
Menu.Item
Menu.Link
Menu.Separator
Menu.Sub
Menu.SubTrigger
Menu.SubContent
Menu.CheckboxItem
Menu.RadioGroup
Menu.RadioItem
Menu.ItemActions
```

The current Menu intentionally owns menu keyboard behavior and is not suitable
as a generic popover. Its handling of Tab differs from normal content.

Do not put arbitrary forms into Menu.

## Popover

Use for contextual interactive content:

```text
filter form
mini editor
configuration panel
color chooser
contextual details
```

Current Popover behavior includes focus-aware hover options, controller APIs,
nesting, viewport collision sizing, and layered Escape handling.

Preserve these behaviors instead of reimplementing overlay mechanics.

Hover-triggered popovers should be used sparingly.

## Tooltip

Use for brief supplemental explanation.

Tooltip must not be the only way to discover:

- required instructions;
- critical actions;
- errors;
- essential data.

## Decision Rules

If content is a command list:
→ Menu.

If content contains arbitrary controls or form fields:
→ Popover.

If content is only a short explanation:
→ Tooltip.

If workflow becomes multi-step or dense:
→ consider a larger dedicated surface rather than an oversized popover.

## Item Actions

If Menu item hover actions are not keyboard-accessible in the underlying menu
model, do not make them the only path to a critical action.

## Anti-Patterns

- generic popover built with Menu because it "looks right";
- hover-only critical controls;
- nested absolute-position divs replacing overlay primitives;
- tooltip containing paragraphs/forms;
- hiding main actions inside overflow purely for visual minimalism.

## Testing

Verify:

- trigger keyboard activation;
- focus movement/restoration;
- Escape behavior;
- nested overlay behavior;
- pointer/touch;
- viewport collision;
- long menu labels;
- critical action parity.
