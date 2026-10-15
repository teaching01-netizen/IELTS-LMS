# Recommendations

Ranked by correctness severity and proof impact. Each item names the exact
change and how to regression-proof it. Items already fixed in this verification
are listed first. Open items keep the `R-n` numbers that SPEC, ASSUMPTIONS and
TRACEABILITY cite.

## Done in this verification

Every fix has a test that was shown to fail when the fix is reverted, or a Lean
counterexample that pins the old behaviour (`Counterexamples.lean`).

| Fix | Where | Lean | Regression test |
| --- | --- | --- | --- |
| A `null` conversion entry decoded to a fabricated 0; an off-scale entry (e.g. 7000) was returned | `PolicyScorer.ScoreSection` (`sat/service.go:88`): pointer decode, `[200, 800]` check | `old_fabricates_from_null`, `old_accepts_out_of_range` → `convert_sound`, `convert_fails_closed` | `TestPolicyScorerRejectsNullAndOffScaleEntries` |
| Interleaved RW/Math module rows produced duplicate report sections (adjacency grouping) | `classroomRawScoreTx` (`terminalization/service.go:1042`): one section per key | `adjacent_duplicates` → `group_exact` | `TestClassroomRawScoreGroupsInterleavedSectionsOnce` |
| Staff view put a module in the wrong section when both sections share a module key | `attachSATModules` (`results/service.go:1057`): nest by `sectionKeys[i]` | `old_misattaches` → `attach_exact` | `TestAttachSATModulesKeepsSharedModuleKeysInTheirSections` |
| An answer matching no option was printed as if blank | `AnsweredExamPaper`: "unmatched" note | `unmatched_was_silent` → `exactly_one_indication` | `marks the paper: chosen option circled, SPR boxed, unmatched and unanswered labelled` |
| Download printed whatever was mounted, before figures decoded | `printAnsweredExam` + `answeredPaperReady` (`SatScoreReport.tsx:55`, `:85`) | `old_prints_unready` → `print_gate_sound` | `never prints when a figure cannot load`, `is ready only when every figure shows a decoded image` |
| An answer in flight at module close showed on the paper though the server rejected it | re-read of the attempt before printing | `close_ack_stale` → `sealed_reload_faithful` | `re-reads the attempt before printing and prints the fresh answers`, `never prints when the attempt cannot be re-read` |
| **PDF-07.** A proctor-start session reset to `scheduled` could be rebound to another version, so completed papers showed new questions against old answers | `schedules.Update` (`schedules/service.go:547`): freeze the version once any attempt exists, every start mode | none (A-PIN) | `TestUpdateFreezesVersionOnceCandidatesJoined` |
| **A-OPT.** Nothing rejected duplicate option ids; two choices then counted as one answer for grading and drew two circles | `satpublish.validateChoiceAnswer` (`sat.choice.id.duplicate`); listed under "Answer choices" in `releaseSelectors.ts` | `duplicate_ids_double_circle` (now unreachable at publish) | `TestValidateQuestionFlagsEachRequiredChoiceAndAnswerRule/duplicate_choice_id`, `TestSATPublishRejectsEachContentViolationMySQL/duplicate_choice_id` |
| **LIVE-1 / A-FAIR.** Repair head-of-line starvation: the sweep took the oldest `LIMIT n` pending rows, and rows that could not be released yet (an unscored module) kept their slot forever, so ≥ n of them starved every newer releasable result | `classroomPendingSQL` (`terminalization/service.go`) now selects only releasable rows, mirroring `classroomRawScoreTx`'s nil conditions | `old_starves_ready` → `sqlReady_iff`, `every_ready_released` | `TestSATClassroomRepairNotStarvedByWithheldMySQL` (failed before the fix), `TestSATClassroomRepairSoakMySQL` |
| **REG-01.** Standard Practice sittings of backfilled exams released the raw report (was R-3) | gate is `sat_score_report_enabled AND sat_session_mode='classroom'` | `practice_never_released`, `step_classroom` | `TestSATPracticeSittingNeverReleasesWithReportOnMySQL` |
| **R-9.** Independent kernel re-check | `Replay.lean` (core `Environment.replay`, lean4checker default mode); self-test rejects a forged proof of `False` | all theorems of Model, Safety, Counterexamples replayed | [evidence/leanchecker.txt](evidence/leanchecker.txt) |

The live flag read at bootstrap (`loadBootstrapResult`, `delivery/service.go:580`)
is pinned by `TestLoadBootstrapResultReadsScoreReportFlagLive`. Removing the
gate fails it.

## R-1. Score conversion wiring (implemented by migration 0087)

The former recommendation to wire classroom estimates is superseded. The
global, versioned policy resolves released `classroomRaw` results at read time
on both student and staff surfaces. It distinguishes full lower/higher
topologies from standalone Module 2, requires exact operational dimensions,
and fails closed when a mapping is absent. `TestSATGlobalScoreConversionIsRetroactiveMySQL`
verifies both read surfaces and that publishing does not rewrite the stored
result. `sat-score-conversion` contains the separate abstract Lean model.

No wiring change is currently indicated. Remaining boundaries are the
psychometric approval of table values, production database/configuration
evidence, and the lack of a mechanized refinement connecting Go's topology and
total logic to the Lean models.

## R-2. Decide the PDF design: build the endpoint or accept client print (PDF-08, PDF-09)

**Severity: medium (a spec gap, not a defect).** The plan specifies
`GET …/answered-exam.pdf` with staff export and bounded rendering. The product
prints in the student's browser. That design leaks nothing: the paper is built
from the bearer's own keyless bootstrap (A-SESS, A-KEYLESS), and there is no
server work to bound. Either:

- **accept it**: update the local `SPEC.md` and drop PDF-08/09 for the endpoint,
  or
- **build it**: an authenticated handler that resolves the attempt from the
  bearer or staff role (never from a path id alone), renders from the pinned
  version (A-PIN), and runs on a bounded worker pool with a queue limit and 429
  on overflow. Test it with the same oracle as PDF-08 (another student's id →
  403) and a load test for PDF-09.

## R-3. Classroom-only score-report gate (implemented)

The release predicate now requires both `sat_score_report_enabled` and
`sat_session_mode = 'classroom'` in `SATScoreReportOpenSQL`. The backend
integration test `TestSATPracticeSittingNeverReleasesWithReportOnMySQL` passes
for a Standard Practice sitting with the report flag on. No additional gate
change is indicated.

## R-4. Validate schedule status changes and make Delete refuse cleanly

**Severity: medium (admin data integrity).** `schedules.Update` stores any
`Status` it receives (`handlers_admin.go:594` passes it through). `Delete`
checks only `status == scheduled`, and `student_attempts` cascades on schedule
delete (0006). After a status reset:
- unsealed attempts are deleted silently;
- sealed ones are protected only by the `attempt_terminalizations` foreign keys
  (0043, RESTRICT), so the admin gets a raw FK error rather than a 409.

Change:
- Accept only forward transitions in `Update`.
- In `Delete`, return `CodeConflict` when
  `EXISTS(SELECT 1 FROM student_attempts WHERE schedule_id = ?)`, under the same
  `FOR UPDATE` lock.

Regression: sqlmock tests mirroring `TestUpdateFreezesVersionOnceCandidatesJoined`.

## R-5. Real-browser print snapshots (PDF-05, U-3, A-DOM)

**Severity: medium.** Long passages, figures and KaTeX in print are untested,
and the readiness check (`img.complete && naturalWidth > 0`) has only been run
in jsdom. Add a Playwright test that:
- renders `AnsweredExamPaper` for a long RW passage and a Math item with a
  figure and an equation;
- calls `page.pdf()`;
- asserts no element is clipped (`scrollHeight <= clientHeight` per block) and
  that each figure's `naturalWidth > 0`.

Add one case that blocks a figure URL and asserts the download shows
"no PDF was made".

## R-6. Audit versions published before the validators (L-1, L-5)

**Severity: low.** A-PUB and A-OPT hold for releases that passed today's
publish gate. Versions published earlier were not checked. Run two read-only
queries over published versions:
1. A module with zero non-pretest questions (L-1: its report would stay pending
   forever).
2. A choice question whose `options[].id` repeat (L-5).

Republish or patch any hits.

## R-7. Replace the silent staff cap (L-7)

**Severity: low.** `satQuestionsQ … LIMIT 500` (`results/service.go:1129`)
truncates silently. SAT exams are far below the cap (98 questions). Either
page, or select 501 rows and return an explicit error when the 501st exists.

## R-8. Close the production-evidence gap (U-1, U-2)

**Severity: medium for `READY`.** Run PRODUCTION_TEST_PLAN P-1 (multi-instance
repair soak) and P-2 (MySQL 8.4 at the production `transaction_isolation`).
Until then, SC-06 is validated only in the local single-host profile.

## R-9. Allow the independent kernel re-check

**Severity: low (assurance).** The pinned toolchain ships no `leanchecker`, and
building `lean4checker` was denied in this session. Allow it in CI, or run
`lake env lean4checker` locally, and attach the output to `evidence/`.

Not recommended: a guard against terminating a released result. Under A-RCPT a
submitted receipt can never be re-sealed as terminated, so L-2 is unreachable
without it.
