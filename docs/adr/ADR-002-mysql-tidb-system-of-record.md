# ADR-002 - MySQL and TiDB remain system of record

Status - accepted.

Context - the ported concurrency machinery is relational and transaction-based - SELECT FOR UPDATE serialization, conditional claim UPDATEs, idempotency ledgers, outbox claim leasing.

Decision - MySQL (TiDB-compatible) stays primary. Connections are UTC per tx, pools bounded, REPEATABLE READ via tx.Runner. SQLite is explicitly not a substitute for integration tests (plan 110).

Consequences - every new table needs locking, index, and retention review (section 130). Trigger strategy diverges per engine (ADR-010).
