# Phase 07 - Integrated Rehearsal, Rollout and Cleanup

Wave: D (L0 integration + authorized ops; L4 independent check).
Sources: docs/optimize.md WP14 (integrated fault/browser/capacity/recovery rehearsal), WP15 (staged rollout + production acceptance), WP16 (evidence-gated compatibility retirement); acceptance matrix section 7 (AC01-AC20); freeze/review/repair protocol section 4.5; budgets section 8; release/rollback checklist section 10; evidence ledger section 11.
Owner: L0 integration owner + authorized operations owner. L4 independent checker (must differ from the integrator who froze the candidate; if agents are unavailable, a second sequential pass by a different human with written non-independence disclosure - never self-approval).
Depends on: all required correctness/security/UI phases (Phases 01-04 incl. WP02-WP09 scope), Phase 05 (MySQL tuning + migration/restore rehearsal, WP11/WP12), Phase 06 (observability/budgets/CI/fixtures, WP10/WP13). WP16 additionally depends on WP14 evidence PLUS per-target usage + consumer-compat + migration-window proof.
Status: Planning only. This file changes no code, no data, no deployment, no credentials. Every checkbox starts unchecked.

---

## 1. Objective

Prove that the INTEGRATED FROZEN CANDIDATE - not any isolated patch - holds the exam-lifecycle promise end to end under fault, load, restart, restore, and rollout conditions, then release it in controlled cohorts with tested rollback, and only afterwards retire compatibility paths whose removal is proven safe:

Student intent to recoverable answer to acknowledged write to authoritative submission to correct score to authorized result.

Concretely, Phase 07 must:

1. INTEGRATE all landed scopes (scoring chain, terminalization/jobs, client durability, auth/API/runtime, DB/migrations, observability/CI) into one runnable candidate and FREEZE its identity (source rev + dirty hashes, schema version, config fingerprint, lockfiles, build artifacts).
2. REHEARSE (WP14): run ALL AC01-AC20 against that frozen candidate; exercise risk-based mode combinations; inject the defined fault set; run authorized-staging representative load (arrival wave, steady writing, section changes, submit storm, proctor observers, grading background, post-exam cleanup) plus backlog recovery and soak over lease/token/retention/job intervals; demonstrate capacity WITH safety margin without extrapolating daily registrations to concurrency; validate restore THROUGH the application, not just DB import success.
3. GATE: submit the frozen candidate to L4 independent inspection + rerun, classify every finding BLOCKING / IMPORTANT / OPTIONAL, and loop targeted repair to new candidate to recheck (1st local repair, 2nd root-cause, 3rd escalate assumption - never repeat the same patch).
4. ROLL OUT (WP15): obtain explicit approvals (SLOs, RPO/RTO, flags, rollback package, policy changes), climb the COHORT LADDER (internal/synthetic, small representative, expanded, full) with pre-defined windows and exit criteria, enforce ZERO-TOLERANCE integrity stops and SUSTAINED-THRESHOLD perf stops, verify ROLLBACK COMPATIBILITY (cache/job/schema vs rollback binary; preserve journals/evidence/queues), run synthetic post-deploy checks, and hand off to on-call.
5. CLEAN UP (WP16, conditional): only after WP14 evidence exists, retire V1 writes / duplicate stores / redundant gateways / flags IFF equivalence tests + usage + compat + migration-window proof all hold; otherwise RETAIN + document the compat contract. Any post-candidate removal is a NEW CANDIDATE requiring rechecks.
6. NEVER claim production readiness while required evidence or approval is missing: preserve the verified engineering candidate, disclose the exact gap, and stop cohort expansion.

Release sign-off rule (non-negotiable): the delivered candidate is the reviewed candidate - same source/config/schema identity that L4 checked and approvers approved. Any mutation (including cleanup removal) creates a new candidate identity that must re-pass affected gates.

---

## 2. Scope / Out of Scope

### 2.1 In scope (integrate, gate, roll out - WP14/WP15/WP16)

- Integrated AC01-AC20 execution against the frozen candidate (section 13 runbook).
- Risk-based mode-combination coverage: PAIRWISE for independent knobs; EXHAUSTIVE TARGETED for auth/fencing, cross-process notification, row-first materialization, terminalization interactions (section 7.3).
- Fault injection: API restart, worker restart, DB slowdown, lost ack, stale caches, browser storage failure/denial/quota, expired tokens, deadline storms including autosubmit fan-out under kill/restart (section 7.4).
- Authorized-staging representative load + backlog recovery + soak (sections 7.5-7.6).
- Capacity + safety-margin statement without registration-to-concurrency extrapolation (sections 6.3, 12.3).
- App-level restore validation (answers, receipts, results, media, replay behavior) against approved RPO/RTO (section 7.7).
- Candidate freeze record + evidence ledger + L4 check + BLOCKING/IMPORTANT/OPTIONAL classification + repair/recheck loop per protocol 4.5 (sections 7.2, 7.8-7.9).
- Rollout approvals, cohort ladder with windows/exit criteria, stop conditions, rollback-compat verification, synthetic post-deploy checks, on-call handoff (sections 7.10-7.14).
- Conditional WP16 cleanup with equivalence-first discipline and retirement records (section 7.15).

### 2.2 Out of scope (do not re-own phase internals)

- Phase 02 internals (response to routing to score to result resolver logic, key pinning, fallback precedence).
- Phase 03 internals (DurableResponseEngine write identity/ack/replay, storage namespaces, conflict archive).
- Phase 04 internals (auth matrices, wire DTO fixes, cache invalidation implementation, runtime clock authority).
- Phase 05 internals (index DDL choice, pool sizing math, migration authoring, backup tooling).
- Phase 06 internals (metric instrumentation, alert rule authoring, CI job design, fixture seeding).
- Any change to examination timing, scoring policy, grading permissions, admission business rules without an approved spec (section 5 constraints).
- Rewrite, blanket dependency upgrades, new queue infra (Redis/another queue), microservices, sharding, guessed index DDL, timeout growth as diagnosis substitute, weakened assertions.
- Production load tests / deployment / data repair / deletion / migration execution / credential access ON THE AUTHORITY OF THIS PLAN ALONE - each requires separate explicit deployment authorization naming environment, window, operator, and blast radius.

Phase 07 INTEGRATES, FREEZES, EVIDENCES, GATES, AND ROLLS OUT. When rehearsal finds a defect, Phase 07 files it against the owning phase/scope and verifies the repair - it does not silently absorb other-scope ownership. Single-mutation-owner rule still applies: Phase 07 owns only its rehearsal/rollout/cleanup artifacts listed in sections 4-5; production-scope files under active ownership are touched only via explicit transfer.

---

## 3. Dependencies

### 3.1 Hard prerequisites (must be DONE or explicitly closed as already-satisfied with evidence before WP14 starts)

Prerequisite - What Phase 07 needs - Gate artifact:

- Phase 01 (WP00/WP01) baseline + frozen C01-C09 + AC01-AC20 fixtures/owners. Needs: frozen contract versions C01-C09; deterministic IELTS/SAT-adaptive/ACT-science fixtures; C09 workload profile; C05 freshness bound value; approved SLO/RPO/RTO proposals or explicit TBD list. Artifact: contract version sheet; fixture inventory; C09 profile doc.
- Phase 02 (WP02/WP04-term) scoring chain + terminalization/job ownership. Needs: authoritative source resolver; terminalization authority; job lease/idempotency/recovery semantics; transaction boundaries. Artifact: AC05/AC06/AC09/AC10 evidence from owner phases.
- Phase 03 (WP03/WP08/WP09) client durability + rendering + UX. Needs: namespaced storage upgrades; ack-matching; quarantine/blocked surfacing; a11y-critical paths; old/new bundle compat matrix. Artifact: AC01/AC02/AC04/AC07/AC08/AC17 evidence.
- Phase 04 (WP05/WP06/WP07) auth/API/runtime. Needs: auth matrix; wire envelope freeze; conditional-read semantics (GET path + compatible POST); cross-process invalidation path; server-clock authority. Artifact: AC07/AC13/AC14/AC15/AC16 evidence.
- Phase 05 (WP11/WP12) DB tuning + migration/restore prep. Needs: stable query shapes tuned on production-like data; migration lineage head + expand/contract plan; scratch-restore rehearsal route + RPO/RTO measurement method. Artifact: query before/after evidence; restore rehearsal log.
- Phase 06 (WP10/WP13) observability/CI/fixtures. Needs: calibrated budgets; integrity alerts with runbooks + fire-tests; redaction/cardinality checks; deterministic clocks/barriers; isolated parallel-test topology; fast vs integration vs browser vs perf vs restore CI split. Artifact: alert catalog; CI gate definition; ledger template.

### 3.2 Entry criteria for WP14 (all must hold; otherwise Phase 07 stays PENDING with a named blocker)

1. One integrated build (API + worker + web bundle + migration head) assembles cleanly from a recorded base revision.
2. C01-C09 versions referenced by that build are frozen; any post-freeze contract edit restarts entry.
3. No open BLOCKING finding from owner-phase checks against scopes in the candidate.
4. Staging environment authorization exists (named environment, data classification, synthetic accounts only - never live students as fixtures, WP13 guard).
5. Telemetry redaction + alert runbooks needed for rehearsal signals are present (minimum: silent-loss probe, terminal-conflict probe, DLQ-age probe, revocation-failure probe, storage-error probe).
6. Rollback binary + compatible migration window identified (which prior release the candidate can roll back to, and which schema states that binary reads).

### 3.3 WP15 entry: WP14 CHECKED with zero unaccepted BLOCKING/IMPORTANT + written deployment authorization. WP16 entry: WP14 evidence + per-target retirement proof (see 7.15). Final sign-off entry: WP15 cohort evidence + applicable WP16 rechecks.

---

## 4. Affected files (rediscovered navigation starts - confirm live before editing)

Workers must rediscover exact symbols/tests before changing code. Paths below were observed in the current tree (Sep 2026) and are STARTING POINTS, not a closed list. If a path moved, record the new path in the evidence ledger; do not edit by assumption.

### 4.1 Integration-test surfaces (extend; do not fork competing harnesses)

- Backend: backend/go/internal/attempts/ (incl. submit.go), backend/go/internal/terminalization/, backend/go/internal/sat/, backend/go/internal/outbox/, backend/go/internal/runtime/, backend/go/internal/liveupdates/, backend/go/internal/delivery/, backend/go/internal/student/ (incl. v1_write.go, readthrough.go, readthrough_test.go, presencerecord_test.go), backend/go/internal/assessscore/, backend/go/internal/act/, backend/go/internal/grading/, backend/go/internal/results/, backend/go/internal/auth/, backend/go/internal/authz/ (incl. authz.go, table_staff.go), backend/go/internal/accesslinks/, backend/go/internal/media/, backend/go/internal/app/app.go, backend/go/cmd/api/main.go, backend/go/cmd/worker/main.go, backend/go/cmd/migrate/main.go (+ MIGRATION_POLICY.md, lineage_test.go, engine_gate_test.go, receipt_immutability_test.go, repair_0057_test.go).
- Client: src/shared/durability/DurableResponseEngine.ts, src/shared/durability/types.ts, src/shared/durability/useResponseDurabilityStatus.ts, src/features/student/api/responseDurabilityTransport.ts, src/features/student/hooks/useStudentSessionRouteData.ts, src/features/student-delivery/hooks/useSatResponsePersistence.ts + checkpoint/outbox/quarantine adapters (glob src/features/student STAR STAR), src/shared/api/apiClient.ts, src/shared/api/queryClient.ts, src/features/auth (all), src/features/student-delivery/hooks/useSatExamController.ts, src/components/proctor/ProctorDashboard.tsx, src/components/admin/StudentReviewWorkspace.tsx, src/features/exam-authoring/ui/AuthoringWorkspace.tsx.
- Contracts: api/openapi/openapi.yaml; frontend API contract mirrors (via contract owner).
- Existing suites to extend: backend/go test files (esp. internal/platform/telemetry tests, internal/platform/apperrors/status_mapping_test.go), Vitest (npm run test:run), Playwright specs under e2e/ (incl. e2e/prod-smoke/, e2e/prod-load/, e2e/support/prodProgress.ts, e2e/support/prodOrchestration.ts), tests/regression/README.md scope, dbg168_main_test.go / mint168f_main_test.go only if owned behavior overlaps (confirm with owner first).
- DO NOT treat e2e/.generated (all), playwright-report (all), test-results (all), coverage (all) artifacts or any committed prod credential/target files (k6/k creds json, k6/k target json, e2e/prod-data/prod-creds.json, e2e/prod-data/prod-target.json, e2e/prod-load/live-users.500.csv) as reusable fixtures without WP13 guard review - generated logs are evidence exhaust, committed real credentials/targets are a secret-hygiene finding to remediate, not a test input.

### 4.2 k6 load profiles (calibrate; never run prod-targeting scripts without authorization)

- Staging-safe rehearsal set: k6/prod-exam-day.js (full-day shape), k6/prod-start-exam-200.js (entry/bootstrap wave), k6/prod-section-transition-200.js, k6/prod-submit-storm-200.js, k6/prod-resume-100.js, k6/prod-auto-submit-200.js, k6/prod-load-helpers.js, k6/scale-proof/ (0_entry_wave.js, 1_bootstrap_herd.js, 2_contend.js, 2_bootstrap_staggered.js, 3_pollers.js, 3_bootstrap_arrival.js, 4_ws_staff_soak.js, README.md).
- Entrypoints: npm run k6:exam-day, k6:start-exam, k6:section-transition, k6:submit-storm, k6:resume, k6:auto-submit; combo runner npm run e2e:live-with-k6 (k6 + live multi-user runner e2e/prod-load/live-multi-user-runner.ts via npm run e2e:live-runner).
- PROHIBITED without separate written authorization: any k6 target json pointing at production, any playwright prod-load / prod-smoke / remote config targeting remote/prod (playwright.prod-load.config.ts, playwright.prod-smoke.config.ts, playwright.remote.config.ts), and any e2e:prod-load / e2e:prod-smoke / e2e:live-runner / test:live-runner invocation against non-staging hosts. Phase 07 rehearsal runs staging-pinned copies with sanitized synthetic accounts; the exact target allowlist is recorded in the freeze record (section 6.1 field staging_target).

### 4.3 Runbooks / operations docs (use + extend, keep one owner per file)

- docs/runbooks/student-answer-durability.md, docs/runbooks/exam-day-mysql-scale.md, docs/runbooks/sat-student-tools-exam-day.md; docs/sat-hardening.md, docs/sat-hardening-baseline.md; docs/architecture/, docs/audits/, docs/adr/; proposed versioned evidence root docs/production-hardening/ (WP00 proposal - create only if absent, with ledger index; never scatter duplicate evidence dirs).
- CI: .github/workflows/ci.yml, .github/workflows/backup-rehearsal-cron.yml, .github/workflows/mirror-main.yml; configs playwright.config.ts, playwright.sat-a11y.config.ts, vitest.config.ts, vitest.prod-load.config.ts, vite.config.ts, eslint.config.js, .env.test (never real secrets).
- Telemetry: backend/go/internal/platform/telemetry/telemetry.go, registry.go, registry_test.go, counter_exposition_test.go; alerts/dashboards owned by operations owner.

### 4.4 Rollout / rollback records (read first; append, never rewrite history)

- Prior rollout logs, migration lineage state (backend/go/cmd/migrate/), backup/restore rehearsal logs, incident playbooks in docs/runbooks/, and the rollback binary compatibility notes (which schema/payload versions it reads). If none exist, record the sentence no prior record - rollback window established by this phase and define it explicitly in 6.3.

### 4.5 Cleanup targets (WP16 candidates - each needs its own retirement record; presence here authorizes investigation only, never removal)

- T1 V1 write path: backend/go/internal/student/v1_write.go + V1 mutation ledger semantics. Why suspect: legacy envelope alongside row-first writes; dual-write ambiguity risk (C01/C02). Retirement requires: equivalence tests row-first equiv V1-read; zero V1-write usage over migration window; old-client compat test; rollback-binary read proof.
- T2 Legacy readback/materialization: backend/go/internal/student/readthrough.go triple-rebuild (+ proctor/rosterpage.go legacy no-runtime branch). Why suspect: rebuild vs row-authoritative divergence. Requires: same as T1 + AC05/AC06 cross-consumer agreement on V2-only + mixed fixtures.
- T3 Legacy admin/proctor compat surfaces: proctor/notes_rules.go legacy repo surfaces, sessions.go legacy_section_v1 timing string, unfenced nil-revision fallbacks in library/service.go. Why suspect: shims that can mask fencing/auth regressions. Requires: auth/fencing exhaustive matrix green without shim; usage proof; retained-contract doc if kept.
- T4 Duplicate response stores / redundant result gateways (grep results/, grading/ gateways; confirm live - no confirmed dup gateway in current grep beyond error-mapping). Why suspect: dual source of truth for results. Requires: single-resolver proof (AC05/AC06/AC12); export/review agreement; no consumer reads retired store.
- T5 Bootstrap compat: old POST-that-returned-304 behavior + any redundant gateway kept for old bundles (WP06). Why suspect: HTTP-semantic debt; cache-boundary risk. Requires: AC15 old/new consumer matrix; cache-key isolation proof; adoption evidence.
- T6 Feature flags / safe-to-disable switches introduced during rollout (enumerate live; do not assume names). Why suspect: flag sprawl; stale kill-switches. Requires: flag-by-flag usage + default-path soak + removal-as-new-candidate recheck.
- T7 Dead code / obsolete tests / stale docs (incl. stale line-number references, historical migration-count claims, e2e/.generated exhaust, committed secret-shaped files). Why suspect: misleading evidence; secret hygiene. Requires: dead-code proof via coverage + grep + review; docs/tests removed TOGETHER with code; secret rotation if real credentials were committed.

If any T-item lacks usage/compat/migration-window proof, Phase 07 RETAINS it and documents the compat contract (section 5.4). Looks-old is never a retirement reason.

---

## 5. New files (Phase 07 owns; one writer at a time)

All new evidence lives under the versioned root proposed by WP00. If WP00 chose a different root, use it and record the mapping here. Default layout:

~~~text
docs/production-hardening/
  README.md                                  # index: candidates, ledgers, logs, records
  candidates/
    CANDIDATE-ID/
      freeze.json                            # 6.1 freeze schema (machine-readable)
      freeze.md                              # human-readable rendering of freeze.json
      build.log                              # full build output for this candidate
      sbom.txt (or lockfile hashes inline)   # dependency identity actually shipped
  evidence/
    CANDIDATE-ID/
      ac-runbook.md                          # per-AC rows with links to raw logs
      acXX logs                              # raw per-AC output (or pointer to CI artifact URL)
      fault-injection.md                     # fault matrix + observations
      load/
        staging-load-plan.md                 # C09 instantiation for this run
        k6-summary.json                      # k6 end-of-run summaries (each profile)
        traces/                              # p50/p95/p99, CPU/RSS, SQL/lock, queue-age series
      soak.md                                # lease/token/retention/job-interval coverage
      restore.md                             # scratch-restore validation (app-level)
      capacity-statement.md                  # supported load + margin, no extrapolation
      l4-report.md                           # L4 independent inspection + rerun log
      classification.md                      # BLOCKING/IMPORTANT/OPTIONAL register
      repair-log.md                          # repair to new candidate to recheck chain
  rollout/
    approvals.md                             # SLO/RPO/RTO/flags/rollback/policy sign-offs
    rollout-log.md                           # cohort ladder execution (5.3)
    rollback-compat.md                       # 6.3 matrix instantiation
    synthetic-postdeploy.md                  # post-deploy synthetic checks
    oncall-handoff.md                        # contacts, playbooks, evidence retrieval
  retirement/
    TARGET-ID.md                             # 5.4 per-target retirement/retention record
~~~

### 5.1 Candidate freeze record (freeze.json + freeze.md)

Machine-readable identity of exactly what was rehearsed/reviewed/released. Schema in 6.1. One directory per candidate; latest is a symlink/file pointer, never a copy. Any byte difference in source, config, schema, or lockfiles equals a new CANDIDATE-ID.

### 5.2 Evidence ledger (evidence/CANDIDATE-ID/ac-runbook.md + raw logs)

Implements the section 11 ledger row per AC plus load/soak/restore/L4/classification/repair entries. Template in 8.3 (ledger) and 8.4. Raw logs attached or linked with content hashes; CI artifact URLs recorded with retrieval date. Skipped/quarantined/unavailable tests listed explicitly - a skipped critical test is NOT RUN, never PASS.

### 5.3 Rollout log (rollout/rollout-log.md + approvals.md)

Append-only cohort ladder record: candidate id, cohort definition, window start/end, exit-criteria evaluation per cohort, stop-condition evaluations, decisions (advance / hold / roll back), operator signatures. Approvals recorded before cohort 1 starts; any approval change mid-ladder restarts the affected cohort.

### 5.4 Retirement record (retirement/TARGET-ID.md per T-item)

For each WP16 candidate: equivalence tests, usage evidence, consumer-compat matrix, migration-window dates, decision (RETIRE with removing commit + new-candidate recheck refs, or RETAIN with compat-contract doc pointer). A single omnibus cleanup-done note is not acceptable.

---

## 6. Interfaces / Contracts

### 6.1 Freeze schema (normative field list; JSON example illustrative)

Required fields - a freeze record missing any field is invalid and L4 must reject it without running scenarios:

- candidate_id: YYYYMMDD-shortsha-seq e.g. 20260911-a1b2c3d-01. Integrator assigns; seq increments per repair loop.
- base_revision: git SHA of clean base (or unknown-dirty-base prefix). Produced by git rev-parse HEAD.
- dirty_files: every dirty/untracked file depended on at build time, with SHA-256. Produced by git status --porcelain + sha256sum per file (script 8.1).
- clean_tree: boolean; false iff any dirty file contributed. Script output.
- schema_version: migration head + checksum of applied lineage (not just a count). Produced by migrate list command (or approved equivalent) + lineage hash.
- config_fingerprint: hash of effective non-secret config: flags, resource limits, pool sizes, TTLs, C05 bound, C09 profile id; secret NAMES listed, values redacted. Canonicalize + sha256sum (script 8.1).
- lockfiles: hashes of package-lock.json, Go module lockfiles, container digests if used. sha256sum of each.
- contracts: C01-C09 version ids actually compiled/tested. From Phase 01 contract sheet.
- build_artifacts: API binary, worker binary, web bundle hashes + build log pointer. Build script output.
- staging_target: named staging environment + target allowlist (hosts); explicit prod-targets-excluded attestation. Copy of allowlist + operator signature.
- rollback_binary: prior release identity the candidate can roll back to + its schema/payload read window. From 6.3 matrix.
- supersedes: prior candidate id + reason (initial / repair-of finding-id). Ledger link.

~~~json
{
  "candidate_id": "20260911-a1b2c3d-01",
  "base_revision": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4",
  "clean_tree": false,
  "dirty_files": [
    { "path": "backend/go/internal/attempts/submit.go", "sha256": "e3b0aa10" },
    { "path": "src/shared/durability/DurableResponseEngine.ts", "sha256": "9f2c44d1" }
  ],
  "schema_version": { "head": "0061_expand_add_response_row_key", "lineage_sha256": "c41a90be" },
  "config_fingerprint": {
    "sha256": "77be12cd",
    "profile": "C09-staging-rev3",
    "includes": ["flags", "pool_sizes", "ttls", "c05_bound_ms_15000", "resources"],
    "secret_names": ["DB_PASSWORD", "SESSION_HMAC_KEY"]
  },
  "lockfiles": {
    "package-lock.json": "sha256:4d21aa11",
    "backend_go_go_sum": "sha256:88f0bb22",
    "image_digest": "sha256:cc99dd33_if_containerized"
  },
  "contracts": { "C01": "v7", "C02": "v5", "C03": "v4", "C04": "v6", "C05": "v3", "C06": "v4", "C07": "v3", "C08": "v5", "C09": "staging-rev3" },
  "build_artifacts": {
    "api_binary_sha256": "aa10ee01",
    "worker_binary_sha256": "bb20ee02",
    "web_bundle_sha256": "cc30ee03",
    "build_log": "evidence_link_to_build_log"
  },
  "staging_target": { "env": "staging-exam-02", "allowlist": ["staging-api-02.internal"], "prod_excluded_attested_by": "ops-owner" },
  "rollback_binary": { "release": "20260828-rel-14", "reads_schema_through": "0061_expand", "reads_payload_versions": ["v2", "v1-compat"] },
  "supersedes": { "candidate": null, "reason": "initial integrated candidate" }
}
~~~

### 6.2 Gate thresholds (reference C09 workload + section 8 budgets; final numbers need approval in rollout/approvals.md)

All thresholds apply PER FROZEN CANDIDATE, on the recorded staging resources/config, with device/browser/network slices kept. Initial candidate gate values below are the section 8 proposals for calibration - Phase 07 does not harden them into permanent gates without WP10 evidence + written approval.

- Answer input responsiveness: p95 input-to-visible max 100 ms. Boundary: named lower-powered supported device; includes synchronous storage checkpoint work.
- General interaction (INP): p75 INP max 200 ms where supported. Boundary: real representative sessions; keep device/browser slices.
- Autosave acknowledgement: p95 max 1 s. Boundary: client send to exact server ack; within defined network profile.
- Terminal submission receipt: p95 max 2 s. Boundary: separate ordinary final seal vs SAT provisional response vs final SAT result readiness.
- API availability (valid critical requests, agreed exam windows): proposed 99.9 percent. Boundary: eligible-request definition; report 429 / validation / client-network / server failures separately.
- Integrity: ZERO confirmed silent-loss, cross-user exposure, duplicate incompatible terminal facts, unexplained score divergence. Boundary: every acceptance + soak run; production incident gate (zero-tolerance stops 7.12).
- Background recovery: bounded oldest-eligible-work age + measured drain time. Boundary: thresholds from expected load times worker capacity, not a universal constant.
- Runtime freshness: C05 bound demonstrated per channel + sleep/reconnect condition. Boundary: fast-lane hint delivery is not a measured propagation SLA; record channel, condition, bound.
- Capacity statement: supported peak + approved headroom, both demonstrated. Boundary: arrival/write/storm sizes, payload bytes, staff conns, background load, generator ceiling, p50/p95/p99, error composition, CPU/RSS, conns, SQL/lock waits, queue age, post-load recovery.

Perf-stop rule: a single slow sample never stops the ladder; only SUSTAINED threshold breach per the pre-defined window in the exit-criteria table (8.2) does. Integrity-stop rule: a SINGLE CONFIRMED integrity violation stops expansion immediately (7.12).

### 6.3 Rollback-compatibility matrix (instantiate per candidate in rollout/rollback-compat.md)

Columns: Dimension | Candidate state | Rollback binary reads? | Evidence (test/proof) | Verdict.

- Row 1 Migration head (expand vs contract): example head 0061_expand, contract not yet applied. Reads: Yes - expand-only, old binary ignores new nullable cols/keys. Evidence: fresh-install + upgrade + old-binary-boot test logs. Verdict: COMPATIBLE / BLOCKED.
- Row 2 Queued job/outbox payload versions: example worker enqueues v2 with v1-compat reader fields. Reads: Yes - old worker drains or requeues without loss. Evidence: old-worker-drains-new-queue test; DLQ readable. Verdict: COMPATIBLE / BLOCKED.
- Row 3 Cache entries (session/authz/runtime keys incl. version/revision scope): example keys include attempt-colon-rev-colon-epoch. Reads: Yes - old binary ignores unknown segments or misses safely to authoritative read. Evidence: cache-mixed-version test; miss-storm bounded. Verdict: COMPATIBLE / BLOCKED.
- Row 4 Client storage namespaces (per-attempt, versioned): example ns v5, old bundle reads v4 journals. Reads: Yes - forward-compat read or clean upgrade path, recovery data preserved. Evidence: old/new bundle matrix (AC04/AC15); no blanket localStorage clear. Verdict: COMPATIBLE / BLOCKED.
- Row 5 Wire envelopes (error codes, ack shapes, bootstrap GET vs POST): example new GET + compatible POST. Reads: Yes - old clients accepted through window. Evidence: AC14/AC15 consumer matrix. Verdict: COMPATIBLE / BLOCKED.
- Row 6 Terminal facts already written by candidate: immutable receipts/results. Reads: must remain valid and readable post-rollback. Evidence: immutability test (receipt_immutability_test.go scope). Verdict: COMPATIBLE / BLOCKED.

Rules: (a) Contract-phase (expand) migrations only until the rollback/consumer window closes - defer contraction. (b) Never purge backlog/journals/evidence as a recovery shortcut. (c) Promise SQL rollback only for transactional DDL; nontransactional DDL gets forward-repair or restore, documented up front. (d) UNSAFE SECURITY ROLLBACK IS FORBIDDEN: never roll back to a known authorization bypass - contain + forward-repair instead (10.2).

---

## 7. Step-by-Step Implementation

Sequence is load-bearing. Do not start step N+1 while step N exit predicate is red. Record every command with environment, exit status, and artifact pointer - looks-correct is not evidence.

### 7.1 Step 1 - Integrate: assemble the single candidate (L0 integration owner)

1. Collect landed scopes: confirm each owner phase reports PRODUCED + INTEGRATED for its WP slice, or closed-as-satisfied with evidence. Any scope still RUNNING blocks integration - record it as the entry blocker, do not integrate around it silently.
2. Resolve shared-surface ownership for the merge window (overall-plan.md section 7 registry): API schema/wire DTOs to contract owner; durability engine + storage format to client durability owner; terminalization + resolver to integrity owner; cmd/api/main.go to integration owner (workers submit wiring diffs); internal/app/app.go to integrity/integration owner; worker fan-out to worker owner; migration filenames/DDL to database owner; query/pool tuning to database owner; CI/deploy to operations owner; cross-feature integration tests to integration test owner. Sequence same-file needs; worktrees isolate edits, not contracts.
3. Build all three artifacts from one base revision: API binary (backend/go/cmd/api), worker binary (backend/go/cmd/worker), web bundle (npm run build), plus migration head. Fix build breaks in owning scopes only; no drive-by refactors.
4. Run the GLOBAL CANDIDATE GATE once as a smoke filter (build/typecheck/lint/unit/Go suites per section 14) before freezing - a red smoke means fix-and-rebuild, not freeze-and-explain.
5. Assign CANDIDATE-ID and write the freeze record per 6.1/8.1. From this point the candidate is IMMUTABLE: any further edit equals a new candidate id via 7.9.

Exit predicate: candidates/ID/freeze.json validates (all fields present, hashes match rebuild), build log green, staging allowlist attested.

### 7.2 Step 2 - Freeze validation (integrator self-check, before L4)

1. Verify freeze.json fields mechanically: recompute one sampled hash per category (source file, config, lockfile, bundle) and confirm match.
2. Verify schema lineage: fresh-install + upgrade-from-prior-release-head on a disposable DB; record head + lineage hash.
3. Verify staging target isolation: allowlist hosts resolve to staging only; prod-target files present in repo are NOT referenced by any rehearsal command (grep rehearsal scripts for prod hostnames/creds as a negative check).
4. Publish freeze.md rendering + ledger skeleton (ac-runbook.md with all 20 AC rows PENDING).

Exit predicate: freeze record passes mechanical validation; L4 accepts the handoff (candidate id + freeze.md + ledger skeleton + build log).

### 7.3 Step 3 - Mode-combination coverage (risk-based, WP14)

Run against the FROZEN CANDIDATE in staging, not isolated patches:

- PAIRWISE for independent knobs (example knob set - instantiate from live flags/config; do not assume names): strict/stateless auth mode times poll vs WS vs fallback times cache-hit vs authoritative-read times pool-normal vs pool-tight times grading-on vs grading-off times media-present vs media-absent. Use a pairwise generator; record seed + generated table + which pairs were actually executed.
- EXHAUSTIVE TARGETED (all combinations in the named subspace, small N by construction) for:
  1. Auth/fencing: role student/proctor/grader/admin/observer times ownership own/same-org-other/cross-org times lease fresh/stale times control epoch fresh/stale - expect deny/allow exactly per C04; cache must not bypass revocation.
  2. Cross-process notification: worker-mutation visibility via durable-bus/invalidation-signal/bounded-authoritative-refresh times API restart before/during/after times poll-sleep awake/background-tab/reconnect - expect API observation within C05 bound.
  3. Row-first materialization: write path row-first/V1-compat times read path row-authoritative/legacy-triple-rebuild times attempt shape V1-only-history/V2-only/mixed - expect identical authoritative answers/scores (AC05/AC06).
  4. Terminalization interactions: terminal request student-submit/proctor-terminate/deadline-autosubmit times timing before/at-boundary/after times channel single/raced-duplicate/worker-retry - expect one compatible terminal outcome (AC09).
- Each combination maps to its AC row(s); failures file against the owning phase with the exact combination id. DISCRIMINATING INPUTS REQUIRED (optimize section 7 discriminating design): same-ID/same-payload vs same-ID/different-payload vs different-ID/same-version; stale-lease vs stale-control vs terminal-replay; missing-key vs blank vs not-administered vs pretest vs invalidated vs pending vs true-incorrect; old-client/new-server and new-client/compatible-old-server.

Exit predicate: combination tables executed and linked; any divergence is a classified finding (7.8), not a waived flake.

### 7.4 Step 4 - Fault injection (WP14, authorized staging / disposable DBs)

Execute each fault with a PRE-REGISTERED expected signal (alert/runbook) and a RECOVERY OWNER. Isolate parallel fault runs by database/schema, accounts, ports, browser storage, artifact dirs (WP13 topology). Never run fault injection against production.

- F1 API restart mid-write/submit: SIGTERM/restart API container mid-batch + mid-submit. Expected I02/I04/I10: committed batch retried by same write/submission id returns compatible ack; no duplicate mutation; no false-complete. Observe: ack-compat (AC03/AC08); terminal single-outcome (AC09).
- F2 Worker restart mid-fan-out / post-provisional: kill worker after SAT provisional seal; restart. Expected I09: every unfinished attempt stays durably owned; reconcile to final seal/result (AC10/AC11). Observe: queue ownership; DLQ classification; API observes without shared memory.
- F3 DB slowdown (latency + lock waits): proxy-induced latency / lock contention on response-batch + job-claim queries. Expected I10: bounded degradation, no silent drop; oldest-work age alert fires; drain after relief. Observe: pool/lock metrics; queue-age alert + runbook.
- F4 Lost acknowledgement: network interception dropping ack after server commit. Expected I02: retry identical write id to compatible ack, payload unchanged (AC03). Observe: client shows pending, never false-saved.
- F5 Stale caches (authz + runtime + session): inject stale session/authz entry past revocation; stale runtime snapshot. Expected I07: writes still enforce at write time; revocation honored within C04 bound (AC07/AC13/AC16). Observe: revocation-fire test; stale-write denial.
- F6 Browser storage failure (denial/quota/corrupt/upgrade): controlled denial, quota-fill, corrupt record, old-namespace bundle. Expected I03: no false save claim; in-memory intent preserved; recovery limits shown (AC02/AC04). Observe: status strings; conflict archive; no blanket clear.
- F7 Expired tokens mid-exam: short-lived bearer + refresh race; logout-all during attempt. Expected I07: distinct expired vs revoked vs invalid envelopes (C07); no blind retry storm (AC14). Observe: exact status/envelope; retry budget honored.
- F8 Deadline storms (many simultaneous expiries): time-compressed cohort with aligned deadlines to autosubmit fan-out spike. Expected I04/I09: one terminal outcome each; fan-out completes or dead-letters with owner (AC09/AC10). Observe: fan-out completion accounting; poison isolation.
- F9 Storage-backend failure (media/upload target down): fail media finalization path. Expected AC20: export/media remains cancelable, no answer-state corruption, no leak. Observe: cancel/recover; answer integrity re-probed.
- F10 Event loss / sleeping poll loop: drop WS frames; force background-tab throttle then reconnect. Expected I07/C05: UI reaches authoritative state within C05 bound per channel/condition (AC16). Observe: freshness-bound measurement per channel.

Exit predicate: each fault has a raw log + alert-fire confirmation + recovery proof, or a classified finding. Stopping load to hide an integrity failure is forbidden - see 10.1.

### 7.5 Step 5 - Representative load (authorized staging only, WP14)

Instantiate the frozen C09 profile into evidence/ID/load/staging-load-plan.md (arrival rate, concurrent writers, write cadence + payload bytes, section-transition rate, submit-storm size, proctor WS observers, grading background, media sizes, device/network mix, flags, resource limits). Then run the day-shape in order - do not cherry-pick the easy profile:

1. Arrival wave (k6/prod-start-exam-200.js shape + scale-proof/0_entry_wave.js, 3_bootstrap_arrival.js): entry to bootstrap herd; watch auth/session + bootstrap query plans under burst.
2. Steady writing (exam-day steady segment of k6/prod-exam-day.js): response-write cadence at C09 rate; watch ack latency, pool waits, rows examined.
3. Section changes (k6/prod-section-transition-200.js): transition spike + runtime-state reads; watch conditional-read hit rates + invalidation.
4. Submit storm (k6/prod-submit-storm-200.js): terminal receipts; watch terminalization contention, single-outcome accounting.
5. Proctor observers (scale-proof/4_ws_staff_soak.js + roster polling): staff WS capacity + poll fallback; watch fan-out of roster updates.
6. Grading background (grading queue drain concurrent with exam load): watch worker-queue age vs exam-write latency isolation.
7. Post-exam cleanup (retention-batch path at bounded batch size, outside peak): watch replay/terminal/evidence tables untouched by cleanup (AC18 boundary).
8. Backlog recovery: stop generators, measure drain-to-baseline time, oldest-eligible-work age, and resource return to baseline. Record the full series - a load run without a recovery tail is incomplete.
9. Compare BASELINE vs CANDIDATE on identical dataset/config/infra/generator capacity (section 8 capacity policy). Record p50/p95/p99, error composition (5xx vs 429 vs validation vs client-network split), CPU/RSS, connections, SQL/lock waits, storage latency, queue age, response bytes.

Exit predicate: staging-load plan + all k6 summaries + comparison table + recovery tail linked in ledger; budgets evaluated per 6.2.

### 7.6 Step 6 - Soak over intervals (WP14)

Run a soak that COVERS EACH RELEVANT INTERVAL AT LEAST ONCE (instantiate durations from live config; examples, not defaults): session/token TTL + revocation-propagation window; attempt lease + control-epoch rotation; worker lease/expiry + retry-backoff + DLQ-age thresholds; runtime cache TTL + invalidation bound + C05 freshness bound; retention-batch period + job-completion horizon. Assert: zero integrity violations across the soak; no unbounded memory/backlog growth; alerts that should stay quiet stay quiet (with rationale); any alert that fires has a runbook entry and a fire-test link.

Exit predicate: soak.md records intervals covered, duration, integrity probes, resource series, and verdict.

### 7.7 Step 7 - App-level restore validation (WP12 gate inside Phase 07, WP14 dependency)

On a DISPOSABLE SCRATCH TARGET (never production): restore the approved backup; validate schema; boot services on the candidate build; then verify THROUGH THE APPLICATION AND BUSINESS INVARIANTS, not just import success: representative answers readable; receipts immutable and matching digests; results consistent across scoring/review/export; media present; replay of a pending write behaves per C02; retention boundary respected; observed RTO/RPO vs approved objectives recorded. Include interrupted-migration-rerun and old/new-app-compat checks for any schema in the candidate.

Exit predicate: restore.md with RTO/RPO observation, invariant checklist, and rollback-vs-forward-repair note per 6.3.

### 7.8 Step 8 - L4 independent inspection + rerun (protocol 4.5 steps 5-6)

L4 receives ONLY the frozen candidate (freeze.json + build log + ledger skeleton + raw logs). L4:

1. Re-validates freeze identity (recompute hashes; reject on mismatch).
2. Independently inspects diff/scope for contract drift, invariant risk (I01-I12), telemetry leakage (I11), and perf-vs-correctness tradeoffs (I12).
3. Independently RE-RUNS the risk-sampled subset at minimum: one AC per invariant family (AC03, AC07, AC09, AC11, AC13, AC18) + the full terminalization/fencing cross-products (7.3 items 1/4) + one fault from F1/F2/F4 + restore invariant spot-checks. Full AC01-AC20 rerun is preferred; sampling must be declared in l4-report.md with rationale.
4. Files every discrepancy as a finding with: candidate id, AC/invariant, reproduction, raw log, severity proposal. L4 never edits the candidate.

Independence rule: L4 executor is not integrator for this candidate. Tool-assisted re-execution is required (not a paper review). If true independence is impossible, record the disclosure and treat the check as INTEGRATOR-RECHECK, not L4-CHECKED - release still needs a genuine L4 pass.

### 7.9 Step 9 - Classify + targeted repair to new candidate to recheck loop (protocol 4.5 steps 7-9)

1. CLASSIFY each L4/owner finding:
   - BLOCKING: violates I01-I10/I12, breaks AC pass criteria, leaks auth/data (I07/I11), corrupts terminal facts, orphans work, breaks rollback compat or restore. Must be repaired; blocks WP15 entry and release.
   - IMPORTANT: degrades budgets/UX/ops (missed SLO slice, noisy alert, a11y gap on critical path, flaky-but-real signal) without violating integrity. Requires repair OR explicit documented acceptance by the appropriate authority (security to security owner; scoring to integrity owner; SLO to L0 + ops; a11y-critical to experience owner). Acceptance names the risk, the compensating control, and the expiry/review date.
   - OPTIONAL: polish, non-critical perf headroom, docs nits. May defer with a ledger entry; never silently dropped (deferred equals backlog link).
2. REPAIR in owning scopes only (transfer ownership explicitly if the fix crosses the registry). Smallest complete repair per finding; add/strengthen the failing behavioral test first for confirmed defects.
3. RECURRENCE RULE: 1st occurrence to local repair; 2nd recurrence of same symptom to root-cause diagnosis (contract/architecture/data-shape, not another patch); 3rd recurrence to escalate the contract/architecture assumption to L0 (record decision: change contract with version bump, change architecture via justified decision, or accept-with-controls). Do not repeat the same patch three times.
4. FREEZE A NEW CANDIDATE (ID-seq+1) with supersedes.reason set to repair-of finding-ids; re-run affected ACs + integration edges + rollback-compat delta; L4 rechecks affected scope. Unrelated green evidence MAY BE CARRIED FORWARD BY REFERENCE only if the new candidate freeze diff proves the related scope untouched (file-hash comparison); otherwise re-run.

Exit predicate (WP14 CHECKED): all AC01-AC20 linked green on the frozen candidate (or NOT RUN/BLOCKED explicitly with owner + next action - which blocks WP15); zero open BLOCKING; zero unaccepted IMPORTANT; rollback-compat matrix COMPATIBLE; restore RTO/RPO observed within approval or gap disclosed.

### 7.10 Step 10 - Rollout approvals (WP15 gate, before cohort 1)

Collect written sign-offs in rollout/approvals.md (named approver + date + version referenced):

1. Workload/SLOs: frozen C09 profile + 6.2 thresholds as applied to this candidate/resources.
2. RPO/RTO: approved objectives + observed restore evidence (restore.md).
3. Infrastructure flags + resource limits: effective flag set in config fingerprint; any flag flip after approval equals new approval.
4. Rollback package: rollback binary identity + 6.3 matrix verdict + tested rollback/re-rehearsal procedure.
5. Intentional product policy changes (if any): scoring/admission/retention deltas with approved specs - absence recorded as no policy change.
6. Deployment authorization: environment, window, operator, blast radius, cohort plan, stop-condition thresholds.

NO APPROVAL means NO COHORT. Missing items are disclosed gaps; the engineering candidate is preserved regardless.

### 7.11 Step 11 - Cohort ladder (WP15 execution)

Fixed ladder; define windows/exit criteria BEFORE starting (table template 8.2). Cohorts:

- C0 internal/synthetic: staff + synthetic exam accounts on production infra (or prod-like if policy requires), no real students. Soak the full exam slice: entry to answer to reload/reconnect to submit to score/review.
- C1 small representative: one small real cohort covering supported device/browser/network mix + at least one adaptive (SAT) + one objective+writing (IELTS) + one science (ACT) path if the release claims all providers.
- C2 expanded: multiple concurrent cohorts approaching (but not exceeding) the demonstrated staging capacity minus margin.
- C3 full: remaining population per release policy.

Per-cohort record in rollout-log.md: candidate id, cohort definition, window, exit-criteria evaluation (each criterion PASS/FAIL with metric + source), stop-condition evaluations, decision + operator signature. ADVANCE ONLY ON ALL-GREEN exit criteria; hold/roll back on any stop (7.12). Cohort N+1 never starts while cohort N window is still open unless the plan explicitly allows overlapping windows with rationale.

### 7.12 Step 12 - Stop conditions (pre-defined; no intuition stops, no silent overrides)

ZERO-TOLERANCE integrity stops (single confirmed occurrence stops expansion immediately, preserve evidence, enter 10.3 incident procedure):

- S1: confirmed newly introduced silent answer loss or false saved status (I02/I03 violation).
- S2: unauthorized access, token/session leakage, or broken revocation (I07/I11).
- S3: conflicting terminal facts or unexplained scoring/review/export divergence (I04/I05).
- S4: unowned unfinished autosubmit/provisional work (I09).
- S5: unsafe migration behavior, evidence deletion, or unusable recovery path.

SUSTAINED-THRESHOLD perf stops (breach held over the pre-defined window stops expansion; single spikes investigate without stopping):

- S6: terminal receipt / autosave-ack / availability breach per 6.2 held over window W_perf (define W in exit table, e.g. 15 min rolling - instantiate with approver).
- S7: backlog/queue-age / oldest-work-age / DLQ-age breach held over window W_queue.
- S8: resource saturation (CPU/RSS/conns/SQL-lock/pool-wait) held over window W_res with no drain trend.

Any stop records: trigger metric + window + raw series pointer, cohort frozen, containment action, finding id, owning phase for repair. Restarting the ladder after a stop requires a NEW CANDIDATE (if code/config/schema changed) or a documented same-candidate resume (if the cause was external and proven) with approver sign-off.

### 7.13 Step 13 - Rollback-compat verification + rollback rehearsal (WP15, before C1)

1. Instantiate 6.3 matrix for the candidate; every row must be COMPATIBLE with a linked test, or WP15 does not start.
2. Rehearse the rollback on staging: deploy candidate, write traffic (answers, terminal facts, queued jobs, cache entries, client journals), roll back to rollback binary, verify health PLUS invariant probes (authoritative answers, receipts, results, queue ownership, access control - not just HTTP 200s), roll forward again if the plan requires. Preserve local journals, DB evidence, queued jobs throughout; never purge backlog as recovery.
3. Record the rehearsal log + timings in rollback-compat.md. Note DDL limits (no SQL-rollback promise for nontransactional DDL) and the forward-repair path.

### 7.14 Step 14 - Synthetic post-deploy checks + on-call handoff (WP15 close)

After each cohort (and fully at C3): run synthetic probes (entry smoke, write-to-ack, submit-to-receipt, result-readiness, revocation probe, queue-age probe, freshness probe) and record in synthetic-postdeploy.md. Then complete oncall-handoff.md: incident contacts, escalation path, evidence-retrieval procedures (where journals/DB evidence/queue state live, with redaction rules), tested recovery playbook pointers, known limitations + capacity ceiling + margin, and retained-compat notes from 7.15. On-call must be able to execute the playbook without the author.

### 7.15 Step 15 - Conditional cleanup WP16 (only after WP14 evidence; each target independent)

For each T-item in 4.5, in its OWN work item with the L1 scope owner (never bundled cleanup sprint that mixes unrelated removals):

1. EQUIVALENCE TESTS FIRST: prove new-path equiv old-path on the fixtures that matter (T1/T2: V2-only + mixed + V1-history fixtures across scoring/review/export; T3: auth/fencing matrix without the shim; T4: single-resolver agreement; T5: AC15 consumer matrix; T6: flag-on equiv flag-off default path soak). No equivalence test means no removal.
2. USAGE PROOF: demonstrate zero (or policy-zero) production + staging usage over the defined migration window (server logs, client version telemetry with bounded labels, gateway counters). State window dates + sources. Absence of instrumentation is not proof of absence of use.
3. CONSUMER-COMPAT PROOF: old/new client times old/new server matrix green; rollback binary reads retained data written by the candidate; storage-namespace upgrade path preserves recovery data.
4. STRUCTURAL RULES: keep domain services independent of HTTP details; keep handlers thin; use explicit composition through the existing shared app graph (internal/app/app.go via its owner); introduce interfaces ONLY at genuine substitution/test boundaries (no generic repositories, plugin frameworks, universal state machines); remove dead code + obsolete tests + stale docs TOGETHER; update onboarding/operation contracts.
5. DECISION: all proofs hold to RETIRE via explicit removing commit(s), then freeze a NEW CANDIDATE and re-run affected regression + integration edges + rollback-compat delta + (if post-WP15) ladder re-entry from the appropriate gate. Any proof missing to RETAIN: document the compat contract (who writes/reads it, version window, removal precondition, owner) and stop. Write the per-target record (5.4).
6. CLEANUP ROLLBACK: package-scoped source revert; data/wire compat maintained until the accepted retirement window closes.

WP16 never blocks release: an unsafe-to-remove path is a retained contract, not a release defect.

---

## 8. Code / Pseudocode (illustrative - adapt to live scripts; keep redaction)

### 8.1 Freeze-record generator (bash pseudocode; run at repo root; review before use)

~~~bash
# freeze.sh CID - writes docs/production-hardening/candidates/CID/freeze.json
# Requires: git, sha256sum, go, node. Never prints secret VALUES (names only).
# Usage: freeze.sh 20260911-a1b2c3d-01
# Steps:
#  1. mkdir -p docs/production-hardening/candidates/CID
#  2. BASE equals git rev-parse HEAD
#  3. CLEAN equals true iff git status --porcelain is empty
#  4. For each file listed by git status --porcelain: sha256sum the file, append path+hash to dirty_files array
#  5. HEAD-MIGRATION equals migrate list command tail line (confirm flags live with database owner)
#  6. LINEAGE-HASH equals sha256 over the ordered migration files (confirm method with database owner)
#  7. CONFIG-HASH equals sha256 over canonical effective-config export with secret values removed (list secret NAMES separately; do NOT dump env with values)
#  8. LOCK-HASHES equal sha256sum of package-lock.json and backend go sum file, plus image digest if containerized
#  9. Fill contracts C01-C09, staging_target allowlist, rollback_binary, supersedes BY HAND, then hand-verify JSON
# 10. Commit the freeze record with the ledger skeleton in the same change that names the candidate
~~~

Hand-verify the generated JSON (dirty list completeness, lineage hash method matches the live migrate tool flags, config canonicalization excludes all secret values). Commit the freeze record with the ledger skeleton in the same change that names the candidate.

### 8.2 Exit-criteria table template (per cohort; copy into rollout/rollout-log.md)

~~~markdown
Cohort C1 - small representative (candidate 20260911-a1b2c3d-02)
Window: 2026-09-20 09:00-12:00 UTC (operator: FILL; approver: FILL)
E1 Zero S1-S5 integrity stops | threshold 0 confirmed | source invariant probes + DLQ/terminal audit | Result PASS
E2 Terminal receipt p95 max 2s (seal vs provisional vs final split) | per approvals | source telemetry dashboard link | Result PASS
E3 Autosave ack p95 max 1s | per approvals | source client-to-ack trace link | Result PASS
E4 Availability of valid critical requests min 99.9 percent (429/validation/client-net split out) | per approvals | source error-composition table | Result PASS
E5 Queue-age / oldest-work within bound, drains post-window | bound link | source worker metrics link | Result PASS
E6 Freshness within C05 bound per channel/condition | C05 equals bound | source AC16 probe log | Result PASS
E7 Synthetic post-deploy suite green | 100 percent | source synthetic-postdeploy.md | Result PASS
Decision: ADVANCE / HOLD / ROLL BACK - signed FILL at FILL
~~~

Perf-stop windows (instantiate with approver; example): W_perf 15min rolling, W_queue 20min rolling, W_res 15min with no drain trend. Record actuals; do not edit thresholds mid-cohort.

### 8.3 Stop-condition evaluator (illustrative TypeScript - wire to real metric source)

~~~typescript
// stopEvaluator.ts (illustrative): evaluates S1-S8 from probe + metric feeds.
type Verdict = 'GO' | 'HOLD' | 'STOP_EXPANSION';
interface IntegrityCounts {
  silentLoss: number; authLeak: number; terminalConflict: number;
  orphanedWork: number; unsafeMigration: number;
}
interface Sustained { series: number[]; threshold: number; windowMin: number; }
interface StopInput {
  integrity: IntegrityCounts;
  perf: Sustained; queue: Sustained;
  resources: Sustained & { draining: boolean };
}
function sustainedBreach(series: number[], threshold: number, windowMin: number, sampleMin: number): boolean {
  // true iff EVERY sample in the trailing window exceeds threshold (no spike-trigger).
  const need = Math.ceil(windowMin / sampleMin);
  const tail = series.slice(-need);
  return tail.length >= need && tail.every(function (v) { return v > threshold; });
}
export function evaluateStops(i: StopInput): { verdict: Verdict; fired: string[] } {
  const fired: string[] = [];
  if (i.integrity.silentLoss > 0) fired.push('S1');
  if (i.integrity.authLeak > 0) fired.push('S2');
  if (i.integrity.terminalConflict > 0) fired.push('S3');
  if (i.integrity.orphanedWork > 0) fired.push('S4');
  if (i.integrity.unsafeMigration > 0) fired.push('S5');
  if (sustainedBreach(i.perf.series, i.perf.threshold, i.perf.windowMin, 1)) fired.push('S6');
  if (sustainedBreach(i.queue.series, i.queue.threshold, i.queue.windowMin, 1)) fired.push('S7');
  const resBreach = sustainedBreach(i.resources.series, i.resources.threshold, i.resources.windowMin, 1);
  if (resBreach && !i.resources.draining) fired.push('S8');
  let verdict: Verdict = 'GO';
  const hard = ['S1', 'S2', 'S3', 'S4', 'S5'];
  if (fired.some(function (f) { return hard.indexOf(f) >= 0; })) verdict = 'STOP_EXPANSION';
  else if (fired.length > 0) verdict = 'HOLD';
  return { verdict: verdict, fired: fired };
}
~~~

### 8.4 Ledger-row template (per AC; copy per candidate)

~~~text
Requirement/scenario: AC09 - submit races terminate/deadline; one compatible terminal outcome.
Work package and owner: WP04 (integrity/worker) + Phase 07 integration rerun.
Behavioral contract version: C03 v4, C06 v4, C05 v3.
Implementation files: backend/go/internal/attempts/submit.go; terminalization/; cmd/worker/main.go (frozen hashes in freeze.json).
Candidate source/config/schema identity: CANDIDATE-ID (freeze.json link).
Producer checks: command, env, exit status, artifact link.
Independent reviewer evidence: L4 rerun command, env, exit status, artifact link.
Observed result: PASS / FAIL / NOT RUN / BLOCKED.
Known limitation or residual risk: e.g. boundary tested at plus-minus 0/1s only; background-tab beyond Xmin excluded - link.
Rollback/recovery evidence: rollback-compat row + recovery probe link.
Next action: none / finding-id / recheck-new-candidate.
~~~

---

## 9. Data / State Flow

~~~text
Owner phases PRODUCED
  to L0 assembles API + worker + web + migrations at base rev
  to freeze.json (+build.log) - candidate IMMUTABLE
  to staging deploy (allowlisted target, synthetic accounts, redacted telemetry)
  to AC01-AC20 runbook (mode combos 7.3 + faults 7.4 interleave deterministically)
  to representative load day-shape (7.5) to recovery tail to soak (7.6)
  to scratch restore validation (7.7)
  to evidence/ID/ ledger complete
  to L4 independent inspect + rerun to l4-report.md
  to classification.md (BLOCKING/IMPORTANT/OPTIONAL)
  to [repair in owning scopes to new candidate to recheck] times N (recurrence rule)
  to WP14 CHECKED
  to approvals.md to rollback-compat.md + rehearsal
  to cohort ladder C0 to C1 to C2 to C3 (rollout-log.md; stops evaluated per window)
  to synthetic post-deploy + on-call handoff
  to WP15 DONE
  to per-target WP16 equivalence to usage to compat to RETIRE(new candidate+rechecks) or RETAIN(contract doc)
  to final release sign-off (delivered equals reviewed candidate)
~~~

State ownership through the flow: attempt/lease/control epochs and write/submission/job identities originate in owner phases and are NEVER redefined by Phase 07; rehearsal only exercises them. Queued jobs stay owned across restarts (C06); terminal facts stay immutable (C03); journals/evidence/queues are preserved across rollback. Telemetry flows candidate to redacted metrics/logs (I11 enforced: no answers/tokens/passwords/unnecessary student ids; bounded labels, ids only in justified diagnostic context).

---

## 10. Edge Cases (must handle; not optional)

1. INTEGRITY FAILURE MASKED AS LOW VOLUME - FORBIDDEN to lower volume to hide it. If any S1-S5 signal appears under load, do not reduce arrival/write/storm sizes to turn the signal green. Required action: stop expansion, preserve evidence (journals, server evidence, job state, redacted diagnostics), file BLOCKING, repair in owning scope, new candidate, full recheck. The capacity statement then reports the SUPPORTED LIMIT actually demonstrated - lowering the claimed ceiling with disclosure is honest; lowering the test to conceal the defect is a process violation.
2. UNSAFE SECURITY ROLLBACK to containment + forward repair. If the rollback binary contains a known authorization bypass (or revocation/fencing regression), rollback to it is forbidden even when perf/correctness would favor it. Contain (disable implicated path / isolate cohort / rotate exposed material per runbook) and forward-repair on the candidate line. Record the decision in rollout-log + classification.
3. LOST ACK vs DUPLICATE WRITE ambiguity: same write-ID retry must return a compatible ack with byte-identical payload semantics; same-ID/different-payload is a distinct case (reject or reconcile per C02 - never silently overwrite). Test all three ID/payload combinations explicitly.
4. SUBMIT/TERMINATE/DEADLINE three-way race at the exact boundary: test both winners where valid per C03; clocks include exact deadline/grace boundaries, pause/resume, extension, background-tab throttle, stale server offset. One compatible terminal outcome; conflicts rejected without overwrite.
5. WORKER KILL between provisional seal and final result (SAT): recovery owner must complete to final seal/result after restart; API observes via durable path, never shared memory; abandoned-client case has a named owner.
6. FAN-OUT partial success with poison attempt: successes commit, transients retry bounded with backoff, poison isolates to DLQ with evidence; parent completes only when every target is finished, permanently classified, or durably assigned. Never purge backlog to complete the parent.
7. STALE LEASE vs STALE CONTROL vs TERMINAL REPLAY produce three distinct, tested recoveries (deny vs reconcile-after-fresh-state vs reject-terminal-replay) - never a single generic session-expired that deletes pending work silently.
8. STORAGE DENIAL mid-sentence: in-memory intent preserved, save status honest (not saved), recovery limits shown; corrupt-record and old-namespace-upgrade paths covered; no blanket localStorage clearing on rollback or error.
9. EXPIRED vs REVOKED vs INVALID credentials return distinct exact envelopes (C07) with bounded retry budgets; DB outage is never misclassified as invalid credentials (AC13/AC14 negative tests under DB-down).
10. CONDITIONAL-READ CACHE CROSSING: ETag/version keys must scope attempt+user+version; stale-cache tests prove no cross-attempt/user/version leak and no answer-key exposure; old POST compat path stays correct alongside new GET (AC15).
11. SLEEPING POLL LOOP + EVENT LOSS: C05 bound verified per channel (WS, poll, fallback) and per condition (awake, background, reconnect); a fast-lane hint is recorded as hint-delivery, not as a propagation SLA.
12. RETENTION BATCH vs LIVE EXAM overlap: retention skips replay/grading/terminal/incident evidence inside the protected window; bounded batches run outside peaks; boundary test proves protected rows survive and eligible rows clean.
13. RESTORE THAT IMPORTS BUT LIES: DB import success without app-level invariant checks is NOT RUN for AC18. Scratch boot + answer/receipt/result/media/replay probes are mandatory; RPO/RTO observed, not assumed.
14. FLAKY GREEN: any flake on an integrity/security AC is a finding (BLOCKING until root-caused), never a retry-until-green. Flaky-test policy names owner + remediation deadline; critical failures are never permanently hidden behind retries.
15. POST-CANDIDATE CLEANUP DRIFT: any WP16 removal after L4 check creates a new candidate; carrying forward unrelated green evidence requires a file-hash diff proving the scope untouched. When in doubt, re-run.

---

## 11. Errors

- E-AC-FAIL: any AC01-AC20 assertion red on frozen candidate. Meaning: candidate defect or fixture/contract drift. Handling: file finding with raw log; classify (7.9); repair in owning scope; new candidate; recheck. Do not edit the frozen candidate in place.
- E-FREEZE-INVALID: freeze.json missing field / hash mismatch / lineage unresolvable. Meaning: candidate identity untrustworthy. Handling: L4 rejects handoff; integrator re-freezes; prior evidence does not transfer.
- E-L4-DIVERGENCE: L4 rerun disagrees with integrator result. Meaning: non-determinism, hidden input, or environment skew. Handling: root-cause before repair (clocks, ordering, shared DB, prod-data leak, generator seed); add determinism (barriers, seeds, isolation) then re-run both.
- E-STOP-FIRED: S1-S8 fires during ladder. Meaning: integrity or sustained perf breach. Handling: 7.12 - S1-S5 stop + incident procedure; S6-S8 hold + investigate. Record + sign.
- E-ROLLBACK-INCOMPAT: any 6.3 row BLOCKED. Meaning: rollback would lose/corrupt state. Handling: block WP15; expand/contract fix, payload-version bridge, or key-scoping fix; re-verify matrix + rehearsal.
- E-RESTORE-GAP: RTO/RPO observed worse than approved, or invariant probe red. Meaning: recovery claim unsupported. Handling: disclose gap; no prod claim for affected scope; forward-repair backup/restore path; re-validate on scratch.
- E-RETIRE-BLOCKED: WP16 target lacks equivalence/usage/compat/window proof. Meaning: removal unsafe. Handling: RETAIN + compat-contract doc; release proceeds with the path retained. Not a BLOCKING release defect.
- E-ENV-SKEW: staging resources/config/generator differ from record. Meaning: evidence not comparable. Handling: invalidate affected runs; re-run on recorded profile; baseline-vs-candidate comparisons require identical dataset/config/infra/generator.
- E-SECRET-EXPOSURE: real credential/target/answer/token in log, artifact, or committed file. Meaning: security + hygiene incident. Handling: rotate affected material; redact + re-issue evidence; file security finding; fix guard (allowlist, secret scan) before continuing ladder.
- E-APPROVAL-GAP: any 7.10 sign-off missing or stale after flag/config change. Meaning: unauthorized cohort advance. Handling: hold ladder; preserve candidate; disclose gap. No production claim for the gap scope.

Retry/rollback vocabulary follows C07: one retry owner per operation, bounded budgets with jitter, cancellation honored, Retry-After respected; mutation retries keyed to stable write/submission/job identities only. Incident procedure per source section 10: stop expansion, preserve evidence, contain without weakening ownership/integrity, tested compatible rollback / safe isolation / approved forward repair, verify answers/receipts/results/queues/access (not just health), root-cause + regression + ladder re-entry.

---

## 12. Performance / Security

### 12.1 Performance (measure on the candidate; no guessed tuning in this phase)

- Workload fidelity: every load/soak claim cites the frozen C09 instantiation (rates, sizes, mixes), staging resources, config fingerprint, generator capacity headroom, and raw evidence links. FORBIDDEN: inferring concurrent sockets/writers from registrations/day (e.g. 1M-per-day implies N concurrent) - concurrency comes from arrival-burst + session-hold-time measurement, not division of a daily total.
- Margin policy: report SUPPORTED PEAK (highest load meeting all 6.2 gates with recovery tail green) AND APPROVED HEADROOM (reserve for storm + background + retry amplification). Do not invent a multiplier the generator cannot sustain; if the generator saturates first, the statement is generator-limited at X; system not yet bounded - not a capacity claim above X.
- Before/after discipline: baseline-vs-candidate on identical dataset/config/infra/load; every section 8 budget evaluated with device/browser/network slices; I12 enforced - any perf improvement that weakens an invariant fails the gate even if faster.
- Soak discipline: resource series (CPU/RSS/conns/pool-waits/SQL-lock/storage-latency/queue-age/backlog bytes) must return to baseline post-load and stay bounded across intervals; unbounded growth is BLOCKING.
- k6 hygiene: staging-pinned targets only; store summaries + series; record generator CPU/net so a generator bottleneck is never misread as system headroom.

### 12.2 Security (zero-tolerance stops; unsafe rollback forbidden)

- Negative testing is mandatory, not sampling: role times resource times operation matrix incl. observer/grader/proctor scope and cross-org; path-param vs bearer ownership; stale-cache-after-revocation; expired/revoked/invalid distinctness; CSRF/origin/body-limit/malformed envelopes; rate-limit behavior without retry storms; media ownership/size/path/finalization/orphan handling; stored-script rendering; parameterized queries. Happy-path-only evidence cannot close AC13/AC14.
- Telemetry redaction (I11): schema + cardinality + redaction checks run against candidate telemetry; any answer/token/password/unnecessary-id in metrics/logs is BLOCKING. Bounded labels; ids only in justified diagnostic context.
- Session/token binding, logout-all, takeover (old-device) semantics verified under fault F5/F7; DB-down is not invalid-credentials proven.
- Dependency/secret hygiene: targeted updates only (no blanket upgrades in this phase); secret scanning on candidate artifacts; committed real creds/targets treated as E-SECRET-EXPOSURE.
- Rollback security rule: never restore a binary with a known auth bypass; containment + forward repair is the only path (10.2). Any intentional policy change (admission/retention/grading-permission) needs its approved spec in approvals.md.

---

## 13. Tests - Full AC01-AC20 Runbook (against the frozen integrated candidate)

Suggested harnesses are starting points; prefer extending the owning suite. Each row needs: deterministic fixtures (Phase 01 set), exact assertions, environment (staging/disposable-DB/browser-matrix as noted), raw-log link, and ledger verdict. Cross-reference invariants I01-I12 and contracts C01-C09.

- AC01 Type before bootstrap resolves; release older snapshot; newer local intent + ordering survive (I01). Procedure on candidate, engine test: inject keystrokes pre-seed, then deliver stale snapshot + fresh seed; assert overlay order. Pass: newer intent wins; no silent overwrite; order preserved.
- AC02 Deny/quota-fail storage mid-edit; no false local/server save; in-memory intent kept + limits shown (I03). Procedure: storage-fault harness: denial, quota-fill, corrupt record, upgrade path; read status strings. Pass: status honest; intent preserved; archive-before-delete; no blanket clear.
- AC03 Server commits batch but ack lost; identical-write retry to compatible ack, no dup mutation, payload unchanged (I02/I10). Procedure: DB integration: commit, drop ack (F4), retry same write id; compare ack + mutation count + payload hash. Pass: compatible ack; mutation count +1 exactly once; payload identical.
- AC04 Reload offline with checkpoint/journal + delayed async storage; ordered pending recovery, no fabricated ack (I03). Procedure: engine + mobile browser: kill mid-journal, delayed flush, reload offline; inspect recovered queue + statuses. Pass: correct order; pending shown pending; old-namespace compat.
- AC05 SAT V2-only answers route to specified adaptive branch, score correctly, agree across review/export; pretest/unadministered correct (I05). Procedure: provider integration + E2E on V2-only + mixed-legacy fixtures; compare scorer/review/export outputs. Pass: all consumers agree; key-revision pinned; null semantics kept.
- AC06 IELTS objective+writing + ACT science follow approved grading/scoring/release rules (I05). Procedure: service + E2E on approved fixtures incl. writing-review queue + release gate. Pass: scores + release states match spec; no client-score authority.
- AC07 Old device after takeover + stale control after pause: no unauthorized writes, no silent deletion, distinct recoveries (I06/I07). Procedure: race + browser: takeover then old-device write; pause then stale-epoch write; stale-cache variant. Pass: denies + recoveries distinct and correct; pending preserved visibly.
- AC08 Submit with blocked/quarantined work or lost receipt: no false complete; recovery choices kept; stable idempotency id (I02/I10). Procedure: integration + browser: block/quarantine item, submit; drop receipt response; assert UI + id reuse. Pass: no false complete; choices retained; id stable across retry.
- AC09 Submit races terminate/deadline-worker: exactly one approved compatible terminal outcome; conflicts rejected (I04). Procedure: real-DB barrier tests: race the three terminal callers at/around boundary both-winners. Pass: single outcome; loser rejected without overwrite; receipt digest matches.
- AC10 Fan-out mixed success/transient/poison: every unfinished attempt durably owned to completed or dead-lettered (I09). Procedure: worker crash/retry integration: kill mid-fan-out, transient-flap, poison pill; audit ownership. Pass: zero orphans; DLQ entries evidenced; parent accounting exact.
- AC11 Kill worker post-provisional (SAT); restart; reconcile to final seal/result; API sees change sans shared memory (I09/C05). Procedure: two-process test: provisional seal, SIGKILL worker, restart, poll/API observation timing. Pass: final seal + result readiness reached; observation within C05 bound.
- AC12 Publish new draft mid-attempt: content/key/scoring inputs + released snapshot stay pinned (I08/I05). Procedure: integration: start attempt on vN, publish vN+1, continue + release; diff inputs + snapshot. Pass: attempt bound to issuance version; released snapshot immutable.
- AC13 Cross-user/org/assignment + bad entry codes: denied, no leak, no unauthorized admission row; cache cannot bypass revocation (I07). Procedure: negative API matrix + DB-down variant + stale-cache-after-revoke. Pass: deny without leak/write; DB-down is not invalid-creds.
- AC14 CSRF/origin/body/malformed/expired/rate-limit keep exact status+envelope; no retry storm (C07). Procedure: contract + browser: each error class asserted byte-exact; retry-budget observed. Pass: statuses/envelopes exact; budgets/jitter/cancel honored.
- AC15 Conditional reads on new GET + compatible old POST: correct status/body; auth/redaction/version-keys/refresh correct (C05). Procedure: HTTP + consumer matrix old/new times old/new; cache-key isolation probes. Pass: 200/304 semantics right; no cross-boundary hits; redaction intact.
- AC16 Worker command/event-loss/stale-cache/sleeping-poll: UI authoritative within C05 per channel/condition; writes enforce immediately (I07). Procedure: process + browser: drop events, stale cache, background-tab throttle; measure per-channel freshness. Pass: bound met per channel/condition; write-time enforcement independent of UI freshness.
- AC17 Timer/overlay/IME/keyboard/focus/selection/undo/question-switch: no lost edits, clock correct (I01/I07). Procedure: browser + a11y matrix: IME composition, keyboard-only, undo, overlay+timer, rapid switching. Pass: zero edit loss; focus/selection/undo preserved; clock authoritative.
- AC18 Interrupted migration rerun + retention boundary + scratch restore preserve replay/terminal/result invariants; RPO/RTO met (I10). Procedure: migration-fault + restore suite on disposable target; app-level probes (7.7). Pass: invariants hold; observed RPO/RTO within approved.
- AC19 Representative device/load within interaction/API/resource budgets; backlog returns to baseline post-storm (I12/C09). Procedure: traces + load day-shape + recovery tail (7.5); device slices. Pass: all 6.2 budgets met; drain-to-baseline proven.
- AC20 Large export / unavailable media-calculator: cancelable/recoverable, no freeze, no leak, no state corruption (I10/I11). Procedure: browser + service: oversized export cancel; media/calc outage during active work. Pass: cancel works; active work + persisted state intact; no leak.

Plus, per section 7 discriminating design: race tests run both winners; clock tests hit exact boundaries + pause/resume/extension + throttling + stale offsets; ID/payload matrix (same/same, same/different, different/same) + stale-lease/stale-control/terminal-replay run separately; answer-state matrix (missing-key, blank, not-administered, pretest, invalidated, pending, true-incorrect) asserted per consumer; old/new times new/old compat for every changed contract/storage format; ownership fixtures span roles (happy path alone proves nothing); stale expectations resolved against the frozen contract, never by editing the test to match broken code.

---

## 14. Verification Commands (confirm live scripts in WP00; staging-pinned; never prod)

~~~bash
# global candidate gate (per candidate; record env + exit + artifact)
npm run typecheck
npm run lint
npm run test:run
npm run build
# from backend/go (confirm module root live):
go vet ./...
go test ./...

# contracts / serialization spot checks (owned by contract owner):
go test ./internal/platform/apperrors/ -run TestStatusMapping -v
go test ./internal/student/ -run TestGetSessionLegacy -v
go test ./cmd/migrate/ -run TestLineage -v

# browser / a11y critical paths (staging URL only):
npx playwright test --config playwright.config.ts
npx playwright test --config playwright.sat-a11y.config.ts

# rehearsal load (STAGING allowlist only; confirm target file is the staging copy):
npm run k6:start-exam
npm run k6:section-transition
npm run k6:submit-storm
npm run k6:resume
npm run k6:auto-submit
npm run k6:exam-day
k6 run k6/scale-proof/0_entry_wave.js
k6 run k6/scale-proof/4_ws_staff_soak.js

# freeze / evidence mechanics:
git status --porcelain
git rev-parse HEAD
sha256sum package-lock.json
# migrate list: confirm flags live with database owner; record head + lineage hash
# restore rehearsal: use the exact Phase 05 script path; record RPO/RTO into evidence/ID/restore.md
~~~

Command rules: run from a clean checkout state matching the candidate; isolate parallel DB-backed runs (separate schemas/accounts/ports); keep device/browser slices for perf claims; never substitute a historical coverage file or stale passing artifact for a current run; unavailable required checks are NOT RUN/BLOCKED with owner + next action - never PASS by substitution. Never execute remote/prod-targeting configs (prod-load, prod-smoke, remote, live-runner against prod hosts, k6 with prod target/creds) without the separate deployment authorization of 7.10.

---

## 15. Completion Checklist (release sign-off equals delivered candidate is reviewed candidate)

### WP14 rehearsal complete (per frozen candidate ID)

- [ ] freeze.json valid (all 6.1 fields, hashes recomputed on sample, lineage + config + lockfiles recorded) + freeze.md published.
- [ ] AC01-AC20 runbook fully linked: each row PASS with raw log, or explicitly NOT RUN/BLOCKED with owner + next action (the latter blocks WP15).
- [ ] Mode-combination tables executed (7.3 pairwise + 4 exhaustive subspaces) with seeds/tables/results linked.
- [ ] Fault matrix F1-F10 executed with expected-signal + alert-fire + recovery proof per fault (or classified finding).
- [ ] Representative load day-shape (arrival, steady, sections, storm, observers, grading, cleanup) + comparison table + recovery tail linked; k6 summaries stored.
- [ ] Soak covering lease/token/retention/job intervals with bounded-resource verdict linked.
- [ ] App-level restore validation (answers/receipts/results/media/replay + RPO/RTO observation) linked in restore.md.
- [ ] L4 report filed (identity re-validated, inspection + independent rerun logged, findings enumerated or explicit none).
- [ ] Classification register closed: zero open BLOCKING; every IMPORTANT repaired or formally accepted (authority + control + review date named); OPTIONAL deferred items have backlog links.
- [ ] Repair loop honored: each repair to new candidate to affected rechecks + rollback-compat delta; recurrence rule applied (no triple-repeat patch); unrelated carry-forward justified by hash diff.
- [ ] Capacity statement written (supported peak + margin + generator ceiling + full metric table) with NO registration-to-concurrency extrapolation.

### WP15 rollout complete

- [ ] approvals.md signed (SLOs/C09, RPO/RTO, flags/resources, rollback package, policy deltas-or-none, deployment authorization).
- [ ] Rollback-compat matrix all-COMPATIBLE + rollback rehearsal (with invariant probes, not just health) logged.
- [ ] Cohort ladder C0 to C1 to C2 to C3 executed per pre-defined windows/exit criteria; rollout-log decisions signed; any stop handled per 7.12 + incident procedure with evidence preserved.
- [ ] Synthetic post-deploy checks green per cohort; on-call handoff complete (contacts, escalation, evidence retrieval, playbook, limits, retained-compat notes).

### WP16 cleanup complete (per target or explicitly retained)

- [ ] For each 4.5 T-item: retirement record exists with equivalence + usage + compat + window evidence and a RETIRE (with removing commit + new-candidate recheck refs) or RETAIN (with compat-contract doc) decision.
- [ ] Structural rules attested (thin handlers, app-graph composition, interfaces only at real boundaries; dead code+tests+docs removed together; onboarding/contracts updated).
- [ ] Any post-candidate removal re-entered the candidate to recheck to L4-delta to approval chain (delivered equals reviewed).

### Final sign-off

- [ ] Delivered candidate id FILL equals reviewed candidate id FILL equals approved candidate id FILL (freeze hashes match across ledger, L4 report, approvals, rollout log).
- [ ] Missing evidence/approvals, if any: NONE - or enumerated gaps FILL with scope-limited non-claim disclosure (no production claim for gap scope; engineering candidate preserved).
- [ ] Planning-only boundary respected: no prod mutation, credential access, or unauthorized load claimed under this plan authority.

---

## 16. Handoff (final evidence + on-call + retained-compat docs)

1. FINAL EVIDENCE BUNDLE (pointers, not pasted logs): candidate freeze record (candidates/ID/freeze.json + freeze.md); AC runbook + raw logs; fault/load/soak/restore reports; capacity statement; L4 report; classification + repair chain; approvals; rollback-compat + rehearsal log; rollout log; synthetic post-deploy results; per-target retirement/retention records. Every pointer includes retrieval path + content hash (or artifact URL + date).
2. ON-CALL HANDOFF (rollout/oncall-handoff.md): incident contacts + escalation; evidence-retrieval procedures (journal/DB/queue locations, redaction rules, bounded-label guidance); tested recovery playbook (compatible rollback / safe isolation / forward repair incl. unsafe-rollback prohibition); stop-condition thresholds + windows; known limitations, capacity ceiling + margin, unsupported environments/risks.
3. RETAINED-COMPAT DOCS: for every WP16 RETAIN (and any deferred contraction/flag/removal): the compat contract (writers/readers, versions, window, removal precondition, owner), linked from the retirement record and the operations contracts. If removal is unsafe, retention is the correct outcome - document it and stop.
4. GAP DISCLOSURE (if any): required evidence or approval still missing, scope affected, why no production claim is made for that scope, preserved candidate id, and next action with owner. A gap never blocks preservation of what was verified.
5. PLANNING BOUNDARY STATEMENT: this phase file planned the work; implementation evidence lives in the bundle above. The next agent (or human authorizer) executes sections 7-14 and checks section 15 - nothing here substitutes for a run.

---

## Appendix A - AC to Contract to Invariant to Owning-evidence quick index

- AC01: contracts C02, C08; invariants I01; layer engine + browser.
- AC02: contracts C08, C07; invariants I03; layer storage-fault + browser.
- AC03: contracts C02, C07; invariants I02, I10; layer DB integration.
- AC04: contracts C02, C08; invariants I03; layer engine + mobile browser.
- AC05: contracts C01, C03; invariants I05; layer provider integration + E2E.
- AC06: contracts C01, C03; invariants I05; layer service + E2E.
- AC07: contracts C02, C04, C05; invariants I06, I07; layer race + browser.
- AC08: contracts C02, C03, C06; invariants I02, I10; layer integration + browser.
- AC09: contracts C03, C06; invariants I04; layer real-DB barrier.
- AC10: contracts C06; invariants I09; layer worker crash/retry integration.
- AC11: contracts C05, C06; invariants I09; layer two-process integration.
- AC12: contracts C01; invariants I08, I05; layer integration.
- AC13: contracts C04; invariants I07; layer negative API.
- AC14: contracts C04, C07; invariants I07; layer contract + browser.
- AC15: contracts C05, C07; invariants freshness/compat; layer HTTP + consumer.
- AC16: contracts C05; invariants I07; layer process + browser.
- AC17: contracts C08; invariants I01, I07; layer browser + a11y.
- AC18: contracts C06 (+WP12); invariants I10; layer migration + restore.
- AC19: contracts C09 (+budgets); invariants I12; layer traces + load.
- AC20: contracts C04, C07; invariants I10, I11; layer browser + service.

## Appendix B - Phase-07 artifact ownership (single writer each)

- freeze.json / freeze.md / build.log: writer L0 integration owner. Reviewer L4 (validates, never edits).
- ac-runbook.md + fault/load/soak/restore/capacity reports: writer integration test owner. Reviewers L4 rerun; scope owners for findings.
- l4-report.md: writer L4 checker. Reviewer L0 (receives, does not edit).
- classification.md / repair-log.md: writer L0 (classification) + scope owners (repairs). Reviewer L4 rechecks deltas.
- approvals.md / rollout-log.md / rollback-compat.md / synthetic-postdeploy.md / oncall-handoff.md: writer authorized operations owner (+L0). Reviewers approvers named in 7.10.
- retirement TARGET.md: writer respective L1 scope owner. Reviewers integration owner (recheck) + L4 delta where applicable.
