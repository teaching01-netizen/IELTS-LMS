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

## 2026-05-16: Correct Answer Display Included Unreachable Variants Under ONE_WORD

### Symptom
Grading review UI could show a student's answer as `Incorrect` while also displaying a correct-answer key that appeared to include the student's exact text (e.g. student `crowd noise`, correct answer `crowd | crowd noise`).

### Scope
Admin grading/review UI correct-answer display for objective text questions (Cloze/Short Answer/Sentence Completion/Note Completion).

### Root Cause
The UI displayed all accepted-answer variants from the exam snapshot without considering the configured `answerRule` word limit. The backend enforces `ONE_WORD`/`TWO_WORDS`/`THREE_WORDS` as a hard upper bound, so multi-word variants in the key are unreachable when the rule is `ONE_WORD`.

### Fix
- Filter correct-answer display variants to those that fit within the descriptor's `answerRule` word limit (fallback to original list if none fit).
- Block saving objective overrides that specify a word-limit scoring rule but include any text variant exceeding that limit (forces key + rule to be consistent).

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
