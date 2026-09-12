




**Status:** Planning deliverable; implementation has not started.

**Target:** IELTS / SAT / ACT examination and proctoring platform.

**Basis:** The architecture mapping and optimization discussion in this conversation. Source paths below are historical navigation starting points, not freshly inspected implementation evidence. Confirm them during WP00.

**Current authoring constraint:** This plan is written without further sub-agent calls. No application code, database migrations, deployment configuration, or production data is changed by this task. The swarm workflow below describes future implementation, not agents currently running or a mandate to override a later no-agent instruction.

**Verification status:** Document-level self-check only. This document does not establish production readiness, prove historical defects remain, or claim an independent review that did not occur.

---

## 1. Outcome and scope

Deliver production-quality implementation across frontend, backend, persistence, operations, and verification while preserving intended product behavior. Prioritize the exam lifecycle over cosmetic refactoring:

> Student intent → recoverable answer → acknowledged write → authoritative submission → correct score → authorized result.

“No bugs” is not a provable target. The release target is no unresolved critical correctness or security defects, no silent answer loss in the defined fault model, bounded performance at a demonstrated supported load, and tested recovery when components fail.

### In scope

- Response durability, ordering, replay, reconciliation, and submission safety.
- IELTS/SAT/ACT scoring and result-source consistency.
- Authentication, authorization, entry admission, media safety, and privacy.
- Backend transactions, worker completion, process-boundary consistency, API contracts.
- React state ownership, rendering, loading, recovery, accessibility, and heavy workloads.
- Measured MySQL query/index/pool tuning, safe migrations, backup and restore.
- Deterministic tests, CI enforcement, observability, performance gates, rollout and recovery.
- Focused structural simplification after behavior is protected by tests.

### Not authorized by this plan alone

- Production load tests, deployment, data repair, deletion, migration execution, or credential access.
- Changes to examination timing, scoring policy, grading permissions, or admission business rules without approved behavior specifications.
- A wholesale rewrite, blanket dependency upgrades, Redis/another queue, microservices, or database sharding.
- Removing compatibility paths solely because they look old.
- Claiming compliance certification, unlimited capacity, or production readiness from unit tests alone.

### Known uncertainties requiring evidence

1. A historical SAT audit described V2/legacy answer-source divergence; later mapping described V2-aware scoring. Establish the current state before changing either.
2. The API and worker are separate processes even when packaged in one container. They do not share in-memory caches or hubs.
3. The mapped bootstrap POST/304 contract needs HTTP-semantic review. A standards-compliant solution must preserve client compatibility.
4. “Zero-SQL polling” may describe a cache lookup, not the whole authenticated request; credential verification may still query MySQL.
5. One million registrations/day and proposed throughput figures are goals, not measured deployment capacity.
6. Production flags, instance resources, RPO/RTO, supported devices, and exact release policy remain unconfirmed.
7. Historical tests, line numbers, migration counts, and passing report artifacts may be stale.

---

## 2. Success card

**User-visible outcome:** Students can enter, work, recover, submit, and receive correct authorized results under the supported exam conditions. Staff can author, supervise, grade, and release without hidden state loss or ambiguous outcomes.

**Must do:**

- Convert critical behavior into executable acceptance scenarios before repair.
- Investigate suspected defects and close already-satisfied requirements with evidence instead of unnecessary code changes.
- Finish each change across producer, consumer, persistence, error states, tests, and operations.
- Demonstrate capacity and recovery on a representative non-production environment.
- Record exact source/configuration/test evidence for the delivered candidate.

**Must preserve:** Published version pinning; supported routes and API compatibility; server-side timing and permissions; response fencing; immutable terminal facts; grading-release intent; student accessibility and active input.

**Must not do:** Hide errors, weaken assertions to turn tests green, increase timeouts as a substitute for diagnosis, bypass authorization/fences, silently drop pending work, or add infrastructure without a measured need.

**Implementation complete when:** All required work packages are verified or explicitly closed as already satisfied; no blocking findings remain; named integrity/security risks pass their scenarios; integrated release gates pass; external approvals and recovery evidence are recorded; the final delivered candidate is the reviewed candidate.

**Important distinction:** Delivering this plan completes planning only. Every implementation checkbox below starts unchecked.

---

## 3. System invariants and contracts

### 3.1 Invariants

| ID | Invariant | Primary evidence |
|---|---|---|
| I01 | New local intent is never silently overwritten by an older snapshot. | Delayed-bootstrap and reconnect tests |
| I02 | Saved means acknowledgement of that exact response version. | Ack matching and status tests |
| I03 | Unacknowledged work is recoverable within the documented browser-storage fault model, or storage failure is visible. | Quota/denial/reload tests |
| I04 | One attempt has one compatible terminal outcome; conflicting outcomes cannot overwrite it. | Concurrent submit/terminate/worker integration tests |
| I05 | Administered questions, authoritative answers, pinned keys, and scoring policy agree across scoring, review, and export. | Cross-provider end-to-end fixtures |
| I06 | Stale leases cannot write; control changes do not silently erase pending answers. | Lease/control race tests |
| I07 | Server-side identity, assignment, and timing gates remain correct when the browser is stale. | Negative authorization and clock tests |
| I08 | Active attempts remain bound to the published version selected at issuance. | Publish-during-exam test |
| I09 | Retried jobs produce no duplicate effects and retain ownership of unfinished work. | Fan-out/crash recovery tests |
| I10 | Partial failure leaves a valid prior state or a durable, observable recovery path. | Fault injection at transaction boundaries |
| I11 | Telemetry and logs do not expose answers, tokens, passwords, or unnecessary student identifiers. | Redaction/schema/cardinality checks |
| I12 | Performance improvements do not weaken any preceding invariant. | Before/after correctness and load evidence |

### 3.2 Contracts to freeze before dependent workers start

**C01 — Response ownership and scoring:** For each provider, specify authoritative response storage, administered-question identifiers, answer-key revision, pretest handling, unadministered/null semantics, legacy fallback conditions, and immutable result inputs. Do not solve ambiguity by uncontrolled dual writes.

**C02 — Durable write and replay:** Specify attempt identity, lease epoch, control epoch, write ID, client version, canonical payload, acknowledgements, revision, retryability, and exact-replay behavior. Distinguish a transport retry of an issued write from a new reconciled write under a newer control epoch. Do not replay across device ownership or terminal boundaries.

**C03 — Terminalization:** Specify provisional versus terminal states, submission-ID ownership, request hashing, outcome compatibility, response digest, server submission time, and result availability. Preserve existing supported wire shapes unless a versioned change is approved.

**C04 — Authorization and caching:** Define role/assignment/attempt checks, revocation semantics, session-cache behavior, token binding, authorization-cache invalidation, and maximum acceptable propagation delay. Safety must not depend on frontend route guards.

**C05 — Runtime and read freshness:** Define server-clock authority, revision ordering, ETag/conditional-read semantics, poll cadence hints, explicit pause/extension behavior, cache keys, invalidation, and worker-originated change visibility.

**C06 — Work ownership and projection:** Every durable job or child work item has an identity, owner/lease, eligible retry state, idempotency rule, completion condition, failure classification, and recovery command. An unfinished attempt must not become ownerless because a sibling succeeded.

**C07 — Error and retry vocabulary:** Preserve exact wire codes and field names. For example, prior mapping distinguished `SUBMISSION_ID_MISUSE` from its Go identifier and `acknowledgements` from internal `acks`. Reverify current serialization. Define retry ownership once for each operation; do not multiply retries across API client, React Query, and durability engine.

**C08 — Client storage:** Specify versioned key namespaces, per-attempt isolation, persistence milestones, quota/denial behavior, journal compaction, conflict archive lifecycle, account switching, terminal cleanup, and compatibility with old bundles.

**C09 — Workload and SLO profile:** Specify concurrent active attempts, arrival rate, response-write cadence, section transitions, submit storm size, proctor subscriptions, content/media sizes, device/network profiles, deployment flags, and resource limits. Performance claims apply only to this profile.

---

## 4. Future implementation workflow: routed-work-rigorous + dispatching-parallel-agents

### 4.1 Route and role topology

Use **ROADMAP** for implementation because response durability, terminalization, scoring, contracts, schema, and rollout have dependent safety obligations. Do not choose ROADMAP merely because the request says production-grade.

```text
L0 — overall success card, contracts, integration, release authority
 ├─ L1 Integrity/security — backend state, scoring, auth, worker correctness
 │   └─ L3 ready work-package owners
 ├─ L1 Client experience — durability adapters, runtime UI, performance, accessibility
 │   └─ L3 ready work-package owners
 └─ L1 Data/operations — query evidence, schema, monitoring, CI, recovery
     └─ L3 ready work-package owners

Scope outputs → L0 integration → frozen candidate
 → L4 combined independent check
 → named-risk specialist only when required
 → targeted repairs → new candidate → recheck → release decision
```

L1 roles may be held by the orchestrator until a scope actually needs delegated coordination. No L2 by default. Add L2 only for active synchronization that cannot be handled through frozen contracts and ownership. Do not create layers for symmetry.

If implementation is instructed to run without agents, perform the same gated work sequentially and state that review was not agent-independent. Never spawn agents against a later user constraint.

### 4.2 Dispatch rules

- Use isolated, self-contained worker prompts; do not fork the entire conversation into every worker.
- Parallelize independent ready packages, not related failures sharing one root cause.
- Start only after prerequisite contracts and required artifacts exist.
- Assign one mutation owner per file or logical scope. Read access may overlap; concurrent edits may not.
- A backend change and frontend consumer can proceed in parallel only against a frozen shared contract.
- Test workers may own new isolated tests, but must not edit production files already owned by another worker.
- Multiple DB-backed workers need separate disposable databases or scheduled exclusive access. Different files do not guarantee runtime isolation.
- Use the smallest ready worker set. Typical execution waves need two or three leaf workers, not a fixed large swarm.

### 4.3 Mutable ownership registry

| Shared surface | Sole authority while active |
|---|---|
| API schema and wire DTO decisions | Contract owner designated by L0 |
| Shared durability engine and storage format | Client durability owner |
| Provider adapter implementation | Assigned provider owner after shared contract freeze |
| Terminalization and response source resolver | Integrity owner |
| `cmd/api/main.go` composition/wiring | Integration owner; workers submit required wiring changes |
| `internal/app/app.go` shared service graph | Integrity/integration owner |
| Worker orchestration and fan-out | Worker correctness owner |
| Migration filenames and DDL | Database owner; allocate from current lineage, never assume next number |
| Query indexes/pool tuning | Database owner after service query shape freeze |
| CI/deployment files | Operations owner |
| Cross-feature integration tests | Integration test owner |

If two packages need the same file, sequence them or transfer ownership explicitly. Worktrees isolate edits, not contracts; integration still requires review.

### 4.4 Worker handoff template

```text
WP ID and candidate/base revision:
Goal and user-visible behavior:
Owned files/scopes:
Read-only dependencies:
Frozen contract versions:
Prerequisites and known hypotheses:
Required implementation and explicit non-goals:
Acceptance scenario IDs:
Tests/commands and safe environment:
Expected artifacts and evidence:
Rollback/compatibility constraints:
Return: produced/tested/integrated status, failures, uncertainty, handoff needs.
```

### 4.5 Freeze/review/repair protocol

1. Owner reproduces or benchmarks before editing; records current behavior.
2. Add a failing behavioral test for a confirmed defect, then implement the smallest complete repair.
3. Run producer checks and deliver actual logs, not a confidence statement.
4. Integrator checks consumer compatibility, shared wiring, and combined tests.
5. Freeze candidate using source revision plus patch/file hashes when the tree is dirty, schema version, configuration fingerprint, and dependency lockfiles.
6. L4 inspects the exact candidate and independently runs relevant scenarios.
7. Classify findings as BLOCKING, IMPORTANT, or OPTIONAL. BLOCKING must be repaired; IMPORTANT requires repair or an explicit documented acceptance by the appropriate authority.
8. Repair only affected ownership scopes, freeze a new candidate, and recheck affected guarantees and integration edges.
9. Repeated failure: first local repair; second recurrence root-cause diagnosis; third recurrence escalate the contract/architecture assumption. Do not repeat the same patch.
10. No final production claim if required environment evidence or approval remains unavailable. Preserve the verified engineering candidate and disclose the missing release gate.

---

## 5. Dependency graph and execution waves

```text
WP00 Baseline ──→ WP01 Contracts/acceptance ──┬→ WP02 Response/scoring chain
                                            ├→ WP03 Client durability
                                            ├→ WP05 Auth/entry/media security
                                            ├→ WP06 API/retry/read semantics
                                            └→ WP07 Runtime/cache/process boundaries
WP01 + WP02 ──→ WP04 Terminalization/jobs
WP03 + WP06 + WP07 ──→ WP08 React state/render performance
WP08 ──→ WP09 Delivery/authoring/grading UX and accessibility
WP02 + WP04 + WP05 + WP06 + WP07 + WP10 evidence ──→ WP11 DB tuning
WP00 ──→ WP10 Measurement/observability
WP00 ──→ WP12 Migration/restore preparation
WP00 ──→ WP13 CI and safe test environment
WP02..WP09 + WP11 + WP12 + WP13 ──→ WP14 Integrated fault/rehearsal gates
WP14 ──→ WP15 Staged rollout and operational acceptance
WP14 ──→ WP16 Evidence-gated compatibility retirement (when eligible)
WP15 + applicable WP16 rechecks ──→ final release sign-off
```

- WP10 instrumentation and WP13 baseline CI can start early; semantic metrics and permanent thresholds depend on WP01/WP10 evidence.
- WP12 creates and proves recovery procedures early. Every schema-changing package depends on its relevant migration/restore gate before applying DDL.
- WP03 may proceed in parallel with WP02 once C01/C02/C08 are frozen. Shared schema changes cannot race ahead of these contracts.
- WP04 and WP07 both touch runtime/worker behavior; resolve shared-file ownership before parallel execution.
- WP16 is conditional. If retirement safety is not demonstrated, retain the compatibility path rather than treating its removal as a prerequisite for safe release.

**Critical path:** baseline → contracts → response/scoring + durability → terminal/job correctness → integrated failure tests → capacity/restore evidence → staged release.

---

## 6. Work packages

All paths are existing owner candidates from conversation context unless marked **proposed**. Workers must rediscover exact symbols and current tests before changing code.

### WP00 — Reproducible baseline and current-state confirmation

**Owner:** L0 with operations owner. **Dependencies:** none.

**Inputs:** Current source tree, historical system map, dependency manifests, existing local test configuration.

**Implementation tasks:**

- [ ] Record source revision, dirty files, toolchain versions, lockfiles, and available test environments without exposing secrets.
- [ ] Enumerate actual startup paths, API/worker process topology, database version, migration head, deployment flags, and supported browsers.
- [ ] Run safe local typecheck, lint, unit tests, Go tests, and build using the current scripts. Classify pre-existing failures and skipped DB/browser checks separately.
- [ ] Reproduce historical high-risk concerns; mark each confirmed, already fixed with regression evidence, not reproduced, or environment-dependent.
- [ ] Establish sanitized deterministic IELTS, SAT adaptive, and ACT science fixtures.
- [ ] Define C09 load profile; do not infer expected concurrency from registrations/day.

**Outputs:** Baseline evidence ledger and hypothesis inventory under a **proposed** versioned evidence directory in `docs/production-hardening/`.

**Acceptance:** Another engineer can reproduce the baseline. No stale passing artifact is substituted for a current run.

**Failure/rollback:** Baseline tasks do not mutate production. Missing credentials block only dependent environment checks; independent work continues.

### WP01 — Freeze behavioral contracts and acceptance matrix

**Owner:** L0/contract owner. **Dependencies:** WP00.

**Targets:** `api/openapi/openapi.yaml`; relevant frontend API contracts; `backend/go/internal/attempts/`, `terminalization/`, `runtime/`, provider services.

- [ ] Record C01–C09 with concrete current wire fields, state transitions, error codes, and allowed compatibility behavior.
- [ ] Resolve authority for start/pause/resume/extension, SAT provisional completion, result release, grading permissions, and invalidation.
- [ ] Define request validation limits and error envelopes from existing behavior, tightening only with compatible handling or an approved version change.
- [ ] Specify acceptance cases AC01–AC20 in §7 and map them to fixtures and owners.
- [ ] Identify true product decisions requiring approval: scoring policy, admission policy, data retention, RPO/RTO, and service SLOs.

**Outputs:** Approved contract versions and executable test skeletons with concrete assertions, not skipped placeholders accepted as evidence.

**Acceptance:** Dependent workers can implement without inventing shared semantics. Existing behavior is either preserved or an intentional change is recorded.

**Rollback:** A contract change invalidates only its producer/consumer packages. Do not silently change a frozen interface mid-wave.

### WP02 — Authoritative response → routing → score → result chain

**Owner:** Integrity owner. **Dependencies:** WP01.

**Targets:** `backend/go/internal/assessscore/`, `delivery/`, `sat/`, `act/`, `grading/`, `results/`, `attempts/`; consumer result gateways.

- [ ] Trace the authoritative response source for each provider through adaptive routing, scoring, review, and export.
- [ ] Confirm whether V2-only SAT responses already work. If they do, add or strengthen the missing regression evidence instead of another bridge.
- [ ] If divergence exists, implement one explicit source resolver with documented fallback precedence and corruption handling.
- [ ] Score using the administered question set, pinned content revision, and recorded scoring policy version; exclude unadministered branches and pretest contributions as specified.
- [ ] Preserve null/pending/invalidated distinctions; never convert unknown correctness into false by default.
- [ ] Keep client-supplied scores non-authoritative. Missing answer keys or policies must follow the approved failure behavior, not silently fabricate zero or interpolate scores.
- [ ] Treat correction of previously issued results as a separate authorized repair operation with audit evidence.

**Acceptance:** AC05/AC06/AC12. V2-only fixtures and mixed legacy compatibility fixtures agree across all consumers. Released snapshots do not change after a later draft edit.

**Rollback:** Compatible reader/service rollback; do not overwrite immutable issued results to conceal a failed deployment. Backfills require WP12 rehearsal and explicit authorization.

### WP03 — Browser durability, ordering, and conflict recovery

**Owner:** Client durability owner. **Dependencies:** WP01; provider adapters depend on frozen C01/C02/C08.

**Targets:** `src/shared/durability/DurableResponseEngine.ts`; `src/features/student/api/responseDurabilityTransport.ts`; `src/features/student/hooks/useStudentSessionRouteData.ts`; `src/features/student-delivery/hooks/useSatResponsePersistence.ts`; related checkpoint/outbox/quarantine adapters.

- [ ] Establish one shared owner for issued write identity, ack matching, pending intent, replay, and conflict handling.
- [ ] Install a readiness barrier: preserve input arriving before server seeding; overlay newer local intent after authoritative hydration.
- [ ] Bound synchronous checkpoints to small records. Avoid rewriting an entire attempt on each keystroke; measure the synchronous path before selecting a storage representation.
- [ ] Make persistence milestones explicit: visible input, local recovery checkpoint, asynchronous journal, in-flight request, exact server acknowledgement.
- [ ] Coalesce only unissued superseded intent. Never mutate the payload associated with an issued write ID.
- [ ] Archive conflicts before destructive removal; handle archive failure without falsely claiming recoverability.
- [ ] Reconcile control-epoch conflicts only after a fresh authoritative state permits writing; never automatically replay across a stale lease or terminal state.
- [ ] Handle quota exhaustion, unavailable storage, corrupt records, upgrade compatibility, account switching, and browser lifecycle interruption.
- [ ] Submission must expose unresolved blocked/quarantined work; explicit discard requires confirmation and the approved audit behavior.

**Acceptance:** AC01–AC04/AC07/AC08/AC17. Saved status only follows the exact ack. Pending work is not silently lost during supported reload/reconnect paths.

**Limits:** Browser eviction, device destruction, or storage denial can destroy unacknowledged work; detect/report available evidence rather than promising impossible durability.

**Rollback:** Old/new client compatibility test; namespaced storage upgrades; preserve recovery data during rollback. No blanket localStorage clearing.

### WP04 — Terminalization, provisional completion, and durable job ownership

**Owner:** Integrity/worker owner. **Dependencies:** WP01 + WP02; WP12 for schema changes.

**Targets:** `backend/go/internal/attempts/submit.go`; `terminalization/`; `sat/`; `outbox/`; `backend/go/cmd/worker/main.go`; `backend/go/internal/app/app.go` through integration ownership.

- [ ] Preserve one terminalization authority and compatible replay rules; enumerate every caller and legacy path.
- [ ] Keep SAT provisional submission separate from final seal and result readiness; define recovery ownership when the client disappears after provisional success.
- [ ] Prove transaction boundaries for receipt, terminal projection, scoring snapshot, audit, and durable work enqueue.
- [ ] Audit autosubmit fan-out. A parent job can complete only when each target is finished, permanently classified, or assigned to durable retry/dead-letter work.
- [ ] Implement durable retry ownership using the existing job model if sufficient. Add a child-work table only if demonstrated requirements cannot be met simply.
- [ ] Classify transient vs permanent failure; bounded retries, poison isolation, idempotent requeue, and lease expiry must retain evidence.
- [ ] Prevent duplicated external side effects from transaction retries; post-commit work requiring durability must be enqueued transactionally.

**Acceptance:** AC09/AC10/AC11. Crash after commit, duplicate delivery, submit/terminate races, partial fan-out, and abandoned SAT completion converge to defined outcomes.

**Rollback:** Retain readable queued payload versions across binary rollback. Stop claiming work incompatible with the old worker; never purge backlog as a recovery shortcut.

### WP05 — Authentication, authorization, admission, media, and privacy

**Owner:** Security/integrity owner. **Dependencies:** WP01.

**Targets:** `backend/go/internal/auth/`, `authz/`, `accesslinks/`, `media/`; API auth/entry/media handlers; `src/features/auth/`; `src/shared/api/apiClient.ts` via contract ownership.

- [ ] Build a role × resource × operation matrix, including observer/grader/proctor scope and cross-organization access.
- [ ] Test path parameters against bearer ownership and locked domain state; frontend permissions are presentation only.
- [ ] Verify session expiry, logout-all, revocation, takeover, strict/stateless modes, and stale-cache behavior without relaxing access guarantees.
- [ ] Preserve closed-by-default pre-mint admission. Review historical captcha and metadata-exposure gaps; choose any external verifier only through an approved dependency and secret-management decision.
- [ ] Test CSRF, cookie attributes, same-origin/cross-origin deployment assumptions, request body limits, and identity mismatch failures.
- [ ] Verify media ownership, content/size validation, safe paths, upload finalization, download access, and orphan cleanup.
- [ ] Review rich text/import rendering for stored-script injection and validate all query construction for parameterized inputs.
- [ ] Define data minimization, retention, and telemetry redaction without claiming legal compliance certification.
- [ ] Review dependency vulnerabilities and exposure; make targeted updates with regression checks, not blanket upgrades.

**Acceptance:** AC07/AC13/AC14/AC18. Unauthorized reads/writes never reveal protected data or create admission rows. DB outages are not misclassified as invalid credentials.

**Rollback:** Never roll back to a known authorization bypass. Security fixes may require feature disabling or forward repair rather than restoring an unsafe binary.

### WP06 — API serialization, retry ownership, and conditional-read semantics

**Owner:** Contract/API owner. **Dependencies:** WP01.

**Targets:** `api/openapi/openapi.yaml`; API handlers including `handlers_delivery.go`, `handlers_v2.go`; `src/shared/api/apiClient.ts`, `queryClient.ts`; feature gateways.

- [ ] Test actual serialized responses, error envelopes, status codes, nullability, limits, and pagination against approved contracts.
- [ ] Separate internal models from wire DTOs where leakage creates real ambiguity; avoid adding unnecessary mapping layers to simple endpoints.
- [ ] Define which layer retries each operation, which failures are retryable, total retry budget, jitter, cancellation, and Retry-After behavior.
- [ ] Keep mutation retries tied to stable operation/write/submission identities. Do not retry arbitrary non-idempotent requests blindly.
- [ ] Investigate bootstrap POST returning 304. Conditional 304 belongs to GET/HEAD semantics; introduce a compatible GET read path or documented full POST response when required.
- [ ] Migrate clients with compatibility tests; ensure cache hits cannot cross attempt/user/version boundaries or expose redacted answer keys.
- [ ] Cancel obsolete requests and prevent old responses from replacing newer route/attempt data.

**Acceptance:** AC03/AC08/AC14/AC15. Contract tests include old/new consumer combinations and lost-response-after-commit retries.

**Rollback:** Keep the compatible endpoint until consumer adoption is evidenced; schema/DTO changes must support the rollback window.

### WP07 — Runtime clocks, caching, and API/worker process boundaries

**Owner:** Runtime owner. **Dependencies:** WP01; coordinate WP04 shared files.

**Targets:** `backend/go/internal/runtime/`, `liveupdates/`, `delivery/`, `student/`; API runtime/WS handlers; `backend/go/cmd/worker/main.go`; frontend runtime poll and authoritative deadline hooks.

- [ ] Inventory cache and event ownership by process, not by container. Document all worker-originated mutations affecting API-visible state.
- [ ] Select an existing durable bus, invalidation signal, or bounded authoritative refresh for those mutations; do not assume direct process memory crosses boundaries.
- [ ] Make cache keys include all required identity/version/revision scope. Set bounded capacity, explicit TTL behavior, and authorization-safe invalidation.
- [ ] Measure end-to-end SQL per poll, including auth/session touch. Advertise zero-SQL only for paths actually proven to perform none.
- [ ] Preserve server time authority; handle pause/resume/extensions explicitly rather than assuming a deadline can never increase.
- [ ] Test slow networks, background tabs, reconnect jitter, event loss, staff WS capacity, and poll fallback.
- [ ] Do not call a 2-second fast-lane hint a universal two-second delivery guarantee: a client already sleeping on the steady interval may not receive it immediately.
- [ ] Timing/authorization correctness remains enforced at write time, independent of UI freshness.

**Acceptance:** AC07/AC11/AC16. Worker mutation → API observation works across distinct processes and restart, under the C05 freshness bound.

**Rollback:** Mode-specific compatibility tests. Preserve durable work; fall back to the already-supported authoritative path rather than stale unsafe memory.

### WP08 — React ownership and measured rendering optimization

**Owner:** Client performance owner. **Dependencies:** WP03 + WP06 + WP07; WP10 baseline measurement.

**Targets:** Student controllers/session stores; `src/features/student-delivery/hooks/useSatExamController.ts`; `src/components/proctor/ProctorDashboard.tsx`; `src/components/admin/StudentReviewWorkspace.tsx`; query/state hooks.

- [ ] Profile typing, question navigation, timers, roster updates, and grading with representative devices and fixtures.
- [ ] Subscribe inputs to question-local state; isolate timer updates from exam content and layout.
- [ ] Remove duplicated derived state and effect-driven state mirrors where they cause races or extra rendering.
- [ ] Stabilize identities, selector outputs, and context boundaries only where evidence shows unnecessary work.
- [ ] Extract focused controllers/use cases from oversized components by responsibility, not line-count quotas. Preserve behavior with characterization tests first.
- [ ] Keep typing synchronous and responsive; background nonurgent work must not block active input or undermine storage correctness.
- [ ] Use memoization and virtualization selectively. Do not unmount active editors, destroy undo/selection, or assume memoization fixes bad ownership.

**Acceptance:** AC17/AC19. Editing one answer does not repeatedly render unrelated questions; clocks do not cause whole-workspace rerenders. Compare traces against WP10 budgets.

**Rollback:** Small component-level reversions; preserve session/storage contracts. Avoid a broad tree rewrite that prevents isolated rollback.

### WP09 — Complete operational UI, accessibility, and heavy-workload handling

**Owner:** Client experience owner. **Dependencies:** WP08; C01 result semantics and C07 errors.

**Targets:** Student shells/tools; `src/features/exam-authoring/ui/AuthoringWorkspace.tsx`; grading/export UI; proctor UI; route loading/error surfaces.

- [ ] Implement loading, empty, offline, denied, conflict, degraded, submitting, and recoverable-error states for critical actions.
- [ ] Preserve active input, IME composition, focus, selection, keyboard navigation, and undo through state changes.
- [ ] Verify timer behavior under overlays, student break, proctor pause, expiry, and module transitions.
- [ ] Audit labels, focus order, dialogs, status announcements, contrast, reduced motion, touch targets, and screen-reader workflows.
- [ ] Lazy-load heavy editors/calculator/export code where route and interaction budgets improve; prefetch only bounded likely-next content.
- [ ] Bound export memory and main-thread work; support progress, cancellation, and recoverable errors. Use a Web Worker or server export only if measured payloads justify that boundary.
- [ ] Optimize large rosters/libraries with server paging and appropriate virtualization, preserving accessible navigation.
- [ ] Keep rich-content rendering, media loading, and calculator failure from corrupting answer state.

**Acceptance:** AC17/AC19/AC20 across supported browser/device combinations. No visual redesign or scoring/timing changes disguised as optimization.

**Rollback:** UI-bundle rollback with preserved persistence compatibility. Keep accessibility regressions release-blocking on critical exam paths.

### WP10 — Measurement, observability, and performance budgets

**Owner:** Operations/performance owner. **Dependencies:** WP00; metric semantics finalize with WP01.

**Targets:** `backend/go/internal/platform/telemetry/`; metrics/alerts; frontend performance/error logging; `k6/`; `docs/runbooks/`.

- [ ] Measure end-to-end latency for entry, bootstrap, write acknowledgement, terminal receipt, roster updates, grading, and exports.
- [ ] Record SQL count, transaction/lock/pool waits, rows examined, worker queue age, retry counts, saturation, and response bytes.
- [ ] Distinguish service errors, expected validation/authorization failures, rate-limit admission, client disconnects, and network failures.
- [ ] Use bounded metric labels. IDs belong in controlled diagnostic context only when justified, not metric label sets.
- [ ] Define actionable integrity alerts, stuck provisional work, fan-out retries, DLQ age, cache freshness failures, auth revocation failures, and storage-error signals.
- [ ] Pair each alert with an owner, threshold rationale, runbook, and test proving the signal can fire.
- [ ] Calibrate C09 budgets using repeatable runs before setting permanent regression gates.

**Acceptance:** No secret/answer leakage; injected failures produce the expected signal; a performance claim includes workload, resources, configuration, distribution, and raw evidence.

**Rollback:** Disable noisy instrumentation safely without disabling correctness checks or masking integrity incidents.

### WP11 — MySQL query, index, transaction, and pool tuning

**Owner:** Database owner. **Dependencies:** Stable query shapes from WP02/WP04/WP05/WP06/WP07, WP10 evidence; WP12 for DDL.

**Targets:** `backend/go/internal/platform/db/`, `tx/`; service queries; approved migrations.

- [ ] Rank hot queries: response batches, bootstrap, runtime/auth reads, rosters, grading queues, job claims, retention.
- [ ] Inspect actual plans and cardinalities. Use EXPLAIN ANALYZE only where executing the query is safe.
- [ ] Remove N+1 reads and excessive payloads before indiscriminate caching/index additions.
- [ ] Test candidate composite indexes against predicate, ordering, cursor semantics, and write amplification; remove none without usage/compatibility evidence.
- [ ] Preserve unique identity/replay/fencing constraints and stable keyset pagination.
- [ ] Keep transactions short, deterministic, and free of external calls; use isolation levels according to required guarantees, not a universal RC switch.
- [ ] Tune API and worker pools against database capacity and lock waits. Increased concurrency is not a remedy for saturation.
- [ ] Reduce hot-path whole-attempt rewrites only when row-first semantics and terminal materialization are proven.
- [ ] Revalidate every plan on production-like data size/distribution; do not hardcode index DDL from guessed columns.

**Acceptance:** Before/after query/throughput evidence meets C09 without breaking AC03/AC09/AC10/AC16. No new unbounded memory/backlog behavior.

**Rollback:** Reversible service/pool configuration; additive compatible indexes with a tested DDL procedure. Destructive index/schema operations require separate safety approval.

### WP12 — Migration safety, retention, backups, and restore

**Owner:** Database/operations owner. **Dependencies:** WP00; applies as prerequisite to all schema mutations.

**Targets:** `backend/go/cmd/migrate/`; current migrations; backup rehearsal scripts and runbooks.

- [ ] Record current migration head and allocate new filenames centrally; historical 0058 is not an instruction to use 0059 blindly.
- [ ] Test fresh installation, representative existing database upgrade, interrupted rerun, and old/new application compatibility.
- [ ] Account for DDL implicit commits, metadata lock duration, table size, online-operation support, and available disk space.
- [ ] Prefer expand/contract migrations; defer contraction until the rollback/consumer window closes.
- [ ] Any deduplication/backfill has approved winner semantics, dry-run counts, audit output, backup, and reconciliation checks. Keep-earliest is not a universal truth.
- [ ] Protect replay, grading, terminal, and incident evidence from premature retention cleanup; use bounded batches outside exam peaks.
- [ ] Establish approved RPO/RTO and backup access controls. Restore to a disposable target, validate schema, boot services, and verify representative answers, receipts, results, media, and replay behavior.
- [ ] Document which changes support binary rollback, forward repair, or full restore. Do not promise SQL rollback for nontransactional DDL.

**Acceptance:** AC18 plus migration fault scenarios pass; observed restore time/data loss satisfy approved objectives.

**Rollback:** Abort before unsafe DDL if limits cannot be met. Restore/repair is rehearsed, target-verified, and explicitly authorized before production execution.

### WP13 — CI, deterministic fixtures, and safe test infrastructure

**Owner:** Test/operations owner. **Dependencies:** WP00; checks expand as packages land.

**Targets:** Existing package scripts, Go test configuration, Vitest, Playwright, CI workflows, dedicated local test setup.

- [ ] Separate fast PR gates from DB integration, browser matrix, performance, and restore jobs without losing required release coverage.
- [ ] Add deterministic clocks, transaction barriers, network interception, and controlled storage faults; avoid arbitrary sleeps.
- [ ] Isolate parallel workers by database/schema, accounts, ports, browser storage, and artifact directories.
- [ ] Guard production-targeting helpers; require explicit environment allowlists and authorization. Never use live students as test fixtures.
- [ ] Distinguish failing, skipped, quarantined, and unavailable tests in the evidence ledger. A skipped critical test is not a pass.
- [ ] Run current safe scripts, typically npm run typecheck, npm run lint, npm run test:run, npm run build, and Go suites, after confirming actual scripts/environment in WP00.
- [ ] Add actual HTTP serialization/consumer contract tests, migration jobs, secret scanning, dependency review, and targeted accessibility checks.
- [ ] Set a flaky-test policy with owner and remediation deadline; do not permanently hide critical failures behind retries.

**Acceptance:** A clean checkout can reproduce the relevant suites; test failures fail the gate; no shared-state collision or unintended production mutation.

**Rollback:** CI changes can revert independently, but release checks cannot be waived merely because their environment is unavailable.

### WP14 — Integrated fault, browser, capacity, and recovery rehearsal

**Owner:** L0 integration/test owner; independently checked by L4. **Dependencies:** Required correctness/security/UI packages, WP11/WP12/WP13.

- [ ] Run AC01–AC20 against the integrated candidate, not only isolated worker patches.
- [ ] Exercise supported mode combinations with risk-based coverage: pairwise for independent knobs, exhaustive targeted combinations for auth/fencing, cross-process notification, row-first materialization, and terminalization interactions.
- [ ] Test API restart, worker restart, DB slowdown, lost acknowledgement, stale caches, browser storage failure, expired tokens, and deadline storms.
- [ ] Run representative load in an authorized staging environment: arrival wave, steady writing, section changes, submit storm, proctor observers, grading background load, and post-exam cleanup.
- [ ] Verify bounded resource use and backlog recovery after the load subsides. Include soak tests covering relevant lease, token, retention, and background-job intervals.
- [ ] Record supported capacity and safety margin without extrapolating daily registrations to concurrent sockets/writers.
- [ ] Validate restored data through the application and business invariants, not just successful database import.

**Acceptance:** Mandatory scenario and budget evidence is linked to the frozen candidate; no blocking/important unaccepted findings remain.

**Rollback:** Stop load safely, preserve evidence, and repair the owning package. Never mask a data-integrity failure by lowering test volume without reporting the supported limit.

### WP15 — Staged rollout and production acceptance

**Owner:** L0 with authorized operations owner. **Dependencies:** WP14 and explicit deployment authorization.

- [ ] Obtain approval for workload/SLOs, RPO/RTO, infrastructure flags, rollback package, and any intentional product policy changes.
- [ ] Roll out internal/synthetic cohort → small representative exam cohort → expanded cohort → full release. Define observation windows and exit criteria before starting.
- [ ] Require zero confirmed new silent-loss, cross-user exposure, incompatible terminal outcomes, or unexplained score divergence. Monitor latency/backlog/resource regressions against the baseline.
- [ ] Stop immediately for integrity/security regression; for performance alerts, use predefined sustained thresholds rather than intuition.
- [ ] Verify cache/job payload/schema compatibility with the rollback binary. Preserve local journals, DB evidence, and queued jobs.
- [ ] Perform post-deploy synthetic checks and ownership handoff; record incident contacts and evidence retrieval procedures.

**Acceptance:** Approved production cohort meets the release criteria and on-call can execute the tested recovery playbook.

**Rollback:** Stop expansion, disable the implicated safe-to-disable feature or roll back compatible binaries, verify health and invariant probes, and investigate. Unsafe security rollback requires containment/forward repair instead.

### WP16 — Focused architecture cleanup and compatibility retirement

**Owner:** Respective L1 scope owner. **Dependencies:** WP14 evidence; compatibility adoption evidence for removal.

- [ ] Consolidate duplicated behavior owners only after equivalence tests exist.
- [ ] Retire V1 writes, duplicate stores, redundant gateways, and flags only when usage, consumer compatibility, and migration windows prove they are unnecessary.
- [ ] Keep domain services independent of HTTP details; keep handlers thin; use explicit composition and the existing shared app graph.
- [ ] Introduce interfaces only at genuine substitution/test boundaries. Do not create generic repositories, plugin frameworks, or universal state machines without a concrete need.
- [ ] Remove dead code and obsolete tests/documentation together; update onboarding and operation contracts.
- [ ] Treat any removal after a reviewed candidate as a new candidate requiring affected regression and integration checks.

**Acceptance:** Less duplication and clearer ownership without external behavior drift. If removal is unsafe, document the retained compatibility contract and stop there.

**Rollback:** Package-scoped source revert; maintain data and wire compatibility until the accepted retirement window closes.

---

## 7. Acceptance and failure matrix

Each scenario needs deterministic fixtures, clear assertions, a safe environment, and links to actual test evidence. Suggested filenames are **proposed**; prefer extending current tests when they already own the behavior.

| ID | Scenario and exact expected result | Owners / test layers |
|---|---|---|
| AC01 | Type before bootstrap resolves; release older snapshot; newer local input and ordering survive. | WP03; engine + browser |
| AC02 | Deny/quota-fail storage during editing; do not claim local/server save; preserve in-memory intent and show recovery limits. | WP03/WP09; storage fault + browser |
| AC03 | Server commits batch, network drops ack; retry identical write returns compatible ack with no duplicate mutation or changed payload. | WP02/WP03/WP06; DB integration |
| AC04 | Reload offline with checkpoint/journal and delayed async storage; recover correct ordered pending work without a fabricated server-ack status. | WP03; engine + mobile browser |
| AC05 | SAT V2-only answers route to the specified adaptive branch, score correctly, and appear consistently in review/export; unadministered/pretest semantics remain correct. | WP02; provider integration + E2E |
| AC06 | IELTS objective + writing review and ACT science fixtures follow their approved grading/scoring/release rules. | WP02; service + E2E |
| AC07 | Old device after takeover and stale control epoch after pause: no unauthorized writes, no silent pending-data deletion, clear distinct recovery. | WP03/WP05/WP07; race + browser |
| AC08 | Submit with blocked/quarantined work or lost receipt response: no false complete screen; retain recovery choices and stable idempotency identity. | WP03/WP04/WP06; integration + browser |
| AC09 | Student submit races proctor terminate/deadline worker; one approved compatible terminal outcome, conflicting request rejected without overwrite. | WP04; real DB barrier tests |
| AC10 | Fan-out has successes, transient failures, and poison attempts; every unfinished attempt remains durably owned and eventually completed or explicitly dead-lettered. | WP04; worker crash/retry integration |
| AC11 | Kill worker after SAT provisional state; restart; reconcile through final seal/result. API process observes worker-originated change without shared memory. | WP04/WP07; two-process integration |
| AC12 | Publish a new draft while an existing attempt runs; content/key/scoring inputs and released result snapshot remain pinned. | WP01/WP02; integration |
| AC13 | Cross-user/organization/assignment access and bad entry codes: denied without data leak or unauthorized admission writes; cache cannot bypass revocation semantics. | WP05; negative API tests |
| AC14 | CSRF/origin/body/malformed input/expired bearer/rate-limit errors retain exact supported status and envelope; no blind retry storm. | WP05/WP06; contract + browser |
| AC15 | Conditional reads on new GET path and compatible old POST behavior return correct status/body; auth, redaction, version keys, and refresh behavior remain correct. | WP06; HTTP + consumer tests |
| AC16 | Worker command, event loss, stale cache, or sleeping poll loop: UI reaches authoritative state within C05 bound under specified conditions; writes enforce immediately. | WP07; process + browser |
| AC17 | Timer ticks, overlays, IME, keyboard navigation, focus/selection/undo, and question switching do not lose edits or change intended clock behavior. | WP03/WP08/WP09; browser/accessibility |
| AC18 | Interrupted migration rerun, retention boundary, and scratch restore preserve replay/terminal/result invariants and meet approved RPO/RTO. | WP12; migration + restore |
| AC19 | Representative device/load stays within agreed interaction/API/resource budgets and returns to baseline backlog after storm. | WP08/WP10/WP11/WP14; traces + load |
| AC20 | Large export or unavailable media/calculator remains cancelable/recoverable without freezing active work, leaking data, or corrupting persisted state. | WP05/WP09; browser + service |

### Discriminating test design

- Race tests control ordering explicitly; test both winners where valid.
- Clock tests include exact deadline/grace boundaries, pause/resume, extension, background-tab throttling, and stale server offsets.
- Include same ID/same payload, same ID/different payload, different ID/same version, stale lease, stale control, and terminal replay separately.
- Distinguish missing key, blank answer, not administered, pretest, invalidated, pending score, and true incorrect response.
- Test old-client/new-server and new-client/compatible-old-server cases for changed contracts and storage formats.
- Use valid and invalid ownership fixtures across roles; a happy-path test cannot establish authorization safety.
- Do not treat a stale test expectation as proof the implementation is wrong; resolve against the frozen behavioral contract.

---

## 8. Initial performance budgets and capacity policy

The following numbers are **proposals for baseline calibration**, not promises or statements about current performance. Final gates require approval and a frozen C09 workload/resource profile.

| Measure | Initial candidate gate | Measurement boundary |
|---|---|---|
| Answer input responsiveness | p95 input-to-visible update ≤100 ms | Named lower-powered supported device; include storage checkpoint work |
| General interaction responsiveness | p75 INP ≤200 ms where supported | Real representative sessions; keep device/browser slices |
| Autosave acknowledgement | p95 ≤1 second | Client send to exact server ack, within defined network profile |
| Terminal submission receipt | p95 ≤2 seconds | Clearly separate ordinary final seal, SAT provisional response, and final SAT result readiness |
| API availability | Proposed 99.9% for valid critical requests during agreed exam windows | Define eligible requests; report 429, validation, client/network, and server failures separately |
| Integrity | Zero confirmed silent-loss, cross-user exposure, duplicate incompatible terminal facts, or unexplained score divergence | Every release acceptance and soak run; production incident gate |
| Background recovery | Bounded oldest eligible work age and measured drain time | Set thresholds from expected load and worker capacity, not an arbitrary universal number |
| Runtime freshness | C05 bound demonstrated per channel and sleep/reconnect condition | A fast-lane hint is not itself a measured propagation SLA |

### Capacity demonstration

- Specify arrival bursts, concurrent writers, write payload sizes, submit storms, staff connections, and background workloads separately.
- Compare baseline and candidate on the same dataset, configuration, infrastructure, and load generator capacity.
- Record p50/p95/p99, error composition, CPU/RSS, connections, SQL/lock waits, storage latency, queue age, and post-load recovery.
- Show expected peak plus approved headroom; do not select an arbitrary multiplier that the load generator cannot sustain.
- If one deployment cannot meet required capacity, first identify the measured limiting resource. Consider new infrastructure only through a separate justified architecture decision with operational ownership and recovery costs.

---

## 9. Test and CI gates by stage

| Stage | Required checks | Not sufficient on its own |
|---|---|---|
| Worker local | Focused failure-first regression, static checks, relevant unit/service tests | Worker statement that code looks correct |
| Scope integration | Producer/consumer contract tests, domain invariants, affected DB/browser tests | Isolated mocked tests |
| Global candidate | Current build/typecheck/lint/unit/Go suites; DB integration; critical browser workflows; security/serialization checks | Historical coverage or test-report files |
| Schema candidate | Fresh install/upgrade/interrupted rerun/compatibility; locking/disk assessment; restore route | SQL parses successfully |
| Performance candidate | Repeatable workload and device evidence; correctness suite preserved | Faster one-off benchmark |
| Release candidate | Integrated fault/restart/load/restore evidence; approved config; rollout/rollback rehearsal; independent review | Merely having a deployment script |

Run commands from the repository’s actual current scripts, confirmed in WP00. The historical project included npm typecheck/lint/test/build scripts, Go tests under `backend/go`, Playwright, and k6. Some existing configurations target remote or production environments; never run them based only on their names.

Unavailable required checks remain explicitly NOT RUN or BLOCKED. They do not become PASS through substitution with weaker evidence.

---

## 10. Release, rollback, and operational checklist

### Before release

- [ ] Source revision/patch hashes, lockfiles, schema version, build artifacts, and configuration fingerprint recorded.
- [ ] Required AC scenarios linked to fresh passing evidence; no critical skips or unexplained flakes.
- [ ] Provider response/scoring sources, state machines, retry ownership, cache behavior, and process boundaries documented.
- [ ] Database migration and binary rollback compatibility verified.
- [ ] Backup restored successfully to scratch; observed recovery meets approved objectives.
- [ ] Alerts are tested and assigned; no student answers or secrets leak into telemetry.
- [ ] Candidate received required independent L4 review for future swarm execution; specialist review covers named security/data-loss risks where needed.
- [ ] Production permissions, product policy changes, observation windows, and stop conditions approved.

### Immediate stop conditions

- Confirmed newly introduced silent answer loss or false saved status.
- Unauthorized access, token/session leakage, or broken revocation guarantees.
- Conflicting terminal facts or unexplained scoring/review divergence.
- Unowned unfinished autosubmit/provisional work.
- Unsafe migration behavior, evidence deletion, or unusable recovery path.
- Sustained latency/resource/backlog threshold breach under the approved profile.

### Incident procedure

1. Stop cohort expansion and identify the candidate/configuration involved.
2. Preserve browser journals, relevant server evidence, job state, and redacted diagnostics before cleanup.
3. Contain the failure without weakening exam ownership or integrity rules.
4. Execute tested compatible rollback, safe feature isolation, or approved forward repair.
5. Verify authoritative answers, receipts, results, queue ownership, and access control—not just health checks.
6. Reproduce the root cause, add regression coverage, and re-enter staged rollout from the appropriate gate.

---

## 11. Evidence ledger and definition of done

Maintain a small implementation ledger; do not create a bureaucracy of redundant reports.

```text
Requirement/scenario:
Work package and owner:
Behavioral contract version:
Implementation files:
Candidate source/config/schema identity:
Producer checks with actual command, environment, exit status, and artifact:
Independent reviewer evidence:
Observed result: PASS / FAIL / NOT RUN / BLOCKED
Known limitation or residual risk:
Rollback/recovery evidence:
Next action:
```

### Package completion states

`PENDING → READY → RUNNING → PRODUCED → INTEGRATED → FROZEN → CHECKED → DONE`

A producer cannot mark overall implementation done. L0 owns final integration and acceptance. A change after review invalidates the affected check until a new candidate is rechecked.

### Final implementation quality bar

- Complete behavior across all affected layers; no temporary bypasses or silent TODO paths in critical flows.
- Simple explicit ownership and composition; no unnecessary universal abstractions.
- Domain rules are testable without recreating the whole HTTP/browser stack, while integration tests still prove real boundaries.
- Inputs and errors are validated and consistent; intentional compatibility decisions are documented.
- Concurrency and partial failure have deterministic outcomes and recovery owners.
- Performance improvement is demonstrated under a declared workload without correctness regression.
- Deployment and rollback are usable by operators other than the author.
- Unsupported environments, remaining risks, and capacity limits are disclosed.

---

## 12. First implementation wave

When implementation is explicitly authorized, begin with this bounded sequence rather than launching every package:

1. **WP00:** Establish a clean, reproducible baseline and revalidate the historical integrity hypotheses.
2. **WP01:** Freeze response/scoring, durability/replay, and terminalization contracts first; these unblock the highest-risk path.
3. **Parallel ready lanes:** WP02 authoritative response/scoring, WP03 browser durability, and WP10/WP13 measurement/test foundations, with one owner for shared files.
4. **WP04 + WP07:** Prove terminal/job recovery and cross-process visibility; sequence overlapping worker/runtime files.
5. **Integrate and independently verify a vertical exam slice:** entry → answer → reload/reconnect → submit → score/review.
6. Only after that slice is correct, expand security/contract coverage, query tuning, UI performance, and production rehearsal according to the dependency graph.

**Planning handoff:** This file is the plan only. It changes no production behavior. All implementation work, test execution, deployment evidence, and independent implementation review remain future work.
'});