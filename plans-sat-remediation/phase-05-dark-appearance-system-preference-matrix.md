# Phase 05 — Dark appearance + system-preference matrix (PLAN ONLY)

> Workflow: ai-planning-workflow · Phase planning agent · PLAN ONLY — no source change in this phase.
> Scope: staff workspace ONLY — `src/products/sat/**` + `.sat-product` / `--sat-staff-*` CSS in `src/index.css`. No `.sat-ui` diff. No behavior change. No toggle.

## Objective

Ship a system-following dark appearance for the SAT staff workspace (Exam Library, Sessions, Session Room, Results, Result Detail, Access + SatRoot chrome) by adding a **dark semantic variant block for every `--sat-staff-*` token** inside the existing `@media (prefers-color-scheme: dark)` scope in `src/index.css`, with **no toggle, no JS theme state, no light-value redesign**, and verify the full system-preference matrix:

- light / dark × `prefers-contrast: more` × `prefers-reduced-transparency: reduce` × `forced-colors: active` (forced-colors wins by cascade order)
- `prefers-reduced-motion: reduce` orthogonal (already guarded; verify unchanged)
- Recomputed WCAG contrast in dark (text ≥ 4.5:1, dots ≥ 3:1) — computed, not eyeballed
- Zero stranded light surfaces in dark (dialogs, menus, segmented thumb, glass nav, skeleton, fills, borders)

**Why this phase exists:** a `prefers-color-scheme: dark` block already exists at `src/index.css:3215-3414`, but it only remaps base `--sat-*` / `--color-au-*` / authoring tokens. **Zero `--sat-staff-*` tokens have dark variants** — canvas, surfaces, all five glass materials, all borders / separators / fills, all text, accent family, all four status families, focus, skeleton, shadows, and scrim still resolve to their light values in dark mode. Every staff component consumes `--sat-staff-*` (see `SatPage.tsx` pill/dot tables), so dark mode today strands white cards, white glass, black-alpha borders, and dark-on-dark status text. This phase closes exactly that gap, inside the dark block only.

## Dependencies

- **Phase 01 (REQUIRED, must be merged first):** final 6-step type scale, final light `--sat-staff-*` values, neutral-dot fix (`--sat-staff-neutral-dot: #9b9a97 → #6e6e73`, audit §HIGH/MEDIUM), chevron `slate-300 → slate-400` remap, density/targets, glass-fallback architecture, motion tokens. Phase 05 consumes these as **frozen inputs** and must not re-decide them.
- **Phase 02 (REQUIRED, must be merged first):** final status colors — `satOutcomeTone` single table + `sessionStatusTone` / `roomStatusTone` aliases, final warning/success/info/danger text + dot + tint values in light. Phase 05 only inverts them for dark; it does not pick new hues or rename tones.
- **Phase 03 / 04:** no dependency (disjoint files). Phase 05 touches no TSX, so dirty-guard dialogs and roster compression do not block it — but Phase 05 verification must run against their final markup (dialog surfaces, roster rows) to confirm dark legibility.
- **Phase 06:** this phase hands off to final integration; it does not absorb it.

**If Phase 01/02 changed any frozen value** (e.g. a different neutral-dot hex than `#6e6e73`), the implementation agent must carry that value into the dark-derivation table in Step 1 instead of the hexes below, and record the substitution in the PR description. Do not invent a third value.

## Affected / new files (with line refs where known)

**Only file to edit (CSS dark block only):**

- `src/index.css`
  - Light staff foundation (READ-ONLY reference, do not edit): lines `1592-1700` — `.sat-product` base `--sat-*` (1593-1605) + `--sat-staff-*` fork (1610-1690: canvas/surface/glass 1610-1623, borders/separators/fills 1625-1640, text 1642-1647 incl. `--sat-staff-text-disabled: #9b9a97` at 1647, accent 1649-1659, status families 1661-1676 incl. `--sat-staff-neutral-dot: #9b9a97` at 1674, focus 1678-1682, radii 1684-1690).
  - Existing preference guards (READ-ONLY, verify precedence, do not restructure): reduced-motion `1752-1767` + `2268-2286`; reduced-transparency `1771-1795` + `2255-2267`; contrast-more `1799-1829`; forced-colors `1831-1909`.
  - Hardcoded light surfaces to **override from inside the dark block only** (never edit the light rule itself): dialog card `background: #ffffff` at `2038-2045`, segmented thumb `background: #ffffff` at `2126-2132`, segmented track `background: rgba(120,120,128,0.12)` at `2095-2101`, skeleton shimmer sweep `rgba(120,120,128,0.14)` at `2201-2206`, list-row hover `rgba(120,120,128,0.06)` at `2214-2219`, reduced-transparency dialog/menu fallback `#ffffff` at `2262-2266`.
  - **Dark block (EDIT HERE ONLY):** `3215-3414` — `:root` dark `3216-3256`, `.sat-ui,.sat-product` base dark `3257-3287`, `.sat-product` authoring/au dark `3289-3323`, au-elevation dark `3325-3338`, utility remaps `3345-3389`, authoring surfaces `3391-3413`. The gap: **no `--sat-staff-*` overrides exist anywhere in 3289-3323** — that is the insertion point (new sub-block after line 3323, before the `--au-tint` block at 3325, still inside the same `@media (prefers-color-scheme: dark)`).
  - Dark+contrast-more (EXTEND): `3416-3429` — currently only `--sat-*-label/divider` + `--color-au-separator*`; staff text/border strengthens must be added here.
  - Forced-colors (VERIFY ONLY, no edit unless a new token missed the 1831-1909 map): `3431-3474`. Cascade order already correct (forced-colors after dark) so it wins over dark — implementation agent must preserve that order.

**Verification-only files (read / run, never edit in this phase):**

- `src/products/sat/ui/SatPage.tsx` — pill table `TONE_PILL_CLASS` (lines 143-156), dot table `TONE_DOT_CLASS` (173-187), `SatStatusPill` (189-204), `satOutcomeTone` (166-171, frozen). All consume `var(--sat-staff-*)` so they flip automatically once tokens flip; no TSX change.
- `src/products/sat/routes/SatSessionRoomRoute.tsx` (`roomStatusTone` line 36, `studentTone` lines 45-47), `SatSessionsRoute.tsx` (`sessionStatusTone` line 45), `SatResultsRoute.tsx` + `SatResultDetailRoute.tsx` (tone call sites) — verify in dark, do not edit.
- `src/products/sat/SatRoot.tsx`, `SatExamLibraryRoute.tsx`, `SatAccessRoute.tsx`, `src/products/sat/ui/Menu.tsx`, `SegmentedControl.tsx`, `ConfirmDialog.tsx` — verify surfaces/menus/dialogs/segmented in dark, do not edit.
- `src/products/sat/ui/__tests__/satContractsCss.test.ts` — existing contract file; **new dark assertions are added here** (only test-file write allowed).
- `e2e/sat-product-workspace.spec.ts`, `playwright.sat-a11y.config.ts` (currently `testMatch: sat-student-accessibility.spec.ts` — staff a11y runs via `e2e:sat-a11y` or documented equivalent per overall-plan §6.8), `e2e/browser-compatibility.spec.ts:84-93` (existing `emulateMedia({ colorScheme: dark })` precedent).

**New files:** none in source. Optional scratch verification script (e.g. `scripts/verify-sat-dark-contrast.mjs`, delete-or-keep per repo convention) is allowed as a verification aid only; it is not a runtime dependency. No new stores / network / auth / theme-toggle module.

## Contracts / interfaces (frozen inputs from Phase 01 if relevant; what you must not break)

1. **Tokens flow one way:** tokens → primitives → pages. Phase 05 adds dark token *values* only. No token renames, no new token namespaces, no TSX class swaps, no new hex literals in TSX.
2. **Type scale (frozen, Phase 01):** H1 30px/-0.045 · hero 52px ResultDetail + 36px SessionRoom clock · H2 16-17px/-0.025 · title/body 13-14px/-0.012 · control/hint 12px semibold · floor 11px medium · eyebrow 11px caps/0.12. Nothing below 11px. Dark must not change any font-size, tracking, or weight.
3. **Status-tone single table (frozen, Phase 01+02):** `satOutcomeTone` is the only outcome mapping (`scored→ready, pending→pending, invalidated_*→invalidated, else neutral`); `sessionStatusTone` / `roomStatusTone` alias the same pill/dot classes. Dark must preserve the mapping — only the resolved colors change.
4. **Contrast floors (frozen, extend to dark):** text ≥ 4.5:1, dots / non-text UI ≥ 3:1. Light table (computed): tertiary `#6e6e73` 5.07 PASS, secondary `#515154` 7.91 PASS, info-text `#0067c9` 5.55 PASS, success-text `#067647` 5.69 PASS, warning-text `#92400e` 7.09 PASS, danger `#b42318` 6.57 PASS, white-on-accent 4.70 PASS, neutral dot 2.81 FAIL → `#6e6e73` fix. Dark must recompute every pair on dark surfaces (see Verification) — no eyeballing.
5. **System-following only, no toggle:** `color-scheme: light` (line 1200, `.sat-ui`) vs `color-scheme: dark` (line 3259, `.sat-ui,.sat-product` in dark media) is the mechanism. FORBIDDEN in this phase: any `.dark` class, `data-theme` attribute, `data-sat-theme`, JS `matchMedia` theme state, localStorage theme key, toggle button, or `color-scheme: light dark` shorthand on `.sat-product`. Grep gate must be empty (see Verification).
6. **No `.sat-ui` diff:** the `.sat-ui,.sat-product` shared dark base (3257-3287) and `.sat-ui` remaps (3345-3389) are out of scope — read-only. All edits are inside a `.sat-product`-only selector within the dark media query.
7. **Preference answers preserved:** reduced-motion guards (1752-1767, 2268-2286), reduced-transparency collapse (1771-1795, 2255-2267), contrast-more strengthening (1799-1829, 3416-3429), forced-colors system mapping (1831-1909, 3431-3474). Dark must compose with all four — never weaken them, never reorder forced-colors above dark.
8. **Behavioral freeze:** filtering, polling intervals, proctor actions, confirm flows, routing, stagger cap (first 6, 150-200ms), skeleton-XOR, empty-state next actions, keyboard (radiogroup segmented + listbox roster), 44px primaries / 28px clear+chips — all unchanged. This phase is CSS-token-only; any visual diff beyond color/blur/shadow in dark is a defect.
9. **Glass-only-on-nav + titles <15 chars + Cancel-focused alerts + white-on-accent prominence** — unchanged; dark glass values keep the same alphas, only the RGB base flips (white → near-black).

## Step-by-step implementation (ordered, each step names exact file + exact change: old class/token → new class/token, old string → new string)

> All edits are in `src/index.css` inside `@media (prefers-color-scheme: dark) { … }`. Do not edit light values. Do not edit TSX. Insertion point for Steps 2-8: new commented sub-block after line 3323 (`}` closing the `.sat-product` au-dark block) and before line 3325 (`.sat-product { --au-tint …`), still inside the dark media query. Keep the existing comment style (`/* … */`, `──` section dividers).

**Step 0 — Freeze check (read-only, no edit).**
Read `src/index.css:1610-1676` and record the *as-merged* Phase 01+02 light values for: `--sat-staff-neutral-dot`, `--sat-staff-text-{primary,secondary,tertiary,faint,disabled}`, `--sat-staff-{success,warn,info,danger}-text`, `--sat-staff-accent-text-on-tint`. If any differ from the "Old (light)" column below, substitute the as-merged value as the derivation basis and note it in the PR. Gate: `git log --oneline -5 -- src/index.css` shows Phase 01+02 merged; `grep -rn "text-\[8px\]\|text-\[9px\]" src/products/sat` returns empty (type floor done).

**Step 1 — Canvas / surfaces / solid fallback (dark).**
In `src/index.css` dark `.sat-product` insertion block, add:
```css
/* Staff dark appearance (Phase 05): system-following only, no toggle.
 * Every --sat-staff-* light value above resolves here to its dark twin.
 * Alphas mirror light; only the RGB base flips (white→near-black,
 * black-alpha→white-alpha) so elevation language stays identical. */
--sat-staff-canvas: #111113;              /* was var(--color-au-canvas) → #f5f5f7 in light */
--sat-staff-surface: #1c1c1e;             /* was var(--color-au-surface) → #ffffff */
--sat-staff-surface-raised: #2c2c2e;      /* was var(--color-au-surface-raised) → #fbfbfd */
--sat-staff-surface-solid-fallback: #1c1c1e; /* was #ffffff */
```
Derivation: aliases the already-shipped dark `--color-au-canvas/surface/raised` (lines 3306-3308) and dark `--sat-canvas/surface` (3260-3264). No new hue.

**Step 2 — Glass materials + blurs (dark).**
In the same dark `.sat-product` block, add:
```css
--sat-staff-glass-sidebar: rgba(28, 28, 30, 0.82);   /* was rgba(255,255,255,0.82) */
--sat-staff-glass-header: rgba(28, 28, 30, 0.88);    /* was rgba(255,255,255,0.88) */
--sat-staff-glass-room: rgba(28, 28, 30, 0.9);       /* was rgba(255,255,255,0.9) */
--sat-staff-glass-bottomnav: rgba(28, 28, 30, 0.92); /* was rgba(255,255,255,0.92) */
--sat-staff-glass-roster: rgba(28, 28, 30, 0.45);    /* was rgba(255,255,255,0.45) */
--sat-staff-glass-fallback: var(--sat-staff-surface); /* unchanged ref; now resolves dark */
--sat-staff-blur-nav: blur(24px) saturate(1.4);       /* unchanged */
--sat-staff-blur-scrim: blur(3px) saturate(1.2);      /* unchanged */
```
Mirrors the shipped dark `--au-material-sidebar/hud` pattern (3293-3296: `rgba(28,28,30,0.9/0.94)`). Reduced-transparency collapse (1786-1794) needs no change — it already collapses every glass var onto `--sat-staff-glass-fallback`, which now resolves dark.

**Step 3 — Borders / separators / fills / skeleton bars (dark).**
In the same dark block, add:
```css
--sat-staff-border-hairline: rgba(255, 255, 255, 0.08); /* was rgba(0,0,0,0.06) */
--sat-staff-border-header: rgba(255, 255, 255, 0.09);   /* was rgba(0,0,0,0.065) */
--sat-staff-border-nav: rgba(255, 255, 255, 0.10);      /* was rgba(0,0,0,0.07) */
--sat-staff-border-input: rgba(235, 235, 245, 0.38);    /* was rgba(0,0,0,0.075); aliases dark separator-strong */
--sat-staff-border-strong: rgba(235, 235, 245, 0.30);   /* was rgba(0,0,0,0.09); aliases dark au-separator-strong */
--sat-staff-separator: rgba(235, 235, 245, 0.24);       /* was var(--sat-separator) light; now dark value directly */
--sat-staff-separator-strong: rgba(235, 235, 245, 0.38);
--sat-staff-fill: rgba(235, 235, 245, 0.10);            /* was var(--sat-fill) light */
--sat-staff-fill-hover: rgba(235, 235, 245, 0.16);
--sat-staff-fill-faint: rgba(235, 235, 245, 0.06);      /* was rgba(0,0,0,0.035) */
--sat-staff-fill-active: rgba(235, 235, 245, 0.12);     /* was rgba(0,0,0,0.065) */
--sat-staff-fill-avatar: rgba(235, 235, 245, 0.10);     /* was rgba(0,0,0,0.06) */
--sat-staff-fill-chip: rgba(235, 235, 245, 0.10);       /* was rgba(0,0,0,0.04) */
--sat-staff-fill-chip-hover: rgba(235, 235, 245, 0.16); /* was rgba(0,0,0,0.07) */
--sat-staff-skeleton-bar: rgba(235, 235, 245, 0.14);    /* was rgba(0,0,0,0.07) */
--sat-staff-skeleton-bar-soft: rgba(235, 235, 245, 0.10); /* was rgba(0,0,0,0.05) */
```
Values alias the shipped dark separator/fill ramp (3268-3271, 3309-3313). Light rules that consume these tokens need no edit.

**Step 4 — Text + neutral family (dark).**
In the same dark block, add:
```css
--sat-staff-text-primary: #f5f5f7;    /* was var(--sat-label) → #1d1d1f */
--sat-staff-text-secondary: #c7c7cc;  /* was var(--sat-secondary-label) → #515154 */
--sat-staff-text-tertiary: #a1a1a6;   /* was var(--sat-tertiary-label) → #6e6e73 */
--sat-staff-text-faint: #a1a1a6;      /* was var(--sat-tertiary-label) */
--sat-staff-text-inverse: #1c1c1e;    /* was #ffffff — inverse flips: dark text on light pills/chips that stay light */
--sat-staff-text-disabled: #8e8e93;   /* was #9b9a97; aliases shipped dark --sat-disabled-text (line 3286) */
--sat-staff-neutral-dot: #a1a1a6;     /* was #6e6e73 (Phase 01 fix); #6e6e73 fails on #1c1c1e (~2.2:1), #a1a1a6 ≈ 5.3:1 on #1c1c1e, ≥3:1 dot floor PASS */
--sat-staff-neutral-text: #c7c7cc;    /* was var(--sat-secondary-label) light */
```
Contrast intent (recompute in Verification): primary/secondary/tertiary on `#1c1c1e` all ≥ 4.5:1 by construction (same ramp as shipped dark `--sat-label/secondary/tertiary-label`, lines 3265-3267). `--sat-staff-text-inverse` is used for white-on-accent labels — in dark the accent button keeps white text (see Step 5), so verify that pair separately; the token itself flips for any dark-surface/light-text inversion (document the one call site if one exists, else keep for API parity with light).

**Step 5 — Accent + focus family (dark).**
In the same dark block, add:
```css
--sat-staff-accent: #0a72d8;                              /* was var(--sat-accent-core) → #0071e3; aliases dark --sat-accent-core (3276) */
--sat-staff-accent-hover: #1680eb;                        /* was var(--color-au-accent-hover); aliases dark au-accent-hover (3298) */
--sat-staff-accent-active: #075fb8;                       /* was var(--color-au-accent-active); aliases dark au-accent-active (3299) */
--sat-staff-accent-text-on-tint: #8ac2ff;                 /* was #0067c9 (5.55:1 on white, fails on dark) → #8ac2ff (≈7:1 on #1c1c1e) */
--sat-staff-accent-tint: rgba(105, 173, 255, 0.18);       /* was var(--color-au-accent-tint) light; aliases dark au-accent-tint (3304) */
--sat-staff-accent-tint-strong: rgba(105, 173, 255, 0.28);/* was light 0.14 variant; aliases dark (3305) */
--sat-staff-accent-ring: rgba(105, 173, 255, 0.45);       /* was rgba(0,113,227,0.4) — lifts ring visibility on dark */
--sat-staff-accent-ring-soft: rgba(105, 173, 255, 0.22);  /* was rgba(0,113,227,0.1) */
--sat-staff-accent-ring-button: rgba(105, 173, 255, 0.35);/* was rgba(0,113,227,0.25) */
--sat-staff-accent-glow-sm: 0 1px 2px rgba(0, 0, 0, 0.5); /* was 0 1px 2px rgba(0,113,227,0.35) — glow becomes depth on dark */
--sat-staff-accent-glow-md: 0 4px 14px rgba(0, 0, 0, 0.5);
--sat-staff-focus-color: #8ac2ff;                         /* was var(--sat-accent); aliases dark --sat-focus (3280) */
--sat-staff-focus-ring: #8ac2ff;                          /* was color-mix(var(--sat-accent) 72%, white); flat dark focus token */
--sat-staff-focus-width: 3px;                             /* unchanged */
--sat-staff-focus-offset: 2px;                            /* unchanged */
--sat-staff-focus-offset-tight: 1px;                      /* unchanged */
```
White-on-accent check: white `#ffffff` on `#0a72d8` must recompute ≥ 4.5:1 in Verification (light pair was 4.70 PASS; dark accent is close in luminance — if it falls below 4.5, escalate to Phase 01 owner for a joint accent decision; Phase 05 must not unilaterally lighten the accent).

**Step 6 — Status families: danger / warning / success / info + form error (dark).**
In the same dark block, add:
```css
--sat-staff-danger: #ff8f85;               /* was var(--sat-danger) → #b42318; aliases dark --sat-danger (3281) */
--sat-staff-danger-strong: #ff8f85;        /* was #d70015 (fails on dark) → dark danger */
--sat-staff-danger-hover: #ffaaa2;         /* was #c00d10 → dark danger-text (3318) */
--sat-staff-danger-tint: rgba(255, 143, 133, 0.16);  /* was var(--color-au-danger-tint) light; aliases dark (3319) */
--sat-staff-warning: #ffbd70;              /* was var(--sat-warning) → #8a4b00; aliases dark --sat-warning (3283) */
--sat-staff-warning-text: #ffd09a;         /* was #92400e (7.09 on white, fails on dark) → dark au-warning-text (3321) */
--sat-staff-warning-dot: #ffbd70;          /* was #d97706 → dark au-warning (3320); dot ≥3:1 on dark PASS */
--sat-staff-warning-tint: rgba(255, 189, 112, 0.16); /* aliases dark (3322) */
--sat-staff-success-text: #76e8b7;         /* was var(--color-au-success-text) → #067647; aliases dark (3315) */
--sat-staff-success-dot: #58d7a1;          /* was var(--color-au-success) → #059669; aliases dark (3314) */
--sat-staff-success-tint: rgba(88, 215, 161, 0.16);  /* aliases dark (3316) */
--sat-staff-info-text: #8ac2ff;            /* was #0067c9 (fails on dark) → dark focus blue */
--sat-staff-info-dot: #69adff;             /* was #0071e3 → dark section-rw (3300) */
--sat-staff-form-error: #ff8f85;           /* was #dc2626 (fails on dark) → dark danger */
```
Pill construction is unchanged (`TONE_PILL_CLASS` border+tint+text, `TONE_DOT_CLASS` dot) — only resolved colors move. Dot+label weight still carries state (contract §3 preserved).

**Step 7 — Shadows / scrim / shimmer / radii (dark).**
In the same dark block, add:
```css
--sat-staff-shadow-card: var(--au-elevation-card);       /* unchanged ref; resolves to dark elevation (3330-3333) automatically */
--sat-staff-shadow-card-soft: 0 1px 2px rgba(0, 0, 0, 0.45); /* was 0 1px 2px rgba(0,0,0,0.04) — visible on dark */
--sat-staff-shadow-row-press: 0 1px 2px rgba(0, 0, 0, 0.45); /* was …0.05 */
--sat-staff-shadow-menu: var(--sat-menu-elevation);      /* unchanged ref; dark au-elevation-menu applies */
--sat-staff-shadow-dialog: var(--sat-dialog-elevation);  /* unchanged ref */
--sat-staff-shadow-drag: var(--au-elevation-drag);       /* unchanged ref */
--sat-staff-shadow-thumb: 0 1px 3px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.08); /* was light 0.08/0.04 pair */
--sat-staff-scrim: rgba(0, 0, 0, 0.55);                  /* was rgba(22,22,23,0.36) — deeper dim on dark */
--sat-staff-scrim-solid: rgba(0, 0, 0, 0.70);            /* was rgba(22,22,23,0.55) */
--sat-staff-shimmer-sweep: rgba(235, 235, 245, 0.14);    /* was rgba(120,120,128,0.14) */
--sat-staff-shimmer-duration: 1.35s;                     /* unchanged */
--sat-staff-skeleton-pulse-duration: 1.6s;               /* unchanged */
--sat-staff-spinner-duration: 0.8s;                      /* unchanged */
--sat-staff-live-dot-duration: 1.6s;                     /* unchanged */
/* Radii unchanged: chip 999px, control-sm 8px, control 10px, input 12px, menu 13px, card 16px, dialog 22px. */
```
Motion/ease tokens (`--sat-staff-ease`, stagger step/cap, durations) are intentionally untouched.

**Step 8 — Dark-scoped hard-surface overrides (no light edits).**
Still inside `@media (prefers-color-scheme: dark)`, after the token block, add `.sat-product`-scoped overrides that re-point the three hardcoded light surfaces at their dark tokens (light rules at the cited lines stay byte-identical):
```css
.sat-product .sat-dialog,
.sat-dialog.sat-product {
  background: var(--sat-staff-surface, #1c1c1e);
  border-color: var(--sat-staff-separator, rgba(235, 235, 245, 0.24));
} /* light rule src/index.css:2038-2045 keeps background:#ffffff for light */
.sat-product .sat-segmented { background: var(--sat-staff-fill, rgba(235,235,245,0.10)); }
.sat-product .sat-segmented-thumb { background: #2c2c2e; box-shadow: 0 1px 3px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.08); }
.sat-product .sat-menu { background: var(--sat-staff-surface, #1c1c1e); border-color: var(--sat-staff-separator, rgba(235,235,245,0.24)); }
.sat-product .sat-product .sat-list-row:hover { background-color: var(--sat-staff-fill-hover, rgba(235,235,245,0.16)); }
```
Keep the selector list minimal — only surfaces that render stranded-white in dark. Do not add new component classes. The existing dark utility remaps for `bg-white/slate/gray` (3345-3362) and `text-slate-*` (3371-3389) already cover TSX Tailwind literals; verify they suffice (see Edge cases) rather than adding per-route overrides.

**Step 9 — Dark + increased-contrast strengthening.**
In `src/index.css` extend the existing `@media (prefers-color-scheme: dark) and (prefers-contrast: more)` block (lines 3416-3429) with staff mirrors — old (dark base just added) → new (dark+more):
```css
.sat-product {
  --sat-staff-text-secondary: #f0f0f2;   /* was #c7c7cc */
  --sat-staff-text-tertiary: #d1d1d6;    /* was #a1a1a6 */
  --sat-staff-text-faint: #d1d1d6;
  --sat-staff-neutral-text: #f0f0f2;
  --sat-staff-neutral-dot: #d1d1d6;      /* dot stays ≥3:1, lifts with text */
  --sat-staff-separator: rgba(255,255,255,0.5);
  --sat-staff-separator-strong: rgba(255,255,255,0.58);
  --sat-staff-border-hairline: rgba(255,255,255,0.36);
  --sat-staff-border-header: rgba(255,255,255,0.36);
  --sat-staff-border-nav: rgba(255,255,255,0.36);
  --sat-staff-border-input: rgba(255,255,255,0.58);
  --sat-staff-border-strong: rgba(255,255,255,0.58);
  --sat-staff-fill-faint: rgba(255,255,255,0.18);
  --sat-staff-fill-chip: rgba(255,255,255,0.18);
  --sat-staff-skeleton-bar-soft: rgba(255,255,255,0.22);
}
.sat-product :is(input, select, textarea) { border-color: var(--sat-staff-border-input) !important; }
```
Mirrors the shipped light+more pattern (1799-1829) and the existing dark+more separator bump (3426-3428). Status hues do not change under contrast-more (semantics preserved).

**Step 10 — Precedence audit (verify-only, no new code expected).**
Confirm in `src/index.css`: (a) dark media (3215) comes before dark+more (3416) comes before forced-colors (3431) — forced-colors wins over both; (b) `forced-color-adjust: auto` already set on `.sat-product` (1833) so system colors apply; (c) reduced-transparency rules (1771-1795, 2255-2267) use token refs that now resolve dark — no dark-specific transparency fork needed; (d) reduced-motion guards need no dark twin. If any new staff token from Steps 1-7 lacks a forced-colors mapping in 1844-1904, add the one-line system mapping there (e.g. any token accidentally omitted) — that is the only permitted edit outside the dark block, and it must use `Canvas / CanvasText / Highlight / GrayText` only.

## Key code / pseudocode (dirty-guard logic, token blocks, row markup — only what your phase needs)

No dirty-guard logic, no row markup changes in this phase — TSX is frozen. The only code is the dark token block sketched in Steps 1-9. Insertion skeleton:

```css
/* ... existing dark .sat-product au block ends at line ~3323 ... */

.sat-product {
  /* Staff dark appearance (Phase 05) — Steps 1-7 tokens go here.
   * System-following only: no .dark class, no data-theme, no JS. */
  --sat-staff-canvas: #111113;
  --sat-staff-surface: #1c1c1e;
  /* ... (full list per Steps 1-7) ... */
}

/* Hard-surface dark overrides — Step 8 ... */

/* ... existing --au-tint / elevation / remap blocks follow untouched ... */
```

Pill/dot resolution proof (no code change — why tokens suffice):

```tsx
// SatPage.tsx TONE_PILL_CLASS['pending'] (frozen):
// 'border-amber-700/25 bg-[var(--sat-staff-warning-tint,…)] text-[var(--sat-staff-warning-text,#92400e)]'
//  light: tint rgba(217,119,6,0.1)  + text #92400e  → 7.09:1 on white PASS
//  dark:  tint rgba(255,189,112,0.16) + text #ffd09a → ~8-9:1 on #1c1c1e (recompute)
// TONE_DOT_CLASS['pending']: 'bg-[var(--sat-staff-warning-dot,#d97706)]'
//  light: #d97706 (3.19:1, ≥3:1 ok) · dark: #ffbd70 (≥3:1 on dark, recompute)
```

System-preference composition (pseudocode for the verification matrix, not runtime code):

```
for scheme in [light, dark]:
  for contrast in [normal, more]:
    for transparency in [normal, reduced]:
      render each route (Exams, Sessions, Room, Results, Detail, Access)
      assert: no stranded white surfaces in dark; glass collapses to --sat-staff-glass-fallback when transparency=reduced
forced-colors: active × {light, dark} → assert every staff token maps to Canvas/CanvasText/Highlight/GrayText; focus outline Highlight 3px
reduced-motion: on → assert .sat-row-enter/.sat-route-enter/.sat-live-dot/.sat-spinner/.sat-skeleton-shimmer::after all animation:none
```

## Edge cases (empty states, loading/error, polling refresh, keyboard, reduced-motion/transparency/contrast, forced-colors, 320px, 200% text)

- **Empty states** (`SatEmptyState` card + icon tile): icon tile uses `--sat-staff-surface` + hairline border + tertiary icon — in dark must read as a raised card on canvas (`#1c1c1e` on `#111113`), not a white island. Verify on Exams/Sessions/Results empty fixtures in both schemes.
- **Loading (skeleton-XOR):** `SatListSkeleton` bars use `--sat-staff-skeleton-bar(-soft)` + `sat-skeleton-shimmer` sweep. Dark bars `rgba(235,235,245,0.14/0.10)` + sweep `rgba(235,235,245,0.14)` must shimmer visibly on `#1c1c1e` without strobing; `animate-pulse` stays forbidden (pinned by `SatPage.test`). Never render skeleton + `SatResultCount` together (double-announce) in either scheme.
- **Error:** `SatInlineError` card + `--sat-staff-form-error: #ff8f85` in dark; retry button is accent-primary (white on `#0a72d8`) — recompute that pair explicitly.
- **Polling refresh (Session Room):**  room polls runtime/roster on an interval; token flip must not reset timers, selection, attention filter, or stage clock. Dark is pure CSS — no re-render, no interval restart. Verify clock (`text-[36px] tabular`) and `Updating…` hint stay legible mid-poll in dark.
- **Keyboard:** focus rings resolve to `--sat-staff-focus-ring: #8ac2ff` in dark (3px, offset 2px/1px tight). Verify visible on every interactive element in dark: rows, search clear, chips, segmented options, menu items, dialog buttons, roster options (`role=option`), stat filter buttons. Forced-colors focus is `Highlight` (existing rule 1906-1908) — unchanged.
- **Reduced-motion:** no new animations introduced; stagger cap (first 6, 60ms step, 160ms row / 140ms banner) and `sat-live-dot` pulse keep existing guards. Dark must not add transitions (color changes inherit the existing 120-160ms state transitions only).
- **Reduced-transparency:** with `prefers-reduced-transparency: reduce`, all five glass vars collapse to `--sat-staff-glass-fallback` (now dark) and blurs go `none`; dialog overlay uses `--sat-staff-scrim-solid` (now `rgba(0,0,0,0.70)`); menus/dialogs use `--sat-staff-surface-solid-fallback` (now `#1c1c1e`). Verify sidebar/header/room-glass/bottom-nav/roster each turn opaque in dark+reduced-transparency.
- **Contrast-more:** light+more (1799-1829) and dark+more (Step 9) both strengthen separators/borders/text without changing status hues. Verify pill text still ≥ 4.5:1 in all four scheme×contrast combos.
- **Forced-colors:** all staff tokens map to `Canvas/CanvasText/Highlight/GrayText` (1831-1909 + 3431-3474); dots collapse to `CanvasText`/`GrayText` and state is carried by label weight + text (contract preserved). Verify in Edge + Firefox forced-colors emulation; confirm cascade order (forced-colors block last) is not disturbed.
- **320px viewport:** dark changes no layout, padding, or radius — bottom-docked sheet (<640px), roster/detail stacking, and stat grid behave identically. Spot-check one 320px dark screenshot per route; any overflow is a layout regression, not a dark defect — route to owning phase, do not fix here.
- **200% text / content zoom:** dark changes no font-size or line-height; `[data-sat-content-zoom]` is student-delivery scope and untouched. Verify no clipped pill text or truncated hero score at 200% in dark (same as light).
- **Tailwind literal leakage:** routes still contain `text-slate-*/bg-slate-*/bg-white/border-slate-*` literals (e.g. `SatSessionsRoute:162 chevron text-slate-300`, `SatSessionRoomRoute:273-290 slate-800/900/600/400`). In dark these are remapped by 3371-3389 (`text-slate-400/500/600→secondary, 700-950→text`) and 3345-3368 (bg/border). Verify each route in dark has no dark-on-dark or light-on-light text; if a literal escapes the remap (e.g. `text-amber-800/700`, `bg-emerald-500`, `text-red-600`, `bg-slate-900 text-white` chips in SessionRoom/ExamLibrary), record it as a **finding for Phase 01/02 owners** (tokenize to staff tokens) — do not hot-fix TSX in this phase.
- **No-toggle proof:** no visible theme switcher may appear in any route; OS scheme change must flip the workspace without reload (CSS media only). Rotation between schemes must not lose form input, dialog open state, or scroll position.

## Tests (which existing tests must pass; which new unit/contract tests to add, with file paths and assertion sketches)

**Existing tests that must stay green (no modifications):**

- `src/products/sat/ui/__tests__/satContractsCss.test.ts` — F-A6 search-clear centering, F-A12 route-fade + reduced-motion guard.
- `src/products/sat/ui/__tests__/SatPage.test.tsx` — `SatStatusPill` dot+label, live pulse only, search clear/Escape, row stagger cap + no-lift, `satOutcomeTone` table, no `bg-[#0071e3]` literal.
- `src/products/sat/ui/__tests__/Dialogs.test.tsx` — confirm/cancel answers, Escape cancel, pristine-close paths.
- `src/products/sat/ui/__tests__/Menu.test.tsx`, `SegmentedControl.test.tsx`, `useSatListParams.test.tsx` — primitives + list params unchanged.
- `src/products/sat/__tests__/SatRoot.test.tsx` — nav/chrome contracts.
- `src/products/sat/routes/__tests__/SatExamLibraryRoute.test.tsx`, `SatSessionsRoute.test.tsx`, `SatResultsRoutes.test.tsx`, `SatSessionRoomRoute.test.tsx`, `scheduleValidation.test.ts` — page behavior frozen.

**New contract tests to add (all in `src/products/sat/ui/__tests__/satContractsCss.test.ts` — the only test file this phase writes):**

1. `DARK-01: dark media sets color-scheme: dark for .sat-product` — assert `css` matches `/@media\s*\(prefers-color-scheme:\s*dark\)[\s\S]*?\.sat-product[\s\S]*?color-scheme:\s*dark/`.
2. `DARK-02: every --sat-staff-* light token has a dark override` — extract light token names from the `.sat-product { … }` block at 1592-1700 via regex `/(--sat-staff-[a-z0-9-]+)\s*:/g`, extract dark-block names from the `@media (prefers-color-scheme: dark)` region, assert the dark set ⊇ light set minus an explicit allowlist (radii, motion durations, ease — enumerated in the test with a comment citing this plan §Step 7). Fails loudly when a future token ships light-only.
3. `DARK-03: no light-only white glass survives in dark` — assert the dark region contains `--sat-staff-glass-sidebar: rgba(28, 28, 30`, `--sat-staff-surface-solid-fallback: #1c1c1e`, and `--sat-staff-surface: #1c1c1e`; assert it does NOT contain `rgba(255, 255, 255, 0.82)` inside the dark media range.
4. `DARK-04: status text/dot dark twins present` — assert dark region contains `--sat-staff-warning-text: #ffd09a`, `--sat-staff-success-text: #76e8b7`, `--sat-staff-info-text: #8ac2ff`, `--sat-staff-danger: #ff8f85`, `--sat-staff-neutral-dot: #a1a1a6`, `--sat-staff-form-error: #ff8f85`.
5. `DARK-05: no theme toggle surface` — assert `css` does not match `/data-theme|data-sat-theme|\.dark\b/` within `.sat-product` scope AND `grep -rn "useState.*theme\|localStorage.*theme\|matchMedia.*color-scheme" src/products/sat` is empty (encode as a skipped-if-unavailable assertion with a comment, or a CI grep gate in Verification).
6. `DARK-06: forced-colors still wins after dark` — assert `css.indexOf('@media (forced-colors: active)') > css.indexOf('@media (prefers-color-scheme: dark)')` and that the forced-colors region maps `--sat-staff-surface: Canvas` + `--sat-staff-accent: Highlight`.
7. `DARK-07: dark+contrast-more strengthens staff text/borders` — assert the `@media (prefers-color-scheme: dark) and (prefers-contrast: more)` region contains `--sat-staff-text-secondary: #f0f0f2` and `--sat-staff-border-input`.
8. (Optional, recommended) `DARK-08: computed dark contrast floors` — import a tiny luminance helper in the test (or assert against a checked-in JSON table produced by the Verification script) for the 10 pairs: primary/secondary/tertiary/info/success/warning/danger-text on `#1c1c1e`-derived surfaces + white-on-`#0a72d8` + neutral-dot on surface. Each text ≥ 4.5, each dot ≥ 3.0. If the helper is deemed too heavy for a contract test, keep the table assertion and run the full recompute in Verification instead.

Assertion sketch (DARK-02 pattern):

```ts
const darkRegion = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
const lightBlock = css.match(/\.sat-product\s*\{([^}]*--sat-staff-canvas[^}]*)\}/)?.[1] ?? '';
const names = (s: string) => new Set([...s.matchAll(/(--sat-staff-[a-z0-9-]+)\s*:/g)].map(m => m[1]));
const EXEMPT = new Set(['--sat-staff-radius-chip','--sat-staff-radius-control-sm','--sat-staff-radius-control','--sat-staff-radius-input','--sat-staff-radius-menu','--sat-staff-radius-card','--sat-staff-radius-dialog','--sat-staff-ease','--sat-staff-ease-press','--sat-staff-motion-hover','--sat-staff-motion-state','--sat-staff-motion-banner','--sat-staff-motion-row','--sat-staff-motion-press','--sat-staff-motion-dialog','--sat-staff-motion-dialog-max','--sat-staff-stagger-step','--sat-staff-stagger-cap','--sat-staff-focus-width','--sat-staff-focus-offset','--sat-staff-focus-offset-tight','--sat-staff-shimmer-duration','--sat-staff-skeleton-pulse-duration','--sat-staff-spinner-duration','--sat-staff-live-dot-duration']);
for (const n of names(lightBlock)) if (!EXEMPT.has(n)) expect(darkRegion).toContain(n + ':');
```

## Verification (exact commands: vitest paths, tsc, eslint, grep gates, contrast recompute)

Run in order; stop and return to the owning step on first red.

1. **Contract + unit (SAT scope):**
   ```bash
   npx vitest run src/products/sat/ui/__tests__/satContractsCss.test.ts
   npx vitest run src/products/sat
   ```
2. **Typecheck + lint:**
   ```bash
   npx tsc --noEmit
   npx eslint src/index.css src/products/sat 2>&1 | head -n 60
   # (repo script equivalents: npm run typecheck, npm run lint — use npx forms above for scoped output)
   ```
3. **Grep gates (all must print the PASS shape shown):**
   ```bash
   # G1 — dark staff block exists, scoped to .sat-product only:
   grep -n "prefers-color-scheme: dark" src/index.css
   # expect: line 3215 block + 3416 dark+more; new staff tokens inside that range only
   # G2 — no toggle / no JS theme state (expect empty):
   grep -rn "data-theme\|data-sat-theme\|\.dark\b" src/products/sat src/index.css | grep -v "sat-ui" || echo "G2 PASS: no toggle surface"
   grep -rn "matchMedia.*color-scheme\|localStorage.*theme\|useState.*[Tt]heme" src/products/sat || echo "G2b PASS: no JS theme state"
   # G3 — no .sat-ui diff (expect empty):
   git diff --name-only | grep -v "plans-sat-remediation/" || echo "G3 CHECK: working tree file list above"
   git diff -- src/index.css | grep "^[+-].*\.sat-ui" || echo "G3 PASS: no .sat-ui lines touched"
   # G4 — no new hex literals in TSX (expect empty):
   git diff -- 'src/products/sat/**/*.tsx' | grep -E "^\+.*#[0-9a-fA-F]{3,8}" || echo "G4 PASS: no new TSX hex"
   # G5 — type floor still holds (expect empty — owned by Phase 01, re-pinned here):
   grep -rn "text-\[8px\]\|text-\[9px\]" src/products/sat || echo "G5 PASS: no sub-11px text"
   # G6 — forced-colors after dark (expect first number < second):
   grep -n "@media (forced-colors: active)" src/index.css | head -n 5
   grep -n "@media (prefers-color-scheme: dark)" src/index.css
   ```
4. **Contrast recompute (computed, not eyeballed) — run and paste the table into the PR:**
   ```bash
   node -e "
   const pairs=[['primary #f5f5f7 on #1c1c1e','#f5f5f7','#1c1c1e',4.5],['secondary #c7c7cc on #1c1c1e','#c7c7cc','#1c1c1e',4.5],['tertiary #a1a1a6 on #1c1c1e','#a1a1a6','#1c1c1e',4.5],['info #8ac2ff on #1c1c1e','#8ac2ff','#1c1c1e',4.5],['success #76e8b7 on #1c1c1e','#76e8b7','#1c1c1e',4.5],['warning #ffd09a on #1c1c1e','#ffd09a','#1c1c1e',4.5],['danger #ff8f85 on #1c1c1e','#ff8f85','#1c1c1e',4.5],['white on accent #0a72d8','#ffffff','#0a72d8',4.5],['neutral-dot #a1a1a6 on #1c1c1e','#a1a1a6','#1c1c1e',3.0],['warning-dot #ffbd70 on #1c1c1e','#ffbd70','#1c1c1e',3.0],['success-dot #58d7a1 on #1c1c1e','#58d7a1','#1c1c1e',3.0]];
   const lum=h=>{const c=[1,3,5].map(i=>{let v=parseInt(h.slice(i,i+2),16)/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};
   const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05)};
   let fail=0; for (const [n,f,b,min] of pairs){const r=ratio(f,b); const ok=r>=min; if(!ok)fail++; console.log((ok?'PASS':'FAIL')+' '+r.toFixed(2)+':1 (floor '+min+') '+n)}
   // Note: pill text sits on tint-over-surface, not flat surface — treat flat-surface ratios as the conservative floor;
   // spot-check two tint composites (warning/info pill bg) with a color-mix sampler in the PR if any flat pair is marginal (<5.0).
   process.exit(fail?1:0);
   "
   ```
   Gate: exit 0 (all PASS). If white-on-`#0a72d8` fails 4.5, do not adjust in this phase — flag to Phase 01 owner and block Phase 05 on the joint decision.
5. **Build + e2e matrix:**
   ```bash
   npm run build
   npm run e2e:sat-a11y
   ```
   Plus manual (or Playwright `emulateMedia`) matrix — minimum 8 dark passes + forced-colors spot-checks, one screenshot per route per cell that renders the route's signature surface (Exams list, Sessions list + New Session sheet, Room roster+detail+clock, Results list, Detail hero+sections, Access):
   - dark × contrast-normal × transparency-normal (all 6 routes)
   - dark × contrast-more (Results + Room roster minimum; all routes recommended)
   - dark × reduced-transparency (nav/sidebar/header/menu/dialog opaque check)
   - light regression sanity (Results + Room — dark must not leak into light)
   - forced-colors active (Room roster + Results pill + one dialog)
   - Precedent snippet for scripting: `await page.emulateMedia({ colorScheme: 'dark', contrast: 'more', reducedMotion: 'reduce' });` (cf. `e2e/browser-compatibility.spec.ts:84-93`).
6. **Visual proof:** attach before/after dark screenshots for at least Room (roster + stage clock), Results row (pill), and one dialog; note the OS/browser used. No screenshot, no merge.

## Definition of done (checklist, measurable)

- [ ] `src/index.css` is the only source file changed (plus `satContractsCss.test.ts` for new assertions); `git diff --name-only` shows no `.sat-ui`, no TSX, no backend, no store/network/auth files.
- [ ] Every non-exempt `--sat-staff-*` token from the light block (1592-1700) has a dark override inside `@media (prefers-color-scheme: dark)` — DARK-02 green.
- [ ] No stranded light surfaces in dark: dialog card, menu, segmented thumb/track, glass nav stack, skeleton bars, list-row hover all resolve dark (manual matrix + DARK-03 green).
- [ ] Dark contrast table recomputed with the §Verification script: 7 text pairs ≥ 4.5:1, 3 dot pairs ≥ 3:1, white-on-accent ≥ 4.5:1 — pasted into the PR, exit 0.
- [ ] Dark+contrast-more block extended (§Step 9) and verified; light+more untouched and still green.
- [ ] Forced-colors precedence preserved (forced-colors block after dark; DARK-06 green) and spot-checked in Edge/Firefox emulation.
- [ ] Reduced-transparency collapses glass to dark fallbacks; reduced-motion guards byte-identical in behavior (no new animations).
- [ ] System-following proven: OS scheme flip changes the workspace with no reload, no toggle UI exists (G2/G2b empty), form/dialog/scroll state survives the flip.
- [ ] Full gates green: `vitest run src/products/sat` + contracts file, `tsc --noEmit`, `eslint`, `vite build`, `e2e:sat-a11y` (or documented equivalent), G1-G6 gates recorded in the PR.
- [ ] Findings outside this phase (e.g. non-remapped `text-amber-*`/`bg-emerald-*` literals, white-on-accent marginality) are filed to the owning phase — not hot-fixed here.
