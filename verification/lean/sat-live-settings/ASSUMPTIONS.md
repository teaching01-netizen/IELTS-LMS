# Assumptions and refinement obligations

The Lean model is a design-level model. Each assumption below is a bridge
between a theorem and the production code; if the bridge breaks, the theorem
still holds but stops describing the system.

## A1 — One save is one transaction

`St.examSave` is atomic. Production correspondence:
`exams.Service.Update` runs inside `runner.WithTx`; the room fan-out
(`satlearning.ApplyExamDefaultsTx`) is inside the same callback as the exam row
update. A rollback after the first room write leaves no room change. Evidence:
`TestSatExamSaveAppliesChangedFieldsToRoomsMySQL` asserts values after commit;
the same test fails if the callback returns an error before commit.

## A2 — Scope is the target exam

`examSave_preserves_other_exam` requires the caller to resolve the exam first.
Production correspondence: `UpdateForActor` calls `GetForActor`, and
`ApplyExamDefaultsTx` enumerates schedules with `WHERE exam_id = ?` only.

## A3 — Lock order is exam → room → policy

Production writers:

| Writer | Lock order |
| --- | --- |
| exam save | `exam_entities` `FOR UPDATE`, then `exam_schedules` `FOR UPDATE` (freeze, then eligible), then `sat_activity_policies` |
| room save | `exam_schedules` `FOR UPDATE`, then `sat_activity_policies` |
| room creation | `exam_entities` `FOR UPDATE`, then the new `exam_schedules` row, then `sat_activity_policies` |
| admission | `exam_schedules` `FOR UPDATE` (or `FOR SHARE`), then `sat_activity_policies` |
| pause | `exam_schedules` `FOR SHARE`, then the attempt row, then policy/current reads |

No writer takes the exam lock after a room lock, so the order is acyclic. This
is the correspondence for `stale_replay_rejected` and `latest_write_wins`. It is
reviewed in `TRACEABILITY.md`; it is not machine-checked.

## A4 — Revision = conflict token

`Room.rev` corresponds to `sat_activity_policies.policy_revision`. A room with
no row has an effective revision of 0 and inherits the legacy fallback. The
first explicit room save or fan-out write materializes the row. The absent-row
case is serialized by the parent `exam_schedules` row lock (`lockScheduleTx`),
which the model represents by a single sequential `roomSave`.

## A5 — Normalization is the storage rule

`Policy.norm` corresponds to `satlearning.NormalizePolicy` and to the SQL check
`chk_sat_activity_policy_keys`. Every write path normalizes, and the model's
`examSave` normalizes the defaults before merging. Therefore
`hidden_results_clear_key` and `key_only_change_keeps_hidden_room` hold.

## A6 — The model bumps a revision whenever the exam changes a field

Production skips a room write — and therefore a revision bump — when the merged
values equal the current room policy (`samePolicyExceptRevision`). The model
always bumps open in-scope rooms on a non-empty change. This is a conservative
abstraction: it can only produce *more* conflicts than production, never fewer,
so SAT-2's exclusion result is preserved. It does not affect the field values
proven by SAT-1/SAT-3.

## A7 — Effective values at the decision point

`St.grant` reads the room's current policy. Production correspondence:

* retake admission: `satlearning.LoadPolicyCurrentTx` inside the admission
  transaction (`schedules/sat_practice_attempts.go`);
* pause: `LoadPolicyCurrentTx` before the pause decision
  (`delivery/student_pause.go`);
* results and key: `results.SATScoreReportOpenSQL` and
  `delivery.KeyedPDFAllowed` on every read/serve;
* PDF download: `handlers_pdf_download.go` rechecks `ReportVisible` and
  `KeyedPDFAllowed` at serve time.

A read that is not part of a protected decision (for example, a list view) is
not covered by SAT-3.

## A8 — Admitted continuations are immutable

`Attempt.grant` keeps the admission snapshot. Production correspondence:
`sat_attempt_learning` is insert-only, and pause/resume uses the attempt's own
stored pause timestamp. A policy change cannot rewrite an admitted row.

## A9 — Client fence

`Client.observe` corresponds to the request-sequence fence in
`useSatLivePolicy` plus the `policyRevision`-keyed reread in
`useSatStudentPause`. The server also rechecks on every write, so the client
fence is a UI-safety property, not the authorization boundary.

## A10 — Foreground cadence

The 3-second foreground poll is a product cadence, not a theorem. The 5-second
p95 target is a browser/network measurement in `PRODUCTION_TEST_PLAN.md`. The
model's `fair_read_converges` only says that once a response with the newest
revision is accepted, the tab shows it.

## A11 — Deployment

Railway replica count, read routing, cache configuration, and migration
lineage are outside the model. See the unverified items in `PROOF_REPORT.md`.
