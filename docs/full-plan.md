# Production Rewrite Specification

## Go Backend + V2-Only Attempt Engine + SOLID React Frontend

**Status:** Target Architecture / Implementation Specification
**Primary goal:** Rewrite the backend in Go and restructure the React frontend without intentionally changing UI, user workflows, exam rules, grading semantics, or externally observable business behavior.
**Durability decision:** Protocol V2 becomes the single canonical student response protocol. V1 is migration-only and is removed after existing V1 attempts drain.
**Products:** IELTS + Digital SAT + ACT / ACT Science.

---

# 1. Executive Decision

The target system is:

```text
React / TypeScript SPA
        │
        │ generated typed API contract
        ▼
Go Modular Monolith
        │
        ├── Authentication / Authorization
        ├── Exam Authoring
        ├── Scheduling / Runtime
        ├── V2 Attempt Engine
        ├── Provider Completion Policies
        │      ├── IELTS
        │      ├── SAT
        │      └── ACT
        ├── Terminalization
        ├── Proctoring
        ├── Grading / Results
        ├── Live Updates
        └── Background Jobs
        │
        ▼
MySQL / TiDB
```

The rewrite must not become a microservice migration.

The database remains the primary durable coordination layer for:

* transactions;
* locks;
* idempotency;
* response ledgers;
* outbox;
* live-event persistence;
* websocket leases;
* terminalization receipts;
* projection checkpoints.

The current system's important concurrency machinery is relational and transaction-based, and that characteristic must survive the rewrite.

---

# 2. Product Contract

The target product is the union of both existing code lineages:

```text
IELTS
+
SAT
+
ACT / ACT Science
```

The rewrite must merge **features, not files**.

The backend map explicitly identifies the product union as IELTS, SAT and ACT, with SAT/V2 on one lineage and ACT Science on the other. The frontend map likewise requires the union of SAT authoring/V2 behavior and ACT-specific authoring/student/grading behavior.
No product behavior may disappear merely because it existed on only one branch.

---

# 3. Behavior-Preservation Rule

This project is an architectural rewrite.

It is not a redesign.

Unless separately approved as a product change, preserve:

* route behavior;
* visible UI;
* layout;
* responsive behavior;
* wording;
* navigation;
* form behavior;
* exam navigation;
* question rendering;
* timing;
* keyboard behavior;
* highlights;
* calculator/reference-sheet behavior;
* proctor controls;
* loading states;
* retry states;
* empty states;
* error states;
* accessibility behavior;
* animation/motion;
* exam defaults;
* validation rules;
* scoring;
* grading workflow;
* result release;
* exports.

A prettier architecture is not justification for behavioral drift.

---

# 4. Rewrite Principles

## 4.1 One business rule, one owner

Every important state transition must have one application-layer owner.

Examples:

```text
response mutation       → Attempt V2 Engine
terminal fact           → Terminalization
runtime transition      → Runtime Service
proctor lifecycle       → Proctor Service
ACT Science score       → ACT Scoring Domain
SAT adaptive completion → SAT Delivery Domain
grading release         → Grading Workflow
```

Avoid multiple React hooks, route handlers, repositories, and workers independently implementing the same rule.

---

## 4.2 Transactions belong to application use cases

Repositories expose database operations.

They do not secretly decide transaction boundaries.

Correct:

```go
func (s *Service) Submit(ctx context.Context, cmd SubmitCommand) error {
    return s.tx.WithTx(ctx, func(tx Tx) error {
        ...
    })
}
```

Incorrect:

```text
repository method A starts tx
repository method B starts another tx
service assumes operation is atomic
```

---

## 4.3 Explicit SQL for correctness-sensitive paths

Use typed or reviewed SQL.

Do not hide critical concurrency behavior behind a generic ORM.

The following must remain obvious in source code:

```sql
SELECT ... FOR UPDATE
UPDATE ... WHERE revision = ?
RowsAffected()
UNIQUE constraints
INSERT-only receipts
conditional claims
```

Particularly sensitive modules:

* V2 writes;
* submit;
* runtime transitions;
* proctor actions;
* terminalization;
* adaptive SAT completion;
* outbox claiming;
* worker checkpoints.

---

## 4.4 Server authority

The browser may propose commands.

It does not own authoritative:

* clocks;
* terminal state;
* lease ownership;
* grading score;
* ACT Science score;
* SAT routing;
* SAT score;
* result release;
* proctor state.

---

# 5. Target Repository

Recommended monorepo:

```text
/
├── apps/
│   └── web/
│
├── backend/
│   ├── cmd/
│   │   ├── api/
│   │   ├── worker/
│   │   └── migrate/
│   │
│   ├── internal/
│   │   ├── platform/
│   │   ├── auth/
│   │   ├── exams/
│   │   ├── authoring/
│   │   ├── schedules/
│   │   ├── runtime/
│   │   ├── attempts/
│   │   ├── terminalization/
│   │   ├── proctor/
│   │   ├── sat/
│   │   ├── act/
│   │   ├── grading/
│   │   ├── results/
│   │   ├── liveupdates/
│   │   ├── outbox/
│   │   ├── media/
│   │   └── maintenance/
│   │
│   ├── migrations/
│   ├── contracts/
│   └── integration/
│
├── api/
│   └── openapi/
│
├── packages/
│   ├── api-client/
│   └── test-fixtures/
│
└── docs/
    ├── architecture/
    ├── adr/
    └── runbooks/
```

Do not share Go domain objects directly with TypeScript.

Share the **wire contract** through generated API schemas.

---

# 6. Backend Process Model

Maintain three process roles:

```text
api
worker
migrate
```

They can be built from the same repository/image.

## API

Responsible for:

* HTTP;
* authentication;
* websocket upgrades;
* synchronous application commands;
* reads.

## Worker

Responsible for:

* outbox;
* SAT reconciliation;
* runtime reconciliation;
* grading projections;
* retention;
* media cleanup;
* invariant audits.

## Migrator

Responsible only for:

* migration history;
* schema upgrades;
* post-migration verification.

The API runtime DB account should not require schema-altering privileges.

---

# 7. Go Platform Layer

Target:

```text
internal/platform/
├── config/
├── db/
├── tx/
├── httpx/
├── errors/
├── telemetry/
├── clock/
├── crypto/
├── objectstore/
└── shutdown/
```

Platform packages must not contain exam business logic.

---

# 8. Dependency Injection

Use explicit constructor injection.

Example:

```go
type App struct {
    Attempts        *attempts.Service
    Runtime         *runtime.Service
    Terminalization *terminalization.Service
    Proctor         *proctor.Service
}
```

Construction occurs centrally:

```go
func BuildApp(cfg Config) (*App, error)
```

Do not use:

* service locator;
* global mutable singleton;
* package-global DB;
* implicit environment lookup deep inside services.

Configuration is loaded once, validated once, then passed explicitly.

---

# 9. Context and Cancellation

Every IO path accepts:

```go
context.Context
```

Including:

* SQL;
* object storage;
* external exporters;
* worker operations;
* websocket leases;
* shutdown.

Request cancellation must terminate abandoned DB work when safe.

Workers use bounded contexts per batch.

---

# 10. HTTP Server

Set explicit:

* header read timeout;
* body read timeout;
* write timeout where appropriate;
* idle timeout;
* maximum header size;
* endpoint-specific body limits.

Large SAT workbook import endpoints get separate larger request limits.

Student mutation endpoints remain tightly bounded.

---

# 11. Middleware Ordering

Recommended conceptual order:

```text
panic recovery
↓
request id
↓
trace/span
↓
security headers
↓
body limit
↓
authentication
↓
CSRF where applicable
↓
rate limiting
↓
authorization
↓
handler
↓
structured access log
```

Authorization is still rechecked inside sensitive application services.

Middleware is not the sole authorization boundary.

---

# 12. API Contract

Maintain stable success/error behavior during rewrite.

Current clients depend on stable machine-readable errors and conflicts.

Target error envelope:

```json
{
  "code": "CONTROL_EPOCH_STALE",
  "message": "Attempt controls changed; refresh before retrying.",
  "details": {},
  "requestId": "..."
}
```

Never expose:

* SQL text;
* driver errors;
* stack traces;
* internal filenames;
* raw panic text.

---

# 13. OpenAPI as Wire Authority

**Target-design decision.**

Create one checked-in OpenAPI contract.

Generate:

```text
Go transport DTO validation support
TypeScript API types/client
test fixtures where useful
```

CI fails if generated outputs are stale.

Domain types remain independent from generated transport types.

---

# 14. V2 Is the Only Target Student Protocol

New Go code must not have a permanent:

```go
switch attempt.ProtocolVersion {
case 1:
    ...
case 2:
    ...
}
```

Target:

```text
new attempt = V2
```

Legacy V1 support exists only in the old service or temporary compatibility layer until active V1 attempts are gone.

---

# 15. V2 Core Responsibilities

The V2 core owns:

```text
writer lease
control fencing
response ordering
idempotent response commands
server revision
response projection
immutable mutation ledger
deadline/grace writability
snapshot recovery
final digest
submission receipt
```

It must remain provider-neutral.

Do not put SAT adaptive scoring inside the V2 engine.

---

# 16. V2 Canonical Storage

Continue existing production table names during first migration:

```text
attempt_responses_v2
attempt_mutations_v2
attempt_submissions_v2
student_attempts
```

Do not rename them during the language rewrite merely for aesthetics.

The schema currently uses unique constraints on V2 write identities and submission identities as part of concurrency correctness.

Possible renaming can be a later independent migration.

---

# 17. Response Aggregate

A student response should be a full aggregate rather than an operation delta.

Canonical conceptual shape:

```ts
type ResponsePayload = {
  answer: unknown;
  markedForReview: boolean;
  eliminatedOptions: string[];
  annotations: Annotation[];
};
```

Provider validation defines the legal `answer` structure.

Persist enough data to represent:

* IELTS objective answers;
* IELTS writing;
* SAT MCQ;
* SAT SPR;
* ACT answers;
* ACT eliminated choices;
* annotations/highlights where they are response-owned.

---

# 18. Response Command

```go
type ResponseCommand struct {
    WriteID       string
    QuestionID    string
    ClientVersion uint64
    Response      ResponsePayload
}
```

Request envelope:

```go
type SaveResponsesCommand struct {
    AttemptID    string
    LeaseEpoch   uint64
    ControlEpoch uint64
    Commands     []ResponseCommand
}
```

The client must not submit database revision numbers as authority except where specifically defined by the protocol.

---

# 19. V2 Hashing

Preserve canonical hashing semantics.

The existing V2 design computes deterministic hashes and a final response digest over sorted question/hash pairs.

Requirements:

1. JSON canonicalization is deterministic.
2. Object key ordering does not affect hash.
3. Hash algorithm is fixed and versioned.
4. Existing attempts cannot silently switch hash algorithm.
5. Test vectors live in both Go and TypeScript.
6. Submit digest is reproducible from persisted server state.

Do not implement hashing twice with subtly different canonicalization logic.

Maintain golden vectors.

---

# 20. V2 Write Algorithm

Canonical transaction:

```text
BEGIN

1. SELECT attempt FOR UPDATE

2. validate:
   - attempt identity
   - user
   - schedule
   - organization
   - token/session
   - protocol eligibility

3. inspect write IDs

4. exact replay?
      yes:
          return previously stored acknowledgements
          subject to current lease authorization

5. verify lease_epoch

6. verify control_epoch

7. lock runtime

8. lock active section

9. obtain authoritative server/DB time

10. ensure attempt writable

11. ensure runtime writable

12. validate commands

13. apply commands

14. INSERT immutable mutation rows

15. UPSERT/UPDATE canonical response projection

16. mirror compatibility projection if still required

17. increment response_revision

COMMIT
```

Global lock order remains:

```text
attempt
→ runtime
→ active section
```

This lock order is explicitly part of the existing system's concurrency contract.

---

# 21. Exact Replay Rule

An exact previously accepted write can be acknowledged again.

It must not mutate state twice.

An old write ID with a different command hash is not a duplicate.

It is a conflict.

This distinction is mandatory.

---

# 22. Client Version Rule

`client_version` is monotonically increasing per question within the active writer lease.

Gaps are valid.

Example:

```text
1
2
5
9
```

because intermediate unsent states may be coalesced.

A stale request may not overwrite a higher accepted logical version.

---

# 23. Lease Ownership

Every attempt uses explicit writer leasing.

```text
lease_epoch = N
```

A takeover makes:

```text
lease_epoch = N + 1
```

Any previous credential is now stale.

Old writer attempts return a stable fencing conflict.

There is one authoritative physical writer at a time.

---

# 24. Takeover

Takeover transaction:

```text
lock attempt
validate authenticated candidate
ensure attempt not closed
validate existing attempt session
increment lease_epoch
revoke/supersede competing attempt sessions
issue new credential containing new lease
commit
```

Do not allow takeover after terminal/provisional closure where existing behavior prohibits it.

---

# 25. Control Epoch

Every control boundary that can alter student writability must fence in-flight writes.

Examples:

* pause;
* resume;
* relevant extension;
* runtime progression;
* terminalization;
* proctor termination.

Result:

```text
request.control_epoch != attempt.control_epoch
→ CONTROL_EPOCH_STALE
```

The current proctor/V2 design relies on these epoch changes to prevent in-flight command batches from crossing lifecycle boundaries.

---

# 26. Server-Authoritative Timing

Student command acceptance is decided by server/database time.

Never trust browser wall time for:

* deadline acceptance;
* pause duration;
* grace boundary;
* terminal effective time.

Preserve:

```text
deadline_at
closing_grace_until
```

and the existing 30-second closing grace semantics.

Timestamp precision must not be rounded to whole seconds where the current schema uses `TIMESTAMP(6)`.

---

# 27. Pause / Resume

For V2 attempts:

## Pause

* student writes become blocked;
* relevant lifecycle status updates;
* `control_epoch++`;
* active SAT module pause state is preserved as currently defined.

## Resume

* paused wall time is added back to deadline where current behavior requires;
* grace is re-anchored;
* `control_epoch++`;
* SAT module pause accumulation is updated.

The existing proctor design treats deadline compensation and control-epoch bumps as correctness machinery, not decoration.

---

# 28. Submission Common Preamble

Every provider submission uses:

```text
lock attempt

validate attempt token/session

validate lease

load existing submission receipt

replay if same submission intent/hash

reject submission-ID misuse

validate expected response revision

lock runtime gate

apply final commands

compute final response digest
```

Only after this point does provider completion behavior diverge.

---

# 29. IELTS Completion Policy

IELTS is direct completion:

```text
V2 submit
↓
final commands
↓
final digest
↓
Terminalize(
  outcome = submitted,
  reason = student_submit
)
↓
attempt_submissions_v2 receipt
```

Existing grading behavior reads the immutable final state.

The durability transport changes.

The grading semantics do not.

---

# 30. ACT Completion Policy

ACT also uses direct completion.

However ACT Science score must remain server-authoritative.

Existing ACT behavior computes Science scoring on authoritative backend state and rejects reliance on a client-provided score.

Target:

```text
V2 final answers
↓
server ACT scoring
↓
result/final projection
↓
Terminalize(submitted)
↓
V2 submission receipt
```

The client may display provisional calculations only if product requirements explicitly allow them, but they can never become authoritative.

---

# 31. SAT Completion Policy

SAT preserves two-phase completion.

This is not optional simplification.

Existing SAT V2 submit intentionally reaches:

```text
delivery_status = submitted
phase = post-exam
submitted_at = NULL
final_submission = NULL
```

so student writing is closed while authoritative scoring can still complete later.

Flow:

```text
Student V2 Submit
        │
        ▼
Provisional Closed State
        │
        ├── proctor may terminate
        ├── timeout reconciler may finish
        └── SAT scorer may complete
        │
        ▼
SAT Assessment Result
        │
        ▼
Terminalize(reason = sat_complete)
```

---

# 32. SAT Provisional Write Rules

While provisionally submitted:

Allowed:

* exact response replay;
* authorized response snapshot read;
* SAT completion/scoring;
* timeout reconciliation;
* valid proctor terminalization.

Rejected:

* new response mutation;
* new module work;
* lease takeover where current terminal guard rejects it.

This existing write matrix must remain intact.

---

# 33. SAT Completion Watchdog

**Target production improvement.**

The current design documents a gap:

> a SAT attempt may remain provisionally submitted indefinitely if every module is already terminal but `complete_assessment` never executes.

Add:

```text
SATProvisionalCompletionReconciler
```

Selection predicate conceptually:

```text
provider = SAT
delivery_status = submitted
phase = post-exam
submitted_at IS NULL
final_submission IS NULL
no terminalization receipt
all required modules terminal
```

Worker behavior:

1. lock attempt;
2. re-evaluate predicate;
3. check proctor termination;
4. rebuild/complete authoritative SAT scoring if needed;
5. call the same completion service;
6. terminalize using the normal path;
7. commit.

It must never manufacture a fake score.

It invokes the same authoritative SAT completion implementation used synchronously.

---

# 34. Terminalization Boundary

Terminalization must remain independent from V2.

```text
attempts
sat
act
proctor
runtime reconciliation
auto-submit
        │
        ▼
Terminalization Service
```

Public application interface:

```go
type Service interface {
    Terminalize(
        ctx context.Context,
        cmd SealCommand,
    ) (SealResult, error)
}
```

The terminalization design is already defined as the single source of truth in the current rewrite material.

---

# 35. Terminalization Invariants

Mandatory:

### T1 — one receipt

```text
attempt_terminalizations.attempt_id
```

is unique / primary-key authoritative.

### T2 — immutable

Once inserted:

```text
UPDATE forbidden
DELETE forbidden
```

### T3 — replay

Same requested outcome:

```text
return stored receipt
```

### T4 — incompatible replay

Different outcome:

```text
TERMINALIZATION_CONFLICT
```

Never overwrite the old outcome.

### T5 — server-owned snapshot

Build final snapshot from locked server state.

Never freeze arbitrary client payload as authoritative terminal state.

---

# 36. Receipt-First Ordering

Terminalization sequence:

```text
BEGIN

lock attempt

find terminal receipt

replay/conflict

validate outcome/reason

apply revision fence

lock SAT provider state when required

build terminal snapshot

INSERT attempt_terminalizations

UPDATE / claim student_attempts

materialize provider result

enqueue terminalization outbox event

COMMIT
```

Receipt insertion **must precede** the attempt terminal claim.

This ordering is part of the current correctness proof.

---

# 37. SAT Provisional Claim Predicate

The terminal claim must retain the semantic branch allowing a provisional SAT attempt to be claimed:

```text
delivery_status = submitted
AND phase = post-exam
AND final_submission IS NULL
```

The current design explicitly identifies this condition as the handshake between SAT provisional state and terminalization.

Do not refactor it away into a predicate that merely looks equivalent without concurrency tests.

---

# 38. Terminal Receipt Repository

Public repository interface:

```go
type TerminalizationRepository interface {
    FindByAttemptID(...)
    Insert(...)
}
```

There must be no application methods named:

```text
Update
Delete
Upsert
Save
```

for terminal receipts.

---

# 39. Trigger Migration

Current MySQL environments may have four terminalization triggers.

The rewrite must support:

```text
MySQL + triggers
MySQL without triggers
TiDB without triggers
```

The trigger replacement plan requires application-level equivalence for:

* receipt/terminal consistency;
* immutability;
* one receipt;
* receipt-first visibility;
* rolling-deploy stragglers.

---

# 40. Missing Receipt Repair

Maintain:

```go
RepairMissingReceipts(ctx, batchSize)
```

Predicate must be:

```text
submitted_at IS NOT NULL
AND terminalization receipt missing
```

Never use only:

```text
delivery_status = submitted
```

because that would incorrectly terminalize SAT provisional attempts.

---

# 41. Runtime Domain

Runtime remains an explicit state machine.

Conceptually:

```text
not_started
    ↓
live
 ↙       ↘
paused    completed
  ↓
live

cancelled as defined by existing commands
```

Runtime owns:

* active section;
* current section;
* waiting state;
* start;
* pause;
* resume;
* extension;
* completion;
* revision.

---

# 42. Runtime Revision

Mutating staff commands carry appropriate optimistic-concurrency fences.

Where current behavior uses:

```text
expected_runtime_revision
expected_active_section_key
```

preserve them.

A stale staff screen must not silently apply a command to a different runtime state.

---

# 43. Proctor Service

One application service owns all proctor commands:

```text
warn
pause
resume
extend attempt
terminate

end section now
extend section
complete exam

presence
ack alert
```

The existing proctor map defines the exact write behavior and lock scope for these actions.

---

# 44. Proctor Lock Discipline

Per-attempt:

```text
attempt
→ runtime
→ active section
```

Schedule-wide controls:

```text
schedule attempts
→ schedule/runtime terminalization scope
```

Never acquire these in reverse order.

Add explicit concurrency tests to prevent future lock-order drift.

---

# 45. Extend-Attempt Provisional Behavior

The current proctor design documents an inconsistent partial extension possibility during SAT provisional state.

For production rewrite, choose one explicit behavior.

Recommended:

```text
if attempt is provisionally closed:
    extend-attempt → Conflict
```

because a post-submit student cannot resume work and partially changing only module extension state is misleading.

This is a correctness cleanup and should be tracked as an approved compatibility fix.

If strict byte-for-byte behavioral equivalence is required, retain the old behavior temporarily and remove it under a separate product migration.

---

# 46. Authentication

Preserve the current credential categories:

## Session cookie

Used for staff/student web session.

Maintain:

* secure cookie;
* HTTP-only;
* secure in production;
* appropriate SameSite;
* idle expiry;
* absolute expiry;
* logout;
* logout-all;
* server-side revocation.

Current system uses session cookies plus CSRF protection for cookie-authenticated writes.

## Attempt bearer token

Used for exam response writes.

Contains enough claims to bind:

* token;
* user;
* schedule;
* attempt;
* client session;
* organization;
* lease.

Server-side attempt-session state remains revocable.

---

# 47. CSRF

Cookie-authenticated mutations retain:

```text
CSRF cookie
+
x-csrf-token
+
origin validation
```

Attempt-token bearer writes are authenticated separately.

Do not weaken staff CSRF merely because the student V2 path uses a bearer credential.

---

# 48. Authorization

Roles remain:

```text
Admin
AdminObserver
Builder
Proctor
Grader
Student
```

Authorization must include tenant/schedule/student scope.

Pattern:

```go
actor := ActorContext{
    UserID:         ...,
    Role:           ...,
    OrganizationID: ...,
    ScheduleScope:  ...,
}
```

Application services receive the actor context.

Repositories receive derived scope or explicit organization predicates.

Never trust organization IDs supplied in a request body when identity already determines scope.

---

# 49. Database Scope

Every tenant-owned data access must be reviewable for:

```text
organization_id
schedule scope
student ownership
shared-library exception where intended
```

No accidental cross-organization read/write.

Test negative authorization explicitly.

---

# 50. Schema Reconciliation

The source material confirms two migration lineages with a collision at `0032`.

Canonical historical union:

```text
0001 ... 0031
0032_provider_neutral_sat.sql
...
0049_response_durability_v2.sql
0050_act_science_support.sql
```

Do not edit already-recorded migration history in place.

Existing environments converge through additive migrations.

---

# 51. New Go Migration Ledger

Target ledger:

```sql
schema_migration_versions (
    version        BIGINT PRIMARY KEY,
    name           VARCHAR(255) NOT NULL,
    checksum       CHAR(64) NOT NULL,
    applied_at     TIMESTAMP(6) NOT NULL
)
```

Migration binary must:

1. acquire an advisory/named migration lock;
2. validate applied checksums;
3. reject changed historical migrations;
4. apply one version at a time;
5. verify required schema after application;
6. release the lock.

---

# 52. Production Schema Audit

Before rewrite deployment, inspect each environment:

```text
dev
preview
staging
production
```

Record:

* migration history;
* tables;
* columns;
* indexes;
* triggers;
* CHECK constraints;
* engine/version;
* product data present.

Do not infer production state from Git.

The current reconciliation plan explicitly requires this per-environment lineage inventory.

---

# 53. DB Connection Discipline

On connection acquisition/session initialization:

```text
timezone = UTC
```

Pool configuration must have:

* bounded max open;
* bounded max idle;
* lifetime jitter;
* acquire timeout;
* metrics.

Avoid connection creation storms.

---

# 54. Transaction Retry

Do not automatically retry every transaction.

Retry only known transient categories:

* deadlock;
* serialization-like transaction conflict where supported;
* safe connection transient before commit certainty.

Retry requires:

* bounded attempts;
* jitter;
* idempotent operation;
* no nontransactional side effect already emitted.

Never retry terminalization or submission blindly outside their idempotency semantics.

---

# 55. Outbox

Business transaction:

```text
database state
+
outbox row
```

commit atomically.

Workers later process the event.

Never:

```text
commit DB
then publish mandatory durable event
```

without outbox protection.

---

# 56. Outbox Processing

Worker claim model:

```text
pending
↓
leased
↓
published
```

Failed records:

```text
retry_count++
next_attempt_at = backoff
```

After configured terminal attempts:

```text
failed/dead
```

Provide operational visibility and manual replay tooling.

Current outbox already uses claim leases, bounded batch draining and retry/backoff behavior; preserve those semantics rather than replacing them with in-memory jobs.

---

# 57. Background Jobs

Target worker responsibilities:

```text
DrainOutbox
ReconcileRuntimeTimeouts
ReconcileSATModules
ReconcileSATProvisionalCompletion
RepairSATTerminalResults
RepairMissingTerminalReceipts
RunTerminalInvariantAudit
RunGradingProjection
RunRetention
RunMediaCleanup
```

All handlers must be idempotent.

---

# 58. Worker Leadership

Avoid assuming one process exists.

Use database coordination where singleton execution matters.

Examples:

* named/advisory lock;
* claim leases;
* row locks;
* CAS checkpoint.

Do not use in-process mutexes for cross-instance correctness.

---

# 59. Grading Projection

Preserve the existing projection/read-model model.

Requirements:

* source rows are authoritative;
* projection can be replayed;
* checkpoint is durable;
* update is idempotent;
* concurrent workers cannot corrupt checkpoint;
* read fallback behavior remains as required during migration.

---

# 60. IELTS Grading

Preserve:

* objective grading;
* writing review;
* override support;
* review drafts;
* grading complete;
* ready to release;
* immediate release;
* scheduled release;
* reopen;
* export behavior.

No grading workflow redesign in this rewrite.

---

# 61. ACT Grading

Preserve:

* Science objective overrides;
* server-computed Science score;
* ACT-aware search;
* Science results/report endpoint;
* category percentages;
* CSV/report output behavior.

ACT Science behavior exists only on the ACT lineage and must be included in the union.

---

# 62. SAT Results

Preserve:

* adaptive section results;
* scaled scoring;
* terminal invalidation;
* invalidated_proctor;
* invalidated_timeout;
* ready-to-release behavior;
* re-materialization from stored terminal snapshot where required.

---

# 63. Live Updates

Retain durable database-backed event transport plus local fanout.

Conceptually:

```text
transaction
↓
live_update_events / outbox
↓
poller
↓
in-memory hub
↓
websocket clients
```

Do not make websocket delivery itself the durable source of truth.

---

# 64. Live Event Ordering

Every durable live event needs monotonic cursor/sequence behavior.

Clients reconnect with their known revision/cursor as appropriate.

Missed websocket frames are healed through:

* snapshot;
* DB event replay;
* normal API refresh.

---

# 65. WebSocket Authorization

Before upgrade:

1. authenticate session;
2. resolve allowed schedules;
3. validate requested schedule/attempt;
4. validate attempt→schedule relationship;
5. acquire connection lease;
6. upgrade.

Never authorize a subscription solely from query-string IDs.

---

# 66. WebSocket Connection Leases

Keep database-backed connection leases/caps where currently used.

This prevents scale-out instances from independently exceeding:

* per-user;
* per-schedule;
* global connection limits.

Lease heartbeat must stop on disconnect.

Release occurs on every exit path.

---

# 67. Slow Client Handling

Bound server send queues.

Do not let one slow browser create unbounded memory usage.

Policy:

```text
queue bounded
→ coalesce safe state events where possible
→ disconnect persistently slow client
```

Student correctness must not depend on receiving every websocket frame.

---

# 68. Observability

Every request has:

```text
request_id
trace_id
route
method
status
latency
actor class
```

Do not put unbounded IDs such as attempt IDs directly into Prometheus labels.

Use logs/traces for high-cardinality identifiers.

---

# 69. Core Metrics

At minimum:

## API

```text
http_requests_total
http_request_duration
http_in_flight
```

## DB

```text
pool_open
pool_in_use
pool_wait
query_duration
tx_duration
deadlocks
```

## V2

```text
response_batch_total{outcome}
response_commands_total{outcome}
lease_fenced_total
control_epoch_stale_total
version_collision_total
submit_replay_total
```

## Terminalization

```text
terminalization_created_total
terminalization_replay_total
terminalization_conflict_total
missing_receipt_repair_total
terminal_invariant_violation_total
```

## Worker

```text
outbox_pending
outbox_oldest_age
job_duration
job_failures
sat_provisional_pending_age
projection_lag
```

## WebSocket

```text
connections
lease_acquire_failures
slow_client_disconnects
```

---

# 70. Structured Logging

Logs are JSON in production.

Never log:

* passwords;
* session cookies;
* bearer tokens;
* reset tokens;
* raw full exam answers;
* student writing;
* unnecessary student PII.

Correlation IDs and stable object IDs may be logged where operationally necessary under an explicit policy.

---

# 71. Tracing

Trace:

```text
HTTP
→ application service
→ DB transaction
→ important SQL operation
→ worker/outbox continuation where practical
```

Do not create per-row spans inside large batches.

---

# 72. Health Endpoints

## `/healthz`

Process is alive.

No expensive dependencies.

## `/readyz`

Process is ready to serve.

Check:

* DB connectivity;
* required schema version;
* critical startup initialization.

Worker readiness should similarly reflect its ability to access required infrastructure.

---

# 73. Graceful Shutdown

On shutdown:

1. stop accepting new HTTP;
2. stop new websocket upgrades;
3. cancel background loops;
4. allow bounded in-flight requests;
5. release leases;
6. close websocket clients;
7. close DB pool.

Test shutdown while:

* response batches run;
* websockets exist;
* worker owns leases.

---

# 74. Frontend Target Architecture

React remains the rendering framework.

TypeScript remains strict.

Recommended organization:

```text
src/
├── app/
├── products/
├── features/
├── entities/
├── shared/
└── generated/
```

But boundaries are based on behavior rather than folder ideology.

---

# 75. Frontend Dependency Direction

Target:

```text
React UI
   ↓
feature application hooks/use-cases
   ↓
ports
   ↓
infrastructure adapters
   ↓
generated API client / IndexedDB
```

UI components must not know:

* REST URL construction;
* auth-header details;
* IndexedDB schema;
* retry protocol;
* V2 hash construction;
* lease-token persistence internals.

---

# 76. Example Attempt Feature

```text
features/student-attempt/
├── domain/
│   ├── attempt.ts
│   ├── response.ts
│   ├── conflicts.ts
│   └── state-machine.ts
│
├── application/
│   ├── saveResponse.ts
│   ├── flushResponses.ts
│   ├── submitAttempt.ts
│   ├── recoverAttempt.ts
│   └── takeoverAttempt.ts
│
├── ports/
│   ├── AttemptGateway.ts
│   ├── ResponseOutbox.ts
│   └── CredentialStore.ts
│
├── infrastructure/
│   ├── HttpAttemptGateway.ts
│   ├── IndexedDbResponseOutbox.ts
│   └── BrowserCredentialStore.ts
│
└── react/
    ├── AttemptProvider.tsx
    └── hooks/
```

---

# 77. React Component Rules

A visual component should primarily handle:

* rendering;
* focus;
* keyboard;
* pointer interaction;
* accessibility;
* local ephemeral UI state.

It should not orchestrate:

* API retries;
* cross-device lease logic;
* response conflict resolution;
* business state machines.

---

# 78. State Ownership

Separate four categories.

## Server state

Examples:

* schedules;
* runtime snapshots;
* grading lists;
* authoring resources;
* results.

Use one query/cache layer consistently.

## Durable client command state

Student unsent answer commands.

Use dedicated IndexedDB persistence.

Do not treat this as generic query cache.

## Navigation state

Examples:

* selected admin tab;
* filters;
* pagination where shareable;
* selected exam.

Use URL/router state where appropriate.

## Ephemeral interaction state

Examples:

* hovered toolbar;
* temporary popover;
* active drag;
* resizer state.

Keep close to component.

---

# 79. Student Visible Response Invariant

The frontend must enforce:

> Once it accepts local response version N, no response older than N can replace the visible answer.

This must hold across:

* server hydration;
* websocket refresh;
* reconnect;
* outbox acknowledgement;
* IndexedDB restoration;
* attempt snapshot refresh.

The current V2 frontend tests already protect against a stale refreshed snapshot overwriting a visible V2 response.

---

# 80. Local Student Durability

Interaction flow:

```text
Student changes answer
        │
        ▼
update visible state
        │
        ▼
persist durable local command
        │
        ▼
enqueue/coalesce
        │
        ▼
send V2 batch
        │
        ▼
receive acknowledgement
        │
        ▼
advance confirmed state
        │
        ▼
delete acknowledged durable command
```

Do not mark an answer "saved" before durable server acknowledgement unless UI distinguishes:

```text
saved locally
vs
synced to server
```

---

# 81. IndexedDB

Persist only data needed for crash recovery:

```text
attempt ID
question ID
write ID
client version
lease epoch
control epoch
response payload
created time
delivery state
```

Avoid persisting unrelated authenticated server data.

Apply expiration and cleanup after terminalization.

---

# 82. Coalescing

Multiple unsent full-aggregate responses for the same question may coalesce:

```text
v1
v2
v3
v4
```

becomes:

```text
send v4
```

provided immutable write semantics and local recovery rules remain valid.

Do not coalesce across:

* lease changes;
* control epoch changes;
* submission boundary.

---

# 83. Recovery

On reload:

```text
load durable local commands
↓
restore local pending state
↓
obtain authorized server snapshot
↓
merge confirmed server state
↓
retain newer pending local versions
↓
retry legal pending commands
```

Server hydration updates confirmed state.

It must not blindly replace pending state.

---

# 84. Conflict Handling

Map stable backend reasons into explicit domain states.

Examples:

```text
LEASE_FENCED
CONTROL_EPOCH_STALE
VERSION_COLLISION
DEADLINE_EXPIRED
ATTEMPT_PROCTOR_BLOCKED
TERMINALIZATION_CONFLICT
```

Do not collapse all 409 responses into:

```text
"Something went wrong"
```

Recovery action depends on the conflict.

---

# 85. Submission Frontend

Submission orchestration:

```text
disable accidental double invocation
↓
flush final command state
↓
submit with finalCommands where required
↓
persist returned submission receipt
↓
transition UI only from authoritative response
```

A network timeout after submit is an unknown-delivery outcome.

Retry using the same idempotency/submission identity.

Do not generate a new submission ID immediately.

---

# 86. SAT Submission UI

After SAT V2 submit:

the UI is closed for editing.

It may display completion/scoring transition according to existing behavior.

It must not infer `submitted_at != NULL`.

The server is allowed to remain in provisional post-exam state while authoritative SAT completion resolves.

---

# 87. Network UX

Preserve:

* offline indication;
* reconnection;
* saving status;
* proctor/network warnings;
* no destructive stale hydration.

Network state must not be equated with exam-authoritative state.

For example:

```text
offline
```

does not pause the exam clock unless the server says the runtime is paused.

---

# 88. Student UI Preservation

The existing frontend suite covers:

* student phases;
* responsive layouts;
* input protection;
* writing;
* highlights;
* split panes;
* accessibility;
* compact navigation;
* proctor interventions;
* motion;
* typing behavior;
* ACT Science interactions.

All of these become characterization gates.

Do not rewrite the JSX tree purely for architectural uniformity when it risks changing interaction behavior.

---

# 89. ACT Student Behavior

Preserve:

* stimulus;
* multi-question navigation;
* tables/images;
* shared zoom view;
* answer selection;
* answer replacement;
* independent eliminated options;
* elimination restricted appropriately;
* highlights.

The frontend map provides direct suite-backed requirements for these ACT Science behaviors.

---

# 90. Builder Architecture

Select one canonical authoring shell.

Recommended:

```text
epic SAT authoring shell
+
IELTS builder behaviors
+
ACT creation/config/stimulus behaviors
```

The existing frontend map itself recommends preserving SAT's invested authoring shell and rehoming IELTS/ACT behavior rather than mechanically merging the two file trees.

---

# 91. Provider Adapters in Authoring

Target:

```ts
interface ExamProviderDefinition {
  key: "ielts" | "sat" | "act";

  createDefaultConfig(): ExamConfig;
  validateDraft(...): ValidationIssue[];
  getAuthoringCapabilities(...): Capabilities;
}
```

Do not put:

```ts
if SAT ...
else if ACT ...
else IELTS ...
```

throughout dozens of UI components.

Provider-specific rules belong behind cohesive provider modules.

---

# 92. IELTS Authoring

Preserve:

* configuration;
* modules;
* timing;
* validation;
* answer key;
* preview;
* publish confirmation;
* error/retry;
* autosave;
* draft recovery.

The existing suite includes a durability law requiring local recovery after process death and preservation of recovery data through server revision conflict until acknowledgement.

---

# 93. SAT Authoring

Preserve:

* rich question editor;
* math/LaTeX extensions;
* module structure;
* adaptive roles;
* question inspector;
* workbook import;
* import undo;
* sample exam;
* access links;
* delivery release;
* quick preview;
* offline/durable autosave.

The current SAT authoring suite inventory becomes the feature gate.

---

# 94. ACT Authoring

Preserve:

* ACT exam type;
* Science configuration;
* 40-question default;
* continuous 40-minute Science section;
* configurable duration;
* stimulus blocks;
* question builder;
* custom summary preservation;
* IELTS defaults unaffected when changing product.

These behaviors are explicitly documented in the frontend rewrite map.

---

# 95. Proctor Frontend

Refactor controller logic separately from rendering.

Suggested:

```text
features/proctor/
├── domain/
├── application/
├── api/
└── ui/
```

Preserve:

* runtime revision sent with timing mutations;
* failed runtime start surfacing;
* live roster updates;
* attempt controls;
* schedule controls;
* presence;
* degraded live mode.

The union must retain both divergent tested expectations called out by the frontend map.

---

# 96. Admin Grading Frontend

Keep:

* session list;
* review workspace;
* question traceback;
* overrides;
* print writing;
* exports;
* filters;
* ACT Science reports;
* IELTS results;
* SAT results.

Server state must not be duplicated in several component-local caches.

---

# 97. Server State Library

**Target-design decision.**

Use one established query/cache layer, preferably TanStack Query, for normal server state.

It should not own student unsynced response durability.

Student answer durability is a separate subsystem because it has stronger ordering, persistence and fencing requirements.

---

# 98. Mutation Policy

Normal admin mutations:

* no blind automatic retries unless idempotent;
* use command-specific idempotency where needed;
* stale-version conflicts are surfaced.

Student V2 mutations:

* use protocol-native replay;
* retry only with same write identities.

---

# 99. API Gateway Layer

All direct HTTP access lives in infrastructure/api modules.

No components doing:

```ts
fetch("/api/...")
```

directly.

Generated client handles:

* request encoding;
* response decoding;
* auth transport conventions;
* common error decoding.

Feature gateways convert transport DTOs to feature/domain forms when needed.

---

# 100. Error Presentation

Frontend has a typed error classifier:

```text
validation
authentication
authorization
not-found
conflict
fenced
stale-control
deadline
rate-limit
network
server
unknown
```

Student-exam conflicts get specialized recovery behavior.

Admin errors get actionable UI plus request ID where useful.

Never show raw backend exception strings as product copy.

---

# 101. Accessibility

No accessibility regression is allowed.

Target baseline:

* WCAG 2.2 AA for core workflows;
* full keyboard navigation;
* visible focus;
* accessible dialogs;
* correct labels/names;
* appropriate live regions;
* reduced-motion support;
* adequate touch targets;
* zoom resilience;
* no color-only status;
* screen-reader compatible student navigation.

Existing accessibility tests remain gates.

Add automated axe checks to critical Playwright flows where not already present.

---

# 102. Motion

Preserve existing interaction motion unless explicitly changed.

Student exam motion must remain restrained.

Respect:

```text
prefers-reduced-motion
```

Never add transition motion to answer/question navigation that could cause dizziness or delay exam interaction.

---

# 103. Performance Frontend

Performance budget categories:

```text
initial JS
route chunk
student exam chunk
authoring chunk
grading chunk
```

Lazy-load:

* heavy SAT authoring;
* workbook tooling;
* grading export builders;
* rich editor;
* calculator integrations where feasible.

Do not lazy-load controls required to acknowledge answer state reliably.

---

# 104. Render Stability

Student typing must not cause unrelated page trees to rerender.

Use:

* narrow context values;
* external stores/selectors where justified;
* memoized derived state;
* stable callbacks only where meaningful.

Do not blanket `memo()` everything.

Measure typing path.

---

# 105. Design System

The UI itself stays unchanged, but code organization should centralize:

* tokens;
* controls;
* focus behavior;
* dialog primitives;
* sheets;
* buttons;
* form fields;
* typography;
* spacing variables;
* motion primitives.

Avoid feature-specific near-duplicate primitive components.

---

# 106. Security Frontend

Never expose backend secrets through:

```text
VITE_*
```

Session cookies remain HTTP-only.

Attempt credentials held in JS must:

* stay scoped to active attempt;
* avoid logs;
* be cleared after terminalization/logout;
* never be persisted more broadly than necessary.

Avoid storing normal authenticated server datasets in persistent browser storage.

---

# 107. Content Security

Rich exam content is data, not executable HTML.

Sanitize/validate author-authored rich content.

Images/media references use controlled asset URLs.

Do not allow arbitrary script/event-handler injection in question content.

---

# 108. Testing Strategy

The rewrite is accepted by tests, not code resemblance.

Test pyramid:

```text
pure domain unit
application service
repository integration
contract/API
concurrency
worker
frontend unit/component
frontend integration
Playwright E2E
load/soak
migration smoke
```

---

# 109. Backend Unit Tests

Use unit tests for pure:

* canonical JSON;
* response hash;
* final digest;
* validation;
* score calculations;
* provider policies;
* state transitions;
* terminal intent compatibility;
* error mapping.

Do not mock SQL to prove transaction correctness.

---

# 110. Database Integration Tests

Run against real MySQL and, where supported, TiDB.

Test:

* locks;
* unique constraints;
* row counts;
* deadlocks;
* timestamps;
* migrations;
* CHECK behavior;
* trigger strategy;
* outbox claim leasing.

SQLite is not a substitute for these tests.

---

# 111. Concurrency Tests

Mandatory scenarios:

### V2

* same write concurrently;
* same version different write;
* takeover vs old writer;
* pause vs response;
* submit vs response;
* submit vs submit.

### Terminalization

* submit vs terminate;
* auto-submit vs student submit;
* repair vs real seal;
* same-outcome terminal replay;
* cross-outcome conflict.

### Runtime

* extend vs advance;
* pause vs resume;
* complete vs student write.

### SAT

* provisional submit vs terminate;
* completion vs timeout;
* watchdog vs direct completion.

---

# 112. Migration Tests

Test migrations from:

```text
empty database
shared 0031 state
epic lineage
ACT fork lineage
hybrid/simulated combined state
production-like snapshot
```

The existing schema reconciliation plan explicitly requires drift verification and lineage-aware migration behavior.

---

# 113. Contract Test Union

Backend release gate is the union of:

* student contract;
* proctor contract;
* grading contract;
* builder contract;
* scheduling contract;
* answer-history contract;
* mutation replay;
* V2 proof tests;
* terminal invariant tests;
* SAT adaptive runtime;
* migration smoke;
* ACT Science contract additions.

## The rewrite maps explicitly make this union the acceptance gate.

# 114. Frontend Test Union

Keep all shared suites plus:

## Epic-only

* StudentAttemptProvider V2;
* builder autosave durability;
* SAT authoring suites;
* empty-state behavior.

## Fork-only

* StudentScience;
* AdminExams ACT;
* AdminResults;
* ActScienceConfigTabs;
* ACT-specific grading cases.

This exact union is identified in the frontend rewrite map.

---

# 115. Visual Regression

Before frontend structural changes:

capture baseline screenshots for:

```text
student desktop
student tablet
student mobile
SAT student
ACT Science
IELTS writing
builder
SAT authoring
ACT builder
proctor
grading
results
```

Use the same data fixture.

Any diff requires:

* explicit review;
* classification;
* intentional approval.

---

# 116. Performance Testing

Backend:

* V2 batch throughput;
* 500/1000+ simultaneous students as target requires;
* websocket connections;
* runtime transitions;
* mass submit;
* proctor complete;
* outbox drain;
* grading projection.

Measure:

```text
latency
pool waits
lock waits
CPU
memory
DB QPS
deadlocks
worker lag
```

---

# 117. Failure Testing

Explicitly test:

```text
DB disconnect
DB slow query
API restart during response batch
worker restart
websocket instance restart
network retry after committed submit
network retry before committed submit
browser refresh with pending answer
proctor action during reconnect
SAT provisional completion after API crash
```

---

# 118. CI Pipeline

Recommended required checks:

```text
go fmt / vet
staticcheck
Go tests
race tests for suitable packages
migration validation
schema diff
OpenAPI lint
generated client freshness
TypeScript typecheck
ESLint
Vitest
Playwright critical flow
accessibility checks
visual regression
dependency audit
secret scanning
container scan
git diff --check
```

---

# 119. Go Quality Rules

Production code should enforce:

* `gofmt`;
* `go vet`;
* `staticcheck`;
* no ignored errors without explicit reason;
* wrapped errors with semantic type;
* bounded goroutines;
* bounded channels;
* no background goroutine without shutdown ownership;
* no panic for user/data errors;
* no `context.Background()` inside request work except intentional detached jobs.

---

# 120. Frontend Quality Rules

Enable strict TypeScript.

Prefer:

```text
no implicit any
exhaustive discriminated unions
typed API errors
runtime validation at unsafe boundaries
```

Do not use `any` to suppress architectural migration pain.

---

# 121. Deployment Strategy

Do not big-bang swap Rust for Go.

Use strangler cutover.

Sequence:

```text
1 schema convergence
2 Go platform
3 auth
4 runtime/scheduling
5 terminalization
6 V2 core
7 IELTS V2
8 ACT V2
9 SAT V2 completion
10 proctor
11 grading/results
12 live updates
13 workers
14 frontend V2-only
15 drain V1
16 remove V1
17 remove Rust
```

---

# 122. Shadow Reads

Read-only migrated services may run Rust and Go in parallel.

For selected requests:

```text
Rust response
vs
Go response
```

normalize nondeterministic fields and compare.

Never dual-execute a write merely for comparison.

---

# 123. Single Writer During Cutover

For every mutation endpoint, route traffic to exactly one implementation.

Wrong:

```text
request
├── Rust write
└── Go write
```

Correct:

```text
request
└── authoritative implementation
```

Shadow only pure reads or replay against isolated fixtures.

---

# 124. V1 Retirement

## Stage 1

All newly created attempts use V2.

## Stage 2

Frontend becomes V2-only.

## Stage 3

Existing V1 active attempts continue through legacy implementation.

## Stage 4

Observe:

```sql
COUNT(
  protocol_version = 1
  AND submitted_at IS NULL
)
```

until zero.

## Stage 5

Hold an agreed safety window.

## Stage 6

Remove V1 mutation/submit routes and code.

Do not convert an actively running V1 exam into V2 mid-attempt.

---

# 125. Historical V1 Data

Do not manufacture fake V2 mutation histories for completed historical attempts.

Historical grading/results continue from existing immutable submission/terminal snapshots.

Only migrate data when a real downstream consumer requires it.

---

# 126. Compatibility Projections

During rewrite V2 may continue mirroring:

```text
student_attempts.answers
student_attempts.writing_answers
student_attempts.flags
```

if grading/history/read paths depend on them.

This is a read-model compatibility decision.

It is not a second response-authority model.

Later removal requires proving all consumers migrated.

---

# 127. Feature Flags

Final architecture has no:

```text
RESPONSE_DURABILITY_V2_ENABLED
VITE_USE_V2_DURABILITY_ENGINE
```

as a product-choice switch.

V2 is the product.

Temporary rollout flags must have:

* owner;
* expiry condition;
* deletion ticket.

---

# 128. Production Runbooks

Required before final cutover:

```text
database outage
database migration failure
deadlocks spike
V2 response conflict spike
student answer sync incident
SAT provisional backlog
terminalization invariant violation
worker backlog
websocket degradation
grading projection lag
object storage failure
rollback to previous API version
frontend asset rollback
```

---

# 129. Backup and Restore

Production readiness requires a tested restore.

Not merely:

```text
backup exists
```

but:

```text
backup
→ restore to isolated DB
→ run schema verification
→ run sample API reads
→ verify terminal receipts
→ verify student submissions
```

Document RPO/RTO.

---

# 130. Database Change Policy

Every schema migration must be:

* backward-compatible with current production binary during rolling deployment;
* bounded;
* reviewed for locking;
* tested with realistic row counts;
* reversible where possible;
* accompanied by rollback/forward-fix plan.

Avoid giant table rewrites during peak exam hours.

---

# 131. Security Review Gates

Before production:

* authorization matrix test;
* CSRF verification;
* cookie policy;
* attempt-token scope;
* token expiry/revocation;
* rate-limit abuse;
* body-size abuse;
* workbook parser abuse;
* rich-content sanitization;
* object-store authorization;
* websocket subscription authorization;
* cross-tenant repository tests.

---

# 132. Operational SLOs

Exact numerical SLOs should be established from observed production load rather than invented here.

Define at minimum:

```text
student response write availability
student response write latency
submit availability
submit latency
runtime command availability
websocket reconnect success
outbox lag
SAT provisional completion lag
grading projection lag
```

The key user-facing reliability SLO is:

> A locally accepted student response that successfully reaches the server is never silently replaced by an older response.

---

# 133. Alerting

Page-worthy examples:

* response write error rate;
* DB unavailable;
* terminal invariant violation;
* missing terminal receipts above zero after migration window;
* SAT provisional attempts above maximum age;
* outbox oldest age exceeds threshold;
* worker completely stopped;
* websocket lease failures spike.

Non-page dashboards:

* ordinary V2 duplicates;
* expected client conflicts;
* connection churn.

---

# 134. Code Review Checklist — Backend

Every backend PR asks:

### Domain

* Is the rule owned by the correct module?
* Is the state transition explicit?

### Database

* Is tenant scope present?
* Is query bounded?
* Is correct index present?
* Is lock order correct?

### Transaction

* Is boundary correct?
* Are external calls outside DB transaction?
* Can the command safely replay?

### V2

* Are lease/control fences correct?
* Can stale data overwrite newer state?

### Terminalization

* Is receipt-first preserved?
* Can anything mutate receipt?

### Operations

* Metrics?
* Logs?
* Migration compatibility?
* Failure behavior?

---

# 135. Code Review Checklist — Frontend

Every frontend PR asks:

### Architecture

* Is server logic outside visual components?
* Is there one owner for state?

### V2

* Can hydration overwrite pending state?
* Is write identity stable?
* Is acknowledgement matched correctly?

### UI

* Did visual output unintentionally change?
* Focus preserved?
* Keyboard preserved?
* mobile/tablet preserved?

### Errors

* Is conflict handled semantically?
* Could student lose unsent input?

### Accessibility

* Accessible name?
* focus order?
* reduced motion?
* screen reader behavior?

### Performance

* unnecessary rerenders?
* giant bundle?
* repeated network request?

---

# 136. Architecture Decision Records

Create ADRs for at least:

```text
ADR-001 Go modular monolith
ADR-002 MySQL/TiDB remains system of record
ADR-003 V2-only durability
ADR-004 SAT provisional two-phase completion
ADR-005 terminalization receipt-first
ADR-006 database-backed outbox/live bus
ADR-007 frontend feature/ports architecture
ADR-008 generated OpenAPI client
ADR-009 V1 retirement policy
ADR-010 trigger strategy MySQL vs TiDB
```

These prevent future engineers from casually undoing correctness decisions.

---

# 137. Definition of Done — Backend

The backend rewrite is complete when:

```text
[ ] Go API serves all production routes
[ ] Go worker owns all required durable jobs
[ ] migrator owns canonical schema
[ ] all new attempts are V2
[ ] IELTS V2 passes
[ ] SAT V2 passes
[ ] ACT V2 passes
[ ] SAT provisional watchdog exists
[ ] runtime lock tests pass
[ ] terminalization invariant tests pass
[ ] migration lineage tests pass
[ ] auth/tenant boundary tests pass
[ ] proctor controls pass
[ ] grading/results union passes
[ ] websocket lease tests pass
[ ] load tests pass
[ ] restore test passes
[ ] observability/runbooks exist
```

---

# 138. Definition of Done — Frontend

```text
[ ] one canonical React codebase
[ ] no production V1 durability path
[ ] no V1/V2 feature toggle
[ ] V2 local recovery universal
[ ] student UI visually unchanged
[ ] IELTS behavior unchanged
[ ] SAT behavior unchanged
[ ] ACT behavior unchanged
[ ] builder union complete
[ ] admin grading union complete
[ ] proctor union complete
[ ] all component tests pass
[ ] Playwright passes
[ ] accessibility gates pass
[ ] visual regression approved
[ ] bundle/performance budgets pass
```

---

# 139. Definition of Done — V1 Removal

V1 can be deleted only when:

```text
[ ] no new V1 attempts can be created
[ ] frontend no longer sends V1 mutations
[ ] frontend no longer sends V1 submit
[ ] active nonterminal V1 attempts = 0
[ ] V1 endpoint traffic = 0
[ ] observation period completed
[ ] rollback plan no longer requires V1
[ ] historical consumers do not depend on V1 mutation tables
```

Then delete:

* V1 mutation handlers;
* V1 submit handler;
* legacy frontend transport;
* V1-specific attempt repository paths;
* V1 flags;
* V1 conflict-only code.

Legacy DB tables may be retained longer if historical reads still use them.

---

# 140. Final Architecture

```text
                           ┌──────────────────────┐
                           │    React Frontend    │
                           │                      │
                           │ UI / Features        │
                           │ V2 Local Durability  │
                           │ Generated API Client │
                           └──────────┬───────────┘
                                      │
                                      ▼
                      ┌──────────────────────────────┐
                      │       Go API Monolith        │
                      │                              │
                      │ Auth / Authorization         │
                      │ Exams / Authoring            │
                      │ Scheduling / Runtime         │
                      │ V2 Attempt Core              │
                      │ Proctor                      │
                      │ Grading / Results            │
                      │ Live Updates                 │
                      └──────────────┬───────────────┘
                                     │
                          ┌──────────┴──────────┐
                          │ Completion Policies │
                          │                     │
                          │ IELTS   SAT   ACT    │
                          └──────────┬──────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │   Terminalization   │
                          │ Immutable Receipt   │
                          │ Server Snapshot     │
                          └──────────┬──────────┘
                                     │
                                     ▼
                           ┌───────────────────┐
                           │   MySQL / TiDB    │
                           │                   │
                           │ Attempts          │
                           │ V2 Responses      │
                           │ Mutation Ledger   │
                           │ Terminal Receipts │
                           │ Outbox            │
                           │ Live Events       │
                           │ Results           │
                           └─────────┬─────────┘
                                     │
                                     ▼
                           ┌───────────────────┐
                           │     Go Worker     │
                           │                   │
                           │ Reconciliation    │
                           │ SAT Watchdog      │
                           │ Projection        │
                           │ Repair            │
                           │ Retention         │
                           └───────────────────┘
```

---

# 141. Final Engineering Doctrine

The most important rules of the rewritten system are:

1. **V2 is the only future student response protocol.**
2. **The browser owns interaction and crash recovery; the server owns truth.**
3. **A newer response can never be silently replaced by an older response.**
4. **Every mutation is fenced by writer ownership and control state.**
5. **The server clock owns examination timing.**
6. **The universal lock order is attempt → runtime → active section.**
7. **SAT provisional completion remains a real lifecycle state.**
8. **Terminalization is a separate immutable domain boundary.**
9. **The terminal receipt is inserted before the terminal claim.**
10. **No terminal receipt may ever be updated or deleted.**
11. **ACT Science scoring remains server-authoritative.**
12. **Business transactions and durable events commit together.**
13. **Workers are replayable and idempotent.**
14. **WebSockets are notifications, not the source of truth.**
15. **Frontend server state, local UI state and durable answer state are different things.**
16. **React components render product behavior; they do not implement distributed-systems logic.**
17. **The rewrite ports the union of IELTS + SAT + ACT behavior.**
18. **Tests, not old file structure, define equivalence.**
19. **UI changes require explicit product approval.**
20. **V1 dies only after its final active attempt dies.**

This produces a materially simpler target than the current dual-protocol architecture without weakening the concurrency, durability, timing, terminalization, scoring, proctoring, or user-experience guarantees that the existing system has accumulated.
