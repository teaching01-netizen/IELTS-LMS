# Phase 06 — Observability, budgets, CI and fixtures

Owner: Operations and test owner (CI and deploy files: operations owner is sole authority; new isolated tests: test workers may own).
Source WPs: WP10 (Measurement, observability, performance budgets) plus WP13 (CI, deterministic fixtures, safe test infrastructure).
Depends on: WP00 baseline (reproducible revision, toolchain, env inventory, safe-script confirmation); metric semantics finalize with Phase 01 (frozen C01 through C09, especially C05 freshness bounds, C07 error vocabulary, C09 workload and SLO profile).
Execution wave: Starts early (Wave B parallel lane: early instrumentation plus CI baseline alongside Phases 02, 03, 04 and Phase 05 restore-prep); gates harden as phases land (permanent SLO gates only after C09 calibration plus approval).
Status: Planning only. This file changes no code, config, CI, or production behavior. Every implementation checkbox starts unchecked.

---

## 1. Objective

Build the measurement and enforcement plane that lets every other phase prove its claims, without owning product behavior or pre-committing SLO gates:

1. Measure the exam lifecycle end to end — entry, bootstrap, write acknowledgement, terminal receipt (ordinary final seal versus SAT provisional response versus final SAT result readiness kept separate), roster updates, grading, exports — with latency distributions, resource footprints, and error composition attached to a declared workload, resource set, config fingerprint, and raw evidence.
2. Record the backend cost of every hot path — SQL count per request and per poll, transaction duration plus isolation outcome, lock and deadlock waits, pool wait/open/in-use, rows examined, worker queue age plus drain time, retry counts by class, saturation and shedding signals, response bytes — so WP11 tuning, WP07 freshness claims, and WP14 capacity claims are evidence, not assertion.
3. Fire integrity alerts that page on real loss and corruption risk — stuck provisional work, fan-out retry burn, DLQ age, cache-freshness failures, auth-revocation failures, storage-error signals — each with a named owner, threshold rationale, runbook, and a signal-fire test proving the alert can fire (and stays silent on the happy path).
4. Split CI into fast-PR versus DB-integration versus browser-matrix versus perf versus restore lanes without losing release coverage: every required release check stays fail-closed (NOT RUN or BLOCKED is never PASS), parallel workers are isolated (DB and schema, accounts, ports, browser storage, artifacts), clocks and barriers and interception and storage-faults are deterministic (no arbitrary sleeps), production helpers are allowlist-guarded (never live students), and flaky critical tests get an owner plus deadline instead of permanent retry-hiding.
5. Calibrate, not promise: section 8 budget numbers are PROPOSED calibration inputs. Phase 06 runs repeatable C09 calibration runs and proposes gates; the Phase 01 and C09 authority plus L0 approve permanent gates. Phase 07 consumes the frozen gates, ledger schema, and rehearsal evidence routes.

Non-goal restatement: no product-behavior change, no final SLO gate set without C09 approval, no new queue infrastructure and no sharding and no microservices, no blanket upgrades, no timeout growth as diagnosis substitute, no weakened assertions to turn tests green.

---

## 2. Scope and out of scope

### In scope

- Backend telemetry: extend the platform telemetry package (metric names, label discipline, log-field conventions), wire new counter and gauge call sites for WP10 measures (end-to-end latency spans, SQL and txn and lock and pool and rows-examined and queue-age and retry and saturation and bytes), extend the Prometheus alert-rules file plus runbooks, add alert-parity plus signal-fire tests.
- Frontend perf and error logging: harden the shared errorLogger, the app performanceMonitor, the app performanceTracker — bounded buffers, sampling, error-taxonomy tagging, redaction, no answer and token and password and ID leakage.
- k6: staging-safe calibration scenarios derived from k6 and load-runner shapes (entry wave, bootstrap herd, steady writes, section transitions, submit storm, resume, auto-submit fan-out, proctor observers, grading background) — always against disposable staging with an explicit confirm gate; production k6 scripts stay under the existing prod-confirm refusal logic and are never run from this phase calibration.
- Runbooks: create or extend docs/runbooks entries per alert (owner, threshold rationale, triage, recovery, fire-test pointer).
- CI: restructure the ci.yml workflow (plus backup-rehearsal-cron.yml; mirror-main.yml untouched unless operations owner approves) into the section 6.5 gate matrix; add serialization and consumer-contract tests, migration jobs, secret scan (gitleaks already present), dependency review, targeted a11y; deterministic fixtures (clocks, barriers, interception, storage faults); parallel-worker isolation; production-helper guards plus allowlists; failing and skipped and quarantined and unavailable ledger; flaky-test owner-plus-deadline policy.
- Test infrastructure: Go test config, vitest.config.ts (vitest.prod-load.config.ts stays prod-scoped), all Playwright config files, e2e support helpers, e2e global-setup, src test setup, local test setup docs and env.

### Out of scope

- Owning product behavior changes (scoring policy, timing rules, grading permissions, admission rules, terminalization semantics) — those belong to Phases 01 through 05; this phase only measures them and freezes their metric semantics.
- Setting final SLO gates without C09 approval — propose plus calibrate only (see sections 6 and 7, steps 9 and 10).
- Production load tests, production deployment, production data repair or deletion or migration execution, credential access — not authorized by the plan; calibration runs target disposable staging and local only.
- Rewriting the telemetry registry, swapping metric backends, adding Redis or another queue for observability, blanket dependency upgrades, claiming compliance or certification or readiness from unit tests alone.

---

## 3. Dependencies

- WP00 baseline: source revision plus dirty-tree hashes, toolchain versions (Go, Node, k6, Playwright), lockfiles, migration head, available envs (which suites are NOT RUN here), confirmed safe scripts (npm typecheck, lint, test run, build, Go suites), sanitized IELTS and SAT-adaptive and ACT-science fixtures. Do not assume script names from this file — re-confirm in WP00. If WP00 marks DB or browser suites unavailable, record them as BLOCKED in the ledger; do not substitute weaker evidence.
- Phase 01 contracts C01 through C09: frozen metric semantics: C05 freshness bound per channel and condition; C06 job and failure classes (transient versus permanent versus poison and DLQ); C07 exact wire codes and envelopes plus single retry owner per operation; C09 workload and resource profile (concurrency, arrival and write cadence, storms, devices and networks, flags, resource limits). Metric label values MUST come from frozen enum sets (outcomes, routes, status classes). Any new outcome label requires a contract amendment via L0 and contract owner — Phase 06 never invents shared semantics.
- Phase 02 (scoring and terminalization): authoritative source labels (v2 versus legacy versus zero), finalize outcomes (completed, replayed, rejected), terminalization outcomes — lands the call sites this phase instruments. Early instrumentation ships with current labels; label-set changes sequence through the integrity owner (single-mutation-owner rule).
- Phase 03 (client durability): durability milestones (visible input, checkpoint, journal, in-flight, exact ack), barrier and quarantine and storage-fault vocabulary. Frontend perf and error logging tags use the same milestone names; no parallel invention.
- Phase 04 (auth, API, runtime): error-code table (C07 wire codes), revocation and invalidation semantics, retry-ownership table per operation. Error taxonomy (section 6.3) and revocation-failure alert derive from these; shared httpx and apperrors files sequenced with security and contract owners.
- Phase 05 (data): query-shape freeze plus pool sizing knobs; migration and restore routes. SQL and lock and pool instrumentation must not change query shapes; restore lane reuses the WP12 rehearsal script.
- Phase 07 (consumer): consumes frozen gates, ledger schema, calibration evidence routes. Section 16 lists exactly what Phase 07 gates on.

Ownership sequencing: CI and deploy files go to the operations owner (sole authority). Telemetry package files and the Prometheus alert-rules file go to the operations owner while this phase is active; test workers own only new isolated test files. The app wiring files, durability engine, terminalization, and worker orchestration files are read-only for this phase — submit wiring needs through the owning phase integrator; never edit under another owner.

---

## 4. Affected files (rediscovered — re-verify paths and symbols in WP00 before editing)

### Backend telemetry, metrics, alerts (rediscovered current state)

- backend/go/internal/platform/telemetry/telemetry.go — metric-name constants (M-prefixed) plus help text plus Names() registry-of-record plus outcome label constants (OutcomeAccepted, ExactReplay, LeaseFenced, ControlStale, VersionConflict, WriteConflict, NotWritable, Rejected, RetriedAccepted; SATScoreV2, Legacy, Zero; FinalizeCompleted, Replayed, Rejected). About 60 series exist covering http, pool, query and tx, v2 batches, SAT score and finalize and heartbeat, terminalization, outbox, jobs, SAT pending age, projection lag, websockets, version-cache, presence, entry-gate, rollup, shed, query-budget, session and snapshot cache, runtime polls, attempt-verify, ratelimit, authoring ops.
- backend/go/internal/platform/telemetry/registry.go — dependency-free Prometheus exposition registry (stdlib only, no client library vendored); IncCounter and SetGauge, CounterValueForTest and GaugeValueForTest and ResetForTest seams, label-pair sorting plus sanitizers, Snapshot(), Handler(). Cardinality rule documented in-file: low-cardinality labels only; high-cardinality IDs stay in logs and traces, never in labels.
- backend/go/internal/platform/telemetry/registry_test.go and counter_exposition_test.go — parity and exposition pins (extend, do not weaken). The exposition test pins that incremented counters render in Snapshot with HELP and TYPE headers; the alert-parity pattern asserts every metric referenced in the alert-rules file appears in Names().
- backend/monitoring/prometheus-alert-rules.yml — current rules: StudentAnswerLossRiskDetected on terminal_invariant_violation_total; SubmitReplayIncompleteDetected on terminalization_conflict_total; RateLimitAuthCriticalDenials; RateLimitTierBurnRate; PostSubmitGraceRejectedSpike on v2 batch not_writable; ReadyzProbeFailing on GET readyz 5xx; OutboxOldestAgeHigh over 300s; AuthoringConflictBurnRate; AuthoringRejectionBurnRate; SATLegacyScoringFallbackDetected; SATMixedScoringFallbackDetected on fallback_rows_total; SATFinalizationRejectedSpike; HTTP5xxRateHigh. Keep the WS-10a discipline: never point a rule at a series nothing emits.
- Emitting call sites (instrument, do not reshape): backend/go/internal/platform/httpx/middleware.go plus httpx.go (request-id, trace, recovery, access-log, duration, status-class, route-template with back-report through the route holder, never raw paths); backend/go/internal/platform/apperrors/errors.go (stable wire Code enum plus HTTP mapping — C07 source of truth, preserving SUBMISSION_ID_MISUSE and acknowledgements naming); backend/go/internal/platform/db/db.go (plus poolstats and poolsplit tests); backend/go/internal/platform/tx/tx.go (plus isolation and retry-metric tests); outbox package including dlq.go quarantine plus outbox and dlq tests; backend/go/cmd/worker/main.go (outbox oldest-age drain report); terminalization, sat, attempts, delivery services; backend/go/internal/platform/clock/clock.go (System versus Fixed — reuse for deterministic tests, server and DB time authority).

### Frontend perf and error logging

- src/shared/observability/errorLogger.ts — singleton ErrorLogger (100-entry in-memory ring, console output, PROD-only external send stub, setUserContext and clearUserContext, log helpers). Known gaps to close: no taxonomy tags, no sampling budget, no redaction pass, raw context passthrough, userId and sessionId attached without minimization review.
- src/app/monitoring/performanceMonitor.ts — PerformanceMonitor measure and recordMetric, 100-metric ring, over-1000ms slow-op warn, p95 helper, usePerformanceMonitor hook plus withPerformanceMonitor HOC. Known gaps: 16ms render-warn threshold is arbitrary (replace with C09-calibrated budgets), no route or attempt scoping, no INP and web-vitals wiring.
- src/app/performance/performanceTracker.ts plus lazyLoad.tsx plus memoize.ts — marker-based tracker plus logger.performance sink plus React hook plus HOC. Overlaps performanceMonitor.ts: consolidate ownership (one owner, one sink) rather than running two parallel systems; see step 5.
- src/shared/error/errorTypes.ts — AppError, NetworkError, ValidationError, AuthError, NotFoundError, ConflictError, RateLimitError, ServiceUnavailableError plus guards. Must map one-to-one onto C07 wire codes at the transport boundary (step 4) — frontend class names never leak onto the wire.
- src/shared/api/apiClient.ts, src/shared/api/queryClient.ts, src/shared/lib/validateApiResponse.ts — retry and log call sites (C07 single-retry-owner audit targets; plan calls out API client plus React Query plus durability engine stacking).
- e2e/frontend-performance.spec.ts — current browser perf spec asserts against a window.performanceMonitor global with mismatched method names (getMetricsByName API, getSlowOperations, getP95Metrics, getAllMetrics — none exist on the class). Treat as stale-contract evidence: rewrite against the frozen perf-sink interface from step 5; do not patch assertions to pass vacuously.

### k6 and load-runner

- k6/README.md, k6/prod-exam-day.js, k6/prod-start-exam-200.js, k6/prod-section-transition-200.js, k6/prod-submit-storm-200.js, k6/prod-resume-100.js, k6/prod-auto-submit-200.js, k6/prod-load-helpers.js (contains the K6_CONFIRM_PROD equals true refusal gate — preserve verbatim), k6/scale-proof files, k6 target json files plus creds.example.json templates (never commit real creds; CI already gates tracked non-example creds files).
- load-runner directory (Dockerfile, README, e2e and k6 and node scripts, ui-server.mjs, ws.d.ts) — staging harness shapes to borrow; do not point at production.
- package.json k6 and live-runner scripts (k6:exam-day, k6:start-exam, k6:section-transition, k6:submit-storm, k6:resume, k6:auto-submit, e2e:live-with-k6, e2e:live-runner, test:live-runner) — all production-targeting; calibration scenarios get NEW staging-only scripts with a different confirm-gate name (never reuse K6_CONFIRM_PROD).

### Runbooks and docs

- docs/runbooks/exam-day-mysql-scale.md (current runbook_url for most alerts — split per-alert runbooks out of this monolith), docs/runbooks/student-answer-durability.md, docs/runbooks/sat-student-tools-exam-day.md.
- docs/optimize.md (WP10 section, WP13 section, section 8 budgets, section 9 gates — source, not target), optimization-plan/overall-plan.md (waves and ownership), docs/architecture/SYSTEM-MAP.md, docs/sat-hardening files, e2e/TEST_STATUS.md (WS-16 quarantine ledger — adopt its fail-closed pattern for the permanent ledger).

### Scripts, configs, CI, local setup

- package.json (scripts: typecheck, lint, test, test:run, test:performance, test:coverage, build, playwright, e2e variants, k6 scripts), vitest.config.ts (jsdom, src/test/setup.ts, coverage excludes stories and tests), vitest.prod-load.config.ts (prod-scoped — do not widen), vite.config.ts, eslint.config.js, .prettierrc.
- playwright.config.ts (default local Go-backed suite: api plus worker plus vite webServers, 7 projects including mobile and tablet, testIgnore for prod-load and prod-smoke and .generated, workers 1, CI retries 2), playwright.prod-load.config.ts (external deployment, retries 0, shard-aware, trace and video off by default), playwright.prod-smoke.config.ts, playwright.remote.config.ts, playwright.sat-a11y.config.ts (a11y-scoped, dev-server only).
- .github/workflows/ci.yml (jobs: go-backend including gofmt, vet, unit, build, race, coverage-ratchet-27, migrate, validate, integration on real MySQL service, OpenAPI-lint, staticcheck, schema-diff, diff-check; quality-gates including typecheck, lint, prettier-changed-files, coverage-75-gate, client-freshness, gitleaks, creds-guard, build, bundle-500KiB; e2e-tests with Playwright install and artifact upload; performance-check with test:performance plus Lighthouse; railway-deploy needing quality plus go-backend), .github/workflows/backup-rehearsal-cron.yml (monthly restore rehearsal, fail-closed without scratch DSN), .github/workflows/mirror-main.yml.
- Go test surface: backend/go test files plus nested internal test files (239 files including sqlmock-scoped DLQ, outbox, tx, ratelimit, accesslog, poolstats suites) plus backend/go/integration (real-MySQL, TEST_MYSQL_DSN).
- Local test setup: .env.test (backend feature flags off), src/test/setup.ts (jest-dom, cleanup, localStorage mock, ResizeObserver stub, scroll stubs, no-motion CSS), e2e/global-setup.ts (migrate plus cmd/e2e_seed plus storage-state manifest), e2e/support/backendE2e.ts, e2e/support/db.ts (lazy mysql2 pool from TEST or DATABASE_URL), e2e/support helpers (prodBootstrap, prodData, prodOrchestration, prodProgress, proctorControls, studentUi, studentViewportMatrix, and others), scripts/backup-rehearsal.sh, scripts/diagnostics helpers, test-mysql-lifecycle.cjs.

---

## 5. New files (proposed paths — confirm against live tree in WP00; prefer extending current tests over new files where behavior already owned)

Backend observability: backend/go/internal/platform/telemetry/exam_spans.go — end-to-end latency span helpers (entry, bootstrap, write-ack, terminal, roster, grading, export) built on clock.Clock; emits durations via existing gauge and counter primitives plus structured log fields; no new registry abstraction. backend/go/internal/platform/telemetry/cost.go — per-request cost recorder (SQL count, tx duration, lock and deadlock waits, pool waits, rows examined, response bytes) fed by db and tx and httpx hooks; single call site per request lifecycle. backend/go/internal/platform/telemetry/taxonomy.go — error-class mapping (service versus validation and authz versus 429 versus disconnect versus network) from apperrors.Code plus transport cause; used by access-log plus alert expressions; table-driven, frozen with C07. Tests exam_spans_test.go, cost_test.go, taxonomy_test.go (Fixed clock, sqlmock where DB-shaped). alert_parity_test.go — extends the WS-10a parity pattern: every series referenced in prometheus-alert-rules.yml must appear in Names(); every rule must have a companion signal-fire test registered in the ledger. backend/monitoring/dashboards/exam-lifecycle.json (proposed Grafana dashboard: lifecycle latency panels, cost panels, error-composition panels, integrity panels; dashboard JSON is documentation, never a gate).

Frontend observability: src/shared/observability/perfBudget.ts — frozen budget table import (PROPOSED values from section 6.2 plus C09 profile id); single source for monitor thresholds. src/shared/observability/redact.ts — redaction allowlist (drop answers, writing bodies, tokens, passwords, keys; truncate and coarsen IDs; structured-context sanitizer used by errorLogger plus perf sink). src/shared/observability/examPerfSink.ts — the ONE frontend perf sink (replaces dual monitor and tracker divergence): route-scoped ring buffer, sampling, budget comparison, beacon hook (disabled by default; explicit opt-in per environment). Tests redact.test.ts, examPerfSink.test.ts, errorTaxonomy.test.ts — redaction property tests plus budget-boundary tests plus taxonomy mapping tests.

Runbooks (one per alert, split out of the monolith): docs/runbooks/alerts/stuck-provisional.md, fanout-retry-burn.md, dlq-age.md, cache-freshness.md, revocation-failure.md, storage-error-signal.md, submit-conflict-spike.md, sat-fallback-scoring.md — each with owner, threshold rationale, triage queries, recovery commands, fire-test pointer, silence criteria. Plus docs/runbooks/observability-lookup.md — metric-to-owner-to-dashboard-to-runbook index. Plus docs/production-hardening/c09-calibration dated run records (workload, resources, config fingerprint, distributions, raw evidence links); directory is proposed, confirm naming with WP00 evidence-dir decision.

CI, fixtures, ledger: .github/workflows/ci-pr.yml — fast-PR lane (typecheck, lint, prettier-changed, unit and vitest, Go vet and unit, OpenAPI lint, secret scan, creds-guard, bundle check); proposed split from ci.yml; operations owner decides split versus matrix refactor. .github/workflows/ci-integration.yml — DB-integration lane (migrate plus validate plus Go integration plus contract and serialization tests plus migration-fault matrix). .github/workflows/ci-browser.yml — browser-matrix lane (Playwright default suite, sharded, artifact-namespaced). .github/workflows/ci-perf.yml — perf lane (repeatable staging k6 calibration plus test:performance plus Lighthouse, manual and scheduled only, never on every PR). .github/workflows/ci-restore.yml — restore lane (reuses backup-rehearsal script path on disposable target; scheduled plus manual). e2e/support/deterministicClock.ts — frontend controllable clock (Fixed-time provider plus tick API for Vitest fake-timer and Playwright clock interception interop). e2e/support/txBarrier.ts — DB transaction-barrier helper (hold and release commit gates for AC09-style race tests; two-connection protocol). e2e/support/netIntercept.ts — network-interception recipes (drop-ack-after-commit, delay, offline and online, slow profiles) for apiClient plus Playwright route interception. e2e/support/storageFaults.ts — controlled storage faults (deny, quota, corrupt, upgrade, account-switch) for durability tests (AC02 and AC04). e2e/support/envGuard.ts — production-helper guard (explicit allowlist loader; refuses live-student fixtures; refuses prod URLs without the staging confirm-gate). docs/production-hardening/test-evidence-ledger.md — failing and skipped and quarantined and unavailable ledger schema plus current rows (supersedes ad-hoc TEST_STATUS pattern with a permanent, phase-owned file). docs/production-hardening/flaky-policy.md — flaky-test owner-plus-deadline policy (quarantine SLA, retry rules, reopen criteria). k6/staging scenario fi... (line truncated to 2000 chars)

---

## 6. Interfaces and contracts

### 6.1 Metric, log, and alert schema

Metric naming extends the existing M-prefixed constants; new names follow the same snake_case plus unit-suffix convention. Proposed new lifecycle series (all names illustrative until Phase 01 freezes the vocabulary):

- exam_entry_duration_seconds with labels outcome and entry_mode.
- exam_bootstrap_duration_seconds with labels outcome and cache where cache is hit or miss (version and snapshot cache path).
- exam_write_ack_duration_seconds with labels outcome and provider where provider is ielts, sat, or act and outcome comes from the frozen batch outcomes.
- exam_terminal_receipt_seconds with labels outcome and seal_kind where seal_kind is final, sat_provisional, or sat_final and the three are NEVER merged into one series.
- exam_roster_refresh_seconds with labels outcome and source where source is api or rollup_cache.
- exam_grading_duration_seconds with labels outcome and queue where queue is inline or background.
- exam_export_duration_seconds with labels outcome and kind where kind is results, audit, or media_manifest.
- Cost per request and per poll: http_sql_count keyed by route_template and method (integer per-request gauge, summed and averaged at analysis time); db_tx_duration_seconds keyed by outcome and isolation; db_lock_wait_seconds keyed by op; db_deadlocks_total keyed by kind (existing MDeadlocks extended with kind deadlock or lock_wait_timeout); existing db_pool_wait_count, db_pool_open, db_pool_in_use plus a derived saturation alert (below); db_rows_examined_total keyed by bounded op values only (bootstrap, roster, grading_poll, job_claim, and similar); worker_queue_age_seconds keyed by queue (outbox, grading, autosubmit_fanout, sat_reconcile); worker_retry_total keyed by queue and class (class transient, permanent, poison, matching the C06 vocabulary); http_response_bytes keyed by route_template and class (success or error).
- Error taxonomy (extends http_requests_total with route, method, status plus http_ratelimit_denied_total with tier and key_class): http_errors_total keyed by class and route_template where class is service_5xx, validation_4xx, authz_403, auth_401, rate_429, disconnect, or network; ws_disconnect_total keyed by cause (slow_client, idle, error; extends the existing slow-disconnect series); storage_error_total keyed by surface and mode (surface checkpoint, journal, archive; mode denied, quota, corrupt).

Label discipline (hard rules, enforced by test):

1. Allowed label keys: outcome, seal_kind, provider, route_template (never raw path), method, status (5xx or 4xx class, never exact body), cache, source, queue, class, tier, key_class, mode, cause, surface, kind, operation. Any new key needs contract-owner approval.
2. Forbidden label values: attempt ids, schedule ids, user ids, session ids, emails, IPs, answer content, free-form error messages. IDs belong in structured logs and traces only when justified (request_id and trace_id correlation), never in metric labels.
3. Route labels use the matched template (the GET readyz pattern), back-reported through the existing route-holder mechanism — never raw parameterized paths.
4. Cardinality budget: each new metric ships with a series estimate (label product) in its change description; the alert-parity test fails if any series observed cardinality exceeds estimate times two in calibration.

Structured log fields (extends FRequestID, FTraceID, FRoute, FMethod, FStatus, FLatencyMs, FActor): request_id, trace_id, route (template), method, status (class), latency_ms, actor_class, outcome, seal_kind, sql_count, tx_ms, lock_wait_ms, pool_wait_ms, rows_examined, response_bytes, queue_age_s, retry_class, error_class, cache (hit or miss plus key-scope hash, never key content), budget_id (C09 profile id). NEVER log: answers, writing bodies, keys, tokens, passwords, or PII beyond minimized actor_class.

Alert record schema (every rule in prometheus-alert-rules.yml plus every runbook carries this): alert stable name; expr over emitted series only; for duration; labels severity page or warning, slo frozen slo id, owner team or role; annotations summary, triage-first description, runbook_url pointing at docs/runbooks/alerts/<name>.md, threshold_rationale explaining why this number with a link to the calibration run, fire_test naming the test id proving the signal fires.

### 6.2 Budget table — ALL VALUES PROPOSED (from docs/optimize.md section 8 as calibration input, NOT promises)

These are starting hypotheses for C09 calibration runs. Permanent gates require a frozen C09 profile plus L0 approval. Frontend device and network slices and backend resource envelopes are part of the profile, not footnotes.

- Answer input responsiveness: PROPOSED p95 input-to-visible update at most 100 ms. Boundary: named lower-powered supported device; include synchronous storage-checkpoint work; per-question scope (editing one answer must not rerender unrelated questions — AC17).
- General interaction responsiveness: PROPOSED p75 INP at most 200 ms where supported. Boundary: real representative sessions; keep device and browser slices; overlays, IME, keyboard, and focus paths included (AC17).
- Autosave acknowledgement: PROPOSED p95 at most 1 second. Boundary: client send to exact server ack of that write ID; within the defined network profile; retries of the same write ID count toward the same ack, new reconciled writes start a new span.
- Terminal submission receipt: PROPOSED p95 at most 2 seconds. Boundary: three separate series — ordinary final seal versus SAT provisional response versus final SAT result readiness. Merging them is a contract violation.
- API availability: PROPOSED 99.9 percent for valid critical requests during agreed exam windows. Boundary: eligible requests defined by C09; report 429, validation, client-disconnect, network, and server-5xx separately per the taxonomy in section 6.3. 429s are not downtime; 5xxs are.
- Integrity: zero confirmed silent-loss, cross-user exposure, duplicate incompatible terminal facts, or unexplained score divergence. Boundary: every release acceptance plus soak run; production incident gate; immediate stop condition (section 11 of the source plan).
- Background recovery: bounded oldest-eligible-work age plus measured drain time. Boundary: thresholds from expected load times worker capacity (calibration), never an arbitrary universal number. Current starting point: outbox oldest age pages above 300 seconds / 5 minutes (existing rule; re-ratify in calibration).
- Runtime freshness: C05 bound demonstrated per channel plus sleep and reconnect condition. Boundary: a 2-second fast-lane hint is NOT a propagation SLA; measure worker-mutation to API-observation across distinct processes plus restart (AC11 and AC16).

Capacity-demonstration policy (binds calibration runs): specify arrival bursts, concurrent writers, payload sizes, submit storms, staff connections, and background workloads separately; compare baseline versus candidate on identical dataset, configuration, infrastructure, and generator capacity; record p50, p95, p99 plus error composition plus CPU and RSS plus connections plus SQL and lock waits plus storage latency plus queue age plus post-load drain; claim peak plus approved headroom only — no arbitrary multiplier the generator cannot sustain; if one deployment cannot meet capacity, name the measured limiting resource and route new-infrastructure asks through a separate justified architecture decision.

### 6.3 Error taxonomy (C07 wire codes to measurement classes)

- service_5xx: wire INTERNAL, SERVICE_UNAVAILABLE, SERVICE_RECOVERY_FAILED (500, 503). Retry: owner retries with bounded budget plus jitter; worker DLQ path for durable work. Only class that pages on burn rate (HTTP5xxRateHigh).
- validation_4xx: wire BAD_REQUEST, VALIDATION_ERROR, PAYLOAD_TOO_LARGE, UNSUPPORTED_PROVIDER, INVALID_ASSESSMENT (400, 413, 422). Retry: never retried blindly; client fixes payload. Dashboard only; high rate means authoring or client bug, not capacity.
- auth_401: wire UNAUTHORIZED, SESSION_EXPIRED, ATTEMPT_TOKEN variants (401). Retry: single re-auth or refresh attempt, then surface. DB outage must NOT masquerade as invalid credentials (AC13 probe).
- authz_403: wire FORBIDDEN, CSRF_FAILED, LEASE_FENCED, ATTEMPT_PROCTOR_BLOCKED (403). Retry: never retried silently; distinct recovery per case (AC07). Lease-fenced writes are correctness, not errors to suppress.
- conflict_409: wire CONFLICT, CONTROL_EPOCH_STALE, VERSION_COLLISION, WRITE_ID_CONFLICT, TERMINALIZATION_CONFLICT, SUBMISSION_ID_MISUSE, RESPONSE_REVISION_MISMATCH, and similar (409). Retry: exact-replay returns compatible ack; stale-epoch and lease paths require fresh-state reconcile only (never auto-replay across terminal). Highest-integrity class; feeds the conflict-spike alert.
- rate_429: wire RATE_LIMITED, RATE_LIMIT_EXCEEDDED, LEASE_ACQUIRE_FAILED (429). Retry: honor Retry-After; client backoff; never retry-storm (AC14). Split by tier and key_class; auth-critical denials page.
- disconnect: client-closed connection, websocket slow-client or idle close. Retry: no server retry of non-idempotent mutations. Track separately; do not stain the 5xx burn rate.
- network: timeouts, DNS, TLS between hops (not a wire code; transport cause). Retry: owner plus budget per the C07 retry table. k6 plus browser matrix must label injected faults so they do not pollute calibration.

Frontend maps its classes (NetworkError, ValidationError, AuthError, RateLimitError, and similar) onto this table at the transport boundary and logs the measurement class, never the raw payload.

### 6.4 Integrity alerts (required set — each gets rule plus runbook plus fire-test before DONE)

- Stuck provisional (SAT): signal sat_provisional_pending_age_seconds (existing MSATPendingAge). Proposed threshold: page when oldest provisional exceeds N seconds for M minutes (N from reconcile-watchdog capacity). Owner: worker and integrity owner. Rationale hint: client may vanish after provisional success (AC11); worker must seal or dead-letter.
- Fan-out retry burn: signal worker_retry_total queue autosubmit_fanout class transient plus worker_job_failures_total. Proposed threshold: warning on burn rate at or above R per 10 minutes. Owner: worker owner. Rationale: parent completes only when every target is finished, classified, or DLQ-assigned (AC10).
- DLQ age and depth: signal outbox_oldest_age_seconds (existing, page above 300s) plus dead-letter depth gauge. Proposed threshold: page above 300s for 5 minutes (existing; re-ratify); warning on DLQ depth growth. Owner: operations and worker owner. Rationale: relay stall means unowned unfinished work; never purge backlog as recovery.
- Cache freshness failure: signal proctor_rollup_lag_seconds plus snapshot-miss rate plus version-cache miss spike. Proposed threshold: warning and page per C05 bound per channel. Owner: runtime owner. Rationale: stale cache must never bypass revocation; freshness bound is per-channel, not universal.
- Revocation failure: signal attempt_verify_total result revoked_stale_accept (new; zero-tolerance) plus session-cache invalidation lag. Proposed threshold: page on ANY stale-accept in window. Owner: security owner. Rationale: safety must not depend on frontend guards; stale-cache accept is a security incident.
- Storage-error signal: signal storage_error_total keyed by surface and mode (new frontend-beacon plus backend-correlate). Proposed threshold: warning on rate; page on quota or denial during submit window. Owner: client durability owner. Rationale: browser eviction can destroy unacked work — detect and report, never promise impossible durability.
- Submit-conflict spike: signal terminalization_conflict_total (existing) plus v2_response_batch_total outcome not_writable. Proposed threshold: warning at or above 20 per 10 minutes (existing; re-ratify). Owner: integrity owner. Rationale: seal-time races (AC09); conflicts are correctness signals, not noise to silence.
- SAT fallback scoring: signal sat_score_source_total source legacy plus sat_score_fallback_rows_total. Proposed threshold: page on ANY in window (existing; keep zero-tolerance post-V2-canonical). Owner: integrity owner. Rationale: legacy scoring post-fix means scoring-disconnect regression.
- SAT finalize rejected: signal sat_finalize_total outcome rejected. Proposed threshold: page on ANY in 10 minutes (existing). Owner: integrity and worker owner. Rationale: frontend beacons may never arrive during outage; page on server-observed outcomes.
- 5xx burn: signal http_requests_total status 5xx. Proposed threshold: warning at or above 50 per 5 minutes (existing; re-ratify per route). Owner: operations owner. Rationale: break down by route and method; auth-critical tier pages separately.

Existing rules keep firing throughout (no alert goes dark during migration). New rules land as warning first, promote to page only with calibration evidence plus owner sign-off.

### 6.5 CI gate matrix (required checks per stage; the not-sufficient-alone note travels with each row)

- Fast PR lane (ci-pr.yml PROPOSED): trigger every PR. Required checks: typecheck, lint, prettier-changed-files, vitest unit (test:run), Go vet plus unit (no DB), OpenAPI lint, generated-client freshness, secret scan (gitleaks), creds-guard (no tracked non-example creds), bundle at most 500 KiB, diff-check. Release-blocking: yes, merge-blocking. Not sufficient alone: worker statement that code looks correct; historical coverage files.
- DB integration lane (ci-integration.yml PROPOSED): trigger on PRs touching backend or migrations plus nightly plus release. Required checks: migrate plus validate-only plus schema-diff guard, Go race, Go integration on real MySQL service, HTTP serialization and consumer-contract tests (old and new combos, lost-ack-after-commit retry), migration-fault matrix (fresh, upgrade, interrupted-rerun, compat), coverage ratchet (Go 27 floor, raise-as-improves). Release-blocking: yes. Not sufficient alone: SQL parses; mocked-only tests.
- Browser matrix lane (ci-browser.yml PROPOSED): trigger on PRs touching client or e2e plus nightly plus release. Required checks: Playwright default suite across chromium, firefox, webkit plus mobile and tablet projects, sharded with namespaced artifacts, trace-on-first-retry. Release-blocking: yes for exam paths; a11y regressions on critical paths block. Not sufficient alone: one-browser green; audit screenshots alone.
- Perf lane (ci-perf.yml PROPOSED): trigger manual plus scheduled plus release (never every-PR). Required checks: staging k6 calibration (repeatable profile, generator-capacity attested), test:performance, Lighthouse CI, correctness suite preserved on the same candidate. Release-blocking: yes for release claims; advisory on PRs. Not sufficient alone: faster one-off benchmark; prod load test.
- Restore lane (ci-restore.yml PROPOSED): trigger scheduled plus release plus any migration PR. Required checks: backup-rehearsal script on disposable target (restore plus validate-only plus readyz plus invariant spot-checks), RPO and RTO observation recorded. Release-blocking: yes where schema or data changes ship. Not sufficient alone: successful mysqldump alone.
- Existing preserved: backup-rehearsal-cron.yml monthly keeps running until the restore lane supersedes it (explicit cutover, not silent replace); mirror-main.yml unchanged.

Fail-closed rule (applies to every lane): unavailable required checks are recorded NOT RUN or BLOCKED in the ledger. They never become PASS by substitution. Release checks cannot be waived because their environment is unavailable — the release waits or the waiver gets explicit authorized acceptance with a new evidence plan.

---

## 7. Step-by-step implementation

Single-mutation-owner rule applies throughout. Operations owner owns CI and deploy files; test workers own only new isolated test files. Read-only cross-phase files are never edited here — file wiring needs through the owning integrator. Planning only: no step executes production load, deployment, or migration.

### Step 0 — Confirm WP00 baseline plus freeze metric semantics with Phase 01

1. Pull the WP00 ledger: source revision, toolchain versions, which envs are live versus BLOCKED, confirmed safe scripts, sanitized fixtures available, migration head, C09 draft profile.
2. With the contract owner, freeze: lifecycle span boundaries (what timestamps define entry, bootstrap, ack, terminal, roster, grading, export), C05 per-channel freshness bounds, C06 failure classes, C07 wire-code to measurement-class table (section 6.3), C09 profile id plus resource envelope plus device and network slices.
3. Record the frozen contract versions this phase builds against (C05, C06, C07, C09 at minimum) in the phase header before any instrumentation lands. If Phase 01 amends a code or outcome enum, re-freeze before instrumenting.

### Step 1 — Inventory current signals (investigate before repairing)

1. Enumerate every existing IncCounter and SetGauge call site versus Names() versus alert-rule references (extend the WS-10a parity check by hand first): flag any rule pointing at a never-emitted series and any emitted series with no dashboard, alert, or ledger consumer.
2. Audit httpx access-log coverage: confirm route-template labels, status classes, duration capture on all API routes including readyz; confirm DB-touch accounting can attribute SQL count per request (even if coarsely at first).
3. Audit frontend sinks: catalog what errorLogger, performanceMonitor, performanceTracker each capture, their buffers and limits, and where the frontend-performance spec expectations diverge from reality. Do not fix the spec by weakening assertions.
4. Inventory k6 and prod scripts versus staging capability: confirm no calibration plan depends on prod targets or creds; confirm the prod-confirm refusal stays intact.
5. Output: signal-inventory table (series to emitter to consumer to gap) plus stale-spec list. Close already-satisfied rows with evidence, not code.

### Step 2 — Backend lifecycle plus cost instrumentation (additive, behind existing primitives)

1. Add exam_spans.go: span helpers taking clock.Clock (System in prod, Fixed in tests); measure entry (admission decision), bootstrap (seed assembly including cache-hit and miss path), write-ack (batch commit to ack render), terminal receipt split three ways (seal_kind final, sat_provisional, sat_final), roster refresh, grading queue time, export duration. Emit durations plus structured log fields; reuse IncCounter and SetGauge, no new registry type unless Phase 01 approves a histogram.
2. Add cost.go: per-request cost record (sql_count, tx_ms plus isolation outcome, lock_wait_ms, deadlock class, pool_wait_ms and open and in-use snapshot, rows_examined, response_bytes) populated from db and tx and httpx hooks at one lifecycle join point (middleware response path). Keep the hot path allocation-careful: fixed-size struct, no map churn per request.
3. Add taxonomy.go: pure function Classify(wireCode, httpStatus, transportCause) to measurement class; table-driven over frozen C07 codes; unknown codes map to service_5xx plus emit a taxonomy_unknown_total tripwire (so contract drift is visible, not silent).
4. Wire call sites additively (one owner at a time, sequenced with integrity, worker, runtime owners): attempts and delivery write path, terminalization seal path, SAT finalize path, roster and rollup path, grading path, export path, outbox and worker drain path.
5. Guard: any instrumentation failure (clock skew, counter contention) must degrade to missing-metric, never to request failure. No external calls inside measured transactions; record-then-emit after commit.

### Step 3 — Label discipline plus redaction hardening

1. Encode section 6.1 rules as tests first: forbidden-key scan over all IncCounter and SetGauge call sites (static grep test), cardinality-estimate assertion per new metric, route-template-versus-raw-path assertion on access-log output.
2. Backend: verify no answer, writing-body, key, token, or password crosses into logs or metric labels — extend existing never-log comments into property tests with adversarial payloads (Unicode, huge bodies, nested details maps).
3. Frontend: add redact.ts allowlist sanitizer; route ALL errorLogger context plus perf metadata through it; minimize userId and sessionId (hash, coarsen, or drop per data-minimization decision with security owner); cap context depth and size.
4. Add taxonomy_unknown_total plus taxonomy tests plus redaction tests before any dashboard work.

### Step 4 — Error-taxonomy plus retry-ownership audit (with Phase 04)

1. Build the operation-by-retry-owner table (API client versus React Query versus durability engine versus worker — exactly one owner per operation) from current code; flag double-retry surfaces (the plan calls out API client plus React Query plus durability engine stacking).
2. Map every apperrors.Code plus frontend error class to section 6.3 measurement classes; verify status-code mapping matches the C07 wire contract including the SUBMISSION_ID_MISUSE naming trap and the acknowledgements versus internal acks shape.
3. Prove with tests: lost-ack-after-commit retry returns compatible ack without duplicate mutation (AC03 shape, DB-backed); expired-bearer, rate-limit, malformed-input retain exact status plus envelope with no blind retry storm (AC14 shape).
4. Do not change retry behavior here — audit plus measure plus table it; behavior changes belong to owning phases against the frozen table.

### Step 5 — Frontend perf sink consolidation plus budget wiring (with Phase 03)

1. Consolidate performanceMonitor.ts plus performanceTracker.ts into the single examPerfSink.ts behind the existing import surface (re-export shims during migration; remove only with adoption evidence plus client-compat test).
2. Sink requirements: route-scoped ring buffer (bounded, for example 100 entries per route), sampling config, budget comparison against perfBudget.ts PROPOSED values, slow-op signal (threshold equals budget, not magic 16ms or 1000ms), INP and web-vitals hooks where supported with device and browser slices preserved.
3. Rewrite the frontend-performance spec against the frozen sink interface with real assertions (measures render, input, ack spans on representative fixtures); delete vacuous guards where an absent signal on a measured route must be FAIL, not skip.
4. Beacon hook ships disabled; enabling it for any environment needs security-owner redaction sign-off plus explicit config flag (never silent movement of student data).

### Step 6 — Integrity alerts plus runbooks plus fire-tests

1. For each section 6.4 row: confirm the series is emitted (add the emitter if missing — for example revocation stale-accept tripwire, storage-error beacon correlator), write or extend the Prometheus rule (warning first for new signals), write the per-alert runbook under docs/runbooks/alerts (owner, threshold rationale with calibration link, triage queries, recovery commands, silence criteria), register the fire-test id.
2. Fire-test pattern per alert: drive the failure deterministically (Fixed clock plus barrier plus fault injection, never sleeps), assert the series moves AND the rule expression evaluates true on synthetic exposition; assert the happy path stays silent. Extend alert_parity_test.go so every rule references an emitted series and every rule has a fire-test.
3. Keep all existing page rules live throughout. Promote warning to page only with calibration evidence plus owner sign-off recorded in the ledger.
4. Runbook quality bar: on-call who has never seen the alert can triage in under 15 minutes using only the runbook plus dashboard plus logs (reviewed by someone outside the authoring pair).

### Step 7 — Deterministic fixtures (clocks, barriers, interception, storage faults)

1. Backend: standardize on clock.Clock injection for every new timing-sensitive path (System at wiring, Fixed in tests); add transaction-barrier test helper for race tests (two-connection hold and release protocol for AC09 shapes); ban time.Sleep-based ordering in new tests (grep-gate it).
2. Frontend: add deterministicClock.ts (Fixed-time provider plus tick API; interop with Vitest fake timers in unit tests and Playwright clock interception in browser tests); document the three clock modes (real, fake-timer, intercepted) and when each is legitimate.
3. Add netIntercept.ts recipes (drop-ack-after-commit, latency profiles, offline and online toggles, websocket event-loss) and storageFaults.ts (deny, quota, corrupt, upgrade, account-switch) keyed to AC02, AC03, AC04, AC07, AC08 shapes.
4. Convert at least one sleep-based test per area (Go race, Vitest hook, Playwright durability) to barrier, clock, and interception form as the pattern reference; record the conversion recipe in the fixture README so later phases copy the pattern instead of inventing variants.

### Step 8 — Parallel-worker isolation plus production-helper guards

1. Isolation scheme (section 8 pseudocode): per-worker MySQL database (or schema) plus seeded accounts namespaced by worker id plus distinct API ports plus isolated browser storage (Playwright storageState per worker plus fresh context per test) plus namespaced artifact dirs (test-results and playwright-report per lane and shard). Document the exact env-var contract (per-worker TEST_MYSQL_DSN, PORT and API_PORT allocation, prod env vars never set in CI).
2. Add envGuard.ts: refuses to run when target URL matches the production allowlist unless the staging confirm-gate is set; refuses live-student fixtures by schedule-id allowlist (test schedules only); fails closed with a naming-the-expected-env error. Wire into global-setup plus k6 staging harness plus any helper that takes a baseURL.
3. CI matrix sets non-overlapping ports and DBs per shard; ledger records the isolation proof (worker id to db to port to artifact dir) per run.
4. Never use live students as fixtures — no exception path, no flag to override it. Production helpers require explicit environment allowlists plus authorization (WP13 acceptance).

### Step 9 — CI lane split (operations owner; independently revertible)

1. Restructure ci.yml into the section 6.5 matrix (split files versus job-matrix refactor is the operations owner call; either way each lane is independently revertible and no lane silently drops a required check).
2. Add the missing gates: HTTP serialization and consumer-contract tests (old and new combos), migration-fault matrix, secret scan stays (gitleaks), dependency review (new), targeted a11y (extend the sat-a11y config pattern to critical exam paths; a11y regressions on critical paths block).
3. Preserve current thresholds as floors (Go coverage ratchet 27, frontend statement gate 75, bundle 500 KiB, no tracked non-example creds) — raise only with evidence, never lower to turn red green.
4. Keep backup-rehearsal-cron.yml monthly until the restore lane explicitly supersedes it; record the cutover in the ledger.
5. Verify revertibility: revert each lane file independently on a scratch branch and confirm the remaining lanes still enforce their gates (no hidden cross-file dependency).

### Step 10 — C09 calibration runs (propose, do not gate — repeatable staging only)

1. Define calibration profile or profiles from frozen C09: arrival bursts, concurrent writers, payload sizes, submit storm, staff connections, background grading and cleanup, device and network slices, flags, resource limits. Record profile id plus config fingerprint.
2. Run baseline-versus-candidate pairs on identical dataset, config, infrastructure, and generator capacity using staging k6 scenarios (derived from prod script shapes, pointed at disposable staging, own confirm-gate). Collect section 6.2 distributions plus cost and error composition plus CPU and RSS, connections, SQL and lock waits, storage latency, queue age, drain.
3. Write one calibration record per run under the c09-calibration directory; propose gate values with rationale plus headroom analysis; submit to C09 authority plus L0 for approval. Permanent gates land only after approval — until then the CI perf lane stays advisory and comparative (fail on missing evidence, not on unapproved numbers).
4. If the generator cannot sustain the claimed load, report the generator as the limit — never extrapolate daily registrations to concurrent sockets and writers, never lower volume to mask an integrity failure.

### Step 11 — Ledger plus flaky policy plus handoff prep

1. Stand up the test-evidence-ledger.md file with the section 11 schema from the source plan (requirement and scenario, WP plus owner, contract version, files, candidate identity, producer checks with command plus env plus exit plus artifact, reviewer evidence, PASS and FAIL and NOT RUN and BLOCKED, residual risk, rollback evidence, next action). Migrate current WS-16 quarantine rows plus skipped-DB and browser rows into it. A skipped critical test is NOT RUN — never PASS.
2. Publish flaky-policy.md: quarantine requires owner plus deadline (default at most 14 days for critical, at most 30 days otherwise); quarantined tests report as skipped-with-reason (fail-closed markers, never silent deletes); retries permitted only for proven-flaky non-critical paths with the retry budget logged; permanent retry-hiding of critical failures is forbidden; third recurrence escalates the contract and architecture assumption.
3. Pre-stage Phase 07 inputs: frozen gate list, ledger HEAD, calibration record ids, dashboard plus runbook index, isolation proof template.

---

## 8. Code and pseudocode (illustrative — confirm exact symbols in WP00; planning only)

### 8.1 Metric definition (extends the telemetry.go pattern)

The Go sketch below shows how a new span helper reuses the existing Registry primitives. SpanKind pins the C05 and C09 vocabulary — never free-form strings. Attempt, schedule, and user IDs must not appear in labels; trace correlation lives in logs only.

    // exam_spans.go — additive span helper; reuses Registry primitives.
    // package telemetry
    // const MExamWriteAck = exam_write_ack_duration_seconds
    // const MExamTerminal = exam_terminal_receipt_seconds
    // type SpanKind string
    // const SealFinal SpanKind = final
    // const SealSATProvisional SpanKind = sat_provisional
    // const SealSATFinal SpanKind = sat_final
    // func RecordWriteAck(r *Registry, durSeconds float64, provider, outcome string)
    //   provider in (ielts, sat, act); outcome in frozen batch outcomes
    //   body: r.SetGauge(MExamWriteAck, durSeconds, provider, provider, outcome, outcome)
    // func RecordTerminal(r *Registry, durSeconds float64, sealKind SpanKind, outcome string)
    //   sealKind is required; there is no default that merges the three seals

Cost recorder sketch: a fixed-size struct populated from db, tx, and httpx hooks at one lifecycle join point (middleware response path), then emitted after commit. No per-request map allocation; no external calls inside measured transactions.

    // cost.go — per-request cost record (illustrative fields)
    // type RequestCost struct { SqlCount int; TxMs float64; Isolation string;
    //   LockWaitMs float64; PoolWaitMs float64; RowsExamined int64; RespBytes int }
    // func EmitCost(r *Registry, routeTemplate, method string, c RequestCost)
    //   emits http_sql_count, db_tx_duration_seconds, db_lock_wait_seconds,
    //   db_rows_examined_total, http_response_bytes with bounded labels only

Taxonomy sketch: a pure table-driven Classify function over frozen C07 codes. Unknown codes map to service_5xx plus a taxonomy_unknown_total tripwire so contract drift is visible, never silent.

    // taxonomy.go — illustrative mapping excerpt
    // func Classify(wireCode string, httpStatus int, transportCause string) string
    //   LEASE_FENCED, ATTEMPT_PROCTOR_BLOCKED -> authz_403 (never silently retried)
    //   RATE_LIMITED, RATE_LIMIT_EXCEEDDED -> rate_429 (honor Retry-After)
    //   TERMINALIZATION_CONFLICT, VERSION_COLLISION, SUBMISSION_ID_MISUSE -> conflict_409
    //   transportCause client_closed -> disconnect (kept out of the 5xx burn rate)
    //   default unknown -> service_5xx plus IncCounter(taxonomy_unknown_total, code, wireCode)

### 8.2 Alert plus runbook record (extends the prometheus-alert-rules.yml pattern)

New signals land as warning and promote to page only with calibration evidence plus owner sign-off. Every rule carries owner, threshold rationale with a calibration link, runbook URL, and fire-test id.

    // illustrative new rule (names and thresholds PROPOSED; re-ratify in calibration)
    // alert: StuckProvisionalDetected
    // expr: sat_provisional_pending_age_seconds > 600
    // for: 5m
    // labels: severity warning, slo exam-completion, owner worker-owner
    // annotations: summary = Provisional SAT work aging without final seal
    //   description = Oldest provisional result older than 10m. Check worker liveness, reconcile watchdog, DLQ depth.
    //   runbook_url = docs/runbooks/alerts/stuck-provisional.md
    //   threshold_rationale = PROPOSED — re-ratify from c09-calibration run id: reconcile capacity times expected storm.
    //   fire_test = TestStuckProvisionalFires in alert_parity_test.go

Runbook front-matter mirrors the rule so either direction resolves: the rule points at the runbook; the runbook names the rule expression, the threshold rationale, triage queries, recovery commands, silence criteria, and the fire-test pointer.

### 8.3 Deterministic-clock fixture (extends clock.Clock plus Vitest and Playwright patterns)

Backend already has clock.Clock with System and Fixed variants: inject via constructor (System at composition roots only, Fixed in tests). Frontend adds a small controllable clock with a tick API that interops with Vitest fake timers and Playwright clock interception. Race tests pair clocks with transaction barriers, never sleeps.

    // e2e/support/deterministicClock.ts — illustrative interface
    // interface DeterministicClock { now(): number; tick(ms: number): void;
    //   install(): () => void }  // install returns restore fn; afterEach restores
    // Go side: svc := NewFinalizeService(repo, clock.FixedAt(deadlineMinusOneSecond))
    // Barrier sketch: gate := NewTxBarrier(two connections); gate.Hold(commit A);
    //   run racer B; gate.Release(); assert exactly one terminal outcome (AC09 shape)

Three clock modes and when each is legitimate: real (calibration and perf lanes only); fake-timer (Vitest unit and hook tests); intercepted (Playwright browser tests via clock interception). Evidence rows must name which mode ran so injected faults never pollute calibration baselines.

### 8.4 Isolation scheme (CI worker contract — illustrative)

Per-worker MySQL database (or schema) plus seeded accounts namespaced by worker id plus distinct API ports plus isolated browser storage (Playwright storageState per worker plus fresh context per test) plus namespaced artifact dirs. The envGuard helper refuses prod URLs and live-student fixtures fail-closed.

    // ci-browser.yml shard step (illustrative env contract)
    // WORKER_ID from matrix shard (0..N)
    // TEST_MYSQL_DB: e2e_shard_<WORKER_ID>
    // PORT: 4100 + WORKER_ID (non-overlapping API ports)
    // PLAYWRIGHT_STORAGE: test-results/browser-<WORKER_ID>/storage
    // ARTIFACT_DIR: test-results/browser-<WORKER_ID>
    // Seed accounts namespaced: shard-<WORKER_ID>-student-<i> at test.invalid
    // envGuard.ts refuses: prod URLs, non-allowlisted schedule ids, live-student fixtures

---

## 9. Data and state flow

Exam event (entry, bootstrap, write, seal, roster, grade, export) flows through four stages. Instrumentation failure degrades to missing-metric, never to request failure.

Stage 1 — capture at the lifecycle join point: span timestamps via clock.Clock plus cost hooks (db, tx, httpx) record sql_count, tx_ms, lock_wait_ms, pool_wait_ms, rows_examined, response_bytes, queue_age_s, retry_class, error_class, cache hit or miss plus key-scope hash, budget_id. Spans record after commit for terminal and receipt paths (post-commit emit; never inside the measured transaction). Worker-originated mutations reach API-visible state via the durable bus or invalidation path owned by Phase 04 and 07 — observability reads the same API-visible state, never assumed shared memory.

Stage 2 — in-process fan-out: the cost plus span record feeds the Registry (/metrics exposition with HELP and TYPE headers, parity-tested) which Prometheus scrapes for alert rules that notify the owner with the runbook; the same record feeds structured JSON logs (request_id and trace_id correlation, redacted context) for diagnostics and incident evidence; the same record feeds calibration datasets (distributions plus cost plus error composition plus resource snapshots) for C09 gate proposals. The frontend examPerfSink (route-scoped ring, sampled, budget-compared, redacted) logs to console in development; its beacon path stays disabled unless an explicit flag plus security sign-off enables it for a named staging collector during calibration.

Stage 3 — CI lanes: fast PR lane, then DB-integration lane (contracts, serialization, migration-fault matrix), then browser-matrix lane (sharded, artifact-namespaced), then perf and restore lanes (scheduled and release-gated, staging and disposable targets only). Each lane writes PASS, FAIL, NOT RUN, or BLOCKED rows with candidate identity into the evidence ledger.

Stage 4 — Phase 07 consumption: frozen gate list, ledger HEAD, calibration record ids, dashboard plus runbook index, isolation proof template. Rollback of noisy instrumentation disables emitters only; correctness checks, invariant probes, and integrity alerts stay live so rollback never masks an integrity incident.

---

## 10. Edge cases

1. Cardinality explosion — a new label value per attempt, user, or route-param forks unbounded series. Mitigations: allowlisted keys and values (section 6.1), series-estimate per metric with parity test failing above estimate times two, route-template discipline, periodic cardinality audit in calibration runs. If exceeded: fail the introducing change, drop the offending label, never sample away integrity signals.
2. Noisy instrumentation — chatty spans or logs drown triage or cost more than the path they measure. Mitigations: sampling config on the frontend sink, per-request cost struct without map churn, safe-disable switch per emitter (correctness checks stay on), log-volume budget per route in calibration. Rollback: disable the noisy emitter; integrity alerts remain.
3. Flaky quarantine drift — quarantined tests silently become the norm (reference: WS-16 inventoried 37 quarantined markers by static count with no live-run delta). Mitigations: ledger as single source (marker counts are inventory, not evidence), owner plus deadline per quarantine, fail-closed skip markers with reason plus ledger row, periodic quarantine-burn review; third recurrence escalates the contract assumption.
4. Missing perf env — staging generator, devices, or DB-backed lanes unavailable. Mitigations: record NOT RUN or BLOCKED (never PASS), keep release blocked or route an explicit authorized-acceptance with a new evidence plan; perf lane stays comparative and advisory until C09 calibration completes. Never waive release checks for missing env; never run prod load as a substitute.
5. Clock and barrier misuse — Fixed clocks leaking into prod wiring, barriers left holding transactions (lock pile-up), interception masking real network behavior. Mitigations: constructor-injected clocks (System at composition roots only), barrier helpers with timeout plus auto-release plus test-only guards, interception recipes labeled in evidence so injected faults never pollute calibration baselines.
6. SAT provisional versus final conflation — merging the three terminal series hides reconcile-watchdog failure. Mitigations: seal_kind is a required label (no default), separate panels and alerts, AC11 two-process test as the proving gate.
7. Redaction regression — a new context field smuggles answers or tokens into logs. Mitigations: allowlist sanitizer (default-deny for new keys), adversarial property tests, secret-scan plus creds-guard in CI, pre-release log-sample review against I11.
8. Alert fatigue leading to ignored pages — thresholds copied from section 8 of the source plan or section 6.2 here without calibration. Mitigations: new signals land as warning, promote only with calibration plus owner sign-off; every alert needs threshold rationale plus silence criteria plus fire-test; noisy-but-correct alerts get threshold work, never silent deletion.
9. Route-template gaps — a new handler registered without the template wrapper leaks raw parameterized paths into labels. Mitigations: route-template assertion test over access-log output; parity review on every new route; sanitize-and-drop fallback that emits an unknown-route tripwire rather than a raw path label.
10. Beacon skew — frontend beacons arriving late or not at all during an outage create survivorship bias if paged on. Mitigations: page integrity on server-observed series (finalize, fallback rows, invariant violations), use beacon signals as warning-grade correlates only; document the bias in each affected runbook.

---

## 11. Errors

Error handling inside Phase 06 follows the frozen C07 vocabulary (section 6.3); this section governs how observability and CI surface failures rather than defining new product errors.

- Instrumentation errors (clock failure, registry contention, sink overflow): degrade to missing-metric plus a telemetry_internal_drop_total tripwire keyed by component; never fail the request, never retry the exam operation because telemetry failed. Rationale: I12 — a measurement fault must not become an exam fault; a gap in metrics is observable (tripwire fires) while a failed submit is silent loss.
- Taxonomy unknowns (unmapped wire code): classify as service_5xx plus increment taxonomy_unknown_total keyed by code so contract drift pages the contract owner; frontend logs the measurement class, never the raw payload. A new wire code appearing in taxonomy_unknown_total is a Phase 01 contract-amendment trigger, not a local relabel.
- Beacon failures (perf or error beacon rejected or offline): buffer bounded, drop oldest with a drop counter, surface a diagnostics-degraded indicator in the UI only where Phase 03 approved the surface — never block submit or ack paths on beacon success. The ack path and the diagnostics path share no fate.
- CI failures: lane outputs FAIL with command plus env plus exit plus artifact link; infrastructure failures (runner or DB-service down) are BLOCKED with the missing env named, not FAILED product code; both block release, but the repair owner differs (operations versus producing phase). Conflating the two misroutes the repair and hides either product risk or infra debt.
- Calibration failures (generator saturation, staging skew): record the limiting resource plus generator capacity attestation; do not extrapolate, do not lower volume to force green (an integrity failure at lower volume still fails the gate and sets the supported limit). A run that measures the generator is a generator-capacity finding, not a system pass.
- Alert-expression failures (rule references a renamed series): the parity test fails the introducing change before merge; if a rename ships anyway, the stale rule must warn via a rule-evaluation-error tripwire and the ledger records a BLOCKED monitoring gap until repaired — never silent darkness. Renaming a metric without updating its rule is a monitoring outage and is treated as one.

---

## 12. Performance and security

### Performance (of the measurement plane itself)

- Backend hot path: fixed-size cost struct, no per-request map allocation, emit-after-commit, label-pair sorting on bounded small sets (existing seriesKey behavior — keep label counts at or below 4 per series). Instrumentation must add no measurable p95 to the write-ack path; the calibration run asserts this by comparing instrumented versus baseline candidates on the same profile (I12 gate).
- Frontend: synchronous checkpoint budget stays inside the 100 ms input p95 (measure before choosing representation — Phase 03 constraint); sink ring bounded (100 per route), sampling for high-frequency spans (typing, polls), no beacon on the input-critical path. Typing stays synchronous and responsive; diagnostics never win a scheduling fight with active input.
- CI: fast-PR lane target under 10 minutes (confirm in WP00 with current timings); heavy lanes (browser matrix, perf, restore) run nightly, scheduled, or release-gated, never per-push-blocking beyond the PR lane. A slow gate that developers bypass is worse than a scoped gate they respect — keep the PR lane fast and move weight to scheduled lanes.
- Calibration: generator capacity attested per run (if the generator saturates first, the run measures the generator, not the system — record and re-run with more generator). Every perf claim names dataset, configuration, infrastructure, and generator headroom or it is not a claim.

### Security (I11 plus WP05 and WP13 constraints)

- Redaction (hard, I11): no answers, writing bodies, answer keys, tokens, passwords, or unnecessary student identifiers in telemetry, logs, metric labels, error contexts, beacons, artifacts, or runbooks. IDs appear only in justified diagnostic context (request_id and trace_id correlation), never in labels. New log and metric context keys default-deny through redact.ts and the taxonomy tests: an unlisted key is dropped and counted, not passed through. Pre-release log-sample review against I11 is a release gate, not an aspiration.
- Secret scanning: gitleaks stays mandatory in the PR lane; tracked-credential guard stays (reject tracked non-example creds files); k6 staging scenarios use disposable staging creds via env or secret mounts, never committed files; env handling follows the WP00 secret inventory (config fingerprints in evidence records, never secret values). A leaked credential rotates the credential and invalidates the evidence that embedded it.
- Production-helper guards: explicit environment allowlists plus authorization for any prod-targeting helper; never live students as fixtures (no override flag exists by design — a request for one is a plan-scope escalation to L0, not a parameter); prod k6 keeps the prod-confirm refusal verbatim; staging calibration uses a distinct staging confirm gate so the two can never be confused by a single mistyped variable.
- Dependency review: add a dep-review gate (new) with targeted — not blanket — updates plus regression checks (WP05 posture). Each update names the exposure it closes and the suites that re-prove behavior.
- Access control on evidence: calibration records plus ledger link raw evidence without embedding secrets or dumps; restores target disposable environments only; diagnostic bundles attached to ledger rows pass the same redaction sanitizer as logs.

---

## 13. Tests (signal-fire tests plus gate reproducibility; no permanent retry-hiding of critical failures)

Backend (Go, backend/go tree): alert_parity_test.go extends the WS-10a pattern — every series in prometheus-alert-rules.yml must be in Names(), every rule must have a registered fire-test, every new metric must carry a series-estimate comment honored by calibration. Per-alert fire-tests, one per section 6.4 row: TestStuckProvisionalFires (Fixed clock ages a provisional past threshold, gauge moves, rule expression true on synthetic exposition; happy path silent); TestFanoutRetryBurnFires; TestDLQAgeFires; TestCacheFreshnessFires; TestRevocationStaleAcceptPages (zero-tolerance: a single stale-accept fires); TestSubmitConflictSpikeFires; TestSATFallbackPagesOnLegacyRow (covers both the legacy-source case and the zero-answer pass where neither source answered); TestFinalizeRejectedFires; TestHTTP5xxBurnFires. taxonomy_test.go covers the full C07 code table to measurement class (including the SUBMISSION_ID_MISUSE naming trap and the acknowledgements versus internal acks shape); an unknown code maps to service_5xx plus the tripwire. cost_test.go and exam_spans_test.go use Fixed clocks, keep the three seal_kinds separate, populate cost fields from mocked hooks, and prove that an instrumentation failure yields missing-metric while the request still succeeds. Label-discipline tests: forbidden-key grep over call sites, route-template assertion, cardinality-estimate pins. Redaction property tests use adversarial payloads (nested details maps, huge bodies, Unicode, token-shaped strings). Determinism: no time.Sleep ordering in new tests (grep-gate); race tests use tx barriers; run with race and count 1.

Frontend (Vitest, jsdom): redact.test.ts — answers, tokens, passwords, keys stripped; IDs coarsened; depth and size caps hold; default-deny on unknown keys. examPerfSink.test.ts — ring bounds, sampling, budget comparison against PROPOSED values, slow-op signal on budget breach, beacon disabled-by-default. errorTaxonomy.test.ts — frontend error classes map to section 6.3 classes at the transport boundary; Retry-After honored; no blind retry storm (AC14 shape, fake timers). Clock, barrier, interception, and storage-fault helper unit coverage for the new e2e support helpers lands on the Vitest side before browser use.

Browser (Playwright, default Go-backed suite): rewrite frontend-performance.spec.ts against the frozen sink with real assertions (input, render, ack spans on IELTS plus SAT-adaptive plus ACT-science fixtures); delete vacuous guards — an absent signal on a measured route is FAIL, not skip. Storage-fault suites (AC02 and AC04 shapes via storageFaults.ts), lost-ack-after-commit (AC03 via netIntercept.ts), stale-epoch and takeover (AC07), blocked-submit (AC08) — each deterministic via clocks and barriers, sharded, artifact-namespaced. Targeted a11y: extend the sat-a11y config pattern to critical exam paths (entry, answering, submit, recovery surfaces); critical-path a11y regressions block the lane.

Contracts and serialization (new, DB-integration lane): HTTP serialization tests assert actual wire bodies against api/openapi/openapi.yaml (statuses, envelopes, nullability, limits, pagination), old-plus-new consumer combinations, and the bootstrap POST-plus-304 compatibility path. Migration jobs cover fresh install, representative upgrade, interrupted rerun, and old-new compat (reuses the WP12 rehearsal route; this lane only gates, WP12 owns the procedure). Staging k6 calibration scenarios are repeatable, generator-capacity attested, evidence-linked, never prod.

Gate-reproducibility bar: a clean checkout reproduces every lane suite from the ledger commands alone; quarantined tests report skipped-with-reason; flakes get owner plus deadline per the flaky policy in step 11 — a critical failure is never hidden behind retries, and a retried-then-green critical path without a root-cause note is still FAIL pending the owner deadline.

---

## 14. Verification commands

Confirm actual script bodies in WP00 before running. Never run production-targeting configs (prod-load, prod-smoke, remote) from calibration. Staging k6 needs its own confirm-gate plus a disposable target.

Fast PR lane (representative; the authoritative list lives in ci-pr.yml after the split):

    npm run typecheck && npm run lint && npm run test:run && npm run build
    npx prettier --check <changed-ts-files> --config .prettierrc
    npx --yes @redocly/cli lint api/openapi/openapi.yaml
    git ls-files | grep -E creds.json | grep -v example && echo CREDS-LEAK || echo creds-clean

Go lanes (run from backend/go):

    gofmt -l .                                   # must print nothing
    go vet ./...
    go test -count=1 -coverprofile=$RUNNER_TEMP/coverage.out ./...
    go test -race -count=1 ./internal/...
    go build ./cmd/api ./cmd/worker ./cmd/migrate
    go run ./cmd/migrate && go run ./cmd/migrate --validate-only
    TEST_MYSQL_DSN=<per-worker-DSN> go test ./integration/ -v -count=1
    go run honnef.co/go/tools/cmd/staticcheck@v0.8.1 ./...

Telemetry and alert gates (new; authoritative check is the Go test, the Python snippet is a pre-check illustration only):

    go test ./internal/platform/telemetry/ -run TestCountersRenderInSnapshotExposition|TestAlertParity|TestStuckProvisionalFires|TestTaxonomy -v -count=1

Browser, perf, and restore lanes:

    npx playwright test --list --project=chromium   # inventory; quarantined markers visible
    npx playwright test                             # default Go-backed suite (local only)
    npx playwright test --config playwright.sat-a11y.config.ts
    npm run test:performance
    K6_CONFIRM_STAGING=true k6 run k6/staging/entry-wave.js   # staging only; never the prod confirm var here
    bash scripts/backup-rehearsal.sh --dump=$RUNNER_TEMP/rehearsal.sql   # disposable target only

Determinism and hygiene gates (new):

    grep -rn time.Sleep backend/go/internal/platform/telemetry/   # must print nothing
    grep -rn attemptId scheduleId userId in telemetry sources filtered to label usage   # must print nothing
    git diff --check

Evidence to attach per run: command plus env fingerprint (no secrets) plus exit status plus artifact links plus candidate identity (revision plus dirty hashes plus schema version plus config fingerprint plus lockfiles), recorded in the ledger row. A gate without attached evidence is NOT RUN regardless of what the terminal appeared to show.

---

## 15. Completion checklist

- [ ] WP00 baseline pulled; safe scripts confirmed; unavailable envs recorded as BLOCKED (no substitution).
- [ ] C05, C06, C07, C09 metric semantics frozen with Phase 01; frozen versions recorded in this file header.
- [ ] Signal inventory done: every emitted series has a consumer; no alert points at a never-emitted series (WS-10a discipline preserved and extended).
- [ ] Lifecycle spans live (entry, bootstrap, write-ack, terminal with 3 seal_kinds kept separate, roster, grading, exports) with cost fields (SQL, txn, lock, pool, rows, queue-age, retry, saturation, bytes) — additive, degrade-to-missing-metric, no query-shape changes.
- [ ] Error taxonomy frozen (C07 table) plus retry-owner table audited with Phase 04; AC03- and AC14-shaped tests pass.
- [ ] Label discipline plus redaction enforced by tests (I11: no answers, tokens, passwords, or unnecessary IDs in telemetry; secret scan plus creds-guard green; pre-release log-sample review done).
- [ ] Frontend sink consolidated (one owner, one interface); stale frontend-performance spec rewritten with real assertions (no vacuous guards); beacon disabled-by-default plus redaction sign-off path documented.
- [ ] All section 6.4 alerts live with owner plus threshold rationale plus runbook plus fire-test; existing page rules never went dark; new rules warning-first with promotion criteria recorded.
- [ ] Deterministic fixtures landed (clocks, tx barriers, interception, storage faults); at least 1 sleep-based test converted per area as pattern reference; no new time.Sleep ordering.
- [ ] Parallel-worker isolation proven (DB and schema plus accounts plus ports plus browser storage plus artifacts; ledger shows worker to db to port to dir per run); envGuard.ts refuses prod URLs plus live-student fixtures.
- [ ] CI lanes split per section 6.5, each independently revertible (verified by per-lane revert on a scratch branch); serialization and contract tests, migration jobs, secret scan, dep review, targeted a11y all gating; floors preserved (Go ratchet 27, 75 percent frontend statements, 500 KiB bundle, no tracked non-example creds).
- [ ] At least 1 C09 calibration run recorded (profile id plus fingerprint plus distributions plus raw evidence) with gate proposals submitted; perf lane stays advisory until C09 approval — no permanent gates set unilaterally.
- [ ] Ledger live with failing, skipped, quarantined, and unavailable rows (skipped critical is NOT RUN, never PASS); flaky policy published with owner-plus-deadline enforcement (critical at most 14 days, other at most 30 days); no permanent retry-hiding of critical failures.
- [ ] Rollback verified: noisy emitter disables cleanly (correctness checks plus integrity alerts stay live); each CI lane reverts independently; release checks unwaivable for missing env.

---

## 16. Handoff to Phase 07 (evidence plus gates consumed)

Phase 07 (Integrated rehearsal, rollout and cleanup) consumes the following frozen outputs from Phase 06 — link exact revisions, not latest:

1. Frozen gate list plus contract versions: C09 profile id or ids, PROPOSED-to-approved gate deltas (which section 6.2 rows L0 approved, with values plus boundaries), C05, C06, C07 frozen versions, alert-rule file revision plus dashboard revision.
2. Calibration evidence pack: per-run records under the c09-calibration directory (workload, resources, config fingerprint, p50, p95, p99, error composition, CPU and RSS, connections, SQL and lock waits, storage latency, queue age, drain time, generator-capacity attestation, raw evidence links) plus baseline-versus-candidate pairs for any tuned path.
3. Ledger HEAD: test-evidence-ledger.md revision with zero unresolved critical FAIL or BLOCKED on required lanes; quarantined rows carry owner plus deadline; unavailable rows carry the re-run plan (Phase 07 does not re-litigate semantics — it re-runs the recorded plan).
4. Alert plus runbook readiness: every section 6.4 alert fire-tested on the frozen candidate; runbooks reviewed by a non-author (15-minute triage bar met); on-call contacts plus evidence-retrieval procedures recorded (feeds WP15 rollout plus incident procedure).
5. Rehearsal routes: deterministic fixture library (deterministicClock, txBarrier, netIntercept, storageFaults, envGuard), isolation contract (worker to db to port to dir), staging k6 scenarios plus confirm-gate, restore-lane procedure — ready for AC01 through AC20 integrated runs, fault, restart, load, and restore rehearsal, plus staged-rollout observation windows.
6. Known limits disclosed: generator ceilings, device and browser slices not yet covered, envs still BLOCKED, residual risks from ledger rows — the Phase 07 release decision needs the limits as much as the greens; an undisclosed limit is a BLOCKED item, not a footnote.
7. Ownership transfers: CI and deploy files remain operations-owned into rollout; alert ownership passes to named on-call with the runbook index (observability-lookup.md); any warning-to-page promotions pending calibration evidence are flagged with their evidence plan, not silently carried as pages.

---

*End of Phase 06 file. Planning only — all boxes unchecked; implementation, calibration runs, and independent review remain future work.*