# Runbook: worker backlog

Signals: `outbox_pending` rising, `outbox_oldest_age_seconds` growing,
`worker_job_failures_total` up; hot-cycle log shows claimed≫published
or repeated claim failures.

## Triage
1. Distinguish drain vs execute: wakeup families
   (attempt_terminalized, runtime_changed, roster_changed) ack fast;
   `auto_submit_schedule_attempts_requested` needs the finalize path.
2. Check `MarkFailed` dispositions: terminal (>= max attempts) vs
   backoff retry (`BackoffFor`: 5s·2^n capped at 300s).
3. Check DB health: deadlocks / lock-wait timeouts stall ClaimBatch
   (60s lease, 100-row batches, 20 rounds max per hot cycle).
4. Check maintenance overlap: retention/media/projection share the pool.

## Mitigation
- Transient DB pressure: worker self-recovers via lease expiry +
  re-claim; scale pool before scaling workers.
- Poison events (terminal): inspect payload, fix consumer, re-enqueue
  explicitly — never silently drop rows.
- Stuck >72h published rows: `PurgePublished` retention handles them;
  verify before manual deletion.
