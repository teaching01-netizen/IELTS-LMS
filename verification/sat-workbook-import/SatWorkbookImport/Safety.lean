import SatWorkbookImport.Model

/-!
# Safety: the inductive invariant and its corollaries

`Inv` is established by initiation + consecution over EVERY constructor of
`Step`, then `reach_inv` lifts it to every reachable state.  The business
guarantees are corollaries, not restated assumptions.
-/

namespace WorkbookImport

theorem upd_eq {α : Type} (f : Nat → α) (k : Nat) (v : α) : upd f k v k = v := by
  simp [upd]

theorem upd_ne {α : Type} (f : Nat → α) {k x : Nat} (v : α) (h : x ≠ k) :
    upd f k v x = f x := by
  simp [upd, h]

theorem upd_some {α : Type} {f : Nat → Option α} {k i : Nat} {v p : α}
    (h : upd f k (some v) i = some p) : (i = k ∧ v = p) ∨ (i ≠ k ∧ f i = some p) := by
  by_cases hi : i = k
  · left
    subst hi
    simp [upd] at h
    exact ⟨rfl, h⟩
  · right
    exact ⟨hi, by simpa [upd, hi] using h⟩

theorem upd_none {α : Type} {f : Nat → Option α} {k i : Nat} {v : α}
    (h : upd f k (some v) i = none) : i ≠ k ∧ f i = none := by
  by_cases hi : i = k
  · subst hi
    simp [upd] at h
  · exact ⟨hi, by simpa [upd, hi] using h⟩

/-- The inductive invariant. -/
def Inv (s : State) : Prop :=
  -- effect accounting: an import's effect is applied exactly when it left `previewed`
  (∀ i, s.previews i = none → s.effects i = 0) ∧
  (∀ i p, s.previews i = some p → p.status = .previewed → s.effects i = 0) ∧
  (∀ i p, s.previews i = some p → p.status ≠ .previewed → s.effects i = 1) ∧
  -- a live preview is never ahead of the draft, and while the draft is still at
  -- its revision the draft IS the snapshot the user checked (no lost update)
  (∀ i p, s.previews i = some p → p.status = .previewed →
      p.expectedRev ≤ s.rev ∧ (p.expectedRev = s.rev → s.draft = p.snapshot)) ∧
  -- until something else writes, a committed import's draft is exactly
  -- "snapshot with the targets replaced" (so undo restores exactly the snapshot)
  (∀ i p, s.previews i = some p → p.status = .committed →
      p.importedRev ≤ s.rev ∧
      (p.importedRev = s.rev → s.draft = override p.targets p.content p.snapshot)) ∧
  -- every claimed key stands for an applied effect
  (∀ k r, s.ledger k = some r → s.effects r.importId = 1)

theorem inv_init {s : State} (h : Init s) : Inv s := by
  obtain ⟨hp, hl, he⟩ := h
  refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩
  · intro i _; exact he i
  · intro i p hi; simp [hp i] at hi
  · intro i p hi; simp [hp i] at hi
  · intro i p hi; simp [hp i] at hi
  · intro i p hi; simp [hp i] at hi
  · intro k r hk; simp [hl k] at hk

theorem inv_step {s s' : State} {e : Ev} (hI : Inv s) (hs : Step s e s') : Inv s' := by
  obtain ⟨h1, h2, h3, h4, h5, h6⟩ := hI
  cases hs with
  | register h =>
    rename_i id targets content
    refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩
    · intro i hi
      obtain ⟨hne, hn⟩ := upd_none hi
      exact h1 i hn
    · intro i p hi hst
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · exact h1 _ h
      · exact h2 i p hq hst
    · intro i p hi hst
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · exact absurd rfl hst
      · exact h3 i p hq hst
    · intro i p hi hst
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · exact ⟨Nat.le_refl _, fun _ => rfl⟩
      · exact h4 i p hq hst
    · intro i p hi hst
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · simp at hst
      · exact h5 i p hq hst
    · intro k r hk
      exact h6 k r hk
  | edit =>
    rename_i m c
    refine ⟨h1, h2, h3, ?_, ?_, h6⟩
    · intro i p hi hst
      obtain ⟨hle, _⟩ := h4 i p hi hst
      exact ⟨Nat.le_succ_of_le hle, fun heq => by
        have heq' : p.expectedRev = s.rev + 1 := heq
        omega⟩
    · intro i p hi hst
      obtain ⟨hle, _⟩ := h5 i p hi hst
      exact ⟨Nat.le_succ_of_le hle, fun heq => by
        have heq' : p.importedRev = s.rev + 1 := heq
        omega⟩
  | commitApply hk hp hst hrev ht hc =>
    rename_i k r p
    -- the live preview's own accounting facts
    have hef : s.effects r.importId = 0 := h2 _ p hp hst
    have hdraft : s.draft = p.snapshot := (h4 _ p hp hst).2 hrev
    refine ⟨?_, ?_, ?_, ?_, ?_, ?_⟩
    · intro i hi
      obtain ⟨hne, hn⟩ := upd_none hi
      show upd s.effects r.importId (s.effects r.importId + 1) i = 0
      rw [upd_ne _ _ hne]
      exact h1 i hn
    · intro i p2 hi hst2
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · simp at hst2
      · show upd s.effects r.importId (s.effects r.importId + 1) i = 0
        rw [upd_ne _ _ hne]
        exact h2 i p2 hq hst2
    · intro i p2 hi hst2
      show upd s.effects r.importId (s.effects r.importId + 1) i = 1
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · rw [upd_eq]; omega
      · rw [upd_ne _ _ hne]
        exact h3 i p2 hq hst2
    · intro i p2 hi hst2
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · simp at hst2
      · obtain ⟨hle, _⟩ := h4 i p2 hq hst2
        exact ⟨Nat.le_succ_of_le hle, fun heq => by
          have heq' : p2.expectedRev = s.rev + 1 := heq
          omega⟩
    · intro i p2 hi hst2
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · refine ⟨Nat.le_refl _, fun _ => ?_⟩
        show override p.targets r.content s.draft = override p.targets p.content p.snapshot
        rw [hdraft]
        funext m
        by_cases hm : m ∈ p.targets
        · simp [override, hm, hc m hm]
        · simp [override, hm]
      · obtain ⟨hle, _⟩ := h5 i p2 hq hst2
        exact ⟨Nat.le_succ_of_le hle, fun heq => by
          have heq' : p2.importedRev = s.rev + 1 := heq
          omega⟩
    · intro k2 r2 hk2
      show upd s.effects r.importId (s.effects r.importId + 1) r2.importId = 1
      rcases upd_some hk2 with ⟨_, rfl⟩ | ⟨_, hq⟩
      · rw [upd_eq]; omega
      · -- an existing claim on this import would mean its effect was already applied
        have hone := h6 k2 r2 hq
        by_cases hsame : r2.importId = r.importId
        · rw [hsame] at hone; omega
        · rw [upd_ne _ _ hsame]; exact hone
  | commitReplay => exact ⟨h1, h2, h3, h4, h5, h6⟩
  | commitConflict => exact ⟨h1, h2, h3, h4, h5, h6⟩
  | commitAbort => exact ⟨h1, h2, h3, h4, h5, h6⟩
  | crash => exact ⟨h1, h2, h3, h4, h5, h6⟩
  | undo hp hst hrev =>
    rename_i id p
    refine ⟨?_, ?_, ?_, ?_, ?_, h6⟩
    · intro i hi
      obtain ⟨hne, hn⟩ := upd_none hi
      exact h1 i hn
    · intro i p2 hi hst2
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · simp at hst2
      · exact h2 i p2 hq hst2
    · intro i p2 hi hst2
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · exact h3 _ p hp (by simp [hst])
      · exact h3 i p2 hq hst2
    · intro i p2 hi hst2
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · simp at hst2
      · obtain ⟨hle, _⟩ := h4 i p2 hq hst2
        exact ⟨Nat.le_succ_of_le hle, fun heq => by
          have heq' : p2.expectedRev = s.rev + 1 := heq
          omega⟩
    · intro i p2 hi hst2
      rcases upd_some hi with ⟨rfl, rfl⟩ | ⟨hne, hq⟩
      · simp at hst2
      · obtain ⟨hle, _⟩ := h5 i p2 hq hst2
        exact ⟨Nat.le_succ_of_le hle, fun heq => by
          have heq' : p2.importedRev = s.rev + 1 := heq
          omega⟩

/-- Every reachable state satisfies the invariant. -/
theorem reach_inv {s : State} (h : Reach s) : Inv s := by
  induction h with
  | init hi => exact inv_init hi
  | step _ hs ih => exact inv_step ih hs

/-! ## Business corollaries -/

/-- REQ-1 (at-most-once effect): no import is ever applied twice, whatever the
retries, keys, interleavings, crashes or undos. -/
theorem at_most_one_effect {s : State} (h : Reach s) (i : Nat) : s.effects i ≤ 1 := by
  obtain ⟨h1, h2, h3, _, _, _⟩ := reach_inv h
  cases hp : s.previews i with
  | none => rw [h1 i hp]; omega
  | some p =>
    by_cases hst : p.status = .previewed
    · rw [h2 i p hp hst]; omega
    · rw [h3 i p hp hst]; omega

/-- REQ-2 (scope isolation): a successful commit changes ONLY the detected
modules; every other module's content is unchanged. -/
theorem commit_scope_isolation {r : Req} {p : Preview} {d : Draft}
    (m : Key) (hm : m ∉ p.targets) :
    (override p.targets r.content d) m = d m := by
  simp [override, hm]

/-- REQ-3 (exact replacement): the detected modules end up with exactly the
checked content, never anything the client substituted. -/
theorem commit_installs_checked_content {r : Req} {p : Preview} {d : Draft}
    (hc : ∀ m, m ∈ p.targets → r.content m = p.content m) (m : Key) (hm : m ∈ p.targets) :
    (override p.targets r.content d) m = p.content m := by
  simp [override, hm, hc m hm]

/-- REQ-4 (no lost update): a commit only applies to the very draft the user
checked: if anything wrote since registration, the revision moved and the
commit cannot apply. -/
theorem commit_applies_only_to_checked_draft {s : State} (h : Reach s) {r : Req} {p : Preview}
    (hp : s.previews r.importId = some p) (hst : p.status = .previewed)
    (hrev : p.expectedRev = s.rev) : s.draft = p.snapshot :=
  ((reach_inv h).2.2.2.1 _ p hp hst).2 hrev

/-- REQ-4b: a stale revision can only produce a no-op. -/
theorem stale_commit_is_noop {s s' : State} {k : Nat} {r : Req} {p : Preview}
    (hp : s.previews r.importId = some p) (hst : p.status = .previewed)
    (hstale : p.expectedRev ≠ s.rev) (hs : Step s (.commit k r) s') : s' = s := by
  cases hs with
  | commitApply hk hp' hst' hrev' ht hc =>
    rw [hp] at hp'
    cases hp'
    exact absurd hrev' hstale
  | commitReplay => rfl
  | commitConflict => rfl
  | commitAbort => rfl

/-- REQ-5 (idempotent retry / key reuse): once a key is claimed, ANY commit
with that key — the same request (ACK-loss retry) or a different one — is a
no-op. -/
theorem claimed_key_commit_is_noop {s s' : State} {k : Nat} {r : Req}
    (hk : s.ledger k ≠ none) (hs : Step s (.commit k r) s') : s' = s := by
  cases hs with
  | commitApply hk' => exact absurd hk' hk
  | commitReplay => rfl
  | commitConflict => rfl
  | commitAbort => rfl

/-- REQ-5b: a successful first delivery claims its key, so the retry after a
lost ACK can never apply a second time. -/
theorem retry_after_applied_is_noop {s s1 s2 : State} {k : Nat} {r : Req}
    (hs1 : Step s (.commit k r) s1) (happly : s1 ≠ s)
    (hs2 : Step s1 (.commit k r) s2) : s2 = s1 := by
  have hclaimed : s1.ledger k ≠ none := by
    cases hs1 with
    | commitApply hk hp hst hrev ht hc => simp [upd]
    | commitReplay => exact absurd rfl happly
    | commitConflict => exact absurd rfl happly
    | commitAbort => exact absurd rfl happly
  exact claimed_key_commit_is_noop hclaimed hs2

/-- REQ-6 (undo restores the pre-import draft): while nothing has been written
since an import committed, undoing it yields exactly the draft the user checked
— for ALL modules, including the ones the import never touched. -/
theorem undo_restores_snapshot {s s' : State} (h : Reach s) {id : Nat} {p : Preview}
    (hs : Step s (.undo id) s') (hp : s.previews id = some p) : s'.draft = p.snapshot := by
  cases hs with
  | undo hp' hst hrev =>
    rw [hp] at hp'
    cases hp'
    rfl

/-- REQ-2b (scope isolation at the transition level): any module outside the
preview's detected targets is byte-for-byte unchanged by a commit step. -/
theorem commit_step_scope {s s' : State} {k : Nat} {r : Req}
    (hs : Step s (.commit k r) s') (m : Key)
    (hm : ∀ p, s.previews r.importId = some p → m ∉ p.targets) :
    s'.draft m = s.draft m := by
  cases hs with
  | commitApply hk hp hst hrev ht hc =>
    show override _ r.content s.draft m = s.draft m
    simp [override, hm _ hp]
  | commitReplay => rfl
  | commitConflict => rfl
  | commitAbort => rfl

/-- REQ-5c (defence in depth): even with a FRESH key — e.g. after the op-key
ledger row was purged — an import that has left `previewed` can never be applied
again.  The state machine alone gives at-most-once; the ledger adds replay. -/
theorem commit_of_used_import_is_noop {s s' : State} {k : Nat} {r : Req} {p : Preview}
    (hp : s.previews r.importId = some p) (hst : p.status ≠ .previewed)
    (hs : Step s (.commit k r) s') : s' = s := by
  cases hs with
  | commitApply hk hp' hst' =>
    rw [hp] at hp'
    cases hp'
    exact absurd hst' hst
  | commitReplay => rfl
  | commitConflict => rfl
  | commitAbort => rfl

/-- REQ-6b: undo only ever discards the import itself — it is refused unless the
draft is still exactly "snapshot with the targets replaced", so no later edit by
anyone can be silently erased. -/
theorem undo_discards_only_the_import {s s' : State} (h : Reach s) {id : Nat} {p : Preview}
    (hs : Step s (.undo id) s') (hp : s.previews id = some p) :
    s.draft = override p.targets p.content p.snapshot := by
  cases hs with
  | undo hp' hst hrev =>
    rw [hp] at hp'
    cases hp'
    exact ((reach_inv h).2.2.2.2.1 id _ hp hst).2 hrev

end WorkbookImport
