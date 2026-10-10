# SAT Import Workbook Proof Report

## Verdict

**Formal status: PROVED** for the listed theorems about the abstract Lean workbook model.

**Correspondence status: REVIEWED_WITH_TESTS** for generated workbook structure, parser round-trip, prompt cell type, active sheet, and tested UI hint behavior.

**Production evidence: PARTIAL. End-to-end production correctness is NOT ESTABLISHED.** The proof does not verify Go execution, Excel/LibreOffice rendering, endpoint authorization, external AI behavior, or the existing commit transaction. The source tree is dirty and no supported desktop viewer or deployed endpoint was tested.

## What the Lean kernel checked

Project: verification/lean/sat-import-template. Toolchain pin: leanprover/lean4:v4.19.0. Observed version: Lean 4.19.0, arm64-apple-darwin23.6.0, commit 6caaee842e94. Lake manifest contains no external packages.

The model defines the ordered sheet contract, headers, module counts, taxonomy, validation ranges, cell encoding abstraction, and parser-relevant row predicates. Its completed fixture is a concrete 147-row example. Its blank fixture includes the generated module/order defaults, Medium difficulty, No pretests, and empty required content.

The 23 audited theorem statements are:

- Workbook shape: contract_sheet_order, contract_metadata_is_hidden, contract_questions_headers_exact, contract_template_version_two.
- Counts and taxonomy: module_counts_exact, module_slots_total_147, questions_rows_include_header, taxonomy_has_31_skills, skill_validation_range_matches_taxonomy, validation_ranges_exact, skill_validation_uses_taxonomy_range.
- Cell encoding and P1 sheet selection: prompt_cell_encoder_always_emits_inline_text, simple_sheet_cells_are_inline_text, question_order_cell_is_numeric, active_tab_resolves_to_ai_instructions.
- Parser-model fixtures: complete_fixture_is_accepted, complete_fixture_contains_147_questions, blank_template_is_rejected.
- Negative fixtures: empty_prompt_rejects_module_fixture, duplicate_order_rejects_module_fixture, wrong_pretest_count_rejects_module_fixture, section_invalid_domain_rejects_module_fixture, student_response_is_not_allowed_in_reading_writing.

Each theorem is listed in AxiomAudit.lean with #check and #print axioms. Lean reported that none of the 23 theorem statements depends on any axioms. No sorry, admit, or custom axiom is present. The independent leanchecker binary is unavailable in this toolchain.

The model does not prove that every possible valid workbook is accepted by the Go parser. It proves the listed finite facts and one valid concrete fixture. The importer has normalization aliases, parsing, answer compilation, image, ZIP size, and failure behavior that are not represented in the Lean model. The Go integration tests additionally accept a picture at Assets column D and reject pictures at Guide and Assets column C.

## Commands and results

Run from verification/lean/sat-import-template:

    lake env lean --version
    lake build SatImportTemplate
    lake env lean AxiomAudit.lean
    lake env leanchecker --help

The first three commands succeeded. The final command exited 1 with: toolchain leanprover/lean4:v4.19.0 does not have the binary leanchecker. The output from AxiomAudit.lean prints all theorem types and the transitive axiom audit.

Run from backend/go:

    go test ./cmd/api -run 'TestSATWorkbook' -count=1
    go test ./internal/authoring -count=1

Both succeeded. Run from the repository root:

    bun run test:run -- src/features/exam-authoring/import/__tests__/SatWorkbookImportSheet.test.tsx

This succeeded with 1 test file and 9 tests passing.

## Finding and correction

The new cell-type assertion first failed on every populated Guide column-B cell and on AI Instructions B2 through B19: the shared row writer emitted them as numeric cells. Excelize still returned their textual values, so value-only assertions had missed the mismatch.

The writer now takes an explicit numeric-column argument. Questions data rows pass column 2 so Order remains numeric; generic Guide, Assets, AI Instructions, and manifest rows pass 0 and are emitted as inline text. The same type assertions passed after this correction. This fixes the concrete NFR-2 mismatch in the inspected source snapshot.

## Source snapshot

Repository HEAD: d1bf8cebb3f0f6c5325b3359963c80a6def8ec0c, branch feat/sat-bluebook-overlays-tools. The working tree has numerous unrelated modifications and untracked files. The following SHA-256 values identify the relevant local files used in the run:

| File | SHA-256 |
| --- | --- |
| backend/go/cmd/api/sat_workbook_template.go | 4c3ef0722c8fb9b3b6575c085742737fad4a9ec99286e5a0cae9f9b80c6d7141 |
| backend/go/cmd/api/sat_workbook_template_test.go | 99667bf8ee478d0207db3ec1fe3a40cccd9fadd3f30869628fe9fc882437e36b |
| backend/go/cmd/api/sat_workbook_template_formal_test.go | 71c03b688990e5efba463584a508c5a5154b7ae412708109064b6fcba528f5a0 |
| backend/go/internal/authoring/workbook.go | 5442fa983230a7764dadb027a6f2f4766dc6537f403778cdcf1daa727415ba45 |
| src/features/exam-authoring/import/SatWorkbookImportSheet.tsx | 52e706f095cfea19012c932bbd6e879f511ffaa8d243588d86fa9790a6852498 |
| src/features/exam-authoring/import/__tests__/SatWorkbookImportSheet.test.tsx | ca9fe97bbc366f7256e2a5bdf6962ff28b3f9a4b1930c5d9c22cd56686c55a06 |
| docs/sat_import.md | e1eb99edc072ae10b7654df003219dbd169bbe90f8449efbeb3839199145c531 |

These hashes were captured after the text-cell correction and focused tests. Recompute and rebuild after any later source change.

## Remaining gaps

- No mechanized refinement proof connects the Lean constants and predicates to the Go generator or parser.
- No manual Excel-compatible viewer check was done.
- No direct endpoint authorization integration test was run for this task.
- Existing commit conflict behavior was covered by the authoring package/UI regression tests but not by a new Lean lifecycle model.
- The prompt cannot enforce AI fidelity, answer correctness, or source attribution. Human review remains the required control.

The result is sufficient to claim the stated Lean model theorems and local correspondence-test outcomes. It is not a production-wide correctness proof.
