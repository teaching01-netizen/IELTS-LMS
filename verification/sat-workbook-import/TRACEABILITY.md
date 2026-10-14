# TRACEABILITY

`Formal`: PROVED = kernel-checked here. `Correspondence`: MECHANIZED / REVIEWED_WITH_TESTS / UNVERIFIED / MISMATCH. `Production`: see PRODUCTION_TEST_PLAN.md.

## Requirement → theorem → code → test
| REQ | Lean theorem (`SatWorkbookImport/Safety.lean`) | Code path | Test oracle | Formal | Correspondence | Production |
|---|---|---|---|---|---|---|
| REQ-1 | `at_most_one_effect` (via `reach_inv`) | `import state previewed→committed` CAS: `UPDATE sat_workbook_imports … WHERE state='previewed'` (`workbook_import.go`) | `…TwoInstanceRaceMySQL` (not run) | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| REQ-2 | `commit_step_scope`, `commit_scope_isolation` | `DELETE FROM assessment_exam_questions WHERE module_id IN (targets)` | `…PreservesOtherModulesAndUndoMySQL`, `…MultipleModulesImportReplacesOnlySelectedMySQL` (not run) | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| REQ-3 | `commit_installs_checked_content` | digest compare under lock (`checkedDigest != importRequest.ContentDigest`) | `TestWorkbookContentDigestBindsContentAndTargets`, `…RejectsTamperedRequestsMySQL` | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| REQ-4 | `commit_applies_only_to_checked_draft`, `stale_commit_is_noop` (+ `naive_loses_edit` / `real_commit_blocked` controls) | revision CAS `actualRevision != expectedRevision` | existing revision-conflict tests; **A4 unenforced** | PROVED | REVIEWED_WITH_TESTS (A4 U) | NOT_TESTED |
| REQ-5 | `claimed_key_commit_is_noop`, `retry_after_applied_is_noop`, `commit_of_used_import_is_noop` | `claimOperationKey` + receipt lookup + state CAS | `TestWorkbookCommitReplays*`, `TestWorkbookCommitRejects*`, `TestWorkbookCommitInFlightKeyAsksForRetry` | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| REQ-6 | `undo_restores_snapshot`, `undo_discards_only_the_import` | `UndoSATWorkbook` + `SATWorkbookUndoState` (revision equality) | `…PreservesOtherModulesAndUndoMySQL` (not run) | PROVED | REVIEWED_WITH_TESTS | NOT_TESTED |
| REQ-7 | not a Lean property | parser ignores Pretest; publish: `satpublish.ValidateModule` (`sat.module.pretest_count`) called in `exams/service.go:929` with the locked tx | `TestParseSATWorkbookIgnoresPretestColumn`, `TestValidateModuleRequiresExactlyTwoPretests` | n/a | REVIEWED_WITH_TESTS | NOT_TESTED |

## Model action ↔ implementation
| Lean | Implementation | Why equivalent | Gap |
|---|---|---|---|
| `register` | `RegisterSATWorkbookPreview` tx: lock exam+draft, revision == shell revision, expire previous, insert import + scope rows | records `expected_rev`, draft digest and targets; snapshot is implicit in the draft at that revision | snapshot is *not stored*; REQ-4 reasons "draft at revision r is the checked draft" which is exactly A4 |
| `edit` | any authoring mutation | bumps revision (A4) | A4 is reviewed, not enforced |
| `commitApply` | `replaceSATDraftOpKey` (one tx) | guards ↔ hk (`claimOperationKey` claimed), preview row `state='previewed' AND expires_at>now FOR UPDATE`, revision CAS, target/digest equality | atomicity = A1 |
| `commitReplay` / `commitConflict` | ledger fallback read + receipt read (fingerprint equal / different) | same-fingerprint → stored result; else 409 | replayed `Shell` may be older than the live draft (safe: next write CAS-conflicts) |
| `commitAbort` / `crash` | rollback, deadlock, timeout, lost ACK | no durable change | none |
| `undo` | `UndoSATWorkbook` | allowed only if `imported_version_revision == current revision` | A4 |

## Anti-vacuity
`effect_is_reachable` exhibits a reachable state with `effects 7 = 1`, module 1 replaced and module 2 untouched. Mutation test: deleting the revision guard from `commitApply` makes `inv_step` fail to compile (guard is load-bearing).
