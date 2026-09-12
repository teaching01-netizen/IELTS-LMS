# Phase 01 — Design Foundation (type · spacing · radius · elevation · border · measure)

## 1. Objective

Freeze the design system that every later phase consumes, **without changing a single component**:

- one 6-step type scale used by every authoring surface,
- one spacing scale (4/8/12/16/20/24/32/40/48/64) expressed as CSS custom properties,
- one radius set (6/8/10/12/14/16),
- ≤ 4 elevation levels,
- a **border policy** (borders are structural, never decorative),
- new measure tokens: canvas 840 (adaptive 720–920), navigator 272 (240–320), inspector 304,
- semantic colour rules written down (accent = interactive only; neutral = required/optional; red = blocking; green = resolved).

Deliverable = tokens + a contract test that pins them. Later phases only *consume*.

## 2. Dependencies

- Requires: nothing (Wave 1, runs alone).
- Blocks: **all** phases (02–07 read these tokens).
- Owns: `src/features/exam-authoring/ui/spine/spine.css` (token block at the top), the authoring token block in `src/index.css` (lines ~36–98: `--spacing-*`, `--text-au-*`, `--radius-au-*`, `--color-au-*`).
- Does **not** own: any `.tsx` file. If a token cannot be adopted without touching a component, note it and defer to the owning phase.

## 3. Current state (verified)

```css
/* src/index.css:36-44 — spacing tokens exist but are incomplete */
--spacing-1: 0.25rem; --spacing-2: 0.5rem; --spacing-3: 0.75rem;
--spacing-4: 1rem;    --spacing-5: 1.25rem; --spacing-6: 1.5rem;
--spacing-8: 2rem;    --spacing-10: 2.5rem; --spacing-12: 3rem;
/* no 20px-in-rem alias beyond --spacing-5, no 64px step */

/* src/index.css:81-92 — type scale is NOT a scale: 11,12,13,15,17,22 + arbitrary
   Tailwind text-[10px]/text-[11px]/text-[13px] used directly in spine components */

/* src/index.css:95-98 — radii */
--radius-au-sm: 7px; --radius-au-md: 10px; --radius-au-lg: 12px; --radius-au-xl: 16px;
/* components additionally hardcode rounded-md / rounded-lg / rounded-xl / rounded-[10px] / rounded-[12px] */

/* src/index.css:1921-1924 — elevation */
--au-elevation-card: 0 1px 2px rgba(0,0,0,0.04);   /* plus menu/sheet/drag variants */

/* src/features/exam-authoring/ui/spine/spine.css:19-20 */
--spine-measure: 720px;
--spine-rail-width: 384px;
```

Measured problems to solve here:
1. **Type**: components use `text-[10px]`, `text-[11px]`, `text-[13px]`, `text-[22px]`, `text-xs`, `text-sm` interchangeably for the same semantic level. There is no named scale to converge on.
2. **Spacing**: sections use `space-y-6`, `mb-7`, `mt-10`, `p-4`, `px-3.5`, `py-2.5` ad hoc.
3. **Radius**: 6 different values in the spine alone.
4. **Border**: `spine-card` puts a border on every logical group.
5. **Measure**: 720 canvas + 384 rail is the squeeze the operator reported (spec §3).

## 4. Behavioral contract (what this phase must guarantee)

- Every token is **additive**: no existing token is renamed or deleted. Existing components keep rendering identically after this phase.
- Tokens are declared under `.sat-spine` (authoring scope) so they cannot leak into `.sat-ui` or IELTS.
- New tokens are consumed by later phases only. This phase's own diff must not alter any rendered pixel.
- All tokens are documented in a comment block at the top of `spine.css` with the exact allowed values, so later phases cannot invent new ones.

## 5. Design decisions

- **Decision: authoring tokens live in `spine.css`, not `index.css`.**
  Reason: `spine.css` is already scoped to `.sat-spine`, is imported by `SpineLayout` only, and is the single file later phases will append to. `index.css` is shared with the student delivery system and every unrelated lane in this worktree; adding authoring-only tokens there increases collision risk. Rejected: putting measures in `index.css` beside `--radius-au-*` (would tempt non-authoring surfaces to consume them).
- **Decision: keep the Tailwind utility layer; do not rewrite components to CSS classes.**
  Reason: components are Tailwind-first and tests assert on class strings (`AnswerKeyField.test.tsx` asserts `min-h-[44px]`). The token layer must therefore work through **arbitrary Tailwind values** (`text-[length:var(--spine-text-body)]` is verbose) — so the scale is delivered as (a) CSS custom properties for CSS files and (b) a **documented mapping table** (semantic level → Tailwind class) that later phases apply. Rejected: replacing Tailwind with hand-written CSS (massive churn, breaks class-string tests).
- **Decision: the type scale is 6 steps, mapped to existing Tailwind classes.**
  ```text
  display  28px / 1.15 / 600   text-[28px] font-semibold tracking-tight   Question title
  title    20px / 1.25 / 600   text-xl font-semibold                     Section heading
  label    14px / 1.4  / 600   text-sm font-semibold                     Field label
  body     16px / 1.6  / 400   text-base                                Editor content
  helper   13px / 1.5  / 400   text-[13px]                              Helper / secondary
  meta     12px / 1.4  / 500   text-xs font-medium                      Metadata / counts
  ```
  Rationale for 6 steps: the operator's spec §23 asks for a "disciplined hierarchy" and explicitly forbids uppercase+tracking as the hierarchy mechanism. Six steps cover display/title/label/body/helper/meta with no gaps and no near-duplicates (the current 13/14/15/17 cluster is the problem).
- **Decision: spacing scale is the 8px-derived set with 4px as the only sub-step.** Spec §24. Delivered as `--spine-space-*` + a Tailwind mapping (`4→1, 8→2, 12→3, 16→4, 20→5, 24→6, 32→8, 40→10, 48→12, 64→16` — all already exist in Tailwind's default scale, so no new utility layer is needed; the tokens exist for CSS files and for the documentation contract).
- **Decision: radius set = 6 / 8 / 10 / 12 / 14 / 16, mapped onto the existing `--radius-au-*` where semantics match.** `--radius-au-sm (7px) → 6px is a **token value change** that affects other surfaces; therefore do **not** change it here. Instead declare authoring-local `--spine-radius-*` and record the mapping; the 7px→6px convergence is deferred and documented as accepted drift.
- **Decision: elevation stays at the existing 4 levels** (`card / menu / sheet / drag`) and the authoring surface **reduces** its own usage (Phase 04 removes card elevation from sections). No new elevation tokens.
- **Decision: border policy is written, not enforced by a test.** Policy: borders only for (1) structural separation (header hairline, navigator divider), (2) focus/editable regions, (3) tables, (4) popovers/menus. Anything else must use whitespace + typography. Phase 04 enforces it by removing `spine-card` usage.

## 6. Detailed TODOs

### 6.1 Token block (spine.css)

- [ ] **1.1** Add a documentation header block to `spine.css` (above `.sat-spine`) containing: the 6-step type scale table, the spacing scale, the radius set, the elevation levels, the border policy, the semantic colour rules, and the measure tokens. This block is the contract later phases read.
  Verify: comment exists; no rule changes.
- [ ] **1.2** Extend the `.sat-spine` custom-property block:
  ```css
  /* measures */
  --spine-measure: 840px;              /* canvas; adaptive 720-920 via clamp below */
  --spine-measure-compact: 720px;
  --spine-measure-wide: 920px;
  --spine-rail-width: 272px;
  --spine-rail-min: 240px;
  --spine-rail-max: 320px;
  --spine-inspector-width: 304px;
  /* type */
  --spine-text-display: 1.75rem;       /* 28 */
  --spine-text-title: 1.25rem;         /* 20 */
  --spine-text-label: 0.875rem;        /* 14 */
  --spine-text-body: 1rem;             /* 16 */
  --spine-text-helper: 0.8125rem;      /* 13 */
  --spine-text-meta: 0.75rem;          /* 12 */
  /* spacing */
  --spine-space-1: 0.25rem; --spine-space-2: 0.5rem;  --spine-space-3: 0.75rem;
  --spine-space-4: 1rem;    --spine-space-5: 1.25rem; --spine-space-6: 1.5rem;
  --spine-space-8: 2rem;    --spine-space-10: 2.5rem; --spine-space-12: 3rem;
  --spine-space-16: 4rem;
  /* radius */
  --spine-radius-xs: 6px; --spine-radius-sm: 8px;  --spine-radius-md: 10px;
  --spine-radius-lg: 12px; --spine-radius-xl: 14px; --spine-radius-2xl: 16px;
  /* motion (aliases only — values already exist in src/shared/motion.ts) */
  --spine-dur-hover: 120ms; --spine-dur-focus: 150ms; --spine-dur-popover: 170ms;
  --spine-dur-panel: 220ms;
  --spine-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --spine-ease-in: cubic-bezier(0.4, 0, 1, 1);
  ```
  Verify: `npx vite build` succeeds (CSS custom properties are not type-checked; a build pass proves syntax).
- [ ] **1.3** Change `.sat-spine__column` to consume the adaptive measure:
  ```css
  .sat-spine__column {
    margin-inline: auto;
    width: calc(100% - 2rem);
    max-width: clamp(var(--spine-measure-compact), 62vw, var(--spine-measure));
    padding-block: 1.75rem 6rem;
  }
  ```
  Rationale: the operator asked for 800–900px with an adaptive range (spec §10). `clamp()` gives 720 at ~1160px viewport, 840 at ~1350px, and never exceeds 840. The 920 wide step is reserved for table-heavy content in Phase 04 (a modifier class), not applied here.
  Verify: visual inspection is not available to the agent; assert via the CSS contract test in 1.5 (string match on the clamp) and by confirming no other rule overrides `.sat-spine__column`.
- [ ] **1.4** Change `.sat-spine__queue` to `--spine-rail-width` (272px) with min/max guards:
  ```css
  .sat-spine__queue {
    flex: 0 0 clamp(var(--spine-rail-min), var(--spine-rail-width), var(--spine-rail-max));
    width: clamp(var(--spine-rail-min), var(--spine-rail-width), var(--spine-rail-max));
    /* existing border-right / background / overflow unchanged */
  }
  ```
  Note: at 272px the Phase-03 row redesign is required for the content to fit — Phase 01 deliberately does not compensate by shrinking text.
- [ ] **1.5** Add `src/features/exam-authoring/ui/spine/__tests__/spineTokens.test.ts` — a CSS contract test modelled on `src/products/sat/ui/__tests__/satContractsCss.test.ts`:
  - reads `src/features/exam-authoring/ui/spine/spine.css` via `readFileSync`;
  - asserts each token name from 1.2 exists with the exact value;
  - asserts `.sat-spine__column` contains a `clamp(` whose first argument is `var(--spine-measure-compact)` and whose third argument is `var(--spine-measure)` (regex, whitespace-tolerant);
  - asserts `.sat-spine__queue` uses `clamp(${--spine-rail-min}`;
  - asserts the documentation header contains the strings `display`, `title`, `label`, `body`, `helper`, `meta` (proves the scale is documented, not implied).
  Verify: `npx vitest run src/features/exam-authoring/ui/spine/__tests__/spineTokens.test.ts` green.

### 6.2 Colour semantics (documentation + guard)

- [ ] **1.6** Add the semantic colour rules to the `spine.css` documentation header:
  ```text
  accent (#0071e3 / --color-au-accent)  interactive · selection · focus · primary action
  neutral (muted-foreground)            required / optional markers, counts, metadata
  red (--color-au-danger-text)          blocking error, destructive confirmation
  amber (--color-au-warning-text)       non-blocking warning
  green (--color-au-success-text)       resolved / success only
  RULE: never use accent for a non-interactive label. Never use red for emphasis.
  ```
- [ ] **1.7** Add `src/features/exam-authoring/ui/spine/__tests__/spineColorSemantics.test.ts` guard: scan the spine + canvas + navigator component sources for the anti-patterns the spec calls out, and fail if present **after** the owning phase. Ship it with an explicit allow-list so it fails today only for files this phase cannot touch:
  ```ts
  // Anti-patterns scanned:
  //  1. bg-primary/10 + text-primary on a non-interactive label  -> "Required" pill
  //  2. text-destructive used with no blocking issue in scope
  //  3. uppercase tracking-\[ on section labels
  const ALLOW: Record<string, string[]> = { /* filled by later phases as they land */ };
  ```
  Rationale: AC-12 and AC-13 are easy to regress. A grep-test makes them permanent.
  Note: at Phase-01 time the scan **will** find hits in `SpineFieldLabel.tsx`, `AnswerKeyField.tsx`, `SpineStep.tsx`. The test therefore ships asserting "the offender list equals this exact set" — later phases shrink the list, and Phase 08 requires it to be empty. This keeps the guard honest without blocking Phase 01.
  Verify: test green with the frozen offender list; add a comment naming the owning phase for each entry.

### 6.3 Baseline manifest (consumed by Phase 08)

- [ ] **1.9** Capture the pre-initiative state of the paths this initiative must NOT touch, so Phase 08 can prove scope (AC-19) despite this worktree carrying hundreds of unrelated in-flight modifications:

  ```bash
  {
    find src/products/sat src/features/student-delivery src/features/student \
         src/features/proctor src/features/admin backend api \
         -type f 2>/dev/null | sort | xargs md5sum 2>/dev/null;
    find src/features/exam-authoring src/index.css -type f | sort | xargs md5sum;
  } > plans/authoring-redesign/baseline-manifest.txt
  wc -l plans/authoring-redesign/baseline-manifest.txt
  ```

  Record the line count in the phase log. Phase 08 re-runs the same command and diffs the output; any difference inside a forbidden path is a scope violation, any difference inside an owned path is expected.

### 6.4 Authoring token adoption map (documentation only)

- [ ] **1.10** Append the adoption map to the documentation header so later phases copy from it verbatim:
  ```text
  element                       class
  question title                text-[28px] font-semibold tracking-tight
  section heading               text-xl font-semibold
  field label                   text-sm font-semibold
  editor body                   text-base
  helper text                   text-[13px]
  metadata / counts             text-xs font-medium tabular-nums
  section gap                   40px (space-y-10)
  group gap                     24px (space-y-6)
  label -> content              8px  (mb-2)
  ```
  Verify: presence asserted by the contract test in 1.5 (extend it to grep these strings).

## 7. File-by-file plan

- **CHANGE** `src/features/exam-authoring/ui/spine/spine.css`
  - insert documentation header (1.1, 1.6, 1.10)
  - extend `.sat-spine` token block (1.2)
  - `.sat-spine__column` adaptive measure (1.3)
  - `.sat-spine__queue` rail clamp (1.4)
- **ADD** `src/features/exam-authoring/ui/spine/__tests__/spineTokens.test.ts` (1.5)
- **ADD** `src/features/exam-authoring/ui/spine/__tests__/spineColorSemantics.test.ts` (1.7)
- **ADD** `plans/authoring-redesign/baseline-manifest.txt` (1.9)
- **VERIFY (no change)** `src/index.css` — confirm the existing `--spacing-*` / `--text-au-*` / `--radius-au-*` / `--au-elevation-*` values are what the documentation claims; if any claim is wrong, fix the documentation, never the token.
- **VERIFY (no change)** `.sat-ui` and `.sat-product` blocks — untouched (AC-19).

## 8. State / side-effect analysis

- No React state, no data flow, no network. This phase is CSS + tests only.
- The only runtime behaviour change is the layout geometry of the authoring shell (canvas wider, rail narrower). That is intentional and is the first half of AC-03.
- Risk: at <1280px the 272px rail plus 720px canvas plus padding may overflow. Mitigation: the existing `@media (max-width: 900px)` rule hides the rail entirely; between 900–1280 the `clamp()` returns 720 for the canvas and the rail stays 272 → 992px + padding fits in 1024. Confirm by reading the media query and documenting the arithmetic in the phase log.

## 9. Error / edge matrix

| Condition | Expected | Handling |
|---|---|---|
| Viewport 1024px | rail 272 + canvas 720 + 32 padding = 1024 | clamp keeps canvas at its compact floor |
| Viewport 1440px | rail 272 + canvas 840 | clamp ceiling |
| Viewport ≤900px | rail hidden (existing rule) | unchanged |
| Browser without `clamp` support | baseline Vite/Playwright targets all support it | no fallback needed; document |
| Reduced motion | n/a (no motion added) | — |
| Forced colors | existing forced-colors block untouched | verify no new rule paints a colour-only affordance |

## 10. Test strategy

- **New**: `spineTokens.test.ts` (token presence + measure wiring + documented scale), `spineColorSemantics.test.ts` (frozen offender list).
- **Regression**: the full authoring suite must stay green — this phase changes no component, so any failure means a CSS-only change leaked into a class-string assertion (unlikely) or the CSS file failed to parse (build).
- **Gate**:
  ```bash
  npx vitest run src/features/exam-authoring
  npx eslint src/features/exam-authoring
  npx vite build
  grep -n "spine-measure\|spine-rail\|spine-inspector" src/features/exam-authoring/ui/spine/spine.css
  ```

## 11. Definition of done

- [ ] Documentation header present with type/spacing/radius/elevation/border/colour/adoption sections.
- [ ] All `--spine-*` tokens declared with the exact values in 1.2.
- [ ] Canvas measure adaptive (720–840), rail 272 with min/max guards, inspector width token declared.
- [ ] Two new contract tests green; full authoring suite green; eslint clean; `vite build` passes.
- [ ] Zero `.tsx` files changed (prove with `git diff --stat -- src/features/exam-authoring/ui/spine/spine.css src/index.css`).
- [ ] `plans/authoring-redesign/phase-01-verification-log.md` written with command output.

