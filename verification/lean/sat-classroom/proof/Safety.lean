import Model
import Counterexamples

/-! T1–T7 for the corrected code, plus anti-vacuity witnesses. -/
namespace SatClassroom

/-- Per-attempt invariant of the corrected code. -/
structure AInv (pol : Policy) (plan : Shape) (a : Att) : Prop where
  staffOnly : pol = .staffSelects → ∀ r, a.m2Opened = some r → a.decision = some (r, .staff)
  fidelity : ∀ r b, a.decision = some (r, b) → a.m2Opened = some r
  baseOpened : plan.standalone = none → ∀ r, a.m2Opened = some r → ∃ b, a.decision = some (r, b)
  baseOpen : plan.standalone = none → a.m1Closed = false → a.decision = none ∧ a.m2Opened = none
  snapshot : ∀ l, a.snapshot = some l → l = a.writes ∧ a.m1Closed = true
  sealedGate : a.sealed = true → gate plan a
  released : a.released = true → a.scored = true ∧ a.sealed = true
  served : ∀ r, a.served = some r → a.m2Opened = some r
  standalone : plan.standalone ≠ none → a.m1Open = false ∧ a.m1Closed = false ∧ a.decision = none
  fresh : a.started = false → a.m1Open = false ∧ a.m1Closed = false ∧ a.m2Opened = none ∧ a.served = none
  planned : ∀ r b, a.decision = some (r, b) → planRouteOK plan r

theorem ainv_init (pol : Policy) (plan : Shape) : AInv pol plan {} := by
  constructor <;> simp [gate, planRouteOK]

private theorem fenceOk_plan {pol : Policy} {plan : Shape} {r : Route} {b : Basis}
    (h : fenceOk pol plan r b = true) : planRouteOK plan r := by
  cases hs : plan.standalone with
  | some branch => simp_all [fenceOk, planRouteOK, hs]
  | none =>
    cases hf : plan.forced with
    | none => simp [planRouteOK, hs, hf]
    | some fixed =>
      unfold fenceOk at h
      simp only [hs, hf, Bool.and_eq_true] at h
      have hRoute : fixed = r := of_decide_eq_true h.2
      simp [planRouteOK, hs, hf, hRoute]

private theorem correctedClose_plan {pol : Policy} {plan : Shape} {high : Bool} {r : Route}
    (hEntry : plan.standalone = none)
    (h : routeAtClose .corrected pol plan high = some r) : planRouteOK plan r := by
  by_cases hs : pol = .staffSelects
  · simp [routeAtClose, hs] at h
  · have hRoute : routeAtClose .corrected pol plan high = some (autoRoute pol plan high) := by
      simp [routeAtClose, hs]
    rw [hRoute] at h
    have hr : r = autoRoute pol plan high := Option.some.inj h.symm
    subst r
    cases hf : plan.forced <;> simp [planRouteOK, hEntry, autoRoute, hf]

theorem ainv_step {pol : Policy} {plan : Shape} (hv : valid .corrected pol plan) {a a' : Att}
    (h : AInv pol plan a) (s : AStep .corrected pol plan a a') : AInv pol plan a' := by
  obtain ⟨_, hstaff⟩ := hv
  obtain ⟨i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11⟩ := h
  -- Facts every Module 1 close needs: base section, nothing decided or served yet.
  have closeFacts : a.m1Open = true → a.m1Closed = false →
      plan.standalone = none ∧ a.decision = none ∧ a.m2Opened = none ∧ a.served = none ∧
      a.started = true ∧ a.sealed = false := by
    intro ho hc
    have hsd : plan.standalone = none := by
      cases hq : plan.standalone with
      | none => rfl
      | some b =>
        have := (i9 (by rw [hq]; exact Option.some_ne_none b)).1
        rw [ho] at this; cases this
    obtain ⟨hd, hm⟩ := i4 hsd hc
    refine ⟨hsd, hd, hm, ?_, ?_, ?_⟩
    · cases e : a.served with
      | none => rfl
      | some r => have := i8 r e; rw [hm] at this; cases this
    · cases e : a.started with
      | true => rfl
      | false => have := (i10 e).1; rw [ho] at this; cases this
    · cases e : a.sealed with
      | false => rfl
      | true => have := ((i6 e).2.2 hsd).1; rw [hc] at this; cases this
  cases s with
  | start hs =>
    obtain ⟨_, _, f3, f4⟩ := i10 hs
    refine ⟨?_, ?_, ?_, ?_, i5, ?_, i7, ?_, ?_, ?_, ?_⟩ <;> dsimp only
    · intro hp r hr; rw [hstaff hp] at hr; cases hr
    · intro r b hd; have := i2 r b hd; rw [f3] at this; cases this
    · intro hp r hr; rw [hp] at hr; cases hr
    · intro hp hc; exact ⟨(i4 hp hc).1, hp⟩
    · intro hS
      exfalso
      obtain ⟨_, g2, g3⟩ := i6 hS
      cases hq : plan.standalone with
      | none => obtain ⟨_, r, _, _, h, _⟩ := g3 hq; rw [f3] at h; cases h
      | some b => have := (g2 b hq).1; rw [f3] at this; cases this
    · intro r hr; rw [f4] at hr; cases hr
    · intro hp
      obtain ⟨_, c2, c3⟩ := i9 hp
      refine ⟨?_, c2, c3⟩
      cases hq : plan.standalone with
      | none => exact absurd hq hp
      | some _ => rfl
    · intro h; cases h
    · intro r b hd; exact i11 r b hd
  | save n ho hc ht =>
    refine ⟨i1, i2, i3, i4, ?_, i6, i7, i8, i9, i10, i11⟩
    intro l hl; have := (i5 l hl).2; rw [hc] at this; cases this
  | closeM1 high ho hc ht =>
    obtain ⟨hsd, hd, hm, hsv, hst, hsl⟩ := closeFacts ho hc
    refine ⟨?_, ?_, ?_, ?_, ?_, ?_, i7, ?_, ?_, ?_, ?_⟩ <;> dsimp only
    · intro hp r hr; rw [hp] at hr; simp [routeAtClose] at hr
    · intro r b hd'
      cases e : routeAtClose .corrected pol plan high with
      | none => rw [e] at hd'; cases hd'
      | some x => rw [e] at hd'; cases hd'; rfl
    · intro _ r hr; exact ⟨.auto, by rw [hr]; rfl⟩
    · intro _ h; cases h
    · intro l hl; cases hl; exact ⟨rfl, rfl⟩
    · intro h; rw [hsl] at h; cases h
    · intro r hr; rw [hsv] at hr; cases hr
    · intro h; exact absurd hsd h
    · intro h; rw [hst] at h; cases h
    · intro r b hd'
      cases e : routeAtClose .corrected pol plan high with
      | none => rw [e] at hd'; cases hd'
      | some x =>
        rw [e] at hd'
        have hpair : (x, Basis.auto) = (r, b) := Option.some.inj hd'
        cases hpair
        exact correctedClose_plan hsd e
  | oldClose high ho hc ht hf =>
    obtain ⟨hsd, hd, hm, hsv, hst, hsl⟩ := closeFacts ho hc
    refine ⟨?_, ?_, ?_, ?_, ?_, ?_, i7, ?_, ?_, ?_, ?_⟩ <;> dsimp only
    · intro hp; have := hf rfl; rw [hp] at this; simp [fenceOk] at this
    · intro r b hd'; cases hd'; rfl
    · intro _ r hr; cases hr; exact ⟨.auto, rfl⟩
    · intro _ h; cases h
    · intro l hl; cases hl; exact ⟨rfl, rfl⟩
    · intro h; rw [hsl] at h; cases h
    · intro r hr; rw [hsv] at hr; cases hr
    · intro h; exact absurd hsd h
    · intro h; rw [hst] at h; cases h
    · intro r b hd'
      cases hd'
      exact fenceOk_plan (hf rfl)
  | staff r =>
    unfold assign
    by_cases hpre : pol ≠ .staffSelects ∨ a.m1Closed = false
    · simp only [hpre, if_true]; exact ⟨i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11⟩
    · simp only [hpre, if_false]
      simp only [ne_eq, not_or, Classical.not_not] at hpre
      obtain ⟨hp, hc⟩ := hpre
      have hpl := hstaff hp
      subst hp hpl
      cases hd : a.decision with
      | some d =>
        obtain ⟨d, b⟩ := d
        by_cases e : d = r <;> simp [e] <;> exact ⟨i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11⟩
      | none =>
        by_cases hs : (a.sealed || a.terminated) = true
        · simp [hs]; exact ⟨i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11⟩
        · simp only [Bool.not_eq_true] at hs
          simp only [hs, Bool.false_eq_true, if_false]
          have hm : a.m2Opened = none := by
            cases e : a.m2Opened with
            | none => rfl
            | some r' => obtain ⟨b, hb⟩ := i3 rfl r' e; rw [hd] at hb; cases hb
          have hsv : a.served = none := by
            cases e : a.served with
            | none => rfl
            | some r' => have := i8 r' e; rw [hm] at this; cases this
          refine ⟨?_, ?_, ?_, ?_, i5, ?_, i7, ?_, ?_, ?_, ?_⟩ <;> dsimp only
          · intro _ r' hr; cases hr; rfl
          · intro r' b hd'; cases hd'; rfl
          · intro _ r' hr; cases hr; exact ⟨_, rfl⟩
          · intro _ h; simp [h] at hc
          · intro h; simp [h] at hs
          · intro r' hr; rw [hsv] at hr; cases hr
          · intro hn; exact absurd rfl hn
          · intro hst; have := (i10 hst).2.1; simp [this] at hc
          · intro r' b hd'; cases hd'; simp [planRouteOK, Shape.forced, Shape.standalone]
  | closeM2 ho hc ht =>
    refine ⟨i1, i2, i3, i4, i5, ?_, i7, i8, i9, i10, i11⟩
    intro hS; obtain ⟨_, g2, g3⟩ := i6 hS; exact ⟨rfl, g2, g3⟩
  | complete hg hs ht =>
    exact ⟨i1, i2, i3, i4, i5, fun _ => hg, fun hr => ⟨(i7 hr).1, rfl⟩, i8, i9, i10, i11⟩
  | terminate hs => exact ⟨i1, i2, i3, i4, i5, i6, i7, i8, i9, i10, i11⟩
  | score hs => exact ⟨i1, i2, i3, i4, i5, i6, fun _ => ⟨rfl, hs⟩, i8, i9, i10, i11⟩
  | release hs hsc => exact ⟨i1, i2, i3, i4, i5, i6, fun _ => ⟨hsc, hs⟩, i8, i9, i10, i11⟩
  | serve r hr =>
    refine ⟨i1, i2, i3, i4, i5, i6, i7, ?_, i9, ?_, i11⟩ <;> dsimp only
    · intro r' h'; cases h'; exact hr
    · intro hst; have := (i10 hst).2.2.1; rw [hr] at this; cases this

/-- Every reachable corrected world satisfies the invariant at every attempt. -/
theorem reachable_inv {w : World} (h : Reachable .corrected w) :
    valid .corrected w.pol w.plan ∧ ∀ i, AInv w.pol w.plan (w.att i) := by
  induction h with
  | init pol plan hv => exact ⟨hv, fun _ => ainv_init pol plan⟩
  | step w w' _ hs ih =>
    obtain ⟨i, a, s, rfl⟩ := hs
    refine ⟨ih.1, fun j => ?_⟩
    simp only [World.set_pol, World.set_plan, World.set_att]
    split
    · subst_vars; exact ainv_step ih.1 (ih.2 _) s
    · exact ih.2 j

/-- T1 (G1): a committed route decision never changes. (`Option` gives ≤ 1.) -/
theorem t1_decision_stable {w w' : World} (h : Reachable .corrected w) (s : Step .corrected w w')
    (i : Nat) (d : Route × Basis) (hd : (w.att i).decision = some d) :
    (w'.att i).decision = some d := by
  obtain ⟨_, inv⟩ := reachable_inv h
  obtain ⟨j, a, st, rfl⟩ := s
  simp only [World.set_att]
  split
  · rename_i e
    subst e
    have hi := inv i
    have closed : (w.att i).m1Closed = true := by
      cases hp : w.plan.standalone with
      | none =>
        cases hc : (w.att i).m1Closed
        · have := (hi.baseOpen hp hc).1; rw [hd] at this; cases this
        · rfl
      | some b =>
        have := (hi.standalone (by rw [hp]; exact Option.some_ne_none b)).2.2
        rw [hd] at this; cases this
    cases st with
    | closeM1 _ _ hc _ => rw [closed] at hc; cases hc
    | oldClose _ _ hc _ _ => rw [closed] at hc; cases hc
    | staff r =>
      unfold assign
      split
      · exact hd
      · dsimp only
        rw [hd]
        obtain ⟨d1, d2⟩ := d
        dsimp only
        split <;> exact hd
    | _ => exact hd
  · exact hd

/-- T2 (G2): under `staff_selects`, a Module 2 exists only after a staff decision. -/
theorem t2_staff_only {w : World} (h : Reachable .corrected w) : StaffOnly w :=
  fun hp i r hr => ((reachable_inv h).2 i).staffOnly hp r hr

/-- T3 (G3): the administered Module 2 is the decided branch. -/
theorem t3_route_fidelity {w : World} (h : Reachable .corrected w) (i : Nat) (r : Route) (b : Basis)
    (hd : (w.att i).decision = some (r, b)) : (w.att i).m2Opened = some r :=
  ((reachable_inv h).2 i).fidelity r b hd

/-- A committed route is also allowed by the immutable section plan. -/
theorem t3_plan_fidelity {w : World} (h : Reachable .corrected w) (i : Nat) (r : Route) (b : Basis)
    (hd : (w.att i).decision = some (r, b)) : planRouteOK w.plan r :=
  ((reachable_inv h).2 i).planned r b hd

/-- T4 (G4): the close snapshot is exactly the writes committed before the lock. -/
theorem t4_snapshot {w : World} (h : Reachable .corrected w) (i : Nat) (l : List Nat)
    (hs : (w.att i).snapshot = some l) : l = (w.att i).writes :=
  (((reachable_inv h).2 i).snapshot l hs).1

/-- T5 (G5): a completed seal implies the exact expected sequence and no awaiting. -/
theorem t5_sealed_gate {w : World} (h : Reachable .corrected w) (i : Nat)
    (hs : (w.att i).sealed = true) : gate w.plan (w.att i) :=
  ((reachable_inv h).2 i).sealedGate hs

/-- T6 (G6): a released raw score implies scored and sealed. -/
theorem t6_release {w : World} (h : Reachable .corrected w) (i : Nat)
    (hr : (w.att i).released = true) : (w.att i).scored = true ∧ (w.att i).sealed = true :=
  ((reachable_inv h).2 i).released hr

/-- T7 (G8): student-visible Module 2 content is an opened branch. -/
theorem t7_served {w : World} (h : Reachable .corrected w) (i : Nat) (r : Route)
    (hs : (w.att i).served = some r) : (w.att i).m2Opened = some r :=
  ((reachable_inv h).2 i).served r hs

/-- G7: a standalone Module 2 section never has a Module 1 or a decision. -/
theorem g7_standalone {w : World} (h : Reachable .corrected w) (i : Nat) (b : Route)
    (hp : w.plan.standalone = some b) :
    (w.att i).m1Open = false ∧ (w.att i).decision = none := by
  have := ((reachable_inv h).2 i).standalone (by simp [hp])
  exact ⟨this.1, this.2.2⟩

/-- F3 fixed: an identical staff retry after the seal replays the committed outcome. -/
theorem corrected_replay_after_seal {w : World} (i : Nat) (r : Route) (b : Basis)
    (hp : w.pol = .staffSelects) (hc : (w.att i).m1Closed = true)
    (hd : (w.att i).decision = some (r, b)) :
    (assign .corrected w.pol (w.att i) r).1 = .replayed := by
  simp [assign, hp, hc, hd]

/-! Anti-vacuity: the premises of T2 and of the replay theorem are reachable. -/

theorem awaiting_reachable :
    ∃ w, Reachable .corrected w ∧ w.pol = .staffSelects ∧
      (w.att 0).m1Closed = true ∧ (w.att 0).decision = none :=
  ⟨awaitingWorld, awaitingWorld_reachable .corrected (by simp [valid, Policy.forced]),
    rfl, by simp [awaitingWorld], by simp [awaitingWorld]⟩

theorem sealed_staff_reachable_corrected : Reachable .corrected sealedAfterStaff :=
  sealedAfterStaff_reachable .corrected (by simp [valid, Policy.forced])

end SatClassroom
