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

## 2026-08-05: Second Client Session Can Silently Overwrite Accepted Answers (Missing Mutation Base-Revision Gate)

### Symptom
Two client sessions for the same student (e.g. phone + laptop) could race on one attempt. The
second session's mutation batch carried a stale `baseRevision` relative to mutations the first
session had already had accepted, yet the batch was applied unconditionally. The second session
could therefore silently overwrite answers that the first session had already had accepted — the
authoritative persisted state diverged from what each session believed it had saved.

### Scope
Backend mutation batch application (`backend/crates/application/src/delivery/`) and the student
client's pending-mutation flush/recovery loop (`src/services/studentAttemptRepository.ts`,
`src/components/student/providers/StudentAttemptProvider.tsx`). Earlier
idempotency/seq-guard rails covered replay of the same session but not a stale *other* session.

### Root Cause
The mutation batch endpoint accepted any command whose `baseRevision` was not ahead of the attempt's
current revision; it never enforced `baseRevision >= attempt.revision`. A session that booted from
an older snapshot could keep submitting batches under an outdated base, and there was no
authoritative path for the client to converge before retrying.

### Fix
- Backend now rejects a batch with `baseRevision < attempt.revision` atomically with
  `409 CONFLICT` / reason `BASE_REVISION_MISMATCH`, carrying the authoritative `latestRevision`,
  the requesting session's accepted watermark (`serverAcceptedThroughSeq`), and the owning
  `activeSessionId` (commits `51efb97`, `67dffba`). The submit-path variant
  (`lastSeenRevision` mismatch) carries `latestRevision` and `activeSessionId` but sets
  `serverAcceptedThroughSeq: None` (`delivery/mod.rs:1344`).
- Position/progression/navigation payloads are not accepted by the public mutation batch route at
  all: they are rejected with `422 VALIDATION_ERROR` (the new-format `type` tag does not admit
  them, and the legacy allowlist excludes them). And every accepted batch — flags included — bumps
  the attempt revision exactly once (`revision = revision + 1`, `delivery/mod.rs:933`); only
  heartbeats update the attempt without touching the revision.
- Frontend already reconciles on the gate (no answer loss): `saveAttempt` (`studentAttemptRepository.ts`)
  adopts the fetched authoritative attempt, rebases the rejected `remainingMutations` with fresh
  mutation ids onto `latestRevision`, requeues them in the durable pending-mutation mirror, and
  re-flushes. A focused test now proves this path end-to-end (before, only the submit-path
  I1-residual variant was covered).

### Regression Protection
- Backend (BEX-003 contract): `backend/tests/contracts/student_contract.rs` — stale-batch rejection,
  mutation-batch conflict shape (`latestRevision`/`serverAcceptedThroughSeq`/`activeSessionId`; the
  submit-path variant carries `serverAcceptedThroughSeq: None`), and
  `submit_from_second_client_session_with_stale_revision_returns_base_revision_mismatch_conflict`.
- Frontend: `src/services/__tests__/studentAttemptRepository.backend.test.ts` — "rebases pending
  mutations onto the authoritative revision and requeues them when the batch flush returns
  409 BASE_REVISION_MISMATCH (BEX-003)"; existing I1-residual submit-reconciliation test
  (`studentAttemptRepository.test.ts`, `StudentAttemptProvider.test.tsx`).

### Invariant
Accepted answers are immutable against a stale writer: a mutation batch must base on
`revision == attempt.revision` (or a superseding state) or be rejected atomically. A rejected batch
must never be silently dropped or looped by the client — it is rebased and retried, so the
student-visible saved/verified state always matches persisted reality.

---

## 2026-07-18: Inferred Viewport Geometry Survived Browser Recovery

### Symptom
Repeated iPad keyboard-dismissal sequences could still leave the exam header or footer displaced.
The footer could remain above a persistent white gap after either tapping outside an answer or using
the keyboard-hide control, even though earlier event-order-specific fixes passed automated tests.

### Scope
The active student exam shell, viewport meta policy, and browser layout tests. Answer entry,
autosave, submission, timers, integrity, audit, grading, and navigation behavior were unchanged.

### Root Cause
The application persisted Visual Viewport measurements into layout-viewport CSS. Browser and OS
combinations control keyboard resize behavior and do not guarantee a complete or consistently
ordered final event sequence. The application could therefore retain a height or origin after the
browser had recovered. Additional policy states changed which sequence failed but could not prove
that stored geometry was current.

### Fix
- Deleted the viewport geometry policy, browser-event controller, timers, focus coupling, and CSS
  height/origin variables.
- Replaced them with one browser-owned fixed `inset: 0` CSS grid containing an intrinsic header,
  `minmax(0, 1fr)` workspace, and intrinsic footer.
- Made the workspace and its panes the only scroll owners.
- Requested `interactive-widget=overlays-content` as progressive enhancement without depending on
  browser support.

### Regression Protection
- Tests: `src/components/student/__tests__/StudentApp.test.tsx`,
  `src/components/student/__tests__/StudentViewportCss.test.ts`,
  `src/components/student/__tests__/examPageZoomGuard.test.ts`,
  `e2e/student-ipad-layout.spec.ts`
- Diagnostics: synthetic Visual Viewport, focus, blur, resize, and scroll events verify that no
  shell geometry is written.
- Rules/Docs updated: `docs/ux-invariants.md`,
  `docs/superpowers/specs/2026-07-18-student-css-viewport-shell-design.md`

### Invariant
The browser layout engine is the sole shell-geometry authority. The application cannot persist stale
shell geometry because it stores no viewport height, origin, or keyboard visibility. Temporary
keyboard-time resizing on historical browsers remains browser-controlled.

---

## 2026-07-18: Keyboard Dismissal Coupled Focus, Height, and Visual Origin

### Symptom
After the earlier persistent-height fix, two iPad dismissal paths still displaced the exam shell.
Tapping outside an answer could hide the header and leave the footer above white space. Using the
keyboard-hide button left the header visible but could still leave the footer above the physical
bottom. Both states persisted without another viewport interaction.

### Scope
The student exam viewport policy, its browser event adapter, and StudentApp viewport regression
tests. Answer entry, autosave, submission, timers, integrity, audit, and grading were unaffected.

### Root Cause
The policy still treated focus and keyboard visibility as the same lifecycle and stored height plus
origin in one trusted rectangle. On tap-outside, `focusout` restored the old baseline origin while
the browser's Visual Viewport remained panned, clipping the header and displacing the footer. The
keyboard-hide button could retain input focus, so recovered growth was ignored and the footer kept
the smaller pre-keyboard shell height. Integration testing also exposed that editable focus during
the initial reused-tab recovery window allowed bootstrap to accept the keyboard-shrunken height.

### Fix
- Separated the trusted closed shell height, live native-scale offset, editable-focus state, and
  keyboard phase in the pure viewport policy.
- Followed live offset throughout keyboard occlusion and recovery instead of restoring a baseline
  origin.
- Accepted recovered growth while focus remains and allowed a later shrink to re-enter keyboard
  occlusion without requiring another focus event.
- Preserved the closed height when editable focus arrives during bootstrap.
- Added optional Virtual Keyboard intersection geometry as a capability signal while ensuring a
  zero intersection cannot authorize a smaller stale height.

### Regression Protection
- Tests: `src/components/student/__tests__/studentExamViewportPolicy.test.ts`,
  `src/components/student/__tests__/studentExamViewportController.test.ts`,
  `src/components/student/__tests__/StudentApp.test.tsx`
- Diagnostics: pure policy sequences reproduce both `900/0 -> 560/180 -> blur -> 900/180 -> 900/0`
  and retained-focus `900/0 -> 560/180 -> 950/180 -> 950/0` without a physical keyboard.
- Rules/Docs updated: `docs/ux-invariants.md`,
  `docs/superpowers/specs/2026-07-18-student-viewport-occlusion-design.md`

### Invariant
Closed shell height, live visual origin, editable focus, and keyboard occlusion have independent
trust rules. Focus may arm shrink protection but cannot decide whether the keyboard is open, and a
stored height may never reset a newer valid origin.

---

## 2026-07-18: Keyboard Dismissal Leaves Footer Above Persistent White Space

### Symptom
After a student typed an answer and dismissed the software keyboard, the footer returned but stayed
above the physical bottom of the browser. A large white gap remained below it indefinitely. Opening
or pasting the exam URL into a reused tab had already been fixed and continued to recover correctly.

### Scope
The active student exam viewport policy, its browser event adapter, viewport meta policy, and shell
CSS. Answer entry, autosave, submission, timers, integrity, and audit flows were unaffected.

### Root Cause
The viewport controller correctly protected a trusted `900px` shell while the keyboard reported
`560px`, but editable focusout opened a recovery window that allowed downward rebasing. A persistent
post-keyboard `820px` VisualViewport sample was therefore committed as the new full height. The
existing controller and StudentApp tests explicitly expected `820px`, so they encoded the failure.
Ending the recovery timer also removed protection, allowing later stale resize/scroll events to
recreate the gap.

### Fix
- Extracted a pure, capability-based viewport state machine with bootstrapping, stable,
  keyboard-active, keyboard-recovery, pinch, and topology states.
- Editable focus captures the last trusted full rectangle. Focusout restores it immediately, and
  smaller samples remain rejected after the bounded observation loop ends.
- A native-scale rectangle at or above the baseline clears keyboard recovery; initial/reused-tab and
  independently evidenced topology recovery remain bidirectional.
- Installed the controller for every active exam without Apple/tablet/browser-version branching.
- Added validated VisualViewport/layout fallbacks, optional VirtualKeyboard geometry events,
  explicit `interactive-widget=resizes-visual`, and ordered `100vh`/`100dvh` CSS fallbacks.

### Regression Protection
- Tests: `src/components/student/__tests__/studentExamViewportPolicy.test.ts`,
  `src/components/student/__tests__/studentExamViewportController.test.ts`,
  `src/components/student/__tests__/StudentApp.test.tsx`,
  `src/components/student/__tests__/examPageZoomGuard.test.ts`,
  `src/components/student/__tests__/StudentViewportCss.test.ts`
- Diagnostics: lifecycle transitions are isolated in the pure policy and can be reproduced without
  a physical software keyboard.
- Rules/Docs updated: `docs/ux-invariants.md`, `docs/failure-cases.md`

### Invariant
Focusout is an observation trigger, never permission to shrink the trusted exam viewport. A smaller
post-keyboard sample cannot move the footer upward unless an independent display-topology transition
explicitly invalidates the baseline.

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

## 2026-07-13: Translation Deterrence Must Preserve Student Selection

### Failure case
Browser translation markers can be removed after exam startup, and iOS selected-text Translate is
outside the page's complete control. Broad event blocking or callout suppression would also break
the student-owned selection/highlight workflow and answer controls.

### Invariant
During an enabled exam, the student translation guard self-heals its document markers and records
cooldown-deduplicated medium violations through the existing audit flow. Callout suppression is
limited to active `[data-student-highlightable="true"]` content, preserves text selection, and does
not cover answer controls. This is best-effort deterrence on unmanaged devices, not hard blocking.

### Regression protection
- `src/components/student/providers/__tests__/StudentProctoringProvider.test.tsx`
- `src/components/student/__tests__/StudentTranslationGuardCss.test.ts`
- `src/features/builder/components/__tests__/SecurityTab.test.tsx`
- `src/components/admin/__tests__/ExamSettingsDrawer.test.tsx`

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
Sub-block grouping (`sentenceBlankGroupKey`, `tableCellGroupKey`) and `scoreGroupId` dedup follow the count model exactly. Multi-select is emitted as one unit whose `slotCount` derives from the number of options marked correct.

### Regression Protection
- `src/utils/__tests__/examTextExport.drift.test.ts` — drift guard: for a fixture exercising all 14 block types, the number of exported `Q*` answer-key rows must equal the number of units from `enumerateBlockQuestionUnits`. Mutation-verified: skipping `SINGLE_MCQ` units makes the test fail (RED).
- `src/utils/__tests__/examTextExport.test.ts` — "exports every SINGLE_MCQ sub-question" and "does not drop SINGLE_MCQ sub-questions across a realistic 40-question exam".
- `src/utils/__tests__/examUtils.questionCounting.test.ts` — count equals source-of-truth enumeration across all block types.

### Invariant
The TXT export and `getBlockQuestionCount`/`getExamStatsFromState` must derive question cardinality from the same `enumerateBlockQuestionUnits` enumeration. Any new question-bearing array on a block must be added there once; both count and export follow automatically. Do not re-introduce block-specific count vs. render logic in two places.

### Note (separate, pre-existing, out of scope)
`MULTI_MCQ` is rendered as one question spanning slots (e.g. `Q1-2`) while `getBlockQuestionCount` returns the number of options marked correct. This makes the canonical "total questions" count larger than the number of answer-key lines for multi-select blocks by design (one question, multiple slots). Do not "fix" by inflating the export; reconcile the counting model deliberately if the discrepancy becomes user-visible.

---

## 2026-07-13: Cursor-Following Highlight Controls Disrupt iPad Selection

### Symptom
On iPad, selecting passage or question text caused the highlight palette to appear beside the current range. The new interactive element could overlap native selection handles, move as the handles were adjusted, and collapse the selection before the student completed the gesture.

### Root Cause
The old flow reacted to intermediate `selectionchange` snapshots and coupled selection capture to cursor-relative toolbar coordinates. iPad may emit overlapping pointer, mouse, and touch completion events for one gesture, so a toolbar-first mutation path also risked duplicate commands.

### Fix
- Move Highlight, five accessible color choices, and Erase into a persistent header split control.
- Apply the active command only after selection completion; keep it active for repeated use.
- Deduplicate synchronous pointer/mouse/touch compatibility events and clear native selection only after a successful enabled-mode command.
- Keep persisted rendering independent from whether the tool is active.

### Regression Protection
- `src/components/student/__tests__/StudentHeaderHighlightHint.test.tsx`
- `src/components/student/__tests__/highlightPersistence.test.tsx`
- `src/components/student/highlight/__tests__/selectionObserver.test.ts`

### Invariant
Do not restore cursor-following highlight UI or mutate ranges from intermediate drag snapshots. Tool-off selection must remain native and non-mutating.

## Student highlight palette hidden by preview controls (2026-07-15)

**Symptom:** In the Reading preview, the fixed preview-section selector covered the first highlight color and made the palette appear to start at Pink.

**Root cause:** The student highlight palette was portaled to the document body but positioned against the viewport edge with a lower stacking layer than builder preview chrome. It was not tethered to its disclosure trigger.

**Policy:** Student header disclosure panels must remain portaled to avoid header overflow clipping, position from their owning trigger with viewport-edge clamping, and render above non-modal preview chrome. Positioning must be recomputed while open when the viewport changes.

**Regression coverage:** `src/components/student/__tests__/StudentHeaderHighlightHint.test.tsx` and `e2e/student-ipad-layout.spec.ts`.

---

## 2026-07-18: Fixed Floating Footer Overlaps iPad Safari Content

### Symptom

On iPad Safari/WebKit tabs with visible browser bars, the floating footer covered the final passage,
question input, or Writing editor region. Safe-area offsets and per-pane bottom reserves changed the
size of the gap but did not make the footer consistently align with the visible screen.

### Root Cause

Both `.student-exam-shell` and `.student-exam-footer` were fixed against the layout viewport, while
iPad browser bars exposed a smaller visual viewport. The footer was deliberately removed from
normal flow, and Reading, Listening, and Writing compensated with synthetic bottom padding. That
overlay architecture could not guarantee content/footer adjacency. Pane transforms were inspected
but were not footer ancestors, so they were not the containing-block cause.

### Fix

The shell now uses a normal-flow three-row grid with `100vh`, `100svh`, and `100dvh` height
fallbacks. The footer is a `position: relative` row with safe-area padding inside its surface.
Overlay offsets and per-pane footer reserves were removed. Its inset white-pill appearance is
preserved with normal-flow margins, radius, and shadow; those visual styles do not participate in
viewport positioning. The viewport metadata uses `viewport-fit=cover` without forcing
`interactive-widget=overlays-content`.

Browsers with `100dvh` use CSS alone. Older engines receive a lifecycle-scoped
`--student-visual-viewport-height` value and resize/orientation updates; cleanup restores the prior
document classes, viewport metadata, and custom property exactly.

### Invariant

The footer must remain in normal flow and must consume real layout space. Do not reintroduce fixed,
sticky, translated, or bottom-offset footer positioning, and do not compensate for it inside pane
scroll owners. Safe-area values belong in padding, not footer coordinates.

### Regression Protection

- `src/components/student/__tests__/StudentViewportCss.test.ts`
- `src/components/student/__tests__/StudentFooterInFlowLayout.test.ts`
- `src/components/student/__tests__/StudentFooterRepresentative.test.tsx`
- `src/components/student/__tests__/StudentWriting.a11y.test.tsx`
- `e2e/student-ipad-layout.spec.ts`

---

## 2026-07-19: Multi-Select Answer Count Drifts Across Builder, Delivery, and Export

### Symptom

A `MULTI_MCQ` block could mark two options correct while storing a different `requiredSelections` value. Builder validation rejected otherwise valid answer keys, the student UI/backend allowed the wrong number of selections, numbering used the wrong slot range, and TXT export displayed the stale count. A malformed empty answer key could also auto-match an unanswered empty set during grading.

### Root cause

Two independently editable fields described one rule: `options[].isCorrect` owned the grading key, while `requiredSelections` owned authoring validation, student limits, backend delivery constraints, and numbering. Deleting or unchecking options did not consistently synchronize them.

The student answer resolver also could not distinguish a multi-select set from a positional
multi-slot array. When an unselection produced a shorter array, the resolver preserved trailing
positions and could turn `['A', 'B'] -> ['B']` into `['B', 'B']`. Repeating this accumulated duplicate
IDs, made the displayed selection count reach its limit, and disabled unselected options.

### Fix

- `src/utils/multiSelectMcq.ts` is the frontend owner for marked IDs/count, runtime selection limits, safe correctness edits, and safe option removal.
- Builder correctness edits keep at least one marked option and synchronize `requiredSelections` as a compatibility projection.
- Student UI, canonical numbering, adapter descriptors, text export, and backend delivery derive the count from marked options.
- Submitted answers remain the real option-ID array; grading and grading-PDF source rows map those IDs without mutating them.
- Multi-select changes declare whole-array replacement intent so unselection removes IDs instead of
  entering the positional-slot merge path used by completion questions.
- Empty marked-answer sets are publish-invalid and cannot auto-grade as correct in either TypeScript review logic or Rust grading.
- Frontend review grading compares submitted option IDs exactly, matching the Rust grader; answer-text case and punctuation normalization never applies to IDs.
- Authoritative backend publish validation enforces the same non-empty marked-answer invariant, requires usable option IDs, derives its slot count from the marked options, and ignores stale `requiredSelections` values.

### Regression protection

- `src/utils/__tests__/multiSelectMcq.test.ts`
- `src/components/blocks/__tests__/MultiSelectMCQBlock.test.tsx`
- `src/components/student/__tests__/StudentQuestionExperience.test.tsx`
- `src/utils/__tests__/examUtils.questionCounting.test.ts`
- `src/services/__tests__/examAdapterService.studentQuestions.test.ts`
- `src/components/admin/__tests__/gradingAnswerUtils.test.ts`
- `src/components/admin/__tests__/gradingReviewUtils.test.ts`
- `src/utils/__tests__/examTextExport.drift.test.ts`
- Backend delivery/grading unit tests named `*multi_mcq*`

### Invariant

For `MULTI_MCQ`, `options[].isCorrect` is authoritative. At least one option must be marked correct. Never use `requiredSelections` to decide student limits, completion slots, correct answers, or export content; it exists only for serialized backward compatibility.

A multi-select answer array is an unordered replacement set of option IDs, not a positional slot
array. Shorter set updates must replace the prior value; only explicitly slot-scoped mutations may
preserve sibling array positions.

---

## 2026-08-05: Submission Response Lost After Server Success → Retry Hash Drift → Idempotency Conflict Loop

### Symptom
A student's first submit request reached the backend and was accepted, but the response was lost
(flaky network, proxy timeout). The client recorded a durable "pending submission" and kept
retrying. If any later mutation-batch response advanced the attempt's revision/sequence counters
before the first retry fired, the retry carried the drifted fields. The backend's idempotency hash
(sha256 over the ENTIRE serialized request, keyed by `Idempotency-Key: student-submit-<attemptId>`)
no longer matched the stored original, so every retry returned 409 CONFLICT and the client rethrew
into the same loop forever. The student sat on the "Submission pending" panel while the submission
was actually safe on the server.

### Scope
Student submit flow (`BackendStudentAttemptRepository.submitAttempt`), the durable pending
submission record (`PendingStudentSubmission`), and the provider retry loop
(`StudentAttemptProvider.scheduleBackgroundSubmitRetry`). Backend idempotency behavior in
`backend/crates/application/src/delivery/mod.rs` is unchanged — it is correct.

### Root Cause
The retry rebuilt the payload from the LIVE attempt (current revision, current watermark-derived
`clientFinalSeq`, current `serverAcceptedThroughSeq`, freshly computed hash). Only the answer
snapshot was frozen. The backend idempotency hash covers all of these fields, so any drift between
first request and retry produced a permanent 409 loop.

### Fix
- Capture the payload-determining fields of the failed request at first-failure time
  (`lastSeenRevision`, `clientFinalSeq`, `serverAcceptedThroughSeq`, `finalClientSnapshotHash`)
  as `FrozenSubmitPayload`, attach them to the thrown error, and persist them on
  `PendingStudentSubmission.frozenPayload`.
- Retries rebuild the serialized request from the frozen values, guaranteeing
  `hash(retry) == hash(first request)` byte-for-byte.
- Belt-and-braces: any 409 (non-`FINAL_FLUSH_REQUIRED`) during submit triggers a fetch of the
  authoritative session; if the server confirms the submission (post-exam + submittedAt), the
  client converges to confirmed instead of rethrowing into the loop.
- The retry loop now hard-stops at the record's absolute `expiresAt` (it previously restarted a
  fresh 1-hour window per reload).
- Legacy records without `frozenPayload` are accepted (never silently dropped) and self-heal on
  their next failed attempt.

### Regression Protection
- Tests: `src/services/__tests__/studentAttemptRepository.test.ts` (drift-freeze replay asserts
  the retry body equals the first body; conflict-converge path),
  `src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx` (drift scenario:
  response lost, revision advances, retry sends the ORIGINAL frozen payload fields).
- Diagnostics: `student_submit_conflict_converged_total` metric when a conflict converges.

### Invariant
The retry of an unconfirmed submission must be byte-identical to the original request: the frozen
payload-determining fields (`revision`/`lastSeenRevision`, `serverAcceptedThroughSeq`,
`clientFinalSeq`, `finalClientSnapshotHash`) plus the frozen final snapshot are the ONLY source
for a retry payload — never the live attempt's current counters. An idempotency CONFLICT on retry
must be treated as "already submitted" (converge), never as a retryable failure.

---

## 2026-08-05: Flushed Mutations Accepted While Submit In Flight → Frozen-Payload BASE_REVISION_MISMATCH Loop → Converge-and-Resubmit-With-Live-Fields Recovery (I1 residual)

### Symptom
The original I1 fix froze the payload-determining fields of a failed submit and replaying them
byte-for-byte was safe — UNLESS the server's state advanced past the frozen values while the
submit request itself never reached the server. Concretely: the submit request fails before
arriving (flaky network), but the mutation-batch flush that was in flight alongside it IS
accepted, bumping the server's revision/`server_accepted_through_seq`. Every retry then replays
the frozen (now stale) revision and the server rejects it with 409 `BASE_REVISION_MISMATCH`.
`tryConvergeAlreadySubmitted` fetched the authoritative session, correctly found the attempt NOT
submitted, and rethrew — so the retry loop burned the entire 60-minute window on a payload that
could never be accepted, and the student sat on the pending panel until reload (which purged the
record and recovered). The loop case was also unobservable: only the converged conflict path had
a metric.

### Scope
`BackendStudentAttemptRepository.submitAttempt` (409-disproved branch),
`PendingStudentSubmission.frozenPayload` lifecycle in `StudentAttemptProvider`, and the
`submitPayload`/`invalidatesFrozenPayload` error carrier.

### Root Cause
"Frozen payload rejected" and "submission already accepted" were conflated. A 409 on a frozen
replay with a converge fetch that DISPROVES submission means the frozen payload is DEAD, not the
submission — the correct recovery is to abandon the frozen values and resubmit with the current
attempt's live fields, not to rethrow the 409 into the loop.

### Fix
- On a 409 of the conflict class (`BASE_REVISION_MISMATCH` / `FINAL_PAYLOAD_HASH_MISMATCH`, i.e.
  not `FINAL_FLUSH_REQUIRED`) where the converge fetch disproves submission: emit
  `student_submit_conflict_not_converged_total` and resubmit ONCE with LIVE fields (fresh
  revision/seq/hash from the current attempt state — the server-accepted mutation state is
  preserved, with no revision regression; note the final answer content still comes from the
  snapshot locked at submit time, not from keystrokes typed after the submit capture).
- If the live resubmit also fails, its error carries `invalidatesFrozenPayload: true`; the
  provider then REPLACES the stale `frozenPayload` on the durable record with the live carrier
  values (or drops it entirely) instead of keeping the dead frozen payload.
- The true-I1 path is unchanged: when the converge fetch confirms submission, the client still
  converges; a live resubmit that itself 409s is converge-checked too.

### Regression Protection
- Tests: `src/services/__tests__/studentAttemptRepository.test.ts` (409-disproved → live-fields
  resubmit asserts the third POST carries LIVE revision/seq + the not-converged metric;
  live-resubmit failure marks `invalidatesFrozenPayload` with the live carrier),
  `src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx` (provider replaces
  the stale frozen payload after an invalidation-marked error and the next retry passes the live
  values).
- Diagnostics: `student_submit_conflict_not_converged_total` (per attempt, reason, statusCode).

### Invariant
A frozen replay 409 whose converge fetch DISPROVES submission is a dead-frozen-payload signal,
never a retryable failure and never "already submitted". The durable record must abandon the
stale frozen payload (replace with the fresh carrier values or drop it) so the next retry
resubmits with live fields. Converge-on-conflict remains authoritative when the fetch CONFIRMS
submission.
