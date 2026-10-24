# SAT module handoff and recovery

This runbook covers a student who reaches a SAT module boundary while offline,
has an ambiguous save/close response, or misses the separate next-module entry
window. It applies to classroom and independent sessions admitted to
`sat_recovery_v1` on the compatible MySQL fleet.

## Boundary states

The server owns the boundary and its timestamps. `working` is answerable until
the module deadline. At that deadline it becomes `collecting` for the fixed
120-second connection-recovery window; only the frozen answer frontier can be
admitted there. At the recovery cutoff it becomes `blocked`. A settled boundary
contains a durable close receipt and route outcome. A next module stays
`preparing` until the student explicitly enters; its separate 120-second
allowance begins at eligibility. Expiry leaves it blocked and does not start
its exam clock. The browser's local save state and clock are useful diagnostics,
not authorization facts.

## Triage

1. Stop expanding the affected rollout if there is evidence of an acknowledged
   answer missing from the server, a wrong or duplicate route, cross-branch
   content, an auto-start before explicit entry, an ownership bypass, or a
   false clean completion. Preserve the session's pinned policy and route it
   only to compatible API/worker binaries.
2. In the SAT room, open **Needs attention** and select the affected student.
   Read the authoritative boundary phase, deadline, receipt, and resolution
   revision. Check the student's save indicator to distinguish locally
   protected work from a server-confirmed save. Do not ask the student to clear
   storage, reload repeatedly, or switch devices as a first step.
3. Check the bounded metrics below for a cohort pattern. Compare API status,
   database pool waits, transaction duration, deadlocks, rate-limit denials,
   worker failures, and boundary events over the same interval. Use restricted
   diagnostic traces for attempt-level investigation; never put student,
   attempt, schedule, token, or answer values into metric labels.
4. Preserve the attempt ID and boundary revision only in the access-controlled
   incident record. Do not include bearer credentials or answer payloads.

## Lost save or close acknowledgment

Keep the original device and its durable local data available. If the deadline
has not passed, reconnect and allow the normal save retry to finish. If the
server may have committed a close but the response was lost, refresh the
authoritative lifecycle state and inspect the receipt before retrying. A retry
must use the same operation ID and identical frozen envelope; the receipt makes
that replay idempotent. Do not create a new close ID to work around an
uncertain result.

Before the recovery cutoff, the client may submit the frozen frontier and
bounded recovery batches. At or after the cutoff, do not retry fresh answer
writes as if the window were renewed. Preserve the local copy and use the
expired-boundary path below. A local “saved” indicator means protected on this
device, not confirmed by the server.

## Expired answer boundary

The existing answers and route remain authoritative. In independent practice,
the student may choose **Continue with confirmed answers** when the app offers
it. In a classroom, the proctor selects the affected student in the room
inspector, reviews the server-confirmed-answer outcome, enters the required
reason, and records the explicit resolution. This does not admit unconfirmed
local edits or reopen the module. Verify the resulting resolution receipt and
audit entry before telling the student the transition is complete.

If the evidence suggests an acknowledged write is missing, a receipt conflicts,
or the selected route is inconsistent, do not resolve the attempt to make the
room look healthy. Stop new admissions and escalate to the SAT delivery owner.

## Original-device evidence and next-module entry

If the original device reconnects within the fixed recovery window, let the
client replay the exact frozen envelope. After the cutoff, any retained local
answers are evidence only. Use the app's late-answer evidence action when
available; it cannot change canonical answers or routing, and a client timestamp
does not prove when an edit occurred. Preserve the evidence under the existing
attempt retention and access rules.

If the student misses the next-module entry allowance, the module remains
unstarted. Do not instruct the student to refresh until it starts or represent
the entry as successful. In a classroom, the proctor reviews the blocked entry
in the room inspector and uses the explicit entry-recovery action if authorized;
the action records a reason and starts the clock only when the transaction
commits. In independent practice, follow the recovery action shown by the app.
Verify the new boundary revision and active-module receipt before resuming.

## Incompatible client or fleet rollback

The delivery policy is pinned when a new session is admitted. Stop admitting
new `sat_recovery_v1` sessions if a client or server binary cannot honor the
policy. Do not move an in-progress recovery session to an older auto-start
binary, disable its boundary fence, or migrate it to a different policy. Keep
the compatible API, worker, and maintenance binaries available until every
admitted attempt is complete or explicitly resolved. Apply a compatible forward
fix or route those sessions to a compatible fleet.

## Metrics

Use rate and latency changes over a time window; counters are process-local and
should be aggregated across the API fleet. Available signals include:

- `sat_recovery_boundary_total` with `event` equal to `opened`, `settled`,
  `expired`, `entry_expired`, `entry_resolved`, or `resolved`
- `sat_recovery_registration_total` with `outcome` equal to `registered`,
  `replayed`, or `expired`
- `sat_recovery_resolution_total{action,actor,outcome}` and
  `sat_recovery_exception_age_seconds`
- `sat_module_close_total{basis,outcome}` and
  `sat_close_writes_pending_total`
- `sat_route_lag_seconds`, `sat_m2_start_lag_seconds`,
  `sat_personal_entry_total{stage="module",result="missed"}`, and
  `sat_personal_frame_late_total{stage="module"}`
- `http_requests_total`, `http_request_duration_seconds`,
  `http_ratelimit_denied_total`, `db_pool_wait_count`,
  `db_query_duration_seconds`, `db_tx_duration_seconds`,
  `db_deadlocks_total`, `worker_job_duration_seconds`, and
  `worker_job_failures_total`

Browser save-ack latency, oldest locally unconfirmed intent, retry
amplification, and the first answerable frame must be collected from the
synthetic browser/k6 run artifacts; they are not server authorization signals.
Reconcile the run against canonical response hashes, one route, one close or
resolution receipt, and zero branch leaks before interpreting latency. The
2,000-student limits in `docs/plans/SAT.md` remain hard release gates; local
measurements are diagnostic and do not qualify deployment capacity.
