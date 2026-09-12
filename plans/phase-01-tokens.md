# Phase 01 — Staff Token Foundation (.sat-product)

> PLAN ONLY — no product code edits. Implementation agent executes this plan verbatim.
> Scope boundary: `src/index.css` (`.sat-product` scope ONLY). Exam-mode Bluebook (`.sat-ui`, `src/features/student-delivery/**`) is READ-ONLY. IELTS surfaces + backend out of scope.
> Style direction: 2026 soft-spatial per `plans/overall-plan.md` §1 — layered cards, 1px border + very soft shadow, 16–24px radii, calm `#F5F5F7`-family canvas, glass sparingly with solid fallback, no neon/gradients/neumorphism, 150–200ms motion, no springs in lists.

## 1. Objective

Define the complete `.sat-product` high-end token set in `src/index.css` **without touching any `.tsx` component**, so Phases 02/03/04A/04B can converge onto tokens instead of inline hex/alphas.

Concrete deliverable: one new token block inside the existing `.sat-product` scope in `src/index.css` (adjacent to the current `lines ~1579–1602` semantic block and `lines ~1725–1740` elevation block) declaring the full `--sat-staff-*` family:

- canvas / surface / raised / glass (+ solid fallbacks)
- border / separator / fill / press
- text (label / secondary / tertiary / disabled / inverse) — AA-checked pairs only
- accent (+ hover / active / tint / ring) + destructive (+ hover) + success / warning / danger families (dot vs. text variants)
- focus ring (width / color / offset)
- radius scale (control / card / sheet / dialog)
- shadow scale (card / menu / dialog / drag)
- motion (durations / ease / stagger cap / shimmer / spinner / live-dot)
- reduced-motion + reduced-transparency + contrast/forced-colors overrides referencing tokens, not literals

Exit state: tokens exist, **unused by components yet** (zero `.tsx` diff), all existing CSS-contract + primitive tests still green.

## 2. Dependencies

- **Upstream (requires): NONE.** Phase 01 is Wave 1 root. Reads `plans/overall-plan.md` (§1 Goal, §3 Architecture, §4 Phase 01, §7 gates) as normative input.
- **Downstream (provides — do NOT implement here):**
  - Phase 02 (SatRoot shell) consumes: `--sat-staff-glass-*`, `--sat-staff-nav-*`, `--sat-staff-canvas/text/border/shadow/motion-*`, solid-fallback + `prefers-reduced-transparency` behavior.
  - Phase 03 (SatPage/Menu/Segmented/ConfirmDialog) consumes: the ENTIRE `--sat-staff-*` table (§6) — button/accent, search-field, pill tones, row/card, stat-strip, empty, skeleton-shimmer, inline-error, section-card, eyebrow/meta, menu elevation, segmented track/thumb, dialog scrim/card/elevation, focus ring, motion.
  - Phase 04A/04B consume tokens **only through Phase-03 primitive props** (never raw hex); any token gap they find is filed back to the Phase-01 owner, not patched locally.
  - Phase 05 verifies: typecheck + scoped/full vitest + eslint + `npm run e2e:sat-a11y` + contrast/spot checks + motion audit.
- **Ownership lock:** this plan edits ONLY `src/index.css` inside `.sat-product` (plus this plan file). It MUST NOT edit `src/products/sat/**/*.tsx`, `src/products/sat/**/__tests__/**`, `.sat-ui` rules, `@theme` `--color-au-*` definitions, or `--sat-accent-core`. If a shared value must diverge, **fork as `--sat-staff-*`** (overall-plan §3 rule).

## 3. Affected / New Files

| File | Action | Notes |
|---|---|---|
| `src/index.css` | **EDIT (only product file)** — append `--sat-staff-*` declarations inside the two existing `.sat-product` blocks; extend the existing `@media (prefers-reduced-transparency)`, `@media (prefers-contrast: more)`, `@media (forced-colors: active)`, `@media (prefers-reduced-motion: reduce)` guards to reference the new tokens | Approx. lines: semantic block `1579–1602`, elevation block `1725–1740`, guards `1671–1718` + `2035–2066`. Do not renumber/reformat unrelated rules. |
| `plans/phase-01-tokens.md` | **CREATE (this file)** | Only file this planning agent writes. |
| `src/products/sat/**/*.tsx` | **NO TOUCH** (read-only for audit) | Audited: `SatRoot.tsx` (195 lines), `ui/SatPage.tsx` (442), `ui/Menu.tsx` (233), `ui/SegmentedControl.tsx` (81), `ui/ConfirmDialog.tsx` (208), `routes/SatExamLibraryRoute.tsx`, `SatSessionsRoute.tsx`, `SatSessionRoomRoute.tsx`, `SatResultsRoute.tsx`, `SatResultDetailRoute.tsx`, `SatAccessRoute.tsx`. |
| `src/products/sat/**/__tests__/**` | **NO TOUCH** | Must stay green; any new token-guard test is a Phase-05 recommendation (§8), not a Phase-01 edit. |
| `.sat-ui …` (`src/index.css` lines ~1151–1307) + `@theme --color-au-*` (lines ~50–98) + `--sat-accent-core` (line ~1153) | **READ-ONLY** | Alias TO them, never mutate them. |

## 4. Contracts / Interfaces to Preserve

Implementation MUST preserve every contract below (verified 2026-09-11; adding tokens changes values of custom properties only — no selector renames, no specificity changes that break these):

1. **Shared-accent invariant** (`src/index.css:1151–1154`): `.sat-ui, .sat-product { --sat-accent-core: #0071e3; }` — do not edit. Staff accent forks as `--sat-staff-accent: var(--sat-accent-core)` (alias), never a new literal.
2. **`au-` authoring tokens are read-only** (`@theme` lines 50–98): `--color-au-accent/hover/active/tint(-strong)/canvas/surface/surface-raised/separator(-strong)/fill(-strong/-press)/success(-text/-tint)/danger(-text/-tint)/warning(-text/-tint)`, `--radius-au-sm/md/lg/xl`, `--text-au-*`. Map staff literals ONTO these via alias where semantics match (§6); add `--sat-staff-*` only for gaps.
3. **Existing `.sat-product` semantics** (lines 1579–1602): `--sat-label #1d1d1f`, `--sat-secondary-label #515154`, `--sat-tertiary-label #6e6e73`, `--sat-separator`, `--sat-fill`, `--sat-surface #fff`, `--sat-canvas #f5f5f7`, `--sat-accent var(--sat-accent-core)`, `--sat-accent-hover #0077ed`, `--sat-warning #8a4b00`, `--sat-danger #b42318`, `--au-elevation-menu/sheet` aliases — keep byte-identical; new staff tokens alias to them, not replace them.
4. **Slate-remap guards** (lines 1606–1612): `.sat-product .text-slate-400 → var(--sat-tertiary-label)` etc. — do not change; new `--sat-staff-text-*` MUST resolve to the same computed colors so the remap stays consistent.
5. **Global focus-visible treatment** (lines 1616–1620 + segmented override 1917–1920): `outline: 3px solid color-mix(in srgb, var(--sat-accent) 72%, white); outline-offset: 2px` — tokenize the *values* into `--sat-staff-focus-*` but keep the selectors + forced-colors `Highlight` fallback (1715–1717) intact.
6. **Touch-target floor + search-clear exemption** (lines 1624–1642): coarse-pointer 44px floor stays; `.sat-search-clear` stays `top:50% + translateY(-50%) + min 32px !important` — pinned by `satContractsCss.test.ts` F-A6. New tokens must not alter these rules' specificity or order (exemption override stays AFTER the floor).
7. **Reduced-motion + route-fade gate** (lines 1654–1669, 1926–1966, 2048–2066 + `.sat-route-fade` 1948–1957): `animation/transition-duration: 0.01ms`, `transform: none` for press-scale/chevron/rotate, `opacity:1 !important` for `.sat-route-fade` under `prefers-reduced-motion` — pinned by F-A12. New motion tokens MUST be consumed through properties the guard already nulls (`animation`, `transition-duration`, `transform`); do not introduce a motion property the guard misses (e.g. no bare `translate` property, no WAAPI-only motion).
8. **Reduced-transparency + solid fallbacks** (lines 1673–1686, 2035–2047): glass surfaces (`aside/header/nav[aria-label="Digital SAT"]`, `.sat-menu`, `.sat-dialog`, `.sat-dialog-overlay`) fall back to opaque `var(--sat-surface)/#fff` + overlay `rgba(22,22,23,0.55)`. Every NEW glass token needs a solid-fallback twin (§6, `--sat-staff-glass-*-fallback`) wired into these guards.
9. **Increased-contrast + forced-colors** (lines 1690–1718): secondary/tertiary labels darken, separators strengthen, `border-black/*` → `var(--sat-separator)`, inputs → `-strong`; forced-colors maps label/surface/canvas/accent/focus to system keywords. New tokens MUST have entries in both guards (no token that renders unreadable at `prefers-contrast: more` or disappears in `forced-colors: active`).
10. **Primitive class hooks + DOM/ARIA** (must not rename/restyle in a way that breaks tests): `.sat-list-row` + `.sat-row-enter` (`--sat-row-index`, cap 5, `calc(min(var(--sat-row-index,0),5)*60ms)`), `.sat-row-chevron` (translateX 2px nudge only), `.sat-route-enter/.sat-banner-enter`, `.sat-skeleton-shimmer::after` (shimmer sweep — `animate-pulse` forbidden in SAT per `SatPage.test.tsx:118–125`), `.sat-spinner`, `.sat-live-dot` (pulse + text label carrier), `.sat-menu/.sat-menu-item (+[data-current]/[data-destructive]/[data-highlighted]/:disabled)`, `.sat-segmented(-option/-thumb/-label)`, `.sat-dialog-overlay/.sat-dialog/.sat-dialog-center/.sat-quiet-button`, `.sat-search-clear`, `.sat-route-fade`, `.sat-pressable/.sat-state-transition` timing. TSX APIs (`SatStatusPill tone+dot+label`, `satOutcomeTone` table, `SatResultCount` skeleton-XOR + `role=status aria-live=polite` + null-when-zero, `SatListRow` button frame + stagger-only-with-index + never-lift, `SatSearchField` Escape-to-clear, `SatPrimaryButton` pending→disabled+aria-busy, `SatMenu` aria-current+aria-label branch-stability, `SatSegmentedControl` radiogroup+roving-tabindex+single-thumb, `SatConfirmDialog/FormDialog` Cancel-focused + Escape-to-cancel + backdrop-tap-never-dismisses + `sat-product` portal scope + useId title ids, 44px targets / 32px clear / 36–40px menu-item/segmented allowances) all stay byte-identical — Phase 01 changes CSS variables only.
11. **Elevation + z-scale** (lines 1725–1740, 2068–2074 + `Menu.tsx:44–45` `MENU_ELEVATION` fallback): `--au-elevation-card/drag`, `--sat-menu-elevation`, `--sat-dialog-elevation`, dialog z 110/111 vs authoring 200/201 (never nest). New shadow tokens alias these, and the `var(--sat-menu-elevation, <literal fallback>)` fallback in TSX keeps working even before migration.
12. **No-lift + chevron + stagger-cap rules** (`SatPage.test.tsx:98–101`): rows never get `-translate-y`; hover = border/shadow or `rgba(120,120,128,0.06)` wash only; stagger capped at first 6 (index cap 5). Tokenizing shadows/fills must not sneak in a lift transform.

## 5. Step-by-Step Implementation Plan

1. **Re-read normative inputs** (no edits): `plans/overall-plan.md` fully; `src/index.css` lines 1–120 (@theme au tokens), 1148–1160 (shared accent), 1577–1745 (.sat-product semantics + elevation), 1750–2110 (menu/dialog/segmented/motion rules); the six `src/products/sat/ui/__tests__/*` files + route tests for contract Tài liệu. Confirm working tree clean (`git status --short`).
2. **Freeze the audit** (read-only; already completed for this plan — re-verify, do not redesign): 175 literal hits across staff TSX (counts by file: `SatPage 58 / SessionRoom 33 / ResultDetail 21 / SatRoot 17 / Sessions 12 / ExamLibrary 11 / ConfirmDialog 8 / Results 7 / Menu 3`). Distinct-literal frequency that drives §6 mapping: `slate-400 ×64, #0071e3 ×39, slate-500 ×23, amber-700 ×16, slate-900 ×15, slate-600 ×14, black/[0.06] ×14, black/[0.04] ×10, amber-50 ×10, slate-950 ×8, slate-700 ×8, slate-300 ×7, black/[0.065] ×7, black/[0.08] ×7, black/[0.07]+[0.09] ×6 each, amber-500 ×5, black/[0.05]+[0.03] ×5 each, emerald-500 ×4, red-700 ×4, #0077ed ×4, #0067c9 ×4, emerald-700 ×4, #f5f5f7 ×3, amber-800 ×3, black/[0.035] ×3, slate-200 ×3, #d70015 ×2, #c00d10 ×1, #fbfbfd ×1, white/{82,88,90,92,45,40} glass alphas, red-600 ×4 (form errors), red-500 ×1 (dot), red-50 ×2, emerald-50 ×2, amber-100/×1, slate-50 ×2`. If re-audit count differs by >5, stop and re-freeze before editing.
3. **Locate the two edit anchors** in `src/index.css` and edit ONLY there:
   - Anchor A — semantic block: after `--sat-danger: #b42318;` (~line 1592) inside the first `.sat-product { … }` (1579–1602).
   - Anchor B — elevation block: after `--sat-dialog-elevation: …;` (~line 1736–1739) inside the second `.sat-product { … }` (1725–1740).
   - Insert the §6 token declarations (comment header + grouped vars). Keep alphabetical-within-group order, one token per line, trailing semicolons, two-space indent matching surrounding code.
4. **Declare canvas / surface / glass group** (Anchor A): add `--sat-staff-canvas/surface/surface-raised/glass-sidebar/glass-header/glass-bottomnav/glass-room/glass-roster + *-fallback` per §6 pseudocode. Verify every glass token has (a) a translucent value, (b) a solid fallback (`#ffffff` / `var(--sat-surface)` / `#fbfbfd`), (c) coverage in the existing `prefers-reduced-transparency` guards — extend the guard selector list ONLY by adding the new var references (e.g. `background-color: var(--sat-staff-glass-fallback, var(--sat-surface)) !important`), never by restyling selectors.
5. **Declare border / fill / press group** (Anchor A): add the hairline + separator + fill + press scale per §6. Cross-check: `black/[0.06]`≈card border, `[0.065]`≈header/divider, `[0.07]`≈nav border, `[0.075]`≈search border, `[0.08–0.09]`≈input/dialog border, `[0.035–0.05]`≈hover washes, `[0.02]`≈stat hover. Each maps to exactly one token (no two tokens for the same alpha).
6. **Declare text group** (Anchor A): add `--sat-staff-text-{primary,secondary,tertiary,disabled,inverse,faint}` aliasing `--sat-label/--sat-secondary-label/--sat-tertiary-label` + disabled/inverse literals already in use (`slate-200` disabled bg context, `white` inverse). Do NOT invent new grays. Confirm computed values equal the current slate-remap outputs.
7. **Declare accent + status families** (Anchor A): accent aliases `--color-au-accent/hover/active/tint(-strong)` + ring/soft/focus twins; destructive `#d70015/#c00d10` + tint `rgba(217,45,32,0.08)`; success/warning/danger dot-vs-text split per §6 (dots: `emerald-500/amber-500/red-500/#0071e3/slate-400`-equivalent AA-non-text ≥3:1; texts: `emerald-700/#0067c9/amber-700(#8a4b00 room variant)/red-700/#b42318/slate-500` AA ≥4.5:1 at 10–12px). Keep the existing `--sat-warning #8a4b00` / `--sat-danger #b42318` authoritative — new tokens alias them.
8. **Declare focus + radius + shadow groups** (Anchors A/B): focus `3px / color-mix(…72%,white) / 2px offset (1px segmented)` + `Highlight` forced-colors note; radii `10/12/16/22 + 9 menu-item + 8 thumb + full pill` (map: controls 10–12, cards/rows 16, dialogs 22, menu 13); shadows alias `--au-elevation-card/drag`, `--sat-menu-elevation`, `--sat-dialog-elevation` + soft card/press twins from audit (`0 1px 2px rgba(0,0,0,.04/.05)`, accent glow `0 1px 2px/0 4px 14px rgba(0,113,227,.35)`). No new blur radii beyond these.
9. **Declare motion + shimmer group** (Anchor B): durations `120/130/140/150/160/200/220ms` + ease `cubic-bezier(.2,0,0,1)` (+ press `(.4,0,.2,1)` 100ms, live-pulse `(0.4,0,0.6,1)` 1.6s, shimmer 1.35s, spin .8s linear, dialog-enter 220ms, dialog/backdrop 140ms) + stagger `60ms × min(index,5)` + shimmer gradient stops + skeleton base colors. Every value MUST already be nullified by the existing `prefers-reduced-motion` guards; if a new duration needs a new guarded property, extend the guard list in the same edit (same file, allowed).
10. **Wire preference overrides to tokens** (same file, same edit): in `@media (prefers-contrast: more)` add `--sat-staff-*` strengthen lines mirroring the existing `--sat-*` lines; in `@media (forced-colors: active)` map every new text/surface/accent/border token to `Canvas/CanvasText/Highlight/GrayText/LinkText` following the existing pattern; in `@media (prefers-reduced-transparency: reduce)` point every glass usage at its solid fallback. Do not add new selectors — only new declarations inside existing guards.
11. **Self-review the diff**: `git diff --stat` shows ONLY `src/index.css` changed; `git diff src/index.css` shows ONLY added `--sat-staff-*` declarations + guard-reference additions (no selector renames, no deleted rules, no `.sat-ui` hunks, no `.tsx` hunks). Grep the diff for forbidden literals: no new `#[0-9a-f]{3,6}` outside token values, no `!important` additions outside guards, no new `z-index`, no `translate`/`scale` properties outside existing keyframes.
12. **Verify** per §9 (scoped vitest → tsc → eslint; full matrix only as smoke if fast, else defer full to Phase 05). On ANY failure, fix ONLY within `.sat-product` token values/guard references — never by editing TSX or tests. Record the contrast-check evidence (§7) in the commit/PR description, not in code.

## 6. Important Code / Pseudocode (token names, sketches — NOT full files)

### 6.1 Insertion sketch (Anchor A — inside first `.sat-product { }`, after `--sat-danger`)

```css
.sat-product {
  /* …existing --sat-label … --sat-danger lines stay byte-identical… */

  /* ── Staff foundation (Phase 01): fork-as-–sat-staff-*, never mutate
   * shared .sat-ui / --color-au-* values. Glass always pairs with fallback. */
  --sat-staff-canvas: var(--color-au-canvas);            /* #f5f5f7 */
  --sat-staff-surface: var(--color-au-surface);          /* #ffffff */
  --sat-staff-surface-raised: var(--color-au-surface-raised); /* #fbfbfd (roster well) */
  --sat-staff-surface-solid-fallback: #ffffff;

  /* Glass materials: translucent value + opaque twin for reduced-transparency
   * + no-backdrop-filter environments. Values mirror current TSX alphas. */
  --sat-staff-glass-sidebar: rgba(255, 255, 255, 0.82);  /* was bg-white/82 */
  --sat-staff-glass-header: rgba(255, 255, 255, 0.88);   /* was bg-white/88 */
  --sat-staff-glass-room: rgba(255, 255, 255, 0.90);     /* was bg-white/90 */
  --sat-staff-glass-bottomnav: rgba(255, 255, 255, 0.92);/* was bg-white/92 */
  --sat-staff-glass-roster: rgba(255, 255, 255, 0.45);   /* was bg-white/45 */
  --sat-staff-glass-fallback: var(--sat-surface);        /* opaque twin */
  --sat-staff-blur-nav: blur(24px) saturate(1.4);        /* backdrop-blur-2xl equiv */
  --sat-staff-blur-scrim: blur(3px) saturate(1.2);       /* dialog overlay */

  /* Borders / separators / fills: one token per audited alpha. */
  --sat-staff-border-hairline: rgba(0, 0, 0, 0.06);      /* card/row/sidebar-06 */
  --sat-staff-border-header: rgba(0, 0, 0, 0.065);       /* page/room header */
  --sat-staff-border-nav: rgba(0, 0, 0, 0.07);           /* sidebar/bottomnav */
  --sat-staff-border-input: rgba(0, 0, 0, 0.075);        /* search field */
  --sat-staff-border-strong: rgba(0, 0, 0, 0.09);        /* text inputs/sheet */
  --sat-staff-separator: var(--sat-separator);
  --sat-staff-separator-strong: var(--sat-separator-strong);
  --sat-staff-fill: var(--sat-fill);                     /* hover wash base */
  --sat-staff-fill-hover: var(--sat-fill-hover);
  --sat-staff-fill-faint: rgba(0, 0, 0, 0.035);          /* nav hover 0.035 */
  --sat-staff-fill-active: rgba(0, 0, 0, 0.065);         /* active pill 0.065 */
  --sat-staff-fill-avatar: rgba(0, 0, 0, 0.06);          /* avatar well */
  --sat-staff-fill-chip: rgba(0, 0, 0, 0.04);            /* filter chips */
  --sat-staff-fill-chip-hover: rgba(0, 0, 0, 0.07);
  --sat-staff-skeleton-bar: rgba(0, 0, 0, 0.07);         /* shimmer bars */
  --sat-staff-skeleton-bar-soft: rgba(0, 0, 0, 0.05);

  /* Text: alias existing --sat-*-label so slate-remap stays consistent. */
  --sat-staff-text-primary: var(--sat-label);            /* slate-950/900/800/700 */
  --sat-staff-text-secondary: var(--sat-secondary-label);/* slate-500/600 */
  --sat-staff-text-tertiary: var(--sat-tertiary-label);  /* slate-400 */
  --sat-staff-text-faint: var(--sat-tertiary-label);
  --sat-staff-text-inverse: #ffffff;
  --sat-staff-text-disabled: #9b9a97;                    /* informational only */

  /* Accent: alias au family; ring/soft for focus + search. */
  --sat-staff-accent: var(--sat-accent-core);            /* #0071e3 */
  --sat-staff-accent-hover: var(--color-au-accent-hover);/* #0077ed */
  --sat-staff-accent-active: var(--color-au-accent-active);/* #0067c9 */
  --sat-staff-accent-text-on-tint: #0067c9;              /* info/ready pill text */
  --sat-staff-accent-tint: var(--color-au-accent-tint);
  --sat-staff-accent-tint-strong: var(--color-au-accent-tint-strong);
  --sat-staff-accent-ring: rgba(0, 113, 227, 0.40);      /* focus:border 40 */
  --sat-staff-accent-ring-soft: rgba(0, 113, 227, 0.10); /* search ring 10 */
  --sat-staff-accent-ring-button: rgba(0, 113, 227, 0.25);
  --sat-staff-accent-glow-sm: 0 1px 2px rgba(0, 113, 227, 0.35);
  --sat-staff-accent-glow-md: 0 4px 14px rgba(0, 113, 227, 0.35);

  /* Destructive + status families: dot (≥3:1 non-text) vs text (≥4.5:1). */
  --sat-staff-danger: var(--sat-danger);                 /* #b42318 */
  --sat-staff-danger-strong: #d70015;                    /* confirm button */
  --sat-staff-danger-hover: #c00d10;
  --sat-staff-danger-tint: var(--color-au-danger-tint);
  --sat-staff-warning: var(--sat-warning);               /* #8a4b00 (room) */
  --sat-staff-warning-text: #92400e;                     /* au-warning-text */
  --sat-staff-warning-dot: #d97706;                      /* au-warning */
  --sat-staff-warning-tint: var(--color-au-warning-tint);
  --sat-staff-success-text: var(--color-au-success-text);/* #067647 */
  --sat-staff-success-dot: var(--color-au-success);      /* #059669 */
  --sat-staff-success-tint: var(--color-au-success-tint);
  --sat-staff-info-text: #0067c9;
  --sat-staff-info-dot: #0071e3;
  --sat-staff-neutral-dot: #9b9a97;                      /* slate-400 equiv */
  --sat-staff-neutral-text: var(--sat-secondary-label);
  --sat-staff-form-error: #dc2626;                       /* red-600 errors */

  /* Focus ring. */
  --sat-staff-focus-color: var(--sat-accent);
  --sat-staff-focus-ring: color-mix(in srgb, var(--sat-accent) 72%, white);
  --sat-staff-focus-width: 3px;
  --sat-staff-focus-offset: 2px;
  --sat-staff-focus-offset-tight: 1px;                   /* segmented */

  /* Radii: one per role. */
  --sat-staff-radius-chip: 999px;                        /* pills/filter */
  --sat-staff-radius-control-sm: 8px;                    /* segmented thumb */
  --sat-staff-radius-control: 10px;                      /* menu item/trigger/sheet btn */
  --sat-staff-radius-input: 12px;                        /* search/primary btn */
  --sat-staff-radius-menu: 13px;                         /* sat-menu */
  --sat-staff-radius-card: 16px;                         /* rows/cards (rounded-2xl) */
  --sat-staff-radius-dialog: 22px;                       /* confirm/form card */
}
```

### 6.2 Insertion sketch (Anchor B — inside second `.sat-product { }`, after elevations)

```css
.sat-product {
  /* …existing --au-elevation-card/drag, --sat-menu/dialog-elevation stay… */

  /* Shadows: alias existing elevations; add soft + press twins from audit. */
  --sat-staff-shadow-card: var(--au-elevation-card);
  --sat-staff-shadow-card-soft: 0 1px 2px rgba(0, 0, 0, 0.04);
  --sat-staff-shadow-row-press: 0 1px 2px rgba(0, 0, 0, 0.05);
  --sat-staff-shadow-menu: var(--sat-menu-elevation);
  --sat-staff-shadow-dialog: var(--sat-dialog-elevation);
  --sat-staff-shadow-drag: var(--au-elevation-drag);
  --sat-staff-shadow-thumb: 0 1px 3px rgba(0, 0, 0, 0.08), 0 0 0 0.5px rgba(0, 0, 0, 0.04);

  /* Motion: single ease, capped stagger, named durations. */
  --sat-staff-ease: cubic-bezier(0.2, 0, 0, 1);
  --sat-staff-ease-press: cubic-bezier(0.4, 0, 0.2, 1);
  --sat-staff-motion-hover: 120ms;    /* nav/chevron hover */
  --sat-staff-motion-state: 130ms;    /* segmented option */
  --sat-staff-motion-banner: 140ms;
  --sat-staff-motion-row: 160ms;      /* rows/route fade */
  --sat-staff-motion-press: 100ms;    /* press-scale only */
  --sat-staff-motion-dialog: 220ms;   /* dialog-enter */
  --sat-staff-motion-dialog-max: 200ms; /* 2026 cap note: dialog-enter 220ms grandfathered, do not extend */
  --sat-staff-stagger-step: 60ms;
  --sat-staff-stagger-cap: 5;         /* min(index,5) */
  --sat-staff-shimmer-duration: 1.35s;
  --sat-staff-shimmer-sweep: rgba(120, 120, 128, 0.14);
  --sat-staff-skeleton-pulse-duration: 1.6s;
  --sat-staff-spinner-duration: 0.8s;
  --sat-staff-live-dot-duration: 1.6s;
  --sat-staff-scrim: rgba(22, 22, 23, 0.36);
  --sat-staff-scrim-solid: rgba(22, 22, 23, 0.55); /* reduced-transparency */
}
```

### 6.3 Downstream consumption sketch (INFORMATIONAL — Phase 02/03 implement, NOT Phase 01)

```css
/* Example of how Phase 03 will consume (do NOT apply in Phase 01): */
.sat-product .sat-list-row {
  background: var(--sat-staff-surface);
  border-color: var(--sat-staff-border-hairline);
  box-shadow: var(--sat-staff-shadow-card-soft);
  border-radius: var(--sat-staff-radius-card);
  transition:
    background-color var(--sat-staff-motion-row) var(--sat-staff-ease),
    transform var(--sat-staff-motion-press) var(--sat-staff-ease-press);
}
```

TSX-side sketch (also NOT Phase 01 — shows why tokens use `var(..., literal)` fallbacks during migration):

```tsx
// Phase-03 style (illustrative): boxShadow: 'var(--sat-staff-shadow-menu, 0 0 0 0.5px rgba(0,0,0,0.055), …)'
// Menu.tsx MENU_ELEVATION already follows this pattern via var(--sat-menu-elevation, <literal>).
```

### 6.4 Full token table (normative — every row MUST exist after Phase 01)

| Group | Token | Value (alias or literal) | Replaces (audited usage) | AA / fallback note |
|---|---|---|---|---|
| Canvas | `--sat-staff-canvas` | `var(--color-au-canvas)` #f5f5f7 | `bg-[#f5f5f7]` ×3 (SatRoot, Room, ring-offset) | — |
| Surface | `--sat-staff-surface` | `var(--color-au-surface)` #fff | `bg-white` ubiquitous | forced-colors → Canvas |
| Raised | `--sat-staff-surface-raised` | `var(--color-au-surface-raised)` #fbfbfd | `bg-[#fbfbfd]` roster well ×1 | — |
| Glass | `--sat-staff-glass-sidebar/header/room/bottomnav/roster` | rgba(255,255,255,.82/.88/.90/.92/.45) | white/{82,88,90,92,45} | each → `--sat-staff-glass-fallback` under reduced-transparency; never glass over busy bg |
| Blur | `--sat-staff-blur-nav/scrim` | blur(24px) saturate(1.4) / blur(3px) saturate(1.2) | backdrop-blur-2xl / overlay blur | `backdrop-filter: none` fallback in guards |
| Border | `--sat-staff-border-{hairline,header,nav,input,strong}` | black .06/.065/.07/.075/.09 | all `border-black/[…]` | contrast-more → `--sat-separator(-strong)` |
| Separator | `--sat-staff-separator(-strong)` | `var(--sat-separator(-strong))` | semantic dividers | — |
| Fill | `--sat-staff-fill(-hover/-faint/-active/-avatar/-chip…)` | `var(--sat-fill…)` + black .035/.04/.06/.065/.07 | nav pill, avatar, chips, hover washes | — |
| Skeleton | `--sat-staff-skeleton-bar(-soft)` | black .07/.05 | shimmer bars | shimmer sweep token pairs with these |
| Text | `--sat-staff-text-{primary,secondary,tertiary,faint,inverse,disabled}` | `var(--sat-label…)` + #fff | all slate-* text | §7 AA table; forced-colors → CanvasText |
| Accent | `--sat-staff-accent(-hover/-active)` | core/#0077ed/#0067c9 via au aliases | #0071e3 ×39, hover/active ×4 | white-on-#0071e3 4.5:1+ (button text) |
| Accent tint/ring/glow | `--sat-staff-accent-{tint,tint-strong,ring,ring-soft,ring-button,glow-sm/md}` + `--sat-staff-accent-text-on-tint` #0067c9 | au tints + rgba(0,113,227,.40/.10/.25) + glow | search focus, pill bg, primary shadow | #0067c9-on-tint ≥4.5:1 |
| Danger | `--sat-staff-danger(-strong/-hover/-tint)` | #b42318 / #d70015 / #c00d10 / au-danger-tint | red-700, destructive btn | white-on-#d70015 ≥4.5:1; #b42318-on-white ≥7:1 |
| Warning | `--sat-staff-warning(-text/-dot/-tint)` | #8a4b00 / #92400e / #d97706 / au tint | amber-700/800/500, amber-50 | amber-700-on-amber-50 ≥4.5:1 (small text) |
| Success | `--sat-staff-success-{text,dot,tint}` | #067647 / #059669 / au tint | emerald-700/500/50 | emerald-700-on-50 ≥4.5:1 |
| Info/neutral | `--sat-staff-info-{text,dot}`, `-neutral-{dot,text}` | #0067c9/#0071e3, #9b9a97/secondary | info/ready + draft/archived/finished/neutral pills | dot ≥3:1 non-text; text ≥4.5:1 |
| Form error | `--sat-staff-form-error` | #dc2626 (red-600) | time/create errors ×4 | on-white ≥4.5:1 |
| Focus | `--sat-staff-focus-{color,ring,width,offset,offset-tight}` | accent 72% mix, 3px/2px(1px seg) | global focus-visible | forced-colors → Highlight 3px |
| Radius | `--sat-staff-radius-{chip,control-sm,control,input,menu,card,dialog}` | 999/8/10/12/13/16/22px | all rounded-* | — |
| Shadow | `--sat-staff-shadow-{card,card-soft,row-press,menu,dialog,drag,thumb}` | alias elevations + soft twins | all shadow-[…] | no lift; press-scale only |
| Motion | `--sat-staff-{ease,ease-press,motion-hover/state/banner/row/press/dialog,…,stagger-step/cap}` | .2,0,0,1 / 120–220ms / 60ms×cap5 | all transitions/animations | reduced-motion nulls all |
| Shimmer | `--sat-staff-shimmer-{duration,sweep}` + `skeleton-pulse-duration`, `spinner-duration`, `live-dot-duration`, `scrim(-solid)` | 1.35s / rgba(120,120,128,.14) / 1.6s / .8s / 1.6s / rgba(22,22,23,.36/.55) | shimmer/spinner/live-dot/overlay | static ring + text carry meaning when reduced |

## 7. Edge Cases

1. **Glass-over-busy / low-contrast text on glass:** only nav/header/room/roster shells use glass tokens; content cards stay solid `--sat-staff-surface`. No text token may resolve below 4.5:1 on its glass value at the shipped blur — verifier spot-checks sidebar label + room title + bottom-nav active/inactive on the translucent value AND the solid fallback.
2. **No-backdrop-filter engines:** every glass surface must be legible with `backdrop-filter: none` (fallback bg covers it). Do not ship a token that only works with blur.
3. **`color-mix` support:** `--sat-staff-focus-ring` uses `color-mix()`; keep the existing literal `outline: 3px solid …` declaration shape so older engines fall back to the pre-token rule gracefully — do not add `@supports` branches in Phase 01 (Phase 03 may add them if needed).
4. **Portal escape:** `.sat-menu` / `.sat-dialog-*` mount at `document.body` outside `.sat-product`. Tokens MUST be declared so portals resolve them: keep the dual-scoped selectors (`.sat-menu`, `.sat-dialog.sat-product`) untouched; declare menu/dialog shadow+radius tokens on `:root`-visible scope OR keep the existing local-alias pattern (`--au-elevation-menu: var(--sat-menu-elevation)`). Never assume `.sat-product` ancestry for portal surfaces.
5. **`prefers-contrast: more`:** strengthen EVERY new border/text token in the guard (mirror existing lines). Watch `black/[0.035–0.05]` faint washes — at forced contrast they must map to `--sat-separator`, not vanish.
6. **`forced-colors: active`:** map new tokens to `Canvas/CanvasText/Highlight/GrayText/LinkText` per existing pattern; destructive/warning/success MUST NOT rely on hue (dot+label/weight carry state). Focus → `3px solid Highlight`.
7. **AA text pairs (verify with a contrast tool; record ratios in PR):** `#1d1d1f` on #fff (~16.5:1) · `#515154` on #fff (~7.5:1) · `#6e6e73` on #fff (~4.8:1 — smallest body/meta allowed) · white on #0071e3 (~4.5:1 — button text, do not darken accent) · #0067c9 on `rgba(0,113,227,.07)` over white (~5.5:1) · emerald-700 (#047857-ish Tailwind) on emerald-50 (~5:1) · amber-700 (#b45309-ish) on amber-50 (~5:1) · amber-800 on amber-50 (~6:1) · red-700 (#b91c1c-ish) on red-50 (~6:1) · #b42318 on white (~7:1) · white on #d70015 (~4.6:1) · white on slate-900 #0f172a (~15:1) · red-600 #dc2626 on white (~4.8:1). If any pair measures <4.5:1 (text) or <3:1 (dot/icon non-text), darken the TEXT variant only — never the dot/tint — and note the change.
8. **Shimmer vs pulse:** `animate-pulse` stays forbidden in SAT (test-pinned). Shimmer sweep uses the gradient + `--sat-staff-shimmer-*` tokens; both are nulled under reduced-motion (static bars + sr-only label carry loading meaning).
9. **Spinner + live-dot under reduced-motion:** rotation/pulse are decoration-only; `Working…` text, `aria-busy`, and dot+label text carry meaning. Guard already nulls `animation` — confirm new duration tokens flow through `animation:`, not `transition:` alone.
10. **Stagger-cap overflow:** rows beyond index 5 share the cap delay (`min(index,5)`); no per-row inline delay beyond the custom property. Tokenizing must not uncap it (perf + motion-sickness risk in long rosters).
11. **`--sat-staff-motion-dialog 220ms` grandfather:** exceeds the 2026 150–200ms cap but matches the shipped `sat-dialog-enter 220ms` keyframe; keep at 220ms in Phase 01 (no behavior change), flag for Phase-03 motion review — do not silently retime dialogs here.
12. **Tailwind arbitrary-value coexistence:** Phase 01 adds tokens but migrates ZERO call sites — `bg-[#0071e3]`, `border-black/[0.06]` etc. remain live. Tokens and literals will temporarily duplicate values; that is intentional (Wave 2 migrates). Do not delete literals or add `@utility` aliases in Phase 01.
13. **Bluebook leak:** any edit whose diff hunk touches `.sat-ui`, `--sat-accent-core`, `student-delivery`, or IELTS selectors is an automatic reject — re-fork under `--sat-staff-*`.
14. **Specificity/order traps:** new declarations go INSIDE existing `.sat-product` blocks and guards — never new top-level selectors that outrank `.sat-product .text-slate-*` remaps or the search-clear exemption order.

## 8. Tests to Add / Update

**Phase 01 edits NO test files** (ownership: primitives' tests belong to Phase 03, matrix to Phase 05). It MUST keep all of these green byte-for-byte:

- `src/products/sat/ui/__tests__/satContractsCss.test.ts` — F-A6 (search-clear 32px centering) + F-A12 (route-fade reduced-motion guard). Highest risk: reordering the exemption rule or breaking `.sat-route-fade` text.
- `src/products/sat/ui/__tests__/SatPage.test.tsx` — dot+label, live-pulse scoping, search clear/Escape, row stagger contract (`sat-row-enter` only with index + `--sat-row-index`), never-lift (`-translate-y` absent), shimmer-not-pulse, stat-strip button-vs-div, `satOutcomeTone` table, result-count skeleton-XOR (null when total=0), inline-error `role=alert` + `min-h-10` retry + `bg-[#0071e3]` (literal still present until Phase 03 migrates — do NOT break the class string).
- `src/products/sat/ui/__tests__/Menu.test.tsx` — open/select/close, destructive+separator, Escape, closed-renders-nothing, `data-sat-menu-animate`, `aria-current` clickability, trigger `aria-label` branch stability.
- `src/products/sat/ui/__tests__/SegmentedControl.test.tsx` — radiogroup + checked, roving tabindex, pointer + Arrow-key select, exactly-one `.sat-segmented-thumb`.
- `src/products/sat/ui/__tests__/Dialogs.test.tsx` — alertdialog name/desc/answers, Cancel path, Escape, closed-renders-nothing, form dialog named + Escape + Close, **portal `sat-product` scope on overlay+content**, useId title-id uniqueness (both families).
- Route tests: `src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx`, `SatSessionsRoute.test.tsx` (+ Results/Room/Detail suites if present) — filter/bucket/empty-state/confirm wiring unchanged.
- **Recommendation to Phase 05 (do NOT implement here):** add a token-presence guard (e.g. extend `satContractsCss.test.ts` or a new `satStaffTokens.test.ts`) asserting each §6 `--sat-staff-*` name exists under `.sat-product`, glass tokens have fallback twins, and no `.sat-ui` hunk changed. Phase-01 implementer only ensures the CSS text makes such a test pass.

## 9. Verification Commands (run in order; stop on first failure)

```bash
# 1. Scope check — only the owned file changed
git status --short
git diff --stat
git diff --name-only | grep -v '^src/index.css$' && echo "OWNERSHIP VIOLATION" || echo "scope OK"

# 2. No Bluebook / shared-token mutation
git diff src/index.css | grep -E '^[-+].*\.sat-ui|^[-+].*--sat-accent-core|^[-+].*--color-au-' && echo "SHARED MUTATION — REJECT" || echo "no shared mutation"
git diff src/index.css | grep -c '^+.--sat-staff-'  # expect ≥ 60 added token lines

# 3. Scoped contract + primitive suites (must all pass)
npm run test:run -- src/products/sat/ui/__tests__/satContractsCss.test.ts
npm run test:run -- src/products/sat/ui/__tests__/SatPage.test.tsx src/products/sat/ui/__tests__/Menu.test.tsx src/products/sat/ui/__tests__/SegmentedControl.test.tsx src/products/sat/ui/__tests__/Dialogs.test.tsx

# 4. Scoped route suites
npm run test:run -- src/products/sat/routes/__tests__/

# 5. Typecheck + lint (CSS-adjacent TSX untouched, but-run)
npx tsc --noEmit
npx eslint src/products/sat/ src/index.css

# 6. Full matrix (required before Wave-2 unlock; Phase 05 re-runs alone)
npm run test:run
npm run e2e:sat-a11y
```

Contrast spot-checks (manual, record in PR): sidebar label + nav active pill + search placeholder + primary-button white-on-accent + info/ready/success/warning/danger pill texts on their tints + room overrun/reconnecting banners + roster timer `tabular-nums` — each on translucent AND solid-fallback bg, default + `prefers-contrast: more` + `forced-colors: active`, with reduced-motion + reduced-transparency toggled.

## 10. Definition of Done

- [ ] `src/index.css` is the ONLY product file changed; diff adds the complete §6 `--sat-staff-*` set (canvas/surface/glass+fallback/blur/border/separator/fill/skeleton/text/accent/tint/ring/glow/danger/warning/success/info/neutral/form-error/focus/radius/shadow/motion/shimmer/spinner/live-dot/scrim) inside existing `.sat-product` blocks + guard references; zero `.tsx` / test / `.sat-ui` / `@theme` hunks.
- [ ] Every audited literal in §5.2 maps to exactly one token or alias (§6 table) — no orphan alpha, no duplicate tokens for one value, no new hue outside the audited palette (no neon/gradient/neumorphism).
- [ ] Every glass token has a solid fallback wired into `prefers-reduced-transparency`; every text pair is AA-checked (§7 ratios recorded); shimmer + reduced-motion tokens flow through guarded properties; stagger stays capped at 5; 44px/32px, focus-ring, portal-scope, skeleton-XOR, dot+label, Cancel-focus, backdrop-no-dismiss contracts untouched.
- [ ] `satContractsCss` (F-A6/F-A12) + all four primitive suites + route suites pass; `npx tsc --noEmit` clean; `npx eslint` clean; full `npm run test:run` + `npm run e2e:sat-a11y` pass (or failures filed to owning phases with no Phase-01 workaround edits).
- [ ] No implementation beyond tokens: components render pixel-identical (tokens unused), perf unchanged, no new stores/persistence/routing/polling behavior.
- [ ] Handoff ready: Phase 02/03 agents can implement purely from the §6 table + §6.3 sketch without redesigning names or values.
