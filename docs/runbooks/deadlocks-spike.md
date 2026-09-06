# Runbook: deadlocks spike

Signals: `db_deadlocks_total` rising; worker/API logs with
`deadlock` / `lock wait timeout` / `try restarting transaction`;
`db_tx_duration_seconds` p99 up; ClaimBatch or seal attempts retrying.

## Triage
1. Confirm the errors are the known-transient set (`tx.transient`):
   deadlock, lock-wait timeout, restart-transaction, pre-commit
   connection transients. Anything else (constraint violations,
   syntax) is a bug, not pressure.
2. Identify the lock-order violator: every writer must lock
   attempt -> runtime -> active section (`FOR UPDATE` in that order).
   A new query locking runtime before attempt deadlocks against the
   V2 write path under exam-start load.
3. Check hotspots: `student_attempts` revision bump + `attempt_mutations_v2`
   insert + `attempt_responses_v2` projection in one tx; concurrent
   batches on the SAME attempt serialize (expected), across attempts
   should not block.
4. Check pool saturation (`db_pool_wait_count`): exhausted pools turn
   fast tx into lock-wait timeouts.

## Mitigation
- Transient-only retry is already bounded (`WithTxRetry` with jitter);
  do not add unbounded retries — fix the ordering instead.
- Kill the violating query pattern (reorder locks), then let traffic
  recover; deadlocks abort one side, no manual row repair needed.
- If pool-bound: raise `DB_POOL_MAX_CONNECTIONS` / idle before adding
  API replicas.
