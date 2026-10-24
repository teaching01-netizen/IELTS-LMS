# IELTS save/readiness/submit capacity

This runbook covers qualifying the IELTS answer path (readiness, durable saves,
runtime polls, submit and staff roster reads) on a fixed topology, choosing the
database flags, and rolling a change back. It implements section 6 of
`docs/plans/2026-10-24-ielts-go-db-throughput-core-plan.md`. Local run summaries
are in `verification/performance/2026-10-24-ielts-local/results.md`.

**Status:** one 500-candidate E2E run passed at 50 logical operations/s. Tested
runs at 150 and 250 operations/s failed the stricter save/flush/replay p99
gates; the 250 runs also dropped iterations. The shared laptop was heavily
loaded, and the 50-ops/s point was not repeated. These are diagnostics, not a
supported headcount. No target-topology envelope exists yet; do not announce a
capacity or change deployment flags from these local results.

## Safety

- Run only against an isolated database whose rows are all synthetic. Never
  point the load at a schedule that has real candidates.
- `k6/ielts-throughput.js` refuses to start unless `K6_CONFIRM_IELTS=true`,
  `K6_CONFIRM_IELTS_TARGET` equals the `host:port` of `K6_BASE_URL`, and the
  credential file says `"synthetic": true`. Do not bypass these guards.
- The credential file holds bearer tokens. Keep it out of the repository,
  delete it after the run, and never paste tokens into tickets or chat.
- Build indexes (migrations 0102, 0103) outside an exam window.

## What the run does

One run admits N synthetic candidates (`IELTS_THROUGHPUT_K6_ROOMS` rooms,
round-robin) to a live Listening section with personal timing and drives
three phases, one k6 invocation each:

1. **ready**: every candidate posts readiness twice. The retry must return the
   same persisted start and deadline.
2. **steady**: open-loop arrival rate. Each iteration is a one-answer save,
   a 20-answer flush (5%), an exact replay (5%) or a runtime poll (20%); answers
   follow `"ABCD"[version % 4]`. Staff sweepers page the whole roster every 2 s
   and the background worker runs in-process. `dropped_iterations` must be 0:
   the generator may not slow down because the server did.
3. **submit**: the sections are ended, then each candidate submits and
   resubmits; the retry must return the same digest and submission ID.

Afterwards the verifier reconciles every candidate against the database,
independently of the server's own digests: one Listening timeline with its
full allowance, one sealed submission, response revision equal to applied
rows, unique server revisions, projection equal to the newest applied version,
the expected answer per question, and `final_submission` equal to the
projection. A missing or wrong candidate fails the run; percentiles cannot
hide it.

k6 thresholds (any breach fails the run): zero operation failures, zero
unexpected 5xx (any status ≥500 other than 503, including proxy 502s), ready
p95 <1 s / p99 <2 s, save/flush/replay p99 <1 s, submit p95 <1 s / p99 <2 s.
The older gates in `k6/ielts-personal-timing-500.js` remain the full-flow
gate.

## Local harness

From `backend/go`, against an isolated database migrated through 0103:

```bash
TEST_MYSQL_DSN='root@unix(/tmp/mysql.sock)/ielts_throughput_it?parseTime=true&loc=UTC' \
IELTS_THROUGHPUT_K6_USERS=500 IELTS_THROUGHPUT_K6_ROOMS=1 \
IELTS_THROUGHPUT_K6_RATE=250 IELTS_THROUGHPUT_K6_DURATION=2m \
IELTS_THROUGHPUT_K6_START_SPREAD=5 \
SAT_RECOVERY_K6_API_POOL=80 SAT_K6_API_INSTANCES=1 \
go test ./cmd/api -run '^TestIELTSThroughputK6MySQL$' -count=1 -v -timeout 30m
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `IELTS_THROUGHPUT_K6_USERS` | 500 | candidates (one VU each) |
| `IELTS_THROUGHPUT_K6_ROOMS` | 1 | rooms the candidates are spread over |
| `IELTS_THROUGHPUT_K6_RATE` / `_DURATION` | 50 / 2m | steady arrivals per second and length |
| `IELTS_THROUGHPUT_K6_ROW_FIRST` | off | `ROW_FIRST_WRITES` for the API |
| `IELTS_THROUGHPUT_K6_INTERPOLATE` | off | adds `interpolateParams=true` to the DSN |
| `IELTS_THROUGHPUT_K6_STAFF` | 2 | staff roster sweepers |
| `IELTS_THROUGHPUT_K6_START_SPREAD` | 0 | seconds to spread the ready and submit waves over |
| `SAT_RECOVERY_K6_API_POOL` | config default | API pool cap; the worker uses the config default (20) |

A laptop's accept backlog (`kern.ipc.somaxconn=128`) resets some dials when
500 VUs connect at once. The harness proxy turns a reset into a 502, which
fails the run even though the API never saw the request. Use a 5 s spread
locally. On a real target keep the default 0 (synchronized wave) unless the
load balancer's own limits are what you are deliberately excluding, and record
the value either way.

## Against a staging target

Seed synthetic candidates admitted to a live personal-timing Listening section,
write the credential file
(`{"synthetic": true, "runId": "...", "candidates": [{"scheduleId", "attemptId", "token", "sectionKey", "questions"}]}`),
then run each phase:

```bash
K6_CONFIRM_IELTS=true K6_CONFIRM_IELTS_TARGET=staging.example.com:443 \
K6_BASE_URL=https://staging.example.com \
K6_ATTEMPT_TOKENS_PATH=/absolute/path/synthetic-ielts-creds.json \
IELTS_TP_MAX_VUS=500 IELTS_TP_PHASE=ready k6 run k6/ielts-throughput.js
# then IELTS_TP_PHASE=steady IELTS_TP_RATE=250 IELTS_TP_DURATION=10m
# then, after every synthetic section has ended, IELTS_TP_PHASE=submit
```

Then reconcile the attempts with the same checks as the harness verifier
(`TestIELTSThroughputK6MySQL`). k6 status codes alone do not prove durability.

## Qualification procedure

1. Freeze and record the build identity, the diff, flags, pool caps, engine
   version and durability settings (`innodb_flush_log_at_trx_commit`,
   `sync_binlog`), `max_connections`, and the fixture size. Do not weaken
   durability settings for a benchmark.
2. Run 500 candidates in one room with default flags. Repeat until two runs
   agree, then raise `RATE` until a threshold fails or `dropped_iterations`
   appears. The last passing rate is the baseline.
3. Repeat at the same rate with 25 rooms.
4. Compare each flag alone and then both together at the same rate and fixture
   (see Flags).
5. Only after 500 passes, run 2,000 candidates the same way.
6. Record for each run: successful logical operations/s, HTTP attempts/s, newly
   applied commands/s, retries/replays/rejects, p50/p95/p99/max per
   operation, dropped iterations, pool `wait_count`/`wait_duration` deltas,
   lock waits and deadlocks, and the worker's cycle lag.
7. Keep at least 30% of the measured steady-state capacity as reserve, and
   repeat the peak with one API replica lost before stating an envelope.

## Connection budget

```text
potential DB connections = sum(API pool caps, DB_POOL_MAX_API)
                         + sum(worker pool caps, DB_POOL_MAX_WORKER, embedded and standalone)
                         + instances overlapping during a deploy
                         + maintenance/failover reserve
```

Keep the total below the database's `max_connections`. Pool wait and database
lock wait are different queues: raising a pool cap can move the wait into
MySQL. The local runs used API 80 + worker 20 + harness connections against
`max_connections=151`.

## Flags

| Change | How to enable | Rollback |
| --- | --- | --- |
| One-pass snapshot ownership (`snapshotOwnersFor` in `cmd/api/handlers_v2.go`) | Shipped; no flag | Revert the patch. No stored data changes. |
| Roster page index (0102) and runtime status index (0103) | Migration | The code works with or without them: the roster hint is ignored with a warning when the index is absent. Dropping either index is safe for the code, but rebuilds must happen outside an exam window. |
| `ROW_FIRST_WRITES=on` | API and worker env, together | **Not a plain flag flip.** With it on, compatibility blobs may lag the rows. Keep row-aware readers and seals deployed, or materialize and verify the affected protocol-2 blobs under the attempt lock before restoring blob-dependent paths. Never run old blob-authoritative binaries against row-first attempts. |
| `interpolateParams=true` | Driver option in every DSN that serves the API and worker | Remove the option. Only the wire protocol changes; the data model does not. |

Enable a flag only on a fresh synthetic or practice cohort first, with API,
worker and readers configured the same way. Reject promotion on any ACK,
hash, authorization or timer mismatch, any lost answer, or a repeatable
latency regression at the same offered load.

## Local envelope (diagnostic only)

Apple M1, 8 cores, 8 GiB, shared desktop (load average 6–16), MySQL 9.6.0 over
a unix socket with a 128 MiB buffer pool, `innodb_flush_log_at_trx_commit=1`,
`sync_binlog=1`. One API process (pool 80) and one in-process worker.

The passing 50-ops/s run completed readiness, steady saves/replays/polls,
submit/resubmit and independent database reconciliation for all 500 candidates:
10,225 answer rows were accepted and there were zero sealed-answer mismatches,
operation failures, unexpected 5xx responses, dropped iterations or API pool
waits. Steady p99 was 167 ms for single saves, 145 ms for flushes and 58 ms for
replays. Ready p99 was 148 ms and submit p99 was 73 ms.

| Offered rate | API pool | Row-first | Logical ops/s | Dropped iterations | Save / flush / replay p99 | API pool waits | Result |
| ---: | ---: | :---: | ---: | ---: | --- | --- | --- |
| 50/s | 80 | off | 49.59 | 0 | 167 / 145 / 58 ms | 0 / 0 s | Full E2E pass; 500 candidates reconciled |
| 150/s | 80 | off | 148.76 | 0 | 2.90 / 3.01 / 2.25 s | 9,141 / 40m00s | Failed p99 gates |
| 250/s | 80 | off | 242.81 | 618 | 4.05 / 4.42 / 3.00 s | 9,494 / 24m44s | Failed p99 and dropped-iteration gates |
| 250/s | 120 | off | 242.81 | 620 | 4.38 / 4.89 / 2.02 s | 3,301 / 12m13s | Failed p99 and dropped-iteration gates |
| 250/s | 120 | on | 237.80 | 1,222 | 5.28 / 6.80 / 3.72 s | 13,899 / 1h10m13s | Failed; row-first did not improve this run |

The local MySQL was 9.6.0 with `max_connections=151`, a 128 MiB InnoDB buffer
pool, `innodb_flush_log_at_trx_commit=1`, and `sync_binlog=1`. A host-load
sample outside the passing run read 13.94/10.70/6.94 on 8 cores while unrelated
desktop processes were active; per-run CPU/load was not captured. See the run
report for exact test commands, full readiness/submit results and limits. The
50/s run is the only tested passing point, not a repeatable capacity baseline
or deployment envelope.

## Not yet qualified

- The target topology: real RTT, replica count, load balancer, and loss of one
  API replica during peak.
- Browser transition time (prepared section to usable page); k6 measures the
  API only.
- 2,000 candidates on anything but this laptop.
