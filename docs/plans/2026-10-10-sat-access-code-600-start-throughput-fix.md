# Implementation plan: SAT access-code start at 600 candidates

## 0. Context and current behavior

- **Goal:** Qualify a synchronized wave of 600 pre-registered candidates using the local MySQL-backed HTTP API. Each candidate submits once, starts their own first module, and receives the normal start response.
- **Current → desired:** Today, requests reserve from a schedule-generation budget capped at 200 failed or pending comparisons. When pending valid starts fill it, later requests are returned `START_CODE_COOLDOWN`. Cold-start requests can also select the exclusive schedule-lock path from a runtime-existence read made before the transaction. Desired behavior is to wait briefly for pending capacity, then admit valid requests while preserving the 200 security bound and minimizing cold-runtime serialization.
- **Verified repository evidence:**

  | Behavior | Evidence | Status |
  | --- | --- | --- |
  | `StartWithCode` checks stable quotas, seeds the base module, reserves comparison capacity, probes runtime existence outside the transaction, starts transactionally, settles the reservation, then assembles state and selected content. | `backend/go/internal/delivery/sat_code_entry.go`: `StartWithCode`, `codeStartTx`, `reserveStartCodeComparison`, `settleStartCodeReservation` | Verified |
  | Reservation claims lock one `(schedule_id, generation)` guard row and count pending reservations plus current-window failures. A full count returns cooldown without distinguishing pending-only saturation. | `backend/go/internal/delivery/sat_code_entry.go`: `reserveStartCodeComparison`; `backend/go/migrations/0080_sat_access_code_start.sql` | Verified |
  | `runtimeExists` is read before the start transaction. A false read selects `FOR UPDATE` on the schedule row; the transaction then reads the runtime. | `backend/go/internal/delivery/sat_code_entry.go`: `StartWithCode`, `codeStartTx` | Verified |
  | The HTTP wave uses a synchronization barrier, sends one request per candidate without retries, caps the DB pool at 32, and currently accepts only 200 or 2,000 candidates. | `backend/go/cmd/api/sat_start_code_http_mysql_test.go` | Verified |
  | The existing local HTTP 200 wave had p95 4.907 s. The direct-service 200 wave had p95 3.089 s; its 2,000 wave accepted 1,061 and returned cooldown for 939. | `docs/plans/2026-10-09-sat-access-code-start.md`; `verification/lean/sat-access-code-start/RESULTS.md` | Recorded local evidence |
  | Many cold requests may retain a stale “runtime absent” observation and serialize on the exclusive schedule lock. | Same delivery path above | Inferred; collect lock-wait evidence before attributing the latency share |

- **Scope:** Local MySQL qualification only, with one API process and the existing HTTP harness pool of 32 as the comparison profile. Record machine CPU/memory, Go and MySQL versions/configuration, pool settings, API process count, schema revision, and test commit. No production database or production-capacity claim is in scope.
- **Non-goals:** Raising the 200 failed/pending comparison bound, changing the request body or route, weakening attempt/content authorization, adding a broker or service, or certifying the original 2,000-candidate AT15 gate. The 2,000 case remains a separate regression/release gate under the SAT spec.

## 1. Requirements

### Functional (P0/P1)

| ID | Behavior | Acceptance criterion |
| --- | --- | --- |
| FR-1 [P0] | A valid, pre-registered candidate can submit once and start only their own first delivered module during a synchronized 600-candidate local wave. | On each cold and warm wave, all 600 receive the existing `started` response; persisted state has 600 accepted attempts and 600 started first modules, with no client retries. |
| FR-2 [P0] | The schedule has one pinned runtime; concurrent candidate starts do not change another candidate’s start, module, or deadline. | Exactly one runtime exists; every candidate’s acceptance, first module, and deadline are internally consistent and use the committed DB start timestamp. |
| FR-3 [P0] | Pending-only capacity saturation is treated as transient capacity, not a failed-code cooldown. Internal waiting does not charge the per-attempt or per-principal quota more than once. | Pending capacity leads to bounded server-side waiting outside a DB transaction. It returns `START_CODE_BUSY` only if the waiter bound/deadline is reached; `START_CODE_COOLDOWN` is returned only when the failed-comparison budget is actually exhausted. |
| FR-4 [P0] | Wrong guesses, rotation, retries, and expired reservations retain the documented security semantics. | Failed comparisons and unresolved comparisons remain bounded at 200 per schedule/generation/window rules; a wrong comparison consumes one failure, a successful comparison releases pending capacity, and expiry is conservatively charged to its original window. |
| FR-5 [P0] | Attempt identity remains bound to the verified bearer; caller input cannot select another candidate or expose protected content. | A cross-attempt/schedule bearer is rejected before comparison reservation or selected-content response. |
| FR-6 [P1] | An already-started attempt resumes its original state after replay or uncertain acknowledgement. | No second acceptance/deadline/module start is created; the existing authoritative recovery response remains unchanged. |

### Non-functional (relevant, measurable)

| ID | Quality / constraint | Target | Validation |
| --- | --- | --- | --- |
| NFR-1 | Local synchronized HTTP performance, including selected content in the response. | Hard gate: full 600-response drain ≤2.0 s and p95 <2.0 s on every run. Improvement target: p95 ≤1.0 s. These are proposed local acceptance values, not production SLOs. | Three cold-runtime and three warm-runtime waves through the real handler and local MySQL. Report p50/p95/p99/max and barrier-to-last-response drain time. |
| NFR-2 | Comparison-guess resistance and admission correctness. | Failed + pending never exceeds 200 for the applicable generation/window accounting. Existing 5-per-attempt/60-second and 20-per-principal/10-minute fixed windows remain unchanged. | Concurrent DB tests with fresh principals, shared-NAT profile, wrong codes, rollover, rotation, and lease expiry. |
| NFR-3 | Start integrity and confidentiality. | Start acceptance, first-module activation, deadline, and audit remain one committed transaction. Authorization and selected-content scoping remain authoritative per attempt. | Real MySQL transaction/race tests plus content-scope regressions; inspect persisted state after each interleaving. |
| NFR-4 | Bounded resource use under backpressure. | Local profile: at most 600 blocked requests per schedule per API process across cold initialization and budget-capacity waits, with a 2.0 s absolute admission deadline from handler entry (or earlier request cancellation); no blocked request holds a DB connection, transaction, or row lock. Overflow/deadline returns typed busy. | Saturation integration test verifies another DB query can use the pool while requests wait; assert waiter cap, deadline, and cancellation cleanup. |

**Capacity implication:** With at most 200 reservations pending at once and 600 valid starts, a two-second drain requires an average permit occupancy no greater than approximately `200 × 2 / 600 = 0.667 s`, assuming the slots are continuously used and successful starts release them after commit. This is a throughput estimate, not a latency guarantee. Current 200-wave p95 measurements miss the requested target, so a cooldown-only fix is insufficient.

## 2. Core entities and invariants

- **Candidate attempt** — authoritative owner is `student_attempts`; candidate identity comes from the verified bearer, not request input. Acceptance timestamp and accepted code generation transition together. The first delivered module activation and its deadline commit with acceptance.
- **Schedule runtime** — schedule-scoped and uniquely persisted in `exam_session_runtimes`; its plan is pinned to the published version. Runtime creation is shared schedule state; candidate module/start state is per attempt.
- **Comparison reservation** — stored in `sat_start_code_reservations`, bound to schedule, code generation, attempt, DB window, and lease. Current states are `pending`, `failed`, and `released`; the worker sweeps expired pending rows. Only the reservation allocator and `StartWithCode` settlement path create/update these records; `SweepStartCodeReservations` is the expiry writer.
- **Admission waiter** — process-local scheduling state only; never authoritative for budget, code generation, or successful start. The DB guard/reservation rows remain the shared source of truth across API processes.

Invariants:

- `INV-1`: For one schedule/generation, current-window failed comparisons plus all unresolved reservations never exceed 200; old-window pending reservations remain counted until settled or expired.
- `INV-2`: Wrong comparison or conservative lease expiry changes one pending reservation to failed; successful comparison changes it to released. Waiting alone changes no comparison/failure count and does not re-charge stable identity quotas.
- `INV-3`: A waiter remains bound to the generation observed when its submission entered the server. It cannot wake after rotation and silently compare the same submitted value against a newer generation.
- `INV-4`: A successful start commits acceptance, generation, first module, DB-time start/deadline, and required audit atomically for exactly one candidate.
- `INV-5`: There is at most one schedule runtime, and all candidate starts use its pinned plan. Starts for distinct candidates preserve each other’s attempt state.
- `INV-6`: A retry/replay after acceptance resumes the original timestamp, deadline, and current module; it does not create another start.
- `INV-7`: No authorization or candidate state is cached to meet latency. The selected module body is returned only after the authoritative start/ownership/scope checks.
- `INV-8`: Attempt and schedule identity come from the verified bearer/route binding; caller-supplied code or control fields cannot select another attempt.

## 3. API / interface changes

- Keep the existing `POST /api/v1/assessment-delivery/schedules/{scheduleID}/start-with-code` route, bearer-derived schedule/attempt identity, `{code, controlEpoch}` body, and successful response shape. No OpenAPI or frontend protocol change is expected.
- Preserve existing `started` and recovery/resume outcomes. A successful internal capacity wait ends in the normal `started` response.
- Refine refusal semantics:
  - `START_CODE_COOLDOWN` (`429` + `Retry-After`): the failed budget is exhausted for this generation/window.
  - Pending-only saturation: keep the request server-side in a bounded wait; do not expose it as invalid code or cooldown while capacity can still clear.
  - `START_CODE_BUSY` (`429` + short `Retry-After`): same-attempt reservation is already active, waiter capacity is full, or the bounded wait ends without a slot.
  - `START_CODE_RATE_LIMITED`: unchanged stable attempt/principal quota behavior.
- Charge the per-attempt/principal quota once for the submitted HTTP request. Internal wait/re-reservation must not increment it. Do not add automatic frontend POST retries; the existing UI already recognizes `START_CODE_BUSY`, `START_CODE_COOLDOWN`, and `START_CODE_RATE_LIMITED`.
- Use one bounded per-schedule admission coordinator with at most 600 blocked requests per API process across cold initialization and pending-capacity waits, and a 2.0 s absolute admission deadline from handler entry, shortened by request cancellation/deadline. This deadline bounds admission waiting only; it must not cancel an already-admitted transaction with an ambiguous commit. A reservation already created remains subject to the existing conservative lease/sweeper rules.

## 4. Critical data flow

1. The HTTP handler verifies the attempt bearer and validates the existing request body. The handler applies its existing request timeout and error mapping.
2. `StartWithCode` checks per-attempt/principal quota once and idempotently ensures the base module attempt exists.
3. Read the current runtime/generation hint. For a cold runtime on this API process, acquire a bounded per-schedule initializer gate **without holding a DB connection**; after waking, recheck runtime. This gate only suppresses local stampedes. A DB schedule lock and unique runtime row remain authoritative across API instances.
4. Claim a comparison reservation for the observed generation in a short DB transaction under the existing schedule/generation guard. If failures alone exhaust 200, return cooldown. If the combined capacity is full because pending rows remain and the failed budget is below 200, roll back and wait outside the transaction; retry the claim for the same generation without re-running quota checks. If code generation changed while waiting, return `START_CODE_ROTATED`.
5. Run the existing lock-ordered start transaction: access link → schedule (`FOR SHARE` for an existing runtime, `FOR UPDATE` only for the initializer) → current code → attempt → runtime → module. Revalidate lifecycle/window, generation, attempt controls, writer, release, and selected module. Compare the same six-digit candidate. On mismatch, roll back start state and settle one failure. On success, commit runtime initialization if needed, acceptance, module activation, deadline, revisions, and audit together.
6. Release the reservation after committed successful start. Release the initializer gate. If another API process created the runtime after this process’s hint, the exclusive-path transaction must recheck under the schedule lock, roll back the probe, and retry the same reservation on the shared path.
7. Assemble authoritative state and selected content after commit. Record handler-level total response latency separately from the current commit-path metric.

## 5. Recommended design

Keep MySQL as the correctness authority and make two narrow changes in the existing delivery service:

1. **Bound cold-runtime initialization to one request per schedule per API process.** Add a keyed, bounded initializer gate to `delivery.Service`. Only its holder may attempt cold initialization; other requests wait with no DB resource held, then re-read runtime state and use the shared path. The gate is an optimization only. Under `FOR UPDATE`, recheck for a runtime created by another process; if present, abort that transaction and retry shared. Keep runtime creation and the initializer candidate’s first module activation in the same transaction.
2. **Wait on pending budget saturation rather than calling it cooldown.** Retain the existing guard and reservation schema initially. Inside the guard transaction distinguish current-window failures from unresolved pending rows. If failures alone exhaust 200, return cooldown. If pending reservations temporarily fill the remaining budget, return an internal capacity signal; `StartWithCode` waits with at most 600 per-schedule waiters for this local profile and short jittered DB rechecks, outside transactions and DB connections. Use a 2.0 s absolute admission deadline from handler entry, shortened by the request context; this timer ends waiting, not an already-admitted transaction. A local reservation-settlement notification may wake local waiters sooner, but DB state must be re-read before claiming and remains authoritative. The waiter retains the generation observed before waiting and spends exactly one identity quota charge.

Use the simplest existing durable mechanism first: no migration, queue service, or permit-slot table is required for the initial implementation. Add stage timings before tuning query/index shape. If the 600 gate still fails and instrumentation attributes material time to the single guard-row lock/count, then design a separate next migration for 200 DB-backed permit slots and prove its rollover/lease transitions before adopting it; do not increase 200 or silently assume a new MySQL feature is supported by production.

Keep rate-limit semantics, authenticated identity, code comparison, transaction lock order, selected content checks, and existing client recovery unchanged. Do not let the initializer gate deduplicate whole start requests: each candidate must still execute their own start transaction.

## 6. Production and failure-mode deep dives

| Risk / failure | Consequence | Safeguard and enforcement | Verification | Residual risk |
| --- | --- | --- | --- | --- |
| Pending reservations fill 200 during a valid wave | Remaining valid candidates receive a false 10-minute cooldown. | Separate `failed` from `pending` at the guard decision; wait outside the DB transaction, retain the original generation, and return cooldown only for exhausted failures. | Seed/hold pending reservations, release one, and assert a waiting correct request proceeds without extra quota charge. | A wave containing 200 real wrong guesses must remain cooled down by design. |
| Waiters overload memory or DB pool | API stalls, DB pool starvation, or a retry storm. | Bounded per-schedule waiter count; no DB connection/lock while waiting; jittered rechecks and cancellation. Local notifications are advisory, not authority. | Hold 200 reservations while saturating waiters; assert pool remains available and overflow receives typed busy. | Multi-instance fairness and per-host waiter budgets require testing with the actual deployment topology. |
| Code rotates while request is waiting | Old code may be charged against or accidentally checked against a new generation. | Bind the waiter/reservation to the original observed generation; reject on generation mismatch before comparison. | Deterministically rotate while a waiter is blocked; assert `START_CODE_ROTATED` and no new-generation failure increment. | None if the generation is revalidated under the code lock; failures in that read fail closed. |
| Cold-start requests all observe no runtime | Hundreds of transactions queue for an exclusive schedule lock. | Per-service, per-schedule initializer gate collapses same-process contention; DB lock/recheck arbitrates across processes; losing initializer retries shared. | Barrier test with 600 cold starts and lock/retry telemetry; assert only one runtime initialization and bounded exclusive-path count. | Multiple processes still contend once per process; production replica count is unknown and not certified here. |
| Process exits after reservation or settlement fails | Capacity may remain occupied and later deny valid starts. | Keep conservative 30-second lease and existing worker sweep; an expired unresolved comparison is counted failed in its original window. | Inject cancellation/settlement failure and run `SweepStartCodeReservations`; assert idempotent one-time expiry. | A crash may consume one slot conservatively even when the code was valid. |
| Start commits but ACK/content assembly fails | Client is uncertain though the candidate is durably started. | Preserve existing authoritative read/recovery path; never repeat the first-start mutation blindly. | Inject post-commit response failure and retry/read; assert original timestamp and one module activation. | Response latency may exceed the target even though commit succeeds; measure handler end-to-end. |
| Selected content cache is optimized unsafely | Candidate state or protected content leaks across attempts. | Keep attempt ownership/scope checks authoritative; cache immutable published-version content only. | Existing content isolation tests plus response-body checks in the HTTP wave. | Full production CDN/browser timing is outside the local DB qualification. |
| Single guard lock remains the bottleneck | 600-wave latency misses despite fixing runtime serialization. | Record guard wait/hold time, reservation transaction latency, pool wait, and lock waits. Only then adopt the separately modeled 200-slot allocator if needed. | Compare before/after stage histograms; require the end-to-end 600 gate. | The proposed performance target may need a faster local MySQL profile; no result is claimed in advance. |

## 7. Ordered implementation phases

| Phase | Files / components | Specific change | Requirement / invariant | Done when |
| --- | --- | --- | --- | --- |
| 1. Baseline and observability | `backend/go/cmd/api/sat_start_code_http_mysql_test.go`; `backend/go/cmd/api/handlers_sat_start_code.go`; `backend/go/internal/delivery/sat_code_entry.go`; `backend/go/internal/platform/telemetry/telemetry.go` | Allow a 600-user wave; categorize typed failures, DB/transport errors, and persisted counts. Add low-cardinality durations for quota, seed, guard wait/claim, schedule/runtime locks, transaction, settlement, state/content assembly, and full HTTP response. Capture reservation pending/failed counts and pool/lock diagnostics where the local MySQL exposes them. | NFR-1, NFR-4 | The unchanged code can produce reproducible, phase-attributed cold and warm 600 baselines; no IDs/codes/generations are metric labels. |
| 2. Collapse cold initializer stampede | `backend/go/internal/delivery/service.go`; `backend/go/internal/delivery/sat_code_entry.go`; `backend/go/cmd/api/sat_access_code_start_mysql_test.go` and/or `backend/go/cmd/api/sat_start_code_http_mysql_test.go` | Add a bounded keyed per-schedule initialization gate. Recheck runtime after gate acquisition and under the exclusive schedule lock. A stale exclusive path that finds an existing runtime rolls back and retries shared with the same reservation. Gate waiters hold no DB connection. | FR-1, FR-2, INV-4, INV-5 | A synchronized cold wave records one runtime creation; after the initializer commits, remaining same-process starts use shared runtime access. Cross-process loser path is covered with deterministic DB interleaving. |
| 3. Distinguish cooldown from pending saturation | `backend/go/internal/delivery/sat_code_entry.go`; `backend/go/cmd/api/sat_start_code_guard_mysql_test.go`; `backend/go/cmd/api/handlers_sat_start_code.go` only if error mapping needs adjustment | Split guard counts into current-window failures and unresolved pending. Return cooldown only for exhausted failures. For pending-only full capacity, use bounded server-side wait/reclaim against the original generation; charge quotas once, hold no transaction while waiting, and return `START_CODE_BUSY` only on waiter overflow/deadline. Do not change schema unless the baseline proves the existing indexes insufficient. | FR-3, FR-4, INV-1–INV-3, NFR-2, NFR-4 | Concurrent guard tests prove the 200 bound and distinguish all-pending, mixed, and all-failed states; waiting valid requests proceed after release. |
| 4. Formal model update | `verification/lean/sat-access-code-start/SatAccessCodeStart.lean`; `verification/lean/sat-access-code-start/README.md`; `verification/lean/sat-access-code-start/RESULTS.md` | Extend the abstract budget model with waiting, waiter cancellation/timeout, generation binding, and conservative expiry. Add lemmas for no budget/quota change while waiting, no admission over 200, and successful candidate state preservation. State fairness as an explicit assumption for any progress theorem. Keep the initializer-gate/runtime proof at transaction-state level. | INV-1–INV-6 | Lean compiles without `sorry`; proof report states the code/SQL refinement assumptions and explicitly does not claim latency or implementation correctness from the abstract model alone. |
| 5. Local qualification and hardening | `backend/go/cmd/api/sat_start_code_http_mysql_test.go`; `backend/go/cmd/api/sat_start_code_guard_mysql_test.go`; relevant existing content/start tests; `docs/plans/2026-10-10-sat-access-code-600-start-throughput-fix.md` | Run three cold and three warm HTTP 600 waves on a new local schema at migration 0080, pool 32, one API process. Record profile/metrics; add mixed-code, shared-NAT, rotation, cancellation, and saturation cases. Run the 200 baseline and 2,000 diagnostic regression separately. | FR-1–FR-6, NFR-1–NFR-4 | All six 600 waves meet the hard gate and all correctness/security assertions pass. Record 2,000 separately; this result alone does not certify AT15. |

## 8. Test matrix

The planned matrix was executed against the local MySQL/API profile; results and unresolved qualification gates are recorded in §11. The 600-candidate hard latency gate failed.

| Case | Setup / stimulus | Expected outcome | Test level | Coverage |
| --- | --- | --- | --- | --- |
| TC-1 Cold 600 | New local schema at migration 0080; one API process; pool 32; 600 synchronized valid candidates; no retry. Repeat three times. | 600 `started`; 600 accepted attempts/modules; one runtime; no busy/cooldown/rate-limit/DB/transport errors; full drain ≤2 s, p95 <2 s; report all percentiles. | HTTP + MySQL load | FR-1/2, NFR-1, INV-4/5 |
| TC-2 Warm 600 | Same profile after runtime exists; 600 new candidates; no retry. Repeat three times. | Same correctness/counts and latency gate; no exclusive initialization storm. | HTTP + MySQL load | FR-1/2, NFR-1, INV-5 |
| TC-3 200 baseline | Existing synchronized 200 profile. | No regressions in success/error contract; compare stage latencies against recorded baseline. | HTTP + MySQL load | FR-1/3, NFR-1 |
| TC-4 Pending-only saturation | Hold 200 live reservations, submit a correct request, release one reservation through a controlled barrier. | Request waits without holding DB pool capacity or recharging quotas, then gets one reservation and starts; never receives cooldown while failed count is below 200. | MySQL integration | FR-3, NFR-4, INV-1/2 |
| TC-5 Exact failed budget | Use distinct principals/attempts and 200 wrong-code submissions concurrently, then one additional wrong and one correct request. | Exactly 200 failures; additional comparisons receive cooldown; no valid start bypasses exhausted budget; no runtime created by invalid candidates. | MySQL integration | FR-4, NFR-2, INV-1/2 |
| TC-6 Mixed pending/failure | Interleave valid and wrong codes behind barriers so `failed + pending` reaches 200 in different compositions. | Pending-only capacity waits; a released successful slot becomes available; a wrong settlement preserves spent total; failed=200 yields cooldown. | MySQL integration | FR-3/4, INV-1/2 |
| TC-7 Rotation while waiting | Pause a request after it observes generation N; rotate to N+1; resume it. | Old request returns rotated without comparing against N+1 or incrementing N+1 failures. | MySQL race | FR-4, INV-3 |
| TC-8 Cold initializer race | Synchronize many candidates after an absent-runtime observation; pause initializer around commit to force stale readers. | One runtime and pinned plan; only one local initializer transaction; other local requests wait without DB connections then use shared path; remote loser rechecks and retries shared. | MySQL concurrency | FR-1/2, INV-4/5 |
| TC-9 Duplicate/replay | Two requests for one attempt race; then retry after successful commit/uncertain ACK. | At most one acceptance/module activation/deadline; duplicate recovers original state; no second code comparison after accepted recovery where current behavior bypasses verification. | MySQL + HTTP | FR-6, INV-6 |
| TC-10 Lease/cancellation/settlement failure | Cancel after reservation; fail settlement; run sweeper twice. | Pending is eventually counted failed once in original window; no expired reservation authorizes comparison; start facts, if already committed, remain recoverable. | MySQL fault injection | FR-4, INV-1/2 |
| TC-11 Per-attempt/principal/shared NAT | Exceed the existing fixed-window quotas and test many candidates behind one shared NAT. | Stable attempt/principal limits remain exact; internal capacity wait is charged once; shared NAT is not used as a new global lockout key. | MySQL + HTTP | FR-3/4, NFR-2 |
| TC-12 Content isolation | Start candidates with different attempts and inspect response bodies/cache headers. | Each response includes only that candidate’s selected module content; no candidate state or protected content crosses attempts. | HTTP integration | INV-7 |
| TC-13 Auth/scope boundary | Use a bearer for a different attempt/schedule and submit the start request; inspect reservation and response state. | Request is rejected before a comparison reservation or protected content is produced. | HTTP + MySQL integration | FR-5, NFR-3, INV-8 |
| TC-14 Lean model | Compile from `verification/lean/sat-access-code-start` using pinned Lean toolchain. | All model lemmas compile; no `sorry`; README explains assumptions and non-claims. | Formal model | INV-1–INV-6 |
| TC-15 2,000 diagnostic regression | Run existing 2,000 profile after 600 gate with classified errors. | Preserve report and explain failures; do not claim AT15 pass unless the original AT15 criteria all pass. | HTTP + MySQL load | Regression / separate AT15 gate |

## 9. Rollout and recovery

- **This plan adds no schema migration in its recommended first implementation.** Use a newly created local database migrated through `0080_sat_access_code_start.sql`; verify the database schema guard is current before the wave.
- Keep the feature flag `SAT_ACCESS_CODE_START` disabled outside the isolated local qualification environment; its config default is false in `backend/go/internal/platform/config/config.go`.
- Run the baseline first, then deploy the code changes to the one local API process and repeat the same profile. Do not compare a different DB pool, host, schema, or API-process count without labeling it as a separate run.
- If the local gate fails, use stage metrics to identify the dominant phase. If the single guard lock is dominant after the runtime gate fix, stop and prepare a separate `0081` expand-only migration/design for 200 DB-backed permit slots, including engine compatibility and Lean proof, before implementing it.
- **Rollback:** Disable code-start locally or revert the application change; no schema cleanup is needed for the recommended path. Existing pending reservations remain governed by the lease sweeper. Do not manually clear pending/failed rows or reset the abuse budget; use the existing authorized code-rotation recovery if a local fixture is exhausted.
- Local success proves only the measured local profile. Production instance count, MySQL-compatible engine/version, pool sizes, host resources, network path, and production SLO remain unknown; a production capacity claim requires repeating the same evidence against that target environment.

## 10. Open decisions and final gap review

- **Latency interpretation:** Recommended hard target is full-wave drain ≤2.0 s and p95 <2.0 s, with p95 ≤1.0 s as the improvement target. Confirm against the user's intended “sub 1–2 sec” wording before treating the 1-second value as a hard gate.
- **Local workload shape:** The plan assumes one API process and pool 32 to match the current HTTP harness. The local machine and exact MySQL runtime profile must be recorded when executing the plan; no production topology is available in the inspected repository evidence.
- **Queue bound and wait budget:** Use the proposed local values of at most 600 blocked requests per schedule per API process across both wait conditions and a 2.0 s absolute admission deadline from handler entry, further capped by request cancellation/deadline. Overflow is `START_CODE_BUSY`, not cooldown. Production values require a separate topology/profile decision.
- **Guard optimization:** Retain the single guard row initially. If measured guard wait dominates and the 600 target fails after cold-runtime serialization is removed, the next decision is whether the actual local/production DB engine supports the proposed 200-slot `SKIP LOCKED` allocator with the required semantics. That is intentionally a separate migration and proof gate, not assumed here.
- **AT15 distinction:** Passing 600 locally does not certify the spec's 2,000-candidate AT15 requirement. The current 2,000 HTTP artifact has aggregate failures including transport resets; it needs classified failure evidence and its own acceptance run.

**Traceability check:** Every P0 requirement is linked to at least one matrix case. Start atomicity and one-runtime correctness remain enforced at the MySQL transaction/constraint boundary; the Lean model proves only its abstract transition properties under the stated bridge assumptions. Queue fairness/liveness requires an explicit scheduler/fairness assumption and is validated by the real HTTP load test. No production capacity or latency claim is made by this plan.

## 11. Execution results

### Implemented

- Added the one-process bounded per-schedule initializer gate, runtime-ready wake broadcast, cross-process runtime recheck/rollback/shared retry, and admission deadline measured from handler entry.
- Kept DB guard rows/reservations authoritative; pending saturation waits outside a transaction/connection, and retries through the existing generation-bound claim path.
- Added stage timing instrumentation and an HTTP/MySQL wave harness with cold/warm 200, 600, and 2,000 profiles.
- Added/updated MySQL and race coverage for cold-runtime cross-service contention, pending-capacity wait/release, rotation, cancellation/deadline, quota retry, start replay, and selected-module scope.
- Fused published-version revision and selected-module scope reads into one query while retaining request-attempt ownership and current-scope validation.
- Reduced per-request SQL connection acquisition in the two quota writes by reusing a pinned connection where supported. The two counter writes remain separate autocommit operations; quota atomicity across both keys is not claimed.
- No schema migration was added. The required repository documents are `verification/lean/sat-access-code-start/SPEC.md`, `ASSUMPTIONS.md`, `TRACEABILITY.md`, `PROOF_REPORT.md`, `PRODUCTION_TEST_PLAN.md`, and `RECOMMENDATIONS.md`.

### Verification

Local profile: Darwin 23.5.0 arm64, 8 logical CPUs, 8 GiB RAM; Go 1.26.3; MySQL 9.6.0; local schema `sat_start_code_600_20261010` through migration 0080; one API process; pool max 32. MySQL global transaction isolation was REPEATABLE-READ; the application transaction runner explicitly uses READ COMMITTED for this transaction. Production topology is unknown.

- `go test -race ./internal/delivery`: passed.
- `go test -race ./internal/delivery -run '^TestSATStartAdmission' -count=1`: passed.
- `go test ./cmd/api -run '^(TestSATAccessCode|TestSATStartCode)' -count=1`: passed against local MySQL.
- `lake build SatAccessCodeStart OperationalSafety Counterexamples AxiomAudit && lake env lean AxiomAudit.lean`: passed with pinned Lean 4.19.0. The proof report records exact theorem statements, transitive axiom audit, and model restrictions. It is not a Go/SQL refinement proof.
- Full `go test ./cmd/api` previously had the unrelated `TestAuthoringHTTPContractsMySQL` fixture failure (“Module 1 has 5 of 27 questions”); that full-package run was not repeated.

### 600 HTTP waves and gate result

All six required cold/warm waves were run, but none meets p95 <2.0s and full drain ≤2.0s:

| Wave | HTTP errors | Accepted / started | Runtime rows | p95 | Drain |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold 1 | 0 | 600 / 600 | 1 | 9.567s | 9.863s |
| Cold 2 | 1 server error | 600 / 600 | 1 | 9.958s | 10.049s |
| Cold 3 | 4 transport resets | 596 / 596 | 1 | 4.924s | 5.012s |
| Warm 1 | 56 transport resets | 545 / 545 | 1 | 5.842s | 5.956s |
| Warm 2 | 0 | 601 / 601, including setup start | 1 | 5.378s | 5.479s |
| Warm 3 | 322 transport resets | 279 / 279 | 1 | 2.072s | 2.400s |

The one server error in Cold 2 occurred although 600 starts were persisted. Warm 1 and Warm 3 have incomplete response/start counts. Every wave had one runtime, but that does not offset the latency/errors. Therefore phase 5 is **executed but failed the acceptance gate**; this plan is not qualified or ready for rollout.

The separate 200 profile had no errors and one runtime (p95 2.233s; drain 2.283s). The 2,000 diagnostic had 736 accepted/started, one runtime, and 1,264 errors (1,241 transport resets; 23 `START_CODE_BUSY`); it is not an AT15 pass.

Additional cold 600 diagnostic with `SAT_CODE_LOAD_STAGES=1` and a current-schema Performance Schema guard digest: 78 errors (34 `START_CODE_BUSY`, 44 transport resets), 522 starts, one runtime, p95 6.940s, drain 7.104s. `guard_lock` measured 160.995 cumulative seconds over 556 calls; global InnoDB row-lock time rose 162.050s (+836 waits). `state_content_assembly` summed 941.932s over 522 responses and `reservation_claim` 682.669s over 556 calls. Stage sums overlap across concurrent requests. The guard is a material contention source, not the only measured cost. Detailed current-schema digest before/after counters are in `verification/lean/sat-access-code-start/PRODUCTION_TEST_PLAN.md`.

### Remaining blocker

The additional sample ties substantial global row-lock time to 556 application guard-lock calls, but its cumulative stage data also identifies larger content-assembly and full reservation-claim costs. This does not establish that removing the guard alone can meet the 2s gate. Capture per-table/index waits on the target profile and model the actual savings before a separate 0081 200-slot design. No 0081 migration has been written. Keep production feature rollout blocked until a production-equivalent six-wave gate and multi-process/fault profile pass.
