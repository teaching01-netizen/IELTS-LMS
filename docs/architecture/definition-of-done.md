# Definition of Done tracker (plan sections 137-139)

Evidence-linked, not aspirational. A box checks only when the cited
artifact exists on the current tree or in a recorded rehearsal. Boxes
that depend on production observation or a running environment stay
open with the reason stated.

## Backend (137)

- [x] Go API serves all production routes - delivery bootstrap, response
  save, module start/submit, assessment submit, authoring (including the SAT
  workbook template and provider-aware validation), proctor notes/rules,
  library usage, live websocket, and V1 mutation/submit compatibility routes
  are wired in `backend/go/cmd/api/main.go`. V1 reads and compatibility
  writes remain only for the measured drain window.
  Round 60: authorUpdateQuestionHandler (sole staticcheck U1000)
  wired as PATCH /exam-questions/{id}; handler mirrors Rust
  save_question (resolve-via-question then update revision).
- [x] Go worker owns all required durable jobs -
  `backend/go/cmd/worker/main.go` hot + slow cycles wired.
- [x] Migrator owns canonical schema -
  `backend/go/cmd/migrate/main.go` with advisory lock, checksum
  verify, and `--validate-only`; lineage tests
  (`cmd/migrate/lineage_test.go`) green.
- [x] All new attempts are V2 - `schedules.ProtocolVersionV2`, V2
  engine rejects non-V2 rows (`attempts/service.go`, `submit.go`).
- [x] IELTS V2 passes - V2 matrix (`attempts/concurrency_test.go`)
  green plus writability matrix.
- [x] SAT V2 passes - SAT matrix (`sat/concurrency_test.go`) green;
  provisional watchdog `ReconcileProvisionalBatch` exists.
- [x] ACT V2 passes - `internal/act` science scoring + results union
  landed (pre-existing; untouched this session).
- [x] SAT provisional watchdog exists - `ReconcileProvisional` +
  `ReconcileModuleTimeouts` + backlog runbook.
- [x] Runtime lock tests pass - `runtime/fence_test.go` green.
- [x] Terminalization invariant tests pass - predicate tests plus
  seal matrix (`seal_concurrency_test.go`) green.
- [x] Migration lineage tests pass - `cmd/migrate/lineage_test.go`
  green; DB-backed lineage stays TEST_MYSQL_DSN-gated.
- [x] Auth/tenant boundary tests pass -
  `auth/authz_test.go` matrix + boundary green.
- [x] Proctor controls pass - service + 12 API routes wired
  (presence, end/extend-section, complete-exam, warn/pause/resume/
  extend/terminate, ack-alert, 2 session reads: ListSessions +
  GetSessionDetail with assignment filter + providerKey gate +
  dashboard limits + degraded overlay, round 119);
  lock-order attempt→runtime→section.
- [x] ACT science scoring passes - `act/scoring_test.go` 6 cases green.
- [x] Grading/results union passes - `grading/state_test.go` 5-case
  matrix green + 16 grading / 6 results routes wired.
- [x] Websocket lease tests pass (subscription-authz half) -
  `liveupdates/forward_test.go` 15-case ShouldForward matrix green;
  DB-backed cap enforcement stays TEST_MYSQL_DSN-gated.
- [ ] Load tests pass - spec written
  (`architecture/load-and-failure-testing.md`); k6 re-runs against
  the Go API not yet recorded.
- [ ] Restore test passes - rehearsal runbook exists
  (`runbooks/backup-restore.md`); no rehearsal yet recorded.
- [x] Observability/runbooks exist - telemetry registry + /metrics +
  full emitter set (HTTP/pool/V2-batch/commands/submit-replay/
  terminal/repair/worker/outbox/SAT-age/projection-lag/WS/V1-drain,
  rounds 66-72) + 14 runbooks in `docs/runbooks/` + alerting spec.

## Frontend (138)

- [x] One canonical React codebase - `features/student-attempt`
  ports architecture landed.
- [x] No production V1 durability path - the frontend uses the V2 response
  durability engine structurally; V1 routes remain only for legacy session
  context, heartbeat, audit, and the backend drain compatibility window.
- [x] No V1/V2 feature toggle - `VITE_USE_V2_DURABILITY_ENGINE` has no
  production reads; the former rollout switch is removed.
- [x] V2 local recovery universal - IndexedDB outbox + recovery
  merge in the landed feature slice.
- [x] Student UI visually unchanged - additive-only rule held; no
  component visuals touched.
- [x] IELTS/SAT/ACT behavior unchanged - no exam-rule or grading
  change made; suites gate.
- [x] Builder/admin-grading/proctor union - providers landed;
  verified round 56: builder FE 90/90, proctor FE 12/12 (round 55),
  grading+answer-history+scheduling FE green, arch gates 8/8 (15 tests),
  BE grading/act/sat/terminalization fresh green.
- [x] Component tests - the existing Vitest suites and the V2 durability
  suites cover the canonical frontend path; no feature flag is required to
  select the engine. Playwright / a11y / visual / bundle remain environment
  gates and are verified separately against the Go runtime.

## V1 removal (139) - production gates remain open

The frontend no longer sends V1 response mutations or V1 submit. The Go API
does retain compatibility handlers for already-running legacy attempts; they
apply idempotent mutation batches and final submissions while the drain is
observed. Production removal still requires the eight retirement gates:
active nonterminal V1 attempts at zero, V1 traffic at zero for the safety
window, rollback readiness, and confirmation that no historical consumer
depends on the compatibility tables.

Reconcile is wired in `internal/delivery/reconcile.go` and is invoked by the
worker and delivery entry points. The remaining deletion manifest is the V1
compatibility handlers, legacy response repository paths, drain counters,
and any legacy-only schema reads after that evidence is recorded. Legacy DB
tables may outlive code regardless.
