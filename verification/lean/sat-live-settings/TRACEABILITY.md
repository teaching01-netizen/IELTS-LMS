# Traceability: theorem → implementation → test

Line numbers are for the release worktree at the commit recorded in
`evidence/build.txt`; re-check them after rebasing.

## SAT-1 — `examSaveAtomicAndScoped`

| Theorem | Implementation |
| --- | --- |
| `examSave_applies_changed_retakes` | `exams.Service.Update` calls `satlearning.ApplyExamDefaultsTx` (service.go:876); `ApplyExamDefaultsTx` merges via `ApplyPolicyChange` (store.go:261); `PolicyChange` / `DiffPolicy` / `ApplyPolicyChange` live in policy.go:74–118. |
| `examSave_keeps_unchanged_field` | `ApplyPolicyChange` writes a field only when its `Change` bit is set (policy.go:104–117). |
| `examSave_preserves_closed_room` | Eligible query filters `status IN ('scheduled','live')` (store.go:280); closed/cancelled rooms are not in the fan-out. |
| `examSave_preserves_other_exam` | Eligible query filters `exam_id = ?` and `provider_key = 'sat'` (store.go:280); `UpdateForActor` resolves the exam first (service.go:563). |
| `examSave_noop_preserves_rooms` | `ApplyExamDefaultsTx` returns early when `!change.Any()` (store.go:264); `exams.Update` only calls it for a non-empty diff (service.go:874). |

Legacy fallback capture: when the results field changes, `freezeLegacyPoliciesTx`
(store.go:326) materializes every row-less SAT room under the pre-save flag
before the exam row is updated. This is what keeps a closed legacy room on its
old policy. Test: `TestSatExamSaveAppliesChangedFieldsToRoomsMySQL` closes a
room and asserts its policy does not move on a later exam save.

Oracle: `backend/go/cmd/api/sat_exam_config_mysql_test.go`
(`TestSatExamSaveAppliesChangedFieldsToRoomsMySQL`), real MySQL.

## SAT-2 — `revisionFencePreservesLatestWrite`

| Theorem | Implementation |
| --- | --- |
| `roomSave_requires_current` | `SavePolicyTx` compares `expectedRevision` with the locked row (store.go:196–206). |
| `roomSave_advances_revision` | `next.Revision = current + 1` (store.go:207–210). |
| `stale_replay_rejected` | The same comparison; a stale `expectedRevision` returns `RevisionConflict` (`store.go:203`) and the handler maps it to 409 (`handlers_sat_learning.go:93`). |
| `wrong_revision_is_noop` | No write occurs before the comparison. |
| `latest_write_wins` | `lockScheduleTx` (store.go:220) serializes absent-row writers; `writePolicyTx` (store.go:230) is only reached after the fence. |

Oracle: `TestSatRoomPolicyAbsentRowWritersConflictMySQL` races two writers on a
missing row and asserts exactly one conflict and final revision 1.

## SAT-3 — `studentGrantUsesCurrentPolicy`

| Theorem | Implementation |
| --- | --- |
| `grant_uses_current_policy` | Retake admission: `LoadPolicyCurrentTx` (sat_practice_attempts.go:408) before `policy.UnlimitedRetakes` is checked (line 419). Pause: `LoadPolicyCurrentTx` at student_pause.go:67 before `state.Allowed` is used. |
| `admitted_attempt_keeps_snapshot` | `sat_attempt_learning` is insert-only (`satlearning.InsertSnapshotTx`); pause/resume reads the attempt's own timestamp and never rewrites a grant. |
| `hidden_results_clear_key` | `NormalizePolicy` (policy.go:64–70) and the SQL `chk_sat_activity_policy_keys`; `ApplyPolicyChange` normalizes after merge. |
| `key_only_change_keeps_hidden_room` | Same normalization plus `ApplyPolicyChange`'s per-field merge; test `TestApplyPolicyChangeKeyOnlyKeepsRoomHiddenResults`. |
| Results release for pending reports | `classroomPendingSQL` now uses the room-effective predicate (`terminalization/service.go:1717`), not the exam flag alone. |
| PDF serve-time revocation | `handlers_pdf_download.go` rechecks `ReportVisible` and `KeyedPDFAllowed` on every download; `answered_exam.go:149–196` reads the live policy. |

Oracles:

* `TestApplyPolicyChangeHidingResultsClearsKey`,
  `TestApplyPolicyChangeKeyOnlyKeepsRoomHiddenResults` (Go unit);
* `TestSATPracticeRetakeMySQL` (real MySQL, retake denial/allowance);
* `TestStudentPolicyStateProjectsRoomPolicy` (student projection);
* `TestKeyedPDFAllowed` (existing, live key gate).

Not yet exercised on real MySQL: pause revocation with a running timer and the
repair path releasing a pre-existing pending report after enablement. See
`PROOF_REPORT.md`.

## SAT-4 — `olderProjectionCannotRestoreGrant`

| Theorem | Implementation |
| --- | --- |
| `stale_observation_ignored` | `useSatLivePolicy` request sequence (`sequence.current`, hook lines 41–49); `useSatStudentPause` read sequence. |
| `fresh_observation_applies` | Accepted response replaces the projection (`setState`). |
| `revocation_survives_stale_response` | `SatRoomCompletion` renders completion-only whenever the newest accepted policy hides results; `SatCompleteScreen` gates the report on `reportVisible` (SatCompleteScreen.tsx:20). |
| `key_revocation_survives_stale_response` | `SatScoreReport` passes `answerKeysAllowed` to `useAnsweredExamDownload`; the hook aborts an in-flight prepare and clears a prepared export when the key is revoked. |
| `fair_read_converges` | `SatRoomCompletion` refetches history and the selected result on every accepted policy signature; `refetchOnWindowFocus` covers reconnect/foreground. |

Oracle: `src/features/student-delivery/hooks/__tests__/useSatLivePolicy.test.tsx`
(discards a stale response, keeps the last policy on failure, backs off hidden,
rereads on visibility), plus `SatCompleteScreen.test.tsx` (revocation hides a
previously loaded score; key-off prepares an answer-only PDF).

The required held-response browser trace (hold an earlier result response,
commit a revocation, accept the new revision, release the old response) is
listed in `PRODUCTION_TEST_PLAN.md` and has **not** run yet.
