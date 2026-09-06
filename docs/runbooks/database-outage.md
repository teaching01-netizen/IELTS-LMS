# Runbook: database outage

Signals: `/readyz` 503 (ping fails or schema version unknown);
`db_pool_wait_count` pegged; API + worker logs show connection refused /
bad connection / broken pipe; `outbox_oldest_age_seconds` climbing.

## Triage
1. `/healthz` (no deps) vs `/readyz` (DB ping + `SchemaVersion`):
   healthz-ok + readyz-fail isolates the DB from the process.
2. Check pool config: `DB_POOL_MAX_CONNECTIONS`, idle, acquire timeout;
   look for connection-creation storms after a DB failover.
3. Reads degrade first: V2 snapshot, runtime reads, grading lists.
   Writes queue client-side (frontend IndexedDB outbox) — answers are
   NOT lost while the outage is shorter than the exam window.
4. Worker: hot cycle claim failures log per round; maintenance stalls
   (provisional backlog grows — see sat-provisional-backlog.md).

## Mitigation
- Fail over / restore the DB (see database-migration-failure.md for
  ledger safety); API recovers without restart once the pool
  reconnects.
- Do NOT hand-write attempt/mutation/receipt rows to "catch up" —
  the V2 ledger replays idempotently; duplicates resolve via
  exact-replay and write-id conflict rules.
- Post-recovery: watch `terminal_attempt_without_receipt` audit — any
  row sealed during the outage must have its receipt; run
  `RepairMissingReceipts` via the maintenance cycle.
- Document RPO/RTO per section 129 after every real event.
