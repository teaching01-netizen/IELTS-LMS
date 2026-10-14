# RECOMMENDATIONS

## Fixed in this engagement
| # | Severity | Finding | Fix | Regression evidence |
|---|---|---|---|---|
| F-1 | Medium (latent data-integrity) | The receipt `SELECT` ran **before** the exam-row `FOR UPDATE` in a REPEATABLE READ tx, fixing the snapshot early; the target-module, question-id and checkpoint-clone reads that follow would read pre-lock data. Currently masked only by A4 (revision CAS). | Receipt lookup moved to just after the exam-row lock and before the revision check (`workbook_import.go`), still non-locking to avoid gap-lock deadlocks. | `expectReplaceGates` now enforces lock → receipt → revision order; new `TestWorkbookCommitReplaysFromReceiptWithoutTouchingDraft`, `TestWorkbookCommitRejectsReceiptKeyReuseWithDifferentPayload` |
| F-2 | Medium (wrong module marked/blocked) | Picture/asset issues carry other sheets' row numbers; the module attribution used row → module from Questions, so e.g. an Assets-sheet issue on row 5 was blamed on the module owning Questions row 5. | Attribution restricted to issues raised while parsing Questions rows (`questionIssuesFrom/To`). | `TestIssuesFromOtherSheetsAreNeverAttributedToAModule` (failed before the fix) |
| F-3 | Low (misleading UX) | Workbook-wide blockers (formula, bad label, oversized cell) left every module "Ready" yet the hint said "Fix the modules marked Needs attention". | Hint now says "Fix the workbook issues listed under Needs attention…" when no module is flagged. | Sheet test "points at the workbook-wide issues…" |

## Open — ranked
| # | Severity | Item | Recommendation |
|---|---|---|---|
| R-1 | High until run | No MySQL integration/concurrency test has been executed (H1–H10). | Run the existing suite with `TEST_MYSQL_DSN` in CI against production-equivalent MySQL; add H8 as an explicit test. |
| R-2 | Medium | Replayed result can carry a `Shell` older than the live draft (e.g. after later edits). Safe — the next write CAS-conflicts — but the UI adopts a stale shell. | On replay, return the stored result's `undo` plus a fresh `Shell` read, or have the UI refetch the shell after any replayed commit. |
| R-3 | Medium | A4 (every draft writer bumps `revision`) is reviewed, not enforced; REQ-4/REQ-6 depend on it. | Add a CI check/test that every function writing `assessment_exam_questions`, `assessment_modules`, or module settings in a draft calls `touch*Draft` (or bumps `exam_versions.revision`), or add a DB trigger-based invariant test. |
| R-4 | Low | Issues from Assets/Guide sheets are labelled "Questions · Row N" in the UI. | Add a `sheet` field to `SatWorkbookIssue` and show it. |
| R-5 | Low | Pretest is now unchecked until publish, so a module can sit in the draft with 0 or 3+ pretests. | Show a per-module "needs 2 pretests" hint in the editor readiness panel (publish already blocks). |
| R-6 | Low | Liveness (retry eventually completes) is unproved. | State SLO assumptions (availability, retry budget) before claiming it. |

## Verdict
**CONDITIONAL.** Formal: PROVED for the stated abstract model. Correspondence: REVIEWED_WITH_TESTS (assumptions A1, A3, A4 carry the gap). Production evidence: NOT_TESTED. Blockers for READY: R-1 (execute MySQL schedules) and R-3 (enforce A4).
