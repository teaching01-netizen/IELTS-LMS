# Implementation phases

Execute serially. Each phase ends with a reviewable diff and the stated evidence. Existing work in the checkout must be reconciled before touching overlapping files. New filenames below are proposed; other paths are existing owners inspected during planning.

## Detailed implementation guides

The guides expand the summaries below into ordered tasks with stable IDs, exact ownership, implementation contracts, meaningful tests, commit boundaries, and exit criteria. Follow the existing zero-based Phase 0–7 numbering consistently.

| Phase | Guide | Task range |
| --- | --- | --- |
| 0 | [Integration baseline and fixtures](phase-00-baseline.md) | P0.1–P0.6 |
| 1 | [Typography and interaction foundation](phase-01-design-system.md) | P1.1–P1.5 |
| 2 | [Adaptive workspace and splitter](phase-02-adaptive-workspace.md) | P2.1–P2.7 |
| 3 | [Protected controls and navigation](phase-03-controls-navigation.md) | P3.1–P3.6 |
| 4 | [IELTS/ACT modules and journey](phase-04-modules-journey.md) | P4.1–P4.7 |
| 5 | [Annotations and workspace memory](phase-05-annotations-memory.md) | P5.1–P5.6 |
| 6 | [Reliability, security, performance, and capacity](phase-06-reliability-security-performance.md) | P6.1–P6.7 |
| 7 | [Verification, release, and rollback](phase-07-verification-release.md) | P7.1–P7.8 |

These are planned tasks, not completed implementation. Historical baseline defects must be rechecked before repair. The current user restriction remains code-only: browser/device checks can be prepared but are not to be executed unless the working constraints change. Unexecuted acceptance checks cannot support a production-ready claim.

Implementation clarifications: Phase 2 defines height thresholds against the outer stable shell and separately checks remaining workspace height; it also replaces exam-title view-state keys with attempt/version scope. Phase 5 keeps V2 records during V3 annotation migration, and Phase 7 requires an active-attempt-compatible rollback reader/assets strategy.

## Phase 0 — Establish the integration and acceptance baseline

**Owns:** this plan, fixture/test setup, necessary baseline repair, lockfile/CI prerequisites. No broad visual changes.

1. Resolve the three unmerged Git entries against the repository's intended Go backend direction. Preserve current ACT reconciliation and SAT work. Record the resolved commit and relevant uncommitted changes; do not reset/stash/discard someone else's work to obtain a clean status.
2. Repair the 14 type errors listed in `code-review-baseline.md` in separate, minimal changes. Do not weaken strict TypeScript settings, add broad non-null assertions, or exclude the files.
3. Standardize on the current CI npm workflow, synchronize `package-lock.json` with `package.json`, and prove `npm ci` in an isolated clean checkout. Retain the pinned DOMPurify dependency. Reconcile the second lockfile with the team's package-manager convention; do not keep publishing mutually inconsistent locks.
4. Pin deterministic IELTS/ACT fixtures using existing test builders and `e2e/support/actFixtures.ts`. Include every supported `QuestionType`, Academic/General Training reading/writing, diagrams/tables, long instructions/options, empty content, a 1,000+ word essay, IME text, broken media, and non-40 ACT question counts.
5. Pin a behavior matrix for clipboard, undo, pause, seeking/speed/transcript, submission availability, word counts, and tools. Preserve current defaults. Separate official-parity candidates from deliberate proctored restrictions; do not add a student-controlled bypass.
6. Inspect the current ACT reconciliation state against `plans/act-reconciliation/overall-plan.md`. Consume its finalized contracts rather than duplicating media, scoring, migration, or result work.
7. Record current test/build/lint status and fixture coverage. Prepare screenshot/interaction fixtures for later browser verification; this planning task remains code-only.

**Gate:** no unresolved Git entries; typecheck succeeds; clean installation is reproducible; baseline failures are fixed or explicitly scheduled as release blockers with an owner. The final release cannot rely on waiving relevant failures.

## Phase 1 — Consolidate typography and interaction tokens

**Owns:** `src/components/student/accessibilityScale.ts`, `accessibilityPreferences.ts`, `providers/StudentUIProvider.tsx`, `StudentApp.tsx`, `src/index.css`, and new `src/components/student/styles/exam.css` if extraction makes the ownership clearer.

1. Replace viewport-dependent exam content sizes with semantic rem-based roles. Keep the existing preference API and stored values valid. Add explicit answer/editor roles instead of copying passage font sizes into every control.
2. Scope the exam system-font stack to IELTS/ACT. Retain unrelated application font behavior. Move only the relevant existing student CSS into the new file if needed; remove the old declarations in the same change to avoid competing rules.
3. Consolidate reading measure, paragraph spacing, control height, targets, borders, neutral/selected/focus colors, shadows, and motion durations. Preserve high-contrast/forced-colors support. Do not style another provider through unscoped `button`, `input`, or `:root` overrides.
4. Replace `active:scale-[0.96]`, unrelated panel entrance animations, and animated counters with immediate state feedback. Update `StudentInteractionMotion.test.tsx`, `StudentInteractionMotionCss.test.ts`, and affected E2E expectations to check the new behavior; do not simply delete coverage.
5. Add a small reusable exam control style recipe or wrapper only where multiple callers share behavior. Reuse existing Button/Dialog infrastructure and installed Radix. Do not build a new component library of trivial wrappers.

**Edges:** largest accessibility setting, blocked remote fonts, authored emphasis/science notation, forced colors, user text-spacing overrides, reduced motion, selected+focused+flagged states.

**Gate:** typography is stable across resize; no exam content font depends on viewport width; Writing and passage use the agreed family; visual state changes preserve geometry; targeted accessibility/token tests pass.

## Phase 2 — Make the shell and panes adapt without state loss

**Owns:** `layout/studentLayoutMode.ts`, `studentCapabilities.ts`, `useStudentLayoutEnvironment.ts`, `StudentExamShell.tsx`, `StudentExamViewport.tsx`, `studentExamViewportPolicy.ts`, `useStudentExamViewport.ts`, `useStudentFocusedControlVisibility.ts`, `layout/README.md`, `StudentMaterialWithQuestionPane.tsx`, `StudentWriting.tsx`, `StudentWritingPanes.tsx`, `useSplitPaneResize.ts`, `splitPaneDimensions.ts`, `browserParityPolicy.ts`, `StudentSplitPaneResizer.tsx`.

1. Replace the width-only mode contract with the four modes, usable-height checks, and computed split-fit capabilities in `design-contract.md`. Update every consumer, CSS mode selector, README, test helper, and the viewport matrix together. Provide deterministic SSR/test fallbacks for missing/invalid measurements.
2. Measure the shell once. Separate viewport facts from user preference and exam state. Avoid device-name routing; keep any platform workaround narrowly tied to a demonstrated API limitation.
3. Refactor material/question and Writing layouts to keep stable pane roots across split/focus mode. Preserve one mounted textarea and one answer-control tree. Hide inactive panes from interaction and assistive navigation, with focus returned to a visible destination when a user switches panes.
4. Replace the 48px split minimums with readable measured bounds. Use one rail-width value across layout, positioning, percentage calculation, and ARIA. Enter focus mode when bounds cannot be satisfied; never swap inverted bounds and present them as usable.
5. Replace separate mouse/touch document listeners with pointer capture and cleanup on every exit path. Apply width without transition. Add keyboard commands and click/tap resize alternatives. Recompute and reclamp after container resize; preserve the preferred ratio separately from temporary clamping so returning wide does not overwrite the preference.
6. Preserve scroll anchors and last active pane across rotation. Begin with stable paragraph/question IDs and task IDs already available; add a small view-state helper at the layout boundary only if needed. Do not put pixel scroll positions into server answer mutations.
7. Extend the keyboard policy to bound the editable region to the visual viewport while keeping stable chrome. Handle focus changes with keyboard already open, scale/offset changes, external keyboard, rapid rotation, and missing APIs. Ensure textarea native caret scrolling has sufficient visible height before introducing caret measurement.
8. Keep page lock scoped to active exam and restore prior page styles/scroll on leave. Account for safe areas once at each owning edge. Overlay lists must remain reachable at 320px and in landscape.

**Gate:** 899/900 and 1179/1180 transitions, short-wide windows, 768px portrait, rotation, and software keyboard changes preserve active answer, editor identity, text, and source context. No unreachable content is hidden to satisfy an overflow assertion. Existing protected-input and Writing lifecycle suites remain green.

## Phase 3 — Complete answer controls, focus, and navigation

**Owns:** `ProtectedInput.tsx`, `ProtectedChoiceInput.tsx`, `ProtectedSelect.tsx`, `protectedAnswerControlLifecycle.ts`, `QuestionRenderer.tsx`, `StudentQuestionBlockSection.tsx`, `StudentQuestionText.tsx`, `StudentQuestionNumber.tsx`, `TableCompletionSlotCell.tsx`, `SubAnswerTreeQuestionList.tsx`, `StudentHeader.tsx`, `StudentFooter.tsx`, `QuestionNavigator.tsx`, `WritingTaskNavigator.tsx`, `layout/CompactStudentHeader.tsx`, `CompactQuestionNavigation.tsx`, `StudentToolsSheet.tsx`.

1. Establish the number/content/flag grid and consistent answer row geometry. Apply the shared recipe to every supported question renderer, not just the multiple-choice example. Keep inline completion fields and table cells readable without clipping.
2. Preserve native radio/checkbox keyboard behavior and one activation per gesture. Maintain independent flag and ACT elimination actions. Keep display numbers separate from answer IDs and shared slot keys.
3. Introduce a value-oriented protected answer adapter before replacing native select presentation. Suggested new owner: `ProtectedExamSelect.tsx`, with internal presentation components only when necessary. Its value-change callback updates the existing live answer registry and command path exactly once. It registers pending draft commit with the existing lifecycle/barrier.
4. Use installed Radix Select for anchored desktop selection where its semantics fit; use the existing dialog pattern for the phone choice sheet. Both consume the same controller. Preserve native `ProtectedSelect` until each caller migrates with tests; remove it only when no production caller remains. Never manufacture a fake DOM event to make a custom button masquerade as an HTMLSelectElement.
5. Keep selected value distinct from keyboard-highlighted option. Support empty/cleared answers, repeated choices where permitted, disabled options, typeahead, long labels, cancel, and unmount during a pending selection. Server hydration must not reapply an older rescued value over newer input.
6. Use one question-state selector for desktop chips, compact navigation, and question sheet. Preserve partial/full multi-slot completion and flagged+current combinations. Keep header/footer geometry stable as counts change.
7. Make tools accessible on touch without relying on hover. Define overlay close/focus rules for Escape, selection, outside click, route/phase change, and viewport transition. Portal roots must participate in focus trapping and inherit typography/contrast settings.
8. Remove permissive returns from required navigator/accessibility tests. Missing expected controls are failures; optional tools are asserted against explicit capability fixtures.

**Gate:** complete keyboard-only path through each answer family and navigator; no duplicate commits; selection followed immediately by blur/section transition/submission persists the chosen value; cancel does not change it; hidden controls cannot receive focus.

## Phase 4 — Apply the system across IELTS and ACT

**Owns:** `StudentReading.tsx`, `StudentListening.tsx`, `StudentWriting.tsx`, `StudentWritingPanes.tsx`, `StudentWritingCountdown.tsx`, `StudentSpeaking.tsx`, `StudentScience.tsx`, `StudentZoomableMedia.tsx`, `StudentExamWorkspace.tsx`, `StudentExamWorkspaceSession.tsx`, `StudentExamPreview.tsx`, `StudentExamPhaseRenderer.tsx`, `StudentPostExamView.tsx`; integration with existing ACT authoring/results owners.

1. Reading: consolidate content styling and maximum measure; retain inline paragraph markers, rich text sanitation, native selection, and correct question-to-passage association. Prevent answer updates from rerendering or repositioning unrelated passage content.
2. Writing: remove card nesting/shadow/slide animation, use the agreed font/inset, align prompt and response headers, reserve word-count width, and place the placeholder at the same text origin. Keep the existing textarea and draft refs. Include task/version identity in memo comparisons; the inspected prompt comparator currently omits `currentTaskId`, which can matter for identical-text tasks with different annotation surfaces.
3. Preserve immediate draft preview and commit on composition end, blur, task switch, navigation, visibility transition, deadline, and explicit submission. Avoid rewriting textarea value when it already matches or replacing a newer local draft with older server data. Keep selection/caret and editor scroll during non-content changes.
4. Keep clipboard/undo default policy unchanged. Consolidate any duplicated rule checks at the existing policy boundary only after pinning current behavior. If native editing parity is approved later, implement an explicit capability and update proctor monitoring and tests together; do not remove one local guard while global interception remains.
5. Listening: make media status explicit, preserve audio element/position through presentation changes, and keep play/seek/rate/volume/transcript behavior configuration-driven. Handle play promise rejection, load/stall/error/end, and inaccessible media. Do not pause the authoritative timer on a local network error.
6. Speaking: pass the same adaptive capabilities through `StudentExamWorkspace` into the component. Apply shared typography/controls and clear disabled/proctor status. Keep preparation/speaking counters correctly labeled; reconcile timing with existing runtime authority if they are intended as scored timing rather than advisory practice counters.
7. ACT Science: reconcile against the in-progress image/order/delivery work. Cover text and image choices, stimulus annotations, tables/graphs, long labels, zoom, flagging, and elimination without changing answer IDs or grading. Use ACT labels in header, navigation, confirmation, and completion.
8. Entry/pre-check/lobby/completion: apply compatible text hierarchy, responsive forms, focused validation, actionable loading/error/retry states, and provider-correct copy. Replace inappropriate fixed `h-screen` assumptions where ordinary page scrolling is needed. Avoid exposing implementation terms such as runtime revisions to candidates.
9. Preview must render the same presentation/components as delivery. Verify ACT has a valid initial question instead of relying on an accidental null fallback. Confirm teacher preview, proctor interventions, grading review, and results still receive correct provider and answer data.

**Gate:** every listed module and journey state has a fixture and relevant automated test; Writing IME/draft lifecycle remains intact; no unsupported ACT section is implied; no local media/error state changes scoring or server time.

## Phase 5 — Finish annotations and workspace memory

**Owns:** `highlightV2Engine.ts`, `highlightV2Persistence.tsx`, `highlight/highlightStore.ts`, `highlight/rangeNormalizer.ts`, `highlight/renderAdapter.ts`, `highlight/highlightCommandService.ts`, `highlightSelectionManager.tsx`, `useHighlightSurfaceV2.ts`, `RichTextHighlighter.tsx`, `HighlightableSurface.tsx`, header/tool-sheet integration; proposed `annotationTypes.ts` and `StudentNoteEditor.tsx` if required.

1. Extend existing normalized text offsets with versioned highlight/underline/note variants. Keep canonical text, content hash, version, and surface ID stable. Reuse existing range validation and limits; define bounded plain-text note length and annotation count before wiring UI.
2. Implement backward-compatible read/migration for V2 highlight records. Catch storage getter/read/write/remove failures. Return observable persistence status instead of silently presenting memory-only notes as saved.
3. Implement toolbar actions and the note editor, with keyboard equivalents, touch selection preservation, labeled controls, Escape/cancel, and focus restoration. Keep native selection visually distinct from saved highlight. Underline must not alter line height.
4. Apply/remove annotations without rewriting canonical content, moving text, or accumulating nested markup. Handle overlaps, adjacent ranges, repeated phrases, paragraph boundaries, Unicode/surrogate pairs, tables, and non-text boundaries explicitly.
5. Prevent stale storage effects when switching namespace/version/surface. Store view state per candidate attempt/module and reset ephemeral state on identity/phase change. Restore scroll/caret only when the corresponding content identity matches.
6. Honor the same-browser annotation scope. Do not add network requests to the answer outbox for cosmetic view state. If cross-device annotation durability becomes required, design a separately authenticated annotation API rather than smuggling notes into scored answers.

**Gate:** existing highlights survive upgrade; underline/notes survive reload; malformed or mismatched annotations cannot crash/render unsafe HTML; storage failure is visible and preserves memory; one candidate cannot see another candidate's notes.

## Phase 6 — Harden recovery, security, and performance

**Owns:** existing `features/student/application/exam-session/` commands/coordinator, `contracts/exam-session/`, infrastructure adapters, `providers/StudentAttemptProvider.tsx`, status UI, `src/shared/durability/`, `src/services/studentMutationOutbox.ts`, sanitization/media boundaries, Go API/ACT tests, existing telemetry.

1. Trace the actual live adapter used by each IELTS/ACT route. Reuse it; do not create another autosave engine. Preserve local-update-before-enqueue, write identity, revision/epoch checks, replay idempotency, and submitted immutability.
2. Map existing persistence/runtime states to the copy/severity contract. Do not infer a saved state from a click or from navigator counts. Keep offline recovery distinct from storage unavailability and proctor pause. Fix contradictory dead copy only after testing reachable state policy.
3. Exercise blur/task switch/manual submit/timeout/proctor advance while a save is pending. Submission must commit drafts, pass durability barriers, flush required work, then obtain/reconcile server terminal state. Response loss and repeated activation must not create duplicate results.
4. Test auth expiry, owner/lease conflict, stale acknowledgments, malformed responses, storage quota/denial, tab close/reload, sleep/wake, and recovery after timeout. Retain recoverable drafts; never clear local data on request dispatch or an assumed success.
5. Reuse DOMPurify and image URL normalization for every new rendered surface. Validate media server-side, scope media access, preserve answer-key redaction and CSRF/authorization middleware, and prevent notes/drafts/credentials appearing in logs or publicly uploaded artifacts.
6. Measure real typing, selection, navigation, highlighting, and drag behavior using the budgets in `verification-and-release.md`. Narrow store subscriptions at measured hot spots. Keep timer ticks from rerendering the editor, avoid synchronous storage on pointermove, and cache canonical text/sanitization by immutable content identity.
7. Extend existing telemetry with bounded reason codes and timing/count metrics only where missing. Monitor pending-save age, barrier failures, verified-submit latency, stale/conflicting write rejections, media errors, and client crashes. Avoid high-cardinality candidate IDs in metric labels.
8. Reuse current API/worker/database/load infrastructure. Scale using measured enrollment/start/save/submit waves. Verify connection pools, request/body limits, deadlines, backpressure, and retry jitter; do not add services, caches, or queues without evidence.

**Gate:** recovery/security scenarios pass; no known accepted-answer loss; no false completion; no unsafe content/identity leakage; budgets are measured on representative content and hardware; useful alerts have owners and a runbook.

## Phase 7 — Verify and release safely

**Owns:** `.github/workflows/ci.yml`, test configuration and fixtures, deployment/runbook artifacts, narrowly targeted fixes assigned back to their phase.

1. Run the command suites and full acceptance matrix in `verification-and-release.md` against an isolated representative Go/MySQL environment. Record commit, environment, fixture IDs, browser versions, results, and artifacts.
2. Replace vacuous accessibility/performance assertions. Add deterministic screenshots for intended exam states, behavioral focus/geometry checks, and real-device tests for software keyboards and assistive technology. Source-string assertions alone do not prove usable UI.
3. Gate deployment on the required frontend, backend, integration/E2E, accessibility, and performance evidence. Pin tooling used by release-critical jobs and verify clean installation. Do not treat running unit tests with a production URL as a deployed-system smoke test.
4. Stage the release with synthetic candidates, then a small controlled cohort. Release a consistent frontend asset set; retain old hashed assets for already-open exams. Avoid forced refreshes or switching presentation mid-attempt.
5. Verify build health, save/submit behavior, images/audio, error telemetry, and backend migration compatibility before widening rollout. No unapproved production load storm or migration is part of this planning task.
6. Rehearse rollback to the previous frontend/backend-compatible release. Retain annotation backward readers and durable drafts. Do not delete new data or reverse schema changes that active attempts depend on.
7. Record exact known limitations and supported browser/device versions. Deliver the code, tests, reference fixtures, operations notes, and evidence together.

**Gate:** all release criteria pass; the latest deployed artifact is smoke-tested; rollback preserves active work; no skipped required scenario or unresolved relevant defect remains.
