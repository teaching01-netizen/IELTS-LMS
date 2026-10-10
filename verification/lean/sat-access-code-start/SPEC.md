# SAT access-code first-start specification

## Scope and boundary

The feature is `POST /api/v1/assessment-delivery/schedules/{scheduleID}/start-with-code`. The bearer-derived attempt and schedule are authoritative; MySQL persists code-generation reservations, stable quota counters, attempt acceptance, first-module activation/deadline, and the schedule runtime. The externally observable success is the existing `started` response with that attempt's selected module content. Concurrent actors are candidates, API processes, code rotation, and the reservation sweeper. This verification covers the local MySQL-backed API path and an abstract Lean state machine; it does not cover browser click delivery, production topology, key management, or deployed service availability.

## Exact requirement interpretation

A start is accepted only when the server's database transaction commits the attempt's accepted timestamp and code generation, activation of that attempt's first delivered module, its database-time start/deadline, and the schedule runtime/pinned plan. A browser click or request send is not acceptance. If the transaction commits but the ACK is lost, recovery must return the committed attempt state rather than create a second start. The first-module close-time boundary is exclusive (`startAt < effectiveClosesAt`); the open-time boundary is inclusive.

| ID | Guarantee | Class | Observable oracle |
| --- | --- | --- | --- |
| FR-1 | One valid request per pre-registered candidate starts only that candidate's first delivered module. For the 600 wave, each candidate receives `started` without client retries. | Safety / API behavior | HTTP response plus persisted acceptance and started-module rows |
| FR-2 | There is one schedule runtime pinned to the published version; each committed candidate start uses the committed database timestamp and does not alter another candidate's state. | Safety / ordering | Runtime count and attempt/module/deadline rows |
| FR-3 | Pending-only reservation saturation waits outside database transactions/connections. Waiting and internal re-claims do not charge the 5-per-attempt or 20-per-principal quota again. `START_CODE_COOLDOWN` means the failed budget is exhausted; `START_CODE_BUSY` means bounded admission failed. | Safety / bounded resource use | Response reason, quota counters, active transactions/connections |
| FR-4 | A mismatch consumes one failure; a successful comparison releases pending capacity; an expired pending reservation is conservatively charged to its original window; rotation prevents an old submission from being compared against a new generation. | Safety | Reservation state, generation, and window rows |
| FR-5 | Attempt/schedule identity comes from the verified bearer; a different attempt or schedule cannot reserve or retrieve selected content. | Confidentiality / authorization | HTTP status/body and reservation/content queries |
| FR-6 | A retry after a committed start resumes the original acceptance, deadline, and module state. | Idempotent recovery | Before/after attempt and module snapshots |
| NFR-1 | On each of three cold and three warm local HTTP waves, 600 starts complete with no errors, p95 <2.0s, and barrier-to-last-response drain ≤2.0s; p95 ≤1.0s is an improvement target. | Capacity / performance | Synchronized HTTP test and persisted counts |
| NFR-2 | Failed plus unresolved reservation comparisons remain within the 200-per-generation/window budget; fixed-window identity quotas remain unchanged. | Safety | Concurrent MySQL quota/reservation checks |
| NFR-3 | Acceptance, first-module activation, deadline, and audit are one committed transaction; selected content remains attempt/scope authorized. | Atomicity / confidentiality | MySQL transaction/race and response-body tests |
| NFR-4 | At most 600 blocked requests per API process (and no more than 600 per schedule) share a 15.0s absolute admission deadline measured from handler entry, or earlier cancellation. A waiter holds no DB connection, transaction, or row lock. This bounds admission waiting only, not total request duration. | Bounded resource use | Admission saturation, cancellation, deadline, and pool-probe tests |
| OBS-1 | Each valid, authorized start request that reaches `StartWithCode` and returns an HTTP response includes request-specific application queue wait in `Server-Timing`, split into worker, runtime-initializer, and slot-capacity waits; the header is exposed to browser clients. | Observability | Header assertions and per-candidate load-harness output; no response means wait is unavailable |

The 15-second admission deadline is an upper bound from handler entry or earlier request cancellation; it does not bound a transaction after admission or the full HTTP response. `sat_admission` is only time blocked inside the application admission queues. It excludes auth/decode, DB pool/query/transaction work, serialization, and network time. The 600-wave values are a local qualification profile, not production SLOs.
Per-response timings are diagnostics, not durable student records or metric labels. Transport failures before an HTTP response have no timing header and must remain `unavailable`, not be imputed as zero.

## Exclusion boundary

Not claimed: a click that never reaches the server is included; unbounded liveness or fairness; exactly-once transport; linearizability of the HTTP history; no transient ACK ambiguity; 2,000-candidate/AT15 certification; capacity on a production host, database engine, pool, or replica count; browser/network performance; or correctness under untested migration/version skew and database failover. See `ASSUMPTIONS.md` and `PROOF_REPORT.md` for proof-to-production gaps.