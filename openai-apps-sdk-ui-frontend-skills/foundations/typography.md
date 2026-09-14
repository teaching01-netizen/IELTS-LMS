# Skill: Typography

## Purpose

Use Apps SDK UI typography utilities to create readable, compact hierarchy
without inventing a parallel type scale.

## Current Typography Families

Apps SDK UI exposes heading utilities such as:

```text
heading-xs
heading-sm
heading-md
heading-lg
heading-xl
heading-2xl
heading-3xl
heading-4xl
heading-5xl
```

and text utilities such as:

```text
text-3xs
text-2xs
text-xs
text-sm
text-md
text-lg
```

Representative current values include:

```text
heading-xs  16px, semibold
heading-sm  18px, semibold
heading-md  20px, semibold
heading-lg  24px, semibold
heading-xl  32px, semibold

text-xs     12px
text-sm     14px
text-md     16px
text-lg     18px
```

Verify installed package output when exact values matter.

## Mental Model

Hierarchy should emerge from:

```text
size
weight
spacing
foreground contrast
grouping
```

Do not rely on size alone.

## Best Practices

- Use smaller headings in compact ChatGPT surfaces.
- Use semibold intentionally rather than bolding everything.
- Preserve readable line height.
- Use `text-secondary`/`text-tertiary` for supporting information.
- Avoid tiny text for interactive labels or essential information.
- Let content wrap unless truncation is a deliberate product requirement.

## Example

```tsx
<section>
  <p className="text-sm text-secondary">Reservation</p>
  <h2 className="heading-lg">La Luna Bistro</h2>
  <p className="text-sm text-secondary">Friday · 7:30 PM</p>
</section>
```

## Decision Rules

If a hierarchy problem can be solved with spacing/weight:
→ do not automatically increase font size.

If content is metadata:
→ reduce emphasis, not readability.

If a label is essential:
→ do not hide it behind placeholder-only UI.

If text may localize:
→ allow more space and wrapping.

## Anti-Patterns

- custom 13/15/17/21/27px scales per screen;
- all-important text in `font-bold`;
- excessive large headings inside compact cards;
- low-contrast body copy;
- truncating content merely to preserve a screenshot.

## Accessibility

- Maintain readable contrast.
- Avoid tiny essential text.
- Preserve zoom behavior.
- Use semantic heading structure where the document hierarchy needs it.

## Testing

Test with:

- long titles;
- narrow containers;
- browser zoom;
- dark mode;
- translated strings;
- dynamic generated content.
