# SAT exam-day burst preset and freeze policy

Rehearsal and exam-day posture for the SAT Math + Desmos burst (plan
`docs/plans/2026-11-04-sat-desmos-burst-subagent-e2e-plan.md`, Track B).
All controls on this page are **environment and procedure only**: ship
defaults in code stay off, and the rollback is an env flip plus redeploy.
No pool auto-tuning, no Desmos proxy, no scoring or timing-model change.

## 1. Exam-day preset (env only — no ship-default flips)

| Env | Preset | Ship default | Notes |
|---|---|---|---|
| `ENTRY_GATE` | `1` | off | Per-schedule check-in bucket; over-limit check-ins get bounded 429 + Retry-After instead of a DB conflict storm. |
| `ENTRY_PER_SEC_PER_SCHEDULE` | `500` | `500` | Sustained admissions per schedule; keep unless the rehearsal measures headroom. |
| `ENTRY_BURST` | `2000` | `2000` | Burst absorbency per schedule (≈ one room). |
| `DB_POOL_MAX_API` | `40` | falls back to `DB_POOL_MAX_CONNECTIONS` (`20`) | Raise only from rehearsal pool-wait data; starts take half, closes a quarter (see service comments). |
| `DB_POOL_MAX_WORKER` | `10` | falls back to `DB_POOL_MAX_CONNECTIONS` (`20`) | Worker share stays small so student traffic keeps connections during a wave. |
| `OUTBOX_CLAIM_MODE` | `skiplocked` | `update` | Skip-locked claiming so parallel workers do not serialize on one row. |
| `WORKER_CLAIM_PARTITIONS` | `>= 2` | `1` | Partitioned claiming consumers; raise with worker count. |
| `VERSION_CACHE` | `1` | off | Singleflight bootstrap fast path off the hot N+1 reads. |
| `RUNTIME_SNAPSHOT` | `1` | off | Zero-SQL runtime gate on the poll path. |
| `HTTP_WRITE_TIMEOUT_SECS` | `>= 30` | `30` | Never below 30: tighter values sever slow-but-healthy admissions. |
| `SHED_MODE` | `exam` | off | Rebalances tier budgets toward submit/seal/autosave (writes never shed) at the expense of poll/heartbeat/admin reads. |

Record the rehearsal deltas (pool waits, version-cache hit ratio, shed
rate) in the rehearsal log before freezing these values.

## 2. Pre-rehearsal dump (close the Unknowns)

Before the first burst run, dump the production-representative env and the
pool signals and attach them to the rehearsal log:

1. The full process env for every API and worker instance (redacted of
   secrets), plus the binary build SHA per instance.
2. `db_pool_wait_count`, `db_pool_wait_seconds_total`, `db_pool_open`,
   `db_pool_in_use`, `db_pool_max_open` over a quiet 10-minute window.
3. `version_cache_hit_total` / `version_cache_miss_total` ratio,
   `runtime_snapshot_hit_total` / `runtime_snapshot_miss_total` ratio.
4. `outbox_pending`, `outbox_oldest_age_seconds`, `sat_timeout_finalize_total`.

## 3. Rehearsal matrix (bell-burst, single schedule)

All runs target **one isolated staging schedule**; never a live schedule.
`K6_CONFIRM_SAT=true` is mandatory.

```bash
# 500-student smoke, preset ON (60s bell window)
K6_CONFIRM_SAT=true K6_BASE_URL=https://staging.example K6_SCHEDULE_ID=<staging-sched> \
  K6_TARGET_PATH=./e2e/prod-data/prod-target.json K6_CREDS_PATH=./e2e/prod-data/prod-creds.json \
  K6_BELL_BURST=true K6_STUDENTS=500 K6_STUDENT_JITTER_MAX_SECONDS=60 \
  k6 run k6/sat-exam-day.js

# 2000-student FR-03 gate, preset ON (target file must hold 2000 students)
K6_CONFIRM_SAT=true K6_BASE_URL=https://staging.example K6_SCHEDULE_ID=<staging-sched> \
  K6_TARGET_PATH=./e2e/prod-data/prod-target.json K6_CREDS_PATH=./e2e/prod-data/prod-creds.json \
  K6_BELL_BURST=true K6_STUDENTS=2000 K6_STUDENT_JITTER_MAX_SECONDS=60 \
  k6 run k6/sat-exam-day.js
```

Run each size preset ON and preset OFF and record the delta. Gate (FR-03):
bootstrap p99 < 5s, response-ack p95 < 2s, handoff p99 < 5s, submit
p99 < 30s, with shed only as bounded 429/503 + Retry-After. The k6 run
asserts these thresholds; `sat_entry_shed_retries` reports the shed rate
for the log. Steady (non-burst) runs use the same file without
`K6_BELL_BURST`; their thresholds are identical values.

## 4. Visible-queue contract (what the client honors)

- 429/503 responses carry `Retry-After` (header, floored at 1s) plus
  `details.retryAfterSeconds`. Tier denials add `details.tier` and the
  `X-RateLimit-Tier` header.
- Shed paths that know their queue add the **additive** position detail:
  `details.queueDepth` (zero-based position at denial time) plus the
  `X-Queue-Depth` header. Currently only the SAT close bulkhead reports
  it (`tier: sat-close`); every other shed path omits both fields, and
  clients must fall back to Retry-After alone. Unknown queue is never
  rendered as zero — zero means head of queue.
- Client behavior: queue UI shows "waiting — retrying in Ns" honoring the
  server Retry-After plus jitter; 5xx without Retry-After is a fault UI
  with no retry. 429s bypass the access log by design; the observability
  path is `http_ratelimit_denied_total{tier,key_class}` plus the deny log
  line (which carries `queue_depth` when known) and, under exam budgets,
  the `shed_exam_requests_total` slice.

## 5. Desmos beacon contract and Math-window board

- `POST /api/v1/sat/desmos-outcome`, attempt bearer. Body:
  `{scheduleId,attemptId,moduleAttemptId,mode,outcome,durationMs,buildSHA}`;
  mode in `scientific|graphing`, outcome in `ready|timeout|blocked|error`.
- Errors: `400` invalid or identity mismatch (client drops), `429` shed
  from the writes/attempt tier (client drops, **no retry storm** — a
  beacon must never amplify a burst). The endpoint never writes to the
  database; during a database outage bearer verification degrades like
  every other student-bearer endpoint, so note the gap on the board
  rather than reading it as calculator health.
- Series (closed vocabularies only; ids stay in the log line, never in a
  label): `sat_desmos_outcome_total{outcome,mode}` and the
  `sat_desmos_ready_seconds` ready-latency histogram (`{mode}`).

Suggested board/alert expressions (paste into the Math-window board; the
alert-parity pin requires every alerted series to be emitted — both are):

```
# Ready rate (page < 0.99 over 5m, incident < 0.95)
sum(rate(sat_desmos_outcome_total{outcome="ready"}[5m]))
  / sum(rate(sat_desmos_outcome_total[5m]))

# Ready p95 by mode
histogram_quantile(0.95, sum(rate(sat_desmos_ready_seconds_bucket[5m])) by (le, mode))

# Shed pressure + pool/consumers alongside
sum(rate(http_ratelimit_denied_total[5m])) by (tier)
sum(rate(shed_exam_requests_total[5m]))
sum(rate(query_budget_exhausted_total[5m]))
outbox_pending / outbox_oldest_age_seconds
```

## 6. Deploy/publish freeze policy

- Freeze window: no API/worker deploys, no exam publish or room-operation
  changes from 60 minutes before the first scheduled Math entry until the
  last room on the fleet completes. A deploy or publish during Math
  re-mounts clients and regrows the Desmos herd the preset just absorbed.
- Rollback is a freeze too: rolling back re-mounts the same clients.
  Prefer forward fix on a frozen fleet; keep the compatible API, worker,
  and maintenance binaries available until every admitted attempt is
  complete or explicitly resolved.
- Audit: every deploy, publish, room create/rotate, and preset change in
  the window goes to the incident record with actor, build SHA, and
  before/after env.

## 7. Config fingerprint (per instance, every rollout)

1. At deploy time, hash the redacted process env
   (`env | grep -v -iE 'secret|token|password|key=' | sort | sha256sum`)
   and record it next to the binary build SHA in the deploy log.
2. On exam morning, scrape `/metrics` once per instance and confirm the
   fingerprint in the log matches the frozen rehearsal fingerprint.
3. Any mismatch stops admissions: re-freeze on the rehearsed values
   before the bell, never during it.
