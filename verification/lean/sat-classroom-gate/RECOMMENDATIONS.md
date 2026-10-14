# Findings and actions

## Fixed in this review

1. **Fail-open package default.** The process-global classroom gate used to treat the zero-valued atomic as enabled. `cmd/api/main` applied the correct false config default, but another entry point or test harness could omit that setter. The gate now stores the enabled value directly, so zero value is disabled; relevant tests set and restore gate state explicitly. Config tests assert `SAT_CLASSROOM_ENABLED` defaults false.
2. **Stale capability after a definitive server refusal.** If GET reached an enabled instance and POST reached a disabled instance, the form retained the stale enabled capability after clearing its operation key. It now disables Classroom for the current form, keeps the restored Classroom value and draft, and leaves Practice usable. Added a UI regression test that receives `SAT_CLASSROOM_DISABLED`, selects Practice, then succeeds with a new key.
3. **Missing full-transaction gate regression.** Added a MySQL test asserting the disabled refusal leaves no release, schedule, link, roster receipt, or partial seal and that Practice still succeeds.

## Release blockers

1. **Do not enable Railway's `SAT_CLASSROOM_ENABLED` yet.** Production instance/build/config evidence and DB migration/fence evidence are UNKNOWN here. Keep the flag false until every API instance runs the Classroom-aware build, 0084/0086 and trigger/equivalent fences are verified active on the production database, and the production engine supports the transaction/fence assumptions.
2. **Run the new gate rollback test on supported MySQL.** `TEST_MYSQL_DSN` was unset in this workspace, so `TestSatRoomsClassroomDisabledRollsBackMySQL` compiled but its database path was skipped. Run it and the existing same-key replay/race tests against the deployment engine before rollout.
3. **Check old SPA version skew.** A pre-change browser bundle does not know the new error code and may classify its 503 as uncertain. Server safety is preserved, but reload/recovery UX should be checked during rollout.
4. **Verify Railway runtime state and instance uniformity.** The gate is process-local. A mixed fleet intentionally permits some nodes to accept while others refuse, as the Lean counterexample demonstrates. The environment cannot be treated as one global gate until every node is aligned.

## Not established

Production durability, replica/read routing, failover, authorization, browser storage fault behavior, multi-instance load, and latency/SLOs remain unverified. The formal proofs cover the explicitly defined atomic model only.
