# Recommendations and remaining gates

1. Keep publish success tied to the validated POST receipt. Do not make success depend on release/list/shell refresh completion.
2. Keep the completion sheet under a stable parent and key for the operation. Keep room creation pinned to the returned version and scope.
3. Keep draft opening behind the explicit, permission-gated Edit exam action. Recheck role authorization on the server.
4. Before a production readiness decision, run the two-context remote-dirty R6 scenario and the isolated database/API lost-ack, crash, and multi-instance tests listed in `PRODUCTION_TEST_PLAN.md` if those guarantees are in the release risk envelope.
5. Complete manual screen-reader, actual 200% zoom/reflow, focus-obscuration, and end-to-end contrast review. Resolve the open product decisions in `docs/specs/sat-staff-ux-ui-spec.md` §11.
6. Preserve the current model boundary in future reports. To strengthen it, first add dirty recovery/write-target state and multiple clients to the Lean model; then provide an explicit refinement argument or generated/verified boundary before describing implementation verification. Do not expand theorem claims to SQL or production from source similarity alone.

No database migration or backend behavior change is needed for the implemented UI lifecycle fix. The frontend can be reverted without unpublishing a committed exam version; operational rollback must account for versions already published and rooms already created.
