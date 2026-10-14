# Specification as verified

**Verification target.** The global, versioned SAT score-conversion policy: draft → publish → active
pointer, and the read-time resolution of every released SAT result against the active revision.

**Scope.** Authoritative state: `sat_score_conversion_revisions`, `sat_score_conversion_active`
(singleton), persisted per-module raw scores inside `assessment_results.score_payload.classroomRaw`.
Actors: any number of administrators (create, save, publish) and any number of readers (staff detail,
student bootstrap). Fault boundary: a request may be rejected, aborted, crash before or after commit,
or lose its ACK and be retried; instances are many and share one MySQL primary. Out of scope: the
release gates (`sat_score_report_enabled`, `release_status`), existing proofs in `../sat-result`,
psychometric correctness of table values, UI behaviour.

## Guarantees (safety unless noted)

| ID | Guarantee | Class |
| --- | --- | --- |
| G-1 (INV-1) | A published revision is never changed or removed. | safety |
| G-2 (INV-2) | The active revision is the published revision with the highest number; numbers are unique and start at 1. | safety |
| G-3 (INV-5, FR-4) | Published revisions form ONE chain: each one's base is the revision active immediately before it. A publish on a stale base cannot commit; two published revisions never share a base. | safety |
| G-4 | A published revision always passes publish validation (complete, valid cells). | safety |
| G-5 (FR-6) | Any displayed converted score is a valid score read from a table with exactly the attempt's operational counts at in-range raw scores; otherwise nothing is displayed. | safety |
| G-6 (FR-4, TC-13) | After a publish commits, every released result - sealed before or after - displays what the new revision resolves from its persisted raw scores. The result's own stored row is unchanged. | safety |
| G-7 (INV-4) | A withheld result never displays a score, whatever any publish does. With no active revision the stored legacy score stays. | safety |
| G-8 | A save applies only to a draft at the expected version (no lost update). | safety |
| G-9 | Re-publishing the active revision (retry after a lost ACK) changes nothing. | idempotency |
| G-10 | Results are insert-only; their raw scores never change. | safety |

**Not claimed:** liveness (a publish eventually succeeds), latency/capacity, correctness of any
table's numbers, exactly-once delivery of the HTTP response, idempotent `POST /drafts`.

## Interpretation choices

- "Atomic publish" is split into: (a) the three writes commit together (database obligation, A-TX),
  and (b) concurrent publishes are serialized by the pointer-row lock (A-LOCK).
- "Retroactive" means the *display* changes; the stored `score_payload` is evidence and is untouched (G-6, G-10).
- A lost ACK on a publish whose revision was later superseded returns 409 `REVISION_SUPERSEDED` although
  the first commit succeeded; that is the specified outcome, not an error of the model.
