# V2 Provisional-State Design: SAT Two-Phase Completion

**Status:** source-verified against `main` @ `9b4414a` (epic lineage). Anchors: `backend/crates/application/src/delivery/response_durability_v2.rs` ("v2"), `backend/crates/application/src/assessment_delivery.rs` ("sat"), `backend/crates/application/src/delivery/mod.rs` ("delivery"), `backend/migrations/0043_attempt_terminalizations.sql` ("0043").
**Purpose:** the single spec the rewrite implements for the window between a SAT student's final submit and the provider-scored result — who may write, and how the real result is persisted without tripping the 0043 terminalization trigger.

---

## 1. Why this state exists at all

`0043` installs an `AFTER UPDATE` trigger (`attempt_terminalizations_legacy_projection`) that manufactures an immutable terminal fact whenever a legacy write flips `student_attempts.submitted_at` from `NULL` to non-`NULL` (0043:57–109). The materialized receipt is **wrong for SAT**: it would freeze a `final_snapshot` (answer revision, answers JSON) *before* provider scoring runs, with `reason='legacy_unknown'`, and the receipt is immutable (update/delete triggers signal 45000, 0043:161/166). A SAT attempt would then be permanently terminal with a garbage receipt and no real score.

Two mechanisms keep SAT correct, and they compose into the two-phase protocol:

1. **Provisional submit (v2):** the final submit flips the lifecycle to `submitted`/`post-exam` but deliberately **never sets `submitted_at`** → the trigger's `NEW.submitted_at IS NOT NULL` predicate is never satisfied (v2:391–410).
2. **Receipt-first seal (delivery):** when the real result exists, the seal inserts the authoritative terminalization row **before** the UPDATE that sets `submitted_at` → the trigger's `NOT EXISTS (existing receipt)` predicate fails (delivery:581+; 0043:102–105).

The provisional state is therefore a *claimed, closed, but not-yet-terminal* lifecycle state: the student is locked out of writing, the proctor can still terminate, and only the provider scorer (or the timeout reconciler) may convert it into the real terminal fact.

## 2. The provisional submit (`submit_attempt_v2`, v2:276–493)

Entry: `POST` V2 submit with `submission_id`, `lease_epoch`, `control_epoch`, `expected_attempt_revision`, `final_commands`. Transaction (attempt row `FOR UPDATE` first):

1. **Identity + session:** `validate_attempt_identity` (attempt/schedule/tenant/user binding, `protocol_version = 2`), `validate_token_session` (token row `FOR UPDATE`, not revoked/expired), `validate_request_epochs` (lease epoch == attempt lease, control epoch == attempt control).
2. **Receipt idempotency:** `attempt_submissions_v2` row `FOR UPDATE`. Same `submission_id` + same `request_hash` → replay the stored receipt (lease-fenced; v2:311–324). Different submission id → `IdempotencyKeyReused` (v2:326–334). `submission_id` is globally unique across attempts (v2:337–352).
3. **Revision fence:** `expected_attempt_revision` must equal `attempt.response_revision` or `VersionCollision` (v2:366–383). This is the last command accepted; the fence makes the receipt attest to a specific answer state.
4. **Runtime gate:** `lock_runtime_write_gate` (attempt → runtime → active section locks, v2:1189–1246) + `ensure_runtime_response_writable` (runtime live, no waiting-for-next-section, active section live/not paused/started, `server_now <= deadline + 30s closing grace`; v2:1602–1664) + `ensure_attempt_writable` (v2:1771–1804).
5. **Final commands applied** via `apply_commands_tx` (new write ids only; exact replays dedupe).
6. **Digest:** `final_response_digest` computed over `attempt_responses_v2` projection — sorted `(question_id, response_hash)` pairs, length-prefixed, sha256 (v2:196–226). The attempt row lock serializes writers, so this is a consistent read.
7. **Provider branch (v2:391–437):**
   - **SAT** (`provider_key='sat'`) → **provisional UPDATE**, exact statement (v2:400–409):
     ```sql
     UPDATE student_attempts
     SET delivery_status = 'submitted',
         phase = 'post-exam',
         response_revision = ?,
         final_response_digest = ?,
         revision = revision + 1,
         control_epoch = control_epoch + 1,
         updated_at = CURRENT_TIMESTAMP(6)
     WHERE id = ? AND submitted_at IS NULL
       AND final_submission IS NULL
       AND COALESCE(delivery_status, 'running') NOT IN ('terminated', 'locked', 'cancelled')
     ```
     `submitted_at` and `final_submission` stay `NULL`. If `rows_affected != 1` → `AttemptNotWritable` ("could not claim the provisional attempt state") and the whole tx rolls back. Note the guard deliberately does **not** exclude `'submitted'` — `delivery_status` is `'running'` at this point in the normal flow.
   - **Non-SAT** → `seal_attempt_in_tx` with `outcome='submitted'`, `reason='student_submit'`, `actor_kind=Student`, `final_submission` carrying `submissionId/providerKey/finalResponseDigest/protocolVersion=2` **first**, then a digest UPDATE afterwards (v2:419–437). Order matters: seal owns `submitted_at`; the follow-up digest write can never re-arm the trigger because `OLD.submitted_at` is already non-NULL and a receipt already exists.
8. **Receipt row:** `INSERT INTO attempt_submissions_v2 (attempt_id, submission_id, lease_epoch, control_epoch, request_hash, expected_attempt_revision, attempt_revision, final_response_digest, receipt, submitted_at)` (v2:453–474). Commit.

The receipt (`SubmitAttemptV2Response`: `status="submitted"`, `attempt_revision`, `final_response_digest`, `submitted_at=now`) is what the client persists; the provisional row state is the server-side claim.

## 3. Who may write between provisional submit and provider scoring

After step 7 (SAT), `student_attempts` has `delivery_status='submitted'`, `phase='post-exam'`, `submitted_at=NULL`, `final_submission=NULL`. Every writer's gate:

| Writer | Gate | Outcome in provisional window |
|---|---|---|
| V2 `save_responses_batch`, new commands | `ensure_attempt_writable` (v2:1771) — rejects `submitted`/`post-exam` | **Rejected**, `AttemptNotWritable` |
| V2 `save_responses_batch`, exact replay | `batch_is_exact_replay` (v2:1495) bypasses runtime gate; `apply_commands_tx` only gates new write ids | **Allowed** — returns `Duplicate` acks; requires still-authorized token at current lease (v2:213–222). Deliberate: a client retrying its last batch after submit must not error |
| V2 `takeover_lease` | `ensure_attempt_not_terminal` (v2:1806) — `submitted` is in the terminal set | **Rejected**, `AttemptNotWritable` ("cannot be taken over after terminalization") |
| V2 `get_responses_snapshot_authorized` | read-only; validates identity/session/lease | **Allowed** — recovery/refresh still works |
| SAT `start_module` / `save_response` / `submit_module` | `ensure_attempt_can_work_tx` (sat:2225–2284) — rejects `submitted`/`post-exam`, runtime not live, proctor paused/terminated | **Rejected** (module lifecycle closed) |
| SAT `complete_assessment` | no can-work gate; `lock_attempt_terminalization_scope_in_tx` + proctor/terminalization check | **Allowed** — this is the provider scoring path (§4) |
| Timeout reconciler (`reconcile_attempt_timeout` / worker `reconcile_expired_modules_at`) | GET_LOCK `'ielts_sat_runtime_reconciliation'` (sat:2560–2566); finalizes remaining modules `time_expired` → `complete_assessment` | **Allowed** — system may still finish a provisionally-submitted attempt whose modules never all submitted |
| Proctor `terminate` | seal claim predicate §5.2 (delivery:741) | **Allowed** — terminates with `proctor_status='terminated'`, real receipt, SAT module invalidation |
| Proctor `force_submit` / `complete` | seal claim predicate §5.2 (delivery:753) | **Allowed** — completes as `submitted` |

**Net rule:** after provisional submit, no *student* write path can change answers; only (a) exact idempotent replays, (b) read-only snapshots, (c) the provider scorer, (d) the timeout reconciler, and (e) proctor terminalization are legal. Every one of them is fenced by the same row locks in the same order (attempt → runtime → active section), so none can race the provisional UPDATE.

## 4. How module completion produces the real result without tripping the trigger

The phrase "SAT module-completion path" covers two distinct stages; only the second touches the trigger's table.

### 4.1 Per-module completion (`submit_module` → `finalize_module_tx`, sat:722–779, sat:2131–2305)

`submit_module` re-validates binding, `reconcile_attempt_timeout` (auto-finalizes anything already expired), `ensure_attempt_can_work_tx`, locks the module attempt row, then `finalize_module_tx`:

1. Scores the module from `assessment_exam_questions` + `assessment_question_revisions` + `assessment_question_responses` (`score_scoring_rows` → `raw_correct`, `operational_question_count`).
2. `UPDATE assessment_module_attempts SET state = 'submitted'|'locked' (time_expired/proctor_end/proctor_terminate → locked), submitted_at, locked_at, paused_at = NULL, completion_reason, raw_correct, operational_question_count, revision = revision + 1 WHERE id = ? AND state IN ('not_started','active','review')` (sat:2168–2177). Fails `Conflict` if another request already finalized.
3. Adaptive routing: for a `base` module, `PracticeThresholdRouting.choose_route` against `assessment_routing_policies` → `assessment_route_decisions` INSERT (policy key + revision snapshot), then the chosen branch module is inserted as the next module attempt; for a branch module, the next section's base module (or `None` if it was the last module) (sat:2249–2305).
4. **It never writes `student_attempts`.** The only `student_attempts` writes anywhere in the SAT delivery lifecycle are `mark_provider_attempt_exam_phase_in_tx` (`phase='exam'`, `control_epoch+1`; delivery:274–285) and `increment_provider_attempt_answer_revision_in_tx` (`answer_revision+1`; delivery:287–299) — both guarded by `submitted_at IS NULL` and neither touches `submitted_at`/`final_submission`. **No trigger predicate can ever be satisfied.**

### 4.2 Final result (`complete_assessment`, sat:922–1258)

Requires every module in `submitted`/`locked` state ("All SAT modules must be submitted before finalization"). Sequence inside one tx (attempt row locked first via `lock_attempt_terminalization_scope_in_tx`):

1. Proctor check: `proctor_status='terminated'` or existing `outcome='terminated'` receipt → `AttemptProctorBlocked` (sat:940–960).
2. Submission idempotency: `student_submissions WHERE attempt_id AND provider_key='sat'`. If present **and** `assessment_results` row loadable → **re-seal** with `reason='sat_complete'` and return the existing result (sat:963–985). This makes `complete_assessment` replay-safe after an earlier successful seal.
3. Aggregate per-section scores from module rows, verify a single adaptive route per section (multiple branches → `InvalidData`), `score_section` from `assessment_scoring_policies.policy_config`, `total_score`, build `score_payload` (sat:1048–1130).
4. `INSERT student_submissions` (provider_key='sat', `grading_status='submitted'`, section statuses auto_graded) and `INSERT assessment_results` (`outcome_status='scored'`, `release_status='ready_to_release'`) + `assessment_section_results` rows (sat:1132–1200).
5. **Seal** with `reason='sat_complete'`, `actor_kind=Student`, `final_submission = {"submissionId", "providerKey":"sat", "assessmentResultId"}` (sat:1202–1232). The result rows live in tables the trigger does not watch.

Trigger math for step 5: seal inserts the `attempt_terminalizations` receipt (PK `attempt_id`, `INSERT IGNORE`) *before* its claim UPDATE; the trigger then runs with `NOT EXISTS(SELECT 1 FROM attempt_terminalizations WHERE attempt_id = NEW.id)` **false** → no duplicate receipt is manufactured (0043:102–105). The receipt is the authoritative one: `reason='sat_complete'`, real `final_snapshot`, correct `answer_revision`.

### 4.3 Timeout path

`reconcile_attempt_timeout` (sat:2307+): locks attempt → runtime → stage rows; for each non-terminal module (bounded `for _ in 0..32`), if its stage expired (or runtime completed/cancelled, or a later stage is active), `finalize_module_tx(..., "time_expired")`; when the last module finalizes → `should_complete_assessment` → commit, then call `complete_assessment` (sat:2474–2485). The worker variant (`reconcile_expired_modules_at`) batches the same transitions under a MySQL named lock so scale-out stays deterministic. In the provisional window, this is the only path that can still finalize `not_started` modules — after which the same `complete_assessment` seal runs, and its `final_submission` carries the computed result.

## 5. The seal contract that makes this safe (delivery:581–~800)

The spec assumes `seal_attempt_in_tx` (full detail in `docs/terminalization-design.md`); the parts the provisional design depends on:

### 5.1 Receipt-first ordering (immutable)
1. Lock attempt row (`FOR UPDATE`) → replay-or-conflict against `attempt_terminalizations` (existing receipt: same `request_id` → return; different → `TerminalizationConflict`).
2. Optional `min_answer_revision` fence (`Conflict` if `answer_revision < min`).
3. SAT: `lock_sat_modules_in_tx` — on `terminated` outcome, lock `assessment_module_attempts`, invalidate `not_started`/`active` modules (`state='locked'`, `completion_reason='invalidated_proctor'`/`'invalidated_timeout'`), delete any section results, store `score_payload`.
4. Build `final_snapshot` JSON (including SAT `assessment.{moduleAttempts,responses}` extension) from live rows read `FOR UPDATE`.
5. `INSERT IGNORE` the receipt (PK `attempt_id`) with `outcome` ∈ `submitted|terminated`, `reason` ∈ the 0043 CHECK list, `actor_kind` ∈ `student|proctor|system`.
6. **Claim UPDATE** (delivery:741 terminate / delivery:753 submit):
   ```
   WHERE id = ? AND schedule_id = ? AND (
       (submitted_at IS NULL AND phase <> 'post-exam')
       OR (delivery_status = 'submitted' AND phase = 'post-exam' AND final_submission IS NULL)
   ) [AND COALESCE(proctor_status,'active') <> 'terminated' for submit]
   ```
   The **second OR-branch is the provisional-state hook**: a seal arriving after the v2 provisional submit can still claim, because the provisional UPDATE left `final_submission NULL` and `submitted_at NULL`. `rows_affected != 1` → conflict (refuses to clobber an already-terminal row).
7. SAT result materialization + outbox `attempt_terminalized` enqueue in-tx. No live-update event (sockets learn via polling/proctor handlers).

### 5.2 Write-path hazard table (who may set `submitted_at`)

| Path | Sets `submitted_at`? | Trigger outcome |
|---|---|---|
| V2 provisional UPDATE (SAT) | No | never fires (predicate false) |
| Non-SAT v2 seal (`student_submit`) | Yes, receipt inserted first | fires, but `NOT EXISTS` false → no-op |
| Non-SAT digest UPDATE after seal | already non-NULL | `OLD.submitted_at IS NULL` false → no-op |
| `complete_assessment` seal (`sat_complete`) | Yes, receipt inserted first | fires, but `NOT EXISTS` false → no-op |
| Proctor terminate/force_submit/complete seals | Yes, receipt inserted first | same |
| 0043 backfill / legacy app writes | n/a | manufactures `legacy_unknown` receipt (only for pre-migration rows / rolling-deploy stragglers) |

## 6. Failure modes and races

- **Provisional claim fails** (`rows_affected != 1`): attempt was terminated/locked/cancelled or already claimed by a concurrent submit → whole tx rolls back, client gets `AttemptNotWritable`, its receipt is not persisted. Client must surface "attempt already closed" and recover via snapshot.
- **`complete_assessment` seal after provisional but module rows incomplete:** sealed only after the "all modules submitted/locked" check; the timeout reconciler is the backstop that finalizes stragglers.
- **Seal races provisional:** impossible — both take the attempt row lock first, and the claim's OR-branch handles both orders (seal-before-provisional: branch 1; provisional-before-seal: branch 2).
- **Receipt replay after terminal boundary:** allowed only with a same-lease token; `validate_claim_lease` re-checks `lease_epoch` under the row lock (v2:213–222).
- **Proctor terminates during the provisional window:** claim branch 2 holds for the terminate predicate too (delivery:741) — outcome `terminated`, SAT modules invalidated; the pending scorer's later `complete_assessment` is blocked by the `outcome='terminated'` check (sat:946–960).
- **Timeout reconcile double-completes:** named lock `ielts_sat_runtime_reconciliation` serializes the worker; `student_submissions`/receipt idempotency makes the second pass a no-op re-seal.

## 7. Equivalence gates for the rewrite

Port these as the acceptance tests of the two-phase behavior (from the epic suites):
- `response_durability_v2` unit tests: provisional UPDATE guard, `AttemptNotWritable` on claim failure, digest computation, receipt idempotency/replay (v2 test region, v2:1870+).
- `student_contract.rs` V2 submit flows (2.9k-line contract suite).
- `assessment_delivery` tests: `submit_module` gating, `complete_assessment` re-seal path, timeout reconcile (`time_expired` → locked), `attempt_write_invariant_guard`.
- Migration smoke: `45000` immutability proofs + `INSERT IGNORE` duplicate-receipt proof (0043 test harness).

## 8. Must-not-change contract for the new backend

1. `submitted_at` and `final_submission` are **claim-owned** — only `seal_attempt_in_tx`'s claim UPDATE may set them; nothing else may flip `submitted_at` on a provisionally-submitted SAT row.
2. The claim predicate's OR-branch (`delivery_status='submitted' AND phase='post-exam' AND final_submission IS NULL`) must survive verbatim — it is the handshake between the two phases.
3. Receipt-first ordering inside the seal tx (INSERT receipt → claim UPDATE) is what neutralizes the 0043 trigger; reordering reintroduces `legacy_unknown` receipts.
4. Module-finalize writes must stay off `student_attempts` (or, in an app-enforced rewrite, keep the `submitted_at`-invariant out of the module path).
5. `ensure_attempt_writable`'s terminal set (`submitted|terminated|paused|locked|cancelled`, `phase='post-exam'`) is what closes the write window; an exact replay must remain the only student-side exception.
6. Lock order attempt → runtime → active section everywhere (§3 table).

## 9. Open questions

- The exact client-side sequencing between `submit_attempt_v2` and `complete_assessment` (does the SAT client call both, or does the reconciler drive the second phase when the client only did V2 submit?) — the server tolerates either order, but the rewrite should pin the intended one.
- Whether the provisional window needs a watchdog: today, if a provisionally-submitted attempt's `complete_assessment` never runs and no module is left non-terminal, nothing seals it (no `submitted_at`, no receipt, attempt stuck in `submitted`/`post-exam` with `final_submission NULL`). The timeout reconciler only finalizes non-terminal modules; a fully-module-submitted attempt has none. **This is a real gap in the current code — flag for product decision.**