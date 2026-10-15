# SPEC — Module 1 threshold gate for fixed Module 2 SAT shapes

## Scope
For an SAT section whose published classroom plan is `m1_hard` ("Module 1, then Hard
Module 2") or `m1_easy` ("Module 1, then Easy Module 2"), the result page may show a
converted (scaled) section score only when the student's Module 1 raw score would have
routed them to that Module 2 under the section's threshold `T`
(`minimumCorrectForHigher`). Otherwise the section is `conversionStatus = "unavailable"`
(raw scores still shown) and no total is shown.

Authoritative state: `assessment_route_decisions` (immutable per attempt+section,
UNIQUE(attempt_id, section_id)), `exam_versions.sat_classroom_plan`, and the sealed
`assessment_results.score_payload.classroomRaw`. Observable outcome: `conversionStatus`,
`scaled`, `totalScaled` in result reads (student and staff).

Out of scope: conversion-table correctness, release gating, authorization of result reads,
the UI rendering (only reads `conversionStatus === "converted"`).

## Guarantees
| ID | Guarantee | Kind |
|---|---|---|
| REQ-1 | `m1_hard`: converted ⇒ a decision row exists with `1 ≤ T ≤ ops`, `0 ≤ raw ≤ ops`, `raw ≥ T` | safety |
| REQ-2 | `m1_easy`: converted ⇒ same validity and `raw < T` | safety |
| REQ-3 | No over-blocking: a valid decision routing to the forced branch converts whenever the table has the cell | safety (dual) |
| REQ-4 | `full`, `m2_easy`, `m2_hard` are never gated | safety |
| REQ-5 | Gate ≡ "routing (`chooseAdaptiveRoute`) would pick the forced branch" | consistency |
| REQ-6 | A total appears only when both sections converted | safety |
| REQ-7 | REQ-1/2 hold after seal, under every later revision publish, unreadable revision, and repair reseal | safety (temporal) |

Boundary: `≥ T` for hard (matches the "Harder Module 2 at T" adaptive rule). Whether the
business wants strictly `> T` is an open question (see RECOMMENDATIONS.md).
