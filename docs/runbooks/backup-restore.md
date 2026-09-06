# Runbook: backup and restore

Status - required rehearsal before final cutover (plan section 129).

The bar is not backup exists. It is the full chain below, rehearsed
against an isolated database and recorded with RPO and RTO.

## Rehearsal chain

1. Restore the latest production backup to an isolated database
   instance. Never rehearse against the live database.
2. Run schema verification against the restored instance:
   `go run ./cmd/migrate --validate-only` backed by `VerifyRuntimeSchema`
   (required columns, required indexes, mutation uniqueness guard).
   The gate must be clean before any API process starts against
   the restore.
3. Run sample API reads: point a staging API at the restored instance
   and exercise health-gated reads - exam bootstrap, V2 snapshot,
   runtime state, grading queue, results. `/readyz` must report the
   expected schema version.
4. Verify terminal receipts: run the invariant audit
   (`maintenance.AuditInvariants`) and require zero
   `terminal_attempt_without_receipt` rows. Every `submitted_at` must
have its immutable receipt in `attempt_terminalizations`.
5. Verify student submissions: sample restored attempts end to end -
   V2 ledger rows (`attempt_mutations_v2`) project to
   `attempt_responses_v2`, final digests recompute, SAT results
   materialize for terminalized SAT attempts.

## RPO and RTO

Record after every rehearsal and every real event:

- RPO: maximum student-write window at risk (bounded by the V2
  client outbox plus the outbox_events claim lag).
- RTO: time from restore start to `/readyz` green plus invariant
  audit clean on the restored instance.

## Rules

- Never replay writes into the restored instance to catch up. The V2
  ledger replays idempotently through the API once clients reconnect.
- Never hand-edit receipt rows during verification. A missing receipt
  is a finding, not a cleanup task - route to
  terminalization-invariant-violation.md.
