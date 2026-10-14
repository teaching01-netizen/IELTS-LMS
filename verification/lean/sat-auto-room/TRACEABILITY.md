# Requirement-to-theorem traceability

Formal status describes the exact listed statement. Correspondence is source review/tests, never mechanized Go verification. Production evidence is local and partial.

| REQ | Formal predicate/theorem | Observable implementation path / environment | Test oracle | Formal / correspondence / production |
|---|---|---|---|---|
| R1 | `at_most_one_effect`: every reachable state's effect count is ≤1 for every actor/key | `CreateRoom`, `claimReceipt`, 0088 PK; A1–A4 | Same-key six-caller race: one room/release; same-key replay count unchanged | PROVED / REVIEWED_WITH_TESTS / PARTIAL |
| R2 | `room_has_atomic_receipt_and_schedule`, `room_has_matching_release` in the creation ledger | One `WithTx` around `PublishDraftInTx`, `InsertWithScheduleTx`, receipt write; A1 | Readiness rejection writes zero rows; injected link INSERT failure rolls back an already sealed release and schedule; same-key retry succeeds | PROVED for abstract schedule/receipt/reference; roster content INCOMPLETE / REVIEWED_WITH_TESTS / PARTIAL |
| R3 | `room_pin_preserved`, `selection_preserves_release` | Explicit `PinVersion`; authoring copies/reopens; A5–A7 | Lifecycle test checks earlier links retain version IDs after later publication | PROVED for modeled non-destructive actions / REVIEWED_WITH_TESTS / PARTIAL |
| R4 | `commit_requires_revision_fences`, `supplied_fences_match` | `CreateRoom` mandatory inputs and locked entity/draft checks; A5/A8 | Missing fences rejected, stale draft revision refused, ordinary submitted request includes all fences | PROVED for model guards / REVIEWED_WITH_TESTS / PARTIAL |
| R5 | `stale_preflight_cannot_seal`, `new_release_validated` | Outside-tx `PreflightSATPublish` plus locked `(version,revision)` check and validator; A5/A7/A8 | Existing stale-fence/not-ready tests; no forced in-flight media-preflight/save barrier test yet | PROVED for abstract validator/preflight / UNVERIFIED for full media/freeze refinement / PARTIAL |
| R6 | `replay_no_effect`, `different_body_not_replayable`; exact JSON replay is an implementation regression check | `response_snapshot`, `GetInTx`, `recordedResult`; A1/A4/A13 | Original response JSON equals replay after rename; deleted room recovery returns original fields; changed request conflicts | PROVED for abstract replay/body identity; JSON serialization NOT_RUN / REVIEWED_WITH_TESTS for new snapshots / PARTIAL |
| R7 | `full_reuse_is_not_equal_scope`, `no_op_write_defeats_clone_reuse` | `covers` / revision-zero `loadDraft`, not a fingerprint index | Full release reused for Math room; no-op question write causes new release | INCOMPLETE for fingerprint uniqueness; equal-scope requirement refuted / MISMATCH / PARTIAL |
| R8 | Client counterexamples describe the pre-fix abstraction; browser state is not in the safety theorem | Scoped marker before POST, in-memory request retention, conservative errors; A10 | Remount same key, opaque-key-only expiry recovery, 404/409 retention, per-user/per-exam isolation, abandoned-preparation cancellation | NOT_RUN as a general browser theorem / REVIEWED_WITH_TESTS within retained-key boundary / PARTIAL |
| R9 | No auth/tenant theorem | HTTP role guard plus `GetForActor`; A9 | Authz policy unit suite; cross-tenant integration scenario remains in test plan | NOT_RUN / UNVERIFIED for full endpoint policy / PARTIAL |
| R10 | No exam-initialization theorem | `exams.Create` → `initializeSATDraftTx`, typed config; A1 | `TestSatExamConfigAtCreateMySQL` | NOT_RUN / REVIEWED_WITH_TESTS / PARTIAL |
| R11 | `permanent_abort_run` demonstrates a counter-run; no conditional eventuality theorem | Retry/status/freeze availability; A8/A10/A12 | Normal replay/status tested; process kill, permanent network loss and fair recovery not tested | INCOMPLETE / UNVERIFIED / NOT_TESTED |
| R12 | No capacity/durability/linearizability theorem | Fleet + DB + storage + coedit + rollout | No deployed-style load/soak/failover results | NOT_RUN / UNVERIFIED / NOT_TESTED |

## Correspondence map and proof-to-code gaps

- `Step.invoke` ↔ authenticated parsed HTTP command; authentication is outside the model. Nat actor IDs abstract SQL string IDs/collations.
- `Step.inspect` ↔ media/readiness preflight reading a committed draft. The formal snapshot includes payload; Go fences version/revision and depends on every mutation changing that revision.
- `Step.save` ↔ authoring commands' transactional revision increments. Model guards do not establish that every actual caller obeys those guards.
- `Step.reopen` ↔ explicit clone command, with canonical content preservation assumed. Plain reads do not perform this model transition.
- `Selection.reuse` ↔ no draft or untouched clone + scope coverage. The model includes effective payload equality; Go infers it from clone provenance/revision zero. That inference is a refinement obligation.
- `Selection.publish` ↔ freeze, matching preflight, locked SAT validation and sealing. The model omits existing publish normalization details and abstracts their effective result as payload.
- `Step.complete` ↔ durable transaction commit. The separate logical receipt/room/schedule maps update atomically. This abstraction is supported by source and one real rollback schedule, not a simulation proof of MySQL.
- `Step.replay`/`acknowledge` ↔ receipt read and response delivery. A stored receipt is not proof of ACK delivery. New response JSON is captured before commit; legacy NULL snapshots fall outside exact replay.
- `Step.crash`/`abort` ↔ uncommitted work discarded while durable state survives. Hardware failover losing acknowledged commits is not represented.

The commit is the proposed linearization point for creation. No invocation/response history sequentialization has been proved; this is **not a linearizability proof**. No mechanized translation links Lean terms to executable Go/TypeScript/SQL.
