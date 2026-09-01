# SAT Excel AI Instructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible, copyable AI authoring prompt and system-context reference to the generated SAT Excel template without changing question import, persistence, delivery, or settings behavior.

**Architecture:** Keep `backend/crates/application/src/sat_workbook.rs` as the authoritative owner of the generated workbook contract. Add an `AI Instructions` worksheet and expand the existing `Guide`; the existing parser continues to consume only `Questions` and `Assets`, so the new content is guidance rather than exam data. Bump the generated template manifest version to `2` while retaining compatibility with older workbooks that do not contain the new sheet.

**Tech Stack:** Rust 1.88, `rust_xlsxwriter` 0.99, `calamine` 0.36, Cargo workspace tests, `ast-grep`, TypeScript/Vitest regression checks.

---

## Repository and change-safety notes

- The approved design is `docs/superpowers/specs/2026-09-02-sat-excel-ai-instructions-design.md`.
- The current working tree already contains unrelated modified and untracked files. Capture that baseline before implementation and do not stage, rewrite, or clean those files.
- The only production source file expected to change is `backend/crates/application/src/sat_workbook.rs`. The focused tests live in that file's existing `#[cfg(test)]` module, so no new binary fixture or frontend contract change is needed.
- Structural discovery must use AST queries before editing. Use exact AST-anchored replacements or an AST/CST rewrite for source changes; do not perform a global text replacement.
- The importer has already been implemented as a full-workbook flow. This plan adds context to its downloaded template; it does not introduce partial import, an AI API, an Excel settings importer, or new rich-text syntax.

## Impact map

```text
GET /v1/assessment-authoring/exams/:exam_id/sat-workbook-template
  → download_sat_workbook_template
  → build_sat_workbook_template
  → Questions / Guide / Assets / AI Instructions / _SAT workbook

completed .xlsx upload
  → preview_sat_workbook
  → parse_sat_workbook
  → Questions and Assets only
  → existing preview renderer
  → existing atomic commit

Release page
  → timing, adaptive routing, calculator/reference-sheet policy, publishing
  → remains the source of truth for delivery settings
```

### Must change

- `backend/crates/application/src/sat_workbook.rs`: template version, AI prompt/reference data, `Guide`, and generated worksheet.
- The existing Rust test module in that file: generated-template contract tests.

### Must verify unchanged

- `parse_sat_workbook` content inputs (`Questions` and `Assets`).
- Rich-content compilation, asset resolution, server validation, preview registration, staged upload, atomic commit, undo, and delivery rendering.
- `src/features/exam-authoring/import/SatWorkbookImportSheet.tsx` and its tests.
- SAT delivery/release behavior and all IELTS behavior.

---

### Task 1: Establish the AST map and clean baseline

**Files:** None.

- [ ] **Step 1: Capture the existing working-tree boundary.**

Run:

```bash
git status --short
printf '%s\n' '--- tracked files at HEAD ---'
git diff --name-only HEAD
```

Record the existing paths. The implementation must add only `backend/crates/application/src/sat_workbook.rs` to the feature diff; do not reset or stage pre-existing changes.

- [ ] **Step 2: Resolve the Rust template symbols structurally.**

Run:

```bash
ast-grep --lang rust --pattern 'const TEMPLATE_VERSION: &str = $$$;' backend/crates/application/src/sat_workbook.rs
ast-grep --lang rust --pattern 'pub fn build_sat_workbook_template() -> $$$' backend/crates/application/src/sat_workbook.rs
ast-grep --lang rust --pattern 'pub fn parse_sat_workbook($$$)' backend/crates/application/src/sat_workbook.rs
ast-grep --lang rust --pattern 'build_sat_workbook_template()' backend
ast-grep --lang rust --pattern 'parse_sat_workbook($$$)' backend
```

Expected structural inventory:

- one `TEMPLATE_VERSION` constant;
- one template builder;
- one parser;
- the template builder is called by the API route and the parser is used by preview/tests;
- no existing `AI Instructions` symbol or worksheet.

- [ ] **Step 3: Resolve the frontend consumer boundary structurally.**

Run:

```bash
ast-grep --lang tsx --pattern '<SatWorkbookImportSheet $$$ />' src
ast-grep --lang ts --pattern '$OBJ.previewSatWorkbook($$$)' src
ast-grep --lang ts --pattern '$OBJ.commitSatWorkbook($$$)' src
ast-grep --lang ts --pattern '$OBJ.getSatWorkbookTemplate($$$)' src
```

Expected result: the existing authoring workspace is the only JSX consumer of `SatWorkbookImportSheet`; the API methods remain unchanged and no frontend file needs a contract edit.

- [ ] **Step 4: Run the focused baseline tests.**

Run:

```bash
cargo test -p ielts-backend-application sat_workbook -- --nocapture
npx vitest run src/features/exam-authoring/import/__tests__/SatWorkbookImportSheet.test.tsx
```

Expected result: record the current pass/failure counts. If a failure is pre-existing, preserve its output in the handoff and do not attribute it to this feature.

- [ ] **Step 5: Parse the target Rust file before mutation.**

Run:

```bash
cargo check -p ielts-backend-application
```

Expected result: the current application crate parses and type-checks, or the baseline error is recorded before any change.

---

### Task 2: Specify the generated workbook contract with failing tests

**Files:**
- Modify: `backend/crates/application/src/sat_workbook.rs` in the existing `#[cfg(test)] mod tests`.

- [ ] **Step 1: Add a worksheet-text helper and a failing template contract test.**

Add these imports at the beginning of the existing test module, then add the helper and test below the existing tests. Use literal expectations in this red test so it fails because the production template has not changed yet:

```rust
use calamine::{DataType, Reader, Xlsx};
use std::io::Cursor;

fn worksheet_text(bytes: &[u8], name: &str) -> String {
    let mut workbook = Xlsx::new(Cursor::new(bytes.to_vec())).expect("xlsx workbook");
    workbook
        .worksheet_range(name)
        .expect("worksheet")
        .rows()
        .flat_map(|row| row.iter().filter_map(|cell| cell.as_string()))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn generated_template_exposes_ai_authoring_contract() {
    let bytes = build_sat_workbook_template().expect("template");
    let mut workbook = Xlsx::new(Cursor::new(bytes.clone())).expect("xlsx workbook");
    let sheet_names = workbook.sheet_names();

    for expected in ["Questions", "Guide", "Assets", "AI Instructions", "_SAT"] {
        assert!(
            sheet_names.iter().any(|name| name == expected),
            "missing worksheet {expected:?}: {sheet_names:?}"
        );
    }

    let manifest = workbook.worksheet_range("_SAT").expect("manifest");
    let manifest_rows: Vec<Vec<String>> = manifest
        .rows()
        .map(|row| row.iter().filter_map(|cell| cell.as_string()).collect())
        .collect();
    let template_version = manifest_rows
        .iter()
        .find(|row| row.first().is_some_and(|key| key == "templateVersion"))
        .and_then(|row| row.get(1))
        .expect("template version");
    assert_eq!(template_version, "2");

    let instructions = worksheet_text(&bytes, "AI Instructions");
    for required in [
        "System prompt",
        "147",
        "Reading & Writing · Module 1",
        "Math · Module 1",
        "exactly two pretest",
        "Prompt",
        "Stimulus",
        "Rationale",
        "Accepted Responses",
        "Release page",
        "\\(x^2+1\\)",
        "\\[x^2+1=5\\]",
        "![graph_01]",
        "Markdown table",
        "fenced code",
    ] {
        assert!(instructions.contains(required), "AI instructions omitted {required:?}");
    }

    assert!(!instructions.trim().is_empty());
    assert!(instructions.chars().count() < 32_000);
}
```

The helper deliberately reads the generated `.xlsx` through `calamine`; it does not inspect the Rust constant directly. This proves the artifact delivered to staff contains the contract.

- [ ] **Step 2: Extend the existing round-trip test with the new manifest expectation.**

In `generated_template_round_trips_as_xlsx`, add this assertion immediately after the existing `row_count` assertion:

```rust
assert_eq!(preview.template_version, "2");
```

The existing `assert!(!preview.valid)` remains: the untouched template still has blank question content and must not become a valid exam merely because instructions were added.

- [ ] **Step 3: Run only the new red test.**

Run:

```bash
cargo test -p ielts-backend-application generated_template_exposes_ai_authoring_contract -- --exact --nocapture
```

Expected result: **FAIL**, because the current generated workbook has no `AI Instructions` sheet and `_SAT.templateVersion` is still `1`. This is the required TDD red proof; do not modify the test to make it pass.

- [ ] **Step 4: Compile the modified test-bearing Rust file and re-run the red test.**

Run:

```bash
cargo test -p ielts-backend-application generated_template_exposes_ai_authoring_contract --no-run
cargo test -p ielts-backend-application generated_template_exposes_ai_authoring_contract -- --exact --nocapture
```

Expected result: the test code compiles as a valid Rust AST, then the targeted test fails on the intended workbook assertion rather than on a syntax or import error.

- [ ] **Step 5: Commit the red test separately.**

Run:

```bash
git add backend/crates/application/src/sat_workbook.rs
git commit --only backend/crates/application/src/sat_workbook.rs -m "test: specify SAT Excel AI instructions"
```

The commit must contain only the focused Rust test additions. Do not stage any existing unrelated working-tree path.

---

### Task 3: Implement the AI Instructions worksheet and Guide context

**Files:**
- Modify: `backend/crates/application/src/sat_workbook.rs`.

- [ ] **Step 1: Add the worksheet name, version, and copyable system prompt constants.**

Immediately beside the existing workbook constants, replace the existing `TEMPLATE_VERSION` declaration with the two declarations below and add the prompt constant. Add the following prompt verbatim so the generated workbook has one authoritative AI instruction source:

```rust
const AI_INSTRUCTIONS_SHEET: &str = "AI Instructions";
const TEMPLATE_VERSION: &str = "2";

const AI_SYSTEM_PROMPT: &str = r###"You are a careful Digital SAT assessment author and Excel workbook editor.

TASK
Using the supplied SAT authoring template, create a complete original Digital SAT practice exam. Preserve the workbook structure, fill the Questions sheet, add any required visuals to the Assets sheet, and return an .xlsx workbook ready for the Import SAT from Excel workflow.

WORKBOOK CONTRACT
- Keep the sheet names Questions, Guide, Assets, AI Instructions, and hidden _SAT.
- Keep the Questions header row exactly as supplied. Do not rename, remove, reorder, or invent columns.
- Write one question per Questions row. Use the supplied module labels and order values.
- Do not use formulas. Write displayed values into cells.
- Preserve the hidden _SAT sheet and all workbook validation rules.
- Return an .xlsx file, not a screenshot, PDF, plain-text table, or a different spreadsheet format.
- Keep the file, cells, and embedded images within the template limits.

COMPLETE DIGITAL SAT STRUCTURE
Create exactly 147 questions in six modules:
- Reading & Writing · Module 1 — base — 27 questions.
- Reading & Writing · Module 2 — Lower — 27 questions.
- Reading & Writing · Module 2 — Higher — 27 questions.
- Math · Module 1 — base — 22 questions.
- Math · Module 2 — Lower — 22 questions.
- Math · Module 2 — Higher — 22 questions.
- Order must run from 1 through the module count without duplicates.
- Mark exactly two rows in every module as Pretest=Yes; mark all other rows Pretest=No.
- Reading & Writing questions must use Response Type=Multiple Choice.
- Math questions may use Response Type=Multiple Choice or Response Type=Student Response.

QUESTIONS COLUMNS
- Module: exact destination module label; it controls placement and adaptive branch.
- Order: 1-based position inside that module.
- Prompt: the exact question students will read and answer. This is required.
- Stimulus: optional passage, context, data, notes, table, equation, or visual supporting the prompt.
- Response Type: Multiple Choice or Student Response.
- A, B, C, D: four complete answer choices for Multiple Choice questions.
- Correct: exactly one of A, B, C, or D for Multiple Choice questions.
- Accepted Responses: semicolon-separated accepted answers for Math Student Response questions.
- Domain and Skill: the valid SAT taxonomy values listed below.
- Difficulty: Easy, Medium, or Hard.
- Pretest: Yes or No.
- Rationale: concise internal explanation of why the keyed answer is correct and why distractors or common traps are wrong. Students do not see it.
- Tags: comma-separated internal search labels.

STUDENT-RESPONSE RULES
- Use Student Response only in Math.
- Put the primary answer first in Accepted Responses and equivalents after it, separated by semicolons.
- Use an integer, decimal, or fraction. SAT responses allow at most 5 characters, or 6 including a leading minus sign.
- Do not use units, words, commas, mixed fraction notation, or an answer that needs rounding unless the question explicitly makes that valid.
- Set A, B, C, D, and Correct blank for Student Response rows.

SAT TAXONOMY
Reading & Writing domains and skills:
- Information and Ideas: Central Ideas and Details; Command of Evidence — Textual; Command of Evidence — Quantitative; Inferences.
- Craft and Structure: Words in Context; Text Structure and Purpose; Cross-Text Connections.
- Expression of Ideas: Rhetorical Synthesis; Transitions.
- Standard English Conventions: Boundaries; Form, Structure, and Sense.
Math domains and skills:
- Algebra: Linear Equations in One Variable; Linear Functions; Linear Equations in Two Variables; Systems of Two Linear Equations; Linear Inequalities.
- Advanced Math: Equivalent Expressions; Nonlinear Equations in One Variable; Systems of Equations in Two Variables; Nonlinear Functions.
- Problem-Solving and Data Analysis: Ratios, Rates, Proportional Relationships, and Units; Percentages; One-Variable Data; Two-Variable Data; Probability and Conditional Probability; Inference from Sample Statistics and Margin of Error; Evaluating Statistical Claims.
- Geometry and Trigonometry: Area and Volume; Lines, Angles, and Triangles; Right Triangles and Trigonometry; Circles.
Use the exact spelling and punctuation of the taxonomy values in the template.

RICH CONTENT SYNTAX
The workbook parser converts these text forms into the same structured rich content used by the authoring editor and student renderer:
- **bold** becomes bold text.
- *italic* becomes italic text.
- `code` becomes inline code.
- \(x^2+1\) becomes an inline equation.
- \[x^2+1=5\] becomes a display equation. Keep the expression on one line when possible.
- ## Heading and ### Subheading become headings.
- - item or * item becomes a bulleted list.
- 1. item becomes a numbered list.
- A Markdown table must have a header row, a separator row, and matching cells.
- A fenced code block such as ```python\nprint(1)\n``` becomes a code block.
- ![graph_01] becomes a workbook image reference. Put it on its own line.
Do not invent Excel markers for underline, superscript, or subscript. They are not supported by this workbook syntax.

HOW CONTENT APPEARS
- Prompt is the main student-visible question.
- Stimulus is student-visible supporting material. Reading & Writing stimulus is presented with the question in the reading workspace; Math stimulus is presented in the Math question flow.
- A-D are the student-visible choices for Multiple Choice.
- Correct, Accepted Responses, Domain, Skill, Difficulty, Pretest, Tags, and Rationale are internal system or staff-review data.
- Rationale is not shown to students.
- The import preview uses the real question renderer, so inspect the preview before importing.

ASSETS
- Add each visual as an embedded image on the Assets sheet in the Image column.
- Give it a unique Asset Key containing only letters, numbers, dots, dashes, or underscores.
- Provide meaningful Alt Text and an optional Caption.
- Reference the asset from Prompt or Stimulus as ![asset_key] on its own line.
- Every image reference must have exactly one matching embedded image and metadata row.
- Do not place workbook images on Questions, Guide, or AI Instructions.

QUALITY CHECK BEFORE RETURNING THE FILE
- Verify every answer, calculation, equation, distractor, grammar decision, and rationale.
- Make the keyed answer the only defensible answer.
- Match every question to its stated domain and skill.
- Keep difficulty appropriate for its module branch; do not make Higher and Lower modules identical copies.
- Use clear, concise, original SAT-style practice content. Do not claim it is official College Board content or copy protected official questions.
- Check that all six modules have the required count and exactly two pretests.
- Check that all four choices are present for every Multiple Choice row.
- Check that Student Response rows have accepted answers and no choice answer key.
- Check that all rich-content delimiters are closed and all asset references resolve.
- Check that there are no formulas, duplicate orders, unsupported values, or accidental blank prompts.

SETTINGS BOUNDARY
Timing, breaks, adaptive routing thresholds, calculator/reference-sheet policy, publishing, and release settings are configured on the SAT Release page. Do not add invented settings columns or assume arbitrary workbook cells will change delivery settings.

FINAL OUTPUT
Return the completed .xlsx workbook while preserving the template structure. The staff member will upload it, review the validation diagnostics and real student preview, and explicitly choose Import."###;
```

The raw string is intentionally below the Excel single-cell limit. Do not add a second conflicting prompt elsewhere in the code.

- [ ] **Step 2: Add a focused worksheet writer.**

Add this helper after `build_sat_workbook_template` or immediately before it, using the existing `Workbook`, `Format`, and `template_error` patterns:

```rust
fn write_ai_instructions(
    workbook: &mut Workbook,
    header: &Format,
    body: &Format,
    scaffold: &Format,
) -> Result<(), SatWorkbookError> {
    let sheet = workbook.add_worksheet();
    sheet
        .set_name(AI_INSTRUCTIONS_SHEET)
        .map_err(template_error)?;
    sheet.set_column_width(0, 38.0).map_err(template_error)?;
    sheet.set_column_width(1, 110.0).map_err(template_error)?;
    sheet
        .write_with_format(0, 0, "SAT AI authoring instructions", header)
        .map_err(template_error)?;
    sheet
        .write_with_format(
            0,
            1,
            "Copy the system prompt, then let your AI fill Questions and Assets.",
            header,
        )
        .map_err(template_error)?;
    sheet
        .write_with_format(2, 0, "System prompt — copy this into your AI tool", scaffold)
        .map_err(template_error)?;
    sheet
        .write_with_format(2, 1, AI_SYSTEM_PROMPT, body)
        .map_err(template_error)?;
    sheet
        .set_row_height(2, 300.0)
        .map_err(template_error)?;

    let fields = [
        ("Module", "Destination module and adaptive branch; determines placement, not raw student text."),
        ("Order", "1-based position within the selected module."),
        ("Prompt", "Required main question. This is the exact content students see."),
        ("Stimulus", "Optional passage, context, data, notes, table, equation, or visual shown with the question."),
        ("Response Type", "Multiple Choice or Math Student Response; determines the response control."),
        ("A–D", "Four answer choices shown to students for Multiple Choice items."),
        ("Correct", "Internal answer key containing exactly A, B, C, or D; never shown to students."),
        ("Accepted Responses", "Internal semicolon-separated Math Student Response answers; never shown to students."),
        ("Domain / Skill", "Internal SAT taxonomy classification used for authoring and review."),
        ("Difficulty", "Internal Easy, Medium, or Hard classification."),
        ("Pretest", "Internal SAT assessment metadata; not rendered as question text."),
        ("Rationale", "Internal staff explanation; not shown to students."),
        ("Tags", "Comma-separated internal search labels."),
        ("Assets", "Embedded image, key, alt text, and caption; referenced from content with ![asset_key]."),
    ];
    let fields_header = 4u32;
    sheet
        .write_with_format(fields_header, 0, "Field", header)
        .map_err(template_error)?;
    sheet
        .write_with_format(fields_header, 1, "Meaning and visibility", header)
        .map_err(template_error)?;
    for (index, (field, description)) in fields.iter().enumerate() {
        let row = fields_header + 1 + index as u32;
        sheet
            .write_with_format(row, 0, *field, scaffold)
            .map_err(template_error)?;
        sheet
            .write_with_format(row, 1, *description, body)
            .map_err(template_error)?;
    }

    let syntax_header = fields_header + fields.len() as u32 + 2;
    sheet
        .write_with_format(syntax_header, 0, "Excel syntax", header)
        .map_err(template_error)?;
    sheet
        .write_with_format(syntax_header, 1, "Structured result", header)
        .map_err(template_error)?;
    let syntax = [
        ("**bold**", "Bold text"),
        ("*italic*", "Italic text"),
        ("`code`", "Inline code"),
        (r"\(x^2+1\)", "Inline equation"),
        (r"\[x^2+1=5\]", "Display equation"),
        ("## Heading / ### Subheading", "Heading or subheading"),
        ("- item / * item", "Bulleted list"),
        ("1. item", "Numbered list"),
        ("Markdown table", "Structured table"),
        ("```python\nprint(1)\n```", "Code block"),
        ("![graph_01]", "Workbook image reference"),
    ];
    for (index, (syntax_value, result)) in syntax.iter().enumerate() {
        let row = syntax_header + 1 + index as u32;
        sheet
            .write_with_format(row, 0, *syntax_value, scaffold)
            .map_err(template_error)?;
        sheet
            .write_with_format(row, 1, *result, body)
            .map_err(template_error)?;
    }

    let context_header = syntax_header + syntax.len() as u32 + 2;
    sheet
        .write_with_format(context_header, 0, "System context", header)
        .map_err(template_error)?;
    sheet
        .write_with_format(context_header, 1, "Where the value is used", header)
        .map_err(template_error)?;
    let context = [
        ("Student preview", "The preview uses the real renderer students receive; review it before importing."),
        ("Reading & Writing", "Stimulus is presented with the question in the reading workspace when present."),
        ("Math", "Stimulus is presented in the Math question flow when present."),
        ("Release settings", "Timing, breaks, adaptive routing, tools, and publishing remain on the Release page."),
    ];
    for (index, (label, description)) in context.iter().enumerate() {
        let row = context_header + 1 + index as u32;
        sheet
            .write_with_format(row, 0, *label, scaffold)
            .map_err(template_error)?;
        sheet
            .write_with_format(row, 1, *description, body)
            .map_err(template_error)?;
    }
    Ok(())
}
```

Keep the field and syntax reference in this helper rather than duplicating it in a second production constant. The system prompt and the visible reference must describe the same supported syntax and settings boundary.

- [ ] **Step 3: Make the existing scaffold format wrap long reference values.**

Change only the existing `scaffold` format construction from:

```rust
let scaffold = Format::new()
    .set_background_color(Color::RGB(0xF5F5F7))
    .set_font_color(Color::RGB(0x3A3A3C));
```

to:

```rust
let scaffold = Format::new()
    .set_background_color(Color::RGB(0xF5F5F7))
    .set_font_color(Color::RGB(0x3A3A3C))
    .set_text_wrap();
```

This preserves the existing style while keeping the new field labels readable.

- [ ] **Step 4: Expand the human Guide without changing the parser.**

Extend the existing `examples` array in the `Guide` worksheet with these four entries after the current Student response example:

```rust
(
    "Prompt",
    "Required exact student-visible question. Stimulus is optional supporting material; Rationale is internal and is not shown to students.",
),
(
    "Student preview",
    "Import preview uses the real student renderer. Reading & Writing stimulus is presented with the question; Math stimulus is presented in the Math question flow.",
),
(
    "AI workflow",
    "Copy the system prompt from AI Instructions. Ask the AI to preserve this workbook, fill Questions and Assets, and return an .xlsx file.",
),
(
    "Settings",
    "Timing, adaptive routing, calculator/reference-sheet policy, and publishing are configured on the Release page, not imported from Excel.",
),
```

Do not add unsupported underline, superscript, or subscript syntax to the Guide.

- [ ] **Step 5: Generate the AI worksheet in the existing workbook flow.**

After the existing `Assets` worksheet block and before the `_SAT` manifest block, call the helper:

```rust
write_ai_instructions(&mut workbook, &header, &body, &scaffold)?;
```

The order in the generated file must be `Questions`, `Guide`, `Assets`, `AI Instructions`, `_SAT`. Do not set the new sheet hidden; only `_SAT` remains hidden.

- [ ] **Step 6: Re-run the focused red test as the green implementation test.**

Run:

```bash
cargo test -p ielts-backend-application generated_template_exposes_ai_authoring_contract -- --exact --nocapture
```

Expected result: **PASS**. The test must observe the new sheet and version through the generated `.xlsx`, not through the constant.

- [ ] **Step 7: Re-parse and format the implementation.**

Run:

```bash
cargo fmt --all -- --check
cargo check -p ielts-backend-application
```

Expected result: zero Rust parse/type errors and no formatting failure in the modified file. If repository-wide formatting reports an unrelated pre-existing file, run `rustfmt --check backend/crates/application/src/sat_workbook.rs` for the target and record the unrelated baseline issue rather than editing unrelated files.

- [ ] **Step 8: Commit the minimal implementation.**

Run:

```bash
git add backend/crates/application/src/sat_workbook.rs
git commit --only backend/crates/application/src/sat_workbook.rs -m "feat: add SAT Excel AI authoring instructions"
```

The commit must include only the template enhancement and its focused tests. No API, frontend, migration, or unrelated working-tree path should be staged.

---

### Task 4: Verify parser compatibility, regressions, and the final change graph

**Files:** None unless verification exposes a defect in the targeted implementation.

- [ ] **Step 1: Run all focused Rust workbook tests.**

Run:

```bash
cargo test -p ielts-backend-application sat_workbook -- --nocapture
```

Verify all of these behaviors remain green:

- the blank generated template round-trips and remains invalid;
- a complete six-module workbook remains valid with 147 questions;
- rich content still maps to math, tables, code, and emphasis nodes;
- embedded assets still resolve with checksum, alt text, and caption; and
- the new visible sheet only affects generated guidance, not parsed question rows.

- [ ] **Step 2: Run the focused frontend importer regression suite.**

Run:

```bash
npx vitest run src/features/exam-authoring/import/__tests__/SatWorkbookImportSheet.test.tsx
```

Expected result: the existing preview, staging, commit, retry, disabled-state, and asset-upload tests pass without changing their API payloads. The frontend should not need a new version field or instruction-sheet behavior.

- [ ] **Step 3: Re-run AST queries for the changed symbols and consumers.**

Run:

```bash
ast-grep --lang rust --pattern 'const AI_INSTRUCTIONS_SHEET: &str = $$$;' backend/crates/application/src/sat_workbook.rs
ast-grep --lang rust --pattern 'const AI_SYSTEM_PROMPT: &str = $$$;' backend/crates/application/src/sat_workbook.rs
ast-grep --lang rust --pattern 'write_ai_instructions($$$)' backend/crates/application/src/sat_workbook.rs
ast-grep --lang rust --pattern 'parse_sat_workbook($$$)' backend
ast-grep --lang tsx --pattern '<SatWorkbookImportSheet $$$ />' src
```

Expected structural result:

- one AI worksheet constant and one prompt constant;
- one call from the template builder;
- all parser references remain unchanged;
- all existing frontend importer references remain resolvable.

- [ ] **Step 4: Run the application and workspace checks.**

Run:

```bash
cargo check --workspace
cargo test --workspace
npm run typecheck
```

Expected result: all commands exit successfully. If the full workspace has a pre-existing environment/database failure, separate that evidence from failures in the modified workbook code and retain the focused passing output.

- [ ] **Step 5: Audit that the parser still ignores guidance sheets.**

Use the generated-template test and parser result as the behavioral proof:

```bash
cargo test -p ielts-backend-application generated_template_round_trips_as_xlsx -- --exact --nocapture
cargo test -p ielts-backend-application complete_workbook_parses_all_six_modules_and_rich_content -- --exact --nocapture
```

The generated template must still report 147 question rows from `Questions`, and the complete workbook helper must still report six modules and 147 parsed questions. There must be no issue whose field is `AI Instructions`; the parser's content path remains limited to `Questions` and `Assets`.

- [ ] **Step 6: Inspect the final diff and preserve the dirty-worktree boundary.**

Run:

```bash
git diff --check HEAD~2..HEAD
git show --stat --oneline HEAD~1
git show --stat --oneline HEAD
git status --short
```

Confirm:

- the two feature commits contain only `backend/crates/application/src/sat_workbook.rs`;
- the approved design commit and implementation commits do not include pre-existing modified/untracked files;
- no source comments or unrelated string literals were changed;
- no `package-lock.json`, migration, API route, frontend contract, or generated binary changed; and
- the final behavior matches the approved spec: workbook-only AI context, complete 147-question output, current rich syntax only, and Release-page settings boundary.

- [ ] **Step 7: Produce the completion traceability report.**

Record evidence for each acceptance criterion:

| Criterion | Evidence |
| --- | --- |
| Visible `AI Instructions` sheet | Generated-template contract test |
| Copyable system prompt | Generated-sheet text assertion and rendered `.xlsx` artifact |
| Complete six-module/147-question contract | Prompt assertions plus existing parser round-trip test |
| Field visibility and rendering context | Prompt/reference assertions |
| Current rich syntax | Syntax assertions and existing rich-content parser test |
| Accessible asset workflow | Prompt/reference assertions and existing asset test |
| Release-page settings boundary | Prompt/reference assertions |
| No parser/import behavior change | Existing parser/importer tests and AST call graph |
| No frontend/backend contract change | Typecheck, focused Vitest, API symbol map |
| Backward compatibility for old workbooks | Parser is unchanged and focused tests still parse generated non-AI workbooks |

Do not report completion until the focused red test was observed failing, the implementation test passes, the modified Rust file re-parses/type-checks, and the final diff has been reviewed.

## Plan self-review

- **Spec coverage:** Workbook structure, copyable prompt, field/rendering mapping, supported rich syntax, asset accessibility, settings boundary, parser isolation, backward compatibility, tests, and rollback are covered by Tasks 2–4.
- **Placeholder scan:** No step relies on `TBD`, `TODO`, a future unspecified helper, or a generic “add tests” instruction. The prompt, worksheet rows, test assertions, commands, and expected outcomes are specified.
- **Type consistency:** The implementation uses existing `Workbook`, `Format`, `SatWorkbookError`, and `template_error` types. `write_ai_instructions` returns `Result<(), SatWorkbookError>` and is called with `&mut Workbook` and `&Format` values already owned by `build_sat_workbook_template`.
- **Scope check:** This is one subsystem—generated workbook guidance—using one production module and its existing test module. No independent AI service, settings importer, or frontend feature is hidden in the plan.
- **AST compliance:** Discovery and revalidation use `ast-grep`; source edits must target the discovered Rust declarations/call site structurally and must be followed by `cargo check`, focused tests, and a diff audit.
