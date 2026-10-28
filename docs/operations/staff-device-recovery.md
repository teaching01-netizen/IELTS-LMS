# Staff-assisted exam recovery

Applies to the implementation plan in `docs/superpowers/plans/2026-10-28-staff-assisted-exam-recovery.md`.

## Staff workflow

1. Open the selected student's details and choose **ย้ายเครื่อง / ให้ทำต่อ**.
2. Confirm the student, exam and eligible section/module. Opening this preview changes no ownership.
3. Leave the time field empty to retain the original deadline, or enter an exact positive `minutes:seconds` award. An award starts when the student presses Continue; the displayed countdown is not an award.
4. Choose **สร้าง QR และรหัส**. This immediately revokes the original writer. Give the personal link/QR and six-digit code to that student.
5. The replacement browser enters the code, checks the preparation screen, then chooses **ทำข้อสอบต่อ**. Questions and answers become available after this explicit action.

Saved work stays in the existing sitting. Unsent work on an inaccessible machine cannot be recovered. A rewind preserves saved later answers, the administered SAT branch, existing forms and break/entry generations.

## Expiry, replacement and restoration

- Issued codes expire after ten minutes. Successful redemption starts a separate ten-minute preparation window. Polling and identical retries do not extend either window.
- Five wrong codes lock a grant. Reissue from the staff dialog. Expired, locked or replaced codes never restore the original machine.
- The original countdown continues during transfer. If it reaches zero, staff must issue a positive time award before Continue can succeed.
- To return to the original machine, choose **กลับไปใช้เครื่องเดิม**. That browser must still possess its original authenticated session and signed attempt credential. It explicitly continues and receives a fresh client session and credential; the revoked token stays revoked.
- If original-browser proof was lost, issue a new QR/code to that browser. Do not copy localStorage, cookies, writer IDs or offline queues between browsers.
- A suspended successor with zero remaining time cannot receive a fresh allocation by retrying. Staff must issue a separate eligible continuation with a positive award.
- Explicit student submission and administrative end/cancellation are final for this feature. Unknown legacy closure provenance is ineligible.

## Rollout and rollback

`STAFF_DEVICE_RECOVERY_ENABLED` defaults to `false`. Keep it off until the plan's verification gates are met. A configured authentication secret of at least 32 characters is required.

Apply migrations 0105–0110 and deploy generation-aware API and worker binaries together before enabling issuance. Do not run old binaries against reopened sittings: old receipt/result queries do not understand completion generations. Keep immutable receipt triggers enabled.

Turning the flag off stops new issuance. Existing grant claim/Continue, status and explicit restoration remain available. Keep the same authentication secret while grants are live; changing it invalidates their verifiers and encrypted staff reveal capsules. Resolve held sittings through the staff workflow before removing capability support.

## Investigation

Use an authorized read-only database connection and scope queries to the specific sitting. Never log or paste codes, fragment secrets, browser proofs, cookies or bearer tokens into incident tickets.

```sql
SELECT id, schedule_id, delivery_status, proctor_status,
       lease_epoch, control_epoch, terminal_generation, deadline_at,
       JSON_UNQUOTE(JSON_EXTRACT(recovery_control, '$.phase')) AS recovery_phase,
       JSON_EXTRACT(recovery_control, '$.target') AS focus
FROM student_attempts WHERE id = ? AND schedule_id = ?;

SELECT id, state, grant_revision, failed_code_count, issued_at,
       expires_at, claimed_at, claim_expires_at, started_at
FROM attempt_device_recovery_grants
WHERE attempt_id = ? AND schedule_id = ? ORDER BY issued_at DESC;

SELECT terminal_generation, terminalization_id, outcome, reason,
       actor_kind, effective_at, recorded_at
FROM attempt_terminalizations WHERE attempt_id = ?
ORDER BY terminal_generation;

SELECT action_type, actor, created_at, payload
FROM session_audit_logs
WHERE schedule_id = ? AND target_student_id = ?
  AND action_type LIKE 'DEVICE_RECOVERY_%'
ORDER BY created_at, id;
```

`RECOVERY_STALE` means refresh authoritative state before a new decision. `RECOVERY_SUPERSEDED` means the old operation no longer owns this sitting. `RECOVERY_TIME_REQUIRED` needs an explicit positive award. `RECOVERY_EXPIRED` needs a new grant. `RECOVERY_CODE_LOCKED` needs staff reissue. Transient server errors should retry the same operation ID.

Use the dialog or the existing authorized controls to resolve an incident. Clearing JSON, owner columns, terminal timestamps or response rows manually bypasses the authority and history invariants.
