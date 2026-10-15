# SAT exam creation verification scope

## Target and authoritative state

This engagement checks the SAT create sheet through `POST /v1/exams`, the Go create transaction, and the active classroom-plan read used by room creation/settings. The MySQL database is authoritative for the exam entity, initial draft, scoring policy, report flag, create event, and idempotency receipt. A create is externally successful only after the transaction commits and the API returns the created exam.

## Interpreted guarantees

| ID | Guarantee | Class |
| --- | --- | --- |
| C-1 | A valid SAT create commits the entity, complete initial draft (including optional plan and converter), score-report flag, created event, and operation receipt together, or commits none of them. | Safety / atomicity |
| C-2 | Within one actor, `exam-create` scope, and retained operation key, the same request payload returns the original exam; the key cannot create a second exam. | Safety / retry idempotency |
| C-3 | Reusing the same retained key for a different payload is rejected without creating an exam. | Safety / request binding |
| C-4 | Plan and converter validation occurs before create writes; invalid input creates no partial exam. | Safety / validation |
| C-5 | Classroom-plan reads use a current draft or published version as their source. An exam with neither pointer fails closed instead of being interpreted as a default full-adaptive plan. | Safety / source consistency |
| C-6 | Older callers without a key retain their existing request behavior. Their creates are not replay-safe. | Compatibility boundary |

The idempotency guarantee is conditional on the client reusing the same key, the authenticated actor remaining the same, and the receipt remaining in the database. Migration `0058_authoring_operation_keys.sql` gives receipts a seven-day retention period. This is at-most-once creation within that boundary, not unconditional exactly-once delivery or eventual completion.

## Exclusions

This proof does not cover score-conversion mathematics, room-creation routing, answer cutoff semantics, scoring/result release, HTTP authorization correctness, external event-bus delivery, UI accessibility, deployment ordering, performance/SLOs, or arbitrary browser recovery. The create key currently survives retries while the create sheet remains mounted; a page reload/remount creates a fresh key. Production database, replica, process, migration, and feature-flag settings were not supplied.
