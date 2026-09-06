# Runbook: terminalization invariant violation

Signals: `terminal_invariant_violation_total > 0`; worker log
`RunTerminalInvariantAudit issues=N` with names:

- `terminal_attempt_without_receipt`: submitted_at set, no receipt row.
- `scored_sat_on_terminated_attempt`: SAT scored on proctor-terminated.
- `submission_without_result_or_receipt`: orphan submission.

## Triage
1. Capture the issue name + count + one sample attempt id.
2. `SELECT * FROM attempt_terminalizations WHERE attempt_id = ?` —
   receipt missing vs outcome mismatch decides the path.
3. Check worker repair logs: `RepairMissingTerminalReceipts repaired=`
   and `RepairSATTerminalResults repaired=`.
4. Receipts are immutable: never UPDATE/DELETE a receipt row; the
   conflict rule is outcome-only compatible.

## Mitigation
- Missing receipt: `RepairMissingReceipts` backfills from the terminal
  projection; re-run the maintenance cycle, do not hand-insert.
- SAT gap: `RepairSATResults` rematerializes from the snapshot.
- Genuine logic bug (new invariant class): freeze the offending deploy
  per section 130, fix forward with a regression test in
  `internal/terminalization/service_test.go`.
