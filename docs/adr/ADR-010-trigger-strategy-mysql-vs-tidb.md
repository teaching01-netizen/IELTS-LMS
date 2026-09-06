# ADR-010 - trigger strategy MySQL versus TiDB

Status - accepted.

Context - triggers differ between MySQL and TiDB dialects and complicate online migration. Business invariants belong in explicit service SQL, not hidden triggers.

Decision - no new business-logic triggers. Existing trigger behavior is ported into service transactions plus outbox rows. Migration 0011 outbox notify trigger is documented as engine-conditional with an application-level fallback.

Consequences - audit trigger inventory per environment before cutover (plan 52). Any engine-specific DDL stays additive and versioned.
