# Recommendations (ranked)

| # | Severity | Change | Proof / test impact |
| --- | --- | --- | --- |
| R-1 | High | Run P-1…P-3 (multi-instance publish, MySQL 8.4, crash points) before the first production publish. | Turns A-LOCK/A-TX from tested-once to validated in profile. |
| R-2 | High | Ship a content-tolerant parser one release **before** any content field is added (L-3), and keep `TestContentChecksumIsPinned` green. | Prevents a rollback from withholding all scores. |
| R-3 | Medium | Add a scheduled invariant query (P-6) and alert on `integrity`. | Detects bypass of A-IMM (direct DB edits, TiDB). |
| R-4 | Medium | If the production engine is TiDB, add a DB-level guard (privilege separation: the app role cannot `UPDATE` published rows except via the publish path) to replace the missing triggers. | Restores G-1 defense in depth. |
| R-5 | Low | Make `POST /drafts` idempotent with the existing `Idempotency-Key`/operation-key ledger if duplicate drafts become a nuisance (L-1). | No safety impact. |
| R-6 | Low | Extend the Lean model to per-subject sections and ranges, and to the release gates jointly with `../sat-result` (L-7). | Closes the modelling gaps listed in PROOF_REPORT. |
