# SAT Module 1 → Module 2 handoff

Deploy migrations `0074` and `0075` before the new API and student client. Existing runtimes keep their captured mode; NULL means `server_start`. Set these values before starting a new personal SAT runtime:

```dotenv
SAT_HANDOFF_MODE=client_start
SAT_PERSONAL_CLOSE_WINDOW_SECS=15
SAT_M2_AUTO_START_SECS=60
SAT_RECONCILE_CONCURRENCY=4
```

Personal reconcile concurrency is capped at `DB_POOL_MAX_WORKER - 2`, with a minimum of one. Ensure the worker pool has headroom for the configured concurrency. Live/cohort timing keeps its existing three-second save grace.

Before the exam, verify the schedule uses `sat_personal_v1` and check the started runtime:

```sql
SELECT schedule_id, timing_model, sat_handoff_mode, status
FROM exam_session_runtimes WHERE schedule_id = '<schedule-id>';
```

The runtime must report `sat_personal_v1` and `client_start`. Do not enable this flow for legacy cohort schedules. Verify the shared-IP check-in rate limit supports at least 3,000 requests during the planned arrival window; this rollout does not change that limit.

At zero, the browser freezes Module 1 input, flushes its final writes, and confirms their versions through `/modules/close`. The server routes under the same attempt lock as answer writes. Without confirmation it routes after the 15-second window. Routed Module 2 has no running clock or question content until `/modules/start` delivers the selected content. Its 60-second backstop runs only while the runtime and student are unpaused.

“Starting Module 2” persisting beyond 60 seconds calls for a device/network check. A backstop start begins the clock even if the device remains disconnected. On reconnect, Module 1 rejections preserve the local draft and do not disable Module 2. “Late Module 1 answer” alerts require review of the stored evidence and scored route. Evidence can flag a route difference but never changes the assigned branch or canonical scored responses. Follow the institution’s review policy; do not manually reroute an active attempt.

Check `/metrics` and `backend/monitoring/prometheus-alert-rules.yml`: route lag p99 ≤ W+5 seconds, client-start lag p99 ≤ 5 seconds, auto-starts ≤ 1% of routes, scoped rejections ≤ 0.5% of closes, and no unreviewed route-changing late evidence. The initial route-lag alert assumes W=15; update its threshold when changing W. Histograms use seconds. Logs/audits use attempt/module identifiers, never answer content in telemetry.

For rollout acceptance, provision 400 synthetic attempts on one shared runtime, with the same Module 1 deadline and distinct credentials. Each credential JSON entry contains `attemptId`, `token`, `moduleId`, `moduleAttemptId`, `expectedModuleId`, `otherModuleId`, and 1–3 final `answers` (`questionId`, `answer`, increasing positive `clientVersion`). Keep this file outside version control.

```bash
K6_BASE_URL=https://staging.example.com \
K6_SCHEDULE_ID=<schedule-id> \
K6_ATTEMPT_TOKENS_PATH=/secure/synthetic-attempts.json \
K6_WAVE_AT_MS=<shared-deadline-unix-ms> \
K6_VUS=400 \
K6_FINAL_SAVE_DELAY_MS=4000 \
k6 run k6/sat-m1-m2-handoff.js
```

Use freshly seeded attempts for each run. Run a `server_start` baseline with `K6_BASELINE=1`, then the new flow at 1–2, 4, and 8 seconds of final-packet delay. The harness checks final write durability, single routing, withheld content, and compressed start response time. HTTP receipt is a proxy for rendering: separately measure browser `sat_first_answerable_frame_at.m2AllotmentDeltaSeconds` (p99 ≤ 2 seconds). Run real shared Wi-Fi/latency checks, an offline student through W, and a reload during handoff. Record route lag from the API histogram, database pool utilization, lock waits, and gzip transfer size. Do not declare the N=400 or exam-network gates passed from unit tests.

Rollback: set `SAT_HANDOFF_MODE=server_start` for newly started runtimes. Existing `client_start` runtimes retain their mode and backstops; keep the new API deployed until they finish. Leave both additive migrations in place. Deploy the new client before enabling `client_start` to avoid old clients relying on the backstop.
