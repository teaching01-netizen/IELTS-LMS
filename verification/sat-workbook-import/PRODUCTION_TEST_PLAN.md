# PRODUCTION_TEST_PLAN

Status of every item here: **NOT_TESTED against a real MySQL** in this engagement
(no `TEST_MYSQL_DSN`, no Docker on the workstation). The mocked (sqlmock) and
Lean evidence do not replace them. Run with `TEST_MYSQL_DSN` set against a
production-like MySQL (same version, RR, `innodb_lock_wait_timeout`, pool size).

## Already written (compile, skipped without a DSN)
`backend/go/cmd/api/sat_single_module_import_mysql_test.go`:
* `TestSATSingleModulePreviewAndCommitHTTPMySQL` — HTTP preview → commit contract.
* `TestSATSingleModulePreservesOtherModulesAndUndoMySQL` — REQ-2, REQ-5 (replay after ledger purge), REQ-6.
* `TestSATMultipleModulesImportReplacesOnlySelectedMySQL` — several detected modules + undo.
* `TestSATSingleModuleTwoInstanceRaceMySQL` — two instances, one shared DB, REQ-1/REQ-4.
* `TestSATWorkbookRejectsTamperedRequestsMySQL` — REQ-3 (content and pretest-flag tampering).
* `TestSATSingleModuleTransactionRollsBackLateReceiptFailureMySQL` — atomicity (A1) via an injected trigger.
* `TestSATFullWorkbookImportCompatibilityMySQL` — six-module sheet.

## Hostile schedules to add/confirm (barrier-coordinated, no sleeps)
| # | Schedule | Expected invariant |
|---|---|---|
| H1 | Two goroutines commit the **same** preview with different keys | exactly one applies; other gets 409; `effects`=1 |
| H2 | Commit succeeds, ACK dropped, retry with same key and same body | identical result, draft revision +1 only |
| H3 | Same key, body differs by one pretest flag | 409, no change |
| H4 | Author B edits a target module between preview and commit | 409 revision conflict; B's edit intact |
| H5 | Ledger row deleted, then retry with same key | replay from receipt, no second effect (REQ-5) |
| H6 | Retry arrives while first still in flight (lock held) | blocks on key insert, then replays; never two effects |
| H7 | Kill API process after `COMMIT` before response | retry replays; after `COMMIT` failure retry applies once |
| H8 | **New (finding 1)** Concurrent author mutation landing between the receipt read and the exam-row lock | commit sees fresh state or conflicts; checkpoint equals the live draft at lock time |
| H9 | Undo racing a new edit | undo refused (revision moved); edit intact |
| H10 | Publish a draft with a freshly imported module (0 pretests) | blocked by `sat.module.pretest_count` inside the publish tx |

## Load/soak profile to run before relying on this at scale
Realistic: 4 API instances, pool 25/instance, 1 exam, 5 concurrent authors, 147-row workbooks
with 20 images, 10% commit-retry rate, 1% injected aborts. Measure p50/p95/p99 of
preview and commit, lock-wait time on `exam_entities`, 409 rates, deadlocks,
`sat_workbook_import_scopes` row growth. Observability: counters for conflict
reasons (revision / digest / key reuse / expired), receipt replays, and a periodic
invariant query: `SELECT import_id FROM sat_workbook_imports WHERE state='committed'` joined to
receipts to assert one receipt per committed import.
