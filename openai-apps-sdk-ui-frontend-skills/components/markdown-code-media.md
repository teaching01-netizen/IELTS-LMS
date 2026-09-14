# Skill: Markdown, Code, and Media

## Purpose

Render rich generated content, source code, icons, and images using Apps SDK UI
primitives while preserving semantics, readability, security, and theme support.

## Markdown

Use the library `Markdown` component for rich formatted content rather than
creating a parallel Markdown theme.

Current Markdown supports optional math rendering:

```tsx
<Markdown includeMath>{content}</Markdown>
```

Use this when LaTeX/math support is required.

Do not bypass sanitization to reproduce arbitrary HTML formatting.

## CodeBlock

Use `CodeBlock` for source code rather than ad-hoc `<pre>` styling when the
design-system primitive fits.

Consider:

- long lines;
- horizontal scrolling;
- copy behavior;
- syntax/theme readability;
- mobile width.

## Icons

Use Apps SDK UI icons when available to maintain visual consistency.

Icon-only actions still need an accessible name:

```tsx
<Button aria-label="Delete item" uniform>
  <Delete />
</Button>
```

Avoid tuning every icon to arbitrary pixel sizes when control APIs already
provide sizing.

## Images

Images should preserve:

- aspect ratio;
- meaningful `alt`;
- responsive sizing;
- loading behavior;
- theme compatibility;
- fallback strategy where useful.

Decorative images should not create redundant announcements.

## Decision Rules

Generated formatted text:
→ Markdown.

Code:
→ CodeBlock.

UI symbol:
→ Apps SDK UI Icon if available.

Meaningful image:
→ Image/media element with appropriate alt text.

## Anti-Patterns

- rendering text as an image;
- unsafe raw HTML injection;
- custom code block that ignores theme/overflow;
- icon-only button with no name;
- transparent image not tested on dark theme.

## Testing

- long Markdown;
- headings/lists/links;
- math if enabled;
- long code lines;
- copy;
- dark mode;
- image failure/slow load;
- narrow container.
