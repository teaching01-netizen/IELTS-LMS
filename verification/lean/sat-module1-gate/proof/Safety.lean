import Model

namespace SatModule1Gate

/-! ## Gate-level lemmas -/

theorem adaptive_higher {raw ops thr : Int} :
    adaptive raw ops thr = some .higher ↔
      1 ≤ thr ∧ thr ≤ ops ∧ 0 ≤ raw ∧ raw ≤ ops ∧ thr ≤ raw := by
  unfold adaptive
  by_cases h : 1 ≤ thr ∧ thr ≤ ops ∧ 0 ≤ raw ∧ raw ≤ ops
  · by_cases h2 : thr ≤ raw
    · simp [h, h2]
    · simp [h, h2]
  · simp only [h, if_false]
    constructor
    · intro e; cases e
    · intro ⟨a, b, c, d, _⟩; exact absurd ⟨a, b, c, d⟩ h

theorem adaptive_lower {raw ops thr : Int} :
    adaptive raw ops thr = some .lower ↔
      1 ≤ thr ∧ thr ≤ ops ∧ 0 ≤ raw ∧ raw ≤ ops ∧ raw < thr := by
  unfold adaptive
  by_cases h : 1 ≤ thr ∧ thr ≤ ops ∧ 0 ≤ raw ∧ raw ≤ ops
  · by_cases h2 : thr ≤ raw
    · (simp [h, h2]) <;> omega
    · (simp [h, h2]) <;> omega
  · simp only [h, if_false]
    constructor
    · intro e; cases e
    · intro ⟨a, b, c, d, _⟩; exact absurd ⟨a, b, c, d⟩ h

/-- A qualifying forced section always has a decision row with an integer
threshold, and that row routes to the forced branch. -/
theorem gate_forced_qualified {s : Shape} {b : Branch} {d : Option Decision}
    (hb : s.forced = some b) (hq : qualified (gate s d) = true) :
    ∃ raw ops thr, d = some ⟨raw, ops, some thr⟩ ∧ adaptive raw ops thr = some b := by
  unfold gate at hq
  rw [hb] at hq
  match d, hq with
  | some ⟨raw, ops, some thr⟩, hq =>
    exact ⟨raw, ops, thr, rfl, by simpa [qualified, Option.getD] using hq⟩
  | some ⟨_, _, none⟩, hq => simp [qualified, Option.getD] at hq
  | none, hq => simp [qualified, Option.getD] at hq

theorem convert_qualified {f : Option Bool} {c : Option Nat}
    (h : convert f c ≠ none) : qualified f = true := by
  unfold convert at h
  cases hq : qualified f
  · simp [hq] at h
  · rfl

/-! ## Exact boundary (REQ-1, REQ-2, REQ-3): iff, so neither over- nor under-blocking -/

theorem m1Hard_qualified_iff (d : Option Decision) :
    qualified (gate .m1Hard d) = true ↔
      ∃ raw ops thr, d = some ⟨raw, ops, some thr⟩ ∧
        1 ≤ thr ∧ thr ≤ ops ∧ 0 ≤ raw ∧ raw ≤ ops ∧ thr ≤ raw := by
  constructor
  · intro hq
    obtain ⟨raw, ops, thr, hd, ha⟩ := gate_forced_qualified (b := .higher) rfl hq
    exact ⟨raw, ops, thr, hd, adaptive_higher.mp ha⟩
  · rintro ⟨raw, ops, thr, rfl, hv⟩
    simp [gate, Shape.forced, qualified, Option.getD, adaptive_higher.mpr hv]

theorem m1Easy_qualified_iff (d : Option Decision) :
    qualified (gate .m1Easy d) = true ↔
      ∃ raw ops thr, d = some ⟨raw, ops, some thr⟩ ∧
        1 ≤ thr ∧ thr ≤ ops ∧ 0 ≤ raw ∧ raw ≤ ops ∧ raw < thr := by
  constructor
  · intro hq
    obtain ⟨raw, ops, thr, hd, ha⟩ := gate_forced_qualified (b := .lower) rfl hq
    exact ⟨raw, ops, thr, hd, adaptive_lower.mp ha⟩
  · rintro ⟨raw, ops, thr, rfl, hv⟩
    simp [gate, Shape.forced, qualified, Option.getD, adaptive_lower.mpr hv]

/-- REQ-4: full adaptive and Module-2-only shapes are never gated. -/
theorem unforced_never_gated {s : Shape} (hs : s.forced = none) (d : Option Decision)
    (cell : Option Nat) : gate s d = none ∧ convert (gate s d) cell = cell := by
  have : gate s d = none := by unfold gate; rw [hs]
  exact ⟨this, by simp [convert, this, qualified, Option.getD]⟩

/-- REQ-5: the gate is exactly "routing would have chosen the forced branch". -/
theorem gate_matches_routing {s : Shape} {b : Branch} (hb : s.forced = some b)
    (raw ops thr : Int) :
    gate s (some ⟨raw, ops, some thr⟩) = some (decide (adaptive raw ops thr = some b)) := by
  unfold gate; rw [hb]

/-- REQ-6: a total exists only when both sections converted. -/
theorem total_needs_both {rw math : Option Nat} {t : Nat} (h : total rw math = some t) :
    ∃ a b, rw = some a ∧ math = some b ∧ t = a + b := by
  match rw, math, h with
  | some a, some b, h => exact ⟨a, b, rfl, rfl, by simp [total] at h; omega⟩

/-! ## Lifecycle invariant over seal, any sequence of revisions, degrade, repair -/

def Inv (st : St) : Prop :=
  (st.sealed = false → st.shown = none) ∧
  (st.sealed = true → st.flag = gate st.shape st.dec) ∧
  (st.shown ≠ none → qualified st.flag = true)

theorem inv_init {st : St} (h : Init st) : Inv st := by
  unfold Inv
  exact ⟨fun _ => h.2, fun hs => (by rw [h.1] at hs; cases hs), fun hv => absurd h.2 hv⟩

theorem inv_step {st st' : St} (hi : Inv st) (h : Step st st') : Inv st' := by
  unfold Inv at hi ⊢
  obtain ⟨_, h2, _⟩ := hi
  cases h with
  | sealResult s d cell _ =>
    exact ⟨fun e => (by cases e), fun _ => rfl, convert_qualified⟩
  | overlay cell hs =>
    exact ⟨fun e => (by simp only at e; rw [hs] at e; cases e), fun _ => h2 hs, convert_qualified⟩
  | degrade =>
    exact ⟨fun _ => rfl, h2, fun hv => absurd rfl hv⟩
  | reseal cell hs =>
    exact ⟨fun e => (by simp only at e; rw [hs] at e; cases e), fun _ => rfl, convert_qualified⟩

theorem reachable_inv {st : St} (h : Reachable st) : Inv st := by
  induction h with
  | init _ hi => exact inv_init hi
  | step _ _ _ hs ih => exact inv_step ih hs

/-- A displayed score always comes from a sealed section whose flag is the gate
applied to the immutable plan shape and route decision. -/
theorem shown_gated {st : St} (hr : Reachable st) (hv : st.shown ≠ none) :
    st.sealed = true ∧ qualified (gate st.shape st.dec) = true := by
  have hi := reachable_inv hr
  unfold Inv at hi
  obtain ⟨h1, h2, h3⟩ := hi
  cases hs : st.sealed with
  | false => exact absurd (h1 hs) hv
  | true => exact ⟨rfl, (h2 hs) ▸ h3 hv⟩

/-- Business guarantee (REQ-1): under "Module 1, then Hard Module 2", a converted
score is visible — after seal, under every revision, and after repair — only if
the route decision records a valid threshold `thr` with Module 1 raw ≥ thr. -/
theorem m1Hard_shown_requires_threshold {st : St} (hr : Reachable st)
    (hs : st.shape = .m1Hard) (hv : st.shown ≠ none) :
    ∃ raw ops thr, st.dec = some ⟨raw, ops, some thr⟩ ∧
      1 ≤ thr ∧ thr ≤ ops ∧ 0 ≤ raw ∧ raw ≤ ops ∧ thr ≤ raw := by
  have := (shown_gated hr hv).2
  rw [hs] at this
  exact (m1Hard_qualified_iff _).mp this

/-- Business guarantee (REQ-2): "Module 1, then Easy Module 2" needs raw < thr. -/
theorem m1Easy_shown_requires_below {st : St} (hr : Reachable st)
    (hs : st.shape = .m1Easy) (hv : st.shown ≠ none) :
    ∃ raw ops thr, st.dec = some ⟨raw, ops, some thr⟩ ∧
      1 ≤ thr ∧ thr ≤ ops ∧ 0 ≤ raw ∧ raw ≤ ops ∧ raw < thr := by
  have := (shown_gated hr hv).2
  rw [hs] at this
  exact (m1Easy_qualified_iff _).mp this

/-- No over-blocking (REQ-3): a qualifying student who is sealed sees exactly the
table cell, for every revision afterwards. -/
theorem qualified_seal_shows_cell {st : St} (s : Shape) (d : Option Decision) (cell : Option Nat)
    (hq : qualified (gate s d) = true) (hu : st.sealed = false) :
    ∃ st', Step st st' ∧ st'.shown = cell := by
  exact ⟨_, Step.sealResult st s d cell hu, by simp [convert, hq]⟩

end SatModule1Gate
