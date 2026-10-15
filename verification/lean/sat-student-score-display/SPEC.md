# Student SAT score display specification

## Verification target

For a released SAT Classroom result, the student report uses the server's
conversion metadata and section status to decide which score text to render.
When a nonblank converter version is present but a section or the combined
score has no valid converted estimate, its score slot displays `-`. Raw
correctness, administered-module counts, and domain counts remain available.
Valid estimates remain visible. A report with no configured converter keeps
its existing raw-score fallback.

The model begins at the student-facing `classroomRaw` payload and ends at the
score values selected for the report. `SatScoreReport` already gates that
payload on `releaseStatus === "released"`; release authorization and the
server's result transaction are outside this model.

## Guarantees

| ID | Guarantee | Class |
| --- | --- | --- |
| D-1 | With a configured converter, a section miss or invalid section estimate renders `-`. | safety |
| D-2 | With a configured converter, a missing or invalid combined estimate renders `-`, including when valid section estimates remain available. | safety |
| D-3 | Valid section and combined estimates remain visible. | safety |
| D-4 | For accepted sections, raw correctness, module details, and domain details pass through the score view unchanged. | safety |
| D-5 | Without a configured converter, unavailable section estimates keep the raw count fallback; a full report with no converted sections keeps the raw combined count. | safety |
| D-6 | Invalid report section shape produces the safe unavailable report. Invalid numeric counts and score intervals are rejected at the TypeScript boundary. | safety |
| D-7 | Adaptive routing uses the inclusive `rawCorrect >= threshold` boundary; a selected force-higher policy opens the higher branch regardless of raw score. | safety |

## Interpretation and boundary

- A converter is considered configured only when the payload contains a
  nonblank string `converterVersion`. Invalid non-string metadata is treated
  as absent.
- Section score intervals must be integer multiples of 10 in `[200, 800]`;
  combined score intervals must be integer multiples of 10 in `[400, 1600]`.
  This matches the server conversion contract.
- The Lean input starts after JSON number parsing and module/domain detail
  filtering. The TypeScript validation and component tests cover those
  boundary refinements separately.
- The route model starts after the classroom plan/session has selected a
  routing policy. Fixed-branch-plan precedence and the committed route/opened
  module lifecycle are covered by the existing `sat-classroom` verification
  artifacts; this project does not alter them.
- No liveness, authorization, database isolation, crash-recovery, browser
  rendering fidelity, or capacity claim is made here.
