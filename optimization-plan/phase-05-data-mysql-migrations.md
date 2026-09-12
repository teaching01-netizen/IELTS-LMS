# Phase 05 — MySQL tuning, migrations & restore

**Phase file:** `optimization-plan/phase-05-data-mysql-migrations.md`
**Source work packages:** WP11 (MySQL query / index / transaction / pool tuning), WP12 (migration safety, retention, backups, restore).
**Owner:** database / operations owner — SOLE AUTHORITY on migration filenames + DDL text, index definitions, pool-size tuning, retention predicates, backup/restore procedures while this phase is active.
**Wave:** B-prep (WP12 restore-prep starts with Phase 01, runs alongside Wave B) + C (WP11 tuning runs only after query-shape freeze + WP10 evidence).
**Depends on:** Phases 01–04 query-shape freeze + WP10 measurement evidence for WP11; WP00 baseline for WP12-prep. WP12 gates EVERY schema-changing phase (02/04/05 and any DDL anywhere).
**Planning only:** this file authorizes no production DDL, no data repair/deletion, no backup-credential access, no production load. Destructive ops need a separate safety approval even after this plan is accepted.

---

## 1. Objective

Make the database fast enough for the frozen C09 workload AND recoverable when anything goes wrong — without weakening any invariant from Phases 01–04.

Concretely, on exit this phase must have:

1. **Ranked, measured hot-query evidence** (response batches, bootstrap, runtime/auth reads, rosters, grading queues, job claims, retention sweeps) with before/after plans and throughput on prod-like data — meeting C09 without breaking AC03/AC09/AC10/AC16, introducing no unbounded memory/backlog behavior (I12).
2. **The smallest reversible tuning set**: N+1 + payload-trim fixes first, then composite-index candidates validated against predicate/ordering/cursor/write-amplification, then short deterministic transactions with per-guarantee isolation, then API/worker pool tuning against DB capacity and lock waits. No guessed DDL, no universal isolation switch, no concurrency-as-remedy.
3. **A migration line that cannot corrupt history**: head recorded from live lineage (currently `0058_authoring_operation_keys.sql`, 58 files, max 0058 — re-verify, never blind-next-number), centrally allocated filenames, crash-retry-safe guarded DDL, expand/contract discipline, backfill/dedup with winner semantics + dry-run/audit/backup/reconciliation.
4. **Retention that protects evidence** (replay, grading, terminal, incident) with bounded off-peak batches, plus approved RPO/RTO, access-controlled backups, and a **disposable-target restore rehearsal that validates answers/receipts/results/media/replay through the app** — not just a successful import.
5. **A documented rollback matrix** (binary rollback vs forward repair vs full restore) that never promises SQL rollback for nontransactional DDL.
6. **A clean handoff to Phase 07**: frozen schema candidate + evidence ledger Phase 07 consumes for integrated fault/capacity/recovery rehearsal (WP14).

Out-of-scope drift, semantic changes, app retry logic, CI jobs, and integrated load all belong elsewhere (section 2) — this phase tunes and protects persistence, nothing more.

---

## 2. Scope / out of scope

### 2.1 In scope (WP11 + WP12 verbatim, expanded to file level)

**WP11 — query / index / transaction / pool tuning** (owner: database owner; deps: stable query shapes from WP02/WP04/WP05/WP06/WP07 + WP10 evidence; WP12 for DDL):

- [ ] Rank hot queries: response batches, bootstrap, runtime/auth reads, rosters, grading queues, job claims, retention. (7.1)
- [ ] Inspect actual plans and cardinalities. Use EXPLAIN ANALYZE only where executing the query is safe. (7.2)
- [ ] Remove N+1 reads and excessive payloads before indiscriminate caching/index additions. (7.3)
- [ ] Test candidate composite indexes against predicate, ordering, cursor semantics, write amplification; remove none without usage/compatibility evidence. (7.4)
- [ ] Preserve unique identity/replay/fencing constraints and stable keyset pagination. (7.5)
- [ ] Keep transactions short, deterministic, free of external calls; per-guarantee isolation, not a universal RC switch. (7.6)
- [ ] Tune API and worker pools against DB capacity and lock waits. Increased concurrency is not a remedy for saturation. (7.7)
- [ ] Reduce hot-path whole-attempt rewrites only when row-first semantics + terminal materialization are proven. (7.8)
- [ ] Revalidate every plan on production-like data size/distribution; never hardcode index DDL from guessed columns. (7.9)

**WP12 — migration safety, retention, backups, restore** (owner: database/operations owner; deps: WP00; applies as prerequisite to ALL schema mutations):

- [ ] Record current migration head and allocate new filenames centrally; 0058 is history, not an instruction to use 0059 blindly. (7.10)
- [ ] Test fresh install, representative existing-DB upgrade, interrupted rerun, old/new app compatibility. (7.11)
- [ ] Account for DDL implicit commits, metadata-lock duration, table size, online-operation support, available disk. (7.12)
- [ ] Prefer expand/contract; defer contraction until rollback/consumer window closes. (7.13)
- [ ] Dedup/backfill has approved winner semantics, dry-run counts, audit output, backup, reconciliation. Keep-earliest is not universal truth. (7.14)
- [ ] Protect replay/grading/terminal/incident evidence from premature retention cleanup; bounded batches outside exam peaks. (7.15)
- [ ] Establish approved RPO/RTO + backup access controls. Restore to disposable target, validate schema, boot services, verify representative answers/receipts/results/media/replay. (7.16)
- [ ] Document binary-rollback vs forward-repair vs full-restore. No SQL-rollback promises for nontransactional DDL. (7.17)

### 2.2 Out of scope (with owning phase)

| Excluded | Owner who does it | Boundary |
|---|---|---|
| Changing query SEMANTICS (what rows mean, resolver precedence, fencing rules) | Phases 02/04 (integrity/worker), 06-server owners | Phase 05 may rephrase SQL for plan shape only; any semantic change is rejected and handed back with the EXPLAIN + failing-behavior note |
| App-level retry logic (who retries, budgets, jitter, envelopes — C07) | Phase 04 (contract/API), Phase 02 (worker retry ownership) | Phase 05 owns only txn-retry CLASSIFIER input (which errors are transient) + pool/timeout sizing; retry policy text lives in owning phases |
| CI jobs, gates, fixtures infra | Phase 06 (operations/test) | Phase 05 SHIPS migration/restore/perf test files; Phase 06 WIRES them into pipelines |
| Integrated load (arrival wave, submit storm, recovery) | Phase 07 (L0 integration, consumes Phase 05 evidence) | Phase 05 produces repeatable single-query + single-pool evidence on prod-like data; Phase 07 runs the storm |
| Frontend state, caching policy, UX | Phase 03 | Phase 05 never changes client storage or poll cadence; it measures SQL-per-poll as input |
| Scoring/grading/admission business rules, compliance certification | Product authority, never this plan alone | Any tuning that would change a score, grade permission, or admission decision is blocked |

---

## 3. Dependencies

### 3.1 Query-shape freeze inputs (WP11 cannot start tuning without these)

WP11 tunes **frozen shapes**, never a moving target. Each input is a named artifact from its owning phase:

| Input | Producing phase | Frozen artifact Phase 05 consumes | Why it gates tuning |
|---|---|---|---|
| Response write path (batch upsert, mutation ledger, V2 write/version uniques) | Phase 02 (WP02) | C02 durable-write contract version + exact SQL text of batch path + row-first vs whole-attempt decision | Index choice on `attempt_mutations_v2`, `attempt_responses_v2`, legacy `student_attempt_mutations` depends on which path is authoritative; tuning both wastes write amplification |
| Terminalization + job/outbox SQL (seal txn, claim/mark/purge, SAT repair, DLQ requeue) | Phase 02 (WP04) | C06 work-ownership contract version + exact claim SQL + txn boundary proof (receipt + terminal projection + scoring snapshot + audit + enqueue atomicity) | Claim pattern (UPDATE-LIMIT vs SKIP LOCKED, partitions) and seal isolation (RR, never RC) are load-bearing; pool/index changes must not break AC09/AC10/AC11 |
| Auth/session/attempt-verify reads (session lookup, attempt verify, revocation) | Phase 04 (WP05) | C04 authorization/cache contract version + session-cache mode + revocation propagation bound | Auth reads run on EVERY request; cache-vs-SQL split decides whether an index matters at all — measure cache-hit SQL-per-request first |
| Bootstrap / delivery / conditional-read shapes (POST vs GET, ETag, version pin) | Phase 04 (WP06) | C05 + openapi contract version + bootstrap statement-budget test | Bootstrap is the join-storm risk (admission queue, version cache); index must match the frozen predicate, not a guessed column |
| Runtime poll / roster / session-runtime shapes (poll SQL count, roster GROUP BY, runtime FOR UPDATE chains) | Phase 04 (WP07) | C05 freshness bound + poll-SQL inventory + process-boundary doc | Poll runs at cadence x attempts; N+1 here dominates exam-window load; roster aggregation + FOR UPDATE lock chains dominate lock waits |
| C09 workload/SLO profile | Phase 01 (frozen), calibrated by Phase 06 (WP10) | C09 version: concurrent attempts, arrival rate, write cadence, section transitions, submit-storm size, proctor subscriptions, media sizes, device/network profiles, flags, resource limits | Every perf claim is scoped to this profile; no extrapolation from registrations/day |

**Freeze rule:** if any owning phase changes a query shape after Phase 05 measured it, the affected 7.1–7.9 steps re-run for that shape. Phase 05 never edits service SQL semantics to make the plan nicer — it returns the shape + plan evidence to the owning phase.

### 3.2 Evidence inputs (WP10 to WP11)

From Phase 06 (WP10) / Phase 01 baseline (WP00), Phase 05 requires before touching DDL or pools:

- Baseline latency ledger: entry, bootstrap, write-ack, terminal receipt, roster, grading, export (p50/p95/p99 + distribution, not single means).
- SQL inventory per operation: statement count, rows examined vs rows returned, lock-wait time, pool-wait time, response bytes (from telemetry + slow-query log + performance_schema statement digests).
- Worker queue age, retry counts, DLQ age, saturation signals.
- Resource fingerprint of the measurement rig: MySQL version (SELECT VERSION()), instance CPU/RAM/disk/IOPS, pool settings, dataset size/distribution, config fingerprint, schema version (schema_migrations MAX), lockfiles.
- C09 calibration runs proving the load generator itself is not the bottleneck.

No evidence means no DDL. A slow query without its plan, cardinality, and workload context is a hypothesis, not a finding (freeze/review/repair protocol: reproduce/benchmark before editing).

### 3.3 WP12-as-prerequisite-to-all-DDL rule

> **WP12 creates and proves recovery procedures early. Every schema-changing package depends on its relevant migration/restore gate before applying DDL.** (overall-plan section 6 / optimize.md section 5)

Operational meaning for this phase:

1. **WP12-prep starts with Phase 01 (Wave B-prep).** As soon as WP00 baseline exists, the database owner records the migration head, verifies the lineage test passes, rehearses backup-to-disposable-restore on the CURRENT schema, and documents draft RPO/RTO + access controls — before any Phase 02/04/05 DDL exists to protect. This prep never blocks Phases 02/03/04 read work; it blocks only DDL application.
2. **No phase applies DDL without passing its 7.11 schema-candidate gate** (fresh install + existing upgrade + interrupted rerun + old/new compat) on a disposable database first. Phase 05 owns that gate procedure; each schema-changing phase invokes it.
3. **Phase 05 tuning DDL (WP11 indexes) goes through the same gate as product DDL.** An index is a schema change: guarded online CREATE INDEX (0017 idiom), metadata-lock/disk accounting (7.12), expand/contract if it renames or replaces (7.13), rollback matrix entry (7.17).
4. **Emergency brake:** if backup/restore is unproven, RPO/RTO unapproved, or disk/lock budget unmet, Phase 05 aborts the DDL (see 11.4) and ships the finding as BLOCKING to Phase 07 — never tune now, rehearse later.

## 4. Affected files (rediscover before editing — paths below are starting points from the current tree, not frozen claims)

The database owner re-runs directory listing + symbol search at phase start; if a path moved, the phase updates this table and proceeds. Ownership while active: database owner for ALL rows below when the edit is DDL/index/pool/retention/restore; service-SQL text edits are proposed by the database owner and merged only with the owning service phase sign-off (single-mutation-owner rule).

### 4.1 Connection pools, timeouts, telemetry (tune, never guess)

| File | Current shape (verify) | Phase 05 action |
|---|---|---|
| backend/go/internal/platform/db/db.go | Open / OpenRole(api/worker) from one DSN; newPool sets MaxOpen/MaxIdle, 25m lifetime, 5m idle; UTC session discipline; ReportPoolStats(role, st) to pool gauges | Tune DB_POOL_MAX_API / DB_POOL_MAX_WORKER / DB_POOL_MAX_IDLE from 7.7 evidence; keep role split; keep UTC discipline; no new pool infra |
| backend/go/internal/platform/config/config.go | DBPoolMax(API/Worker/Idle), WorkerClaimPartitions, validation pool/partition tunables must be positive | Change only defaults/bounds with capacity proof; validation stays fail-closed |
| backend/go/internal/platform/db/poolstats_test.go, poolsplit_test.go | Role-sizing assertions without live DB | Extend with saturation-regression tests (13.5) |
| backend/go/cmd/api/query_timeout.go | DefaultQueryTimeout=10s, withQueryTimeout, QueryContext, MapDBError (deadline to 503) | Calibrate per-route budgets from 7.1 latency distribution; NEVER raise a timeout to hide a slow plan — fix the plan or bound the payload first |
| backend/go/cmd/api/main.go, backend/go/cmd/worker/main.go | API uses OpenRole(api), worker OpenRole(worker); retry-hook to deadlock counters; worker hot/slow cycles | Wire pool-stat emission intervals only; no orchestration changes (worker owner) |
| backend/go/internal/platform/telemetry/ | Pool/query-duration/deadlock counters | Add ONLY: per-query rows-examined/rows-returned + lock-wait + pool-wait gauges with bounded labels (no IDs in labels — I11); every new alert gets owner + threshold rationale + runbook + fire-test (WP10 rule) |

### 4.2 Transaction boundaries (discipline, not a switch)

| File | Current shape (verify) | Phase 05 action |
|---|---|---|
| backend/go/internal/platform/tx/tx.go | WithTx (RR) default; WithTxRC/WithTxRCRetry (RC) for hot point-write paths with PK/unique + FOR UPDATE justification comment; bounded transient retry (deadlock/lock-wait/conn-transient) with jitter; retryHook | AUDIT every caller isolation choice per 7.6; move a caller between RR/RC only with its guarantee proof + owning-phase sign-off; never a universal RC migration; keep txns short, deterministic, external-call-free |
| backend/go/internal/platform/tx/tx_isolation_test.go, retry_metric_test.go | Isolation-level capture, deadlock-replay-once, no-retry-on-business-error | Extend with per-guarantee matrix tests (13.6); keep sqlmock posture |
| Service txn call sites (attempts/submit.go, terminalization, delivery, proctor, media/service.go, accesslinks/service.go, outbox) | Mixed WithTx / WithTxRC(Retry); SELECT FOR UPDATE chains on attempts/runtimes/links/assets | Phase 05 READS these shapes for the hot-query ledger; semantic moves belong to owning phases; Phase 05 may propose lock-order / split-txn refactors as reviewed diffs |

### 4.3 Service queries under measurement (read-first; owning phase edits semantics)

| Hot family | Representative SQL / file (verify exact text) | Tuning lever owned here |
|---|---|---|
| Response batch write + replay | attempt_mutations_v2 write-id/version uniques, attempt_responses_v2 lease/version reads, student_attempts.response_revision, legacy student_attempt_mutations / answers/writing_answers/flags whole-row reads (internal/attempts, materialize.go) | N+1/payload-trim proposal, composite index on frozen predicate, row-first proof before whole-attempt-rewrite reduction (7.8) |
| Bootstrap / delivery | internal/delivery/service.go, versioncache.go, bootstrap_statement_budget_test.go, admission-queue / join-storm paths (migrations 0017/0018/0025 context) | Statement-budget enforcement, version-cache key scoping, predicate-matched indexes |
| Runtime poll / presence | cmd/api/handlers_runtime_poll.go, auth/sessionlookup_cache_impl.go, auth/attemptverify_read.go, student/readthrough.go, heartbeat mutation_id paths | SQL-per-poll inventory (auth touch included); cache-key scoping; heartbeat/probe index validation |
| Rosters / rollups | proctor/rollup.go (GROUP BY delivery_status), sessions.go (IN-batch reads, outbox-guide counts, attempt counts), accesslinks/service.go (started/submitted_count correlated subqueries) | Keyset-pagination preservation, correlated-subquery to batched-read proposals, composite covering indexes |
| Grading queues / projection | grading/projection.go, sessions.go, result_read.go, review_read.go, maintenance/jobs.go projection checkpoint (shared_cache_entries:grading_projection_state_v1) | Queue-claim ordering index, projection batch/watermark tuning (with worker owner) |
| Job claims / outbox drain | internal/outbox/outbox.go ClaimBatch: update (single UPDATE ORDER BY LIMIT) vs skiplocked (SELECT FOR UPDATE SKIP LOCKED + update-by-id), WithClaim partitions MOD(CRC32(aggregate_id),N)=i, 20x100 drain, 60s lease, backoff 5s-2n-1 max 300s, terminal >=8 | Claim-mode + partition + lease evidence under multi-consumer load; exactly the 8.2 pattern |
| Retention / media sweeps | internal/maintenance/jobs.go RunRetention (10-table bounded deletes, batch 1000, grace/budget scaling) + RunMedia (pending-to-orphaned-to-delete, batch 1000) | Predicate-matched sweep indexes, off-peak scheduling, evidence-protection predicates (7.15) — never widen a DELETE without 7.14 |

### 4.4 Migrations + lineage (database owner is sole filename/DDL authority)

| File | Current shape (verify at phase start) | Phase 05 action |
|---|---|---|
| backend/go/migrations/*.sql (0001–0058; head 0058_authoring_operation_keys.sql; ledger schema_migrations(filename PK)) | 58 files, max 0058, no gaps, MIGRATION_POLICY.md sections 0–7 guard idioms, README.md lineage probes | Record live head (SELECT COUNT/MIN/MAX FROM schema_migrations + dir listing); allocate next numbers centrally; author new DDL per 7.10–7.14; update README.md lineage + probes; bump lineage_test.go pins iff a file lands |
| backend/go/cmd/migrate/main.go | GET_LOCK 300s, history create + legacy-guard fail-closed, quote-aware split, per-file record-after-success, checksum-verify-if-versions-table-exists, VerifyRuntimeSchema gate, --validate-only | Add ONLY the short MySQL 8.0.16 version gate snippet (policy section 5, with semver-tuple compare + matrix test) if not yet landed; otherwise close with evidence. No apply-path redesign (WS-12 forbids) |
| backend/go/cmd/migrate/MIGRATION_POLICY.md | Additive rule, backup-table+row-count-guard, heuristic-heal, CHECK-swap (0046 reference), big-ALTER exam-day policy, version floor, guard idioms, crash-retry+dirty-data test rule | Normative authoring standard for every new file; extend only with database-owner review |
| backend/go/cmd/migrate/lineage_test.go | Pins pinnedMigrationFiles=58, pinnedMigrationMax=58, reservedSequences empty, gap/duplicate/convention checks | Bump pins + clear reservations exactly when a file lands; add reservation entries for in-flight lanes while active |
| backend/go/cmd/migrate/repair_0057_test.go, engine_gate_test.go, receipt_immutability_test.go | Static guard audit + DSN-gated crash-retry/dirty-data reference (0057) | Copy the two-test pattern for every repair/guard migration (7.11, 13.8) |
| backend/go/internal/platform/db/schema.go | RequiredTables (incl. authoring_operation_keys), 19 RequiredColumns, 9 RequiredIndexes, VerifyRuntimeSchema fail-closed startup gate | Extend required-lists iff new runtime-critical objects land; startup must still refuse half-migrated DBs |
| backend/go/internal/platform/pagination/pagination.go | Keyset Cursor(limit 1..500) + offset Page(pageSize 1..200), opaque cursor strings, CursorPage envelope | Preserve keyset semantics in every index change (7.5); no pagination rewrites here |

### 4.5 Rehearsal scripts / runbooks (proposed paths — create, never improvise in prod)

| Path (proposed unless noted) | Status | Purpose |
|---|---|---|
| scripts/backup-rehearsal.sh | EXISTS (verify contents at phase start) | Nightly logical-backup + disposable-restore driver; Phase 05 hardens per 7.16 |
| docs/runbooks/exam-day-mysql-scale.md | EXISTS | Exam-day pool/lock/explain triage notes; Phase 05 adds measured thresholds |
| docs/runbooks/mysql-restore.md | PROPOSED (5.4) | Step-by-step restore runbook Phase 07 executes |
| docs/runbooks/migration-rollback-matrix.md | PROPOSED (5.5) | Per-change binary-rollback / forward-repair / full-restore table |
| scripts/mysql-measure.sh, scripts/mysql-restore-validate.sh | PROPOSED (5.1, 5.3) | Deterministic measure + restore-validation drivers |
| test-mysql-lifecycle.cjs | EXISTS (root; verify scope) | Lifecycle smoke; Phase 05 extends only the DB-lifecycle assertions it owns, via Phase 06 wiring |

## 5. New files (all PROPOSED — database owner creates; Phase 06 wires into CI; Phase 07 executes)

> Naming: prefer extending current tests when they own the behavior (overall-plan section 4). New files exist only where no owner file covers the gate.

### 5.1 `scripts/mysql-measure.sh` — deterministic hot-query measurement driver

Captures, per query family: SQL text hash, bind-shape class, EXPLAIN ANALYZE (safe-only) + JSON plan, rows examined/returned, lock-wait, pool-wait, p50/p95/p99 latency, dataset fingerprint (rows/table, schema version, MySQL version, pool settings, C09 profile id). Emits a JSON ledger row per 6.1. Fails closed when TEST_MYSQL_DSN is absent (prints NOT RUN, never fake PASS).

### 5.2 `backend/go/internal/platform/db/hotquery_ledger_test.go` — hot-query regression ledger (DSN-gated)

Go test that replays the 7.1 ledger against a disposable MySQL: asserts each family plan uses the expected index (no full-scan regression, no filesort regression on ordered/cursor paths), asserts rows-examined/returned ratio within the approved bound, asserts fencing/identity uniques still enforced (duplicate-write probe). Skips cleanly without DSN; Phase 06 gates it in the DB-integration lane, never the fast PR lane.

### 5.3 `scripts/mysql-restore-validate.sh` + `docs/runbooks/mysql-restore.md` — restore rehearsal driver + runbook

End-to-end: provision disposable target, restore latest backup, migrate --validate-only, boot API+worker against target, run 8.4 validation checklist (answers/receipts/results/media/replay through the app), record wall-time (RTO probe) + newest-restorable-timestamp delta (RPO probe). The runbook is the operator-readable companion: prerequisites, access-control steps, exact commands, expected outputs, abort criteria, evidence-capture list.

### 5.4 `docs/runbooks/migration-rollback-matrix.md` — per-change rollback matrix

One row per landed migration (6.3 record): change class (additive index / additive column / CHECK-swap / backfill / dedup+UNIQUE / retention-predicate change), binary-rollback support (old binary reads new schema? new rows readable by old code?), forward-repair procedure, full-restore trigger, and the explicit statement SQL rollback: NOT SUPPORTED wherever DDL is nontransactional.

### 5.5 Migration + retention test companions (created per change, not up front)

- `backend/go/cmd/migrate/repair_NNNN_test.go` (per repair/guard migration): static guard audit + DSN-gated crash-retry + dirty-data tests, copied from `repair_0057_test.go`.
- `backend/go/internal/maintenance/retention_boundary_test.go` (PROPOSED, DSN-gated): seeds rows on both sides of every retention boundary and asserts protected evidence survives while expired rows are swept within one bounded batch.
- `backend/go/internal/platform/db/indexchange_NNNN_test.go` (PROPOSED, DSN-gated): per-index before/after plan assertion + write-amplification probe (INSERT/UPDATE throughput delta on the indexed table) + fencing-unique preservation probe.

---

## 6. Interfaces / contracts

### 6.1 Index-change record (required for EVERY WP11 index add/drop — review gate, not optional)

```yaml
# docs/production-hardening/index-change-NNNN.yaml (proposed path; versioned evidence dir from WP00)
index: idx_attempt_mutations_v2_attempt_version   # exact name
table: attempt_mutations_v2
migration: 0059_attempt_mutations_v2_covering_read.sql   # centrally allocated; NEVER blind next-number
c09_profile: c09-v1.3
schema_before: 0058 MAX(schema_migrations)
dataset: { rows_attempt_mutations_v2: 4200000, distribution: exam-peak-shape-v2, mysql: 8.0.36, instance: staging-db-4cpu-16gb }
target_query_family: response-batch-replay
predicate_ordering_cursor: WHERE attempt_id=? ORDER BY version ASC LIMIT ? (keyset: version,id)
plan_before: { access: range-on-uq_version, rows_examined_per_returned: 3.1, filesort: false, p95_ms: 41 }
plan_after:  { access: covering-range-on-NEW-index, rows_examined_per_returned: 1.05, filesort: false, p95_ms: 9 }
write_amplification: { insert_p95_delta_pct: 2, update_p95_delta_pct: 1, secondary_index_count_after: 4 }
fencing_uniques_preserved: [uq_attempt_mutations_v2_write_id, uq_attempt_mutations_v2_version]
keyset_stability: stable  # cursor (version,id) ordering unchanged; tiebreak preserved
reversibility: online-drop-guarded  # DROP INDEX guarded by statistics probe; old binary unaffected
rollback_row: migration-rollback-matrix.md#0059
evidence: [explain-before.json, explain-after.json, mysql-measure-run-2026-09.json]
decision: APPROVED-BY-database-owner  # + owning-service-phase sign-off when predicate text touched
```

Rules: one record per index; no record means no DDL. Drops need the same record with 7-day usage evidence (performance_schema index-usage zero-reads + compatibility proof) plus separate safety approval.

### 6.2 Migration procedure (required for EVERY new migration file)

```yaml
migration: 0059_example.sql
class: additive-index | additive-column | check-swap | backfill | dedup-plus-unique | retention-predicate
head_basis: live MAX=0058 verified 2026-..-.. (dir listing + SELECT MAX(filename))
allocation: central-database-owner-ledger  # reservedSequences entry while in flight
guard_idioms: [statistics-probe-for-CREATE-INDEX | constraints-probe-for-ADD-CONSTRAINT | columns-probe-for-ADD-COLUMN | check-swap-0046-pattern]
crash_retry: record-after-success-only  # runner semantics: any statement may run twice
tests: [static-guard-audit, crash-retry-twice-applies-clean, dirty-data-dedup, fresh-install, existing-upgrade, interrupted-rerun, old-new-compat]
size_lock_disk: { rows: 4200000, est_copy_mb: 0-online-index, metadata_lock_p95_s: 0.4, disk_free_required_gb: 12, window: off-peak-only }
expand_contract: { expand: 0059-add, contract: deferred-to-00NN-after-window, consumer_window: old binary reads new schema OK until date }
backfill_or_dedup: { winner: keep-earliest-created_at-id-per-key, dry_run_count: 1234, audit_table: backup_0059_table, reconciliation: COUNT-DISTINCT-equals-COUNT }
retention_impact: none  # or the protected-evidence analysis per 7.15
rollback_row: migration-rollback-matrix.md#0059  # binary-rollback | forward-repair | full-restore; SQL-rollback NEVER promised for DDL
approvals: [database-owner, owning-service-phase-if-touched, safety-approval-if-destructive]
```

### 6.3 Retention / RPO / RTO record (approved product + ops decision, not engineering fiat)

```yaml
retention_table: student_attempt_mutations   # one row per swept table
protected_evidence: [replay-ledger-for-unsealed-attempts, grading-inputs-for-unreleased-results, terminal-receipts, incident-hold-tags]
predicate: server_received_at < NOW-30d AND (attempt sealed OR schedule terminal) AND incident_hold IS NULL
batch: 1000
window: off-peak-only  # never during exam peak; worker maintenance cycle (300s, floor 60s)
rpo: 15m   # max acceptable data-loss window — APPROVED, not proposed, before release
rto: 60m   # max acceptable restore wall-time — APPROVED, rehearsed mean+margin, not a wish
backup: { kind: logical-nightly-plus-binlog, location: access-controlled-vault, access: [db-owner, oncall-lead], encryption: at-rest-plus-in-transit }
rehearsal: { date: 2026-..-.., target: disposable-mysql-8.0.36, rpo_observed: 9m, rto_observed: 37m, checklist: mysql-restore-validate-run-id }
```

Unapproved RPO/RTO blocks release claims (overall-plan section 5: unconfirmed RPO/RTO is a Phase-01-must-resolve uncertainty; section 10 requires observed restore meeting approved objectives).

## 7. Step-by-step implementation

> Order is load-bearing: measure, rank, plan-inspect, smallest reversible change, revalidate, rehearse restore. Skipping ahead to DDL is the failure mode this phase exists to prevent.

### 7.0 Entry gates (do not start tuning without these)

1. Confirm Phases 01–04 froze C01–C09 (record contract versions in the evidence ledger).
2. Confirm WP00 baseline + WP10 measurement rig exist (dataset loader, C09 profile id, telemetry dashboards, slow-query capture).
3. WP12-prep: record migration head from LIVE lineage (dir listing + SELECT COUNT/MIN/MAX(filename) FROM schema_migrations), run lineage_test.go (expect 58/0058/zero-gaps today — re-verify, pins drift as lanes land), rehearse one disposable restore of the CURRENT schema, draft RPO/RTO + access controls for approval.
4. Freeze the candidate identity for this phase evidence: source revision + dirty-tree hashes, schema version, config fingerprint, lockfiles (overall-plan section 7 decision 7).

### 7.1 Measure then rank the hot queries

1. Enable capture on the prod-like rig for one full C09 cycle: slow-query log (long_query_time = 0.2s during measurement only), performance_schema statement-digest snapshot before/after, pool-wait gauges (MPoolWait role split), lock-wait introspection (performance_schema lock waits / sys.innodb_lock_waits), worker queue-age + retry counters.
2. Inventory SQL per poll INCLUDING auth/session touch (WP07 rule: advertise zero-SQL only for proven paths). Attribute every statement to its family: response-batch, bootstrap, runtime/auth-read, roster/rollup, grading-queue/projection, job-claim/outbox, retention/media-sweep.
3. Rank by (total time = mean x calls) then by p95, then by lock-wait contribution, then by rows-examined/returned ratio. Publish the ranked ledger (8.1 shape) with C09 profile id + dataset fingerprint. The top of this ledger — not intuition — selects 7.2 targets.
4. Record response bytes per family (oversized payloads are a 7.3 input, not an index input).

### 7.2 Plan-inspect with safe EXPLAIN ANALYZE

1. For each top-family representative: capture EXPLAIN FORMAT=JSON (always safe) + optimizer cardinality (SHOW TABLE STATUS, index histograms where present).
2. Run EXPLAIN ANALYZE ONLY where executing the query is safe: SELECTs on the disposable/prod-like rig, never mutating statements, never on production, never with unbounded LIMIT. When unsafe, record ANALYZE skipped with reason and use FORMAT=JSON + handler counts instead — a skipped ANALYZE is NOT RUN, never PASS-by-assumption.
3. Classify the plan defect explicitly: full scan, range-on-wrong-index, filesort on ORDER BY/cursor, correlated subquery per row, temp-table GROUP BY, gap-lock-prone FOR UPDATE scan, claim UPDATE over-locking, or plan OK — problem is N+1/payload/lock/pool (go to 7.3/7.6/7.7, not an index).
4. Check the fencing/identity uniques the plan currently uses (schema.go RequiredIndexes + information_schema): any candidate that would drop, replace, or bypass one is flagged for 7.5 proof before proceeding.

### 7.3 N+1 + payload-trim BEFORE indexes/cache

This step is mandatory and ordered: no index lands while an N+1 or oversized payload explains the cost.

1. **N+1 hunt:** for bootstrap, roster (IN-batch reads already present in sessions.go — verify coverage), grading reads, poll fan-out: count statements per user action. A per-row SELECT inside a loop is rewritten (by the OWNING phase, from a Phase-05 proposal diff) to a batched keyset read before any index is considered.
2. **Payload trim:** SELECT-star / whole-answers JSON / full-attempt rewrites per keystroke-batch are measured (bytes x calls). Trim to needed columns / row-scoped writes; the whole-attempt-rewrite reduction additionally needs 7.8 proof.
3. **Cache second:** only after N+1/payload are clean does Phase 05 evaluate cache-key scoping (with the runtime owner — C05) or an index. Add cache to hide N+1 and add index to hide SELECT-star are both rejected at review.
4. Evidence: before/after statement-count + bytes-per-action, not just latency.

### 7.4 Composite-index candidates vs predicate / ordering / cursor / write-amplification

1. Draft the candidate ONLY from the frozen predicate + ORDER BY + cursor: equality columns leftmost, then range, then ORDER BY/cursor tiebreak — e.g. (attempt_id, version) for WHERE attempt_id=? ORDER BY version, covering-read extensions only when the bytes justify them.
2. Validate four ways on prod-like size/distribution (never on empty/small dev DBs):
   - **Predicate:** EXPLAIN shows the intended access path across the C09 bind distribution (not one lucky id).
   - **Ordering/cursor:** no filesort regression; keyset cursor (updated_at,id)/(version,id) ordering stable across pages (probe first/middle/last page + boundary duplicates).
   - **Write amplification:** INSERT/UPDATE p95 delta on the indexed table within the approved bound (secondary indexes cost writes; exam-window tables pay per keystroke-batch).
   - **Compatibility:** old binary reads/writes with the new index present (additive indexes are binary-transparent; record the proof anyway).
3. Prefer online guarded CREATE INDEX (0017 idiom, see 8.3) with ALGORITHM=INPLACE, LOCK=NONE where supported; verify on a replica first that MySQL does not silently copy (column-type changes copy regardless — schedule off-peak, 7.12).
4. Drops: usage evidence (7-day zero-reads) + compatibility proof + index-change record + SEPARATE safety approval. Never drop a fencing/identity unique; never drop without the rollback-matrix row.
5. File one 6.1 index-change record per index. No record means the DDL does not ship.

### 7.5 Preserve identity / replay / fencing uniques + keyset pagination

Non-negotiable invariants carried from Phases 02/04 (I04, I06, I09):

- Fencing/identity uniques stay enforced at the DB layer even where the service also checks: uq_attempt_mutations_v2_write_id, uq_attempt_mutations_v2_version, uq_attempt_submissions_v2_submission, uq_assessment_result_attempt_provider, heartbeat_mutation, module_attempt_identity, mutation-idempotency indexes (schema.go RequiredIndexes). Every index migration re-probes them post-apply (VerifyRuntimeSchema + dirty-data duplicate probe).
- Replay safety: retried identical writes return compatible acks without duplicate mutation (AC03) — index changes must not alter uniqueness semantics that the retry classifier depends on.
- Keyset pagination (pagination.CursorPage) ordering is part of the contract: any index touching an ORDER BY/cursor column ships a cursor-stability probe (duplicate-timestamp ties, page-boundary overlap, backward compat of opaque cursor strings).
- Roster/rollup GROUP BY changes preserve counts (reconciliation query before/after).

### 7.6 Short deterministic transactions, per-guarantee isolation (no universal RC switch)

Current posture (verify): WithTx = RR default; WithTxRC(Retry) = RC for hot point-write paths documented as PK/unique + FOR UPDATE with no multi-read snapshot dependence; seal/mint/projection stay RR; bounded transient-only retry with jitter.

Phase 05 procedure per txn call site (hottest first per 7.1 lock-wait ranking):

1. **Shorten:** list every statement in the txn; move reads that do not need the snapshot outside; split multi-entity txns where the boundary proof allows (owning-phase approval — Phase 05 proposes, never unilaterally splits a seal/mint boundary).
2. **Determinism:** fixed statement order (lock ordering: runtime, attempt, ledger, outbox — document the actual order per path); no external calls (HTTP/store/objectstore) inside; no user-controlled sleeps; bounded batch sizes.
3. **Isolation per guarantee, decided per site:**
   - Seal / mint / terminal projection / anything depending on a repeatable snapshot across reads stays RR (WithTx(Retry)), unchanged.
   - Hot point-write by PK/unique + explicit FOR UPDATE where mutated, no snapshot dependence may use RC (WithTxRC(Retry)) with the justification comment kept current.
   - New RC proposals need the three-line proof in the diff (access path + lock scope + why no phantom matters) + owning-phase sign-off + deadlock-rate before/after.
4. **Never:** a repo-wide isolation flip, SET GLOBAL TRANSACTION ISOLATION, or RC fixed deadlocks so apply everywhere. A deadlock-rate drop bought by a correctness regression is I12-violating and BLOCKING.
5. **Claim txns:** outbox claim already runs its own RC txn (claimBatchUpdate); Phase 05 tunes mode/partitions/lease (7.7, 8.2), not the claim atomicity.

### 7.7 API / worker pool tuning vs DB capacity and lock waits

Current posture (verify): one DSN, role split DB_POOL_MAX_API about 40 / WORKER about 10 (fallback to shared max), idle 5, lifetime 25m/idle 5m, per-route query budgets (10s default to 503, never unbounded growth), worker hot cycle 20x100 claim batches + 60s lease, slow cycle 300s maintenance.

1. Measure saturation, not CPU: MPoolWait(api,worker) rate, lock-wait time vs query time, Threads_running vs max_connections, InnoDB row-lock waits, claim contention (multi-consumer over-lock), connection-churn rate.
2. Tune against the DB, not the app wish: MaxOpen(api+worker+admin/migrate headroom) at most 0.7 x max_connections on the sized instance; worker share bounded so grading/projection/retention cannot starve exam writes; idle at most open; lifetime below LB/proxy timeout.
3. **Concurrency is not remedy:** if pool-wait is high AND lock-wait/rows-examined is high, the fix is 7.3/7.4/7.6 (fewer/shorter locks), not a bigger pool. A pool increase ships only with the saturation decomposition proving waits are capacity-queuing, not lock-queuing — plus a rollback bound (revert to prior split in one config change).
4. Claim tuning (with worker owner): update vs skiplocked under the C09 multi-consumer shape; partitions WorkerClaimPartitions disjointness proof (no double-claim under crash); lease 60s vs claim-duration p99 (lease must exceed p99 batch processing with margin, else duplicate execution); 20x100 drain bound vs backlog-recovery time.
5. Timeout calibration: per-route budgets from the 7.1 distribution (budget at least p99 + margin, at most user-tolerance bound); MapDBError 503 mapping preserved; raising a budget without a plan fix is rejected at review (overall-plan must-not-do).

### 7.8 Whole-attempt-rewrite reduction — only after row-first + terminal-materialization proof

Context: legacy paths read/write whole answers/writing_answers/flags blobs per keystroke-batch; V2 row-first paths (attempt_responses_v2 + attempt_mutations_v2 + materialize.go) exist. The rewrite reduction is a KNOWN temptation with a correctness cliff (partial-row state vs terminal receipt).

1. Prove row-first first (with Phase 02): V2-only fixtures score/review/export identically (AC05/AC06 evidence), source resolver precedence frozen (C01), corruption handling defined.
2. Prove terminal materialization: materialize.go rebuild-from-rows equals whole-attempt read on the compatibility fixture set, including null/pending/invalidated distinctions (never default unknown to false) and pinned content/key/policy versions.
3. Only then: narrow the hot write to row-scoped mutations on the frozen predicate, keep the whole-attempt read as the compatibility fallback behind its existing flag, and measure write-bytes x calls + lock-hold reduction.
4. If either proof fails: STOP. The whole-attempt path stays, documented as retained-compat, and Phase 05 tunes around it (indexes on the read predicate, payload trim where safe). No partial migration.

### 7.9 Revalidate on prod-like size/distribution — never guessed DDL

Every 7.4/7.6/7.7 change re-runs on the prod-like rig (C09 dataset shape: millions-scale mutation/response rows, exam-peak skew — a few hot schedules, not uniform):

- Before/after: plan JSON, rows examined/returned, p50/p95/p99, lock-wait, pool-wait, throughput, CPU/RSS, error composition.
- Same dataset + config + instance + generator capacity for baseline vs candidate (capacity-demonstration rule, optimize.md section 8).
- AC03/AC09/AC10/AC16 correctness suite preserved on the candidate (perf without correctness is I12-violating).
- The index-change record (6.1) carries the raw evidence links. A plan captured on an empty dev DB is marked NOT EVIDENCE.

### 7.10 Migration-head recording + central filename allocation (never blind next-number)

1. At phase start AND before authoring any file: list backend/go/migrations/, run the lineage test, query the reference DB SELECT COUNT, MIN/MAX(filename) FROM schema_migrations (expect files=58, max=0058 today — re-verify; lanes land concurrently).
2. Allocate the next number(s) from the database owner central ledger (today: next free is 0059 barring reservations). While in flight, register reservedSequences entry 59-lane/topic in lineage_test.go so concurrent lanes gap-tolerate explicitly instead of colliding.
3. Author per MIGRATION_POLICY.md sections 0–7: correct guard table per spelling (statistics for CREATE UNIQUE INDEX incl. dynamic-SQL, table_constraints for ADD CONSTRAINT/ADD UNIQUE KEY — never cross-probe), existence-guarded ADD COLUMN / CREATE INDEX, keep-earliest dedup DELETE ahead of UNIQUEs, CHECK-swap by looked-up name (0046 pattern), no destructive DELETE without backup-table + row-count-guard + justification, heuristic heals naming the literal legacy value with pre-update audit.
4. Crash-retry rule: runner records a file only after ALL statements succeed, so every statement is re-runnable (guards idempotent, dedups keep-earliest-stable, backfills predicate on not-yet-migrated state).
5. Land: file + bumped pinnedMigrationFiles/Max + cleared reservation + README.md lineage entry + rollback-matrix row (6.2) + the two-test companion (7.11).

### 7.11 Fresh-install / existing-upgrade / interrupted-rerun / old-new-compat tests

Per new migration (and per index DDL), on disposable MySQL (DSN-gated, skip-cleanly without):

1. **Fresh install:** empty DB, full migrate, --validate-only clean, VerifyRuntimeSchema passes, boot API+worker smoke.
2. **Existing upgrade:** representative snapshot (prod-like shape, dirty data incl. duplicates where the migration dedups), migrate, reconciliation queries pass (uniqueness holds, row counts match dry-run plus/minus approved delta, audit/backup tables populated).
3. **Interrupted rerun:** apply file twice (second run changes nothing); mid-file crash simulation (kill between statements where harness allows, or statement-level double-execution), re-run converges, no duplicate-index/duplicate-constraint errors (the 0057 reference: TestRepair0057CrashRetry).
4. **Old/new compat:** old binary reads new schema (additive: must pass) + new binary reads old schema during the expand window (must pass until contraction), then and only then contract.
5. Static guard audit (no DB): split with the migrator own splitStatements, assert every ALTER/CREATE-INDEX/ADD-CONSTRAINT guarded + every DELETE keep-earliest-shaped or backup-guarded (copy TestRepair0057StatementsGuarded).

### 7.12 DDL implicit-commit / metadata-lock / size / online-support / disk accounting

Pre-apply checklist per DDL (record in the 6.2 procedure; abort criteria in 11.4):

- **Implicit commits:** MySQL DDL commits implicitly — no transactional rollback. The procedure states this explicitly; the safety net is backup + forward-repair + rehearse, never we will roll back the transaction.
- **Metadata locks:** estimate lock scope (INSTANCE vs TABLE), expected duration from replica trial, contending workload (exam-window tables student_attempts, student_attempt_mutations, student_heartbeat_events, outbox_events, attempt_responses_v2, attempt_mutations_v2 MUST NOT take blocking full-table ALTER during the exam window — policy section 4). Prefer ALGORITHM=INPLACE, LOCK=NONE; verify no silent copy; schedule big ALTERs off-peak with a kill/abort plan.
- **Size:** rows + index size estimate (information_schema + replica trial); chunked PK-ordered backfill with sleeps for multi-million-row writes, each chunk independently re-runnable.
- **Online support:** confirm per-statement (CREATE INDEX online by default; column-type changes copy; CHECK add validates existing rows — time it).
- **Disk:** temp-table + binlog + backup space vs free disk; refuse to start below the computed floor (fail closed, with the observed numbers in the evidence ledger).

### 7.13 Expand / contract with deferred contraction

1. **Expand:** additive new column/table/index alongside the old (nullable or defaulted; dual-write if the column is read-critical; new code reads new, falls back to old).
2. **Migrate:** backfill in bounded re-runnable chunks with reconciliation; old/new compat tests green (7.11.4).
3. **Contract (DEFERRED):** drop old column/index/table only after the rollback/consumer window closes (old binary retired + adoption evidence), as a SEPARATE reviewed migration with its own safety approval — never in the same file as the expand.
4. Record the window + consumer version in the 6.2 procedure and the rollback matrix. Contraction during the exam window is forbidden on hot tables.

### 7.14 Backfill / dedup winner-semantics + dry-run / audit / backup / reconciliation

- **Winner semantics approved in the migration header,** never assumed: keep-earliest (created_at, id) per key is ONE option (0019 idiom, reused by 0057) — valid only when earliest-write-wins matches the domain (idempotent replays). Counter-cases (latest-authoritative grade override, proctor-terminal vs student-submit race) need their domain owner written rule. Keep-earliest is not a universal truth (WP12).
- **Dry-run:** SELECT COUNT + winner-distribution sample on the prod-like snapshot BEFORE the DELETE/UPDATE; counts recorded in the procedure.
- **Audit:** doomed/affected keys copied to backup_NNNN_table (kept, not dropped in-file; cleanup is a separate reviewed migration) or the migrate log for heuristic heals.
- **Backup:** full restorable backup exists + verified BEFORE a destructive file runs anywhere beyond disposable rigs.
- **Reconciliation:** post-apply COUNT(DISTINCT key) = COUNT, spot-check winner rows, VerifyRuntimeSchema, app-level read-back of affected attempts (8.4 subset).

### 7.15 Retention protecting replay / grading / terminal / incident evidence, bounded off-peak batches

Current sweeps (verify in maintenance/jobs.go RunRetention/RunMedia): shared-cache (grace 24h to 0 under budget pressure), idempotency (expiry+24h grace), authoring-op-keys (expiry+24h), user-sessions (30d revoked/expired), heartbeats (7d non-live schedules), mutations (30d terminal schedules/attempts), published outbox (72h), rate counters, live events (72h), websocket leases, media pending-to-orphaned (24h) to delete-after.

Phase 05 hardening:

1. **Evidence-protection predicates:** no sweep may delete rows that are still replay/grading/terminal/incident evidence: unsealed attempts mutations, unreleased results grading inputs, terminal receipts inside the RPO window, rows under incident-hold. Encode as explicit predicates (e.g. AND attempt sealed AND incident_hold IS NULL), each with a boundary test (5.5 retention_boundary_test).
2. **Bounded batches:** keep LIMIT-bounded, oldest-first, ORDER-BY-indexed deletes (batch 1000 default; budget scaling documented); each pass idempotent and resumable; never one multi-million-row DELETE.
3. **Off-peak:** maintenance cycle stays 300s/floor 60s; retention passes that touch hot tables run outside exam peaks (config flag + runbook window, owned with the worker owner — Phase 05 defines the predicate/batch, worker owner the schedule wiring).
4. **Storage-budget interaction:** grace-tightening under pressure (24h to 1h to 0) must never breach the evidence predicates — pressure sheds cache, never terminal/replay evidence. Record the precedence in the 6.3 record.
5. **Media:** orphan-mark before delete, both bounded; download-access + orphan-cleanup ownership verified with the security owner (WP05 media checks stay theirs).

### 7.16 RPO / RTO + access controls + disposable-target restore rehearsal

1. **Approve RPO/RTO** (product + ops authority): proposed starting points — RPO at most 15m (binlog-granular), RTO at most 60m (disposable-target wall time incl. service boot + validation) — then REHEARSE and record observed values; release claims cite observed, not proposed.
2. **Access controls:** backup vault (encrypted at rest + in transit), least-privilege restore credentials, no production credentials in scripts/CI, secret-scan on every new script, redacted logs (I11: no answers/tokens/passwords/unnecessary student ids in rehearsal artifacts).
3. **Rehearsal (the WP12 acceptance core):** on a DISPOSABLE target, never production:
   - Restore latest backup, migrate --validate-only, schema-gate passes, boot API + worker against target,
   - Validate THROUGH THE APP (8.4 checklist): representative answers readable, terminal receipts verifiable, results consistent across scoring/review/export, media downloadable, replay of a sealed attempt converges, worker claim cycle runs clean.
   - Record RPO-observed (newest-restorable-timestamp delta) + RTO-observed (wall time) in the 6.3 record. Import succeeded alone is NOT acceptance (optimize.md section 5/WP14: validate through app + business invariants).
4. Cadence: full rehearsal before any destructive migration, before each release candidate, and after any backup-procedure change. Failures are BLOCKING for Phase 07 entry.

### 7.17 Binary-rollback vs forward-repair vs full-restore matrix (no SQL-rollback promises)

Per landed change, one row in migration-rollback-matrix.md (5.4):

- **Binary rollback** (redeploy old binary on new schema): supported for additive indexes/columns, expand-phase states, compatible outbox payload versions. Unsupported for contracted schemas, tightened CHECKs old code violates, new required columns without defaults. Procedure: stop expansion, redeploy, verify invariant probes, investigate.

- **Forward repair** (new binary + repair migration): for failed/interrupted DDL, bad backfill, security fixes that must never roll back to a bypass (WP05 rule). Procedure: tested repair file through the 7.11 gate, never hand-edited prod SQL.
- **Full restore** (backup to disposable to promote per runbook): for evidence deletion, unrecoverable DDL, integrity divergence. Trigger criteria + authorization chain + RPO-cost stated per row.
- **Never promised:** SQL-transaction rollback of applied DDL (implicit commits), blind re-run of a half-applied unguarded file, backlog purge as recovery (WP04 rule: never purge queued work as a shortcut).

---

## 8. Code / pseudocode (illustrative — rediscover exact symbols; owning phase merges semantic edits)

### 8.1 Hot-query ledger row (what 7.1 publishes per family)

```json
{
  "family": "job-claim-outbox",
  "c09_profile": "c09-v1.3",
  "schema": "MAX(schema_migrations)=0058",
  "dataset": { "outbox_events": 180000, "shape": "submit-storm-tail", "mysql": "8.0.36" },
  "sql_hash": "sha256:...",
  "calls_per_min": 1180, "p50_ms": 6, "p95_ms": 41, "p99_ms": 210,
  "rows_examined_per_returned": 3.1, "lock_wait_ms_p95": 12, "pool_wait_ms_p95": 4,
  "plan": "UPDATE outbox_events ... ORDER BY created_at LIMIT 100 (range on idx_created_due)",
  "verdict": "tune-claim-mode-partitions"
}
```

One row per family (response-batch, bootstrap, runtime/auth-read, roster, grading-queue, job-claim, retention-sweep). Ranked by total-time; the ledger is the review entry ticket for 7.4-7.7.

### 8.2 Claim-query pattern (the two postures Phase 05 evaluates — from internal/outbox/outbox.go)

```sql
-- Posture A: single-statement claim (ship default, ClaimUpdate). Atomic; weak under multi-consumer load:
-- InnoDB over-locks scanned-but-unclaimed rows.
UPDATE outbox_events
SET claimed_at = NOW(),
    claim_expires_at = DATE_ADD(NOW(), INTERVAL 60 SECOND),
    claimed_by = :worker, claim_token = :token, publish_attempts = publish_attempts + 1
WHERE published_at IS NULL
  AND failed_at IS NULL
  AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
  AND (claimed_at IS NULL OR claim_expires_at < NOW())
  -- partitioned consumers add: AND MOD(CRC32(aggregate_id), :n) = :i
ORDER BY created_at ASC
LIMIT 100;
-- then: SELECT ... WHERE claim_token = :token  (read your own claim)

-- Posture B: select-then-update (ClaimSkipLocked, OUTBOX_CLAIM_MODE=skiplocked).
-- Disjoint row locks across consumers; two round-trips; needs the claim_token guard.
START TRANSACTION ISOLATION LEVEL READ COMMITTED;
SELECT id FROM outbox_events
WHERE published_at IS NULL
  AND failed_at IS NULL
  AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
  AND (claimed_at IS NULL OR claim_expires_at < NOW())
ORDER BY created_at ASC LIMIT 100
FOR UPDATE SKIP LOCKED;
-- UPDATE outbox_events SET <same claim columns> WHERE id IN (<claimed ids>) AND claim still due;
COMMIT;
```

Phase 05 decision inputs: multi-consumer deadlock rate, claim-duration p99 vs 60s lease, backlog-drain time (20x100 bound), partition-skew (CRC32 MOD N uniformity on the C09 aggregate distribution). No posture change without the 7.9 revalidation + worker-owner sign-off.

### 8.3 Expand / contract example (guard idioms per MIGRATION_POLICY.md section 6 — illustrative names)

```sql
-- 0059_expand_example.sql -- EXPAND only (additive, online, guarded, re-runnable).
CREATE TABLE IF NOT EXISTS attempt_review_notes (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  attempt_id    VARCHAR(64) NOT NULL,
  note_json     JSON NULL,
  created_at    TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
-- existence-guarded secondary index (0017 idiom: probe statistics, never blind CREATE).
SET @sql = (SELECT IF(COUNT(*) = 0,
    'CREATE INDEX idx_review_notes_attempt ON attempt_review_notes(attempt_id)',
    'SELECT 1')
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attempt_review_notes'
      AND INDEX_NAME = 'idx_review_notes_attempt');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 0061_contract_example.sql -- SEPARATE file, DEFERRED until the consumer window closes
-- (old binary retired + compat evidence recorded in the 6.2 procedure).
-- DROP only with usage evidence + safety approval; never in the expand file.
```

Dedup-ahead-of-UNIQUE keeps the 0019 keep-earliest self-join shape; destructive DELETEs carry the backup-table + row-count-guard skeleton (policy section 1); CHECK changes follow the 0046 drop-by-looked-up-name + guarded re-ADD (policy section 3). Illustrative skeletons live in MIGRATION_POLICY.md sections 1/3/6 — copy those verbatim, do not invent new shapes here.

### 8.4 Restore-validation checklist (what mysql-restore-validate.sh asserts through the app)

```text
[ ] migrate --validate-only clean on target; VerifyRuntimeSchema passes
[ ] API + worker boot against target (no half-migration serve)
[ ] representative attempt answers readable (row-first + whole-attempt paths agree)
[ ] terminal receipts verifiable (submission_id to receipt to terminal projection)
[ ] results consistent across scoring / review / export for the fixture set
[ ] media sample downloadable + ownership-checked (no cross-user leak)
[ ] replay probe: re-submit sealed attempt yields compatible ack, no duplicate mutation (AC03)
[ ] worker probe: enqueue synthetic outbox event, claimed, published, no orphan (AC10 subset)
[ ] retention-boundary probe: protected evidence rows present, expired rows swept at most 1 batch
[ ] RPO-observed + RTO-observed recorded in the 6.3 record
```

All green = rehearsal PASS. Any red = BLOCKING for Phase 07 entry, with the failed probe + target identity + backup id in the ledger.

---

## 9. Data / state flow

```text
C09 workload (Phase 01 frozen, Phase 06 calibrated)
   |  SQL inventory + plans + lock/pool waits (7.1-7.2)
   v
Hot-query ledger (ranked) --> N+1/payload-trim proposals --> owning phases 02/04 merge semantics
   |                                | (Phase 05 never changes semantics)
   v                                v
Index candidates (7.4, 6.1 record) + txn discipline (7.6) + pool tuning (7.7)
   |  all revalidated on prod-like data (7.9); fencing uniques + keyset preserved (7.5)
   v
Guarded DDL via WP12 gate (7.10-7.13: head check, central allocation, guarded file,
   fresh/upgrade/rerun/compat tests, size/lock/disk accounting, expand, deferred contract)
   |  backfill/dedup with winner semantics + audit/backup/reconciliation (7.14)
   v
Retention sweeps protect evidence, bounded off-peak batches (7.15, 6.3 record)
   |  backups access-controlled; RPO/RTO approved
   v
Disposable-target restore rehearsal validates answers/receipts/results/media/replay
THROUGH THE APP (7.16, 8.4) to rollback matrix row per change (7.17, 5.4)
   |
   v
HANDOFF to Phase 07: frozen schema candidate + evidence ledger (AC03/09/10/16 perf + AC18 restore)
```

State that must survive every step: fencing/identity uniques, terminal receipts, replay ledger for unsealed work, grading inputs for unreleased results, incident-hold rows, queued/durable work (never purged as recovery), local journals on rollback. Anything this phase deletes is bounded, audited, restorable, and pre-approved.

Read/write path notes (MySQL 8.0, InnoDB, UTC session discipline):

- Hot write path: app txn (RR default, RC only per-site per 7.6) does PK/unique-point writes + SELECT FOR UPDATE where mutated + transactional outbox INSERT; claim path runs its own RC txn (claimBatchUpdate) with 60s lease; worker marks published or backs off (5s doubling to 300s, terminal at 8 attempts) or parks to DLQ.
- Hot read path: bootstrap/delivery/poll/roster reads run under per-route query budgets (10s default to retryable 503 via MapDBError); session/attempt-verify reads consult the C04 cache first, SQL on miss; roster/rollup reads are keyset-paginated (CursorPage) with stable (updated_at,id)/(version,id) ordering; retention/media sweeps run as bounded oldest-first LIMIT deletes/updates on the slow maintenance cycle (300s, floor 60s), never inside request txns.
- DDL path: migrate acquires GET_LOCK 300s, applies pending files lexically, records each file only after ALL its statements succeed (crash-retry => re-runnable guards), then VerifyRuntimeSchema refuses to serve half-migrated state. DDL commits implicitly per statement — there is no transactional DDL rollback; the safety nets are guards + backup + rehearsed restore + forward repair.

---

## 10. Edge cases

| # | Edge | Handling (phase procedure) |
|---|---|---|
| E1 | Lock waits spike under submit storm (rival FOR UPDATE chains: runtime, attempt, ledger) | Fixed statement/lock order per path; shorten txns (7.6); RC only with per-site proof; claim partitions to disjoint leases; pool increase FORBIDDEN as the first move (7.7.3) |
| E2 | Pool saturation (api starves worker or vice versa) | Role-split evidence; worker share bounded; idle/lifetime discipline; per-route 503 budgets preserved; saturation decomposition (capacity-queue vs lock-queue) before any sizing change |
| E3 | Metadata lock blocks exam writes during DDL | Hot-table blocking ALTER forbidden in-window (7.12); online CREATE INDEX + replica trial; off-peak window + kill/abort plan; abort-before-unsafe-DDL (11.4) |
| E4 | Interrupted DDL / crash mid-file | Guarded re-runnable statements only; runner record-after-success; 7.11.3 rerun tests; forward-repair file, never hand SQL on prod |
| E5 | Claim mode pathology (over-lock vs two-trip cost; partition skew; lease expiry to duplicate execution) | C09-shaped A/B with deadlock-rate + drain-time + skew evidence; lease greater than p99 batch duration + margin; unknown mode fails closed |
| E6 | Retention boundary eats evidence (unsealed replay rows, unreleased grading inputs, incident rows, terminal receipts in RPO window) | Protection predicates + boundary tests; pressure sheds cache first, never terminal/replay evidence; incident-hold tag honored by every sweep |
| E7 | Backfill/dedup wrong-winner (keep-earliest vs latest-authoritative vs race-winner) | Domain-owner written winner rule per migration; dry-run distribution; audit table; reconciliation; abort on ambiguous winners |
| E8 | CHECK unenforced (MySQL below 8.0.16) / MariaDB drift | Version gate (8.0.16 or later) in migrate path + SELECT VERSION() pre-check until landed; MariaDB unsupported — refuse, do not adapt silently |
| E9 | Implicit-commit surprise (half-applied file assumed transactional) | Procedure states nontransactional DDL explicitly; safety net = backup + rehearsed restore, never transaction rollback |
| E10 | Disk exhaustion mid-DDL (copy temp + binlog + backup) | Pre-computed floor; fail closed below it; chunked backfill with sleeps; resumable passes |
| E11 | Old/new binary skew during expand window | Compat matrix tests (7.11.4); contraction deferred; rollback-matrix binary-rollback row states exact supported/unsupported pairs |
| E12 | Plan regression on skew (hot-schedule concentration vs uniform dev data) | Prod-like distribution mandatory (7.9); bind-distribution sweep, not one lucky id; cursor-stability probes on duplicate-heavy pages |
| E13 | Whole-attempt vs row-first divergence during rewrite reduction | 7.8 proofs ordered; fallback retained on failure; null/pending/invalidated never defaulted to false |
| E14 | Backup restores but app disagrees (import OK, invariants broken) | 8.4 through-the-app checklist is the gate; import-only success = FAIL |
| E15 | Time-zone / clock skew breaks lease/expiry comparisons (pools must run UTC) | Keep UTC session discipline (SET time_zone UTC + UTC_TIMESTAMP reads inside txns); compare expiry with NOW() server-side only; never trust app-clock arithmetic for claim/lease predicates |
| E16 | Phantom reads after an RC move on a range scan (gap locks gone) | RC allowed only for PK/unique point-access + explicit FOR UPDATE (7.6.3); any range-scan-then-decide site stays RR; new RC diff carries the no-phantom-matters proof or is rejected |
| E17 | Cursor pagination breaks on duplicate timestamps (unstable tiebreak) | Keyset cursor always (ordering-column, id); probes cover duplicate-heavy pages + boundary overlap; opaque cursor strings stay backward compatible |
| E18 | Retention sweep lock escalation blocks exam writes (big DELETE holds row locks) | Oldest-first ORDER-BY-indexed LIMIT batches (1000); off-peak window; transient-lock idiom (record 0 + continue) only where established; else fail loudly, never silently skip |
| E19 | Binlog growth during chunked backfill fills disk mid-migration | Chunk sleeps + binlog-space estimate in 6.2 size_lock_disk; monitor free disk per chunk; abort threshold pre-declared; resume from not-yet-migrated predicate |
| E20 | Outbox poison row blocks the drain (infinite redelivery) | Backoff 5s doubling to 300s, terminal at 8 attempts, DLQ park + evidence commit atomically (0055); operator requeue-dead-letter path (fail closed on unknown id); poison never purged silently |

---

## 11. Errors

### 11.1 Error taxonomy (DB failures map honestly — C07 vocabulary preserved)

| Failure | Surface | Required behavior |
|---|---|---|
| Lock-wait timeout / deadlock (transient) | txn retry classifier absorbs, bounded + jitter, noteRetry to deadlock counters | Retry whole txn only; never retry business errors; never replay across terminal/device boundaries |
| Pool exhausted / query-budget exceeded / ctx deadline | MapDBError to 503 SERVICE_UNAVAILABLE + retryable envelope | Client retries per C07 ownership (not this phase); server never grows unbounded goroutines/conns |
| Metadata-lock wait / DDL timeout | Migration aborts pre-commit-point; alert fires | Abort-before-unsafe-DDL; forward-repair path; no partial-serve (startup gate refuses half-migrated schema) |
| Constraint violation (fencing/identity replay) | Domain error envelope (e.g. submission-id misuse), never 500-masked | Uniques stay enforced; duplicate-write probe asserts compatible-ack semantics (AC03) |
| Duplicate-claim under crash (two workers, same due row) | claim_token guard: loser UPDATE touches 0 rows / SELECT-SKIP-LOCKED skips locked rows; partition MOD keeps leases disjoint | Exactly one owner proceeds; loser re-claims next cycle; duplicate execution is a lease-duration bug (7.7.4), investigated as BLOCKING |
| Retention sweep error (transient lock vs missing table vs real failure) | Missing-table to skip-count-0 (established idiom); transient-lock on mutation sweep to record 0 + continue; else fail the pass loudly | Never silently skip a failing sweep and call it clean |
| Backup/restore failure | Rehearsal FAIL, BLOCKING for Phase 07 | Preserve evidence (backup id, target identity, failed probe); re-enter only through a new rehearsal |
| DB outage during auth | Auth-layer honest error (WP05: never misclassify as invalid credentials) | Phase 05 provides the outage-signal wiring evidence; Phase 04 owns the envelope |
| Version-gate failure (MySQL below 8.0.16 / MariaDB) | migrate refuses with explicit version message before any DDL | No CHECK-dependent migration proceeds; operator upgrades or aborts; never silently adapts |
| Checksum/history drift (pending files / dirty lineage / legacy non-empty DB without history) | migrate --validate-only lists drift; legacy-guard fails closed (warn mode only with explicit env) | No DDL until lineage reconciled by the database owner; Phase 07 does not consume a drifted candidate |

### 11.2 Never-do list (review rejects on sight)

Never promise SQL rollback for applied DDL. Never purge backlog/queued work as recovery. Never widen a pool to hide lock contention. Never raise a timeout instead of fixing the plan. Never drop a fencing unique. Never run unguarded DDL. Never backfill/dedup without winner semantics + audit + backup. Never sweep retention during exam peak on hot tables. Never validate restore by import-only. Never tune on empty-DB plans. Never interpolate identifiers from untrusted input into DDL/scripts. Never mark a skipped-DB test as PASS.

### 11.3 Logging / redaction (I11)

Slow-query + rehearsal artifacts redact answers, tokens, passwords, unnecessary student identifiers. Metric labels bounded (no IDs — IDs belong in controlled diagnostic context only with justification). Diagnostic bind values sampled in controlled context only with justification. Secret-scan gates every new script. Evidence files carry the C09 profile id + dataset fingerprint instead of student-identifying data.

### 11.4 Abort criteria (fail closed, with evidence)

Abort the DDL / tuning step — and record BLOCKING — when: backup unproven or RPO/RTO unapproved; disk/lock budget unmet; prod-like rig unavailable (no guessed DDL); owning-phase sign-off missing on semantic-adjacent changes; rehearsal red; destructive op lacking separate safety approval; lineage drift unresolved; version gate red. The phase then ships the measurement + blocked-reason to Phase 07 instead of a tuned-but-unproven candidate.

---

## 12. Performance / security

### 12.1 Performance rules

- Every claim cites workload + resources + config + distribution + raw evidence (WP10 rule). p50/p95/p99, never means alone. Compare baseline and candidate on the same dataset, configuration, infrastructure, and generator capacity; record p50/p95/p99, error composition, CPU/RSS, connections, SQL/lock waits, storage latency, queue age, post-load recovery (optimize.md section 8).
- Budgets instead of vibes: autosave-ack (p95 at most 1s client-send to exact-server-ack), terminal-receipt (p95 at most 2s, ordinary seal vs SAT provisional vs final readiness separated), bootstrap, roster, grading-projection-lag, runtime freshness per C05 bound — each gets a C09-scoped budget from calibration; 7.9 revalidation checks all of them, not just the tuned query. Initial numbers are calibration proposals (optimize.md section 8), not promises.
- No unbounded behavior: claim batches (100x20), retention/media batches (1000), projection batches (500), SAT repair batch (250), cursor limits (at most 500), page sizes (at most 200) stay bounded; any increase needs the memory/backlog proof (WP11 acceptance: no new unbounded memory/backlog behavior).
- Throughput math is scoped: arrival bursts, concurrent writers, payload sizes, submit storms, staff connections, background workloads specified separately; expected peak plus approved headroom shown; no registrations-per-day to concurrent-sockets extrapolation; generator-not-the-bottleneck proof required.
- Soak awareness: lease/token/retention-interval-length phenomena are Phase 07 soak inputs — Phase 05 records the intervals, never assumes short-run success generalizes.

### 12.2 Security rules

- Least privilege: migrate/restore credentials separate from app pools; backup-vault access = database owner + oncall lead; production credential access needs its own approval (not this plan). Guard production-targeting helpers with explicit environment allowlists (WP13 rule); never use live students as fixtures.
- Injection: all query construction stays parameterized (WP05 review input); new scripts never interpolate identifiers from untrusted input; rich-text/import rendering stays out of this phase (security owner).
- Exposure: no backup contents, DSNs, or student data in logs/tickets/evidence files; rehearsal fixtures sanitized deterministic (WP00 fixtures); telemetry labels bounded (I11).
- Authorization coupling: index/txn/pool changes must not alter who can read/write what — roster-count queries keep their assignment scoping; media-restore probes assert ownership checks; cache-key changes (proposed, runtime owner merges) keep identity/version/revision scope; revocation propagation bound (C04) never loosened for freshness.
- Dependency discipline: no new infra (no Redis/queue/sharding/microservices), no blanket upgrades; any driver/tooling change is targeted + regression-checked. Never roll back to a known authorization bypass (WP05 rule) — security fixes go forward-repair.
- Auditability: every destructive-shaped migration keeps its backup table + row-count guard + audit output; retention passes emit per-table counts (RetentionReport/MediaReport); invariant audit (AuditInvariants) findings route to operators, never silent-drop.

### 12.3 Concurrency is not remedy (the principle, stated once, enforced everywhere)

Throughput problems decompose FIRST into rows-examined, lock-hold time, txn length, N+1 count, payload bytes. Only the residual capacity-queue after those are minimized may be answered with pool/worker concurrency — sized to the DB measured headroom, with a one-change rollback. A review that finds a pool bump ahead of a plan fix sends the change back.

---

## 13. Tests (what lands; Phase 06 wires lanes, Phase 07 runs integrated)

> Prefer extending current tests when they own the behavior. New files only per section 5. AC mapping: this phase PRODUCES perf + migration/restore evidence for AC03/09/10/16 + AC18; Phase 07 RUNS all 20 integrated. Discriminating-test rules (optimize.md 7.x) apply throughout: control race ordering explicitly and test both winners where valid; same-ID/same-payload vs same-ID/different-payload vs different-ID/same-version separately; old-client/new-server + new-client/compatible-old-server for every changed contract/storage shape; valid + invalid ownership fixtures (happy-path alone never proves authorization).

### 13.1 AC03 — committed batch, dropped ack, identical retry (perf + correctness)

- DB integration (DSN-gated): commit batch, drop ack (harness), retry identical write-id, assert compatible ack, no duplicate mutation, payload unchanged; assert under the tuned index + RC posture (not just the old plan).
- Discriminators: same-ID/same-payload vs same-ID/different-payload vs different-ID/same-version run separately; stale-lease and terminal-replay variants included (never auto-replay across a stale lease or terminal state).
- Index-regression companion (indexchange_NNNN_test.go): the same probe re-runs post-DDL and fails on any uniqueness-semantics drift the retry classifier depends on.

### 13.2 AC09 — submit vs terminate/deadline race (tuned-txn proof)

- Real-DB barrier tests (owning phase 02 owns the race; Phase 05 contributes): one approved compatible terminal outcome under the frozen txn/lock order (I04); conflicting request rejected without overwrite; deadlock-rate + outcome-convergence recorded on the candidate plan.
- Both winners tested where valid (submit-wins and terminate-wins fixtures with explicit ordering control); exact deadline/grace boundaries included.

### 13.3 AC10 — fan-out successes + transient + poison (claim-tuning proof)

- Worker crash/retry integration on the tuned claim posture: mix of successes, transient failures, poison attempts; every unfinished attempt durably owned, completed or explicitly dead-lettered (outbox_dead_letters); DLQ age bounded; no ownerless work when a sibling succeeds (C06/I09); parent completes only when each target is finished, permanently classified, or durably assigned to retry/DLQ.
- Crash-after-commit, duplicate-delivery, partial-fan-out variants; claim-mode/partition/lease values recorded in the evidence row; requeue-dead-letter operator path covered (fail closed on unknown id).

### 13.4 AC16 — worker/cached/stale visibility within C05 bound (pool/poll proof)

- Two-process (API + worker distinct processes, never shared memory) probe: worker-originated change observable via the durable bus/invalidation/bounded-refresh within the C05 bound under pool pressure; sleeping-poll-loop + event-loss + stale-cache variants; writes still enforce immediately regardless of freshness (timing/authorization correctness at write time, independent of UI freshness).
- Pool-pressure variant: the bound must hold at the tuned pool split under the C09 background load, not just on an idle rig.

### 13.5 AC19-input — pool/throughput budgets (Phase 05 produces, Phase 07 storms)

- Repeatable C09-shaped run on prod-like data: arrival wave + steady writes + section changes + submit storm + proctor observers + grading background + post-exam cleanup; record latency distribution, error composition, CPU/RSS, conns, SQL/lock/pool waits, storage latency, queue age, post-load backlog recovery to baseline. No registrations-to-sockets extrapolation; generator-not-the-bottleneck proof required.
- Output feeds Phase 07 (WP14) storm: supported capacity + safety margin + limiting resource named.

### 13.6 Txn/isolation matrix (unit + sqlmock, no DB)

- Extend tx_isolation_test.go: per-site isolation assertion (seal/mint/projection = RR; hot point-write = RC + justification fixture); deadlock replays once with bounded jitter; business error never replays (no replay storms); hook fires exactly once per absorbed transient; attempts floor at 1.
- Failing-test-first for any site moved between RR/RC: the matrix test names the site + guarantee before the diff lands.

### 13.7 Pool/timeout regression (unit + disposable-DB)

- Role-split sizing assertions (poolsplit/poolstats): explicit split holds when set, falls back to shared max when unset, unknown role fails closed.
- Saturation test: lock-queue-dominant load must NOT be fixable by a pool bump in the test allowed actions (assert the tuning procedure demands plan-first — 7.7.3).
- Per-route budget tests assert 503-not-hang under wedged-DB harness (withQueryTimeout short-circuit on exhausted budget; QueryContext per-query cap; MapDBError deadline/cancel to 503 incl. message-intact driver cancellations).
- Unknown outbox claim mode fails closed at ClaimBatch (never silently changes lock semantics); claim limit clamps to 1..100.

### 13.8 AC18 — migration/restore fault scenarios (the WP12 acceptance core)

- Interrupted-rerun (apply twice + mid-file crash converge, second run changes nothing), retention-boundary (protected evidence survives, expired sweeps bounded to one batch), scratch-restore (disposable target + 8.4 through-the-app checklist + observed RPO/RTO within approved). AC18 wording: interrupted migration rerun, retention boundary, and scratch restore preserve replay/terminal/result invariants and meet approved RPO/RTO.
- Every repair/guard migration ships the 0057 two-test companion: (a) static guard audit with no DB — split the .sql with the migrator own splitStatements, assert every ALTER/CREATE-INDEX/ADD-CONSTRAINT information_schema-guarded (correct table per spelling per policy section 0) and every DELETE keep-earliest-shaped or backup-guarded; (b) DSN-gated crash-retry (apply twice converges) + dirty-data dedup (seed duplicates, dedup, build UNIQUE cleanly). Copy TestRepair0057StatementsGuarded / TestRepair0057CrashRetry / TestRepair0057DirtyDataDedup.
- Old/new + new/old compat matrix for each expand window (old binary reads new schema; new binary reads old schema until contraction); contraction only after window evidence; legacy-history guard covered (non-empty DB without history refuses unless explicit warn mode).
- Schema-candidate gate row (optimize.md section 9): fresh install / upgrade / interrupted rerun / compatibility + locking/disk assessment + restore route — SQL parses successfully is explicitly NOT sufficient.

### 13.9 Index/retention companions (DSN-gated, per change)

- indexchange_NNNN_test.go: expected-index plan assertion (no full-scan/filesort regression on ordered/cursor paths) + write-amplification probe (INSERT/UPDATE p95 delta within bound) + fencing-unique preservation probe (duplicate-write rejected, VerifyRuntimeSchema green).
- retention_boundary_test.go: both-sides-of-boundary seeds per swept table (shared-cache, idempotency, authoring-op-keys, user-sessions, heartbeats, mutations, outbox, rate counters, live events, leases, media); incident-hold rows survive; terminal/replay evidence survives; one pass deletes at most batch bound; expired rows swept oldest-first.
- Grading-projection checkpoint companion where touched: revision compare-and-swap idempotency + 24h bootstrap lookback + batch-500 bound preserved.

### 13.10 Test lanes (for Phase 06 to wire — declared here, owned there)

Fast PR, no DB: lineage pin (TestMigrationSequenceContinuous), guard audits, isolation matrix, pool-split, pagination keyset, openapi/contract unit tests. DB integration, DSN-gated, isolated schemas per worker: hot-query ledger, claim A/B, retention boundary, migration 4-way gate, restore-validate, AC03/09/10/16 candidate runs. Browser/load/restore-nightly: owned by Phase 06/07 lanes. Never gate PRs on live-DB tests; never mark skipped-DB as PASS — skipped critical tests are NOT RUN (WP13 rule) and block release claims until run. Different files do not guarantee runtime isolation: parallel DB workers need separate disposable databases or scheduled exclusive access.

---

## 14. Verification commands

> Confirm actual scripts/environment in WP00 first (names below are current-tree readings; if WP00 renamed them, use WP00s). Never run production-targeting configs by name alone — some existing configs target remote/production; verify before executing. All DB-backed commands need TEST_MYSQL_DSN pointing at a DISPOSABLE database; without it the DSN-gated tests skip cleanly (NOT RUN, never PASS). Record command + env + exit status + artifact links in the section 6 records for every run.

```bash
# --- lineage + head (run first, every time) ---
ls backend/go/migrations/ | sort | tail -n 5
# expect tail ...0057..., 0058_authoring_operation_keys.sql (re-verify; pins drift as lanes land)
go -C backend/go test ./cmd/migrate/ -run 'TestMigrationSequenceContinuous|TestIsTriggerStatement' -v
# expect PASS with pinned files=58 / max=0058 today (re-verify — bump pins iff a file lands)
mysql -e "SELECT COUNT(*), MIN(filename), MAX(filename) FROM schema_migrations;"
# expect COUNT 58 / MIN 0001_roles.sql / MAX 0058_authoring_operation_keys.sql (today — re-verify)
mysql -e "SELECT VERSION();"
# expect MySQL >= 8.0.16 (CHECKs silently ignored below; MariaDB unsupported)

# --- migration 4-way gate (per new file NNNN; disposable DB only) ---
TEST_MYSQL_DSN='mysql://u:p@127.0.0.1:3306/phase05_disc' go -C backend/go test ./cmd/migrate/ -run 'TestRepairNNNN|TestMigration' -v
go -C backend/go run ./cmd/migrate --validate-only   # MIGRATIONS_DIR=<disposable-clone> as needed
# expect: validate-only clean + VerifyRuntimeSchema passes (half-migrated DB must refuse to serve)

# --- txn / pool / pagination fast gates (no DB) ---
go -C backend/go test ./internal/platform/tx/ ./internal/platform/db/ ./internal/platform/pagination/ -v
# expect: isolation matrix green (RR default, RC only justified), pool-split holds, keyset bounds hold

# --- hot-query ledger + claim + retention (disposable DB) ---
TEST_MYSQL_DSN='...' go -C backend/go test ./internal/platform/db/ -run TestHotQueryLedger -v
TEST_MYSQL_DSN='...' go -C backend/go test ./internal/outbox/ ./internal/maintenance/ -v
# expect: expected-index plans, rows-examined bounds, fencing uniques enforced, one pass at most batch bound

# --- AC03/09/10/16 candidate probes (disposable DB; owning-phase harnesses where noted) ---
TEST_MYSQL_DSN='...' go -C backend/go test ./internal/attempts/ -run 'TestDurability|TestContention|TestSubmit' -v
# expect: compatible-ack replay, single terminal outcome under barrier, no duplicate mutation

# --- measurement + restore drivers (proposed scripts; Phase 06 wires schedule) ---
bash scripts/mysql-measure.sh --c09 c09-v1.3 --out docs/production-hardening/measure-<date>.json
bash scripts/mysql-restore-validate.sh --backup <vault-id> --target mysql://.../restore_disc --checklist
# expect: JSON ledger rows per 8.1 + 8.4 checklist all-green with observed RPO/RTO

# --- pre-existing lifecycle smoke (extend, do not replace) ---
node test-mysql-lifecycle.cjs   # verify scope at phase start; DB assertions owned here stay green

# --- lineage audit probes on a migrated DB (from migrations README) ---
'mysql -e "SELECT filename FROM schema_migrations ORDER BY filename;"'
# expect: every file exactly once, lexical order, no gaps outside reservedSequences
```

Evidence to capture per run: command + env (MySQL SELECT VERSION(), schema MAX, config fingerprint incl. pool split + claim mode/partitions, C09 profile id, dataset fingerprint) + exit status + artifact links in the section 6 records. Looks correct without logs is not evidence (freeze/review/repair protocol). Unavailable required checks stay NOT RUN / BLOCKED — never PASS by substitution (optimize.md section 9).

---

## 15. Completion checklist

- [ ] C01–C09 frozen versions recorded; query-shape freeze inputs (3.1) confirmed from Phases 01–04; WP10 evidence rig available (3.2).
- [ ] Hot-query ledger ranked + published with C09 profile + dataset fingerprint (7.1); plans inspected safe-only (7.2).
- [ ] N+1 + payload-trim proposals dispositioned (merged by owning phases or closed with evidence) BEFORE any index DDL (7.3).
- [ ] Each landed index has a 6.1 record + 7.9 revalidation + fencing/keyset proof (7.4/7.5); no guessed DDL; drops have 7-day usage evidence + separate safety approval.
- [ ] Txn audit complete: every call site RR/RC justified per-guarantee; no universal switch; txns short/deterministic/external-call-free (7.6).
- [ ] Pools sized to measured DB headroom with saturation decomposition; claim mode/partitions/lease evidenced with worker-owner sign-off; timeouts calibrated, none raised to hide plans (7.7).
- [ ] Whole-attempt-rewrite reduction EITHER proven (7.8.1–7.8.3) OR explicitly retained-compat with rationale (7.8.4).
- [ ] Migration head re-verified from live lineage; all new files centrally allocated, guarded, crash-retry-safe; pins + README + rollback-matrix rows landed (7.10–7.13).
- [ ] Backfill/dedup files carry winner semantics + dry-run + audit + backup + reconciliation (7.14).
- [ ] Retention predicates protect replay/grading/terminal/incident evidence; bounded off-peak batches; boundary tests green (7.15 + 6.3).
- [ ] RPO/RTO approved; backups access-controlled; disposable-target restore rehearsal PASS through-the-app (8.4) with observed RPO/RTO recorded (7.16).
- [ ] Rollback matrix complete: every change has binary-rollback / forward-repair / full-restore rows; no SQL-rollback promises (7.17).
- [ ] Tests 13.1–13.9 landed (or extended in owner files); DSN-gated suites skip-cleanly without DB; no skipped-critical marked PASS; flaky-test policy with owner + deadline honored (no permanent retry-hiding of critical failures).
- [ ] Destructive ops (if any) carry separate safety approval; abort-criteria invocations (11.4) recorded honestly; IMPORTANT findings repaired or formally accepted, BLOCKING findings all repaired (no unresolved critical correctness/security defects).
- [ ] Handoff package to Phase 07 assembled (16); phase evidence ledger rows filled (requirement / owner / contract version / files / candidate identity / producer checks / reviewer evidence / PASS-FAIL-NOT-RUN-BLOCKED / residual risk / rollback evidence / next action).

---

## 16. Handoff to Phase 07 (what Phase 07 consumes — nothing implied, everything linked)

Phase 07 (WP14 integrated rehearsal: AC01–AC20 against the integrated candidate, load + recovery + independent L4 check) needs this exact package; Phase 05 does not run the storm itself:

1. **Frozen schema candidate:** source revision + dirty hashes, schema_migrations MAX, migrate --validate-only clean log, VerifyRuntimeSchema log, rollback-matrix file, backup id the candidate was rehearsed from, lockfiles + config fingerprint.
2. **Perf evidence:** hot-query ledger (before/after per family, 8.1 rows), index-change records (6.1) with raw EXPLAIN + measure-run JSON, pool/txn settings + saturation decomposition, AC03/09/10/16 candidate-run logs with C09 profile id + dataset fingerprint + resource fingerprint; AC19-input run (13.5) with supported capacity + headroom + limiting resource.
3. **Recovery evidence:** AC18 rehearsal bundle — fresh/upgrade/rerun/compat logs per new migration, retention-boundary logs, disposable-restore 8.4 checklist log with observed RPO/RTO vs approved, incident-hold + evidence-protection proof, DLQ/requeue path evidence.
4. **Known limits + residual risks:** capacity headroom + limiting resource, deferred contractions with windows + consumer versions, retained-compat paths (e.g. whole-attempt fallback if 7.8.4), any IMPORTANT findings with authorized acceptance, any BLOCKING findings (Phase 07 must not start the storm over a BLOCKING data-loss/restore gap — stop conditions in optimize.md section 10 apply).
5. **Runbooks + commands:** mysql-restore.md, rollback matrix, measure/restore-validate drivers, exact verification commands (14) Phase 07 re-runs against the integrated candidate; incident contacts + evidence-retrieval procedures per WP15 handoff.
6. **Ownership transfer note:** database-owner tuning authority ends when Phase 07 freezes its candidate; subsequent DDL restarts at 7.10 (re-verify head — numbers moved meanwhile). Cross-feature integration tests belong to the integration test owner; CI wiring belongs to Phase 06 — Phase 07 coordinates, both phases hand over invocations, not ownership confusion.

---

## Appendix A — Contract / invariant / AC touchpoints (traceability)

| Item | Meaning for Phase 05 | Proved by |
|---|---|---|
| C06 work ownership & projection | Claim atomicity, lease, idempotency, DLQ, no ownerless work | 7.7.4, 8.2, 13.3 |
| C09 workload & SLO profile | All perf claims scoped; budgets calibrated, never extrapolated | 3.1, 7.1, 7.9, 13.5 |
| I09 retried jobs, no duplicate effects | Uniques + claim guards + idempotent requeue survive tuning | 7.5, 13.1/13.3 |
| I10 partial failure to valid prior/durable path | Txn boundaries, crash-retry migrations, restore rehearsal | 7.6, 7.11, 7.16 |
| I11 telemetry redaction | Bounded labels, no IDs, redacted rehearsal artifacts | 11.3, 12.2 |
| I12 perf must not weaken invariants | Correctness suite re-run on every candidate | 7.9, 13 |
| AC03 batch-retry compat ack | Index + RC posture preserve replay semantics | 13.1 |
| AC09 submit/terminate race | Lock-order + RR seal proof under tuned txns | 13.2 |
| AC10 fan-out ownership/DLQ | Tuned claim still converges every item | 13.3 |
| AC16 freshness bound under pressure | Pool/poll evidence, two-process probe | 13.4 |
| AC18 migration/restore faults | 4-way migration gate + boundary + scratch restore | 13.8 |
| AC19 capacity budgets | Phase 05 single-query/pool evidence feeds Phase 07 storm | 13.5 to Phase 07 |
| AC11 SAT provisional recovery (adjacent) | Claim/seal evidence must not break provisional-to-final reconciliation | 7.6/7.7 witness logs (owning phase 02 asserts) |

## Appendix B — Ownership registry excerpt (binding while active)

Migration filenames/DDL, index definitions, pool sizing, retention predicates, backup/restore procedures go to **database/operations owner (this phase)**. Service-SQL semantics go to owning phases 02/04 (Phase 05 proposes diffs, they merge). Worker orchestration/fan-out goes to worker owner (claim tuning joint). cmd/api/main.go wiring, app.go graph go to integration owner. CI/deploy files go to Phase 06. Same-file needs sequenced or ownership explicitly transferred; worktrees isolate edits, not contracts.

## Appendix C — Source map (where each file section came from)

WP11 tasks go to 2.1/7.1–7.9; WP12 tasks go to 2.1/7.10–7.17; C06/C09 go to 3.1/6/16 + App. A; I09/I10 (+I11/I12) go to 7.5/7.6/7.9/11.3; AC03/09/10/16 go to 13.1–13.4 + App. A; AC18 goes to 13.8; AC19-input goes to 13.5; AC11-adjacent noted in App. A; ownership registry goes to App. B + 4; MIGRATION_POLICY.md sections 0–7 go to 7.10–7.13 + 8.3; live lineage (58/0058) goes to 4.4/7.10/14 (re-verify at execution — pins drift).