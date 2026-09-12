# Phase 01 — Measurement & Acceptance Baseline

## 1. Objective
Establish the quantitative baseline and acceptance gate for the authoring read-path optimization. No production behavior changes in this phase. Output: reproducible benchmark harness + recorded baseline numbers + locked AT acceptance matrix that Phases 02-05 must satisfy.

Depends on: overall-plan.md. Blocks: Phase 02, 03, 04, 05 implementation.

## 2. Dependencies
- Read-only access to: backend/go/internal/authoring/service.go (Shell 374, OpenShell 404, Preview 649, loaders 1694-1802), readiness.go:108-207, delivery/service.go:393-523, cmd/api/main.go:150-210/424-446, authoring_authorization.go, src/features/exam-authoring/api/assessmentQueries.ts:24-29.
- Existing tests: delivery/versioncache_test.go, cachedsections_test.go, cmd/api/contracts_mysql_test.go, authoring/service_test.go.
- A MySQL-compatible test/staging DB with a full SAT fixture (2 sections, 6 modules, RW×27 + Math×22 = ~150 questions).

## 3. Behavioral contract (what Phase 01 locks)
- Shell JSON shape unchanged (examId/providerKey/versionId/versionRevision/sections[].modules[].questions[] + routingPolicy).
- Preview JSON shape unchanged and answer-redacted (delivery.DeliverySection projection).
- Auth matrix unchanged: GET shell/preview/template/undo + POST validate = admin/observer/builder; mutating routes = admin/builder; builder tenant-scoped via Exams.GetForActor.
- Performance claim format: p50/p95/p99 + query count + pool/lock wait, measured on identical fixture + concurrency, before vs after.

## 4. ATDD acceptance scenarios (locked here, verified in Phase 05)
| ID | Scenario | Verification |
| AT-01 | Full SAT shell returns byte-equivalent sections/modules/questions/ordering/readiness vs baseline | fixture diff test |
| AT-02 | Preview returns delivery projection without answer_definition/correct keys | redaction test |
| AT-03 | Observer can GET shell/preview, denied POST shell/mutations | authz matrix test |
| AT-04 | Builder of org A denied exam of org B (read + write) | tenant isolation test |
| AT-05 | Concurrent save during shell read never returns mixed-revision tree | consistency test |
| AT-06 | POST /shell with existing draft does not clone; without draft clones once under concurrency | idempotency/CAS test |
| AT-07 | p95 shell+preview latency improves vs baseline at N=1 and N=50 concurrent staff | benchmark gate |

## 5. Change-surface map
- ADD: benchmark harness + fixture seeder + baseline report (new files, test-only).
- VERIFY: Shell/Preview/loaders/authz/frontend query path (no prod change).
- N/A: workbook commit/undo, scoring, migrations, Redis.

## 6. Detailed TODOs
### 6.1 Fixture & harness
- [ ] 1.1 Build deterministic SAT fixture seeder (test-only): exam_entities (provider sat) + draft exam_versions rev R + 2 sections + 6 modules (rw-m1/rw-m2-lower/rw-m2-higher/math-m1/math-m2-lower/math-m2-higher) + routing policies + ~150 exam_questions + revisions with representative JSON sizes (plain + rich + image-metadata variants).
  - Before: no reproducible full-size fixture. After: one command seeds identical dataset. Deps: none. Failure: seeder must be idempotent or clean-before-seed. Verify: row counts asserted.
- [ ] 1.2 Add read-path benchmark script (test-only): measures wall latency + SELECT count (via sql proxy/log or test DB general_log sampling) + pool stats for: GET shell, POST shell (draft exists), GET preview, at concurrency 1/10/50.
  - Before: ad-hoc claims. After: repeatable numbers. Verify: 3 consecutive runs within documented variance.
### 6.2 Baseline capture
- [ ] 1.3 Record baseline: p50/p95/p99, mean, query counts (expect ~13 shell + ~9 preview service SELECTs + authz overhead), slow-query log excerpts, EXPLAIN for the 4 hot SELECT patterns.
- [ ] 1.4 Profile summary CPU: time row.summary() over full fixture; count json.Unmarshal/Marshal calls per question.
- [ ] 1.5 Record frontend behavior: confirm useAuthoringShell triggers POST /shell on mount+refetch (devtools HAR or test spy).
### 6.3 Lock acceptance
- [ ] 1.6 Freeze AT-01..AT-07 thresholds (e.g. "p95 shell at N=50 must not regress; target improve ≥20% — adjust to measured baseline").
- [ ] 1.7 Add contract snapshot test (shell+preview golden JSON for fixture) BEFORE optimization so Phase 03 has a regression oracle.

## 7. File plan
- ADD plans/authoring-read-perf/baseline-report.md (numbers + EXPLAIN + variance).
- ADD backend/go/internal/authoring/readperf_bench_test.go (or scripts/authoring-read-bench/) — test-only harness; must not ship in prod binary paths.
- ADD fixture seeder under backend/go/internal/authoring/testdata/ or e2e helper (reuse existing seed patterns; do not duplicate a second seeder if one exists — verify first).
- VERIFY (read-only): files listed in §2.

## 8. Error/edge matrix
| Condition | Expected | Test |
| Empty draft (no sections) | shell with sections:[] ; preview sections:[] | AT-01 variant |
| Missing draft pointer | 404 Draft version not found | existing tests |
| Non-sat provider | 422 provider not supported | existing tests |
| Revision flap mid-read | consistent snapshot OR documented conflict, never mixed tree | AT-05 |

## 9. Test strategy
- Benchmark (not unit): latency + query count. Snapshot: golden JSON. Authz: existing matrix + AT-03/04. No prod code coverage games.

## 10. Observability
- Define Phase-05 metrics now: handler latency histogram (route, method), db query count per request (test-only), version-cache hit/miss (existing telemetry.MVersionCacheHit/Miss), pool wait. No prod telemetry changes in Phase 01.

## 11. Rollout/rollback
- No prod deploy. Baseline report is the gate: do not start Phase 02 until variance is understood and golden snapshots pass on current code.

## 12. Definition of done
- [ ] Fixture + bench runnable by a second engineer with one command.
- [ ] baseline-report.md contains p50/p95/p99 @ N=1/10/50, query counts, EXPLAINs, CPU profile note.
- [ ] Golden snapshot tests pass on unmodified code.
- [ ] AT-01..AT-07 frozen with numeric thresholds.
