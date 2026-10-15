import SatResultStaffRead.Model

namespace SatResultStaffRead

/-- The available and unavailable API filters are a total, disjoint partition. -/
theorem scoreFiltersPartition (row : AttemptRow) :
    scoreAvailable row = !scoreUnavailable row := by
  cases row with
  | mk hasResult outcome legacy raw =>
    cases hasResult <;> cases outcome <;> cases legacy <;> cases raw <;>
      simp [scoreAvailable, scoreUnavailable, rawSummaryValid, RawSummary.valid]

/-- A failed active-policy read cannot surface a persisted estimate. -/
theorem failedPolicyClearsStoredEstimate (stored : Option ScoreRange) :
    estimateAfterRead true stored .failed = none := by
  simp [estimateAfterRead]

/-- Before the first policy publish, a valid sealed estimate remains visible. -/
theorem noActivePolicyPreservesValidStoredEstimate (stored : ScoreRange)
    (valid : stored.valid = true) :
    estimateAfterRead true (some stored) .noActiveRevision = some stored := by
  simp [estimateAfterRead, normalizeEstimate, valid]

/-- An active policy's result wins over an older stored estimate. -/
theorem activePolicyReplacesStoredEstimate (stored active : ScoreRange)
    (activeValid : active.valid = true) :
    estimateAfterRead true (some stored) (.activeRevision (some active)) = some active := by
  simp [estimateAfterRead, normalizeEstimate, activeValid]

/-- No list estimate or raw summary is exposed when the raw summary is invalid. -/
theorem invalidRawSummaryHasNoEstimate (stored : Option ScoreRange) (policy : PolicyRead) :
    estimateAfterRead false stored policy = none := by
  simp [estimateAfterRead]

/-- The parser rejects a numerically integral JSON decimal token such as 42.0. -/
theorem integralDecimalCountIsRejected :
    parseRawSummary (.integralDecimalToken 42) (.integerToken 54) = none := by
  decide

/-- A valid JSON integer-token pair is preserved as the raw summary. -/
theorem integerCountPairIsPreserved :
    parseRawSummary (.integerToken 42) (.integerToken 54) = some ⟨42, 54⟩ := by
  decide

/-- The signed 64-bit upper bound is representable by the Go response fields. -/
theorem signedInt64MaximumCountIsPreserved :
    parseRawSummary (.integerToken 9223372036854775807)
      (.integerToken 9223372036854775807) =
      some ⟨9223372036854775807, 9223372036854775807⟩ := by
  decide

/-- Counts outside the Go signed 64-bit response range fail closed. -/
theorem aboveSignedInt64CountIsRejected :
    parseRawSummary (.integerToken 9223372036854775808)
      (.integerToken 9223372036854775808) = none := by
  decide

/-- A synthesized section contains only rows carrying that section key. -/
theorem sectionRowsHaveRequestedKey (rows : List ModuleRow) (key : String)
    (row : ModuleRow) (member : row ∈ rowsForSection rows key) :
    row.sectionKey = key := by
  simp [rowsForSection] at member
  exact member.2

/-- Section aggregates are the sum over exactly the filtered module rows. -/
theorem sectionSumsMatchFilteredModules (rows : List ModuleRow) (key : String) :
    (summarizeSection key rows).rawCorrect = sumCorrect (rowsForSection rows key) ∧
    (summarizeSection key rows).operational = sumOperational (rowsForSection rows key) := by
  constructor <;> rfl

/-- Any returned module with negative, zero-total, or over-total counts
    prevents section synthesis. -/
theorem invalidModuleRowsFailClosed (rows : List ModuleRow)
    (invalid : rows.all ModuleRow.scoreValid = false) :
    synthesizeSections rows = [] := by
  simp [synthesizeSections, invalid]

/-- If any synthesized section total cannot fit the Go int64 response fields,
    the fallback returns no section summaries. -/
theorem sectionSumOverflowFailsClosed (rows : List ModuleRow)
    (notFit : sectionSumsFit rows = false) :
    synthesizeSections rows = [] := by
  simp [synthesizeSections, notFit]

/-- Synthesized sections retain the first-appearance order of distinct keys. -/
theorem synthesizedSectionOrder (rows : List ModuleRow)
    (valid : rows.all ModuleRow.scoreValid = true)
    (sumsFit : sectionSumsFit rows = true) :
    (synthesizeSections rows).map SectionSummary.sectionKey = firstSeenKeys rows := by
  simp [synthesizeSections, valid, sumsFit, List.map_map, summarizeSection, Function.comp_def]

/-- The zero-count row that used to become a displayed `0 / 0` section is
    rejected by the read model. -/
private def zeroOperationalModule : ModuleRow where
  sectionKey := "math"
  moduleKey := "m1"
  role := .base
  rawCorrect := 0
  operational := 0

theorem zeroOperationalModuleIsOmitted :
    synthesizeSections [zeroOperationalModule] = [] := by
  decide

private def negativeRawModule : ModuleRow where
  sectionKey := "math"
  moduleKey := "m1"
  role := .base
  rawCorrect := -1
  operational := 1

theorem negativeModuleRowFailsClosed :
    synthesizeSections [negativeRawModule] = [] := by
  decide

private def halfSignedInt64Max : Int := 4611686018427387904

private def overflowingSectionModules : List ModuleRow :=
  [
    { sectionKey := "math", moduleKey := "m1", role := .base,
      rawCorrect := halfSignedInt64Max, operational := halfSignedInt64Max },
    { sectionKey := "math", moduleKey := "m2", role := .base,
      rawCorrect := halfSignedInt64Max, operational := halfSignedInt64Max }
  ]

theorem aggregateOverflowFailsClosed :
    synthesizeSections overflowingSectionModules = [] := by
  decide

/-- A contradictory higher/lower branch pair has no reported single route. -/
theorem contradictoryBranchHasNoRoute :
    consistentRoute [.higher, .lower] = none := by
  decide

/-- Option IDs remain in authored order when labels are attached. -/
theorem labelsPreserveAuthoredOptionOrder (index : Nat) (ids : List String) :
    (labelOptions index ids).map Prod.fst = ids := by
  induction ids generalizing index with
  | nil => rfl
  | cons id rest inductionHypothesis =>
    simp [labelOptions, inductionHypothesis]

/-- First four SAT options receive A, B, C, D. -/
theorem satChoiceLettersAreABCD :
    [optionLetter 0, optionLetter 1, optionLetter 2, optionLetter 3] = ["A", "B", "C", "D"] := by
  decide

end SatResultStaffRead
