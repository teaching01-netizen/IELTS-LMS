# SAT Authoring Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SAT staff 3-pane authoring workspace with a single-column exam-paper spine (shadcn/ui + semantic tokens) while preserving all behavior, data contracts, autosave, validation, and keyboard flow.

**Architecture:** Strangler migration inside `AuthoringWorkspace` (stays the orchestrator). New presentational spine components under `src/features/exam-authoring/ui/spine/` consume the same draft/autosave/selection callbacks; legacy panes stay mounted behind a flag until the spine proves parity, then are removed. No backend, contract, validation-logic, or route changes.

**Tech Stack:** React 19 + Tailwind v4 + shadcn/ui (`src/components/ui/*`) + Radix (`radix-ui`) + `cmdk` + `sonner` + `motion/react` (restrained) + TipTap (`FastQuestionComposer`/`RichQuestionComposer`) + TanStack Query + `satProvider.validateSatQuestion`.
---
## ATDD acceptance matrix (full pass required in Phase 9)
| AT-01 | Batch run parity | Module with target N, empty slots | Create, write prompt, classify, key, Save&Next x3 | 3 valid drafts, same API payloads as legacy, focus lands in next prompt | E2E + API spy |
| AT-02 | Classification gating | New draft, empty domain/skill | Attempt release-check | Blocking issues name Domain/Skill; spine shows inline errors at fields | Unit + E2E |
| AT-03 | Key unmissable | MCQ draft | Select key B | Selected card filled + aria-checked=true + Key text | Visual + a11y |
| AT-04 | Validation click-scroll | Draft with 2 blockers | Click checklist item | Scrolls to data-authoring-field, focuses control, count decrements on fix | E2E |
| AT-05 | Single save truth | Editing draft | Type, offline, reconnect | One cluster: Editing, Offline, Saving, Saved | E2E |
| AT-06 | No-loss navigation | Dirty draft, save fails | Try next question | Blocked, draft intact, one-click Retry | E2E |
| AT-07 | Bulk classify | 3 selected, mixed domains | Bulk set domain+skill | All updated, selection cleared, caches invalidated | E2E |
| AT-08 | Keyboard batch | Spine, no dialogs | Ctrl+S / Ctrl+Return / Ctrl+1-4 / Ctrl+D / Ctrl+K / j/k | Save / Save&Next / key / duplicate / palette / move; ? opens help | E2E |
| AT-09 | Screen reader | Spine + key + difficulty | Tab through classify+key | Visible labels announced; difficulty and key are radiogroups; errors via aria-describedby | a11y |
| AT-10 | Zoom 200 pct | 200% text, 1280px | Full batch run | No clipped primary action; footer in flow | Manual + Playwright |
| AT-11 | Reduced motion | prefers-reduced-motion | Switch key/difficulty/dialogs | Instant state changes | Manual + CSS |
| AT-12 | Release gating forward | Module incomplete | View spine release card | Publish disabled WITH reasons + link to /release | E2E |
| AT-13 | Mobile sheet | 900px or less | Open queue, validation | Editor only in-flow region; focus restored | E2E |
| AT-14 | Import parity | Draft dirty then clean | Paste + workbook import + undo | Dirty blocks; clean imports; undo restores | E2E |
| AT-15 | No IELTS regression | IELTS builder snapshot | Run IELTS suites + spot check | Zero diff from spine work | Unit + visual |
---
## Phase 1 - Flag, shell, token freeze (no visual change)
- [ ] **1.1 spineFlag.ts** - Create `src/features/exam-authoring/ui/spine/spineFlag.ts` with `isSpineEnabled(searchParams)`: true when ?spine=1 or localStorage[sat-authoring:spine]==1, try/catch around storage. Test first: `spine/__tests__/spineFlag.test.ts` (param on/off, storage on/off, storage-throws). Run: `vitest run src/features/exam-authoring/ui/spine`.
- [ ] **1.2 SpineLayout shell** - Create `spine/SpineLayout.tsx` (slots: header, queue, main, footer; single column, main max-w 720px, skip link) + `spine/spine.css` scoped to `.sat-spine` using ONLY semantic + --sat-* vars (no au-*). Branch in `AuthoringWorkspace.tsx` return: spine flag renders legacy panes inside new shell slots. Behavior identical; AT-01 smoke passes both branches.
- [ ] **1.3 Freeze tokens** - Comment-mark the `.sat-authoring` block in `src/index.css` FROZEN (bugfix-only to Phase 10). Record token map in spine.css header: bg/foreground/border/primary/success-warning-danger -text tokens, preview --sat-*.
- [ ] **1.4 Commit** - `feat(sat): add spine flag and shell (no visual change)`. Verify: `npx tsc --noEmit`, spine tests + `AuthoringWorkspace.test.tsx`.
---
## Phase 2 - Primitive consolidation (one of each)
- [ ] **2.1 One segmented** - Keep `AuthoringSegmented.tsx` as THE segmented (CSS-transition thumb, no layoutId spring on hot paths). Delete bespoke difficulty pill in `QuestionProperties.tsx`; route both difficulty usages through it. AT-11 spot check.
- [ ] **2.2 One dialog family** - Keep `AuthoringDialog` + `AuthoringConfirmDialog` (restoreAuthoringFocus + data-dialog-initial-focus). Convert `ConfirmPopover.tsx` to deprecated re-export (TODO spine P10: remove); migrate `SatMenu` usages to `src/components/ui/dropdown-menu.tsx`; `ModuleScopePicker` stays the only wrapper.
- [ ] **2.3 One button/input scale** - Inside touched files only, swap ad-hoc rounded/min-h classes for `Button` variants + `Input/Select/Label/Checkbox`. Do not restyle editors yet; do not touch IELTS.
- [ ] **2.4 Commit** - `refactor(sat): consolidate segmented/dialog/button primitives`. Verify: AuthoringDialog, ConfirmPopover, ModuleScopePicker tests + eslint.
---
## Phase 3 - Spine header + queue rail (progress first)
- [ ] **3.1 SpineHeader** - Create `spine/SpineHeader.tsx`: back button, title + Draft badge, `Progress` with numeric authored/target (never lone 3px bar), save slot node. tabular-nums; slate-600 minimum. AT: AT-10 spot, header announces progress.
- [ ] **3.2 QuestionQueueRail** - Create `spine/QuestionQueueRail.tsx` mirroring the `QuestionListPane` prop contract (module, sections, selection, search, filter, isMutating, all callbacks incl. bulk/reorder/import). Reuse row/bulk logic (extract helpers, do NOT fork readiness). Narrow rail (~288px; sheet at 900px or less). Selection has text/aria cue beyond color (AT-09 spot).
- [ ] **3.3 Wire spine branch** - Legacy pane stays default; spine renders SpineHeader + QuestionQueueRail with identical callbacks (flush-before-navigation, bulk invalidation). Verify AT-01 smoke + AT-07.
- [ ] **3.4 Commit** - `feat(sat-spine): header progress and queue rail`.
---
## Phase 4 - Single classification fieldset (kill the dual spine)
- [ ] **4.1 ClassificationFieldset** - Create `spine/ClassificationFieldset.tsx` + test. Controlled `{ question, onChange }` on `QuestionRevision.metadata`. Visible `Label` per control: Domain select, Skill select (disabled until domain), Difficulty as radiogroup (role + aria-checked, NOT aria-pressed), Tags input + comma help. Domain change clears incompatible skill (existing logic). Blocking-empty Domain/Skill shows inline error via aria-describedby from `selectedQuestionIssues`.
- [ ] **4.2 Spine order** - Prompt, Supporting material (+starters when empty), ClassificationFieldset, Answer key (P5), Rationale (disclosed), Validation checklist (P6), footer save cluster.
- [ ] **4.3 Delete second copy (spine branch)** - Grep-assert spine imports neither `QuestionMetadataBar` nor `QuestionProperties`. Legacy branch untouched. Verify AT-02.
- [ ] **4.4 Commit** - `feat(sat-spine): single classification fieldset`.
---
## Phase 5 - Unmissable answer key
- [ ] **5.1 AnswerKeyField** - Create `spine/AnswerKeyField.tsx` + test. Props `{ question, onChange }` on `answer: { options, correctOptionId }`. 44px letter button + full-text `FastQuestionComposer` (unchanged) + filled selected state + Key text (never color alone). role=radiogroup, arrow-key movement; Ctrl+1-4 preserved by workspace handler. Keep choice-to-SPR confirm flow (`pendingQuestionType` via `AuthoringConfirmDialog`). Verify AT-03 + AT-09.
- [ ] **5.2 SPR restyle, logic frozen** - Keep `SatStudentResponseEditor` add/remove/validation exactly (`validateSatStudentResponse`); swap classes to shadcn Input + -text tokens at 12px or more. Existing `SatStudentResponseEditor.test.tsx` passes unmodified. Math-only SPR gating unchanged.
- [ ] **5.3 Commit** - `feat(sat-spine): unmissable answer key field`.
---
## Phase 6 - Inline validation checklist + release gate
- [ ] **6.1 ValidationChecklist** - Create `spine/ValidationChecklist.tsx` + test. Props `{ issues, onIssueSelect }` from `validateSatQuestion(draft)`. Blocking-first order; each item scrolls to + focuses `[data-authoring-field]` (reuse rAF focus effect). role=status Ready/Needs-attention summary. Count decrements live (AT-04).
- [ ] **6.2 Module blockers table** - `DataTable.tsx` rows from validation report reusing `openIssue` deep-links (same `useAssessmentValidation` trigger; no new fetching). Replaces IssuesPane in spine branch only.
- [ ] **6.3 ReleaseGateCard** - Create `spine/ReleaseGateCard.tsx` mirroring `SatDeliveryReleasePage canPublish` inputs (readinessFresh, valid, dirtySections.size, isPublishing, blockers). Disabled publish WITH enumerated reasons + link to /release. No publish logic duplicated (AT-12).
- [ ] **6.4 Commit** - `feat(sat-spine): inline validation and release gate`.
---
## Phase 7 - Single save truth
- [ ] **7.1 SaveCluster** - Create `spine/SaveCluster.tsx` + test. One vocabulary for `QuestionSaveStatus`: Saved / Editing / Saving... / Offline - saved on this device / Not saved - Retry. Same `autosave` object in header slot + footer; error is a Retry button (`autosave.retry(draft)`); role=status live region. Footer docked to 720px column, in-flow at 200% zoom (AT-05, AT-10). Remove `SaveStatusIndicator` + footer `SaveState` from spine branch.
- [ ] **7.2 Carry-metadata visible** - Same `keepMetadataForNext` state beside Save&Next, never hidden on mobile. Save&Next keeps Ctrl+Return + disabled-while-saving.
- [ ] **7.3 Failure toasts** - Spine-branch `setNavigationError` messages via `sonner` + inline banner (copy preserved + action). Drafts preserved on failed navigation (AT-06).
- [ ] **7.4 Commit** - `feat(sat-spine): single save cluster`.
---
## Phase 8 - Keyboard: jump palette + cheat sheet
- [ ] **8.1 QuestionJumpPalette** - Create with `cmdk CommandDialog` over module questions (same `matchesSearch` semantics); Enter selects via flush-guarded `selectQuestion`. Ctrl+K opens palette in spine (list search remains fallback).
- [ ] **8.2 ShortcutHelpDialog** - `?` opens dialog listing every binding + scope note (inactive in inputs except Escape/Ctrl+S). Bindings byte-identical. Verify AT-08 full keyboard run.
- [ ] **8.3 Commit** - `feat(sat-spine): jump palette and shortcut help`.
---
## Phase 9 - Hardening then default-on
- [ ] **9.1 Responsive** - 900px or less: queue + validation in `Sheet/Drawer` (existing infra + `restoreAuthoringFocus`); editor only in-flow region; preview `ExamQuestionRenderer` keeps --sat-* parity (AT-13).
- [ ] **9.2 A11y pass** - AT-09 + AT-10 + AT-11: visible labels, radiogroups, 44px key targets (24px-min spacing elsewhere), focus-visible rings, skip link, per-question page title, live regions, non-modal preview focus-trap verification. Run `playwright test --config playwright.sat-a11y.config.ts`; fix spine findings.
- [ ] **9.3 Motion restraint** - CSS transitions for press/selection; `motion` only for sheet/dialog entrance + question-swap fade (interruptible, initial={false} where apt). No layout/shared-layoutId on key/difficulty/filter. Reduced-motion = instant.
- [ ] **9.4 Import parity** - Paste, workbook import + undo banner, sample-exam dialog identical from spine (same dirty guards). Restyle onto shadcn Dialog/EmptyState w/o logic change (AT-14).
- [ ] **9.5 Flip default** - `isSpineEnabled` defaults ON; ?spine=0 / storage 0 opts back for one release. PR description carries AT-01..AT-15 results table.
- [ ] **9.6 Commit** - `feat(sat-spine): harden and default on`.
---
## Phase 10 - Release-page alignment + legacy removal
- [ ] **10.1 Release page visual alignment** - `SatDeliveryReleasePage.tsx` class/token swap ONLY; `canPublish` logic byte-identical. Verify `SatDeliveryReleaseRoute.test.tsx` + `SatDeliveryReleasePage.test.tsx` green.
- [ ] **10.2 Remove legacy** - Delete `QuestionEditor/QuestionListPane/QuestionInspectorPane/QuestionProperties/QuestionMetadataBar/SaveStatusIndicator/ConfirmPopover-alias/StructurePane-if-superseded`, legacy branch, flag, `.sat-authoring/au-*` CSS (grep au- + authoring- first; IELTS zero diff). `AuthoringWorkspace` becomes thin orchestrator over spine slots.
- [ ] **10.3 Final verification** - `npx tsc --noEmit`, `npx eslint .`, `vitest run`, sat-a11y Playwright, route-contract test, AT-01..AT-15 PASS, IELTS suites green.
- [ ] **10.4 Commit** - `feat(sat)!: remove legacy panes, spine is the workspace`.
---
## Frozen (never in this plan)
Backend, `contracts/assessment.ts`, `assessmentAuthoringApi` payloads, `satProvider/studentResponse/taxonomy` rules, autosave durability/offline pipeline, TipTap schemas, delivery renderers, routes/permissions, IELTS.
## Sequencing
Phases dependency-ordered 1-10. Run 1 then 2; 3-7 may parallelize across workers ONLY after 1+2 merge (shared primitive names); 8 after 3; 9 after 3-8; 10 last. One PR per phase with AT rows checked.