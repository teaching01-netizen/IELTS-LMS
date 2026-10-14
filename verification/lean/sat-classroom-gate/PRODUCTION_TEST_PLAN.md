# Production-profile verification plan

Production correctness is not established until the checks below run against the real Railway API fleet and supported database.

## Readiness facts to record before enabling

- Every API instance ID, image/build SHA, startup time, and `SAT_CLASSROOM_ENABLED` value.
- Load-balancer behavior for the capability GET and room POST; whether one client can hit different instances.
- Database product/version, transaction engine, isolation, durability/failover policy, current schema ledger, and presence/definition of 0084 and 0086 triggers.
- Whether each database supports those fences. If it skips triggers, document an equivalent enforcement mechanism or keep the gate false.
- Current Railway gate value and deployment rollout order. No production mutation is part of this verification run.

## Deterministic scenarios

| Scenario | Forced schedule | Expected result |
| --- | --- | --- |
| Gate off, Classroom request | Submit with a fresh operation key to each disabled instance. | Stable `SAT_CLASSROOM_DISABLED`; no operation receipt, release seal, schedule, access link, or roster row. The form retains values and can switch to Practice. |
| Gate off, Practice request | Submit Practice while the Classroom gate is false. | One room is created; the Classroom gate does not reject Practice. |
| Capability mismatch across instances | GET defaults from each instance, then POST to every instance with a fresh key. | Any off instance refuses Classroom; no partial room. Mixed flags are a rollout blocker, even if some nodes accept. |
| Restored Classroom draft | Restore a Classroom form while capability is false, then after a failed capability fetch. | Selection remains Classroom; submit is blocked; explanation is announced; Practice remains selectable. |
| Gate changes after GET | GET reports enabled, then POST lands on an off instance. | Stable refusal clears the key, preserves draft/selection, and disables Classroom in that open form. |
| Same-key concurrent submissions | Barrier two API instances after both begin the same `(actor,key,body)` request. | One transaction creates one room; the other replays the same receipt or safely reports in-progress/conflict; no duplicate effect. |
| Lost ACK after commit | Drop the POST response after database commit; retry exact request/key. | Original receipt is replayed; one room remains. |
| Generic 5xx before/after commit | Inject proxy failure before commit and after commit but before ACK. | Client retains exact request/key; retry/status check resolves; no new key is minted while uncertain. |
| Gate refusal after draft seal/schedule insert | Use a valid editable exam and verify gate check late in the transaction. | Rollback restores the draft and leaves zero release, schedule, link, roster, or operation receipt rows. |
| API restart and old browser tab | Restart during rollout; use a cached pre-change SPA against the new API. | No room is created on a disabled node. Record old-client behavior; require reload guidance if it cannot recognize `SAT_CLASSROOM_DISABLED`. |
| Fence migration check | Inspect ledger and trigger definitions on every production DB. | 0084 and 0086 are active on a trigger-capable supported engine, or equivalent fences exist before enablement. |

Use DB barriers/fault hooks rather than sleeps. Capture build ID, instance ID, request/response, transaction outcome, operation receipt, room rows, and trigger inventory.

## Invariant queries

- For every gate-refused operation key, no receipt exists and no corresponding release/schedule/link/roster was committed.
- For each committed `(actor_id, operation_key)`, exactly one durable room receipt and one room effect exist.
- A replay returns the original response snapshot and does not add rows.
- A disabled instance's capability response is false and its new Classroom POST returns `SAT_CLASSROOM_DISABLED`.
- Practice can be created when Classroom is disabled.
- 0084/0086 fences are present and active on the database engine serving attempts.

## Load, soak, and failure recovery

Run at least two production-equivalent API instances against the supported production database with expected room creation, status checks, retries, and normal authoring traffic. Include one process restart and database failover/reconnect. Report workload, concurrency, p50/p95/p99 latency, errors, deadlocks/retries, pool waits, operation replay counts, and invariant-query results. Set thresholds from the service SLO; no load or production guarantee follows from the Lean proof.

No production-profile run was performed in this review.
