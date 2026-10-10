# Implementation plan: AI-ready SAT workbook template

## 0. Context and current behavior

- **Goal:** Make the workbook from **Download SAT Excel template** a useful authoring specification for staff and external AI tools that transcribe supplied exam materials.
- **Current → desired:** The application already generates and imports the SAT workbook contract. Its Guide has six short rows and AI Instructions has three short rows. Expand those existing sheets with the complete workflow, field definitions, taxonomy, math and image rules, and a copyable prompt; keep the existing importer and draft-replacement behavior.
- **Repository evidence:**

| Behavior | Evidence | Status |
| --- | --- | --- |
| The Go template generator emits Questions, Guide, Assets, AI Instructions, and hidden _SAT; Questions has 17 headers and 147 prefilled rows. | [sat_workbook_template.go](../backend/go/cmd/api/sat_workbook_template.go), especially satWorkbookQuestionsSheet, satWorkbookGuideSheet, satWorkbookInstructionsSheet, and satWorkbookManifestSheet | Verified |
| The existing template test opens the generated XLSX and parses it; it checks the sheet names, 147 rows, version 2, and that the blank template is invalid. | [sat_workbook_template_test.go](../backend/go/cmd/api/sat_workbook_template_test.go) | Verified |
| The parser validates required columns, module and order values, question content, taxonomy, response types, exactly two pretests per module, formulas, and embedded-image location and limits. | [workbook.go](../backend/go/internal/authoring/workbook.go), ParseSATWorkbook, scanSATWorkbookPictures, parseSATWorkbookAssets | Verified |
| The template download is an authenticated SAT exam endpoint returning an XLSX attachment. | [handlers_authoring.go](../backend/go/cmd/api/handlers_authoring.go), authorSatWorkbookTemplateHandler; route in [main.go](../backend/go/cmd/api/main.go) | Verified |
| The import sheet already downloads that endpoint, previews workbook content, stages images, and requires confirmation before replacing a draft. | [SatWorkbookImportSheet.tsx](../src/features/exam-authoring/import/SatWorkbookImportSheet.tsx) | Verified |
| A local v2 workbook prototype contains the expanded Guide and a 7,109-character prompt in AI Instructions!B4. It is a content reference, not the application download. Its _SAT sheet is visible and Questions is initially active, unlike the production generator’s hidden _SAT sheet. | [SAT_AI_Ready_Authoring_Template_v2.xlsx](SAT_AI_Ready_Authoring_Template_v2.xlsx) | Verified |

- **Scope:** Update the canonical Go workbook generator and its contract tests. Optionally make AI Instructions the initially active sheet and add a short hint beside the existing download button.
- **Non-goals:** No AI service integration, importer/parser rewrite, new workbook format, database or migration changes, question-count changes, or production deployment as part of this planning task.
- **Evidence labels:** Verified means the named local source was inspected; proposed changes below are recommendations, not existing behavior.

## 1. Requirements

### Functional

| ID | Priority | Behavior | Acceptance criterion |
| --- | --- | --- | --- |
| FR-1 | P0 | Staff downloads the expanded authoring guide and AI instructions from the existing button. | The generated file has all five existing sheets, the 17-column Questions schema, and complete guidance on Guide and AI Instructions. |
| FR-2 | P0 | The workbook explains how to map source exam material into the import fields and six modules. | It documents every column, all six module labels and counts, section-specific taxonomy, MCQ/Student Response rules, pretests, supported rich text, and image handling. |
| FR-3 | P0 | The copyable prompt prioritizes faithful transcription and identifies missing information. | It directs the external AI not to fabricate questions, answers, module placement, taxonomy, difficulty, pretest status, or figures; unresolved required data must be reported as blockers, and personal/student information must not be copied into tags. |
| FR-4 | P0 | The expanded workbook remains accepted by the current import preview when completed correctly. | A completed workbook satisfying existing parser rules previews as valid; the generated blank template remains invalid and cannot be imported. |
| FR-5 | P1 | Staff can find the instructions immediately. | Open the workbook on AI Instructions without changing sheet order; the import UI may also state that the downloaded template contains a copyable AI prompt and guide. |

### Relevant non-functional requirements

| ID | Constraint | Target | Validation |
| --- | --- | --- | --- |
| NFR-1 | Import compatibility | No change to sheet names, question headers/order, module labels/counts, parser semantics, or templateVersion 2. | Generator round-trip and contract assertions against the existing parser. |
| NFR-2 | Workbook safety | Keep instruction content as ordinary cell text; add no worksheet formula cells or decorative embedded pictures. | Inspect generated workbook structure and retain the importer’s Questions-formula and picture-placement checks. |
| NFR-3 | Authoring clarity | Clearly distinguish prefilled placeholders from verified source facts and label incomplete content NOT IMPORT READY. | Content assertions plus staff review of the generated workbook. |
| NFR-4 | Existing access and replacement safeguards | Preserve authenticated download, preview, explicit replacement confirmation, and revision-conflict behavior. | Endpoint/flow regression checks; no new authorization or persistence path. |

## 2. Core entities and invariants

- **Template workbook:** Generated by buildSATWorkbookTemplate; templateVersion remains 2 because this change does not alter the import schema.
- **Questions:** The source data contract consumed by ParseSATWorkbook: 17 columns and 147 slots across six modules (27 questions in each of three Reading & Writing modules; 22 in each of three Math modules).
- **Assets:** Optional image metadata and embedded media. A referenced image must be embedded in Assets column D on the same row as its metadata; decorative images elsewhere are rejected by the importer.
- **AI instructions:** Guidance for an external tool, not an application-enforced policy or a system message. Staff still owns source verification and import confirmation.

Invariants:

- **INV-1:** Keep the five worksheet names and Questions headers exactly as generated today; keep _SAT hidden in the application workbook.
- **INV-2:** Preserve the six module labels, 147 preassigned rows, list validations, and _SAT taxonomy range used by the Domain/Skill dropdowns.
- **INV-3:** The blank template must not pass import validation. A complete import still requires exactly two Yes pretests in each module and all existing required values.
- **INV-4:** Do not embed images in Guide or AI Instructions. The only accepted picture location is Assets column D.
- **INV-5:** Prompt and guide copy must describe parser behavior accurately; application preview remains authoritative for structural validity.

## 3. API and interface changes

- **Existing interface:** GET /api/v1/assessment-authoring/exams/{examID}/sat-workbook-template, registered in main.go and implemented by authorSatWorkbookTemplateHandler.
- **Proposed change:** None to the URL, response type, headers, authorization, or request shape. The handler continues to call buildSATWorkbookTemplate.
- **Existing client:** SatWorkbookImportSheet continues to call getSatWorkbookTemplate and download SAT-Authoring-Template.xlsx.
- **Optional P1 UI copy:** Add a short hint next to the button only; do not introduce a new action, state, or API call.
- **Compatibility:** Keep preview, commit, undo, expected draft revision, and idempotent retry contracts unchanged.

## 4. Critical data flow

1. Authorized staff opens the SAT workbook import sheet and downloads the generated XLSX.
2. Staff supplies the workbook and source material to an external AI tool and asks it to follow the prompt and guide.
3. The AI returns a completed workbook and a QA/blocker summary. This step is outside the application and cannot be guaranteed by the app.
4. Staff uploads the result. The existing preview parses Questions and Assets, validates fields and images, and renders issues and question previews.
5. Staff checks the preview against source material, secures any staged images, and confirms replacement.
6. The existing commit path checks the draft version/revision and replaces all six draft modules; concurrent edits remain conflicts, not silent overwrites.

The feature changes workbook guidance only. It does not alter preview acceptance, persistence, or the commit transaction.

## 5. Recommended design

Expand the existing generator in [sat_workbook_template.go](../backend/go/cmd/api/sat_workbook_template.go); do not serve the prototype XLSX as a second source of truth.

- Expand satWorkbookGuideSheet into a readable cell-based reference covering the workflow, all 17 fields, six module mappings/counts, taxonomy pairs, supported markup/math, image rules, parser limits, placeholder defaults, and a source-review checklist.
- Expand satWorkbookInstructionsSheet with a copyable prompt in B4 and a ready-to-copy user request below it. The prompt should require faithful transcription, source/page traceability, independent answer-key checks, uncertainty reporting, and an explicit NOT IMPORT READY status for blockers.
- Preserve the Questions sheet, prefilled defaults, validation lists, Assets layout, hidden _SAT metadata, and current workbook version.
- Keep B4 comfortably within the workbook format’s cell-text limit. XML escaping must preserve ampersands, angle brackets, quotes, apostrophes, Unicode, backslashes, and line breaks when reopened by Excelize.
- Do not add pictures, worksheet formula cells, a new library, or a static-file serving path. Use ordinary text cells and preserve the existing data-validation list formulas.
- P1: Set the workbook activeTab to AI Instructions while retaining the existing sheet order and hidden _SAT state. Add the optional concise UI hint only if it remains a copy-only change.

The local prototype is a useful copy source for the expanded text, but reconcile it with the production contract before porting: keep _SAT hidden, keep sheet order unchanged, and retain version 2. Fix any copy that implies AI output alone proves transcription accuracy.

## 6. Production and failure-mode deep dives

| Risk | Consequence | Protection / location | Verification | Residual risk |
| --- | --- | --- | --- | --- |
| Template drifts from importer | Staff produces a workbook that cannot preview or maps values incorrectly. | Preserve the generator schema and assert the generated workbook through Excelize and ParseSATWorkbook. | Contract tests for sheets, headers, rows, module labels, version, and completed round-trip. | The parser and template still have duplicated module/taxonomy definitions; tests must catch future drift. |
| External AI fabricates missing facts | Incorrect question content or answer key reaches review. | Prompt and Guide require source fidelity, blocker reporting, no personal/student information in tags, and human comparison. Parser blocks structural omissions. | Content assertions and a manual source-to-preview review; do not claim an external AI behavior test proves compliance. | Prompt text cannot enforce external model behavior or transcription accuracy. |
| Image token has no matching Assets key | A missing or wrong figure may survive structural preview. | Prompt and Guide require matching each image token to an embedded Assets row; human reviewer checks each reference. The current parser checks embedded image placement and metadata but does not enforce token-to-key referential integrity. | Manual source-to-preview image audit. Add a parser change only if automatic referential-integrity enforcement is separately required. | Structural preview alone does not guarantee every image token resolves. |
| Decorative pictures are added to guidance | Importer reports image-placement issues or rejects the workbook. | Use text-only Guide and AI Instructions; keep user figures confined to Assets. | Assert generated workbook has no embedded pictures outside Assets and manually open it. | A later editor can add unsupported workbook content. |
| Placeholder defaults are mistaken for source facts | Invalid pretest assignment or unsupported difficulty can be imported if completed inconsistently. | Explicitly mark Medium/No defaults as placeholders and prohibit inference; existing preview remains the gate. | Verify copy and test invalid/complete parser outcomes. | Staff may still override guidance; reviewer remains responsible. |
| Concurrent draft edit during import | A stale workbook could overwrite newer authoring changes. | Existing preview/commit version checks and explicit replace flow remain unchanged. | Preserve existing conflict/regression coverage. | No change to the existing lifecycle risk. |

## 7. Ordered implementation phases

| Phase | Files / components | Specific change | Requirement / invariant | Done when |
| --- | --- | --- | --- | --- |
| 1. Template content | [sat_workbook_template.go](../backend/go/cmd/api/sat_workbook_template.go) | Expand Guide and AI Instructions using the current importer contract; preserve Questions, Assets, validations, hidden _SAT, and version 2. | FR-1–FR-3, NFR-1–NFR-3, INV-1–INV-5 | Generated XLSX has the intended complete copy and unchanged import schema. |
| 2. Discoverability (P1) | sat_workbook_template.go; [SatWorkbookImportSheet.tsx](../src/features/exam-authoring/import/SatWorkbookImportSheet.tsx) | Set AI Instructions as the active tab without reordering sheets; add a short download hint if retained. | FR-5 | Instructions open first and the existing download action still works. |
| 3. Contract verification | [sat_workbook_template_test.go](../backend/go/cmd/api/sat_workbook_template_test.go); optionally the import-sheet test | Extend generator assertions and add UI-copy assertion only if phase 2 includes UI copy. | FR-1–FR-5, INV-1–INV-5 | Planned test matrix passes; no importer or API contract change is needed. |
| 4. Release | Existing application deployment | Deploy as a normal application change. No database migration, backfill, feature flag, or data cleanup. | NFR-1, NFR-4 | Downloaded workbook is the expanded version and existing preview/commit safeguards remain operational. |

## 8. Test matrix

These are planned checks, not tests run during plan preparation.

| Case | Setup / action | Expected outcome | Test level | Coverage |
| --- | --- | --- | --- | --- |
| TC-1 | Generate and open the template with Excelize. | Five expected sheets exist; _SAT is hidden; AI Instructions is active if P1 is implemented. | Unit | FR-1, FR-5, INV-1 |
| TC-2 | Inspect Questions rows, headers, module labels, validations, and _SAT taxonomy cells. | Exact 17 headers, 147 rows, six existing labels/counts, and current validation ranges remain unchanged; templateVersion is 2. | Unit | FR-2, NFR-1, INV-1–INV-2 |
| TC-3 | Inspect Guide and AI Instructions text. | All columns, modules, taxonomy, response rules, LaTeX/image instructions, placeholder warning, QA steps, no-fabrication rule, privacy reminder, and blocker language are present. Prompt is in B4 and has no formula. | Unit | FR-1–FR-3, NFR-2–NFR-3 |
| TC-4 | Parse the generated blank template. | Parser returns 147 input rows and an invalid preview; blank slots cannot be imported. | Unit / parser integration | FR-4, INV-3 |
| TC-5 | Fill a generated workbook with valid data for all six modules, correct response shapes, taxonomy, and two pretests per module; parse it. | Preview is valid and retains the expected 147-question, six-module shape. | Unit / parser integration | FR-4, INV-2–INV-3 |
| TC-6 | Add a formula to a Questions cell or a picture outside Assets, then preview the fixture. | Existing parser reports a blocking issue; generated guidance sheets themselves contain no pictures. Separately, a manual image audit confirms every image token has a matching Assets row because the parser does not currently enforce that link. | Parser integration / manual | NFR-2, INV-4–INV-5 |
| TC-7 | Download from the import sheet and inspect the new hint if included. | Existing download button requests the same endpoint and saves the XLSX; hint is visible and accessible. | UI test / manual smoke | FR-1, FR-5, NFR-4 |
| TC-8 | Run the existing stale-revision import scenario. | Concurrent draft change still returns the existing conflict behavior; no stale replacement occurs. | Backend integration / UI regression | NFR-4 |

The external AI’s adherence is not a testable application guarantee. Verify the prompt’s required wording and continue to require human source comparison before import.

## 9. Rollout and recovery

- No migration or deploy ordering dependency exists because this changes generated workbook content only.
- Keep the endpoint authorization and private/no-store response behavior unchanged.
- Rollback is a code revert of the generator and optional UI hint. Previously downloaded workbooks remain compatible because the import schema and parser are unchanged.
- If preview rejects the new template after staff fills it, fix the generator copy or contract test first; do not weaken importer validation to make the template pass.
- Use existing endpoint error handling and import-preview diagnostics; new telemetry is not justified for this static workbook-content change.

## 10. Open decisions and final gap review

- **Recommended default:** Adopt the local prototype’s expanded copy after checking every rule against ParseSATWorkbook; preserve the production generator’s hidden _SAT sheet and current sheet order.
- **P1 recommendation:** Make AI Instructions the active tab without reordering sheets. Keep the UI hint only if it remains a small text-only addition.
- **Versioning:** Keep templateVersion 2 because the Questions/Assets import contract is unchanged. Revisit versioning only if a later change alters machine-readable fields or parser semantics.
- **Blockers:** None. The only unresolved product choice is whether to include the optional UI hint; it does not block P0 delivery.

Traceability: FR-1–FR-3 map to phase 1 and TC-2/TC-3; FR-4 maps to phase 3 and TC-4/TC-5; FR-5 maps to phase 2 and TC-1/TC-7. INV-1–INV-5 are covered by TC-1–TC-6.
