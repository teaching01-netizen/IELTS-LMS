# Recommendations

## Before rollout

1. **Deploy and verify the backend first.** Confirm migration 0058 and runtime schema checks pass in every environment before the new SAT create sheet is enabled. The frontend config fields can be silently ignored by an old server.
2. **Run the production-profile race and fault tests** in `PRODUCTION_TEST_PLAN.md` across at least two API processes. The local test proves the local MySQL unique-key path only.
3. **Decide whether retry must survive reload.** The current operation key is retained only while the create sheet is mounted. If recovery after refresh/browser restart is required, persist a payload-bound pending key until a definitive create response and add reload tests without storing raw converter/name data.
4. **Keep the seven-day boundary explicit.** If clients or offline flows may retry after seven days, lengthen retention or retain a durable create receipt; otherwise keep retries within the existing TTL.
5. **Verify production DB and read routing.** Confirm unique-key enforcement, transaction durability/isolation, migration state, and read-after-write behavior against the deployed database product and replicas.

## Proof impact

The checked model establishes abstract state safety only. Mechanizing a Go/MySQL refinement would require a verified transaction semantics or generated implementation; this engagement does not claim that. For higher assurance without changing the system, add SQL fault-injection tests at each write and a two-process integration race against the production database engine.
