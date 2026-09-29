# Final implementation plan: SAT answers and adaptive handoff

## Required behavior

An answer selected on screen before Module 1 reaches zero must be included when scoring Module 1. The recorded score must select exactly one Module 2 branch, and the student must receive questions from that branch only.

Today, the browser saves answers through the V2 durability engine, while the server closes and scores a module on its own timer. The server allows a [three-second save window](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/attempts/service.go:28) after zero, then [scores and selects Module 2](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/start_submit.go:905). A delayed save can miss that decision. Separately, the [bootstrap returns the full question tree](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/backend/go/internal/delivery/service.go:361), including both branches.

## 1. Make module closure an explicit, recoverable step

**Owner:** the server’s module lifecycle, with the browser supplying its final answer intent.

- At zero, immediately stop new answer editing and capture the module’s final visible answer snapshot. Capture it at the answer-input boundary and checkpoint it through the existing durability engine; do not wait for a React render or an IndexedDB operation to decide what was selected.
- Send a new **module-close request** containing the module attempt ID, an idempotency ID, and the final per-question write IDs and versions. Reuse V2 response validation and fencing. The existing V2 *attempt submit* remains the final assessment step; it should not double as module closure.
- Persist a per-module closure record with a unique constraint on module attempt ID. Timeout reconciliation must leave that module awaiting closure and must not create a route decision from an incomplete answer set.
- In one transaction, apply or confirm the final response batch, score the resulting server snapshot, record the route decision, lock Module 1, and create the selected Module 2 attempt. Retries must return that same decision.
- If the close request cannot be confirmed, show **“Answers are being verified”** and keep Module 2 unavailable. After a defined recovery window, move the attempt to **proctor review** with the local draft and server receipts preserved. Never quietly route from the older server snapshot.

**Trust limit:** a server cannot independently prove when a click happened on a disconnected, user-controlled browser. The existing local `receivedAt` is a browser wall-clock value, not proof. For a high-stakes run, a late, unverified local answer needs proctor adjudication; accepting its timestamp automatically would allow a client to claim an answer was selected before zero. This is the exception path that makes the agreed rule honest rather than silently producing a wrong route.

**Timing:** when closure is delayed, Module 2’s timer must start when that student can actually enter the selected module. For a shared cohort clock, the proctor needs a hold or extension path so verification delay does not take away answer time.

## 2. Prevent older state from replacing a newer handoff

**Owner:** the attempt projection returned by the delivery API and committed by the student controller.

- Add a monotonic **per-attempt delivery revision** to bootstrap and state responses. Advance it in the same transaction as response changes, module transitions, and completion.
- In [the controller’s payload commit](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatExamController.ts:317), reject a lower attempt revision. The current room runtime revision is not a sufficient ordering key for an individual student’s module transition.
- Keep the existing module-ID lookup. It is the correct way to associate the route with [rendered questions](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatExamController.ts:1125).

A test must start two reads around the M1→M2 transition, return the newer response first, then the older one. The screen must stay on the selected Module 2.

## 3. Deliver only assigned question content

**Owner:** the server’s candidate delivery projection.

- Filter question content **after** loading the cached exam tree and the candidate’s module attempts. Return content for administered modules and the assigned current module. Never include the unselected adaptive branch in a candidate response.
- Do not mutate the shared cached tree while filtering. Build an attempt-scoped projection.
- When a newly assigned module is absent from the client’s retained content, fetch its content before rendering it. Update the [state-refresh fallback](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/student-delivery/hooks/useSatExamController.ts:431) to detect missing *question content*, as well as a missing module ID.
- Assert at the API boundary that each delivered question belongs to the assigned module ID. The UI should remain in a loading or recovery state if that assertion cannot be satisfied.

## Verification and rollout

| Gate | Required result |
|---|---|
| Last-second answer | Delay its save past the current three-second window. It is either included in the confirmed score or the attempt visibly enters review; it must never route from the older answer unnoticed. |
| Offline at zero | Reload and recover the checkpointed final answer. No automatic route occurs while closure is unresolved. |
| Duplicate and racing closes | Two close requests, timeout reconciliation, and a proctor action produce at most one route decision and one selected Module 2 attempt. |
| Wrong-question check | Before routing, inspect the raw bootstrap: neither branch’s questions are present. After routing, only the selected branch’s questions are present and rendered. |
| Out-of-order responses | A stale read cannot replace a newer module or result snapshot. |
| Exam-day load | Run a synchronized save-and-close wave against real MySQL; measure time from zero to a confirmed route and the count awaiting review. |

Roll out the new API fields and closure storage first, with old readers still supported. Then deploy the new browser flow and enable server-side held closure for supported clients. Do not turn on the hold before clients can send close requests, or older clients will strand attempts. Keep a repair path for held attempts during rollback.

**Operational signals:** alert on modules awaiting closure beyond the recovery window, late or rejected final writes, route/module-ID mismatch, and a rise in proctor-review cases. Logs need attempt ID, module attempt ID, close ID, answer revision, selected module ID, and reason—no answer text.

The main acceptance criterion is straightforward: **the system must either score the answer selected before zero or clearly stop for recovery; it must never silently choose Module 2 from an incomplete answer set.**

The other findings **remain open**. The last plan covered them in sections 2 and 3, but they are independent of the last-second answer problem:

| Finding | What can happen | Required fix |
|---|---|---|
| **Stale handoff state — SEV-2** | A newer response says the student has moved to Module 2, then an older response arrives and replaces it in the browser. The student may see stale directions or a temporarily unresolved screen. This does **not** show that the server selected the opposite branch. | Give each candidate’s delivery state a revision that increases on module transitions and answer changes. Reject older responses in the student controller. Test two handoff reads arriving in reverse order. |
| **Both branches’ questions exposed — SEV-1** | Before routing, the student API sends questions for **both** Lower and Higher Module 2. The normal UI displays only the selected module, but the other questions are already available in the browser’s network response. | Filter question content on the server by the candidate’s assigned module. After routing, fetch only the selected branch. Test the **raw API response**, as well as the screen. |
| **Synchronized timeout capacity — unverified risk** | Many students reaching zero together could make module closure and Module 2 availability slow. The timeout worker processes a capped set of candidates sequentially. The focused tests do not establish its exam-day latency. | Run a real-MySQL synchronized load test; measure expiry-to-Module-2 time, backlog, failures, and DB contention. Set an alert and a proctor recovery procedure for delayed handoffs. |

The **wrong Module 2** concern has two distinct causes. A missing last-second answer can make the server calculate the wrong score and therefore choose the wrong branch; the closure fix addresses that. An out-of-order read can make the **screen** regress after a correct server decision; the revision fix addresses that. The current server code records the route and selected module together, and the UI normally resolves questions by module ID. I did not find evidence of a separate server-side “Higher decision, Lower module assigned” bug.

I would implement and verify all three correctness changes before calling this production ready: **safe answer closure, monotonic candidate state, and server-side branch-content filtering**. The load test is the release gate that checks whether those changes still work when many students cross the boundary together. No fixes have been made yet.