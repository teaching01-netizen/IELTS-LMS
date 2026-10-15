# Verification target

SAT completion's post-commit global score overlay and student-facing release projection.

Critical guarantees: responses derive from successful committed reads; finish and bootstrap agree for identical report/policy/gate observations; raw data and release status survive overlay; policy failures strip conversion; withheld/disabled reports and private snapshots do not leak through the student projection.

Scope/production assumptions: arbitrary request IDs and finite interleavings with retries, policy changes, repairs and crashes. SQL atomicity, primary visibility and immutable revisions are explicit assumptions. See ASSUMPTIONS.md. Conversion arithmetic, full exam lifecycle correctness, multi-instance liveness and capacity are outside the proved boundary.

## Verdict

| Field | Status |
|---|---|
| Formal status | **PROVED** for the 17 explicitly audited model theorems and counterexamples listed in proof/SatFinishScore.lean. |
| Correspondence status | **REVIEWED_WITH_TESTS**; Go/SQL correspondence is not mechanically proved. |
| Production evidence | **PARTIAL**; local MySQL functional/concurrency testing only. |
| Overall | **CONDITIONAL**. Production correctness **NOT ESTABLISHED**: deployed DB/topology/rollout and crash/failover/load obligations remain unverified. |

## Reproducibility and proof evidence

Base commit and SHA-256 of exact relevant working-tree sources are pinned in evidence/source-snapshot.json. The implementation and proof changes are uncommitted. Unrelated concurrent edits exist; this report does not attribute them to this work.

- Lean: leanprover/lean4:v4.19.0, compiler commit 6caaee842e94; no external Lake packages.
- Compiler binary SHA-256: 5c1fe58db7d10b1cd0ddff1a1cbc49db2396fff9c6c983cc3b49f1c5c1ae241b.
- lake build: exit 0; all four proof modules are library roots. evidence/lean-build.txt.
- lake env lean proof/SatFinishScore.lean: exit 0; exact theorem types and transitive axiom lists in evidence/axiom-audit.txt.
- Permitted/observed axioms: only standard propext and Quot.sound. No sorryAx, custom axioms, admitted placeholders or native evaluation axioms.
- lake env lean --run Replay.lean Model Safety Counterexamples: exit 0. All safe declarations were replayed through the kernel; no safe axioms declared. Its forged proof of False was rejected. This is a second checking pass through the same Lean kernel, not an independent kernel implementation. evidence/kernel-replay.txt.
- Local environment: Go 1.26.3 darwin/arm64; MySQL 9.6.0, REPEATABLE-READ, innodb_flush_log_at_trx_commit=1. evidence/environment.json.

## What was proved

Model.lean defines arbitrary initial durable rows, report/policy observations, a live gate, request-local readiness after successful commit, historical committed-read tickets, response history, and nondeterministic transitions. Successful commits can seal or replay stored data; failures stutter; crashes discard readiness; repairs can change durable data after a read; policy observations may change between responses.

Safety.lean establishes initiation, preservation for every Step constructor, and reachability induction. Every modeled response references a successful committed-read ticket and equals the bootstrap specification for the same observations. Additional theorems establish raw/release preservation, missing-raw no-op, error stripping, idempotence, snapshot filtering, disabled/withheld receipt projection and no durable write during response construction.

Counterexamples.lean checks the original missing-conversion behavior and the old endpoint's disabled-report leak. It also demonstrates that different policy revisions can yield different displayed results. These concrete examples are counterexample/testing evidence, not a replacement for the unbounded reachability theorem.

## Implementation findings

The original overlay fix is retained outside WithTxRetry. A related actual defect was found in deliverySubmitAssessmentHandler: it returned the internal AssessmentResult directly, bypassing bootstrap's live score-report switch and snapshot allowlist. Extracted delivery.StudentSATResult is now called by both paths. It preserves the receipt, withholds pending/invalidated/disabled reports, fails closed on gate read errors, and removes the private terminal snapshot from released results.

TRACEABILITY.md maps each theorem to the handler, transaction, query and tests. Equality in Lean follows the intentionally shared overlay/projection specification; it is not a mechanized proof that Go executes that specification. The actual wiring is reviewed and exercised by tests.

## Tests

The requested SAT/scoring/integration packages and delivery package passed with real MySQL. The expanded command also included cmd/api, so its aggregate exit is 1 due to three unresolved tests outside the edited finish/projection path:
- TestSATAnsweredExamMySQL: "burst returned a different paper".
- TestSATPublishRequiresCompleteConverterMySQL: configured table covers 3 operational questions while the exam delivers 6.
- TestSATSingleModuleTransactionRollsBackLateReceiptFailureMySQL: missing sat_single_module_imports table.

These are not claimed to be pre-existing without a separate baseline run. No edits were made to those paths. Exact output is retained in evidence/go-tests.txt; broader API suite status is FAILED. Focused race results are in evidence/go-race.txt: exit 0, three repetitions with shuffle seed 42 and the Go race detector, covering SAT completion transaction failures/retry, student projection, live bootstrap gating, real MySQL scaled completion/replay and client-submit/timeout reconciliation. All three selected packages passed; no data race was reported. This bounded profile is not a load test.

The first expanded run passed SAT/scoring/delivery/integration but API MySQL fixtures failed with "unsupported Scan, storing driver.Value type []uint8 into type *time.Time". The supplied test DSN omitted parseTime=true. evidence/go-tests-initial-dsn.txt preserves the failure; the rerun uses parseTime=true and loc=UTC. This was test setup, not an application fix.

New regression coverage:
- Successful commit, deadlock commit retry and permanent commit failure: ordered SQL expectations place the overlay query after successful commit.
- Policy read failure leaves completion successful and preserves raw score while dropping conversion.
- Real classroom completion and replay return section estimates 600/500 and total 1100, identical to LoadResultForAttempt.
- Two barrier-started duplicate completion requests return the estimate and retain exactly one terminal receipt.
- No global totalScaled is persisted by read-time overlay.
- Disabling reporting after release hides the replayed report without hiding its receipt.
- Enabled/disabled/pending/invalidated/missing/failed release gates and private snapshot filtering.

No browser run, production traffic, multi-instance load, failover or crash injection was performed.

## Anti-vacuity review

- Init permits arbitrary existing stored data and policy, including pending/legacy rows; it does not assume the invariant. Request-local histories start empty.
- Initiation and every transition's preservation are proved before the reachability corollary. Arbitrary actors and finite interleavings are quantified, not only two actors.
- nonvacuous_response reaches a committed response containing 600/500/1100 estimates.
- The committedReads/response lists are ghost histories, not extra production tables. ACK loss does not undo a commit.
- Aborts never create ready tickets; crashes cannot invent successful commits. Repairs need not preserve the latest row, so the invariant uses the historical read snapshot.
- Atomic commit and Go/SQL semantics are explicitly assumed/refinement obligations, never smuggled in as proved production facts.
- Policy and gate reads are separate observations. No joint linearizability or equality across changed policies/gates is claimed.
- Overlay arithmetic and malformed-data parsing are abstracted; this proof does not establish numeric validity for every Go payload.
- No liveness follows from safety; permanent failure, starvation or overload can prevent response delivery.
- Exact theorem types and dependency axioms were checked, and a meaningful witness plus negative examples exist.
- An adversarial deployment using stale replicas, mutable cached revisions or old binaries falls outside the written assumptions; production correctness remains conditional.
