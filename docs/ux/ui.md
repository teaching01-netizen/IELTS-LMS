# Recommended Design System for Your SAT Internal Platform

My recommendation: Copy the visual language of Linear and implement it using shadcn/ui + Tailwind CSS 4 + Radix UI.

Use Vercel Geist Design System as the reference for typography, spacing, colors, and precise component styling.

This gives your SAT platform the polished feel of a professional SaaS application without introducing a completely different technology stack.

References: Linear's redesigned workspace and Vercel's Geist Design System.

## 1. The three references to follow

1\. Linear — Copy the overall product experience

Use its understated navigation, information-dense lists, selected-row treatments, side panels, and smooth interactions.

[Linear's official redesign explanation](https://linear.app/now/how-we-redesigned-the-linear-ui).&#x20;

2\. shadcn/ui — Copy the React component patterns

Buttons, dialogs, sheets, dropdowns, data tables, forms, and sidebars built for modern React applications.

[Official dashboard examples](https://ui.shadcn.com/blocks?category=dashboard).&#x20;

[image](https://www.google.com/s2/favicons?domain=https://ui.shadcn.com\&sz=32)

shadcn/ui



3\. Vercel Geist Design System — Copy the visual foundations

Neutral surfaces, high-contrast typography, precise spacing, subtle borders, and restrained color.

[Official Geist documentation](https://vercel.com/geist/introduction).&#x20;

[image](https://www.google.com/s2/favicons?domain=https://vercel.com\&sz=32)

vercel.com



Important: These are design references, not three component libraries to install together. Your repository already uses React, Radix, Tailwind and several shadcn-style primitives. Extend what you have rather than replacing everything.

## 2. SAT Staff Design System — Recommended specification

Call the internal system SAT Staff UI. One visual language should apply to Exams, Authoring, Publishing, Rooms, and Responses.

### Colors

Use your existing SAT staff blue as the accent and a light, neutral workspace.

Canvas

\#F7F7F8

Surface

\#FFFFFF

Primary text

\#1D1D1F

Secondary text

\#515154

Hairline

\#E9E9EC

Accent

\#0071E3

Success

\#067647

Warning

\#92400E

Danger

\#B42318

These colors are close to the project's existing design tokens, so this is a consolidation rather than a new brand. Verify foreground/background contrast for all supported component states.

### Component sizing

| Property           | Standard                                       |
| ------------------ | ---------------------------------------------- |
| Font               | Inter, already configured in your project      |
| Page title         | 24px / 600                                     |
| Section title      | 16–18px / 600                                  |
| Body               | 14px / 400–500                                 |
| Supporting text    | 12–13px                                        |
| Buttons and inputs | 40px visually; 44px minimum interactive target |
| Control radius     | 10px                                           |
| Card radius        | 14px                                           |
| Dialog radius      | 18px                                           |
| Sidebar width      | Approximately 240px, collapsible               |
| Standard spacing   | 8 / 12 / 16 / 24 / 32px                        |
| Borders            | 1px, low contrast                              |
| Shadows            | None by default; subtle for floating surfaces  |

These should map to your existing `--sat-staff-*` variables in `src/index.css`, not become duplicate hardcoded values in every component.

## 3. What to copy for each SAT screen

| Your SAT screen | Reference pattern           | Design approach                                                           |
| --------------- | --------------------------- | ------------------------------------------------------------------------- |
| Exam library    | Linear issue list           | Compact exam rows, status, search, one primary Create exam action         |
| Exam authoring  | Notion-style editor         | Focused editing canvas, unobtrusive outline, contextual tools             |
| Publish         | Geist dialog / validation   | Simple readiness summary, actionable issues, one primary Publish action   |
| Create room     | shadcn form + sheet         | A short form, progressive disclosure, no unnecessary stepper              |
| Live room       | Linear split-pane workspace | Students on the left, operational context on the right, student inspector |
| Responses       | shadcn data table           | Search, filters, sortable rows, clear result states and exports           |
| Settings        | Geist settings layout       | Grouped sections, concise explanations, no crowded cards                  |

The visual styling stays consistent. Only the interaction layout changes to suit the task.

## 4. The React components to standardize

Your repository already has many reusable UI primitives. Rather than installing an entire dashboard kit, standardize the following set across the internal SAT experience.

Application shell

Sidebar, header, breadcrumbs, page title, contextual actions

Data display

Lists, tables, statuses, filters, empty states

Forms

Inputs, selects, switches, validation, buttons

Overlays

Sheets, dialogs, dropdowns, tooltips, confirmations

For implementation, use the existing Radix-based components, with shadcn/ui as the reference for composability and styling. Radix handles many focus-management and keyboard patterns that are especially important during live exam operation.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.radix-ui.com\&sz=32)

Radix Primitives



The recommended shadcn styling reference is the restrained New York family, rather than oversized cards or highly decorative dashboard templates. The official Tailwind v4 guidance supports React 19 and CSS-variable-based theming.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://ui.shadcn.com\&sz=32)

shadcn/ui

+1



## 5. Specific templates worth copying

These are the practical starting points I'd give your frontend developer.

[shadcn Sidebar-07](https://ui.shadcn.com/blocks/sidebar)

For the SAT navigation. Copy its collapsible layout and active-item treatment, adapting it to your existing roles and routes.

[shadcn Dashboard-01](https://ui.shadcn.com/blocks?category=dashboard)

For tables, top-level page layout, and responsive dashboard composition. Skip unnecessary analytics charts and metric cards.

[Linear workspace redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)

For the Room and Responses pages: information hierarchy, list selection, contextual panels, and compact navigation.

The Linear redesign is particularly relevant: its designers explicitly focused on reducing visual noise, improving alignment, and creating a consistent hierarchy across lists, panels, headers, and navigation.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://linear.app\&sz=32)

linear.app



## 6. Rules for keeping the design professional

These should be enforced during code review.

| Prefer                                      | Avoid                                             |
| ------------------------------------------- | ------------------------------------------------- |
| One clear primary action per screen state   | Three or four competing primary buttons           |
| Quiet white and neutral surfaces            | Every section filled with a different color       |
| Flat lists with subtle separators           | One oversized card per row                        |
| Contextual student inspector                | Large permanent panels showing irrelevant details |
| Simple status text and icons                | Excessive badges, colored pills and animation     |
| Consistent 10–18px corner radius system     | Random 6px, 12px, 20px, 28px radii                |
| Tailwind utilities backed by tokens         | Repeated arbitrary hex values                     |
| Predictable focus and keyboard interactions | Hover-only actions and decorative controls        |

I would also use light mode as the initial reference implementation. Dark mode can follow using the same semantic tokens, but don't let it delay fixing consistency across existing SAT screens.

## 7. How to adopt it in IELTS-LMS

The sensible order is to establish a few canonical components and migrate screens gradually.

```

src/products/sat/ui/
  design-system/
    SatStaffButton.tsx
    SatStaffSurface.tsx
    SatStaffStatus.tsx
    SatStaffPageHeader.tsx
    SatStaffEmptyState.tsx
    SatStaffListRow.tsx

```

Only create a component when an existing `SatPage` or shared component doesn't already satisfy the same role. Use `src/index.css` as the canonical token source; keep the new directory small.

First apply the system to SAT Room, because it exercises buttons, lists, panels, statuses and dialogs together. Then adopt the same primitives in Exams, Authoring, Publish and Responses. Use Storybook stories and Playwright screenshots to prevent visual drift.

The direction I'd commit to is:

SAT Staff UI

Design direction v1

# Linear-like clarity. Geist-like precision.

Implemented with your existing React + Tailwind + Radix stack, using shadcn/ui component patterns.

Neutral surfaces

Compact typography

Minimal borders

Contextual actions

This is the strongest fit for your project because it improves the appearance without forcing a framework migration or sacrificing operational clarity during a live SAT exam.