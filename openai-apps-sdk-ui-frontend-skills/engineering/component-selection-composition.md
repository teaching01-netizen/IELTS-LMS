# Skill: Component Selection and Composition

## Purpose

Choose the correct Apps SDK UI primitive for the semantic interaction and
compose components without rebuilding their behavior.

## Mental Model

Ask what the UI **is**, not what it visually resembles.

```text
action?                    → Button
navigation?                → TextLink / ButtonLink
command list?              → Menu
arbitrary contextual UI?   → Popover
short input?               → Input
long input?                → Textarea
many choices?              → Select
single visible choice?     → RadioGroup
boolean setting?           → Switch
independent binary choice? → Checkbox
compact mode selector?     → SegmentedControl
continuous value?          → Slider
status/category?           → Badge / Indicator
important feedback?        → Alert
rich generated content?    → Markdown
code?                      → CodeBlock
```

## Component Inventory

Current library areas include components such as:

```text
Alert
AppsSDKUIProvider
Avatar / AvatarGroup
Badge
Button / ButtonLink / CopyButton
Checkbox
CodeBlock
DatePicker
DateRangePicker
EmptyMessage
Icon
Image
Indicator
Input
Markdown
Menu
Popover
RadioGroup
SegmentedControl
Select
SelectControl
ShimmerText
Slider
Switch
TagInput
TextLink
Textarea
Tooltip
Transition
```

Verify exact exports and props in the installed version.

## Composition Rules

- Keep primitives responsible for primitive behavior.
- Put domain behavior in feature components.
- Use layout wrappers for layout, not semantic reinvention.
- Avoid wrappers that only rename variants.

Useful abstraction:

```text
SubmitAnswerButton
```

if it owns submission state, analytics, or domain behavior.

Weak abstraction:

```text
BluePrimaryButton
```

if it only hardcodes styling.

## Decision Rules

If a primitive already supports the interaction:
→ use it.

If two features merely look similar today:
→ do not abstract yet.

If behavior must stay consistent across features:
→ create a domain wrapper around the public API.

If the desired UI conflicts with semantic behavior:
→ preserve semantics and adjust the visual solution.

## Anti-Patterns

- clickable `div`;
- hand-built dropdown when `Select` fits;
- `Menu` used as generic popover;
- nested custom buttons inside button-like containers;
- copying component source to tweak padding.

## Review Heuristics

- What semantic role does this component play?
- Which existing primitive already owns the keyboard/focus model?
- Is our abstraction domain-driven?
- Are we preserving the public API boundary?
