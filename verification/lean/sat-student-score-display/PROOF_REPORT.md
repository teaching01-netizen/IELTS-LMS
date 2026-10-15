# Proof report

## Verification target

Pure transformation from a released, normalized SAT Classroom report to the
student-facing score values and score details. The target behavior is: with a
configured converter, missing/invalid section or combined estimates render
`-`; any valid estimate and all accepted raw details remain visible; with no
converter, existing raw fallbacks remain. The adaptive threshold and an
already-selected force-higher policy are also modeled because they determine
which route topology reaches the report.

This proof does not model release authorization, database writes, API
transactions, adaptive module lifecycle, a real browser, or deployment state.
The complete interpretation and exclusion boundary are in `SPEC.md`.

## Verdict

| Status field | Result |
| --- | --- |
| **Formal status** | **PROVED** for the named theorems about `proof/Model.lean`; all theorem terms were checked by Lean 4.19.0 and re-played through `Lean.Environment.replay`. |
| **Correspondence status** | **REVIEWED_WITH_TESTS** for the TypeScript/React display path and selected-route policy. No mechanized refinement from TypeScript/Go to Lean. |
| **Production evidence** | **PARTIAL**: local TypeScript, React component, Go route, and Lean verification passed. No deployed browser smoke, production topology, or accessibility-device evidence. |
| **Overall decision** | **CONDITIONAL**. The requested UI behavior is implemented and locally verified. Confirm converter metadata and browser output in the release environment before claiming deployment validation. |

## Proved properties

`proof/Safety.lean` proves:

- adaptive routing is lower below the configured threshold and higher at or
  above it, when the operational count and threshold are valid;
- a selected force-higher policy returns the higher route for every valid raw
  count;
- a configured converter plus an unavailable or malformed section estimate
  produces `dash`; without a converter, an unavailable estimate uses raw
  correctness;
- a valid section estimate remains visible;
- when the combined score is missing, valid section estimates remain while
  the combined slot is `dash`; when a valid total is available, the total and
  section estimates remain visible;
- a missing section estimate in a full SAT report displays `dash` while the
  other section estimate and both sections' raw detail structures remain;
- no-converter full reports with no converted sections retain the raw combined
  count;
- score-view projection preserves raw, module, and domain details; malformed
  section shape yields the unavailable state; and dash rendering is exactly
  `"-"`.

Concrete non-vacuity witnesses are in `proof/Counterexamples.lean`: an active
converter miss yields dash, and the same missing conversion without a
converter retains the prior raw score and detail rows. `proof/AxiomAudit.lean`
prints exact theorem statements (`#check`) and transitive axioms.

## Toolchain and reproducible checks

Base source commit: `0f2f1a10c90500094faeff34054a3df6d2231443`, with the
implementation and proof changes present as uncommitted working-tree changes.
The hashed Lean and implementation files are listed in
`evidence/source-sha256.txt`.

- Toolchain: `leanprover/lean4:v4.19.0` (Lean commit `6caaee842e94`), Lake
  5.0.0; no external Lake packages (`lake-manifest.json`).
- `lake build` — exit 0; includes the axiom audit. Full output and exact
  statements: `evidence/lean-build.txt`.
- `lake env lean proof/AxiomAudit.lean` — exit 0; transitive axiom listing:
  `evidence/lean-axiom-audit.txt`.
- `lake env lean --run Replay.lean proof.Model proof.Safety proof.Counterexamples proof.AxiomAudit`
  — exit 0. Replay re-checked every theorem in Model, Safety, and
  Counterexamples; its forged proof-of-`False` self-test was rejected. See
  `evidence/lean-replay.txt`.
- Audited dependencies contain only Lean's standard `propext`,
  `Classical.choice`, and `Quot.sound`; no custom axioms, `sorry`, `admit`, or
  `native_decide` occur in project Lean source.
- Existing related `verification/lean/sat-classroom`, `sat-result`, and
  `sat-score-conversion` projects also completed `lake build` during this
  pass. This verifies their current proof projects compile; it does not expand
  their production evidence.

## Local implementation evidence

| Check | Result |
| --- | --- |
| Focused view-model and score-display component tests | 2 files, 21 tests passed (`evidence/vitest.txt`) |
| `bun run typecheck` | Passed (`evidence/typecheck.txt`) |
| ESLint on changed score-report components/model/tests | Passed (`evidence/eslint.txt`) |
| Go adaptive threshold and classroom force-higher tests (`-count=1`) | Passed (`evidence/go-routing-tests.txt`) |
| `git diff --check` | Passed |

The UI tests include blank and malformed converter metadata, integer and
10-point score validation, malformed counts, active-converter section/total
misses, available section estimates, raw fallback, and retained module/domain
details alongside the rendered dash.

## Hostile cases and limits

| Case | Outcome / boundary |
| --- | --- |
| Adaptive `X-1`, `X`, `X+1` correct | Lean boundary is inclusive; Go test exercises 12/13/14 for `X=13` and 25 operations. |
| Classroom force-higher with low raw score | Model and Go test confirm the selected forced policy ignores the M1 score. Plan selection and transactional route commit are outside this project. |
| Missing one section conversion | Missing section and combined score become dash; valid sibling estimate and details remain. |
| Missing total after both sections convert | Combined score becomes dash; both section estimates remain. |
| Fractional/off-step/out-of-range/inverted intervals | TypeScript rejects them as estimates; with active converter they display dash. Lean proves the integer, 10-step interval rule, including a 605-point counterexample. JS number parsing is a tested refinement, not a Lean theorem. |
| Fractional/negative/over-total raw counts | TypeScript rejects invalid section shape or drops invalid module/domain rows; component tests cover visibility of valid remaining details. Raw counts are `Nat` in the Lean model. |
| Duplicate/unrecognized section structure | The modeled invalid shape fails closed. The TypeScript tests also cover duplicate, invalid, and unknown sections. |
| Deadline/save race, lost submit ACK, concurrent closure workers, crash/restart, stale replica, and unselected branch access | Not exercised by this pure display verification. See `PRODUCTION_TEST_PLAN.md`; relevant existing classroom/result proofs and their own stated gaps remain separate. |

The model is not vacuous: it contains successful report views, active and
absent converter cases, adaptive lower/higher outcomes, available estimates,
raw fallbacks, and explicit unavailable witnesses. No state transition is
claimed, so there is no assumed atomic database step or liveness theorem.

## Refinement and production boundary

The mapping from Lean to `buildStudentScoreReportView`, `SatScoreOverview`,
`SatSubjectPerformance`, and `SatKnowledgeSkills` is hand-reviewed and tested.
The Lean model begins after JSON parsing, converter-string normalization, and
module/domain filtering. The release gate in `SatScoreReport.tsx` and the
backend conversion metadata/status are implementation dependencies, not part
of a mechanized refinement proof.

The production test plan requires a deployed-style report smoke for adaptive
and fixed-hard routes, a no-converter control, and screen-reader output. It
also records the separate timer/save, retry, concurrency, restart, replica,
and authorization obligations. Until those deployment facts are measured,
this change is locally verified but production correctness for a stated
deployment profile is not established.
