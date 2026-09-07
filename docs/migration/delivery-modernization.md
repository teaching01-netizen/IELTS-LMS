# Delivery Modernization (migration sequence, compatibility, rollback)

## Sequence

1. Freeze delivery-contracts revision; pin behavior per attempt lifetime.
2. Ship behind explicit feature flags; internal test sessions first.
3. Small operational cohort; compare reliability + performance vs T0.2 baseline.
4. Expand after the agreed observation window; pause rollout on: lost acknowledged answers, false submission confirmation, grading-version mismatch, material interaction regression.

## Compatibility

- Keep outbox + API schemas backward-compatible during migration; retain the previous implementation until active attempts drain.
- Never roll an active attempt back into code that cannot read its pending outbox format.
- V2 submit receipts are provisional until provider completion scores and seals all modules (see SubmitAttemptV2Response.submittedAt note in src/shared/durability/types.ts).

## Rollback (must be demonstrated, incl. queued mutations + active sessions)

- Rollback procedure: pin revision, drain/replay pending outbox in the old format, verify acks converge, confirm terminal states unchanged.
- Runbook pointers: docs/runbooks/frontend-asset-rollback.md, docs/runbooks/student-answer-sync-incident.md, docs/runbooks/rollback-api-version.md.
