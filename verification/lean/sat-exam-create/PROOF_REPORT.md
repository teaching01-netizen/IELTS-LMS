# SAT exam create proof and verification report

## Verification target

SAT creation from the four-step sheet through the Go create endpoint, plus the active classroom-plan lookup used by downstream UI. The database is the authority for the exam and its initial draft/configuration. The create HTTP response is only acknowledged after the transaction returns successfully.

## Critical guarantees

- A valid create commits the exam bundle and idempotency receipt together; callback failure/transaction abort leaves no durable partial bundle.
- A same-actor, same-key, same-payload retry returns the original exam ID while the receipt is retained.
- A same-key, different-payload request conflicts without adding a second exam.
- Invalid plan/converter data is rejected before writes.
- An exam with no current draft or published version cannot be reported as having a default classroom plan.

## Scope and production assumptions

The Lean theorem is about the abstract model in `proof/Model.lean`. It treats a complete exam bundle and operation receipt as one atomic commit. The corresponding Go SQL implementation, unique key constraint, request fingerprint, and frontend header are reviewed and tested, not mechanically refined. Local MySQL 9.6.0 evidence is not production evidence. Production replica count, engine/version, isolation, failover durability, migration ledger, rollout order, read routing, flags, and workload are `UNKNOWN`.

## Status

- **Formal status:** `PROVED` for `Invariant` under `Init` and the model's `Step` relation, including all declared transition constructors. Also proved: retained-key replay is a stutter, a receipt points to a complete matching bundle, and explicit counterexamples for no-key retry and post-expiry retry.
- **Correspondence status:** `REVIEWED_WITH_TESTS` for the listed Go/SQL/frontend paths. There is no mechanized Go/SQL refinement proof.
- **Production evidence:** `PARTIAL`. Focused tests passed, including an eight-caller race against a disposable local MySQL 9.6.0 schema. No multi-process, production-profile, load/soak, failover, or actual deployment verification was performed.
- **Release decision:** `CONDITIONAL`, not production-ready. Confirm A1–A11 in `ASSUMPTIONS.md`, deploy backend/schema before frontend, and decide whether retry recovery must survive a page reload.

## Requirement-to-theorem summary

See `TRACEABILITY.md` for exact paths and evidence.

| Property | Lean result | Application evidence |
| --- | --- | --- |
| Commit preserves complete bundle, coherent receipt, and fresh allocator state | `commit_preserves`; `reachable_invariant` | Go transaction review, SQL-mock package tests, local MySQL race |
| Abort/replay/conflict/invalid/ACK-loss do not mutate durable state | `abort_is_stutter`; `same_key_retry_replays`; `mismatched_key_payload_conflicts`; `lost_ack_is_stutter` | Go replay, malformed receipt, mismatch, header, and UI retry tests |
| Ledger receipt points to complete exam bundle | `receipt_points_to_complete_exam` | Result JSON is stored before the same transaction commits |
| No-key ACK-loss retry may duplicate | `old_client_lost_ack_can_duplicate` | Documents why clients need a stable key |
| Retry after receipt expiry may duplicate | `expired_key_allows_late_duplicate` | Migration 0058 sets seven-day retention |
| No current plan source fails closed | Not formalized | Go regression test for both pointers NULL |

## Lean build and axiom audit

- Pinned toolchain: `leanprover/lean4:v4.19.0`, Lean 4.19.0, commit `6caaee842e94`.
- Lake project: `verification/lean/sat-exam-create`; no external Lake packages.
- Clean build command: `lake clean`, then `lake build SatExamCreate`.
- Axiom audit command: `lake env lean proof/AxiomAudit.lean`.
- Both commands exited 0. Full build and `#check`/`#print axioms` output are in `evidence/lean-build.txt` and `evidence/axioms.txt`.
- Transitive dependencies use only Lean's standard `propext` for the state/function extensionality proofs; other listed theorems have no axioms. There are no custom axiom declarations, `sorry`, or `admit` in proof sources.
- Independent `leanchecker` was attempted and is unavailable in this pinned toolchain (exit 1); see `evidence/leanchecker.txt`.

## Application tests

The working tree was already dirty at base commit `8aa1d87ba5c8d264a0a039efda55a3c82c69a92a`. Relevant source SHA-256 pins are in `evidence/source-sha256.txt`.

| Command | Result |
| --- | --- |
| `go test ./internal/exams/... ./internal/authoring/... -count=1` | Passed; transcript `evidence/go-unit-tests.txt`. |
| `TEST_MYSQL_DSN=… go test ./cmd/api -run '^(TestExamsCreateHandlerPassesIdempotencyHeaderToActorScopedClaim\|TestSATExamCreateIdempotencyRaceMySQL)$' -count=1 -v` | Passed; the HTTP handler forwarded the header and eight simultaneous requests against local MySQL 9.6.0 shared one result; transcript `evidence/go-api-idempotency.txt`. |
| `bunx vitest run src/products/sat src/features/exam-authoring` | Passed: 218 files, 1,971 tests; transcript `evidence/frontend-tests.txt`. |
| `bun run typecheck` | Passed; transcript `evidence/typecheck.txt`. |

The temporary schema used for the MySQL race was created for this verification, migrated through `0089_sat_room_response_snapshot.sql`, and dropped after evidence capture. Version and migration ledger are recorded in `evidence/environment.txt`.

## Production-state model

Lean uses arbitrary natural-number actor IDs, operation keys, and exam IDs; an exam bundle includes the entity fields, draft plan, converter policy, report setting, and created event. The operation receipt is keyed by `(actor, key)` and stores the exact abstract payload and result ID. A create is permitted only for a valid payload and an absent key; replay and conflict are modeled separately. Abort and ACK loss are explicit stutters. Receipt expiry deletes the key while leaving the exam.

The model admits arbitrary prior complete bundles and coherent receipts, with a cursor greater than their IDs; it is not limited to a single empty startup. The type/model excludes partially persisted historical bundles and malformed receipt data. Go tests separately ensure malformed stored JSON fails closed. It also abstracts database commit/PK serialization atomically; this assumption is not proved by Lean.

## Adversarial traces and anti-vacuity review

- **No-key retry after lost ACK:** first create commits; ACK loss leaves it durable; retry without a key commits a second bundle. The Lean witness has distinct IDs 0 and 1.
- **Retained key after lost ACK:** first create commits; ACK loss stutters; the same actor/key/payload replay stutters and retains result ID 0.
- **Expired key:** after the modeled receipt-expiry action, the same request can create ID 1 alongside ID 0. This is the seven-day design ceiling, not an unconditional exactly-once result.
- **Two claimants:** actual MySQL integration starts eight goroutines on one barrier against one actor/key/payload; one exam, one create event, one completed receipt, and the same ID for all callers are asserted.
- `reachable_invariant` is inductive over every `Step` constructor: create, replay, conflict, invalid input, abort, ACK loss, ACK delivery, and receipt expiry.
- A valid create is shown reachable (`valid_create_is_reachable`); old-client and expiry counterexamples are witnesses, so the model is not transition-empty.
- Startup validity is an explicit assumption about existing complete rows/receipts. Malformed DB startup and production migration drift are not proved away.
- ACK is separate from commit. No liveness or infinite-capacity claim is made.

## Precise limits

Lean exact-payload equality abstracts SHA-256 and Go JSON serialization. UUID uniqueness is modeled as a monotone ID allocator. Database constraints, isolation, commit durability, cleanup scheduling, auth middleware, HTTP/network loss, replica freshness, and deployed configuration remain application/environment obligations. The key is kept in a React ref, so a same-sheet retry reuses it but a browser reload/remount does not. This proof does not establish production correctness or performance.
