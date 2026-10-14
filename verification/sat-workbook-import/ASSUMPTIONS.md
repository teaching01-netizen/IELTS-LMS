# ASSUMPTIONS

Every theorem is conditional on these. Status: V = validated by code review/tests, U = unvalidated here.

| ID | Assumption | Owner | Anchor | Validation | Status |
|---|---|---|---|---|---|
| A1 | One `WithTx` = one atomic, durable InnoDB transaction (REPEATABLE READ); `commitApply` is a single step. | DB/platform | `platform/tx/tx.go:70` (`WithTx`, RR), `workbook_import.go` `replaceSATDraftOpKey` | Code review; sqlmock order tests; **MySQL integration tests exist but not run here** | V (partial) |
| A2 | All imports for one exam serialize on `SELECT … FROM exam_entities … FOR UPDATE`, then `exam_versions … FOR UPDATE`. Replay/receipt reads happen after that lock. | authoring | `workbook_import.go` (lock, then receipt, then revision check) | sqlmock in-order tests `TestWorkbookCommitReplaysFromReceiptWithoutTouchingDraft` | V |
| A3 | `Content` equality ⇔ equal digest (SHA-256 over canonical JSON; no collisions; browser re-serialization is equivalent). | authoring | `workbook_binding.go` `canonicalWorkbookFingerprint` | `TestWorkbookContentDigestBindsContentAndTargets` | V (collision resistance assumed) |
| A4 | **Every** write to draft content/placements/module settings bumps `exam_versions.revision` in the same transaction (`touchModuleDraft`/`touchQuestionDraft`, or a direct bump). Without this, REQ-4 and REQ-6 fail. | authoring | `mutation_contracts.go:19-45`; callers in `question_commands.go`, `coedit.go`, `workspace_coedit.go`, `delivery_settings.go`, `score_converter.go` | Reviewed by grep: each placement writer sits in a function that touches the draft. **No mechanical enforcement.** | U (see RECOMMENDATIONS R-3) |
| A5 | Registry rows existing at deploy time are well-formed (each `committed/undone` has effects=1, each `previewed` has `expected_rev ≤ rev`). | ops | migration `0082` | Migration is new (no legacy rows). | V |
| A6 | `authoring_operation_keys` and `sat_workbook_import_scopes` may be purged independently (retention); a purged key/receipt can never cause a second effect (the import has left `previewed`). | ops | `commit_of_used_import_is_noop` | Lean theorem + integration test `…PreservesOtherModulesAndUndoMySQL` | V |
| A7 | Single MySQL primary is authoritative; no stale replica serves these reads. | infra | — | UNKNOWN production topology | U |
| A8 | One concurrent preview per (exam, actor); a newer preview expires the older. | authoring | `RegisterSATWorkbookPreview` | Code review | V |
| A9 | Server clock only decides preview expiry (`expires_at > CURRENT_TIMESTAMP`). | DB | same | n/a to safety | V |
