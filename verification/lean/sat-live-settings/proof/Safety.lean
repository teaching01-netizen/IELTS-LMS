import Model

/-!
SAT-1..SAT-4 for the live SAT settings cutover.

Every theorem is proved over `Model.lean`. The implementation witnesses named
in the docstrings are the production boundaries mapped in TRACEABILITY.md.
-/
namespace SatLiveSettings

/-! ### Policy projection helpers -/

theorem Policy.norm_retakes (p : Policy) : (Policy.norm p).retakes = p.retakes := by
  simp [Policy.norm]

theorem Policy.norm_results (p : Policy) : (Policy.norm p).results = p.results := by
  simp [Policy.norm]

theorem Policy.norm_pause (p : Policy) : (Policy.norm p).pause = p.pause := by
  simp [Policy.norm]

theorem Policy.norm_keys_of_hidden (p : Policy) (h : p.results = false) :
    (Policy.norm p).keys = false := by
  simp [Policy.norm, h]

/-! ## SAT-1: one exam save is atomic and scoped -/

/-- A changed field reaches every open room of the target exam. -/
theorem examSave_applies_changed_retakes
    (st : St) (target id : Nat) (c : Change) (d : Policy)
    (hexam : (st.rooms id).exam = target)
    (hopen : (st.rooms id).closed = false)
    (hchange : c.retakes = true) :
    ((st.examSave target c d).rooms id).policy.retakes = (Policy.norm d).retakes := by
  unfold St.examSave
  have hany : c.any = true := by simp [Change.any, hchange]
  simp [hany, hopen, hexam, Policy.apply, hchange, Policy.norm_retakes]

/-- A field the save did not name keeps the room's own value. -/
theorem examSave_keeps_unchanged_field
    (st : St) (target id : Nat) (c : Change) (d : Policy)
    (hexam : (st.rooms id).exam = target)
    (hopen : (st.rooms id).closed = false)
    (hchange : c.pause = false) :
    ((st.examSave target c d).rooms id).policy.pause = (st.rooms id).policy.pause := by
  unfold St.examSave
  by_cases hany : c.any = true
  · simp [hany, hopen, hexam, Policy.apply, hchange, Policy.norm_pause]
  · simp [show c.any = false by simpa using hany]

/-- A closed room keeps its own policy. -/
theorem examSave_preserves_closed_room
    (st : St) (target id : Nat) (c : Change) (d : Policy)
    (hclosed : (st.rooms id).closed = true) :
    (st.examSave target c d).rooms id = st.rooms id := by
  unfold St.examSave
  by_cases hany : c.any = true
  · simp [hany, hclosed]
  · simp [show c.any = false by simpa using hany]

/-- A room of another exam is outside the save's scope. -/
theorem examSave_preserves_other_exam
    (st : St) (target id : Nat) (c : Change) (d : Policy)
    (hexam : (st.rooms id).exam ≠ target) :
    (st.examSave target c d).rooms id = st.rooms id := by
  unfold St.examSave
  by_cases hany : c.any = true
  · by_cases hclosed : (st.rooms id).closed = true
    · simp [hany, hclosed]
    · have hopen : (st.rooms id).closed = false := by simpa using hclosed
      simp [hany, hopen, hexam]
  · simp [show c.any = false by simpa using hany]

/-- A no-op save preserves every room and its revision. -/
theorem examSave_noop_preserves_rooms
    (st : St) (target : Nat) (c : Change) (d : Policy)
    (hany : c.any = false) :
    st.examSave target c d = st := by
  simp [St.examSave, hany]

/-! ## SAT-2: the revision fence keeps the latest write -/

/-- A successful room save was written against the current revision. -/
theorem roomSave_requires_current
    {st s : St} {id : Nat} {p : Policy} {expected : Nat}
    (h : st.roomSave id p expected = some s) :
    expected = (st.rooms id).rev := by
  unfold St.roomSave at h
  by_cases hrev : (st.rooms id).rev = expected
  · exact hrev.symm
  · simp [hrev] at h

/-- A successful room save advances the room revision by exactly one. -/
theorem roomSave_advances_revision
    {st s : St} {id : Nat} {p : Policy} {expected : Nat}
    (h : st.roomSave id p expected = some s) :
    (s.rooms id).rev = (st.rooms id).rev + 1 := by
  unfold St.roomSave at h
  by_cases hrev : (st.rooms id).rev = expected
  · simp [hrev] at h
    cases h
    simp
  · simp [hrev] at h

/-- Replaying the same expected revision after a committed save conflicts and
cannot apply a second change. This is the absent-row two-writer case. -/
theorem stale_replay_rejected
    {st s1 : St} {id : Nat} {p1 p2 : Policy} {expected : Nat}
    (h : st.roomSave id p1 expected = some s1) :
    s1.roomSave id p2 expected = none := by
  unfold St.roomSave
  have hrev := roomSave_advances_revision h
  have he := roomSave_requires_current h
  rw [hrev]
  have hne : ¬ ((st.rooms id).rev + 1 = expected) := by omega
  simp [hne]

/-- A write with the wrong expected revision leaves the state untouched. -/
theorem wrong_revision_is_noop
    {st : St} {id : Nat} {p : Policy} {expected : Nat}
    (h : expected ≠ (st.rooms id).rev) :
    st.roomSave id p expected = none := by
  unfold St.roomSave
  have hne : ¬ ((st.rooms id).rev = expected) := by omega
  simp [hne]

/-- A save based on `st` and a save based on its successor cannot both carry
the same expected revision. -/
theorem latest_write_wins
    {st s1 s2 : St} {id : Nat} {p1 p2 : Policy} {expected : Nat}
    (h1 : st.roomSave id p1 expected = some s1)
    (h2 : s1.roomSave id p2 expected = some s2) :
    False := by
  have hnone := stale_replay_rejected (id := id) (p2 := p2) (expected := expected) h1
  rw [hnone] at h2
  cases h2

/-! ## SAT-3: protected grants use the current policy -/

/-- A new grant observes the field after the save's cutover. -/
theorem grant_uses_current_policy
    (st : St) (target id : Nat) (c : Change) (d : Policy)
    (hexam : (st.rooms id).exam = target)
    (hopen : (st.rooms id).closed = false)
    (hchange : c.pause = true) :
    (st.examSave target c d).grant id (fun p => p.pause) = (Policy.norm d).pause := by
  unfold St.grant St.examSave
  have hany : c.any = true := by simp [Change.any, hchange]
  simp [hany, hopen, hexam, Policy.apply, hchange, Policy.norm_pause]

/-- An already-admitted attempt keeps its admission snapshot, so turning a
control off cannot retract a permitted continuation. -/
theorem admitted_attempt_keeps_snapshot
    (st : St) (id : Nat) (a : Attempt) (field : Policy → Bool)
    (hadmitted : a.admitted = true) :
    a.grant st id field = field a.snapshot := by
  simp [Attempt.grant, hadmitted]

/-- A hidden report clears the key at the same scope: the normalized merge
cannot leave a key on behind hidden results. -/
theorem hidden_results_clear_key
    (st : St) (target id : Nat) (c : Change) (d : Policy)
    (hexam : (st.rooms id).exam = target)
    (hopen : (st.rooms id).closed = false)
    (hresults : c.results = true)
    (hhidden : (Policy.norm d).results = false) :
    ((st.examSave target c d).rooms id).policy.keys = false := by
  unfold St.examSave
  have hany : c.any = true := by simp [Change.any, hresults]
  have hd : d.results = false := by
    simpa [Policy.norm_results] using hhidden
  have hmerged : (Policy.apply (st.rooms id).policy (Policy.norm d) c).results = false := by
    simp [Policy.apply, hresults, hd, Policy.norm_results]
  have hkey : (Policy.norm (Policy.apply (st.rooms id).policy (Policy.norm d) c)).keys = false :=
    Policy.norm_keys_of_hidden _ hmerged
  simp [hany, hopen, hexam, hkey]

/-- A key-only exam change cannot reveal a room that hides its own results. -/
theorem key_only_change_keeps_hidden_room
    (st : St) (target id : Nat) (c : Change) (d : Policy)
    (hexam : (st.rooms id).exam = target)
    (hopen : (st.rooms id).closed = false)
    (hkey : c.keys = true)
    (hnoresults : c.results = false)
    (hroomhidden : (st.rooms id).policy.results = false) :
    ((st.examSave target c d).rooms id).policy.results = false ∧
    ((st.examSave target c d).rooms id).policy.keys = false := by
  unfold St.examSave
  have hany : c.any = true := by simp [Change.any, hkey]
  have hres : (Policy.apply (st.rooms id).policy (Policy.norm d) c).results = false := by
    simp [Policy.apply, hnoresults, hroomhidden]
  have hkey : (Policy.norm (Policy.apply (st.rooms id).policy (Policy.norm d) c)).keys = false :=
    Policy.norm_keys_of_hidden _ hres
  constructor
  · simp [hany, hopen, hexam, hres, Policy.norm_results]
  · simp [hany, hopen, hexam, hkey]

/-! ## SAT-4: an older projection cannot restore a revoked control -/

/-- An out-of-order observation is the identity. -/
theorem stale_observation_ignored
    (c : Client) (rev : Nat) (p : Policy) (h : rev < c.seen) :
    c.observe rev p = c := by
  simp [Client.observe, h]

/-- A non-stale observation applies the delivered fields. -/
theorem fresh_observation_applies
    (c : Client) (rev : Nat) (p : Policy) (h : ¬ rev < c.seen) :
    (c.observe rev p).results = p.results := by
  simp [Client.observe, h]

/-- After accepting a revocation, a late response carrying an older grant
cannot restore the score. -/
theorem revocation_survives_stale_response
    (c : Client) (revNew revOld : Nat) (pnew pold : Policy)
    (hnew : c.seen ≤ revNew)
    (hold : revOld < revNew) :
    ((c.observe revNew pnew).observe revOld pold).results = pnew.results := by
  have hnot : ¬ revNew < c.seen := by omega
  have hinner : c.observe revNew pnew =
      { seen := revNew, results := pnew.results, keys := pnew.keys, pause := pnew.pause } := by
    simp [Client.observe, hnot]
  rw [hinner]
  simp [Client.observe, hold]

/-- The same fence holds for the PDF key control. -/
theorem key_revocation_survives_stale_response
    (c : Client) (revNew revOld : Nat) (pnew pold : Policy)
    (hnew : c.seen ≤ revNew)
    (hold : revOld < revNew) :
    ((c.observe revNew pnew).observe revOld pold).keys = pnew.keys := by
  have hnot : ¬ revNew < c.seen := by omega
  have hinner : c.observe revNew pnew =
      { seen := revNew, results := pnew.results, keys := pnew.keys, pause := pnew.pause } := by
    simp [Client.observe, hnot]
  rw [hinner]
  simp [Client.observe, hold]

/-- A fair successful read of the newest revision converges the tab. -/
theorem fair_read_converges
    (c : Client) (rev : Nat) (p : Policy) (h : c.seen ≤ rev) :
    (c.observe rev p).results = p.results ∧
    (c.observe rev p).keys = p.keys ∧
    (c.observe rev p).pause = p.pause := by
  have hnot : ¬ rev < c.seen := by omega
  simp [Client.observe, hnot]

end SatLiveSettings
