# Full detail plan: single deploy + own MySQL (InnoDB), no new infra

## 0. Locked constraints and what they imply

1. **No new external services.** No Redis / NATS / Kafka / CDN / read replicas / queue. Only: one Go process (+ in-process worker goroutines) and self-hosted MySQL/InnoDB.
2. **One deploy only.** Single container running api + worker via backend/Dockerfile start.sh; railway.json stays a single service.
3. **Database is self-hosted MySQL/InnoDB, not TiDB.** backend/go/cmd/migrate/main.go databaseIsTiDB is always-false here, so trigger DDL applies and TiDB skips never trigger. All tuning assumes InnoDB semantics: clustered PKs, gap/next-key locks under REPEATABLE READ, single-writer buffer pool, GET_LOCK migrator.

Implication: every scaling win must come from **doing less work per request** (fewer statements, fewer locks, fewer bytes, fewer connections, fewer goroutines) inside the existing binaries + schema. There is no horizontal unit and no off-box cache. The plan exploits the one advantage this topology has: **with exactly one app process, all cross-instance coordination can be deleted and replaced with process memory**.

## 1. Goals, non-goals, honest ceiling

### Goals

- G1. Exam-day survival for **1M registered attempts per day in staggered waves** on one box + one MySQL.
- G2. Steady-state cost: **0 SQL on polls/heartbeats (cache hit), ~5 statements in 1 tx per batched autosave**, 0 SQL for auth on cache hit.
- G3. No answer-loss regression: V2 idempotency ledger, exact-replay, epoch fencing, receipt-first terminalization stay intact.
- G4. Every phase independently shippable behind env flags, rollback = config flip + redeploy.

### Non-goals

- 1M simultaneous persistent WebSocket connections on one box. Physically impossible (FDs, RAM for per-conn goroutines/buffers in backend/go/cmd/api/handlers_ws.go, TLS). Students move to short-poll; sockets stay proctor-only.
- 100k sustained write rps on one MySQL. Target sustained single-box throughput is **~5-15k write rps** (box-dependent); 1M users fit by staggering + batching, not simultaneity.
- Zero-downtime PK-type rewrites. Existing UUIDv4 PKs stay; only new hot keys are time-ordered.

### Capacity sketch (same box, tuned MySQL)

| Load | Today | After plan |
|---|---|---|
| 1M student sockets | capped 600 total (`CapTotal` in `internal/liveupdates/bus.go`), singleton-row admission tx | 0 student sockets (poll), ~10-20k proctor WS max |
| 67k heartbeats/s | 67k tx/s JSON read-modify-write (`RecordHeartbeat` in `internal/student/telemetry.go`) | ~0 SQL steady-state (memory + 60s flush) |
| 100k saves/s x ~10 stmts / 3 txs | >1M stmts/s | ~5 stmts / 1 tx + batching (up to 200/batch) + staggered windows |
| 1M bootstraps in minutes | 1M x full-tree N+1 (`LoadSections` in `internal/delivery/service.go`) | 1M x (1 attempt row + version-LRU hit), herd collapsed by singleflight + ETag/304 |
| Entry herd | ~10 stmts multi-tx per check-in, no gate | in-memory per-schedule bucket + idempotent replay + pre-created attempts |

## 2. Invariants that must NOT break (regression net)

- I1. V2 write contract (backend/go/internal/attempts/service.go saveInTx): attempt lock -> identity -> exact-replay -> lease/control fencing -> writability -> idempotency/version probes -> ledger INSERT -> projection upsert -> revision bump. Lock order attempt -> runtime -> section preserved wherever locks remain.
- I2. attempt_mutations_v2 UNIQUE (write_id) and UNIQUE (lease, question, version); student_attempt_mutations UNIQUE guard (`checkMutationUniquenessGuard` in `internal/platform/db/schema.go`, pinned by `schemaguard_test.go`).
- I3. Receipt-first terminalization (`internal/terminalization/service.go`, pinned by `seal_concurrency_test.go` + `seal_validate_test.go`): receipt PK on attempt, outcome-only replay, outbox row in-tx.
- I4. Middleware order in `BuildRouter` (`cmd/api/main.go`, pinned by `middleware_order_test.go`): recovery > request-id > trace > security > body-limit > auth > CSRF > rate-limit > authorization > handler > access-log. Session-failure still fails closed to 503 (never masquerades as anonymous).
- I5. Stable error envelope (httpx.WriteError + apperrors codes) and route-template low-cardinality logging. No raw IDs in keys/logs.
- I6. Migrator gate: GET_LOCK + lexical apply + VerifyRuntimeSchema before serve. Any new required column/index is added to schema.go RequiredColumns/Indexes in the same change.

## 3. Architecture before -> after (same boxes, same deploy)

Before (hot path per student request): cookie session SELECT + UPDATE touch (`LookupSession` in `internal/auth`) -> tier limiter pinned-conn UPSERT + SELECT (`DBRateLimiter.Check` in `ratelimit_fallback.go`) -> attempt_sessions SELECT (`VerifyAttemptToken` in `internal/auth`) -> business tx (attempt + runtime + section FOR UPDATE, blob rewrite) -> outbox INSERT -> (worker) claim UPDATE ... LIMIT -> live bus INSERT -> forwarder poll SELECT -> hub publish; WS via singleton-lease tx; heartbeat = full tx + JSON RMW + revision bump.

After: LRU session cache + write-behind touch -> local-only tier buckets (no DB) -> stateless HMAC verify (no DB) -> business tx (attempt-row only + row-per-question writes, RC) -> direct in-process Hub.Publish; presence/version/runtime served from memory; worker drains only executable outbox rows on its own pool; students poll versioned runtime, proctors keep WS.

New in-process components (stdlib-only, no new deps):

- sessionCache: LRU + TTL + write-behind flusher (replaces per-request touch).
- attemptVerifier: pure HMAC verify wrapper (thin; mostly deletion of DB call).
- admissionGate: per-schedule token buckets for entry + WS (replaces DB lease/counts).
- presenceMap: attempt -> last-seen + status, TTL heap, 60s batched DB flush.
- versionCache: versionID -> assembled delivery tree, LRU (50) + singleflight.
- runtimeCache: scheduleID -> runtime snapshot, ~1s TTL + singleflight.
- rollupCache/rollupRow: per-schedule proctor counters (DB row updated async, read path 1 row).

singleflight: implement ~60 lines in internal/platform/singleflight (stdlib sync only) to avoid adding golang.org/x/sync if not already vendored. Check go.mod first; use x/sync only if already a dependency.

## 4. Work plan by phase

Conventions per item: CURRENT (file:line) -> CHANGE -> SQL/config -> tests -> rollout/rollback -> metrics -> risks.

---

### Phase A - stop the per-request DB bleed (biggest saving, lowest risk)

#### A1. Local-only rate limiting (delete the per-request UPSERT+SELECT)

- CURRENT: `buildTierSet` in `cmd/api/main.go` attaches `NewDBRateLimiter(app.DB, tier, ...)` for every tier except backstop; `TierSet.Middleware` (`internal/platform/httpx/ratelimit_tiers.go`) runs local Allow then ALWAYS dbCheck. `DBRateLimiter.Check` (`ratelimit_fallback.go`) pins a pool Conn, does INSERT ... ON DUPLICATE KEY UPDATE request_count = LAST_INSERT_ID(...) + SELECT LAST_INSERT_ID(). Nearly every request pays 2 statements + holds a conn across 2 round trips, all hammering one PK minute-window per tier.
- CHANGE:
  1. Add env RATE_LIMIT_MODE=local|dual|db (default local after rollout; start dual for shadow-compare). In local, buildTierSet passes dbs = {} (same as today's nil-DB test path) so tiers enforce purely via BucketStore.
  2. Keep DBRateLimiter code but stop calling it in request path; optionally sample 1:1000 checks async for audit parity during migration, then remove sampling.
  3. Keep tier names/budgets/429 envelope/MRatelimitDeniedTotal labels unchanged. Keep TierBackstop as-is (already local-only).
  4. Raise local BucketStore cap (today RateLimitBucketCap default 10000/120) and size it: cap = max(configured, 4 x expected concurrent identities).
- SQL: none (distributed_rate_limit_counters becomes write-cold; retention keeps purging leftovers; do NOT drop the table - migrator/tests reference it).
- TESTS: existing ratelimit_tiers_test.go + ratelimit_fallback_test.go keep passing; add TestTierLocalOnlyParity (same request stream, local verdict == former dual verdict for allow/deny classes) and a burst test (10k keys, assert no DB calls via sqlmock).
- ROLLOUT: ship dual (behavior unchanged) -> flip one deploy to local, compare http_ratelimit_denied_total{tier} for 1h -> fleet-wide local. ROLLBACK: env flip to dual/db.
- METRICS: denied_total by tier (parity), p99 added latency on tier middleware (should drop ~1-3ms), db_pool_wait_count, distributed_rate_limit_counters insert rate -> ~0.
- RISKS: none functionally on single deploy (local IS global). Note in docs that re-adding a second deploy later requires revisiting this (flag exists for that).

#### A2. Session LRU + coalesced touch (kill the per-request UPDATE)

- CURRENT: `authMiddleware` (`cmd/api/main.go`) calls `auth.LookupSession` (`internal/auth`) = SELECT user_sessions JOIN users + unconditional UPDATE user_sessions SET last_seen_at, idle_timeout_at. Every poll/heartbeat pays a hot-row write; failures 503 the request.
- CHANGE:
  1. New internal/auth/sessioncache.go: SessionCache (LRU by token-hash, cap e.g. 150k entries, TTL = min(idle window, 60m)): Get returns cached session if expiresAt/idleTimeoutAt > now; Put on miss-after-DB-load; Invalidate(tokenHash) on logout/revoke; background flusher every 10s writes back at most one touch per session per SESSION_TOUCH_COALESCE_SECS (default 300).
  2. LookupSession gains fast path: cache hit + not-expired -> return (no SQL). Miss -> existing SELECT, then Put. Touch UPDATE only if now - lastFlushed > coalesce. Keep exact 401-vs-503 semantics: cache hit never 503s; DB error on miss still 503s.
  3. RevokeSession/RevokeAllSessions + logout handlers invalidate affected entries synchronously (revoke-all: iterate user's cached entries; keep a secondary index userID -> tokenHashes, bounded).
  4. Memory math: ~300 bytes/entry x 150k ~= 45MB. Cap via env SESSION_CACHE_MAX (default 150000) with LRU eviction (eviction only drops cache, never logs anyone out).
- SQL: UPDATE volume collapses ~60-600x depending on poll rate. No schema change.
- TESTS: authz_test.go-style unit + new sessioncache_test.go: expiry, revoke invalidation, coalesce bound (N Gets -> <=1 UPDATE), restart-cold-miss correctness.
- ROLLOUT: env SESSION_CACHE=off|on (default on after bake). ROLLBACK: off restores today's path exactly.
- METRICS: cache hit rate, touch UPDATEs/s, session-lookup p99, stale-session acceptance = 0 (test: revoked token rejected <= revoke-call + 0ms on same process).
- RISKS: process restart drops cache -> miss storm on DB (bounded by pool + admission gate; acceptable, document). Never cache negative/expired decisions beyond 5s.

#### A3. Stateless attempt-bearer verify (kill the per-request SELECT)

- CURRENT: `auth.VerifyAttemptToken` (`internal/auth`) verifies HMAC (`internal/platform/crypto`) then SELECTs attempt_sessions WHERE token_id (+ fallback SELECT for older schemas) and compares 6 fields + org/lease. Every delivery/V2 call pays this.
- CHANGE:
  1. Request path verifies HMAC + exp only via crypto.VerifyAttemptToken. Bind checks (schedule/attempt/user match) happen against values already loaded in the business tx (attempt row), not a second table: saveInTx already compares claims.ScheduleID/UserID to the locked attempt (`internal/attempts/service.go`) - keep that, delete the session-row lookup.
  2. IssueAttemptToken (`internal/auth`: upsert + re-SELECT canonical token) stays for issuance, but issuance happens once per check-in, not per request. attempt_sessions becomes append/audit: keep writing it (cheap, rare), stop reading it per request. Revocation = short TTL (keep 15m) + lease-epoch mismatch on next write (already enforced) + explicit revoke list checked only on bootstrap (rare) not on saves.
  3. Delete the two-SELECT fallback branch from the hot path; keep a VerifyAttemptTokenStrict (with DB) used only by bootstrap/entry flows and tests.
- SQL: -1 read per delivery/V2/heartbeat call. No schema change.
- TESTS: token unit tests (crypto_test.go) + handler tests asserting forged/expired/cross-attempt tokens still 401, lease-mismatch still fenced, replay still exact-replay.
- ROLLOUT: env ATTEMPT_VERIFY=strict|stateless (default stateless after bake). ROLLBACK: strict.
- METRICS: verify p99, attempt_sessions read rate -> ~0, auth-failure classes unchanged.
- RISKS: stolen bearer usable until exp (<=15m) - same as today between touches; documented, unchanged threat model. No new crypto (HMAC-SHA256 stays).

Phase A exit gate (k6): same 200-VU exam-day passes with >=50% fewer SQL statements/request (measure via slow-log sampling or pool stats), p99 bootstrap unchanged-or-better, zero auth-failure-class drift.

---

### Phase B - InnoDB locking + write amplification (the deadlock/mutex phase)

#### B1. Hot txs to READ COMMITTED

- CURRENT: `tx.Runner.WithTx` (`internal/platform/tx`) hardcodes REPEATABLE READ. Attempt saves, telemetry, V1 writes, terminalization all run RR: SELECT ... FOR UPDATE on secondary-index scans takes next-key/gap locks -> cohort-concurrency deadlocks, WithTxRetry then replays whole txs (more load). Only `outbox.ClaimBatch` (`internal/outbox`) and WS lease (`internal/liveupdates/bus.go`) use RC today.
- CHANGE:
  1. Add Runner.WithTxRC (RC variant; same tz discipline, same retry classifier). Route these callers to RC: V2 save (attempts), heartbeat flush path, V1 mutation batch, delivery module start/submit, outbox claim (already RC), lease paths (being deleted anyway).
  2. Keep RR for: terminalization seal, schedule/register/attempt mint, grading projection, migrations - anywhere code relies on a stable snapshot across multiple reads.
  3. Optionally set server transaction_isolation=READ-COMMITTED in my.cnf and keep explicit RR only where needed; either way, code is explicit per call site.
- SQL: none. Config: none (code-routed).
- TESTS: existing concurrency tests (attempts/concurrency_test.go, sat/concurrency_test.go, seal concurrency) must pass under -race -count=5; add a 200-goroutine same-schedule save contention test asserting no deadlocks and all acks applied-or-duplicate.
- ROLLOUT: code change, no flag (RC is strictly less locking; behavior preserved because all hot-path reads are point-gets + explicit FOR UPDATE where needed). ROLLBACK: redeploy previous build.
- METRICS: db_deadlocks_total -> near 0 on hot paths, MJobFailures{deadlock}, tx p99 on save path.
- RISKS: phantom-read exposure in long multi-read txs - audited per call site; seal path untouched.

#### B2. Remove runtime+section locks from the per-write path

- CURRENT: V2 saveInTx calls rl.Lock = exam_session_runtimes WHERE schedule_id FOR UPDATE (+ section row) on every save (`internal/runtime/service.go`, `internal/schedules/service.go` similar). One schedule = one global write queue. Proctor lockScheduleScope (`internal/runtime`) selects ALL attempt ids FOR UPDATE, serializing the whole cohort behind one admin click.
- CHANGE:
  1. New internal/runtime/snapshot.go: RuntimeCache (schedule -> {status, activeSection, revision, timingModel}, 1s TTL + singleflight). V2 save validates writability against the snapshot + client lease/control epochs; mismatch/stale-snapshot errors trigger exactly one synchronous refresh + retry, then fail with today's 422/409 codes.
  2. Keep FOR UPDATE runtime+section locking ONLY in: seal/terminalize, runtime commands (start/pause/resume/complete), reconcile-finalize. Student steady-state writes never lock them.
  3. Narrow lockScheduleScope: lock runtime + sections only, never SELECT ... all attempts FOR UPDATE. Attempt-scoped effects (auto-submit enqueue) become an outbox row + worker-side batched seal, not an in-request attempt sweep.
  4. EnsureActiveWriter pre-tx (delivery UPDATE + SELECT FOR UPDATE in its own tx) folds into the write tx as one SELECT active_client_session_id ... FOR UPDATE + conditional claim UPDATE.
- SQL: no schema change. Lock waits on exam_session_runtimes should collapse.
- TESTS: fence tests (runtime/fence_test.go) + new TestSaveAgainstStaleRuntimeSnapshot (pause races save -> 422, not lost write; resume -> save accepted); proctor-command-during-saves contention test.
- ROLLOUT: env RUNTIME_SNAPSHOT=off|on. ROLLBACK: off restores FOR UPDATE path.
- METRICS: performance_schema.data_lock_waits on runtimes table, save p99 under same-schedule fan-in, 422/409 rates (should be flat).
- RISKS: 1s-stale runtime view could accept a write ~1s past a pause boundary - mitigated by closing-grace semantics (ClosingGrace 30s already exists) + server closing_grace_until check staying in-tx on the attempt row (which IS locked). Document the 1s bound.

#### B3. Row-per-question becomes the write path; blobs become async materialization

- CURRENT: mergeProjection (`internal/attempts/service.go`) re-SELECTs and rewrites entire answers/writing_answers/flags JSON per answer: O(exam-size) bytes per keystroke, max redo/binlog, longest lock hold in the tx.
- CHANGE:
  1. Write path touches only: mutation probe -> version probe -> attempt_responses_v2 UPSERT -> attempt_mutations_v2 INSERT -> student_attempts narrow UPDATE (response_revision+1, updated_at, epochs only - no blob columns).
  2. Legacy blob columns become read-views materialized (a) lazily on reads that still need them, (b) by worker flush every N seconds for active attempts, (c) synchronously at seal time (correctness point). V1 readers (student/service.go GetSession/GetStatic) read through the materializer.
  3. Keep CanonicalJSON/hashing untouched (idempotency depends on it).
- SQL: no immediate schema change (columns stay); later migration may move blobs to a side table - explicitly out of scope for this phase.
- TESTS: projection-equivalence test (legacy blob == materialized from rows for randomized answer streams); V1/V2 mixed-read tests; seal-time materialization test.
- ROLLOUT: env ROW_FIRST_WRITES=off|on. ROLLBACK: off (old merge path kept, flagged dead-code until removal).
- METRICS: avg UPDATE bytes on student_attempts (should drop 10-100x), tx hold time p99, binlog bytes/s.
- RISKS: readers seeing briefly-stale blobs - bounded by flush interval; seal path always materializes synchronously so grading never sees staleness.

#### B4. Outbox: executable-only + partitioned claiming + pool split

- CURRENT: hot cycle (`runHotCycle` in `cmd/worker/main.go`) drains wakeup families through publishWakeup -> liveBus.Append INSERT per event, then MarkPublished; ClaimBatch (`internal/outbox`) does UPDATE ... ORDER BY created_at LIMIT ? (over-locks on InnoDB) with a single token; API and worker share one pool (`DBPoolMax` in `internal/platform/db`).
- CHANGE:
  1. Stop enqueuing wakeup families (attempt_terminalized, runtime_changed, roster_changed) for live purposes; publish directly to the in-process Hub after commit (Phase C). Keep enqueueing only auto_submit_schedule_attempts_requested (+ any future executable family). Worker publishWakeup path deleted.
  2. db.Open gains OpenN(cfg, role) or two pools from same DSN: poolAPI (e.g. 40) + poolWorker (e.g. 10). Wire API services to one, worker jobs to the other. Env: DB_POOL_MAX_API, DB_POOL_MAX_WORKER (fallback to DB_POOL_MAX_CONNECTIONS).
  3. Partitioned claiming: N in-process consumer goroutines (N = e.g. 4, env WORKER_CLAIM_PARTITIONS) each claim with AND MOD(CRC32(aggregate_id), N) = ? predicate (extra AND to the existing WHERE; index-friendly enough at these volumes) + smaller batches; evaluate SKIP LOCKED select-then-update variant behind OUTBOX_CLAIM_MODE=update|skiplocked.
  4. Auto-submit fan-out (`cmd/worker/main.go` unbounded SELECT id ... ORDER BY id + per-attempt seal loop) becomes cursor-batched (500/batch, WHERE id > ? ORDER BY id LIMIT) with progress logged; per-attempt provider lookup stays (indexed point-get).
- SQL: no schema change required; optional later index on (published_at, failed_at, next_attempt_at) if claim scan shows up in slow log.
- TESTS: outbox_test.go + new partition test (2 consumers, disjoint claims, no double-execute; seal idempotency under redelivery).
- ROLLOUT: flags OUTBOX_EXEC_ONLY, OUTBOX_CLAIM_MODE, pool envs. ROLLBACK: env flips.
- METRICS: MOutboxPending, MOutboxOldestAge, drain rate vs arrival, worker-vs-API pool waits separately.
- RISKS: changing claim SQL needs slow-log verification on prod-shaped data; keep LIMIT small until proven.

Phase B exit gate: same-schedule 500-way concurrent save test: zero deadlocks, p99 save latency down >=3x, student_attempts UPDATE bytes down >=10x, seal correctness suite green.

---

### Phase C - realtime without the database (single-process advantage)

#### C1. In-process live bus (delete poll + AppendInTx from hot paths)

- CURRENT: AppendInTx (`internal/liveupdates/bus.go`) INSERTs per business commit; startLiveBusForwarder (`cmd/api/handlers_ws.go`) polls PollNew every LiveUpdatePollIntervalMs (default 1000ms) with LIMIT 200; PurgeOlderThan deletes 1000/retention-cycle - insert rate at scale outruns purge.
- CHANGE:
  1. Hot paths call Hub.Publish(event) directly after commit (same call sites that call AppendInTx today). AppendInTx becomes a no-op wrapper (kept for signature compat) or is removed per call site.
  2. Delete the forwarder goroutine + LiveForwardOnce, LatestSequence startup MAX(), PollLimit/PollInterval hot usage. Keep the live_update_events table + PurgeOlderThan as an optional async debug sink (1:1000 sampled) or stop writing entirely behind LIVE_BUS_SINK=off|sample.
  3. Hub.Publish (`internal/liveupdates/bus.go`) holds RLock while iterating all subs + non-blocking send (drop + MWSSlowDisconnect). At proctor-only scale this is fine; add per-schedule subscription sets (map schedule -> subs) so publish is O(subs-of-schedule), not O(all-conns). Keep drop semantics (documented) + add last-revision cursor per schedule so reconnects resync via poll (Phase C3).
- SQL: live-bus INSERT/SELECT rate -> ~0. No schema change.
- TESTS: liveupdates/forward_test.go updated (in-process ordering); drop-counter test; schedule-fanout isolation test.
- ROLLOUT: LIVE_BUS=direct|db (default direct after bake). ROLLBACK: db.
- METRICS: publish-to-delivery lag (in-process: microseconds), drop rate, per-schedule sub counts.
- RISKS: none on single deploy (no peers to forward to). The origin <> own logic simply becomes unnecessary.

#### C2. In-memory WS admission (delete the singleton-row tx)

- CURRENT: LeaseRepository.Acquire (`internal/liveupdates/bus.go`): begin RC tx -> SELECT ... websocket_lease_admission_lock WHERE id=1 FOR UPDATE -> DELETE expired -> 3x COUNT(*) -> INSERT 60s lease. Every connect serializes globally; counts slow down as table grows. Caps 600/5/600 (`CapTotal/CapPerUser/CapPerSchedule`). Write pump ticks lease heartbeat every 30s (`cmd/api/handlers_ws.go`) = UPDATE per conn per 30s; read pump ties death to 60s TTL.
- CHANGE:
  1. New internal/liveupdates/admission.go: Admission{total atomic, perUser map, perSched map, ttlHeap} with mutex-sharded counters (e.g. 16 shards), Acquire(user, sched) -> (token, ok), Heartbeat(token), Release(token), background reaper (1s) expiring TTL entries. Same cap semantics, env-tunable: WS_CAP_TOTAL (e.g. 30000), WS_CAP_USER (5), WS_CAP_SCHEDULE (20000).
  2. `Acquire`/`Heartbeat`/`Release` in `cmd/api/handlers_ws.go` call the in-memory gate; delete DB lease calls. Keep CodeLeaseAcquireFailed 429 shape.
  3. Keep the websocket_connection_leases table (schema guard references it) but stop writing per-conn rows; retention purges leftovers.
- SQL: admission reads/writes -> 0.
- TESTS: cap tests (total/user/schedule), TTL expiry, heartbeat extension, concurrent-acquire race test.
- ROLLOUT: WS_ADMISSION=memory|db. ROLLBACK: db.
- METRICS: acquire latency p99 (should go ms -> microseconds), lease failures by reason, active conns gauge (already MWSConnections).
- RISKS: restart clears admission (safe direction: briefly permissive). Document.

#### C3. Students off sockets: versioned runtime poll (the 1M enabler)

- CURRENT: every student holds a WS (liveWebSocketHandler does session + liveAllowedScheduleIDs (2+ queries) + lease tx + upgrade + GetRuntime + full loadStudentRuntimeContext snapshot inline) with 2 goroutines/conn (write pump + read pump), 25s ping + 30s lease tickers each.
- CHANGE:
  1. New endpoint GET /api/v1/student/sessions/{scheduleID}/runtime?sinceRevision=N (Polling tier, attempt-bearer or session): returns 304 Not Modified when currentRevision == N, else {revision, status, activeSection, transitionsAt, pollAfterSecs}. Server computes pollAfterSecs adaptively: 20-30s steady-state, 2-5s within 60s of a known transition (server knows schedule plan).
  2. Clients: students poll this instead of WS; proctors/staff keep WS (add role=staff gate or separate proctor WS path; students attempting WS get 410 GONE + {use: runtime-poll} with a grace period behind STUDENT_WS=allow|gone).
  3. WS handler slim-down for remaining staff conns: single goroutine per conn (merge read/write loops), shared wheel timer for ping/TTL instead of per-conn tickers, raise read/write buffers modestly (4K/8K -> 16K), keep 64K read limit + origin check.
  4. Attempt-scoped events (warn/pause/extend/terminate) reach students via: runtime-poll revision bump (fast enough: <= poll interval) + enforcement on next write regardless (server-side gates already exist) - document the <=30s visibility bound + 2s fast-lane after control commands (server returns pollAfterSecs: 2 for 60s post-command).
- SQL: per poll = 0 on snapshot-hit (runtimeCache, Phase B2) or 1 indexed row read on miss; WS upgrade path (multi-query + tx) disappears for students.
- TESTS: poll contract tests (304/delta/revision monotonic), lastSeenRuntimeRevision parity with existing WS query param, staff-WS-kept test, student-WS-410 test, reconnect-resync test.
- ROLLOUT: dual-serve (WS + poll) -> clients migrate -> STUDENT_WS=gone. ROLLBACK: allow.
- METRICS: polls/s, 304 ratio (target >90% steady-state), runtime-poll p99, WS conns (should drop ~98%), missed-control-command visibility delay (synthetic probe).
- RISKS: needs frontend/client work; control-command visibility delayed up to poll interval (accepted + bounded + server-enforced on writes). This is THE behavior tradeoff to get stakeholder sign-off on.

Phase C exit gate: 20k concurrent staff-WS-capable conns OR 100k pollers simulated on one box; live-bus SQL rate ~0; WS acquire p99 <1ms; 304 ratio >90%.

---

### Phase D - content + entry + presence (exam-day shape)

#### D1. Immutable version cache (kill the bootstrap N+1)

- CURRENT: Bootstrap (`internal/delivery/service.go` reconcile tx -> `LoadSections`: 1 sections query + N loadModules each + M loadQuestions each) -> ensureBaseModuleAttempt -> module attempts + responses + control + timing queries. Every student re-reads immutable bytes. loadQuestions also runs deliveredAnswer JSON surgery per question per student.
- CHANGE:
  1. New internal/delivery/versioncache.go: VersionCache LRU (cap 50 versions, single-digit MB each worst case) storing fully-assembled []DeliverySection (post-deliveredAnswer, post-JSON-parse) keyed by versionID + content-hash; singleflight on miss so a 50k-student start wave = 1 DB load; TTL = infinite until publish bumps version (explicit Invalidate(versionID) in authoring publish path).
  2. Bootstrap becomes: attempt row + module attempts + responses + control + timing (per-attempt, indexed) + cache hit (shared, zero-copy read via sync.RWMutex + immutable value).
  3. HTTP: ETag: W/"v{versionID}-{contentHash}" on bootstrap/static payloads + If-None-Match -> 304. Client caches across reconnects.
  4. Keep ReconcileAttemptTimeout but add lock-light fast path: if no modules near expiry (deadline check against cached runtime), skip the reconcile tx (today it runs unconditionally at :213).
- SQL: per bootstrap from ~dozens of queries to ~5 indexed point/small-range reads.
- TESTS: cache-equivalence (cached tree == fresh tree byte-equal), publish-invalidation test, singleflight herd test (1000 concurrent bootstraps, 1 miss load), ETag/304 tests.
- ROLLOUT: VERSION_CACHE=off|on. ROLLBACK: off.
- METRICS: cache hit rate (target >99% during exam), bootstrap p50/p99 + bytes, LoadSections DB calls/s -> ~0 steady-state.
- RISKS: stale version after publish if invalidation missed - mitigated by versioning cache key on content-hash and verifying hash on publish commit (fail-closed to miss).

#### D2. Presence collapse (kill the per-beat tx)

- CURRENT: RecordHeartbeat (`internal/student/telemetry.go`): RR tx -> loadTelemetryAttempt ... FOR UPDATE -> authorizeTelemetryAttempt (may UPDATE user_id) -> ensureTelemetryClientSession (may UPDATE session claim) -> dedupe SELECT -> INSERT event -> JSON RMW integrity/recovery -> UPDATE attempt (revision+1). Per beat per student. RecordPrecheck/V1 paths share the shape.
- CHANGE:
  1. New internal/student/presence.go: PresenceMap (attempt -> {status, lastSeen, clientSession}, sharded mutex, TTL heap). Heartbeat handler becomes: stateless bearer verify -> presenceMap.Touch -> 200 {nextHeartbeatSecs} with NO SQL in the common case (dedupe by (attempt, mutationID) in a small in-memory ring for retry-safety).
  2. Flusher (60s): multi-row batched INSERT into student_heartbeat_events + conditional attempt integrity update ONLY when status changed (disconnect/lost/reconnect transitions), not per beat. Proctor liveness reads presenceMap (sub-ms), DB is the cold record.
  3. Prefer piggyback: autosave + runtime-poll responses carry presenceEcho + nextHeartbeatSecs; clients skip dedicated beats when they saved/polled within the window. Dedicated endpoint stays for idle students.
  4. Keep mutation_id dedupe semantics (in-memory ring + DB unique as backstop on flush).
- SQL: steady-state heartbeat SQL -> 0; flush = 1 multi-INSERT/min + rare integrity UPDATEs.
- TESTS: presence-visibility test (proctor sees beat within X), flush-correctness (events land exactly once across retries), status-transition test, superseded-session still 409.
- ROLLOUT: PRESENCE_MODE=inline|memory (default memory after bake). ROLLBACK: inline.
- METRICS: heartbeat SQL/s -> ~0, flush batch sizes, presence staleness (beat-to-visible p99), dedupe hits.
- RISKS: 60s DB staleness for presence analytics - acceptable (proctor view is memory-fresh); document for reporting consumers.

#### D3. Entry gate + idempotent provisioning (survive the check-in wave)

- CURRENT: studentEntryHandler (anon-auth tier, IP-keyed) does user lookup-or-INSERT -> CreateRegistration (schedule FOR UPDATE + registration FOR UPDATE + INSERT) -> CreateScheduleAttempt (schedule FOR UPDATE + registration FOR UPDATE + replay check + INSERT + deadline projection) -> IssueAttemptToken (upsert + re-SELECT) -> CreateSession (2-row tx). ~10 statements across 4 txs per check-in, all contending on the schedule row. STORM_ADMISSION_ENABLED defaults false and the DB queue table (0025) is not consulted by entry.
- CHANGE:
  1. In-memory per-schedule token bucket in entry handler (env ENTRY_PER_SEC_PER_SCHEDULE, default e.g. 500, burst ENTRY_BURST, e.g. 2000): over-limit -> 429 {retryAfterSecs, queuePosition} (reuse CodeRateLimitExceeded envelope + tier detail), NOT a DB conflict storm. Bucket state also feeds Retry-After honesty.
  2. Keep the existing idempotent replay (registration lock + attempt-by-registration replay in `internal/schedules/service.go`) as the correctness backstop; add unique-key-first fast path: attempt-by-(schedule,user) lookup before mint tx to turn retries into 1 SELECT.
  3. Pre-provisioning: admin/ops script (or authoring action) mints attempts for rostered (schedule,user) pairs ahead of exam day; entry then degrades to token+session issuance only. No schema change (uses existing tables).
  4. Ops: staggered check-in windows per cohort chunk communicated to students (e.g. 50k per 5-min window); gate enforces it. K6 exam-day scenario extended to 5k+ VUs against entry specifically.
- SQL: per admitted check-in unchanged (~10 stmts) but arrival rate capped; retries collapse to ~1 SELECT.
- TESTS: gate test (over-limit 429 with honest Retry-After), double-submit idempotency (same user -> same attempt, no dup), pre-provisioned fast-path test, replay-after-partial-failure test.
- ROLLOUT: ENTRY_GATE=off|on + rate envs. ROLLBACK: off.
- METRICS: entry admit rate, 429-with-position rate, entry p50/p99, duplicate-attempt count = 0, schedule-row lock waits during wave.
- RISKS: legitimate users see 429 during peaks - by design; messaging + position + honest Retry-After make it a queue, not an outage. Stakeholder sign-off needed on window sizing.

#### D4. Proctor roster pagination + rollup (stop selecting the cohort)

- CURRENT: loadStudentSessions (proctor/sessions.go) selects ALL attempts of a schedule with correlated active-module subquery per row + Go-side JSON parse, ORDER BY updated_at DESC. Dashboard polls this every few seconds per proctor.
- CHANGE:
  1. Paginated roster API: cursor (updated_at,id) + limit (e.g. 200), filter by status; keep existing shape per row.
  2. schedule_proctor_rollups (new small table OR reuse shared_cache_entries row per schedule - prefer existing table, no migration): {scheduleID, countsByStatus, updatedAt, revision} updated async every 5s by worker from a single GROUP BY query. Dashboard header polls the 1-row rollup; roster pages on demand.
  3. Roster-changed bump: rollup revision increments publish to Hub (in-process) so proctor WS clients refresh only on change instead of polling blind.
- SQL: per dashboard poll from full-cohort scan to 1 PK get (+ occasional page).
- TESTS: pagination-correctness (no gaps/dups under concurrent updates), rollup-accuracy bounds test.
- ROLLOUT: additive endpoints + worker job flag ROLLUP=off|on. ROLLBACK: clients fall back to old endpoint (keep it, paginated-by-default with a high cap).
- METRICS: roster query p99 + rows-scanned, rollup lag (target <10s), dashboard poll rate.
- RISKS: rollup staleness (bounded, displayed as "updated Xs ago").

Phase D exit gate: k6 entry-wave (5k VUs) with zero duplicate attempts, bootstrap p99 <2s at 2k concurrent, heartbeat SQL ~0, dashboard poll = 1 row.

---

### Phase E - own-MySQL hardening + shedding + proof (no new boxes)

#### E1. MySQL + pool + retention tuning

- my.cnf (values scaled to box; examples for 16GB box): innodb_buffer_pool_size=10G (~60-70% RAM); innodb_flush_log_at_trx_commit=1, sync_binlog=1 (exam durability; do NOT relax); max_connections=250; innodb_lock_wait_timeout=8; transaction_isolation=READ-COMMITTED (with RR kept explicit where needed per B1); slow_query_log=ON, long_query_time=0.2, performance_schema=ON; binlog_expire_logs_seconds per PITR policy; nightly mysqldump/XtraBackup + tested restore (scripts/backup-rehearsal.sh).
- db.go Open: two pools (API 40 / worker 10, env DB_POOL_MAX_API/DB_POOL_MAX_WORKER, fallback DB_POOL_MAX_CONNECTIONS); ConnMaxLifetime 5-25min, ConnMaxIdleTime 1-5min; add per-query timeouts (context.WithTimeout) on poll/bootstrap/roster paths (5-10s).
- Retention (worker slow cycle, maintenance): purge cadence up (outbox published, heartbeat events, rate-counter leftovers, live-bus sink if kept) with small bounded batches OUTSIDE exam windows; never mega-DELETE ... LIMIT during exams (lock + replication-lag spike on single writer). Add covering indexes only for surviving hot point-gets (verify via slow log, not guesswork).
- New hot keys time-ordered (UUIDv7) going forward; existing UUIDv4 PKs untouched.

#### E2. Load shedding order + exam-window policy

- Priority (drop from the bottom): submit/seal > autosave > bootstrap > runtime-poll > heartbeat > proctor-list > admin/authoring/grading. Implement as tier-budget rebalancing under pressure (env SHED_MODE=off|exam: raises submit/write budgets, crushes heartbeat/poll/admin budgets) + entry-gate tightening. Submits NEVER shed.
- Frozen-deploys + migration-freeze windows around exams; BACKGROUND_RUNTIME_MODE + worker intervals left at continuous (single deploy must keep auto-submit/projection alive in every mode - already the Dockerfile contract).
- Backpressure honesty: every 429 carries retryAfterSecs + queue position where applicable; clients honor it (client work item).

#### E3. Proof: load tests + dashboards + game day

- k6: extend prod-exam-day.js + submit-storm to: entry-wave 5k VUs, bootstrap herd 2k concurrent (assert singleflight collapse via DB-call counter), 500-way same-schedule save contention (assert zero deadlocks), poller simulation (100k pollers at 20s interval = 5k rps, assert >90% 304), WS staff-only soak.
- Dashboards (existing Prometheus registry + telemetry.*): per-endpoint p50/p99 + SQL-per-request (pool stats + slow-log sampling), deadlock rate, outbox pending/oldest-age (already MOutboxPending/OldestAge), drop rate, cache hit rates (session/version/runtime/presence), entry admit/429 rates, bootstrap bytes, pool waits split API/worker.
- Game day: full exam-day rehearsal on prod-shaped data (100k+ attempts), chaos items (process restart mid-exam -> cache-cold behavior; MySQL slow-disk 2x; submit storm at deadline), rollback drill (every new flag flipped off).

## 5. Flags, config, rollout matrix (complete)

| Flag | Default (ship) | Rolled-out | File |
|---|---|---|---|
| RATE_LIMIT_MODE=dual/local | dual | local | cmd/api/main.go buildTierSet |
| SESSION_CACHE=off/on, SESSION_CACHE_MAX, SESSION_TOUCH_COALESCE_SECS | off | on | auth/*, main.go authMiddleware |
| ATTEMPT_VERIFY=strict/stateless | strict | stateless | auth.go, attempts/* |
| RUNTIME_SNAPSHOT=off/on | off | on | runtime/*, attempts/*, handlers_v2.go v2Locker |
| ROW_FIRST_WRITES=off/on | off | on | attempts/mergeProjection |
| OUTBOX_EXEC_ONLY=off/on, OUTBOX_CLAIM_MODE=update/skiplocked, WORKER_CLAIM_PARTITIONS | off/update/1 | on/skiplocked/4 | worker/main.go, outbox/* |
| DB_POOL_MAX_API, DB_POOL_MAX_WORKER | fallback 20 | 40/10 | platform/db/db.go, both mains |
| LIVE_BUS=direct/db, LIVE_BUS_SINK=off/sample | db | direct | liveupdates/*, handlers_ws.go, worker |
| WS_ADMISSION=memory/db, WS_CAP_* | db | memory | liveupdates/admission.go (new) |
| STUDENT_WS=allow/gone | allow | gone (post-client) | handlers_ws.go |
| VERSION_CACHE=off/on | off | on | delivery/versioncache.go (new) |
| PRESENCE_MODE=inline/memory | inline | memory | student/presence.go (new) |
| ENTRY_GATE=off/on, ENTRY_PER_SEC_PER_SCHEDULE, ENTRY_BURST | off | on | handlers_v2.go studentEntryHandler |
| ROLLUP=off/on | off | on | proctor rollup job + handlers |
| SHED_MODE=off/exam | off | exam (windows) | tier budgets + entry gate |

Each flag: exact rollback = flip + redeploy (single deploy, ~minutes). No flag requires a migration to roll back (schema additions are additive; code tolerates absent-or-present).

## 6. Client/frontend contract changes (required)

- C1. Runtime poll replaces student WS: GET .../runtime?sinceRevision= with 304 handling + pollAfterSecs honoring (20-30s idle, 2-5s near transitions). (Phase C3)
- C2. Autosave batching: 15-30s interval, batch up to 200 mutations, beacon-on-unload, honor 429 retryAfterSecs with jitter (never tight-retry). (Phase B3/D3)
- C3. Entry queue UX: 429-with-position rendering + countdown + auto-retry at Retry-After. (Phase D3)
- C4. Bootstrap caching: persist version payload by ETag across reconnects; send If-None-Match. (Phase D1)
- C5. Presence: skip dedicated beats within nextHeartbeatSecs of any save/poll (server echoes presence state). (Phase D2)

## 7. What to measure before writing code (2-hour baseline)

1. Slow-log top-20 by total time on prod-shaped load (expect: session touch UPDATE, limiter upsert, attempt_sessions SELECT, runtime FOR UPDATE, heartbeat tx, bootstrap N+1).
2. performance_schema.data_lock_waits summary by table (expect: runtimes, attempts, registrations during waves).
3. Deadlock rate + victims (SHOW ENGINE INNODB STATUS sampling + db_deadlocks_total).
4. Pool waits split (API vs worker - currently shared, so measure combined as baseline).
5. k6 200-VU exam-day as control; record statements/request via general_log sampling (brief!) or proxy counting.

## 8. Effort + sequencing recommendation

- A1 (limiter): S. A2 (session cache): M (careful invalidation). A3 (stateless verify): S-M.
- B1 (RC): S + heavy testing. B2 (runtime snapshot): M (correctness-critical). B3 (row-first): M-L (touches V1 readers). B4 (outbox/pools): M.
- C1/C2 (bus/admission): S-M (mostly deletion). C3 (poll + client): M-L + client team.
- D1 (version cache): M. D2 (presence): M. D3 (entry): S-M + ops. D4 (rollup): S-M.
- E: ongoing ops + k6 + dashboards.

Recommended build order: A1 -> A2 -> A3 -> B1 -> C1 -> C2 -> B2 -> B4 -> D1 -> D2 -> D3 -> C3 (client-gated, can parallelize early) -> B3 -> D4 -> E. Each item shippable alone; C3 is the only one requiring coordinated client release.

## 9. Open questions for you (answer when ready, build starts regardless with defaults)

1. Box size (CPU/RAM/disk) for the single Railway service + MySQL box size - sets pool sizes, LRU caps, flush intervals, bucket rates above.
2. MySQL version + my.cnf access (can we set buffer pool / isolation / slow log?) and backup/PITR story.
3. Exam-day shape: max attempts per single schedule (cohort size), check-in window minutes, exam duration - sets bucket rates + stagger math.
4. Client release cadence (for C3 poll migration + C2/C5 heartbeat behavior) - sets whether STUDENT_WS grace period is weeks or days.
5. Which V1 readers must stay byte-identical during B3 (list consumers of answers/flags blobs) - sets materialization scope.
