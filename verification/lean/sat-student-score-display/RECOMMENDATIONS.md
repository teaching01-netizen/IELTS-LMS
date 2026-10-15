# Recommendations

| Priority | Recommendation | Proof / regression impact |
| --- | --- | --- |
| P-1 | Keep the integer, 10-point-step, and score-range guards in the report view model. | Prevents malformed payload values from appearing as valid SAT estimates; covered by new regression tests. |
| P-2 | Run the deployed-style student report smoke from `PRODUCTION_TEST_PLAN.md` on one real adaptive result and one fixed-hard result before rollout. | Checks server metadata, frontend bundle version, actual route topology, accessible output, and raw-detail retention together. |
| P-3 | Resolve U-1 through U-3 for the release environment and keep the SAT lifecycle obligations attached to the existing `sat-classroom` / `sat-result` verification. | The display theorem is conditional on the released payload and cannot establish transaction, authorization, or deployment behavior. |

No backend routing, scoring, or result API change is required for this display
behavior. The two application fixes in this working tree address malformed
converter metadata and invalid numeric count/score fields.
