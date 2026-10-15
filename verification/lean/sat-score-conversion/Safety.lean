import Model

/-!
# Safety theorems for the global score-conversion policy

Requirement ids refer to the local `SPEC.md` (G-*, INV-*).
Everything here is about the definitions in `Model.lean` and its stated assumptions.
-/

namespace SatScoreConversion

/-! ## Lookup: fail closed (FR-6, INV-3) -/

theorem find_exists_some {α : Type} (p : α → Bool) :
    ∀ l : List α, (∃ t ∈ l, p t = true) → ∃ t, l.find? p = some t := by
  intro l
  induction l with
  | nil => intro ⟨t, ht, _⟩; cases ht
  | cons x xs ih =>
    intro ⟨t, ht, hp⟩
    by_cases hx : p x = true
    · exact ⟨x, by simp [List.find?, hx]⟩
    · have hx' : p x = false := by simpa using hx
      rcases List.mem_cons.mp ht with rfl | hmem
      · exact absurd hp hx
      · obtain ⟨u, hu⟩ := ih ⟨t, hmem, hp⟩
        exact ⟨u, by simp [List.find?, hx', hu]⟩

/-- A converted score is read from a table with EXACTLY the attempt's operational counts,
at in-range raw scores, from a present, valid cell: nothing is borrowed, interpolated
or invented. -/
theorem resolve_sound (c : Content) (a b m1 m2 v : Nat)
    (h : c.resolve a b m1 m2 = some v) :
    ∃ t ∈ c.tables, t.m1Ops = a ∧ t.m2Ops = b ∧ m1 ≤ a ∧ m2 ≤ b ∧
      t.cell m1 m2 = some v ∧ ValidScore v := by
  unfold Content.resolve at h
  cases hf : c.tables.find? (fun t => t.m1Ops == a && t.m2Ops == b) with
  | none => simp [hf] at h
  | some t =>
    rw [hf] at h
    dsimp only at h
    have hmem := List.mem_of_find?_eq_some hf
    have hp := List.find?_some hf
    simp at hp
    by_cases hr : m1 ≤ a ∧ m2 ≤ b
    · rw [if_pos hr] at h
      cases hc : t.cell m1 m2 with
      | none => rw [hc] at h; dsimp only at h; simp at h
      | some w =>
        rw [hc] at h
        dsimp only at h
        by_cases hv : ValidScore w
        · rw [if_pos hv] at h
          injection h with hw
          subst hw
          exact ⟨t, hmem, hp.1, hp.2, hr.1, hr.2, hc, hv⟩
        · rw [if_neg hv] at h; simp at h
    · rw [if_neg hr] at h; simp at h

/-- No table with the attempt's operational counts: unavailable (a 25-question table is
never used for a 27-question attempt). -/
theorem resolve_none_of_no_table (c : Content) (a b m1 m2 : Nat)
    (h : ∀ t ∈ c.tables, ¬ (t.m1Ops = a ∧ t.m2Ops = b)) : c.resolve a b m1 m2 = none := by
  unfold Content.resolve
  have : c.tables.find? (fun t => t.m1Ops == a && t.m2Ops == b) = none := by
    rw [List.find?_eq_none]
    intro t ht hp
    simp at hp
    exact h t ht hp
  rw [this]

/-- A publishable policy answers every in-range lookup for dimensions it covers. -/
theorem publishable_resolves (c : Content) (hp : Publishable c) (a b m1 m2 : Nat)
    (hcov : ∃ t ∈ c.tables, t.m1Ops = a ∧ t.m2Ops = b) (h1 : m1 ≤ a) (h2 : m2 ≤ b) :
    ∃ v, c.resolve a b m1 m2 = some v := by
  obtain ⟨t0, ht0, ha, hb⟩ := hcov
  obtain ⟨t, hf⟩ := find_exists_some (fun t => t.m1Ops == a && t.m2Ops == b) c.tables
    ⟨t0, ht0, by simp [ha, hb]⟩
  have hmem := List.mem_of_find?_eq_some hf
  have hpred := List.find?_some hf
  simp at hpred
  obtain ⟨v, hv, hvalid⟩ := hp.2 t hmem m1 m2 (hpred.1 ▸ h1) (hpred.2 ▸ h2)
  refine ⟨v, ?_⟩
  unfold Content.resolve
  rw [hf]
  simp [h1, h2, hv, hvalid]

/-! ## The invariant -/

structure Inv (s : St) : Prop where
  next_pos : 1 ≤ s.nextNum
  pub_num : ∀ i r, s.revs i = some r → r.status = .published → 1 ≤ r.num ∧ r.num < s.nextNum
  pub_inj : ∀ i j ri rj, s.revs i = some ri → s.revs j = some rj →
    ri.status = .published → rj.status = .published → ri.num = rj.num → i = j
  active_none : s.active = none →
    s.nextNum = 1 ∧ ∀ i r, s.revs i = some r → r.status = .draft
  active_some : ∀ a, s.active = some a →
    ∃ r, s.revs a = some r ∧ r.status = .published ∧ r.num + 1 = s.nextNum
  chain : ∀ i r, s.revs i = some r → r.status = .published →
    (r.base = none ∧ r.num = 1) ∨
    (∃ b rb, r.base = some b ∧ s.revs b = some rb ∧ rb.status = .published ∧ rb.num + 1 = r.num)
  pub_ok : ∀ i r, s.revs i = some r → r.status = .published → Publishable r.content

theorem upd_cases {α : Type} {f : Nat → Option α} {k : Nat} {v r : α} {i : Nat}
    (h : upd f k v i = some r) : (i = k ∧ r = v) ∨ (i ≠ k ∧ f i = some r) := by
  unfold upd at h
  by_cases hi : i = k
  · rw [if_pos hi] at h
    exact Or.inl ⟨hi, (Option.some.inj h).symm⟩
  · rw [if_neg hi] at h
    exact Or.inr ⟨hi, h⟩

/-- A key already holding a value keeps it when another key is updated. -/
theorem upd_keep {α : Type} {f : Nat → Option α} {k i : Nat} {v r : α}
    (h : f i = some r) (hne : i ≠ k) : upd f k v i = some r := by
  rw [upd_other f k v i hne]; exact h

theorem Init.inv {s : St} (h : Init s) : Inv s := by
  obtain ⟨hr, ha, hn, _⟩ := h
  refine ⟨by omega, ?_, ?_, ?_, ?_, ?_, ?_⟩
  · intro i r hi; rw [hr i] at hi; cases hi
  · intro i j ri rj hi; rw [hr i] at hi; cases hi
  · intro _; exact ⟨hn, fun i r hi => by rw [hr i] at hi; cases hi⟩
  · intro a ha'; rw [ha] at ha'; cases ha'
  · intro i r hi; rw [hr i] at hi; cases hi
  · intro i r hi; rw [hr i] at hi; cases hi

/-- Changing only the results table cannot affect the policy invariant. -/
theorem Inv.keepRevs {s : St} (h : Inv s) {t : Nat → Option Result} : Inv { s with results := t } :=
  ⟨h.next_pos, h.pub_num, h.pub_inj, h.active_none, h.active_some, h.chain, h.pub_ok⟩

/-- Every step preserves the invariant. -/
theorem Inv.step {s s' : St} {a : Act} (h : Inv s) (hs : Step s a s') : Inv s' := by
  cases hs with
  | createDraft id c hid =>
    refine ⟨h.next_pos, ?_, ?_, ?_, ?_, ?_, ?_⟩
    · intro i r hi hp
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨_, hi'⟩
      · cases hp
      · exact h.pub_num i r hi' hp
    · intro i j ri rj hi hj hpi hpj hn
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨hi1, hi'⟩
      · cases hpi
      · rcases upd_cases hj with ⟨_, rfl⟩ | ⟨hj1, hj'⟩
        · cases hpj
        · exact h.pub_inj i j ri rj hi' hj' hpi hpj hn
    · intro hn
      obtain ⟨hn1, hd⟩ := h.active_none hn
      refine ⟨hn1, ?_⟩
      intro i r hi
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨_, hi'⟩
      · rfl
      · exact hd i r hi'
    · intro a' ha'
      obtain ⟨r, hr, hp, hnum⟩ := h.active_some a' ha'
      have hne : a' ≠ id := by intro e; rw [e] at hr; rw [hid] at hr; cases hr
      exact ⟨r, upd_keep hr hne, hp, hnum⟩
    · intro i r hi hp
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨_, hi'⟩
      · cases hp
      · rcases h.chain i r hi' hp with hl | ⟨b, rb, hb, hrb, hpb, hnb⟩
        · exact Or.inl hl
        · have hne : b ≠ id := by intro e; rw [e] at hrb; rw [hid] at hrb; cases hrb
          exact Or.inr ⟨b, rb, hb, upd_keep hrb hne, hpb, hnb⟩
    · intro i r hi hp
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨_, hi'⟩
      · cases hp
      · exact h.pub_ok i r hi' hp
  | save id expected c d hd hdraft hver =>
    have hne_pub : ∀ b rb, s.revs b = some rb → rb.status = .published → b ≠ id := by
      intro b rb hrb hpb e; rw [e, hd] at hrb; cases hrb; rw [hdraft] at hpb; cases hpb
    refine ⟨h.next_pos, ?_, ?_, ?_, ?_, ?_, ?_⟩
    · intro i r hi hp
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨_, hi'⟩
      · simp [hdraft] at hp
      · exact h.pub_num i r hi' hp
    · intro i j ri rj hi hj hpi hpj hn
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨hi1, hi'⟩
      · simp [hdraft] at hpi
      · rcases upd_cases hj with ⟨_, rfl⟩ | ⟨hj1, hj'⟩
        · simp [hdraft] at hpj
        · exact h.pub_inj i j ri rj hi' hj' hpi hpj hn
    · intro hn
      obtain ⟨hn1, hd'⟩ := h.active_none hn
      refine ⟨hn1, ?_⟩
      intro i r hi
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨_, hi'⟩
      · simpa using hdraft
      · exact hd' i r hi'
    · intro a' ha'
      obtain ⟨r, hr, hp, hnum⟩ := h.active_some a' ha'
      exact ⟨r, upd_keep hr (hne_pub a' r hr hp), hp, hnum⟩
    · intro i r hi hp
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨_, hi'⟩
      · simp [hdraft] at hp
      · rcases h.chain i r hi' hp with hl | ⟨b, rb, hb, hrb, hpb, hnb⟩
        · exact Or.inl hl
        · exact Or.inr ⟨b, rb, hb, upd_keep hrb (hne_pub b rb hrb hpb), hpb, hnb⟩
    · intro i r hi hp
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨_, hi'⟩
      · simp [hdraft] at hp
      · exact h.pub_ok i r hi' hp
  | publish id d hd hdraft hbase hpub =>
    have hnp := h.next_pos
    have hne_pub : ∀ b rb, s.revs b = some rb → rb.status = .published → b ≠ id := by
      intro b rb hrb hpb e; rw [e, hd] at hrb; cases hrb; rw [hdraft] at hpb; cases hpb
    refine ⟨by show 1 ≤ s.nextNum + 1; omega, ?_, ?_, ?_, ?_, ?_, ?_⟩
    · intro i r hi hp
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨hi1, hi'⟩
      · simp; omega
      · obtain ⟨p1, p2⟩ := h.pub_num i r hi' hp
        simp; omega
    · intro i j ri rj hi hj hpi hpj hn
      rcases upd_cases hi with ⟨hi1, rfl⟩ | ⟨hi1, hi'⟩
      · rcases upd_cases hj with ⟨hj1, rfl⟩ | ⟨hj1, hj'⟩
        · rw [hi1, hj1]
        · have := (h.pub_num j rj hj' hpj).2
          simp at hn; omega
      · rcases upd_cases hj with ⟨hj1, rfl⟩ | ⟨hj1, hj'⟩
        · have := (h.pub_num i ri hi' hpi).2
          simp at hn; omega
        · exact h.pub_inj i j ri rj hi' hj' hpi hpj hn
    · intro hn; cases hn
    · intro a' ha'
      have hid : id = a' := Option.some.inj ha'
      subst hid
      exact ⟨_, upd_same _ _ _, rfl, rfl⟩
    · intro i r hi hp
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨hi1, hi'⟩
      · -- the newly published revision
        rcases hact : s.active with _ | a'
        · obtain ⟨hn1, _⟩ := h.active_none hact
          left; refine ⟨?_, ?_⟩
          · simp [hbase, hact]
          · simp; omega
        · obtain ⟨ra, hra, hpa, hna⟩ := h.active_some a' hact
          right
          refine ⟨a', ra, ?_, ?_, hpa, ?_⟩
          · simp [hbase, hact]
          · exact upd_keep hra (hne_pub a' ra hra hpa)
          · simp; omega
      · rcases h.chain i r hi' hp with hl | ⟨b, rb, hb, hrb, hpb, hnb⟩
        · exact Or.inl hl
        · exact Or.inr ⟨b, rb, hb, upd_keep hrb (hne_pub b rb hrb hpb), hpb, hnb⟩
    · intro i r hi hp
      rcases upd_cases hi with ⟨_, rfl⟩ | ⟨_, hi'⟩
      · exact hpub
      · exact h.pub_ok i r hi' hp
  | republish => exact h
  | sealResult => exact h.keepRevs
  | releaseResult => exact h.keepRevs
  | stutter => exact h

theorem Reach.inv {s : St} (h : Reach s) : Inv s := by
  induction h with
  | init s hi => exact hi.inv
  | step s s' a _ hs ih => exact ih.step hs

/-! ## Business corollaries -/

/-- INV-1: a published revision is never changed or removed by any step. -/
theorem published_immutable {s s' : St} {a : Act} (hs : Step s a s') {id : Nat} {r : Rev}
    (hr : s.revs id = some r) (hp : r.status = .published) : s'.revs id = some r := by
  cases hs with
  | createDraft id' c hnone =>
    have : id ≠ id' := by intro e; rw [e, hnone] at hr; cases hr
    exact upd_keep hr this
  | save id' expected c d hd hdraft hver =>
    have : id ≠ id' := by intro e; rw [e, hd] at hr; cases hr; rw [hdraft] at hp; cases hp
    exact upd_keep hr this
  | publish id' d hd hdraft hbase hpub =>
    have : id ≠ id' := by intro e; rw [e, hd] at hr; cases hr; rw [hdraft] at hp; cases hp
    exact upd_keep hr this
  | republish => exact hr
  | sealResult => exact hr
  | releaseResult => exact hr
  | stutter => exact hr

/-- INV-2: the active revision is the published one with the highest number. -/
theorem active_is_latest {s : St} (h : Reach s) {a : Nat} (ha : s.active = some a) :
    ∃ ra, s.revs a = some ra ∧ ra.status = .published ∧
      ∀ i r, s.revs i = some r → r.status = .published → r.num ≤ ra.num := by
  have hi := h.inv
  obtain ⟨ra, hra, hpa, hna⟩ := hi.active_some a ha
  refine ⟨ra, hra, hpa, ?_⟩
  intro i r hr hp
  have := (hi.pub_num i r hr hp).2
  omega

/-- INV-5 / FR-4: no two published revisions share a base - the history is one chain,
so a concurrent publish on a stale base can never fork it. -/
theorem no_fork {s : St} (h : Reach s) {i j : Nat} {ri rj : Rev}
    (hi : s.revs i = some ri) (hj : s.revs j = some rj)
    (hpi : ri.status = .published) (hpj : rj.status = .published)
    (hbase : ri.base = rj.base) : i = j := by
  have inv := h.inv
  apply inv.pub_inj i j ri rj hi hj hpi hpj
  rcases inv.chain i ri hi hpi with ⟨b1, n1⟩ | ⟨b, rb, hb, hrb, hpb, hnb⟩
  · rcases inv.chain j rj hj hpj with ⟨_, n2⟩ | ⟨b', rb', hb', _, _, _⟩
    · omega
    · rw [b1] at hbase; rw [hb'] at hbase; cases hbase
  · rcases inv.chain j rj hj hpj with ⟨b2, _⟩ | ⟨b', rb', hb', hrb', hpb', hnb'⟩
    · rw [hb] at hbase; rw [b2] at hbase; cases hbase
    · rw [hb] at hbase; rw [hb'] at hbase
      have e : b = b' := Option.some.inj hbase
      subst e
      rw [hrb] at hrb'
      cases hrb'
      omega

/-- A published revision always passes the publish validation: no empty or invalid cell
is ever part of an active policy. -/
theorem published_is_publishable {s : St} (h : Reach s) {i : Nat} {r : Rev}
    (hr : s.revs i = some r) (hp : r.status = .published) : Publishable r.content :=
  h.inv.pub_ok i r hr hp

/-- Optimistic lock: a successful save was made against the draft's current version. -/
theorem save_requires_current_version {s s' : St} {id expected : Nat} {c : Content}
    (hs : Step s (.save id expected c) s') (hne : s' ≠ s) :
    ∃ d, s.revs id = some d ∧ d.status = .draft ∧ d.version = expected := by
  cases hs with
  | save _ _ _ d hd hdraft hver => exact ⟨d, hd, hdraft, hver⟩
  | stutter => exact absurd rfl hne

/-- FR-4 / INV-5: a successful publish replaced exactly the revision that was active. -/
theorem publish_requires_active_base {s s' : St} {id : Nat}
    (hs : Step s (.publish id) s') (hne : s' ≠ s) :
    ∃ d, s.revs id = some d ∧ d.status = .draft ∧ d.base = s.active ∧ Publishable d.content ∧
      s'.active = some id := by
  cases hs with
  | publish _ d hd hdraft hbase hpub => exact ⟨d, hd, hdraft, hbase, hpub, rfl⟩
  | republish => exact absurd rfl hne
  | stutter => exact absurd rfl hne

/-- Idempotent retry (lost ACK): publishing the active revision again is a no-op. -/
theorem retry_after_commit {s s' : St} {id : Nat} {d : Rev} (hd : s.revs id = some d)
    (hp : d.status = .published) (hs : Step s (.publish id) s') : s' = s := by
  cases hs with
  | publish _ d' hd' hdraft _ _ => rw [hd] at hd'; cases hd'; rw [hdraft] at hp; cases hp
  | republish => rfl
  | stutter => rfl

/-- Results are insert-only, and their raw scores and legacy value never change. -/
theorem result_raw_immutable {s s' : St} {a : Act} (hs : Step s a s') {rid : Nat} {r : Result}
    (hr : s.results rid = some r) :
    ∃ r', s'.results rid = some r' ∧ r'.raw = r.raw ∧ r'.legacy = r.legacy ∧
      (r.released = true → r'.released = true) := by
  cases hs with
  | createDraft => exact ⟨r, hr, rfl, rfl, id⟩
  | save => exact ⟨r, hr, rfl, rfl, id⟩
  | publish => exact ⟨r, hr, rfl, rfl, id⟩
  | republish => exact ⟨r, hr, rfl, rfl, id⟩
  | sealResult rid' r0 hnone =>
    have : rid ≠ rid' := by intro e; rw [e, hnone] at hr; cases hr
    exact ⟨r, upd_keep hr this, rfl, rfl, id⟩
  | releaseResult rid' r0 hr0 =>
    by_cases e : rid = rid'
    · subst e; rw [hr] at hr0; cases hr0
      exact ⟨{ r with released := true }, upd_same _ _ _, rfl, rfl, fun _ => rfl⟩
    · exact ⟨r, upd_keep hr e, rfl, rfl, id⟩
  | stutter => exact ⟨r, hr, rfl, rfl, id⟩

/-! ## Display: release gate, retroactivity, no invention -/

/-- INV-4: a withheld result never shows a score, whatever any publish does. -/
theorem display_withheld (s : St) (r : Result) (h : r.released = false) : display s r = none := by
  simp [display, h]

theorem display_released_only (s : St) (r : Result) (v : Nat) (h : display s r = some v) :
    r.released = true := by
  by_cases hr : r.released = true
  · exact hr
  · have : r.released = false := by simpa using hr
    simp [display, this] at h

/-- FR-4 (retroactivity): right after a publish commits, EVERY released result - sealed
before or after - displays what the newly active revision resolves from its persisted raw
scores. -/
theorem display_after_publish {s s' : St} {id : Nat} (hs : Step s (.publish id) s')
    (hne : s' ≠ s) (r : Result) (hrel : r.released = true) :
    ∃ rev, s'.revs id = some rev ∧
      display s' r = rev.content.resolve r.raw.m1Ops r.raw.m2Ops r.raw.m1 r.raw.m2 := by
  cases hs with
  | publish _ d hd hdraft hbase hpub =>
    refine ⟨d.published s.nextNum, upd_same _ _ _, ?_⟩
    simp [display, hrel]
  | republish => exact absurd rfl hne
  | stutter => exact absurd rfl hne

/-- The displayed score depends on the result only through its persisted raw scores:
two released results with equal raw scores show the same score under the active policy,
whenever each was sealed (TC-13). -/
theorem display_depends_on_raw_only (s : St) {a : Nat} (ha : s.active = some a)
    (r1 r2 : Result) (h1 : r1.released = true) (h2 : r2.released = true)
    (hraw : r1.raw = r2.raw) : display s r1 = display s r2 := by
  simp [display, h1, h2, ha, hraw]

/-- FR-6: any displayed score under an active policy is a valid score read from a table of
exactly the attempt's operational counts. -/
theorem display_no_invention {s : St} {r : Result} {a : Nat} {v : Nat}
    (ha : s.active = some a) (hv : display s r = some v) :
    ∃ rev, s.revs a = some rev ∧ ∃ t ∈ rev.content.tables,
      t.m1Ops = r.raw.m1Ops ∧ t.m2Ops = r.raw.m2Ops ∧ ValidScore v := by
  have hrel := display_released_only s r v hv
  simp [display, hrel, ha] at hv
  cases hrev : s.revs a with
  | none => rw [hrev] at hv; simp at hv
  | some rev =>
    rw [hrev] at hv
    simp only [] at hv
    obtain ⟨t, ht, h1, h2, _, _, _, hvalid⟩ := resolve_sound _ _ _ _ _ _ hv
    exact ⟨rev, rfl, t, ht, h1, h2, hvalid⟩

/-- Before the first publish nothing changes: a result shows exactly its stored legacy score. -/
theorem display_without_policy {s : St} (hn : s.active = none) (r : Result)
    (hrel : r.released = true) : display s r = r.legacy := by
  simp [display, hrel, hn]

end SatScoreConversion
