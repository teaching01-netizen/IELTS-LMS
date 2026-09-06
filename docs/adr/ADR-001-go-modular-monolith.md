# ADR-001 - Go modular monolith

Status - accepted.

Context - the backend must be rewritten in Go without becoming a microservice migration (full-plan section 1). The database stays the durable coordination layer, so the process topology needs only three roles - api, worker, migrate - sharing one module.

Decision - one Go module with packages per domain over a shared platform layer (config, db, tx, httpx, apperrors, telemetry, clock, crypto, objectstore, shutdown). Constructor injection from BuildApp. No service locator, no global DB, no package-level singletons.

Consequences - splitting into services later requires a new ADR and must re-prove lock ordering and receipt-first guarantees that are trivial in-process.
