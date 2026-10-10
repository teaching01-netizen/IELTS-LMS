# Production and concurrency test plan

## Measured local profile

All waves used `backend/go/cmd/api/TestSATStartCodeHTTPWaveMySQL`, one in-process API/HTTP server, 32 maximum/idle DB connections, 600 pre-registered attempts, a barrier release, one HTTP request per candidate, and no client retries. Warm runs also create one setup start. The local schema was `sat_start_code_600_20261010`, migrated through `0080_sat_access_code_start.sql`. Host: Darwin 23.5.0, arm64, 8 logical CPUs, 8 GiB RAM. Tool versions: Go 1.26.3; MySQL 9.6.0. Observed server `@@transaction_isolation=REPEATABLE-READ`, `@@innodb_lock_wait_timeout=50`; the application transaction runner explicitly opens this path at READ COMMITTED. Production topology/configuration is UNKNOWN.

The harness reports p50/p95/p99/max, barrier-to-last-response drain, HTTP failure classes, DB-pool wait deltas, and optional stage histograms (`SAT_CODE_LOAD_STAGES=1`). It snapshots global InnoDB row-lock status plus the current schema's Performance Schema statement digest for the reservation guard `FOR UPDATE` query. The guard timer measures the SQL call after transaction acquisition; the broader `reservation_claim` stage includes transaction/pool work.

## Six 600-candidate qualification runs

| Run | Mode | HTTP errors | Accepted / started / runtime rows | p50 | p95 | p99 | Max | Drain | Global row-lock delta* |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Cold 1 | Cold | 0 | 600 / 600 / 1 | 9.500s | 9.567s | 9.832s | 9.862s | 9.863s | Not sampled |
| Cold 2 | Cold | 1 server error (`SERVICE_UNAVAILABLE`) | 600 / 600 / 1 | 9.653s | 9.958s | 10.023s | 10.047s | 10.049s | +598 waits; +220,817ms lock time |
| Cold 3 | Cold | 4 transport resets | 596 / 596 / 1 | 4.774s | 4.924s | 4.988s | 5.011s | 5.012s | +594 waits; +111,218ms lock time |
| Warm 1 | Warm + setup start | 56 transport resets | 545 / 545 / 1 (600 requested, plus one setup start) | 5.693s | 5.842s | 5.913s | 5.955s | 5.956s | +783 waits; +149,816ms lock time |
| Warm 2 | Warm + setup start | 0 | 601 / 601 / 1 | 5.218s | 5.378s | 5.448s | 5.479s | 5.479s | +858 waits; +135,244ms lock time |
| Warm 3 | Warm + setup start | 322 transport resets | 279 / 279 / 1 (600 requested, plus one setup start) | 0.022s | 2.072s | 2.357s | 2.400s | 2.400s | +561 waits; +60,577ms lock time |

`*` Each delta is from `SHOW GLOBAL STATUS` before/after its isolated wave. Counters aggregate all InnoDB tables and are supporting evidence, not definitive attribution to one table. The maximum reported row-lock wait counter remained 4,990ms from prior local activity.

**NFR-1 failed in all six runs:** every p95 exceeded 2.0s and every drain exceeded 2.0s. Two runs had no request failures, one had a 503 after all 600 rows had committed, and the other four had transport/server failures and incomplete HTTP response counts. One runtime existed in each run; persisted starts matched accepted HTTP responses in incomplete waves. A passing correctness count in one run does not satisfy the six-run hard gate.

Measured DB-pool wait deltas ranged from 4,715 to 10,579 checkout waits and 7m49.9s to 1h27m13.4s cumulative wait time per 600 wave. The pool wait duration is cumulative across goroutines, not wall-clock duration. On the later five sampled runs, global row-lock waits rose by 561–858 and accumulated 60.6–220.8s. A seventh diagnostic wave with stage and guard-digest snapshots is recorded below.

## Additional 600 diagnostic with stage and SQL-digest instrumentation

This extra cold wave used the same local schema/profile and additionally set `SAT_CODE_LOAD_STAGES=1`. Command:

```sh
TEST_MYSQL_DSN='root@unix(/tmp/mysql.sock)/sat_start_code_600_20261010?parseTime=true&multiStatements=true' \
SAT_CODE_LOAD_USERS=600 SAT_CODE_LOAD_RUNTIME=cold SAT_CODE_LOAD_STAGES=1 \
go test ./cmd/api -run '^TestSATStartCodeHTTPWaveMySQL$' -count=1 -v
```

Result: 78 request failures (34 `START_CODE_BUSY`, 44 transport resets), 522 accepted/started, one runtime; p50 6.837s, p95 6.940s, p99 7.063s, max 7.101s, drain 7.104s. Pool wait delta was 9,434 / 54m4.825s.

Per-request stage histograms reported these cumulative sums: `guard_lock` 160.995s/556 observations; `reservation_claim` 682.669s/556; `generation_probe` 235.927s/556; `quota` 163.823s/556; `seed` 173.986s/556; `start_transaction` 404.344s/522; `state_content_assembly` 941.932s/522. These sums overlap in wall-clock time because requests run concurrently; they are not additive wave duration. Global InnoDB counters rose by 836 waits and 162,050ms row-lock time. The application `guard_lock` stage and global row-lock delta closely track; lock contention is real, but the larger `state_content_assembly` and full `reservation_claim` sums show that removing the guard lock alone is not shown to satisfy the 2s response gate.

The current-schema Performance Schema guard digest counters changed from `count=27,181, timer=2,301,966,890,000,000ps, lock=2,299,092,708,000,000ps` to `count=28,849, timer=2,462,902,333,000,000ps, lock=2,459,817,583,000,000ps` (deltas: 160.935s total statement timer; 160.725s `SUM_LOCK_TIME`). These digest aggregates include prepared-statement lifecycle events and are supporting SQL-level evidence, not a per-request execution count. They are sampled in the HTTP harness; the local MySQL server had `performance_schema=1`.

## Separate 200 and 2,000 diagnostics

- **200 cold:** 200 responses completed with no failures and one runtime. p50 2.081s, p95 2.233s, p99 2.278s, max 2.282s, drain 2.283s. Pool wait delta 3,316 / 5m26.9s. This is a comparison profile, not a pass for the 600 hard gate.
- **2,000 cold:** 736 accepted/started, one runtime; 1,264 failures (1,241 transport resets, 23 `START_CODE_BUSY`). p50 0.151s, p95 6.399s, p99 6.449s, max 6.571s, drain 6.575s. Pool wait delta 13,205 / 1h9m59.4s; global row-lock delta +994 / +159,320ms. This does not certify the separate AT15 gate.

## Per-request individual admission wait (local diagnostic)

The handler now returns `Server-Timing` with total application admission wait and separate start-worker, runtime-initializer, and slot-capacity waits. These values are request-specific and exposed to browser clients; they measure only time actually blocked in those application queues. They exclude handler auth/decoding, DB-pool checkout, SQL/transaction work, response encoding, and network time. The local wave harness prints one `student_wait student_index=...` line per synthetic candidate when `SAT_CODE_LOAD_DETAILS=1`; it does not log real student identifiers. A request with no HTTP response has no header, so its queue wait is `unavailable`.

Two additional 600-request waves ran on a separate fresh scratch schema `sat_start_code_individual_wait_verify`, migrated through 0081, against the same local one-process profile (pool max 32, MySQL 9.6.0, Go 1.26.3, Darwin arm64, 8 logical CPUs). They are diagnostics, not two extra runs that qualify the six-run NFR gate.

| Run | HTTP responses / no response | Accepted / started / runtime rows | End-to-end p50 / p95 / p99 / max | Admission-wait samples p50 / p95 / p99 / max | Drain |
| --- | ---: | --- | --- | --- | ---: |
| Cold | 560 / 40 TCP resets | 560 / 560 / 1 | 3.881s / 6.942s / 7.034s / 7.038s | 3.764s / 6.671s / 6.869s / 6.897s (560 responses) | 7.041s |
| Warm | 368 / 232 TCP resets | 369 / 369 / 1 (includes one warmup start) | 1.233s / 4.944s / 4.997s / 5.003s | 2.625s / 4.687s / 4.892s / 4.919s (368 responses) | 5.003s |

The end-to-end distribution includes all 600 wave requests, including transport resets; the admission distribution includes only responses carrying the timing header. The values differ by student and by stage: start-worker queueing dominates the response samples. Neither p95 is below the existing 2-second target. The 40 cold and 232 warm transport resets are separate failures whose queue wait cannot be inferred from a missing response.

Examples from the cold wave: synthetic candidate 000 waited 901.465ms in application admission (1,196.297ms end-to-end); candidate 001 waited 4,902.403ms (5,221.922ms end-to-end); candidate 598 waited 6,877.477ms (7,031.087ms end-to-end). These are individual local samples, not a production distribution.

The diagnostic counters did not identify these waits as MySQL row-lock waits: the reservation-slot statement-digest query returned zero matching executions in these runs; the global InnoDB row-lock counter moved by +1 in the cold wave and did not move in the warm wave. Those global counters are not table-specific, and zero matching digest rows does not prove that the DB had no other wait. Pool wait deltas were 613 / 25.778s cumulative (cold) and 388 / 7.505s cumulative (warm). Therefore the measured application start-worker queue and separate transport failures are known; a unique physical cause for every elapsed millisecond/reset is not established.

Reproduction used:

```sh
TEST_MYSQL_DSN='root@unix(/tmp/mysql.sock)/sat_start_code_individual_wait_verify?parseTime=true&multiStatements=true&loc=UTC' \
AUTH_SECRET='<local-test-only secret>' \
SAT_CODE_LOAD_USERS=600 SAT_CODE_LOAD_RUNTIME=cold SAT_CODE_LOAD_DETAILS=1 \
go test ./cmd/api -run '^TestSATStartCodeHTTPWaveMySQL$' -count=1 -v
```

Repeat with `SAT_CODE_LOAD_RUNTIME=warm` for the warm wave. The hard 2-second latency assertion fails as expected; do not remove or relax it to make a wave pass.

## Executed functional tests

- `go test -race ./internal/delivery` passed after updating the selected-content regression for the fused current-scope query.
- `go test -race ./internal/delivery -run '^TestSATStartAdmission' -count=1` passed, including shared waiter cap, ready-runtime wake broadcast, cancellation, timeout, and cleanup.
- `go test ./cmd/api -run '^(TestSATAccessCode|TestSATStartCode)' -count=1` passed against the local MySQL schema. Coverage includes ordinary start/replay, concurrent first start, cross-service cold-runtime race, original-window expiry, quota enforcement, capacity wait/release, rotation while waiting, and scope/auth regressions.
- Full `go test ./cmd/api` was previously attempted with `parseTime=true`; the remaining failure was the unrelated `TestAuthoringHTTPContractsMySQL` fixture validation (“Module 1 has 5 of 27 questions”). It was not rerun after these changes.

## Required production-equivalent follow-up

1. Run the six 600 waves against the exact candidate MySQL engine/version, writer endpoint, API replica count, pool sizes, CPU/memory, network, and rollout flags. Do not infer production SLO from this local host.
2. Correlate guard `FOR UPDATE` calls, per-request stage histograms, global row-lock deltas, and DB-pool waits. Use table/index-specific `data_lock_waits` and statement events on the target profile before attributing all elapsed time to the guard.
3. Use barriers to force concurrent pending claims at 199/200, duplicate same-attempt reservation, rotation after generation observation, and competing cold-runtime commits from distinct API processes. Assert durable rows and client-visible reasons.
4. Inject cancellation/crash before reservation commit, after reservation commit, during start transaction, after start commit/before response, during settlement, and during sweeper replay. Verify the lease sweeper charges at most once in the original window and ACK recovery returns the original attempt state.
5. Test accepted-vs-close-time ordering with the database timestamp as the authority; distinguish browser send/click, request arrival, transaction commit, and response ACK.
6. Test DB deadlock/lock-timeout/connection loss, primary failover, stale/replica reads, cache invalidation, and mixed-version rollout/migration compatibility.
7. Migration `0081` now implements the 200-slot allocator and has been applied/tested on local MySQL 9.6.0. Validate its DDL, backfill, `SKIP LOCKED` behavior, and the full test profile against the exact supported/deployed MySQL version before rollout; do not increase the 200 bound or treat a process-local semaphore as correctness authority.
