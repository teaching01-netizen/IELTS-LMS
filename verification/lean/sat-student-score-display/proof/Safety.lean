import proof.Model

/-! Theorems about the exact definitions in `proof/Model.lean`. -/

namespace SATStudentScoreDisplay

theorem adaptive_route_uses_inclusive_threshold (threshold rawCorrect operationalCount : Nat)
    (hpositive : 0 < operationalCount) (hthresholdLow : 1 ≤ threshold)
    (hthresholdHigh : threshold ≤ operationalCount) (hraw : rawCorrect ≤ operationalCount) :
    chooseRoute (.adaptive threshold) rawCorrect operationalCount =
      some (if threshold ≤ rawCorrect then .higher else .lower) := by
  simp [chooseRoute, hpositive, hthresholdLow, hthresholdHigh, hraw]

theorem forced_higher_route_ignores_threshold_and_raw_score (rawCorrect operationalCount : Nat)
    (hraw : rawCorrect ≤ operationalCount) :
    chooseRoute .forceHigher rawCorrect operationalCount = some .higher := by
  simp [chooseRoute, hraw]

theorem adaptive_example_below_threshold_routes_lower :
    chooseRoute (.adaptive 13) 12 25 = some .lower := by decide

theorem adaptive_example_at_threshold_routes_higher :
    chooseRoute (.adaptive 13) 13 25 = some .higher := by decide

theorem adaptive_example_above_threshold_routes_higher :
    chooseRoute (.adaptive 13) 14 25 = some .higher := by decide

theorem unavailable_section_with_converter_is_dash (sec : InputSection)
    (hstatus : sec.conversionStatus = .unavailable) :
    sectionScore true sec = .dash := by
  simp [sectionScore, hstatus]

theorem unavailable_section_without_converter_is_raw (sec : InputSection)
    (hstatus : sec.conversionStatus = .unavailable) :
    sectionScore false sec = .raw sec.details.overall.correct sec.details.overall.total := by
  simp [sectionScore, hstatus]

theorem valid_section_estimate_survives (sec : InputSection) (score : Interval)
    (hstatus : sec.conversionStatus = .converted)
    (hscaled : sec.scaled = some score) (hvalid : validSectionInterval score) :
    sectionScore true sec = .estimated score.low score.high := by
  simp [sectionScore, hstatus, hscaled, hvalid]

theorem malformed_converted_interval_is_dash (sec : InputSection) (score : Interval)
    (hstatus : sec.conversionStatus = .converted) (hscaled : sec.scaled = some score)
    (hinvalid : ¬ validSectionInterval score) : sectionScore true sec = .dash := by
  simp [sectionScore, hstatus, hscaled, hinvalid]

theorem five_point_section_score_is_invalid : ¬ validSectionInterval ⟨605, 605⟩ := by
  intro h
  have hm : (605 : Int) % 10 = 0 := h.2.2.2.1
  omega

theorem section_view_preserves_details (converterPresent : Bool) (sec : InputSection) :
    (sectionView converterPresent sec).details = sec.details := rfl

theorem section_scores_preserve_details (converterPresent : Bool) (sections : List InputSection) :
    (sections.map (sectionView converterPresent)).map SectionView.details =
      sections.map InputSection.details := by
  simp [sectionView]

theorem rendered_dash_is_hyphen : renderedUnavailableScore .dash = "-" := rfl

theorem malformed_section_shape_is_unavailable (report : InputReport)
    (hinvalid : ¬ validSectionList report.sections) :
    buildReport report = .unavailable := by
  simp [buildReport, hinvalid]

theorem full_report_keeps_valid_section_estimates_when_total_is_missing
    (rw math : InputSection) (rwScore mathScore : Interval)
    (hrwSubject : rw.subject = .readingWriting) (hmathSubject : math.subject = .math)
    (hrwStatus : rw.conversionStatus = .converted) (hmathStatus : math.conversionStatus = .converted)
    (hrwScaled : rw.scaled = some rwScore) (hmathScaled : math.scaled = some mathScore)
    (hrwValid : validSectionInterval rwScore) (hmathValid : validSectionInterval mathScore)
    (hrwRaw : validSectionInput rw) (hmathRaw : validSectionInput math) :
    ∃ subjects primary showCombined,
      buildReport { converterPresent := true, sections := [rw, math], totalScaled := none } =
          .available subjects primary showCombined ∧
        subjects.map SectionView.score =
          [.estimated rwScore.low rwScore.high, .estimated mathScore.low mathScore.high] ∧
        primary = some .dash ∧ showCombined = false := by
  simp [buildReport, validSectionList, hrwSubject, hmathSubject, hrwRaw, hmathRaw,
    orderSections, sectionView, sectionScore, hrwStatus, hmathStatus, hrwScaled, hmathScaled,
    hrwValid, hmathValid, combinedPrimary, estimated, primaryIsEstimate]

theorem full_report_shows_available_total_and_section_estimates
    (rw math : InputSection) (rwScore mathScore totalScore : Interval)
    (hrwSubject : rw.subject = .readingWriting) (hmathSubject : math.subject = .math)
    (hrwStatus : rw.conversionStatus = .converted) (hmathStatus : math.conversionStatus = .converted)
    (hrwScaled : rw.scaled = some rwScore) (hmathScaled : math.scaled = some mathScore)
    (hrwValid : validSectionInterval rwScore) (hmathValid : validSectionInterval mathScore)
    (htotalValid : validTotalInterval totalScore)
    (hrwRaw : validSectionInput rw) (hmathRaw : validSectionInput math) :
    ∃ subjects,
      buildReport { converterPresent := true, sections := [rw, math], totalScaled := some totalScore } =
          .available subjects (some (.estimated totalScore.low totalScore.high)) true ∧
        subjects.map SectionView.score =
          [.estimated rwScore.low rwScore.high, .estimated mathScore.low mathScore.high] := by
  simp [buildReport, validSectionList, hrwSubject, hmathSubject, hrwRaw, hmathRaw,
    orderSections, sectionView, sectionScore, hrwStatus, hmathStatus, hrwScaled, hmathScaled,
    hrwValid, hmathValid, combinedPrimary, estimated, primaryIsEstimate, htotalValid]

theorem full_report_shows_dash_for_missing_section_and_total
    (rw math : InputSection) (mathScore : Interval)
    (hrwSubject : rw.subject = .readingWriting) (hmathSubject : math.subject = .math)
    (hrwStatus : rw.conversionStatus = .unavailable) (hmathStatus : math.conversionStatus = .converted)
    (hmathScaled : math.scaled = some mathScore) (hmathValid : validSectionInterval mathScore)
    (hrwRaw : validSectionInput rw) (hmathRaw : validSectionInput math) :
    ∃ subjects,
      buildReport { converterPresent := true, sections := [rw, math], totalScaled := none } =
          .available subjects (some .dash) false ∧
        subjects.map SectionView.score = [.dash, .estimated mathScore.low mathScore.high] ∧
        subjects.map SectionView.details = [rw.details, math.details] := by
  simp [buildReport, validSectionList, hrwSubject, hmathSubject, hrwRaw, hmathRaw,
    orderSections, sectionView, sectionScore, hrwStatus, hmathStatus, hmathScaled, hmathValid,
    combinedPrimary, estimated, primaryIsEstimate]

theorem no_converter_full_report_keeps_raw_total (rw math : InputSection)
    (hrwSubject : rw.subject = .readingWriting) (hmathSubject : math.subject = .math)
    (hrwStatus : rw.conversionStatus = .unavailable)
    (hmathStatus : math.conversionStatus = .unavailable)
    (hrwRaw : validSectionInput rw) (hmathRaw : validSectionInput math) :
    ∃ subjects primary showCombined,
      buildReport { converterPresent := false, sections := [rw, math], totalScaled := none } =
          .available subjects primary showCombined ∧
        primary = some (.raw
          (rw.details.overall.correct + math.details.overall.correct)
          (rw.details.overall.total + math.details.overall.total)) ∧
        showCombined = false := by
  simp [buildReport, validSectionList, hrwSubject, hmathSubject, hrwRaw, hmathRaw,
    orderSections, sectionView, sectionScore, hrwStatus, hmathStatus, combinedPrimary,
    sumCounts, estimated, primaryIsEstimate]

end SATStudentScoreDisplay
