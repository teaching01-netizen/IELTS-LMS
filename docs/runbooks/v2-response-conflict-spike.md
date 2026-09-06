# Runbook: V2 response conflict spike

Signals: `v2_lease_fenced_total`, `v2_control_epoch_stale_total`,
`v2_version_collision_total` rising; 403 LEASE_FENCED / 409
CONTROL_EPOCH_STALE / VERSION_COLLISION in access logs (route
`POST /api/v2/student/attempts/{id}/responses:batch`).

## Triage
1. Break down by outcome label (`v2_response_batch_total{outcome}`):
   `lease_fenced` = two writers (takeover storm or duplicated tab);
   `control_epoch_stale` = pause/resume raced in-flight batches;
   `version_collision` = client retry reusing writeId+version.
2. Correlate with proctor actions (pause/resume/extend bump control_epoch)
   and with takeover rate (`POST .../takeover`).
3. Sample request_ids: confirm client sent stale lease/control epochs vs
   server `student_attempts.lease_epoch/control_epoch`.
4. Check frontend outbox health: stuck flush loops amplify collisions.

## Mitigation
- lease_fenced: expected after takeover; client must recover (snapshot +
  rebase), not retry blindly. If no takeover occurred, hunt duplicate
  sessions sharing one attempt credential.
- control_epoch_stale: client re-snapshots and retries with the new
  control epoch; do NOT roll back the pause/resume.
- version_collision: client mints a fresh writeId; server state is
  authoritative — never force-overwrite the ledger.
- If the spike follows a deploy, follow the rollback/forward-fix policy
  in docs/full-plan.md section 130.

Never log answers or bearer tokens while sampling payloads.
