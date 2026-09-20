## SAT core audit — `main` @ `711ebbc9cd53d4df70f9ecacd2a5e6d954252d12`

I continued the audit specifically around **exam correctness**: answer durability, module boundaries, authoritative timing, finalization, recovery, async races, and state-machine behavior. I excluded rollback, observability/telemetry, deployment, and general UI polish.

I used the invariant-first standard from your audit spec: for each critical path, define what must remain true under overlapping actors, then construct a concrete failure schedule rather than flagging speculative races.

### Executive result

**Core SAT runtime posture: Fragile at orchestration boundaries.**

The low-level answer durability engine is actually quite strong. The largest risks are where independently well-designed subsystems meet each other.

| ID      | Severity | Finding                                                                            | Confidence |
| ------- | -------- | ---------------------------------------------------------------------------------- | ---------- |
| SAT-001 | **P1**   | V2 provisional submit can become permanently orphaned before SAT result creation   | High       |
| SAT-002 | **P1**   | Final-module timeout from question screen has no reliable finalization retry state | High       |
| SAT-003 | **P1**   | Cohort-section mode can auto-submit from the non-authoritative personal timer      | High       |
| SAT-004 | **P1**   | Blocked visible answer can cross module finalization without being persisted       | High       |
| SAT-005 | **P2**   | Old `startModule` / `submitModule` response can overwrite a newer poll state       | High       |
| SAT-006 | **P2**   | Backend module deadline checks use a timestamp captured before lock acquisition    | High       |
| SAT-007 | **P2**   | Every HTTP 409 is treated as a normal section-closing race                         | High       |

No P0 was confirmed in this pass.

---

## SAT-001 — provisional submission can become orphaned

**Severity: P1 — release blocker**

The finalization sequence is currently two separate durable operations.

In `useSatExamController.ts`, `finalizeAssessment()` does:

```text
persistence.flush()
→ persistence.submit()
→ satDeliveryGateway.submitAssessment()
```

The second step hits V2 `/student/attempts/:id/submit`. For SAT, `backend/go/internal/attempts/submit.go` deliberately makes this only a **provisional terminal claim**:

```text
delivery_status = submitted
phase = post-exam
submitted_at remains NULL
final_submission remains NULL
INSERT attempt_submissions_v2 receipt
```

Only the following `/v1/assessment-delivery/.../submit` request performs SAT scoring and creates the actual assessment result through `sat.Service.CompleteAssessment`.

The dangerous schedule is therefore:

```text
A1  all SAT modules are terminal
A2  persistence.submit() succeeds
A3  DB commits submitted/post-exam + attempt_submissions_v2 receipt
A4  browser closes / network disappears / process crashes
A5  submitAssessment() never reaches the backend
```

That state needs another owner to finish scoring.

There is a watchdog in `backend/go/internal/sat/service.go`, but `ReconcileProvisionalBatch()` explicitly requires:

```sql
AND NOT EXISTS (
    SELECT 1
    FROM attempt_submissions_v2 r
    WHERE r.attempt_id = a.id
)
```

The normal V2 provisional path **always writes that receipt transactionally**, so the watchdog excludes the exact state it needs to repair.

The reload path does not close the gap either. `DurableResponseEngine.recover()` sees `deliveryStatus = "submitted"` as terminal and moves to `conflict_terminal`. The controller's recovery finalization subsequently calls `persistence.submit()` again before `submitAssessment()`, but the durability engine now refuses the submit because the attempt is already terminal.

So the invariant:

> Every response-committed SAT attempt with all modules terminal eventually gets exactly one result.

is currently **broken**.

**Fix:** make the server the owner of this continuation. `ReconcileProvisional` should include receipt-present SAT provisional attempts and reuse the receipt's submission ID when calling the idempotent SAT scoring path. The client recovery path should also recognize “V2 provisional receipt exists, SAT result absent” and skip response resubmission—go directly to result completion.

The acceptance test should deliberately kill the flow immediately after V2 submit commits and before `submitAssessment()`. With no original browser alive, the worker must produce exactly one `assessment_result`, and a later reload must reach `complete`.

---

## SAT-002 — timeout on final module can strand the state machine

**Severity: P1 — release blocker**

The timeout effect in `useSatExamController.ts` runs while either:

```text
phase = module
or
phase = review
```

When time reaches zero it calls `submitModule()`.

For the last module, `submitModule()` calculates:

```ts
{ type: "submit" }
```

and dispatches it before calling `finalizeAssessment()`.

But `satRunnerReducer.ts` only accepts that action here:

```ts
case 'submit':
  if (state.phase !== 'review') return state;
```

So consider the normal exam-day scenario where time expires while the student is still looking at Question 22:

```text
state = module
time = 0
→ automatic submitModule()
→ server finalizes last module
→ nextModule = none
→ dispatch("submit")
→ reducer ignores it because phase !== review
→ state remains module
→ finalizeAssessment()
```

As long as finalization succeeds, the later `recover → complete` masks the bug.

But if finalization fails, the state remains `module`.

The existing retry mechanism explicitly permits retry only when:

```text
phase === submitting
OR
recoveryNeedsRetry
```

and `recoveryNeedsRetry` requires `phase === directions`.

Neither condition is true.

The timeout dedupe key has also already been consumed, so automatic submission does not simply fire again.

You can therefore end in:

```text
all modules finalized
result = null
state.phase = module
error = finalization failed
no valid retry path
```

The existing `sat-finalization-recovery.test.tsx` covers the happy recovery scenario after explicitly calling `reviewModule()` first. It does not cover timeout directly from `module`.

**Fix:** finalization state must not depend on whether the student visited Review. Introduce a semantic transition such as `beginFinalization`, legal from both `module` and `review`, or make `submit` valid from both. More importantly, derive recovery eligibility from authoritative data:

```text
all modules terminal
AND result == null
→ finalization required
```

rather than from UI phase.

Add an integration test where the final module expires on the question screen, the first finalization call fails, and a retry succeeds.

---

## SAT-003 — cohort mode can submit before the authoritative deadline

**Severity: P1 — exam-time correctness**

This one is particularly clear because the source code itself states the intended invariant.

`useSatExamController.ts` says:

> the server's section clock is the sole expiry authority

and explains that:

```text
min(personal module, section)
```

is only the **student-facing allotment** and the personal clock:

> is not force-closed while its section is live

But immediately afterward:

```ts
const remainingSeconds =
  Math.min(personalModuleRemainingSeconds, authoritativeRemainingSeconds)
```

is used by the timeout effect:

```ts
if (remainingSeconds > 0) return;

setAutoSubmitted(true);
void submitModule(stateModule.id);
```

So display time and expiry authority have been accidentally collapsed into one variable.

Your own cohort test fixture demonstrates the problematic state:

```text
authoritative section remaining = 120 seconds
personal module remaining       = 60 seconds
display remaining               = 60 seconds
```

At +60 seconds:

```text
personal = 0
section  = 60
min(...) = 0
→ client submits module
```

The backend then permits that submission. `SubmitModule()` explicitly applies the personal deadline only when:

```go
gate.usesPersonalDeadline()
```

and `usesPersonalDeadline()` is true only for the **legacy** timing model. Cohort mode uses the shared runtime deadline.

Therefore the client can finalize a cohort module while the backend still considers the authoritative section live.

That is a direct contradiction between the client and server timing model.

**Fix:** maintain two concepts:

```text
displayRemainingSeconds
expiryRemainingSeconds
```

For legacy:

```text
expiry = personal module
```

For cohort-stage:

```text
expiry = authoritative stage
```

For cohort-section:

```text
expiry = authoritative section
```

The personal clock can still influence what you display if that is intentional, but it must never trigger finalization in a model where the backend says it is non-authoritative.

The existing `sat-cohort-clock.test.tsx` should be extended: advance the fixture's 60-second personal clock to zero while 60 seconds remain on the section and assert `submitModule` has **not** been called.

---

## SAT-004 — blocked answer can be omitted during module finalization

**Severity: P1 — answer loss / wrong adaptive route**

The durability system correctly understands that a response crossing a control-epoch boundary may need manual reconciliation.

There is even an existing test reproducing the important race:

```text
recovery starts at control epoch 1
student types q1 while recovery is in flight
recovery snapshot returns control epoch 2
q1 becomes BLOCKED
q1 remains visible
q1 is never sent
```

That is good.

Final attempt submission protects this state. `useSatResponsePersistence.submit()` explicitly checks blocked/quarantined drafts and refuses to continue.

Module submission does **not** use that gate.

`submitModule()` only does:

```ts
await persistence.flush()
await satDeliveryGateway.submitModule(...)
```

and `flush()` eventually validates only:

```ts
engine.getPendingCount() > 0
```

`getPendingCount()` is:

```ts
outbox.size + inFlight.size
```

It does not mean “all visible answers are acknowledged.”

There is a reachable race where the answer is still a provisional write while recovery discovers the newer control epoch. The live response becomes blocked before it was ever put in the outbox.

The resulting state can be:

```text
states[q1].pending = blocked visible answer
outbox.size = 0
inFlight.size = 0
getPendingCount() = 0
```

`flush()` can therefore return successfully.

The module boundary then continues:

```text
submitModule()
→ backend scores currently persisted V2 responses
→ q1's newest visible answer isn't there
→ module becomes terminal
→ adaptive route / raw score may be wrong
```

The existing blocked-draft test checks that **final `submit()`** refuses this situation, but it does not verify the **module submission boundary**.

**Fix:** create one shared boundary invariant in the durability engine, something conceptually like:

```text
assertBoundarySettled()

no acceptance in progress
no sendable writes
no in-flight writes
no blocked drafts
no quarantined drafts
no visible unacknowledged intent
```

Both `submitModule()` and final `submit()` must use that same barrier.

Do not infer safety from queue length.

---

## SAT-005 — stale mutation responses can overwrite newer authoritative state

**Severity: P2**

Polling has a good stale-response guard.

`acceptPayloadAndRoute()` checks:

```ts
incomingRevision < currentRevision
→ reject payload
```

and keeps payload application behind a single commit layer.

But `startPendingModule()` and `submitModule()` bypass this layer.

After their network request resolves they directly do approximately:

```ts
const current = dataRef.current;
const timing = mergeAuthoritativeTiming(current?.timing, payload.timing);

const merged = { ...payload, timing };

dataRef.current = merged;
setData(merged);
```

`mergeAuthoritativeTiming()` protects only `timing`.

Everything else comes from the possibly older payload:

```text
proctorStatus
scheduleRuntimeStatus
attempt.moduleAttempts
attempt.responses
result
...
```

A valid adversarial sequence is:

```text
A1 submitModule request starts at runtime revision 10
B1 proctor pauses or terminates attempt
B2 poll fetches revision 11
B3 poll commits paused/terminated state
A2 older submitModule HTTP response finally arrives
A3 controller takes old payload, keeps newer timing only,
   but replaces the rest of data with the old projection
```

Now the client can contain a hybrid impossible state:

```text
timing = revision 11
proctorStatus / attempt state = revision 10
```

Server-side fences prevent many corrupting writes, which is why I classify this P2 rather than P1, but the UI can re-enter an active exam state after a newer pause/termination and generate additional blocked work.

**Fix:** every bootstrap-shaped payload should go through one monotonic commit function. Mutation responses must not have a privileged bypass.

Ideally expose a single bootstrap/projection revision from the backend. If that is not currently available, enforce monotonicity for the state domains you already have: runtime revision, module-attempt revisions, terminal result presence, and proctor/terminal states.

---

## SAT-006 — deadline TOCTOU inside backend module operations

**Severity: P2**

The modern V2 response service does this correctly: it obtains authoritative DB time *after acquiring its transaction/runtime state*.

The older delivery operations don't consistently do that.

For example `SubmitModule()` roughly does:

```go
now := time.Now().UTC()

ReconcileAttemptTimeout(..., now)

WithTxRCRetry(... {
    lock attempt
    lock runtime
    lock module

    moduleTimingGateTx(..., now)
})
```

The same timestamp survives lock waiting and retry attempts.

An adversarial schedule:

```text
12:00:59.900 request captures now
12:00:59.950 another transaction owns runtime/module lock
12:01:00.000 official deadline expires
12:01:01.000 this request finally acquires locks
gate compares deadline against 12:00:59.900
request is accepted
```

The invariant should be based on **the time at which the transaction has authority to mutate**, not the time before it waited for authority.

This affects `StartModule`, `SubmitModule`, and the legacy `SaveResponse` path.

**Fix:** read `UTC_TIMESTAMP(6)` inside the transaction after the relevant locks are acquired, on every retry. Even better, let `moduleTimingGateTx()` own the authoritative DB-time read so callers cannot accidentally pass stale wall-clock time.

A deterministic test should hold the runtime/module lock, start a request before deadline, release it after deadline, and assert `DEADLINE_EXPIRED`.

---

## SAT-007 — every 409 is incorrectly considered “section closing”

**Severity: P2**

The helper says:

```ts
function isSectionClosingRejection(error: unknown): boolean {
  return hasBackendStatusCode(error, 409);
}
```

But the backend uses 409 for much more than:

```text
DEADLINE_EXPIRED
RUNTIME_NOT_LIVE
SECTION_NOT_ACTIVE
already finalized
```

For example the writer-session code documents `ACTIVE_SESSION_SUPERSEDED` as HTTP 409.

So this can happen:

```text
another browser legitimately takes over attempt
→ submitModule receives ACTIVE_SESSION_SUPERSEDED / 409
→ isSectionClosingRejection() returns true
→ UI tells student:

"The exam is finalizing this module —
 your answers are safe. Keep this screen open."
```

That is the wrong recovery instruction. A poll can continue returning the same still-active module because bootstrap intentionally does not require writer ownership, leaving the old browser waiting for a transition that will never occur.

**Fix:** classify by structured backend code/reason, not HTTP status.

Use a narrow allowlist for the actual transition race reasons. `ACTIVE_SESSION_SUPERSEDED`, version collisions, malformed state, configuration conflicts, etc. need their own handling.

---

## What is already strong

I would **not rewrite the durability subsystem**. `DurableResponseEngine` shows a lot of deliberate correctness work: synchronous intent checkpointing, per-question acceptance serialization, recovery/version seeding, write IDs, acknowledgement identity checks, lease/control fencing, blocked drafts, quarantine, final-command submission, collision recovery, and late-write handling.

The backend also has several good foundations: attempt-row locking, V2 DB-authoritative time, lease/control epochs, idempotent V2 submission receipts, module CAS transitions, unique submission ownership, and idempotent SAT result replay.

The architectural problem is that these guarantees are not consistently carried across the next boundary.

### Remediation order

| Priority | Work                                                                     |
| -------- | ------------------------------------------------------------------------ |
| **1**    | Fix SAT-001 provisional receipt → guaranteed result continuation         |
| **2**    | Fix SAT-003 authoritative cohort timeout source                          |
| **3**    | Fix SAT-004 module boundary so no visible blocked answer can be excluded |
| **4**    | Fix SAT-002 terminal timeout state/retry path                            |
| **5**    | Route all bootstrap-shaped responses through one monotonic commit layer  |
| **6**    | Move backend deadline timestamp acquisition inside locked transaction    |
| **7**    | Replace blanket 409 classification with reason-aware handling            |

The first four are the ones I would block an exam-day release on. They directly affect **whether students receive their full time, whether their latest answer counts, and whether a completed exam can reliably become a result**.
