# SAT Internal Staff Workspace — High-End UI Overall Plan

> Workflow: ai-planning-workflow · Stage: PLAN ONLY (no implementation yet)
> Scope: SAT internal/staff React surface only — `src/products/sat/**` + SAT product CSS in `src/index.css` (`.sat-product` scope).
> Out of scope: exam-mode Bluebook system (`.sat-ui`, `src/features/student-delivery/**`), IELTS surfaces (`src/components/student/**`), backend, persistence, timing, scoring, auth.

## 1. Goal

Take the SAT staff workspace (Exam Library, Sessions, Session Room, Results, Result Detail, Student Access) from "clean functional ops UI" to **high-end 2026 product UI** while preserving every behavioral and accessibility contract.

High-end means (per 2026ui skill):
- **Soft spatial UI**: layered cards, 1px border + very soft shadow, 16–24px radii, calm `#F5F5F7`-family canvas, clear foreground/background separation.
- **Glass sparingly**: one glass nav layer (sidebar / sticky room header / mobile bars) + solid readable content cards. Never glass over busy backgrounds, never low-contrast text on glass, always solid fallback.
- **Bento where it pays**: Sessions/Results stat strips → true bento summary; Result Detail performance → bento score hero + module cards; Session Room → roster + stage + detail bento instead of flat grid.
- **Editorial typography**: confident page titles (30px, -0.045em already good — keep), stronger section titles, short confident descriptions, no tiny-gray-everywhere, no gradient text.
- **Warm human texture**: one subtle human detail max (e.g. empty-state illustration tone, grain-free — readability first). No fake texture over data.
- **2026 components**: 44–52px inputs/buttons with 12–16px radii + strong focus rings, pill badges with dot+label, minimal tables, 150–200ms transitions, no lift-on-hover, no spring in ops lists.

Non-goals:
- No behavior change (filtering, polling, proctor actions, confirm flows, routing, polling intervals stay identical).
- No token rename that churns logic; no new stores; no persistence migration.
- No change to `.sat-ui` Bluebook tokens or exam-mode components.
- No neon, no heavy gradients, no neumorphism, no chatbot-as-UI.

## 2. Current-state snapshot (verified 2026-09-11)

Shell: `SatRoot.tsx` (195 lines) — desktop glass sidebar (244px) + mobile sticky header + mobile bottom nav + `SatRouteFade` (motion 160ms). Role-based nav (builder/grader/proctor/admin). Detail pages hide chrome via regex.

Primitives: `ui/SatPage.tsx` (442 lines) — SatContainer / SatPageHeader / SatSearchField / SatPrimaryButton / SatStatusPill (+ `satOutcomeTone` table) / SatList / SatListRow (button frame, capped stagger first 6, hover = border+shadow only) / SatStatStrip / SatResultCount (polite live region, skeleton-XOR rule) / SatEmptyState / SatListSkeleton (shimmer, not pulse) / SatInlineError / SatReleaseTag / SatEyebrow / SatSectionCard / SatMeta.

Controls: `ui/Menu.tsx` (233 lines, Radix + static fallback, aria-current contract), `ui/SegmentedControl.tsx` (81 lines, radiogroup + roving tabindex + sliding thumb), `ui/ConfirmDialog.tsx` (208 lines, Radix AlertDialog + static fallback, Cancel-focused, backdrop tap never dismisses).

Routes (~1,050 lines total): SatExamLibraryRoute (183) · SatSessionsRoute (248, bucket + search + New Session sheet + StatStrip) · SatSessionRoomRoute (290, sticky room header + roster listbox + detail + SessionControls + confirms) · SatResultsRoute (138, StatStrip + availability filter) · SatResultDetailRoute (178, 52px score hero + section raw/scaled + QuestionRawTable) · SatAccessRoute (36, wraps StudentLinksDashboard).

CSS: `.sat-product` shares `--sat-accent-core: #0071e3` with `.sat-ui`; staff components mostly use inline hex (`#0071e3`, `#f5f5f7`, `black/[0.06]`) + arbitrary Tailwind alphas, NOT the `--color-au-*` authoring tokens. Product CSS contracts live in `src/products/sat/ui/__tests__/satContractsCss.test.ts` (search-clear 32px exemption, route-fade reduced-motion guard) + `SatPage.test.tsx` / `Menu.test.tsx` / `Dialogs.test.tsx` / `SegmentedControl.test.tsx`.

Prior art: `docs/superpowers/plans/2026-09-10-bluebook-design-system.md` is exam-mode only and explicitly leaves staff screens alone — this plan is the staff counterpart and must not leak into `.sat-ui`.

## 3. Architecture

Evolve, don't rebuild. Three layers, one direction (tokens → primitives → pages):

```text
Layer 0 — Tokens (.sat-product scope, src/index.css)
  --sat-staff-* : canvas / surface / border / text / accent / focus / radius / shadow / motion
  maps onto existing --color-au-* where semantics match, adds only missing staff names
         ↓
Layer 1 — Primitives (src/products/sat/ui/*)
  SatPage.tsx · Menu.tsx · SegmentedControl.tsx · ConfirmDialog.tsx
  converge onto tokens; keep every DOM/ARIA contract identical
         ↓
Layer 2 — Pages (src/products/sat/routes/* + SatRoot.tsx)
  Library · Sessions · SessionRoom · Results · ResultDetail · Access
  compose primitives into bento/editorial layouts; call sites own content, not frame CSS
```

Rules:
- Pages never hardcode hex/alphas for staff chrome once Layer 0 exists; they use tokens or primitive props.
- Primitives keep their exported API (props, class hooks like `.sat-list-row`, `.sat-row-chevron`, `.sat-segmented*`, `.sat-menu*`, `.sat-dialog*`) so route tests + CSS contract tests keep passing.
- `.sat-ui` values are read-only. If a shared variable must diverge, fork it as `--sat-staff-*` instead of editing the shared one.
- Motion: 150–200ms ease-out (`cubic-bezier(.2,0,0,1)`), capped stagger (first 6 rows), full `prefers-reduced-motion` opt-out. No springs in lists.
- A11y invariants (never break): dot+label status, skeleton-XOR rule, polite live regions, roving tabindex, focus-visible rings, 44px targets (32px search-clear exemption stays), Cancel-focused alerts, backdrop-tap-never-dismisses.

## 4. Phases

### Phase 01 — Staff Token Foundation
Objective: define the complete `.sat-product` high-end token set in `src/index.css` without touching any component.
Owns: `src/index.css` (SAT product block only).
Key work: audit current staff hex/alphas; add `--sat-staff-*` canvas/surface/border/text/accent/focus/radius/shadow/motion; solid fallbacks for every glass surface; AA-check text pairs; reduced-motion + shimmer tokens; document token table.
Exit: tokens exist, unused by components yet, CSS contract tests still green.

### Phase 02 — App Shell (SatRoot)
Objective: make the frame feel premium: sidebar, mobile header, bottom nav, route fade.
Owns: `src/products/sat/SatRoot.tsx` (+ its test).
Key work: glass sidebar with solid fallback, active-pill nav (desktop) + top-indicator (mobile), account block, workspace switcher, mobile bars with safe-area + blur, route fade with reduced-motion guard. No nav logic change.
Depends on: 01. Parallel with: 03.

### Phase 03 — List-System Primitives
Objective: bring SatPage/Menu/SegmentedControl/ConfirmDialog to 2026 component styling on top of Phase-01 tokens.
Owns: `src/products/sat/ui/SatPage.tsx`, `Menu.tsx`, `SegmentedControl.tsx`, `ConfirmDialog.tsx` (+ `__tests__`).
Key work: container/header/search/button/pill/row/stat-strip/result-count/empty/skeleton/inline-error/section-card/eyebrow/meta + segmented + menu + dialogs — tokenized, 44px targets, focus rings, dot+label, shimmer, stagger cap. APIs stay backward compatible.
Depends on: 01. Parallel with: 02.

### Phase 04A — List Pages (Library / Sessions / Results)
Objective: compose Phase-03 primitives into confident bento list experiences.
Owns: `SatExamLibraryRoute.tsx`, `SatSessionsRoute.tsx` (+ New Session sheet), `SatResultsRoute.tsx`.
Key work: editorial headers, StatStrip-as-bento, search + filter rhythm, row content hierarchy (13–14px title, 10–11px meta, tabular-nums), empty states with one human detail, archived/score filters. No query/facade change.
Depends on: 01 + 03. Parallel with: 04B.

### Phase 04B — Detail & Ops Pages (Session Room / Result Detail / Access)
Objective: make dense operational pages scannable and premium without hiding controls.
Owns: `SatSessionRoomRoute.tsx`, `SatResultDetailRoute.tsx`, `SatAccessRoute.tsx` (wrapper styling only — StudentLinksDashboard internals out of scope).
Key work: room header (glass, timer tabular-nums, overrun/reconnecting states), roster listbox rows, attention filter, detail bento (stage/timeline/actions), confirm/menu wiring untouched; result hero (52px score, practice caption, performance bento, module dl, QuestionRawTable wrapper); access back-link rhythm. PII discipline (IDs only in logs) stays.
Depends on: 01 + 03. Parallel with: 04A.

### Phase 05 — Verification & Polish
Objective: prove nothing regressed and the system feels coherent.
Owns: no product files (tests + docs + CSS fixes only, via owning-phase agents on failure).
Key work: typecheck, scoped + full vitest, eslint, sat-a11y Playwright, contrast/spot checks, motion/reduced-motion audit, cross-route consistency (radii/shadow/type/tone), unfinished-TODO sweep, plan-docs update.
Depends on: 01 + 02 + 03 + 04A + 04B. Runs last, alone.

## 5. Dependency graph & execution order

```text
Phase 01 — Foundation (tokens)
   ├──────────────┐
   ↓              ↓
Phase 02        Phase 03
Shell           Primitives
   └──────┬───────┘
          ↓
   ┌──────┴───────┐
   ↓              ↓
Phase 04A       Phase 04B
List pages      Detail & ops
   └──────┬───────┘
          ↓
Phase 05 — Verification & polish
```

Waves (implementation only — NOT running yet):
- Wave 1: Phase 01
- Wave 2: Phase 02 + Phase 03 (parallel — disjoint file ownership)
- Wave 3: Phase 04A + Phase 04B (parallel — disjoint route ownership, both need 03 done)
- Wave 4: Phase 05 (alone, after all)

Gates: a phase unlocks only when implementation finished + tests/typecheck/lint pass + Definition of Done satisfied + Main Agent verifies. Never unlock dependents early. Conflicting edits to the same file by two agents at once are forbidden — ownership table above is the lock.

## 6. Parallelizable work (this planning stage)

All six phase-planning agents run in parallel NOW (plan-only, no code edits):
- phase-01, phase-02, phase-03, phase-04a, phase-04b, phase-05
Each reads the real codebase + this overall plan and writes its own `plans/phase-XX-*.md`. Planning agents must not edit product code.

## 7. Completion criteria (whole initiative)

- [ ] All six phase plans exist under `plans/` with objective/deps/files/contracts/steps/pseudocode/edge-cases/tests/verification/DoD.
- [ ] Every phase plan preserves its inherited contracts (SatPage/Menu/Dialog/Segmented tests, satContractsCss, route tests, skeleton-XOR, dot+label, live regions, reduced-motion, focus, 44px targets).
- [ ] Token plan forks staff needs as `--sat-staff-*` instead of mutating shared `.sat-ui` values.
- [ ] Shell + primitives + pages plans compose (no API drift between Phase 03 output and Phase 04 consumption).
- [ ] Verification plan covers typecheck + vitest (scoped & full) + eslint + sat-a11y + contrast + motion audit.
- [ ] No implementation performed in this stage (plan-only gate).
