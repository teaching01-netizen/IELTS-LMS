# Student Exam Behavior Test Plan

## 1. Target behavior

The production student journey should behave as follows:

```text
Open scheduled exam
        ↓
Authenticate and bootstrap attempt
        ↓
Exam briefing and silent device pre-check
        ↓
Persist pre-check successfully
        ↓
Waiting room
        ↓
Proctor starts runtime
        ↓
Student workspace opens automatically
        ↓
Answer locally and synchronize to backend
        ↓
Submit current section
        ↓
Wait for proctor-controlled section advance
        ↓
Runtime completes
        ↓
Flush remaining answers
        ↓
Finalize attempt
        ↓
Show confirmed post-exam state
```

The implementation currently follows the important rule that a production student cannot start the exam. After pre-check completion, the student stays in the lobby until the server runtime becomes `live` or `paused`. The runtime deadline, rather than a browser-owned countdown, determines remaining time.

The student attempt layer maintains an in-memory answer state, a durable pending-mutation mirror, offline replay, lifecycle-event flushing, server revision comparison, and recovery checkpoints. Typing is debounced, while discrete actions and answers close to a time boundary receive more immediate durability.

---

## 2. Critical behavior decision

### P0: Unconfirmed submission state

The current attempt provider treats a failed immediate submit as locally completed:

1. It sets the attempt phase to `post-exam`.
2. It creates a local `submittedAt`.
3. It returns success to the submission orchestration.
4. It retries submission in the background for up to one hour.

At the same time, `submittedAt` is treated as a verified terminal condition.

**Recommended production contract:**

* A failed submit may lock the exam against further editing.
* The UI must show **“Submission pending”**, not **“Exam submitted”**.
* Confirmed completion must require a backend submission receipt or authoritative submitted attempt.
* Reloading during pending submission must resume the retry state.
* The student must not lose the final local snapshot while retrying.

This should be resolved before treating the final submission behavior as production-safe.

---

# 3. Backend behavior tests

The main backend locations should be:

```text
backend/tests/contracts/student_contract.rs
backend/tests/integration/exam_lifecycle.rs
backend/tests/integration/mutation_replay.rs
backend/tests/integration/revision_tracking.rs
backend/tests/contracts/grading_contract.rs
```

Existing contract coverage already includes pre-check persistence and idempotency, bootstrap, mutation persistence, heartbeat behavior, audit events, submission idempotency, final answer patches, and crash recovery.

## A. Access and attempt ownership

### BEX-001 — Student opens an enrolled schedule

**Given:** The student is registered for the schedule.
**When:** They request the static and live session context.
**Then:**

* The schedule and published exam version are returned.
* Runtime status is returned.
* No attempt is created from a read-only request.
* The student cannot read another candidate’s attempt.

### BEX-002 — Schedule credential mismatch

Test these independently:

* Attempt token belongs to another schedule → `403 FORBIDDEN`.
* Request body contains another attempt ID → `422 VALIDATION_ERROR`.
* Expired attempt token → `401 UNAUTHORIZED`.
* Student is not enrolled → `403 FORBIDDEN`.

The API already performs separate schedule-claim and body-attempt validation; tests should assert both status and error code.

### BEX-003 — Active client-session ownership

**Given:** Session A owns an attempt.
**When:** Session B submits stale or conflicting mutations.
**Then:**

* The documented multi-session rule is applied consistently.
* Conflicts include `activeSessionId` where relevant.
* The accepted server revision and mutation watermark are returned.
* No answer from the valid session is silently overwritten.

---

## B. Pre-check and waiting-room boundary

### BEX-010 — Pre-check creates or updates the attempt

Verify:

* Candidate identity comes from authorized enrollment, not trusted request fields.
* Device fingerprint and check results are persisted.
* Attempt phase becomes `lobby`.
* Exactly one audit event is created.
* The response returns the authoritative attempt.

### BEX-011 — Pre-check idempotency

Test:

* Same idempotency key and same payload → same response, no duplicate audit.
* Same key and different payload → `409 CONFLICT`.
* Retry after client timeout → attempt remains valid and singular.
* Two simultaneous identical requests → one logical result.

### BEX-012 — Pre-check cannot start runtime

Submitting pre-check must not:

* Start the exam runtime.
* Set the section deadline.
* Change runtime status to `live`.
* Expose section content through an unauthorized endpoint.

---

## C. Runtime and timer authority

### BEX-020 — Proctor controls exam start

**Given:** Student has completed pre-check.
**When:** Runtime remains `not_started`.
**Then:** Live context continues returning waiting-room state.

**When:** Proctor starts runtime.
**Then:**

* Runtime becomes `live`.
* Current section is assigned.
* Deadline and remaining seconds are returned.
* Repeated start commands do not create duplicate section starts.

### BEX-021 — Pause and resume

Verify:

* Pause freezes the effective deadline.
* Repeated pause is idempotent.
* Resume accounts for accumulated paused time.
* Student heartbeat does not accidentally resume the exam.
* Individual proctor pause and cohort pause remain distinguishable.

### BEX-022 — Section advance

Test:

* Student cannot authoritatively advance the cohort.
* Submission marks the student section complete without unlocking an unavailable section.
* Proctor advance exposes the next section.
* Late mutations from the old section return the expected section-lock conflict.
* Repeated advance does not skip a section.

### BEX-023 — Runtime completion

Runtime is only structurally complete when the completion contract is satisfied:

* Status is `completed`.
* An actual end time exists, or no current section remains, or all sections are completed.
* A transient `completed` status with incomplete section data must not finalize the student attempt.

---

## D. Mutation and answer persistence

### BEX-030 — Supported mutation commands

Create contract cases for:

* Set and clear scalar answer.
* Set and clear choice.
* Set and clear answer slot.
* Set and clear writing text.
* Set flag.
* Unicode and multiline values.
* Empty values versus explicit clear operations.

The public API accepts an operation-command batch and returns a full authoritative response. It also maintains an allowlisted legacy payload path.

### BEX-031 — Validation

Reject:

* Unknown top-level fields where the strict contract applies.
* Unknown mutation type.
* Missing question or task ID.
* Invalid slot index.
* Oversized mutation batch.
* Malformed choice value.
* Attempt ID mismatch.
* Mutation for a nonexistent exam target.

No partial state should be persisted when the whole batch is invalid.

### BEX-032 — Revision conflict

**Given:** Server revision is `N`.
**When:** A mutation uses an invalid base revision.
**Then:**

* Return `409 CONFLICT`.
* Include `latestRevision`.
* Include the accepted mutation sequence watermark.
* Preserve the server’s current answers.

### BEX-033 — Mutation idempotency

Test:

* Same mutation ID replayed → applied once.
* Same idempotency key and identical batch → stable response.
* Same key and different batch hash → conflict.
* Duplicate mutation appears in another client session → no duplicate application.
* Retry after a network timeout → no answer duplication.

### BEX-034 — Batch transactionality

Inject a database failure in the middle of a batch.

Expected:

* No partial answer snapshot.
* No partial revision increment.
* No partial mutation-watermark movement.
* Retry can safely apply the complete batch.

### BEX-035 — Question-type round trip

For every supported IELTS question type:

```text
Frontend answer value
    → mutation command
    → database representation
    → hydrated attempt
    → grading input
```

Assert semantic equality after the complete round trip.

Include:

* Single answer.
* Multi-select.
* True/False/Not Given.
* Matching.
* Sentence completion with several slots.
* Diagram labels.
* Writing tasks.
* Cleared answers.
* Case variants where grading rules permit them.

---

## E. Offline recovery and replay

### BEX-040 — Reconnect replay

**Given:** Several offline mutations exist.
**When:** The client reconnects and replays them.
**Then:**

* Mutations are applied in a deterministic order.
* Server watermark advances correctly.
* Latest answer wins according to the defined mutation semantics.
* No accepted mutation is lost during chunking.

### BEX-041 — Replay across section transition

Test pending mutations created immediately before:

* Timer expiry.
* Proctor section advance.
* Runtime pause.
* Final completion.

Expected behavior must be explicit:

* Accept within the configured grace boundary, or
* Reject with a structured section-lock reason.

Never return generic failure for an expected transition conflict.

### BEX-042 — Crash recovery

After browser crash and bootstrap:

* Existing attempt is returned.
* Current runtime section is authoritative.
* Server revision is returned.
* Already accepted mutations are not replayed twice.
* Pending client mutations can continue from the accepted watermark.

---

## F. Heartbeat, audit, and integrity

### BEX-050 — Heartbeat acknowledgement

Verify:

* Regular heartbeat can use acknowledgement-only mode.
* It does not increment answer revision unnecessarily.
* Full mode returns runtime hydration.
* Credential refresh is accepted and returned.

### BEX-051 — Network transitions

Disconnect, reconnect, and heartbeat-lost events must:

* Update the correct integrity fields.
* Produce one logical audit/live event.
* Be idempotent under retry.
* Never modify answers.

### BEX-052 — Violation identity

Test repeated audit delivery using the same violation business ID:

* One violation record.
* One snapshot entry.
* No duplicate proctor alert.
* Invalid severity is rejected or ignored according to contract.
* Student cannot forge another attempt’s violation.

---

## G. Section and final submission

### BEX-060 — Section submission requires accepted answers

Before marking a section complete:

* Required pending mutations must be accepted.
* Client and server sequence information must be checked.
* A sequence gap without a final patch returns `FINAL_FLUSH_REQUIRED`.
* A valid final patch can reconcile a stale last-seen revision.

### BEX-061 — Final snapshot hash

Test:

* Matching hash → submission accepted.
* Mismatching hash → structured conflict.
* Same logical JSON with different key order → same canonical hash.
* Unicode content hashes consistently.
* Writing HTML is hashed without accidental normalization differences.

### BEX-062 — Submit idempotency

The submit API requires an idempotency key.

Test:

* Missing key → `422`.
* Empty key → `422`.
* Same key and same payload → same receipt.
* Same key and different payload → conflict.
* New key after successful submission → same terminal attempt without duplicate grading.
* Concurrent submit requests → exactly one submission ledger entry.

### BEX-063 — Post-submit mutation grace

Test both sides of the grace boundary:

* Mutation arrives just inside grace → accepted and reflected in final snapshot.
* Mutation arrives just outside grace → rejected with `ATTEMPT_SUBMITTED`.
* Replaying an already accepted mutation after submission remains idempotent.
* Grading never starts from an older snapshot than the finalized submission.

---

## H. Grading and results

### BEX-070 — Objective grading

For each objective question type:

* Exact correct answer.
* Incorrect answer.
* Blank answer.
* Extra whitespace.
* Case handling.
* Shared answer pool.
* Duplicate answer consumption.
* More blanks than available valid answers.

### BEX-071 — Submission-to-grading consistency

Assert that:

* Grading reads the final immutable submission snapshot.
* Later attempt-cache changes cannot affect results.
* Re-running grading produces the same result.
* Objective score totals equal per-question awarded marks.
* Writing answers remain available for manual or AI-assisted grading.

---

## I. Concurrency and capacity

### BEX-080 — Exam-start fan-out

Simulate many students polling while the proctor starts the exam:

* No inconsistent runtime status.
* No missing deadline.
* No duplicate attempts.
* Schedule and global rate limits return structured retry information.

### BEX-081 — Submit storm

For many simultaneous submissions:

* Stable latency target.
* No connection-pool exhaustion.
* No duplicate receipts.
* No answer-loss telemetry.
* Retries remain idempotent.

---

# 4. Frontend behavior tests

Primary locations:

```text
src/components/student/__tests__/
src/components/student/providers/__tests__/
src/services/__tests__/
e2e/
```

The current `StudentAttemptProvider` tests already cover many difficult persistence cases, including offline queues, writing replay, typing coalescing, in-flight flush races, lifecycle flushing, checkpoint recovery, storage failure, stale backend snapshots, and newer authoritative snapshots.

## A. Exam entry

### FEX-001 — Briefing content

Verify visible content:

* Exam title.
* Candidate name and ID.
* Enabled sections only.
* Configured section durations.
* Correct total duration.
* Timer and reconnection guidance.
* No technical compatibility checklist.
* No production **Start Exam** button.

### FEX-002 — Continue to waiting room

**When:** Student selects **Continue to waiting room**.
**Then:**

* Button shows pending state.
* Duplicate clicks produce one request.
* Lobby is not shown before persistence succeeds.
* Failure keeps the student on the briefing.
* Retry preserves the same device-check result and idempotency identity.

### FEX-003 — Waiting room

Verify:

* Waiting message remains visible.
* No answer inputs are mounted.
* No section content is present in the DOM.
* No student start action exists.
* Runtime polling continues.
* Runtime `live` or `paused` automatically opens the workspace.

Existing Playwright coverage already verifies the briefing, waiting state, hidden technical checks, persisted pre-check, absence of a student start button, and absence of answer controls before proctor start.

---

## B. Runtime hydration and timer

### FEX-010 — Authoritative phase mapping

Parameterize:

| Pre-check | Runtime                                 | Attempt terminal state | Expected UI                |
| --------- | --------------------------------------- | ---------------------- | -------------------------- |
| Missing   | Any nonterminal                         | No                     | Briefing                   |
| Complete  | `not_started`                           | No                     | Waiting room               |
| Complete  | `live`                                  | No                     | Exam                       |
| Complete  | `paused`                                | No                     | Exam with blocking overlay |
| Complete  | `completed` but structurally incomplete | No                     | Do not show false success  |
| Complete  | Structurally complete                   | Yes                    | Finalization/post-exam     |
| Any       | Any                                     | Proctor terminated     | Terminated view            |

### FEX-011 — Server deadline timer

Use fake clocks to verify:

* Countdown is calculated from the server deadline.
* Browser clock offset is applied.
* Rerender does not reset time.
* Reload continues from the server deadline.
* Background-tab throttling does not extend the exam.
* Pause prevents local countdown drift.
* Resume uses the new authoritative deadline.

### FEX-012 — Stale runtime response

Deliver runtime responses out of order.

Expected:

* An older `not_started` response cannot move a live student back to the lobby.
* An older section cannot replace the active section.
* Terminal state cannot regress to exam.
* A transient local phase cannot override a newer runtime revision.

---

## C. Answer interaction and rendering

### FEX-020 — Every question type

For every renderer, test:

* Accessible label.
* Initial hydrated value.
* User edit.
* Mutation metadata.
* Clear behavior.
* Keyboard navigation.
* Flag behavior.
* Rerender preservation.
* Reload hydration.

### FEX-021 — Slot-scoped questions

For sentence completion and diagram-style slots:

* Typing in slot 2 changes only slot 2.
* Fast typing coalesces per slot, not across slots.
* Slot ID and index are persisted.
* Removing one answer does not shift other answers.
* Hydration does not generate new mutations.

### FEX-022 — Writing editor

Test:

* Draft is committed before section submission.
* Debounced editing keeps the latest value.
* Blur and page lifecycle events persist the current editor content.
* Reload restores the draft.
* Large writing content remains responsive.
* Paste policy is applied only where configured.

---

## D. Durability and offline behavior

### FEX-030 — Immediate local feedback

After an answer change:

* UI reflects the answer synchronously.
* Pending-save state appears without blocking typing.
* A backend poll containing an older snapshot cannot erase the local answer.

### FEX-031 — Durable mirror

Test:

* Typing mutations use the configured short debounce.
* Discrete choices persist immediately.
* Answers near the final time boundary persist immediately.
* `blur`, `pagehide`, `beforeunload`, `visibilitychange`, freeze, and window blur flush durability.
* Failed browser storage activates the `storage_unavailable` block.

### FEX-032 — Offline answer flow

**Given:** Connection becomes unavailable.
**Then:**

* Answer entry continues when durable local storage works.
* Pending mutation count increases.
* Offline status is visible.
* Navigation does not discard answers.

**When:** Connection returns.
**Then:**

* Queue replays.
* Successful acknowledgements remove only accepted mutations.
* Latest answers remain visible.
* Offline overlay clears only after synchronization succeeds.

### FEX-033 — Browser storage failure

Verify:

* Input mutation is blocked once safe durability is unavailable.
* Existing visible answer is not cleared.
* Warning explains that new answers cannot be safely stored.
* Recovery removes the block only after storage is usable.
* Audit and observability hooks are invoked once.

---

## E. Section submission

### FEX-040 — Unanswered confirmation

For reading and listening:

* Confirmation appears when unanswered questions exist and policy is `confirm`.
* Counts for answered, total, and flagged questions are correct.
* Cancel returns to the same question.
* Confirm does not duplicate the submission.
* Policy `allow` skips confirmation.

### FEX-041 — Flush-before-submit

When submit is selected:

1. Current DOM controls emit their latest values.
2. Writing draft is committed.
3. Live answer cache is reconciled.
4. Pending mutations are flushed.
5. Section transition occurs only after successful flush.

The current orchestration retries a failed section flush with exponential backoff and shows offline or reconnect blocking state.

### FEX-042 — Section submission race

Test submitting while:

* Another flush is in flight.
* The final keystroke is still debounced.
* Proctor advances the section.
* Runtime pauses.
* Connection drops.
* Timer reaches zero.

Each case must preserve the last student input.

---

## F. Final submission

### FEX-050 — Automatic finalization

When runtime becomes structurally complete:

* Final DOM answer is committed.
* Pending mutations flush.
* Submit request is issued once.
* Progress overlay blocks closing or editing.
* Retry status is visible.
* Final success appears only according to the chosen confirmation contract.

### FEX-051 — Submission pending after network failure

Recommended expected UI:

```text
Title: Submission pending
Message: Your answers are stored on this device.
         Keep this page open while we confirm your submission.
Actions: Retry now / View connection guidance
```

Test:

* No false “success” confirmation.
* Reload restores pending state.
* Retry uses the same submission ID.
* Backend receipt transitions the page to confirmed success.
* A different payload cannot reuse the same submission identity.

### FEX-052 — Duplicate finalization effects

React Strict Mode, repeated runtime hydration, and rerenders must not create:

* Duplicate submit calls.
* Duplicate retry loops.
* Multiple overlays.
* Multiple post-exam transitions.

---

## G. Proctor and integrity behavior

### FEX-060 — Pause overlays

Parameterize:

* Cohort pause.
* Individual proctor pause.
* Waiting for section advance.
* Offline.
* Heartbeat lost.
* Device mismatch.
* Storage unavailable.

For each:

* Correct title and message.
* Correct remaining time.
* Answers cannot be changed where appropriate.
* Overlay disappears only from the corresponding recovery transition.
* One blocking reason does not accidentally clear a higher-priority reason.

### FEX-061 — Warning acknowledgement

Test tab switch, screenshot, translation, secondary screen, and proctor warning behavior:

* Warning appears once per violation ID.
* Acknowledgement persists where required.
* Screenshot blackout cannot be dismissed through unrelated controls.
* Duplicate live updates do not reopen an acknowledged warning.
* Hidden warnings do not steal focus repeatedly.

---

## H. Accessibility and viewport

### FEX-070 — Keyboard and screen-reader flow

Verify:

* Skip link reaches the main exam content.
* Question controls have meaningful labels.
* Waiting and blocking changes use an appropriate live announcement.
* Modal focus is trapped and restored.
* Submission confirmation is operable without a pointer.
* Timer is not announced every second.

### FEX-071 — Tablet and mobile viewport

Playwright projects should cover:

* iPad Safari portrait and landscape.
* Software keyboard open and closed.
* Footer remains reachable.
* Current input is not hidden behind navigation.
* Browser zoom and visual viewport changes do not remove controls.
* Rotation preserves answer and scroll position.

### FEX-072 — Readability controls

Test:

* Font scaling.
* Passage readability levels.
* Zoom.
* High contrast.
* Highlight and erase modes.
* Controls cannot make navigation or answers inaccessible.
* Preferences do not alter persisted answer content.

---

# 5. Required end-to-end journeys

## E2E-01 — Complete successful exam

```text
Check in
→ briefing
→ persist pre-check
→ waiting room
→ proctor starts exam
→ answer every question type
→ submit section
→ proctor advances
→ complete final section
→ backend confirms submission
→ post-exam screen
```

Verify the database submission snapshot and result input, not only the UI.

## E2E-02 — Reload during every phase

Reload during:

* Briefing.
* Waiting.
* Active reading.
* Active writing.
* Proctor pause.
* Section transition.
* Final submission.
* Confirmed post-exam.

## E2E-03 — Offline typing and reconnect

* Enter answers offline.
* Reload while offline.
* Restore from durable queue.
* Reconnect.
* Verify backend answer values exactly.
* Complete submission.

## E2E-04 — Last-second answer

* Type during the final 1–2 seconds.
* Trigger automatic section submission.
* Verify the final value reaches the backend submission snapshot.
* Verify grading uses that value.

## E2E-05 — Proctor advances during client flush

* Delay the mutation response.
* Advance the runtime.
* Release the delayed response.
* Verify expected grace or structured conflict behavior.
* Verify no silent answer loss.

## E2E-06 — Submission response lost

* Backend accepts submit.
* Browser receives a simulated network failure.
* Client retries with the same idempotency key.
* Backend returns the original receipt.
* One submission and one grading job exist.

## E2E-07 — Two tabs or devices

* Open the same attempt in two client sessions.
* Enter conflicting answers.
* Verify the defined ownership and conflict behavior.
* Confirm which answer becomes authoritative.
* Ensure the student is clearly informed.

## E2E-08 — Browser storage unavailable

* Disable IndexedDB/local storage writes.
* Attempt to enter an answer.
* Verify safe blocking.
* Restore storage.
* Verify recovery without losing the previous answer.

---

# 6. Test data matrix

At minimum, maintain these reusable fixtures:

```text
exam_all_question_types
exam_reading_only
exam_writing_only
exam_multiple_sections
exam_with_disabled_sections
exam_with_unanswered_confirmation
exam_auto_submit_enabled
exam_security_rules_enabled
exam_accessibility_time_extension
exam_shared_sentence_answer_pool
```

Candidate/runtime fixtures:

```text
candidate_new
candidate_precheck_complete
candidate_live_with_answers
candidate_offline_pending
candidate_paused
candidate_terminated
candidate_submission_pending
candidate_submitted
candidate_stale_revision
candidate_second_client_session
```

---

# 7. Implementation priority

## P0 — Release blockers

1. Confirmed versus pending final submission behavior.
2. Final-keystroke preservation at timer and section boundaries.
3. Server-authoritative start, pause, deadline, and completion.
4. Offline queue replay without answer loss.
5. Idempotent mutation and submission retries.
6. Stale snapshot protection.
7. Full question-type answer round trip.

## P1 — High-risk production cases

1. Multi-tab/client-session conflicts.
2. Reload during submission.
3. Proctor advance during flush.
4. Browser storage failure.
5. Heartbeat and reconnect transitions.
6. iPad keyboard and viewport behavior.
7. Duplicate runtime/live-update events.

## P2 — Hardening

1. Accessibility.
2. Warning focus management.
3. Rate-limit UX.
4. Load and submit-storm tests.
5. Telemetry and audit assertions.
6. Cache retention and cleanup.

---

# 8. CI execution strategy

## Every pull request

```bash
npm run typecheck
npm run lint
npm run test:run
cargo test --workspace
```

Run focused backend contract suites for student exam changes and Playwright smoke journeys for briefing, runtime start, answering, and submission.

## Nightly

```bash
npm run test:coverage
npm run playwright
```

Also run:

* MySQL-backed backend integration tests.
* Multi-browser Playwright.
* Offline and reload journeys.
* Mutation replay and revision suites.
* Full grading contract matrix.

## Pre-release

Run:

```bash
npm run e2e:prod-smoke
npm run k6:exam-day
npm run k6:start-exam
npm run k6:section-transition
npm run k6:submit-storm
npm run k6:resume
npm run k6:auto-submit
```

The repository already defines Vitest, Playwright, production smoke/load, and k6 commands for these scenarios.

---

# 9. Definition of done

The student exam is ready only when:

* No accepted answer can disappear after reload, reconnect, poll hydration, section transition, or submission.
* A student cannot start or extend a production runtime.
* Browser time cannot override the server deadline.
* Every write is authenticated, attempt-bound, revision-aware, and retry-safe.
* Section and final submission are idempotent.
* Pending submission is never presented as confirmed success.
* Every supported question type survives frontend → API → database → hydration → grading.
* Expected concurrency conflicts return structured, recoverable errors.
* The critical E2E journeys pass in Chromium and WebKit.
* Load tests show no duplicated attempts, submissions, or answer-loss signals.
