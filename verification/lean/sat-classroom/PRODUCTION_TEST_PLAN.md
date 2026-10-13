# Production verification plan

Current production evidence is PARTIAL; run these checks against the actual deployment profile before enabling classroom sessions.

## Required environment facts

Record DB product/version, trigger support and trigger inventory, isolation level, transaction durability/failover behavior, API instance count/build IDs, migration ledger, server clock source/drift, close window W, worker/reconciler scheduling, and relevant feature flags. Test with the production DB engine: the MySQL trigger suite does not establish behavior on TiDB or another engine.

## Deterministic concurrency and fault cases

| Scenario | Forced schedule | Required persisted and observable result |
| --- | --- | --- |
| Opposite staff routes | Two API instances, barrier after both requests begin; release both against one attempt | One route row and one M2 branch; winner succeeds, loser gets conflict; no duplicate module |
| Staff route vs M1 close | Barrier around attempt lock acquisition | One valid serialized result; no route/module mismatch |
| Staff route vs terminalization | Barrier around both lock paths | Either valid staff route then terminalization, or terminalization blocks route; no partial decision |
| Save vs close at boundary | Set server-controlled timestamps around deadline and deadline+W, then barrier on lock acquisition | Inclusion follows the explicitly approved server-commit ordering; no click-before-server guarantee |
| Lost ACK then retry | Commit route, drop response, retry same route before and after seal; then retry opposite route | Identical request replays one durable decision; opposite route conflicts |
| Crash around commit | Kill process before commit, after commit before ACK, after result receipt before score repair | No partial transaction; retry/repair converges without changing route or fabricating score |
| Legacy binary during migration | Old and new API versions against actual schema, including each plan shape | DB fence refuses excluded route and wrong entry module, or feature gate remains closed until all binaries are upgraded |
| Malformed/absent scoring metadata | Fail scoring and repair at each release boundary | Receipt remains; score stays pending; no zero or partial score is exposed |
| Unauthorized route/content request | Anonymous, student, wrong-schedule staff, authorized staff | Only authorized staff can assign; unopened branch content remains inaccessible |

Use DB locks/barriers or fault hooks; sleep-only races are not sufficient. Capture request/response history, transaction IDs, committed rows, trigger errors, and resulting student/staff views.

## Invariant queries after every run

- At most one assessment_route_decisions row per (attempt_id, section_id).
- Every decision's selected_module_id, selected_route, route_basis, and section plan agree.
- Every M1-based classroom section completing holds M1 plus exactly the decided, plan-admitted M2; standalone M2 holds only its planned entry and no route decision.
- No attempt seals with missing, unfinished, unresolved, or awaiting sections.
- No response write commits after the authoritative close point.
- A released raw score has a sealed terminal receipt and successful operational score calculation.
- Student payloads contain only approved result fields and no unopened module content.

## Load, soak, and recovery

Run at least two API instances with realistic route/save/submit/score-repair traffic, normal connection pools, expected peak concurrency, retry rates, and worker backlog. Include DB contention and one process restart. Report workload shape and p50/p95/p99 latency, errors, lock waits, deadlocks/retries, queue depth, recovery time, duplicate suppression, pending-result age, and invariant violations. Define limits from the service SLO before the run; no throughput claim follows from Lean or functional tests.

## Evidence already collected

Local MySQL 9.6.0, a temporary schema migrated through 0086, focused route/topology tests, migration lineage test, and plan-fence/mixed-binary integration tests passed. This does not replace the actual production-profile runs above.
