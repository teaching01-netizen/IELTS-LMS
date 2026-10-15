import SatResultStaffRead.Safety

namespace SatResultStaffRead

/-- The old SQL predicate treated any present classroomRaw path as available. -/
def naivePresenceAvailable (resultExists : Bool) (outcome : Outcome)
    (hasLegacyScore classroomRawPathIsNonNull : Bool) : Bool :=
  resultExists && outcome == .scored && (hasLegacyScore || classroomRawPathIsNonNull)

/-- JSON `classroomRaw: null` is path-present but is not a renderable raw score. -/
theorem nullRawWasFalsePositive :
    naivePresenceAvailable true .scored false true = true ∧
    scoreAvailable ⟨true, .scored, false, none⟩ = false := by
  decide

/-- Default Go JSON decoding turned 42.0 into an integral float and accepted
    it; preserving the JSON token kind rejects it in the corrected reader. -/
def naiveParseRawSummary (correct total : JSONCount) : Option RawSummary :=
  let coerce : JSONCount → JSONCount
    | .integralDecimalToken value => .integerToken value
    | other => other
  parseRawSummary (coerce correct) (coerce total)

theorem integralDecimalCounterexample :
    naiveParseRawSummary (.integralDecimalToken 42) (.integerToken 54) = some ⟨42, 54⟩ ∧
    parseRawSummary (.integralDecimalToken 42) (.integerToken 54) = none := by
  decide

/-- Counterexample to leaving the stored range untouched after active-policy
    lookup failure; the corrected contract clears it. -/
theorem staleEstimateCounterexample :
    normalizeEstimate (some ⟨1300, 1320⟩) = some ⟨1300, 1320⟩ ∧
    estimateAfterRead true (some ⟨1300, 1320⟩) .failed = none := by
  decide

/-- The previous loop's last-write route choice silently chose one side of a
    contradictory branch pair. -/
def naiveLastBranch (routes : List BranchRoute) : Option BranchRoute :=
  routes.foldl (fun _ route => some route) none

theorem conflictingBranchCounterexample :
    naiveLastBranch [.higher, .lower] = some .lower ∧
    consistentRoute [.higher, .lower] = none := by
  decide

end SatResultStaffRead
