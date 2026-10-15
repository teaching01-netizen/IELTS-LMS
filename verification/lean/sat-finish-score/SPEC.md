# Verification target

SAT finish-score read-time overlay and its student-facing projection. Authoritative data is the committed assessment result plus the active global conversion revision. The changed completion response must use the same overlay and live release policy as bootstrap.

Critical guarantees:
- R1 (ordering/safety): no successful response is derived from an aborted completion transaction. Overlay happens after the successful commit, outside retries.
- R2 (consistency): given identical persisted report, policy-read outcome, and live gate observation, finish and bootstrap return identical report content. This is not equality across arbitrary wall-clock times.
- R3 (integrity): overlay preserves raw data and release status, does not write persisted results, is idempotent under the same policy observation, and strips conversion on policy-read failure when classroomRaw exists.
- R4 (release/privacy): missing classroomRaw stays missing; pending/invalidated or disabled reports expose only the receipt. Internal terminal snapshots never reach the student projection. A gate-read error exposes no result.
- R5 (replay): duplicate completion requests resolve estimates again, using the stored result and current policy, without another terminal receipt.

Scope/production assumptions: arbitrary actor/request IDs, finite retry counts and interleavings, pre-existing legacy/pending/released rows, policy changes, crashes/lost ACKs, and background repairs. SQL commit is an assumed atomic boundary; request-local decoded maps do not alias other requests. Deployed topology and capacity are UNKNOWN. Arithmetic, deadline scoring, answer cutoff inclusion, M1 routing and branch authorization are outside this narrow proof; unchanged upstream gates are reviewed/tested, not newly proved here. No liveness, linearizability of combined policy+flag reads, or throughput guarantee is claimed.
