import proof.Model

namespace SatAutoRoom

theorem initiation {s : State} (h : Init s) : Invariant s := by
  obtain ⟨revision, draft, current, releases, rfl⟩ := h
  intro k
  simp [Invariant, initial]

theorem selection_covers {valid s actor r id rel sealed}
    (h : Selection valid s actor r id rel sealed) : Covers rel.scope r.scope := by
  cases h with
  | reuse _ _ _ _ cover _ => exact cover
  | publish => exact Or.inr rfl

theorem selection_preserves_release {valid s actor r id rel sealed old oldRel}
    (h : Selection valid s actor r id rel sealed)
    (stored : s.releases old = some oldRel) :
    put s.releases id (some rel) old = some oldRel := by
  cases h with
  | reuse _ _ _ hr _ _ =>
      by_cases eq : old = id
      · subst old
        have same : oldRel = rel := Option.some.inj (stored.symm.trans hr)
        simp [put, same]
      · simp [put, eq, stored]
  | publish d _ _ _ _ fresh =>
      have ne : old ≠ d.id := by
        intro eq
        subst old
        simp [fresh] at stored
      simp [put, ne, stored]

theorem commit_preserves {valid s actor r id rel sealed}
    (inv : Invariant s) (absent : s.receipts r.key = none)
    (sel : Selection valid s actor r id rel sealed) :
    Invariant (commit s r id rel sealed) := by
  intro k
  by_cases eq : k = r.key
  · subst k
    have zero : s.counts r.key = 0 := by
      simpa [absent] using (inv r.key).2.2.1
    refine ⟨?_, ?_, ?_, ?_⟩
    · simp [commit, put]
    · simp [commit, put, effect]
    · simp [commit, put, zero]
    · intro e he
      have ee : e = effect r id rel := by
        simpa [commit, put] using he.symm
      subst e
      exact ⟨rel, by simp [commit, effect, put], rfl, selection_covers sel⟩
  · obtain ⟨room, schedule, count, reference⟩ := inv k
    refine ⟨?_, ?_, ?_, ?_⟩
    · simpa [commit, put, eq] using room
    · simpa [commit, put, eq] using schedule
    · simpa [commit, put, eq] using count
    · intro e he
      have old : s.receipts k = some e := by simpa [commit, put, eq] using he
      obtain ⟨oldRel, stored, payload, cover⟩ := reference e old
      exact ⟨oldRel, selection_preserves_release sel stored, payload, cover⟩

theorem consecution {valid s a t} (inv : Invariant s)
    (h : Step valid s a t) : Invariant t := by
  cases h with
  | complete _ _ _ _ _ _ absent _ _ selected => exact commit_preserves inv absent selected
  | invoke => exact inv
  | inspect => exact inv
  | save => exact inv
  | reopen => exact inv
  | replay => exact inv
  | acknowledge => exact inv
  | crash => exact inv
  | abort => exact inv

theorem reachable_invariant {valid s} (h : Reachable valid s) : Invariant s := by
  induction h with
  | init _ h => exact initiation h
  | next _ step ih => exact consecution ih step

-- Arbitrary actor IDs, keys, finite trace length, saves, retries and crashes.
theorem at_most_one_effect {valid s} (h : Reachable valid s) (k : Key) :
    s.counts k ≤ 1 := by
  rw [(reachable_invariant h k).2.2.1]
  split <;> decide

theorem room_has_atomic_receipt_and_schedule {valid s k e}
    (h : Reachable valid s) (room : s.rooms k = some e) :
    s.receipts k = some e ∧ s.schedules k = some e.version := by
  have inv := reachable_invariant h k
  have receipt := inv.1.symm.trans room
  exact ⟨receipt, by rw [inv.2.1, receipt]; rfl⟩

theorem room_has_matching_release {valid s k e}
    (h : Reachable valid s) (room : s.rooms k = some e) :
    ∃ rel, s.releases e.version = some rel ∧
      rel.payload = e.payload ∧ Covers rel.scope e.scope := by
  have inv := reachable_invariant h k
  exact inv.2.2.2 e (inv.1.symm.trans room)

theorem room_pin_preserved {valid s a t k e}
    (inv : Invariant s) (room : s.rooms k = some e) (step : Step valid s a t) :
    t.rooms k = some e := by
  cases step with
  | complete _ r id rel sealed _ absent _ _ _ =>
      have ne : k ≠ r.key := by
        intro eq
        subst k
        have receipt := (inv r.key).1.symm.trans room
        simp [absent] at receipt
      simpa [commit, put, ne] using room
  | invoke => exact room
  | inspect => exact room
  | save => exact room
  | reopen => exact room
  | replay => exact room
  | acknowledge => exact room
  | crash => exact room
  | abort => exact room

theorem replay_no_effect {valid s actor r e}
    (pending : s.pending actor = some r) (stored : s.receipts r.key = some e)
    (same : e.body = r.body) : Step valid s (.replay actor) s :=
  Step.replay s actor r e pending stored same

theorem different_body_not_replayable {valid s actor r e}
    (pending : s.pending actor = some r) (stored : s.receipts r.key = some e)
    (different : e.body ≠ r.body) :
    ¬ ∃ t, Step valid s (.replay actor) t := by
  rintro ⟨t, step⟩
  cases step with
  | replay _ req recorded hp hs same =>
      have eqr : req = r := Option.some.inj (hp.symm.trans pending)
      subst req
      have eqe : recorded = e := Option.some.inj (hs.symm.trans stored)
      subst recorded
      exact different same

-- Freshness is conditional on supplying all fences; acknowledgement in a
-- browser is not modeled as evidence of a durable save.
theorem supplied_fences_match {s r revision draftId draftRevision d}
    (fence : Fences s r) (he : r.expectedExam = some revision)
    (hd : r.expectedDraft = some (some draftId))
    (hv : r.expectedRevision = some draftRevision) (actual : s.draft = some d) :
    s.examRevision = revision ∧ d.id = draftId ∧ d.revision = draftRevision := by
  exact ⟨fence.1 revision he,
    Option.some.inj (by simpa [actual] using fence.2.1 (some draftId) hd),
    fence.2.2 draftRevision d hv actual⟩

theorem stale_preflight_cannot_seal {valid s actor r d id rel}
    (actual : s.draft = some d) (stale : s.preflight actor ≠ some d) :
    ¬ Selection valid s actor r id rel true := by
  intro selected
  cases selected with
  | publish found hd _ pre _ _ =>
      have eq : found = d := Option.some.inj (hd.symm.trans actual)
      subst found
      exact stale pre

theorem commit_requires_revision_fences {valid s actor t}
    (step : Step valid s (.commit actor) t) :
    ∃ r, s.pending actor = some r ∧ RequiredFences r ∧ Fences s r := by
  cases step with
  | complete _ r _ _ _ pending _ required fences _ =>
      exact ⟨r, pending, required, fences⟩

theorem new_release_validated {valid s actor r id rel}
    (selection : Selection valid s actor r id rel true) : valid rel.payload r.scope := by
  cases selection with
  | publish _ _ _ _ ready _ => exact ready

end SatAutoRoom
