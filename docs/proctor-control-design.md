# Proctor-Control Design Spec

**Status:** source-verified against `main` @ `9b4414a` (epic lineage). Anchors: `backend/crates/api/src/routes/proctor.rs` ("route"), `backend/crates/api/src/router.rs` ("router"), `backend/crates/application/src/proctoring.rs` ("svc"), `backend/crates/application/src/delivery/mod.rs` ("delivery").
**Purpose:** the single spec the rewrite implements for every proctor control — which action writes what, through which lock scope, and how each interacts with the v2 provisional state and the seal claim predicate.

---

## 1. Route inventory (all under `/api/v1/proctor`, router:329–369)

| Method + Path | Handler (route) | Service fn (svc) | Class |
|---|---|---|---|
| `GET /sessions` | `list_sessions` | `list_sessions` | read |
| `GET /sessions/:schedule_id` | `get_session` | `get_session_detail[_with_options]` | read |
| `POST /sessions/:schedule_id/presence` | `refresh_presence` | `record_presence` (svc:331) | presence |
| `POST /sessions/:schedule_id/control/end-section-now` | `end_section_now` | `end_section_now` (svc:429) | schedule control |
| `POST /sessions/:schedule_id/control/extend-section` | `extend_section` | `extend_section` (svc:693) | schedule control |
| `POST /sessions/:schedule_id/control/complete-exam` | `complete_exam` | `complete_exam` (svc:1007) | schedule control |
| `POST /sessions/:schedule_id/attempts/:attempt_id/warn` | `warn_attempt` | `warn_attempt` (svc:1143) | per-attempt |
| `POST /sessions/:schedule_id/attempts/:attempt_id/pause` | `pause_attempt` | `update_attempt_status("paused", …)` (svc:1868) | per-attempt |
| `POST /sessions/:schedule_id/attempts/:attempt_id/resume` | `resume_attempt` | `update_attempt_status("active", …)` | per-attempt |
| `POST /sessions/:schedule_id/attempts/:attempt_id/extend` | `extend_attempt` | `extend_attempt` (svc:881) | per-attempt (SAT only) |
| `POST /sessions/:schedule_id/attempts/:attempt_id/terminate` | `terminate_attempt` | `update_attempt_status("terminated", "post-exam", …)` | per-attempt → seal |
| `POST /alerts/:alert_id/ack` | `acknowledge_alert` | `acknowledge_alert` (svc:1814) | alert |
| `GET /live-mode` | `live_mode` | `live_mode` | read |

Authz (route): write actions require `Admin|Proctor` + schedule assignment (`authorize_schedule`, route:375–400; proctors filtered to `schedule_staff_assignments` rows, route:257–266); reads also allow `AdminObserver` (`authorize_read_schedule`, route:356–374). All writes require `VerifiedCsrf`.

## 2. The concurrency backbone: two lock scopes (delivery:430–466)

Every proctor write acquires one of these **first**, inside its own transaction, in the documented order:

- **`lock_attempt_terminalization_scope_in_tx(schedule_id, attempt_id)`** (delivery:452) — `SELECT … student_attempts WHERE id AND schedule_id FOR UPDATE` (fails `NotFound`), then `lock_schedule_terminalization_scope_in_tx` → `exam_session_runtimes WHERE schedule_id FOR UPDATE` + the active `exam_session_runtime_sections` row. Used by warn, pause, resume, terminate (svc:1143, 1868), and student-side `complete_assessment`. **Lock order: attempt → runtime → active section**, matching every student response writer and terminalization, so no proctor command can deadlock with or race a student write.
- **`lock_schedule_attempts_in_tx(schedule_id)`** — every pending `student_attempts` row for the schedule `FOR UPDATE` (schedule-wide exclusivity). Used by `end_section_now`, `extend_section`, `complete_exam` (svc:450, 720, 1024). `auto_submit_schedule_attempts_in_tx` additionally takes `lock_schedule_terminalization_scope_in_tx` (delivery:3587).

Fences: `end_section_now`/`extend_section` accept optional `expected_runtime_revision` and `expected_active_section_key`; mismatch → `Conflict("Runtime changed; refresh before retrying.")` (svc:470–500, 740–770). This is the optimistic-concurrency handshake for the dashboard.

## 3. Shared terminalization machinery (recap — full detail in `docs/terminalization-design.md`)

`seal_attempt_in_tx` (delivery:581) is the only writer of terminal state:

1. Attempt row `FOR UPDATE` → `NotFound` if absent.
2. **Replay-or-conflict:** existing receipt → `terminalization_intent_is_compatible(existing_outcome, _, requested_outcome, _)` = **same outcome only** (delivery:135–140); compatible → re-materialize SAT result and return the stored receipt; incompatible → `TerminalizationConflict` (delivery:810).
3. Validate `outcome ∈ {submitted, terminated}` and `reason` ∈ the 0043 CHECK list (delivery:616–637; `proctor_complete | proctor_end | proctor_force_submit | proctor_terminate` among them).
4. Optional `min_answer_revision` fence (`BaseRevisionMismatch` conflict, delivery:639–654).
5. SAT + `terminated` → `lock_sat_modules_in_tx` (delivery:469): all `not_started|active|review` module attempts → `locked`, `completion_reason` set, `paused_at NULL`.
6. `build_server_terminal_snapshot` (delivery:554) — answer revision + answers/writing_answers/flags JSON, extended with SAT `assessment.{moduleAttempts,responses}` read `FOR UPDATE`.
7. Enrich `final_submission` projection (delivery:701–719): `submittedAt`, `completionReason`, `terminalizationOutcome`, `terminalizationId`, answers/writingAnswers/flags/providerKey, `terminated: true` when terminated.
8. **Receipt INSERT first** (immutable row, PK `attempt_id`; delivery:721–757).
9. **Claim UPDATE** — the heart of the provisional interaction (§4):
   - terminated branch (delivery:741): `SET phase='post-exam', delivery_status='terminated', final_submission=?, submitted_at=COALESCE(submitted_at, ?), proctor_status='terminated', proctor_note=COALESCE(?, proctor_note), proctor_updated_at, proctor_updated_by, revision+1, control_epoch+1` with predicate:
     ```
     ((submitted_at IS NULL AND phase <> 'post-exam')
      OR (delivery_status = 'submitted' AND phase = 'post-exam' AND final_submission IS NULL))
     ```
   - submitted branch (delivery:753): same SET minus proctor fields, plus `AND COALESCE(proctor_status,'active') <> 'terminated'`; claim failure → `AttemptProctorBlocked` conflict.
   - **The second OR-branch is the provisional-state handshake** — a seal may claim a v2-provisionally-submitted SAT attempt because `final_submission` is still NULL there.
10. `materialize_sat_terminal_result_in_tx` (delivery:205): `outcome_status` = `invalidated_proctor` (terminated by Proctor) / `invalidated_timeout` (terminated by system) / `pending` (submitted); deletes section results + invalidates when re-terminating an already-scored result; otherwise inserts an invalidated `assessment_results` row.
11. Outbox `attempt_terminalization` / `attempt_terminalized` enqueue in-tx (delivery:800–819). **No live-update event from the seal itself.**

## 4. Per-action behavior

### 4.1 Warn — `POST …/attempts/:id/warn` (svc:1143)

Writes, in one tx (scope lock → checks → writes):
- Terminal check: `submitted_at` set, or `delivery_status ∈ {submitted, terminated, locked, cancelled}` → `Conflict("already terminal …")` (svc:1216–1225).
- `INSERT student_violation_events` — `violation_type='PROCTOR_WARNING'`, `severity='medium'`, payload `{message}` (svc:1227–1241).
- `UPDATE student_attempts` — `proctor_status='warned'`, `proctor_note`, `proctor_updated_at/by`, `last_warning_id`, `violations_snapshot = JSON_MERGE_PRESERVE(…, warning_json)`, `revision+1`, `control_epoch+1` (svc:1243–1262).
- Audit `STUDENT_WARN` (svc:1264); outbox `schedule_roster`/`roster_changed` (svc:1272–1279).

Does **not** touch runtime rows, deadlines, or module attempts. `proctor_status='warned'` is not a blocking state (only `paused`/`terminated` block student writes).

### 4.2 Pause / Resume — `…/pause`, `…/resume` (svc:1282/1321 → `update_attempt_status`, svc:1868)

The single most intricate proctor write: a **protocol-aware lifecycle + clock mutation** on `student_attempts`, plus a SAT module pause.

Non-terminate guard (svc:1893–1904): `submitted_at` set, `proctor_status='terminated'`, or terminal `delivery_status` → Conflict. (Terminate skips this guard; the seal owns conflict detection.)

The V2-aware UPDATE (svc:1906–1967), all in one statement:
- `delivery_status`: protocol v1 → unchanged; v2 + pause → `'paused'` **unless already terminal** (terminal states preserved); v2 + resume when `proctor_status='paused'` and `delivery_status='paused'` → `'running'`; else unchanged.
- **Resume clock compensation (v2 only):** `deadline_at = DATE_ADD(deadline_at, INTERVAL GREATEST(TIMESTAMPDIFF(SECOND, proctor_updated_at, UTC_TIMESTAMP(6)), 0) SECOND)` and `closing_grace_until = DATE_ADD(DATE_ADD(deadline_at, …), INTERVAL 30 SECOND)` — the paused wall-time is added back, then the 30s grace is re-anchored to the shifted deadline. Only when `proctor_status='paused'` and `deadline_at IS NOT NULL`.
- `proctor_status`, `phase = COALESCE(?, phase)` (resume passes `None` → phase unchanged; terminate passes `'post-exam'` but terminate skips this branch), `proctor_note = COALESCE(?, proctor_note)`, `proctor_updated_at = UTC_TIMESTAMP(6)`, `proctor_updated_by`, `revision+1`, `control_epoch+1` — **the control_epoch bump fences any in-flight V2 command batch across the pause boundary** (`ControlEpochStale`, v2:1138–1152).

SAT module pause/resume (svc:1969–1998), only for `timing_model ∈ {legacy_section_v1, cohort_section_v3}`:
- Pause: `SET ma.paused_at = COALESCE(ma.paused_at, NOW())` on `state='active' AND started_at IS NOT NULL AND paused_at IS NULL` module attempts.
- Resume: `accumulated_paused_seconds += GREATEST(TIMESTAMPDIFF(SECOND, paused_at, NOW()), 0)`, `paused_at = NULL`.

Audit `STUDENT_PAUSE`/`STUDENT_RESUME` + outbox `schedule_roster`/`roster_changed` (svc:2006–2021). Route layer additionally publishes live events `schedule_roster` + `attempt` (`attempt_changed`) after commit (route:214–243).

### 4.3 Extend attempt — `POST …/attempts/:id/extend` (svc:881)

SAT-only (`provider_key != "sat"` → Validation, svc:905); **disabled for shared-clock sessions** (`timing_model ∈ {cohort_stage_v2, cohort_section_v3}` → "extend the active cohort section instead", svc:913–921); minutes must be in the exam policy's allowed set (`allowed_extension_minutes` from config snapshot, svc:925–932).

Writes in one tx:
- Attempt row `FOR UPDATE`; `proctor_status='terminated'` → Conflict (svc:941–950).
- `UPDATE assessment_module_attempts SET extension_seconds += minutes*60, revision+1 WHERE attempt_id AND state='active' AND started_at IS NOT NULL` — exactly one row, else `Conflict("does not have an active SAT module")` (svc:952–962).
- `extend_v2_attempt_deadline_in_tx` (delivery:358): v2-only (`protocol_version=2`, non-terminal guard): `deadline_at = DATE_ADD(deadline_at, minutes)` (stays NULL if NULL), `closing_grace_until` shifted likewise (initialized to `deadline + 30s` if missing), `control_epoch+1`, `revision+1`.
- Audit `EXTENSION_GRANTED` (scope=attempt) + outbox `schedule_roster`/`roster_changed` (svc:974–993). Route publishes `attempt`/`attempt_extended` live event (route:254–262).

### 4.4 Terminate — `POST …/attempts/:id/terminate` (svc:1360 → 1868)

`update_attempt_status(proctor_status="terminated", phase=Some("post-exam"), action="STUDENT_TERMINATE")`. The only proctor action that seals:
- Scope lock (svc:1885) — **the pre-check is skipped** for terminate; the seal's own replay-or-conflict decides.
- `STUDENT_TERMINATE` branch → `seal_attempt_in_tx` (svc:1999–2047) with:
  - `outcome="terminated"`, `reason="proctor_terminate"`, `actor_kind=Proctor`, `actor_id=proctor user id`, `proctor_note = req.reason.or(req.message)`, `final_submission = {"terminated": true, "reason": "proctor_terminate", "proctorStatus": "terminated"}`.
  - Claim sets `proctor_status='terminated'`, `proctor_note`, `proctor_updated_at/by` on the row; SAT modules invalidated (§3 step 5); SAT `assessment_results` → `outcome_status='invalidated_proctor'`, `release_status='invalidated'` (§3 step 10).
- Audit `STUDENT_TERMINATE` + outbox `schedule_roster` (svc:2049–2060). Route publishes `schedule_roster` + `attempt` (`attempt_changed`) (route:266–288).

**Idempotency:** a second terminate replays (same outcome `terminated` → intent-compatible) and returns the stored receipt; it does **not** re-invalidate (materialization guards on existing status, delivery:216–236).

### 4.5 Complete exam — `POST …/control/complete-exam` (svc:1007)

Schedule-wide terminalization. Idempotent header: runtime already `completed|cancelled` → return current runtime without writing (svc:1044–1050).
- `lock_schedule_attempts_in_tx` first (svc:1056–1061) — documented as matching terminalization lock order to avoid deadlock with pause/student seals.
- Runtime → `status='completed'`, `actual_end_at`, active/current section cleared, `waiting_for_next_section=false`, `revision+1` (svc:1063–1079).
- All runtime sections → `status='completed'`, `completion_reason=COALESCE(completion_reason, 'proctor_complete')` (svc:1081–1096).
- Schedule → `status='completed'` (svc:1098–1104).
- **`auto_submit_schedule_attempts_in_tx(schedule_id, "proctor_complete")`** (delivery:3582) — see §5.
- Control event `complete_runtime` + audit `SESSION_END` (svc:1122–1141); outbox `schedule_runtime`/`runtime_changed` (svc:1143–1151). Route publishes `schedule_runtime`/`complete_exam` (route:171–181).

### 4.6 End section now — `POST …/control/end-section-now` (svc:429)

- **Rejected for SAT** ("Adaptive SAT sections cannot be ended with a cohort section override…", svc:446–452) and for IELTS authentic mode (svc:454–460).
- Scope lock + revision/section-key fences (§2).
- Active section → `status='completed'`, `actual_end_at`, `completion_reason='proctor_end'` (svc:520–531).
- If a next section exists: it becomes `live` (`available_at`/`actual_start_at = NOW()`), runtime advances `active_section_key`/`current_section_key`/`current_section_remaining_seconds`, `revision+1` (svc:533–565).
- **Else** (last section): runtime → `completed`, schedule → `completed`, and **`auto_submit_schedule_attempts_in_tx(schedule_id, "proctor_end")`** (svc:567–602).
- `sync_v2_runtime_timing_in_tx` re-projects the V2 deadline from the newly active section (svc:604–612; delivery:304) — lifecycle + clock move atomically.
- Audit `SECTION_END` (+`SECTION_START` or `SESSION_END`), control event, outbox `schedule_runtime`/`runtime_changed` (svc:614–648). Route publishes `schedule_runtime`/`end_section_now` (route:132–142).

### 4.7 Extend section — `POST …/control/extend-section` (svc:693)

Cohort-clock twin of §4.3: minutes > 0, disabled in IELTS authentic mode, must be in policy's allowed set (svc:729–748). Scope lock + fences; writes `exam_session_runtime_sections.extension_minutes += minutes`, `projected_end_at = COALESCE(projected_end_at, NOW()) + INTERVAL minutes MINUTE`, runtime `current_section_remaining_seconds += minutes*60`, `revision+1` (svc:768–790). Two further propagations inside the same tx:
- **Active SAT module attempts** (`timing_model ∈ {legacy_section_v1, cohort_section_v3}`): `assessment_module_attempts.extension_seconds += minutes*60` for every active SAT module in the schedule (svc:811–831) — this is the "extend the active cohort section" behavior the per-student extend route points at.
- **Immediate V2 re-projection**: `sync_v2_runtime_timing_in_tx(schedule, runtime, section_key, None)` (svc:833–844; delivery:304–355) rewrites every v2 attempt's `deadline_at`/`closing_grace_until` from the extended section clock (`actual_start_at + (planned+extension)*60 + paused`, grace re-anchored at +30s) and bumps `control_epoch + 1`, `revision + 1` — so in-flight V2 command batches are fenced (`ControlEpochStale`) and clients see the new clock immediately, not only on the next section transition.

Audit `EXTENSION_GRANTED` (section scope), control event, outbox `schedule_runtime`/`runtime_changed` (svc:846–860). Route publishes `schedule_runtime`/`extend_section`.

### 4.8 Presence & alert ack (non-control, for completeness)

- `record_presence` (svc:331): upserts heartbeat into `student_attempt_presence` per proctor/schedule; no attempt state.
- `acknowledge_alert` (svc:1814): marks a `session_audit_logs` alert acknowledged; authorizes via the alert's schedule.

## 5. Schedule-wide auto-submit (`auto_submit_schedule_attempts_in_tx`, delivery:3582)

The force-completion engine behind §4.5/§4.6's last-section path:

1. `SELECT * FROM student_attempts WHERE schedule_id = ? AND submitted_at IS NULL FOR UPDATE` — all pending attempts, then `lock_schedule_terminalization_scope_in_tx`.
2. Deduped durable wake-up: outbox `schedule`/`auto_submit_schedule_attempts_requested` enqueued only if no unprocessed request exists (delivery:3595–3617) — the worker can replay the same completion idempotently.
3. Per attempt (delivery:3618–3670):
   - **SAT + `legacy_section_v1` + a still-valid module clock** (active/review, unpaused, `now < started_at + allocated+extension+paused`) → **skip**: the personal module clock still grants time; the SAT module reconciler owns that attempt's terminal transition at its authoritative deadline. This is the "who owns terminalization" arbitration.
   - Outcome: `'terminated'` if provider is SAT **or** `proctor_status='terminated'` already; else `'submitted'`. (So a cohort SAT attempt force-completes as `terminated`/invalidated — it has no valid score — while IELTS force-completes as `submitted`.)
   - `reason = completion_reason` (`proctor_complete` | `proctor_end`), `actor_kind=System`, `final_submission = {submissionId: "submission-<uuid>", completionReason, autoSubmission: true, proctorStatus, submissionPolicy: "forced_auto_submit"}` → seal (§3).

## 6. Interaction with the v2 provisional state (matrix)

Provisional state = `delivery_status='submitted'`, `phase='post-exam'`, `submitted_at NULL`, `final_submission NULL` (see `docs/v2-provisional-state-design.md` §2).

| Action | Allowed in provisional window? | Mechanism |
|---|---|---|
| Warn | **No** — Conflict (terminal check: `delivery_status='submitted'` in set, svc:1216–1225) | pre-check under scope lock |
| Pause | **No** — Conflict (same guard) | pre-check |
| Resume | **No** — Conflict (same guard; also `delivery_status` CASE never rewrites terminal states, svc:1910–1917) | pre-check + CASE |
| Extend attempt | **No hard block — silently partial** — `extend_v2_attempt_deadline_in_tx`'s guard (`delivery_status NOT IN ('submitted', …)`, delivery:377–380) makes the deadline/control-epoch write a no-op, but the module `extension_seconds` UPDATE (svc:952–962) has no such guard: if a module is still `active` it **commits** with the extension applied while the V2 deadline stays put. Inert (students can't resume post-provisional) but inconsistent; no error surfaces | guard inside deadline write only |
| **Terminate** | **Yes** — seal's claim OR-branch 2 (`delivery_status='submitted' AND phase='post-exam' AND final_submission IS NULL`) lets the terminated claim UPDATE through (delivery:741) | receipt-first + claim OR-branch |
| Complete exam / end-section-now | **Yes** — auto-submit seals them; seal replay-or-conflict decides per attempt (same-outcome replay allowed, cross-outcome → `TerminalizationConflict`) | seal idempotency |
| Extend section (cohort) | **Yes** — runtime-level; immediately re-projects every v2 attempt's deadline from the extended clock and bumps `control_epoch` via `sync_v2_runtime_timing_in_tx` (delivery:304–355); active SAT module `extension_seconds` also grow (svc:811–831) | runtime rows + v2 projection |

Consequences to preserve: terminating a provisionally-submitted SAT attempt produces an authoritative `terminated` receipt (reason `proctor_terminate`, snapshot with `submittedAt` = seal `effective_at`), invalidates SAT modules and any staged result, and a later `complete_assessment` is blocked by the proctor check (`outcome='terminated'`, sat:946–960). A schedule-level force-complete on a provisional attempt with a still-valid personal module clock is **skipped** (delivery:3638–3650) — only the module reconciler may terminalize it.

## 7. Live events and outbox per action

| Action | Outbox (in-tx) | Live publish (post-commit, route layer) |
|---|---|---|
| warn | `schedule_roster`/`roster_changed` | `schedule_roster` + `attempt`/`attempt_changed` |
| pause/resume | `schedule_roster`/`roster_changed` | `schedule_roster` + `attempt`/`attempt_changed` |
| extend attempt | `schedule_roster`/`roster_changed` | `attempt`/`attempt_extended` |
| terminate | `schedule_roster`/`roster_changed` (from update_attempt_status) **+** `attempt_terminalization`/`attempt_terminalized` (from seal, delivery:800) | `schedule_roster` + `attempt`/`attempt_changed` |
| complete exam | `schedule_runtime`/`runtime_changed` + per-attempt `auto_submit_schedule_attempts_requested` (deduped) + seals' `attempt_terminalized` | `schedule_runtime`/`complete_exam` |
| end section now | `schedule_runtime`/`runtime_changed` (+ auto-submit trio on last section) | `schedule_runtime`/`end_section_now` |
| extend section | `schedule_runtime`/`runtime_changed` | `schedule_runtime`/`extend_section` |

The seal never publishes live events itself — sockets learn via the wrapping route publishes, outbox-driven worker, or `/live` polling.

## 8. Findings and must-not-change contract

1. **`proctor_force_submit` is declared but dead code.** It exists only in the seal's reason enum (delivery:650) and the 0043 CHECK constraint; there is no route, service fn, or caller anywhere in `crates/`. If the rewrite needs a per-attempt force-submit (distinct from schedule-wide `complete_exam`), it must be designed — the current product's "force submit" behavior is `complete_exam` → `auto_submit_schedule_attempts_in_tx` with `submissionPolicy: "forced_auto_submit"`.
2. **Lock order attempt → runtime → active section** in every proctor write (scope locks) is what makes student/proctor/seal races impossible; the schedule-wide controls take the same order via `lock_schedule_attempts_in_tx` first. Do not reorder.
3. **The claim predicate's OR-branch** (`delivery_status='submitted' AND phase='post-exam' AND final_submission IS NULL`) must survive verbatim — it is what lets terminate/complete claim provisional attempts, and what lets a submitted seal fail with `AttemptProctorBlocked` instead of clobbering.
4. **Receipt-first + outcome-only intent compatibility:** a second proctor action on a sealed attempt replays only if the outcome matches (`terminated` vs `submitted` conflict). Cross-outcome attempts must surface `TerminalizationConflict`, never overwrite.
5. **Resume clock compensation** (deadline shift + 30s grace re-anchor, v2 only) and the `control_epoch+1` bump on every status change are the V2 correctness machinery — dropping them silently desynchronizes client clocks.
6. **SAT arbitration in auto-submit:** a cohort expiry must never override a still-valid personal module clock (`legacy_section_v1` skip); the module reconciler owns that transition.
7. The route layer publishes live events only **after** commit; outbox rows are enqueued **in** the transaction. Both must exist for every action in §7.

## 9. Equivalence gates for the rewrite

- `proctoring` service tests: pause/resume deadline compensation, warn guard, terminate seal (receipt, SAT invalidation, `invalidated_proctor` result), extend gates (non-SAT, cohort-timed, terminated).
- Delivery tests: seal replay-or-conflict matrix, claim-predicate branches, `auto_submit_schedule_attempts_in_tx` arbitration (SAT `legacy_section_v1` skip), SAT materialization re-termination.
- `student_contract.rs`: proctor-blocked writes after terminate (`AttemptProctorBlocked`), post-provisional terminate, pause → `ControlEpochStale` on V2 batch.
- Migration smoke: 45000 immutability, `attempt_terminalizations` CHECK values, `outcome_status` transitions.
- E2E: complete-exam while a student holds a valid module clock (attempt must survive), terminate mid-provisional (receipt `terminated`, no duplicate).

## 10. Open questions

- Whether the rewrite wants a real per-attempt **force-submit** (see finding 1) — product decision, currently folded into `complete_exam`.
- `warn_attempt` writes `proctor_status='warned'` but nothing ever restores `'active'` — confirm the frontend treats `warned` as a display state, not a latch.