import Model

/-!
Counterexamples the implementation must not reproduce. Each one is a concrete
trace showing why the corresponding guard exists; the matching theorem in
Safety.lean is the corrected behavior.
-/
namespace SatLiveSettings

/-- The base state: one exam (id 0), one open room (id 0), revision 0. -/
def baseSt : St :=
  { defaults := Policy.default,
    examRev := 0,
    rooms := fun _ => { exam := 0, policy := Policy.default, rev := 0, closed := false } }

/-- A defaults-only save (no room-scoped field changed) never moves a room. -/
theorem defaults_only_save_keeps_room :
    (baseSt.examSave 0 ⟨false, false, false, false⟩ { Policy.default with results := true }).rooms 0 =
      baseSt.rooms 0 := by
  simp [St.examSave, Change.any]

/-- Without the revision fence, a duplicate first write silently overwrites the
committed policy instead of conflicting. This is the absent-row race the room
lock in `SavePolicyTx` closes. -/
def St.roomSaveUnfenced (st : St) (id : Nat) (p : Policy) : St :=
  { st with
    rooms := fun i =>
      if i = id then
        { st.rooms i with policy := Policy.norm p, rev := (st.rooms i).rev + 1 }
      else st.rooms i }

theorem unfenced_duplicate_write_overwrites
    (p1 p2 : Policy) :
    (((baseSt.roomSaveUnfenced 0 p1).roomSaveUnfenced 0 p2).rooms 0).policy = Policy.norm p2 := by
  simp [St.roomSaveUnfenced]

/-- The fenced writer rejects the stale replay instead. -/
theorem fenced_first_write_conflicts :
    ((baseSt.roomSave 0 { Policy.default with results := true } 0).bind
      (fun s => s.roomSave 0 { Policy.default with pause := true } 0)).isNone = true := by
  decide

/-- A stale client without the projection fence restores a revoked score. -/
def revokedClient : Client :=
  { seen := 5, results := false, keys := false, pause := false }

theorem unfenced_stale_response_restores_score :
    (revokedClient.observeUnfenced 3 { Policy.default with results := true }).results = true := by
  decide

theorem fenced_stale_response_keeps_revocation :
    (revokedClient.observe 3 { Policy.default with results := true }).results = false := by
  decide

/-- A prepared keyed export served without a serve-time policy check leaks the
key after revocation. The production download path rechecks
`KeyedPDFAllowed`. -/
theorem unchecked_prepared_export_leaks_after_revocation :
    servedKeyed false true false = true := by
  decide

theorem checked_prepared_export_withholds_after_revocation :
    servedKeyed true true false = false := by
  decide

/-- A key-only exam change against a room that hides results must not reveal
the key. This is the exact clause `NormalizePolicy` enforces after the merge. -/
theorem key_only_change_cannot_reveal_hidden_room :
    (baseSt.roomSave 0 { Policy.default with results := false, keys := true } 0).isSome = true ∧
    ((baseSt.roomSave 0 { Policy.default with results := false, keys := true } 0).map
      (fun s => (s.rooms 0).policy.keys) = some false) := by
  decide

end SatLiveSettings
