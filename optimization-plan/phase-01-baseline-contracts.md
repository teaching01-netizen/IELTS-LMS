# Phase 01 — Baseline, contracts and acceptance matrix

**Wave:** A (first; gates all other phases).
**Sources:** WP00 (reproducible baseline and current-state confirmation) + WP01 (freeze behavioral contracts and acceptance matrix), from `docs/optimize.md` sections 5 and 6.
**Owner:** L0 + contract owner (operations owner assists WP00 evidence capture; database owner assists migration-head confirmation on a read-only basis).
**Dependencies:** none (entry phase). **Unblocks:** Phases 02 to 07 via frozen C01-C09 + AC01-AC20 matrix + baseline ledger.
**Mode:** planning + recording only. No production code, DDL, deploy, or data changes in this phase.

> Path convention: every path below is a **historical starting point rediscovered during WP00** (per `docs/optimize.md` section 6 preamble). Never trust stale file names, symbol names, or line numbers. Each step tells the worker exactly what to list and inspect to re-ground before recording. If a file moved, record the new path in the ledger and continue — do not stop the phase.

---

## 1. Objective

1. Produce a **reproducible baseline** of the current tree that any second engineer can re-run: exact source revision + dirty-tree identity, toolchain versions, lockfiles, env and config fingerprint (redacted), API and worker process topology, DB version + migration head, deployment flags, supported browsers, and current safe-suite results (pass, fail, and skip classified — never relabeled).
2. **Confirm or retire the four historical high-risk hypotheses** with evidence, not memory: (a) SAT V2 versus legacy answer-source divergence, (b) bootstrap POST and 304 HTTP semantics, (c) the scope of “zero-SQL polling”, (d) throughput figures as goals rather than capacity — plus stale-test, line-number, and migration-count hygiene.
3. **Freeze behavioral contracts C01–C09 at v1** with concrete wire fields, state transitions, error codes and envelopes, and compatibility rules, resolving all authority questions (start, pause, resume, extension, SAT provisional versus final, result release, grading permissions, invalidation).
4. **Specify the AC01–AC20 acceptance matrix** with deterministic fixtures, assertions, owning phase and worker, and test layer for each scenario, plus executable **skeleton** tests (real assertions or explicit NOT-RUN markers — never skipped placeholders counted as passes).
5. Hand Wave B a **closed contract package**: versioned evidence directory + contract version docs + AC skeletons + product-decision approval list, so Phases 02, 03, and 04 can implement without inventing shared semantics.

Done means: another engineer on a clean checkout reproduces the baseline, reads C01–C09 without ambiguity, and knows exactly which fixture + layer proves each AC.

---

## 2. Scope / out of scope

### In scope (WP00 + WP01 only)

- Record source revision, toolchains, lockfiles, and envs (redacted); enumerate API and worker topology, DB version, migration head, flags, and browsers.
- Run safe local suites (typecheck, lint, unit, Go, build) and **classify** pre-existing failures, skips, and env-blocked checks.
- Reproduce the four historical high-risk concerns + stale-artifact audit (tests, line numbers, migration counts, old pass artifacts).
- Build **sanitized deterministic fixtures**: IELTS objective + writing-review, SAT-adaptive (V2-only + mixed-legacy compat), ACT science; define the C09 workload and SLO profile as proposal-pending-approval.
- Freeze C01–C09 with concrete wire fields, transitions, codes, and compat windows; resolve authority questions; set request-validation limits + error envelopes from existing behavior.
- Specify AC01–AC20 (fixtures + owners + layers); create executable skeleton tests; list product decisions needing approval.
- Stand up the versioned evidence directory under `docs/production-hardening/` plus the ledger and hypothesis inventory.

### Out of scope (belongs to Phases 02–07; doing it here is a phase violation)

- Any production code edit, DDL or migration execution, deployment, data repair, deletion, backfill, credential access, or production load test.
- Changing scoring, timing, admission, grading-permission, retention, RPO and RTO, or SLO policy (record current behavior + flag the decision for approval instead).
- Implementation detail of durability engines, terminalization resolvers, auth hardening, API retry refactors, runtime caches, query and index tuning, observability wiring, rehearsal and load, or cleanup and retirement.
- Blanket dependency upgrades, new infra (Redis, queues, microservices, sharding), timeout growth as diagnosis, assertion weakening, compat-path removal.
- Using live students, real PII, production secrets, or production DB rows as fixtures or evidence.

---

## 3. Dependencies

### What this phase needs (inputs)

- **None gated.** Clean checkout + read access to the tree, manifests, existing local test config, and the historical map in `docs/optimize.md`.
- **Nice-to-have, not blocking:** local MySQL 8.4 (CI uses `mysql:8.4`), Go 1.26.x, Node 22+ with npm 11 (observed local run: go1.26.3 darwin/arm64, node v26.0.0, npm 11.12.1 — re-record at run time), Playwright browsers. If any item is missing, mark dependent checks BLOCKED or NOT-RUN and continue independent work (per the WP00 failure policy).

### What this phase unblocks (consumers — contract-gated)

| Consumer | Needs frozen | Why it blocks |
|---|---|---|
| Phase 02 (WP02 scoring chain; WP04 terminalization and jobs) | **C01, C02, C03** + AC05, AC06, AC09, AC10, AC11, AC12 fixtures | Authoritative response source, replay identity, provisional-versus-terminal rules; without them Phase 02 would invent semantics |
| Phase 03 (WP03 durability adapters; WP08 and WP09 UX and perf) | **C01, C02, C08** + AC01, AC02, AC03, AC04, AC07, AC08 skeletons; WP08 additionally needs WP06 and WP07 runtime and API contracts | Provider adapters start **only after** C01, C02, C08 are frozen (overall-plan Wave B rule); storage namespaces + write and replay identity must predate adapter work |
| Phase 04 (WP05 auth; WP06 API and retry; WP07 runtime and process) | **C04, C05, C07** (+ C02 and C03 for terminal and replay edges; C06 for worker ownership) | Auth matrix, error vocabulary, clock, cache, and process-boundary rules; WP06 POST and 304 + retry-ownership work must not begin on guessed wire shapes |
| Phase 05 (WP11 tuning; WP12 restore) | **C09 profile proposal** + baseline query-inventory pointers + WP12-prep (migration head + restore procedure pointers) | WP11 needs stable query shapes (Phases 02–04) + WP10 evidence, but preparation (head allocation discipline, restore rehearsal pointers) starts here; C09 bounds what capacity means |
| Phase 06 (WP10 observability; WP13 CI and fixtures) | Baseline suite results + metric-semantics hooks (finalized with Phase 01) + fixture seeds | WP10 and WP13 start early on the WP00 baseline; permanent thresholds wait for C09 approval |
| Phase 07 (WP14, WP15, WP16) | Full C01–C09 v1 + AC01–AC20 matrix + candidate-freeze procedure | Integrated rehearsal runs all 20 AC against the frozen candidate; cleanup retirement needs adoption evidence defined here |

**Cross-phase coordination notes:** Phase 02 and Phase 04 shared runtime and worker files are sequenced by the ownership registry (overall-plan section 7), not by this phase. This phase only freezes the contracts they coordinate *against*. A contract change after freeze invalidates only its producer and consumer phases (WP01 rollback rule) — record version bumps, never silent edits.
---

## 4. Affected files (read-only in this phase — inspect, never edit)

> Rediscovery rule: run the listed glob or ls first, then read the file that actually exists. Named symbols are *starting points from conversation context*; the worker records the true path + symbol in the ledger.

### 4.1 Contract surface: OpenAPI + wire DTOs

- `api/openapi/openapi.yaml` — confirmed present (openapi 3.0.3, `info.version: 1.0.0`, uniform error envelope `{code, message, details?, requestId}` + `X-Request-Id` header, UTC RFC3339-micro timestamps, tags auth, student-v2, terminalization, proctor, grading, results, sat, act). Inspect: `paths` for `/auth/login`, `/auth/student/entry`, delivery and bootstrap, response-batch write, submit and terminalize, SAT provisional and final, result-read, grading and review; `components/schemas` + `components/responses/Error` + `components/parameters/RequestId`. Record every status code, envelope field, nullability, limit and pagination field actually serialized.
- Go wire DTOs versus internal models: search `backend/go/internal/**/*.go` for handler structs serving the above paths (starting points `handlers_delivery.go` and `handlers_v2.go` — glob to confirm exact names; they may live under `internal/delivery`, `internal/student`, or an http or handler package). Record which structs are wire DTOs versus leaked internals (WP06 follow-up, not this phase fix).

### 4.2 Backend: attempts, terminalization, runtime (WP01 targets)

- `backend/go/internal/attempts/` — confirmed: `service.go`, `types.go`, `validate.go`, `submit.go`, `materialize.go`, `canonicaljson.go`, plus contract-adjacent tests (`durability_contract_test.go`, `envelope_vocab_test.go`, `fencing_order_test.go`, `outcome_wire_test.go`, `outcome_vocab_test.go`, `outcome_retry_test.go`, `submit_envelope_test.go`, `submit_receipt_compat_test.go`, `submit_replay_emit_test.go`, `writability_test.go`, `revocation_test.go`, `rowfirst_test.go`, `sat_annotations_test.go`, `contention_test.go`, `retry_test.go`). Inspect: attempt identity, lease epoch, control epoch, write and mutation IDs, canonical payload + hash, ack and revision fields, fencing order, replay-versus-new-write rule, terminal-boundary guard.
- `backend/go/internal/terminalization/` — confirmed: `service.go` plus `seal_concurrency_test.go`, `seal_deadline_race_test.go`, `seal_emit_test.go`, `seal_materialize_test.go`, `seal_validate_test.go`, `requestid_pin_test.go`, `orgnull_test.go`, `repair_emit_test.go`. Inspect: provisional versus terminal states, submission-ID ownership, request hashing, outcome-compatibility predicate, response digest, server-submission-time source, result-availability gate.
- `backend/go/internal/runtime/` — confirmed: `service.go`, `poll.go`, `snapshot.go` plus `poll_test.go`, `snapshot_test.go`, `snapshot_err_test.go`, `snapshot_load_test.go`, `fence_test.go`, `snapshot_emit_test.go`. Inspect: server-clock authority, revision ordering, ETag and conditional-read fields, poll-cadence hints, pause, resume, and extension handling, cache keys, TTL, invalidation, worker-change visibility path.
- Process topology: `backend/go/cmd/api/main.go` (API composition), `backend/go/cmd/worker/main.go` (worker orchestration and fan-out), `backend/go/internal/app/app.go` (shared service graph — confirm exact path; glob `internal/app/*.go`), `backend/go/internal/liveupdates/bus.go` (plus `forward_test.go` and `admission_test.go`), `backend/go/internal/outbox/*.go` (durable bus and outbox candidate). Record: separate-process proof (no shared in-memory hub or cache), worker-to-API-visible mutation list + mechanism (bus, invalidation, or bounded refresh).

### 4.3 Provider services (C01 response-ownership evidence)

- SAT: `backend/go/internal/sat/service.go` (plus `scoring_test.go`, `scoring_edges_test.go`, `concurrency_test.go`, `ageprobe_test.go`).
- Scoring core: `backend/go/internal/assessscore/score.go` and `v2read.go` (plus tests) — V2-aware read path central to hypothesis H1.
- ACT: `backend/go/internal/act/service.go` (plus `scoring_test.go` and `service_test.go`).
- Grading and review: `backend/go/internal/grading/service.go`, `sessions.go`, `projection.go`, `review_read.go`, `result_read.go` (plus `source_test.go`, `sessions_test.go`, `state_test.go`, `result_read_test.go`).
- Results and release: `backend/go/internal/results/service.go` and `backend/go/internal/release/service.go`.
- Delivery and student read + write: `backend/go/internal/delivery/*.go` (including `content_contract_test.go` and `timing_contract_test.go`, plus cache and reconcile tests), `backend/go/internal/student/service.go`, `v1_write.go`, `readthrough.go`, `backend/go/internal/exams/*.go`, `backend/go/internal/answerhistory/service.go`, `backend/go/internal/authoring/*.go` (publish and draft pinning for AC12).
- Auth, admission, media: `backend/go/internal/auth/*`, `authz/*`, `accesslinks/service.go`, `media/*` (plus `authz_test.go`, `sessioncache_test.go`, `masterkey_test.go`).
- Enumerate with: `ls backend/go/internal/` and `ls backend/go/internal/{sat,act,assessscore,grading,results,delivery,student,attempts,terminalization,runtime,liveupdates,outbox,auth,authz,accesslinks,media}`.

### 4.4 Frontend API + durability contracts

- Transport: `src/shared/api/apiClient.ts` and `src/shared/api/queryClient.ts` (retry ownership, cancellation, envelope parsing — record current behavior).
- Durability engine: `src/shared/durability/DurableResponseEngine.ts`, `types.ts`, `useResponseDurabilityStatus.ts` (write identity, ack matching, pending intent, replay, conflict handling).
- Student session: `src/features/student/**` — confirmed sample includes `application/exam-session/StudentAttemptController.ts`, `createStudentExamSession.ts`, `reconcileServerSnapshot.ts`, `submissionCommands.ts`, `studentSessionBootstrap.ts`, `studentSubmissionCoordinator.ts`; `contracts/exam-session/*.ts` (DraftCommitPort, StudentAttemptStore, StudentDurabilityPort, StudentMutationOutbox, StudentPlatformPort, StudentRealtimePort, StudentSessionTransport); `api/studentAttemptGateway.ts`, `studentSessionGateway.ts`, `studentSessionQueries.ts`, `studentSessionRouteData.ts`; `infrastructure/exam-session/studentMutationOutboxAdapter.ts` and `studentRealtimeCoordinator.ts`. Rediscover: `src/features/student/api/responseDurabilityTransport.ts`, `src/features/student/hooks/useStudentSessionRouteData.ts`, `src/features/student-delivery/hooks/useSatResponsePersistence.ts` and `useSatExamController.ts` (glob; names may have moved — record actuals).
- Shells and dashboards (read-freshness + storage consumers, for C05 and C08 scoping): `src/components/proctor/ProctorDashboard.tsx`, `src/components/admin/StudentReviewWorkspace.tsx`, `src/features/exam-authoring/ui/AuthoringWorkspace.tsx` (glob to confirm).

### 4.5 Persistence lineage, config, observability, test and load harness

- Migrations: `backend/go/migrations/0001_*.sql` through `0058_authoring_operation_keys.sql` (58 files observed) + `backend/go/cmd/migrate/main.go`, `MIGRATION_POLICY.md`, plus lineage and repair tests. Record head = `0058`; do NOT assume next is `0059` (central allocation per WP12).
- Config and flags: `backend/go/internal/platform/config/*` (rate-limit tiers and modes, session-cache, attempt-verify, runtime-snapshot, rowfirst, outbox, livebus, ws-admission, studentws, versioncache, entrygate, presence, rollup modes — each with mode tests), root `.env.example` plus `RESOURCE_PROFILE`, `BACKGROUND_*`, `DB_POOL_*`, `RETENTION_*` keys. Record flag names + defaults; never record secret values.
- DB and tx pools: `backend/go/internal/platform/db/*`, `platform/tx/tx.go`, `backend/go/go.mod` (`module example.com/ielts-proctoring`, go 1.26.3) + `go.sum`.
- Telemetry: `backend/go/internal/platform/telemetry/telemetry.go` and `registry.go` (plus tests) — record metric names, label sets (flag unbounded ID labels), redaction posture.
- Test and load: `package.json` scripts (confirmed in section 14), `vitest.config.ts` (jsdom, setup `src/test/setup.ts`), `playwright.config.ts` (plus `playwright.sat-a11y`, `prod-smoke`, `prod-load`, `remote` configs), `k6/prod-*.js` (exam-day, start-exam-200, section-transition-200, submit-storm-200, resume-100, auto-submit-200 + helpers), `.github/workflows/ci.yml` (go-backend job: gofmt, vet, unit, build, race, coverage-ratchet-27, migrate, validate, integration-mysql, openapi-lint, staticcheck, schema-guard, diff-check), `e2e/**`, `tests/**`, `test-mysql-lifecycle.cjs`.

---

## 5. New files (all **proposed** — create in this phase; nothing here edits prod code)

Versioned evidence root (single version for the whole phase output; bump as a set):

```text
docs/production-hardening/
baseline-v1/                        # WP00 output (frozen; never edit after freeze — copy to v2)
  00-index.md                       # map of every artifact + how to reproduce
  01-source-identity.md             # revision, dirty hashes, lockfiles, toolchains
  02-topology.md                    # API/worker processes, DB version, migration head, flags, browsers
  03-suite-results.md               # typecheck/lint/unit/Go/build raw logs + classification table
  04-hypothesis-inventory.md        # H1–H7 verdicts with file:line + log excerpts
  05-fixture-catalog.md             # sanitized fixture IDs + coverage matrix
  06-c09-profile-proposal.md        # workload/SLO proposal (pending approval)
  logs/                             # raw command output, redacted (*.log, never secrets)
contracts-v1/                       # WP01 output (frozen; consumers cite these versions)
  00-contract-index.md              # C01–C09 version table + compat windows + change policy
  C01-response-ownership.md
  C02-durable-write-replay.md
  C03-terminalization.md
  C04-authorization-caching.md
  C05-runtime-read-freshness.md
  C06-work-ownership-projection.md
  C07-error-retry-vocabulary.md
  C08-client-storage.md
  C09-workload-slo-profile.md       # points at baseline-v1/06 proposal; records approval status
  authority-matrix.md               # start/pause/resume/extension, provisional, release, grading, invalidation owners
  product-decisions-needing-approval.md
acceptance-v1/                      # AC matrix + skeletons
  AC-matrix.md                      # AC01–AC20 table (fixtures x owners x layers)
  fixtures/                         # sanitized JSON/TS seeds (ielts-*, sat-*, act-*) — no PII
  skeletons/                        # executable skeletons (fail-closed, not skipped passes)
```

Executable skeleton tests (extend current suites where they own the behavior; new files only where no owner exists — filenames **proposed**):

```text
# Frontend (Vitest; colocate or under acceptance-v1/skeletons mirrored into src where CI picks them up)
src/shared/durability/__tests__/c02-replay-identity.skeleton.test.ts
src/features/student/application/exam-session/__tests__/ac01-readiness-barrier.skeleton.test.ts
src/features/student/application/exam-session/__tests__/ac04-reload-recovery.skeleton.test.ts
e2e/acceptance/ac02-storage-denial.spec.ts
e2e/acceptance/ac08-submit-blocked.spec.ts
e2e/acceptance/ac17-input-preservation.spec.ts

# Backend (Go; package-owned, build-tagged where DB-gated)
backend/go/internal/attempts/ac03-lost-ack-replay.skeleton_test.go
backend/go/internal/sat/ac05-v2-routing.skeleton_test.go
backend/go/internal/assessscore/ac05-key-pinning.skeleton_test.go
backend/go/internal/terminalization/ac09-terminal-race.skeleton_test.go
backend/go/internal/outbox/ac10-fanout-ownership.skeleton_test.go
backend/go/internal/runtime/ac16-freshness-bound.skeleton_test.go
backend/go/internal/auth/ac13-negative-authz.skeleton_test.go
backend/go/integration/ac11-two-process-reconcile.skeleton_test.go   # two-process; skips closed unless both procs live
```

Rules: skeletons assert the frozen contract (exact codes, fields, transitions) and either PASS on current behavior or FAIL with a pointer to the hypothesis — an env-gated skeleton reports `NOT RUN (reason + command to enable)`, never `PASS`. No skeleton may call production, mutate prod data, use live-student rows, or embed secrets.

---

## 6. Interfaces / contracts (C01–C09 frozen v1 + versioning discipline)

### 6.1 Versioning and compatibility recording (applies to all nine)

- Version scheme: `Cxx v1.0.0-baseline (<YYYY-MM-DD>, source <git-sha12>[+dirty:<hash>], openapi <version>, schema <migration-head>)`. Patch = clarification with zero wire change; minor = additive compatible (new optional field or endpoint, old consumers unaffected through the rollback window); major = breaking (requires versioned endpoint or storage namespace + migration window + adoption evidence).
- Each contract doc records: status (FROZEN or PROPOSED), version, source revision, wire fields (names, types, nullability, limits), state-transition table, error codes + envelopes + HTTP statuses, retry owner + budget, compat window (which old and new combinations are supported and for how long), rollback pairing (which binary and schema restore the prior behavior), and open product questions (moved to the approval list, never silently decided).
- Change policy (WP01 rollback rule): after freeze, a contract change is a **new versioned proposal** that invalidates only its producer and consumer phases; mid-wave silent edits are forbidden. Record supersession (`supersedes: Cxx v0 -> v1, reason, adopter checklist`).
- Wire-truth rule (C07): the contract quotes the **observed serialized bytes** (OpenAPI + live handler output), not the Go identifier. Known alias trap from source history: `SUBMISSION_ID_MISUSE` (wire) versus the Go const name, `acknowledgements` (wire) versus internal `acks` — reverify and pin both columns in C07.

### 6.2 C01 — Response ownership and scoring authority (gates Phases 02, 03)

Freeze per provider (IELTS, SAT, ACT): authoritative response table(s) + columns; administered-question identifiers + content-revision pin; answer-key revision + scoring-policy version; pretest handling (excluded from score, flagged in review and export); unadministered-branch semantics (never scored, never defaulted to false); null versus blank versus pending versus invalidated distinctions; legacy-fallback conditions with explicit precedence (single resolver; no uncontrolled dual writes); immutable result inputs (what snapshot is sealed at terminal time). Concrete start: SAT path through `assessscore/v2read.go` + `sat/service.go` + `attempts/materialize.go`; IELTS and ACT through `assessscore/score.go` + `act/service.go` + grading projection. Record the current V2 and legacy verdict inline (H1 result).

### 6.3 C02 — Durable write and replay (gates Phases 02, 03)

Freeze: attempt identity, lease epoch, control epoch, write and mutation ID (stable per issued write), client version, canonical payload bytes + hash (`attempts/canonicaljson.go`), ack shape (`acknowledgements` wire name + `revision`), retryability matrix: **transport retry** (same write ID + same bytes gives compatible ack, no duplicate mutation) versus **new reconciled write** (new write ID under newer control epoch after fresh authoritative state); forbidden replays (across device-ownership change, across terminal boundary, under stale lease). Pin idempotency keys + fencing order from the `attempts` fencing, retry, and contention tests as observed.

### 6.4 C03 — Terminalization (gates Phase 02; read by 03 and 04)

Freeze: provisional versus terminal state machine (all states + allowed transitions + who may initiate: student submit, proctor terminate, deadline worker); submission-ID ownership + request-hash binding; outcome-compatibility predicate (when a second terminal request is rejected versus coalesced); response-digest + scoring-snapshot contents; server-submission-time authority (server clock, never client); result-availability gate (when a result may be read or released). Preserve existing wire shapes; any change is a versioned endpoint.

### 6.5 C04 — Authorization and caching (gates Phase 04)

Freeze: role x resource x operation matrix (student, observer, grader, proctor, admin including cross-org denial); attempt-ownership + assignment checks (path params versus bearer); session and token binding, expiry, logout-all, revocation propagation bound (max acceptable delay, approved in C09 and the approval list); strict versus stateless mode behavior; session-cache scoping (keys include user, attempt, version; no cross-user hits); closed-by-default admission (invite-code versus access-link branches; 404-collapse indistinguishability). Safety never depends on frontend route guards.

### 6.6 C05 — Runtime and read freshness (gates Phases 02, 04)

Freeze: server-clock authority + staleness handling (pause, resume, extension may move deadlines forward explicitly); revision ordering; ETag and conditional-read semantics on the **new GET read path** (POST stays compatible — see C07 and AC15); poll-cadence hints (steady versus fast-lane hint with explicit non-guarantee: a sleeping client may miss the hint window); cache keys (identity, version, revision scope), TTL, capacity, authorization-safe invalidation; worker-originated mutation to API-observable mechanism + visibility bound (millisecond or second SLO proposal, measured in Phase 06 and 07, never asserted here).

### 6.7 C06 — Work ownership and projection (gates Phase 02)

Freeze: job and child-work identity, owner and lease + expiry, eligible-retry states, idempotency rule per job type, completion condition (parent completes only when every target is finished, permanently classified, or durably re-owned — no orphan-by-sibling-success), transient versus permanent failure classes, poison isolation + dead-lettering, recovery commands (requeue, claim, repair ownership). No new queue infra assumed; record the existing job and outbox model as found.

### 6.8 C07 — Error and retry vocabulary (gates Phases 03, 04)

Freeze: exact wire codes (including `SUBMISSION_ID_MISUSE`), HTTP statuses, envelope `{code,message,details?,requestId}` + `X-Request-Id` echo and mint, field nullability, validation limits, pagination shape; per-operation retry owner (exactly one of: API client, React Query, durability engine, worker — never stacked), retryable-versus-fatal classes, budget + jitter + cancellation + `Retry-After` honoring; stale-response suppression (cancel obsolete, never let old route or attempt data overwrite newer). The bootstrap POST and 304 verdict is recorded here with the compatible path (new GET conditional-read path + documented full-POST response) — implementation belongs to Phase 04.

### 6.9 C08 — Client storage (gates Phase 03)

Freeze: versioned key namespaces (`{app, schema-version, attempt-id}` scoping), per-attempt isolation, persistence milestones (visible input, local checkpoint, async journal, in-flight, exact server ack), sync-checkpoint size bound (small records; no whole-attempt rewrite per keystroke), journal compaction + conflict-archive lifecycle (archive before destructive removal), quota, denial, corrupt, upgrade, account-switch, and terminal-cleanup behavior, old-bundle compat window, rollback rule (namespaced upgrades; never blanket `localStorage.clear()`).

### 6.10 C09 — Workload and SLO profile (gates Phases 05, 06, 07; PROPOSED until approved)

Record as **proposal for calibration** (source section 8 numbers are candidates, not promises): concurrent active attempts, arrival rate, write cadence, section-transition rate, submit-storm size, proctor subscriptions, content and media sizes, device and network profiles (including the named lower-powered device), deployment flags, resource limits (CPU, RAM, disk, pools); candidate gates table (input p95 at most 100 ms, INP p75 at most 200 ms, autosave-ack p95 at most 1 s, terminal-receipt p95 at most 2 s with SAT-provisional versus final split, 99.9 percent valid-critical-request availability with 429, validation, client, and server reported separately, zero silent-loss integrity gate, bounded queue-age + drain, C05 freshness bound per channel). Explicit non-inference rule: never derive concurrency from registrations per day. Approval owners recorded in the product-decision list.

---

## 7. Step-by-step implementation (ordered; each step = action + exact inspect + record + done-criterion)

> Execute in order. Steps 1–8 = WP00 baseline; Steps 9–14 = WP01 freeze. Every step writes into `docs/production-hardening/baseline-v1/` or `contracts-v1` / `acceptance-v1` and updates `00-index.md`. No step edits prod code.

### Step 1 — Freeze source identity (WP00)

- **Action:** capture `git rev-parse HEAD`, `git status --porcelain`, dirty-file hashes (`git diff --stat` + sha per changed file), `package-lock.json` + `backend/go/go.sum` hashes, Go version (`go version`), Node and npm (`node --version; npm --version`), TypeScript (`npx tsc --version`), MySQL client and server version if reachable, Playwright browser revisions (`npx playwright --version` + installed browsers list).
- **Inspect:** repo root; `.github/workflows/ci.yml` go-version pin (currently `go-version-file: backend/go/go.mod`, go 1.26.3).
- **Record:** `baseline-v1/01-source-identity.md` + raw log in `logs/01-source-identity.log`.
- **Done:** a second engineer running the listed commands gets identical revision + toolchain rows.

### Step 2 — Enumerate topology: processes, DB, migration head, flags, browsers (WP00)

- **Action:** list startup paths and prove API and worker separation.
- **Inspect:** `backend/go/cmd/api/main.go`, `backend/go/cmd/worker/main.go`, `backend/go/cmd/migrate/main.go`, `backend/go/internal/app/app.go` (confirm path), `playwright.config.ts` `webServer` block (today starts API + worker as two processes — cite as dev-topology evidence, then confirm prod packaging docs), `backend/go/migrations/` (count + head; observed 0001–0058, head `0058_authoring_operation_keys.sql`), `MIGRATION_POLICY.md`, `backend/go/internal/platform/config/*` flag names and defaults, `.env.example` + `RESOURCE_PROFILE`, `BACKGROUND_*`, `DB_POOL_*`, `RETENTION_*` keys (names only), Playwright `projects` (Desktop Chrome, Pixel 7, iPhone 13, iPad gen7 x2, Desktop Firefox and Safari) as the supported-browser starting list.
- **Record:** `baseline-v1/02-topology.md` (process table, migration head, flag table with defaults, browser matrix marked UNCONFIRMED until product approves).
- **Done:** head, process list, flag names, and browser rows are cited to file and line; any deviation from this plan starting points is noted as a rediscovery.

### Step 3 — Run safe local suites; classify results (WP00)

- **Action:** confirm actual scripts in `package.json`, then run read-only suites in order; capture full logs; classify every failure.
- **Inspect and proof:** `package.json` scripts observed: `typecheck: tsc --noEmit`, `lint: eslint .`, `test:run: vitest run`, `build: vite build`; Go: `go vet ./...`, `go test -count=1 ./...`, `go build ./cmd/api ./cmd/worker ./cmd/migrate` (mirror CI; do NOT run k6, prod-*, or any script whose name or config targets remote or prod without reading it first).
- **Commands (verify-then-run; see section 14 for the exact block):** `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run build`, `cd backend/go && go vet ./... && go test -count=1 ./...`, `go run ./cmd/migrate --validate-only` (read-only validation), `npx --yes @redocly/cli lint api/openapi/openapi.yaml`.
- **Record:** `baseline-v1/03-suite-results.md` + `logs/` raw outputs; classification table per failure: PRE-EXISTING-FAIL (test + assertion + log line), SKIPPED-BY-DESIGN, BLOCKED-NO-ENV (missing DB, browser, creds + enabling command), FLAKY (with rerun evidence). Never relabel BLOCKED as PASS.
- **Done:** every suite row has status + log pointer; pre-existing failures are individually classified.

### Step 4 — Reproduce H1: SAT V2 and legacy divergence current state (WP00)

- **Action:** determine whether V2-only answers already route, score, review, and export correctly or diverge.
- **Inspect:** `backend/go/internal/assessscore/v2read.go + v2read_test.go`, `assessscore/score.go + score_test.go`, `backend/go/internal/sat/service.go + scoring_test.go + scoring_edges_test.go`, `backend/go/internal/attempts/materialize.go + sat_annotations_test.go`, grading `source_test.go` and review and export consumers.
- **Record:** `baseline-v1/04-hypothesis-inventory.md#H1` verdict: CONFIRMED-DIVERGENT (with failing fixture IDs), ALREADY-FIXED (with regression test pointers), NOT-REPRODUCED (with fixture + command), or ENV-DEPENDENT. Do not bridge or fix here — freeze the observed behavior into C01.
- **Done:** verdict cites file and line + test command + fixture IDs.

### Step 5 — Reproduce H2: bootstrap POST and 304 semantics (WP00)

- **Action:** capture actual bootstrap request and response bytes + status; judge HTTP-semantic correctness while preserving compat.
- **Inspect:** `api/openapi/openapi.yaml` bootstrap paths; delivery and bootstrap handlers (glob `handlers_delivery.go` and `handlers_v2.go` actuals); frontend bootstrap call sites (`studentSessionBootstrap.ts`, gateways, `queryClient.ts`); any test asserting 304 on POST.
- **Record:** inventory entry H2 + C07 wire-truth rows (method + path + observed status + body contract). Proposed compatible direction (new GET conditional-read path + documented full-POST response) recorded as proposal; implementation deferred to Phase 04.
- **Done:** observed bytes quoted; no behavior changed.

### Step 6 — Reproduce H3 and H4: zero-SQL polling scope + throughput-as-goal (WP00)

- **Action (H3):** measure end-to-end SQL per poll **including** auth and session touch; identify which path (if any) is actually zero-SQL (cache lookup versus full request).
- **Inspect:** `runtime/poll.go + poll_test.go`, `liveupdates/bus.go`, session and auth verification path (`sessioncache_test.go`, attempt-verify config), telemetry counters.
- **Action (H4):** inventory every throughput figure found in docs, comments, and k6 scripts; label each GOAL (unmeasured) versus MEASURED (with evidence pointer). Record the non-inference rule (registrations per day does not imply concurrency).
- **Record:** H3 and H4 verdicts + C05 and C09 scoping notes (advertise zero-SQL only for proven paths; capacity claims only under frozen C09).
- **Done:** SQL-per-poll statement cites the measured path; every throughput number is tagged GOAL or MEASURED.

### Step 7 — Stale-artifact audit: tests, line numbers, migration counts, old pass reports (WP00)

- **Action:** list suites that no longer match implementation, line numbers that drifted, migration-count assumptions (0058 observed — re-count live), and any checked-in pass or coverage artifacts masquerading as current evidence.
- **Inspect:** `git log --oneline -15 -- <suspect test>` per suspect; `backend/go/cmd/migrate/lineage_test.go`; coverage remnants (`coverage/`, stray `coverage.out`); old `playwright-report` and `test-results` dirs.
- **Record:** stale-versus-valid table in the hypothesis inventory (H7); stale expectations are resolved **against the frozen contract** (per source section 7 discriminating-design rule), never by editing tests here.
- **Done:** each stale item has an owner-phase pointer (usually Phase 06) and is excluded from baseline PASS claims.

### Step 8 — Build sanitized fixtures + C09 proposal draft (WP00)

- **Action:** author deterministic, PII-free seeds: IELTS objective + writing-review; SAT-adaptive V2-only + mixed-legacy-compat + pretest, unadministered, blank, null, invalidated variants; ACT science; cross-user and assignment negative fixtures (IDs only, no real users).
- **Inspect:** existing seeds and fixtures under `e2e/`, `tests/`, `backend/go/integration/`, `e2e_seed` and `preprovision` commands (read for shape, do not run against prod; local disposable DB only).
- **Record:** `baseline-v1/05-fixture-catalog.md` (fixture ID, provider, what it discriminates, owning AC) + `baseline-v1/06-c09-profile-proposal.md` (concurrency, arrival, cadence, storms, devices, networks, flags, limits + section 8 candidate gates, all marked PROPOSED-PENDING-APPROVAL) + seed files under `acceptance-v1/fixtures/`.
- **Done:** every AC01–AC20 maps to at least 1 fixture ID; no fixture contains PII, secrets, or live rows.

### Step 9 — Freeze C01, C02, C03 first (highest-risk path; WP01)

- **Action:** write `contracts-v1/C01-*.md`, `C02-*.md`, `C03-*.md` with concrete fields, transitions, and codes per sections 6.2–6.4; resolve authority sub-questions for scoring source, replay identity, provisional-versus-terminal ownership.
- **Inspect:** files in sections 4.2–4.3 + OpenAPI diff of actual serialized output (add a throwaway local probe if needed; record output, commit nothing prod).
- **Record:** FROZEN v1 rows in `00-contract-index.md`; any intentional deviation from observed behavior filed as a versioned change proposal with adopter checklist (not a silent edit).
- **Done:** Phase 02 owner confirms they can implement without inventing semantics (written sign-off line in index).

### Step 10 — Freeze C04, C05, C06, C07 (WP01)

- **Action:** write the four docs per sections 6.5–6.8; build the role x resource x operation matrix skeleton (C04), the worker-mutation to API-visibility table (C05), the job-ownership table (C06), and the exact wire-code + retry-owner table (C07).
- **Inspect:** auth, authz, accesslinks, and media handlers + session and cache tests (C04); runtime, poll, snapshot, liveupdates, outbox + worker main (C05 and C06); OpenAPI + handler serialization + frontend retry layers (C07).
- **Record:** authority answers that are *engineering facts* frozen here; anything that is *policy* (expiry lengths, revocation bound, retry budgets, freshness SLO) recorded as PROPOSED and copied to the approval list.
- **Done:** Phase 04 owner confirms no invented semantics needed.

### Step 11 — Freeze C08 and C09 + authority matrix (WP01)

- **Action:** write C08 (namespaces, milestones, quota and denial matrix, compaction and archive lifecycle, account-switch, terminal cleanup, bundle compat) and C09 (promote the Step 8 proposal with measurement boundaries per channel and condition); write `authority-matrix.md` answering: who owns start, pause, resume, extension, deadline-move; when SAT provisional completes versus final seal and result readiness and who recovers an abandoned provisional; who releases results and who repairs an issued result; grading-permission boundaries; invalidation semantics + audit.
- **Inspect:** durability engine + storage adapters + student-delivery persistence hooks (C08); k6 profiles + telemetry + runbooks for measurability (C09; do not run load here).
- **Record:** C08 FROZEN; C09 PROPOSED-PENDING-APPROVAL with approver + date rows left open; authority matrix rows cite contract sections.
- **Done:** Phase 03 owner confirms storage and replay semantics are unambiguous; C09 approval owners are named.

### Step 12 — Specify AC01–AC20 matrix with fixtures x owners x layers (WP01)

- **Action:** write `acceptance-v1/AC-matrix.md` per section 13 table: per AC list Given, When, Then assertions, fixture IDs (Step 8), owning phase + worker, test layers (engine+browser, DB integration, two-process, contract, accessibility, load), and environment (local, disposable-DB, browser matrix, staging-only).
- **Inspect:** source section 7 scenario texts (normative) + discriminating-design bullets (race both-winners, clock boundaries, ID, payload, and epoch combinations, key, blank, not-administered, pretest, invalidated, pending versus incorrect, old and new interop, negative ownership fixtures).
- **Record:** every AC has at least 1 fixture, 1 owner, at least 1 layer; AC12 pinned-snapshot rule and AC15 old and new interop explicitly covered.
- **Done:** Phase 07 owner can schedule all 20 against the integrated candidate from this matrix alone.

### Step 13 — Author executable AC skeletons (WP01)

- **Action:** create the skeleton files in section 5 (extend existing suites where an owner exists); each asserts the frozen contract concrete fields, codes, and transitions; env-gated ones report NOT-RUN with the enabling command.
- **Inspect:** neighboring tests for harness conventions (Vitest jsdom setup, Go test package style, Playwright `testMatch **/*.spec.ts` + webServer two-process boot).
- **Record:** skeleton index (file, AC, contract version, current result PASS, FAIL, or NOT-RUN) inside `AC-matrix.md` appendix.
- **Done:** `npm run test:run` + `go test ./...` execute the new skeletons; zero skeletons counted as PASS via skip.

### Step 14 — Close the phase: approval list + freeze + handoff (WP01)

- **Action:** write `product-decisions-needing-approval.md` (section 13 tail list); freeze `baseline-v1/`, `contracts-v1/`, `acceptance-v1/` (record hashes); update `00-index.md` reproduce steps; emit the section 16 handoff packet.
- **Inspect:** diff of all new docs (`git status --porcelain`); secret scan of evidence (`grep -riE` scan must show only redacted placeholders).
- **Record:** freeze table (version, sha, date, sign-off) + handoff message to Phase 02, 03, and 04 owners.
- **Done:** section 15 checklist fully ticked; Wave B may start (Phase 03 adapters gated on C01, C02, C08 FROZEN rows).

---

## 8. Important code / pseudocode (illustrative only — do not copy into prod)

### 8.1 Evidence-ledger record schema (one file per suite and hypothesis; JSON shown, Markdown equivalent acceptable)

```jsonc
// ILLUSTRATIVE — shape of baseline-v1 records, not a prod type.
{
  "record": "suite-result | hypothesis-verdict | topology-fact | fixture-entry",
  "id": "WP00-suite-go-unit | H1-sat-v2-divergence | TOPO-worker-separation",
  "contractVersion": null,
  "candidate": {
    "gitSha": "<40-hex>",
    "dirtyHash": "<sha-of-diff | clean>",
    "openapiVersion": "1.0.0",
    "schemaHead": "0058_authoring_operation_keys",
    "configFingerprint": "<sha-of-redacted-env>",
    "lockfiles": { "npm": "<sha>", "goSum": "<sha>" }
  },
  "procedure": { "command": "cd backend/go && go test -count=1 ./...", "env": "local, no creds" },
  "observed": "PASS 212 / FAIL 3 / SKIP 1 — see logs/03-go-unit.log:412-447",
  "classification": "PRE-EXISTING-FAIL | SKIPPED-BY-DESIGN | BLOCKED-NO-ENV | FLAKY | PASS",
  "verdict": "CONFIRMED | ALREADY-FIXED | NOT-REPRODUCED | ENV-DEPENDENT",
  "evidence": ["file:line", "log path + line range"],
  "residualRisk": "what remains unknown and who owns it next",
  "rollback": "n/a (read-only phase)"
}
```

### 8.2 Contract version record (header every Cxx doc carries)

```yaml
# ILLUSTRATIVE — paste at the top of each contracts-v1/Cxx-*.md
contract: C02-durable-write-replay
version: v1.0.0-baseline
status: FROZEN
date: <YYYY-MM-DD>
source: { gitSha: <sha12>, dirty: <hash|clean>, openapi: 1.0.0, schemaHead: "0058_..." }
wireTruth:
  - field: acknowledgements
    internalAlias: acks
    type: array<object>
    observedIn: backend/go/internal/attempts/outcome_wire_test.go:XX + live probe log
transitions: [issued -> in-flight -> acked | pending-retry | quarantined]
errors: [{ wire: SUBMISSION_ID_MISUSE, http: 409, envelope: "{code,message,details?,requestId}" }]
retryOwner: durability-engine
compat: { supports: [client>=N with server>=M], window: "<N days/releases>", rollbackPairsWith: "<binary+schema>" }
supersedes: null
openPolicyQuestions: [C09-revocation-bound-approval]
```

### 8.3 AC skeleton example — Vitest (AC01 readiness barrier; illustrative)

```ts
// ILLUSTRATIVE — acceptance-v1/skeletons/ac01-readiness-barrier.skeleton.test.ts
import { describe, expect, it } from "vitest";

describe("AC01: type-before-bootstrap resolves; older snapshot never clobbers newer intent", () => {
  it("preserves pre-seed input and ordering after authoritative hydration", async () => {
    // Arrange: controller with readiness barrier; input "B" typed before seed arrives.
    // Seed fixture: acceptance-v1/fixtures/sat-v2-only-basic.json (sanitized).
    // Act: emit local intent (version 7), deliver authoritative snapshot (version 5), release barrier.
    // Assert: visible answer is "B", order preserved, no ack claimed before server ack (C02 v1).
    expect(true).toBe(true); // REPLACE with controller wiring during Step 13 — never ship as pass-through.
  });
});
```

### 8.4 AC skeleton example — Go (AC03 lost-ack replay; illustrative, DB-gated)

```go
// ILLUSTRATIVE — backend/go/internal/attempts/ac03_lost_ack_replay_skeleton_test.go
package attempts

import "testing"

// AC03: identical retry after committed batch + dropped ack gives compatible ack, no duplicate mutation.
// Requires disposable MySQL (TEST_MYSQL_DSN); reports NOT RUN when absent — never PASS-by-skip.
func TestAC03LostAckIdenticalRetrySkeleton(t *testing.T) {
  t.Skip("skeleton: wire to disposable DB + committed-batch fixture in Step 13")
}
```

---

## 9. Data / state flow

1. **Baseline flow (WP00):** clean checkout, identity capture (Step 1), topology enumeration (Step 2), suite runs with raw logs (Step 3), hypothesis probes H1–H7 (Steps 4–7), sanitized fixtures + C09 proposal (Step 8). All output lands in `baseline-v1/`; raw bytes in `logs/`; nothing flows to prod.
2. **Freeze flow (WP01):** observed behavior (baseline-v1 + live serialization probes), C01, C02, C03 first, then C04–C07, then C08 + C09 proposal, then authority matrix, then AC matrix, then skeletons, then approval list, then versioned freeze. Consumers read only the frozen docs; any correction is a new version, never an overwrite.
3. **State discipline:** baseline records are append-only within v1; post-freeze edits create v2 directories. Contract docs carry the candidate identity (sha + schema head + openapi version) so Phase 07 can prove the released candidate is the reviewed candidate.
4. **Fixture flow:** sanitized seeds (`acceptance-v1/fixtures`) are referenced by C01, C02, C08 examples and by every AC row, then consumed read-only by later-phase tests (disposable DB, jsdom, Playwright). No fixture ever contains PII, secrets, or prod rows.

---

## 10. Edge cases

1. **Stale tests that contradict the frozen contract** — resolve against the contract (source section 7 rule); record the conflict in H7; do not fix tests or implementation here. Owner: Phase 06.
2. **Env-dependent repros** (no local MySQL, browsers, or GPU-heavy a11y) — mark verdict ENV-DEPENDENT + BLOCKED-NO-ENV with the exact enabling command (`TEST_MYSQL_DSN=... go test ./integration/ -v -count=1`); independent steps continue.
3. **Missing creds and prod-only configs** — block only dependent checks; independent recording continues (WP00 failure policy). Never embed, request, or log secrets.
4. **Dirty tree at freeze time** — freeze records dirty hashes per file; prefer a clean tree but never block the phase on unrelated uncommitted work — record and isolate.
5. **Migration-head drift** (new file beyond 0058 lands mid-phase) — re-count live, record the new head, note which records cited the old head; never assume `0059`.
6. **Moved or renamed symbols** (for example `handlers_v2.go`, `useSatExamController.ts`, `app.go` paths) — glob, record the true path, keep going; file the rename in the index so later phases do not re-search.
7. **POST and 304 and zero-SQL verdicts that surprise consumers** — record observed bytes and measurements even when inconvenient; file the compatible path as proposal; Phase 04 owns the repair.
8. **Throughput numbers quoted as capacity** — every figure gets a GOAL or MEASURED tag; untagged numbers are treated as GOAL.
9. **Large evidence logs** — keep raw logs verbatim in `logs/`; the Markdown docs cite line ranges, never paste secrets or full PII-adjacent rows.
10. **Skeleton that cannot run locally** — explicit `NOT RUN (needs <env>)` + command; a skipped critical skeleton is a release-blocker flag, not a pass (source WP13 rule).

---

## 11. Errors

| # | Error / failure mode | Handling in this phase |
|---|---|---|
| E1 | Pre-existing suite failure (TS, Go, lint, build) | Log verbatim; classify PRE-EXISTING-FAIL with test + assertion + log lines; do not repair (repair belongs to owner phases via failing-behavioral-test protocol) |
| E2 | Skipped, DB-gated, or browser-gated check | Classify SKIPPED-BY-DESIGN or BLOCKED-NO-ENV with enabling command; never count as PASS; carry as explicit gate debt to Phase 06 and 07 |
| E3 | Flaky test | Rerun x3 with seeds where supported; record FLAKY + owner + remediation-deadline pointer (Phase 06 policy); do not hide behind retries |
| E4 | Hypothesis NOT-REPRODUCED | Record fixture + command + tree identity; keep the guard test (skeleton) so later phases cannot regress silently |
| E5 | Hypothesis CONFIRMED (real divergence or bug) | Record minimal repro + fixture; file failing skeleton; hand to owner phase — do not patch here |
| E6 | Env or credential absence | BLOCKED-NO-ENV for that check only; rest of phase proceeds |
| E7 | Secret, answer, or PII discovered in evidence | Redact immediately, re-hash the redacted file, note the redaction in the index; telemetry-redaction finding goes to C04, C07 + Phase 04 |
| E8 | Contract ambiguity found mid-freeze | Freeze the observed behavior + file the question in `product-decisions-needing-approval.md`; never silently pick the convenient semantics |
| E9 | Post-freeze contract correction needed | New version (v1.0.1 clarification, v1.1.0 additive, or v2 breaking proposal); notify producer and consumer owners; re-sign the index |
| E10 | Accidental prod mutation risk (wrong DSN, prod-named script) | Stop, verify target (`echo $TEST_MYSQL_DSN`, read script + config it loads), use disposable or local only; record the near-miss if one occurs |

Ledger statuses allowed: `PASS`, `FAIL`, `NOT RUN`, `BLOCKED` (plus the classifications above). A skipped critical test is NOT RUN — never PASS.

---

## 12. Performance / security concerns (read-only phase — do no harm)

- **No prod mutation:** no migration execution, no data repair, deletion, or backfill, no prod load (k6 `prod-*` scripts are inventoried, never executed against prod), no deployment. Local and disposable targets only; verify DSN and URL before every DB-touching command.
- **No secrets in evidence:** redacted config fingerprints only (hash of redacted file, never values); grep scan before freeze; Playwright and global-setup env files are read for *names*, never pasted with values.
- **No live students as fixtures:** all seeds sanitized + deterministic (fixed clocks, seeded RNG); negative-authz fixtures use synthetic IDs; media and calculator payloads are synthetic and bounded.
- **No weakening:** no timeout increases, no assertion weakening, no auth or fence bypasses, no silent pending-work drops — even to make the baseline green. Red is recorded, not repaired, here.
- **Measurement honesty:** SQL-per-poll includes auth and session touch; fast-lane hints are not called delivery guarantees; capacity figures are GOAL until measured under frozen C09 (Phases 06 and 07).
- **PII and telemetry hygiene:** record current redaction posture from `telemetry/*.go` + log schemas; flag unbounded ID-label cardinality and answer, token, and password exposure risks to Phase 04 and 06 without claiming compliance certification.

---

## 13. Tests — AC01–AC20 mapping (fixtures x owners x layers)

Normative scenarios: `docs/optimize.md` section 7. Fixture IDs below are the **sanitized seeds created in Step 8** (under `acceptance-v1/fixtures/`). Layers: E = engine and unit, B = browser and Playwright, DB = Go DB integration, 2P = two-process, CT = contract and serialization, A11y = accessibility, LD = load and traces (Phase 07). Owner = phase that implements the behavior; Phase 07 re-runs all 20 on the integrated candidate.

| ID | Scenario (expected result) | Fixtures | Owner / layers |
|---|---|---|---|
| AC01 | Type before bootstrap resolves; older snapshot released; newer intent + ordering survive | `sat-v2-only-basic`, `ielts-objective-basic`, `stale-snapshot-v5-vs-intent-v7` | Phase 03; E+B |
| AC02 | Storage denied or quota during editing; no false local or server-save claim; in-memory intent preserved + recovery limits shown | `storage-denied-quota`, `ielts-writing-draft` | Phase 03 (+09 UI states); B with storage faults |
| AC03 | Committed batch + dropped ack; identical retry gives compatible ack, no duplicate mutation, payload unchanged | `committed-batch-no-ack`, `same-id-same-bytes`, `same-id-diff-bytes` | Phases 02, 03, 04-contract; DB+CT |
| AC04 | Offline reload with checkpoint and journal + delayed async storage; ordered pending recovery, no fabricated ack status | `journal-checkpoint-v3`, `delayed-storage-profile` | Phase 03; E+B (including mobile browser) |
| AC05 | SAT V2-only answers route to the adaptive branch, score correctly, agree across review and export; pretest and unadministered correct | `sat-v2-only-*`, `sat-mixed-legacy-compat`, `sat-pretest-unadministered` | Phase 02; provider integration + E2E |
| AC06 | IELTS objective + writing-review and ACT science follow approved grading, scoring, and release rules | `ielts-objective-basic`, `ielts-writing-rubric`, `act-science-basic` | Phase 02; service + E2E |
| AC07 | Post-takeover old device + post-pause stale control epoch: no unauthorized writes, no silent pending deletion, distinct recovery paths | `takeover-old-device`, `stale-control-post-pause`, `expired-lease-write` | Phases 03 and 04; race + B |
| AC08 | Submit with blocked or quarantined work or lost receipt: no false complete screen; recovery choices + stable idempotency identity retained | `quarantined-blocked-submit`, `lost-receipt-response` | Phases 03 and 04-contract; integration + B |
| AC09 | Student submit races proctor terminate or deadline worker gives exactly one compatible terminal outcome; loser rejected without overwrite | `submit-vs-terminate-race`, `deadline-vs-submit-race` | Phase 04 (needs C03 + WP02); real-DB barrier tests |
| AC10 | Fan-out with success + transient + poison: every unfinished attempt durably owned; eventually completed or dead-lettered | `fanout-mixed-outcomes`, `poison-attempt` | Phase 04 (worker); crash and retry integration |
| AC11 | Kill worker after SAT provisional; restart; reconcile to final seal and result; API observes without shared memory | `sat-provisional-abandoned` | Phases 04 and 07-runtime; 2P integration |
| AC12 | Publish new draft mid-attempt; content, key, and scoring inputs + released snapshot stay pinned | `mid-exam-draft-publish`, `key-revision-bump` | Phases 01-pin-rule and 02; integration |
| AC13 | Cross-user, org, and assignment + bad entry codes: denied, no leak, no admission writes; cache cannot bypass revocation | `cross-user-ids`, `bad-entry-codes`, `revoked-session` | Phase 04; negative API tests |
| AC14 | CSRF, origin, body, malformed, expired-bearer, and rate-limit keep exact status + envelope; no blind retry storm | `malformed-bodies`, `expired-bearer`, `rate-limited-burst` | Phases 04 and 06-contract; CT+B |
| AC15 | Conditional reads on new GET + compatible old POST return correct status and body; auth, redaction, version-keys, refresh correct | `bootstrap-etag-variants`, `old-post-compat` | Phase 04 (WP06); HTTP + consumer interop (old and new x new and old) |
| AC16 | Worker command, event loss, stale cache, or sleeping poll: UI reaches authoritative state within C05 bound; writes enforce immediately | `event-loss-profile`, `stale-cache-entry`, `sleeping-poll-hint-miss` | Phase 04-runtime; 2P + B |
| AC17 | Timer ticks, overlays, IME, keyboard, focus, selection, undo, question switching: no lost edits, clock behavior intact | `ime-composition-session`, `overlay-timer-session`, `focus-undo-session` | Phases 03, 08, 09; B+A11y |
| AC18 | Interrupted migration rerun + retention boundary + scratch restore preserve replay, terminal, and result invariants; meet RPO and RTO | `retention-boundary-rows` + existing migration fault harness | Phase 05 (WP12); migration + restore |
| AC19 | Representative device and load within interaction, API, and resource budgets; backlog returns to baseline after storm | C09 profile + `storm-submit-burst` | Phases 08, 10, 11, 14; traces + load (staging) |
| AC20 | Large export or unavailable media and calculator: cancelable, recoverable, no frozen active work, no leak, no persisted-state corruption | `large-export-payload`, `media-unavailable`, `calculator-failure` | Phases 04 and 09; B + service |

Discriminating-design coverage (source section 7, wired into skeletons): both race winners; clock boundaries (deadline, grace, pause, resume, extension, background-throttle, stale-offset); ID, payload, and epoch matrix (same-ID and same-payload, same-ID and diff-payload, diff-ID and same-version, stale lease, stale control, terminal replay); key, blank, not-administered, pretest, invalidated, pending versus true-incorrect; old-to-new interop; valid + invalid ownership fixtures. Stale expectations never overrule the frozen contract.

**Product decisions needing approval** (tracked in `product-decisions-needing-approval.md`; NOT decided here): scoring policy versions, admission policy (invite versus link windows), data-retention windows, RPO and RTO, SLO and threshold values (availability, freshness bound, queue-age and drain), supported device and browser list, release and rollback policy, any timing or grading-permission change.

---

## 14. Verification commands (confirm-then-run; never run prod-targeting scripts by name alone)

```bash
# 0) Confirm working tree + toolchain (Step 1)
git rev-parse HEAD && git status --porcelain
go version && node --version && npm --version && npx tsc --version
ls backend/go/migrations | tail -n 5   # expect 0058_* head; re-count live

# 1) Frontend safe suites (Step 3) — scripts confirmed in package.json
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run test:run    # vitest run (jsdom; excludes e2e/dist)
npm run build       # vite build

# 2) Go safe suites (Step 3) — mirrors .github/workflows/ci.yml go-backend job
cd backend/go
gofmt -l .
go vet ./...
go test -count=1 ./...
go build ./cmd/api ./cmd/worker ./cmd/migrate
go run ./cmd/migrate --validate-only
npx --yes @redocly/cli lint ../../api/openapi/openapi.yaml
TEST_MYSQL_DSN="<disposable-local-dsn>" go test ./integration/ -v -count=1   # ONLY disposable/local; never prod

# 3) Hypothesis probes (Steps 4-7) — focused, read-mostly
go test ./internal/assessscore/ ./internal/sat/ -run "V2|Scoring|Edge" -count=1 -v
go test ./internal/attempts/ -run "Wire|Envelope|Fenc|Replay|Writab" -count=1 -v
go test ./internal/terminalization/ -run "Seal|Requestid|Concurr" -count=1 -v
go test ./internal/runtime/ ./internal/liveupdates/ -run "Poll|Snapshot|Fence|Admission" -count=1 -v

# 4) Skeletons (Step 13) + secret hygiene (Step 14)
npm run test:run -- <path-to-new-skeleton>
go test ./internal/attempts/ -run "AC03" -count=1 -v
grep -riE "secret|passwd|api[_-]?key|bearer [A-Za-z0-9._-]{10,}" docs/production-hardening/ || echo "evidence-clean"
git status --porcelain   # only docs/production-hardening/** + skeleton tests should be new
```

Never run `k6:*`, `e2e:prod-*`, `e2e:live-*`, or any Playwright config targeting remote or prod without reading its file + confirming an authorized non-prod target. The default Playwright suite boots local API + worker + Vite (see `playwright.config.ts` webServer) — that is the only browser harness this phase may use, and only for AC skeleton bring-up.

---

## 15. Completion checklist

- [ ] `baseline-v1/01-source-identity.md`: revision, dirty hashes, toolchain versions, lockfile hashes recorded; second engineer can reproduce.
- [ ] `baseline-v1/02-topology.md`: API and worker processes proven separate, DB version, migration head (live-counted), flags with defaults, browser matrix (approval status marked).
- [ ] `baseline-v1/03-suite-results.md`: typecheck, lint, unit, Go, build + OpenAPI lint + migrate-validate run with raw logs; every failure classified (pre-existing, skipped, blocked, flaky).
- [ ] `baseline-v1/04-hypothesis-inventory.md`: H1 (SAT V2 and legacy), H2 (POST and 304), H3 (zero-SQL scope), H4 (throughput goals), H5 (flags, resources, RPO, RTO, devices, release unconfirmed), H6 (stale tests, lines, counts) each verdict-tagged with file and line + log evidence.
- [ ] `baseline-v1/05-fixture-catalog.md` + `acceptance-v1/fixtures/`: sanitized IELTS, SAT-adaptive, ACT seeds covering every AC; no PII, secrets, or prod rows.
- [ ] `baseline-v1/06-c09-profile-proposal.md`: workload, resources, flags, devices, networks, candidate gates with measurement boundaries; marked PROPOSED-PENDING-APPROVAL.
- [ ] `contracts-v1/C01–C09` FROZEN (C09 = frozen proposal + open approval rows) with wire fields, transitions, codes, compat windows, rollback pairs; `00-contract-index.md` signed by L0 + contract owner.
- [ ] `authority-matrix.md`: start, pause, resume, extension, SAT provisional versus final, result release + repair, grading permissions, invalidation — each row cites its contract.
- [ ] `acceptance-v1/AC-matrix.md`: AC01–AC20 each with assertions, fixture IDs, owning phase, layers, environment.
- [ ] Executable skeletons run in CI-picked suites; none counted PASS-by-skip; env-gated ones say NOT RUN + enabling command.
- [ ] `product-decisions-needing-approval.md`: scoring, admission, retention, RPO, RTO, SLO, device, release items with approver + date-open rows.
- [ ] Evidence secret-scan clean; freeze table (versions + hashes) recorded; handoff packet (section 16) delivered to Phase 02, 03, and 04 owners.

---

## 16. Handoff to Phases 02 / 03 / 04 (exact artifacts + versions consumed)

**Frozen package (cite versions in every downstream worker prompt):**

| Artifact | Version | Consumer | Consumes what |
|---|---|---|---|
| `docs/production-hardening/contracts-v1/C01-response-ownership.md` | C01 v1.0.0-baseline | Phase 02 (WP02), Phase 03 adapters | Authoritative source per provider, key, pin, pretest, and null rules, legacy precedence |
| `.../C02-durable-write-replay.md` | C02 v1.0.0-baseline | Phase 02, Phase 03 | Write and replay identity, ack shape, retry-versus-new-write, forbidden replays |
| `.../C03-terminalization.md` | C03 v1.0.0-baseline | Phase 02 (WP04 needs WP02 + C03) | Provisional and terminal machine, submission-ID ownership, compatibility predicate |
| `.../C04-authorization-caching.md` | C04 v1.0.0-baseline | Phase 04 (WP05) | Role x resource x operation matrix, revocation bound (proposed), admission branches |
| `.../C05-runtime-read-freshness.md` | C05 v1.0.0-baseline | Phase 04 (WP07); read by 02 | Clock authority, ETag and GET path, poll hints, visibility bound (proposed) |
| `.../C06-work-ownership-projection.md` | C06 v1.0.0-baseline | Phase 02 (WP04) | Job identity, lease, idempotency, completion, failure classes, recovery commands |
| `.../C07-error-retry-vocabulary.md` | C07 v1.0.0-baseline | Phase 03, Phase 04 (WP06) | Wire codes and envelopes, per-op retry owner, POST and 304 compatible direction |
| `.../C08-client-storage.md` | C08 v1.0.0-baseline | Phase 03 (adapter gate) | Namespaces, milestones, quota and denial, compaction and archive, account-switch, compat |
| `.../C09-workload-slo-profile.md` | C09 v1-proposal (pending approval) | Phases 05, 06, 07 | Workload + resource + gate table; no capacity claimed until measured |
| `.../authority-matrix.md` | v1 | 02, 03, 04 | Start, pause, resume, extension, provisional recovery, release and repair, grading, invalidation |
| `.../acceptance-v1/AC-matrix.md + fixtures/ + skeletons/` | acceptance v1 | All (07 re-runs 01–20) | Per-AC assertions, fixture IDs, owners, layers, environments |
| `.../baseline-v1/` (ledger + logs) | baseline v1 | 05-prep, 06 | Repro points, suite classification, hypothesis verdicts, stale-item exclusions |

**Gating reminders for the Main Agent:** start Phase 03 provider adapters only after C01, C02, C08 rows read FROZEN; sequence 02–04 shared runtime and worker files by the ownership registry (overall-plan section 7); WP12-prep and WP10 and WP13 foundations may start early on the baseline, but permanent thresholds wait for C09 approval; any post-freeze contract edit is a new version that re-gates only its producer and consumer phases.
