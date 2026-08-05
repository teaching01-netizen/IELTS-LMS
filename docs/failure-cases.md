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
  the attempt revision exactly once (`revision = revision + 1`, `delivery/mod.rs:931`); only
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

---

## 2026-08-05: Duplicate-Key Detection Checks Only Numeric 1062 — Dead Branch Under sqlx SQLSTATE Codes

### Symptom
Concurrent precheck requests with the same idempotency key could surface `500 DATABASE_ERROR`
(duplicate entry) instead of an idempotent replay or clean `409`; the same failure mode
threatens duplicate runtime/registration rows.

### Scope
Precheck flow (`backend/crates/application/src/delivery/mod.rs` — `persist_precheck`,
`get_or_create_attempt`; `backend/crates/infrastructure/src/idempotency.rs` —
`store_or_replay`). Pre-existing identical pattern in
`backend/crates/application/src/scheduling.rs` (`is_mysql_duplicate_key`, ~line 1181).

### Root Cause
This repo's sqlx (sqlx-mysql 0.7.4) returns the SQLSTATE (`"23000"`) from
`DatabaseError::code()`, not the numeric MySQL code (`"1062"`). The scheduling helper checks
only `"1062"`, so its duplicate branch never fires and its two call sites (`start_runtime`,
`register_student`) fall through to a 500 instead of Conflict/idempotent adoption.

### Fix
Commit `777a3c2` added two helpers that accept both codes: `is_duplicate_key` in
`delivery/mod.rs` (~line 2003) and `idempotency.rs` (~line 266).

RESOLVED (B-3): commit `8658766` fixed the scheduling.rs helper to accept both
`"23000"` and `"1062"`, so `start_runtime` duplicate-key races now resolve to a
clean 409 Conflict and `register_student` races adopt the existing registration
idempotently (200). Regression test:
`repeated_start_returns_conflict_without_duplicate_sections`
(`backend/tests/contracts/scheduling_contract.rs`). Centralizing the helper in
infrastructure remains a future cleanup.

### Regression Protection
- Tests: `backend/tests/contracts/student_contract.rs`
  (`precheck_concurrent_identical_requests_yield_one_logical_result`).

### Invariant
Unique-constraint races must resolve to the idempotent replay/Conflict outcome, never a 500.

---

## 2026-08-05: Section Transition Grace and Structural-Completion Finalization (BEX-022/023)

### Behavior (not a bug — documented contract)
1. **Section-transition grace:** after a proctor `end-section-now` advance, mutations for the
   just-completed section stay accepted for `final_submit_grace_seconds` (default 300s, config
   `FINAL_SUBMIT_GRACE_SECONDS`) after the section's `actual_end_at`. Beyond the window the batch
   route rejects them with `409 CONFLICT` / `details.reason SECTION_MISMATCH`
   (`enforce_section_membership`, `backend/crates/application/src/delivery/mod.rs` ~3547).
   Rationale: a student's in-flight answer flush must not hard-fail on the last seconds of a
   section, but an open-ended window would let stale answers leak into later sections.
2. **Structural completion:** student attempts are auto-finalized (auto-submit) ONLY inside the
   same transaction that completes the runtime AND all section rows (`end-section-now` last
   section, `end_runtime`, `complete_exam`). A `completed` runtime row whose sections are still
   incomplete must never finalize pending attempts; the `complete-exam`/`end_runtime` early-return
   on already-completed status performs no finalization.

### Regression Protection
- `backend/tests/contracts/student_contract.rs`
  (`late_mutation_from_old_section_accepted_in_grace_then_section_mismatch_after_backdate`).
- `backend/tests/contracts/scheduling_contract.rs`
  (`proctor_end_section_now_on_last_section_auto_submits_pending_attempts`,
  `transient_completed_runtime_does_not_finalize_pending_attempts`).

### Invariant
A pending attempt must never be finalized by an incomplete (transient) `completed` runtime state;
old-section mutations must be rejected with SECTION_MISMATCH once the grace window closes.

## 2026-08-05: Mutation Clear Commands Persist Explicit JSON Nulls; Legacy Batch Denies Unknown Top-Level Fields (BEX-030/031)

### Behavior (documented contract, not a bug)
1. **Clear == JSON null, not key removal.** Every clear command
   (`ClearScalar`, `ClearChoice`, `ClearSlot`, `ClearEssayText`) writes an explicit
   `null` into the persisted JSON (`set_value` / `set_array_slot_answer`,
   `backend/crates/application/src/delivery/mod.rs` ~3511-3545): e.g. after
   `ClearScalar q1`, `student_attempts.answers` is `{"q1": null}` — the key stays
   present. The apply arms validate `Value::Null` against the question constraint
   before persisting. This is distinct from an empty string: `SetScalar ""` stores
   `""`. Do not "fix" clears to remove keys: replays and idempotent dedupe
   (`student_attempt_mutations`) and the base-revision gate assume clears are
   null-writes like any other value.
2. **Legacy batch requests deny unknown top-level fields.** Both the strict
   (`ApiMutationBatchRequest`) and the legacy fallback
   (`ApiLegacyMutationBatchRequest`, `backend/crates/api/src/routes/student.rs`
   ~272-288) carry `deny_unknown_fields`. A payload with an unknown top-level
   field fails both parses and returns `422 VALIDATION_ERROR` /
   "Invalid mutation batch payload: ..." — the legacy path must never silently
   accept unknown top-level fields even though it also carries legacy keys
   (`studentKey`, `clientSessionId`). Legacy per-command allowlist unchanged:
   only SetSlot/ClearSlot/SetScalar/ClearScalar/SetChoice/ClearChoice/
   SetEssayText/ClearEssayText; anything else (e.g. `position`, `answer`, `flag`)
   → 422 "Legacy mutation type `<type>` is not allowed for mutation batch."
   (The deny_unknown_fields attribute shipped earlier in 3f33626; B-5 pinned it
   with route-level regression tests.)

### Regression Protection
- Tests: `backend/tests/contracts/student_contract.rs`
  (`mutation_batch_supported_command_matrix_objective_questions`,
  `mutation_batch_supported_command_matrix_writing_unicode`,
  `mutation_batch_legacy_envelope_allowlist_and_rejects`,
  `mutation_batch_rejects_unknown_top_level_fields_and_malformed_commands`).

### Invariant
Student-visible "saved" state must match persisted reality byte-for-byte: clears
round-trip as explicit JSON nulls, empty strings stay empty strings, and unknown
top-level fields are rejected on every accepted batch path.

## 2026-08-05: Mutation-Batch Idempotent Replay Returned 409 Hash-Mismatch for Identical Requests (BEX-033)

### Symptom
Retrying an identical mutation batch (same body bytes, same `Idempotency-Key`) after a timeout returned `409 CONFLICT` / "Idempotency-Key does not match the original request." instead of the cached 200 response, so clients could never confirm whether their batch had been applied. Pinned by the then-passing test `mutation_batch_rejects_replayed_idempotency_key_and_hash_mismatch` (asserting the buggy 409).

### Scope
`POST /api/v1/student/sessions/{schedule_id}/mutations:batch` idempotency path (`crates/application/src/delivery/mod.rs` `apply_mutation_batch`; `crates/api/src/routes/student.rs` `parse_mutation_batch_request`).

### Root Cause
The route stamps `timestamp: Utc::now()` onto every `MutationEnvelope` while parsing the HTTP payload (student.rs ~436). The idempotency request hash was computed by serializing the whole `StudentMutationBatchRequest` (`idempotency_request_hash`), so two byte-identical HTTP bodies produced different hashes; the replay lookup found the stored row, compared hashes, and misclassified the replay as a hash mismatch → 409. The base-revision gate and in-batch dedupe were never reached.

### Fix
`apply_mutation_batch` now hashes with `batch_idempotency_request_hash`: it serializes the request to a `Value` and strips the server-stamped `timestamp` from each envelope before hashing. serde_json maps are key-ordered, so the serialization is stable across replays. The timestamp is a server reception artifact (persisted as `client_timestamp`), not part of the client-authored idempotency identity; all client-authored fields (envelope id/seq/command/base_revision, request attempt/student/session) still feed the hash, so a same-key batch with different content still 409s. Hash-mismatch 409 and per-mutation dedupe scope are unchanged. Precheck/submit hashing is untouched (their requests carry no server-stamped volatile fields).

Note: idempotency rows stored before this fix (timestamp-bearing hash) will not match the new hash until they expire (72h TTL); the previous behavior was that replays always 409'd, so this only improves matters.

### Regression Protection
- Tests: `backend/tests/contracts/student_contract.rs`
  (`mutation_batch_idempotency_replay_returns_stable_response_and_hash_mismatch_conflicts`,
  `mutation_batch_same_key_identical_batch_applies_once_and_retry_after_timeout_does_not_duplicate`).
- The rewritten test replaces `mutation_batch_rejects_replayed_idempotency_key_and_hash_mismatch`, which pinned the buggy 409.

### Invariant
An identical retry of a mutation batch (same bytes, same idempotency key) must return the cached 200 response without re-applying; a same-key batch with different content must 409; per-session mutation dedupe scope `(attempt_id, client_session_id, client_mutation_id)` is contract-pinned and must not be widened.

## 2026-08-05: Cross-Session Duplicate Mutation Ids Are Owned, Not Deduped (BEX-033 interpretation)

### Behavior (documented contract, not a bug)
The plan bullet "duplicate mutation in another client session → no duplicate application" is enforced by ownership, not by cross-session dedupe:
1. In-batch dedupe is scoped per `(attempt_id, client_session_id, client_mutation_id)` — a duplicate id from another session is NOT skipped.
2. A second session with a stale base revision is rejected atomically by the base-revision gate (BEX-003): `409 BASE_REVISION_MISMATCH` with `latestRevision` / `serverAcceptedThroughSeq` / `activeSessionId`; nothing is applied twice.
3. A second session with a FRESH base is blocked by the physical unique index `(attempt_id, client_mutation_id)` (migration 0017): the INSERT fails with a duplicate-key error → atomic `500 DATABASE_ERROR`, no row, no partial state.

Do not "fix" the 500 into a dedupe/skip: that would require widening dedupe scope (contract-pinned) or silently dropping a write the client believes is new.

### Regression Protection
- Tests: `backend/tests/contracts/student_contract.rs`
  (`mutation_batch_duplicate_mutation_id_from_other_client_session_is_not_applied_twice`).

### Invariant
A mutation id may be applied at most once per attempt, cross-session included; the rejection mechanisms are the base-revision gate (stale base) and the unique index (fresh base); batch apply stays all-or-nothing.

## 2026-08-05: Mutation Batch Is Fully Transactional (BEX-034)

### Behavior (documented contract, verified)
A database failure mid-batch (e.g. `client_mutation_id` exceeding the `VARCHAR(255)` column width → data-too-long on TiDB strict mode) aborts the whole transaction: no partial answers snapshot, no partial revision increment, no partial mutation row, and no cached idempotent response. The client can then retry the complete batch (same idempotency key) and it applies fully: both mutations present, revision advanced exactly once, watermark advanced to the full seq range.

### Regression Protection
- Tests: `backend/tests/contracts/student_contract.rs`
  (`mutation_batch_mid_batch_database_failure_rolls_back_atomically_and_retry_applies_fully`).

### Invariant
`apply_mutation_batch` runs as one transaction (begin → per-mutation INSERTs → attempt UPDATE → audit log → idempotent-response store → commit); any failure must roll back everything, and a retry of the complete batch must be safe.

## 2026-08-05: Per-Slot Sub-Ids and Question-Type Round Trip Shapes (BEX-035)

### Behavior (documented contract, verified)
Full question-type round trip pins (all in `mutation_batch_*`/`bex035_question_type_round_trip_matrix`):

1. **Slots/labels are block-level arrays, sub-ids are section-only.** `SENTENCE_COMPLETION`, `NOTE_COMPLETION`, `DIAGRAM_LABELING`, `FLOW_CHART`, `TABLE_COMPLETION` register the VALUE constraint (`ArrayText`/`EnumArray`) at the BLOCK id and register each child key as `"{parent_id}:{child_id}"` (raw string concat) in the section map only. So the only supported write is `SetSlot`/`ClearSlot` against the block id with `slotIndex`; `SetScalar` against a child sub-id is accepted-but-ignored (200, `appliedMutationCount: 0`, answers unchanged — the mutation row is still stored, so **the revision still advances +1**). The seeded `l-blank-2` blank ids already include the question prefix (`"l-blank-2:b1"`), so the REGISTERED child key is the double-prefixed `"l-blank-2:l-blank-2:b1"`; the grading `questionId` for per-blank results uses the same double-prefixed key.
2. **MULTI_MCQ array values ride `SetChoice`**, not `SetSlot`: the new-style API restricts `SetScalar.value` to `String` (`ApiMutationCommandPayload::SetScalar { value: String }`), while `SetChoice.value` is `serde_json::Value`, and `validate_answer_value`'s `MultiChoice` arm accepts arrays. Stored as sent (order preserved); grading compares as an order-insensitive set (`ExactSet`).
3. **`q1`/`r1` in the default seed are legacy-minimal TFNG questions** (`{"id": ...}` only) → constraint is `Text`, NOT the strict `{T,F,NG}` Enum. Strict TFNG validation only applies when the question object carries metadata (statement/mode) — the BEX-035 seed adds `l-tfng-1` for the strict pin. `"True"`/`"t"` are rejected at mutation with `422 VALIDATION_ERROR` "Answer value is not valid for this question."; they never reach grading.
4. **Auto-grading is NOT projected synchronously at submit.** `submit_attempt` only writes `final_submission`; `section_submissions.auto_grading_results` rows appear only after the projection cycle (`GradingService::run_projection_cycle`, the worker path) runs. Tests invoking grading must run that cycle themselves.
5. **Text grading is whitespace-insensitive but case-SENSITIVE.** `normalize_exact_text` collapses/trims whitespace only; a value `"  diagram  "` grades correct against answer key `"diagram"`, while a case variant does not — pinned at the grading leg by the BEX-035 test (`"Petrol"` stored byte-exact against key `"petrol"` grades wrong). The only case-fold in grading is the shared-sentence path: a `SENTENCE_COMPLETION` question with `acceptAnyAnswerKey: true` + `sharedAcceptedAnswers` normalizes with case-fold + punctuation collapse, so `"Apple"` grades correct against `"apple"`.
6. **Attempt phase pins**: the attempt phase is computed at creation from runtime status; `submit` requires phase `exam`. The runtime gate row only exists after the proctor-side `StartRuntime` command (a bare `UPDATE exam_session_runtimes` is a silent no-op until that row exists), so tests that submit must start the runtime first and only then bootstrap.

### Regression Protection
- Tests: `backend/tests/contracts/student_contract.rs` (`bex035_question_type_round_trip_matrix`).
- Grading normalization source: `backend/crates/application/src/grading/mod.rs`
  (`normalize_exact_text` ~3309, `normalize_shared_sentence_answer_with_case` ~3982,
  `index_block` sub-id registration in `backend/crates/application/src/delivery/mod.rs` ~2687).

### Invariant
Round-trip semantic equality holds per type: persisted JSON == hydrated live attempt == `final_submission`; clears are explicit JSON nulls with keys retained (ClearSlot keeps array length); Enum answers are case-strict at mutation; slot values round-trip per blank/label through the block-level array.

## 2026-08-05: Reconnect Replay, Transition Conflicts, Crash Recovery (BEX-040/041/042)

### Behavior (documented contract, verified)
All pinned in `bex040_reconnect_replay_chunked_batches_apply_in_order_without_loss`,
`bex041_replay_across_section_transition_grace_or_structured_conflict`, and
`bex042_crash_recovery_returns_attempt_and_continues_from_watermark`:

1. **Attempt revision starts at 0 after bootstrap.** `get_or_create_attempt` + precheck/bootstrap use `update_attempt_preserving_revision`, so the first accepted batch moves the attempt from revision 0 to 1. Tests must compute bases/expected revisions relative to the bootstrap response (`base + n`), never assume 1.
2. **Individual attempt pause AND resume each bump the attempt revision exactly once** (`update_attempt_status` in `crates/application/src/proctoring.rs` runs `revision = revision + 1`). Because the base-revision gate runs BEFORE the proctor gate in `apply_mutation_batch`, a pending mutation composed pre-pause with a stale base yields `409 BASE_REVISION_MISMATCH`, NOT `ATTEMPT_PROCTOR_BLOCKED` — the client must re-base on the post-pause revision to surface the pause reason. Cohort `pause_runtime` does NOT touch the attempt revision (runtime row only).
3. **Pause rejection reasons (empirical, pinned):** runtime `status = 'paused'` (cohort pause) → `409 OBJECTIVE_LOCKED`; attempt `proctor_status = 'paused'` (individual pause) → `409 ATTEMPT_PROCTOR_BLOCKED`. Both carry `error.code == "CONFLICT"` and `error.details.reason`.
4. **Final completion contract:** `end_runtime` auto-submits every pending attempt (`auto_submit_schedule_attempts_in_tx`): `submitted_at = NOW`, phase `post-exam`, `revision + 1`. Within the 300s post-submit grace (`final_submit_grace_seconds`, AppConfig default) new mutations are ACCEPTED with `acceptedInGrace: true` and the objective/section gates bypassed; after the grace window (backdate `student_attempts.submitted_at`) the same replay is `409 ATTEMPT_SUBMITTED` (the submitted-check in `apply_mutation_batch` fires before the objective gate). Never a generic failure.
5. **Post-submit grace recovery fields are persisted but NOT echoed in the response.** `merge_recovery` writes `postSubmitGraceAcceptedAt` / `postSubmitGraceLastAppliedMutationCount` into the DB recovery JSON, but the typed `StudentRecovery` serialization drops unknown keys, so the response `attempt.recovery` never shows them — assert against the DB column.
6. **Precheck resets the recovery watermark on EVERY bootstrap:** `persist_precheck` merges `{pendingMutationCount: 0, syncState: "idle", serverAcceptedThroughSeq: 0}` while preserving `clientSessionId`. After a crash re-bootstrap, `recovery.serverAcceptedThroughSeq` is 0 even though all accepted mutation rows survive (COUNT unchanged) — the client must continue from the last batch RESPONSE watermark, not the recovery blob. Dedupe (identical `client_mutation_id` + type + payload under the same `client_session_id`) short-circuits BEFORE the base-revision gate, so re-sending already-accepted mutations returns 200 with `appliedMutationCount: 0` and the CURRENT watermark, never a 409.
7. **Transition grace = 300s from `actual_end_at` for completed sections** (`load_recently_completed_section_keys_for_grace`: `now <= actual_end_at + final_submit_grace_seconds`); backdating `exam_session_runtime_sections.actual_end_at` past the window makes the same late replay `409 SECTION_MISMATCH` (message names the question id). The post-grace rejection mechanism is pinned identically for timer-expiry (SQL transition) and proctor `end-section-now` paths; in-grace acceptance is pinned for the timer path and for final completion.
8. **Reconnect replay semantics:** server assigns `mutation_seq` per (attempt, client_session) in REQUEST order; within a chunk the last position wins, across chunks the later chunk wins; one revision increment per accepted chunk; a replayed identical chunk after commit returns the current watermark with 0 applied and inserts nothing.

### Regression Protection
- Tests: `backend/tests/contracts/student_contract.rs` (`bex040_*`, `bex041_*`, `bex042_*`).

### Invariant
Student-visible saved state (answers, revision, watermark) must match persisted reality; accepted mutations are never replayed twice nor lost across chunking/crash; expected transition conflicts always surface a structured 409 reason, never a generic failure, and never partial state.

## 2026-08-05: Heartbeat Acknowledgement, Network Transition Idempotency, Violation Identity (BEX-050/051/052)

### Behavior (documented contract, verified)
All pinned in `bex050_ack_heartbeat_returns_no_attempt_and_preserves_revision_and_answers`,
`bex050_full_heartbeat_returns_attempt_and_runtime_hydration`,
`bex050_heartbeat_returns_refreshed_credential_when_near_expiry`,
`bex051_network_transitions_update_integrity_and_are_idempotent_under_retry`,
`bex052_violation_delivery_is_idempotent_with_single_alert`,
`bex052_invalid_severity_is_ignored_and_blank_violation_id_is_rejected`, and
`bex052_student_cannot_forge_another_attempt_violation`:

1. **Heartbeats never touch revision or answers.** `update_attempt_heartbeat` writes ONLY integrity fields (`lastHeartbeatAt`, `lastHeartbeatStatus`, `lastDisconnectAt` for Disconnect|Lost, `lastReconnectAt` for Reconnect, `clientSessionId`) + `updated_at`, and the presence row UPSERT (COALESCE keeps the FIRST disconnect/reconnect timestamp). Plain Heartbeat events produce no audit row, no event row, no live alert; the `student_attempt_presence.last_heartbeat_status` still goes `ok`.
2. **Ack vs full response shape.** `?responseMode` absent (or `ack`) on a Heartbeat → both `attempt` and `runtime` fields are OMITTED from the response (`skip_serializing_if`, so assert with `.get(...).is_none()`, not `is_null()`). `?responseMode=full` → `attempt` hydrated + `runtime` hydrated via `get_live_session_context` (runtime.currentSectionKey equals the persisted `exam_session_runtimes.current_section_key`; requires a real runtime row — `SchedulingService::apply_runtime_command(StartRuntime)` as in bex041). Disconnect/Reconnect/Lost ALWAYS return the attempt (never ack), but still omit `runtime` unless `?responseMode=full`.
3. **Credential refresh keys on the signed claims `exp`, not the DB row.** `maybe_refresh_attempt_token` refreshes when claims exp is <= 5 minutes out; the refreshed token rotates (`refreshedAttemptCredential.attemptToken != old`), authorizes follow-up requests, and a fresh token yields `refreshedAttemptCredential: null`. Craft near-expiry tokens by re-signing the bootstrap session's `token_id`/`user_id` with a short `exp` (attempt_sessions row keeps its original `expires_at`).
4. **Network transitions produce exactly one logical event.** Each Disconnect/Reconnect/Lost: one `session_audit_logs` row (NETWORK_DISCONNECTED/NETWORK_RECONNECTED/HEARTBEAT_LOST; payload `{eventType, clientTimestamp, payload}`), one `student_heartbeat_events` row, and one `schedule_alert` live update (`network_disconnected`/`network_reconnected`/`heartbeat_lost`). Retry with the identical `(event_type, client_timestamp)` creates NO second row and NO second alert — the route-level publish is gated on the delivery being newly recorded.
5. **Production fix (BEX-051 idempotency):** `student_heartbeat_events` now has a unique index `uq_student_heartbeat_attempt_event_client_ts (attempt_id, event_type, client_timestamp)` (migration `0031_heartbeat_events_idempotency.sql`, which also widens `client_timestamp` to `TIMESTAMP(6) NOT NULL` — safe because the request type makes it non-optional). The insert uses `INSERT IGNORE` and the audit row + live alert fire only when `rows_affected == 1`. **TiDB quirk:** `ON DUPLICATE KEY UPDATE id = id` reports `rows_affected = 1` for a no-change duplicate update, which would defeat gating; `INSERT IGNORE` reports 0 for an ignored duplicate. **Caveat:** `INSERT IGNORE` also swallows non-duplicate insert errors (e.g., an out-of-range timestamp) — the event row, audit row, and alert are all skipped silently while integrity/presence still update; no failure is surfaced anywhere.
6. **Violation identity (BEX-052).** Same `violationId` delivered twice → one `student_violation_events` row, one `violations_snapshot` entry, `revision + 1` total, ONE `schedule_alert` live update; the append-only audit log records each delivery (2 rows — a retry is itself an auditable event). A distinct `violationId` → second record, second snapshot entry, `revision + 1` again, second alert.
7. **Production fix (BEX-052 duplicate alert):** violation insert switched to `INSERT IGNORE` (same TiDB quirk as above); the snapshot merge + revision bump were already gated on `rows_affected == 1`, and the `VIOLATION_DETECTED` alert is now gated on the violation being newly recorded. Side effect pinned by test: a VIOLATION_DETECTED with invalid severity no longer publishes an alert at all (an unrecorded violation must not alert).
8. **Invalid severity is silently ignored:** response 200, audit row appended, but no violation record, no snapshot change, no revision bump, no alert. **Blank/missing `violationId` → 422 `VALIDATION_ERROR` and the whole audit write rolls back** (transaction).
9. **Anti-forgery:** the violation `attempt_id` comes from the attempt-token claims, never the body. A credential for schedule A posting to schedule B's `/audit` path → 403 `FORBIDDEN`; a body claiming another attempt's id is ignored and the violation lands on the caller's attempt.

### Regression Protection
- Tests: `backend/tests/contracts/student_contract.rs` (`bex050_*`, `bex051_*`, `bex052_*`); migrations `0031_heartbeat_events_idempotency.sql`.

### Invariant
One logical audit/live event per network transition and per newly recorded violation — retries must never duplicate rows, snapshot entries, revision bumps, or proctor alerts; heartbeat traffic must never advance the answer revision; violation identity and attribution come from the authenticated principal, not the payload.

## 2026-08-05: Section Submission Gate, Final Snapshot Hash, Submit Idempotency, Post-Submit Grace (BEX-060/061/062/063)

### Behavior (documented contract, verified)

All pinned in `backend/tests/contracts/student_contract.rs` (`bex060_*`, `bex061_*`, `bex062_*`, `bex063_*` — 15 tests, one of which rewrites the old `submit_applies_final_patch_even_if_last_seen_revision_is_behind`). Submit route: `POST /api/v1/student/sessions/{schedule_id}/submit`; service: `submit_attempt` (`backend/crates/application/src/delivery/mod.rs`).

1. **FINAL_FLUSH_REQUIRED matrix (production gate strengthened).** The flush gate now rejects when EITHER (a) no flush metadata at all (`clientFinalSeq`, `serverAcceptedThroughSeq`, `finalAnswerPatch` all absent), OR (b) a sequence gap exists without a final patch — gap = `serverAcceptedThroughSeq < clientFinalSeq`, or `clientFinalSeq > 0` with no server seq. Both return `409 CONFLICT` / `details.reason FINAL_FLUSH_REQUIRED`, no revision bump, no audit row, `final_submission`/`submitted_at` untouched. Consequence: `replayIncomplete: true` is only ever persistable when a final patch reconciles the gap (gap + patch → 200, `finalFlush.replayIncomplete: true`, `finalPatchApplied: true`, patched answers in the snapshot). `(0,0)` seqs with no patch remains accepted (`replayIncomplete: false`). **Gate precedence:** the revision gate still runs BEFORE the flush gate, so a stale revision + gap + no patch returns `BASE_REVISION_MISMATCH` first (client must sync to the current revision; then the gap demands the flush).
2. **A final patch reconciles a stale `lastSeenRevision` (production gate relaxed + existing test rewritten).** The revision gate now fires only when `finalAnswerPatch` is absent. With a patch, a stale `lastSeenRevision` no longer 409s: the patch is the client's authoritative final state and is merged over the persisted answers. The old test pinned the 409; it now pins: stale revision + valid patch → 200, `final_submission.answers` carries the patched value, revision bumped exactly once, exactly one `STUDENT_SUBMIT` audit row. New companion pin: stale revision WITHOUT patch → still `409 BASE_REVISION_MISMATCH` (`details.latestRevision` pinned; `details.activeSessionId` present but unpinned), attempt not sealed.
3. **Production fix (patch persistence):** the submit UPDATE now also writes the FINAL (patch-merged) `answers`/`writing_answers`/`flags` into `student_attempts`. Previously only `final_submission` carried the patched state: the response attempt echoed the stale pre-patch answers (student-visible state diverged from the submitted snapshot) and a post-submit grace mutation would merge from the stale answers and silently resurrect pre-patch values in the rebuilt `final_submission`. The response attempt, the persisted answers, and the grading snapshot are now reconciled.
4. **Canonical final snapshot hash (BEX-061).** The hash covers `sha256(serde_json::to_string({"answers":…, "writingAnswers":…, "flags":…}))` over the FINAL (patch-merged) state. serde_json ships default features (no `preserve_order`) so object keys serialize alphabetically (BTreeMap): the same logical JSON in any key insertion order → byte-identical canonical string → identical hash. Unicode (`café ☕`) and raw HTML essay text (`<p>Hello &amp; welcome</p>`) are hashed as raw UTF-8 bytes — no normalization. Matching hash → 200; a flipped character → `409 CONFLICT` / `details.reason FINAL_PAYLOAD_HASH_MISMATCH`, no revision bump, no `STUDENT_SUBMIT` row, no `final_submission` write. The hash is optional (`finalClientSnapshotHash` absent → skipped).
5. **Submit idempotency matrix (BEX-062).** Missing `Idempotency-Key` header → `422 VALIDATION_ERROR` "Idempotency-Key header is required for submit requests."; empty or whitespace-only value → 422 "Idempotency-Key header cannot be empty." Same key + byte-identical payload → 200 with the cached receipt (identical `submissionId` AND `submittedAt`), one `STUDENT_SUBMIT` audit row, one `idempotency_keys` row. Same key + different payload → `409 CONFLICT` "Idempotency-Key does not match the original request." (checked before any gate, so a sealed attempt stays untouched). NEW key after a successful submission → 200 terminal-attempt replay: identical `submissionId`/`submittedAt`, revision UNCHANGED, no second audit row, `final_submission` byte-identical (no duplicate grading). The `attempt_submission_ledger` table (migration 0022) is vestigial — nothing writes it; the submission ledger is the `STUDENT_SUBMIT` audit row + the `idempotency_keys` row.
6. **Production fix (concurrent submit 500):** two concurrent submits with the SAME key used to race: both passed the pre-tx and in-tx idempotency lookups (TiDB snapshot isolation — the loser's read view predates the winner's commit), and the loser's `INSERT INTO idempotency_keys` hit the PRIMARY KEY → `500 DATABASE_ERROR: Duplicate entry`. `DeliveryService::store_idempotent_response` now catches the duplicate-key error, re-reads the winner's record on a FRESH connection (the in-tx connection still sees the stale snapshot), and classifies by request hash: matching hash → the caller's response is the cached-equivalent terminal receipt (the already-submitted gate rebuilt it from the post-commit attempt) → commit and return 200; differing hash → the same-key/different-payload 409. Pinned outcome: `tokio::join!` of two identical submits → both 200 with the SAME receipt, exactly one `STUDENT_SUBMIT` row, exactly one `idempotency_keys` row, revision bumped exactly once.
7. **Post-submit grace (BEX-063).** Inside the window (`submitted_at + final_submit_grace_seconds`, default 300s): a new mutation is accepted (`acceptedInGrace: true`, `appliedMutationCount: 1`), persisted answers AND `final_submission` are merged (`graceMerge {acceptedInGrace, lastAppliedMutationCount, mergeCount, appliedMutationTotal, firstAcceptedAt, graceWindowSeconds}`; `finalFlush.serverAcceptedThroughSeq` extended), and recovery records `postSubmitGraceAcceptedAt` + `postSubmitGraceLastAppliedMutationCount`. Outside the window (backdate `submitted_at` by 360s): a NEW mutation → `409 CONFLICT` / `details.reason ATTEMPT_SUBMITTED`, no revision bump, no mutation row; replaying an already accepted in-grace mutation → 200 `appliedMutationCount: 0` (the in-batch dedupe short-circuit runs BEFORE the submitted gate). The finalized snapshot retains the grace-accepted value — grading never starts from an older snapshot.

### Empirical notes (things that look like bugs but are pinned behavior)
- `start_runtime` (the SQL UPDATE helper) is a silent NO-OP until the runtime row exists; the row is created only by the real `StartRuntime` command (`SchedulingService::apply_runtime_command` / proctor route). A submit on an attempt whose phase is still `lobby` (no live runtime) is rejected by the PHASE gate (`409` "Attempt cannot be submitted before the exam starts.") — the pre-existing tests `submit_finalizes_the_attempt_idempotently`, `submit_replays_cached_response_for_the_same_idempotency_key`, and `submit_rejects_missing_seq_without_final_patch` pin exactly that phase gate despite their names.
- `SetEssayText` is section-gated pre-submit: with `listening` active it returns `SECTION_MISMATCH`; the HTML-essay hash scenarios therefore carry the essay in `finalAnswerPatch` instead.
- A second student on the same schedule must register with a distinct `wcode` (`schedule_registrations` UNIQUE(schedule_id, wcode)); `StartRuntime` twice on one schedule collides on the UNIQUE runtime row.

### Regression Protection
- Tests: `backend/tests/contracts/student_contract.rs` (`bex060_*`, `bex061_*`, `bex062_*`, `bex063_*`).
- Production: `backend/crates/application/src/delivery/mod.rs` (`submit_attempt` gates + persist; `store_idempotent_response` duplicate-key replay).

### Invariant
The final snapshot is the single source of truth for grading and must always equal the reconciled final state (patch-merged); a submit must be accepted exactly once per attempt (one audit row, one revision bump, one idempotent receipt per key) with concurrent retries converging on the same receipt instead of 500ing; grace-accepted mutations must be reflected in the snapshot grading reads; submitted answers are immutable outside the grace window.

---

## 2026-08-05: Objective grading matrix + submission-to-grading consistency pinned (BEX-070/071)

### Symptom
No contract tests pinned the per-type objective grading rules end-to-end (exact/incorrect/blank/
whitespace/case per question type), the shared-answer pool consumption semantics, or the
submission-to-grading consistency guarantees (immutable snapshot, re-run stability, totals
identity, writing-answer availability). Worse, a real gap existed: an Enum-constrained question
(TFNG/MATCHING/SINGLE_MCQ) whose value reached the final snapshot through the submit
`finalAnswerPatch` path (which is intentionally unvalidated — the patch is client-authoritative
and hash-checked) was graded with whitespace collapse, so `" T "` graded CORRECT for `l-tfng-1`
even though the mutation layer rejects it with 422.

### Scope
`backend/crates/application/src/grading/mod.rs` (objective scoring engine: spec building, exact
matching, shared-pool consumption) and the grading leg of
`backend/tests/contracts/student_contract.rs` (`bex070_*`, `bex071_*`).

### Root Cause
`ObjectiveExpectedAnswer::matches` normalized the student answer with `normalize_exact_text`
(whitespace collapse + trim) for every `TextAnyOf` spec, regardless of whether the question is
Enum-constrained at the mutation layer. The two layers disagreed: the delivery schema rejects
whitespace variants for Enum questions (`validate_answer_value`, `AnswerConstraint::Enum` exact
`allowed.contains(text)`), but grading silently accepted them when a value arrived via the submit
patch path.

### Fix
- `ObjectiveAnswerSpec` gained `strict_text: bool`. Grading now matches **byte-exact** (no
  whitespace collapse) for Enum-constrained types: TFNG, MATCHING, SINGLE_MCQ (both per-question
  and legacy block-level), CLASSIFICATION, MATCHING_FEATURES. Free-text types (SHORT_ANSWER,
  SENTENCE_COMPLETION/NOTE_COMPLETION blanks, DIAGRAM_LABELING/FLOW_CHART/TABLE_COMPLETION slots,
  sub-answer trees) keep whitespace collapse. MULTI_MCQ was already byte-strict (`ExactSet`).
  Override specs keep the base strictness of their question.
- No change to the shared-answer path (already correct) and no change to the mutation layer.

### Grading matrix as pinned (all through the real submit → projection worker path)
- **SHORT_ANSWER / sentence blanks / diagram labels (free text):** exact → correct; incorrect →
  wrong; blank/cleared/unanswered → wrong; whitespace variant (`"  diagram  "`, `"first "`) →
  **correct** (collapse + trim, Unicode NBSP included); case variant (`"Petrol"`, `"SECOND"`,
  `"Ear"`) → **wrong** (case-sensitive; the shared-answer path is the only case-folding path).
- **TFNG / MATCHING / SINGLE_MCQ (Enum):** exact → correct; incorrect valid value (`"F"`, `"i"`,
  `"A"`) → wrong; blank → wrong; whitespace variant (`" T "`, `"ii "`, `" B"`) → **rejected 422 at
  mutation** and, if smuggled via `finalAnswerPatch`, **wrong at grading** (the BEX-070 fix);
  case variant (`"t"`, `"b"`) → rejected 422 at mutation, wrong at grading via patch.
- **MULTI_MCQ (set):** exact set any order → correct; wrong set → wrong; blank → wrong;
  whitespace inside an element (`["A", "C "]`) or case variant (`["a","c"]`) → wrong (ExactSet is
  byte-strict, no normalization anywhere).
- **Legacy-minimal TFNG (`q1`, no answer metadata):** no grading row at all (spec not built).
- **Shared-answer sentence:** pool value → correct; value outside pool → wrong; blank → wrong;
  case-folded pool value (`"APPLE"`) → **correct** (punctuation/apostrophe/hyphen normalized too).

### Shared-answer pool consumption semantics (exactly as pinned)
Consumption is per question (group key `sentence:{question_id}:shared`), in **spec order = blank
order**. `matches_shared_sentence_answer` normalizes the student value (case-fold + punctuation
normalization) and: (a) a value already in `consumed` → wrong, never re-awarded; (b) a value in
the pool → consumed (inserted into `consumed`) and correct; (c) a value outside the pool → wrong
and **NOT consumed** (the pool stays available for later blanks). Consequences pinned:
`["apple","apple"]` on a 1-answer/2-blank question → [correct, wrong] (duplicate consumption =
"more blanks than valid answers": the excess blank can never be correct, even as `"APPLE"` — the
case-folded repeat is still a consumed duplicate); `["cherry","apple"]` → [wrong, correct]
(wrong values don't consume); `["banana","apple"]` on a 2-answer pool → both correct
(order-independent).

### Submission-to-grading consistency (as pinned)
- **Data source:** the projection (`sync_submissions_from_attempts` →
  `ensure_section_submissions_with_mode`) reads `student_attempts.final_submission.answers` /
  `.writingAnswers` only — never the live `answers`/`writing_answers`/`flags` columns. Pinned:
  after submit, SQL-tampering the live cache (`answers`, `writing_answers`, `flags`) and
  re-running the projection leaves `auto_grading_results`, `section_submissions.answers`, the
  writing task rows, and `final_submission` semantically identical (JSON Value equality; content
  is stable because `generatedAt` derives from the immutable `submitted_at`).
- **Re-run stability:** the no-watermark cycle re-processes every submitted attempt and
  re-upserts identical values (`section_rows_synced >= 1` again), and the persisted JSON is
  identical run after run (Value equality; `generatedAt` derives from the stable `submitted_at`).
- **Totals identity:** `sum(questionResults[].awardedScore) == totalScore`,
  `sum(questionResults[].maxScore) == maxScore`, `percentage == totalScore/maxScore*100` — pinned
  on a 7-correct/4-wrong mix (total 7 of max 11).
- **Writing answers availability:** the essay must be keyed by the **content-declared task id**
  (`writing-1` for the seed). The delivery-side `SetEssayText` accepts legacy `task1`/`task2`
  from the config fallback, but the projection materializes a task row for ANY key present in
  `final_submission.writingAnswers` (passthrough in `build_writing_task_descriptors`) — so only
  content-declared ids materialize rows end-to-end; the pinned path uses the content id.
  Pinned: `final_submission.writingAnswers["writing-1"]` survives; the projection writes the
  `writing` section row (`grading_status needs_review`, `answers.tasks[0].text`) and a
  `writing_task_submissions` row (`student_text` byte-exact, `needs_review`) — all readable for
  manual/AI grading and immune to later live-cache tampering.

### Regression Protection
- Tests: `backend/tests/contracts/student_contract.rs` (`bex070_objective_grading_matrix`,
  `bex070_shared_answer_pool_matrix`, `bex071_submission_to_grading_consistency`); the existing
  `bex035_question_type_round_trip_matrix` still passes unchanged.
- Production: `backend/crates/application/src/grading/mod.rs` (`strict_text` on
  `ObjectiveAnswerSpec`; unit tests `objective_text_matches_*` updated for the new `matches` arg).

### Invariant
Grading must read only the immutable `final_submission` snapshot; re-running the projection must
be content-idempotent; section totals must equal the per-question sums; every objective question
type must grade exact/incorrect/blank deterministically, free-text collapses whitespace (but stays
case-sensitive), Enum/choice matches byte-exact at both the mutation layer and the grading layer
(the submit patch path must not be able to turn a rejected variant into a correct grade), and the
shared pool is consumed once per normalized value in blank order.

## 2026-08-06: Concurrency and capacity under exam-start fan-out and submit storm (BEX-080/081, B-12)

### Empirical findings (contract tests on remote TiDB, 5-connection test pool)

- **Pool starvation surfaces as a raw 500 that leaks sqlx internals.** During development a true
  10-concurrent submit storm on the 5-connection test pool against the remote TiDB Cloud endpoint
  took ~33 s wall; the queued request that exceeded the pool acquire window (sqlx default 30 s)
  returned
  `500 {"code":"DATABASE_ERROR","message":"pool timed out while waiting for an open connection"}`
  — a 500 that both misrepresents retryability and leaks pool internals. Fixed: pool-availability
  failures (`sqlx::Error::PoolTimedOut` / `PoolClosed`) now map to a structured, retryable
  `503 {"code":"SERVICE_UNAVAILABLE", ...}` with no internal text, via `db_error_api_error()`
  in `backend/crates/api/src/routes/student.rs` (used by the `DeliveryError::Database`,
  `StudentAccessRepositoryError::Database`, `AuthError::Database` mappers — the three paths
  reachable from the submit route — plus the audit route's `map_db_error`). All other sqlx errors
  keep the existing `500 DATABASE_ERROR` shape (existing DATABASE_ERROR contract tests still
  pass). The committed storm test uses two sequential waves of 5 concurrent submits (each
  in-flight submit can hold two connections: the submit transaction plus a version load on the
  pool), so starvation is still reachable under remote latency but not deterministic; the 503
  mapping itself is pinned deterministically by unit tests
  (`db_error_pool_timeout_maps_to_structured_503`,
  `db_error_pool_closed_maps_to_structured_503`,
  `db_error_other_errors_keep_500_database_error_shape`).
- **Per-submit hold time dominates under remote latency.** On the remote TiDB endpoint each
  submit transaction holds its pool connection for several seconds (rate-limit INSERT+SELECT,
  `SELECT ... FOR UPDATE`, idempotency lookups, finalization, commit). A 10-burst on 5
  connections therefore queues beyond the acquire window whenever the remote is slow; how many
  requests get served vs. return the structured 503 in a given run is environment-dependent.
  Deterministic contract: served requests are always 200 with a receipt; starved requests are
  always the structured 503; never a 500, never `pool`/`timeout` text in any body. Under a
  catastrophically degraded remote even the first wave can starve; the test then falls back to
  one serial submit, which must still be served with a receipt.
- **Both live rate-limit scopes return structured retry information.** Schedule scope has no
  burst: with `rate_limit_student_live_per_schedule = 2` the third rapid `/live` request is
  `429 {"error":{"code":"RATE_LIMIT_EXCEEDED","details":{"scope":"schedule","retryAfterSeconds":N>=1}}}`.
  The global scope hardcodes `.with_burst(50)` (route `get_student_live_session`), so its
  effective capacity is `rate_limit_student_live_global + 50` per window: with `global = 1` the
  first 51 requests are allowed and the 52nd is denied with `scope:"global"` (pinned exactly).
- **Fan-out consistency.** With 8 students polling `/live` concurrently with StartRuntime, every
  captured response is internally consistent: `not_started` ⇒ `actualStartAt`/
  `currentSectionKey`/`currentSectionDeadlineAt` null; `live` ⇒ all three present,
  `activeSectionKey == currentSectionKey == "listening"`, `revision == 1`, `sections[0]` live,
  `sections[1]` locked; every poller eventually observes `live`; exactly 8 attempts exist in
  `student_attempts` (no duplicates), ids distinct and matching the bootstraps.
- **Submit storm integrity.** Every served storm submit seals the attempt exactly once: one
  `STUDENT_SUBMIT` audit row, one `idempotency_keys` row (actor = student_key,
  route = `POST:/api/v1/student/sessions/{id}/submit`), revision `base+1`, `submitted_at` set,
  `final_submission.submissionId` equal to the receipt. A pool-starved 503 leaves the attempt
  completely untouched (revision unchanged, zero audit rows). Concurrent same-key replays on a
  served attempt return the identical cached receipt with no new rows. Clean storm (complete
  seq metadata, no gaps) leaves `backend_submit_replay_incomplete_total 0` and
  `student_answer_loss_risk_total` absent/zero in `/metrics` — no answer-loss telemetry.
- **Timing pins (generous, non-flaky ceilings).** Single-exam fan-out join (StartRuntime + 8
  pollers) ~2-3 s in the fast case; the committed storm (two waves of 5) ~120 s wall in the
  observed runs (a true 10-burst was ~31-33 s wall during development); per-request latency
  ceiling asserted at 60 s (30 s proved too tight: a starved request legitimately waits the full
  30 s acquire window before its structured 503).

### Regression Protection
- Tests: `backend/tests/contracts/student_contract.rs`
  (`bex080_exam_start_fan_out_keeps_runtime_consistent`,
  `bex080_live_rate_limits_return_structured_retry_information`,
  `bex081_submit_storm_exactly_one_receipt_no_answer_loss`); unit tests in
  `backend/crates/api/src/routes/student.rs`
  (`db_error_pool_timeout_maps_to_structured_503`,
  `db_error_pool_closed_maps_to_structured_503`,
  `db_error_other_errors_keep_500_database_error_shape`).
- Production: `backend/crates/api/src/routes/student.rs` — `db_error_api_error()` maps
  `sqlx::Error::PoolTimedOut | PoolClosed` to `503 SERVICE_UNAVAILABLE`; wired into
  `From<DeliveryError> for ApiError`, `map_student_access_error`, `map_auth_error`, and the
  audit route's `map_db_error`.

### Invariant
Under concurrency the API must never produce an inconsistent runtime snapshot, a missing
deadline, a duplicate attempt, a duplicate submission receipt, a 500 from pool contention, or
an error body leaking pool internals; schedule and global live rate limits must deny with
structured `retryAfterSeconds`; submit retries must stay idempotent; answer-loss telemetry must
stay at zero for clean submissions.

---

## 2026-08-06: Frontend exam entry (FEX-001/002/003, F-1)

### Symptom
Behavior-test pass F-1 pinned the student exam-entry flow (briefing → waiting room →
workspace). One real contract violation surfaced: under React StrictMode's dev double-mount
(mount → cleanup → mount), `PreCheck` started a SECOND silent persist with a SECOND
device-check result (`runPreCheckChecks` computes a fresh `completedAt` per call), so the two
POSTs carried DIFFERENT `Idempotency-Key` values (`attempt.id:clientSessionId:completedAt`).
That defeats the single-flight/idempotency-identity guarantee that makes duplicate triggers
safe.

### Scope
Frontend only: `src/components/student/PreCheck.tsx` (briefing silent persist) and its
tests. The backend-side dedupe of the precheck key is pinned elsewhere (B-2 contract).

### Root Cause
The persist effect captured `const result = runPreCheckChecks(config)` inside the effect body.
StrictMode re-runs the effect after a simulated cleanup; each run produced a new result (new
`completedAt`) and fired a new `onComplete`, i.e. two requests with two identities.

### Fix
`PreCheck` now keeps a single-flight ref (`persistStateRef`, keyed by `config` REFERENCE — an
equal-but-new config object identity starts a fresh check, matching the pre-fix effect-dep
semantics) holding the first device-check result plus `inFlight`/`succeeded` flags. A
duplicate effect run reuses the in-flight persist or the already-succeeded outcome instead of
starting a second one; automatic retries after a failure keep reusing the SAME result (same
`completedAt`), so the idempotency identity is stable across retries and duplicate triggers. A
genuinely new `config` still starts a fresh check. `src/components/student/PreCheck.tsx:25-90`.

Edge (dev-only, pinned): if the first persist REJECTS after StrictMode's simulated cleanup, the
superseded effect run hands retry responsibility to the live run via an effect-generation
counter (a real unmount still bails); the characterization test
"still retries with the same result when the first persist fails under a StrictMode double-mount
(FEX-002)" pins this.

### Regression Protection
- Tests:
  - `src/components/student/__tests__/PreCheck.test.tsx` — "persists exactly once under a
    StrictMode double-mount, reusing the first result (FEX-002)"; "still retries with the same
    result when the first persist fails under a StrictMode double-mount (FEX-002)"; "reuses the
    same device-check result across automatic retries (FEX-002)"; "never surfaces the technical
    compatibility checklist while the five silent checks still run (FEX-001)"; "shows only
    enabled sections with their configured durations in the briefing (FEX-001)".
  - `src/components/student/__tests__/StudentApp.test.tsx` — pending persist keeps the
    briefing (FEX-002); failure keeps the briefing + automatic retry with the SAME
    `Idempotency-Key` (FEX-002); lobby has no answer inputs/section content/start action
    (FEX-003); live runtime auto-opens the workspace (FEX-003).
  - `src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx` — same
    result re-recorded ⇒ identical idempotency key + identical body; new `completedAt` ⇒
    distinct key (FEX-002).
  - `src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx` — paused
    runtime promotes lobby → exam (FEX-003).
  - `src/features/student/hooks/__tests__/useStudentSessionRouteData.backend.test.tsx` —
    poll loop keeps firing every 15s while runtime is not started (lobby) (FEX-003).

### Invariant
The exam entry is a SINGLE silent flow: there is deliberately NO "Continue to waiting room"
button (`PreCheck.test.tsx` pins its absence) and NO student start action in the lobby unless
preview capability is explicitly supplied. The briefing shell (exam title, candidate name/ID,
enabled sections with durations, total duration, timer/reconnection guidance) is the only
visible UI; the five device checks run invisibly. The lobby must never render before precheck
persistence succeeds, failures keep the student on the briefing with automatic retry, and every
retry/duplicate trigger must reuse the same `attempt.id:clientSessionId:completedAt` idempotency
identity. While waiting, the 15s live poll must keep running, and a runtime that becomes
`live` OR `paused` must open the workspace automatically.

---

## 2026-08-06: Authoritative phase mapping and stale runtime protection (FEX-010/012, F-2)

### Symptom
Three reachable phase regressions empowered a stale or out-of-order runtime response to move a
student between screens incorrectly:
1. A live student re-polled with an older `not_started` runtime was bounced back to the waiting
   room (exam → lobby demotion at the provider).
2. After verified terminal completion (runtime structurally complete, attempt not submitted), a
   stale `live` runtime re-delivery flipped the student back into the exam workspace and could
   re-arm the timer/auto-submit boundary.
3. A student whose pre-check was still pending was pushed straight into the exam workspace when a
   `live` runtime snapshot arrived, skipping the required briefing.

### Scope
`src/components/student/providers/StudentRuntimeProvider.tsx` (phase derivation in
`getInitialPhase` + `hydrate_runtime` / `hydrate_attempt` / `hydrate_proctor` + `submit_module`)
and `src/components/student/StudentApp.tsx` (`shouldRenderPostExam`). Route-data freshness
handling (`useStudentSessionRouteData` + `studentSessionStateMachine`) already discarded
older-revision runtime frames; the provider/App layers were the gap when the harness handed
snapshots through directly.

### Root Cause
- `hydrate_runtime` picked `'lobby'` for any non-promotable non-terminal runtime status even when
  `state.phase` was already `'exam'` — no phase monotonicity.
- Terminal verification (`isRuntimeStructurallyCompleted(runtimeSnapshot)`,
  `attempt.submittedAt`, `proctorStatus === 'terminated'`) was recomputed from the *incoming*
  snapshot each hydration; a stale nonterminal snapshot silently unverified it. There was no
  latch, so `StudentApp`'s `shouldRenderPostExam` fell back to the workspace (`effectivePhase`
  degrades `post-exam` → `exam` when unverified).
- `hydrate_attempt`'s `shouldPromoteToExamPhase` did not require `preCheck.completedAt`, so a
  pending-pre-check attempt was promoted into the exam by a `live` runtime.

### Fix
- Phase monotonicity (FEX-012): in `hydrate_runtime` / `hydrate_attempt` / `hydrate_proctor`, a
  non-terminal runtime may only promote the *lobby*; once `exam` or `post-exam` is reached it is
  kept (stale `not_started` blocks the workspace, it never returns the student to the lobby).
- Terminal latch: new `terminalVerified` boolean on `RuntimeReducerState` (init from
  attempt/runtime, set by hydrate paths, set in runtime-backed `submit_module` terminal
  branches and in `terminate_exam`). `StudentApp.shouldRenderPostExam` now also trusts
  `runtimeBacked && terminalVerified`, making verified completion absorbing.
- Pre-check gate (FEX-010 row "Missing → Briefing"): `hydrate_attempt` promotion to `exam`
  requires `preCheck.completedAt`; `hydrate_runtime` promotion additionally requires
  `phase === 'lobby'` (only a completed-pre-check student can wait there).

### Deviation
The "completed but structurally incomplete" runtime row renders the **waiting shell**
(`Waiting for the exam to start`), not a dedicated unlocking screen — honest pinned behavior:
the student never sees a success/completion screen and never enters the workspace.

### Regression Protection
- Tests:
  - `student/__tests__/StudentApp.test.tsx` — "FEX-010 authoritative phase mapping" table
    (7 rows: briefing / waiting room / exam workspace / paused overlay / no false success /
    finalization / terminated view) + "keeps the finalization UI when a nonterminal runtime
    is re-delivered after terminal completion (FEX-012)".
  - `student/providers/__tests__/StudentRuntimeProvider.test.tsx` — "keeps a live student in the
    exam phase when an older `not_started` runtime is re-delivered (FEX-012)", "keeps the
    local module advance only while the runtime lags, and lets newer runtime revisions win
    (FEX-012)", and "keeps a pending pre-check on the briefing while the runtime is already
    live, and promotes only when the pre-check completes (FEX-010 hydrate_attempt gate)" —
    the last pins the `hydrate_attempt` pre-check gate across re-hydration and the
    no-deadlock convergence once the pre-check completes.
  - Re-purposed spy-restore fix in the display-time test (leaked `window.setTimeout`/
    `setInterval` spies) so later real-timer tests run clean.
  - Route-level section regression was already pinned:
    `useStudentSessionRouteData.backend.test.tsx` "discards a runtime_snapshot WS frame with an
    older revision", "applies fresher attempt snapshots even when runtime freshness regresses".
- Rules/Docs updated: this file; `StudentRuntimeProvider.tsx` comments.

### Invariant
The student-phase progression is monotonic for non-terminal runtimes: `pre-check → lobby → exam`,
and once `exam`, only a verified terminal state (`post-exam`) may move the student out; stale
`not_started` responses block the workspace in place. Verified terminal state is absorbing and
survives stale nonterminal snapshots and attempt re-hydration. A pending pre-check permanently
stays on the briefing regardless of how `live` the runtime is until `preCheck.completedAt` is
authoritative. "Saved/verified" UI must never be shown off unverified runtime structure.
