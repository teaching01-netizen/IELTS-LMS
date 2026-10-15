# Assumptions and unresolved environment facts

Unknown facts are marked `UNKNOWN`; local evidence does not establish production state.

| ID | Assumption / fact | Status and owner | Evidence or validation | Criticality |
| --- | --- | --- | --- | --- |
| A1 | One database transaction atomically commits the exam, initial draft, optional plan/converter, report flag, create event, and receipt. A transaction abort leaves none of these writes durable. | Refinement obligation; backend/database owners | Go `Create` uses `tx.Runner.WithTx`; local MySQL integration exercises it. Production engine, isolation, durability, and failover settings are `UNKNOWN`. | Critical |
| A2 | The unique key on `(actor_id, scope, operation_key)` serializes simultaneous claims across all API instances. | Refinement obligation; database owner | Migration `0058`; eight concurrent calls passed against local MySQL 9.6.0. Cross-process and production-engine behavior are `UNKNOWN`. | Critical |
| A3 | A receipt and exam bundle persist through process death after commit. | Refinement obligation; database owner | Both are written in the same transaction. Production failover and acknowledged-commit durability are `UNKNOWN`. | Critical |
| A4 | A retry uses the same authenticated actor and operation key, with the same serialized payload. | Client/API contract; frontend and auth owners | The mounted create sheet fingerprints the effective request and reuses its key; `CreateForActor` derives owner from authenticated actor. Key state is in memory, so reload/remount does not preserve it. | High |
| A5 | SHA-256 of Go's JSON encoding is an adequate request fingerprint; collisions are ignored as cryptographically negligible. | Cryptographic assumption; backend owner | `createRequestFingerprint` hashes the request with `OperationKey` blanked. Lean models exact payload equality, not SHA-256 or JSON serialization. | High |
| A6 | Operation keys are retained for seven days and the cleanup job deletes expired receipts. | Code/schema contract; operations owner | Migration `0058` sets `expires_at`; `internal/maintenance/jobs.go` sweeps expired rows. The Lean expiry action models the boundary, not wall-clock scheduling. | High |
| A7 | Generated UUID exam IDs do not collide; the database primary key rejects a collision. | Runtime/database assumption; backend owner | Go uses `uuid.NewString`; Lean uses a monotone natural-number allocator. A collision is not modeled. | Medium |
| A8 | Plan/converter parser results accurately represent the accepted configurations persisted by initialization. | Code refinement; backend owner | Validation and persistence use `satpublish.ParsePlan` / `satconvert.Parse`; focused Go tests pass. Parser implementations are not imported into Lean. | Critical |
| A9 | The frontend deploys only after a backend that recognizes the optional config fields and idempotency header. | Release owner | The feature brief requires backend-first rollout. Actual deployment order/version skew is `UNKNOWN`. | Critical |
| A10 | Production reads for plan and create response are sufficiently current for the UI flow. | Platform owner | Local tests use one primary DB. Production read replicas, caches, and read-after-write routing are `UNKNOWN`. | High |
| A11 | Production topology, MySQL version, API replica count, DB isolation/durability, migration ledger, feature flags, and load profile match the tested local setup. | `UNKNOWN`; platform/release owners | Only a disposable local MySQL 9.6.0 schema migrated through 0089 was exercised. | Critical |

## Model boundary

Lean treats a complete exam bundle plus its ledger receipt as one atomic database commit. That models the intended SQL transaction, not MySQL semantics. It allows arbitrary pre-existing complete bundles and receipts whose result resolves to a bundle, with an allocator cursor beyond existing IDs. It does not admit malformed pre-existing rows; schema/repair state must be checked separately. Concurrent claim serialization, payload hash fidelity, UUID uniqueness, and durable commit behavior remain refinement obligations.
