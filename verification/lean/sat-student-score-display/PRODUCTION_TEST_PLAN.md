# Production test plan

## Local evidence in this verification

| Scenario | Test | Expected result |
| --- | --- | --- |
| Single-subject converter miss | React component test | Primary score is `-`; raw count, administered-module count, and domain counts remain visible. |
| One SAT section misses while the other converts | React component and view-model tests | Missing section slot and combined slot show `-`; available section estimate remains visible. |
| Both sections miss with an active converter | View-model test | Combined and section scores are unavailable; raw correctness remains present. |
| No converter or blank metadata | View-model tests | Existing raw-score fallback remains. |
| Malformed intervals/counts/metadata | View-model tests | Invalid report shape fails closed; invalid score entries do not display as estimates; non-string converter metadata does not throw. |
| Adaptive threshold 13 of 25 | Go route boundary test | 12 routes lower; 13 and 14 route higher. |
| Classroom force higher | Go forced-route test | Higher branch is opened independent of Module 1 score. |

## Deployed-style student report smoke

Run against the exact frontend/backend release pair before marking the UI
change production-validated:

1. Use a released Classroom result with converter metadata present and one
   section marked unavailable. Confirm the section score and combined score
   show `-`, while raw correctness, modules, domains, and any available section
   estimate remain visible.
2. Repeat for a single-subject report and a report where neither section
   converts.
3. Repeat with no converter metadata and confirm the existing raw-score
   presentation remains.
4. Use an adaptive attempt one correct below threshold, exactly at threshold,
   and one above. Confirm below-threshold routes lower while at/above routes
   higher. Confirm the route result's conversion availability controls the
   report independently of the chosen route.
5. Use an M1 + fixed-hard-M2 plan and confirm the hard branch remains fixed;
   then inspect a result whose hard-route topology has no conversion table.
6. Test keyboard navigation and screen-reader output: the visual hyphen is
   announced with its unavailable-score explanation.

## Lifecycle and fault scenarios

The score view model is a pure function, so concurrent report renders do not
mutate shared state. This engagement did not re-run backend lifecycle fault
tests. The following must remain separate production obligations:

- deadline versus a save: verify server-accepted and durable answers, not a
  browser click, define the scoring snapshot;
- delayed or duplicate finalization, retry after a lost acknowledgment, and
  two closure workers: verify one immutable result receipt and route decision;
- process restart and multi-instance execution: verify recovery from the
  authoritative database without stale branch or score payloads;
- access to an unselected branch: verify server authorization before content is
  returned;
- stale reads/replicas: verify the active conversion revision and released
  result are read from the intended source.

Existing `sat-classroom` / `sat-result` artifacts provide model and local test
coverage for several of these boundaries, but production instance topology,
replica behavior, and full browser rollout remain unknown. Do not infer
production readiness from this pure presentation proof.
