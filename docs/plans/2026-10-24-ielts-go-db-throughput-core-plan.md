# IELTS Go/DB throughput: implementation-ready core plan

Date: 2026-10-24, Asia/Bangkok. Mode: design; no application source changes made for this plan.

Decision: retain the existing Go monolith and transaction boundaries. First measure the current implementation, qualify its existing row-first and driver options, and remove repeated work from the IELTS answer resolver. Then optimize the SQL, allocations, or contention that the measured profile identifies. Higher RPS is useful only while accepted answers remain durable and exam controls remain correct.

## 1. Change boundary and repository evidence

This plan extends `2026-10-23-go-db-performance.md` and `2026-10-23-go-db-core-implementation.md`. The latter already records orders 1–8 as implemented. Do not repeat those changes from an older design. Evidence below is from working tree HEAD `714d997a`, which contains extensive uncommitted changes. Freeze the actual diff, build, fixtures, and settings before a performance comparison.

Paths below are relative to `backend/go/` unless they begin with `src/`, `k6/`, `docs/`, or `verification/`.

| Evidence | Status | Consequence |
| --- | --- | --- |
| `cmd/api/handlers_v2.go`: `v2BatchHandler` → `attempts.Service.SaveResponses` → `saveInTx` → `saveIO` | Verified | Keep the existing mutation loop and its error precedence. Both single and batch saves use it. |
| `internal/attempts/service.go`: payload canonicalization happens before the transaction; request hashes are transaction-local and lazy | Verified | Already implemented. Do not introduce a second serialization or hashing path. |
| `internal/attempts/batch_io.go`: `bulkWriteThreshold = 1`, exact ledger keys, staged projections, set-based reads/writes | Verified | Two or more commands already use bulk I/O. Remaining work needs a measured improvement over this version. |
| `cmd/api/handlers_v2.go`: `ResolveMany` loads one snapshot, then calls `snapshotOwnerFor` separately for every missing question | Verified | Remaining worst-case traversal is O(B × N), for B requested IDs and N snapshot nodes. This is an algorithmic cost; its share of production latency is unknown. |
| `internal/runtime/cohort_readiness.go`, `ielts_personal.go`: personal readiness locks the requesting attempt, uses bounded RC retries, returns persisted start/deadline, and avoids rewriting an active timeline on retry | Verified | Preserve this path. The legacy cohort branch still has broader locking; existing sessions retain their captured timing model. |
| `internal/proctor/ielts_personal_status.go`: page hydration uses three bounded reads | Verified | The earlier correlated-query rewrite is already implemented. Measure the complete page, including its base query and runtime reads. |
| `internal/attempts/materialize.go`, `internal/student/readthrough.go`, terminalization and submit paths | Verified | Protocol-2 row materialization and seal-time answer assembly already exist. Grading/submission compatibility must remain intact. |
| `internal/platform/config/config.go`: `ROW_FIRST_WRITES` defaults false | Verified | The presence of an optimized code path does not mean the deployment uses it. Establish the actual production posture. |
| `internal/platform/db/db.go`, `instrumented.go`, `internal/platform/tx/tx.go` | Verified | UTC setup is connection-owned; query/result-consumption timing and transaction duration already exist; API/worker pools are separate roles. |
| `internal/platform/db/db_test.go`, `binding_mysql_test.go` | Verified | DSN support and real-DB equivalence tests for `interpolateParams` already exist. Qualify the configuration rather than building a statement-cache abstraction. |
| `internal/platform/telemetry/registry.go` and existing benchmarks | Verified, locally measured | Millisecond buckets already exist. One observation still normalizes labels and updates a shared registry; local allocation evidence is in section 8. Mutex dominance is unproven. |
| `k6/ielts-personal-timing-500.js` | Verified | Exercises readiness, transitions, reconnect, saves and submit, but setup enforces localhost and exactly 500 students. It cannot currently qualify 2,000 users or a remote staging deployment. |
| `internal/proctor/reconcile.go`: `ReconcileExpiredSections` | Verified | Due selection contains date arithmetic/OR predicates. `LIMIT` bounds returned candidates, not necessarily rows examined. Inspect its execution plan before redesigning scheduling. |

Unknown: production MySQL/TiDB engine and version; vCPU/RAM/I/O/network limits; enabled flags; deployed replicas; DB connection allowance; current RPS, payload distribution, table cardinalities and required peak cohort. The local compose file uses `pingcap/tidb:latest`; it does not establish the production engine. Resolve these through deployment configuration and one controlled baseline, not assumptions.

In scope: IELTS admission/readiness, V2 answer saves and replay, runtime reads, staff roster, submission, and background work competing for the same DB. Shared changes require SAT/ACT regression checks. Preserve public JSON, hashes, IDs, errors, authorization, timing policy, answer receipt, and grading inputs. New exam policies, SAT recovery protocols for IELTS, microservices, Redis, custom JSON codecs, and storage-engine replacement are outside this change.

## 2. Requirements, invariants and acceptance criteria

| ID | Requirement / invariant | Observable acceptance and enforcement owner |
| --- | --- | --- |
| FR-1 | Increase useful capacity on identical resources | Compare maximum sustainable successful logical operations/s before/after at the same mix, fixture size and latency gates. Report HTTP attempts/s and answer commands/s separately. Proposed objective: at least 2× the measured baseline; this is a target, not a prediction. |
| FR-2 | Reduce work per IELTS save | Snapshot ownership resolution makes one traversal of eligible roots per batch, O(N+B), with O(B) result/request memory. Canonical bytes/hashes, ordered ACKs and SQL count do not regress. |
| FR-3 | Maintain the complete IELTS flow | Every synthetic admitted candidate is reconciled against independent expected answers, section times and submission outcome. No missing candidate is hidden by a percentile. |
| INV-1 | ACK means committed durability | `attempts.Service` commits projection, mutation ledger and revision atomically before acknowledging a new write. No asynchronous answer acknowledgment. |
| INV-2 | Replay and ordering remain stable | Current lease/token checks, write-ID/request-hash conflicts, version collisions, superseded writes and ordered per-command outcomes retain their existing behavior. Database unique keys remain the final duplicate boundary. |
| INV-3 | Personal time is authoritative | `runtime.Service` and server write gates retain assigned start/deadline, preparation allowance, pause accounting and room-release eligibility. Readiness retry never allocates new time. Natural room completion does not cut short a valid personal section. |
| INV-4 | Mutable authority stays current | Resolver output uses timeline/module/control state from the current transaction; a content optimization cannot cache authorization, lease, pause, deadlines or eligibility across requests/retries. |
| INV-5 | One durable terminal outcome | Submit/retry/auto-submit/termination continue through their existing receipt/seal boundary. Lost acknowledgment is recovered from authoritative state without a second seal. Grading failure does not undo answer receipt. |
| ERR-1 | Errors retain their contracts | Malformed envelopes retain existing 400s; token/lease/control errors retain their codes; unknown questions retain their existing NOT_FOUND verdict; domain rejections retain existing per-command behavior. Dependency failures are propagated rather than converted into an ownership miss. |
| ERR-2 | Overload remains bounded | Request cancellation reaches SQL; existing 429/503 retry contracts remain usable. No unlimited wait queue, pool growth or goroutine-per-answer work. |

Existing IELTS load gates: readiness p95 <10 s, transition p95 <20 s, submit p95 <15 s, and full flow success in the 500-user harness. Preserve them throughout.

Proposed stricter qualification objectives: durable save p99 ≤1 s; ready handler p95 ≤1 s / p99 ≤2 s; durable submit p95 ≤1 s / p99 ≤2 s; eligible, locally prepared section transition to a usable browser p95 ≤3 s / p99 ≤5 s. Keep separate full-flow timings including intentional room waiting, content/audio preparation and offline recovery. Backend acknowledgment alone does not prove browser usability.

Start at 500 concurrent candidates, then qualify 2,000 only after the previous tier passes. Do not extrapolate a supported headcount. Keep at least 30% measured steady-state capacity reserve as an initial operating objective and validate peak load during loss of one API replica.

## 3. Entities, ownership and relationships

| Owner | Authoritative state / responsibility | Readers and writers |
| --- | --- | --- |
| Published exam version | Immutable content and question-to-section identity for the pinned sitting | Existing authoring/publish paths write; resolver reads the attempt's pinned version. |
| `student_attempts` + `attempts.Service` | Actor binding, lease/control epochs, response revision, save ordering | Existing saves, takeover, proctor controls and terminalization share the attempt lock protocol. |
| `attempt_responses_v2` + `attempt_mutations_v2` | Current protocol-2 cells and immutable replay evidence | Existing mutation core writes both in one transaction; materialization/sealing reads cells. |
| `ielts_attempt_section_timelines` + `runtime.Service` | Per-attempt preparation, start, deadline, pause and completion | Readiness, runtime pause/resume and individual proctor controls write; saves/roster read. Unique `(attempt_id, section_key)` owns identity. |
| Existing terminalization/receipt owners | Committed completion and final answer snapshot | Student submit, worker and proctor paths converge here. |
| `platform/db` and `platform/tx` | Connection lifetime/session discipline; commit/rollback/retry | Services reuse the existing pool and transaction runner. |

Existing personal readiness transitions to preserve:

| State | Event / guard | Outcome |
| --- | --- | --- |
| Absent or preparing | Eligible, signals ready, before fixed allowance, not paused | Persist active with DB-assigned start/deadline; return those values. |
| Active | Repeated readiness before deadline | Return the same stored times; no duration reset or duplicate activation audit. |
| Preparing | Allowance exhausted | Persist unable; preserve earlier answers and incident evidence. |
| Active | Own deadline reached | Existing completion/cutoff rules apply. |
| Any | Authoritative pause/termination | Existing controls and response codes remain effective. |

The new ownership lookup below is a temporary derived value, not a new entity or source of truth.

## 4. Exact function-level design

### Core change A: one snapshot traversal per batch

Verified edit target: `cmd/api/handlers_v2.go`.

Proposed helper, not yet present:

```go
func snapshotOwnersFor(
    root map[string]any,
    questionIDs []string,
) map[string]attempts.QuestionOwner
```

Contract:

- Reads a successfully decoded snapshot and bounded requested question IDs. Mutates neither input.
- Returns static ownership only for requested IDs that occur under the existing `snapshotQuestionRoots` ordering. Empty input returns an empty map.
- Matches exactly the current identifier spellings: `id`, `questionId`, `questionID`, `taskId`, `taskID`. In particular, preserve IELTS Writing task IDs and the existing broad legacy ID behavior.
- When an ID occurs in more than one section, the first eligible root wins, exactly as `snapshotOwnerFor` does now. Nested traversal order inside one root cannot change the owner because that root supplies one section/module pair.
- Returns no new errors. Decode, provider and SQL failures remain owned by existing callers. It never decides whether the question is currently writable.
- Lifetime is one resolver call inside one transaction attempt. No process cache and no shared mutable map.

Change `ResolveMany`: after its existing normalized lookup, provider restriction, snapshot load and `loadIELTSTimelines`, call `snapshotOwnersFor(root, missing)` once. For each missing ID, attach the current transaction's timeline with `applyIELTSTimeline`, or retain `errQuestionNotInExam()` if absent. Keep normalized-row precedence and the SAT no-fallback rule unchanged.

Keep `snapshotOwnerFor` and `snapshotContainsQuestion` unchanged for the existing single-question hot path and as the independent equivalence oracle. Their callers in `resolveSnapshotQuestion` and `Resolve`, and the Writing task-ID tests in `handlers_v2_test.go`, remain compatible. This avoids adding two lookup maps to every interactive one-question save. Compare the new batch helper against these unchanged functions; do not compare it with a wrapper around itself. If a bulk request has only one missing fallback ID, retain the original one-ID branch rather than building an unnecessary batch lookup.

### Core change B: qualify the already-implemented efficient persistence path

Verified owners: `attempts.Service.SetRowFirst`, `student.Service` read-through, `terminalization.Service`, `terminalSealer`, `platform/db.newPool` and DSN normalization.

No new save service or schema is needed. Compare row-first on/off for a one-command save, two-command save, 100-command offline flush, exact replay, and long Writing values. For protocol 2, the row-first path must write cells/ledger plus narrow attempt metadata without replacing full answer blobs on every save. Protocol 1 retains its existing authority.

Also compare the current DSN with driver-managed `interpolateParams=true` using the existing binding suite. Record actual prepares and wire/network time; fewer domain SQL statements does not by itself prove fewer protocol operations. Retain bound `?` arguments in application code, `multiStatements=false`, UTC and utf8mb4. Qualify quotes, backslashes, Unicode, binary values, numeric boundaries, timestamps, large packets and `NO_BACKSLASH_ESCAPES` through the existing tests. Do not hand-build SQL values.

Configuration promotion is conditional on equivalent persisted values and an equal-resource load improvement. These options are already supported; application source edits are needed only for an exposed consumer gap or failed contract, with its regression test.

### Next changes selected from the profile

| Verified boundary | Concrete permitted change | Promotion condition |
| --- | --- | --- |
| `proctor.LoadStudentSessionsPage`, existing `loadIELTSPersonalRosterStates` | Keep page-scoped three-read hydration; inspect the base page plan. If required, add a compatible ascending `(schedule_id, updated_at, id)` index using the next free migration number. Inspect live indexes first: migration 0017 already declares `(schedule_id, updated_at DESC, id)`, whose order must not be assumed equivalent to the page's ASC/ASC order. | Real execution plan and equal-fixture timings show excessive scanned/sorted rows, then improve after DDL without unacceptable write cost. Do not add a duplicate index from names alone. |
| `proctor.ReconcileExpiredSections` | Capture rows examined and scan/transaction time for due selection separately from the per-schedule mutation. Optimize a demonstrated expensive predicate or access path; retain bounded candidate batches and revalidation under existing locks. | Historical data or active-room growth demonstrably harms due lag. A stored next-action projection is a separate follow-up requiring every start/pause/resume/extend/advance writer and backfill to be designed; do not add an unmaintained timestamp. |
| `runtime.ReadyCohortSection` → `readyIELTSPersonalSectionInTx` | Count wrapper and handler SQL, including identity checks. Remove a repeated metadata read only if its locked/captured source can be reused without changing schedule → attempt → runtime/timeline ordering. | Measured statement reduction with readiness-vs-pause/submit races passing. Existing active retry must remain write-free at the readiness owner. |
| `Registry.ObserveSeconds`, `db.observeQuery` | If label normalization is material in the application allocation/CPU profile, add a registry-owned bound histogram handle for the fixed DB operation/outcome vocabulary. Resolve series once and let `Observe(value)` update the same histogram under its existing lock. Keep the generic API and dynamic-registry test behavior. | Profile demonstrates benefit; no wire/metric/cardinality change; no stale handle across test registry replacement/reset; race and scrape tests pass. A sharded/lock-free registry is not justified by the current microbenchmark alone. |
| `platform/db.OpenRole`, existing admission/background boundaries | Tune pool and worker concurrency within the fleet DB budget after reducing work. Queue waiters must not hold DB connections. | Measured pool wait, DB saturation, worker lag and p99 improve together. Larger pool size alone is not acceptance. |

## 5. Core algorithm, transaction and error behavior

Proposed Go implementation sketch for change A; this code is not applied:

```go
func snapshotOwnersFor(root map[string]any, ids []string) map[string]attempts.QuestionOwner {
    wanted := make(map[string]struct{}, len(ids))
    for _, id := range ids {
        wanted[id] = struct{}{}
    }
    owners := make(map[string]attempts.QuestionOwner, len(wanted))
    var visit func(any, attempts.QuestionOwner)
    visit = func(value any, owner attempts.QuestionOwner) {
        if len(wanted) == 0 {
            return
        }
        switch node := value.(type) {
        case map[string]any:
            for _, key := range []string{"id", "questionId", "questionID", "taskId", "taskID"} {
                if id, ok := node[key].(string); ok {
                    if _, needed := wanted[id]; needed {
                        owners[id] = owner
                        delete(wanted, id)
                    }
                }
            }
            for _, child := range node {
                visit(child, owner)
            }
        case []any:
            for _, child := range node {
                visit(child, owner)
            }
        }
    }
    for _, candidate := range snapshotQuestionRoots(root) {
        if len(wanted) == 0 {
            break
        }
        visit(candidate.value, attempts.QuestionOwner{
            ModuleID: candidate.moduleKey, SectionKey: candidate.sectionKey, ModuleState: "active",
        })
    }
    return owners
}
```

`snapshotQuestionRoots` continues owning wrappers, section normalization, deduplication and precedence. The helper is O(N+B) including root discovery, with O(B) maps plus traversal depth, rather than a complete index of all content. Early exit avoids scanning after all requested IDs are found. It does not remove the existing JSON decode or DB reads; profile those separately before proposing cross-request content caching.

Save execution order stays:

1. HTTP body bound/decode → envelope validation → trusted bearer checks.
2. Prepare immutable payload bytes outside the attempt lock as currently implemented.
3. Begin existing bounded RC retry; lock attempt and validate actor/token session.
4. Probe exact replay at the existing point. An authorized exact replay may return a prior outcome without reopening write eligibility.
5. Fence lease/control/session; read authoritative runtime and DB time.
6. Run the existing ordered command classification, using the new resolver only when ownership is actually needed. Attach current personal timeline; enforce section admission/cutoff in the existing owner.
7. Flush the existing projection/ledger/revision work, commit, then emit success/ACK. Preserve existing domain partial-accept semantics; any SQL failure rolls back that transaction.
8. Recreate transaction-local maps and mutable derived state on a retry. Cancellation or a failed dependency never publishes buffered work as success.

Do not move ownership/validation ahead of replay merely to prewarm a map. It can change error precedence and make a legitimate replay fail after an exam transition. Do not acquire a DB pool connection from inside a transaction for a second helper query: use the supplied `q`. Do not parallelize statements on one `sql.Tx`.

Existing identity/unique indexes remain: response `(attempt_id, question_id)`, ledger `(attempt_id, client_write_id)` and `(attempt_id, lease_epoch, question_id, client_version)`, timeline `(attempt_id, section_key)`. Real-DB plans and constraints, not an in-process mutex, protect multi-instance behavior.

## 6. Concrete implementation sequence

| Step | Files / deliverable | Exit criterion |
| --- | --- | --- |
| 0 | Proposed `verification/performance/<run-id>/`: build/diff identity, engine/version, quotas, topology, flags, schema, fixture seed, workload mix, baseline profiles and raw summaries | Repeated baseline runs agree sufficiently to distinguish a real improvement. Include normal/max supported payloads, long Writing, historical ledger growth, one large room and many rooms. |
| 1 | Proposed `cmd/api/ielts_statement_budget_mysql_test.go`; reuse `measureStatements`/`measuredPool` in the inspected `sat_statement_budget_mysql_test.go` | Real handler and service budgets for readiness first/retry, 1/2/100-command saves, replay, submit, poll and roster. Count domain queries/execs separately from prepares, begin/commit and connection setup. Existing helper swaps the global registry: serialize these tests or isolate their registry; no `t.Parallel`. |
| 2 | `cmd/api/handlers_v2.go`, existing resolver test files; proposed `handlers_v2_snapshot_bench_test.go` | Implement the helper and its `ResolveMany` integration; preserve the existing single-question branch. Equivalence against the old algorithm, no extra SQL, Writing/task IDs and SAT exclusion pass. Benchmark requested sizes 1/2/20/100 against small/large snapshots, including misses. |
| 3 | Existing DB binding tests, row-first read/seal tests, configuration/runbook | Qualify row-first and driver options independently, then together. Compare returned/persisted cells, hashes, flags, final submission and grading/export views. Use a consistent fleet configuration. |
| 4 | Profile-selected owner from section 4; only the required migration/config or telemetry edit | One isolated change yields a measured operation-level win and passes its invariant tests. No schema addition solely because a candidate index appears in this plan. |
| 5 | Keep `k6/ielts-personal-timing-500.js` as the existing localhost flow gate. Add proposed `k6/ielts-throughput.js` and an IELTS fixture/verifier in `cmd/api/ielts_throughput_mysql_test.go` | Explicit synthetic target/credentials, configurable 500/2,000 cohorts, arrival-rate save traffic, full completion verification, and mixed staff/poll/worker load. Retain guards against accidental real-exam mutation. |
| 6 | Proposed `docs/runbooks/ielts-capacity.md`, raw repeatable reports | Publish the measured capacity envelope, latency/accuracy results, connection limits, flags, and rollback steps for the actual deployment. |

Steps 0–3 are the initial core implementation scope. Step 4 is conditional on evidence; steps 5–6 qualify the resulting capacity. No source implementation is claimed in this document.

Fleet budget:

```text
potential DB connections = sum(all API caps)
                         + sum(all embedded/standalone worker caps)
                         + overlapping rollout instances
                         + maintenance/failover reserve
```

Keep this below the actual database allowance. Estimate demand from measured connection occupancy per logical operation, then validate under bursts. Pool wait and database lock wait are different; increasing a pool can simply move the queue into MySQL.

Capacity workload model:

```text
logical requests/s = candidates × (save-Hz + runtime-poll-Hz + heartbeat-Hz)
                   + readiness/entry/submit traffic + staff traffic
HTTP attempts/s    = logical requests/s + retry/recovery attempts
answer commands/s  = sum(commands in committed and replayed batches), reported separately
```

Record newly applied commands separately from replays/superseded/rejected commands. Use actual browser cadences and batch distributions; the generator must not create capacity by slowing itself as the server slows. The existing IELTS flow script snapshots before each save; keep that behavior for its flow gate, while the new throughput script maintains per-attempt versions/epochs and reads authoritative state at bootstrap/recovery, matching the current browser protocol.

## 7. Worked scenarios

Normal save: attempt A is active in Reading, lease 3, control 8, response revision 40. Its pinned snapshot contains `q-reading-1` and a later Writing task `task-1`.

1. A sends a valid Reading write, client version 7. The service validates actor/token and locks A.
2. No replay exists. Current runtime and A's Reading timeline permit the write.
3. The resolver checks normalized ownership first, loads the pinned fallback snapshot if needed, visits eligible roots once and selects Reading for the requested ID. It attaches A's current timeline.
4. The existing loop classifies/applies the write, stages the projection, inserts its ledger evidence and advances revision. Commit succeeds before the ACK.
5. Refresh/materialization returns the same accepted answer. A Writing ID appearing in the static lookup would still fail current-section admission; content membership grants no permission.

Lost acknowledgment + pause race:

1. The save commits, but A receives no response.
2. An authorized pause locks A through the established protocol, changes control state, commits and becomes authoritative.
3. A retries the exact prior write at the current authorized lease/token. The existing exact-replay branch returns its stored outcome without another projection write or revision increment.
4. A distinct new write using the old control epoch is rejected with the existing stale-control contract. A new write at the updated epoch remains subject to pause rejection.
5. Final state contains the accepted answer exactly once; no content map preserves the earlier permission. If the first transaction instead rolled back, retry re-runs current gates and cannot treat an uncommitted write as a replay.

Readiness fairness: room Reading release is 09:00:00, A becomes ready at 09:00:40, and configured working time is 60 minutes. The current readiness owner assigns the persisted start/deadline around 09:00:40/10:00:40 using DB time. A duplicate request returns those same values. A room advance at 10:00:00 does not shorten A's valid Reading time or open Writing before the room release and A's prior deadline. Benchmarks and optimizations must preserve this trace.

## 8. Verification and measurement

| Case | Test layer / evidence | Requirements |
| --- | --- | --- |
| Single and batch snapshot lookup, every legacy ID spelling, nested wrappers, duplicate IDs across sections, unknown/empty requests, Writing tasks | Unit equivalence with the unchanged old traversal; benchmark 1/2/20/100 requested IDs with misses and IDs near the end; preserve single-save allocation behavior | FR-2, ERR-1 |
| Normalized versus snapshot precedence; SAT cannot use snapshot fallback; same ACK/hash/order for unchanged inputs | Existing resolver/batch/hash tests plus added contract cases | INV-2/4, ERR-1 |
| Same-question versions 9 then 8 in one batch, version collisions, exact replay, 100-command flush | Existing staged-projection/equivalence tests and real-DB statement budgets | FR-2, INV-1/2 |
| Current versus expired/paused/unstarted IELTS timeline, foreign student/section, room natural completion versus explicit end | Real-DB writes through actual handlers and services; compare persisted timeline and answers | FR-3, INV-3/4 |
| Ready vs ready/pause; save vs pause/takeover/submit; duplicate submit vs worker seal | Real-DB concurrent connections/processes with barriers or injected phase failures, not sleeps | INV-1–5 |
| Commit acknowledged locally but HTTP response lost; process restart; rollback after staged writes | Receipt/ledger recovery plus authoritative final-state reconciliation | INV-1/2/5 |
| Row-first on/off, protocol 1/2, long Writing, flags/clears and final submission → grading/export | Integration/contract tests; verify independent expected values, not only server digest self-consistency | FR-3, INV-1/5 |
| Optional binding mode | Existing `TestDriverBindingModesRoundTripMySQL`, binding cancellation tests and benchmarks on the qualification engine | INV-1, ERR-2 |
| Optional bound metric handle | Race, snapshot/exposition parity, registry replacement/reset, concurrent scrape and allocation comparison | ERR-2; observer correctness |
| Mixed 500 then 2,000 candidates; readiness/submit bursts; one room and many rooms; API loss; worker restart | Open-loop arrival rates plus cohort flow/browsers and DB verifier; zero lost/incorrectly confirmed answers and all expected candidates accounted for | FR-1/3, INV-1–5 |

Measurements for each fixed offered load: successful logical ops/s, HTTP attempts/s, newly applied commands/s, retry/replay/reject counts, p50/p95/p99/max by operation, generator dropped iterations, CPU, heap/allocation rate, GC time, goroutines, pool wait deltas, query/prepare counts, transaction/commit time, lock wait/deadlock rates, rows/bytes examined/returned, and worker/outbox lag. Report overload failures and unfinished candidates; do not count rejected traffic as successful capacity.

Use isolated profiling windows for CPU, heap/allocations, mutex and blocking evidence. Existing transaction duration includes pool acquisition, callback and commit, so it is not a direct measurement of attempt-lock hold time. Use stage spans/timers or database evidence when attributing that interval. Do not add independently measured p99 values together to claim a request breakdown.

Useful commands from `backend/go` for the implementation stage:

```bash
go test ./internal/attempts ./internal/runtime ./internal/proctor ./internal/terminalization ./internal/student ./internal/platform/... ./cmd/api
go test -race ./internal/attempts ./internal/runtime ./internal/proctor ./internal/platform/telemetry ./cmd/api
go test ./cmd/api -run '^TestIELTSStatementBudgetMySQL$' -count=1 -v
go test ./internal/platform/db -run '^TestDriverBinding' -count=1 -v
go test -tags integration ./integration/... -count=1
go test ./cmd/api -run '^$' -bench '^BenchmarkSnapshotOwners' -benchmem -count=10
go test ./internal/platform/telemetry -run '^$' -bench '^BenchmarkObserveSeconds' -benchmem -count=10 -cpu=1,4
```

`TestIELTSStatementBudgetMySQL` and `BenchmarkSnapshotOwners*` are proposed tests, not existing coverage. Set `TEST_MYSQL_DSN` to an isolated, correctly migrated qualification database for DB tests; check skipped tests explicitly. The integration README's `docker compose up tidb mysql` instruction does not match the current compose file, which defines only TiDB. Pin and provision the intended engine rather than assuming that command supplies MySQL.

Already executed while preparing this plan:

- Targeted `internal/attempts` tests: prepared hash equivalence, staged same-question ordering, pending version collision, two-answer bulk path, bulk statement counts/replay, and batch strategy equivalence: passed.
- Targeted `internal/runtime` tests: persisted IELTS readiness times and read-only active retry: passed.
- Five `cmd/api` resolver tests: set-based resolution, SAT batch fallback exclusion, valid snapshot fallback, SAT single fallback exclusion and unknown-question behavior: passed.
- `go test ./internal/platform/db ./internal/platform/telemetry -count=1`: passed. An explicit verbose run of `TestDriverBindingModesRoundTripMySQL` confirmed it was skipped: `TEST_MYSQL_DSN not set; requires isolated MySQL`. Real-DB binding and capacity remain unverified.
- Existing telemetry benchmarks, Go 1.26.3, darwin/arm64, Apple M1, `-benchtime=200ms -count=3 -cpu=1,4`: ordinary observation 352 B/op, 15 allocs/op; one CPU 829.9–884.8 ns/op; four CPUs 246.8–429.4 ns/op aggregate benchmark time. Scrape mixture 693–694 B/op and 18 allocs/op. These short local samples measure instrumentation cost, not API RPS, DB capacity, lock dominance or a performance improvement.

No new snapshot benchmark, production profile, database execution-plan comparison, 500/2,000-user run or capacity certification was performed for this plan.

## 9. Rollout, extensibility and remaining risks

Ship the resolver change as a small independent patch. It needs no migration or new feature flag; rollback restores the prior traversal without changing stored data. Reject promotion for any hash/ACK/authorization mismatch, lost answer, changed timer, or repeatable latency regression at equal offered load.

Treat row-first rollout as a data-compatibility change. Use fresh synthetic/practice cohorts and consistent API/worker/reader settings before wider use. Do not run mixed old blob-authoritative readers/writers against newly row-first attempts without proving compatibility. Turning the flag off alone is not a safe rollback: compatibility blobs may be stale. Keep row-aware reads/seals, or materialize and verify affected protocol-2 blobs under the existing attempt lock before restoring blob-dependent paths. Preserve rows/ledger throughout.

Promote driver interpolation independently only after real-engine equivalence/load tests. Reverting that option restores the driver protocol without changing the data model. Additive indexes require an engine-specific DDL/recovery plan and a fresh plan after rollback; avoid DDL during a live exam wave. Do not weaken durability settings to win a benchmark.

One realistic extension is another legacy snapshot identifier spelling. The new pure helper owns membership matching; add its spelling and equivalence tests there, while timing, persistence, HTTP and transaction code remain untouched. A second is a new personal timing policy: `runtime.Service` and the existing save admission rules own it; the static lookup must stay policy-free.

The major unresolved performance risk is attribution: reducing snapshot traversal, allocations, prepares or blob writes may help different workloads by different amounts. The qualification report must say which change improved which operation and name the exact supported topology. A local microbenchmark or a plan cannot establish a production RPS guarantee.

Technical basis: profile with the tools described in [Go diagnostics](https://go.dev/doc/diagnostics); budget and observe pools using [Go connection management](https://go.dev/doc/database/manage-connections). For a MySQL qualification deployment, verify access paths with [MySQL EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/using-explain.html) and account for scanned-record lock scope described in [InnoDB locking](https://dev.mysql.com/doc/refman/8.4/en/innodb-locks-set.html). Engine-specific syntax and behavior must be checked against the actual deployed version.
