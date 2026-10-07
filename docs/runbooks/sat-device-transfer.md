# SAT session ownership and device transfer

Design: `docs/superpowers/plans/2026-10-06-sat-session-ownership-and-device-transfer.md`.

One browser session writes a SAT attempt. A second browser or device using the same student identity is blocked before any exam content loads, and moving the attempt requires an approved device transfer: the current device confirms it before any timed module starts, otherwise an assigned proctor approves it. The exam clock keeps running during a transfer.

## Deploy order

1. Apply migration `0076_attempt_device_transfers.sql` before the new API. It is additive: `student_attempts.writer_policy` (nullable) and the `attempt_device_transfers` table.
2. Deploy the API and worker on every replica, then deploy the student/proctor frontend. Confirm the build on every API replica before an exam.
3. Configure:

```dotenv
SAT_SINGLE_WRITER=true               # default; enables SAT admission claims and transfer requests
SAT_SINGLE_WRITER_SCHEDULE_IDS=      # optional comma-separated schedule IDs; empty selects all SAT schedules
SAT_TRANSFER_REQUEST_TTL_SECS=600    # unapproved request lifetime
SAT_TRANSFER_APPROVAL_TTL_SECS=120   # time to redeem an approval
```

The first SAT admission of an attempt claims it for the presenting browser session and snapshots `writer_policy = 'sat_single_writer_v1'`. A snapshotted attempt stays under the policy even if the flag is later turned off. IELTS/ACT attempts are unchanged. Admission always issues credentials at the attempt's current lease; no path issues a hardcoded lease.

For a practice canary, set `SAT_SINGLE_WRITER_SCHEDULE_IDS` to the exact practice schedule IDs on every API replica. Unselected attempts do not acquire a new policy snapshot. Removing a schedule from this list never weakens attempts already snapshotted under the policy.

Browser requirement: the student exam requires Web Locks (Chrome/Edge 69+, Safari 15.4+, Firefox 96+, secure context). Without it the exam shows an unsupported-browser screen instead of starting.

## What students see

| Situation | Behavior |
|---|---|
| Same browser refreshes, reconnects, or re-enters | Resumes; same browser-owned writer identity |
| Second tab of the same browser | "This exam is already open in another tab" — the tab never mounts the exam |
| Another browser/device | "This exam is open on another device" — no questions, no answer input; **Request device change** |
| Before any timed module starts | The original device shows **Move this exam to another device** on the waiting screen; choosing **Allow on another device** approves the request |
| After a module starts | Request waits for proctor approval |
| Approved | The new device redeems the approval, loads server-saved answers, and continues the running clock |
| Old device after transfer | Saves stop with "Opened on another device"; unsent drafts stay on that device as evidence and are never replayed under the new owner |

Heartbeat loss never transfers ownership.

## Proctor approval

The SAT session room shows **Device change requests (N)** while requests are open. Before approving:

1. Verify the student in person and that the new device belongs to them.
2. Check **last server save**. Answers the old device had not saved to the server will not move; the approval requires acknowledging this.
3. Approve or deny. Approval does not change ownership; the target device commits it within the approval window. Denial, cancellation, and expiry leave the current device as writer.

Only assigned proctors (and admins) for the schedule can list or decide requests. Every request, approval, denial, cancellation, conflict, and commit is written to `session_audit_logs` (`DEVICE_TRANSFER_*`).

## Diagnosis

```sql
-- Current owner and policy
SELECT id, active_client_session_id IS NOT NULL AS owned, lease_epoch, writer_policy, delivery_status
FROM student_attempts WHERE id = '<attempt-id>';

-- Transfer history (no session ids or answers are exposed to staff UI)
SELECT id, state, policy_stage, approval_kind, requested_at, expires_at, approved_at,
       approval_expires_at, committed_at, resulting_lease_epoch
FROM attempt_device_transfers WHERE attempt_id = '<attempt-id>' ORDER BY requested_at;

-- Live credentials for the attempt
SELECT client_session_id, lease_epoch, revoked_at, revocation_reason, expires_at
FROM attempt_sessions WHERE attempt_id = '<attempt-id>';
```

Error codes: `SESSION_ALREADY_ACTIVE` (blocked browser asked for protected content), `TRANSFER_APPROVAL_REQUIRED` (legacy takeover or unapproved commit; post-start self-confirmation), `TRANSFER_EXPIRED`, `TRANSFER_CONFLICT` (operation reuse, another open request, lease changed, attempt closed), and `LEASE_FENCED` for writes from a superseded session.

Metrics: `sat_admission_total{outcome}` and `sat_device_transfer_total{action,outcome}`. Investigate a rise in `blocked` admissions (shared devices, cleared storage) and in `commit` outcomes other than `committed`/`recovered`.

## Failure handling

- **Target shows "Approved — opening your exam here…" for a long time:** the commit is idempotent. Reloading the target re-reads the request and recovers the credential while the target still owns the resulting lease.
- **Approval expired before the student continued:** the student requests again; the proctor approves again.
- **Old device unreachable or broken:** approve the request (post-start) after acknowledging unconfirmed-answer risk. Device-only drafts on the old device cannot be recovered remotely.
- **Database unavailable:** no request, approval, or commit can complete; current owners keep local drafts until saves resume.

## Rollback

Set `SAT_SINGLE_WRITER=false` to stop new admission claims and new transfer requests. Attempts already under the policy keep single-writer enforcement; open requests can still be decided, cancelled, and committed, and committed transfers still recover. Do not roll back to an API build that predates this policy while snapshotted attempts are active; keep migration `0076` in place until those attempts are terminal and retention allows removal.

## Capacity validation (staging only)

Run `k6/sat-device-transfer.js` against an isolated staging schedule (`K6_CONFIRM_SAT=true`) and the staging scenarios in the design document (§8). The script checks HTTP admission/commit receipts and V2 snapshot access: competing entry receives no credential, the superseded credential is refused, and repeat commit recovers the same lease. It does not inspect stored database outcomes or exercise V2 answer-save throughput. Pair the run with database invariant checks and a V2 save workload; the legacy PATCH workload in `k6/sat-exam-day.js` is not a substitute. Unit and integration tests do not certify capacity.

## Local verification and unresolved release gates

The production frontend build passes. The transfer browser scenarios exercised post-start proctor approval, old-writer fencing, new-owner saving, and pre-start current-writer confirmation. The post-start scenario also passed twice with retries disabled.

The local backend check passed `go test ./cmd/api ./internal/attempts ./internal/platform/config -count=1`, including schedule-canary selection and rollback precedence. All ten `TestSATTransfer*` scenarios passed with `-race -count=1` against the disposable MySQL database, including concurrent admission through two independently constructed services sharing MySQL, concurrent commit, stale approval after module start, terminal/submit fencing, and progress while a neighbouring attempt holds locks. The rollback case checks stored ownership: disabling new claims preserves owner renewal, permits an outstanding request to finish and recover exactly once, and keeps the superseded writer blocked. This is local service-level evidence, not a deployed multi-replica or operational rollback rehearsal. `sigmap validate` passed with an 8% coverage warning.

The broader Chromium SAT regression run recorded 3 passes and 8 failures: four adaptive-identity failures at the check-in heading, one answer-recovery failure waiting for the start notification, two auto-resume failures (cross-out control and section expiry), and one security failure interacting with the radio input. A policy-disabled diagnostic run passed answer recovery but failed auto-resume during admin setup and the security radio interaction. These results do **not** establish that all failures are pre-existing or that the broader suite passes.

Continuation found a local startup race: recovery could commit a SAT payload before the initial bootstrap, leave the runner in `loading`, and then discard the equivalent bootstrap. The first accepted recovery payload now advances the loading runner. A controller regression failed before the fix and passed after it; all 38 targeted commit/recovery/identity tests passed (the convergence suite also emitted a React `act` warning). The corrected answer/metadata recovery flow subsequently passed in Chromium. Browser fixtures now assert behavioral surfaces rather than removed check-in/start-notification wording, preserve cross-out mode across reload, explicitly select cohort timing when expiring a shared section, and interact with the labeled radio control.

An accumulated disposable database contained 67 exams and 69 schedules; that run recorded rate-limit denials. Clean-database verification uses a newly migrated database, default rate-limit budgets, and retries disabled. This isolates fixture history but does not establish production root cause or certify large staff datasets.

Final local Chromium verification on 2026-10-07 passed **13/13 scenarios, retries disabled**, against the freshly migrated `sat_ownership_browser_final_1007` database. It covered all four adaptive-identity scenarios, both answer-recovery scenarios, both auto-resume scenarios, entry control-epoch adoption, both security scenarios, and both device-transfer scenarios. The staff convergence test now waits for the routed Higher branch rather than accepting the still-active base module; the device-only approval test allows the staff queue's 10-second refresh to retire the committed request. Command:

```bash
# Set TEST_DATABASE_URL to an isolated, already migrated disposable database.
bunx playwright test \
  e2e/sat-adaptive-identity.spec.ts e2e/sat-answer-recovery.spec.ts \
  e2e/sat-auto-resume.spec.ts e2e/sat-entry-epoch-adoption.spec.ts \
  e2e/sat-student-security.spec.ts e2e/sat-device-transfer.spec.ts \
  --project=chromium --reporter=list --retries=0
```

The corrected runtime also passed `bun run typecheck`, `bun run build`, and targeted ESLint checks. This closes the recorded local browser regressions on that isolated fixture set, not the external release gates below.

The reported production incident remains unconfirmed. Staging load certification, multi-replica deployment verification, canary/rollback rehearsal, approval staffing, supported-browser validation, retention, and disaster durability remain release gates. No production capacity is certified by the local tests or k6 script parsing.

Available target metadata currently identifies loopback fixtures and `ielts-lms-production.up.railway.app`, not an isolated staging deployment. Do not run staging capacity scenarios against that production target. Deployment verification needs the isolated staging URL and schedule/student fixtures, replica identities/builds/configuration, and access to database invariants and runtime metrics.
