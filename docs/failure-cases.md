# Failure Cases

Purpose: turn incidents and bug fixes into durable memory for humans and AI agents.

## 2026-08-06: Final-Submit Pipeline Was Gated Off by Verified-Terminal Absorption (FEX-050/051/052, F-9)

### Symptom
Production contract violation (verified from code, then fixed): in runtime-backed mode the
final attempt submission was NEVER issued, and the app claimed success without a backend
receipt. On a structurally complete runtime, `shouldRenderPostExam` became true from RUNTIME
STRUCTURE ALONE — `isRuntimeStructurallyCompleted` drives both `verifiedTerminalState`
(`'completed'` without any `submittedAt`) and `runtimeCompletionVerified`, so the
orchestration gate `if (shouldRenderPostExam) { return; }` was true on every condition in
which the pipeline could fire, and the finalization overlay had an unreachable
`!shouldRenderPostExam` clause: the student saw **"IELTS Examination Complete!"** with
`submittedAt: null` and no submission ever issued (false success, Agents.md critical
invariant "student-visible saved/verified state must match persisted reality"). The bug was
PINNED by `StudentApp.test.tsx` FEX-010 row (old `:4887-4898`, submittedAt-null fixture
`createWritingAttemptSnapshot` at `:106-129`) and the old FEX-012 `:4940-4976`.

### Scope
- `src/components/student/useStudentSubmissionOrchestration.ts` — pipeline gate + reset-branch
  hardening.
- `src/components/student/StudentApp.tsx` — finalization overlay condition, post-exam phase
  gate, orchestration prop wiring, `attemptFinalized` derivation.
- `src/components/student/__tests__/useStudentSubmissionOrchestration.test.tsx` and
  `src/components/student/__tests__/StudentApp.test.tsx` — rewritten violative tests + new
  contract tests.
- `docs/failure-cases.md` (this entry). Backend untouched.

### Root Cause
`useStudentSubmissionOrchestration.ts` gated the final-submit pipeline on
`shouldRenderPostExam`, and `StudentApp.tsx` derives that flag from
`isRuntimeStructurallyCompleted(runtimeSnapshot)` (via `verifiedTerminalState.ts`,
`isRuntimeStructurallyCompleted` `:7-25` and `isVerifiedTerminalStudentState` `:28-46`). The
runtime-status `'completed'` + `runtimeCompletionVerified` pipeline condition implies the same
structural completion, so `shouldRenderPostExam` was always true exactly when the pipeline
condition held: the pipeline (per-attempt flush → `submitAttempt()`) could never run. The only
effectively reachable `submitAttempt` call was the pending-panel "Retry now"
(`StudentApp.tsx:546` original), which requires a pending record that nothing ever created.

### Fix
1. **Unblock the pipeline** (`useStudentSubmissionOrchestration.ts`): removed
   `shouldRenderPostExam` from the options; added `attemptFinalized: boolean`
   (`attempt.submittedAt != null || attempt.proctorStatus === 'terminated'`) and
   `pendingSubmissionActive: boolean` (`attemptState.pendingSubmission != null`). Gate now:
   `if (attemptFinalized || pendingSubmissionActive || finalSubmitStatus === 'failed') return;`
   (`:178-198`). A structurally-complete runtime with an un-finalized, non-pending attempt
   fires the pipeline exactly once; finalized attempts and durable pending submissions never
   fire it (the provider's `submitAttempt` claims "handled" — `StudentAttemptProvider.tsx
   :1566-1582` — and its retry loop owns the submission identity).
2. **Harden against stale re-delivery (FEX-052)** (`:151-176`): the reset branches
   (`!runtimeBacked` or `runtimeStatus !== 'completed' || !runtimeCompletionVerified`) no
   longer clear `finalSubmitInFlightRef`/status while a pipeline is in flight; a stale
   nonterminal snapshot re-delivered mid-submit cannot start a second submit when completion
   returns. The `finalSubmitStatus === 'failed'` guard also prevents a re-render right after
   the sixth failed attempt from starting a SECOND six-attempt pipeline (the app passes fresh
   action objects each render); only a later re-completed runtime (reset branch clears the
   status) may legitimately retry.
3. **Overlay over the completion phase** (`StudentApp.tsx:550-563`): dropped
   `!shouldRenderPostExam` from the finalization-overlay condition so it renders while
   `runtimeStatus === 'completed' && runtimeCompletionVerified && finalSubmitStatus !== 'idle'`;
   `submissionPending → Panel` precedence unchanged. The post-exam phase
   (`StudentApp.tsx:630-663`) renders ONLY the overlay while the submit is in flight and
   `!submissionPending`: the completion claim is not in the DOM before the backend receipt
   (no false success). `attemptFinalized` is derived at `StudentApp.tsx:158-165`.

### Regression Protection
`useStudentSubmissionOrchestration.test.tsx` (suite: 15 passed, zero act() warnings):
- `:600` — pipeline did NOT fire when `isAttemptFinalized` true (submittedAt/terminated gate).
- `:646` — pipeline did NOT fire while a durable pending submission owned the retry loop.
- `:692` — retry-status machine `submitting → retrying → idle` when the provider recovered.
- `:762` — `failed` after six unanswered (1s,2s,4s,8s,16s,30s capped) backoffs.
- `:818` — one submit across fresh runtime-state hydration; after success the `attemptFinalized`
  gate blocks a live→completed round trip.
- `:901` — the fix-B (in-flight hardening) red→green: stale `live` re-delivery mid-pipeline
  then `completed` → still exactly one submit (was red at 2 calls without the hardening).
- `:64`/`:107` updated to the new props (mirror + StrictMode double-effect still one submit).

`StudentApp.test.tsx` (all 53 passed; act-warning count identical to baseline at 19):
- `:4930` rewritten FEX-010 row — structurally complete runtime + unsubmitted attempt →
  finalization overlay while the (deferred) submit is outstanding, COMPLETION VISIBLE ONLY
  after the backend receipt.
- `:4986` rewritten FEX-012 — completed → submit → receipt → completion → stale live runtime
  re-delivered → stays on completion, exactly one submit.
- `:5034` FEX-050 — one overlay ("Submitting your exam" / "Submitting" / "Do not close" /
  keep-this-page-open copy) with submit in flight; completion claim and Exit action absent.
- `:5080` FEX-050 — receipt releases the overlay, completion appears, no Confirm Submission
  dialog (the auto-finalization contract is no-confirm).
- `:5115` FEX-051 — failed submit: overlay replaced by the "Submission pending" panel over the
  completion view; Retry now re-uses the same submission identity and the receipt releases it.
- `:5182` FEX-052 — a fresh completed runtime object re-delivered mid-submit keeps one overlay
  instance and one submit call.

Unmodified pinning coverage for FEX-051 (verified only): provider `:2481` (no pseudo
post-exam on failed submit), `:2531` (same submission identity + ORIGINAL frozen snapshot on
retry), `:2589` (I1 drift), `:2678` (reload restores durable pending + resumes retry loop),
`:2787` (StrictMode double-mount, one retry loop), `:2892` (I1-residual — a dead frozen
payload is abandoned); app `:4160` (panel, same id + original answers on retry), `:4500`
(panel over completed runtime), `:4561` (M7 release); panel unit tests
`StudentSubmissionPendingPanel.test.tsx` (4 tests; the pre-mapping counted 5 — the file has
four).

### Accepted Deviation
The app-level "Retrying" badge and the `retrying`/`failed` overlay copy are unreachable in the
real app because the provider returns TRUE ("handled") on failure — it records a pending
submission and the background loop owns retries. The `submitting / retrying / failed` status
machine is pinned at the orchestration level instead. Also, E1's click-interception
(replicating the F-8 pattern at `StudentApp.test.tsx:3803`) is inapplicable to the
finalization overlay: while the submit is in flight the completion view (and its Exit button)
is not rendered at all, so "blocks closing/editing" is pinned by asserting the Exit action is
unreachable and the overlay is the sole surface.

### Follow-up (non-blocking)
A stale nonterminal runtime re-delivered WHILE the final submit is in flight keeps
`finalSubmitStatus` non-idle (FEX-052 hardening) while the overlay's `runtimeStatus ===
'completed'` precondition fails — in isolation that could briefly re-expose the workspace or
render an empty container. This is unreachable in the real app: the F-2 terminal latch
(`runtimeState.terminalVerified`, `StudentApp.tsx:250-254`) plus runtime-provider phase
monotonicity (FEX-012) absorb stale nonterminal frames before they reach `StudentApp`. If a
future change weakens those guards, the overlay condition (`StudentApp.tsx:557-561`) should
be reduced to `finalSubmitStatus !== 'idle' && !submissionPending` and pinned with an
app-level mid-flight stale-live test.

### Invariant
Automatic finalization is single-fire: for a structurally completed runtime with
an un-finalized, non-pending attempt, the pipeline emits the final DOM answer state, flushes
pending mutations, and calls `submitAttempt` exactly once — never before a stale runtime
snapshot, a re-render, or repeated hydration, and never at all for submitted/terminated
attempts or attempts with a durable pending submission. The UI shows the finalization overlay
during the submit and claims "IELTS Examination Complete!" only after the backend receipt, or
the pending panel when the backend cannot confirm — the completion claim, the submit call,
and the retry loop all remain single-instance and receipt-gated.

## 2026-08-06: Parameterized Pause Overlays and Warning Acknowledgement (FEX-060/061, F-10)

### Symptom
Plan-driven. No production incident. FEX-060 (pause overlays) and FEX-061 (warning
acknowledgement) were largely unpinned: `getBlockingCopy` was inline in `StudentApp.tsx`
with ZERO tests for any reason's title/message/badge/contextLabel; `proctor_paused` had no
positive app test; the waiting-for-advance app test (old `StudentApp.test.tsx:523`) was
vacuous — it rendered without an attempt snapshot, so the phase stayed `pre-check` and
the blocking overlay never rendered (it asserted only that `container` was in the document);
`waiting_for_runtime`, the remaining-time chip, the proctorNote override, priority
reconciliation at app level, the whole proctor-warning flow (provider + app), screenshot
blackout dismissal isolation, and translation/secondary-screen app behavior had zero
coverage. Characterization testing then exposed TWO real (minor) violations, both fixed
minimally (below).

### Scope
- `src/components/student/blockingCopy.ts` (NEW) — pure `getBlockingCopy` module, the only
  intended production extraction; `StudentApp.tsx:34` imports it, `:65` calls it.
- `src/components/student/StudentApp.tsx` — extraction import + the empty-description
  fallback fix (4 one-character changes `??` → `||`).
- `src/components/student/providers/StudentAttemptProvider.tsx` — duplicate-frame
  acknowledgement-preservation fix (`:821-845`).
- `src/components/student/__tests__/blockingCopy.test.ts` (NEW), `StudentApp.test.tsx`,
  `useStudentWarningVisibility.test.tsx`, `StudentAttemptProvider.test.tsx` — new/rewritten
  tests.
- `docs/failure-cases.md` (this entry). Backend/admin/builder and the F-9 finalization flow
  untouched.

### Root Cause (finding 1 — FEX-061 "duplicate live updates do not reopen an acknowledged warning")
`StudentAttemptProvider`'s attempt-snapshot sync effect has a keep-local branch (pending
mutations or local-state preference) that preserves a locally acknowledged
`lastAcknowledgedWarningId` (`currentAttempt.lastAcknowledgedWarningId ?? attemptSnapshot.lastAcknowledgedWarningId`,
`:804-808`), but the REPLACE branch (no local signals — the normal case for a live-update
frame) overwrote the attempt with the raw snapshot: `attemptRef.current = attemptSnapshot`.
A server frame that is identical except that the acknowledgement is not yet reflected on it
would therefore regress the acked id, reopening an already-acknowledged proctor warning —
exactly the "duplicate live updates do not reopen an acknowledged warning" clause of
FEX-061. Reproduced red with a provider characterization test (ack → re-deliver same frame
→ acked id was `null` again).

### Root Cause (finding 2 — empty-description violations render an empty warning dialog)
The four warning overlays in `StudentApp.tsx` used `latestXViolation?.description ?? 'fallback'`.
Nullish coalescing keeps an EMPTY string, so a violation with `description: ''` rendered the
warning dialog with no message text at all (characterization test: overlay opened with
heading "ATTENTION" and empty body). The fallback copy is the correct surface for an empty
description.

### Fix
1. **Finding 1** (`StudentAttemptProvider.tsx:821-835`): the replace branch now preserves the
   locally acknowledged id when a same-id attempt frame arrives without it:
   `sameAttempt && currentAttempt && currentAttempt.lastAcknowledgedWarningId
   ? { ...attemptSnapshot, lastAcknowledgedWarningId: currentAttempt.lastAcknowledgedWarningId }
   : attemptSnapshot`. Mirrors the keep-local branch's intent; no other behavior changes.
2. **Finding 2** (`StudentApp.tsx:693-696` screenshot, `:708-712` tab-switch, `:723-727`
   translation, `:738-742` secondary screen): `??` → `||` so the parameterized fallback
   message renders when the violation description is empty. This is also what makes the
   FEX-061 fallback-message app tests (empty-description violations) meaningful.
3. **Extraction (A)**: `getBlockingCopy` moved verbatim (identical strings, identical
   `default: null`) from `StudentApp.tsx` (old `:36-109`) to `blockingCopy.ts:13-84`; the
   overlay render (`StudentApp.tsx:454-474`) is unchanged and still gates on
   `runtimeState.blocking.active && blockingCopy`.

### Accepted Reconciliation (offline / heartbeat_lost / device_mismatch)
These three reasons have copy entries in `getBlockingCopy` (`blockingCopy.ts:51-83`) but are
NON-BLOCKING by design (FEX-032: answer entry continues offline; the header
`autoSaveStatus` badge is the offline surface — `StudentApp.tsx:72-81`). The blocking
machine ignores transitions for them (`blockingStateMachine.ts:79-81`
`NON_BLOCKING_INTEGRITY_REASONS`); production dispatches them only as non-blocking signals,
which the machine ignores (`StudentKeyboardProvider.tsx:277-285`,
`useStudentSubmissionOrchestration.ts:75-80`), and the F-7 app suite pins 'Offline' as a
header badge while answer entry continues (`StudentApp.test.tsx:4303-4461`). The
`blockingCopy` entries are DEFENSIVE parameterization — now pinned by the
`blockingCopy.test.ts` unit table
so a future change that makes them blocking must consciously update both. `syncing_reconnect`
has no copy entry → `null` → no overlay, pinned by `blockingCopy.test.ts:92`.

### Regression Protection
`blockingCopy.test.ts` (NEW, 10 passed): `:10-89` `it.each` table — exact title/message/
badge/contextLabel for cohort_paused, proctor_paused, not_started, waiting_for_advance,
waiting_for_runtime, offline, heartbeat_lost, device_mismatch, storage_unavailable; `:92`
null for syncing_reconnect and unknown reasons.

`useStudentWarningVisibility.test.tsx` (4 passed): `:78` once-per-violation-ID (v1,v2 → only
v2 shows; ack v2 → closed; duplicate re-delivery of the same array stays closed; v3 reopens;
ack v3 → full [v1,v2,v3] re-delivery never reopens any — older ids never re-trigger);
`:156` per-type isolation (acknowledging SCREENSHOT_ATTEMPT does not acknowledge TAB_SWITCH;
a new screenshot id reopens only the screenshot warning).

`StudentAttemptProvider.test.tsx` (61 passed): `:2104` durable ack — `saveAttempt` payload
carries `lastAcknowledgedWarningId`, proctorStatus demoted `warned` → `active`, `proctorUpdatedBy
'Candidate'`, ALERT_ACKNOWLEDGED audit with `{warningId}`; `:2157` idempotent — same id acked
again → no second save/audit; `:2207` non-warned statuses untouched; `:2246` no-op without an
attempt; `:2282` the finding-1 red→green — ack then re-deliver the same frame without the
acked id keeps it (duplicate live update never reopens the warning).

`StudentApp.test.tsx` (65 passed; act warnings 18, at/below the 19 baseline):
- `:544` WEAK-TEST FIX — the old vacuous waiting-overlay test rewritten: completed
  pre-check + `waitingForNextSection: true` → heading 'Waiting for cohort advance', message
  /The proctor is preparing the next section/i, badge 'Waiting', contextLabel 'Cohort
  Runtime', writing fieldset disabled; release rerender (`waitingForNextSection: false`,
  section `live`) → overlay gone.
- `:5287` cohort pause full contract — heading/message/badge 'Paused'/'Cohort Runtime'/
  'Remaining 05:00' (300s → zero-padded MM:SS), fieldset disabled + aria-disabled + change
  event refused, released only when the runtime resumes live.
- `:5349` proctor pause via attempt snapshot — 'Individual session paused' copy,
  `proctorNote` OVERRIDES the message, released when proctorStatus → 'active'.
- `:5414` proctor pause via blocking-machine override — high-severity violations with
  `allowPause` hit the 15s-cooldown pause threshold (`transition_blocking('proctor_paused')`)
  → same overlay from the machine path.
- `:5462` waiting_for_runtime — `sections: []` contract issue → 'Waiting for runtime' copy +
  locked fieldset; repaired frame releases.
- `:5516` not_started mid-exam — stale `not_started` frame → 'Waiting for start' + 'Locked'
  badge; next live frame clears.
- `:5579` priority reconciliation — cohort-paused runtime + attempt proctorStatus 'paused' →
  'Individual session paused' wins; runtime resumes while proctor still paused → STILL the
  proctor overlay (lower reason clearing never clears the higher); proctor active → gone.
- `:5654` proctor-warning flow — overlay opens with the violation description, 'I Understand'
  calls `acknowledgeProctorWarning(id)` (durable `saveAttempt` payload asserted), same
  violation id re-delivered on a duplicate frame stays closed, a NEW id reopens.
- `:5771` latest-only — two PROCTOR_WARNING ids, only the latest drives the overlay and the
  ack targets exactly that id.
- `:5836` blackout isolation — Escape keydown, backdrop/dialog-area click, and
  acknowledging an unrelated tab-switch warning do NOT dismiss; only 'Continue Exam' does.
- `:5929` / `:5985` translation + secondary-screen — fallback messages
  ('Translation tools detected...', 'Multiple screens detected...') with empty-description
  violations (finding-2 red→green), 'I Understand' acks and closes.
- `:6038` focus characterization — three open/ack cycles with cumulative violation
  histories; `document.activeElement` never moves off the student's answer input (the
  absence of focus code in `WarningOverlay.tsx` IS the contract — no autofocus/trap/restore
  exists, and repeated cycles confirm nothing steals focus).
- `:4534-4537` storage_unavailable extended — FEX-033 block test now also pins badge
  'Blocked', contextLabel 'Session Recovery', 'Remaining 05:00' (M7 recovery release remains
  at `:4623`).

Unmodified pinning coverage re-verified: machine priority + non-blocking semantics
(`blockingStateMachine.test.ts`, `blockingStateMachine.priority.test.ts`,
`StudentRuntimeProvider.test.tsx:274-303`, `:492-515`); `answerControlsLocked` derivation
(`StudentRuntimeProvider.tsx:1724-1730`); WarningOverlay component suite (14 tests,
untouched).

### Invariant
The blocking overlay is copy-parameterized per reason and disappears ONLY on the matching
recovery transition, with priority reconciliation (proctor pause > cohort pause > ...) such
that clearing a lower-priority reason never clears a higher one, and answers are locked
while any blocking reason is active. Each warning type shows at most once per violation id,
an acknowledgement persists against duplicate live updates (locally, and durably through
`lastAcknowledgedWarningId`), the screenshot blackout dismisses only through 'Continue Exam',
and warning overlays never steal focus.

## 2026-08-06: Keyboard/Screen-Reader Flow, Modal Confirmation, and Readability Pins (FEX-070/071/072, F-11)

### Symptom
Plan-driven. No production incident. Three FEX-070 rows were violated by production code:
(1) `SubmitConfirmation` was not a dialog at all — no `role="dialog"`, no `aria-modal`, no
accessible name, no focus management (no move-in, no trap, no restore), and its icon-only
X close button had no label (pre-fix `SubmitConfirmation.tsx:41-155`). The e2e "submit
confirmation dialog is accessible" test (`e2e/student-accessibility.spec.ts:105-144`) passed
VACUOUSLY: `page.getByRole('dialog')` matched nothing, so the whole block was skipped.
(2) The blocking/waiting overlay (`StudentApp.tsx:453-475` pre-fix) had no live region:
waiting/blocking changes were never announced to screen readers. (3) All four
`#main-content` skip-link targets (`StudentApp.tsx:520` pre-check, `:543` lobby,
`StudentExamWorkspace.tsx:97`, `StudentPostExamView.tsx:24`) lacked `tabIndex`, so fragment
navigation does not move focus in real browsers (WCAG 2.4.1 needs a focusable target).
Two FEX-070/072 rows were unpinned: the countdown timer's non-live semantics ("not announced
every second") and the `high-contrast` shell class application.

### Scope
- `src/components/student/SubmitConfirmation.tsx` — dialog semantics + focus management.
- `src/components/student/StudentApp.tsx` — blocking overlay polite live region (countdown
  chip and badge stay outside), `tabIndex={-1}` on the two `main` targets.
- `src/components/student/StudentExamWorkspace.tsx`, `src/components/student/StudentPostExamView.tsx`
  — `tabIndex={-1}` on `main`.
- `src/components/student/__tests__/SubmitConfirmation.test.tsx`, `StudentApp.test.tsx` — new
  pins (existing tests untouched).
- `docs/failure-cases.md` (this entry) + `docs/e2e-audit-accessibility-viewport.md` (NEW
  FEX-070/071/072 coverage matrix). Nothing under `e2e/` was modified — the e2e specs cannot
  run in this environment (MySQL/TiDB infra) and their gaps are listed in the audit doc.

### Fix
1. **SubmitConfirmation** (`SubmitConfirmation.tsx:43-87`): an effect gated on `isOpen`
   (the component still early-returns `null` when closed) stores
   `document.activeElement`, moves focus into the dialog container (`tabIndex={-1}`),
   traps Tab/Shift+Tab (wraps at first/last, pulls stray focus back in, and wraps
   Shift+Tab from the container itself, which is the initial focus target), maps Escape
   to `onClose`, and restores the previously focused element in its cleanup. The effect
   is keyed on `[isOpen]` only and reads the latest `onClose` through a ref
   (`onCloseRef`, `:31-32`): the parent passes an inline `onClose`
   (`StudentApp.tsx:759`) whose identity changes on every render, and StudentApp
   re-renders once per second while the dialog is open (runtime clock tick), so an
   `onClose`-keyed effect would restore focus to the trigger and reset the tab position
   every second — found by both F-11 reviewers (focus churn), fixed before commit.
   `:106-109`: `role="dialog"` + `aria-modal="true"` + `aria-labelledby="submit-confirmation-title"`
   (stable id on the h2 at `:124`) and `aria-label="Close"` on the X button (`:130`). No new
   user-visible dismissal paths (no backdrop-click close, no autofocus attributes on the
   action buttons).
2. **Blocking overlay** (`StudentApp.tsx:462-470`): the TEXT portion (contextLabel + title
   + message) is wrapped in `<div role="status" aria-live="polite">`; the "Remaining mm:ss"
   countdown chip and the badge stay OUTSIDE it (`:471-478`) so the per-second countdown is
   never announced. The countdown format and overlay structure are otherwise unchanged.
3. **Skip links**: `tabIndex={-1}` added to the four `main#main-content` elements
   (`StudentApp.tsx:526`, `:549`, `StudentExamWorkspace.tsx:96-101`, `StudentPostExamView.tsx:24`)
   so fragment navigation moves focus; `tabIndex=-1` keeps them out of the tab order, so the
   F-10 focus contracts (warning overlays never steal focus) are unaffected.

### Regression Protection
`SubmitConfirmation.test.tsx` (21 passed; the 13 pre-existing tests unchanged): new FEX-070
pins — dialog role/`aria-modal`/accessible name via `aria-labelledby`, close-button label,
initial focus lands on the dialog, Tab/Shift+Tab trap (wrap at both ends, stray focus pulled
back in, middle controls not intercepted, Shift+Tab from the container wraps to the last
control), Escape calls `onClose`, focus restored to the previously focused element on close,
and focus stays trapped when the parent re-renders with a new `onClose` identity while the
dialog is open (regression for the review-found focus-churn defect).

`StudentApp.test.tsx` (71 passed; act warnings still 18 from the same 6 pre-existing tests;
all F-10 pins untouched):
- `:6114` blocking overlay live region — `role="status"` + `aria-live="polite"` contains
  contextLabel/title/message; its text never contains 'Remaining' or '05:00'; the countdown
  chip and badge elements are outside any `[role="status"]`.
- `:6154` timer — `role="timer"` (non-live role), `closest('[aria-live]')` is null, and no
  ancestor up to and including the banner carries `aria-live`: never announced every second.
- `:6180` high contrast — `.student-exam-shell` lacks `high-contrast` by default, gains it
  via the accessibility panel switch, and loses it when toggled back (FEX-072).
- `:6207` in-app dialog — Finish opens `getByRole('dialog', { name: 'Confirm Submission' })`
  with `aria-modal="true"`; Escape closes it.
- skip-link enabler pins — briefing shell and lobby shell both render the skip link with
  `href="#main-content"` and a `tabindex="-1"` main target (F-11 describe), the exam-shell
  main (StudentExamWorkspace) carries the same contract, and `StudentPostExamView.test.tsx`
  pins it for the post-exam view (3 tests, +1).

Full student suite re-verified after the changes: 77 files / 836 tests pass.

### Invariant
The submission confirmation is a labelled modal dialog: focus moves in on open, is trapped
while open, Escape closes it, and focus returns to the element that opened it. The blocking
overlay announces only static text changes (never the ticking countdown). Every skip-link
target is programmatically focusable. The countdown timer is never inside a live region.
Readability preferences (font scale, zoom, high contrast, passage readability, highlight
mode) change only presentation, never persisted answer content.

## 2026-08-06: Section Submission — Unanswered Confirmation, Flush-Before-Submit, and Submission Races (FEX-040/041/042, F-8)

### Symptom
Plan-driven. No production incident. The F-8 test pass had to pin the section-submission
contracts end to end: **FEX-040 unanswered confirmation** (confirm dialog on unanswered +
`confirm` policy with correct counts, cancel returns to the same question, confirm does not
duplicate the submission, `allow` skips the dialog), **FEX-041 flush-before-submit** (DOM
controls → live cache → writing draft → pending flush, section transition only after a
successful flush, exponential-backoff retry with offline/reconnect blocking), and **FEX-042
section submission races** (another flush in flight, final keystroke still debounced, proctor
advance, runtime pause, connection drop, timer zero). One hardening finding was surfaced but
NOT changed (see Fix): a `fireEvent` click-through reaches `handleModuleSubmit`'s confirmation
branch before the `answerControlsLocked` gate while paused; userEvent (and real browsers, via
the z-40 blocking overlay) never reach it.

### Scope
Test-only changes inside the student module, plus this memory artifact:
- `src/components/student/__tests__/useStudentSubmissionOrchestration.test.tsx`
- `src/components/student/__tests__/StudentApp.test.tsx`
- `src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx`

Read-only context used for citations: `src/components/student/useStudentSubmissionOrchestration.ts`
(the retry loop re-reads `runtimeStateRef.current` each iteration; backoff is
`Math.min(30_000, 1_000 * 2 ** attemptIndex)` via `window.setTimeout`; the same-fingerprint
in-flight dedupe uses `moduleSubmitInFlightRef` + `moduleSubmitFingerprintRef`),
`src/services/studentMutationOutbox.ts` (`flushNow` forces `persistNow` when
`isDurableMirrorUpToDate()` is false), `src/components/student/StudentApp.tsx`
(`performModuleSubmit` early-returns on `answerControlsLocked`; the pause overlay is
`fixed inset-0 z-40`).

### Gap Matrix

| Bullet | Verdict | Evidence (file:line) | Action |
|---|---|---|---|
| FEX-040: confirmation appears when unanswered and policy is `confirm` | PINNED-ALREADY | component suite `SubmitConfirmation.test.tsx` (title/unanswered/flagged counts/block/allow/time); app `StudentApp.test.tsx:3415` | — |
| FEX-040: counts for answered, total, and flagged are correct | NEWLY-PINNED (app-level wiring) | `StudentApp.test.tsx:3649` — 2 seeded questions, 1 typed answer, 1 flag → dialog shows `You have 1 unanswered question`, `Answered:` row `1/2`, `You have 1 flagged question` (component-level counts already pinned in `SubmitConfirmation.test.tsx`) | — |
| FEX-040: cancel returns to the same question | NEWLY-PINNED | `StudentApp.test.tsx:3528` — `Review Answers` closes the dialog, no `Examination Complete!`, the student stays on q1 (`Answer for question 1` still present/enabled), and re-clicking Finish re-opens the dialog | — |
| FEX-040: confirm does not duplicate the submission | PINNED-ALREADY + NEWLY-PINNED | app `StudentApp.test.tsx:2633` (rapid Finish clicks during an in-flight runtime-backed flush → one `saveAttempt`); orchestration `useStudentSubmissionOrchestration.test.tsx:519` (same-fingerprint call while first flush in flight → exactly one `flushPending` + one `submitModule`) | — |
| FEX-040: policy `allow` skips confirmation | PINNED-ALREADY | `StudentApp.test.tsx:3921` — `allow` submits immediately with unanswered questions | — |
| FEX-041: current DOM controls emit their latest values | NEWLY-PINNED (order) | `useStudentSubmissionOrchestration.test.tsx:154` — `flushDomAnswerControlsNow` is the first pipeline call | — |
| FEX-041: writing draft is committed | PINNED-ALREADY + NEWLY-PINNED (order) | `StudentApp.test.tsx:686` (mounted editor draft committed before runtime final submission, F-5); `useStudentSubmissionOrchestration.test.tsx:154` (`commitWritingDraft` before `flushPending`) | — |
| FEX-041: live answer cache is reconciled | NEWLY-PINNED (order) | `useStudentSubmissionOrchestration.test.tsx:154` — `reconcileLiveAnswerCacheNow` second, before the flush. Accepted deviation from spec numbering 1-2-3-4: the pinned order is DOM-controls → cache-reconcile → writing-draft (steps 1-3-2-4); steps 2/3 operate on independent domains (writing draft vs objective cache) and both strictly precede the flush, so the swap is semantically inert | — |
| FEX-041: pending mutations are flushed | NEWLY-PINNED (order) | `useStudentSubmissionOrchestration.test.tsx:154` — `flushPending` last; full order `[flushDom, reconcile, commit, flushPending]` | — |
| FEX-041: section transition only after successful flush | NEWLY-PINNED | `useStudentSubmissionOrchestration.test.tsx:215` — no `submitModule` while the flush fails; exactly one `submitModule` after the retry succeeds; happy path pinned at `:7` | — |
| FEX-041: retry with exponential backoff + offline/reconnect blocking | NEWLY-PINNED | `useStudentSubmissionOrchestration.test.tsx:215` (1_000ms then 2_000ms backoffs, `transitionBlocking('syncing_reconnect', true)` while online, both blockings cleared on success), `:301` (`transitionBlocking('offline', true)` when `navigator.onLine === false`, cleared after success) | — |
| FEX-042: another flush is in flight | PINNED-ALREADY + NEWLY-PINNED | provider `StudentAttemptProvider.test.tsx:928`/`:981`/`:1037` (answer-level races: new answers queued mid-flush are persisted with the latest value); orchestration `:519` (submit-level dedupe); app `StudentApp.test.tsx:2633` | — |
| FEX-042: final keystroke still debounced | NEWLY-PINNED | `StudentAttemptProvider.test.tsx:1316` — online typing inside the 100ms debounce then `flushPending()` with ZERO timer advancement: `flushNow` forces the durable mirror write (`persistNow` via `isDurableMirrorUpToDate()` false) with the LATEST typed value, queue drains (`pendingMutationCount` 0, `syncState 'saved'`), and the later debounce tick does not duplicate the write | — |
| FEX-042: proctor advances the section | NEWLY-PINNED | `useStudentSubmissionOrchestration.test.tsx:376` — `currentModule` changed mid-retry → the loop re-reads `runtimeStateRef.current` and abandons WITHOUT a second flush or submit; `:448` — same for `phase` leaving `'exam'` | — |
| FEX-042: runtime pauses | NEWLY-PINNED | `StudentApp.test.tsx:3782` — paused runtime (`status: 'paused'`): the blocking overlay intercepts Finish (userEvent hit-testing matches the browser), no confirmation dialog opens, no submission/completion, overlay stays, student remains on q1 | — |
| FEX-042: connection drops | PINNED-ALREADY + NEWLY-PINNED | provider `StudentAttemptProvider.test.tsx:1109` (pending mutations kept when the connection drops mid-flush, recovered on retry); orchestration `:301` (offline blocking state + retry until the flush succeeds, then submit once) | — |
| FEX-042: timer reaches zero | PINNED-ALREADY | `StudentApp.test.tsx:2363` (auto-submit at 00:00 + UI lock), `:2492` (server-confirmed 00:00 on load), `:2853` (no duplicate while the first zero-timer flush is in flight), `:3080` (auto-submit retried when the flush fails) | — |

### Fix
No production code changes. Ten regression tests added (6 orchestration, 1 provider, 3 app) —
see the Gap Matrix for citations. One hardening finding REPORTED, not changed:
`StudentApp.tsx` `handleModuleSubmit` (`:437-444`) evaluates `submitRequiresConfirmation`
before the `answerControlsLocked` gate that protects `performModuleSubmit` (`:421-424`). A
`fireEvent` click on Finish while paused reaches the confirmation branch and opens the dialog;
confirming is still a no-op (the gate early-returns), and real browsers cannot reach the
button at all because the pause overlay (`fixed inset-0 z-40`, `:522`) intercepts the
pointer — verified by userEvent hit-testing in `StudentApp.test.tsx:3782`. Recommendation for
the controller: move the lock check ahead of the confirmation branch in `handleModuleSubmit`
for defense in depth; no integrity invariant is currently violated.

### Regression Protection
- `npx vitest run src/components/student/__tests__/useStudentSubmissionOrchestration.test.tsx` → **Tests 9 passed (9)**, zero `act()` warnings.
- `npx vitest run src/components/student/__tests__/StudentApp.test.tsx` → **Tests 49 passed (49)**; the 19 "not wrapped in act" occurrences match the pre-existing baseline exactly (zero new).
- `npx vitest run src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx` → **Tests 56 passed (56)**, zero `act()` warnings (the provider file's zero-warning bar is kept).
- All new tests use fake timers with `finally { vi.useRealTimers(); }` where timers are involved, restore the `navigator.onLine` descriptor in `finally`, and add no module-level `vi.mock`s; no `.only`/`.skip`.

### Invariant
Section submission is a single, idempotent, retried transaction that never runs ahead of
persistence and never fires twice: the pipeline always emits the current DOM controls,
reconciles the live answer cache, commits the writing draft, and then flushes pending
mutations in that exact order; the section transitions only after the flush succeeds, while a
failed flush retries with exponential backoff (1_000, 2_000, 4_000… capped at 30_000ms)
showing `offline` blocking when the connection is down and `syncing_reconnect` otherwise, and
clears both blockings only on success; concurrent submit requests with the same fingerprint
await the in-flight attempt instead of duplicating it, and the retry loop re-reads the
runtime state on every iteration so a proctor advance, a phase exit, or a runtime pause
abandons the loop without submitting; the final debounced keystroke is forced into the
durable mirror by the flush itself (no timer wait), so the latest value always reaches the
submission snapshot; and the unanswered-question confirmation shows accurate answered/total/
flagged counts, returns the student to the same question on cancel, and never double-submits
on confirm, while `allow` skips the dialog entirely.

## 2026-08-06: Offline Answer Flow and Browser Storage Failure Contracts (FEX-032/033, F-7)

### Symptom
Plan-driven — one production gap found: **no visible offline status**. While offline with
working browser storage the blocking machine stays disengaged (`blocking.reason` remains
`null`), so before this change the student had no offline indicator at all: the header
received no `autoSaveStatus` even though `StudentAttemptProvider` already surfaced
`attemptSyncState` (`'offline' | 'syncing_reconnect' | 'saving' | 'saved'`, plus a
runtime-emitted `'error'`). Every
other FEX-032/033 behavior already existed (offline typing reaches the durable queue, the
queue replays on reconnect, storage failure blocks input and surfaces the
`storage_unavailable` overlay) but was unverified at the app surface.

### Scope
Owning module only — the student module:
- `src/components/student/StudentApp.tsx` (composition root; the one place that passes the
  header badge, `autoSaveStatus={autoSaveStatus}`).
- `src/components/student/__tests__/StudentApp.test.tsx`
- `src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx`

Read-only context used for citations: `src/services/studentMutationOutbox.ts`,
`src/utils/studentObservability.ts` (`emitStudentObservabilityMetric`),
`src/features/student/infrastructure/studentAttemptGateway.ts` (re-exports
`saveStudentAuditEvent` from `@services/studentAuditService`).

### Gap Matrix

| Bullet | Verdict | Evidence (file:line) | Action |
|---|---|---|---|
| FEX-032: answer entry continues while durable local storage works | NEWLY-PINNED (app level) | `StudentApp.test.tsx:3869-3871` types while offline; `:3880-3892` the durable mirror queues the `answer` mutation with `OFFLINE_TYPED` | — |
| FEX-032: pending mutation count increases | NEWLY-PINNED | `StudentAttemptProvider.test.tsx:336-339` — offline `persistAnswer` takes `pendingMutationCount` 0→1 | — |
| FEX-032: offline status is visible | **FIXED-PRODUCTION-GAP** | Before fix: no header wiring. After fix: `StudentApp.tsx:146-154` derives `autoSaveStatus` from `attemptSyncState` (comment `:140-145`), applied `:670`; pinned by `StudentApp.test.tsx:3865`, `:3901`, `:3955` | **ADDED** GAP-1 wiring (one-way derivation) |
| FEX-032: navigation does not discard answers | NEWLY-PINNED | `StudentAttemptProvider.test.tsx:307-386` — runtime navigation keeps the queue (the navigation itself enqueues its own position mutation, so `pendingMutationCount` only grows, `:352-354`), answers survive (`:353`), and the replay carries `OFFLINE_NAV` to `savePendingMutations` exactly once (filter `:369-377`, assert `:378`, drain `:379`) | — |
| FEX-032: queue replays on reconnect | PINNED-ALREADY + NEWLY-PINNED (app level) | provider `:273-306` pins the provider replay; `StudentApp.test.tsx:3976-3992` dispatches `online` and `clearPendingMutations` follows | — |
| FEX-032: successful acknowledgements remove only accepted mutations | PINNED-ALREADY | `StudentAttemptProvider.test.tsx:273` (queue drains only after the durable flush ack) and `:981` (new answers queued mid-clear not lost) | — |
| FEX-032: latest answers remain visible | NEWLY-PINNED | `StudentApp.test.tsx:3902-3903` (`OFFLINE_TYPED`), `:4001-4002` (`RECONNECT_TYPED` still in the workspace input) | — |
| FEX-032: offline surface clears only after the flush succeeds | NEWLY-PINNED | `StudentApp.test.tsx:3990-3992` — `'Offline'` gone and `'Saved'` shown only after `advanceTimersByTime` has driven the flush to `clearPendingMutations` (`:3976-3992`) | — |
| FEX-033: input mutation is blocked once it is unavailable | NEWLY-PINNED (app) | `StudentApp.test.tsx:4065-4067` locks the disabled fieldset and `:4070-4078` refuses edits + flag; provider keeps RAM `:1613-1614` | — |
| FEX-033: existing visible answer is not cleared | NEWLY-PINNED (app) | `StudentApp.test.tsx:4076-4078` (`FIRST` untouched, `'Unflag'` absent) | — |
| FEX-033: warning explains new answers cannot be safely stored | NEWLY-PINNED | `StudentApp.test.tsx:4058-4061` — `Answer storage unavailable` heading + `/Your browser cannot safely store new answers/i` copy | — |
| FEX-033: recovery removes the block only after storage is usable | PINNED-ALREADY | `StudentAttemptProvider.test.tsx:2765` — sticky `storage_unavailable` clears only after the pending save succeeds + confirmation (M7) | — |
| FEX-033: audit and observability hooks are invoked once | NEWLY-PINNED | `StudentAttemptProvider.test.tsx:1618-1701` — a durable persist failure fires the `student_pending_persist_failure_total` metric and one `PERSISTENCE_STORAGE_ERROR` audit (`:1662-1664`), a later successful save fires neither (`:1686-1696`) | — |

### Fix
One production change and five regression tests, no behavior removed:
- `StudentApp.tsx:146-154` — the only production fix: the header badge is derived one-way
  from `attemptSyncState` (`offline → 'offline'`, `syncing_reconnect → 'syncing'`,
  `saving → 'saving'`, `saved → 'saved'`, everything else — including `error`, which owns
  the full-screen `storage_unavailable` overlay, and `idle` — silently null). Applied at
  `:670`.
- `StudentApp.test.tsx:3832` pins offline status visible + offline typing reaching the
  durable queue; `:3913` pins the live transition: `'Offline'` remains until the replay
  flush actually syncs, then `'Saved'` appears and the latest `RECONNECT_TYPED` answer is
  both persisted and visible in the workspace. The tail drives the recovery loop
  deterministically with explicit `act` + `vi.advanceTimersByTime` rounds (`:3976-3992`)
  because `waitFor` makes no auto-advance under Vitest fake timers. `:4012` pins FEX-033
  blocking.
- `StudentAttemptProvider.test.tsx:307` pins navigation-does-not-discard + replay-exactly-once;
  `:1618` pins metric/audit-exactly-once with `vi.spyOn` on the same module
  instances the provider imports (`studentObservabilityUtilsModule`/`studentAttemptFacadeModule`,
  `:13-14`), restored in `finally`.

### Regression Protection
- `npx vitest run src/components/student/__tests__/StudentApp.test.tsx` → **Tests 46 passed (46)**;
  the 19 "not wrapped in act" occurrences match the pre-existing baseline (zero new),
- `npx vitest run src/components/student/__tests__/StudentApp.test.tsx -t "FEX-032|FEX-033"` → **3 passed** | 43 skipped, zero act warnings.
- `npx vitest run src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx` → **Tests 55 passed (55)**, zero `act()` warnings (the provider file's zero-warning bar is kept).
- All new tests use `vi.useFakeTimers()` + `finally { vi.useRealTimers(); }` and restore every descriptor/spy in `finally`; no module-level `vi.mock`s added.

### Invariant
The student's offline answer flow is a durable outbox that the UI never misrepresents: while
the network is down, typing must keep working into RAM and into the durable mutation queue
(pending count rises, `offline` badge visible), runtime navigation must never discard queued
answers; when `online` fires the queue replays and the header leaves `offline` only once the
flush actually synchronizes (the intermediate `syncing` badge is produced by the mapping but
not separately pinned by a test), at which point only accepted
mutations leave the queue and the latest answer remains visible in the workspace; and when
browser storage fails instead, the `storage_unavailable` overlay blocks further input, never
clears the visible answer, explains the failure, its blocking flag stays until storage is
usable again, and the failure is reported on exactly once per durable persist failure —
a single `student_pending_persist_failure_total` metric and a single
`PERSISTENCE_STORAGE_ERROR` audit on the very first failure, with later successful saves never
firing additional hook calls.

## 2026-08-06: Immediate Local Feedback and Durable Mirror Contracts for Student Answers (FEX-030/031, F-6)

### Symptom
No incident. The invariant test plan required pinning two student-side answer contracts end to
end: **FEX-030 immediate local feedback** — an answer edit is reflected in the UI
synchronously, pending-save state appears without blocking typing, and an older backend poll
can never erase the local answer; and **FEX-031 durable mirror** — typing mutations debit
through the configured short debounce, discrete choices persist immediately, answers near the
final-time boundary persist immediately, blur / pagehide / beforeunload / visibilitychange /
freeze / window-blur all flush durability, and failed browser storage activates the
`storage_unavailable` block.

### Scope
Owning module only: `src/components/student/providers/StudentAttemptProvider.tsx` (durable mirror
wiring, `forceImmediateDurability` at the 20-second boundary, lifecycle flush listeners) with its
suite `src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx`. Read-only
context used for citations: `studentMutationOutbox.ts` (`buildQueuedMutationUpdate` durability
branch) and `QuestionRenderer.matrix.test.tsx` (renderer input-value binding). No production code
changed; behavior unchanged — the new tests pin behavior that already existed.

### Gap Matrix

| Bullet | Verdict | Evidence (file:line) | Action |
|---|---|---|---|
| FEX-030: UI reflects the answer synchronously | Already pinned | RAM-immediate test `StudentAttemptProvider.test.tsx:1281` asserts `state.attempt?.answers.q1 === 'ABC'` before any durable flush (:1296); renderer matrix `QuestionRenderer.matrix.test.tsx:440-443` (text input) and :329-333 (radios) pin `answer prop → rendered input value`. The provider state is the single source the renderers bind to | — |
| FEX-030: pending-save state appears without blocking typing | Already pinned | `:928` types a second answer while a flush is still in flight; `:981` keeps `pendingMutationCount` visible (1) while typing mid-clear; `:1037` preserves the final answer across a latency overlap | — |
| FEX-030: a backend poll with an older snapshot cannot erase the local answer | Already pinned | stale-snapshot quartet: `:2041` (keeps local answers after a successful flush), `:2107` (a fresher snapshot wins), `:2178` (equal freshness + local mutation signals keep local), `:2255` (preview mode preserved) | — |
| FEX-031: typing mutations use the configured short debounce | Already pinned | `:1281` (exactly 100ms, no write before it), `:1502`/`:1530` (focusout rescue), writing coalescing `:582`/`:605` | — |
| FEX-031: discrete choices persist durably immediately | Already pinned | `:1316` — discrete selection writes without waiting for the debounce window; a second save is never issued | — |
| FEX-031: answers near the final time boundary persist immediately | **GAP — boundary exists, unpinned** | `StudentAttemptProvider.tsx:125` (`BOUNDARY_IMMEDIATE_DURABILITY_THRESHOLD_SECONDS = 20`), `:548-553` (`forceImmediateDurability` when exam phase + `currentSectionRemainingSeconds ∈ [0,20]`) → `studentMutationOutbox.ts:694-699` (`durableWriteMode: 'immediate'`) + `:705` (`delayMs: 0` under the boundary). No test asserted durable-persistence timing with `remaining ≤ 20` (a pre-existing test at `:605` already drives the value) | **ADDED** 3 tests: inside-boundary typed answer persists durably immediately (:1349), 21s stays debounced (:1394), boundary skips the durable debounce for writing answers too (:1439) |
| FEX-031 life-cycle flush: blur / focusout | Already pinned | `:1502` (input blur), `:1530` (DOM-rescue focusout pins the raw typed value) | — |
| FEX-031 life-cycle flush: pagehide + beforeunload | Already pinned | `:1750` `window.pagehide`/`window.beforeunload` | — |
| FEX-031 life-cycle flush: freeze + window blur | Already pinned | `:1784` `window.blur` + `document.freeze` | — |
| FEX-031 life-cycle flush: visibilitychange (hidden) | **GAP — listener exists, unpinned** | `StudentAttemptProvider.tsx:674-679` flushes on `document.visibilityState === 'hidden'`; no test dispatched `visibilitychange` | **ADDED** hidden → immediate durable flush; a visible transition with the guard must stay silent (:1818) |
| FEX-031: failed storage activates `storage_unavailable` | Already pinned | `:1577` persist failure → RAM kept, syncState `error`, `blocking.reason === 'storage_unavailable'` (:1614); `:2765` sticky-clear after a confirmed save (M7) | — |

### Fix
Four regression tests added in `StudentAttemptProvider.test.tsx`; no production code change; no
contract violation demonstrated (the new tests confirm the behavior the provider already
implements):
- "persists a typed answer durably immediately once remaining time is inside the 20-second
  boundary" (:1349) — runtime-backed exam with `currentSectionRemainingSeconds: 10`; a
  plain typed `persistAnswer` hits `savePendingMutations` straight away (no 100ms debounce),
  RAM is immediate, and no second write follows the debounce window.
- "keeps the 100ms durable debounce once remaining time moves above the immediate-durability
  boundary" (:1394) — `currentSectionRemainingSeconds: 21`: RAM immediate, but the durable
  write is withheld until the 100ms window (pin-points the boundary direction).
- "applies the final-time boundary to writing answers, skipping the durable debounce"
  (:1439) — the writing_answer mutation reaches the durable mirror with zero timer
  advancement (the writing path's 1500ms figure governs the outbound network flush, which
  is offline in this test; the durable-mirror debounce it skips is the 100ms budget).
- "forces an immediate durable answer flush when the document becomes hidden
  (visibilitychange)" (:1818) — a hidden-transition flushes pending answers at once, a
  still-visible transition must not flush a fresh unsaved answer, and a later hidden
  transition flushes it — using the repo's `Object.defineProperty(document,
  'visibilityState', …)` idiom with descriptor restore in `finally`.

### Regression Protection
- Run (2026-08-06): `npx vitest run src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx`
  → **53 passing** (49 pre-existing + 4 new). The four new tests also pass in isolation
  (`-t "boundary"` → 3 tests, `-t "visibilitychange"` → 1 test).
- Zero `act()` warnings: the full-file run and the isolated runs both emit no "not wrapped in
  act" diagnostics. New tests use `vi.useFakeTimers()` + `finally { vi.useRealTimers(); }`, and
  the `visibilitychange` test additionally restores the `document.visibilityState` descriptor
  in `finally`. No module-level `vi.mock`s added.

### Invariant
`StudentAttemptProvider` persists the LAST typed value durably without mind-reading the editor:
typing is RAM-immediate and durable at 100ms; discrete choices skip the debounce; inside the
final 0–20-second boundary of the exam phase Landed objective AND writing answers skip their
debounce and persist immediately (a failed boundary write when the window is still debounced is
a contract breach); blurrings and every leaving-signal — focusout, visibilitychange-to-hidden,
pagehide, beforeunload, freeze, window blur — flush the durable mirror while non-hidden
visibility transitions never do; and a failed storage write must reach the
`storage_unavailable` blocking state while keeping the RAM answer intact.

---

## 2026-08-06: FEX-021/022 — Slot-Scoped Questions and Writing Editor Draft Lifecycle (F-5)

### Symptom
No incident. The invariant test plan required pinning two student-side flows:
**FEX-021 slot-scoped questions** (sentence-completion / diagram-style blanks) — a slot edit
must change only that slot, fast typing coalesces per slot, slot id+index persist, clearing one
answer must not shift the others, and hydration must not mint new mutations; and
**FEX-022 writing editor** — draft committed before section submission, debounce keeps the latest
value, blur/page-lifecycle persistence, reload restores the draft, large drafts stay responsive,
and the paste policy is applied only where configured.

### Scope
Owning modules only: `StudentWriting.tsx` (editor draft lifecycle), `StudentAttemptProvider.tsx`
and `studentMutationOutbox.ts` (per-slot coalescing + payload shape). Read-only: the FEX-020/F-4
renderer matrix and the outbox coalescing suite. No production code changed; behavior unchanged.

### Gap Matrix

| Bullet | Verdict | Evidence (file:line) | Action |
|---|---|---|---|
| FEX-021: typing in slot 2 changes only slot 2 | Already pinned | `QuestionRenderer.matrix.test.tsx` user-edit cases: every slot arm emits the full array with only the edited slot changed (SENTENCE_COMPLETION ~:776-788, DIAGRAM ~:864-872, FLOW_CHART ~:944-958, TABLE ~:1027-1037, NOTE ~:1182-1198, CLASSIFICATION ~:1266-1275, MATCHING_FEATURES ~:1352-1362). Merge layer: `resolveObjectiveAnswerUpdate.slots.test.ts` "preserves existing slots when updating a different slot" (:96-100) | — |
| FEX-021: fast typing coalesces per slot, not across slots | Already pinned | `studentMutationOutbox.coalescence.test.ts` (same question+slot replace key, different slots kept separate, order preserved); `StudentAttemptProvider.test.tsx` super-fast burst :684, per-slot coalescing :722, different slot indexes :785 | — |
| FEX-021: slot ID and slot index persist | Already pinned | `StudentAttemptProvider.test.tsx` "persists slot identity metadata for slot-scoped answer mutations" :824 asserts `payload.slotIndex`/`slotId`/`slotCount` | — |
| FEX-021: removing one answer does not shift others | **Partially pinned — persistence gap with an EMPTY slot value** | Renderer clear-behavior emits full array with cleared slot + intact siblings (e.g. SENTENCE ~:789-798); merge-layer no-shift `resolveObjectiveAnswerUpdate.slots.test.ts:96-100` | **ADDED** provider test: a clear mutation persists full-array `['', sibling]` under the cleared slot's coalescing key while the sibling slot's pending mutation keeps its value (no shift, no wipe) |
| FEX-021: hydration generates no new mutations | Already pinned | `StudentAttemptProvider.test.tsx` :1946 "does not generate autosave mutations when hydrating existing answers" (no `savePendingMutations`, no `saveAttempt`) | — |
| FEX-022: draft committed before section submission | Already pinned, both paths | `StudentWriting.lifecycle.test.tsx` commits the current draft before opening the submit-review modal; `StudentApp.test.tsx` :686 commits the mounted editor draft before runtime final submission; `useStudentSubmissionOrchestration.ts` calls `commitWritingDraft()` before `submitAttempt()` (:178); legacy manual submit flushes at `StudentApp.tsx:417` | No duplicate — flush-before-submit wiring is owned by FEX-040/F-8 |
| FEX-022: debounced editing keeps the latest value | Already pinned | `StudentTypingPerformance.test.tsx` — 3 rapid changes, exactly one commit with the LAST value | — |
| FEX-022: blur and page lifecycle persist editor content | Already pinned | `StudentWriting.lifecycle.test.tsx` commits on compositionend / pagehide / visibilitychange-hidden / freeze / beforeunload / blur / task switch, with exact whitespace preservation | — |
| FEX-022: reload restores the draft | **GAP — only the null→blank case pinned** | `StudentWriting.a11y.test.tsx` pins blank editor for a null persisted answer; non-null persisted-draft restore unasserted | **ADDED** lifecycle test: fresh mount with a persisted non-null draft restores the editor text; remount same; hydration mints no `onWritingChange` |
| FEX-022: large writing content stays responsive | **Partial gap — >5k-char path unpinned** | debounce pinned for short strings only | **ADDED** >5k-char test: a single debounced commit of the LATEST large value, then a pagehide flush preserving the full final text (no intermediate commits dropping content) |
| FEX-022: paste policy applied only where configured | **Partial gap — positive side unpinned at event level** | clipboard tests pin the BLOCKED side (editor) plus keydown-level block/allow; no positive event-level assertion | **ADDED** positive test: paste/copy/drop on an objective answer control outside the writing editor stays unblocked and audit-free |

### Fix
Four regression tests added; no production code change; no contract violation demonstrated.
- `src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx` — "clears one slot without shifting or wiping its sibling slot answers": clears a slot through the provider; asserts the cleared-slot mutation keeps `['', 'late']` and the sibling-slot pending mutation keeps `['daily', 'late']`.
- `src/components/student/__tests__/StudentWriting.lifecycle.test.tsx` — "restores the persisted writing draft into a freshly mounted editor after reload".
- `src/components/student/__tests__/StudentTypingPerformance.test.tsx` — "commits the latest large draft through the debounce without losing content or spamming commits" (>5k chars, single latest-value commit, pagehide flush with the full final string).
- `src/components/student/__tests__/StudentWriting.clipboard.test.tsx` — "does not block paste, copy, or drop on controls outside the writing editor policy".

Deliberately left uncovered: the flush-before-submit wiring itself (FEX-040/F-8 territory) — the editor-side `registerDraftCommit`/`commitWritingDraft` flush and its end-to-end runtime-submission test already exist; F-5 covered only the editor's own draft-lifecycle edges.

### Regression Protection
- Run (2026-08-06): `npx vitest run src/components/student/providers/__tests__/StudentAttemptProvider.test.tsx src/components/student/__tests__/StudentWriting.lifecycle.test.tsx src/components/student/__tests__/StudentWriting.clipboard.test.tsx src/components/student/__tests__/StudentTypingPerformance.test.tsx` → **68 passing across 4 files** (49 + 11 + 3 + 5). All four new tests pass in isolation with zero `act()` warnings; no new module-level `vi.mock`s added.
- One pre-existing `act()` warning surfaces in `StudentWriting.lifecycle.test.tsx` ("commits blur draft and allows a subsequent edit after refocus" — `vi.runAllTimers()` outside `act`); that test body was not modified (this task's diff to the file is add-only).

### Invariant
Per-slot mutations are coalescing-key-scoped and always persist the FULL answer array — clearing one slot (even to `''`) must never shift or drop sibling slot values. The writing draft reaches a durable commit at every exit point (blur, pagehide, freeze, beforeunload, task switch, review, section submit) with the LATEST content; reload restores it from persisted state; hydration never synthesizes a mutation; and the clipboard guard stays scoped to the writing editor surface.

---

## 2026-08-06: FEX-020 — Uniform Per-Renderer Contract Matrix for QuestionRenderer (F-4)

### Symptom
No incident. The renderer had grown to 14 `block.type` dispatch arms
(`src/components/student/QuestionRenderer.tsx`) with a mix of plain radio/checkbox/select
controls, `ProtectedInput` text paths, and slot-indexed `updateIndexedAnswer` paths. The
invariant test plan (FEX-020, task F-4) required every question type to be pinned against
9 uniform dimensions (accessible label, initial hydrated value, user edit, mutation metadata,
clear behavior, keyboard navigation, flag behavior, rerender preservation, reload hydration).
Many cells of that matrix were unpinned: TFNG, CLOZE, MAP, MATCHING, FLOW_CHART and
NOTE_COMPLETION had no direct `QuestionRenderer` tests at all, and no renderer test asserted
accessible labels, flag wiring, keyboard reachability, or reload hydration.

### Scope
Student objective question rendering module only: `QuestionRenderer.tsx`, `ProtectedInput.tsx`,
`ProtectedSelect.tsx`, `ProtectedChoiceInput.tsx`, `TableCompletionSlotCell.tsx`,
`resolveObjectiveAnswerUpdate.ts`, `resolveSharedStudentAnswerMeta.ts`. No production behavior
changed.

### Root Cause
None (matrix pass). Every dispatch arm already emitted the expected value shape, meta shape
(slot types: `UpdateIndexedAnswer` with `slotIndex/slotId/slotCount/slotValue/interactionType:
'typing'`; MULTI_MCQ: `{ arrayUpdateMode: 'replace', interactionType: 'discrete' }`; scalar
non-slot types: no meta), live-answer registration, and accessible labels. No production-code
fix was required.

### Fix
- Added `src/components/student/__tests__/QuestionRenderer.matrix.test.tsx` (129 tests) —
  13 `describe` blocks covering all 14 render arms, parameterized across CLOZE/MAP/SHORT_ANSWER
  where the ProtectedInput text path is genuinely identical, plus a multi-slot
  TABLE_COMPLETION describe for the inline-input cell variant.
- The flag contract is asserted on BOTH sides: slot-based types render one
  `aria-label="Flag question"`/`"Unflag question"` button per slot (invokes `onToggleFlag(slotId)`
  and flips label with the `flags` prop), and TFNG/CLOZE/MATCHING/MULTI_MCQ/MAP/SINGLE_MCQ/
  SHORT_ANSWER intentionally render none — flagging for those is owned by the parent
  (`StudentQuestionBlockSection.FlagButton`). Note, not a violation: the parent `FlagButton`
  (StudentQuestionBlockSection.tsx:40-80) exposes only a `title` and no `aria-label` or
  `aria-pressed`; any fix belongs to the parent module, which is out of scope for this task.

### Regression Protection
- Tests: `src/components/student/__tests__/QuestionRenderer.matrix.test.tsx` (129 tests,
  14×9 matrix with table-extra slot meta variants). Verified run (2026-08-06):
  `npx vitest run QuestionRenderer.matrix.test.tsx StudentQuestionExperience.test.tsx
  ProtectedInput.test.tsx ProtectedSelect.test.tsx ProtectedChoiceInput.test.tsx
  TableCompletionSlotCell.test.tsx SubAnswerTreeQuestionList.test.tsx
  resolveObjectiveAnswerUpdate.test.ts resolveObjectiveAnswerUpdate.slots.test.ts` →
  241 passing across 9 files (matrix 129 + StudentQuestionExperience 45 + controls/resolvers 67);
  zero `act()` warnings from the matrix file.
- Note: the matrix run surfaced a pre-existing React key warning in `renderFlowChart`
  (`QuestionRenderer.tsx` maps `steps` to slot fields without a `key`; the sibling
  `renderDiagramFallbackFields` wraps in keyed Fragments). Not a contract violation — the
  warning is invisible in production and out of this task's scope; tracked as a follow-up.
- Diagnostics: none added beyond the matrix.

### Invariant
For every objective renderer arm: (1) every answer control exposes an accessible label and
radios share one `name` group; (2) `onChange` always emits the real answer value (option id,
heading roman, option-id array, or full slot array) plus the exact meta the dispatch arm
declares; (3) slot edits always emit the FULL array so one slot can be cleared without
touching its siblings; (4) scalar non-slot edits and the flag button never drop or invent
meta; (5) reload hydration relies solely on the `answer` prop — the controls are fully
controlled, so there is no internal state that could desync from persisted reality.
Keep the matrix in sync whenever a new renderer arm is added to `QuestionRenderer.tsx`.

---

## 2026-08-05: Second Client Session Can Silently Overwrite Accepted Answers (Missing Mutation Base-Revision Gate)

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

---

## 2026-08-06: Paused Exam Countdown Kept Draining and the Zero Latch Survived a Verified Deadline (FEX-011, F-3)

### Symptom
While a student's exam was paused, the visible countdown kept decreasing toward the old
deadline (local drift). For a proctor pause — the attempt reports `proctorStatus: 'paused'`
while the cohort runtime snapshot still reports `live` — the display drained to 0
mid-pause and latched at 0. After a resume whose new authoritative deadline was verified by
the paused-time accumulation (cohort pause, BEX-021), the display stayed at 0 and answers
stayed locked: the new deadline never reached the UI. A student whose exam was paused at the
moment the deadline expired permanently lost the extended time on resume.

### Scope
`src/components/student/providers/StudentRuntimeProvider.tsx` — the runtime-backed display
derivation (`resolveRuntimeDisplayRemainingSeconds`), the timer identity
(`buildRuntimeTimerIdentity`), and the monotonic display guard / zero latch that key off that
identity. No other modules were affected.

### Root Cause
1. The deadline-derived countdown had no pause gate: `resolveRuntimeDisplayRemainingSeconds`
   computed `deadline − now` whenever the runtime snapshot was `live` and the section was
   `live`/unpaused, even while a proctor pause was in effect (the cohort runtime stays `live`
   during an individual proctor pause, so no runtime signal flagged it). A runtime-status
   pause already froze correctly (the paused projection has no live deadline and the function
   falls back to the frozen server remaining) — only the proctor-pause signal was missing.
2. The timer identity (`sectionKey:extensionMinutes`) does not change across a pause → resume
   (the backend never touches `extensionMinutes` for a pause; it extends the deadline via
   `accumulatedPausedSeconds`/`totalPausedSeconds`). So after a verified resume the monotonic
   `Math.min` guard clamped the display to the pre-resume value (0) and the zero latch
   (`localZeroTimerIdentityRef`) never cleared — the timer stayed locked even though the
   server had legitimately extended the deadline.

### Fix
- `resolveRuntimeDisplayRemainingSeconds` accepts a `paused` flag; while a pause is in effect
  (`proctor_paused` or `cohort_paused` blocking reason) it returns the frozen server remaining
  instead of draining toward the old deadline. The flag is derived from the single source of
  truth for pause state (`blocking.reason`), so individual proctor pauses, cohort pauses, and
  blocking-machine-driven pauses all freeze the countdown.
- `buildRuntimeTimerIdentity` now includes the active section's `accumulatedPausedSeconds`.
  Resume bumps it server-side (BEX-021), so the identity changes exactly when a verified new
  authoritative deadline re-anchors the timer: the monotonic display guard resets and the
  zero latch clears, letting the countdown unlock and tick from the extended deadline. The
  release gate is untouched: an unverified later deadline (same section, same extension, same
  paused accumulation) still cannot apply.
- Metrics note: during a proctor pause the display holds while the observability loop keeps
  re-baselining the draining deadline math, so `student_timer_tick_expected_total` is
  suppressed for the pause duration — a metrics-contract nuance for SLO owners. The stall
  detector never fires off the frozen display (it compares observations to expectations, both
  of which stay aligned during the pause).

### Regression Protection
- Tests: `src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx`:
  - "holds the countdown steady during a proctor pause while the runtime stays live"
  - "holds the countdown steady while the runtime itself is paused"
  - "re-anchors the countdown to the new authoritative deadline after a cohort pause and resume"
  - "unlocks the timer and ticks again from the extended deadline when a resume follows a
    pause that froze the countdown at zero"
  - "rejects an unverified later deadline after a proctor pause resumes (release gate holds)"
  - "freezes the countdown at the pause-instant value across a live→paused transition (and
    across a snapshot refresh during the pause)"
  - "continues the countdown from the server deadline after a fresh mid-exam mount (reload)"
  - Fixture fix in `timerReleaseGate.test.tsx` (synthetic attempt now completes its pre-check):
    before it the tests booted to the pre-check phase and rendered an empty timer, so their
    text assertions failed on the clean tree (`''.includes('8')` is false in jest-dom, it
    does not pass vacuously). With the repair they boot into the exam phase and genuinely
    pin the release gate (pre-existing defect, failing at HEAD).
- Rules/Docs updated: this file; `StudentRuntimeProvider.tsx` comments.

### Invariant
While a pause is in effect the client countdown must never drain toward the old deadline.
Two pause kinds are intentional and distinct: a **cohort** pause freezes the deadline
server-side (BEX-021 — deadline null, remaining frozen, resume bumps the section's
`accumulatedPausedSeconds` and re-issues a later deadline), so the display holds the frozen
server value until the new authoritative deadline; an **individual proctor** pause does NOT
freeze the deadline server-side, so the client holds the pause-instant value (answers locked
throughout) and the display catches down on resume — no extra time ever accrues, and an
unverified later deadline is still rejected by the release gate. Only a verified new
authoritative deadline (a resume re-anchor, or a granted extension) may move the displayed
remaining time. The zero latch and monotonic display guard must never survive a verified
resume.

## 2026-08-06: Dev/E2E Proxy Rewrote Host, Breaking CSRF Origin Validation (e2e infra, E2E-01 prep)

### Symptom
First-ever e2e run against a real test database (Railway MySQL, repointed from TiDB Cloud
in `backend/.env`) failed the student flow: `POST /api/v1/student/sessions/:id/bootstrap`
returned 403 `CSRF_REJECTED "Origin validation failed."` and the session route rendered
"Loading Error". Instrumented replay (`page.on('response')`) showed the exact failing
request: bootstrap 403 while `GET .../static` and `GET .../live` were 200. The check-in POST
(`/api/v1/auth/student/entry`) passed because it has no `VerifiedCsrf` extractor.

### Root cause
`vite.config.ts` proxied `/api` with `changeOrigin: true`, which rewrites the Host header to
the backend origin (`localhost:4000`) while the browser's `Origin: http://localhost:3000`
header is forwarded unchanged. The backend's same-origin CSRF heuristic
(`backend/crates/api/src/http/auth.rs:180-194`, `same_origin_allowed`:
Origin/Referer must contain Host) then rejects every CSRF-protected POST in dev. Only
`auth.rs` reads the Host header (`backend/crates/api/src/http/auth.rs:116`), so rewriting it
was safe to disable. Production is unaffected: the built frontend is served same-origin by
the backend, so Host/Origin already agree.

### Fix
`vite.config.ts` `/api` proxy: `changeOrigin: false` (+ comment). The proxy now preserves
the browser's Host, matching the production same-origin topology. Verified: bootstrap and
precheck POSTs return 200, the full student flow reaches the exam, and
`e2e/smoke.spec.ts` passes 10/10 (chromium).

### Environment note (second failure in the same session)
Seed-written storage states (`e2e/.generated/*.storage-state.json`) contain cookies named
`session`/`csrf` because `e2e/global-setup.ts:47-50` forces
`AUTH_SESSION_COOKIE_NAME=session`, `AUTH_CSRF_COOKIE_NAME=csrf`, `AUTH_COOKIE_SECURE=false`
into the seed's env. Playwright's `webServer` env applies the same overrides to the backend
it starts (`playwright.config.ts:4-8`), so the pairs match — but a backend started manually
(plain `./target/debug/ielts-backend-api` with only `backend/.env`) uses the config.rs
defaults `__Host-session`/`__Host-csrf` and rejects the storage-state sessions with 401
"Authentication is required for this route." Symptom: admin/builder/proctor tests pass
(they do not assert authenticated data), but `startLobbyIfPresent`'s runtime-commands POST
401s. Always run e2e with Playwright's webServer-managed backend (or export the same
AUTH_* overrides); never mix a manually started backend with e2e storage states.

### Regression Protection
`e2e/smoke.spec.ts` "student exam interface loads with proper accessibility" now exercises
the CSRF-protected bootstrap POST through the proxy and fails on any origin-validation
regression. `git diff` of `vite.config.ts` is one line of behavior (`changeOrigin`) plus
comment.

## Student UI blind to per-attempt proctor pause (E2E-02)

### Failure
A proctor pauses an individual student attempt (`POST /api/v1/proctor/sessions/:scheduleId/attempts/:attemptId/pause` → 200, `student_attempts.proctor_status` set to `paused`). The student session keeps polling `/live` (every response carries `attempt.proctorStatus: "paused"`) and receives a WS `attempt` event, but the UI never shows the "Individual session paused" blocking overlay and the workspace stays fully interactive — including after a reload.

### Root cause
`mapBackendStudentAttempt` (`src/services/studentAttemptRepository.ts`) hardcoded `proctorStatus: 'active'`, `proctorNote: null`, `proctorUpdatedAt: null`, `proctorUpdatedBy: null`; the `BackendStudentAttempt` interface did not even model the fields, and no code path read `payload.proctorStatus`. The blocking-overlay machinery (`StudentRuntimeProvider.tsx:603` — `attemptSnapshot?.proctorStatus === 'paused' ? 'proctor_paused' : null`, blocking state machine, FEX-060/061 unit tests) existed but could never fire from the API path. Server-side integrity held regardless: answer mutations are gated with `DeliveryConflictReason::AttemptProctorBlocked`, so persisted data honored the pause while the UI contradicted it — violating "Student-visible 'saved/verified' state must match persisted reality."

### Fix
`BackendStudentAttempt` gained optional `proctorStatus`/`proctorNote`/`proctorUpdatedAt`/`proctorUpdatedBy`; the mapper passes them through, defaulting to the historical `'active'`/`null` values when the payload omits them (no behavior change for older payloads or unit fixtures). Unit tests pin both directions: paused-state pass-through and active default.

### Regression Protection
- Unit: `src/services/__tests__/studentAttemptRepository.backend.test.ts` — mapper pass-through + default tests.
- E2E: `e2e/e2e-02-reload-every-phase.spec.ts` pause phase asserts the overlay renders while paused, the answer field is disabled, and the overlay is restored after a mid-pause reload (these were characterization pins pre-fix).
