# Production-like verification plan

No production-like concurrency or load run was performed in this engagement. Local evidence is limited to Go unit tests, frontend tests/typechecking, and read-only SQL expression checks against a local MySQL 9.6 server.

## Required before production readiness

1. **MySQL 8.4 query semantics:** Run the application-generated available and unavailable count queries against a disposable MySQL 8.4 database. Seed rows for: valid integer raw counts; JSON null; missing fields; fractional and integral-decimal counts; signed-int64 maximum and overflow counts; negative counts; zero total; `correct > total`; legacy `total_score`; pending outcome; no result row. Assert each row belongs to exactly one filter and the result agrees with the returned JSON fields.
2. **Active revision race:** Use two real API instances and a barrier after the result page query but before `ActiveRevision`. Publish/activate revision A, pause a list read, activate B, release the read; assert the displayed estimate is produced wholly by the one revision that the pointer query observed, or is absent on lookup failure. Repeat with concurrent list requests and alternating activation. Do not assert a stable snapshot across count/page/policy queries unless the API is changed to provide one.
3. **Lookup and connection failures:** Force the active-revision SQL read to fail after a result row containing a valid old `totalScaled`; assert raw counts remain, estimate is absent, and the service records the intended operational signal. Recover the connection and assert the next read uses the active policy.
4. **Persisted data anomalies:** Seed contradictory branch rows, duplicate section keys, tied/interleaved display orders, missing module raw counts, per-module values at MaxInt64, section-sum overflow, and malformed nested JSON. Assert grouping remains stable and ambiguous route/score data is withheld.
5. **Question-review access:** With a staff session, verify response labels, key labels, SPR text, unknown-option fallback, filters, and null verdicts. With a student or unauthenticated session, verify the existing staff result endpoint remains inaccessible.
6. **Version skew:** Exercise old backend/new frontend and new backend/old frontend during a rolling deployment. Optional JSON fields must not break decoding; the user-visible score state must not become falsely available.
7. **Capacity and recovery:** On the deployed DB engine and topology, run multiple API instances at representative peak read concurrency and result sizes. Record workload, p50/p95/p99, errors, query latency, pool saturation, and replica lag. The model proves no capacity bound.

## Expected observations

- Every scored row with a legacy score or a valid classroom summary is `available`; all other rows are `unavailable`.
- Lookup failure never presents a persisted conversion as active. The raw score remains visible when valid.
- A read overlapping activation may observe either revision at the active-pointer statement; it must not mix two conversion revisions within one row/page application.
- Invalid or contradictory raw/module data degrades to absent summary/conversion/route fields, not an invented score or route.
- Results remain within the tested SLO and do not saturate pools under the declared workload. No SLO or capacity claim exists until that profile is supplied and measured.
