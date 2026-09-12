# SAT Staff Workspace — Apple-Design Audit Remediation, Overall Plan (Production-Grade)

> Workflow: ai-planning-workflow · Stage: PLAN + EXECUTE (implementation-grade)
> Source audit: Apple-design review (HIG-cited, code-read, contrast-computed), rating **Critical issues** (1 Critical type-floor failure, else strong foundation).
> Scope: staff workspace ONLY — `src/products/sat/**` + `.sat-product` / `--sat-staff-*` CSS in `src/index.css`.
> Out of scope: student exam delivery (`.sat-ui`, `src/features/student-delivery/**`), IELTS surfaces, backend, persistence, timing, scoring, auth, any redesign/rebrand.
> Prior art: `plans/overall-plan.md` (staff high-end UI) + `plans-sat-audit/*` (student exam audit). This plan is the staff counterpart and must not leak into `.sat-ui`.

## 1. Goal

Remediate every audit finding so the SAT internal tool is **accessible, premium-feeling, job-matched, and easy to use** — while preserving every behavioral and accessibility contract and shipping production-grade code (correct, secure, fast, reliable, maintainable, tested, clean).

Production-grade means:
- **Correctness**: no behavior change except where the audit mandates (type floor, deleted duplicate line, dirty-guard). Filtering, polling, proctor actions, confirm flows, routing, polling intervals stay identical.
- **Security**: no new injection/XSS surface (copy stays string-only), no PII in logs, no new network calls, no auth change.
- **Performance**: zero new blocking work on list render; entrance stagger stays capped (first 6, 150–200ms); no layout thrash; CSS-only changes where possible (token/type/density).
- **Reliability**: dirty-guard never traps the user (pristine always closes; Escape/backdrop paths preserved); reduced-motion/transparency/contrast/forced-colors answers preserved and extended to new tokens.
- **Maintainability**: tokens first, then primitives, then pages. One 6-step type scale, one status-tone table (`satOutcomeTone` + session tones unified), no forked mappings, no new hex literals in TSX.
- **Testing**: unit (vitest) + contract (existing `satContractsCss.test.ts` family) + a11y (existing `e2e:sat-a11y`) + typecheck + lint + build. Every phase defines its verification gate.

## 2. Architecture (evolve, don't rebuild)

Three layers, one direction — tokens → primitives → pages:

```text
Layer 0 — Tokens (.sat-product scope, src/index.css)
  --sat-staff-*: canvas/surface/border/text/accent/focus/radius/shadow/motion
  + dark semantic variants (new) + neutral-dot fix + 6-step type scale
         ↓
Layer 1 — Primitives (src/products/sat/ui/*)
  SatPage.tsx (type scale, status pill, rows, stats, search, buttons)
  Menu.tsx / SegmentedControl.tsx / ConfirmDialog.tsx (untouched unless a phase needs them)
         ↓
Layer 2 — Pages (src/products/sat/routes/* + SatRoot.tsx)
  ExamLibrary / Sessions / SessionRoom / Results / ResultDetail / Access
```

Rules: no phase edits a layer above its own except through that layer's contract; no new stores; no persistence migration; no `.sat-ui` change; no token rename that churns logic.

## 3. Phases

| Phase | Name | Lens / driver | Depends on | Parallelizable with |
|-------|------|---------------|------------|---------------------|
| 01 | Type floor + contrast + density (Critical + High) | Lens 1 Accessibility | — | — (first; touches shared primitives) |
| 02 | Status language + search + writing (Medium/Low copy) | Lens 5 Content | 01 (type scale must exist first) | 03, 04 (different files) |
| 03 | Dirty-guard dialogs + interaction safety | Lens 4 Interaction | 01 | 02, 04 |
| 04 | Session Room ops hierarchy (roster/detail compress) | Lens 3 Layout + jobs | 01 | 02, 03 |
| 05 | Dark appearance + system-preference answers | dark-mode.md | 01 (tokens), 02 (status colors final) | — (touches same token block; run alone) |
| 06 | Final integration + regression | workflow §7 | 01–05 | — |

Ownership map (prevents conflicting agents editing the same files):
- 01: `src/index.css` (.sat-product block) + `src/products/sat/ui/SatPage.tsx` + type usages in routes/SatRoot (mechanical class swaps only).
- 02: `SatResultsRoute` (delete 8px line), search placeholders (3 routes + room), Title-Case buttons, jargon deletion, action-name alignment.
- 03: `ui/ConfirmDialog.tsx` (dirty-guard helper) + `SatSessionsRoute` (New Session sheet) + `SatExamLibraryRoute` (New SAT dialog).
- 04: `SatSessionRoomRoute` (+ `SatRoot` bottom-tab label size only if 01 defers it).
- 05: `src/index.css` (.sat-product dark block only) + verification across all routes.
- 06: verification only (tests, typecheck, lint, build, e2e) + repair routing to owning phase.

## 4. Execution graph (waves)

```text
Wave 1:  Phase 01 (tokens + primitives + mechanical swaps)
Wave 2:  Phase 02 + Phase 03 + Phase 04 (parallel; disjoint files; shared 01 contracts frozen)
Wave 3:  Phase 05 (dark appearance; needs 01+02 final colors)
Wave 4:  Phase 06 (final integration + full regression)
```

Gate per phase (§5 of skill): implementation finished → tests/typecheck/lint pass → Definition of Done satisfied → Main Agent verifies → unlock dependents. Failures return to the owning implementation agent; never unlock dependents prematurely.

## 5. Key contracts (frozen after Phase 01)

- **Type scale (6 steps)**: H1 `30px/-0.045` · hero `52px/-0.045 tabular` (ResultDetail only) + `36px` stage clock (SessionRoom only) · H2 `16–17px/-0.025` · title/body `13–14px/-0.012` · control/hint `12px semibold` · floor `11px medium` · eyebrow `11px caps/0.12`. Nothing below 11px ships.
- **Status tones**: extend `satOutcomeTone` discipline — one mapping table, no forks. Session tones (`sessionStatusTone`, `roomStatusTone`) alias the same pill classes.
- **Contrast floor**: all text ≥4.5:1, dots ≥3:1. Neutral dot `#9b9a97` → `#6e6e73` (2.81→5.07:1). Chevron `slate-300` → `slate-400` (remapped to tertiary).
- **Targets**: primaries/rows keep 44px; search-clear → 28px min; filter chips → 28px min.
- **Motion**: capped stagger (first 6, 150–200ms), instant under reduced-motion; glass collapses under reduced-transparency; contrast + forced-colors mappings preserved.

## 6. Completion criteria (production-grade exit)

1. Zero text below 11px in `src/products/sat/**` (grep gate).
2. Contrast table re-verified (computed, not eyeballed); neutral dot + chevron fixed.
3. Duplicate Results 8px status line deleted (single pill per row).
4. Dirty-guard on both creation dialogs; pristine-close + Escape/backdrop preserved.
5. Session Room roster/detail ≤2-line rows; attention filter + stage clock intact.
6. Dark appearance ships (system-following, no toggle) incl. dark+contrast+transparency matrix.
7. Title-Case buttons, scoped search placeholders, jargon + action-name fixes.
8. Full suite green: `vitest run src/products/sat`, contracts tests, `tsc --noEmit`, `eslint`, `vite build`, `e2e:sat-a11y` (or documented equivalent), no `.sat-ui` diff.
