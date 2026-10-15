# Traceability

Statuses are independent. `PROVED` refers only to the Lean definitions and
assumptions. `REVIEWED_WITH_TESTS` is a hand-reviewed correspondence to the
application plus local test evidence; it is not a mechanized refinement.

| Requirement | Lean theorem(s) | Implementation anchor | Test oracle | Formal | Correspondence | Production evidence |
| --- | --- | --- | --- | --- | --- | --- |
| D-1 configured converter + unavailable section displays dash | `unavailable_section_with_converter_is_dash`; `witness_converter_miss_renders_dash` | `scoreReportViewModel.ts` `sectionScore`; `SatScoreOverview.tsx`; `SatSubjectPerformance.tsx` | view-model and component tests for single and full reports | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| D-2 unavailable combined estimate displays dash while section estimates survive | `full_report_keeps_valid_section_estimates_when_total_is_missing`; `full_report_shows_dash_for_missing_section_and_total` | `scoreReportViewModel.ts` combined-score branch | component test with one unavailable and one converted section; view-model test when both sections miss | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| D-3 valid section and combined estimates remain visible | `valid_section_estimate_survives`; `full_report_shows_available_total_and_section_estimates` | `estimate`; `SatScoreOverview`; `SatSubjectPerformance` | existing available-score view-model tests | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| D-4 raw counts/modules/domains remain visible | `section_view_preserves_details`; `section_scores_preserve_details`; `full_report_shows_dash_for_missing_section_and_total` | section projection, `SatModuleBreakdown`, `SatKnowledgeSkills` | component test asserts raw totals, module total, and domain accuracy alongside dash | PROVED for already-filtered rows | REVIEWED_WITH_TESTS | PARTIAL |
| D-5 no-converter fallback remains raw | `unavailable_section_without_converter_is_raw`; `no_converter_full_report_keeps_raw_total`; `witness_no_converter_retains_raw_score_and_details` | `buildStudentScoreReportView` | existing no-converter view-model tests; malformed/blank metadata test | PROVED | REVIEWED_WITH_TESTS | PARTIAL |
| D-6 malformed shape fails closed; malformed numbers are rejected | `malformed_section_shape_is_unavailable` | `validRaw`, `estimate`, duplicate/invalid section guard | view-model tests for malformed sections, fractional counts, fractional/off-step scores, and invalid metadata | PROVED for section shape; numeric parser checks are TypeScript-tested | REVIEWED_WITH_TESTS | PARTIAL |
| D-7 adaptive threshold inclusive; selected force-higher ignores raw score | `adaptive_route_uses_inclusive_threshold`; `forced_higher_route_ignores_threshold_and_raw_score`; 12/13/14 witnesses | `start_submit.go` `chooseAdaptiveRoute` / `nextModuleTx` | `TestChooseAdaptiveRouteBoundary`; `TestNextModuleTxForcedRouteIgnoresModule1Score`; `sat-classroom` route-plan model | PROVED for selected-policy model | REVIEWED_WITH_TESTS | PARTIAL |
| Student only sees released classroom report | Not part of this model; prior `sat-result` release proofs apply | `SatScoreReport.tsx` `classroomReport`; Go student result projection | Existing release-gate tests in `verification/lean/sat-result` | NOT_RUN here | REVIEWED_WITH_TESTS in prior artifact | PARTIAL |

## Refinement map

| Lean | Application behavior | Gap |
| --- | --- | --- |
| `chooseRoute` | `chooseAdaptiveRoute` and forced route selection in `nextModuleTx` | The model starts after plan/session policy selection. Database commit, plan pinning, and opened-module fidelity are outside this project. |
| `sectionScore` | Per-section `conversionStatus` + valid `scaled` interval handling in `buildStudentScoreReportView` | The model starts from parsed integer interval data; JSON parsing, JS numeric type guards, and strings are tested, not mechanically linked. |
| `combinedPrimary` | Combined total is accepted only when all present section estimates are valid; active converter misses return a dash | The implementation's selected subjects and server-created payload are hand-reviewed against the model. |
| `SectionView.details` | Raw counts, modules, and domains carried to score-report components | Lean assumes already-filtered detail rows; `buildModules`/`buildDomains` filtering is covered by TypeScript tests. |
| `renderedUnavailableScore` | `aria-hidden` hyphen plus screen-reader reason in both score components | React component test checks the rendered hyphen and visible raw details; real browser/AT behavior is untested. |

The related transaction/lifecycle proof projects are
`verification/lean/sat-classroom` and `verification/lean/sat-result`. They are
not imported as dependencies and their production evidence is not upgraded by
this report.
