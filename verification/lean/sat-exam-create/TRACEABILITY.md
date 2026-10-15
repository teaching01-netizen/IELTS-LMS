# Requirement to implementation traceability

| ID | Exact guarantee | Formal predicate/theorem | Application path and evidence | Environment dependency | Status |
| --- | --- | --- | --- | --- | --- |
| C-1 | Bundle and operation receipt are written as one commit or not at all. | `bundleWellFormed`; `commit_preserves`; `reachable_invariant`; `abort_is_stutter` | `exams.Service.Create` inserts entity, initializes SAT draft, report flag, event, then stores `result_json` inside `WithTx`; Go tests and local MySQL create race. | DB transaction atomicity/durability. | `REVIEWED_WITH_TESTS` |
| C-2 | Same actor/key/payload replays one exam. | `same_key_retry_replays`; `receipt_points_to_complete_exam`; `keyed_lost_ack_then_retry_replays` | `claimExamOperationKey` uses `INSERT IGNORE` against migration 0058 PK; result JSON is stored before commit; wizard sends a stable key for the same mounted request; SQL-mock + 8-way MySQL race + RTL retry test. | Unique-key behavior across production instances and seven-day retention. | `REVIEWED_WITH_TESTS` |
| C-3 | Same actor/key with different payload conflicts and does not write another exam. | `mismatched_key_payload_conflicts` | Claim compares stored SHA-256 request hash; SQL-mock mismatch test. | SHA collision and serialization assumptions. | `REVIEWED_WITH_TESTS` |
| C-4 | Invalid config rejects before database writes. | `Step.invalid` is a stutter; valid create requires `Payload.valid` | `validateCreate` validates SAT config before `WithTx`; `sat_config_test.go` asserts invalid config opens no transaction. | Parser/code correspondence. | `REVIEWED_WITH_TESTS` |
| C-5 | No active version cannot be presented as a default plan. | Not in this transaction model; Go regression test is the oracle. | `GetClassroomPlan` returns conflict if both pointers are absent; SQL-mock regression test. Existing draft-first and published-fallback tests pass. | Read freshness and repair process. | `REVIEWED_WITH_TESTS` |
| C-6 | Old clients without keys keep their create request shape. | `old_client_lost_ack_can_duplicate` documents why they are not replay-safe. | `buildCreateAssessmentExamPayload` emits only API fields; key is header-only. Service transport test asserts body excludes `operationKey`. No-key API compatibility tests remain. | Old/new binary skew. | `REVIEWED_WITH_TESTS` |
| C-7 | Expired receipt is outside the at-most-once window. | `expired_key_allows_late_duplicate` | Migration 0058 expires rows after seven days; maintenance sweep deletes them. | Cleanup timing/retention. | `PROVED` in model; production schedule `UNKNOWN` |

## Refinement mapping

| Lean object/action | Go / SQL / frontend | Equivalence reason | Evidence and remaining gap |
| --- | --- | --- | --- |
| `Request.actor` | `CreateForActor` overwrites `OwnerID` from the authenticated actor. | Server actor, not client owner input, scopes the receipt. | Code review; auth boundary is not mechanized. |
| `Request.operationKey` | `Idempotency-Key` header → `CreateRequest.OperationKey`; scope literal `exam-create`. | Same logical key crosses browser, handler, transaction. | RTL/service transport test; no reload persistence. |
| `Payload` | Slug/title/provider/visibility/org/SAT config request fields, excluding key. | Captures result-affecting create content. | Lean uses exact payload equality; Go uses SHA-256 over JSON. |
| `keyAvailable` | Unique primary key in `authoring_operation_keys`. | Concurrent first claim must have one winner; duplicate claim reads stored row. | Eight concurrent calls on local MySQL; production/cross-process profile unknown. |
| `commitState` | `Create` transaction in `internal/exams/service.go`. | A single Lean step represents the SQL commit; no intermediate row state is observable after abort. | Reviewed transaction boundaries; not a Go/SQL semantics proof. |
| `Step.abort` | Any create error returned from the `WithTx` callback; deferred rollback. | No state change becomes durable. | SQL-mock tests, local MySQL integration; fault-at-every-write testing not done. |
| `Step.ackLost` + replay | Commit succeeds, response is lost, same mounted form resubmits same key. | Durable receipt returns same exam ID. | SQL-mock and local race; process reload generates a new key. |
| `Step.expireKey` | Maintenance cleanup after `expires_at`. | Removing the receipt permits the same key to be newly claimed. | Seven-day schedule modeled as an explicit action; no clock/scheduler proof. |
| `GetClassroomPlan` no pointer | Draft/published version pointer query. | Plan must come from the active version source. | Regression test; query freshness and cross-replica consistency remain unknown. |
