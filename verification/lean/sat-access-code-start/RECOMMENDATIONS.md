# Recommendations

## P0 — Do not mark the 600-candidate gate ready

**Decision:** retain the feature rollout gate. The six cold/warm local 600-user qualification waves and three additional 600-user diagnostics all missed p95 <2.0s and drain ≤2.0s. Four of the six qualification waves had HTTP/transport errors; the three diagnostics had 78, 40, and 232 errors. One runtime per wave is not sufficient to claim the acceptance criteria passed. Production topology is unknown. Do not enable based on abstract Lean proofs or one successful run.

## P1 — Diagnose current queueing; old guard contention was not the whole SLO

The seventh cold 600 diagnostic on the earlier shared-guard path measured `guard_lock` at 160.995 cumulative seconds across 556 observations; global InnoDB row-lock time rose 162.050s (+836 waits). That confirms a material old-path lock-wait component. It also measured `state_content_assembly` at 941.932 cumulative seconds across 522 responses and the full `reservation_claim` at 682.669 seconds; concurrent per-request sums overlap.

After migration 0081, two new local 600 bursts exposed per-response application admission time. Among responses with timing headers, cold p95 admission wait was 6.671s (max 6.897s), warm p95 4.687s (max 4.919s); the start-worker gate was the dominant recorded stage. The cold/warm waves had 40/232 TCP resets with no response header. Those results do not establish a unique cause for every end-to-end millisecond or reset, and they still fail the 2-second target.

**Next action:** keep migration 0081; do not plan another allocator migration based on the old guard diagnosis. Diagnose transport resets through the target ingress and profile current worker queue, DB-pool, SQL/transaction, response assembly, and network stages on the exact one-instance deployment. Tune worker concurrency only against measured DB headroom and other-route latency; raising the cap without production-shaped tests can merely transfer queueing into MySQL.

## P1 — Preserve server and DB as the authority

Keep the per-process admission gate and runtime-ready notification advisory only. Do not treat either as distributed locking or a durable permit. The current DB guard, reservation row, transaction lock/recheck, and authoritative current-scope query remain the cross-process checks. Do not increase the budget, turn pending saturation into cooldown, or move lockout into shared-NAT identity.

## P2 — Add barrier-controlled commit/ACK fault coverage

The local suite exercises races and replay, but the proof model does not include HTTP history, partial SQL commit, client ACK loss, DB failover, or multiple deployed replicas. Add deterministic faults at: reservation commit, start transaction commit, response assembly, HTTP write, settlement, and sweeper retry. Assert one durable attempt/module activation/deadline, one quota charge per logical operation, and recoverability after uncertain ACK. Run the tests with separate API processes sharing one database.

## P2 — Verify the cutoff contract against transaction timestamps

The 15-second admission deadline bounds application queue waiting only; it does not bound a request after it is admitted. Define whether the product cutoff is request arrival, database acceptance, durable commit, or client receipt. Preserve the existing server/database ordering unless requirements explicitly change. Add a forced save-versus-close race and assert the exact accepted/durable boundary. A click that did not reach the server cannot be guaranteed by this implementation.

## P2 — Close unverified operational dependencies

Before a production verdict, record exact DB engine/version/isolation and writer/read endpoint, API replica count/version skew, pool sizes, failover behavior, feature flag, host/network profile, and retry/timeouts. Test stale reads and cache invalidation, transaction deadlock/abort retry, rotation across replicas, process death while a reservation lease is live, and compatible migration deploy/rollback. The current local test profile does not establish these properties.
