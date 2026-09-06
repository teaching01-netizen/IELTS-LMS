# Runbook: SAT provisional backlog

Signals: `sat_provisional_pending_age_seconds` growing; worker log
`ReconcileSATProvisionalCompletion repaired=0` while provisional rows
accumulate:

```sql
SELECT COUNT(*) FROM student_attempts
WHERE delivery_status = 'submitted' AND phase = 'post-exam'
  AND submitted_at IS NULL AND final_submission IS NULL;
```

## Triage
1. Check worker maintenance cycle errors (ReconcileProvisional,
   ReconcileModuleTimeouts, RepairSATResults).
2. Check module states: all modules must be submitted|locked before the
   watchdog scores. Stuck `active` modules block completion — inspect
   `ReconcileModuleTimeouts finalized=` counts.
3. Check scoring policy presence per version; missing policy parks rows
   (by design — never fabricate scores).
4. Check for terminalization conflicts on the same attempts.

## Mitigation
- Stuck modules past timeout: watchdog finalizes on next cycle; do not
  hand-update module rows.
- Missing policy: author the policy version, then let the watchdog run.
- If backlog predates a deploy, forward-fix; provisional rows are
  claimed exactly once via the provisional OR-branch predicate.
