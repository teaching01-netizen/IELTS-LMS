# Skill: Apps SDK UI Installation and Setup

## Purpose

Own the complete installation and build integration of `@openai/apps-sdk-ui`.

## Use This Skill When

- starting a new Apps SDK UI project;
- adding Apps SDK UI to an existing React app;
- components render but appear unstyled;
- semantic classes do not resolve;
- production styling differs from development;
- Tailwind scanning is incomplete;
- upgrading Tailwind or Apps SDK UI.

## Goals

A correct setup should provide:

- React 18 or 19;
- Tailwind CSS 4;
- `@openai/apps-sdk-ui` installed;
- foundation CSS loaded globally;
- Tailwind package source scanning configured;
- CSS imported before rendering;
- a smoke test proving tokens and components work.

## Mental Model

```text
React
+
Tailwind 4 build
+
Apps SDK UI CSS
+
Tailwind scans Apps SDK UI package source
=
correct component rendering
```

Successful TypeScript imports do **not** prove styling is configured.

## Current Documented Installation

### 1. Verify prerequisites

```bash
npm ls react react-dom tailwindcss
```

Current documented compatibility:

```text
React 18 or 19
Tailwind CSS 4
```

Do not replace a working package-manager or framework setup unnecessarily.

### 2. Install the package

```bash
npm install @openai/apps-sdk-ui
```

Use the repository's package manager if different:

```bash
pnpm add @openai/apps-sdk-ui
yarn add @openai/apps-sdk-ui
```

### 3. Configure the global stylesheet

At the top of the main global stylesheet:

```css
@import "tailwindcss";
@import "@openai/apps-sdk-ui/css";

/* Required so Tailwind discovers class references used by the package. */
@source "../node_modules/@openai/apps-sdk-ui";

/* Application CSS follows. */
```

The `@source` path is relative to the stylesheet/build environment. In a
monorepo or hoisted dependency structure, verify the real location instead of
blindly copying the example path.

### 4. Import styles before rendering components

```tsx
import "./main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Foundation styles should exist before component styles are evaluated.

## Smoke Test

```tsx
import { Button } from "@openai/apps-sdk-ui/components/Button";

export function AppsSDKUISmokeTest() {
  return (
    <div className="rounded-2xl border border-default bg-surface p-4">
      <p className="text-sm text-secondary">Apps SDK UI check</p>

      <Button color="primary" className="mt-3">
        Working
      </Button>
    </div>
  );
}
```

Verify:

- the button is visibly styled;
- semantic classes such as `bg-surface`, `border-default`, and
  `text-secondary` work;
- focus and hover styles exist;
- a production build keeps the styles;
- dark mode also works after theme setup.

## Decision Rules

If imports fail:
→ inspect installation/version resolution.

If components mount but look unstyled:
→ inspect CSS imports first.

If only some variants are missing styles:
→ inspect `@source` and Tailwind scanning.

If semantic utilities fail:
→ verify `@openai/apps-sdk-ui/css` is imported.

If the project is a monorepo:
→ resolve the real package path used by the CSS build.

If Tailwind 4 is already configured:
→ integrate with that configuration instead of creating a second system.

## Architecture

Keep design-system foundation imports centralized.

Preferred:

```text
src/
├── main.tsx
├── main.css
└── app/
```

Avoid importing the design-system foundation CSS independently inside features.

## Anti-Patterns

- Omitting `@source`.
- Importing Apps SDK UI CSS only inside one lazy route.
- Adding broad `!important` overrides to "fix" missing styles.
- Running Tailwind 3 patterns against a Tailwind 4 setup.
- Duplicating foundation styles in several CSS entry points.
- Assuming local development proves production scanning works.

## Performance

- Import the design-system foundation once.
- Avoid duplicated CSS bundles.
- Let the build tree-shake JavaScript normally.
- Do not add a second component library just to fill minor styling gaps.

## Accessibility

Installation itself affects accessibility if missing styles remove focus
indicators, disabled treatment, or control affordances. A smoke test should
include keyboard focus.

## Testing

Minimum checks:

```text
typecheck
production build
render one Button
render semantic surface classes
keyboard focus
dark mode
```

## Production Checklist

- [ ] React version supported
- [ ] Tailwind 4 present
- [ ] Apps SDK UI installed
- [ ] global CSS imports Tailwind
- [ ] global CSS imports Apps SDK UI CSS
- [ ] `@source` points to Apps SDK UI package
- [ ] global CSS imported before app render
- [ ] smoke test passes in development
- [ ] smoke test passes in production build
- [ ] dark mode verified

## Review Heuristics

Ask:

- Is the design system globally available or accidentally route-scoped?
- Could production purging/scanning remove package styles?
- Are we fixing setup problems with component-level CSS hacks?
- Is package installation consistent with the existing repository conventions?
