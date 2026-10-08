# Railway Serverless Plan — IELTS LMS

- **Status:** Proposal for review; no application code changed in this revision
- **Repository baseline:** 1043f205
- **Reviewed:** 1 Oct 2026
**Scope:** IELTS LMS Railway application service; database service remains always on

## 1. Goal and decision

Reduce idle application traffic, database connections, and memory use while preserving exam, authoring, delivery, grading, and maintenance behavior.

The current service is not ready for Railway Serverless. Several independent loops generate outbound traffic, and the current activity-driven worker mode skips required jobs while retaining timeout polling. More importantly, a database probe cannot wake a sleeping service: every producer of work needs a wake path.

**Recommended direction**

- Keep production behavior and Railway Serverless unchanged until the gates in this plan pass.
- Implement an opt-in activity-driven mode; leave continuous mode as the default and rollback target.
- Make a complete obligation and wake-source inventory the first engineering gate.
- Use demand-driven database-bus polling as the default live-update design.
- Treat scheduled exam wake-ups and first-request cold-start behavior as product and operations decisions. A five-minute cron is best effort, not an exam reliability guarantee.
- Initially enable Railway Serverless only in staging and non-exam production windows with an accepted cold-start experience.

## 2. Railway behavior that constrains the design

Verified against the current Railway documentation:

| Behavior | Planning consequence |
| --- | --- |
| Serverless considers outbound packets when detecting inactivity; the threshold is five minutes and checks are sampled. Actual sleep can take about five to ten minutes after the last outbound packet. | Measure packets from the deployed container and allow for a variable sleep delay. Do not promise an exact sleep time. |
| Replies to inbound requests count as outbound traffic. Private-network traffic also counts, even though Railway's public network metrics do not show it. | A local file beacon can notify the worker without network traffic; an HTTP self-beacon cannot. Health checks, cron requests, API replies, DB traffic, and private-network calls must be considered separately. |
| The first request to a sleeping service may return 502 while it wakes. | Startup retries can help API calls after JavaScript loads, but cannot repair the initial HTML document request. |
| The setting applies to all replicas, takes effect on a newly created container, and a sleeping service retains its infrastructure slot. Railway also documents rare cases where a rebuild is needed to recover a sleeping service. | Verify the setting after redeploy. Keep a tested redeploy runbook and do not use replica count as a substitute for worker coordination. |
| Railway Cron has a five-minute minimum interval, runs on UTC schedules, requires the job to exit, and skips a run if its prior run is still active. | Cron is a best-effort wake source. It cannot guarantee exact deadline processing or strict exam readiness. |

Sources: [Railway Serverless](https://docs.railway.com/deployments/serverless), [Railway Cron Jobs](https://docs.railway.com/cron-jobs), [Pre-deploy Command](https://docs.railway.com/deployments/pre-deploy-command), [Config as Code reference](https://docs.railway.com/config-as-code/reference).

## 3. Current repository findings

The production container starts migration, API, Hocuspocus, and worker processes from the backend Docker startup script. Railway uses the repository’s railway.json, which currently has a Dockerfile, /healthz health check, and restart policy; it has no pre-deploy command or drain setting.

| Source | Current behavior | Required treatment |
| --- | --- | --- |
| backend/go/cmd/worker/main.go | Personal timeout reconciliation runs every second. SAT timeout reconciliation runs every five seconds. Hot work includes outbox draining, grading projection, and section reconciliation; maintenance includes repairs, retention, and media work. The timeout-only mode returns before hot and maintenance work. | Classify every loop and job by deadline, active-work predicate, and acceptable lateness. Do not reuse timeout-only mode as the idle worker. |
| backend/go/cmd/api/authoring_coedit_orchestration.go and backend/go/internal/authoring/coedit_lifecycle.go | When co-edit is enabled, a recovery loop runs on a 30-second cadence and performs database-backed freeze and workspace recovery. This loop was absent from the earlier poller inventory. | Include it in the obligation inventory. Replace unconditional polling only after proving request-triggered recovery and boot catch-up preserve freeze and workspace correctness. |
| backend/go/cmd/api/handlers_ws.go | The default database live bus polls for new events every 250 ms, or 500 ms in low-profile mode. Direct mode disables the cross-process forwarder. | Prefer demand-driven polling while at least one hub subscriber exists. Retain database-bus semantics unless the direct-mode trade-offs are explicitly accepted. |
| services/authoring-coedit/src/singletonLock.ts | The co-edit process polls its MySQL singleton lock every five seconds. | Lazy start and orderly shutdown must release the lock and close the connection. |
| backend/go/internal/platform/db/db.go | The API pool uses configured maximum idle connections, but connection idle lifetime is hard-coded to five minutes. The example DB_POOL_IDLE_TIMEOUT_SECS value is not loaded. | Wire one canonical idle-timeout setting and verify every process pool closes idle connections. Do not disable keepalive for live connections without measured need. |
| backend/go/internal/platform/config/config.go | IDLE_GRACE_SECS is parsed into configuration but not consumed by the Go worker. BACKGROUND_RUNTIME_MODE is parsed and validated, while Go worker behavior does not use it. | Reuse and wire the existing idle-grace setting; make the mode select the worker state machine. Avoid introducing a duplicate grace variable. |
| backend/go/cmd/api/main.go and backend/Dockerfile | Startup migration currently runs before application children. The API also verifies runtime schema and media configuration before it begins listening. | Moving migrations to pre-deploy reduces boot work but does not remove all cold-start delay. Preserve runtime schema verification. |
| backend/go/internal/platform/shutdown/shutdown.go and the /app/start.sh script embedded in backend/Dockerfile | API drain timeout is 30 seconds. The shell waits for child exit; an idle child must not exit as a way to represent quiescence. | Keep the worker alive in a quiescent state. API shutdown must stop and reap any lazy co-edit child within the Railway termination window. |
| Backend WebSocket admission and handlers | Open sockets send 25-second pings and default database admission refreshes a 30-second lease. | Active sockets are real activity and should keep the service awake. Confirm their shutdown and reconnect behavior. |
| Frontend API/query clients | Retry behavior exists at more than one layer. API wrappers and React Query have different defaults; some mutations can be retried. | Define one bounded cold-start retry policy. Do not retry a mutation unless its idempotency behavior is proven. |

### Corrections to the previous draft

1. The co-edit recovery loop is another database poller and must be included.
2. Do not cap obligation searches to rows touched in the last 24 hours. A valid, nonterminal obligation can be older and still require work. Use domain expiry/terminal predicates and indexed existence queries. Route terminal failures to alerting or operator work unless automatic retry is explicitly defined.
3. A schedule query for work starting within the next 30 minutes can keep an already-awake service active. It cannot wake a sleeping service. Scheduled obligations need a separate, tested wake source.
4. A worker that only checks a local beacon in QUIESCENT cannot discover a database write made by an independent process that does not signal it.
5. The old seven-to-twelve-minute sleep estimate omitted the five-minute co-edit idle-exit window and other connection/grace periods. Measure the complete path instead of promising a fixed interval.
6. The old B1 live-bus configuration can remove worker-to-API live event forwarding and assumes no overlapping API instances. A rolling deployment can create overlap even when steady-state replica count is one.

## 4. Required invariants

These are release gates, not implementation preferences:

1. **Every obligation has a wake owner.** For each action that creates, advances, or schedules background work, identify the process that writes it and the event that wakes the worker. Direct database writers without a wake path block Serverless rollout.
2. **Fail awake.** If an obligation query, activity signal, or state transition fails, do not enter QUIESCENT. Emit an actionable alert. Recovery from an already sleeping service must use ingress or an external wake source, not a database probe from the sleeping process.
3. **No arbitrary recency cutoff.** Obligation queries use domain state and expiry, with indexes and bounded execution time. A row is not ignored merely because it is old.
4. **Catch-up is safe.** Jobs run idempotently or have deduplication/lease semantics. Startup and wake catch-up must not duplicate outbox execution, grades, terminal receipts, submissions, or co-edit recovery.
5. **Quiescence means no network work.** In QUIESCENT, the worker may check a local signal file or in-process state, but must not poll the database, call an HTTP beacon, emit telemetry, or maintain idle network connections.
6. **Exam timing is explicit.** Any deadline that cannot tolerate Railway wake delay must keep the service warm through a reliable policy or use an always-on execution path.
7. **Defaults preserve current behavior.** Continuous mode stays the default. Every new behavior is opt-in until staging evidence passes.

## 5. Target runtime design

Use two configured modes and three runtime states.

| Mode/state | Behavior |
| --- | --- |
| continuous mode | Preserve current worker cadence and job behavior. This is the default and immediate rollback mode. |
| activity-driven / ACTIVE | Run required timeout, hot, outbox, and maintenance jobs. Probe obligations on a bounded cadence. Any probe error keeps the worker ACTIVE. |
| activity-driven / QUIESCING | Stop entering new maintenance work, finish or safely checkpoint in-flight work, then run two successful empty-obligation probes separated by a short interval. Confirm no new local activity signal arrived across the transition. |
| activity-driven / QUIESCENT | Make no network calls. Check only a local activity signal. Keep the process alive. |
| activity-driven / wake | On process boot or a new local signal, run bounded catch-up, then return to ACTIVE. A request to a sleeping Railway service may fail before application middleware runs, so boot catch-up is mandatory. |

### Local activity signal

The API and worker run in the same application container, so a local file signal is a viable low-cost wake mechanism for in-container API requests. The API should signal at request entry and completion for routes that can create or advance worker obligations. The worker checks the file timestamp or generation locally while quiescent. Skip health-only routes for worker activity, while remembering that Railway may still count their network responses as outbound packets.

Signal failure must be observable and must not silently accept work that relies on the worker. Define how mutation routes fail before committing if their required signal cannot be delivered. Keep an in-flight request marker so the worker cannot quiesce during a long request. If the post-commit signal fails, use a proven wake fallback or keep the worker ACTIVE and alert; do not treat a successful database commit as proof that the worker was notified. Requests from scheduled jobs, webhooks, separate services, or direct database writers need their own signal path. The local file does not cover them.

### Obligation catalogue

Phase 0 must confirm exact predicates and indexes for at least:

- Active SAT modules and personal timing that still require timeout reconciliation.
- Live exam runtimes, sections, and breaks with pending transitions.
- Pending outbox events, with failed terminal rows separated from retryable pending work.
- Co-edit freezes and workspaces requiring recovery.
- Scheduled exam starts or other timed transitions, with a separately owned wake source.
- Grading/projection and terminal-repair work that is pending or overdue.
- Retention, media cleanup, and other maintenance, with an agreed maximum delay.

Implement the catalogue as bounded indexed existence checks returning reason codes. Use domain terminal/expiry semantics. Validate query plans and worst-case latency on staging data. Do not run these queries in QUIESCENT.

### Producer-to-wake matrix

Before coding the state machine, complete this table from actual writers and runtime paths:

| Producer | Obligation created/advanced | Wake path | Owner | Verified |
| --- | --- | --- | --- | --- |
| Student, proctor, or staff API request | Exam, timeout, outbox, grading, or section work | Local signal at request entry/completion; Railway ingress wakes a sleeping container | API | No |
| Co-edit operation | Freeze/workspace recovery | API proxy/control request signals worker; co-edit callbacks must be mapped | API/co-edit | No |
| Scheduled exam start | Timed exam work | External schedule-aware wake before the deadline; a database query after wake only holds the service open | Product/ops decision | No |
| Railway Cron or external webhook | Depends on job payload | Must call a bounded wake endpoint and retry/alert on cold-start failure | Ops | No |
| Direct database or separate service writer | Depends on writer | Explicit cross-service wake event or prove no such writer exists | TBD | No |

“Verified” means the path was exercised while the application service was asleep or quiescent, not just while the worker was ACTIVE.

## 6. Workstreams and order

### Phase 0 — Close requirements and inventory

- Recheck every repository reference in this plan against the implementation branch.
- Enumerate every loop, timer, job, event producer, webhook, direct DB writer, and scheduled transition.
- For each job, record its predicate, required deadline, retry/idempotency behavior, and maximum acceptable lateness.
- Decide the first-request HTML behavior, cold-start latency/error SLO, exam warm-up policy, maintenance lateness, and who owns the exam calendar.
- Baseline idle packets, SQL activity, open DB connections, memory, startup time, migration time, and recovery behavior in staging.
- Verify Railway treatment of container TCP keepalives, health checks, local traffic, private-network calls, and any mounted-volume behavior using the production-shaped image.

**Gate:** No implementation of QUIESCENT until the producer-to-wake matrix is complete and product/ops accept the cold-start and exam policy.

### Phase 1 — Safe activity-driven worker

- Make BACKGROUND_RUNTIME_MODE select the Go worker behavior; keep continuous as the default.
- Build the obligation catalogue and reason-coded logs/metrics.
- Include all timeout, outbox, grading, terminal-repair, co-edit recovery, and maintenance paths. Do not carry forward the current timeout-only mode as the activity-driven implementation.
- Add ACTIVE, QUIESCING, and QUIESCENT states with bounded probes, local signal handling, fail-awake behavior, and idempotent boot/wake catch-up.
- Preserve the current cadence and behavior in continuous mode.
- Add per-job tests for active obligations, empty state, expired state, query error, wake races, repeated catch-up, and shutdown during in-flight work.

**Gate:** In staging without Railway Serverless, prove continuous mode matches baseline and activity-driven mode executes every classified job correctly.

### Phase 2 — Producer signals and timed wake policy

- Implement the local API-to-worker signal with explicit signal failure behavior.
- Wire every discovered producer. Do not mark the matrix complete based only on API middleware if jobs can originate elsewhere.
- Choose the scheduled-wake implementation. If the only option is Railway Cron, treat it as best effort, schedule with a measured lead time beyond the obligation window and cold-start p99, retry boundedly, and alert on failure.
- Keep the application warm during active exams unless the measured wake path meets the product SLO with a documented margin.
- Do not rely on a “next 30 minutes” database query to wake the application.

**Gate:** For every producer, demonstrate that a new obligation wakes the worker from QUIESCENT; for scheduled work, demonstrate wake from actual Railway sleep and record lateness.

### Phase 3 — Connections, co-edit, and live bus

- Wire DB_POOL_IDLE_TIMEOUT_SECS or remove it from examples. Use one canonical idle-grace setting; reuse IDLE_GRACE_SECS unless a deliberate migration is needed.
- Close idle connections in every process pool when entering QUIESCENT. Verify idle connection counts and outbound packets; do not infer sleep readiness from an empty SQL query log.
- Make co-edit lazy-start opt-in. The Go API supervisor should single-flight starts, wait for readiness, and stop/reap the process only after zero sockets and no freeze work. Shutdown must flush stores, release the singleton lock, and close database connections within the API/Railway drain budget.
- Precompile co-edit TypeScript in the image build rather than invoking tsx compilation on each cold start.
- Make live-bus polling demand-driven: start when the first subscriber arrives and stop after the last leaves, with a tested subscribe/restart cursor handoff that cannot miss required events.
- Keep LIVE_BUS=db as the initial production default. Use LIVE_BUS=direct plus OUTBOX_EXEC_ONLY only after proving cross-process delivery is unnecessary during deploy overlap and accepting the fallback polling latency.

**Gate:** Demonstrate no idle DB/network activity after grace, no lost live updates at subscriber transitions, co-edit persistence across stop/start, and correct singleton-lock release.

### Phase 4 — Startup, migrations, client behavior, and shutdown

- Move migrations to Railway pre-deploy after staging proves the command works with the deployed image, environment, private database access, and no volume dependency. The pre-deploy command runs separately, has no volume, and blocks deployment on failure; choose a timeout from measured migration p99 plus lock-wait margin.
- Keep VerifyRuntimeSchema in API/worker startup. Preserve additive/expand-contract migration compatibility because a migration can succeed even if the application deploy later fails; do not plan to reverse schema changes as the rollback.
- Measure remaining cold boot after migration is moved: API schema checks and media validation still happen before listen.
- Align Railway termination/drain configuration with the API’s 30-second drain, co-edit flush, worker stop, and child reaping.
- Consolidate frontend retries into one bounded waking policy for safe reads. Do not blindly retry mutations; require idempotency keys or endpoint-specific proof.
- Set the cold-start UI and document-request behavior. JavaScript cannot retry the initial HTML navigation before it loads. Decide whether users accept a transient document error, an always-on front door/CDN, or no Serverless for that surface.

**Gate:** A failed pre-deploy command leaves the previous app serving; a successful deploy passes schema verification; shutdown loses no accepted work; cold-start behavior meets the agreed SLO.

### Phase 5 — Staging Serverless and production pilot

- Enable Serverless only for staging through Railway’s supported service setting, then redeploy and verify the setting applies. Do not add an undocumented sleepApplication key to railway.json.
- Config as Code is deprecated with existing files supported only until 1 Dec 2026. Track migration of service configuration to Railway’s supported IaC path before that date.
- Test actual sleep, first-request failure/wake, retry behavior, scheduled wake, health checks, co-edit, WebSockets, and worker catch-up using the production-shaped image and data volume.
- Pilot production only outside exam windows, with rollback staff present and alerts active.
- Expand only after product/ops accept measured cold-start latency, failure rate, sleep delay, scheduled-work lateness, and database cost impact.

## 7. Configuration and ownership

| Setting | Plan |
| --- | --- |
| BACKGROUND_RUNTIME_MODE | continuous remains default; activity_driven is opt-in after Phase 1 |
| IDLE_GRACE_SECS | Reuse and wire the already parsed setting for worker idle grace; do not add BACKGROUND_IDLE_GRACE_SECS without a migration reason |
| DB_POOL_IDLE_TIMEOUT_SECS | Wire to the DB pool or remove the dead example. Pick one value based on measured quieting and reconnect cost |
| DB_POOL_MAX_IDLE | Keep bounded and configure consistently for every process |
| LIVE_BUS | Keep db by default; add demand-driven lifecycle before considering direct |
| AUTHORING_COEDIT_LAZY_START | New opt-in flag; default off until co-edit lifecycle QA passes |
| AUTHORING_COEDIT_IDLE_EXIT_SECS | New setting only if needed; choose from measured store flush and edit-recovery bounds |
| Railway Serverless | Configure using Railway’s supported setting, redeploy, and verify the deployed service |
| Pre-deploy migration | Configure after staging validation; do not disable boot migration until pre-deploy is proven |

Remove or wire stale BACKGROUND_COMMAND_QUEUE_CAP, BACKGROUND_WAKE_TIMEOUT_MS, and DB_POOL_IDLE_TIMEOUT_SECS references. Do not create duplicate controls for the same behavior.

## 8. Acceptance and release gates

Record baseline and candidate measurements with build SHA, Railway environment, replica count, image, test timestamps, and logs.

| Area | Acceptance evidence |
| --- | --- |
| Compatibility | Continuous mode runs the same jobs at the current cadence; rollback to continuous requires no schema reversal. |
| Obligation correctness | Every catalogue predicate has active, terminal, expired, old-but-valid, query-error, and concurrent-write coverage. No arbitrary age cap causes a false empty result. |
| Wake completeness | Every producer in the matrix wakes a quiescent worker. Scheduled wake is tested from actual Railway sleep and its lateness distribution is measured. |
| Idle behavior | After all configured grace and connection timeouts, there are no worker database probes, poller packets, HTTP beacons, or idle connections. Capture container counters plus Railway metrics because private traffic may be hidden. |
| Job recovery | Outbox backlog drains once, grading and terminal repairs converge, timed transitions stay within accepted lateness, and maintenance runs within its agreed window. |
| WebSockets/live bus | Existing clients receive required events at agreed latency. Test a subscriber joining while polling starts and reconnecting while polling stops. |
| Co-edit | Cold start is within the agreed budget; edits persist; idle stop flushes; singleton lock is released; process is reaped; API shutdown is bounded. |
| Cold start and UI | Test sleeping-service 502/network errors, safe-read retry budget, mutation deduplication, initial HTML behavior, and measured latency against the product SLO. |
| Migration/deploy | Pre-deploy failure blocks the new deployment without corrupting the running version; expanded schema supports old/new app overlap; runtime schema verification remains active. |
| Shutdown | Railway termination leaves no uncommitted accepted work, orphaned co-edit process, or held singleton lock. |

A fixed count of successful cold starts is not itself a reliability guarantee. Set the test sample size from the agreed failure-rate target and confidence level; report observed failures and latency distribution.

## 9. Rollback and operations

**Rollback triggers:** missed or late exam transition, outbox growth, lost live event, co-edit persistence/lock failure, cold-start SLO breach, repeated wake failure, migration incompatibility, or unexplained outbound traffic.

**Rollback sequence**

1. Disable Serverless in Railway and redeploy if the setting requires a new container.
2. Set BACKGROUND_RUNTIME_MODE=continuous and redeploy.
3. Disable lazy co-edit or demand-driven bus flags if implicated.
4. Keep additive schema changes in place; do not attempt destructive schema rollback during incident response.
5. Verify active exam work, outbox, terminal receipts, live connections, and co-edit lock state before closing the incident.

**Required telemetry and runbook**

- Worker phase, phase duration, transition reason, obligation-query duration/error, catch-up duration/result, and wake source.
- Outbox backlog count and oldest age; per-job overdue count and lateness; co-edit spawn/stop/flush/lock state.
- Cold-start request status and latency, including first-request 502/503/504 rates.
- DB open/idle connection counts and per-process outbound packet deltas in staging.
- Runbook for disabling Serverless, redeploying, restoring continuous mode, checking scheduled wake ownership, and validating exam state.

Memory-only state such as rate-limit buckets, WebSocket admission state, and version caches is lost or suspended across a sleep/restart. Phase 0 must confirm each cache is safe to rebuild and document any user-visible effect.

## 10. Decisions required before production

1. What is the maximum acceptable cold-start latency and first-document failure rate for staff and students?
2. Which exam transitions require exact or near-exact timing, and what is the maximum allowed lateness?
3. Who owns the exam calendar and the external wake path? Can best-effort Railway Cron meet the agreed SLO, or must the service stay warm during exam windows?
4. Are there any writers outside the API/co-edit container that can create background obligations?
5. What delay is acceptable for retention, media cleanup, grading projection, and other maintenance?
6. Is polling fallback acceptable for worker-originated live events, or must the database live bus stay active only while subscribers exist?

## Appendix A — Job classification template

Complete with code owner and product SLO during Phase 0.

| Job/loop | Trigger/predicate | Deadline/maximum lateness | Retry/idempotency | Wake path | Quiescent allowed? |
| --- | --- | --- | --- | --- | --- |
| Personal timeout reconciliation | To verify | To decide | To verify | To map | No until proven |
| SAT timeout reconciliation | To verify | To decide | To verify | To map | No until proven |
| Section/break reconciliation | To verify | To decide | To verify | To map | No until proven |
| Outbox drain | Pending nonterminal rows | To decide | To verify | Producer signal | No |
| Grading projection | To verify | To decide | To verify | Producer signal / catch-up | No |
| Co-edit freeze/workspace recovery | Expired recovery state | To decide | To verify | API/co-edit signal and boot catch-up | No |
| Terminal repairs and audits | To verify | To decide | To verify | Catch-up / scheduled wake | No |
| Retention and media cleanup | Maintenance schedule | Product decision | To verify | Scheduled wake / next boot | Only if delay accepted |

## Appendix B — Expected sleep-time model

Do not publish a fixed sleep duration until staging measurements exist. Estimate it as:

- **Time until last relevant outbound packet:** max(worker idle grace, co-edit idle-exit and flush, API/co-edit DB idle-connection lifetime, in-flight request/job completion)

- **Railway sleep after that packet:** typically another five to ten minutes, with sampled detection and platform variance.

This estimate excludes a later health check, cron request, reconnect, telemetry packet, private-network call, or inbound request response; any such packet can extend the interval.
