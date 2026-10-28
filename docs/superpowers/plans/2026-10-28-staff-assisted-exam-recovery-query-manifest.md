# Completion-generation query inventory

Companion to the staff-assisted recovery plan. Scope: production Go references to `attempt_terminalizations`, `student_submissions`, and `assessment_results`. Test fixtures, migrations and prose references are not current result readers.

Regenerate the source inventory with:

```sh
rg -n 'attempt_terminalizations|student_submissions|assessment_results' backend/go --glob '*.go' --glob '!*_test.go'
```

Current completion identity is `(attempt_id, terminal_generation)`. Current student-facing/queue result reads also require a sealed attempt. Explicit submission-ID reads may retain historical work; they must not overlay live response rows or accept historical mutations. `assessment_results` is a replaceable current projection, while immutable receipts and versioned submissions retain history.

| Owner (under `backend/go/`) | Classification and boundary |
| --- | --- |
| `cmd/api/handlers_v2.go` | Current receipt probe/insert; generation comes from the locked attempt. The immutable snapshot and completion event carry that generation and sealed answers. |
| `cmd/api/grading_writing_recovery.go` | Current-only compatibility overlay; historical writing remains in its versioned section/task rows. |
| `cmd/api/handlers_grading.go` | Explicit-ID schedule authorization and historical section/task reads; current response-row overlays join the submission generation. Result helpers delegate to grading/results. |
| `cmd/api/handlers_library.go` | Explicit submission-ID authorization; historical identity is intentional. |
| `cmd/e2e_seed/main.go` | Fixture cleanup/purge across all generations, scoped to named E2E fixtures. |
| `internal/act/repair.go` | Current projection repair under the attempt lock, rechecking submitted state. New submission identity and counters use the current generation. Existing assessment projection identity may be reused, with its generation rewritten in the same transaction. |
| `internal/act/service.go` | Current ACT result/detail/report reads join generation and submitted state. |
| `internal/answerhistory/service.go` | By-attempt resolution is current. Explicit submission history reads the matching immutable receipt for older generations, skips current V2 materialization and bounds mutations by submission time. |
| `internal/delivery/device_recovery.go` | Staff eligibility reads the selected current receipt generation. |
| `internal/delivery/reconcile.go` | Current receipt-existence checks; module runs use their independent run generation. |
| `internal/delivery/service.go` | Current SAT submission closure check. |
| `internal/exams/service.go` | Authorized whole-exam purge intentionally removes all generations through the existing purge boundary. |
| `internal/grading/projection.go` | Current submission lookup/insert under a generation-checked attempt lock; stale projection inputs cannot populate a reopened attempt. |
| `internal/grading/result_read.go` | Latest-by-schedule is current. Explicit result-by-submission retains historical versions. |
| `internal/grading/review_read.go` | Historical draft-by-submission read; drafts retain their original submission identity. |
| `internal/grading/service.go` | Mutations lock/check the current attempt generation. Later updates by submission ID run within that transaction. Queue/integrity aggregates are current. Explicit selected-submission export is historical and joins assessment payload only for the same generation. |
| `internal/grading/sessions.go` | Session lists/counts are current. Explicit submission reads expose `historical` and `terminalGeneration` for read-only review. |
| `internal/maintenance/jobs.go` | Current missing-projection/receipt diagnostics and grading counters; projection inputs carry terminal generation. |
| `internal/media/service.go` | Media-owner existence check permits historical submission identity; it is not a current result reader. |
| `internal/platform/db/schema.go` | Schema/index metadata requirements, not completion data reads. |
| `internal/results/sat_attempt_answers.go` | Current outcome overlay; answers remain attached to the current attempt. |
| `internal/results/sat_rawdata_export.go` | References are comments; raw-data export intentionally starts from attempts, including unfinished/unscored attempts. |
| `internal/results/service.go` | Current dashboard, details, exports and student-result reads join current generation and sealed state. |
| `internal/sat/service.go` | Current result/receipt/submission checks and provisional repair; stale result projections do not short-circuit a new generation. |
| `internal/satscoring/impact.go` | Conversion-policy impact counts only released results for the current sealed generation. |
| `internal/terminalization/reopen.go` | Current receipt provenance check and one generation advance under the attempt lock; previous immutable receipts/submissions stay intact. |
| `internal/terminalization/service.go` | Current receipt repository, materializers, gap repair and counters. Legacy missing-receipt repair inserts the locked current generation. Historical snapshot payloads remain immutable. |

Queued completion work is additionally fenced in `internal/terminalization/recovery_fence.go`. The background caller supplies its inspected generation and event creation time; the terminalizer rechecks both under the attempt lock. A room timeout cannot close a focused continuation. The recovery timeout owner supplies the matching recovery control only after its authoritative deadline and successor progression.

Module boundaries, close intents, recovery resolution and late-evidence frontiers are a separate inventory: they use `(module_attempt_id, run_generation)`, not terminal generation. The section-entry form writer includes the current module run when arming a boundary. Form responses themselves retain their original consumed identity.
