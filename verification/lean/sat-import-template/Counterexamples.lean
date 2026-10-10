import WorkbookModel

namespace SATImportTemplate

def readingWritingModuleOne : ModuleSpec :=
  ⟨"rw-m1", "Reading & Writing · Module 1", .readingWriting, 27⟩

def withMissingPrompt (rows : List Question) : List Question :=
  rows.map fun q => if q.order == 1 then { q with prompt := "" } else q

def withDuplicateOrder (rows : List Question) : List Question :=
  rows.map fun q => if q.order == 2 then { q with order := 1 } else q

def withOnePretestMissing (rows : List Question) : List Question :=
  rows.map fun q => if q.order == 1 then { q with isPretest := false } else q

def withWrongSectionDomain (rows : List Question) : List Question :=
  rows.map fun q => if q.order == 1 then { q with domain := "Algebra" } else q

def withUnsupportedReadingWritingResponse (rows : List Question) : List Question :=
  rows.map fun q =>
    if q.order == 1 then { q with responseType := .studentResponse } else q

theorem empty_prompt_rejects_module_fixture :
    moduleAccepted readingWritingModuleOne
      (withMissingPrompt (completedRows readingWritingModuleOne)) = false := by
  decide

theorem duplicate_order_rejects_module_fixture :
    moduleAccepted readingWritingModuleOne
      (withDuplicateOrder (completedRows readingWritingModuleOne)) = false := by
  decide

theorem wrong_pretest_count_rejects_module_fixture :
    moduleAccepted readingWritingModuleOne
      (withOnePretestMissing (completedRows readingWritingModuleOne)) = false := by
  decide

theorem section_invalid_domain_rejects_module_fixture :
    moduleAccepted readingWritingModuleOne
      (withWrongSectionDomain (completedRows readingWritingModuleOne)) = false := by
  decide

theorem student_response_is_not_allowed_in_reading_writing :
    moduleAccepted readingWritingModuleOne
      (withUnsupportedReadingWritingResponse (completedRows readingWritingModuleOne)) = false := by
  decide

end SATImportTemplate
