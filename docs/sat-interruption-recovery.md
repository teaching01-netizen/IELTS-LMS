# SAT interruption recovery

SAT can resume an existing sitting with its valid exam grant after the account
cookie expires. Direct entry and Student Links use the same server-owned attempt
and writer authorization. Expired/revoked access requires recovery; reconnecting
does not extend a deadline. Registration formats and pre-start browser admission
are unchanged.

## Diagnose a report

Obtain the room ID, student code, and approximate incident time. Resolve the
attempt within that room before correlating logs. Database/server timestamps are
UTC; Thailand time is UTC + 7 hours.

Client incident metadata is stored as `STUDENT_DIAGNOSTIC` in
`session_audit_logs`, separate from `VIOLATION_DETECTED`. Example read-only query
(bind the attempt ID; do not interpolate untrusted input):

```sql
SELECT created_at, action_type, payload
FROM session_audit_logs
WHERE target_student_id = ?
  AND action_type IN (
    'STUDENT_DIAGNOSTIC',
    'DEVICE_RECOVERY_ISSUED', 'DEVICE_RECOVERY_REISSUED',
    'DEVICE_RECOVERY_RESTORE_REQUESTED', 'DEVICE_RECOVERY_CONTINUED'
  )
ORDER BY created_at, id;
```

Interpret `created_at` as receipt time and diagnostic `occurredAt` as untrusted
client time. Buffered events can arrive later and browser clocks can be wrong.
Group by `pageId`; `eventId` makes retransmissions idempotent for an attempt.

- `mounted`: exam UI mounted; `navigationType` distinguishes reload, history
  navigation, and ordinary navigation when the browser exposes that information.
- `interrupted`: the same tab retained an unfinished sitting marker. This is an
  unexplained interruption signal, **not proof of a browser crash**.
- `pagehide` / `unmounted`: the browser page left or React unmounted the exam.
- `explicit_exit`: the student used the application's check-in/exit action.
- `route_error` / `render_error`: router or render boundary failure. `chunk`
  indicates a detected bundle-loading failure without retaining its URL/message.
- `unhandled_error`: a browser error or unhandled rejection; raw content is omitted.
- `access_rejected`: access/writer failure observed during the sitting.
- `resume_result`: result of a resume probe with an existing SAT locator.

Correlate these with server access errors, credential expiry/revocation, last
accepted answer updates, and staff recovery. A recovery revocation after the last
answer update does not itself explain the original interruption. Final submission
or timeout does not prove the student experienced uninterrupted delivery.

## Limits and privacy

Only allowlisted event metadata is accepted: IDs, timestamps, application version,
reason/status categories, navigation category, and optional pending-write count.
No answer content, credentials, email, student name, arbitrary error text, or URLs
are included. These client reports never authorize an action, change a timer,
claim a writer, or create a proctoring violation.

Uploads use the existing authenticated audit endpoint, with a three-second
timeout, no credential renewal, and no automatic HTTP retries. A page makes at
most three failed flush attempts; another event, coming online, or reopening the
same sitting can trigger delivery. Client storage retains at most 40 pending
events across sittings for up to 24 hours, and each exam mount generates at most
40 events. Storage and transport failures are best-effort and cannot gate answers.
Server-side records follow the existing audit-log retention policy.

An invalid/revoked writer cannot upload; its events remain local until valid
authority for the same attempt exists. Cleared/denied storage, a new browser,
hard termination, or queue limits can leave gaps. Missing telemetry is not proof
that no interruption occurred. Diagnostics cannot retrospectively explain the
original W260260 incident.

## Delivery

Deploy the backend validation/idempotency change before the client. No database
migration or backfill is required. Verify one controlled SAT sitting: save an
answer, lose the account cookie, reopen entry, and confirm the same answer,
attempt, writer, and deadline. Verify staff transfer still fences the old writer.

Inspect diagnostic audit events for the controlled attempt. On regression,
roll back the affected application build; keep exam data and existing audit
records. Production deployment and production data changes are separate actions.
