# Skill: Typography and Content Readability

## Purpose

Make interfaces feel premium through excellent reading rhythm, hierarchy, density, line length, labeling, and text behavior.

## Mental Model

Typography is layout.

Changing font size, weight, line-height, wrapping, or measure changes how the entire interface feels and behaves.

## Principles

- Use few type levels with clear roles.
- Prefer hierarchy from size + weight + spacing, not color alone.
- Keep body text comfortably readable.
- Avoid weak gray-on-gray secondary text.
- Use numeric alignment and tabular figures where repeated numbers must scan.
- Keep operational labels concise.
- Use sentence case unless the product has a strong reason otherwise.
- Avoid overusing bold.

## Suggested Roles

A practical system often needs:

- display/title;
- section heading;
- body;
- body-emphasis;
- label;
- caption/meta;
- numeric/data display.

Do not create a unique style for every screen.

## Readability Rules

Long-form reading:

- maintain a comfortable measure;
- use generous but not airy line-height;
- preserve paragraph separation;
- avoid overly light font weights;
- do not force centered body copy.

Dense application UI:

- shorten labels before shrinking type;
- group related values;
- use alignment to support scanning;
- preserve minimum legibility even in compact density.

## Overflow

For critical text:

- wrap rather than truncate whenever space permits.

For compact repeated rows:

- truncation may be acceptable if the full value remains discoverable.

Never truncate an error message so aggressively that the user cannot understand the problem.

## Content Craft

Prefer precise labels:

- “Save changes” over “Submit” when saving is the task;
- “Try again” over “OK” after a recoverable failure;
- “No invoices yet” over “No data.”

## Anti-Patterns

- using tiny text to create a “luxury” look;
- too many font weights;
- headings with insufficient contrast from body text;
- using all caps for ordinary navigation;
- 70+ character lines in app sidebars;
- arbitrary negative letter spacing across all text;
- hiding important explanatory text in tooltips.

## Testing

Test with:

- 200% zoom;
- longest realistic labels;
- localization expansion;
- large system text when applicable;
- dynamic error messages;
- empty values and placeholder content.
