# Production verification plan

Production evidence is `PARTIAL`. Run these checks against the actual deployment profile before relying on retry safety or enabling the frontend.

## Record the environment

Capture the database product/version, transaction isolation and durability/failover configuration, all API build IDs/replica count, migration ledger and `authoring_operation_keys` primary key, read-replica/cache routing, classroom feature flags, and the backend/frontend rollout order. Confirm the create endpoint reads and writes the same authoritative database. Do not infer these from the local MySQL test.

## Deterministic scenarios

Use DB barriers/fault hooks and at least two API processes; do not use sleep-only scheduling.

| Scenario | Forced schedule | Required result |
| --- | --- | --- |
| Same-key concurrent create | Release 8–20 requests with same actor, key, and payload simultaneously across two API processes. | All successful callers receive one exam ID; one exam entity, draft, create event, and completed receipt exist. |
| Same-key payload mismatch | Submit two different payloads with same actor/key while the first claim is in flight. | One payload wins; the other gets 409; no second exam or changed receipt. |
| Lost response | Drop the HTTP response after DB commit; retry with same key and identical body. | Retry returns the committed exam; row/event/plan/converter/report counts remain one. |
| Abort between writes | Inject failure after entity, draft, plan, scoring, report, event, and result receipt writes in turn. | Every failed transaction leaves no partial bundle and no committed receipt. |
| Commit response ambiguity | Kill the API connection/process around DB commit, then retry same key. | If commit persisted, replay its result; if it rolled back, retry creates one result. |
| Different actor, same key | Send same key and payload under two authorized actors. | Actor scopes remain isolated and each receives only its own result. |
| Expiry boundary | Retry before seven days, then after maintenance cleanup removes the receipt. | Before expiry replay; after expiry a new create is currently permitted and should be documented as such. |
| No active exam version | Read an exam whose draft and published pointers are both NULL, plus dangling-pointer variants. | Plan read fails closed; no full-adaptive default is fabricated. |
| Version skew | Roll backend and frontend in both supported orders; inspect plan/config persistence. | Backend-first rollout preserves config. Frontend against an old backend must be blocked by release controls. |

After each scenario query counts by exam ID and `(actor_id, scope, operation_key)`, inspect the receipt hash/result JSON, and compare API responses to committed state. Check that parser validation precedes all writes.

## Capacity, failover, and soak

Run the create mix with two or more API instances, realistic DB pools, normal title/config distributions, configured timeouts/retries, and expected peak concurrency. Measure p50/p95/p99 latency, duplicate suppression, conflicts, DB lock waits/deadlocks, connection saturation, errors, and failover recovery. Include one DB primary failover and one API process restart. Define thresholds from the service SLO before the run; neither Lean nor the local functional race proves capacity.

## Local evidence already collected

- MySQL 9.6.0 disposable schema migrated through 0089.
- Eight concurrent same-actor/same-key create calls passed; one exam, one created event, one completed receipt, and one shared exam ID were asserted.
- The HTTP handler test verified the header becomes an actor-scoped claim and mismatched content returns 409.
- No multi-process API race, load/soak, failover, or production-profile test was run.
