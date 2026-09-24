Yes. After reviewing the current repo, I would define the requirement as a **server-side durability invariant**, not as “try to submit when the browser closes.”

Your target should be:

> **Once an answer has been acknowledged by the server, that answer must eventually appear in the canonical result for the attempt, even if the student disconnects, closes the browser, loses power, changes device, or never returns. No student action is required for finalization.**

Your codebase is already fairly close to this.

### What you already have

The current architecture has several strong pieces:

* `src/services/studentMutationOutbox.ts` keeps pending answers durably in local storage/IndexedDB and has lifecycle triggers such as `pagehide`, `visibility_hidden`, `beforeunload`, `freeze`, etc.
* `backend/go/internal/attempts/service.go` persists V2 answers into `attempt_responses_v2` instead of waiting for final submit.
* V2 writes use idempotent `writeId`, client versions, server revisions, lease fencing, and replay protection.
* `backend/go/internal/terminalization/service.go` rebuilds `answers`, `writing_answers`, and `flags` from `attempt_responses_v2` when sealing the attempt. This is exactly the right source-of-truth model.
* `backend/go/internal/delivery/reconcile.go` explicitly says a disconnected candidate must not wait for another HTTP request and already sweeps SAT/ACT attempts.
* SAT has `ReconcileProvisional()` as another watchdog if completion was missed.
* terminalization has an immutable `attempt_terminalizations` receipt.
* SAT/ACT result materialization already happens server-side.

So I would **not rewrite scoring or answer persistence**.

The important change is to make terminalization/result creation universally guaranteed.

## Required invariant

I would establish these database invariants:

```text
ANSWER INVARIANT
server_acknowledged_response
    -> attempt_responses_v2 contains it permanently

TERMINAL INVARIANT
attempt reaches authoritative exam end
    -> attempt_terminalizations eventually exists

RESULT INVARIANT
attempt_terminalizations exists
    -> canonical provider result eventually exists

RESULT CONTENT INVARIANT
result answer snapshot
    == latest server-authoritative responses
       at terminalization revision

NO-CLIENT INVARIANT
none of the above requires another browser request
```

That last one is the important part.

The browser can disappear forever.

---

# Implementation plan

### 1. Make `attempt_responses_v2` the absolute answer authority

Keep the existing V2 architecture.

Do **not** make these authoritative:

```text
React state
localStorage
IndexedDB
student_attempts.answers
final_submission
Submit button payload
```

They are caches/projections/recovery mechanisms.

Canonical path should remain:

```text
student action
   ↓
local durable queue
   ↓
SaveResponses
   ↓
attempt_responses_v2
   ↓
ACK to client
```

Once the ACK is returned, losing the browser must be irrelevant.

I would formalize this with one shared definition:

```go
type PersistedAnswerRevision struct {
    AttemptID      string
    AnswerRevision uint64
    Responses      ...
}
```

and make all finalization/scoring operate from this server snapshot.

---

### 2. Do not depend on `Submit` to create a result

This is the most important behavioral rule.

Currently there are paths such as:

```text
student finishes
→ client submits
→ terminalization
→ result
```

but the canonical lifecycle needs to be:

```text
                    ┌─ client Submit
answers ────────────┤
                    │
                    └─ authoritative deadline
                             ↓
                       TerminalizeAttempt
                             ↓
                           Result
```

Both paths converge on the **same** terminalization service.

Never create a second “auto submit” scoring implementation.

Your existing:

```text
internal/terminalization.Service.Terminalize()
```

should own this.

---

### 3. Add a universal orphan-attempt finalizer

You already have `ReconcileTimeouts`, but currently its query is specifically:

```sql
WHERE e.provider_key IN ('sat', 'act')
```

and it is mainly module reconciliation.

I would add a provider-neutral worker job:

```text
FinalizeExpiredAttempts
```

Conceptually:

```sql
SELECT attempt
FROM student_attempts
WHERE submitted_at IS NULL
  AND no terminalization exists
  AND authoritative attempt/schedule deadline <= NOW()
ORDER BY deadline
LIMIT 250
FOR UPDATE SKIP LOCKED
```

For each attempt:

```text
1. lock attempt
2. determine effective provider
3. verify authoritative examination really ended
4. finish/lock open provider modules if necessary
5. materialize latest V2 responses
6. Terminalize(
       reason = time_expired,
       actor = system
   )
7. create/repair provider result
```

This applies to:

```text
IELTS
SAT
ACT
future providers
```

Do not make future providers invent their own abandoned-attempt logic.

---

### 4. Run expiry reconciliation much more frequently

Your worker currently puts:

```go
ReconcileRuntimeTimeouts
ReconcileSATProvisionalCompletion
RepairSATTerminalResults
...
```

in the slower maintenance path.

The default slow interval shown in `cmd/worker/main.go` is approximately five minutes.

That's too long for the UX you're describing.

I'd split it:

```text
HOT — every ~5 seconds
- ReconcileDueAttempts
- CompleteTerminalizedResults

MAINTENANCE — every few minutes
- deep repair
- audit
- retention
- orphan receipts
```

Do **not** scan the entire attempts table every 5 seconds.

Use a bounded indexed query:

```text
terminalized_at/result_status/deadline_at/schedule_id
```

plus batches around 100–250.

Then a disconnected student should normally appear in Results seconds after the authoritative exam deadline.

---

### 5. Separate terminalization from result materialization, but guarantee both

Model lifecycle explicitly:

```text
RUNNING
   ↓
TERMINALIZED
   ↓
RESULT_PENDING
   ↓
RESULT_READY
```

The terminal receipt is the durable fact.

Result generation can be retried safely.

For example:

```text
attempt_terminalizations
    attempt_id PK
    answer_revision
    final_snapshot
    outcome
    reason
```

Then:

```text
assessment_results/student_results
```

is the materialized result.

This is important because a crash could happen here:

```text
terminal receipt COMMITTED
💥 process crash
result INSERT never executes
```

That must not strand the result.

You already have some repair logic; make the invariant generic:

```text
terminalization exists
AND expected result does not exist
→ worker materializes/repairs result
```

forever, idempotently.

---

### 6. Store the exact answer revision used by the result

You already preserve `answer_revision` in terminalization.

Keep that and expose the relationship explicitly.

Example:

```text
attempt:
answer_revision = 37

terminalization:
answer_revision = 37

result:
source_answer_revision = 37
```

Then you can prove:

> Result X was calculated from answers through revision 37.

This makes debugging exam incidents dramatically easier.

I would add `source_answer_revision` to provider result projections if it isn't already represented there.

---

### 7. Make result creation idempotent

Use:

```text
UNIQUE(attempt_id, provider_key)
```

or equivalent canonical uniqueness.

Every worker operation should safely support:

```text
worker A terminalizes
worker B terminalizes
client submits simultaneously
proctor force submits simultaneously
```

with exactly one terminal fact/result.

Expected outcome:

```text
client submit ───┐
timeout worker ──┼──> same terminalization
proctor end ─────┤
repair worker ───┘
                        ↓
                  one canonical result
```

Your terminalization receipt architecture is already designed well for this.

---

### 8. Keep the student's latest acknowledged answer even when they exit mid-module

Example:

```text
10:31:12 Q1 = A → server ACK rev 31
10:31:16 Q2 = D → server ACK rev 32
10:31:21 Q3 = B → server ACK rev 33
10:31:25 student closes browser
```

Student never reconnects.

Server should eventually produce:

```text
Q1 A
Q2 D
Q3 B
Q4 unanswered
Q5 unanswered
...
```

and score unanswered questions according to provider rules.

Do **not** classify the entire attempt as missing merely because the student never pressed Submit.

---

### 9. Treat unanswered differently from missing data

This distinction is important.

These are two completely different states:

```text
question legitimately unanswered
```

versus

```text
answer existed but persistence failed
```

For every administered question the result/audit model should be able to say:

```text
answered
unanswered
not_administered
pretest
persistence_unknown   // exceptional
```

Ideally `persistence_unknown` should almost never happen.

SAT's current scorer already has good logic around unanswered operational questions; extend the conceptual model across providers.

---

### 10. Keep the local outbox, but don't pretend it gives an impossible guarantee

Your IndexedDB/local-storage work is still valuable.

For example:

```text
student answers
↓
internet disappears before server ACK
↓
IndexedDB retains answer
↓
browser closes
↓
student opens same device again
↓
pending mutation syncs
```

Great.

But there is one physical limit:

> If an answer never reached the server, and the device is destroyed or never reconnects, the server cannot know that answer existed.

No web architecture can guarantee otherwise.

So define the contract precisely as:

```text
SERVER ACK → guaranteed in eventual result
```

and separately:

```text
NOT YET ACKED → locally recoverable where possible
```

For discrete MCQ interactions, I would continue sending immediately rather than debounce.

For writing:

```text
RAM update immediately
IndexedDB immediately/debounced very short
network autosave continuously
```

---

# Optional: actual real-time staff result

If by “real-time score” you also mean staff should see a changing score while the student is taking the exam, don't modify the canonical result on every answer.

Add a separate read model:

```text
attempt_live_score
```

or compute it from the canonical answer projection.

For staff:

```text
Student A

Status       In progress
Answered     31 / 44
Saved        31 / 31
Provisional  520
Last answer  2 sec ago
```

But label it clearly:

```text
Provisional
```

Canonical `assessment_results` should remain terminal/result data.

That avoids mixing:

```text
live projection
```

with:

```text
official scored result
```

---

# Tests I would require

The core acceptance suite should cover these incidents:

1. Student answers 10 questions → receives 10 ACKs → force-kill browser → never returns → deadline passes → result contains exactly those 10 answers.
2. Student answers while offline → closes browser → reconnects same device before deadline → IndexedDB replays → result contains recovered answers.
3. Offline answer never reaches server and device never returns → result contains last server-acknowledged revision, not invented local data.
4. Student never presses Submit → deadline expires → backend terminalizes and produces result automatically.
5. Client Submit and timeout worker race → exactly one terminalization and one result.
6. Proctor force-submit and timeout worker race → exactly one terminalization.
7. Worker crashes after terminal receipt but before result creation → repair worker creates result.
8. Worker crashes after result creation but before job ACK → replay produces no duplicate.
9. SAT student disappears during Module 1 → module times out → route/final modules reconcile correctly → final result is produced.
10. Student disappears during final SAT module → timeout locks module → `CompleteAssessment` runs → score/result created.
11. ACT disappears → server-authoritative ACT scorer uses latest persisted responses.
12. IELTS disappears → provider-neutral terminalizer creates submission/result from persisted answers.
13. Zero-answer student → still gets a result record with zero/unanswered scoring rather than disappearing from Results.
14. 500 concurrent disconnected candidates at exam end → bounded worker batches eventually terminalize everyone.
15. Result's `source_answer_revision` equals terminal receipt revision and the actual V2 response snapshot.

I'd also add one invariant integration test:

```text
FOR every attempt whose authoritative exam has ended
AND whose grace period has elapsed

eventually exactly one of:
  result exists
  explicitly invalidated result exists

NEVER:
  no result / invisible attempt
```

## The architecture I would aim for

```text
                  STUDENT DEVICE
                       │
                 answer/change
                       │
          ┌────────────┴────────────┐
          │                         │
    IndexedDB backup          SaveResponses
                                    │
                                    ▼
                         attempt_responses_v2
                               CANONICAL
                                    │
                          server ACK returned
                                    │
              ┌─────────────────────┴────────────────────┐
              │                                          │
        Student Submit                         Server deadline worker
              │                                          │
              └──────────────────┬───────────────────────┘
                                 ▼
                         Terminalization
                                 │
                      immutable answer snapshot
                                 │
                                 ▼
                           Provider scorer
                                 │
                                 ▼
                       Canonical result row
                                 │
                                 ▼
                          Results page
```

The most important rule is:

> **Closing the screen must change only connectivity, never ownership of exam completion. The server owns completion.**

Given your current repo, this is an evolutionary change rather than a rewrite. The core pieces—V2 response durability, terminalization receipts, SAT reconciliation, worker, IndexedDB outbox—already exist; I would consolidate them into the universal **`server-acknowledged answer → terminalization → result`** invariant above.
