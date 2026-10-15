import Model

namespace SatModule1Gate

/-- The gate as first shipped (pre-fix): it read only existing decision rows
(no row → no flag) and checked only `thr ≥ 1`. -/
def oldGate (s : Shape) (d : Option Decision) : Option Bool :=
  match s.forced, d with
  | some b, some ⟨raw, _, some thr⟩ => some (decide (1 ≤ thr) && decide (thr ≤ raw ↔ b = .higher))
  | some _, some ⟨_, _, none⟩ => some false
  | _, _ => none

/-- F1: a forced section with no route decision row converts under the old gate. -/
theorem F1_missing_decision_converts :
    convert (oldGate .m1Hard none) (some 500) = some 500 := by decide

/-- …and is blocked after the fix. -/
theorem F1_fixed : convert (gate .m1Hard none) (some 500) = none := by decide

/-- F2: m1_easy with threshold above the operational count (30 > 22): routing
rejects this policy, but the old gate qualified every student. -/
theorem F2_threshold_above_ops_converts :
    convert (oldGate .m1Easy (some ⟨22, 22, some 30⟩)) (some 500) = some 500 := by decide

theorem F2_fixed : convert (gate .m1Easy (some ⟨22, 22, some 30⟩)) (some 500) = none := by decide

/-- F2b: a corrupt raw (above ops) qualified m1_hard under the old gate. -/
theorem F2b_raw_above_ops_converts :
    convert (oldGate .m1Hard (some ⟨50, 22, some 10⟩)) (some 500) = some 500 := by decide

theorem F2b_fixed : convert (gate .m1Hard (some ⟨50, 22, some 10⟩)) (some 500) = none := by decide

/-- Anti-vacuity: a converted m1_hard score IS reachable (the invariant is not
proved over an empty or score-free reachable set). -/
theorem m1Hard_score_reachable :
    ∃ st, Reachable st ∧ st.shape = .m1Hard ∧ st.shown = some 500 := by
  let s0 : St := { sealed := false, shape := .full, dec := none, flag := some false, shown := none }
  refine ⟨_, Reachable.step s0 _ (Reachable.init s0 ⟨rfl, rfl⟩)
    (Step.sealResult s0 .m1Hard (some ⟨15, 22, some 10⟩) (some 500) rfl), rfl, ?_⟩
  decide

/-- Boundary witnesses for the exact threshold (≥ for hard, < for easy). -/
example : gate .m1Hard (some ⟨10, 22, some 10⟩) = some true := by decide
example : gate .m1Hard (some ⟨9, 22, some 10⟩) = some false := by decide
example : gate .m1Easy (some ⟨9, 22, some 10⟩) = some true := by decide
example : gate .m1Easy (some ⟨10, 22, some 10⟩) = some false := by decide
example : gate .m1Hard (some ⟨10, 22, none⟩) = some false := by decide

end SatModule1Gate
