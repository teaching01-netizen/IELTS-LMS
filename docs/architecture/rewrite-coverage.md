# Rewrite Coverage Matrix — plan sections to implementation

Tracks every section of `docs/full-plan.md` to its Go/TS location.
Updated as implementation lands. Checked in CI review.

## Backend

| Plan | Topic | Location | Status |
|------|-------|----------|--------|
| 4.1 | One rule, one owner | `backend/go/internal/*/service.go` (mutation→attempts, terminal→terminalization, runtime→runtime, proctor→proctor, science→act, SAT→sat, release→grading) | done |
| 4.2 | Tx boundaries in services | services own `WithTx` (proctor 6+ sites, runtime/sat/attempts/terminalization same shape) | done |
| 4.3 | Explicit SQL | `FOR UPDATE` counts: proctor 16, terminalization 14, sat 7, attempts 7, runtime 6; receipts INSERT-only; conditional claims | done |
| 4.4 | Server authority | DB-time gates, lease/control fencing, server-side ACT/SAT scoring, token-bound clocks | done |
| 5 | Repo layout | `backend/go/` | done |
| 6 | api/worker/migrate | `backend/go/cmd/*` (API delivery 5/5 wired, SAT workbook template, live websocket, V1 compatibility writes, worker jobs, migration lock/checksum, and Go E2E seed/provision tools) | done |
| 7 | Platform layer | `backend/go/internal/platform/*` | done |
| 8 | DI BuildApp | `cmd/api/main.go` BuildApp and route table; frontend audit: no retired durability flag reads; Go mounts `/api/v1` plus canonical `/api/v2` and the `/v2` compatibility alias. All audited frontend wire paths have a live Go handler, including library usage, workbook download, websocket, and V1 drain routes. | done |
| 9 | Context/cancellation | every Service method takes ctx (zero ctx-less entry points) | done |
| 10-11 | HTTP server + middleware | timeouts/body tiers, recovery/request-id/trace/security/body/auth/CSRF/rate-limit/authorization/access-log middleware, and all production handlers wired; the former `notImplemented` helper is unused and no registered route returns 501. | done |
| 12-13 | Error envelope + OpenAPI | Stable `WriteError` envelope plus the versioned route contract; V2 batch/submit/takeover/snapshot, V1 compatibility writes, public entry resolution, authoring workbook/validation, proctor notes/rules, library usage, and websocket routes are represented. Delivery timeout reconciliation is active in the worker and delivery entry points. | done |
| 14-28 | V2 core + write algorithm | `internal/attempts/*` (V2-only gate `!=2` reject, no v1/v2 switch; canonical tables; provider-neutral core; hashing vectors; write algorithm; replay/version/lease/takeover/control/timing/pause/submit-preamble) | done |
| 19 | Hashing vectors | `internal/attempts/service_test.go` (canonical order, digest sorted+stable, known vector) + `writability_test.go` (writability matrix, fencing codes, command-hash) | done |
| 29-33 | IELTS/ACT/SAT completion | `internal/attempts/submit.go` (SAT provisional vs IELTS/ACT seal-first) + `internal/sat` (CompleteAssessment, ReconcileProvisionalBatch 250, repairOne, scoreAndPersist; predicate matches §33 incl. all-modules-terminal; same-path completion, never fake score; 3 concurrency tests) | done |
| 34-40 | Terminalization | `internal/terminalization/*` (single-writer seal, receipt-before-claim, ClaimPredicate w/ provisional OR-branch, repair `submitted_at NOT NULL + receipt missing` never delivery_status alone, trigger-equivalence, 12 tests: seal 5 + outcome/predicate/vocab 7) | done |
| 41-45 | Runtime + proctor + delivery | `internal/runtime`, `internal/proctor`, `internal/delivery`, and `internal/release`: lock/fence rules, session reads, proctor controls plus notes/rules, provider-aware bootstrap/module lifecycle/submit, timeout reconciliation, and release reads. | done |
| 46-49 | Auth/CSRF/roles/scope | `internal/auth` (session+bearer, CSRF 403, 6 roles, ActorContext, org-scope, 12-case matrix + tenant boundary) | done |
| 50-52 | Schema reconciliation | `backend/go/migrations/` canonical 0001..0053, Go migrator lock/checksum/validate-only, TiDB trigger-statement handling, 0051 trigger cleanup, 0052 ACT provider checks, 0053 attempt user-id backfill, and lineage tests. | done |
| 53-54 | DB discipline + tx retry | UTC tz, bounded pool + idle/lifetime, transient-only retry (deadlock/lock-wait/restart-txn/conn-transient) + jitter, no blind terminalization retry | done |
| 55-62 | Outbox/workers/grading | `internal/outbox` (atomic enqueue, lease claim, backoff, 3 tests) + worker (all 10 §57 jobs wired, DB-coordinated leadership) + grading/ACT/SAT (state machine 5, science 6, projection checkpoint) | done |
| 63-67 | Live updates + WS leases | `internal/liveupdates` (DB bus + hub fanout, seq-ordered poll, pre-upgrade authz, DB leases 600/5/600 hb30s, bounded queues + coalesce + slow-disconnect, 15 forward tests) | done |
| 68-73, 140-141 | Observability/health/final-arch | `platform/telemetry` (metric consts + outcome labels + log fields, no high-cardinality IDs; dep-free Prometheus Registry + GET /metrics, 4 tests round 66); emitters: AccessLog http_requests_total/in_flight + readyz db-pool gauges + V2 batch/commands/submit-replay post-tx + terminal created/replay/conflict + repair + worker job/outbox/invariant + WS slow/lease/connections + V1 drain counters (round 71) + lag gauges outbox-oldest/SAT-age/projection (round 72); probes live in `cmd/api/main.go` (healthz liveness no-DB, readyz DB-ping+schema-version); target diagram in `cutover.md` §§140-141; doctrine rule 20 restates §139 (V1 dies with its last attempt) | done |
| 108-114 | Tests + contract union | 53 test funcs: V2 13 (6 concurrency + 4 hash + 3 writability) + terminal 12 (5 seal + 7 predicate) + runtime fence + SAT 3 + grading 5 + ACT 6 + library 3 + answerhistory 1 + outbox 3 + authz 2 + ws-forward + lineage 3; §111 runtime cases via fence matrix; DB-integration + load runs pending env |
| 119-120 | Quality rules | CI gofmt/vet/staticcheck, tsc strict | partial |
| 121-127 | Cutover + V1 retirement | `docs/architecture/cutover.md` (sequence, shadow, single-writer, stages, history, compat, flags) | done |
| 130-131, 140-141 | Change policy + security gates + final arch/doctrine | `docs/architecture/cutover.md` (§§130-131, 140-141) | done |
| 128-129 | Runbooks + backup/restore | `docs/runbooks/*` (13 required + backup-restore rehearsal) | done |
| 132-133 | SLOs + alerting | `docs/architecture/alerting.md` (page vs dashboard) | done |
| 134-135 | Review checklists | `docs/architecture/review-checklists.md` (backend+frontend) | done |
| 137-139 | Definition of Done | `docs/architecture/definition-of-done.md` (evidenced checkboxes) | done, V1-removal all open by design |
| 115 | Visual regression | `docs/architecture/visual-regression.md` (baselines+method, run pending API) | done |
| 116-117 | Load + failure testing | `docs/architecture/load-and-failure-testing.md` (k6 remap + failure matrix) | done, runs pending API |
| 136 | ADRs | `docs/adr/ADR-*.md` (10 expanded) | done |
| 50-52 | Library + answer-history | `internal/library` (14 CRUD/defaults/profile methods + 3 tests) + `internal/answerhistory` (overview/detail/export projections + validation test) | done |

## Frontend

| Plan | Topic | Location | Status |
|------|-------|----------|--------|
| 74-78 | Feature/ports architecture | `src/features/student-attempt/*` (exact §76 layout; UI→hooks→ports→adapters→client/IDB; component rules; 4 state categories; 10 invariant tests green) | done |
| 79-87 | V2 local durability | invariant (visible-version, 10 tests) + flow (local-first, receipt-persist) + IDB (crash-recovery fields, expiry) + coalescing (no cross-lease/control/submit) + recovery merge + typed 409s + single-flight submit w/ same-ID retry + SAT provisional UI + network UX | done |
| 88-89 | Student UI preservation | existing components (untouched) | gate |
| 88-89 | Student UI preservation | existing suites as characterization gates (untouched JSX) + ACT science behaviors | gate, suites green |
| 90-94 | Builder union (IELTS/SAT/ACT) | `src/shared/providers.ts` ExamProviderDefinition (ielts/sat/act, no scattered if-branches) + existing shells | done |
| 95-96 | Proctor + grading union | `src/features/proctor/*` (api/application/contracts/hooks/infrastructure/routes) + grading workspace + ACT science reports | done |
| 97-100 | Query layer + gateways + errors | TanStack Query (server state, never answer durability) + api-client (zero direct fetch in features) + error-codes 12-kind taxonomy w/ recovery actions; BE audit round 162: 6 verbatim-shared codes, 6 dead Go consts kept (status-mapped), CSRF_FAILED leak fixed in proctor (CSRF_REJECTED now); 5 same-string status mismatches open (LEASE_FENCED 409->403, NOT_WRITABLE 409->422, PROCTOR_BLOCKED 409->403, DEADLINE 409-reason->422-top, INVALID_RESPONSE 400->422-rename; FE classifies by code so no FE break, but cutover contract must bless the Go statuses) | done |
| 101-107 | A11y/motion/perf/security/content | a11y specs + axe + reduced-motion + budgets + no-secret VITE + sanitize gates (frontend untouched) | gate |
| 114 | Frontend test union | Existing Vitest/Playwright suites plus the V2 durability and ACT Science coverage; the former V2 rollout flag is removed and the canonical engine is exercised directly. |
