# Production evidence and outstanding tests

Executed local profile: MySQL 9.6.0 primary, default REPEATABLE-READ with innodb_flush_log_at_trx_commit=1; Go 1.26.3 darwin/arm64. SAT/scoring/delivery/integration packages passed. Focused race tests passed three repetitions with shuffle seed 42. Expanded API suite has three unresolved failures documented in PROOF_REPORT.md. Functional tests are not capacity validation.

| Schedule / fault | Expected observation | Evidence / remaining work |
|---|---|---|
| Commit deadlocks then retries | Sealer runs twice, overlay pointer query runs once after successful commit | ordered SQL mock regression |
| Commit fails permanently | nil result/error, no overlay query | ordered SQL mock regression |
| Policy lookup fails after commit | completion succeeds, raw score retained, conversion stripped | regression |
| Lost ACK then two concurrent finish retries | both show active-policy total; one terminal receipt | barrier-started real MySQL regression |
| Submit vs timeout reconcile | one immutable receipt and digest | existing channel-coordinated MySQL integration test |
| Policy changes between finish and refresh | revision/score may differ legitimately | Lean counterexample; existing retroactive policy tests |
| Staff disables report after release | replay exposes receipt only; no snapshot | real MySQL completion regression, shared-projection unit cases |
| Missing/failed gate query; invalidated status | no score disclosure; error produces no response result | projection unit cases |
| Background pending-result repair | later request may read new report; prior historical response remains valid | repair transition; existing repair coverage; no new fault injection |
| Cancellation after successful commit | caller may receive raw-only or no ACK; replay observes committed receipt | allowed by model; deployed HTTP fault injection outstanding |
| Worker/node crash, replication lag, failover, mixed versions | no claimed same-observation guarantee unless primary consistency and rollout obligations hold | NOT TESTED in deployed topology |

Outstanding production profile: run two API instances and the normal worker against the actual DB engine/isolation. Barrier duplicate completion requests and publish between active-pointer observation and revision read; restart one instance between commit and ACK. Exercise flag off/on and pending repair. Use sanitized realistic row volume, pool limits and deadline traffic; ramp 1/10/100/500 concurrent students only as approved staging capacity permits. Record workload, p50/p95/p99, DB/HTTP errors, lock waits, deadlock retries, pool saturation, receipt counts, overlay outcomes, and recovery latency. Do not infer infinite throughput or liveness from these tests. No production endpoints are used by this engagement.
