# IELTS Proctoring System Design System

## 1. Atmosphere & Identity

The admin experience is a quiet, information-dense grading command center. It uses
Atlassian-inspired blue actions, neutral panels, and restrained status colors so a
grader can compare evidence quickly without losing the student's context. The
signature is a split evidence surface: answer data stays readable in white cards,
while correctness and override state are carried by small, explicit status treatments.

## 2. Color

### Palette

| Role | Token | Value | Usage |
|------|------|------|------|
| Surface/primary | `--surface-primary` | `#FFFFFF` | Main workspace and cards |
| Surface/secondary | `--surface-secondary` | `#F4F5F7` | Rails, table headers, quiet panels |
| Surface/elevated | `--surface-elevated` | `#FFFFFF` | Dialogs and selected evidence |
| Text/primary | `--text-primary` | `#172B4D` | Headings and answer content |
| Text/secondary | `--text-secondary` | `#42526E` | Supporting labels and metadata |
| Text/tertiary | `--text-tertiary` | `#7A869A` | Captions and overlines |
| Border/default | `--border-default` | `#C1C7D0` | Card outlines and controls |
| Border/subtle | `--border-subtle` | `#DFE1E6` | Dividers and row separation |
| Accent/primary | `--accent-primary` | `#0052CC` | Primary actions and focus |
| Accent/hover | `--accent-hover` | `#0065FF` | Hover and active action states |
| Status/success | `--status-success` | `#00875A` | Correct and saved states |
| Status/warning | `--status-warning` | `#FF991F` | Review and caution states |
| Status/error | `--status-error` | `#DE350B` | Incorrect and destructive states |
| Status/info | `--status-info` | `#0065FF` | Informational status |

Accent is reserved for interaction. Status colors always appear with text or an icon,
never as color-only meaning.

## 3. Typography

### Scale

| Level | Size | Weight | Usage |
|------|------|--------|------|
| Page title | 30px | 700 | Admin page title |
| Section title | 24px | 700 | Major grading section |
| Card title | 20px | 600 | Evidence card headings |
| Body | 16px | 400 | Primary answer content |
| Body/sm | 14px | 400 | Supporting text and controls |
| Caption | 12px | 500 | Metadata and badges |
| Overline | 11px | 600 | Uppercase section labels |

Primary font: `Inter, ui-sans-serif, system-ui, sans-serif`.
Mono font: `JetBrains Mono, ui-monospace, monospace` for IDs and machine values.

## 4. Spacing & Layout

All spacing uses the existing 4px base scale: 4, 8, 12, 16, 20, 24, 32, 40, and
48px. The grading shell is a three-region layout: a 240px navigation rail, a flexible
evidence canvas, and a 384px grading rail. The evidence canvas reflows to one column
at narrow widths; answer/key cards remain stacked and readable. The admin navigation
and review sections become drawers on small screens, while the rubric rail is deferred
below the desktop breakpoint so objective answer controls retain usable width.

## 5. Components

### Answer comparison row

- **Structure**: question label, prompt, student answer, answer key, correctness badge,
  and a two-state grader override control.
- **Variants**: correct, incorrect, not scored, pending save, saved override, save error.
- **Spacing**: 12px internal cells, 16px card padding, 24px between row groups.
- **States**: default, hover, focus-visible, disabled while saving, success, error.
- **Accessibility**: semantic table headers where tabular; controls use labels and
  `aria-pressed`/native checkbox semantics; correctness is written as text.
- **Motion**: 100–150ms color/opacity feedback only; reduced motion is respected.
- **Layout**: data table inside the evidence canvas; no viewport-level scroll ownership.

### Status badge

- **Structure**: inline icon plus text label.
- **Variants**: Correct, Incorrect, Not scored, Saved, Error.
- **Spacing**: 8px horizontal padding, 4px vertical padding.
- **States**: static status with focus delegated to its owning control.
- **Accessibility**: text label is always present; color is supplementary.

### Grading panel

- **Structure**: header, answer comparison rows, and footer/action feedback.
- **Variants**: loading, empty, populated, error.
- **Spacing**: 16px panel padding, 24px section separation.
- **States**: loading skeleton, empty message, populated, mutation pending/success/error.
- **Accessibility**: heading hierarchy, live region for save feedback, keyboard-reachable
  controls, and visible focus rings.
- **Motion**: 200–300ms panel/state transitions only.
- **Layout**: stack within the center evidence canvas.

### Exam answer group summary

- **Structure**: student answer, current key, affected student/question counts, decision status, primary accept action, secondary reject action, and an expandable evidence table.
- **Variants**: correct, incorrect, saving, saved confirmation, and save error.
- **Accessibility**: group actions use explicit labels, evidence uses a native disclosure button with `aria-expanded`/`aria-controls`, status is written as text, and high-impact decisions use a labelled confirmation dialog.
- **Interaction**: details are collapsed by default; confirmation states the exact scope before regrading; successful mutations announce the affected questions and students in a live status region.

## 6. Motion & Interaction

Interactive feedback uses existing Tailwind transitions and the global reduced-motion
rule. No layout properties animate. Saving an override keeps the row stable and changes
only status/opacity so the grader's reading position is not disrupted.

## 7. Depth & Surface

Strategy: mixed. White cards use a 1px neutral border plus the existing subtle shadow;
correct and incorrect rows add a low-contrast tonal tint. Avoid decorative gradients or
additional shadows in grading evidence.

## 8. Accessibility Constraints & Accepted Debt

Target WCAG 2.2 AA: 4.5:1 body-text contrast, visible focus for every interactive
element, full keyboard reachability, semantic form controls, and `prefers-reduced-motion`
support. Existing admin screens still contain some raw Tailwind color classes rather than
named component tokens; this change preserves those established classes and adds no new
color family.
