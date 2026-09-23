Yes. Based on the current default branch, I would implement this as a **SAT answer-integrity / server-owned module completion change**, not as a simple “remove Submit button” patch.

The core invariant should be:

> **Every student answer is autosaved independently of module completion. A student can never close/submit a SAT module. Module completion is caused only by authoritative server timing or an authorized proctor action. A result must never silently omit persisted answers.**

## 1. Current problems to fix

The implementation currently violates that invariant in several places.

`SatReviewPage.tsx` exposes `onSubmit`, **Submit module**, the confirmation dialog, and **Submit anyway**. `SatStudentSessionRoute.tsx` connects that directly to:

```ts
commands.submitModule(stateModule.id)
```

`useSatExamController.ts` also uses the same `submitModule()` mutation automatically when the client timer reaches zero.

On the backend, `backend/go/internal/delivery/start_submit.go` accepts a student module submission while the module is:

```go
active
review
```

and executes:

```go
finalizeModuleTx(..., "student_submit")
```

That changes the module to a terminal state. Meanwhile V2 response durability only accepts new responses while the owning module is `active|review`.

So the dangerous sequence is:

```text
student changes answer
        ↓
V2 save queued / network in flight

student presses Submit module
        ↓
backend finalizes module = submitted
        ↓
pending V2 answer reaches backend
        ↓
ensureQuestionAdmitted()
sees module != active/review
        ↓
write rejected
        ↓
result does not contain latest answer
```

There is also an independent result-read problem: `GetSATResult()` currently swallows `satQuestions()` errors and returns `Questions: []`. That can incorrectly turn an infrastructure/query failure into “No question-level responses recorded.”

---

# Implementation plan

## Phase 1 — Define the lifecycle contract first

Before changing code, make the SAT lifecycle explicit.

Student-authorized actions should be:

```text
answer question
change answer
mark for review
add notes/highlight
navigate questions
open review screen
return from review
```

Student must **not** be authorized to:

```text
submit module
finish module early
skip remaining module time
force adaptive routing
force section transition
force final assessment completion early
```

The terminal owners are:

```text
time expired      → server
proctor end       → proctor/server
proctor terminate → proctor/server
```

Remove `student_submit` as a valid SAT module completion reason for new traffic.

Keep historical DB values readable if old attempts contain `student_submit`; don't require a data migration just to rename history.

---

# Phase 2 — Remove manual submission from the Review UI

Primary files:

```text
src/features/student-delivery/ui/review/SatReviewPage.tsx
src/features/student-delivery/ui/review/SatReviewPage.test.tsx
src/features/student-delivery/routes/SatStudentSessionRoute.tsx
```

Change the review page from:

```text
Review answers

[Back]
[Submit module]

→ confirmation
→ Submit anyway
```

to:

```text
Review your answers

Answered 24 of 27
3 unanswered

Answers save automatically.
You can review and change answers until time ends.

[Back to question]
```

Keep:

* question navigation;
* answered/unanswered states;
* mark-for-review states;
* remaining time;
* save/offline state;
* Retry Save when persistence fails.

Remove:

* `onSubmit`;
* submit button;
* submit confirmation state;
* `sat-submit-confirm`;
* `Submit anyway`;
* submission readiness logic whose only purpose was enabling/disabling manual submission.

Do **not** remove save-state warnings. If the student is offline, the Review page should still say answers are pending/retrying.

### Tests

Rewrite `SatReviewPage.test.tsx` around the new contract.

Assert:

```text
"Submit module" does not exist
"Submit anyway" does not exist
submit confirmation does not exist
review question navigation still works
Back to question works
unanswered count still renders
mark-for-review still renders
timer still renders
offline/retrying state still renders
Retry Save still works
```

Add a negative test:

```ts
expect(
  screen.queryByRole("button", { name: /submit/i })
).not.toBeInTheDocument();
```

This should become a permanent policy regression test.

---

# Phase 3 — Remove student `submitModule` from the controller contract

Primary file:

```text
src/features/student-delivery/hooks/useSatExamController.ts
```

Today the controller exports something equivalent to:

```ts
commands.submitModule
```

Remove that from the student-facing command surface.

The student controller should expose concepts such as:

```ts
setAnswer()
toggleReview()
reviewModule()
navigateQuestion()
retrySave()
```

but not:

```ts
submitModule()
```

This is important architecturally: future UI code shouldn't accidentally reintroduce a submit button simply because the command still exists.

Also remove `submitModule` from the route wiring.

---

# Phase 4 — Stop using `submitModule()` when the browser timer expires

Current code approximately does:

```ts
if (expiryRemainingSeconds <= 0) {
    void submitModule(stateModule.id);
}
```

That makes a student's browser participate in authoritative module terminalization.

Replace this with a **client read-only timeout state**.

At zero:

```text
1. Immediately disable answer interaction.
2. Keep the current answer state visible.
3. Ask persistence to flush anything already queued.
4. Show a calm transient surface:
   "Time is up"
   "Your saved answers are being recorded…"
5. Refresh/reconcile authoritative session state.
6. Server determines the next module / break / completion.
```

Important distinction:

```text
flush autosaves ≠ student submitting the module
```

The student is merely synchronizing response writes already generated by question interactions.

The server decides that the module ended.

Rename concepts too. For example:

```ts
timeoutSubmissionKeyRef
```

should become something like:

```ts
timeoutTransitionKeyRef
timeoutReconcileKeyRef
```

because there should no longer be a “submission” at this point.

---

# Phase 5 — Make the server the only normal timeout finalizer

You already have the right underlying mechanism:

```text
backend/go/internal/delivery/reconcile.go
```

`ReconcileAttemptTimeout()` evaluates authoritative timing and calls:

```go
finalizeModuleTx(..., "time_expired")
```

That should become the canonical normal SAT module-completion path.

Expected lifecycle:

```text
server clock expires
        ↓
ReconcileAttemptTimeout
        ↓
finalizeModuleTx(..., "time_expired")
        ↓
score persisted responses
        ↓
select adaptive branch
        ↓
create next module attempt
        ↓
bootstrap exposes new authoritative state
        ↓
student UI transitions
```

The browser timer becomes visual UX only.

It must not be the source of truth.

Also confirm the existing `ReconcileTimeouts` worker is active in production. The correctness requirement is:

> A disconnected student's module still ends and progresses even when the student sends no HTTP request after timeout.

Bootstrap reconciliation can remain as an additional recovery mechanism, but background reconciliation must be sufficient by itself.

---

# Phase 6 — Disable early `/modules/submit` on the backend

Primary files:

```text
backend/go/internal/delivery/start_submit.go
backend/go/cmd/api/handlers_delivery.go
```

Do **not** merely remove the route from TypeScript.

Old JS bundles, devtools, malicious clients, or manually crafted requests could still invoke it.

Recommended compatibility behavior:

### Active/review module

Request:

```http
POST /v1/assessment-delivery/schedules/:id/modules/submit
```

while time remains.

Return typed conflict:

```json
{
  "code": "ASSESSMENT_CONFLICT",
  "details": {
    "reason": "STUDENT_MODULE_SUBMIT_DISABLED"
  },
  "message": "SAT modules close automatically when the authoritative time ends."
}
```

HTTP:

```text
409
```

Do not mutate:

```text
module state
submitted_at
completion_reason
raw score
route decision
next module
attempt status
```

### Already timeout-finalized module

For stale old clients, it is reasonable to return the current authoritative bootstrap idempotently.

But never cause terminalization because the endpoint was called.

The backend should no longer execute:

```go
finalizeModuleTx(..., "student_submit")
```

for SAT student traffic.

Keep `proctor_end`, `proctor_terminate`, and `time_expired`.

---

# Phase 7 — Put an invariant around module finalization and response durability

This is the most important data-integrity part.

Currently V2 requires:

```go
owner.ModuleState == "active" || owner.ModuleState == "review"
```

for a new answer.

That means terminalization and response saving must have a clearly defined ordering contract.

The invariant should be:

> A module may not be finalized from a student action while response durability is still settling.

Removing early manual submit eliminates the major problematic race.

For timeout, preserve the existing server-side timing/grace architecture, but explicitly test the boundary.

I would **not** solve this by simply allowing arbitrary writes to a locked module for 30 seconds. That creates a cheating window where a direct API client could alter answers after time expired.

Instead preserve these semantics:

```text
before authoritative deadline:
    answers writable

at/after authoritative deadline:
    no new user interaction

already admitted/idempotent durability work:
    may safely replay

new post-deadline answer mutation:
    rejected

module finalization:
    driven from authoritative timing
```

The existing V2 write IDs are valuable here because exact replay is already accepted even after terminal state.

You already have tests proving post-terminal **exact replay** works. Preserve that behavior.

---

# Phase 8 — Make autosave the only answer-writing mechanism

`useSatResponsePersistence.ts` already has the correct conceptual pieces:

```text
save
flush
retryFailed
offline
retryable
superseded
```

Strengthen the contract:

### Discrete answers

Multiple-choice answer changes should be saved immediately.

No long debounce.

```text
tap answer
→ reducer updates
→ V2 outbox write created immediately
→ async persistence starts
```

### Text/student-produced response

A very short debounce is okay for typing, but:

```text
blur
question navigation
review navigation
visibility change
pagehide
timeout UI freeze
```

must flush the latest draft.

### Never clear the outbox because a module UI changed

Only remove a pending write after positive server acknowledgement or confirmed supersession.

Do not do:

```text
module changed
→ clear pending answer writes
```

The outbox should be attempt/question/write-ID based, not screen-lifecycle based.

---

# Phase 9 — Fix result detail's false-empty behavior

Primary file:

```text
backend/go/internal/results/service.go
```

Current behavior:

```go
if questions, err := s.satQuestions(...); err == nil {
    return questions
}

return Questions: []
```

Change that.

A DB/query failure must become a real API failure.

Prefer:

```go
questions, err := s.satQuestions(ctx, attemptID)
if err != nil {
    return nil, fmt.Errorf("load SAT question responses: %w", err)
}
```

Then return the questions.

The frontend should distinguish:

```text
query succeeded + []     → genuinely no rows
query failed             → "Could not load response details. Retry."
```

Never:

```text
query failed
→ "No question-level responses recorded"
```

That is dangerous because staff could conclude the student submitted nothing when the database actually contains their responses.

---

# Phase 10 — Fix result question identity

In `satQuestions()` the implementation comment says results are deduplicated by the administered question row, but the query currently selects:

```sql
eq.question_id
```

and Go uses it for:

```go
seen[questionID]
```

That is a question-bank identity, not necessarily a unique administered placement.

Change the query to include:

```sql
eq.id AS exam_question_id,
eq.question_id
```

Use:

```go
seen[examQuestionID]
```

for deduplication.

Continue returning the public/domain `questionId` if the API expects it, but use `examQuestionID` internally as the administered-response identity.

This prevents:

```text
same question-bank question reused in two module placements
→ result silently drops one placement
```

---

# Phase 11 — Keep V2 canonical everywhere

For current SAT attempts, the canonical answer source should remain:

```text
attempt_responses_v2
```

with:

```text
assessment_question_responses
```

only as historical fallback.

This policy should hold consistently in:

```text
module scoring
adaptive routing
bootstrap response hydration
SAT result question detail
terminal result generation
```

The existing V2-first logic in scoring and `satQuestions()` should remain.

Do not introduce another result-specific answer snapshot that can drift from V2.

---

# Phase 12 — Harden final assessment completion

Final assessment completion may remain automatic, but students should never receive a UI control for it.

Current conceptual flow:

```text
all required modules terminal
        ↓
finalization gate
        ↓
V2 durability submit/final receipt
        ↓
CompleteAssessment
        ↓
assessment result
```

That's acceptable because the student isn't deciding to finish early.

Keep the server check:

```text
all required SAT modules must be submitted|locked
```

Therefore even if somebody calls final assessment submit directly before modules finish:

```text
409
no result
no terminalization
```

Add a test explicitly pinning this policy.

---

# Test plan

I would implement this with TDD around invariants rather than only snapshot/UI tests.

## A. Frontend policy tests

`SatReviewPage.test.tsx`

Required assertions:

```text
✓ Submit module absent
✓ Submit anyway absent
✓ confirmation dialog absent
✓ answered/unanswered count works
✓ marked questions work
✓ returning to a question works
✓ timer works
✓ offline status works
✓ retry-save works
```

Controller tests:

```text
✓ student command interface exposes no submitModule
✓ timer reaching zero does not call gateway.submitModule
✓ timer reaching zero freezes interaction
✓ timer reaching zero flushes existing persistence queue
✓ controller refreshes/reconciles authoritative state
```

---

## B. Backend endpoint tests

Add to something like:

```text
backend/go/internal/delivery/start_submit_test.go
```

### Active module cannot be manually submitted

Arrange:

```text
module = active
time remaining > 0
```

Call student `SubmitModule`.

Expect:

```text
409
STUDENT_MODULE_SUBMIT_DISABLED
```

Database assertions:

```text
module still active
submitted_at NULL
completion_reason NULL
no route decision
no next-module insert
```

### Review module cannot be manually submitted

Same test with:

```text
state = review
```

Same expected result.

### Expired module uses reconciliation

Arrange authoritative deadline expired.

Run:

```go
ReconcileAttemptTimeout()
```

Expect:

```text
state = locked
completion_reason = time_expired
raw score populated
next adaptive module created
```

No `student_submit`.

---

# C. Answer durability tests

### Answer before module end survives

```text
1. student answers Q1 = B
2. V2 write succeeds
3. module times out
4. result generated
5. result Q1 == B
```

Verify both:

```text
attempt_responses_v2
result detail API
```

### Answer changed immediately before timeout

```text
Q1 = A
server persisted A

student changes Q1 = C near boundary
write is accepted before authoritative close
timeout reconciles
```

Result must contain:

```text
C
```

not A.

### Duplicate replay after terminal state

Existing behavior should remain:

```text
same writeId
same payload
after module terminal
→ duplicate/replayed ACK
→ no data loss
→ no revision increase
```

### New post-time mutation rejected

After module is closed:

```text
new writeId
new value
```

must fail.

That proves the recovery mechanism doesn't become a post-deadline cheating path.

---

# D. Disconnect tests

These matter for your larger requirement that answers never disappear.

### Close tab after answer

```text
answer Q1
server ACK received
close browser
never reconnect
server timeout worker closes exam
result contains Q1
```

### Close tab while outbox has pending retry

If the write never reached the server before the valid admission window, the system cannot truthfully claim the server possesses it.

So test/document the exact guarantee:

```text
ACKed server response → must always survive
accepted durability write → must always survive
purely local unsent state → recoverable only if reconnect happens while writes are still admissible
```

Do not display “saved” until server durability has actually acknowledged it.

---

# E. Result integrity tests

Add to:

```text
backend/go/internal/results/service_test.go
```

### V2 answer appears in result

Already partly covered; expand it into an invariant.

```text
attempt_responses_v2.answer = B
legacy answer = A

result response must = B
```

### Result query failure is not empty result

Mock `satQuestions()` query failure.

Expect:

```text
GetSATResult returns error
```

Not:

```json
{
  "questions": []
}
```

### Legitimate empty result

Separately prove an actually empty successful query returns an empty collection.

This ensures:

```text
error != empty
```

### Reused question-bank ID

Create:

```text
exam question row 1 → question_id = shared-q
exam question row 2 → question_id = shared-q
```

Different `eq.id`.

Expect two administered result rows.

---

# F. Adaptive-routing tests

This is critical because answer loss can also cause the **wrong Module 2** to be assigned.

Test:

```text
threshold = e.g. 10 correct

latest answer makes raw score = 10
→ higher branch expected
```

Race answer persistence against module close.

Verify:

```text
persisted response = latest answer
raw_correct = 10
route_decision = higher
created module attempt = higher branch
result later matches the same response
```

You want one source of truth to prove:

```text
answer persistence
→ scoring
→ routing
→ final result
```

all agree.

---

# G. Playwright end-to-end tests

`e2e/sat-transition-flow.spec.ts` currently has helper logic that literally does:

```text
Review answers
Submit module
Submit anyway
```

Delete that assumption completely.

Change E2E to server-driven transitions.

Flow:

```text
student starts Module 1
answers questions
opens Review
verifies no Submit button
wait/force authoritative expiry
server reconciles
student receives Module 2 automatically
```

For test speed, continue manipulating authoritative runtime/deadline data rather than waiting real exam durations.

Assert:

```text
✓ no Submit module control
✓ no Submit anyway control
✓ module remains open before deadline
✓ direct early submit API rejected
✓ expiry closes module
✓ response rows survive
✓ adaptive route correct
✓ final result contains responses
```

Do the same across:

```text
RW M1 → RW M2
RW M2 → break
break → Math M1
Math M1 → Math M2
Math M2 → complete
```

---

# Race/concurrency test

I would explicitly add one backend concurrency regression.

Run two goroutines:

```text
A: save response
B: timeout reconcile
```

Use barriers so they race around the same boundary.

Valid outcomes must never include:

```text
save acknowledged successfully
AND
result missing that answer
```

The invariant is:

```text
if SaveResponses returned success/applied
then every later score/result must see that committed response
```

This is the strongest test in this entire change.

---

# Observability

Add metrics/logs for cases that indicate answer-integrity risk.

Useful counters:

```text
sat_student_module_submit_rejected_total
sat_response_write_after_terminal_total
sat_result_question_detail_failure_total
sat_timeout_finalize_total
sat_response_replay_after_terminal_total
```

For errors, log identifiers only:

```text
attemptId
scheduleId
moduleAttemptId
questionId/examQuestionId
writeId
serverRevision
completionReason
```

Do not log answer contents.

A particularly valuable invariant alert is:

```text
SAT result exists
AND administered module has V2 responses
AND result question enrichment returned zero because of query error
```

That should never silently happen after this change.

---

# Definition of done

I would not consider this fixed until all of these are true:

```text
[ ] Student SAT UI contains no module-submit button.
[ ] Review page contains no submit confirmation.
[ ] Student controller exposes no manual submitModule command.
[ ] Timer expiry does not cause a student submit mutation.
[ ] Direct early module-submit API cannot terminalize a module.
[ ] Server timeout reconciliation is authoritative.
[ ] Proctor end/terminate still work.
[ ] V2 autosave remains the canonical response source.
[ ] An acknowledged answer survives every later module/result transition.
[ ] Result-detail DB failure cannot masquerade as zero answers.
[ ] Result dedup uses administered exam-question identity.
[ ] Adaptive routing uses the same persisted answers shown in results.
[ ] Disconnected students are eventually finalized by server reconciliation.
[ ] Existing V2 idempotent replay behavior remains intact.
[ ] Full SAT Playwright flow no longer relies on Submit module / Submit anyway.
```

The architectural result should be:

```text
Student interaction
      │
      ▼
V2 autosave ───────────► durable response store
      │
      │
      └──── no connection to module completion
                         │
Authoritative server clock
                         │
                         ▼
                timeout reconciliation
                         │
                         ▼
                   finalize module
                         │
                  ┌──────┴──────┐
                  ▼             ▼
                score        adaptive route
                  │             │
                  └──────┬──────┘
                         ▼
                    next stage
                         │
                         ▼
                   final result
                         │
                         ▼
             same persisted V2 answers
```

That separation—**answer durability independent from module terminalization**—is the key best-practice change. It removes the current class of bugs where pressing “Submit module” can race the autosave system and make an answer disappear.
