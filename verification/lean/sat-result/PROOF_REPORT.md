# SAT result verification report

Requirement interpretation: [SPEC.md](SPEC.md). Per-row status:
[TRACEABILITY.md](TRACEABILITY.md). The formerly referenced
`docs/sat-result.md` source file is absent from this checkout.

## Verdict

| Field | Value |
| --- | --- |
| **Formal status** | **PROVED** for every theorem in `Safety.lean` (now including `ConvertTopo`, `practice_never_released` and `RepairQueue`): the pinned Lean 4.19.0 kernel build, the 154-entry axiom audit and an independent kernel replay (`Replay.lean`) all exit 0, with no `sorry`, `admit`, custom `axiom` or `native_decide`. **NOT_RUN** for PDF-05, PDF-07, PDF-08 and PDF-09, which have no theorem. |
| **Correspondence status** | **REVIEWED_WITH_TESTS** for implemented rows, including global converted scores and the classroom-only release gate. The global score-conversion model is separate from the older result/release model; no row is MECHANIZED to Go/SQL. |
| **Production evidence** | **PARTIAL.** <br>• MySQL 9.6.0 and **8.4.9** scratch DBs: result flow, publish gate and answered-exam suites pass under `-race` ([mysql84-suite.txt](evidence/mysql84-suite.txt), 59 PASS). <br>• Multi-worker repair soak (6 pools, flag toggling) plus a 5× `-race` re-run: all invariants hold ([mysql-result-soak.txt](evidence/mysql-result-soak.txt)). <br>• Playwright print fidelity (PDF-05/10) in 3 engines. <br>• Not known: production instance count and `transaction_isolation` (U-1, U-2). |
| **Overall** | **CONDITIONAL.** Production topology and isolation level remain UNKNOWN; correspondence is reviewed, not mechanized; and legacy published versions were not audited. This turn's score-conversion check is local MySQL evidence, not production evidence. |

### SAT classroom conversion check (2026-10-15)

- `sat.LoadResultForAttempt` and `results.GetSATResult` both apply `satscoring.Overlay` to the read payload. The student-safe projection still requires `release_status = 'released'`; report materialization requires the score-report flag and classroom session mode.
- `TestSATGlobalScoreConversionIsRetroactiveMySQL` passed on a disposable local MySQL 9.6.0 schema migrated through 0089. It verified student and staff estimates update after publish while the stored result payload stays byte-identical. `TestSATPracticeSittingNeverReleasesWithReportOnMySQL` also passed.
- `go test -count=1 ./internal/satconvert ./internal/satscoring ./internal/terminalization` passed with the same MySQL DSN, including database-backed policy and fail-closed cases. The disposable database was dropped afterward.
- The active policy configured in any production database and the calibration accuracy of its table values were not inspected. The Lean policy theorems prove their abstract model; they do not establish Go/SQL refinement or compose conversion with the result-release model.

### NOT ESTABLISHED

| Item | Why |
| --- | --- |
| Psychometric validity of the active table values | No authoritative calibration reference was supplied or compared. The local integration test proves the read path applies a published policy, not that its values match College Board or any approved calibration. |
| Mechanized end-to-end score conversion refinement | The current global Lean model proves abstract lookup/publish/display properties, but does not model Go topology assignment or combined totals, and is not composed with this package's classroom release gates. |
| Server PDF endpoint, staff export, PDF-08 for that endpoint, PDF-09 | Not implemented. The product prints in the student's browser. R-2. |
| PDF-05 (long passages, figures, equations without clipping) | Rendering fidelity is outside the model and untested in a real browser. R-5. |
| Multi-instance repair and MySQL 8.4 | Only one host on MySQL 9.6.0 was run (U-1, U-2). R-8. |

## Reproducible Lean evidence

Run from `verification/lean/sat-result/`:

```text
lean-toolchain: leanprover/lean4:v4.19.0
Lake project:   satResult (lakefile.lean); Lean core only, no Mathlib
Lean:  Lean (version 4.19.0, arm64-apple-darwin23.6.0, commit 6caaee842e94, Release)
Lake:  Lake version 5.0.0-6caaee8 (Lean version 4.19.0)
```

```bash
rm -rf .lake/build && lake build      # Model, Safety, Counterexamples, SatResult, AxiomAudit
lake env lean AxiomAudit.lean         # #check + #print axioms for 116 declarations
```

- Build: [evidence/lean-build.txt](evidence/lean-build.txt). Clean rebuild, `Build completed successfully`, `exit: 0`.
- Axiom audit: [evidence/lean-axiom-audit.txt](evidence/lean-axiom-audit.txt), `exit: 0`.
- Source identity: [evidence/source-snapshot.json](evidence/source-snapshot.json).

### Axiom audit

`AxiomAudit.lean` prints the axioms of 116 declarations: every Safety theorem
cited in TRACEABILITY, plus every counterexample and witness.

| Axioms | Count |
| --- | --- |
| none | 26 |
| `propext` | 26 |
| `Quot.sound` | 1 |
| `propext`, `Quot.sound` | 30 |
| `propext`, `Classical.choice`, `Quot.sound` | 33 |

- **Accepted:** the three standard axioms.
- **Found nowhere:**
  - `sorryAx` (0 occurrences);
  - `Lean.ofReduceBool` (no `native_decide`);
  - any custom `axiom` (a grep of the sources finds none).
- **Not run: `leanchecker`.** The pinned toolchain does not ship it ([evidence/leanchecker.txt](evidence/leanchecker.txt)). Building `lean4checker` from upstream was denied by this session's permission policy. The checks performed are the kernel build and the transitive `#print axioms`. RECOMMENDATIONS R-9.

## Proved theorem groups (`Safety.lean`)

- **Convert** (CONV-1, CONV-2):
  - `convert_sound`, `convert_complete`: a number is returned iff the table holds an integer entry in `[200, 800]`.
  - `convert_fails_closed`: `null`, missing and off-scale entries give no number.
  - `convert_refines_old`: the fix agrees with the old decoder wherever the old one was right.
  - `convert_local`: the result depends only on the `(section, route, raw)` entry.
  - `total_requires_both`, `total_in_range`, `total_absent_single_section`.
  - `normalizedRaw_bounds`, `normalizedRaw_mono`, `normalizedRaw_full`, `tdiv_eq_ediv_nonneg`.
- **Scoring** (SCORE-1):
  - `score_fold`, `score_raw`, `score_op`, `score_le`;
  - `score_pretest_irrelevant`: pretest rows change neither the raw score nor the operational count.
- **Report** (RPT-1, RPT-2):
  - `group_exact`, `group_keys_unique`, `group_keys_cover`, `group_section_exact`, `group_totals`: one section per key in first-appearance order, with exact per-key sums, even when sections interleave.
  - `scoreAll_spec`, `reportOf_spec`, `report_requires_all_scored`, `report_complete`, `report_bounds`.
  - `classroomRaw_disabled`.
- **ResultMachine** (REL-1…REL-3, LIVE-1):
  - `inv_init`, `inv_step`, `inv_reachable`, for every action in every reachable state:
    - `lateScore`, `rescore`, `toggle`;
    - `submit` with or without a failed read;
    - `terminate` by either actor;
    - `repair`.
  - Corollaries:
    - `released_report_faithful`: released ⇒ scored and `raw = reportOf mods`;
    - `released_only_when_enabled`, `released_rows_scored`, `never_started_no_result`;
    - `submit_idempotent`, `terminate_idempotent`, `released_immutable`.
  - Conditional liveness: `submit_releases`, `repair_releases`.
  - Limitations: `report_blocked`, `zero_op_never_released`.
- **Release** (REL-4):
  - `visible_only_released`, `studentSafe_release`, `studentSafe_payload`, `studentSafe_withheld`;
  - `client_gate`, `student_sees_only_released_raw`;
  - `student_view_gate`: the student sees `classroomRaw` only while the flag is on and the row is released.
- **Attach** (STAFF-1): `attach_exact`, `attach_sound`, `attach_complete`.
- **Paper** (PAPER-1…3):
  - `circle_iff`, `circle_exact` (given `opts.Nodup`, A-OPT);
  - `unanswered_none`, `unmatched_no_circle`, `exactly_one_indication`;
  - `fold_untouched`, `answer_unique`, `answer_absent`;
  - `complete_iff`.
- **PrintGate** (PRINT-1, PRINT-2, LIVE-2):
  - `inv_init`, `inv_step`, `inv_reachable`;
  - `print_gate_sound`: every printed paper is complete, fully decoded, free of media failures, current-generation and re-read after the click;
  - `single_flight`, `poll_can_end`.
- **CloseAck** (PRINT-3): `closed_server_frozen`, `sealed_reload_faithful`.
  - `reload_faithful` is **definitional**: the re-read copies the server.
  - The content of PRINT-3 is the other two theorems. They rest on A-IMM.

## Fixed during this verification

Each row has a Lean counterexample for the old behaviour and/or a test that was
shown to fail with the fix reverted. Details and test names:
[RECOMMENDATIONS.md](RECOMMENDATIONS.md#done-in-this-verification).

| Defect | Plan row | Evidence of the old behaviour |
| --- | --- | --- |
| `null` conversion entry → 0; off-scale entry accepted | SC-05 | `old_fabricates_from_null`, `old_accepts_out_of_range` |
| Interleaved sections → duplicate report sections | SC-01 / RPT-1 | `adjacent_duplicates` |
| Shared module key → module nested in the wrong section (staff) | STAFF-1 | `old_misattaches` |
| Unmatched answer printed as blank | PDF-01 | `unmatched_was_silent` |
| Download printed an unready paper | PDF-10 | `old_prints_unready` |
| Rejected in-flight edit shown on the paper | SC-07 / PDF-10 | `close_ack_stale` |
| **Schedule version rebind after candidates joined** (proctor-start sessions) | PDF-07 | mutation of `TestUpdateFreezesVersionOnceCandidatesJoined` (the old placement fails it) |
| **Duplicate option ids accepted at publish** | PDF-01 / A-OPT | `duplicate_ids_double_circle`; mutation of the unit test and the MySQL publish test |

## Counterexamples and limitations kept

These hold in the model. ASSUMPTIONS rates each one's reachability in production.

| Theorem | Meaning | Production |
| --- | --- | --- |
| `zero_op_stuck`, `zero_op_never_released` | A module with no operational questions blocks release forever | Unreachable through the publish gate (A-PUB). Legacy versions: R-6 |
| `released_then_invalidated` | A terminate after release invalidates the row | Unreachable (A-RCPT: a submitted receipt cannot be re-sealed) |
| `flag_late_release`, `flag_off_hides_released` | Flag changes apply to past attempts | Intended ("a change applies to past attempts too") |
| `duplicate_ids_double_circle` | Two circles with duplicate ids | Now rejected at publish |

## Hostile executions considered (Phase 4)

| Schedule | Outcome | Basis |
| --- | --- | --- |
| Submit and timeout race to seal | One receipt and one result row. The loser gets the same row back or a 409 | A-DB unique keys, A-RCPT. `TestSATV2SubmitAndTimeoutReconcileRaceWithProductionSealer`, 20× `-race` |
| Submit vs proctor terminate (different outcomes) | The second seal is refused (409). A released row is never invalidated | `OutcomeCompat`, `TestSubmitVsTerminateCrossOutcomeConflicts` |
| Two or more repair runners | Each row is released at most once, with the report computed from its module rows | `FOR UPDATE OF ar` + guarded `UPDATE`, modelled as atomic `repair` steps in any interleaving. `TestRepairClassroomResults` (unit). Concurrent runners on MySQL were **not** run (U-1, P-1). The two-binary MySQL test covers staff routing, not repair |
| Module scored after the seal | The row stays pending, and repair releases it once every module is scored | `lateScore` + `repair_releases` |
| Score read fails inside the seal | The receipt is kept and the row stays pending | `submit … readFails`, `TestClassroomScoreFailureKeepsReceiptAndWithholds` |
| Flag toggled at any time | Release requires the flag at the moment of release. Visibility follows the flag at read time | `toggle`, `released_only_when_enabled`, `student_view_gate` |
| Edit in flight when the module closes; ack lost | The paper shows the server's accepted answers after the re-read | `close_ack_stale` (old), `sealed_reload_faithful`, A-IMM |
| Re-read fails; a figure fails or never loads; double click | No print; the button is re-enabled; one flow at a time | `print_gate_sound`, `single_flight`, `poll_can_end` |
| Proctor resets a session and rebinds the version | **Was possible** (bug). Now refused once any attempt exists | `TestUpdateFreezesVersionOnceCandidatesJoined` |
| Author repeats an option id | **Was possible** (gap). Now refused at publish | `sat.choice.id.duplicate` tests |
| Read replica on bootstrap | A freshly released report can be briefly invisible. That is a delay, not a wrong score | A-RAW, UNKNOWN in production |
| Admin resets status and deletes the schedule | Sealed results are protected by the FK RESTRICT, which surfaces as a raw error. Unsealed attempts cascade | R-4 |
| Deploy version skew, migration mid-flight | Not modelled | Out of scope; recorded |

## Anti-vacuity review

- **Vacuous truth.** The safety invariants have witnesses showing the guarded outcome is reachable:
  - `release_reachable`: a released state is reachable;
  - `report_exists`: a report is produced;
  - `print_reachable`: a print happens;
  - `flag_off_hides_released`: the same released row is visible with the flag on and hidden with it off.
- **`Init` is not handpicked.** `ResultMachine.Init` is every unsealed attempt with no result row, with any module rows, flag and `started`. `PrintGate.init` is the real mount state. `CloseAck` theorems quantify over arbitrary server and cache contents.
- **The model is more permissive than production in three places, so the safety claims are conservative:**
  - `terminate` may follow `submit`;
  - `lateScore` writes any values at any time;
  - `toggle` is unrestricted.
- **Atomicity has a DB basis.** `submit`, `terminate` and `repair` are single steps because each is one MySQL transaction over a unique-keyed row (A-TX, A-DB). Repair runners are therefore any interleaving of atomic steps, for any number of runners.
- **Not proved:**
  - capacity;
  - liveness without A-FAIR;
  - anything about browser pixels;
  - any equivalence between the Lean and the code beyond review plus tests (no row is `MECHANIZED`).

## Other test evidence

| Check | Transcript | Result |
| --- | --- | --- |
| Go packages: sat, terminalization, results, delivery, schedules, satpublish, exams, cmd/api | [go-tests.txt](evidence/go-tests.txt) | all `ok`, exit 0. Includes three mutation notes |
| MySQL: migrate a fresh scratch DB to 0085 | [mysql-migrate.txt](evidence/mysql-migrate.txt) | ok |
| MySQL: result flow, 9 tests, `-race` | [mysql-result-flow.txt](evidence/mysql-result-flow.txt) | all PASS |
| MySQL: 20× soak of the race tests, `-race` | [mysql-result-soak.txt](evidence/mysql-result-soak.txt) | ok |
| MySQL: receipt immutability and cross-outcome conflict | [mysql-receipt.txt](evidence/mysql-receipt.txt) | PASS |
| MySQL: publish gate, `-race` | [mysql-publish.txt](evidence/mysql-publish.txt) | all PASS, including `duplicate_choice_id`; mutation fails it |
| vitest: student delivery, exam rendering, release UI | [unit-suite.txt](evidence/unit-suite.txt) | 158 files, 1564 passed, 2 skipped |
| `bunx tsc --noEmit` | [typecheck.txt](evidence/typecheck.txt) | exit 0 |
| eslint on the changed files | [eslint.txt](evidence/eslint.txt) | 0 errors. 6 warnings already present at HEAD |

**Already present at HEAD (`2c319e59`), not introduced here:**
- `go vet` copylocks in `delivery/close_module.go:156` and `delivery/service.go:437` (`snapshot := *s`; line 418 at HEAD);
- `gofmt` on `schedules/runtime_plan_sections_test.go`;
- the 6 eslint warnings listed in `eslint.txt`.

## Source identity

- Base commit `2c319e59`, plus the uncommitted working tree of
  `feat/sat-bluebook-overlays-tools`.
- SHA-256 hashes of the Lean sources and every application file cited are in
  [evidence/source-snapshot.json](evidence/source-snapshot.json).
- **Re-run this verification if any hashed file changes.**
