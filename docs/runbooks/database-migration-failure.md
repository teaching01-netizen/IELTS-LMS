# Runbook: database migration failure

Signals: `migrate` exits non-zero; deploy blocked pre-start;
`schema_migration_versions` checksum mismatch; legacy-history guard
refusal on a non-empty DB without history rows.

## Triage
1. Read the failure class:
   - Advisory lock held (`ielts_backend_startup_migrations_lock`,
     300s): another migrator is running — wait, do not kill it.
   - Checksum mismatch: a historical file changed after it was
     recorded — the ledger rejects it by design.
   - Legacy guard: non-empty DB with no history rows; needs an
     explicit, reviewed baseline import, never `--force`.
   - Statement failure: file + statement index in the log; migrations
     apply one version at a time, so the DB is at the last good
     version.
2. Verify post-state: `VerifyRuntimeSchema` (required columns /
   indexes / mutation uniqueness guard) reports what is missing.

## Mitigation
- Lock held: let the holder finish; concurrent migrators serialize.
- Bad edit to history: revert the file to the recorded checksum,
  then ship the change as a NEW additive migration.
- Failed version: fix forward with a new version; the failed one
  never partially applies (per-file statement failure stops the run).
- Re-run `migrate --validate-only` until clean before restarting API.
