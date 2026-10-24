# SAT / IELTS Go and database performance plan

Date: 2026-10-23, Asia/Bangkok. Status: proposed implementation plan; no backend changes or new performance measurements made in preparing it.

## 0. Decision and current evidence

Optimize **successful, durably committed exam operations per second at a fixed latency and infrastructure budget**. Reduce database round trips and transaction occupancy first, then optimize the Go CPU and allocation costs identified by profiles. Qualify synchronized exam transitions separately from steady request throughput.

Keep the existing Go service and SQL database as the implementation boundary. The initial delivery requires no new cache service, message broker, microservice split, or database replacement.

This plan inspects the current working tree based on commit `714d997a`, including substantial uncommitted backend changes. Freeze an exact revision and configuration for each benchmark. Code facts below are verified by source inspection; performance reports are attributed to existing repository notes and were not independently rerun.

| Evidence | What it establishes | Implication |
| --- | --- | --- |
| `docs/plans/SAT.md`, October 23 local diagnostics | Two APIs, durable local MySQL 9.6, 2,000 students: all iterations and reconciliation completed. One-room practice/classroom save p99: 1.459/1.984 s; healthy transition p95/p99: 11.458/11.661 s and 10.893/10.991 s. These runs fail the stated latency gates. | There is an existing reproducible workload to improve; correctness success alone does not establish acceptable capacity. |
| Same notes, 100-room diagnostics | Healthy transition p99 remains 11.204/11.782 s. Earlier local API/pool increases also worsened latency. | Shared-room contention alone does not explain the delay. Keep pool/concurrency settings fixed for the first comparison. These are local reports, not proof of the production bottleneck. |
| `internal/attempts/service.go`, `batch_io.go` | V2 saves lock the attempt, validate session/epochs, apply projection and mutation ledger atomically. Two or more commands already use set-based I/O (`bulkWriteThreshold = 1`). | Preserve the validation loop and improve its execution costs; batching is already implemented. |
| `internal/platform/db/db.go`, `internal/platform/tx/tx.go` | Connection DSNs establish UTC; write transactions also execute `SET time_zone`. API/worker pool limits and SQL/transaction histograms exist. | Test removing redundant session work at its owner; extend existing telemetry. |
| `internal/delivery/lifecycle_state.go`, `cmd/api/handlers_delivery.go` | Pinned SAT `/state` avoids response/question assembly, but still performs many SQL reads. Full bootstrap is live attempt state and explicitly uses `no-store`. | Consolidate reads without caching mutable state under an exam-version validator. |
| `internal/platform/telemetry/registry.go` | Each duration observation builds histogram series under one mutex; the smallest duration bucket is 100 ms. | Measure observer overhead and add useful millisecond resolution before attributing small SQL costs. The mutex is a candidate, not a measured bottleneck. |
| `internal/runtime/ielts_personal.go`, `internal/proctor/ielts_personal_status.go`, migrations 0094–0095 | IELTS has attempt-owned section deadlines and a separate roster hydration query with correlated subqueries. | Include IELTS readiness, writing payloads, personal timing and staff reads explicitly. SAT-only results do not qualify IELTS. |

Paths in tables below are relative to `backend/go/` unless prefixed otherwise.

Unknown: production database engine/version, actual CPU/memory/I/O quotas, network RTT, deployment topology, enabled flags, table cardinalities, workload mix and required peak headcount. Phase 0 records them; none is assumed from local Docker or test fixtures. `backend/docker-compose.yml` specifies TiDB `latest`, while recent notes describe local MySQL: choose and pin the qualification engine/version.

## 1. Requirements and performance contract

### Required behavior

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| FR1 | Students enter, save, reconnect, transition and submit under concurrent SAT and IELTS traffic. | Every expected candidate finishes the scenario, with persisted answers and terminal state reconciled against independent expected data. |
| FR2 | Preserve protocol semantics while optimizing internals. | Existing HTTP envelopes, acknowledgments, hash bytes, error precedence, lease/control fences, timing and replay outcomes remain equivalent. |
| FR3 | Overload stays bounded and recoverable. | Existing 429/503 retry semantics are honored; bounded admission queues cancel cleanly; no unbounded goroutine, memory or connection growth. No premature durable acknowledgment. |
| FR4 | Capacity is reproducible. | Every result includes revision, flags, engine/version, hardware, data size, offered/achieved load, completed cohort, latency, retries, integrity checks and raw evidence. |

### Latency, throughput and efficiency

| Metric | Gate | Status |
| --- | --- | --- |
| SAT regular save acknowledgment | p99 ≤ 1,000 ms under the 2,000-student close workload | Existing gate in `k6/sat-recovery-close-2000.js`. |
| SAT healthy deadline → next-module start acknowledgment | p95 ≤ 3 s, p99 ≤ 5 s | Existing API gate in that script; measure browser first-answerable frame separately. |
| SAT browser deadline → first answerable control | p95 ≤ 3 s, p99 ≤ 5 s, all required students represented | Existing requirement recorded in `docs/plans/SAT.md`; API acknowledgments alone do not prove it. |
| Runtime polling | p99 < 500 ms; >90% 304 only in an intentionally unchanged-state workload | Existing scale-proof gate; 304 is not evidence of zero authentication/limiter SQL. |
| IELTS baseline | Preserve readiness p95 <10 s, transition p95 <20 s, submit p95 <15 s and full-cohort success | Current `k6/ielts-personal-timing-500.js` gates. They are weaker than the proposed targets below. |
| IELTS next targets | Ready p95 ≤1 s/p99 ≤2 s; eligible transition → usable section p95 ≤3 s/p99 ≤5 s; durable submit p95 ≤1 s/p99 ≤2 s | Proposed engineering objectives. Start after content/local readiness and intentional release waiting; keep complete user-flow timing too. Qualify at 500, then 2,000 students. |
| Sustainable throughput | Maximum passing **successful logical operations/s**, with HTTP attempts/s and answer commands/s reported separately | Measure first. Proposed improvement goal: ≥2× the baseline maximum passing throughput on identical resources, subject to all correctness and latency gates. No promised RPS before measurement. |
| Operational reserve | Expected peak ≤70% of measured maximum passing mixed-load capacity | Proposed starting reserve; also test losing one API instance at expected peak. Adjust only with evidence. |
| Efficiency | Record CPU-seconds, SQL statements, connection-seconds, committed transactions, redo bytes and allocated bytes per successful operation | A change must reduce its named cost or remove an established correctness/performance defect; unrelated paths must not materially regress. |

At the rated workload, unexpected application 5xx, answer loss, invalid authorization, duplicate ownership/route decisions and uncompleted students must all be zero. Count recovered overload responses and transport resets separately; retries must fit the end-to-end deadline. A test does not pass by excluding failed requests from its latency distribution.

## 2. Capacity model

Use actual client cadence and observed active-writing fraction when available:

```text
steady HTTP RPS = N × (1/Tpoll + 1/Theartbeat + activeWritingFraction/Tsave
                      + 1/Tlifecycle) + staffRPS + entryRPS
attempted HTTP RPS = first-attempt RPS × observed retry amplification
SQL statements/s = Σ(route RPS × measured SQL statements per request)
mean occupied connections ≈ Σ(route RPS × mean connection-hold seconds)
fleet connection cap = Σ(all API pool caps + all worker pool caps) + maintenance reserve
```

Illustration only: 25 s runtime polls, 30 s heartbeat and a save every 5 s from every student produce about 547 RPS for 2,000 students or 2,733 RPS for 10,000, before lifecycle reads, staff traffic and retries. With 20% additional attempts these become about 656/3,280 HTTP attempts/s. Heartbeat/save cadence here is an assumption, not a verified production mix.

For a synchronized cohort of 2,000, a 5 s transition objective requires roughly 400 completed student transitions/s during the wave; each transition can require several HTTP requests and transactions. Measure those multiplicities. Mean occupancy estimates help size experiments; they do not determine p99 or justify raising pool limits.

`k6/scale-proof/3_pollers.js` uses constant VUs with a 20 s sleep. 1,000 VUs produce at most roughly **50 polls/s**, not 5,000. Its 100,000-poller claim is a model, not a measured load. Add an open arrival-rate scenario to exercise actual offered RPS and keep the existing cadence scenario for user behavior.

## 3. Entities, authority and invariants

- **INV1 — durable answer:** `attempt_responses_v2`, its mutation ledger and revisions commit atomically before a success acknowledgment. A lost response can be recovered with the same operation identity.
- **INV2 — ordering/idempotency:** write-ID uniqueness and `(attempt, lease, question, client version)` uniqueness remain database-enforced. Stale writes cannot replace newer answers; a reused ID with different content still conflicts.
- **INV3 — authority:** authenticated identity, organization/schedule scope, live token session, writer lease and control epoch govern every accepted mutation. Revoked credentials are rejected on reads as well as writes.
- **INV4 — exam time/control:** current database state and authoritative time decide eligibility, pause, deadline and recovery. Cached poll/content data cannot authorize a write or create additional exam time.
- **INV5 — terminal state:** close, route selection, seal and submission receipts remain consistent under worker/client races. Required scoring and routing use the committed final answer set.
- **INV6 — content isolation:** cached trees are immutable, revision-bound and filtered for the authorized attempt/module. Unopened branches, future questions and staff-only answer material cannot leak.
- **INV7 — bounded execution:** payloads, batch sizes, cache retention, admission and worker concurrency remain bounded; cancellation releases resources.

Keep the attempt lock as the common mutation boundary in this plan. Room command lock ordering is part of correctness: `runtime.LockScheduleAttemptsInTx` locks the schedule's attempt rows before runtime state. `snapshotLocker` relies on that ordering to avoid a runtime lock per save. Do not remove either side independently.

## 4. Interfaces and critical flow

Public endpoints and request/response shapes stay compatible. Optimize inside the existing handlers, services, pool and transaction runner. Any proposed internal prepared-response value is unexported and request-scoped; it carries no trusted authorization decision.

```text
save:
bounded decode → signature/envelope checks → request-only preparation
→ begin transaction → lock attempt → validate live session/lease/control
→ authoritative runtime/module/time checks → replay/version classification
→ response rows + mutation ledger + revisions/audit → durable commit → acknowledgment

SAT close/entry:
bounded admission (before taking a DB connection)
→ existing close transaction → frozen-answer validation/apply + route + receipt
→ commit → existing entry/start protocol → usable module

IELTS:
ready request → locked attempt + shared runtime → section readiness/timing policy
→ attempt-owned timeline update → commit → independent personal work clock

read:
live authorization → bounded committed read/snapshot transaction
→ immutable content cache only where applicable → current authorized projection
```

Move only pure computation outside transactions. Recheck all mutable admission facts inside them. Receipt and required domain writes remain atomic. Preserve existing durable cross-instance notifications; coalescing a wakeup must not remove its recovery mechanism.

## 5. Ordered implementation phases

### Phase 0 — Establish a trustworthy baseline

**Owner:** backend performance engineer with database/operations support. Dependency: none. Complete before changing pool sizes, hashing or transaction behavior.

Files: `internal/platform/{db/db.go,db/instrumented.go,tx/tx.go,telemetry/registry.go,telemetry/telemetry.go}`, `cmd/api/{main.go,query_timeout.go}`, `cmd/worker/main.go`, existing k6 suites and `e2e/prod-load/`.

1. Record exact effective configuration, engine/version, schema/indexes, process topology, resource limits, DB RTT, active dataset and durability settings. Count embedded activity-driven worker pools as well as standalone workers. Reconcile documented pool variables with the actual config loader; do not assume every variable in `backend/.env.example` takes effect.
2. Run generators separately from API and database hosts. Preserve a local diagnostic profile, but qualify against the deployment's network/storage behavior. Pin fixture seeds; include 100k+ historical attempts and representative mutation/audit history, long IELTS writing answers, normal and maximum supported payloads.
3. Reuse existing HTTP/SQL/transaction telemetry. Add pool `WaitDuration`, idle/in-use/open/max, connection churn and periodic API/worker sampling. Driver query timing excludes `database/sql` pool wait; transaction timing currently includes acquisition/setup/callback/commit, so do not label it lock time.
4. Add bounded operation/stage observations for save, close, entry, IELTS ready/submit and lifecycle reads: admission wait, transaction work, commit and total service time. Do not use student IDs or raw SQL as metric labels. Add millisecond histogram resolution for SQL and transaction comparisons.
5. Capture CPU, heap/allocation, mutex and block profiles in separate repeatable runs. No pprof listener was found in the inspected server wiring: add an opt-in private/loopback diagnostic listener, excluded from public routing, with bounded sampling and explicit lifecycle/shutdown. Protect profiles because they may contain sensitive data. Follow [Go diagnostics](https://go.dev/doc/diagnostics).
6. Rank MySQL normalized statement digests by total time, calls, rows examined/returned and lock time; collect COMMIT/fsync/redo and I/O evidence. Use TiDB's corresponding statement/plan diagnostics when that is the deployed engine. MySQL supports grouped SQL evidence through [Performance Schema digests](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-digests.html).
7. Replace `TestBootstrapSteadyStatementBudget`'s constant-only assertion with an executing scenario that counts actual reads/writes. Add real budgets for warm/cold bootstrap, pinned `/state`, one-/two-/100-command saves, exact replay, close and IELTS ready. Include handler auth/limiter work in end-to-end counts, separately from service counts.
8. Correct the scale-proof RPS and stale bootstrap-304 assumptions. Live bootstrap intentionally returns current state; a 304 ratio applies to the runtime poll, not to mutable bootstrap. Add open arrival-rate load, route tags and complete outcome accounting, including dropped iterations.

**Done when:** repeated baseline runs identify the largest costs per operation, provide a complete latency breakdown, and reconcile all candidates. Save a report and raw artifacts under a proposed `verification/performance/<run-id>/` directory; redact credentials/answers. Existing note-only measurements remain historical evidence, not the new baseline.

### Phase 1 — Remove repeated work from save transactions

**Owner:** response persistence engineer. Dependency: Phase 0 cost/statement baseline. Main files: `internal/attempts/{service.go,batch_io.go,canonicaljson.go,submit.go,validate.go}`, `internal/platform/{db/db.go,tx/tx.go}` and affected tests.

1. **One owner for UTC initialization.** Prove every affected pool uses `NormalizeDSN`/the shared connector and initializes new/reconnected connections to UTC. Then remove the redundant per-transaction `SET time_zone` in the shared runner. Expected deterministic saving: one SQL setup execution per affected write transaction, not a promised percentage speedup. Inspect the manual transaction paths in `student/v1_write.go`, `terminalization/service.go`, outbox and `cmd/api/handlers_v1_writes.go` before migrating their setup. Keep an explicit fallback where a caller can supply an unnormalized pool. Test multiple physical connections, reconnects and non-UTC host/session defaults. The driver's [system-variable contract](https://github.com/go-sql-driver/mysql/tree/v1.9.3#system-variables) supports initialization through the DSN.
2. **Prepare canonical bytes/hashes once when semantics permit.** `saveInTx` computes request hashes, hashes payloads and canonicalizes payloads; it also creates a canonical command value whose result is discarded. `exactReplay` computes request hashes separately. Build a request-scoped prepared representation after provider question-ID normalization is known. Reuse canonical bytes for SHA-256 and persistence, and across transaction retries only when the normalized inputs are unchanged. Retain error behavior for unsupported values and all cross-language hash vectors. Server-selected superseded/canonical responses still need their own correct bytes.
3. Keep single-command and set-based strategies behind the existing validation loop. Compare SQL counts and elapsed cost before changing the threshold, already 1. Add equivalence cases for multi-write same-question batches, partial replay, superseded responses and error precedence.
4. Profile `batchIO.loadVersionRows`: independent question/version `IN` lists can fetch combinations not present in the command set. Compare exact `(question_id, client_version)` pair predicates or separate indexed write-ID/version queries against the existing OR query. Select by actual plans/rows/round trips; preserve collision checks and command order. Additional indexes require Phase 3 evidence.
5. Audit row-first projection consumers before enabling or changing that rollout. Legacy answer blobs may still feed grading, staff reads, exports or V1 compatibility. Use existing read-through/projection behavior and prove consumer equivalence; do not simply stop maintaining a required representation.

**Done when:** byte-identical hashes/acks and equivalent errors pass; real DB race tests pass; statements, allocation or transaction occupancy improve on the named operation; mixed-load latency does not regress. Changes affecting hash preparation get reviewed independently from UTC/pool work.

### Phase 2 — Reduce lifecycle and content read amplification

**Owner:** exam delivery engineer. Dependency: executing read budgets from Phase 0. Files: `internal/delivery/{lifecycle_state.go,service.go,versioncache.go}`, `internal/runtime/{snapshot.go,poll.go}`, `cmd/api/{handlers_delivery.go,handlers_runtime_poll.go}`.

1. Consolidate repeated schedule/version/policy reads in pinned `LifecycleState`; combine compatible attempt/module/entry projections where plans remain selective. Keep a single coherent snapshot for facts whose relationship matters. Do not replace queries with one giant row-multiplying join or serialize independent reads on one transaction through goroutines.
2. Replace cold `LoadSections → loadModules → loadQuestions` query fan-out with bounded set-based reads by version, assembling the existing typed tree in Go. Keep revision checks, order, answer filtering and per-attempt branch visibility. Warm-cache behavior is already optimized; measure cold-herd cost separately.
3. `VersionCache` waits on an in-flight channel without observing the supplied context. Make waiters cancellation-aware and specify loader lifetime so one canceled leader cannot leave waiters blocked or cause unbounded duplicate loads. Preserve revision verification and immutable shared values.
4. `SnapshotCache.Get` permits concurrent miss loaders; add per-schedule coalescing only if herd measurements show meaningful duplicate loads. Use generation/revision-aware publication so invalidation during a load cannot reinstall an older snapshot. Bound expired schedule retention. Keep the 1 s staleness ceiling and mutation gates independent of this cache.
5. Profile `loadResponsesV2`'s OR join/collation/question identity resolution against production-shaped response histories. If material, separate canonical ID lookup and legacy fallback without changing ordering or duplicating responses. Auth/session and rate-limit work remain in read budgets even on 304.

**Done when:** measured SQL/bytes/allocations decline for selected paths; cold/warm herd tests pass; attempt content, timing, recovery and revocation semantics remain correct on two API instances. Full bootstrap stays `no-store`; no exam-version-only 304 for attempt state.

### Phase 3 — Tune proven expensive queries and deadline scans

**Owner:** database engineer with the owning domain engineer. Dependency: Phase 0 digests and Phase 1/2 final query shapes. Files: `internal/delivery/reconcile.go`, `internal/proctor/{rosterpage.go,sessions.go,ielts_personal_status.go}`, `internal/runtime/ielts_personal.go`, `internal/outbox/outbox.go`, new forward migration(s) only when justified.

1. Capture actual plans and cardinalities for the highest-total-cost queries. Compare warm/cold cases, one large room and many small rooms. [MySQL EXPLAIN ANALYZE](https://dev.mysql.com/doc/refman/8.4/en/explain.html) executes the statement; run against isolated/read-safe fixtures. Use engine-specific evidence rather than assuming MySQL and TiDB behavior is identical.
2. Start with index candidates suggested by inspected predicates: roster `(schedule_id, updated_at, id)` and optional status-filter variant; module/IELTS timeline `(attempt_id, state, section_order)`-style reads; canonical response lookup; due-worker claims. Verify existing index definitions and selectivity first. Avoid redundant/wide covering indexes on write-heavy tables. Preserve existing unique constraints.
3. Evaluate the computed `DATE_ADD(started_at, allocated+extension+pause+grace)` SAT expiry filter. First improve selective state/start-time filtering. If scans dominate and that is insufficient, propose an indexed due-time field or separate due-candidate projection. List every writer—start, pause/resume, extension, entry, close and recovery—before introducing it. Recheck authoritative timing inside the locked transaction, backfill in chunks and shadow-compare old/new candidate sets; a candidate index may never omit an eligible timeout.
4. Profile IELTS correlated roster lookups at the actual page limit and rewrite only expensive parts into bounded page-ID batches. Include full writing/flag payload sizes in row-width measurements. Preserve all personal-clock status rules.
5. Evaluate outbox `MOD(CRC32(aggregate_id), partitions)` scans and existing update/skip-locked claim modes under real backlog. Persist an indexed partition only if examined-row amplification warrants its migration and rebalance protocol. Preserve leases, deduplication, retry/dead-letter handling and transactional enqueue.
6. Review room commands under active saves. The all-attempt lock is a possible large-cohort cost with a correctness role. Improve lock duration and supported index access first. A replacement room/control-epoch protocol is a separate design only if this path remains dominant; it must replace the `snapshotLocker` ordering proof across every writer.

**Done when:** plan and observed total SQL time improve without unacceptable write/redo overhead; migration rehearsals pass on realistic table sizes; worker lag and candidate fairness do not regress. Add only indexes whose before/after results justify them.

### Phase 4 — Optimize measured Go CPU, allocations and telemetry

**Owner:** Go runtime/performance engineer. Dependency: representative profiles after the SQL changes. Files: `internal/platform/telemetry/{registry.go,telemetry.go}`, `internal/platform/db/instrumented.go`, `internal/attempts/canonicaljson.go`, and the profile-identified delivery code.

1. Benchmark telemetry observation in parallel, including `/metrics` scrapes. Current observations rebuild and sort series keys for every duration bucket under a process-wide mutex. If visible in CPU/mutex profiles, pre-register bounded series/label combinations and reuse bucket storage; consider atomic counters or narrower locks only as necessary. Preserve cumulative histogram semantics and metric names. Demonstrate the observer's improvement in both a microbenchmark and a mixed-load run.
2. Add benchmarks for realistic one-/two-/100-command saves, replay, SAT close manifests, long IELTS writing answers and warm/cold content assembly. Measure `ns/op`, `B/op` and `allocs/op`; use repeated samples and statistical comparison. Benchmark SQL algorithms on the real qualification database as well as pure CPU code.
3. Remove repeated map conversion/JSON round trips, pre-size bounded slices/maps and reuse request-local work where profiles justify it. A pooled buffer must have an explicit size ceiling and exclusive ownership; do not retain large exam/essay bodies globally. Keep standard JSON semantics and hash vectors.
4. Measure prepared/direct execution costs at the driver boundary, including prepares/closes and database RTT. Compare stable prepared statements with the current behavior only on hot queries. Treat parameter interpolation as a separate compatibility-tested experiment, with driver/charset constraints checked; never construct SQL values manually.
5. Match `GOMAXPROCS` to real CPU quotas and test a memory budget with heap/GC evidence. GC tuning is conditional on heap profiles, not a substitute for eliminating allocations. Finally compare a representative PGO build against the same non-PGO build; the [Go PGO guide](https://go.dev/doc/pgo) calls for representative application profiles. Keep reproducible profiles/build inputs and accept PGO only on measured benefit.

**Done when:** the measured hot path improves repeatably, correctness and race checks pass, and latency/CPU/RSS/GC behavior improves at the same workload. No unsafe memory tricks or serialization/library replacement without evidence that the simpler changes are insufficient.

### Phase 5 — Set fleet concurrency and protect mixed traffic

**Owner:** backend and operations engineers. Dependency: shorter transactions and measured DB service curve. Files: `internal/platform/{config/config.go,db/db.go,httpx/ratelimit_fallback.go}`, `internal/delivery/sat_close_admission.go`, background runner, API/worker startup.

1. Sweep a small set of **aggregate** connection/concurrency budgets around the baseline while holding resources fixed. Account for overlapping rolling deploys and all worker pools. Choose the last point before commit latency, queues or errors rise; [Go connection management](https://go.dev/doc/database/manage-connections) explains how the pool's maximum bounds concurrent connections, not database capacity.
2. Preserve existing close admission before DB acquisition and cancellation/FIFO behavior. Tune active/queued capacity against measured connection hold time and end-to-end deadlines. Half the local pool is an existing heuristic, not a proven global optimum. More API replicas also multiply admission capacity, so test the fleet total.
3. Verify worker claim/sweep concurrency stays within its budget and still catches up after restarts. Reserve enough request capacity for autosaves and staff pause/terminate during synchronized closes. Long PDF/export/retention work must not contend unboundedly with exam mutations; reuse existing job separation.
4. Benchmark the existing four-permit distributed rate-limit reservation/batching. Keep rate ceilings, restart/fallback behavior and fairness; removing shared protection or lengthening leases requires an explicit equivalent contract. Include legitimate cohorts behind one NAT in the test.

**Done when:** mixed traffic meets its gates without monotonic queue growth, staff controls remain responsive, and one-node-loss/restart tests retain answer integrity. Keep database durability enabled; reducing fsync/commit guarantees cannot count as an optimization win.

### Phase 6 — Qualify and publish the capacity envelope

**Owner:** performance/QA and operations engineers. Dependency: all earlier accepted changes.

1. Repeat the identical baseline and candidate workload at least three times, reporting variation. Use an open arrival-rate ramp for sustainable RPS and separate synchronized candidate waves. Include cold caches, warmed runs, 30-minute steady tests and a two-hour soak at the candidate operating point. Extend if the production session is longer.
2. Run SAT practice/classroom and IELTS independently, then together: 500 → 2,000 students; attempt 5,000/10,000 only after the previous tier passes. Test one large room and many rooms at equal total load. Do not claim larger capacity through extrapolation.
3. Run target-scale browsers for deadline-to-first-answerable behavior separately from k6. Exercise actual media/content readiness for IELTS; a backend acknowledgment does not prove the student can listen or type.
4. Publish a capacity table per topology: maximum passing logical RPS, HTTP attempts/s, answer commands/s, simultaneous candidates, per-operation p95/p99, retry counts, CPU/RSS, DB/pool/commit/worker lag and cost per completed exam. Retain failing runs and identify whether failures came from generator, network, application or database.

**Done when:** all correctness and existing latency gates pass on the named topology with repeatable evidence, the chosen operating point has measured reserve, and remaining proposed objectives are clearly labeled achieved or open.

## 6. Verification matrix

All rows below are planned; no tests were executed for this planning document. Extend existing tests rather than duplicating their implementation.

| Case | Setup / stimulus | Expected persisted and external outcome | Level / coverage |
| --- | --- | --- | --- |
| T1 | One, two and maximum supported save commands; empty/large essays; malformed and oversized payloads | Equivalent acknowledgments/hash bytes/error precedence; bounded work; correct persisted projection/ledger/revisions | Unit/golden + real DB; FR1–2, INV1–2/7 |
| T2 | Same write concurrently; same version with different write IDs; partial replay; commit succeeds but response is lost | One logical effect; same durable receipt on replay; conflict for changed content; no stale overwrite | Real DB, two APIs; INV1–2 |
| T3 | Takeover/revocation/pause/extension/terminate races against a prepared save and read | Current authority wins according to lock ordering; revoked reads rejected; no writes beyond the eligible boundary | Deterministic real DB interleavings; INV3–4 |
| T4 | UTC initialization across multiple pooled connections, expiry/reconnect and non-UTC host defaults | Same timestamp/deadline decisions before and after removing transaction setup | Real qualification engine; INV4 |
| T5 | Simultaneous SAT close, final response, worker timeout, replay and next-module start | Complete final-answer set, one route/receipt, correct next module, no reopened terminal state | Real DB + existing close/recovery k6; INV1/4/5 |
| T6 | IELTS ready/reconnect/section handoff/submit at 500 then 2,000 candidates, including delayed readiness and long writing responses | Full authorized duration from captured timing policy; no extra time on retry; all submissions durable; full cohort completes | Existing IELTS k6 + DB + browsers; FR1, INV1/3–5 |
| T7 | Empty cache herd; waiter cancel; loader error; publish/invalidate during load; many schedules | Bounded loaders/retention; no stale generation or branch leakage; cancellation releases waiters | Unit barriers/race + multi-instance load; INV6–7 |
| T8 | Compare optimized lifecycle/roster/response query output to old implementation on identical fixtures | Same authorized projection, ordering and legacy identity resolution; no answer scans on pinned `/state` | Golden + actual statement counts/EXPLAIN; FR2, INV3/6 |
| T9 | Deadline extension/pause/resume during due scan; two workers; worker crash/restart | No early/missed timeout; idempotent completion; bounded backlog catch-up | Real DB + shadow old/new candidates; INV4–5/7 |
| T10 | Saturate close admission with saves/polls/staff controls; shared NAT; cancel queued requests; remove one API | Bounded queues/pools; recoverable overload; no permit/connection leak; controls and save latency meet rated-load gates | Open arrival + synchronized load; FR3–4, INV3/7 |
| T11 | Concurrent metrics observations and scrapes, SQL streaming/early close/cancel | Correct cumulative buckets/counts and driver behavior; bounded cardinality; improved observer cost | Unit/race + benchmarks; FR4 |
| T12 | Migration on production-sized clone, backfill interruption, old/new binary overlap and app rollback | Compatible schema; correct shadow results; no long blocking DDL surprise; retained receipts/answers | Migration/integration rehearsal; INV1–7 |

Use deterministic barriers and controlled clocks where available. Real database tests must prove locking and uniqueness; sqlmock is insufficient for those guarantees. Run targeted `go test`/`go test -race` and `go vet` for changed packages, then repository-required suites. Load scripts mutate exam state: use isolated schemas, credentials and schedules. The integration README's compose command names MySQL although the inspected compose file only defines TiDB; verify the actual harness before running it.

## 7. Risks, delivery and recovery

| Risk | Protection and residual limitation |
| --- | --- |
| Faster save acknowledges before durable commit | Keep receipt/answer/ledger boundaries atomic; process-kill and lost-response tests. Async buffering of exam answers is outside this plan. |
| Precomputation or cache removes a live authority check | Only prepare immutable request data; retain transaction checks and live read authorization. Test revocation/control interleavings. |
| Fewer queries create inconsistent reads or row multiplication | Preserve coherent read snapshots; compare full projections and actual rows/bytes, not just statement counts. |
| Extra indexes improve reads but slow every write | Measure total mixed-workload latency/redo/storage and DDL behavior before approval. |
| Materialized due state becomes stale | Complete writer inventory, transactional updates, chunked backfill and shadow comparison before cutover. Remain on the current scan until equivalence is proven. |
| Local benchmark or retry loop hides capacity failure | Separate generator/resources, count first-attempt and logical completion latency, require all students, report retries/dropped work and raw failures. |
| MySQL results are applied to TiDB | Pin engine and test its transaction/lock/DDL behavior explicitly. TiDB documents [pessimistic transaction differences](https://docs.pingcap.com/tidb/stable/pessimistic-transaction/); compatibility is not identical performance or lock behavior. |

Deliver one independently measurable change per PR. Start with baseline/harness work, then UTC setup and canonicalization as separate changes, read consolidation, justified query/index work, measured Go tuning, concurrency settings and final qualification. Keep required scoring/routing synchronous with the authoritative transition; only already-asynchronous derived work belongs in existing jobs/outbox.

For schema work: inspect all existing indexes, select new migration numbers at implementation time, rehearse engine-supported online DDL, expand schema before code, backfill in bounded resumable chunks, shadow-check, then switch readers. Do not perform large blocking DDL during an exam. Keep old columns/indexes through the rollback window; application rollback does not undo data changes.

Canary on an isolated practice cohort before exam traffic, then use normal deployment controls to expand. Capture the same metrics at each step. Roll back the application/config change on any integrity/authorization/hash mismatch, candidate incompletion, or sustained breach of the relevant existing SLO. Proposed comparative stop rule: >10% p99 regression at equal offered load across repeated windows, or growing queue/worker lag. Reconcile affected attempts from durable ledgers/receipts before retrying an interrupted rollout. Roll back index usage through compatible code first; remove a problematic index later with controlled DDL.

## 8. Alternatives and open decisions

| Approach | Decision / revisit condition |
| --- | --- |
| Minimal: eliminate repeated work, selective queries, existing caches and bounded concurrency | Recommended initial approach. It directly targets inspected code and can be validated incrementally. |
| Structural: materialized due candidates or a new room control-epoch coordination protocol | Consider only if measured scans or all-attempt locking remain dominant. Both change writer/invalidation obligations and need a separate correctness review. |
| Workload: more adaptive polling, coalesced derived roster notifications, prewarmed published content | Use existing cadences/caches first. Additional staleness or changed polling contracts need explicit product limits; answer durability/deadlines cannot be relaxed. |

Phase 0 resolves production topology/engine, enabled flags, actual peak users and traffic mix. Keep the current settings as the first comparison point. The 2× throughput goal and stricter IELTS targets are proposed objectives; revise scope after a measured baseline, without weakening existing release gates.

Traceability: FR1 → Phases 1–3/6 → T1/2/5/6; FR2 → Phases 1–4 → T1/3/4/7/8; FR3 → Phase 5 → T9/10; FR4 → Phases 0/6 → T8/11/12. INV1–7 are covered by the matrix. The first implementation deliverable is the baseline and real SQL-budget harness; the final deliverable is a proven capacity envelope for a named deployment.
