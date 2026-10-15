# Requirement and implementation correspondence

All file paths below are relative to backend/go unless prefixed verification/.

| Requirement | Lean theorem/action | Observable implementation | Oracle / gap |
|---|---|---|---|
| R1 | init_safe, step_safe, reachable_safe, response_after_commit_and_matches_bootstrap; commit/respond/failure | sat.Service.CompleteAssessment; platform/tx.Runner.WithTxRetry and withTxLevel | TestCompletionOverlayRunsOnlyAfterSuccessfulCommit ordered sqlmock expectations: success, deadlock commit retry, permanent commit failure; transaction atomicity assumed |
| R2 | response_after_commit_and_matches_bootstrap | sat.CompleteAssessment and LoadResultForAttempt both call satscoring.Overlay; handler and bootstrap both call delivery.StudentSATResult | TestSATCompletionOverlaysGlobalScaledScores compares whole classroomRaw reports; actual Go correspondence reviewed, not a translation proof |
| R3 | overlay_preserves_raw/release, overlay_idempotent, policy_failure_strips_conversion, response_does_not_write | satscoring.Overlay, ApplyRevision, stripConversion; fresh loadResult maps | policy error/no-policy tests, score-conversion MySQL tests; arithmetic correctness not established by this model |
| R4 | missing_raw_unchanged, no_snapshot_exposure, closed_gate_hides_report, withheld_hides_report | delivery.StudentSATResult, satReleasedProjection, satReceiptProjection; handlers_delivery finish projection | TestStudentSATResultUsesLiveGateAndStripsSnapshot; bootstrap flag test; disabled-after-release real completion replay |
| R5 | commit uses stored.getD candidate; overlay_idempotent | attempt row lock, terminalization single receipt, loadResult replay, post-commit overlay | concurrent duplicate finishes with active policy assert 1100 and one receipt; existing client-submit/reconcile race |
| Boundary counterexamples | old_finish_misses_score; policy_change_can_change_display; disabled_old_endpoint_leaks | original finish omitted overlay; original handler omitted student projection | Concrete Lean counterexamples and Go regression |
| Nonvacuity | nonvacuous_response | commit then response | Reachable emitted report includes 600/500/1100 conversion |

The history and committedReads lists are ghost histories, not actual extra database tables. State.ready represents successful transaction return, not an in-transaction candidate. Transaction read/write internals are abstracted at commit; aborted attempts do not publish a ready ticket. A repair can replace durable rows after a read, so response correctness is relative to the historical committed read, not the latest repaired row. Policy and gate observations need not be a joint database snapshot. Model equality deliberately does not assert that two independent real requests observe identical state.

Upstream exam lifecycle review: CompleteAssessment locks the attempt and rejects terminated outcomes, then EnsureSATModuleTopologyTx validates terminal modules and committed classroom routes before sealing. V2 completion computes the durable response digest inside the transaction. Delivery timeout reconciliation and answer save cutoff ownership are exercised by existing integration tests. Client clicks never accepted by the server are not an inclusion guarantee. Branch-content authorization is outside this change and not re-proved.
