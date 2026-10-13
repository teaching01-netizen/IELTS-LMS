# Production test plan: executed evidence and remaining scenarios

## Executed

All MySQL runs used a throwaway scratch database, `sat_result_verify`, on local
MySQL 9.6.0. It was migrated fresh to 0085. The DSN was derived from
`backend/.env` by replacing the database name, with a shell guard that refuses
any other shape. Credentials are omitted from every transcript. `AUTH_SECRET`
was a fresh `openssl rand -hex 32`. No shared or production data was touched.

| Check | Command | Transcript | Result |
| --- | --- | --- | --- |
| Lean build (clean) | `rm -rf .lake/build && lake build` | [lean-build.txt](evidence/lean-build.txt) | exit 0 |
| Statement and axiom audit | `lake env lean AxiomAudit.lean` | [lean-axiom-audit.txt](evidence/lean-axiom-audit.txt) | 116 declarations; standard axioms only |
| Go packages | `go test -count=1 ./internal/{sat,terminalization,results,delivery,schedules,satpublish,exams}/... ./cmd/api/` | [go-tests.txt](evidence/go-tests.txt) | all ok |
| Migrate the scratch DB | `cmd/migrate` against the scratch DSN | [mysql-migrate.txt](evidence/mysql-migrate.txt) | to 0085 |
| Result flow | `go test ./cmd/api -run 'TestSATClassroom.*MySQL\|TestSATV2Submit\|TestSATTimeoutSealFailure' -count=1 -race -v` | [mysql-result-flow.txt](evidence/mysql-result-flow.txt) | 9 PASS |
| Race soak | the three race tests, `-count=20 -race` | [mysql-result-soak.txt](evidence/mysql-result-soak.txt) | ok |
| Receipt immutability | `go test ./cmd/migrate ./internal/terminalization -run 'TestReceiptImmutabilityMySQL\|TestSubmitVsTerminateCrossOutcomeConflicts'` | [mysql-receipt.txt](evidence/mysql-receipt.txt) | PASS |
| Publish gate | `go test ./cmd/api -run 'TestSATPublish.*MySQL' -count=1 -race -v` | [mysql-publish.txt](evidence/mysql-publish.txt) | all PASS, including `duplicate_choice_id` |
| Frontend | `bunx vitest run src/features/student-delivery src/features/exam-rendering src/features/exam-authoring/ui/release` | [unit-suite.txt](evidence/unit-suite.txt) | 1564 passed |
| Types and lint | `bunx tsc --noEmit`; `bunx eslint <changed files>` | [typecheck.txt](evidence/typecheck.txt), [eslint.txt](evidence/eslint.txt) | exit 0; no new findings |

**Mutation probes.** Each regression test written for a fix in this
verification was run against the reverted fix and failed. The source was then
restored and the test re-run:
- the schedule freeze;
- the live flag read;
- the duplicate-id check, both the unit test and the MySQL test.

The probes are recorded in `go-tests.txt` and `mysql-publish.txt`.

## Remaining scenarios

| ID | Scenario | Setup | Invariant checks | Closes |
| --- | --- | --- | --- | --- |
| P-1 | Multi-instance repair soak | 3+ API instances with the background runner enabled, one MySQL. 500 classroom attempts sealed while module scoring is delayed. Toggle the flag during the run | Per attempt:<br>• exactly 1 `assessment_results` row;<br>• `release_status='released'` ⇒ `classroomRaw` equals a recomputation from `assessment_module_attempts`;<br>• no row released with the flag off at release time.<br>Also every pending row reaches released within N runner periods once all of its modules are scored. | U-1, A-FAIR, SC-06 at scale |
| P-2 | MySQL 8.4 at production isolation | Re-run `mysql-result-flow`, the soak and `mysql-receipt` on 8.4 with the production `transaction_isolation` | Same PASS set. Count deadlocks and lock waits (`performance_schema.data_lock_waits`) | U-2 |
| P-3 | Browser print, end to end | Playwright: student finishes a classroom sitting → completion screen → Download. Variants: one figure URL blocked (expect "no PDF was made" and the button re-enabled); network offline during the re-read (expect no print) | `window.print` called only after every `img` is decoded and the re-read succeeded; at most one flow at a time | A-DOM, PDF-10 in a real browser |
| P-4 | Print fidelity | `page.pdf()` of `AnsweredExamPaper` for a long RW passage, a Math figure and a KaTeX item, in Chromium and WebKit | No clipped block; every figure has `naturalWidth > 0`; page count stable across runs | PDF-05, U-3 |
| P-5 | Read-after-write on bootstrap | Run P-1 with the production read topology. Poll bootstrap right after the seal response | A released report is visible on the first bootstrap after the seal, or the replica lag is measured | A-RAW |
| P-6 | Legacy published versions | Read-only queries over published versions: modules with zero non-pretest questions, and choice questions with repeated `options[].id` | Zero rows, or a remediation list | L-1, L-5 (R-6) |
| P-7 | PDF endpoint load (only if R-2 builds one) | N concurrent downloads per instance against a bounded pool | Bounded queue, 429 on overflow, no OOM; p95/p99 recorded | PDF-09 |

## Observability for rollout

- **Count `assessment_results` with `outcome_status='pending'` older than one runner period, by exam.** A rising count means a module was never scored, or L-1 on a legacy version.
- **Log repair outcomes per run.** Record rows released, rows skipped as unscored, and errors.
- **Alert on 409s from the seal path** (`OutcomeCompat`) and from `START_CODE_RELEASE_FROZEN`. Both are expected to be rare.
- **Log client-side print failures** ("no PDF was made") with the failing figure URL host, to tell media failures apart from re-read failures.
