import WorkbookModel

namespace SATImportTemplate

theorem contract_sheet_order :
    sheetOrder = [.questions, .guide, .assets, .aiInstructions, .metadata] := by
  decide

theorem contract_metadata_is_hidden :
    hiddenSheets = [.metadata] := by
  decide

theorem contract_questions_headers_exact :
    headers =
      [ "Module", "Order", "Prompt", "Stimulus", "Response Type", "A", "B", "C", "D"
      , "Correct", "Accepted Responses", "Domain", "Skill", "Difficulty", "Pretest"
      , "Rationale", "Tags"
      ] := by
  decide

theorem contract_template_version_two : templateVersion = 2 := by
  decide

theorem module_counts_exact :
    moduleCounts = [27, 27, 27, 22, 22, 22] := by
  decide

theorem module_slots_total_147 : questionSlotCount = 147 := by
  decide

theorem questions_rows_include_header : questionRowCountIncludingHeader = 148 := by
  decide

theorem taxonomy_has_31_skills : taxonomySkillCount = 31 := by
  decide

theorem skill_validation_range_matches_taxonomy :
    taxonomyRangeFormula = "_SAT!$D$1:$D$31" ∧ taxonomySkillCount = 31 := by
  decide

theorem validation_ranges_exact :
    validations.map ValidationSpec.sqref =
      ["A2:A148", "E2:E148", "J2:J148", "L2:L148", "M2:M148", "N2:N148", "O2:O148"] := by
  decide

theorem skill_validation_uses_taxonomy_range :
    validations.any (fun v => v.sqref == "M2:M148" && v.source == .taxonomyRange) = true := by
  decide

theorem prompt_cell_encoder_always_emits_inline_text (value : String) :
    (encodeTextCell value).kind = .inlineText := by
  rfl

theorem simple_sheet_cells_are_inline_text (column row : Nat) :
    encodeRowCell column row 0 = .inlineText := by
  rfl

theorem question_order_cell_is_numeric :
    encodeRowCell 2 2 2 = .number := by
  decide

theorem active_tab_resolves_to_ai_instructions :
    activeSheetIndex = 3 ∧ activeSheet = some .aiInstructions := by
  decide

theorem complete_fixture_is_accepted : completedFixtureAccepted = true := by
  decide

theorem complete_fixture_contains_147_questions : completedQuestionCount = 147 := by
  decide

theorem blank_template_is_rejected : blankFixtureAccepted = false := by
  decide

end SATImportTemplate
