# Formal verification report

**Feature:** SAT staff result list/detail read model and question labels  
**Spec revision:** [`SPEC.md`](SPEC.md), captured 2026-10-15  
**Application base commit:** `8aa1d87ba5c8d264a0a039efda55a3c82c69a92a` (`feat/sat-bluebook-overlays-tools`)  
**Application source state:** dirty working tree; target-file hashes are in [`evidence/source-snapshot.json`](evidence/source-snapshot.json). Other in-progress authoring work was present and left untouched.  
**DB schema:** `assessment_results.score_payload` is MySQL JSON (migration `0032_provider_neutral_sat.sql`); the active global conversion pointer/revisions are introduced by migration `0087_sat_score_conversion.sql`. The migration runner identifies MySQL 8.4 as supported.  
**Production topology profile:** UNKNOWN.  
**Lean toolchain/dependencies:** Lean 4.19.0 pinned by `lean-toolchain`; Lake manifest has no external Lean dependencies.  
**Verification date:** 2026-10-15.

## 1. Guarantees and proof coverage

| Req ID | Exact guarantee | Lean theorem | Code/SQL owner | Formal status | Correspondence | Production evidence |
|---|---|---|---|---|---|---|
| RSL-01 | Raw list fields require JSON integer tokens representable as signed 64-bit values, nonnegative correct, positive total, and `correct ≤ total`. | `parseRawSummary`, `integralDecimalCountIsRejected`, `integerCountPairIsPreserved`, `signedInt64MaximumCountIsPreserved`, `aboveSignedInt64CountIsRejected`, `invalidRawSummaryHasNoEstimate` | SQL `JSON_TYPE`/`JSON_EXTRACT`, `decodeClassroomRaw`, `int64FieldPtr`, `classroomRawScoreAvailable`, `ListSATAttempts` | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| RSL-02 | Available and unavailable filters are a total, disjoint score-row partition. | `scoreFiltersPartition` | `ListSATAttempts` SQL predicate | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| RSL-03 | Fallback sections group exactly by key, preserve order, sum module rows, and fail closed on invalid or overflowing scored counts. | `sectionRowsHaveRequestedKey`, `sectionSumsMatchFilteredModules`, `invalidModuleRowsFailClosed`, `sectionSumOverflowFailsClosed`, `negativeModuleRowFailsClosed`, `zeroOperationalModuleIsOmitted`, `aggregateOverflowFailsClosed`, `synthesizedSectionOrder` | `satModules`, `satSectionsFromModules`, `GetSATResult` | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| RSL-04 | Conflicting branch roles do not produce a single adaptive route. | `contradictoryBranchHasNoRoute` | `satSectionsFromModules` | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| RSL-05 | Stale estimates clear on active-policy lookup failure; no-active preserves valid stored range; active replaces stored range. | `failedPolicyClearsStoredEstimate`, `noActivePolicyPreservesValidStoredEstimate`, `activePolicyReplacesStoredEstimate` | `ListSATAttempts`, `satscoring.ApplyRevision` | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| RSL-06 | Labels follow authored option positions; SAT's four options are A–D. | `labelsPreserveAuthoredOptionOrder`, `satChoiceLettersAreABCD` | `SATChoiceLabels`, `satQuestionsQ`, question-response UI | PROVED | REVIEWED_WITH_TESTS | PARTIAL |

## 2. Model and assumptions

The Lean model is a read transformation: a `AttemptRow` contains result existence, outcome, legacy-score presence, and an optional validated raw summary. A `PolicyRead` is exactly one of failed, absent, or active with an optional converted estimate. Module rows are grouped by key; route synthesis inspects branch roles. There are no persistent writes in this boundary, so retry/crash transitions for a writer do not apply.

The model does not assume a stable snapshot for the separate count, page, and policy SQL statements. It proves row classification and transformation for the values passed to those functions. Production DB behavior, isolation, replicas, policy activation races, authorization, version skew, load, and SLOs remain assumptions or refinement obligations; see [`ASSUMPTIONS.md`](ASSUMPTIONS.md).

## 3. Proof commands and actual outputs

Pinned Lean version: `Lean (version 4.19.0, arm64-apple-darwin23.6.0, commit 6caaee842e94, Release)`. Lake: `5.0.0-6caaee8`.

```sh
cd verification/lean/sat-result-staff-read
lake update
lake build
lake env lean SatResultStaffRead/AxiomAudit.lean
lake env leanchecker  # attempted; binary is absent from pinned toolchain
```

`lake build` exit status: **0**. The output says `Build completed successfully.` The exact theorem statements and `#print axioms` output are in `evidence/lean-build.txt` and `evidence/lean-axiom-audit.txt`.

Transitive axiom audit: theorem dependencies are limited to Lean's standard `propext` and, for `synthesizedSectionOrder`, `Quot.sound`; the definitional aggregation and hostile counterexample theorems show no axioms. No custom axioms, `sorry`, `admit`, native-evaluation assumptions, or opaque placeholders are used. No `Classical.choice` dependency is reported. The standalone `leanchecker` binary is unavailable in the pinned toolchain; its exact error is preserved in `evidence/leanchecker.txt`.

## 4. Proof-to-code refinement

| Abstract value / theorem | Concrete function/query | Why the mapping is plausible | Evidence | Remaining gap |
|---|---|---|---|---|
| `parseRawSummary` / `RawSummary.valid` | SQL `JSON_TYPE` and `JSON_EXTRACT`; Go `decodeClassroomRaw` + `int64FieldPtr` + `classroomRawScoreAvailable` | Both require integer JSON tokens representable as signed int64, total > 0, correct ≥ 0, and correct ≤ total. SQL admits MySQL signed/unsigned integer labels with an int64 upper bound; Go `UseNumber` preserves the integer-token distinction. | Lean integer-vs-decimal theorem, Go unit tests, local MySQL 9.6 truth table, sqlmock query assertion | Not mechanically proven against Go driver or MySQL 8.4. |
| `scoreAvailable` / `scoreUnavailable` | Available/unavailable branches in `ListSATAttempts` | The SQL uses the same three conditions with `COALESCE` for null-safe outcome handling. | Lean partition theorem plus local SQL truth table | No 8.4 integration DB or concurrent list snapshot test. |
| `estimateAfterRead` | Persisted range parse, `ActiveRevision`, `ApplyRevision` | Failure clears estimate; nil policy leaves stored; active policy replaces; malformed raw rows remain summary-less. | sqlmock error regression; existing `satscoring` tests | No mechanized Go/SQL refinement; no live policy activation race. |
| `summarizeSection` | `satModules` validation and `satSectionsFromModules` fallback in `GetSATResult` | The loader rejects missing/invalid persisted counts; the helper validates paired row/key lists, checks each section sum against MaxInt64 before addition, filters by key, and preserves order. | Go tests including interleaved rows, invalid counts, raw/operational sum overflow, and conflicting branch roles | The theorem is about a mathematical list, not SQL result completeness or concurrent mutation. |
| `labelOptions` | `SATChoiceLabels` and `satQuestionsQ` | Both assign letters by option index; Go output is keyed by unique option ID and uses Excel-style columns. | Lean order theorem, Go helper tests, route tests | JSON parsing and Go map semantics are test/review correspondence only. |

## 5. Hostile executions and counterexamples

| Trace | Expected behavior | Naive behavior | Current result / reproduction |
|---|---|---|---|
| Scored row has persisted estimate; active-revision SQL read fails. | Preserve raw counts and clear estimate. | Old list left payload estimate untouched, while detail overlay strips it. | Fixed. `staleEstimateCounterexample`; `TestListSATAttemptsDoesNotReturnStaleEstimateWhenActiveRevisionLookupFails`. |
| `classroomRaw` path is JSON null or count fields are malformed. | Row is unavailable unless a legacy score exists. | `JSON_EXTRACT(... ) IS NOT NULL` counted JSON null as available; Go also rounded integral decimal tokens into float64 integers. | Fixed. Strict SQL predicate and `UseNumber`; local MySQL query confirmed JSON-null path presence was true but strict predicate false. |
| Same section has a higher and lower branch row, with a later branch row. | No single route. | Last branch silently overwrote the earlier one. | Fixed. `conflictingBranchCounterexample`; Go conflict regression. |
| Scored result contains a module with NULL counts or `0 / 0`. | Do not fabricate a section score. | `sql.NullInt64` defaulted missing values to zero and could produce a false summary. | Fixed. `satModules` rejects invalid scored counts; `satSectionsFromModules` rejects sum overflow; Lean theorems and Go boundary tests cover invalid counts and overflow. |
| A count exceeds signed int64, or MySQL reports a large positive integer as `UNSIGNED INTEGER`. | The filter and Go parser must agree at their representation boundary. | Earlier SQL accepted only the `INTEGER` label, while Go accepted signed-int64 values; raw response fields were machine-sized `int`. | Fixed. SQL accepts both integer labels only through MaxInt64, and the response fields are `int64`; the local MySQL table accepts MaxInt64 and rejects overflow. |
| Individually valid module counts overflow their section raw-correct or operational sum. | Do not return a wrapped section total. | Go int64 addition wrapped without an aggregate bound. | Fixed. `satSectionsFromModules` guards both sums; Lean theorem and Go boundary tests cover raw and operational overflow. |
| Policy activates while a list request is between page query and policy lookup. | Use one observed revision for conversion; do not claim page-wide snapshot. | Mixing policy/data snapshots could confuse an unversioned response. | **Not tested in production-like topology.** See production test plan. |
| Attempt is inserted between count and page queries. | No stable pagination guarantee was specified. | Total and items can reflect different snapshots. | **Known consistency boundary, not fixed.** If stable pagination is required, transaction around both reads. |

## 6. Production-like tests and measurements

Executed:

- `cd backend/go && go test ./...` — all Go packages passed.
- `bunx vitest run src/products/sat src/features/results src/components/results` — **31 files, 365 tests passed**. A few tests emitted their configured retries for `/v1/sat/exam-config/defaults`; the run completed successfully.
- `bun run typecheck` — passed.
- `bun run lint` — exit 0, **0 errors and 1076 warnings** across the repository. Targeted ESLint for changed SAT result files passed with no output.
- Local read-only SQL predicate truth table on MySQL 9.6 — 14 malformed, legacy, and boundary cases; valid legacy/raw rows were available only, all malformed/non-scored rows unavailable only, MaxInt64 accepted, signed-int64 overflow rejected, and `SHOW COUNT(*) WARNINGS` returned 0.
- `lake build` and direct theorem/axiom audit — passed as above.
- `git diff --check` — passed.

Not executed: MySQL 8.4 integration database; authenticated browser E2E; concurrent activation barriers; multi-instance deployment; fault injection against a live connection; load/soak; p50/p95/p99; production replica checks. The local browser could not provide an authenticated staff session, and the result API proxy was unavailable. There is no actual production profile to validate, and no capacity or SLO claim is made.

## 7. Verdict

- **Formal:** **PROVED** for the named Lean model theorems only.
- **Correspondence:** **REVIEWED_WITH_TESTS**; Go/TypeScript/SQL refinement is not mechanized.
- **Production evidence:** **PARTIAL**.
- **Release decision:** **CONDITIONAL**, not READY.
- **Unresolved blockers / assumption owners:** MySQL 8.4 query verification and deployment DB profile (DB/platform owner); concurrent policy activation/result read test (backend/platform owner); staff browser/access-control/version-skew test (release owner); declared workload/SLO and multi-instance load test (service owner).
- **Smallest required code/DB/infra fixes:** No additional code fix is justified by the observed cases. Run the required supported-engine and deployed-topology evidence in [`PRODUCTION_TEST_PLAN.md`](PRODUCTION_TEST_PLAN.md); add a repeatable MySQL 8.4 integration case if the CI suite does not already exercise this predicate.
