# Skill: Responsive Layout

## Purpose

Build adaptive interfaces using Apps SDK UI's mobile-first responsive model.

## Mental Model

Wrong:

```text
desktop layout
→ squeeze until it fits mobile
```

Correct:

```text
small usable layout
→ progressively enhance when space exists
```

## Current Default Breakpoints

```text
xs   380px
sm   576px
md   768px
lg   1024px
xl   1280px
2xl  1536px
```

## Tailwind Pattern

```tsx
<div className="flex flex-col lg:flex-row">
```

Base classes apply to narrow layouts; breakpoint classes enhance wider layouts.

## React Breakpoint Hook

For behavior that truly needs JavaScript:

```tsx
import { useBreakpoint }
  from "@openai/apps-sdk-ui/hooks/useBreakpoint";

const isMedium = useBreakpoint("md");
```

Do not use JS for layout that CSS can express.

## ChatGPT-Surface Rule

Do not assume the app owns the viewport. Design for constrained embedded
containers.

Test:

```text
very narrow
phone-like
tablet-like
comfortable desktop width
```

## Robust Layout Patterns

Use:

```text
min-w-0
flex-wrap
grid
shrink-0
break-words
overflow-auto where intentional
```

Treat truncation as a product decision, not a default cleanup trick.

## Decision Rules

If only visual arrangement changes:
→ CSS breakpoint.

If component behavior changes materially:
→ consider `useBreakpoint`.

If a control must remain usable:
→ preserve target size and allow surrounding content to wrap.

If horizontal overflow is caused by text:
→ investigate `min-w-0`, wrapping, and fixed children before hiding overflow.

## Anti-Patterns

- hardcoded desktop widths;
- many media-query patches after desktop implementation;
- JS viewport listeners for simple layout;
- `overflow-hidden` masking layout bugs;
- shrinking touch targets to preserve one row.

## Testing

Use long labels and dynamic content, not only ideal fixtures.

Verify:

- no unintended horizontal scrolling;
- overlays remain on-screen;
- actions wrap or reflow coherently;
- text stays readable;
- touch targets remain usable.

## Production Checklist

- [ ] narrow-first implementation
- [ ] standard breakpoints used unless justified
- [ ] no avoidable JS layout detection
- [ ] long content tested
- [ ] no accidental clipping
- [ ] controls do not collapse below usable size
