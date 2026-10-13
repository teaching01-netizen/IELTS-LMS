# Lean proof and verification report

## Decision

- **Formal status:** PROVED for the named abstract per-section safety theorems below.
- **Correspondence status:** REVIEWED_WITH_TESTS for selected paths; several critical mappings remain UNVERIFIED.
- **Production evidence:** PARTIAL for a disposable local MySQL 9.6.0 profile.
- **Overall production correctness:** **NOT ESTABLISHED**. The writer-lock audit, production database/trigger profile, migration state, cutoff contract, and multi-section refinement remain unresolved.

## Bugs found and fixed in this review

- **Incomplete classroom sequence could pass completion.** The old `satExpectedSequence` accepted a terminal M1-only classroom attempt. It now requires M1 plus exactly the route-selected, plan-admitted branch, or exactly the configured standalone M2 with no route decision. Standard Practice keeps its prior gate. Unit cases cover base-only, branch-only, extra branch, missing decision/module, wrong plan, and standalone shapes.
- **Fixed section plans could be bypassed by an older binary.** Migration 0084 fenced stored route policy, but an old binary could still use score-based adaptive routing when a section's plan was `m1_hard`, or seed M1 for an `m2_hard` standalone plan. Migration 0086 adds database write fences for the immutable plan; a MySQL test rejects both legacy writes and accepts the configured route/entry.
- **Migration 0086's JSON path was initially malformed.** The fresh-schema MySQL test caught the missing dot in the section-key path. The path was corrected and the migration was reapplied to a fresh disposable schema before the final passing test.
- **Migration lineage pin and audit example were stale.** Adding 0086 exposed a lineage test still pinned to 85 files; its count/max are now 86. The migration README's expected ledger endpoint is updated to 0086. `go test ./cmd/migrate -count=1` passes.

## Pin and commands

Repository HEAD at review start: 2c319e59a7de3c15345e8ac575142d9254acb22a. The working tree was already dirty, and this report covers the uncommitted tree; the commit alone does not identify the verified source snapshot. Lean sources and reports are stored in this directory.

SHA-256 pins for the Lean sources, spec, changed SQL/test inputs, and relevant Go paths are in evidence/source-sha256.txt.

Pinned toolchain: leanprover/lean4:v4.19.0; lake-manifest.json has no external packages. On arm64 macOS, lake env lean --version reported Lean 4.19.0, commit 6caaee842e94.

Commands from verification/lean/sat-classroom/:

| Command | Exit | Result |
| --- | ---: | --- |
| lake clean && lake build SatClassroom | 0 | Clean Lake build completed successfully. Transcript: evidence/lean-build.txt. |
| lake env lean proof/AxiomAudit.lean | 0 | Exact statement checks and transitive axiom prints. Transcript: evidence/axioms.txt. |
| lake env leanchecker | 1 | Unavailable: the pinned toolchain has no leanchecker binary. Transcript: evidence/lean4checker.txt. |
| rg -n -e sorry -e admit proof; rg -n '^axiom\b' proof | 1 for each search (no matches) | No sorry/admit use or custom axiom declaration in proof sources. |

The axiom audit found only Lean's standard propext, Classical.choice, and Quot.sound dependencies. corrected_fence_rejects_plan_bypass has no axioms. No custom axiom or sorryAx was accepted. This is a Lean kernel-checked Lake build; the unavailable independent checker is not claimed as passed.

## Theorems checked

- ainv_init, ainv_step, reachable_inv: initiation, preservation for every constructor in the abstract transition relation, and reachable-state invariant.
- t1_decision_stable: an existing route decision stays fixed across one abstract step.
- t2_staff_only: under staff-selects, an opened branch carries a staff decision.
- t3_route_fidelity, t3_plan_fidelity: decision/opened branch and immutable plan agree.
- t4_snapshot: a saved close snapshot equals the model's write list.
- t5_sealed_gate: sealed implies the model's exact single-section completion predicate.
- t6_release: released implies scored and sealed.
- t7_served: served branch is the opened branch.
- g7_standalone: standalone M2 has no M1 or route decision.
- corrected_replay_after_seal: identical staff selection replays after sealing.
- corrected_fence_rejects_plan_bypass: a legacy lower route is refused under an M1-hard plan.
- Reachable witnesses establish that the awaiting-staff state and post-staff sealed state are not vacuous.
- Historical counterexamples show the pre-fix model could auto-route a staff plan, refuse replay after sealing, and let an old adaptive binary bypass a fixed M1-hard plan.

Exact theorem types and axiom output are retained in evidence/axioms.txt.

## Model boundary

The model has one immutable policy and one section plan, with arbitrary attempt indices. It starts from an empty valid state. It abstracts each transition as atomic; the close step snapshots the current list of writes. Mode.current is the historical pre-fix system, not the present working tree. Mode.corrected abstracts the fixes and database fences.

Not modeled: multiple sections inside one global completion gate, malformed/recovered database states, separate SQL read/write steps, lock acquisition, transaction abort/deadlock/retry, process crash, ACK loss/network history, wall-clock deadlines, actual scoring math, HTTP authorization, privacy projection, cache/replica behavior, liveness/fairness, throughput, or production configuration. Consequently, the Lean proof is not a Go/SQL proof and does not establish production correctness.

## Backend verification evidence

The following focused Go checks passed in the working tree:

- go test ./internal/attempts -count=1
- go test ./internal/delivery -run 'TestAssignStaffRoute|TestNextModuleTxStaffSelects|TestNextModuleTxForcedRouteIgnoresModule1Score' -count=1
- go test ./internal/exams -count=1
- go test ./cmd/migrate -count=1
- TEST_MYSQL_DSN='root@unix(/tmp/mysql.sock)/codex_satclass_verify_f30pz09c?parseTime=true' go test ./cmd/api -run '^TestSATClassroom(PlanFenceBlocksLegacyWritesMySQL|StaffRouteRaceMySQL|StaffRouteVsTerminalizationMySQL|GateOffStillFinishesStartedAttemptsMySQL|StaffRouteAcrossAPIBinariesMySQL)$' -count=1

The disposable schema was freshly migrated through 0086_sat_classroom_plan_fence.sql; its ledger contained 86 migrations and the expected 0084/0086 triggers. It ran MySQL 9.6.0 and was dropped after testing. The database is not production evidence. No full repository suite, multi-instance load/soak, production failover, or production DB configuration was verified.
