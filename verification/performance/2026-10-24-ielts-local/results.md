# IELTS local E2E and hot-path verification

Date: 2026-10-24 (Asia/Bangkok). These results describe one shared Apple M1
laptop, not a supported deployment capacity. A host-load sample outside the
passing run read 13.94/10.70/6.94 on 8 cores while unrelated desktop processes
were active; per-run CPU/load was not captured.

## Environment and workload

- MySQL 9.6.0, `max_connections=151`, 128 MiB InnoDB buffer pool,
  `innodb_flush_log_at_trx_commit=1`, `sync_binlog=1`, local Unix socket.
- Fresh isolated database migrated with the repository migration runner.
- 500 synthetic candidates, one room, three IELTS sections, 40 questions per
  section; one API process, API pool 80 unless noted, in-process worker, two
  staff roster sweepers, and a 5-second spread on readiness/submit waves.
- The E2E harness ran actual HTTP API processes and k6, then independently
  reconciled persisted answers and submission receipts. k6 guards required an
  exact local target confirmation and a synthetic-only credential file.
- No durability setting was weakened. Fixture cleanup left no synthetic IELTS
  users, exam or attempt rows. The disposable test schema was dropped after the
  verification run.

## Throughput runs

| Offered logical ops/s | API pool | `ROW_FIRST_WRITES` | Delivered ops/s | Dropped iterations | Save / flush / replay p99 | API pool wait count / time | Outcome |
| ---: | ---: | :---: | ---: | ---: | --- | --- | --- |
| 250 | 80 | off | 242.81 | 618 | 4.05 / 4.42 / 3.00 s | 9,494 / 24m43.9s | Failed p99 and dropped-iteration gates; 0 operation failures and 0 unexpected 5xx |
| 250 | 120 | off | 242.81 | 620 | 4.38 / 4.89 / 2.02 s | 3,301 / 12m12.5s | Failed p99 and dropped-iteration gates; 0 operation failures and 0 unexpected 5xx |
| 250 | 120 | on | 237.80 | 1,222 | 5.28 / 6.80 / 3.72 s | 13,899 / 1h10m12.5s | Failed p99 and dropped-iteration gates; row-first did not improve this run |
| 150 | 80 | off | 148.76 | 0 | 2.90 / 3.01 / 2.25 s | 9,141 / 40m00.2s | Failed p99 gates; 0 operation failures and 0 unexpected 5xx |
| 50 | 80 | off | 49.59 | 0 | 166.79 / 145.31 / 57.85 ms | 0 / 0 s | Full E2E pass |

The full pass at 50 ops/s completed the readiness wave, two-minute steady
save/flush/replay/poll phase with worker and staff sweeps, submit/resubmit wave,
and database reconciliation. It reconciled 500 submitted candidates and 10,225
accepted answer rows with zero sealed-answer mismatches. Ready p99 was 148 ms;
submit p99 was 73 ms; 354 staff roster pages had p99 141 ms. k6 recorded zero
operation failures, unexpected 5xx responses or dropped iterations.

The 150/s run delivered its requested arrival rate but missed p99. The 250/s
runs delivered only about 243 operations/s and dropped iterations. Raising the
API pool to 120 reduced aggregate pool wait for the baseline-write run but did
not pass the latency gates. Turning row-first writes on for both API and worker
was worse at this load. None of these settings is promoted from a local run.

## Other verification

- `TestIELTSRowFirstEquivalenceMySQL` passed against the isolated MySQL for
  Listening and Writing, including replay, version collision, superseded
  commands and long Writing edits.
- `TestIELTSStatementBudgetMySQL` passed for binary/interpolated DSNs with
  row-first on/off. One-command save used 14 queries/5 execs with default
  binding and 13 queries/4 execs in row-first mode; interpolate mode removed
  driver prepares from the counter, without changing domain query counts.
- `TestSnapshotOwners*` passed. `BenchmarkSnapshotOwners` on Apple M1 showed
  the batch traversal at 20 IDs taking 124.5 µs vs 1.65 ms on a small snapshot
  and 1.16 ms vs 23.08 ms on a large snapshot. At 100 IDs it took 128.3 µs vs
  7.19 ms and 1.17 ms vs 76.46 ms. For one ID the direct batch helper costs
  more allocations, so `ResolveMany` retains the old single-ID traversal.

Commands for the complete passing E2E run, from `backend/go`:

```bash
# First create the disposable schema and migrate it. Set AUTH_SECRET to a
# unique random value of at least 32 characters for the migration process.
mysql --protocol=socket -uroot -e "CREATE DATABASE codex_ielts_throughput_20261024 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
DATABASE_URL='root@unix(/tmp/mysql.sock)/codex_ielts_throughput_20261024?parseTime=true' \
AUTH_SECRET="$(openssl rand -hex 32)" \
go run ./cmd/migrate

TEST_MYSQL_DSN='root@unix(/tmp/mysql.sock)/codex_ielts_throughput_20261024?parseTime=true' \
IELTS_THROUGHPUT_K6_USERS=500 IELTS_THROUGHPUT_K6_RATE=50 \
IELTS_THROUGHPUT_K6_DURATION=2m IELTS_THROUGHPUT_K6_START_SPREAD=5 \
SAT_RECOVERY_K6_API_POOL=80 SAT_K6_API_INSTANCES=1 \
go test ./cmd/api -run '^TestIELTSThroughputK6MySQL$' -count=1 -v -timeout 30m

TEST_MYSQL_DSN='root@unix(/tmp/mysql.sock)/codex_ielts_throughput_20261024?parseTime=true' \
go test ./cmd/api -run '^(TestIELTSRowFirstEquivalenceMySQL|TestIELTSStatementBudgetMySQL)$' -count=1 -v -timeout 30m

go test ./cmd/api -run '^TestSnapshotOwners' \
  -bench '^BenchmarkSnapshotOwners$' -benchmem -benchtime=200ms -count=1

# Then drop the disposable schema after the test cleanup is verified.
mysql --protocol=socket -uroot -e "DROP DATABASE codex_ielts_throughput_20261024"
```

These are local diagnostics only. Runs were not repeated under a quiet,
controlled host; the 500-candidate 50-ops/s point is not a certified capacity
envelope. The target engine/topology, 25-room workload, 2,000-candidate tier,
API-replica loss, production profiles and stable maximum sustainable rate
remain unverified.
