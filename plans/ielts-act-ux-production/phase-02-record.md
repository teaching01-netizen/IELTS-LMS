# Phase 2 record — adaptive workspace (2026-09-12)

Evidence record for [phase-02-adaptive-workspace.md](phase-02-adaptive-workspace.md).
All mode/threshold values below refer to `src/components/student/layout/studentLayoutMode.ts`
as the single policy owner.

## Implemented

| Subtask | State | Evidence |
| --- | --- | --- |
| P2.1 Four-mode policy (`phone`/`compact`/`standard`/`wide`) over width + stable shell height + pane-fit | Done | `studentLayoutMode.ts` decision order (invalid → phone → wide → standard → compact); `studentCapabilities.ts` wires the height-aware `resolveStudentLayoutMode` into the live shell; CSS mode selectors + `studentLayoutTokens` renamed; invalid geometry resolves to compact while measurements arrive |
| P2.1 width band boundaries | Done | 600/900/1180 px; shell-height gates 650 (wide) / 600 (standard); unmeasured height treated as fitting so SSR/tests stay deterministic |
| P2.2 Viewport matrix + spec consistency | Done | `e2e/support/studentViewportMatrix.ts` rewritten to the four modes; `npx tsx` cross-check ran the production policy over all 11 matrix rows — zero mismatches; AC-07 boundary pair moved to 1179→1180; AC-11 return-to-portrait asserts `phone`; workflow spec asserts 768×1024 → compact, 1080×810 → standard; layout README rewritten (no 700px/medium contract) |
| P2.3 Stable panes in compact/phone | Done | `StudentMaterialWithQuestionPane.tsx`: both panes stay mounted, inactive pane `hidden` + `inert`; compact tab persisted per exam+module (sessionStorage); last-active pane restored when re-entering compact; question-change auto-switch; scroll anchors saved/restored per pane |
| P2.4 Readable split bounds + pointer capture + resize menu | Done | Minimums 380/430 px (+rail 10) replace 48 px; bounds clamp 0.32–0.68 of usable width; focus override (no inverted bounds) reported via `splittable` and honored by every module call site; pointer capture path (`pointerdown/move/up/cancel/lostpointercapture`) with no document listeners; keyboard 2% (5% with Shift), Home/End to bounds; drag-free narrower/wider/reset menu revealed on focus/tap with pointerdown propagation stopped; rendered % quantized to 0.5% grid while the persisted preference stays exact; preferred ratio preserved separately from temporary clamping (window returns restore the wide split) |
| P2.4 persistence | Done | sessionStorage key scoped per attempt/module (`persistenceKey`), legacy percent values normalized once, persisted only at gesture/keyboard completion |
| P2.5 rail width single source | Done | `STUDENT_SPLIT_RAIL_WIDTH_PX = 10` used by layout math, resizer markup, percentage math, and ARIA; separator role + valuem/min/max/now from live bounds; 44px touch hit target in overlay mode |
| P2.6 rotation/resize recompute | Done | Bounds read from the live workspace rect each render (bounded layout read); preferred ratio survives container changes; scroll anchors and last active pane preserved across rotation |
| P2.7 software keyboard policy | Pre-existing, verified intact | `studentExamViewportPolicy.ts` (keyboard inference with jitter immunity), `useStudentFocusedControlVisibility.ts` (scrolls focused control into visual viewport), `useStudentExamViewport.ts` (visualViewport events incl. resize/scroll/orientation) — all wired through the shell; unchanged this phase |
| P2.8 page lock + safe areas | Pre-existing, verified intact | `useStudentExamPageLock.ts` scopes `student-exam-active` to the exam phase, restores prior scroll on leave; safe-area insets declared once in `index.css` |

## Standing constraint honored

Exam tools (highlight/erase/zoom/navigator/accessibility) were not modified this phase;
only structure underneath them changed (layout policy, pane persistence, splitter).

## Verification results (2026-09-12)

- `npm run typecheck` — 0 errors project-wide.
- Full student-component suite: **79 files / 540 tests, all green** (includes the
  updated motion, a11y, preview, and question-experience contracts plus the new
  `StudentSplitPaneResizer.test.tsx` — 6 tests for the drag-free menu).
- Layout suites: `studentLayoutMode` (19), `studentExamViewportPolicy` (10),
  `studentLayoutCss` (7), `studentCapabilities` (4), shell/viewport component tests — green.
- Matrix/policy consistency: 11/11 rows match via a direct `tsx` policy evaluation.

## Known failures NOT caused by this phase (attributed)

- 5 `src/test/architecture/*` failures (`layer-dependencies`, `legacy-services`,
  `forbidden-browser-boundaries`, `feature-isolation`, `student-exam-architecture`):
  violations trace to the parallel, untracked `src/features/exam-authoring/editor/ingestion/`
  ACT work (confirmed via `git status`), except one pre-existing committed violation in
  `StudentEntryRoute.tsx` (unchanged since Sep 8). None of this phase's files appear in
  any violation output (grep-verified: 0 hits).
- `StudentNetworkProvider` reconnect-retry test: passes inside the full 78-file suite,
  fails in isolation; pre-existing timing flake — proven independent of the new
  `PointerEvent` test-setup polyfill by temporarily removing the polyfill and re-running.

## Test-environment note

`src/test/setup.ts` gained a minimal `PointerEvent` polyfill because jsdom lacks the
constructor; production pointer-capture code keeps the real browser contract. Existing
`user-event` interactions were re-verified green under the polyfill.
