# Proof report — live SAT settings

## Kernel result

| Item | Result |
| --- | --- |
| Toolchain | Lean 4.19.0 / Lake 5.0.0-6caaee8 (pinned `lean-toolchain`) |
| Command | `elan run leanprover/lean4:v4.19.0 lake build Model Safety Counterexamples AxiomAudit` |
| Exit | 0 |
| Axiom audit | `lake env lean proof/AxiomAudit.lean`, exit 0 |
| Axioms | only `propext`, `Quot.sound`, or none; no `sorryAx`, no `Classical.choice` on the exported statements |
| Artifacts | `evidence/build.txt`, `evidence/axioms.txt` |

Verdict: **PROVED (scoped)** for the model in `SPEC.md`. The kernel result is
not a proof of the Go/SQL implementation or of deployment behavior.

## Implementation evidence

| Gate | Command | Result |
| --- | --- | --- |
| Go unit/integration | `go test -count=1 ./internal/satlearning ./internal/exams ./internal/schedules ./internal/delivery ./internal/results ./internal/terminalization ./internal/authz ./cmd/api ./cmd/migrate` | PASS (`evidence/go-tests.txt`) |
| MySQL fan-out, scope, race | `TEST_MYSQL_DSN=… go test ./cmd/api ./internal/schedules -run 'TestSatExam|TestSatRoomPolicyAbsentRow|TestSATPracticeRetakeMySQL'` | PASS on MySQL 9.6.0 (`evidence/mysql-tests.txt`) |
| Migration lineage | `go run ./cmd/migrate` from empty, then `--validate-only` | applied through 0133; validate-only clean |
| Typecheck | `bun run typecheck` | PASS |
| Production build | `bun run build` | PASS |
| Feature suites | `bunx vitest run src/features/student-delivery src/products/sat/classrooms src/features/exam-authoring/ui/release` | 1740 passed, 4 failed (both pre-existing calculator tests; reproduced at the base commit) |
| Full suite | `bun run test:run` | 7908 passed, 12 failed; all 12 reproduce at base (`load-runner`, calculator/floating, two SAT route/copy tests, selection breaker, two architecture tests) |
| Browser, feature | `playwright.sat-live-settings.config.ts`, chromium, workers=1 | 2 passed (`evidence/browser.txt`) |
| Browser, regression | `playwright.sat-room-retakes.config.ts`, chromium, workers=1 | 2 passed (`evidence/browser.txt`) |

## Counterexample traces

`Counterexamples.lean` proves the failure modes exist without each guard:
defaults-only save, unfenced duplicate write, stale client restoration, and
post-revocation serving of a prepared keyed export. `TRACEABILITY.md` names the
production guard for each one.

## Known gaps

* The held-response browser trace for SAT-4 (release an older result response
  after a revocation on a reconnected tab) is unit-tested but not yet recorded
  in a browser.
* Pause revocation was exercised in the browser; the full Playwright suite with
  two API instances and production-like read routing was not.
* `classroomPendingSQL`'s repair path was changed and compiled, but no real-MySQL
  test submits while results are off and then asserts the repair releases the
  pending report. This is a remaining obligation.
* Commit-to-observation p50/p95/p99 was not measured. The foreground poll is
  3 seconds; the product target is a p95 under 5 seconds.
* Railway migration head, replica count, cache/read routing, and representative
  load remain unverified.
* Pre-existing full-suite failures (12) and the `platform/db` schema guard
  failure (`RequiredTables = 19 entries, want 17`) are unrelated to this
  change and reproduce at `e10825b0`.

## Reproduction

```bash
cd verification/lean/sat-live-settings
elan run leanprover/lean4:v4.19.0 lake build Model Safety Counterexamples AxiomAudit
elan run leanprover/lean4:v4.19.0 lake env lean proof/AxiomAudit.lean

cd ../../../backend/go
go test -count=1 ./internal/satlearning ./internal/exams ./internal/schedules \
  ./internal/delivery ./internal/results ./internal/terminalization ./internal/authz \
  ./cmd/api ./cmd/migrate

cd .. && cd ..
bun run typecheck
bun run build
```
