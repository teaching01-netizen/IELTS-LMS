# Scale-proof k6 suite (plan E3)

Five scripts, one per proof obligation. All run against a staging box with
prod-shaped data (100k+ attempts) and the rolled-out flags
(`VERSION_CACHE=on ENTRY_GATE=on ROLLUP=on STUDENT_WS=gone`). Order matters:
preprovision first, then waves.

## 0. Fixtures

```bash
# Idempotent roster mint ahead of exam day (plan D3 ops):
go run ./cmd/preprovision -schedule <id> -registrations ./regs.csv
# regs.csv -> entry-wave.csv (wcode,email,fullName), attempt-tokens.json,
# question-ids.json, session-cookies.json, staff-cookies.json
```

## 1. Entry wave (D3 exit gate: 5k VUs, zero duplicate attempts)

```bash
k6 run k6/scale-proof/0_entry_wave.js \
  -e K6_BASE_URL=https://staging \ -e K6_SCHEDULE_ID=<id> \
  -e K6_ENTRY_CSV_PATH=./entry-wave.csv -e K6_VUS=5000
```

Pass: 200s + 429s-with-position only, zero 500s, `p99<5s`.
Follow with the dupe check: submit one wcode twice, assert one attempt row.

## 2. Bootstrap herd (D1 exit gate: p99 < 2s at 2k concurrent)

```bash
k6 run k6/scale-proof/1_bootstrap_herd.js \
  -e K6_BASE_URL=https://staging \ -e K6_SCHEDULE_ID=<id> \
  -e K6_ATTEMPT_TOKENS_PATH=./attempt-tokens.json -e K6_VUS=2000
```

Pass: `p99<2s`, `failed<1%`, second-leg 304s. Singleflight collapses
2k assemblies into ~1 (watch `version_cache_miss_total` ~= 1/wave).

## 3. Save contention (B1 exit gate: 500-way, zero deadlocks)

```bash
k6 run k6/scale-proof/2_contend.js \
  -e K6_BASE_URL=https://staging \ -e K6_SCHEDULE_ID=<id> \
  -e K6_ATTEMPT_TOKENS_PATH=./attempt-creds.json \
  -e K6_QUESTION_IDS_PATH=./question-ids.json
```

Pass: zero 500s, zero deadlock-coded bodies. Unit twin:
`TestConcurrentDistinctQuestionsAllAccepted` (500 goroutines, mock DB).

## 4. Poller simulation (C3 exit gate: >90% 304)

```bash
k6 run k6/scale-proof/3_pollers.js \
  -e K6_BASE_URL=https://staging \ -e K6_SCHEDULE_ID=<id> \
  -e K6_SESSION_COOKIES_PATH=./session-cookies.json \
  -e K6_VUS=1000 -e K6_DURATION=5m
```

Pass: `poll_not_modified_rate>0.9`, poll `p99<500ms` (snapshot-cache hit),
zero 500s. 1k VUs x 20s cadence samples the 100k-poller shape (5k rps).

## 5. Staff WS soak (C1 exit gate: students gone, staff stable)

```bash
k6 run k6/scale-proof/4_ws_staff_soak.js \
  -e K6_BASE_URL=https://staging \ -e K6_SCHEDULE_ID=<id> \
  -e K6_STAFF_COOKIES_PATH=./staff-cookies.json \
  -e K6_STUDENT_COOKIE='session=...' -e K6_VUS=50 -e K6_DURATION=10m
```

Pass: student HTTP probe 410 + `{use: runtime-poll}`; staff 101s hold
10m with pings, no abnormal closes.

## Dashboard watch (plan E3: existing `telemetry.*` registry)

`version_cache_hit/miss_total`, `presence_touch/flush_total`,
`entry_gate_admit/queued_total`, `proctor_rollup_refresh_total`,
`shed_exam_requests_total`, `query_budget_exhausted_total`,
`db_deadlocks_total`, `http_ratelimit_denied_total{tier}`,
`outbox_pending/oldest_age`, pool waits split API/worker.
