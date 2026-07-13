# Failure Cases

Purpose: turn incidents and bug fixes into durable memory for humans and AI agents.

## Entry Template

```
## YYYY-MM-DD: <short title>

### Symptom
<what users/operators observed>

### Scope
<which modules/flows were affected>

### Root Cause
<specific technical reason>

### Fix
<what changed>

### Regression Protection
- Tests: <paths>
- Diagnostics: <paths>
- Rules/Docs updated: <paths>

### Invariant
<what must remain true going forward>
```

---

## 2026-07-13: Student Review Mark Disappears After a Later Answer Save

### Symptom
A student marked Q20 for review, navigated to and answered Q12, and then saw the Q20 Mark state disappear.

### Scope
Student attempt persistence and the strict frontend-backend mutation contract. This was a durability failure, distinct from the 2026-07-11 Question Navigator styling fix that made flagged questions visually amber even when answered.

### Root Cause
The frontend queued the `flag` mutation and mirrored it into local durable state, but `toOperationCommand` did not map it to a wire command. A chunk containing only flag mutations therefore produced no mapped commands and was removed from the pending queue without an HTTP POST. When a later answer save returned the authoritative attempt without the Q20 flag, that response replaced the local state and the Mark disappeared.

### Fix
- Added an additive strict frontend mapping from local `flag` mutations to `SetFlag` with a boolean `value`.
- Added the strict backend `SetFlag` command and mapped it to the existing domain `Flag` mutation, preserving the existing authentication, section validation, objective-lock enforcement, append-only/idempotent persistence path, and audit/trace behavior.
- No database migration or navigation behavior change was required.

### Regression Protection
- Tests: `src/services/__tests__/studentAttemptRepository.backend.test.ts`, `backend/crates/api/src/routes/student.rs`, `backend/crates/application/src/delivery/mod.rs`
- Diagnostics: none added
- Rules/Docs updated: `docs/failure-cases.md`, `docs/architecture/student-mutation-outbox.md`

### Invariant
Student-visible Mark/Unmark state must match the persisted attempt, be idempotent, and survive later answer saves, refresh, and reconnect. Only intentional section-transition pruning may remove pending flags that belong to a different section.

---

## 2026-07-11: Student Pre-Check Made Silent (Input Form → Waiting Room, No Button)

### Symptom
After check-in, students landed on a briefing screen and had to click **Continue to waiting room** before reaching the proctor-controlled waiting room. The extra manual step confused students about when the exam actually begins.

### Scope
Student exam entry flow: `PreCheck`, `ExamEntryCard`, `Lobby`, `StudentApp` pre-check phase, and the E2E student helpers/specs. No backend or runtime timing changes.

### Root Cause
`PreCheck` coupled the silent compatibility checks + audit persistence to a user-driven button. Advancing to the waiting room (`setPhase('lobby')`) only happened on click, so there was no way to reach the waiting room without an extra action.

### Fix
- Extracted the pure check logic into `src/components/student/preCheckChecks.ts` (`runPreCheckChecks`).
- Rewrote `PreCheck` to render the waiting room immediately and run the checks + persist the pre-check **silently on mount**, retrying idempotently (2s backoff) until it succeeds. No buttons.
- Folded the essential briefing guidance (timer starts only when the proctor starts; autosave; reconnect same device) into `ExamEntryCard` waiting content, and removed the now-dead `briefing` mode.
- E2E `completePreCheckIfPresent` no longer clicks a button — it only settles on the resulting waiting/exam state.

### Regression Protection
- Tests: `src/components/student/__tests__/PreCheck.test.tsx` (silent auto-submit, no buttons, retry-on-failure), `src/components/student/__tests__/preCheckChecks.test.ts`, `src/components/student/__tests__/Lobby.test.tsx` (folded guidance), `src/components/student/__tests__/StudentProviderRuntime.test.tsx` (pre-check phase renders the waiting room).
- E2E: `e2e/student-precheck.spec.ts` (form → waiting room, no briefing/continue button, silent precheck POST persisted).
- Docs updated: `docs/superpowers/specs/2026-07-11-student-exam-briefing-waiting-room-design.md`.

### Invariant
Compatibility checks are advisory but MUST still be persisted for audit — persistence stays idempotent (idempotency key in `recordPreCheckResult`) and retries in the background; failing/incompatible checks never block reaching the waiting room. Students still expose no start control; the exam opens only when the proctor's runtime goes live, which remains the sole production `lobby → exam` transition.

---

## 2026-05-16: Objective Text Grading Ignores Word-Limit Rules

### Symptom
Objective text questions could be marked `Incorrect` even when the student's answer appeared in the answer key variants (e.g. `crowd | crowd noise`), because the configured scoring rule was `ONE_WORD`.

### Scope
Backend objective auto-grading for text answers (Reading/Listening), plus schedule-scoped overrides and regrade/backfill flows.

### Root Cause
Word-limit scoring rules (`ONE_WORD`/`TWO_WORDS`/`THREE_WORDS`) were enforced during grading, but many legacy keys and overrides contain multi-word variants (including `NOT GIVEN`). This created unreachable key variants and widespread grading confusion.

### Fix
- Grade objective text answers by exact OR-match against answer-key variants and ignore word-limit rules for correctness.
- Trim student answers before matching to avoid invisible trailing/leading whitespace mismatches.

### Regression Protection
- Tests: `backend/crates/application/src/grading/mod.rs`
- Rules/Docs updated: `docs/failure-cases.md`

### Invariant
For objective text answers, `|` variants are logical OR and must not be invalidated by word-limit scoring rules.

## 2026-05-16: Correct Answer Display Included Unreachable Variants Under ONE_WORD

### Symptom
Grading review UI could show a student's answer as `Incorrect` while also displaying a correct-answer key that appeared to include the student's exact text (e.g. student `crowd noise`, correct answer `crowd | crowd noise`).

### Scope
Admin grading/review UI correct-answer display for objective text questions (Cloze/Short Answer/Sentence Completion/Note Completion).

### Root Cause
The UI displayed all accepted-answer variants from the exam snapshot without considering the configured `answerRule` word limit. The backend also enforced word-limit rules during grading at the time, making multi-word variants unreachable under `ONE_WORD`.

### Fix
- Auto-upgrade objective override scoring rules (`ONE_WORD`/`TWO_WORDS`/`THREE_WORDS`) to match the longest provided answer-key variant so staff-entered `a | b` behaves as an OR list.

### Regression Protection
- Tests: `src/components/admin/__tests__/gradingAnswerUtils.test.ts`
- Tests: `src/components/admin/__tests__/ObjectiveOverridesPanel.test.tsx`
- Rules/Docs updated: `docs/failure-cases.md`

### Invariant
Correct-answer display must reflect answers that can actually earn points under the configured word-limit rule.

## 2026-05-15: Objective Word Limit Treated As Exact Count

### Symptom
A Listening/Reading objective answer could be displayed with identical student and correct answers but still marked incorrect when the scoring rule was `TWO_WORDS`.

### Scope
Backend objective auto-grading for text answers and schedule-scoped objective overrides.

### Root Cause
The grading helper interpreted `ONE_WORD`, `TWO_WORDS`, and `THREE_WORDS` as exact whitespace token counts. IELTS-style answer rules are maximum limits, so a one-word answer such as `CD` must be valid under `TWO_WORDS`.

### Fix
- Treat text-answer word-count scoring rules as upper bounds.
- Keep strict text matching and reject responses that exceed the configured word limit.

### Regression Protection
- Tests: `backend/crates/application/src/grading/mod.rs`
- Rules/Docs: `docs/failure-cases.md`

### Invariant
Objective text scoring must require exact answer-key equality while enforcing `ONE_WORD` / `TWO_WORDS` / `THREE_WORDS` as maximum word limits, not exact counts.

---

## 2026-05-11: Desktop Reading Highlight Selection Escapes Passage

### Symptom
Desktop text selection in reading could extend into the question pane. Native blue selection disappeared or highlighted too broadly.

### Scope
Student reading highlight UX and highlight snapshot logic.

### Root Cause
Selection handling mixed live browser selection with post-mouseup/button events, and out-of-container endpoints were clipped back into passage text. That could expand user intent into broad ranges and produce unstable highlight apply behavior.

### Fix
- Reject any selection whose start/end endpoints are not both inside the highlightable passage container.
- Reject cross-block (cross-paragraph) highlight requests instead of auto-splitting them.
- Prefer applying from the latest captured selection snapshot before re-reading live selection on mouseup/manual apply.

### Regression Protection
- Tests: `src/components/student/__tests__/highlightPersistence.test.tsx`
- Tests: `src/components/student/__tests__/highlightSelection.test.ts`
- Rules/Docs: `AGENTS.md`

### Invariant
Highlighting is fail-closed: no endpoint clipping, no cross-block expansion, and no highlight apply based on stale/collapsed live selection if a stable snapshot exists.

---

## 2026-05-11: Reading Passage Selection Blocked By Drag Guard

### Symptom
Students could see text selection collapse/disappear when drag-selecting reading passage text, especially when selection started on the passage title.

### Scope
Student reading passage selection behavior under exam anti-cheat drag/drop guard.

### Root Cause
Global `dragstart` blocking exempted only elements inside `[data-student-highlightable="true"]`. The reading title sat outside that boundary, so native selection gestures could be canceled.

### Fix
- Marked the full reading passage pane container as `data-student-highlightable="true"` so title and body are covered by the drag-selection exemption.

### Regression Protection
- Tests: `src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx`
- Rules/Docs: `docs/failure-cases.md`

### Invariant
Reading passage text selection (title and body) must remain native-selectable during exam mode.

---

## 2026-05-11: Reading Passage HTML Overrides Standard Typography

### Symptom
Reading passage content rendered with mixed font families and sizes when pasted HTML included inline typography styles.

### Scope
Student reading passage rendering path (`StudentReading` non-highlight HTML mode).

### Root Cause
Passage HTML was sanitized for safety, but inline typography declarations (`font-family`, `font-size`, `line-height`) were still preserved and overrode the shared student reading typography variables.

### Fix
- Added `sanitizeReadingPassageHtml` in the student reading module.
- Strip inline typography overrides (`font-family`, `font-size`, `line-height`) after sanitization.
- Unwrap legacy `<font>` tags so passage text always uses the standard reading typography baseline.

### Regression Protection
- Tests: `src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx`
- Rules/Docs: `docs/failure-cases.md`

### Invariant
Reading passage content may keep semantic emphasis formatting (for example bold/italic), but font family, base font size, and line-height must come from platform reading typography variables only.

---

## 2026-05-12: Reading Question Text Selection Blocked By Question Chrome

### Symptom
Students could not reliably drag-select reading question text. Starting selection on a question number, option letter, or prompt row chrome could collapse or fail selection even though the prompt text itself was highlight-enabled.

### Scope
Student reading question rendering and exam anti-cheat drag/drop guard behavior.

### Root Cause
`QuestionRenderer` marked only inner `FormattedText` prompt spans as highlightable. The visible question chrome around those spans, especially question numbers and prompt rows, remained outside `[data-student-highlightable="true"]`, so the global drag/drop guard could treat native selection gestures as blocked drag/drop attempts.

### Fix
- Marked visible question text chrome as highlightable/selectable across objective question renderers.
- Kept answer inputs/selects outside the highlightable boundary so answer-control protections are not weakened.
- Made the reading passage pane explicitly `user-select: text` in addition to its highlightable marker.

### Regression Protection
- Tests: `src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx`
- Tests: `src/components/student/__tests__/StudentQuestionExperience.test.tsx`
- Tests: `src/components/student/providers/__tests__/StudentKeyboardProvider.test.tsx`
- Rules/Docs: `docs/failure-cases.md`

### Invariant
Reading passage and question display text must remain native-selectable during exam mode, while answer controls remain outside highlightable selection boundaries.

---

## 2026-05-12: Reading Highlight Toolbar Clears Selection Before Apply

### Symptom
Students could select reading passage text, but clicking a floating highlight color action did not apply a highlight. In browser selection UI this could look like the active selection jumped or expanded unexpectedly before the highlight action completed.

### Scope
Student reading/listening highlight toolbar and v2 highlight persistence.

### Root Cause
The floating toolbar accepted a normal mouse down. Browsers may collapse or rewrite the active text selection before the subsequent click handler runs, causing the highlight surface to clear its captured selection and leaving the color action with nothing to apply.

### Fix
- Prevent default mouse-down behavior on the floating highlight toolbar so clicking color actions does not steal or collapse the active text selection before the click handler runs.

### Regression Protection
- Tests: `src/components/student/__tests__/highlightPersistence.test.tsx`
- Rules/Docs: `docs/failure-cases.md`

### Invariant
Floating highlight controls must not clear or replace the text selection they are acting on before the apply/remove action has consumed it.

---

## 2026-05-13: Touch Highlight Toolbar Tap Drops Selected Text

### Symptom
Students could select the intended passage/question text, but tapping the floating highlight toolbar could make the toolbar disappear or leave the color action with no selection to apply.

### Scope
Student reading/listening highlight toolbar and v2 highlight selection capture.

### Root Cause
The highlight surface only kept transient invalid selection snapshots when the browser still reported the same selected text. Touch/pointer activation can briefly report a collapsed empty selection before the click action runs, so the surface could clear the captured selection and hide the toolbar during the action sequence.

### Fix
- Preserve toolbar selection controls for the existing short transient window whenever a valid captured selection just existed.
- Keep the last valid captured selection available for toolbar apply/remove during that transient window.
- Prevent mouse, pointer, and touch start defaults on toolbar controls so activation does not steal native text selection.

### Regression Protection
- Tests: `src/components/student/__tests__/highlightPersistence.test.tsx`
- Rules/Docs: `docs/ux-invariants.md`

### Invariant
Floating highlight controls must consume the latest valid captured text selection even if the browser temporarily reports an empty live selection while the toolbar is being tapped.

---

## 2026-05-13: Highlight Surface V3 Enables Cross-Block, Surface-Bounded Selection

### Symptom
Reading/question text selection could not be highlighted when a range crossed paragraph/block boundaries inside the same visible text surface.

### Scope
Student highlight selection capture, toolbar apply flow, and highlight persistence boundary policy.

### Root Cause
Selection capture enforced a single-block policy gate that rejected otherwise valid same-surface ranges.

### Fix
- Rebuilt the selection pipeline around `highlightSelectionPort -> captureSurfaceSelection -> useHighlightSurfaceV2 -> highlightV2Persistence` with explicit V3 seams:
  - `surfaceResolver`
  - `rangeNormalizer`
  - `selectionObserver`
  - `highlightCommandService`
  - `highlightStore`
  - `renderAdapter`
- Removed single-block rejection from capture so cross-block ranges are valid when both endpoints stay in one highlight surface.
- Kept strict fail-closed surface checks and exclusion of answer controls (`input`, `textarea`, `select`, `[contenteditable]`, and answer-control wrappers).
- Deleted legacy snapshot/highlight path files:
  - `src/components/student/highlightSelection.ts`
  - `src/components/student/highlightPersistence.tsx`
  - `src/components/student/__tests__/highlightSelection.test.ts`

### Regression Protection
- Tests: `src/components/student/__tests__/highlightV2Engine.test.ts`
- Tests: `src/components/student/__tests__/highlightSelectionPort.test.tsx`
- Tests: `src/components/student/__tests__/highlightPersistence.test.tsx`
- Tests: `src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx`
- Tests: `src/components/student/__tests__/StudentQuestionExperience.test.tsx`
- Rules/Docs: `docs/ux-invariants.md`

### Invariant
Cross-block selections are valid within a single highlight surface. Cross-surface and answer-control-touching selections are rejected.

---

## 2026-05-13: Dragstart Anti-Cheat Blocks Native Text Selection

### Symptom
Students could not select reading/question text like a normal browser. Selection could collapse or never reach the highlight toolbar, especially when the browser emitted `dragstart` from wrapper text chrome instead of the exact highlightable element.

### Scope
Student exam global anti-cheat drag/drop guard and student text selection.

### Root Cause
The anti-cheat layer blocked `dragstart` unless the event target was inside `[data-student-highlightable="true"]`. Native selection gestures can dispatch `dragstart` from surrounding wrappers, whitespace, or text nodes that are still part of the visible reading/question text experience, so the guard interrupted normal browser selection behavior.

### Fix
- Allow `dragstart` during exam mode so native text selection behaves normally.
- Allow `drop` during exam mode so native browser text/interaction flows are not canceled by global listeners.

### Regression Protection
- Tests: `src/components/student/providers/__tests__/StudentKeyboardProvider.test.tsx`
- Rules/Docs: `docs/ux-invariants.md`

### Invariant
Anti-cheat interaction policy must not cancel native text selection or drop gestures; integrity enforcement belongs on paste and answer-mutation paths.

---

## 2026-05-16: Fullscreen Anti-Cheat Removed From Student Runtime

### Symptom
Required fullscreen enforcement depended on browser fullscreen APIs from React effects and retry handlers. Those APIs are gesture-gated, so an exam could silently continue without entering fullscreen while the runtime carried extra iPad keyboard/viewport exception logic.

### Scope
Student proctoring runtime, student pre-check, builder/admin security configuration, and default exam config normalization.

### Fix
- Removed fullscreen entry/re-entry enforcement and `FULLSCREEN_EXIT` runtime counting.
- Removed fullscreen warning overlays and fullscreen controls from builder/admin security UI.
- Removed fullscreen API checks from student pre-check and preview pre-check snapshots.
- Kept legacy fullscreen config keys tolerated only so old saved JSON can normalize without crashing.

### Regression Protection
- Tests: `src/components/student/providers/__tests__/StudentProctoringProvider.test.tsx`
- Tests: `src/components/student/__tests__/PreCheck.test.tsx`
- Tests: `src/features/builder/components/__tests__/SecurityTab.test.tsx`
- Tests: `src/constants/__tests__/examDefaults.test.ts`

### Invariant
Do not reintroduce browser fullscreen as an anti-cheat requirement. Integrity enforcement remains in tab-switch, secondary-screen, translation, screenshot, clipboard, audit, and threshold flows.

---

## 2026-07-11: Student Briefing Must Not Start a Runtime-Backed Exam

### Failure case
Displaying compatibility checks or a student-owned start button can imply readiness that was not persisted and can bypass the proctor-controlled start boundary.

### Invariant
Compatibility checks run silently and their complete result is persisted before entering the waiting room. A runtime-backed student remains in the waiting room until server runtime hydration reports an active exam; only the proctor/server owns timer start.

---

## 2026-07-11: TXT Export Drops SINGLE_MCQ Sub-Questions

### Symptom
Bulk "Export to TXT" produced an incomplete file: an exam reported as N questions (e.g. 40) in the admin UI only wrote ~N-10 questions (e.g. 30). The missing questions and answer-key rows belonged to `SINGLE_MCQ` blocks that carry a `questions` array of sub-questions.

### Scope
`src/utils/examTextExport.ts` `renderBlock` `SINGLE_MCQ` case, plus the TXT export triggered from `src/components/admin/AdminExams.tsx` `handleBulkExport`.

### Root Cause
`SingleMCQBlock` has an optional `questions?: SingleMCQQuestion[]` (types.ts:226) used when one MCQ block holds several independent questions, each with its own stem/options. The canonical question count (`getBlockQuestionCount`, examUtils.ts:34) counts `block.questions.length`, matching the student renderer (QuestionRenderer.tsx `renderSingleMCQ`, gradingAnswerUtils.ts). But `renderBlock`'s `SINGLE_MCQ` case ignored `block.questions` entirely and emitted a single question from `block.stem`/`block.options`, so every sub-question beyond the first disappeared from the export (and its answer key). The deeper cause was two independent, hand-maintained definitions of "the questions in a block" — one in `getBlockQuestionCount` (count) and one in `renderBlock` (export) — which had already drifted for `SINGLE_MCQ`.

### Fix (systematic)
Introduced a single source of truth, `enumerateBlockQuestionUnits(block): QuestionUnit[]` in `src/utils/examUtils.ts`, that returns one unit per answerable slot with `{ blockId, blockType, questionId, slotCount }`. Both consumers now derive from it:
- `getBlockQuestionCount` sums `slotCount` over the enumerated units (so count and export can never disagree on cardinality).
- `renderBlock` in `src/utils/examTextExport.ts` was refactored to a per-block context section plus `enumerateBlockQuestionUnits(block).forEach(unit => renderUnit(...))`, with `renderUnit` switching on `unit.blockType`. `SINGLE_MCQ` renders each sub-question from `block.questions[x]` when present, falling back to block-level rendering when empty.
Sub-block grouping (`sentenceBlankGroupKey`, `tableCellGroupKey`) and `scoreGroupId` dedup follow the count model exactly. Multi-select is emitted as one unit with `slotCount = requiredSelections`.

### Regression Protection
- `src/utils/__tests__/examTextExport.drift.test.ts` — drift guard: for a fixture exercising all 14 block types, the number of exported `Q*` answer-key rows must equal the number of units from `enumerateBlockQuestionUnits`. Mutation-verified: skipping `SINGLE_MCQ` units makes the test fail (RED).
- `src/utils/__tests__/examTextExport.test.ts` — "exports every SINGLE_MCQ sub-question" and "does not drop SINGLE_MCQ sub-questions across a realistic 40-question exam".
- `src/utils/__tests__/examUtils.questionCounting.test.ts` — count equals source-of-truth enumeration across all block types.

### Invariant
The TXT export and `getBlockQuestionCount`/`getExamStatsFromState` must derive question cardinality from the same `enumerateBlockQuestionUnits` enumeration. Any new question-bearing array on a block must be added there once; both count and export follow automatically. Do not re-introduce block-specific count vs. render logic in two places.

### Note (separate, pre-existing, out of scope)
`MULTI_MCQ` is rendered as one question spanning slots (e.g. `Q1-2`) while `getBlockQuestionCount` returns `requiredSelections`. This makes the canonical "total questions" count larger than the number of answer-key lines for multi-select blocks by design (one question, multiple slots). Do not "fix" by inflating the export; reconcile the counting model deliberately if the discrepancy becomes user-visible.
