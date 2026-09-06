# Runbook: grading projection lag

Signals: `grading_projection_lag_seconds` growing; hot-cycle log
`RunGradingProjection error=` or flat synced counts; graders see stale
queues.

## Triage
1. Check the enabled gate (`GRADING_PROJECTION_ENABLED`) and the
   failure counter (`RecordProjectionFailure`).
2. Check the checkpoint: `grading_projection_state_v1` CAS row — a
   stuck watermark means one poison batch; inspect cursors
   (schedule/attempt) and the 24h bootstrap window.
3. Check batch errors at 500-row batches; transient locks retry, poison
   rows park with failure counts.
4. Sync-on-read fallback (`GRADING_SYNC_ON_READ_FALLBACK`) masks lag
   on reads — check whether graders actually hit stale data.

## Mitigation
- Poison batch: fix the offending submission/schedule row, reset the
  checkpoint past it explicitly (audit-logged), let projection resume.
- Sustained lag: raise batch throughput before widening the bootstrap
  window; projection is idempotent so replays are safe.
- Never hand-edit projected grading rows; fix the source submission
  and re-project.
