# Verification target

SAT Internal automatic versioning and one-action room creation, as specified in `docs/SAT_Internal_Auto_Version_Create_Room_Implementation.md`. Verification date: **2026-10-14 (Asia/Bangkok)**.

## Critical guarantees

The checked model establishes at-most-one effect per actor/key, atomic creation-ledger receipt/schedule correspondence, matching release payload and scope coverage, preserved historical version pins under ordinary modeled actions, required revision fences, and rejection of stale preflight sealing. Same-key abstract replay has no additional effect; a different body cannot replay.

## Scope / production assumptions

The model's database commit is atomic under explicitly inventoried assumptions. This is a theorem about an operational model, not verification of Go, TypeScript, SQL, MySQL, Hocuspocus or deployed infrastructure. `ASSUMPTIONS.md`, `SPEC.md` and `TRACEABILITY.md` define the boundary.

| Status field | Verdict |
|---|---|
| Formal status | **PROVED** for the 25 named, audited Lean theorems, including safety helpers, non-vacuity examples and counterexample lemmas. Full specification: **INCOMPLETE**. |
| Correspondence status | **REVIEWED_WITH_TESTS** for the tested coordinator/recovery boundaries; overall refinement **UNVERIFIED**, with release-reuse **MISMATCH**. No mechanized implementation correspondence. |
| Production evidence | **PARTIAL**: one local MySQL profile and mocked browser transport. Deployed faults/load/fleet: **NOT_TESTED**. |
| Readiness | **BLOCKED** for the full specification/deployment claim. **Production correctness: NOT ESTABLISHED.** |

Blockers: fingerprint/equal-scope policy remains inconsistent with the documented implementation; DB/coedit/asset/authorization/deployment assumptions are unverified; no multi-instance crash/failover/soak evidence or conditional liveness proof. Exact response replay also has an explicit exception for pre-0089 NULL snapshots.

## Reproducible source and toolchain

- HEAD: `b0be8c0e246fc8bb4d71a6bcb9d050ab32c93810`. This repository already had extensive uncommitted implementation changes. **HEAD alone is not the checked source.** Exact working-tree input/dependency SHA-256 values are in [source-snapshot.json](evidence/source-snapshot.json).
- Lean: `leanprover/lean4:v4.19.0`, arm64 macOS, Lean commit `6caaee842e94`; Lake 5.0.0. The `lean-toolchain`, `lakefile.toml` and dependency-free `lake-manifest.json` are retained.
- Go 1.26.3, Bun 1.3.14, Node 26.0.0. Actual versions and Lean/Lake executable hashes: [toolchain.json](evidence/toolchain.json).
- DB: local MySQL 9.6.0, InnoDB tables, runner REPEATABLE READ; observed flush-at-commit=1 and sync-binlog=1. This is not the supported production MySQL 8.4 deployment profile. [Environment metadata](evidence/environment.txt).

## Requirement / theorem / implementation map

The complete requirement-to-theorem table and exact function anchors are in [TRACEABILITY.md](TRACEABILITY.md). Production state, transitions and scope interpretation are in [SPEC.md](SPEC.md).

Proof source:

- [proof/Model.lean](proof/Model.lean): unbounded actor/key types; separate durable room/receipt/schedule/count/release maps; pending requests, preflight and ACK state; initiation, nondeterministic steps and reachability.
- [proof/Safety.lean](proof/Safety.lean): initiation/consecution/reachability induction, release preservation, at-most-once effects, atomic creation ledger, pin preservation, request identity/fences and preflight safety.
- [proof/Counterexamples.lean](proof/Counterexamples.lean): scope mismatch, clone-reuse ceiling, pre-fix omitted-fence/live-replay/client-remount abstractions, a reachable seal/crash/retry/ACK trace, and a permanent-abort counter-run.
- [proof/AxiomAudit.lean](proof/AxiomAudit.lean): theorem statements and transitive axiom audits. The root imports every proof module; none is left outside the Lake build.

`Selection.publish` overapproximates release choice: a valid frozen/preflight-matching draft may seal even where the actual policy would reuse. This strengthens the safety check over additional interleavings; it cannot establish minimal release creation or fingerprint uniqueness. `RequiredFences` was added to new modeled commits when the implementation fix made fences mandatory. The omitted-fence lemma demonstrates the old raw optional predicate, not an enabled unfenced transition in the corrected model.

## Proof tool output

Run all Lean commands from `verification/lean/sat-auto-room` so the pinned toolchain is selected. No global default toolchain was changed.

| Command | Exit | Evidence |
|---|---:|---|
| `lake build` | 0 | [lean-build.txt](evidence/lean-build.txt): all five proof/root targets built, `Build completed successfully.` |
| `lake env lean proof/AxiomAudit.lean` | 0 | [lean-axiom-audit.txt](evidence/lean-axiom-audit.txt) |
| `lake env lean --run Replay.lean proof.Model proof.Safety proof.Counterexamples` | 0 | [kernel-replay.txt](evidence/kernel-replay.txt) |

The additional replay checker, reused from the repository's `sat-result/Replay.lean`, rejects its deliberately forged proof of False. It rechecks all 69 Model, 21 Safety and 22 Counterexamples theorem declarations, including compiler-generated declarations. Unsafe/partial compiler auxiliaries are excluded; safe undeclared axioms in those modules: `[]`. This uses the same Lean kernel in a fresh environment, **not an independent checker implementation**. A third-party leanchecker was not run.

All 25 named theorem dependency chains use only the permitted standard logical axioms `propext` and `Quot.sound`, or no axioms. See [axiom-policy.json](evidence/axiom-policy.json). No `sorry`, `admit`, custom axiom, `sorryAx`, native-evaluation proof axiom or disabled kernel check closes a claimed theorem. Early compiler failures were repaired before the successful build; they are not counted as proofs.

## Adversarial findings and fixes

1. **Original response was mutable.** Commit returned a post-commit live link read; replay loaded that live row again. A rename changed the replay payload; deletion produced NOT_FOUND despite a durable receipt. **Fixed for new operations:** response fields are read inside the transaction and stored as JSON alongside the effect. Replay/status read the snapshot. There is no new-operation post-commit projection dependency. Exact JSON equality after rename and original-result recovery after deletion pass. Legacy NULL snapshots remain a documented historical exception.
2. **Missing fences silently bypassed preparation checks.** The raw service accepted nil fence pointers. **Fixed:** new operations require entity/draft identity and draft revision when applicable. Replay is looked up before new-operation validation. Stale and missing-fence tests pass.
3. **Unknown operation identity died with its component.** After ACK loss, closing/remounting let the same human intent acquire a new key. **Fixed within retained-tab identity:** an actor/exam-scoped opaque key is saved before POST; the unchanged request stays in memory. Reload/body expiry keeps the key and disables unsafe body recreation. No roster data is persisted in session storage.
4. **Generic 4xx and in-progress conflicts were treated as proof of rollback.** **Fixed:** unclassified responses and key conflicts retain uncertainty; permission failure during an unknown retry also retains its key. Not-found status alone never means that an in-flight operation cannot later commit.
5. **Abandoned preparation could POST after unmount, and global exam switching reused operation state.** **Fixed:** old preparations cannot start a later POST; operation state belongs to actor/exam while room form fields remain intact.
6. **Fingerprint/equal-scope mismatch remains.** Full-to-Math reuse is real and mathematically different from scope equality. A no-op save also defeats the untouched-clone shortcut. No canonical-hash theorem or index exists. These are clearly marked policy/implementation gaps, not passed requirements.

Pre-fix characterization transcripts are retained in [mysql-tests.txt](evidence/mysql-tests.txt) and [vitest.txt](evidence/vitest.txt). Their passing confirmed the problematic behavior; they did not approve it. The final regression assertions require the corrected behavior.

## Application verification evidence

Commands for Go tests run from `backend/go`; frontend commands run from the repository root. Real room tests used `TEST_MYSQL_DSN=root@unix(/tmp/mysql.sock)/codex_sat_auto_room_verify_20261014?parseTime=true&multiStatements=true` on a disposable schema created for this engagement.

| Check | Result | Evidence |
|---|---|---|
| Fresh migration through 0088, then additive 0089 | Exit 0; startup schema guard passes | [mysql-migrate.txt](evidence/mysql-migrate.txt), [mysql-migrate-0089.txt](evidence/mysql-migrate-0089.txt) |
| Reexecute 0089 twice | Exit 0 both times | [migration-rerun.txt](evidence/migration-rerun.txt) |
| `go test ./cmd/api -run 'TestSat(Rooms\|RoomVerification\|ExamConfig)\|TestSATPublish(OperationKeyReplaysOneRelease\|PreservesRevisionFences)MySQL' -count=1 -v` | Exit 0; **11 top-level tests**, no skips | [mysql-tests-final.txt](evidence/mysql-tests-final.txt) |
| `go test ./internal/accesslinks ./internal/exams ./internal/platform/db ./internal/platform/tx ./internal/authz` | Exit 0; 5 packages pass | [go-unit.txt](evidence/go-unit.txt) |
| `env -u TEST_MYSQL_DSN go test ./cmd/migrate` | Exit 0; migration unit checks; DB-gated probes skipped | [migration-unit.txt](evidence/migration-unit.txt) |
| `bunx vitest run` with the five exact files in `evidence/commands.json` | Exit 0; **41 tests** across 5 files | [vitest-final.txt](evidence/vitest-final.txt) |
| `bun run typecheck` | Exit 0 | [typecheck-final.txt](evidence/typecheck-final.txt) |
| `bunx eslint` on six changed frontend files | Exit 0; no warnings/errors | [eslint.txt](evidence/eslint.txt) |

An expanded real-DB migration suite returned exit 1 at the existing `TestReceiptImmutabilityMySQL`: `UPDATE on attempt_terminalizations must fail post-0056 (BEFORE UPDATE guard)`. The disposable table had zero rows, so the per-row trigger never fired; both triggers were installed. The failing transcript is retained in [go-unit-after-fixes.txt](evidence/go-unit-after-fixes.txt), with row/trigger metadata in `environment.txt`. This is a fixture-dependent probe failure, not claimed as passing or silently replaced with the unit-only result. Room-specific migration/schema, transaction and replay checks pass. No Playwright, production fleet or soak test was run.

## Anti-vacuity review

- Reachability is nonempty: a seal, durable commit, crash before ACK, identical-key retry and ACK are explicitly reachable, and their effect count is one.
- Initiation constructs fresh monitored maps for arbitrary imported release/draft data; it does not assume the invariant as its own base case. Arbitrary malformed existing operation receipts are not certified.
- Consecution covers every action constructor and both reuse/publish selections. Actor/key domains and finite trace length are unbounded, not limited to the example actor or six test goroutines.
- Transaction atomicity is an explicit DB abstraction with source/test support, not a theorem about MySQL. Hash identity, UUID injectivity, clone equivalence, validator correctness and freeze behavior remain assumptions.
- ACK state and durable effect are separate. No liveness claim follows from the invariant; the infinite abort counter-run demonstrates the limitation.
- Scope coverage is not scope equality. A validated abstract payload is not a proof of media existence, branch authorization or numerical scoring correctness.
- No history/real-time sequentialization, Go refinement, legacy response reconstruction or capacity theorem is claimed.
- Named transitive axioms and fresh-environment replay were audited at the pinned toolchain. Deployment configuration remains UNKNOWN.

## Decision

The verification engagement is complete: checked proof sources, traceability, assumption inventory, regression fixes, evidence and a production test plan are saved. The product/deployment certification is **BLOCKED / NOT ESTABLISHED**, for the obligations above. Apply migration 0089 before serving the new coordinator, resolve the reuse policy, and execute [PRODUCTION_TEST_PLAN.md](PRODUCTION_TEST_PLAN.md) before claiming production readiness.
