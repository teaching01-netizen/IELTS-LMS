# Production verification plan

## Executed profile

Local MySQL 9.6.0 on one developer machine; disposable migrated schema through 0089; Go service instances/goroutines in one test process; REPEATABLE READ runner; no Hocuspocus, load balancer, read replica, broker, remote object store, browser E2E or failover. This is functional evidence, not a production load profile. Migration idempotence and schema metadata are saved in `evidence/environment.txt` and migration logs.

Executed scenarios: same-key six-caller race; normal commit/lost-response replay/status; changed-body conflict; unready/stale/freeze-refused requests; untouched-clone reuse; changed question and historical version pin; mandatory fences; configured exam creation; rename/deletion replay; link INSERT failure after seal/schedule writes followed by rollback and same-key retry; two distinct keys released by a start barrier on an already published revision. A start barrier coordinates invocation; it does not force two transactions to read the same precondition before either writes.

Browser unit tests execute the real hook/form with mocked transport: remount retains identity; old-request body expires while key remains; generic 404 and in-progress 409 retain the key; actor/exam isolation; no late POST after unmount during preparation; existing SAT Rooms/Access form behavior. They do not establish live browser/server transport behavior.

## Required deterministic schedules

| Scenario | Coordination / injection | Persisted and external oracle |
|---|---|---|
| Same-key claim race across API instances | Pause both after the unlocked missing-receipt read; release together into INSERT under actual PK | One committed receipt/schedule/link; all successful responses same snapshot; retryable loser must converge under same key |
| Distinct first-room commands, same draft | Hold first seal before commit; second prepared with old fences | At most one new release; loser receives revision conflict, preserves form, then fresh explicit preparation creates a distinct room |
| Save versus preflight | Barrier after media preflight, save a changed revision, release creator | No room/receipt/release from stale preflight; correct conflict code; no asset I/O while DB locks held |
| Save/freeze race | Two coedit clients, hold one ACK, freeze and expire/renew lease across instances | No seal while any relevant work is unacknowledged; lost edits remain recoverable; all ordinary write callers respect the freeze |
| Crash before/inside commit | Kill API process before writes, after seal, after schedule and before receipt write | After rollback/restart, no partial new rows; identical request/key can complete |
| Crash/ACK loss after commit | Proxy drops response after commit, kill API, reload browser, query status through another instance | Original immutable response recovered; no second operation key or new room; deleted live room remains deleted |
| DB deadlock / timeout / connection loss | Force canonical conflicting lock order and fail connection at commit | No inference of rollback from connection error; same-key retry and status converge; bounded retries avoid a storm |
| Replica/cache staleness | Route projections to delayed replica while receipt stays on authority | Receipt remains acknowledgement; no fuzzy reconciliation; stale missing projection never authorizes a new key |
| Key retention loss | Clear tab storage / close tab after unknown result | Document inability to dedupe human intent without retained identity; provide an authorized receipt-discovery protocol before promising session-independent recovery |
| Request body loss without commit | Reload/expire body after an uncommitted unknown attempt | Client stays safe and holds opaque key; cannot promise eventual retry completion without durable request/abort protocol |
| Mixed-version fleet | Run old/new writers while applying 0089, then roll back app | NULL legacy responses handled explicitly; no false exact-response claim; schema guard fails before new code serves without the column |
| Release/asset policy changes | Reuse legacy/partial release after asset deletion or validator policy changes | Student-visible content/security invariant remains valid or creation fails with a definitive policy decision |
| Unauthorized lookup/create | Other actor, other org, revoked privilege, key collision between orgs | No receipt/content leak, no room writes, correct non-enumerating errors |

No sleep-only race tests: use barriers, controllable proxies and DB locks/test hooks. Persist invocation, commit and ACK events with actor/key/exam/version IDs and no roster/student PII. Check both API responses and SQL counts/pins/snapshots. Monitor pending operation recovery and lease ownership.

## Load / soak evidence still required

Use the actual supported production DB/version and at least two API instances with production pools and feature flags. Start with declared profiles of 10, 50 and 100 simultaneous creators, then measure the supported ceiling instead of assuming it. Mix fresh seals, reused releases, coedit saves, 10% identical retries and 1% post-commit response loss; include skewed hot-exam contention. Run a 30-minute steady phase, a burst phase and recovery after one node dies. These numbers are proposed experiments, not measured capacity or SLOs.

Record request counts, p50/p95/p99, errors by machine code, lock waits/deadlocks, connection-pool saturation, duplicate suppression, stale-fence rejections, orphan queries, coedit lease recovery and backlog. No `READY` verdict until service owners supply SLO thresholds and the declared profile passes without invariant violations.
