# SAT Go/MySQL throughput: low-level implementation plan

Date: 2026-10-23, Asia/Bangkok. Status: steps 0–5 implemented and verified on 2026-10-23 (uncommitted working tree); step 6 now has local MySQL 9.6 and isolated MySQL 8.4 diagnostics. Target-topology capacity qualification (section 7 load procedure) is still outstanding. Results: section 9.

Increase successfully committed SAT operations per second on the same infrastructure while meeting the existing exam latency and integrity requirements. Start with repeated database work on the actual student paths. Optimize CPU work when profiles establish its cost.

This is a SAT-specific follow-up to `2026-10-23-go-db-performance.md` and `2026-10-23-go-db-core-implementation.md`. The latter records an earlier implementation in the working tree. Do not implement those changes again. This plan identifies additional concrete work remaining after that implementation.

## 1. Change boundary and repository evidence

Inspected base: commit `714d997a` plus the current, substantially modified working tree. Local Go: `go1.26.3 darwin/arm64`; driver: `github.com/go-sql-driver/mysql v1.9.3`. Freeze the complete working tree and effective configuration before comparing performance; the commit alone does not identify this baseline.

Paths in code tables are relative to `backend/go/`.

| Status | Inspected owner / evidence | Consequence |
| --- | --- | --- |
| Verified | `internal/attempts/service.go`: `SaveResponses`, `saveInTx`, `ioFor`, `exactReplay`; `batch_io.go`: both I/O strategies | Single-command saves use `perCommandIO`. A new write ID is queried in `exactReplay`, then queried again in the normal loop. The strategy currently does not remember the first miss. |
| Verified | `service.go`: `lockAttempt`, `exactReplay` | The attempt lock already reads `response_revision`. Successful exact replay executes a second query for that same revision while still holding the attempt lock. |
| Verified | `attempts/batch_io.go`, `prepared_test.go`, `question_identity.go` | Multi-command set-based I/O, prepared canonical bytes, exact version-pair lookups and staged projections already exist. Both ledger insertion implementations are in this package; frozen SAT writes call the same mutation core. |
| Verified | `delivery/lifecycle_state.go`: `LifecycleState`; `delivery/service.go`: module/scope/boundary/entry loaders | The joined lifecycle header already exists. The pinned-policy path still uses four separate reads for allowed module IDs, module attempts, boundaries and entry metadata. |
| Verified | `cmd/api/handlers_v2.go`: `loadV2SubmitResponse`, `loadV2Acknowledgements` | Post-commit response assembly executes one ledger query per final command. The validated submit envelope permits at most `attempts.MaxBatchCommands = 100`. |
| Verified | `platform/telemetry/registry.go`: `ObserveSeconds` | Each observation constructs bucket keys, sorts/quotes labels and formats bounds under one registry mutex. The smallest duration bucket is 100 ms. |
| Verified | `platform/db/db.go`, `db/instrumented.go`, `platform/tx/tx.go` | Role pools, driver query measurement and connection-owned UTC setup exist. Application pools already skip redundant transaction UTC setup. Preserve the fallback for externally supplied pools. |
| Verified | `delivery/bulk_sections.go`, `versioncache.go`, `reconcile.go`, `sat_close_admission.go` | Three-query content loading, revision-aware cache flights, due-work machinery and bounded close admission already exist. Preserve these owners. |
| Verified | `migrations/0100_sat_recovery_writer_fence.sql`; `docs/plans/SAT.md` | The pinned SAT recovery rollout requires MySQL and compatible API/worker binaries. The TiDB Docker example does not establish compatibility with this recovery protocol. |
| Inferred | Repeated lookups and serial response assembly increase connection occupancy and synchronized-wave work | Their statement savings are predictable; their share of end-to-end latency must be measured. |
| Unknown | Production MySQL version, quotas, RTT, enabled flags, historical row counts, command-count distribution and present maximum passing RPS | Capture these in step 0. Do not present local tests or an existing load script as a capacity result. |

Actual request chains:

```text
student durability transport
  → POST /api/v2/student/attempts/{attemptID}/responses:batch
  → v2BatchHandler → attempts.Service.SaveResponses → saveInTx
  → attempt/session locks → replay/fences/runtime/ownership
  → projection + ledger + revisions + audit → COMMIT → acknowledgement

GET /api/v1/assessment-delivery/schedules/{scheduleID}/state
  → deliveryStateHandler → live read-session verification → LifecycleState
  → read-only snapshot/header → scoped modules/boundaries/entry/timing/breaks
  → current Bootstrap-shaped state, empty sections/responses, no-store

POST /api/v2/student/attempts/{attemptID}/submit
  → v2SubmitHandler → attempts.Service.Submit → committed terminal receipt
  → loadV2SubmitResponse → loadV2Acknowledgements → HTTP response

SAT handoff
  → close-intent / registered final-response batches / modules/close
  → existing attempt-owned recovery transaction and lifecycle receipt
  → modules/start → authorized content and persisted next-module clock
```

Scope: shared mutation internals exercised by SAT, pinned SAT lifecycle reads, submit response assembly, database protocol overhead, and measurement needed to qualify them. Shared IELTS/ACT behavior remains a regression obligation. Preserve public endpoints, JSON, canonical hash bytes, replay/error ordering, timing policy and lock order. New infrastructure, relaxed durability, protocol redesign and broad schema rewrites are outside this plan.

## 2. Requirements and invariants

| ID | Observable requirement / acceptance criterion | Enforcement owner |
| --- | --- | --- |
| FR-1 | Increase maximum passing successful logical operations/s at fixed CPU, memory, storage and topology. Report HTTP attempts/s and answer commands/s separately. | Qualification harness and report |
| FR-2 | At 2,000 candidates, save confirmation p99 ≤ 1 s; healthy deadline-to-next-answerable p95 ≤ 3 s and p99 ≤ 5 s. These are existing gates in `docs/plans/SAT.md`. | API load plus browser timing |
| FR-3 | A pinned lifecycle read performs no domain mutation and returns no question/answer content. | `LifecycleState` and read-only transaction |
| ERR-1 | Invalid, revoked, wrong-attempt, wrong-tenant, stale-lease/control and closed/deadline requests keep their established errors and precedence. Dependency failures remain distinguishable from invalid credentials. | Existing auth and mutation gates |
| INV-1 | No success acknowledgement before the answer projection, ledger, revisions and required audit commit atomically. | `attempts.Service` + transaction runner |
| INV-2 | Write-ID/content conflicts and question-version collisions remain DB-enforced. Older content cannot replace a newer projection. | Existing unique keys + ordered save loop |
| INV-3 | Replay uses the live session/current credential lease and stored canonical acknowledgement. It neither applies an answer again nor restarts a clock. | Existing replay branch |
| INV-4 | Mutable admission decisions use authoritative transaction state/time. Process-local content/poll caches cannot authorize mutations. | Existing attempt/runtime/module owners |
| INV-5 | Frozen final answers, score, selected route, boundary state and close receipt describe the same committed transition. | Existing delivery close transaction |
| INV-6 | Caches, payloads, query batches, worker concurrency and admission stay bounded; cancellation releases resources. | Existing boundaries; request-local optimization state |

Proposed improvement objective: at least 2× the maximum passing baseline mixed-workload throughput on identical resources. This is a comparison target, not a capacity promise. First find a passing baseline below saturation. Qualify the 2,000-candidate wave independently; steady RPS alone cannot establish synchronized-transition capacity.

## 3. State ownership and relationships

| State | Authoritative owner | Proposed change |
| --- | --- | --- |
| Attempt identity, lease/control and current response revision | Locked `student_attempts` row | Reuse its revision on exact replay. |
| Accepted write identity/result | `attempt_mutations_v2` | Remember reads only within one locked transaction attempt. |
| Current answer | `attempt_responses_v2` with existing compatibility behavior | Keep the existing ordered projection algorithm unchanged. |
| SAT module/boundary/entry state | Module-attempt row and its optional boundary row | Read together in a one-to-one projection, inside the existing snapshot. |
| Submit result | Existing submission/terminal receipts and immutable ledger rows | Batch acknowledgement reads after commit. |
| Durations | Existing telemetry registry | Move exposition string construction away from observations. |

`saveInTx` remains the mutation orchestrator. Construct all replay memoization inside it, once per transaction attempt. Never put negative ledger results in `Service`, a shared cache, or state reused after rollback.

Keep the current lock protocol: attempt first, followed by the existing session/runtime/module/boundary order for the operation. Room controls also coordinate through affected attempt rows. Do not combine mutation queries into a joined `FOR UPDATE` merely to reduce statement count: that can widen locks or change acquisition order. MySQL documents the different behavior of shared and exclusive locking reads. [MySQL locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).

## 4. Exact function-level implementation design

### A. Remove repeated single-command replay work

Verified targets: `internal/attempts/batch_io.go` and `internal/attempts/service.go`.

1. Make the per-command strategy a pointer-owned transaction-local value. Add `byWrite map[string]*ledgerRow`; map presence means the lookup completed, and a present nil value means no row. Allocate lazily. `ioFor` returns `*perCommandIO`; update its `saveIO` assertion and affected receivers/tests.
2. `ledgerByWrite(writeID string) (*ledgerRow, error)` first checks that map. Cache a found row or a confirmed `sql.ErrNoRows`; do not cache SQL/cancellation errors. Retain the existing query and error mapping.
3. After a successful `insertLedger`, replace any cached miss for that ID with the inserted row. On failure return the existing error. This keeps the I/O adapter coherent if called again within the transaction; normal envelope validation still rejects duplicate input IDs.
4. Change the internal replay contract to:

```go
// Proposed internal signature; only the inspected saveInTx caller changes.
func exactReplay(
    io saveIO,
    cmd SaveResponsesCommand,
    prepared []preparedCommand,
    lockedRevision uint64,
) (replayed bool, acks []Ack, revision uint64, err error)
```

Pass `attempt.ResponseRevision`. Preserve command hashing, stored-result decoding, short-circuit order and the later `validateClaimLease` call. Replace only the final revision query with `return true, acks, lockedRevision, nil`.

Core method sketch, using the existing query/row type:

```go
func (p *perCommandIO) ledgerByWrite(writeID string) (*ledgerRow, error) {
    if row, loaded := p.byWrite[writeID]; loaded {
        return row, nil // a cached nil is a verified miss in this transaction
    }
    row := &ledgerRow{WriteID: writeID}
    err := p.q.QueryRowContext(p.ctx, `
        SELECT request_hash, response_hash, outcome, server_revision,
               CAST(canonical_response AS CHAR)
        FROM attempt_mutations_v2
        WHERE attempt_id=? AND client_write_id=? FOR UPDATE`,
        p.attemptID, writeID,
    ).Scan(&row.RequestHash, &row.ResponseHash, &row.Outcome,
           &row.ServerRevision, &row.CanonicalRaw)
    if err == sql.ErrNoRows {
        row = nil
    } else if err != nil {
        return nil, err
    }
    if p.byWrite == nil {
        p.byWrite = make(map[string]*ledgerRow, 1)
    }
    p.byWrite[writeID] = row
    return row, nil
}
```

This is a proposed implementation sketch, not an applied/compiled patch. Keep the existing SQL uniqueness constraints and shared validation loop. The attempt lock serializes the inspected ledger writers; re-audit that premise if a new writer is introduced.

Expected deterministic saving: one ledger SELECT for a new interactive write, and one revision SELECT for an exact-replay request. These are different request outcomes; do not add them together as a two-query saving on every request.

### B. Combine the pinned SAT module-state projection

Verified targets: `internal/delivery/lifecycle_state.go` and `service.go`. Proposed helper:

```go
func (s *Service) loadSATLifecycleModules(
    ctx context.Context,
    attemptID, versionID string,
    scope map[string]bool,
    now time.Time,
) ([]ModuleAttempt, error)
```

Call it on `snapshot := s.withTxDatabase(q)`, so every row comes from the same read-only transaction as `loadLifecycleReadContext`. Replace only this pinned-policy path's calls to `moduleIDsForScope`, `loadModuleAttempts`, `loadSATModuleBoundaries` and `loadPersonalEntryOffers`. Other callers keep their existing helpers until deliberately migrated.

Proposed SQL selects the module, entry and boundary fields consumed by the existing loaders:

```sql
SELECT ma.id, ma.module_id, ma.state, ma.allocated_seconds,
       ma.available_at, ma.started_at, ma.paused_at,
       ma.accumulated_paused_seconds, ma.extension_seconds,
       ma.completion_reason, ma.raw_correct, ma.operational_question_count,
       ma.tool_state, ma.revision,
       ma.entry_generation, ma.entry_starts_at, ma.entry_confirmed_at,
       ma.entry_entered_at, ma.auto_start_at,
       sec.section_key,
       b.module_attempt_id, b.phase, b.policy_version,
       b.work_deadline_at, b.entry_deadline_at, b.recovery_deadline_at,
       b.next_action_at, b.resolution, b.resolved_at,
       CAST(b.resolution_receipt AS CHAR), b.revision
FROM assessment_module_attempts ma
JOIN assessment_modules m ON m.id = ma.module_id
JOIN assessment_sections sec ON sec.id = m.section_id
LEFT JOIN assessment_module_boundaries b
       ON b.module_attempt_id = ma.id AND b.attempt_id = ma.attempt_id
WHERE ma.attempt_id = ? AND sec.exam_version_id = ?
ORDER BY ma.created_at, ma.id;
```

Filter with the existing `examdomain.AllowsSection(scope, sectionKey)` rule. Use nullable scans for the optional boundary; a NULL boundary identity produces a nil `SATBoundary`, not a synthetic phase. Reuse `computeModuleTiming`, `rawJSON` and existing null helpers. Preserve entry-generation pointers, `{}` tool-state default, module ordering and empty-array behavior. Bind both attempt and published version. Keep breaks, responses and other one-to-many collections out of this join.

`assessment_module_boundaries.module_attempt_id` is already its primary key (migration 0096); this join cannot multiply one module row into many boundaries. Use existing attempt/module and primary-key access paths. Check the actual plan before adding any index.

Expected deterministic saving: four module-related SELECTs become one, reducing this stage by three SELECTs. This is not a claim that the entire endpoint uses one query: auth, limiter, header, timing, device, breaks and conditional result/start-policy work remain.

### C. Batch post-submit acknowledgement reads

Verified target: `cmd/api/handlers_v2.go`, `loadV2Acknowledgements(ctx, db, attemptID, writeIDs)`; retain its signature and caller contract.

- Empty list: return the current empty acknowledgement slice without SQL.
- Deduplicate lookup IDs; query using bound placeholders and the existing `(attempt_id, client_write_id)` unique key. Normal validated submits have at most 100 IDs; use `attempts.MaxBatchCommands` as the query chunk bound if the helper accepts larger internal inputs.
- Decode rows into a map by write ID; normalize nil annotation/elimination slices exactly as today. Check `rows.Err()` and close rows before the next chunk or response encoding.
- Reconstruct the output in original `writeIDs` order, preserving repeats if a non-submit internal caller ever supplies them. Preserve today's behavior of skipping missing IDs and returning decode/DB errors. Do not change that compatibility behavior in a performance patch.

```sql
SELECT client_write_id, question_id, client_version, outcome,
       server_revision, response_hash, CAST(canonical_response AS CHAR)
FROM attempt_mutations_v2
WHERE attempt_id = ? AND client_write_id IN (?, ...);
```

For a valid N-command submit, acknowledgement reads change from N to one when N > 0; the separate attempt-header read remains. No new transaction or pre-commit acknowledgement is introduced. Immutable ledger results remain recoverable if the submit committed but response assembly or transport failed.

### D. Reduce histogram observation work

Verified targets: `internal/platform/telemetry/registry.go`, its tests, and `platform/db/db.go:ReportPoolStats`.

Keep `ObserveSeconds`, `Snapshot`, metric names and label normalization compatible. Represent each normalized histogram series with numeric bucket counts, total count and sum. Resolve one normalized label-series key per observation; find and increment one non-cumulative bucket under the existing mutex. During `Snapshot`, copy numeric state under the lock, then construct cumulative Prometheus bucket strings after unlocking. Reject negative/NaN/infinite values as today. Start without mutex sharding, atomics or a new dependency.

Add 1/2/5/10/20/50 ms buckets while retaining existing boundaries so SQL changes are visible. Compare before/after `BenchmarkObserveSecondsParallel` (proposed) with allocation counts and a concurrent scrape; preserve label-order equivalence, sums/counts, `+Inf`, counter/gauge behavior and `ResetForTest` behavior. Keep instrumentation identical for the main old/new application comparison so an observer change is not misattributed to SQL work.

Extend the existing pool snapshot with cumulative `WaitDuration.Seconds()`, idle/max connections and connection-close counters. Distinguish those counters from gauges and derive rates/deltas in reports. `WaitCount` alone does not quantify time waiting. `database/sql` bounds open connections and exposes pool statistics; saturation can make callers wait. [Go connection management](https://go.dev/doc/database/manage-connections), [DBStats](https://pkg.go.dev/database/sql#DBStats).

### E. Qualify driver protocol overhead before changing defaults

Verified owner: `platform/db/db.go:normalizeMySQLDSN/newPool`; installed driver code: `connection.go:Exec/Query`. The application preserves supplied driver options but does not force `InterpolateParams`. Effective production DSN settings remain unknown.

On an isolated synthetic database, compare the same workload using the existing native DSN with `interpolateParams=false` and `true`. Also compare explicitly prepared statements for a small set of stable hot SQL shapes if preparation dominates. Measure prepare/execute/close counts, bytes, latency and CPU at the deployment RTT. The driver documents that interpolation can avoid per-call preparation/closure; it also rejects unsafe multibyte encodings. [Pinned driver documentation](https://github.com/go-sql-driver/mysql/blob/v1.9.3/README.md#interpolateparams).

Use driver-owned binding only. Preserve `multiStatements=false`; never concatenate caller values. Verify the actual charset/collation and round-trip quotes, backslashes, NUL, emoji, UTF-8, timestamps, uint64 boundaries and supported payload sizes. Verify URI/native DSN options survive normalization; the current URI normalization needs explicit coverage for any driver option used by the experiment. Check `NO_BACKSLASH_ESCAPES` behavior and cancellation. Keep the binary protocol default if safety/compatibility or measurements do not justify a change. If interpolation wins, first use the existing deployment DSN option rather than adding a second global configuration mechanism.

Logical SQL savings from A–C and wire-protocol savings from E are different measurements. Do not infer a fixed throughput multiplier from preparation counts.

## 5. Execution order and acceptance budgets

| Step | Exact edit boundary / deliverable | Required proof before proceeding |
| --- | --- | --- |
| 0 | Existing telemetry, `bootstrap_statement_budget_test.go`, API load fixtures and k6 scripts | Record a repeatable baseline; replace the constant-only bootstrap budget assertion with an executing scenario. Count domain SQL separately from auth, limiter and driver commands. |
| 1 | `attempts/batch_io.go`, `attempts/service.go`, nearby replay/batch/retry tests | New interactive write loses exactly one ledger lookup; exact replay loses exactly one revision lookup; responses/errors/order remain equivalent. |
| 2 | `delivery/lifecycle_state.go`, existing module loaders; proposed `lifecycle_state_test.go` | Four module-related reads become one; byte-equivalent normalized projection except clock fields; zero domain writes/content leakage. |
| 3 | `cmd/api/handlers_v2.go`; proposed `v2_acknowledgements_test.go` | 0/1/100 inputs produce 0/1/1 acknowledgement queries; ordering, normalization and errors remain compatible. |
| 4 | `telemetry/registry.go`, `registry_test.go`; proposed benchmark; `db.go` pool reporting | Warm observations avoid per-bucket string generation, allocations decrease, concurrent scrapes/race checks pass. |
| 5 | Existing DSN boundary/tests and isolated deployment settings | Select driver mode from measured results and correctness cases. No new SQL/data contract. |
| 6 | Existing close admission, API/worker configuration, k6/browser harnesses | Re-run mixed traffic and synchronized transitions; then tune existing concurrency/pool limits under one fleet budget. |

Steps 1–3 are the first core implementation. They need no schema migration or external dependency. Step 4 improves measurement cost; step 5 is an experiment, not a prerequisite. Close scoring, recovery and route logic change only if profiles identify a further concrete hotspot.

For indexes, retain existing response primary key, ledger unique keys and boundary due index. Rank actual normalized SQL by total time, calls, rows examined and lock wait; use EXPLAIN/representative SELECT EXPLAIN ANALYZE before proposing an additional index. Include INSERT/UPDATE/COMMIT and redo/fsync evidence, not only SELECT timing. Performance Schema provides statement-digest aggregation. [MySQL statement digests](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-statement-digests.html).

## 6. Core control flow and worked traces

```text
validate envelope + signature → prepare immutable response bytes
→ begin bounded retry attempt
→ lock attempt, bind actor, verify live token session
→ canonicalize SAT sitting question IDs
→ create transaction-local I/O state
→ exact replay probes ledger once; all replay → stored acks + locked revision
→ otherwise preserve lease/control/runtime/deadline/ownership guards
→ process commands in client order; reuse observed ledger hits/misses
→ existing projection/ledger writes + revisions + required audit
→ COMMIT → acknowledge; failed/ambiguous response retries use the same IDs
```

Normal example: attempt lease 3/control 7/revision 41, question Q at client version 6. Save write W7/version 7. The transaction locks the attempt; the replay probe records a miss. The normal loop reuses the miss, passes existing guards and applies Q/version 7. Projection, ledger W7 and revision 42 commit; only then does the response report revision 42. A second save with older content still follows the existing superseded-version rule.

Lost acknowledgement plus close: W7 commits at revision 42 but the response is lost. The close transaction subsequently acquires the attempt, verifies the committed frontier and stores its route/receipt. Retrying W7 with the still-current credential returns the stored canonical answer without applying it or running the new-write deadline gate. The replay reports the attempt's locked revision, including any intervening accepted writes, rather than W7's historical revision. A revoked credential or replaced lease still fails at the established fence; memoization grants no authority.

Rollback/concurrency example: A caches a ledger miss and then fails after projection work, before commit. No success is returned; the transaction rolls back. B acquires the attempt and commits W7. A's retry constructs new I/O state and sees B's ledger row, so it replays instead of trusting the old miss. Use barriers/fault injection to test this sequence, not timing sleeps.

Lifecycle example: the snapshot sees a submitted old module, one preparing successor and an optional boundary. The combined projection yields exactly those scoped rows in current order. A concurrently committed start appears either in the next snapshot or wholly in this one; joining never starts a module, changes its deadline or releases unopened content.

## 7. Verification and capacity qualification

| Cases | Test boundary / proof |
| --- | --- |
| New single save; all replay; partial replay; superseded version (INV-1/2/3) | Existing attempts service/batch suites plus executing statement counts; exact canonical acknowledgements and revision behavior. |
| Retry after rollback; same write/different body; same question/version; stale lease/control; revoked replay (ERR-1, INV-1/2/3/4) | Existing retry, concurrency, fencing, revocation and durability tests; real MySQL transaction barriers for cross-connection behavior. |
| Frozen writes versus close/worker; duplicate close; lost response; cutoff expiry (INV-4/5) | Existing `cmd/api/sat_frozen_chunk_mysql_test.go`, recovery-worker, handoff and v2-completion suites; reconcile answers, route, boundary and receipt. |
| Combined state: absent boundary, every phase, pause/extension, scoped release, empty modules, pre-start, staff route and completed result (FR-3, INV-4) | Projection equivalence tests plus existing SAT MySQL/API tests; read-only transaction and content/privacy assertions. |
| Acknowledgements: empty, 1, 100, shuffled SQL rows, missing IDs, invalid stored JSON, cancelled query (INV-1/3/6) | Proposed acknowledgement tests exercise the real helper, ordered output and exact query counts. |
| Histogram parallel observation + scrape; label permutation; bucket edges; reset (FR-1) | Registry/race tests and proposed allocation/parallel benchmark. |
| Driver binding modes, connection replacement/UTC, cancellations (ERR-1, INV-4/6) | Existing pool/driver tests plus isolated real-MySQL value round trips. |
| Overload/cancellation, queue saturation, bounded retry and worker limits (INV-6) | Existing close-admission tests plus fault/load tests; all waiters release, no queued SQL connection ownership, no unbounded memory growth. |
| Shared-provider compatibility (ERR-1, INV-1/2/3/4/5) | Attempts, delivery, runtime, terminalization and IELTS/ACT API regressions for any shared-code changes. |
| Maximum passing throughput and complete 2,000-candidate wave (FR-1/2) | The mixed-load, browser, integrity reconciliation and failure qualification below. |

Executed while preparing this plan, against the pre-existing working tree:

```sh
# From backend/go; test database variables explicitly removed.
env -u TEST_MYSQL_DSN -u TEST_DATABASE_URL go test -race -count=1 \
  ./internal/attempts ./internal/delivery \
  ./internal/platform/db ./internal/platform/tx ./internal/platform/telemetry
```

All five package suites passed. This validates the inspected unit baseline, not the proposed code or database capacity. No new benchmark, real-MySQL integration or 2,000-candidate load run was executed for this plan.

After implementation, run those suites and the affected `cmd/api` tests. Run real database suites only with their documented isolated `TEST_MYSQL_DSN` and required schema, preserving their explicit opt-in flags. Existing load entry points include `TestSATRecoveryCloseK6LoadWaveMySQL` (`SAT_RECOVERY_K6_USERS`) and `TestSATRecoveryLifecycleK6LoadWaveMySQL` (`SAT_LIFECYCLE_K6_USERS`); verify fixture options before a run. These local diagnostics do not replace target-topology qualification.

Load procedure:

1. Freeze exact source/configuration, MySQL version, schema/indexes, durable commit settings, API/worker counts, CPU/memory/I/O caps, DB RTT and representative data. Record effective `ROW_FIRST_WRITES`, `RUNTIME_SNAPSHOT`, verification, limiter, cache and background settings. Count embedded worker pools too.
2. Use existing `k6/sat-recovery-lifecycle-2000.js`, `sat-module-entry-2000.js` and `sat-recovery-close-2000.js` with unique synthetic attempts. Cover one room and many rooms, classroom/practice, normal editing, final edits, partial offline recovery, submit and staff controls. Keep offered mix and seeds fixed across comparisons.
3. Add a proposed `k6/sat-throughput.js` open-arrival scenario to find maximum passing logical operations/s; keep the existing VU/cohort scenarios to model real candidates. Allocate sufficient VUs, report offered/achieved rate and require zero dropped iterations for a passing capacity point. Arrival rate controls iterations, not automatically requests. [k6 arrival-rate executor](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/).
4. Prevent artificial same-attempt contention in that scenario: bind each synthetic attempt to one VU for that VU's lifetime, use disjoint credential sets across concurrent scenarios, maintain its own monotonic versions/stable retry IDs, and retain enough unique credentials for the configured VUs. Increase concurrency with distinct attempts, not multiple simultaneous writers to one synthetic student. Refresh credentials through the supported flow when run duration requires it.
5. Sweep increasing load, then narrow around the failing point. Warm up, measure at steady state for at least 10 minutes, and repeat passing points three times. Record p50/p95/p99, logical operation success, retries, pool wait, connection occupancy, SQL/prepare counts, CPU/allocation/GC, lock/commit time and worker lag. Run CPU/mutex/block profiles in separate matched diagnostic runs to quantify profiling overhead.
6. Qualify a full exam/reconnect soak and losing one API at expected peak. Reconcile every candidate and every acknowledged/frozen answer against independent expected data. Report recovered 429/503/timeouts and end-to-end retry time; failed or uncompleted operations cannot disappear from the latency/success denominator.

Capacity model:

```text
HTTP attempts/s = first-attempt operations/s × requests per operation × retry amplification
SQL/s = sum(route attempts/s × measured SQL statements per request)
mean occupied connections ≈ sum(route attempts/s × connection-hold seconds)
fleet pool cap = all API + all worker pools + deployment overlap + maintenance reserve
```

The SAT fallback lifecycle cadence currently jitters between 30–60 s with a healthy socket and 10–20 s without it (`satPollCadence.ts`); initial transitions/events add requests. Measure the actual mix instead of deriving RPS from student count alone. A simultaneous 2,000-student transition within 5 s requires roughly 400 completed student transitions/s during the wave, each potentially involving multiple HTTP requests.

Keep expected steady peak initially below 70% of maximum passing mixed-load capacity, subject to the failure test. Tune existing close admission/reconcile concurrency and role pools only after reducing per-operation work. A larger pool is not evidence of more database capacity. Do not change MySQL durability settings to make the benchmark pass.

## 8. Rollout, extensibility and remaining risks

Roll out the compatible internal cuts individually: unit/real-DB verification → small synthetic cohort → 500 → 2,000 → measured pilot. Preserve source and effective DSN for rollback. Steps A–D need no data migration; driver mode can revert through the existing DSN. Rollback binaries must still understand the already-pinned SAT recovery protocol and database writer fences.

One realistic extension: another submit response consumer needs acknowledgements. It should call the same batched `loadV2Acknowledgements` owner or an extracted helper only when that caller exists; it must not add a second ledger query loop. Another SAT boundary phase requires the existing boundary owner and projection tests to change, not a new cache or scheduler.

Remaining risks: production configuration and database plan quality are unknown; pool/lock/commit wait may dominate even after query reduction; histogram contention is unmeasured; driver modes may perform differently at real RTT; shared-code optimizations affect other providers. Resolve each through the named baseline and regression boundary. The deliverable is complete only when the implementation removes the specified work and the chosen deployment passes correctness, latency and sustained-load gates with saved evidence.

## 9. Implementation record (2026-10-23)

Statement counts below come from `cmd/api` `TestSATDeliveryStatementBudgetMySQL`, which runs the service calls through the production measured driver against a real pinned-policy SAT attempt. "Before" values were measured by temporarily reverting the change.

| Step | Change | Evidence |
| --- | --- | --- |
| 0 | The constant-only `TestBootstrapSteadyStatementBudget` is replaced by the executing MySQL budget test. It counts domain queries/execs and logs driver prepares separately. | LifecycleState 9 queries, 0 execs. Steady pinned-SAT Bootstrap 37 queries + 1 exec (reconcile's conditional break-completion UPDATE, which matches no row). New one-answer save 16 statements. Exact replay 4 queries, 0 execs. |
| 1 (A) | `perCommandIO` is a pointer with a transaction-local `byWrite` memo (misses and hits cached; errors not cached; a successful insert replaces a cached miss). `exactReplay` returns the locked `response_revision`. | New save 17 → 16 statements, exact replay 5 → 4 (measured both ways). Sqlmock suites pin the exact order. `TestSaveRetryDoesNotReuseRolledBackLedgerMiss` shows a retry re-probes after rollback. Only `saveInTx` (after `lockAttempt`) writes `attempt_mutations_v2`. |
| 2 (B) | `loadSATLifecycleModules` replaces `moduleIDsForScope` + `loadModuleAttempts` + `loadSATModuleBoundaries` + `loadPersonalEntryOffers` on the pinned path only. | LifecycleState 12 → 9 queries. `TestSATLifecycleModulesMatchLegacyReads` checks DeepEqual and byte-equal JSON against the four-read oracle (nil/rw-only/denied scopes). EXPLAIN: attempt index on `ma`, PK `eq_ref` for module and boundary, filesort over the attempt's few rows (as before). No index added. |
| 3 (C) | `loadV2Acknowledgements` reads up to `MaxBatchCommands` distinct ids per IN statement and rebuilds request order, keeping repeats. | 0/1/100 ids → 0/1/1 statements. Deviation: `client_write_id` is `utf8mb4_unicode_ci`, so an id with no byte-equal row falls back to the old single-id lookup. That keeps collation-equal and missing-id behavior exactly as before. |
| 4 (D) | Histogram series are numeric (non-cumulative buckets + count + sum; label normalization outside the lock; cumulative strings built in `Snapshot` after unlock). Added 1/2/5/10/20/50 ms buckets. Pool stats add `db_pool_idle`, `db_pool_max_open` (gauges) and `db_pool_wait_seconds_total`, `db_pool_closed_total{reason}` (counters via the new `SetCounter`). | `BenchmarkObserveSecondsParallel` (8 goroutines): 17.9 µs, 384 allocs, 13.8 KB → 0.37 µs, 15 allocs, 352 B per observation. Exposition matches the old algorithm (oracle test) except one case: an odd label list used to render `{dangling="le"}` and now drops the dangling key, as counters do. |
| 5 (E) | No default changed. Added coverage showing `interpolateParams` survives native and `mysql://` normalization as a driver option (not a session variable), plus a real-MySQL round trip in both modes: quotes, backslashes, NUL, emoji/Thai, `NO_BACKSLASH_ESCAPES`, timestamps, uint64/int64 bounds, ~1 MiB payloads, cancellation. | Identical stored values in both modes; utf8mb4 connection. Local unix-socket PK lookup at 8-way parallelism: 24.8 µs (binary: prepare + execute + close) vs 13.5 µs (interpolated). With interpolation, the budget scenario sends 0 prepares and the same domain counts. Recommendation: qualify `interpolateParams=true` in the deployment DSN at the real RTT before enabling. |
| 6 | Added `k6/sat-throughput.js` (constant-arrival-rate; one attempt per VU; per-attempt pacing under the write limit; deterministic save/replay/state mix) and `TestSATThroughputK6MySQL`, which reconciles revision = applied ledger rows, unique applied revisions and projection = newest applied write. Knobs are `SAT_TP_*` because `K6_DURATION`/`K6_VUS` are k6's own options and replace the scenario. | Local diagnostics only (MySQL 9.6, 128 MiB buffer pool, two API processes × 60 connections, on a shared 8-core laptop with load average 6–17 from other apps): |

Local diagnostics (not capacity results):

- Throughput, 1,000 attempts: 250 ops/s offered passes (0 dropped, 0 failures, save p95 205 ms, no pool waits, 11,301 answers reconciled). 600 offered achieves 425 with 9,719 dropped iterations, so it fails; correctness still held (19,799 answers reconciled, 0 failed operations).
- Close/recovery wave, 500 users: passes. 0 failures, 0 lost frozen answers, 0 replay failures, 0 5xx; healthy deadline-to-next-start p95 2.68 s.
- Lifecycle wave, 2,000 users: no projection leaks, no invalid policies, no 5xx, attempt/module/boundary/session fingerprint unchanged. It failed the zero-failure threshold: 2 and then 86 of ~16k requests. The 2 were TCP resets from 2,000 simultaneous dials into one local listener (`kern.ipc.somaxconn=128`); the 86 were 10 s client timeouts behind pool waits while the machine was saturated. The first run matches the pre-change result recorded in `SAT.md` (16,844 reads, the same two transient resets, p95/max 1.459/2.516 s): 16,817 reads, p95/max 1.507/2.32 s. This local wave has not passed its strict counter on this host before or after the change.

Isolated-instance diagnostics, matching the setup of the earlier `SAT.md` runs (temporary MySQL 9.6, 1 GiB buffer pool, 512 MiB redo, durable commits, two APIs × 100 connections, same shared laptop):

- Lifecycle wave, 2,000 users, 2 min, `K6_INITIAL_JITTER_SECONDS=5`: **passes**. 16,710 reads, 0 failures, 0 5xx/leaks/invalid policies, unchanged fingerprint, request p95/max 8/131 ms, no pool waits. The same run without jitter failed 668 requests in its first two seconds, all at the local network layer: 395 were 502s generated by the test proxy when its dials to the APIs were reset at the 128-connection accept backlog, and the rest were k6 dial resets. The API processes logged no 5xx.
- Close/recovery wave, 2,000 users (harness defaults): integrity passes (0 scenario failures, lost frozen answers, replay failures or 5xx; SQL reconciliation clean). FR-2 latency gates still fail: save p99 2.09 s, healthy transition p95/p99 13.2/13.5 s. That is within the range recorded before this change on this host (save p99 0.61–2.92 s, transition p95 7.2–13.7 s); load average reached 20.7 during the run. Throughput change cannot be measured on this host; FR-2 stays open, as before.

Outstanding: the full section 7 load procedure on the frozen target topology (baseline vs. this tree with identical instrumentation, 2,000-candidate synchronized wave, soak, and losing one API). Then decide the driver binding mode and pool/admission limits.

### E2E execution addendum (2026-10-23)

Ran against a fresh isolated schema, migrated through `0101`, on local MySQL 9.6 (`max_connections=151`, 128 MiB InnoDB buffer pool, durable commits). This host is not a production-capacity substitute.

- Real-MySQL integration suite: `go test -tags integration -count=1 ./integration/...` **passes**.
- API E2E scenarios for cross-binary classroom routing, committed-save/lost-ACK recovery, multi-API/multi-worker recovery, and the delivery statement budget **pass**.
- Lifecycle load: 2,000 candidates across 20 rooms for one minute; 8,790 requests at 125.6 req/s, zero failures/5xx/policy errors/projection leaks, and unchanged attempt/module/boundary/session fingerprint. Request p95/max: 2.48/3.06 s.
- Close/recovery load: 2,000 candidates across 20 rooms, two API processes with 70 DB connections each; 11,992 requests at 126.1 req/s. Post-fix, the scenario reports zero close failures, lost answers, replay failures or unexpected 5xxs, and the database reconciliation assertions pass. K6 still records 1,577 retryable transport resets (13.15% of requests) and 1,557 retryable 503s. The local run fails the latency gates: save p99 3.87 s (target ≤1 s), healthy transition p95/p99 18.4/18.6 s (targets ≤3/5 s). The API pools accumulated 9,046 waits and 18m34s aggregate wait time.
- The load exposed MySQL error 1040 (“Too many connections”) escaping as HTTP 500. The shared SQL connector now maps that specific connection-capacity rejection to retryable `SERVICE_UNAVAILABLE`; the post-change wave has no unexpected 5xxs. This improves overload behavior but does not raise the local server's connection or latency capacity.

The 2,000-candidate close gate remains open until the same wave passes on the frozen, production-sized MySQL 8.4 topology. Do not use the local result as a throughput certification.

### Isolated MySQL 8.4 and throughput follow-up (2026-10-23)

Ran on a separate local MySQL 8.4.9 datadir, not the production host: `max_connections=240`, 512 MiB InnoDB buffer pool, 256 MiB redo capacity, durable commits (`innodb_flush_log_at_trx_commit=1`), two API processes × 100 connections. Schemas were migrated through `0101`. The machine and local socket remain shared-host diagnostics, not a target-capacity substitute.

- Real-MySQL integration E2E suite and the API E2E cases for cross-binary classroom routing, save/lost-ACK recovery, two-API/two-worker recovery, and the delivery statement budget **pass** on MySQL 8.4.9.
- Constant-arrival mixed throughput, 2,000 distinct attempts, 60 seconds, `interpolateParams=true`: 400 offered operations/s completed 24,001 iterations (393.4 logical ops/s; 426.2 HTTP req/s), with zero dropped iterations, failures, unexpected 5xx, or DB-pool waits. Save p99 was 80 ms; replay p99 48 ms. Database reconciliation found 18,101 accepted answers.
- At 500 offered operations/s, both driver modes completed about 30,000 iterations (491.6–491.8 logical ops/s; about 524.4 HTTP req/s), with zero dropped iterations, failures, or unexpected 5xx. The interpolated run had zero pool waits, save p99 78 ms, replay p99 49 ms, and 22,600 reconciled answers. The default driver-binding run had save p99 252 ms and replay p99 223 ms, with 136 waits totaling 567 ms on one API pool and none on the other. At this one-minute local point, interpolation reduced save p99 by 69% and replay p99 by 78% without changing completed throughput; keep it as a production-DSN candidate and qualify again at the real database RTT before enabling.
- At 600 offered operations/s with interpolation, the run **fails** the saturation gate: 502 logical ops/s completed, one iteration dropped, two unexpected 5xx responses, save/replay p95 4.17/3.81 s, and API-pool waits totaled about 46m53s. DB reconciliation still completed, with 23,787 accepted answers. The local mixed-load passing point is 500 offered ops/s, not a production capacity claim; keep expected steady peak below 70% of the maximum passing rate during a target-topology pilot.
- Close/recovery, 2,000 candidates, default 50% admission and no interpolation: integrity and save p99 pass (645 ms), with zero failed HTTP requests, but transition p95/p99 are 6.56/6.85 s against 3/5 s targets. Admission queue p95 is between 3 and 5 s; DB-pool wait totals about 12.8 s across both API processes. With interpolation, save p99 is 322 ms and transition p95/p99 improve to 5.06/5.15 s, but the transition gate still fails and the run has 37 retryable local TCP resets.
- A 75% close-admission cap was tested and rejected: it did not improve transition latency (p95 7.14 s), introduced 339 local transport failures, and raised API-pool wait totals to about 107 s. Retain the 50% per-process cap; the higher limit moves pressure into the DB pools without increasing useful transition throughput.

The local 500/s result is the current diagnostic ceiling. Before production tuning, repeat the same frozen-build mixed-load and 2,000-candidate transition runs against the target MySQL 8.4 service and RTT, include deployment overlap/worker pools in the connection budget, and run soak plus one-API-loss scenarios. Until the transition latency gates pass on that topology, do not claim the 2,000-candidate recovery target is qualified.

### Full current-tree E2E audit (2026-10-23)

Repeated against a fresh isolated MySQL 8.4.9 schema after migrating through `0101`, with two API processes × 100 connections and durable commits. No source changes were made during this audit.

- `go test -v -count=1 -timeout=20m ./cmd/api`: **passes** in 19.9s. The five skips were the four explicitly gated k6 waves plus the prepared-PDF route test, which requires its PDF artifact. The four k6 waves were exercised separately across the current audit and the preceding throughput run.
- `go test -v -tags integration -count=1 -timeout=20m ./integration/...`: **passes** in 4.24s.
- SAT lifecycle poll wave, 2,000 candidates across 20 rooms for one minute: **passes**. 8,710 requests at 124.4 req/s, request p95 7.14 ms, zero HTTP failures, policy/projection/5xx counters zero, zero API DB-pool waits, and the test's before/after lifecycle fingerprint is unchanged.
- SAT module entry wave, 2,000 candidates across 20 rooms: all 2,000 entry iterations and database reconciliation checks completed; protocol p95/p99 were 2.20/2.23s, under the 3/5s thresholds. The k6 gate nevertheless **fails** on four 502s emitted by the local reverse proxy after `connect: connection reset by peer`; these account for all four `sat_unexpected_5xx` samples. This host's accept backlog makes the strict zero-5xx result noisy at a synchronized 2,000-connection burst. API pools accumulated 178s of wait time during the wave.
- SAT close/recovery wave, 2,000 candidates across 20 rooms: answer integrity and reconciliation **pass** (`sat_close_failures=0`, lost frozen answers=0, replay failures=0, unexpected 5xx=0), with one retryable 503/transport retry. The latency gate **fails**: save p99 6.03s (target 1s), healthy transition p95/p99 7.00/7.09s (targets 3/5s). API pool waits total 63.5s. Performance Schema reports COMMIT average 26.54ms, no row-lock waits, and InnoDB reports zero row-lock wait events; this run is consistent with local durable-commit/storage or host contention, not an InnoDB row-lock bottleneck.

These current-tree API and integration suites close the broad functional regression audit. The exact zero-5xx entry gate and 2,000-candidate close latency gate remain open; the latter needs the frozen target MySQL and deployment topology before changing concurrency or claiming capacity.

### Continued current-state verification (2026-10-23)

- `go test -count=1 -timeout=30m -p=4 ./...` with `TEST_MYSQL_DSN` against a fresh isolated MySQL 8.4.9 schema **passes** across every Go package. This exposed a false-negative fixture in `TestReceiptImmutabilityMySQL`: its trigger probe updated an empty receipt table. The test now inserts a uniquely named row in a transaction, asserts update/delete rejection against that row, and rolls the fixture back.
- Race-enabled tests for `cmd/api`, `internal/delivery`, `internal/attempts`, `internal/platform/db`, `internal/platform/telemetry`, and `internal/platform/tx` **pass**.
- Current `BenchmarkObserveSecondsParallel` on Apple M1: 0.510–0.531 µs/op, 352 B/op, 15 allocs/op.
- Repeated the 2,000-candidate close/recovery wave across 20 rooms on MySQL 8.4.9, two API processes × 100 DB connections, durable commits. Integrity assertions pass (zero close failures, lost answers, replay failures, or unexpected 5xx); save p99 is 807 ms (≤1 s gate). Healthy transition p95/p99 are 10.35/10.37 s (3/5 s gates fail). The run also has 1,185 retryable local transport resets and 458 retryable 503s, while API pool waits total only 1.74 s. Performance Schema reports 7,446 COMMITs averaging 27.92 ms, with 0 ms lock wait; InnoDB reports one row-lock wait event. This remains a local diagnostic, not the production topology qualification.

The full MySQL-backed package suite and focused concurrency checks pass, but the 2,000-candidate transition latency target is still open. Tune against the target service RTT, storage and deployment connection budget; do not raise per-process admission based on this host result.

### Remaining issue — 2,000-candidate close/recovery latency gate (not passing)

The latest MySQL 8.4.9 local wave does not meet the transition latency SLO: healthy transition p95/p99 were **10.35/10.37 s**, against **3/5 s** limits. Save latency and answer-integrity checks pass, but the overall close/recovery gate remains **failed**. The run also recorded 1,185 retryable transport resets and 458 retryable 503s; local results do not establish the target topology's capacity or root cause.

**To close:** rerun the frozen 2,000-candidate wave against the target MySQL service and deployment topology, including its real RTT, storage durability, and combined API/worker connection budget. Require transition p95 ≤3 s and p99 ≤5 s, save p99 ≤1 s, zero lost frozen answers/replay failures/unexpected 5xxs, and complete SQL reconciliation. Until then, this capacity target is not qualified.
