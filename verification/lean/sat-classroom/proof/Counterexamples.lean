import Model

/-! Historical pre-fix behaviors violate the guarantees; these traces are
regression witnesses, not counterexamples to the current working tree. -/
namespace SatClassroom

private theorem stepTo {mode : Mode} {w : World} (i : Nat) {a : Att}
    (h : Reachable mode w) (s : AStep mode w.pol w.plan (w.att i) a) : Reachable mode (w.set i a) :=
  .step _ _ h ⟨i, a, s, rfl⟩

/-- G2 (staff routes) as a state predicate. -/
def StaffOnly (w : World) : Prop :=
  w.pol = .staffSelects → ∀ i r, (w.att i).m2Opened = some r → (w.att i).decision = some (r, .staff)

private def w0 (pol : Policy) (plan : Shape) := World.init pol plan
private def w1 (pol : Policy) (plan : Shape) :=
  (w0 pol plan).set 0 { ((w0 pol plan).att 0) with started := true, m1Open := plan.standalone.isNone, m2Opened := plan.standalone }

private theorem reach1 (mode : Mode) (pol : Policy) (plan : Shape) (h : valid mode pol plan) :
    Reachable mode (w1 pol plan) :=
  stepTo 0 (.init _ _ h) (.start _ rfl)

/-- ¬T2 (F1): `staff_selects` on an `m1_hard` section routes with no staff action. -/
theorem current_violates_staff_only_plan_shape :
    ∃ w, Reachable .current w ∧ ¬ StaffOnly w := by
  let a := (w1 .staffSelects .m1Hard).att 0
  refine ⟨(w1 .staffSelects .m1Hard).set 0
      { a with m1Closed := true, snapshot := some a.writes,
               decision := (routeAtClose .current .staffSelects .m1Hard true).map (·, Basis.auto),
               m2Opened := routeAtClose .current .staffSelects .m1Hard true }, ?_, ?_⟩
  · exact stepTo 0 (reach1 _ _ _ (by intro r h; cases h)) (.closeM1 _ true rfl rfl rfl)
  · intro h
    have := h rfl 0 .higher (by rfl)
    simp [World.set, routeAtClose, Shape.forced] at this

/-- ¬T2 (F7): without the fence an old binary routes a staff session adaptively. -/
theorem current_violates_staff_only_old_binary :
    ∃ w, Reachable .current w ∧ ¬ StaffOnly w := by
  let a := (w1 .staffSelects .none).att 0
  refine ⟨(w1 .staffSelects .none).set 0
      { a with m1Closed := true, snapshot := some a.writes,
               decision := some (autoRoute .adaptive .none true, .auto),
               m2Opened := some (autoRoute .adaptive .none true) }, ?_, ?_⟩
  · exact stepTo 0 (reach1 _ _ _ (by intro r h; cases h)) (.oldClose _ true rfl rfl rfl (by intro h; cases h))
  · intro h
    have := h rfl 0 .higher (by rfl)
    simp [World.set] at this

/-- Before migration 0086, an older binary could ignore `m1_hard` and commit
the score-selected lower branch. -/
def legacyFixedPlanBypass : World :=
  let w := w1 .adaptive .m1Hard
  let a := w.att 0
  w.set 0 { a with m1Closed := true, snapshot := some a.writes,
                   decision := some (.lower, .auto), m2Opened := some .lower }

theorem legacyFixedPlanBypass_reachable : Reachable .current legacyFixedPlanBypass := by
  have r1 := reach1 .current .adaptive .m1Hard (by intro r h; cases h)
  have r2 := stepTo 0 r1 (.oldClose _ false rfl rfl rfl (by intro h; cases h))
  simpa [legacyFixedPlanBypass, w1, w0, adaptiveRoute, World.set] using r2

theorem current_violates_plan_route :
    Reachable .current legacyFixedPlanBypass ∧
      (legacyFixedPlanBypass.att 0).decision = some (.lower, .auto) ∧
      ¬ planRouteOK legacyFixedPlanBypass.plan .lower := by
  refine ⟨legacyFixedPlanBypass_reachable, ?_, ?_⟩
  · simp [legacyFixedPlanBypass, w1, w0, World.set]
  · simp [planRouteOK, legacyFixedPlanBypass, w1, w0, World.set, Shape.forced, Shape.standalone]

/-- The 0086 fence blocks that exact old-binary decision. -/
theorem corrected_fence_rejects_plan_bypass :
    fenceOk .adaptive .m1Hard .lower .auto = false := by
  decide

/-- `staff_selects`, Module 1 closed, no decision: the student awaits staff. -/
def awaitingWorld : World :=
  let w := w1 .staffSelects .none
  w.set 0 { (w.att 0) with m1Closed := true, snapshot := some (w.att 0).writes,
                           decision := Option.none, m2Opened := Option.none }

theorem awaitingWorld_reachable (mode : Mode) (hv : valid mode .staffSelects .none) :
    Reachable mode awaitingWorld := by
  have r2 := stepTo 0 (reach1 mode .staffSelects .none hv) (.closeM1 _ true rfl rfl rfl)
  cases mode <;> simpa [awaitingWorld, w1, w0, routeAtClose, Shape.forced, Shape.standalone] using r2

/-- The awaiting → staff → sealed trace shared by the replay theorems. -/
def sealedAfterStaff : World :=
  let w := w1 .staffSelects .none
  let a1 := { (w.att 0) with m1Closed := true, snapshot := some (w.att 0).writes,
                             decision := Option.none, m2Opened := Option.none }
  let a2 := { a1 with decision := some (Route.higher, Basis.staff), m2Opened := some .higher }
  let a3 := { a2 with m2Closed := true }
  (((w.set 0 a1).set 0 a2).set 0 a3).set 0 { a3 with sealed := true }

theorem sealedAfterStaff_reachable (mode : Mode) (hv : valid mode .staffSelects .none) :
    Reachable mode sealedAfterStaff := by
  have r1 := reach1 mode .staffSelects .none hv
  have r2 := stepTo 0 r1 (.closeM1 _ true rfl rfl rfl)
  have r3 := stepTo 0 r2 (.staff _ .higher)
  cases mode <;>
  · have r4 := stepTo 0 r3 (.closeM2 _ (by simp [w1, w0, routeAtClose, assign, Shape.forced, Shape.standalone]) rfl
      (by simp [w1, w0, routeAtClose, assign, Shape.forced, Shape.standalone]))
    have r5 := stepTo 0 r4 (.complete _ (by simp [gate, Shape.standalone, w1, w0, routeAtClose, assign, Shape.forced, Shape.standalone])
      (by simp [w1, w0, routeAtClose, assign, Shape.forced, Shape.standalone]) (by simp [w1, w0, routeAtClose, assign, Shape.forced, Shape.standalone]))
    simpa [sealedAfterStaff, w1, w0, routeAtClose, assign, Shape.forced, Shape.standalone] using r5

/-- ¬(replay after seal) (F3): the identical retry gets `ATTEMPT_SEALED`. -/
theorem current_replay_after_seal_refused :
    Reachable .current sealedAfterStaff ∧
    (sealedAfterStaff.att 0).decision = some (.higher, .staff) ∧
    (sealedAfterStaff.att 0).sealed = true ∧
    (assign .current .staffSelects (sealedAfterStaff.att 0) .higher).1 = .sealedRefused := by
  refine ⟨sealedAfterStaff_reachable .current (by intro r h; cases h), ?_, ?_, ?_⟩ <;>
    simp [sealedAfterStaff, World.set, assign]

end SatClassroom
