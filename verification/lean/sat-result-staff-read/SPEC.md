# SAT staff result read path: specification

## Verification boundary

This verification covers the staff-facing SAT result list and detail read paths implemented in `backend/go/internal/results/service.go`, plus choice labels shown by the SAT question review UI. The authoritative inputs are the result row and `score_payload.classroomRaw`, administered module-attempt rows, the pinned question answer definition, and the currently observed global score-conversion revision. The externally observable outcomes are the list row's raw/estimated score fields, available/unavailable list-filter membership, section/module summaries, and response/key labels.

The list operation is read-only. A list request can overlap result sealing or a global conversion-policy activation. The model treats the values observed by the query and the policy read as explicit inputs. It does not claim a single snapshot across the count query, page query, and policy query. It does not model the authorization middleware, PDF generation, browser rendering, or any state-changing lifecycle operation.

## Requirements

| ID | Exact guarantee | Class |
|---|---|---|
| RSL-01 | A list row has no raw summary or estimate unless `classroomRaw.rawCorrect` and `classroomRaw.total` are JSON integer values representable as signed int64, `total > 0`, and `0 ≤ rawCorrect ≤ total`. A legacy non-null `total_score` remains available for scored rows. | Safety |
| RSL-02 | `scoreFilter=available` and `scoreFilter=unavailable` form a total, disjoint partition. A row is available exactly when a result exists, its outcome is `scored`, and either `total_score` is non-null or its classroom raw summary satisfies RSL-01. | Safety |
| RSL-03 | For a classroom result whose legacy section rows are empty, each synthesized section contains exactly the returned module rows with that section key, in source order; raw-correct and operational totals equal the sum of those rows. Section order follows first appearance in the module query. If any scored module row has missing or invalid counts, or any section sum exceeds signed int64, no partial/fabricated section summary is synthesized. | Safety / ordering |
| RSL-04 | A section route is reported only when its administered branch rows agree. Conflicting higher/lower branch rows produce no single route. | Safety |
| RSL-05 | A valid stored estimate remains visible before any global policy is published. A successful active-policy read replaces the stored estimate with that policy's conversion. A failed active-policy read clears the estimate while preserving a valid raw summary. | Safety / consistency |
| RSL-06 | Single-choice labels follow authored option order (`A`, `B`, `C`, `D` for SAT choices); response and key labels are derived from the pinned answer definition. SPR labels remain raw response text. | Safety / display semantics |

## Observable failure behavior

- A SQL error loading the result page is returned as an error; it does not return a partially populated page.
- An active conversion-revision lookup error degrades a classroom row to raw counts, never a persisted estimate that may belong to an older revision.
- An absent active revision preserves a valid stored estimate. This is the existing documented behavior until the first global publish.
- Malformed or conflicting module data does not produce a fabricated `0 / 0` summary, a partial section, conversion, or singular adaptive route.
- A missing option label falls back to the raw option ID in the staff question response.

## Exclusions

No liveness, linearizability, stable-pagination, durability, authorization, capacity, or production-readiness claim is made. In particular, RSL-02 is about row classification, not a promise that `COUNT(*)` and a later page query see the same attempt set. The current repository has no declared production instance count, result-read isolation profile, replica policy, peak traffic, or SLO for this path.
