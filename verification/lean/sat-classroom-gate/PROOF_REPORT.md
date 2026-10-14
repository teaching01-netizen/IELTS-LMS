# Formal verification report: SAT Classroom creation gate

## Verification target

Staff room creation through capability read, session selection, POST, and recovery of definitive refusal versus uncertain 5xx. The API instance that serves the POST is authoritative for creation; the database is authoritative for the room and operation receipt.

## Critical guarantees

| Requirement | Formal theorem | Code owner | Formal | Correspondence | Production |
| --- | --- | --- | --- | --- | --- |
| Gate-off Classroom creates no effect; Practice is unaffected | `disabled_instance_refuses_new_classroom`, `disabled_gate_allows_practice` | `PersistSATSession`, `satrooms.Service.CreateRoom` | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| Capability false/unknown blocks Classroom and preserves a restored form | `classroom_requires_enabled_capability`, `blocked_restored_classroom_cannot_begin`, `begin_submit_preserves_selected_session`, `refresh_preserves_restored_form` | SAT defaults API, `SatCreateRoomFlow`, `AccessLinkEditorSheet` | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| Definitive refusal clears pending key, preserves form, and disables Classroom in the open form | `disabled_refusal_clears_pending_and_preserves_form`, `definitive_refusal_disables_classroom_but_keeps_practice` | error mapper, create hook, flow | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| Generic 5xx retains the same pending request; same-key retry is at most once | `generic_5xx_retains_the_same_pending_attempt`, `reachable_at_most_one_room_per_operation`, `lost_ack_same_key_replays_once` | client pending store, transactional operation receipt | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| Uniform fleet rollout is necessary | `mixed_instance_configuration_is_not_global` (counterexample) | Railway per-instance env/config | PROVED counterexample | REVIEWED | UNKNOWN |

## Scope and production assumptions

Lean models per-instance startup gate values, abstract operation receipts, room effects, arbitrary request interleavings, and client response handling. Each room-create transaction is one atomic abstract step. A generic 5xx can be observed with or without a committed server effect; the client retains its request in either case. The detailed assumptions and owners are in [ASSUMPTIONS.md](ASSUMPTIONS.md).

The working tree was dirty at review start. Repository HEAD then was `5727547d421c442df206119ba1c559cad099adf6`; unrelated pre-existing user edits remain. Relevant source and proof hashes are in `evidence/source-sha256.txt`.

## Proof tool output and axiom audit

- Local validation outputs captured from 2026-10-14 18:16:08 to 18:20:35 UTC (2026-10-15 01:16:08 to 01:20:35 Asia/Bangkok). Repository and production-state provenance are in `evidence/repo-snapshot.txt` and `evidence/production-state.txt`.
- Toolchain: `leanprover/lean4:v4.19.0`, Lean 4.19.0, commit `6caaee842e94`; no external Lake packages.
- `lake clean && lake build SatClassroomGate`: exit 0. Full output is in `evidence/lean-build.txt`.
- `lake env lean proof/AxiomAudit.lean`: exit 0. Exact checked statements and `#print axioms` are in `evidence/axiom-audit.txt`.
- Every business theorem was kernel checked. Transitive dependencies use only Lean standard axioms `propext` and `Quot.sound`; no custom axioms, `sorry`, or `admit` occur.
- `lake env leanchecker`: unavailable in the pinned Lean distribution; output is recorded in `evidence/leanchecker.txt`.

The proof establishes properties of the Lean definitions only. It does not prove the Go/TypeScript/SQL implementation or production environment.

## Adversarial traces

| Trace | Model result | Application evidence / residual |
| --- | --- | --- |
| Two same-key requests interleave | Atomic first request stores one receipt/effect; later same-body request replays. Reachability invariant proves at most one effect per key. | SQL primary key plus `INSERT IGNORE` and transaction; MySQL replay tests exist but were not run here. |
| Commit succeeds, ACK is lost, same-key retry | `lost_ack_same_key_replays_once` returns the first receipt and leaves one effect. | Existing client and service recovery tests; no proxy fault injection here. |
| Generic 5xx incorrectly clears key, then user submits a new key | `clearing_generic_5xx_key_can_duplicate_rooms` shows two effects. This justifies retaining generic 5xx keys. | Current client classifies unknown 5xx as `unknown`; recovery test passes. |
| Gate off, fresh Classroom request | Refusal returns with unchanged store. | New MySQL full-transaction test added; DB portion skipped because `TEST_MYSQL_DSN` is unset. |
| Gate off, Practice request | Practice creates a single effect. | Unit test and UI coverage pass; new full-room DB scenario skipped locally. |
| GET to enabled node, POST to disabled node | POST refusal is definitive; current form marks Classroom disabled, preserves selection/draft, and lets Practice proceed. | New Flow regression test passes. |
| Mixed gate configuration across nodes | An enabled node accepts one fresh request, then a disabled node refuses a separate fresh request in the same sequential history. This is a rollout blocker, not a global-gate guarantee. | Railway instance states are UNKNOWN. |
| Crash/rollback after draft seal and schedule insert | Atomic model rolls back all effects on error. | `WithTx` code reviewed; new MySQL test asserts rollback but could not run against a DB here. |

## Validation commands

| Command | Result |
| --- | --- |
| `lake clean && lake build SatClassroomGate` | PASS, exit 0 |
| `lake env lean proof/AxiomAudit.lean` | PASS, exit 0; standard axioms only |
| `go test ./internal/exams ./internal/platform/apperrors ./internal/platform/config` | PASS, exit 0 |
| `go test -v ./cmd/api -run 'TestSatConfigDefaultsMatchBlueprint|TestSatRoomsClassroomDisabledRollsBackMySQL' -count=1` | PASS; defaults test passed, database-backed case skipped because `TEST_MYSQL_DSN` is unset |
| `bun run typecheck` | PASS, exit 0 |
| `bunx vitest run` on SAT room flow, recovery, and exam library route files | PASS, 38 tests |
| `git diff --check` | PASS, exit 0 |
| `lake env leanchecker` | NOT AVAILABLE in pinned toolchain |

Raw command output is captured in the corresponding files under `evidence/`; the exact command list is in `evidence/commands.md`.

## Decision

- **Formal status:** PROVED for the named abstract theorems; counterexamples are also kernel checked.
- **Correspondence status:** REVIEWED_WITH_TESTS for covered code paths; MySQL rollback mapping remains UNVERIFIED until the database test runs.
- **Production evidence:** PARTIAL for local code/unit tests; production fleet, engine, migrations, failover, and load are NOT_TESTED.
- **Release decision:** CONDITIONAL / BLOCKED on production evidence. The deployed flag state is UNKNOWN and was not changed. Do not enable `SAT_CLASSROOM_ENABLED` until the API fleet, 0084/0086 fences, database engine, and transactional behavior are verified as specified in [PRODUCTION_TEST_PLAN.md](PRODUCTION_TEST_PLAN.md).
