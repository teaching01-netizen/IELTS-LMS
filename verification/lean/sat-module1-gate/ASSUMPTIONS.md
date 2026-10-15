# ASSUMPTIONS

| ID | Assumption | Owner / anchor | Validation | Criticality |
|---|---|---|---|---|
| A1 | The decision row's `raw_correct` equals the final M1 raw (no rescoring after routing) | `delivery/service.go:2408` recovery closure skips repair once a decision exists | `timeout_recovery_closure_test.go` | High |
| A2 | `policy_config` in the decision is an immutable snapshot | INSERT-only in `start_submit.go:1435`; no UPDATE path found | grep review | High |
| A3 | `sat_classroom_plan` of a published version does not change after publish | satpublish publish flow | review | High |
| A4 | Every converter path calls `SectionQualified` after table lookup | `convertClassroomScoresTx`, `satscoring.ApplyRevision`, `Impact` | unit tests + review | High |
| A5 | `stripConversion` never removes `module1Qualified` | `satscoring/overlay.go` | `TestApplyRevisionSkipsUnqualifiedSection` | Medium |
| A6 | Results sealed before this change have no flag and keep converting (legacy) | `SectionQualified` absent ⇒ true | **Residual**: see RECOMMENDATIONS R1 | Medium |
| A7 | One `(attempt, section)` route decision (UNIQUE) — LEFT JOIN yields ≤ 1 row per section | schema | DDL | Medium |
| A8 | Frontend shows scaled only when `conversionStatus === "converted"` | `scoreReportViewModel.ts:243`, `SatResultDetailRoute.tsx:80` | existing tests | Medium |
