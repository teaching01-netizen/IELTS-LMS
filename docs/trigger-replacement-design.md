# Trigger-Replacement Design: 0043 Triggers → Transactional App Logic (Go/Bun)

**Status:** historical source design, implemented in the Go rewrite. The
canonical migrations now include `0051_drop_terminalization_triggers.sql`;
`internal/terminalization` owns receipt-first sealing and the worker repairs
stragglers. Anchors for provenance remain `backend/migrations/0043_attempt_terminalizations.sql`
and the deleted Rust delivery module.
**Companions:** `docs/terminalization-design.md` §6 (Strategy A/B overview), `docs/schema-migration-reconciliation.md` (migration audit/runbook), `docs/v2-provisional-state-design.md` (provisional window), `docs/proctor-control-design.md` (proctor seals).
**Purpose:** the single spec for replacing all four 0043 triggers with
transactional application logic in the Go rewrite, preserving every invariant
they enforced — including receipt-first ordering and immutability — on both
MySQL and TiDB.

Current deployment uses the triggerless path on both engines: migration 0051
drops the four trigger names on MySQL, while the Go migrator skips trigger DDL
on TiDB. The trigger table and rollback discussion below are retained as
historical compatibility guidance for databases that have not yet converged.

---

## 1. The four triggers and what each enforces

| # | Trigger (0043 anchor) | Event | Effect |
|---|---|---|---|
| T1 | `attempt_terminalizations_legacy_projection` (0043:57–109) | `AFTER UPDATE ON student_attempts` | If `OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL AND NOT EXISTS(receipt)` → `INSERT IGNORE` a conservative receipt (`reason='legacy_unknown'`, `actor_kind='system'`, snapshot from NEW row, `providerKey='legacy'`) |
| T2 | `attempt_terminalizations_legacy_insert` (0043:111–157) | `AFTER INSERT ON student_attempts` | If `NEW.submitted_at IS NOT NULL AND NOT EXISTS(receipt)` → same manufacture |
| T3 | `attempt_terminalizations_immutable_update` (0043:161) | `BEFORE UPDATE ON attempt_terminalizations` | `SIGNAL SQLSTATE '45000'` — receipts cannot be mutated |
| T4 | `attempt_terminalizations_immutable_delete` (0043:166) | `BEFORE DELETE ON attempt_terminalizations` | `SIGNAL SQLSTATE '45000'` — receipts cannot be deleted |

T1/T2 are **compatibility projection** — they exist so a legacy write that flips `submitted_at` outside the seal never leaves terminal state without a receipt (documented at 0043:50–56 as a rolling-deployment guard). T3/T4 are **immutability enforcement** for the authoritative terminal fact.

Verified production access to `attempt_terminalizations` today (the surface the replacement must keep): `load_terminalization_in_tx` (`SELECT … FOR UPDATE`, delivery:422), the seal's single `INSERT` (delivery:715), `repair_sat_terminal_results` (`JOIN`, delivery:3721), and the SAT proctor check (`SELECT outcome … FOR UPDATE`, `assessment_delivery.rs:792`). **There is no UPDATE/DELETE anywhere in app code** — the only mutation paths today are the seal INSERT and the triggers themselves.

## 2. Invariants to preserve (the contract)

- **I1 — receipt ⟺ terminal:** `submitted_at IS NOT NULL` on `student_attempts` ⟺ a receipt exists. (Provisional state is exempt by design: `delivery_status='submitted'`, `phase='post-exam'`, `submitted_at NULL` — see `v2-provisional-state-design.md` §2.)
- **I2 — immutability:** a receipt, once inserted, is never UPDATE'd or DELETE'd. Its `final_snapshot`, `answer_revision`, `effective_at`, `recorded_at`, actor fields are frozen forever.
- **I3 — at most one receipt per attempt:** PK `attempt_id`; a second seal with the same outcome is a *replay* (returns the stored receipt), a different outcome is `TerminalizationConflict`.
- **I4 — receipt precedes claim visibility:** inside the seal transaction, the receipt INSERT happens before the claim UPDATE that flips `submitted_at`. In the trigger world this kept T1 silent; in the triggerless world it remains the ordering that makes I1 provable to every concurrent reader and keeps the same code path valid on MySQL-with-triggers (Strategy A).
- **I5 — straggler coverage:** any write that flips `submitted_at` outside the seal (old binary during rolling deploy, manual/import script) still ends with a conservative receipt — `legacy_unknown`/`system` — never a bare terminal row.
- **I6 — content fidelity:** the manufactured receipt's shape must match T1/T2 byte-for-byte semantics (outcome from `proctor_status`, `providerKey='legacy'`, snapshot fields `attemptId/scheduleId/organizationId/examId/publishedVersionId/answerRevision/answers/writingAnswers/flags`) so downstream consumers cannot tell which writer produced it.

## 3. Design: five enforcement layers

### L1 — Single Terminalize entrypoint (primary I1 enforcement)

Already the architecture; the rewrite keeps it: **`Terminalize(ctx, SealCommand)` is the only code path that may set `submitted_at`/`final_submission` or insert a receipt.** All callers route through it: v1 submit, v2 non-SAT submit, v2 SAT `complete_assessment`, proctor terminate/complete, schedule auto-submit, timeout reconciler. The claim UPDATEs at delivery:741/753 are reachable only inside this function; the v2 provisional UPDATE (which sets `delivery_status`/`phase` but **not** `submitted_at`) is the single documented exception and is exempt from I1 by design.

Verification gate for this layer: a repo-wide check (lint/codegen) that `submitted_at` and `attempt_terminalizations` appear in SQL strings only inside the terminalization module.

### L2 — Receipt-first ordering in code (I4)

The transaction skeleton, identical in intent to `seal_attempt_in_tx` (delivery:581–820):

**Go sketch:**
```go
func Terminalize(ctx context.Context, tx *sqlx.Tx, cmd SealCommand) (*SealResult, error) {
    attempt := lockAttempt(tx, cmd.AttemptID, cmd.ScheduleID)          // SELECT ... FOR UPDATE
    if existing, ok := findReceipt(tx, attempt.ID); ok {                // SELECT ... FOR UPDATE
        if existing.Outcome != cmd.Outcome {                            // outcome-only intent compat
            return nil, &TerminalizationConflict{Outcome: existing.Outcome, ...}
        }
        materializeSatResult(tx, attempt, existing)                     // idempotent replay
        return replayResult(existing), nil
    }
    validateOutcomeReason(cmd.Outcome, cmd.Reason)                      // CHECK vocabulary in app
    if cmd.MinAnswerRevision != nil && attempt.AnswerRevision < *cmd.MinAnswerRevision {
        return nil, &BaseRevisionMismatch{...}
    }
    if isSAT(attempt.ExamID) && cmd.Outcome == Terminated {
        lockSatModules(tx, attempt.ID, cmd.Reason, cmd.EffectiveAt)     // -> locked
    }
    snapshot := buildServerSnapshot(tx, attempt)                        // incl. SAT assessment ext
    receipt := Receipt{...}                                             // terminalizationID = uuid()
    insertReceipt(tx, receipt)                                          // INSERT only, no upsert  (I2/I3)
    claim := updateStudentAttempt(tx, claimPredicate(cmd.Outcome), ...) // delivery:741/753 verbatim
    if claim.RowsAffected != 1 {                                        // incl. OR-branch 2 for
        return nil, &AttemptProctorBlocked{...}                         //   provisional claims
    }
    materializeSatResult(tx, attempt, receipt)                          // pending/invalidated_*
    enqueueOutbox(tx, "attempt_terminalized", ...)                      // in-tx, no live event
    return loadResult(tx, attempt.ID), nil
}
```

**Bun/TS sketch (same order):**
```ts
export async function terminalize(tx: Transaction, cmd: SealCommand): Promise<SealResult> {
  const attempt = await lockAttempt(tx, cmd);          // FOR UPDATE
  const existing = await findReceipt(tx, attempt.id);  // FOR UPDATE
  if (existing) { /* outcome-only replay or TerminalizationConflict */ }
  /* validate outcome/reason enums; min_answer_revision fence; SAT lock; snapshot */
  const receipt = Receipt.create({ ...cmd, terminalizationId: randomUUID() });
  await insertReceipt(tx, receipt);                    // INSERT only
  const claim = await claimAttempt(tx, cmd, attempt);  // predicate verbatim, rowsAffected==1
  await materializeSatResult(tx, attempt, receipt);
  await outbox.enqueueInTx(tx, "attempt_terminalization", { kind: "attempt_terminalized", ... });
  return loadSealResult(tx, attempt.id);
}
```

Why the INSERT precedes the UPDATE: (a) with Strategy A still deployed, T1's `NOT EXISTS` guard sees the receipt and stays silent — the same tx is valid in both worlds; (b) the receipt row is the "reservation" that makes the claim's `rows_affected == 1` check a conflict detector, not a race detector; (c) concurrent readers of the receipt (grading projection, results, live bus) can never observe a terminal row whose receipt does not yet exist.

### L3 — Immutability without triggers (I2)

Three layers, in increasing strength:

1. **Type-level encapsulation.** The receipt entity exposes **no mutation surface**: Go — unexported fields, `Receipt` returned from `findReceipt`/created by `insertReceipt` only, no `Update`/`Delete` methods on `TerminalizationRepository` (only `FindByAttemptID`, `Insert`). TS — `private constructor`, `static load(row)` / `static create(cmd)` factories, `readonly` fields, no `UPDATE`/`DELETE` statement strings outside the repository file (lint-enforced).
2. **DB grants (hard, works on MySQL and TiDB).** The application DB user gets **only `SELECT, INSERT`** on `attempt_terminalizations`; `UPDATE/DELETE/TRUNCATE` stay with the DDL/migration user. A misbehaving or compromised app path fails at the database, not in review. DDL:
   ```sql
   REVOKE UPDATE, DELETE ON <db>.attempt_terminalizations FROM '<app_user>'@'%';
   -- TiDB: identical syntax. TRUNCATE is covered by the DROP privilege on both
   -- engines — the app user must never hold DROP on this schema anyway.
   ```
   Note for MySQL-managed hosts (RDS etc.): user management differs per provider; the grant must be applied via the host's user tooling and asserted by the equivalence gate in §5.
3. **Invariant audit (catches drift the grants miss).** A periodic job (same cadence as the outbox drain) runs two idempotent checks and emits telemetry on violation:
   ```sql
   -- (a) terminal row without receipt  (I1)
   SELECT id FROM student_attempts
   WHERE submitted_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM attempt_terminalizations t WHERE t.attempt_id = id);
   -- (b) receipt without terminal row (I1 converse — should never exist)
   SELECT attempt_id FROM attempt_terminalizations t
   WHERE NOT EXISTS (SELECT 1 FROM student_attempts a WHERE a.id = t.attempt_id AND a.submitted_at IS NOT NULL
                     AND (a.proctor_status <> 'terminated' OR t.outcome <> 'terminated'));
   ```
   (b) is intentionally lenient about the `terminated`/`proctor_status` pairing — the receipt is authoritative and survives even if the projection is later edited.

### L4 — Straggler manufacture as a repair job (I5, replaces T1+T2)

`RepairMissingReceipts(ctx, batchSize)` sweeps exactly the T1/T2 predicates and manufactures the conservative receipt **in its own transaction, per attempt, with the attempt row locked** (so it can never race a real seal):

```sql
SELECT a.* FROM student_attempts a
WHERE a.submitted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM attempt_terminalizations t WHERE t.attempt_id = a.id)
ORDER BY a.updated_at, a.id LIMIT ? FOR UPDATE
```

For each row, `INSERT` (plain, not `INSERT IGNORE` — the `FOR UPDATE` lock plus `NOT EXISTS` makes collision impossible; a concurrent seal would either block until commit and then the re-scan skips, or commit first and the `NOT EXISTS` re-check fails the row): outcome `= IF(proctor_status='terminated','terminated','submitted')`, reason `'legacy_unknown'`, actor_kind `'system'`, actor_id `NULL`, `effective_at = COALESCE(submitted_at, updated_at)`, `recorded_at = UTC_TIMESTAMP(6)`, `answer_revision`, snapshot in the exact T1/T2 shape (I6), `request_id = UUID()`. Every manufactured receipt is logged at WARN with the attempt id — drift is visible, not silent.

**Critical predicate rule:** the sweep matches on `submitted_at IS NOT NULL` **only** — never on `delivery_status='submitted'`. Provisional rows (`delivery_status='submitted'`, `submitted_at NULL`) must never be manufactured into `legacy_unknown` receipts (that is exactly the bug the provisional design exists to prevent).

The INSERT-trigger case (T2) needs no separate handling: the production attempt-creation path (`delivery:3006`) never sets `submitted_at` on insert (verified), so any row caught by T2 semantics is by definition a straggler the same sweep covers.

### L5 — Legacy Strategy A (MySQL rollback only)

For a not-yet-converged MySQL environment, the four triggers may remain as a
temporary rollback/defense-in-depth option: the new code does not depend on
them. Converged Go MySQL environments run migration 0051 and use L1–L4 only;
TiDB environments have always run L1–L4 only. The app suite must pass in both
the legacy-trigger and current triggerless configurations (§5 hybrid gate).

## 4. Migration runbook

1. **Phase 0 — deploy the Go app and canonical migrations.** Existing MySQL databases may keep triggers until `0051` is applied; fresh/converged databases are triggerless. Verify every seal path yields exactly one receipt and never a `legacy_unknown` one (hybrid gate, §5).
2. **Phase 1 — enable `RepairMissingReceipts` + invariant audit** (both engines). Run ≥ N days (N = at least one full rolling-deploy window; recommend 14). Alert on any manufactured receipt or audit violation.
3. **Phase 2 — drop the triggers (MySQL), with pre-check:** zero audit violations for the observation window AND no straggler receipts manufactured in the last 24h. Migration `0051_drop_terminalization_triggers.sql` performs the converged drop:
   ```sql
   DROP TRIGGER attempt_terminalizations_legacy_projection;
   DROP TRIGGER attempt_terminalizations_legacy_insert;
   DROP TRIGGER attempt_terminalizations_immutable_update;
   DROP TRIGGER attempt_terminalizations_immutable_delete;
   ```
   Apply the L3 grants **before** dropping T3/T4 (grants are the immutability replacement) — order matters: grants first, then trigger drop, within one maintenance window.
4. **Rollback:** re-apply the four-trigger DDL from 0043 verbatim (idempotent with existing receipts: both manufacturing triggers are `INSERT IGNORE` + `NOT EXISTS`-guarded). No data migration needed — receipts are unchanged.
5. **The 0043 backfill** (0043 tail: historical rows with `submitted_at` → `legacy_unknown` receipts) stays as migration DDL on both engines; the rewrite's migrator must reproduce it, not re-run the app sweep for it.

## 5. Equivalence gates (replacing the 45000/INSERT-IGNORE proofs)

| Old proof (trigger world) | New gate (triggerless world) |
|---|---|
| 45000 SIGNAL on UPDATE/DELETE | (a) repository has no update/delete surface (compile/type + lint); (b) **grant test**: app-credential connection attempts `UPDATE`/`DELETE` on `attempt_terminalizations` and gets a permissions error on MySQL and TiDB; (c) audit job finds zero drift |
| `INSERT IGNORE` duplicate-receipt proof | replay-or-conflict unit tests: same-outcome second seal returns stored receipt (no second row), cross-outcome → `TerminalizationConflict`; PK `attempt_id` insert collision test |
| Trigger manufactures receipt on straggler write | `RepairMissingReceipts` unit + integration tests: straggler row (submitted_at set outside seal) → exactly one `legacy_unknown`/`system` receipt with the T1 shape (I6); provisional row never touched; concurrent seal vs. repair race → single receipt |
| Trigger stays silent on seal path | **Hybrid gate**: run the full seal-path suite twice — once with the four triggers present (MySQL), once without (TiDB) — and assert identical observable behavior: exactly one receipt, correct outcome/reason, no `legacy_unknown` |
| — | `attempt_write_invariant_guard.rs` port: I1 asserted after every exercised path (submit/terminate/auto-submit/provisional/repair) |
| — | Receipt-first ordering test: instrumented terminalize fails (rollback, no partial state) if the claim UPDATE is attempted before the receipt INSERT |

## 6. Must-not-change contract

1. **Receipt-first ordering** (§3 L2) — the same code must remain valid with triggers present and absent.
2. **Claim predicate verbatim** (delivery:741/753), including the provisional OR-branch `(delivery_status = 'submitted' AND phase = 'post-exam' AND final_submission IS NULL)` — the only thing that lets proctor terminate claim a provisional attempt.
3. **Outcome-only intent compatibility** for replays (`existing_outcome == requested_outcome`, delivery:135–140).
4. **CHECK constraints stay as DDL** on both engines (outcome/reason/actor_kind; TiDB enforces CHECKs) — the app's `validateOutcomeReason` is a fast-fail convenience, not the enforcement.
5. **Backfill stays in the migration** — the sweep must not be the historical backfill, and must not rewrite existing `legacy_unknown` receipts (seal replay is outcome-compatible with them, so a re-seal of a legacy receipt with `submitted` outcome replays; that is existing behavior — keep it).
6. `effective_at`/`recorded_at` semantics, `terminalization_id` UNIQUE, `request_id` idempotency, and the outbox `attempt_terminalized` enqueue (in-tx, no live event) — unchanged.

## 7. Open questions

- Whether the L3 grant layer is acceptable on all target MySQL hosts (managed providers vary) — if not, the audit job becomes the only hard guarantee for T3/T4 replacement, and the triggerless rollout must rely on repository discipline for those environments.
- The observation window (Phase 1, "N days") is a policy choice; the runbook suggests 14 but the deployment team should set it from the actual rolling-deploy cycle.
