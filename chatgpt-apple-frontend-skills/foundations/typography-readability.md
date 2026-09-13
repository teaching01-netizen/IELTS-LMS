# Skill: Typography and Readability

## Purpose

Own the type system, text measure, hierarchy, line rhythm, truncation behavior, and long-form reading quality.

## Use This Skill When

- A page contains passages, chat, documentation, forms, tables, or dense labels.
- Text feels tiring, cramped, or visually inconsistent.
- Responsive layouts cause wrapping or alignment bugs.

## Goals

- Make long reading comfortable.
- Keep UI labels quickly scannable.
- Support Thai, Latin, and other scripts without clipping.
- Avoid hierarchy that depends only on font size.

## Mental Model

Typography is layout. Font metrics, line height, measure, weight, wrapping, and alignment determine both readability and spatial rhythm.

## Core Principles

- Content and task completion outrank decoration.
- Prefer familiar interaction patterns over novel controls unless the novel pattern measurably improves the task.
- Accessibility, keyboard continuity, and touch usability are part of the component contract, not QA cleanup.
- Use semantic design tokens and stable component APIs so visual refinement does not leak into feature code.
- Keep motion short, interruptible, and meaningful; never make users wait for animation.
- Design for narrow, wide, touch, pointer, keyboard, reduced-motion, zoomed text, localization, and loading/error states from the start.
- Body text should be calmer than headings but never low-contrast.
- Use weight and spacing before extreme size jumps.

## Architecture

Separate text roles:

```text
display / page title
section heading
body / reading
UI label
metadata / secondary
caption / helper
code / data
```

Each role has a controlled size, line-height, weight, and intended context.

## Best Practices

- For reading surfaces, constrain line length rather than stretching text across wide panels.
- Use unitless or relative line-height where possible so zoom and font fallback behave well.
- Keep UI labels concise and avoid unnecessary all-caps.
- Use tabular numerals for aligned timers, metrics, and financial data when supported.
- Allow text to wrap before truncating unless the layout truly requires single-line identification.
- Test Thai combining marks and line-height; do not tune only against Latin screenshots.
- Use system/local fallback stacks unless custom-font licensing and performance are explicit product requirements.

## Implementation Patterns

- Use `max-inline-size` for reading columns.
- Use semantic type tokens instead of arbitrary `font-size`.
- Use `text-wrap: balance` selectively for short headings, not long body text.

## Decision Rules

- If content is meant to be read → prioritize measure and line-height.
- If content is meant to be scanned → prioritize concise labels and alignment.
- If truncation hides information needed to choose an item → wrap, expand, or provide detail access.
- If a narrow layout causes heading domination → step down display size at the component/container level.

## States and Edge Cases

- Long words/URLs.
- Thai and CJK.
- 200% zoom.
- User font scaling.
- Bold-text preference.
- Narrow panels.
- Dynamic values changing width.
- Code/math inline.

## Anti-Patterns

- Body text at low contrast.
- Very long lines on desktop.
- Fixed-height text containers.
- Truncating critical labels without a recovery path.
- Using a display font for dense UI.
- Tuning line-height so tightly diacritics clip.

## Performance

- Prefer local/system fonts for critical UI paths.
- Subset custom fonts carefully if used.
- Avoid loading many weights that are visually redundant.

## Accessibility

- Text must survive zoom and browser minimum-font settings.
- Do not encode hierarchy using color alone.
- Maintain readable focus/selection styling around editable text.

## Testing

- Snapshot at 320, 768, 1024, 1440px widths.
- Test Latin + Thai + long localization strings.
- Zoom to 200%.
- Test font loading failure.
- Check text selection and copy behavior.

## Production Checklist

- Reading measure constrained.
- Line height script-safe.
- Type roles tokenized.
- Critical labels never irrecoverably truncated.
- Numeric data alignment intentional.

## Review Heuristics

- Can users read for ten minutes without fatigue?
- Does the same hierarchy survive Thai text?
- Does narrowing the panel reflow naturally rather than clipping?

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
