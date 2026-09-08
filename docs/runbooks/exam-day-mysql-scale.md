# Runbook: exam-day MySQL scale (plan E1/E2/E3, single deploy + own MySQL)

No new infra. One Go process (api + worker via `backend/Dockerfile`
start.sh) + self-hosted MySQL/InnoDB. Every win is doing less work per
request inside the existing binaries + schema.

## 1. my.cnf (16GB box example; scale to box)

```ini
[mysqld]
innodb_buffer_pool_size = 10G        # ~60-70% RAM
innodb_flush_log_at_trx_commit = 1   # exam durability; do NOT relax
sync_binlog = 1                      # PITR; do NOT relax
max_connections = 250
innodb_lock_wait_timeout = 8
transaction_isolation = READ-COMMITTED  # B1 hot path; seal/mint stay RR explicit
slow_query_log = ON
long_query_time = 0.2
performance_schema = ON
binlog_expire_logs_seconds = 604800    # per PITR policy
```

Verify: `SHOW VARIABLES WHERE Variable_name IN
('innodb_buffer_pool_size','transaction_isolation','max_connections');`

## 2. Pools (code truth: `platform/db/db.go`)

API 40 / worker 10 via `DB_POOL_MAX_API` / `DB_POOL_MAX_WORKER`
(fallback `DB_POOL_MAX_CONNECTIONS`, default 20). Lifetimes 25m / idle 5m.
Watch `db_pool_open/in_use/wait_count` split API vs worker on the
dashboard; waits > 0 sustained during a wave = stagger harder, not raise
pools (single writer; more conns = more lock pileup).

## 3. Per-query budgets (E1)

Hot reads run under `DefaultQueryTimeout` (10s, `cmd/api/query_timeout.go`,
pinned by `TestDefaultQueryTimeoutRunbookFigure`):
runtime poll, bootstrap probes. Exhausted budget renders 503
`query_budget_exhausted_total` (`MQueryTimeout` in `telemetry.go`, emitted
by `withQueryTimeout`) — never a hung conn. Slow-DB honesty:
a 503 spike means the box is saturated; shed (below), don't retry-storm.

## 4. Load shedding (E2: `SHED_MODE=off|exam`)

Priority (drop from the bottom): submit/seal > autosave > bootstrap >
runtime-poll > heartbeat > proctor-list > admin/authoring/grading.
`exam` rebalances tier budgets (poll 240->60, heartbeat 120->30,
authed-reads 300->150, pinned by `TestShedExamRunbookFigures`);
**writes never shed** (code truth: `ApplyShedMode`, `platform/config/config.go`;
ship defaults in the `RATE_LIMIT_*_PER_MIN` block; pinned by `shed_mode_test.go`). Every 429 carries
`retryAfterSecs` (+ queue position on entry); clients honor it (C2/C3).
Exam windows: frozen deploys + migration freeze; worker intervals stay
continuous (auto-submit/projection must live in every mode).

Rollback: flip `SHED_MODE=off` + redeploy (~minutes). No migration to
roll back (schema additions are additive; code tolerates absent-or-present).

## 5. Retention (worker slow cycle, `maintenance.RunRetention`)

Purge cadence up OUTSIDE exam windows, small bounded batches: outbox
published rows, heartbeat events, rate-counter leftovers, live-bus sink.
Never mega-`DELETE ... LIMIT` during exams (single-writer lock +
replication-lag spike). Covering indexes only for surviving hot
point-gets — verify via slow log, not guesswork.

## 6. Backup + restore rehearsal (`scripts/backup-rehearsal.sh`)

Nightly `mysqldump`/XtraBackup + PITR binlogs. Rehearse monthly:

```bash
bash scripts/backup-rehearsal.sh --latest   # restore to scratch, VerifyRuntimeSchema, boot api read-only probe
```

A backup that has never restored is not a backup.

## 7. Flags matrix (rollback = flip + redeploy)

| Flag | Ship | Rolled-out |
|---|---|---|
| `RATE_LIMIT_MODE` | dual | local |
| `SESSION_CACHE` | off | on |
| `ATTEMPT_VERIFY` | strict | stateless |
| `RUNTIME_SNAPSHOT` | off | on |
| `ROW_FIRST_WRITES` | off | on |
| `OUTBOX_EXEC_ONLY/CLAIM_MODE/PARTITIONS` | off/update/1 | on/skiplocked/4 |
| `DB_POOL_MAX_API/WORKER` | 20 | 40/10 |
| `LIVE_BUS/SINK` | db | direct |
| `WS_ADMISSION` | db | memory |
| `STUDENT_WS` | allow | gone (post-client) |
| `VERSION_CACHE` | off | on |
| `PRESENCE_MODE` | inline | memory |
| `ENTRY_GATE` + rates | off | on |
| `ROLLUP` | off | on |
| `SHED_MODE` | off | exam (windows) |

## 8. Game day (quarterly, prod-shaped 100k+ attempts)

Chaos items: process restart mid-exam (cache-cold behavior), MySQL
slow-disk 2x, submit storm at deadline, every-flag-off rollback drill.
Proof gates: k6 `scale-proof/` suite green — entry 5k zero-dup,
bootstrap p99 < 2s @2k, 500-way zero-deadlock, poll >90% 304,
staff WS soak clean.
