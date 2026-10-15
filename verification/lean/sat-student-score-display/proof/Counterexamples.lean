import proof.Safety

/-! Concrete witnesses for the unavailable-conversion behavior and its old failure mode. -/

namespace SATStudentScoreDisplay

def mathWithoutConversion : InputSection :=
  { subject := .math
    conversionStatus := .unavailable
    scaled := none
    details :=
      { overall := { correct := 34, total := 44 }
        modules := [{ key := 1, counts := { correct := 20, total := 22 } }]
        domains := [{ key := 1, counts := { correct := 8, total := 10 } }] } }

def oneSubjectReport (converterPresent : Bool) : InputReport :=
  { converterPresent := converterPresent
    sections := [mathWithoutConversion]
    totalScaled := some ⟨1200, 1200⟩ }

theorem witness_converter_miss_renders_dash :
    buildReport (oneSubjectReport true) =
      .available
        [{ subject := .math, score := .dash, details := mathWithoutConversion.details }]
        (some .dash) false := by
  simp [buildReport, oneSubjectReport, mathWithoutConversion, validSectionList,
    validSectionInput, orderSections, sectionView, sectionScore]

theorem witness_no_converter_retains_raw_score_and_details :
    buildReport (oneSubjectReport false) =
      .available
        [{ subject := .math
           score := .raw 34 44
           details := mathWithoutConversion.details }]
        (some (.raw 34 44)) false := by
  simp [buildReport, oneSubjectReport, mathWithoutConversion, validSectionList,
    validSectionInput, orderSections, sectionView, sectionScore]

theorem witness_old_raw_fallback_would_show_raw_count_instead_of_dash :
    renderedUnavailableScore (.raw 34 44) = "34 of 44 correct" ∧
      renderedUnavailableScore .dash = "-" := by
  constructor <;> rfl

end SATStudentScoreDisplay
