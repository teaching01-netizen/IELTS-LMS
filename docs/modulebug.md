I traced the adaptive SAT flow end-to-end on the current `main` commit `44a68145…`.

The important conclusion is: **the hard/easy routing calculation itself is not reversed. The bug is downstream: after the backend correctly chooses Higher, the system does not keep that selected module ID as the single source of truth across the student UI, bootstrap cache, and staff session UI.** That explains why the result can say Higher while a live screen says Lower.

### What I found in the chain

| Chain                      | Finding                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| Module 1 scoring           | ✅ Correct                                                        |
| Higher/Lower threshold     | ✅ Correct                                                        |
| Routing policy IDs         | ✅ Correct                                                        |
| Persist `selected_route`   | ✅ Correct                                                        |
| Create Module 2 attempt    | ✅ Uses selected module ID                                        |
| Timeout/reconciler routing | ✅ Uses same routing function                                     |
| Result scoring             | ✅ Reads actual administered module role                          |
| Workbook/import mapping    | ✅ Higher/Lower aren't swapped                                    |
| Student live state         | ⚠️ Loses authoritative `moduleId`                                |
| Bootstrap/reconnect        | ❌ Dynamic state can incorrectly return `304`                     |
| Proctor/student row        | ⚠️ Can accept stale projection based on heartbeat `lastActivity` |

The backend decision is here:

`backend/go/internal/delivery/start_submit.go`

```text
Module 1 answers
   ↓
scoreScoringRows()
   ↓
chooseAdaptiveRoute()
   ↓
route == higher
   ↓
selectedModuleID = higherModuleID
   ↓
INSERT assessment_route_decisions
    selected_route = higher
    selected_module_id = HIGHER_ID
   ↓
insertModuleAttemptTx(HIGHER_ID)
```

The initial SAT policy is also correct in `backend/go/internal/exams/sat_initialization.go`:

```text
baseID   = Module 1
lowerID  = Module 2 Lower
higherID = Module 2 Higher
```

and they're inserted in the correct order:

```go
base_module_id,
lower_module_id,
higher_module_id
```

So there is **no Lower/Higher inversion there**.

### Why the Result page saying Higher is very important

`backend/go/internal/sat/service.go` does not blindly trust some frontend label. When producing the result it loads the actual terminal module attempts and their `adaptive_role`.

Conceptually:

```text
assessment_module_attempts
        ↓
assessment_modules.adaptive_role
        ↓
higher_branch
        ↓
section result route = "higher"
```

It even rejects a result if both Higher and Lower branches were submitted for the same section.

Therefore:

> If the final result says **Higher**, the persisted assessment data says that the administered terminal branch was `higher_branch`.

That strongly rules out the adaptive scorer itself as the root cause.

---

## Root cause #1 — dynamic Bootstrap is incorrectly cached as static

This is a real correctness bug.

In:

`backend/go/cmd/api/handlers_delivery.go:47-53`

the bootstrap handler does this **before calling `Bootstrap()`**:

```go
if _, _, etag, terr := app.Delivery.VersionTag(...); terr == nil {
    if writeETagOrNotModified(w, r, etag) {
        return
    }
}

out, err := app.Delivery.Bootstrap(...)
```

But `VersionTag()` in:

`backend/go/internal/delivery/service.go:405-426`

only uses:

```text
published version ID
+
exam version revision
```

So the ETag is effectively:

```text
W/"v{publishedVersionId}-{versionRevision}"
```

The problem is that `/bootstrap` is **not static**.

It includes:

```text
published questions       ← static
module attempts           ← LIVE
active module             ← LIVE
Higher/Lower route        ← LIVE
responses                 ← LIVE
timers                    ← LIVE
proctor status            ← LIVE
result                    ← LIVE
```

Module 1 → Higher Module 2 does **not** change the published exam version.

Therefore this is possible:

```text
Student previously received bootstrap
ETag = W/"v123-7"

                    ↓

Module 1 finishes

DB:
assessment_route_decisions = HIGHER
assessment_module_attempts += HIGHER MODULE

                    ↓

student reconnects / reloads

If-None-Match: W/"v123-7"

                    ↓

server checks only exam version

still W/"v123-7"

                    ↓

HTTP 304
Bootstrap() NEVER RUNS
```

The frontend explicitly treats that `304` as “nothing changed” in `useSatExamController.ts`.

This can leave the live runner behind the authoritative adaptive state, especially around reconnect/resume.

### Correct fix

**Do not ETag the complete dynamic bootstrap with an exam-version-only ETag.**

Best architecture:

```text
STATIC DELIVERY
version / sections / modules / questions
→ version ETag allowed

LIVE ATTEMPT
module attempts / route / responses / timers / result
→ always fresh or ETag includes attempt revision
```

For the immediate safe fix, remove the early `304` from `deliveryBootstrapHandler`.

Do not optimize correctness-sensitive attempt state away.

---

# Root cause #2 — student runner throws away `moduleId`

This is the second architectural correctness bug and especially dangerous for adaptive exams.

The backend correctly works in IDs:

```text
selected_module_id = UUID-HIGHER
```

`moduleForAttempt()` also correctly resolves:

```ts
module.id === attempt.moduleId
```

But then `startModuleRouteAction()` reduces the identity to:

```ts
{
    type: "routeToModule",
    sectionKey,
    moduleKey: module.moduleKey,
    ...
}
```

The actual `module.id` is discarded.

`SatWorkingState` in:

`src/features/student-delivery/application/satRunnerReducer.ts`

stores only:

```ts
sectionKey: SatSectionKey;
moduleKey: string;
```

Then the student renderer later reconstructs the module in:

`useSatExamController.ts:1063-1069`

using:

```ts
data.sections
    .flatMap(section => section.modules)
    .find(candidate => candidate.moduleKey === state.moduleKey)
```

That is exactly the wrong direction for an adaptive runtime.

You already had:

```text
authoritative ModuleAttempt.moduleId
```

but turned it into:

```text
moduleKey
```

and then tried to rediscover an ID from the key.

The invariant should instead be:

```text
route decision.selected_module_id
        =
module attempt.module_id
        =
runner.state.moduleId
        =
rendered module.id
        =
response.moduleAttemptId's module
```

**No re-derivation.**

Canonical current SAT keys make this bug less visible, but old/custom data, duplicated keys across sections, stale actions, future authoring changes, or recovery data can break it. An exam runtime should never depend on a display/business key when a UUID identity already exists.

### Fix it to

```ts
type SatWorkingState = {
    ...
    moduleId: string;
    moduleKey: string;
}
```

and:

```ts
routeToModule: {
    moduleId: module.id,
    moduleKey: module.moduleKey,
    ...
}
```

Then:

```ts
const stateModule =
    data.sections
        .flatMap(section => section.modules)
        .find(module => module.id === state.moduleId) ?? null;
```

`moduleKey` becomes metadata/display only.

---

# Root cause #3 — staff Session page has the right source, but the freshness guard is wrong

The backend proctor query is actually good.

`backend/go/internal/proctor/sessions.go`

selects the actual active SAT attempt:

```sql
SELECT ma2.id
FROM assessment_module_attempts ma2
WHERE ma2.attempt_id = sa.id
  AND ma2.state = 'active'
ORDER BY ma2.created_at DESC, ma2.id DESC
LIMIT 1
```

It joins that module and exposes:

```text
sat_module.module_key
sat_module.adaptive_role
```

So an active Higher attempt should produce:

```text
runtimeCurrentModuleRole = higher_branch
```

And the frontend mapping is also correct:

```text
lower_branch  → Module 2 · Lower
higher_branch → Module 2 · Higher
```

However `useProctorRouteController.ts` decides whether an incoming student row replaces the current one with:

```ts
next.lastActivity >= existing.lastActivity
```

That is not a valid revision fence for adaptive routing.

`lastActivity` is normally derived from the student's **presence heartbeat**, not from the module attempt revision.

So these can be two different projections:

```text
Response A
heartbeat = 19:20:15
module = Module 1

Response B
heartbeat = 19:20:15
module = Module 2 Higher
```

They have equal `lastActivity` even though their exam state differs.

With overlapping/out-of-order requests, an older projection can replace a newer adaptive-module projection because there is no:

```text
moduleAttemptRevision
attemptRevision
projectionRevision
```

ordering it.

That can explain why staff temporarily sees a module state inconsistent with the authoritative database/result.

### Fix

Expose a proper monotonic revision in the proctor student projection:

```text
attemptRevision
moduleAttemptId
moduleAttemptRevision
moduleId
adaptiveRole
```

Then merge using revision, not heartbeat time.

For example:

```text
higher attempt revision wins
↓
equal revision → newer projection timestamp
↓
older revision can NEVER overwrite
```

Heartbeat timestamp should only describe presence.

---

# What I ruled out

I specifically checked several other plausible causes:

* **Higher and Lower IDs reversed in SAT initialization:** no.
* **`chooseAdaptiveRoute()` reversed:** no; `rawCorrect >= threshold → higher`.
* **Timeout reconciliation selecting a different route:** no; it calls the same `finalizeModuleTx()`.
* **Excel import putting Lower questions into Higher:** current importer maps canonical module key → exact destination module and rejects mismatch.
* **Published version reordering branches:** publishing seals the existing version rather than cloning/reordering them.
* **Result page merely guessing Higher:** no; backend result derives it from terminal module `adaptive_role`.
* **Staff UI mapping `higher_branch → Lower`:** mapping is correct.

So I would **not modify the scoring threshold or swap Higher/Lower IDs**. That would mask this problem and risk making correct routing wrong.

---

# Correct target architecture

There should be one uninterrupted identity chain:

```text
Module 1 score
      ↓
assessment_route_decisions
selected_route = higher
selected_module_id = H123
      ↓
assessment_module_attempts
module_id = H123
      ↓
Student bootstrap
pending/active module_id = H123
      ↓
Runner state
moduleId = H123
      ↓
Question renderer
module.id = H123
      ↓
Proctor session
moduleId = H123
adaptiveRole = higher_branch
      ↓
Final result
route = higher
```

At every boundary, assert:

```text
H123 === H123 === H123 === H123
```

Never:

```text
"Higher"
"rw-m2-higher"
display_order = 2
find(first matching key)
```

as the authority.

### Tests I would require before considering this fixed

1. **Higher-route end-to-end invariant:** score Module 1 above threshold → `selected_module_id = higherID` → only Higher Module 2 attempt exists → start response has `moduleId = higherID` → rendered question IDs all belong to `higherID` → proctor says `higher_branch` → result says `higher`.

2. **Reconnect exactly at adaptive handoff:** cache bootstrap before Module 1 ends → server routes Higher → close/reload → conditional request must **not** reuse an old attempt snapshot → immediately render Higher.

3. **Proctor concurrency test:** issue old detail request before Module 1 transition, then new detail request after Higher begins; deliver responses in reverse order. The final roster **must remain Higher**. An old heartbeat-based snapshot must never regress the module identity.

The biggest design change is simple: **make `moduleId` the authority everywhere after routing, and stop caching/merging live attempt state using static-version or heartbeat identities.** That is the change that makes this class of Higher-vs-Lower disagreement structurally impossible.
Yes. Based on the chain audit of the current `main`, I would implement this as a **SAT adaptive-routing integrity fix**, with the rule:

> Once the server chooses a Module 2 ID, that exact `moduleId` must be the authority everywhere: database → bootstrap → student runner → rendered questions → proctor session → final result.

Do **not** change `chooseAdaptiveRoute()`, the threshold, or swap Higher/Lower IDs. Those parts are already correct.

# Implementation plan

## Phase 0 — Write the failing tests first

Before production changes, create regression tests reproducing the contradiction:

```text
Module 1 score qualifies for Higher
        ↓
route decision = higher
selected_module_id = HIGHER_ID
        ↓
student must open HIGHER_ID
        ↓
proctor must display higher_branch
        ↓
result must display higher
```

The test must fail if **any** surface reads Lower.

Add a second regression reproducing the stale-bootstrap case:

```text
bootstrap before M1 finishes
        ↓
M1 finishes → server creates HIGHER attempt
        ↓
same published version/revision
        ↓
reload/reconnect
        ↓
bootstrap MUST contain HIGHER attempt
```

The existing version-only `304` behavior should make this test red before the fix.

---

# Phase 1 — Stop caching dynamic bootstrap using the static exam-version ETag

### Root problem

`backend/go/cmd/api/handlers_delivery.go`

currently checks `VersionTag()` before executing:

```go
app.Delivery.Bootstrap(...)
```

But the ETag represents only:

```text
publishedVersionId
versionRevision
```

while Bootstrap contains dynamic state:

```text
module attempts
adaptive branch
responses
timing
proctor state
result
```

Those are different cache domains.

## Backend change

Modify:

```text
backend/go/cmd/api/handlers_delivery.go
```

Remove the early conditional response from `deliveryBootstrapInner`.

Remove this behavior from the dynamic bootstrap route:

```go
if _, _, etag, terr := app.Delivery.VersionTag(...); terr == nil {
    if writeETagOrNotModified(...) {
        return
    }
}
```

and do not use:

```go
delivery.VersionETag(out.VersionID, out.VersionRevision)
```

as the cache validator for the complete Bootstrap payload.

Bootstrap should always execute:

```go
out, err := app.Delivery.Bootstrap(...)
```

and return current attempt state.

Add:

```http
Cache-Control: no-store
```

for this endpoint.

### Important

Do **not** remove the internal server `VersionCache`.

This part is good:

```text
published sections/modules/questions
        ↓
VersionCache
```

It reduces database work while `Bootstrap()` can still assemble fresh:

```text
module attempts
responses
timing
routing
result
```

around that cached immutable tree.

So:

```text
SERVER INTERNAL STATIC CACHE     ✅ keep

HTTP CACHE OF WHOLE BOOTSTRAP    ❌ remove
```

## Frontend change

Update:

```text
src/features/student-delivery/api/assessmentDeliveryApi.ts
src/features/student-delivery/application/ports/SatDeliveryGateway.ts
src/features/student-delivery/hooks/useSatExamController.ts
src/features/student-delivery/bootstrap/satBootstrapSeed.ts
```

Change:

```ts
bootstrap(scheduleId, attemptId, ifNoneMatch)
```

to:

```ts
bootstrap(scheduleId, attemptId)
```

Remove `If-None-Match` from dynamic SAT bootstrap requests.

Remove the special:

```ts
if (hasBackendStatusCode(error, 304))
```

handling for SAT attempt bootstrap.

Also remove `deliveryEtag` from the SAT bootstrap seed. A parent handoff may still carry:

```text
scheduleId
attemptId
attemptRevision
runtimeRevision
staticVersionId
```

but it must not claim that a static-version ETag validates dynamic attempt data.

### `bootstrapEtag.ts`

Search all references first.

If it is used exclusively by SAT dynamic bootstrap, delete it and its sessionStorage payload.

If another static endpoint uses it, retain it only for genuinely immutable version content.

Never keep:

```text
sat-bootstrap-etag:{schedule}:{attempt}
```

as authority over adaptive runtime state.

---

# Phase 2 — Make `moduleId` part of the SAT runner state

This is the most important structural change.

Currently the backend selects:

```text
selected_module_id = UUID-HIGHER
```

but the frontend runner later stores only:

```ts
moduleKey
```

That throws away the strongest identity in the system.

## Modify `SatWorkingState`

In:

```text
src/features/student-delivery/application/satRunnerReducer.ts
```

change:

```ts
type SatWorkingState = {
    sectionKey: SatSectionKey;
    moduleKey: string;
    ...
}
```

to:

```ts
type SatWorkingState = {
    sectionKey: SatSectionKey;

    // authoritative runtime identity
    moduleId: string;

    // metadata/display identity only
    moduleKey: string;

    ...
}
```

## Modify runner actions

Change:

```ts
moduleStarted
routeToModule
```

to contain both:

```ts
{
    moduleId: string;
    moduleKey: string;
}
```

`moduleId` is mandatory.

No production route action should be allowed without it.

## Modify `startModuleRouteAction`

In:

```text
src/features/student-delivery/application/satCommitRouting.ts
```

change the action from roughly:

```ts
return {
    type: "routeToModule",
    sectionKey,
    moduleKey: module.moduleKey,
    ...
};
```

to:

```ts
return {
    type: "routeToModule",
    sectionKey,
    moduleId: module.id,
    moduleKey: module.moduleKey,
    ...
};
```

## Modify `newWorkingState`

Persist:

```ts
moduleId: action.moduleId
```

alongside `moduleKey`.

---

# Phase 3 — Never rediscover an active module using `moduleKey`

This code is dangerous:

```ts
data.sections
    .flatMap(section => section.modules)
    .find(candidate => candidate.moduleKey === state.moduleKey)
```

Change all runtime identity lookups to:

```ts
candidate.id === state.moduleId
```

The main location is:

```text
src/features/student-delivery/hooks/useSatExamController.ts
```

Replace:

```ts
const stateModule = ...
    .find(candidate => candidate.moduleKey === state.moduleKey)
```

with:

```ts
const stateModule = data.sections
    .flatMap(section => section.modules)
    .find(candidate => candidate.id === state.moduleId) ?? null;
```

Then audit every SAT runtime lookup for:

```text
moduleKey ===
.find(...moduleKey...)
```

and classify it.

`moduleKey` can still be used for:

```text
display
logging
authoring
labels
analytics dimensions
```

It must not be used for:

```text
active module identity
answer ownership
routing
timer ownership
response persistence
adaptive branch determination
```

---

# Phase 4 — Fix `decideSatCommitRoute()` to compare IDs

There is another key-based comparison in:

```text
src/features/student-delivery/application/satCommitRouting.ts
```

Current logic conceptually does:

```ts
currentModule = find(module.moduleKey === preState.moduleKey)
```

Change it to:

```ts
currentModule = find(module.id === preState.moduleId)
```

And change:

```ts
nextModule.moduleKey !== preState.moduleKey
```

to:

```ts
nextModule.id !== preState.moduleId
```

The adaptive transition becomes:

```text
current active ID
        ↓
current attempt ID
        ↓
server creates next module attempt
        ↓
nextAttempt.moduleId
        ↓
nextModule.id
```

No name/key comparison.

---

# Phase 5 — Change dedupe keys from moduleKey → moduleId

Several safety/reconciliation effects currently key work with values such as:

```text
versionId
runtimeRevision
phase
moduleKey
```

For runtime correctness, change them to:

```text
versionId
runtimeRevision
phase
moduleId
moduleAttemptId when available
```

For example:

```ts
`${versionId}:${runtimeRevision}:${phase}:${moduleId}`
```

or, preferably when the attempt exists:

```ts
`${versionId}:${runtimeRevision}:${moduleId}:${moduleAttemptId}`
```

This prevents two adaptive branches occupying the same logical “Module 2” slot from sharing a dedupe identity.

---

# Phase 6 — Protect legacy/recovered runner states

If any persisted or recovered `SatRunnerState` can exist without `moduleId`, do **not** silently do:

```ts
find(module.moduleKey === oldState.moduleKey)
```

and choose the first match.

Use a compatibility resolver only during migration.

Safe order:

```text
1. moduleId present
   → use it

2. moduleId absent
   → compare moduleKey + exact questionIds

3. exactly one module matches
   → migrate to its ID

4. zero or multiple matches
   → do not guess
   → return to authoritative bootstrap/directions recovery
```

Fail closed.

Wrong-module delivery is worse than requiring one extra bootstrap.

---

# Phase 7 — Make the proctor student projection carry runtime identities

The backend proctor query already joins the actual active SAT module, which is good.

Extend:

```text
backend/go/internal/proctor/sessions.go
```

to expose the identities needed to order projections correctly.

Add to the query:

```sql
sa.revision,
sat_attempt.id,
sat_attempt.module_id,
sat_attempt.revision
```

Keep:

```sql
sat_module.module_key,
sat_module.adaptive_role
```

Add fields to the backend DTO such as:

```text
attemptRevision
runtimeCurrentModuleId
runtimeModuleAttemptId
runtimeModuleAttemptRevision
runtimeCurrentModuleRole
```

No DB migration should be necessary; these columns already exist.

The resulting student projection should identify:

```text
Attempt
  revision = 42

Active module attempt
  id = MA-HIGHER
  moduleId = MOD-HIGHER
  revision = 1
  role = higher_branch
```

---

# Phase 8 — Stop using heartbeat time as the proctor merge version

Current proctor frontend merging contains logic like:

```ts
return next.lastActivity >= existing.lastActivity
    ? next
    : existing;
```

That is incorrect for exam state.

Heartbeat freshness and exam-state freshness are unrelated.

Modify:

```text
src/features/proctor/hooks/useProctorRouteController.ts
```

Create one pure function:

```ts
sessionProjectionSupersedes(existing, incoming)
```

Use this order:

```text
1. attemptRevision

2. if same attemptRevision:
   runtime module identity / module-attempt revision

3. if still tied:
   server projection timestamp

4. exact tie:
   keep existing
```

Never use:

```text
lastActivity
```

to decide which exam module wins.

`lastActivity` should only answer:

> When did we last hear from this student?

It must never answer:

> Which SAT adaptive module is authoritative?

---

# Phase 9 — Fail closed on impossible route/module contradictions

Add a backend consistency guard.

Once a section has:

```text
assessment_route_decisions.selected_module_id
```

and has a branch attempt, those IDs must match.

Conceptual invariant:

```text
route_decision.selected_module_id
    ==
branch_module_attempt.module_id
```

If they differ, do not silently continue.

Produce a structured internal conflict such as:

```text
SAT_ADAPTIVE_ROUTE_INTEGRITY
```

and log:

```text
attempt_id
section_id
selected_module_id
actual_module_id
selected_route
actual_adaptive_role
```

No student answers in the log.

This should effectively never execute after the fix. Its purpose is detecting data corruption rather than allowing a contradictory exam to continue.

---

# Phase 10 — Validate final result against the route decision

The result code currently correctly derives the route from the actual administered branch.

Keep that.

But before persistence, verify:

```text
route decision.selected_module_id
        ==
submitted adaptive module.module_id
```

and:

```text
selected_route = higher
        ↔
adaptive_role = higher_branch
```

Likewise:

```text
selected_route = lower
        ↔
adaptive_role = lower_branch
```

If this fails, finalization should fail loudly rather than generate a misleading result.

This gives you a last-line integrity fence.

---

# Rigorous tests

## 1. Routing boundary unit tests

Target:

```text
backend/go/internal/delivery/start_branch_module_test.go
backend/go/internal/delivery/sat_v2_scoring_test.go
```

For an operational count of `25` and threshold `13`:

```text
rawCorrect 12 → lower
rawCorrect 13 → higher
rawCorrect 14 → higher
```

Assert the returned **module ID**, not only `"higher"`.

For Higher:

```text
returned module.id == higher_module_id
returned adaptiveRole == higher_branch
```

For Lower:

```text
returned module.id == lower_module_id
returned adaptiveRole == lower_branch
```

---

## 2. Persisted route-decision integration test

Use real MySQL integration, not only sqlmock.

### Given

```text
base module = BASE
lower module = LOW
higher module = HIGH

threshold = 13
rawCorrect = 20
```

### When

Module 1 finalizes.

### Then

Exactly one:

```sql
assessment_route_decisions
```

exists with:

```text
selected_route = higher
selected_module_id = HIGH
base_module_id = BASE
```

Exactly one successor attempt exists:

```text
module_id = HIGH
state = not_started
```

And:

```text
LOW has no module attempt
```

This is an essential invariant.

---

# 3. Timeout routing parity

Module 1 normally ends through the timeout reconciler, so test it independently.

### Given

Module 1 is active and its authoritative clock expires.

Student's saved answers qualify for Higher.

### When

```text
ReconcileAttemptTimeout()
```

runs.

### Then

It must produce the exact same:

```text
route decision = higher
selected module ID = HIGH
next module attempt = HIGH
```

as direct finalization.

No special Lower default may exist in the timeout path.

---

# 4. Concurrent Module 1 finalization

This should be a real database concurrency test.

Start two goroutines simultaneously:

```text
ReconcileAttemptTimeout(A)
ReconcileAttemptTimeout(A)
```

or equivalent competing finalizers.

Assert after both settle:

```text
1 route decision
1 HIGH module attempt
0 LOW module attempts
1 finalized BASE module
```

Never:

```text
HIGH + LOW
```

and never duplicate HIGH attempts.

Run this with Go race detection too.

---

# 5. Dynamic bootstrap regression — critical

This test specifically pins the ETag bug.

### Given

First bootstrap:

```text
M1 active
version = V1
version revision = 7
```

Then M1 finishes and server selects:

```text
HIGH
```

Published version remains:

```text
V1 revision 7
```

### When

Client requests Bootstrap again while sending the old version ETag.

### Required result after the fix

```text
HTTP 200
```

not:

```text
304
```

And response contains:

```text
moduleAttempt.moduleId == HIGH
```

This test should directly prove that exam-version equality cannot suppress live attempt updates.

---

# 6. Reload at exact adaptive handoff

Browser integration test.

### Sequence

```text
student enters M1
↓
answers enough for Higher
↓
M1 expires
↓
server creates HIGH attempt
↓
browser closes/reloads before M2 starts
↓
student resumes
```

Assert:

```text
pendingModule.id == HIGH
pendingModule.adaptiveRole == higher_branch
```

Then automatic start must call:

```text
POST /modules/start
{ moduleId: HIGH }
```

Never LOW.

---

# 7. Runner identity unit test

Target:

```text
satRunnerReducer
satCommitRouting
```

Start with:

```text
routeToModule {
  moduleId: "HIGH-ID",
  moduleKey: "rw-m2-higher"
}
```

Assert working state contains:

```text
moduleId = HIGH-ID
moduleKey = rw-m2-higher
```

Then provide payload containing both:

```text
LOW-ID
HIGH-ID
```

and verify `stateModule` resolves:

```text
HIGH-ID
```

regardless of array order.

Reverse module array order and run again.

Result must be identical.

---

# 8. Duplicate/business-key defense test

Create a synthetic payload where multiple modules intentionally have confusing or duplicate display/business metadata.

For example:

```text
module A:
 id = LOW-ID
 moduleKey = module-2

module B:
 id = HIGH-ID
 moduleKey = module-2
```

Runner state:

```text
moduleId = HIGH-ID
```

Assert renderer selects:

```text
HIGH-ID
```

This test proves the student runtime does not depend on module-key uniqueness.

---

# 9. Question ownership test

Once Higher is selected:

```text
HIGH-ID
```

every rendered question must belong to that module.

Assert:

```text
stateModule.id == HIGH-ID
questionIds == HIGH.questions
```

and:

```text
intersection(renderedQuestionIds, LOW.questionIds) == ∅
```

Also verify answer persistence uses the Higher:

```text
moduleAttemptId
```

---

# 10. Start-module response test

Mock:

```text
pending attempt = HIGH not_started
```

Call:

```text
startPendingModule()
```

Server returns:

```text
HIGH active
```

Assert the single atomic commit performs:

```text
data = payload containing HIGH
state.phase = module
state.moduleId = HIGH
state.moduleKey = rw-m2-higher
```

There must never be an intermediate render with:

```text
new payload + old module identity
```

---

# 11. Proctor Higher projection backend test

Target:

```text
backend/go/internal/proctor/sessions.go
```

Database:

```text
LOW no active attempt
HIGH active attempt
adaptive_role = higher_branch
```

Assert API projection:

```text
runtimeCurrentModuleId = HIGH
runtimeModuleAttemptId = HIGH-ATTEMPT
runtimeCurrentModuleRole = higher_branch
```

Do not assert from `student_attempts.current_module`; SAT should remain authoritative from `assessment_module_attempts`.

---

# 12. Out-of-order proctor request test — critical

This reproduces the likely session-page contradiction.

Construct:

```text
Snapshot A
attemptRevision = 10
module = Module 1
heartbeat = 12:00:00

Snapshot B
attemptRevision = 12
module = HIGH
heartbeat = 12:00:00
```

Apply B first.

Then apply A.

Final state must remain:

```text
HIGH
```

Even though:

```text
lastActivity(A) == lastActivity(B)
```

Then add another test where:

```text
A.lastActivity > B.lastActivity
```

but:

```text
A.attemptRevision < B.attemptRevision
```

B must still win.

That proves heartbeat timestamps can no longer regress exam state.

---

# 13. Proctor same-revision enrichment test

If two projections have the same:

```text
attemptRevision
moduleAttemptId
moduleAttemptRevision
```

but one carries extra non-authoritative information such as:

```text
warnings
heartbeat
email
```

merge that enrichment without replacing a newer runtime identity.

This prevents the new revision guard from accidentally freezing useful staff updates.

---

# 14. Result integrity test

### Given

Route decision:

```text
selected_route = higher
selected_module_id = HIGH
```

Terminal module:

```text
module_id = HIGH
adaptive_role = higher_branch
```

Result must be:

```text
route = higher
```

Then deliberately construct corrupt data:

```text
route decision = HIGH
terminal module = LOW
```

Expected:

```text
finalization rejected
SAT_ADAPTIVE_ROUTE_INTEGRITY
```

No result should be persisted.

---

# 15. Full Higher end-to-end acceptance test

This is the most important complete test.

```text
Create SAT
→ publish
→ create schedule
→ start runtime
→ student enters RW M1
→ answer enough operational questions correctly
→ allow M1 to expire
→ server routes Higher
→ student auto-enters RW M2 Higher
→ inspect rendered question IDs
→ inspect staff Session page projection
→ finish exam
→ inspect result
```

All four authorities must agree:

```text
assessment_route_decisions.selected_module_id = HIGH

student runner.state.moduleId = HIGH

proctor.runtimeCurrentModuleId = HIGH

result.section.route = higher
```

And:

```text
LOW was never active
LOW answers = 0
```

---

# 16. Full Lower control test

Repeat exactly the same scenario with a score below threshold.

Everything must become:

```text
LOW
lower_branch
lower
```

This prevents fixing Higher while accidentally breaking Lower.

---

# 17. High-concurrency cohort test

Run a cohort where students finish Module 1 almost simultaneously:

```text
25–100 attempts

mix:
Higher
Lower
Higher
Higher
Lower
...
```

Run timeout reconciliation concurrently.

For every student assert:

```text
exactly one route decision
exactly one branch module attempt
branch module == route selected_module_id
student bootstrap == branch module
proctor projection == branch module
result == branch role
```

Also assert there is never a student with:

```text
two adaptive branch attempts
```

for the same section.

---

# 18. Reconnect/concurrency torture test

For a Higher student repeatedly trigger around the Module 1 boundary:

```text
bootstrap
heartbeat
proctor detail poll
student poll
runtime websocket update
browser reload
module start
another bootstrap
```

Deliver responses intentionally out of order.

The invariant remains:

```text
once HIGH becomes authoritative,
no older projection can return the UI to LOW or Module 1.
```

This is where the revision-based merge must prove itself.

---

# Observability

Add a low-cardinality metric around routing:

```text
sat_adaptive_route_total{
  section="reading-writing",
  route="higher"
}
```

and module opening:

```text
sat_adaptive_module_open_total{
  role="higher_branch"
}
```

Add an integrity counter:

```text
sat_adaptive_integrity_violation_total{
  reason="route_module_mismatch"
}
```

The expected production value of the last metric is:

```text
0
```

Do not log question answers.

---

# Required invariants

After implementation, these should be written directly into test names/comments:

```text
RouteDecision.selectedModuleId
    ==
ModuleAttempt.moduleId
    ==
Runner.moduleId
    ==
RenderedModule.id
    ==
Proctor.runtimeCurrentModuleId
    ==
Result-administered branch module id
```

And:

```text
moduleKey is metadata, never runtime authority.
```

And:

```text
exam version revision is not an attempt-state cache validator.
```

And:

```text
heartbeat freshness is not exam-state freshness.
```

# Release gate

I would not ship until all of these pass:

```text
Go delivery tests
Go SAT tests
Go proctor tests
MySQL integration tests
Go -race on touched backend packages

frontend unit tests
SAT controller/reducer tests
proctor merge tests
TypeScript typecheck

Playwright:
Higher normal
Lower normal
Higher timeout
reload at Module 1 → Module 2 boundary
out-of-order/stale projection scenario
```

The key acceptance requirement is not merely “the screen now shows Higher.” It is:

> **For every SAT section, it must be impossible for routing, delivered questions, staff monitoring, and final result to disagree about which adaptive Module 2 the student received.**
