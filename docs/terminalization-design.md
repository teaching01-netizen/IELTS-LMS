# Terminalization Module Design — single source of truth for the rewrite

> This document is the authoritative spec the new backend (Go or Bun) implements for **attempt terminalization**: the act of making an attempt’s terminal fact immutable and projecting it into every read model. It consolidates the current Rust/MySQL implementation (epic `9b4414a`) with the DB-owned trigger contract and the v2 provisional path.
> Verified 2026-09-04 against: `backend/crates/application/src/delivery/mod.rs` (`seal_attempt_in_tx` cluster, lines 135–856), `backend/migrations/0043_attempt_terminalizations.sql`, `backend/crates/application/src/delivery/response_durability_v2.rs` (`submit_attempt_v2`, lines 431–675), `delivery/mod.rs` (`repair_sat_terminal_results` ~3711, `auto_submit_schedule_attempts_in_tx` ~3582). Related maps: `docs/backend-rewrite-map.md` §9, §23.1-A/B/I/J/M; `docs/schema-migration-reconciliation.md` §4–5 (trigger re-emission); `docs/backend-rewrite-map.md` §7–§8 (v1/v2).

---

## 1. Purpose and invariants

Terminalization records the one factual, irreversible outcome of a student attempt and projects it into legacy read models. Invariants (in priority order):

1. **One terminal fact per attempt.** `attempt_terminalizations.attempt_id` is the PRIMARY KEY; at most one row ever exists.
2. **Single writer.** `seal_attempt_in_tx` is the *only* code path that creates the authoritative receipt (v1 submit, v2 non-SAT submit, proctor terminate/complete, auto-submit, timeout finalization, module-completion seals). Everything else writes *compatibility projections*.
3. **Immutable once written.** No UPDATE/DELETE on `attempt_terminalizations` — enforced by DB triggers (MySQL) or by lock-and-check in the app (TiDB / managed engines; see §6).
4. **Idempotent and replayable.** The same terminalization intent replayed returns the stored receipt (`created: false`) and re-materializes derived state from the stored snapshot. An incompatible intent is a structured `TerminalizationConflict`, never a silent overwrite.
5. **Server authority.** `effective_at` defaults to `UTC_TIMESTAMP(6)` read inside the transaction; never trust client clocks (30 s closing-grace handling lives in the write gate, not here).
6. **Provider correctness.** SAT adds a *provisional* intermediate state so a receipt is never manufactured before provider scoring runs (migration 0043 trigger hazard — §5.2). IELTS/ACT-style flows seal directly.
7. **Lock order** is always `attempt row → runtime → active section` (or the helper equivalents `lock_attempt_terminalization_scope_in_tx`), so student/proctor/auto-submit races serialize on the same locks.

---

## 2. Vocabulary (schema CHECKs — reproduce exactly)

- `attempt_terminalizations.outcome`: `submitted | terminated`.
- `reason` (varchar 64): `student_submit, sat_complete, time_expired, auto_stop, proctor_complete, proctor_end, proctor_force_submit, proctor_terminate, legacy_unknown`.
- `actor_kind`: `student | proctor | system`. (`student`/`proctor` come from the actor that triggered the seal; `system` for auto-submit/timeout and every trigger-manufactured receipt.)
- `TerminalizationActorKind` mirrors the three values; routes map proctor commands → `proctor`, v1/v2 student submit → `student`.
- Result outcomes derived for SAT (`sat_terminal_outcome_status`): `terminated` + proctor actor → `invalidated_proctor`; `terminated` + anything else → `invalidated_timeout`; `submitted` → `pending` (scoring later flips it; the row is pre-created so section results/score land on a stable result id).
- Conflict vocabulary on incompatible replay: `TerminalizationConflict { message, outcome, reason, terminalization_id, latest_revision }` → HTTP 409 with `details.{outcome, reason, terminalizationId, latestRevision}`.

Schema contract for `attempt_terminalizations` (from 0043; re-emit verbatim, do not retype):
`attempt_id VARCHAR(36) PK`, `organization_id`, `terminalization_id VARCHAR(36) UNIQUE`, `schedule_id` (FK exam_schedules), `outcome/reason/actor_kind` CHECKs above, `actor_id`, `effective_at TIMESTAMP(6)`, `recorded_at TIMESTAMP(6)`, `answer_revision INT`, `final_snapshot JSON`, `schedule_transition_id`, `request_id VARCHAR(36)`. Indexes: `idx_attempt_terminalizations_schedule_recorded (schedule_id, recorded_at, attempt_id)`; `student_attempts` gains `answer_revision INT NOT NULL DEFAULT 0` + `idx_student_attempts_schedule_answer_revision`. FKs to `student_attempts(id)` and `exam_schedules(id)`.

---

## 3. The terminal snapshot (final_snapshot JSON)

Built inside the seal transaction from server-owned state only (never client payload — v1 submit can pass an optional final answer patch that is *applied first*, then snapshotted):

```jsonc
{
  "attemptId": "...", "scheduleId": "...", "organizationId": "...|null",
  "examId": "...", "publishedVersionId": "...", "providerKey": "ielts|sat",
  "answerRevision": 0,
  "answers": { /* canonical v1 JSON, keyed by question id */ },
  "writingAnswers": { /* by task id */ },
  "flags": {},
  // only when provider_key == 'sat':
  "assessment": {
    "moduleAttempts": [ { "id", "moduleId", "state", "allocatedSeconds",
      "startedAt", "submittedAt", "lockedAt", "completionReason", "revision" } ],
    "responses": [ { "id", "moduleAttemptId", "examQuestionId", "response",
      "markedForReview", "eliminatedOptions", "annotations", "revision" } ]
  }
}
```

- Builder `build_server_terminal_snapshot` reads SAT module attempts + question responses with `FOR UPDATE` (they are frozen at the same moment as the receipt).
- The snapshot is the *replay source of truth*: idempotent re-seals and the repair worker re-derive everything from it, never from current live rows.

---

## 4. The seal transaction (authoritative flow)

Pseudo-code of `seal_attempt_in_tx` (single MySQL transaction):

```
1  lock attempt        SELECT * FROM student_attempts WHERE id=? AND schedule_id=? FOR UPDATE
                       (NotFound if absent)
2  existing = SELECT * FROM attempt_terminalizations WHERE attempt_id=? FOR UPDATE
   if existing:
       if terminalization_intent_is_compatible(existing.outcome, req.outcome):   # same outcome
           if provider == 'sat': re-run materialize_sat_terminal_result_in_tx(existing.*, snapshot)
           return SealAttemptResult{..., created: false}                        # idempotent replay
       else return TerminalizationConflict(existing, attempt.revision)          # incompatible intent
3  validate: outcome ∈ {submitted, terminated}; reason ∈ allowlist (CHECK list)
   if req.min_answer_revision: attempt.answer_revision >= required else Conflict BASE_REVISION_MISMATCH
4  recorded_at = UTC_TIMESTAMP(6) (in-tx); effective_at = req.effective_at.unwrap_or(recorded_at)
5  if provider=='sat' && outcome=='terminated': lock_sat_modules_in_tx(attempt, reason, effective_at)
       # UPDATE assessment_module_attempts SET state='locked', locked_at=COALESCE(locked_at,?),
       #   paused_at=NULL, completion_reason=COALESCE(completion_reason,?),
       #   revision=revision+1 WHERE attempt_id=? AND state IN ('not_started','active','review')
6  snapshot  = build_server_terminal_snapshot(attempt, provider_key)
7  INSERT INTO attempt_terminalizations (attempt_id, organization_id, terminalization_id,
       schedule_id, outcome, reason, actor_kind, actor_id, effective_at, recorded_at,
       answer_revision, final_snapshot, request_id)   # terminalization_id = fresh UUID v4
8  projection = req.final_submission OR default_final_submission(snapshot, outcome, reason, effective_at)
       # default: {submissionId: "submission-<uuid>", submittedAt, answers, writingAnswers, flags,
       #            completionReason: reason, autoSubmission: outcome=='submitted' && reason!='student_submit'}
       # + terminated:true when outcome=='terminated'
   enrich projection with submittedAt, completionReason, terminalizationOutcome, terminalizationId,
       answers/writingAnswers/flags/providerKey (from snapshot, insert-if-absent)
9  claim UPDATE student_attempts  (conditional — one row or Conflict):
       outcome=='terminated':
         SET phase='post-exam', delivery_status='terminated', final_submission=?, submitted_at=COALESCE(submitted_at,?),
             proctor_status='terminated', proctor_note=COALESCE(?,proctor_note),
             proctor_updated_at=UTC_TIMESTAMP(6), proctor_updated_by=?,
             revision=revision+1, control_epoch=control_epoch+1
         WHERE id=? AND schedule_id=? AND ((submitted_at IS NULL AND phase<>'post-exam')
               OR (delivery_status='submitted' AND phase='post-exam' AND final_submission IS NULL))
       outcome=='submitted':
         same minus proctor_* fields, plus AND COALESCE(proctor_status,'active') <> 'terminated'
   # NOTE: UPDATE fires 0043 legacy trigger only when OLD.submitted_at IS NULL → NEW.submitted_at NOT NULL
   #       and no receipt exists — impossible here because we inserted the receipt at step 7, so the
   #       trigger's NOT EXISTS guard no-ops. This is deliberate: app writes the real receipt first.
10 if provider=='sat': materialize_sat_terminal_result_in_tx(...)  (see §5.1)
11 OutboxRepository::enqueue_in_tx(aggregate_kind='attempt_terminalization', id=attempt.id,
       revision=attempt.revision+1, event_family='attempt_terminalized',
       payload {terminalizationId, attemptId, scheduleId, organizationId, outcome, reason, answerRevision})
       # durable record only — the worker marks it published (future fan-out); no live-update event is
       # emitted from seal. Sockets learn via wrapping route handlers or later schedule_runtime events.
12 re-read student_attempts; commit; return SealAttemptResult{attempt, terminalization_id, outcome,
       reason, effective_at, recorded_at, snapshot, created: true}
```

**Callers:** v1 `submit_attempt`/`submit_attempt_with_metadata` (outcome `submitted`, reason `student_submit`, actor `student`); v2 non-SAT submit (same, after digest computation — see §5.2); proctor per-student terminate (`proctor_terminate`, actor `proctor`); cohort/force paths that end attempts use the allowlisted reasons `proctor_end`/`proctor_force_submit`/`proctor_complete` (verify the exact per-command mapping at each proctor call site before porting); auto-submit finalization (actor `system`, completion reason `runtime_completed`/`auto_stop`); timeout reconciliation seals (`time_expired`, and `sat_complete` on module-completion); v1 SAT full-assessment submit (`sat_complete`). The v2 SAT path deliberately does **not** call seal at submit time (§5.2).

---

## 5. Provider branches and the v2 provisional path

### 5.1 SAT result materialization (`materialize_sat_terminal_result_in_tx`; runs in the seal tx)
1. No-op unless `provider_key == 'sat'`.
2. Lock `assessment_results WHERE attempt_id=? AND provider_key='sat' FOR UPDATE`.
3. `outcome_status = sat_terminal_outcome_status(outcome, actor_kind)`.
4. If a row exists **and** outcome is `terminated` **and** status differs: `DELETE FROM assessment_section_results` for it, then set `submission_id=NULL, total_score=NULL, outcome_status=?, release_status='invalidated', score_payload={providerKey, outcomeStatus, completionReason, terminalizationId, submittedAt, snapshot}` — i.e., scoring is voided, the result is invalidated, snapshot preserved in payload.
5. Else if no row exists: `INSERT assessment_results (id=<uuid>, attempt_id, submission_id=NULL, provider_key='sat', outcome_status, total_score=NULL, score_payload={…same…}, release_status='invalidated')`.
6. If a row exists and outcome is `submitted`: no-op (the normal completion path already created/kept the pending→scored row; seal must not clobber it).

### 5.2 v2 submit: the two branches (`submit_attempt_v2`)
Common preamble: identifier/batch-shape validation; hash request; lock attempt; validate token/session binding; replay check — same `submission_id` + same `request_hash` returns the stored receipt **even after a terminal boundary**, but still requires the current `lease_epoch` (a superseded session can’t replay old receipts); `submission_id` is globally unique across attempts (`IdempotencyKeyReused`); epoch + runtime-writability checks; flush `final_commands` via `apply_commands_tx`; compute `final_response_digest` from current `attempt_responses_v2`; `attempt_revision = applied.attempt_revision`; `submitted_at = server_now`.

Then:
- **non-SAT:** `seal_attempt_in_tx(outcome:'submitted', reason:'student_submit', actor:student, final_submission: {submissionId, providerKey, finalResponseDigest, protocolVersion:2})` **first**, then a second UPDATE that stamps `response_revision` + `final_response_digest`. Order matters: seal owns `submitted_at`/`final_submission`; the later digest UPDATE cannot re-arm the 0043 trigger because `OLD.submitted_at` is already non-NULL.
- **SAT (provisional):** do **not** set `submitted_at`/`final_submission`. Instead one UPDATE claims provisional state:
  `SET delivery_status='submitted', phase='post-exam', response_revision=?, final_response_digest=?, revision=revision+1, control_epoch=control_epoch+1`
  guarded by `WHERE id=? AND submitted_at IS NULL AND final_submission IS NULL AND COALESCE(delivery_status,'running') NOT IN ('terminated','locked','cancelled')`; `rows_affected != 1` → `AttemptNotWritable`. Because `submitted_at` stays NULL, migration 0043’s AFTER-UPDATE trigger cannot manufacture a legacy `legacy_unknown` receipt before scoring.
- Both branches then INSERT the immutable `attempt_submissions_v2` receipt row (attempt_id, submission_id, lease_epoch, control_epoch, request_hash, expected_attempt_revision, attempt_revision, final_response_digest, receipt JSON, submitted_at) and commit.
- Who finishes SAT: the provider module-completion path writes `assessment_results` (+ section results, score) on the provisional attempt, and a worker step **heals gaps** (below). The final real terminalization for SAT-v1-completed attempts arrives via the normal SAT seal (reason `sat_complete`) once scoring exists.

### 5.3 Repair worker (`repair_sat_terminal_results`, batch 250)
Query (batch, FOR UPDATE): attempts `phase='post-exam'` whose exam `provider_key='sat'` **and** that have an `attempt_terminalizations` receipt **but no** `assessment_results (attempt_id, provider_key='sat')` row. For each: load the receipt, map `actor_kind` (proctor/student/else system), call `materialize_sat_terminal_result_in_tx` from the **stored snapshot**. Idempotent by construction (row no longer matches the gap query after repair). Runs from the worker drain loop and is safe to run concurrently (row locks + gap predicate).

### 5.4 Auto-submit family (context)
`auto_submit_schedule_attempts_in_tx` selects pending attempts (`submitted_at IS NULL … FOR UPDATE`), locks the schedule terminalization scope, dedupe-guards an outbox `auto_submit_schedule_attempts_requested` row, then per attempt decides ownership by timing model: SAT `legacy_section_v1` personal module clocks are *not* overridden by cohort expiry (module reconciler seals at the authoritative deadline); cohort/IELTS flows seal here with the completion reason. `finalize_pending_schedule_attempts` is the worker-side idempotent entry.

---

## 6. Trigger contract (0043) and its replacement

Four triggers exist (MySQL). Names + exact semantics to reproduce or replace:

| Trigger | Event | Semantics |
|---|---|---|
| `attempt_terminalizations_legacy_projection` | AFTER UPDATE on `student_attempts` | When `OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL` and **no** receipt exists: `INSERT IGNORE` a receipt (outcome from `proctor_status='terminated'` → `terminated` else `submitted`; reason `legacy_unknown`; actor `system`; effective_at `COALESCE(NEW.submitted_at, UTC_TIMESTAMP(6))`; snapshot built from the JSON columns with `providerKey:'legacy'`; fresh `terminalization_id`+`request_id` UUIDs). |
| `attempt_terminalizations_legacy_insert` | AFTER INSERT on `student_attempts` | Same guard for rows inserted already-submitted (rolling-deploy/backfill safety). |
| `attempt_terminalizations_immutable_update` | BEFORE UPDATE on `attempt_terminalizations` | `SIGNAL 45000 'attempt_terminalizations is immutable'`. |
| `attempt_terminalizations_immutable_delete` | BEFORE DELETE on `attempt_terminalizations` | Same SIGNAL. |

Migration 0043 also **backfills** every existing `student_attempts` row with `submitted_at NOT NULL` into receipts (`legacy_unknown`, `effective_at = COALESCE(submitted_at, updated_at)`).

Re-emission strategy (see `docs/schema-migration-reconciliation.md` §5):
- **MySQL (Strategy A):** keep the DDL verbatim (renumbered file in the canonical migration set). The immutability triggers stay authoritative; the legacy-projection triggers become *safety nets* for any future code that writes `submitted_at` directly.
- **TiDB / managed engines without triggers (Strategy B):** enforce in the app transactionally —
  - immutability → the seal replay-or-conflict path under the attempt lock (§4 step 2) plus a test that no other UPDATE path touches `attempt_terminalizations`;
  - legacy projection → every code path that sets `submitted_at` must create the receipt in the same transaction (the app already does: seal inserts the receipt *before* the `submitted_at` flip). Prove equivalence with migration tests that flip `submitted_at` and assert the receipt.

Write-path hazard table (who may set `submitted_at`, and what must accompany it):

| Path | Sets `submitted_at`? | Receipt | Notes |
|---|---|---|---|
| v1 submit / proctor / auto-submit / timeout / v2 non-SAT | yes (via seal claim UPDATE) | seal inserts first (trigger no-ops) | canonical |
| v2 SAT provisional submit | **no** (deliberately) | none yet | scored later by provider path |
| Legacy/rolling-deploy direct writes | possibly | trigger manufactures `legacy_unknown` | only during mixed-version deploys |
| Any app path in the rewrite | only via seal-equivalent | same tx | Strategy B requirement |

---

## 7. Idempotency, replay, races

- **Replay semantics:** same outcome intent + existing receipt → `created:false`, and for SAT the result row is re-materialized from the stored snapshot (heals a torn state where seal committed but materialization didn’t). Different outcome → `TerminalizationConflict` (e.g., proctor `terminated` racing a student `submitted` loses deterministically to whichever claimed the row first; the loser gets the structured conflict with the winner’s receipt id/revision).
- **Race windows closed by:** (a) the attempt row `FOR UPDATE` at seal start; (b) the conditional claim UPDATE (§4 step 9) that refuses to clobber an already-terminal row; (c) `lock_attempt_terminalization_scope_in_tx` (attempt → runtime → active section) used by schedule-scoped terminalizers (auto-submit, runtime completion); (d) SAT module lock at §4 step 5 for terminated SAT attempts so no module can keep writing.
- **v2 across-terminal replay:** receipts replay even after terminalization but are still lease-checked — fencing wins over idempotency.
- **Concurrent repair/materialization:** both take `assessment_results … FOR UPDATE`; the worker gap predicate makes replays no-ops.

---

## 8. What the rewrite must NOT change (contract items)

1. Receipt row layout, CHECK values, immutability, and single-row-per-attempt (schema contract §2).
2. `final_snapshot` shape (§3) — grading, answer-history, results, and the repair worker read it.
3. Outcome-status derivation for SAT (`invalidated_proctor` / `invalidated_timeout` / `pending`→scored) and the invalidate-on-retermination behavior (delete section results, null score, `score_payload` with reason/snapshot).
4. The v2 provisional claim for SAT (no `submitted_at`) + digest-after-seal ordering for non-SAT.
5. Lock order and conditional-claim semantics; structured conflict vocabulary.
6. Outbox `attempt_terminalized` durable record and the no-live-event rule.
7. Legacy projection triggers either as DDL (A) or as transactional equivalents proven by tests (B).

## 9. Equivalence gates (tests to port)

Port/rerun as the gate for the rewritten module:
- Epic unit tests in `delivery/mod.rs` §23.1-T: `terminalization_intent_compatibility_only_accepts_same_outcome`, `terminal_snapshot_contains_only_server_owned_attempt_state`, submit/gate tests (`objective_mutation_gate…`, trusted ingress) that exercise writability before seal.
- Epic contract/integration: `backend/tests/contracts/student_contract.rs`, `proctor_contract.rs`, `scheduling_contract.rs`, `backend/tests/integration/mutation_replay.rs`, `attempt_write_invariant_guard`, `response_durability_v2_proof_tests`, `sat_adaptive_runtime` (module locks/timeouts).
- Fork-side migration smoke (`startup_migrations_smoke.rs`) for trigger/backfill boot behavior.
- Trigger proofs (§6): 45000 on UPDATE/DELETE of a receipt; INSERT-IGNORE legacy receipt on a raw `submitted_at` flip; 0043 backfill on migrated rows.
- Re-emission cross-check per `docs/schema-migration-reconciliation.md` §5–6.

## 10. Target module layout (when splitting/porting)

Map §23.1 clusters to new modules (Go package or Bun file): `terminalization` (seal + helpers + snapshot), `sat_materialize` (result materialization + repair), `provider_writes` (claim helpers), `presence`, `finalize` (auto-submit), with `session_context`/`claims` for row acquisition and the idempotency repository shared infra. Single service boundary: one `Terminalize(ctx, SealCommand) → SealResult` entry point that owns the transaction, exactly like `seal_attempt_in_tx` today.

---

*End. Companion docs: `backend-rewrite-map.md` (§9, §23), `schema-migration-reconciliation.md`, `frontend-rewrite-map.md`.*
