# Runbook: rollback to previous API version

Context: api/worker/migrate build from one repo; migrations are
additive and backward-compatible with the current binary during
rolling deploy (section 130). Rollback means running the PREVIOUS
binary against the CURRENT schema — never rolling the schema back.

## Triage
1. Confirm the regression came from the API binary (not schema):
   `migrate --validate-only` clean + readyz schema version expected.
2. Check which routes regressed (access-log route template +
   status); V2 write routes are the highest blast radius.
3. Confirm the previous binary supports every column it will touch
   (additive migrations only add nullable/defaulted columns).

## Mitigation
1. Shift traffic back to the previous API image; keep the DB as-is.
2. Worker: the previous worker image is equally safe (idempotent
   jobs, 60s outbox leases re-claim cleanly).
3. NEVER run `migrate` down / drop columns to "match" the old
   binary — forward-fix the schema instead.
4. Drain: wait out the 30s graceful-shutdown window (`DrainTimeout`)
   per instance before declaring the rollback complete.
