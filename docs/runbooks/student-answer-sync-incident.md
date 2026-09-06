# Runbook: student answer sync incident

Signals: student reports answers not saving; `v2_response_batch_total`
drops while page views hold; 422 ATTEMPT_NOT_WRITABLE / DEADLINE_EXPIRED;
or Image `submit_replay_total` climbing on
`POST /api/v2/student/attempts/{id}/submit`.

## Triage
1. Identify scope: one attempt (client/outbox) vs many (server/runtime).
   Pull request_id + attempt id; check `student_attempts` row:
   delivery_status, phase, lease/control epochs, deadline_at,
   closing_grace_until, proctor_status.
2. Check runtime gate: `exam_session_runtimes.status`, active section,
   cohort clock vs server time (`UTC_TIMESTAMP(6)`).
3. Check browser outbox: IndexedDB pending rows, flush errors, takeover
   history. A newer response is never replaced by an older one — look
   for superseded outcomes, not lost writes.
4. Check terminalization: a sealed attempt (receipt exists) correctly
   rejects new writes with TERMINALIZATION_CONFLICT.

## Mitigation
- Paused/proctor-blocked: resolve the proctor state; client retries
  after re-snapshot.
- Past deadline+grace: terminal by design; route to proctor review, do
  not hand-edit the ledger.
- Single-client outbox jam: takeover/recover flow, then flush resumes.
- Multi-attempt outage: treat as API/runtime incident (see
  database-outage.md / deadlocks-spike.md).
