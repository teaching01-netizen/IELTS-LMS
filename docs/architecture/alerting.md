# Alerting Spec (plan section 133)

Metric names reference `backend/go/internal/platform/telemetry` constants.
Threshold numerics are deployment-owned and set from observed production
load, not here. What this spec fixes is WHICH signals page versus which
stay on dashboards, and what each page means.

## Page-worthy

- Response write error rate: sustained 5xx on the V2 batch and submit
  routes (`v2_response_batch_total` without a conflict outcome
  breaking down). Expected client conflicts (lease fenced, control
  stale, version collision) NEVER page; see the v2-response-conflict
  runbook for the triage split.
- Database unavailable: `/readyz` failing its DB ping or schema gate.
  Pairs with the database-outage runbook.
- Terminal invariant violation: `terminal_invariant_violation_total`
  above zero, any class. Pairs with the terminalization runbook. This
  is the highest-severity page: it means the receipt-first ordering
  was violated or a repair is pending.
- Missing terminal receipts above zero after the migration window:
  `missing_receipt_repair_total` continuously repairing, or the audit
  `terminal_attempt_without_receipt` count not returning to zero.
- SAT provisional attempts above maximum age:
  `sat_provisional_pending_age_seconds` past the deployment-agreed
  maximum. Pairs with the SAT backlog runbook. Ordinary provisional
  volume is a dashboard, not a page.
- Outbox oldest age exceeds threshold: `outbox_oldest_age_seconds`
  past the deployment-agreed bound, or `worker_job_failures_total`
  with zero successful claims (worker completely stopped). Pairs with
  the worker-backlog runbook.
- WebSocket lease failures spike: `websocket_lease_acquire_failures`
  rate far above the connection-churn baseline. Pairs with the
  websocket-degradation runbook.

## Non-page dashboards

- Ordinary V2 duplicates: `exact_replay` and `write_id` idempotent
  replays at normal client-retry volume.
- Expected client conflicts: fenced, stale, and collision outcomes
  within baseline after takeovers and pause/resume races.
- Connection churn: `websocket_connections` sawtooth at exam
  boundaries, slow-client disconnects at baseline.

## SLO linkage (plan section 132)

Exact numerical SLOs come from observed production load. At minimum
define: student response write availability and latency, submit
availability and latency, runtime command availability, websocket
reconnect success, outbox lag, SAT provisional completion lag, grading
projection lag. The key user-facing reliability SLO is: a locally
accepted student response that successfully reaches the server is never
silently replaced by an older response.
