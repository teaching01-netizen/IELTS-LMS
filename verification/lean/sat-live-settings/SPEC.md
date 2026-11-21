# Live SAT settings — formal model

## Scope

One SAT exam, its defaults, its rooms, and the student-facing projections that
depend on the four Results and scoring settings:

| Setting | Model field |
| --- | --- |
| Allow retakes | `Policy.retakes` |
| Show results | `Policy.results` |
| Include answer key in PDF | `Policy.keys` |
| Allow students to pause and leave | `Policy.pause` |

The model covers:

* one exam save that may change any subset of the four fields;
* room-local saves with an optimistic-concurrency revision;
* room creation that pins the current defaults;
* a protected decision (`St.grant`) and an already-admitted continuation
  (`Attempt.grant`);
* a student tab that accepts revisioned observations (`Client.observe`).

It deliberately does **not** model SQL, HTTP, timers, or the score pipeline.
Those are refinement obligations in `ASSUMPTIONS.md`.

## State

```
Policy   := { retakes, results, keys, pause : Bool }
Change   := which fields the exam save named
Room     := { exam : Nat, policy : Policy, rev : Nat, closed : Bool }
St       := { defaults : Policy, examRev : Nat, rooms : Nat → Room }
Attempt  := { admitted : Bool, snapshot : Policy }
Client   := { seen : Nat, results, keys, pause : Bool }
```

`Policy.norm` enforces the storage rule `keys ⇒ results`: hiding results turns
the key off.

## Transitions

* `St.examSave target change defaults`
  * no-ops when `change.any = false`;
  * updates the exam defaults and `examRev` once;
  * for every open room whose `exam = target`, merges **only** the changed
    fields and advances that room's revision;
  * leaves closed rooms and rooms of other exams byte-for-byte unchanged.
* `St.roomSave id policy expected`
  * succeeds only when `expected = (st.rooms id).rev`;
  * writes the normalized policy and advances the revision by exactly one;
  * otherwise returns `none` and does not mutate state.
* `St.createRoom id exam`
  * pins `Policy.norm st.defaults` at revision 1.
* `St.grant id field`
  * evaluates `field` against the room's current policy.
* `Attempt.grant st id attempt field`
  * an admitted attempt evaluates `field` against its immutable snapshot.
* `Client.observe revision policy`
  * ignores a response whose revision is older than the newest accepted one;
  * otherwise adopts the delivered controls.
* `servedKeyed serveTimeCheck preparedWithKey keyAllowedNow`
  * with the serve-time check, a prepared keyed export is withheld after a
    revocation; without it, the key leaks.

## Proven properties

| ID | Theorem | Meaning |
| --- | --- | --- |
| SAT-1 | `examSave_applies_changed_retakes`, `examSave_keeps_unchanged_field`, `examSave_preserves_closed_room`, `examSave_preserves_other_exam`, `examSave_noop_preserves_rooms` | One exam save is atomic: changed fields reach open in-scope rooms, unchanged fields and out-of-scope rooms are preserved, a no-op changes nothing. |
| SAT-2 | `roomSave_requires_current`, `roomSave_advances_revision`, `stale_replay_rejected`, `wrong_revision_is_noop`, `latest_write_wins` | Two writers requiring the same prior revision cannot both advance it, and a replay after commit is rejected. |
| SAT-3 | `grant_uses_current_policy`, `admitted_attempt_keeps_snapshot`, `hidden_results_clear_key`, `key_only_change_keeps_hidden_room` | A new protected grant uses the post-cutover policy; an admitted attempt keeps its snapshot; a hidden report cannot carry a key, and a key-only change cannot reveal a hidden room. |
| SAT-4 | `stale_observation_ignored`, `fresh_observation_applies`, `revocation_survives_stale_response`, `key_revocation_survives_stale_response`, `fair_read_converges` | An older projection cannot restore a revoked score or key; a fair read of the newest revision converges the tab. |

## Counterexamples

`Counterexamples.lean` exhibits the failure each guard prevents:

* a defaults-only save leaves rooms untouched;
* an unfenced duplicate write overwrites the committed policy;
* the fenced writer conflicts on the stale replay;
* an unfenced client restores a revoked score;
* a prepared keyed export served without a serve-time check leaks the key;
* a room that hides results cannot be revealed by a key-only save.

## What is not claimed

Lean proves statements about the model above. It does not prove the Go/SQL
implementation, the deployment, or browser behavior. Those require the
production evidence listed in `PRODUCTION_TEST_PLAN.md`; the current status of
each obligation is in `PROOF_REPORT.md`.
