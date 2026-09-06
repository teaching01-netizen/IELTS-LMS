# PR Review Checklists (plan sections 134-135)

Paste the applicable section into the PR description and answer every
line. A PR that cannot answer a line is not ready.

## Backend (every backend PR)

### Domain

- Is the rule owned by the correct module (one rule, one owner, 4.1)?
  Name the module and the rule it owns.
- Is the state transition explicit? Name the from-state, the event,
  and the to-state; no implicit transitions.

### Database

- Is tenant scope present? Show the predicate (org, schedule, or
  student scope) or justify platform scope.
- Is the query bounded? Name the LIMIT / batch cap.
- Is the correct index present? Name the index or the migration that
  adds it.
- Is lock order correct? Confirm attempt, runtime, then section. Any
  deviation names the deadlock test that covers it.

### Transaction

- Is the boundary correct? Name the service method owning WithTx and
  everything inside it.
- Are external calls outside the DB transaction? Object-store, HTTP,
  and clock reads that are not DB time must not sit inside the tx.
- Can the command safely replay? Name the idempotency key (write id,
  submission id, claim token, receipt PK).

### V2

- Are lease and control fences correct? Stale lease fences, stale
  control goes stale, exact replay returns the stored receipt.
- Can stale data overwrite newer state? The per-question monotonic
  lease and version rule must hold; hydration never overwrites pending.

### Terminalization

- Is receipt-first preserved? INSERT into attempt_terminalizations
  precedes the claim UPDATE in the same tx.
- Can anything mutate a receipt? The answer must be no: no UPDATE or
  DELETE path on the receipt table exists.

### Operations

- Metrics? Name the new or touched telemetry constant.
- Logs? Request id present, no secrets, answers, or PII.
- Migration compatibility? Additive, backward-compatible with the
  current binary during rolling deploy (section 130).
- Failure behavior? Timeout, retry bound, and lease-expiry story.

## Frontend (every frontend PR)

### Architecture

- Is server logic outside visual components? Protocol, fencing, and
  recovery live in domain, application, or infrastructure, never JSX.
- Is there one owner for state? Name the hook owning the state and
  its single writer.

### V2

- Can hydration overwrite pending state? Visible-version invariant
  must hold: a newer confirmed response never replaces a pending one.
- Is write identity stable? Write ids minted once per intent, reused
  across retries, fresh per new intent.
- Is acknowledgement matched correctly? Ack keys match request ids;
  mismatched acks surface, never silently drop.

### UI

- Did visual output unintentionally change? Screenshots or explicit
  no-visual-change statement.
- Focus preserved? No focus theft on re-render or poll.
- Keyboard preserved? Tab order and shortcuts unchanged or
  explicitly approved.
