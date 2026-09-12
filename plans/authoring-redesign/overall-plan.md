# SAT Exam Authoring — Apple-Grade Redesign (Clarity · Deference · Progressive Disclosure · Direct Manipulation)

> Workflow: ai-planning-workflow · Stage: **PLAN** (implementation waves dispatch after operator go-ahead)
> Scope: SAT staff authoring surface only — `src/features/exam-authoring/**` (UI + editor + hook wiring) and the authoring blocks of `src/index.css` (`.sat-spine*`, `.sat-rich-editor*`, consumption of existing `--color-au-*` / `--radius-au-*`; **no token renames**).
> Out of scope: `.sat-ui` student delivery, `src/products/sat/**` staff list pages, IELTS surfaces, backend (`backend/go/**`), API contracts (`api/openapi/openapi.yaml`, `contracts/assessment.ts`), persistence/migrations, scoring, auth, release-page publish logic.
> Source of truth for the target: the operator's production-grade redesign spec (50 sections). This plan converts it into executable phases against the **real** repository state and records where the spec must bend to existing invariants.

---

## 1. Goal

Move the SAT exam builder from "well-built internal admin tool" to a calm, direct-manipulation authoring product:

> **"I am editing the exam itself"** — not "I am filling database fields that eventually become an exam."

The screen must say **"here is the thing you are doing now; everything else appears when you need it"** and must survive three hard real constraints:

1. **147-question exams** on a normal desktop.
2. **Zero edit loss** across navigation, mutations, offline, and conflicts (existing durability contract).
3. **WCAG 2.2 AA** with keyboard-complete batch authoring.

### 1.1 What "done" looks like (one screen)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ‹ Exams   Read-perf SAT baseline                        Preview   Release    │
│           Reading & Writing · Module 1 · Draft        ✓ Saved (transient)   │
├──────────────────┬───────────────────────────────────────────────────────────┤
│ Questions    27  │  Question 1                        ✓ Ready      ···        │
│ Search…          │                                                           │
│ 1  Which…    A   │  Question                                                 │
│ 2  Which…    B   │  ───────────────────────────────────────────────────      │
│ 3  Which…    C   │  Which choice best answers rw-m1 item 0?                  │
│ 4  Which…    !   │                                                           │
│                  │  Supporting material                            Optional  │
│                  │  ───────────────────────────────────────────────────      │
│                  │  Seeded rich stimulus with table and math…                │
│                  │                                                           │
│                  │  Answer                                                   │
│                  │  ───────────────────────────────────────────────────      │
│                  │  ● A   …   ○ B   …   ○ C   …   ○ D   …                    │
│                  │                                                           │
│                  │  Explanation                                    Optional  │
│                  │  ───────────────────────────────────────────────────      │
│                  │  + Add an explanation…                                    │
└──────────────────┴───────────────────────────────────────────────────────────┘
```

---

## 2. Current state (verified 2026-09-11 against the working tree)

The spine migration already delivered the *shell* (single column, autosave, validation checklist, overlay stack, focus plumbing). What remains is exactly the hierarchy/IA problem the operator described: **the shell is right, the screen is still loud.**

| # | Symptom (spec §) | Verified evidence |
|---|---|---|
| S1 | 7–8 competing nav/action layers (§1) | `SpineHeader` renders back + title + lifecycle badge + progress text + `Progress` bar + compact Questions button + **Build/Overview/Issues** segmented + save slot + **Manage** menu + Preview + Release (`spine/SpineHeader.tsx:66-170`); `SpineQuestionView` adds **Preview / Duplicate / Save now** + a sticky **6-stage** nav (`SpineStageNav.tsx:15-22,66`) + **numbered uppercase steps 01–06** (`SpineStep.tsx:22-26`) + validation step + footer save cluster |
| S2 | Container soup (§2, §25, §48) | `spine-card` (border + radius + surface + elevation, `spine.css:100-106`) on stage nav, classification, validation, save footer; `.sat-rich-editor` is a fully bordered surface with a 3px focus ring (`index.css:2728-2746`) |
| S3 | Canvas squeezed (§3, §10) | `--spine-measure: 720px` and `--spine-rail-width: 384px` (`spine.css:19-20`) |
| S4 | Header has no focal point (§4) | Same as S1; `min-h-[52px]` row with ~9 controls (`SpineHeader.tsx:66`) |
| S5 | Readiness is decoration (§5, §21) | Static pill in `SpineStageNav.tsx:74-82` + a "Validation" *destination* step; nothing in the header is clickable to a specific field |
| S6 | Sidebar is a database table (§6, §19) | Row = checkbox + number + readiness dot + truncated title + answer letter + `Current` text + ↑↓ arrows (`QuestionQueueRail.tsx:250-336`), `min-h-[64px]` rows, 384px rail |
| S7 | Over-designed filters (§7) | 4-segment control with permanent zero counts `All 27 / Ready 27 / Needs work 0 / Errors 0` (`QuestionQueueRail.tsx:174-185`) |
| S8 | CMS toolbar (§8) | 12+ icons always visible: style select, bullet/ordered list, B, I, U, x², x₂, Σ, image, code, table, undo, redo (`RichQuestionComposer.tsx:250-390`) |
| S9 | Weak type hierarchy (§9) | Uppercase `01 — PROMPT` labels are the hierarchy mechanism (`SpineStep.tsx:22-26`) |
| S10 | Blue `Required` (§10, §22) | `bg-primary/10 text-primary` pills in `SpineFieldLabel.tsx:12-24` and `AnswerKeyField.tsx:52-55` |
| S11 | Starter control mixes verbs and nouns (§11) | `Replace | Paired texts | Student notes | Data table` in one group (`SpineQuestionView.tsx:186-224, 336-375`) |
| S12 | Question is not the hero (§12) | The canvas opens with a 6-button stage nav before the first content glyph |
| S13 | Explicit Save (§4, §48) | `Save now` button (`SpineQuestionView.tsx:169-179`) layered on a working autosave (`useQuestionAutosave` → `useDurableLatestAutosave`) |
| S14 | `Duplicate` prominence (§16) | Persistent button in the question header (`SpineQuestionView.tsx:160-167`) |
| S15 | Classification eats canvas (§16) | Full fieldset card in the middle of the authoring column (`SpineQuestionView.tsx:229-233`) |
| S16 | Dead affordance / e2e drift | `SampleExamLoadDialog` is mounted (`AuthoringWorkspace.tsx:1176`) but **no code path ever opens it** (`setSampleDialogOpen(true)` does not exist); e2e expects `More authoring actions → Load sample exam` (`e2e/sat-product-workspace.spec.ts:291-292`) and `147 of 147 questions authored` (line 296) |

### 2.1 Hard invariants (must survive every phase)

```text
Autosave      useQuestionAutosave / useDurableLatestAutosave: schedule → saving → saved,
              offline durable draft, error retry, conflict review. Debounce 800ms.
No-loss nav   flushBeforeNavigation() before every select/create/duplicate/delete/reorder/
              bulk/import/preview/release/back; commitAndAdvance() before Save & Next.
              A failed flush blocks the transition (AT-06).
Idempotency   operationKey (crypto.randomUUID) on batch/duplicate/bulk/publish;
              expectedQuestionIds / expectedRevisions fences on reorder & bulk.
Focus plumbing data-authoring-field anchors + resolveAuthoringField() + flashAuthoringField()
              + scroll-mt; selection rows keep [data-question-list-row] (workspace Esc handler).
Overlays      useOverlayStack: max one dialog + one sheet; opener capture/restore.
Release gate  releaseSelectors.getPublishBlockers / canPublishFromBlockers is the ONLY
              publish-gating authority (ReleaseGateCard delegates; no forked logic).
A11y          focus-visible everywhere, non-colour status cues, 44px targets, aria-live for
              save/validation, reduced-motion honored, radiogroups stay radiogroups.
Scope         no backend, no contracts/assessment.ts, no openapi, no .sat-ui, no IELTS.
```


---

## 3. Target architecture

Evolve, don't rebuild. Four layers, one direction:

```text
Layer 0 — Tokens & discipline (spine/spine.css + authoring blocks in src/index.css)
  type scale · spacing scale · radius set · elevation levels · border policy ·
  measure tokens (--spine-measure 840 / --spine-rail 272 / --spine-inspector 304) ·
  semantic colour rules (accent = interactive only)
        ↓
Layer 1 — Primitives (spine/*)
  QuestionNavigator (rows, row menu, filter menu, selection mode)
  EditorSurface (defer / hover / focus states)
  SectionRule (typographic section header + hairline)
  ReadinessControl (computed checks + jump-to-issue)
  Inspector (classification / settings) · OverflowMenu · CommandPalette
        ↓
Layer 2 — Canvas composition (spine/SpineQuestionView + new section components)
  QuestionHeader → ContentSection(Question, SupportingMaterial) →
  AnswerSection → ExplanationSection → CanvasFooter
        ↓
Layer 3 — Shell (SpineHeader · SpineLayout · AuthoringWorkspace orchestration)
  header (4 persistent controls) · navigator (272) · canvas (840) · inspector (304, optional)
```

Rules:
- `AuthoringWorkspace` stays the **only** orchestrator (draft, autosave, selection, mutations, focus, keyboard). Presentational components never fetch, never mutate, never own navigation.
- One navigation model for question structure: **Content · Answer · Explanation**, with **Settings** in the inspector. The 6-stage nav and the numbered-step list are deleted, not restyled.
- Validation is a **system behaviour**: inline field errors + a readiness control. It is never a destination.
- New components take the smallest prop surface; existing prop names (`onIssueSelect`, `onChange`, `selectedQuestionId`, …) are preserved so call sites stay stable.

### 3.1 Component architecture (target)

```text
AuthoringWorkspace (orchestrator — unchanged responsibilities)
├── SpineHeader              back · title/subtitle · Preview · Release · OverflowMenu
├── SpineLayout              header / navigator / canvas / inspector slots
│   ├── QuestionNavigator
│   │   ├── NavigatorHeader  "Questions 27"  +  Select toggle  +  Add
│   │   ├── QuestionSearch   (fixed)
│   │   ├── QuestionFilterMenu  ("27 questions   Filter ⌄" — counts only when non-zero)
│   │   └── QuestionList → QuestionRow (+ QuestionRowMenu)
│   ├── AuthoringCanvas
│   │   ├── QuestionHeader   "Question 1" · ReadinessControl · OverflowMenu
│   │   ├── ContentSection   Question · Supporting material (Type selector)
│   │   ├── AnswerSection    ● A ○ B ○ C ○ D  (+ SPR editor unchanged)
│   │   ├── ExplanationSection (renamed label; field stays rationale)
│   │   └── CanvasFooter     Save & Next (primary) · Carry metadata · quiet save state
│   └── Inspector            ClassificationInspector · ItemSettingsInspector
└── OverlayLayer             CommandPalette · ReleaseDialog · ConfirmDialogs · PreviewSheet
```

---

## 4. Phases

| Phase | Name | Depends on | Parallel with | Owns (files) |
|---|---|---|---|---|
| 01 | Design foundation: type/spacing/radius/elevation/border tokens + measure | — | — | `spine/spine.css`, authoring token block in `src/index.css` |
| 02 | Shell & header hierarchy; ambient autosave; overflow menu; restore sample-load | 01 | — | `spine/SpineHeader.tsx`, `spine/SpineLayout.tsx`, `AuthoringWorkspace.tsx` (header/menu wiring), header tests |
| 03 | Question navigator: rows, filter menu, row menu, selection mode | 01 | 06 | `spine/QuestionQueueRail.tsx`, `spine/queueModel.ts`, new `spine/QuestionRowMenu.tsx`, navigator tests |
| 04 | Canvas: typographic sections, container removal, readiness control, ambient validation, empty states | 01, 02 | — | `spine/SpineQuestionView.tsx`, new `spine/QuestionHeader.tsx` / `SectionRule.tsx` / `ReadinessControl.tsx` / `CanvasFooter.tsx`, `AuthoringWorkspace.tsx` (canvas wiring), canvas tests |
| 05 | Inspector: classification/settings off-canvas | 02, 04 | — | new `spine/Inspector.tsx`, `spine/ClassificationInspector.tsx`, `spine/ItemSettingsInspector.tsx`, `SpineLayout.tsx` slot, `AuthoringWorkspace.tsx` (inspector wiring) |
| 06 | Editor: toolbar progressive disclosure, contextual toolbars, editor surface, answer option rows | 01 | 03 | `editor/RichQuestionComposer.tsx`, `.sat-rich-editor*` block in `src/index.css`, `spine/AnswerKeyField.tsx`, editor tests |
| 07 | Command palette, keyboard, motion, loading/empty polish, a11y pass | 02–06 | — | `spine/QuestionJumpPalette.tsx` → `spine/CommandPalette.tsx`, `spine/ShortcutHelpDialog.tsx`, `src/shared/motion.ts`, `AuthoringWorkspace.tsx` (keyboard map), skeleton/empty states |
| 08 | Final integration & verification | 01–07 | — | no product files (evidence + repair routing only) |

### 4.1 Execution graph (waves)

```text
Wave 1   Phase 01  (tokens/measure — everyone reads it)
Wave 2   Phase 02  (shell/header — owns AuthoringWorkspace header wiring)
Wave 3   Phase 03 ║ Phase 06      (disjoint: navigator vs editor; both avoid AuthoringWorkspace)
Wave 4   Phase 04  (canvas — owns AuthoringWorkspace canvas wiring)
Wave 5   Phase 05  (inspector — depends on the canvas that stopped owning classification)
Wave 6   Phase 07  (palette/keyboard/motion — depends on every new surface existing)
Wave 7   Phase 08  (verification; repairs routed back to the owning phase)
```

Wave discipline: a phase may not start before its dependencies are **verified** (not merely "implemented"). Phases 03 and 06 are the only parallel pair — they touch disjoint files and neither edits `AuthoringWorkspace.tsx`. If a wave-3 agent finds it must edit `AuthoringWorkspace.tsx`, it stops and reports; the Main Agent re-sequences.

### 4.2 Ownership rules (conflict prevention)

- `AuthoringWorkspace.tsx` is owned by **one phase per wave**: 02 → 04 → 05 → 07. Never two at once.
- `spine/spine.css` is owned by 01. Later phases append their own component classes only; only Phase 01 may change the token block at the top.
- `src/index.css` authoring blocks: Phase 01 (tokens only), Phase 06 (`.sat-rich-editor*` only). No other phase edits `index.css`.
- Tests are owned by the phase that changes the behaviour they pin. No phase edits another phase's tests.
- A later wave MAY re-touch a file an earlier wave owns **only** when its phase doc names the file and the reason (sequential, never concurrent). Two known cases: `spine/AnswerKeyField.tsx` (Phase 06 owns the option row in Wave 3; Phase 04 changes only its label row in Wave 4) and `spine/SpineQuestionView.tsx` (Phase 04 owns it; Phase 05 removes the classification section and adds the settings row).
- **No git commits.** The worktree carries many unrelated in-flight lanes (`git status` shows hundreds of modified files). Implementation agents restrict edits to owned paths and verify with `git diff -- <owned paths>`.


---

## 5. Frozen acceptance criteria

Referenced by ID in every phase. These are the operator's spec, expressed as testable statements.

| ID | Criterion |
|---|---|
| AC-01 | Exactly **one** navigation model for question structure (Content · Answer · Explanation; Settings in the inspector). No stage nav, no numbered step list, no duplicate tab concepts. |
| AC-02 | No section uses a border/card **solely** to group. Canvas container count ≤ 2 (both editor focus surfaces). ≤ 4 elevation levels app-wide. |
| AC-03 | Canvas measure 840px (adaptive 720–920), navigator 272px (240–320), inspector 304px **only when opened**. |
| AC-04 | Header has ≤ 4 persistent controls (back · title block · Preview · Release) plus ≤ 1 status element. |
| AC-05 | No explicit `Save now` control. Autosave states are transient; only exceptional states (offline / error / conflict) persist. |
| AC-06 | Readiness is computed, inspectable in one click, and every item jumps to the offending field. No manual ready toggle. |
| AC-07 | Zero-information states never render (no `Errors 0`, no zero-count filter segments, no `No blocking issues` filler). |
| AC-08 | Navigator row = number + title + ≤ 1 trailing token. Contextual actions live behind `···`. Selection has a non-colour cue (`aria-current` + tint). |
| AC-09 | Duplicate / Move / Replace / Delete / per-question Preview are **not** permanently visible. |
| AC-10 | Editor default toolbar ≤ 5 controls + `···`. Advanced controls ≤ 2 clicks. Contextual toolbars appear only for the relevant selection (table/equation/image). |
| AC-11 | Classification/metadata occupy **zero** canvas vertical space. |
| AC-12 | Blue = interactive/selection/focus/primary only. `Required`/`Optional` are neutral. Red = blocking error. Green = resolved/success. |
| AC-13 | Uppercase + tracking is not the hierarchy mechanism; numbered stage labels are gone. |
| AC-14 | Keyboard intact: ⌘/Ctrl+S flush · ⌘Enter Save & Next · ⌘1–4 key · ⌘D duplicate · ⌘K palette · j/k & ↑/↓ navigate · Space preview · ? help · Esc close — with no dialog/menu open. |
| AC-15 | 150-question exam: only the active question editor mounts; navigator header/search/filter stay fixed while the list scrolls. |
| AC-16 | No edit loss: navigation, mutation, refresh, offline, conflict, and unmount paths preserve local edits. |
| AC-17 | Release stays a deliberate exam-level action with enumerated blockers; publish is impossible while blocking issues exist. |
| AC-18 | WCAG 2.2 AA: keyboard-complete, visible focus, non-colour status, 44px targets, reduced motion, aria-live for save + validation. |
| AC-19 | Zero changes outside scope: `.sat-ui`, IELTS, backend, `contracts/assessment.ts`, `api/openapi/openapi.yaml`. |
| AC-20 | Gate green: authoring vitest suite, authoring eslint, `vite build`, CSS/contract greps, and the static e2e selector audit. |

---

## 6. Verification model

```bash
# per phase (authoring scope)
npx vitest run src/features/exam-authoring
npx eslint src/features/exam-authoring
npx vite build

# CSS/contract greps (examples; each phase names its own)
grep -rn "spine-card" src/features/exam-authoring/ui/spine          # expect 0 after Phase 04
grep -rn "Save now" src/features/exam-authoring                      # expect 0 after Phase 02
grep -rn "uppercase tracking-\[" src/features/exam-authoring/ui/spine  # expect 0 section labels after 04
```

Known toolchain facts (carried from `plans-sat-remediation/phase-06-verification-log.md`):
- `npx tsc --noEmit` heap-OOMs on this repo (exit 134) — pre-existing, not a phase failure. Type safety is asserted by **vitest + eslint + vite build**; `tsconfig.json` also excludes `**/__tests__`, so test files are checked by running them.
- The Playwright runner is currently blocked by an unrelated backend compile error (`e2e/TEST_STATUS.md` §1). E2E selector changes are **static-verified** in this initiative; Phase 08 records that limitation explicitly.

Evidence rule: every phase writes its gate output (command + result + count) into `plans/authoring-redesign/phase-NN-verification-log.md`. Claims without command output are not accepted.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Removing the stage nav strands validation jumps | Phase 04 keeps every `data-authoring-field` anchor and keeps `resolveAuthoringField` as the single mapping; ReadinessControl reuses `onIssueSelect` unchanged |
| Inspector move breaks classification issue jumps | Phase 05 makes the jump path "open inspector → focus field"; `ClassificationFieldset` keeps `data-authoring-field="domain"/"skill"` |
| Toolbar diet breaks power users | Every removed control stays reachable (Insert menu / More menu / contextual toolbar); accessible names stay identical for a11y and tests |
| `Save now` removal hides a real need | ⌘S still flushes; exceptional states stay persistent and actionable; the footer keeps the save truth |
| Test churn masks regressions | Each phase states **why** each pinned assertion changes, and must add at least one new assertion for the new behaviour |
| Parallel phase conflict | Waves are strictly sequenced; wave 3 is the only parallel pair and is file-disjoint |
| Scope creep into student delivery | AC-19 grep gate: no diff under `src/products/sat/**`, `src/features/student-delivery/**`, `backend/**`, `api/**` |

---

## 8. Definition of done (initiative)

1. AC-01 … AC-20 all demonstrably satisfied.
2. `npx vitest run src/features/exam-authoring` green, with net-new assertions for: readiness jump, navigator row contract, filter-menu counts, toolbar menus, ambient save, section anchors.
3. `npx eslint src/features/exam-authoring` clean (pre-existing warnings documented, not added).
4. `npx vite build` succeeds.
5. Static e2e audit: every selector the authoring specs rely on exists in the new UI (`More authoring actions`, `Load sample exam`, `Release`, `Ready to publish`, `Publish`), or the spec is updated with justification.
6. `plans/authoring-redesign/phase-08-verification-log.md` records every command, result, and residual limitation.
7. No file outside the ownership map is modified (proved by `git diff --stat` scoped to initiative paths).

