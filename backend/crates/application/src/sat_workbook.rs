use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read, Seek};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

use calamine::{DataType, Reader, Xlsx};
use ielts_backend_domain::assessment::{
    AccessibilityMetadata, AnswerDefinition, ChoiceOption, Difficulty, QuestionKind,
    QuestionMetadata, QuestionRevision, StructuredContent,
};
use ielts_backend_domain::exam_provider::{
    provider_for, valid_sat_domain, QuestionValidationContext, ADVANCED_MATH_SKILLS,
    ALGEBRA_SKILLS, CRAFT_AND_STRUCTURE_SKILLS, EXPRESSION_OF_IDEAS_SKILLS, GEOMETRY_SKILLS,
    INFORMATION_AND_IDEAS_SKILLS, PROBLEM_SOLVING_SKILLS, STANDARD_ENGLISH_CONVENTIONS_SKILLS,
};
use rust_xlsxwriter::{Color, DataValidation, Format, FormatAlign, Workbook, XlsxError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use thiserror::Error;
use zip::ZipArchive;

use crate::assessment_authoring::BatchQuestionDraft;

const MAX_WORKBOOK_BYTES: usize = 12 * 1024 * 1024;
const MAX_ROWS: usize = 200;
const MAX_CELL_CHARS: usize = 50_000;
const MAX_ZIP_ENTRIES: usize = 1_000;
const MAX_UNCOMPRESSED_BYTES: u64 = 80 * 1024 * 1024;
const MAX_EMBEDDED_ASSETS: usize = 48;
const MAX_EMBEDDED_ASSET_BYTES: usize = 10 * 1024 * 1024;
const MAX_EMBEDDED_ASSET_TOTAL_BYTES: usize = 30 * 1024 * 1024;
const QUESTIONS_SHEET: &str = "Questions";
const ASSETS_SHEET: &str = "Assets";
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
- Use the exact module label Reading & Writing · Module 1 for the base module; create 27 questions.
- Use the exact module label Reading & Writing · Module 2 — Lower; create 27 questions.
- Use the exact module label Reading & Writing · Module 2 — Higher; create 27 questions.
- Use the exact module label Math · Module 1 for the base module; create 22 questions.
- Use the exact module label Math · Module 2 — Lower; create 22 questions.
- Use the exact module label Math · Module 2 — Higher; create 22 questions.
- Order must run from 1 through the module count without duplicates.
- Mark exactly two rows in every module as Pretest=Yes; mark all other rows as Pretest=No.
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
- A fenced code block such as ```python
print(1)
``` becomes a code block.
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
- Check that Student Response rows have accepted answers, blank choices, and no choice answer key.
- Check that all rich-content delimiters are closed and all asset references resolve.
- Check that there are no formulas, duplicate orders, unsupported values, or accidental blank prompts.

SETTINGS BOUNDARY
Timing, breaks, adaptive routing thresholds, calculator/reference-sheet policy, publishing, and release settings are configured on the SAT Release page. Do not add invented settings columns or assume arbitrary workbook cells will change delivery settings.

FINAL OUTPUT
Return the completed .xlsx workbook while preserving the template structure. The staff member will upload it, review the validation diagnostics and real student preview, and explicitly choose Import."###;

const HEADERS: [&str; 17] = [
    "Module",
    "Order",
    "Prompt",
    "Stimulus",
    "Response Type",
    "A",
    "B",
    "C",
    "D",
    "Correct",
    "Accepted Responses",
    "Domain",
    "Skill",
    "Difficulty",
    "Pretest",
    "Rationale",
    "Tags",
];

#[derive(Debug, Error)]
pub enum SatWorkbookError {
    #[error("The workbook is too large. SAT workbooks must be 12 MB or smaller.")]
    TooLarge,
    #[error("The file is not a readable .xlsx workbook: {0}")]
    InvalidWorkbook(String),
    #[error("The workbook template could not be generated: {0}")]
    Template(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SatWorkbookIssue {
    pub row: usize,
    pub field: String,
    pub message: String,
    pub blocking: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SatWorkbookModuleDraft {
    pub module_key: String,
    pub section_key: String,
    pub questions: Vec<BatchQuestionDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SatWorkbookAsset {
    pub key: String,
    pub file_name: String,
    pub content_type: String,
    pub size_bytes: usize,
    pub checksum_sha256: String,
    pub alt_text: String,
    pub caption: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SatWorkbookPreview {
    pub import_id: String,
    pub template_version: String,
    pub row_count: usize,
    pub question_count: usize,
    pub valid: bool,
    pub modules: Vec<SatWorkbookModuleDraft>,
    pub assets: Vec<SatWorkbookAsset>,
    pub issues: Vec<SatWorkbookIssue>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SatWorkbookStagedAsset {
    pub key: String,
    pub asset_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SatWorkbookCommitRequest {
    pub import_id: String,
    pub expected_version_id: String,
    pub expected_version_revision: i32,
    pub modules: Vec<SatWorkbookModuleDraft>,
    #[serde(default)]
    pub assets: Vec<SatWorkbookStagedAsset>,
}

#[derive(Clone, Copy)]
struct ModuleSpec {
    key: &'static str,
    section_key: &'static str,
    label: &'static str,
    count: usize,
}

const MODULES: [ModuleSpec; 6] = [
    ModuleSpec {
        key: "rw-m1",
        section_key: "reading-writing",
        label: "Reading & Writing · Module 1",
        count: 27,
    },
    ModuleSpec {
        key: "rw-m2-lower",
        section_key: "reading-writing",
        label: "Reading & Writing · Module 2 — Lower",
        count: 27,
    },
    ModuleSpec {
        key: "rw-m2-higher",
        section_key: "reading-writing",
        label: "Reading & Writing · Module 2 — Higher",
        count: 27,
    },
    ModuleSpec {
        key: "math-m1",
        section_key: "math",
        label: "Math · Module 1",
        count: 22,
    },
    ModuleSpec {
        key: "math-m2-lower",
        section_key: "math",
        label: "Math · Module 2 — Lower",
        count: 22,
    },
    ModuleSpec {
        key: "math-m2-higher",
        section_key: "math",
        label: "Math · Module 2 — Higher",
        count: 22,
    },
];

pub fn build_sat_workbook_template() -> Result<Vec<u8>, SatWorkbookError> {
    let mut workbook = Workbook::new();
    let skill_labels = skill_labels();
    workbook
        .define_name(
            "SatSkills",
            &format!("='_SAT'!$D$1:$D${}", skill_labels.len()),
        )
        .map_err(template_error)?;
    let header = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x1D1D1F))
        .set_align(FormatAlign::Center)
        .set_text_wrap();
    let body = Format::new().set_text_wrap().set_align(FormatAlign::Top);
    let scaffold = Format::new()
        .set_background_color(Color::RGB(0xF5F5F7))
        .set_font_color(Color::RGB(0x3A3A3C))
        .set_text_wrap();

    {
        let sheet = workbook.add_worksheet();
        sheet.set_name(QUESTIONS_SHEET).map_err(template_error)?;
        sheet.set_freeze_panes(1, 2).map_err(template_error)?;
        for (col, title) in HEADERS.iter().enumerate() {
            sheet
                .write_with_format(0, col as u16, *title, &header)
                .map_err(template_error)?;
        }
        let widths = [
            30.0, 8.0, 48.0, 48.0, 18.0, 28.0, 28.0, 28.0, 28.0, 10.0, 24.0, 30.0, 42.0, 12.0,
            10.0, 42.0, 24.0,
        ];
        for (col, width) in widths.iter().enumerate() {
            sheet
                .set_column_width(col as u16, *width)
                .map_err(template_error)?;
        }

        let module_values: Vec<&str> = MODULES.iter().map(|module| module.label).collect();
        let module_validation = DataValidation::new()
            .allow_list_strings(&module_values)
            .map_err(template_error)?;
        let response_validation = DataValidation::new()
            .allow_list_strings(&["Multiple Choice", "Student Response"])
            .map_err(template_error)?;
        let correct_validation = DataValidation::new()
            .allow_list_strings(&["A", "B", "C", "D"])
            .map_err(template_error)?;
        let difficulty_validation = DataValidation::new()
            .allow_list_strings(&["Easy", "Medium", "Hard"])
            .map_err(template_error)?;
        let boolean_validation = DataValidation::new()
            .allow_list_strings(&["No", "Yes"])
            .map_err(template_error)?;
        let domain_labels = domain_labels();
        let domain_refs: Vec<&str> = domain_labels.iter().map(String::as_str).collect();
        let domain_validation = DataValidation::new()
            .allow_list_strings(&domain_refs)
            .map_err(template_error)?;
        let skill_validation = DataValidation::new().allow_list_formula("SatSkills".into());

        let mut row = 1u32;
        for module in MODULES {
            for order in 1..=module.count {
                sheet
                    .write_with_format(row, 0, module.label, &scaffold)
                    .map_err(template_error)?;
                sheet
                    .write_with_format(row, 1, order as u32, &scaffold)
                    .map_err(template_error)?;
                sheet
                    .write_with_format(row, 4, "Multiple Choice", &body)
                    .map_err(template_error)?;
                sheet
                    .write_with_format(row, 13, "Medium", &body)
                    .map_err(template_error)?;
                sheet
                    .write_with_format(row, 14, "No", &body)
                    .map_err(template_error)?;
                row += 1;
            }
        }
        let last = row - 1;
        sheet
            .add_data_validation(1, 0, last, 0, &module_validation)
            .map_err(template_error)?;
        sheet
            .add_data_validation(1, 4, last, 4, &response_validation)
            .map_err(template_error)?;
        sheet
            .add_data_validation(1, 9, last, 9, &correct_validation)
            .map_err(template_error)?;
        sheet
            .add_data_validation(1, 11, last, 11, &domain_validation)
            .map_err(template_error)?;
        sheet
            .add_data_validation(1, 12, last, 12, &skill_validation)
            .map_err(template_error)?;
        sheet
            .add_data_validation(1, 13, last, 13, &difficulty_validation)
            .map_err(template_error)?;
        sheet
            .add_data_validation(1, 14, last, 14, &boolean_validation)
            .map_err(template_error)?;
        sheet
            .autofilter(0, 0, last, (HEADERS.len() - 1) as u16)
            .map_err(template_error)?;
    }

    {
        let guide = workbook.add_worksheet();
        guide.set_name("Guide").map_err(template_error)?;
        guide.set_column_width(0, 28.0).map_err(template_error)?;
        guide.set_column_width(1, 90.0).map_err(template_error)?;
        guide
            .write_with_format(0, 0, "SAT Excel authoring", &header)
            .map_err(template_error)?;
        guide
            .write_with_format(
                0,
                1,
                "Use normal text until you need richer content.",
                &header,
            )
            .map_err(template_error)?;
        let examples = [
            ("Inline math", r"The value is \(x^2+3x\)."),
            ("Display math", "\\[\\frac{x+1}{2}=7\\]"),
            ("Table", "| Year | Value |\n| --- | ---: |\n| 2025 | 42 |"),
            ("Code", "```python\ndef f(x):\n    return x * 2\n```"),
            ("Image", "Add the image on the Assets sheet, then place it with ![graph_01] on its own line."),
            ("Bold / italic", "Use **bold** or *italic* when the source requires emphasis."),
            ("Student response", "Set Response Type to Student Response and put equivalents in Accepted Responses separated by semicolons."),
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
        ];
        for (index, (label, value)) in examples.iter().enumerate() {
            guide
                .write_with_format((index + 1) as u32, 0, *label, &scaffold)
                .map_err(template_error)?;
            guide
                .write_with_format((index + 1) as u32, 1, *value, &body)
                .map_err(template_error)?;
        }
    }

    {
        let assets = workbook.add_worksheet();
        assets.set_name(ASSETS_SHEET).map_err(template_error)?;
        assets.set_freeze_panes(1, 0).map_err(template_error)?;
        let asset_headers = ["Asset Key", "Alt Text", "Caption", "Image"];
        for (col, title) in asset_headers.iter().enumerate() {
            assets
                .write_with_format(0, col as u16, *title, &header)
                .map_err(template_error)?;
        }
        for (col, width) in [24.0, 58.0, 42.0, 30.0].iter().enumerate() {
            assets
                .set_column_width(col as u16, *width)
                .map_err(template_error)?;
        }
    }

    write_ai_instructions(&mut workbook, &header, &body, &scaffold)?;

    {
        let manifest = workbook.add_worksheet();
        manifest.set_name("_SAT").map_err(template_error)?;
        manifest
            .write(0, 0, "templateVersion")
            .map_err(template_error)?;
        manifest
            .write(0, 1, TEMPLATE_VERSION)
            .map_err(template_error)?;
        manifest
            .write(1, 0, "providerKey")
            .map_err(template_error)?;
        manifest.write(1, 1, "sat").map_err(template_error)?;
        for (index, skill) in skill_labels.iter().enumerate() {
            manifest
                .write(index as u32, 3, skill)
                .map_err(template_error)?;
        }
        manifest.set_hidden(true);
    }

    workbook.save_to_buffer().map_err(template_error)
}

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
        .write_with_format(
            2,
            0,
            "System prompt — copy this into your AI tool",
            scaffold,
        )
        .map_err(template_error)?;
    sheet
        .write_with_format(2, 1, AI_SYSTEM_PROMPT, body)
        .map_err(template_error)?;
    sheet.set_row_height(2, 300.0).map_err(template_error)?;

    let fields = [
        (
            "Module",
            "Destination module and adaptive branch; determines placement, not raw student text.",
        ),
        ("Order", "1-based position within the selected module."),
        (
            "Prompt",
            "Required main question. This is the exact content students see.",
        ),
        (
            "Stimulus",
            "Optional passage, context, data, notes, table, equation, or visual shown with the question.",
        ),
        (
            "Response Type",
            "Multiple Choice or Math Student Response; determines the response control.",
        ),
        (
            "A–D",
            "Four answer choices shown to students for Multiple Choice items.",
        ),
        (
            "Correct",
            "Internal answer key containing exactly A, B, C, or D; never shown to students.",
        ),
        (
            "Accepted Responses",
            "Internal semicolon-separated Math Student Response answers; never shown to students.",
        ),
        (
            "Domain / Skill",
            "Internal SAT taxonomy classification used for authoring and review.",
        ),
        ("Difficulty", "Internal Easy, Medium, or Hard classification."),
        (
            "Pretest",
            "Internal SAT assessment metadata; not rendered as question text.",
        ),
        (
            "Rationale",
            "Internal staff explanation; not shown to students.",
        ),
        ("Tags", "Comma-separated internal search labels."),
        (
            "Assets",
            "Embedded image, key, alt text, and caption; referenced from content with ![asset_key].",
        ),
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
        (
            "Student preview",
            "The preview uses the real renderer students receive; review it before importing.",
        ),
        (
            "Reading & Writing",
            "Stimulus is presented with the question in the reading workspace when present.",
        ),
        (
            "Math",
            "Stimulus is presented in the Math question flow when present.",
        ),
        (
            "Release settings",
            "Timing, breaks, adaptive routing, tools, and publishing remain on the Release page.",
        ),
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

pub fn parse_sat_workbook(bytes: &[u8]) -> Result<SatWorkbookPreview, SatWorkbookError> {
    if bytes.len() > MAX_WORKBOOK_BYTES {
        return Err(SatWorkbookError::TooLarge);
    }
    if !bytes.starts_with(b"PK") {
        return Err(SatWorkbookError::InvalidWorkbook(
            "expected an .xlsx ZIP container".to_owned(),
        ));
    }
    guard_xlsx_archive(bytes)?;
    let cursor = Cursor::new(bytes.to_vec());
    let mut workbook =
        Xlsx::new(cursor).map_err(|error| SatWorkbookError::InvalidWorkbook(error.to_string()))?;
    let mut issues = Vec::new();
    let assets = parse_workbook_assets(&mut workbook, &mut issues)?;
    let asset_catalog: HashMap<String, SatWorkbookAsset> = assets
        .iter()
        .cloned()
        .map(|mut asset| {
            asset.data_base64 = None;
            (asset.key.clone(), asset)
        })
        .collect();

    if let Ok(formulas) = workbook.worksheet_formula(QUESTIONS_SHEET) {
        if formulas
            .cells()
            .any(|(_, _, formula)| !formula.trim().is_empty())
        {
            issues.push(issue(0, "file", "Formulas are not allowed in SAT imports. Replace formulas with their displayed values."));
        }
    }
    let range = workbook
        .worksheet_range(QUESTIONS_SHEET)
        .map_err(|error| SatWorkbookError::InvalidWorkbook(error.to_string()))?;
    let mut rows = range.rows();
    let Some(header_row) = rows.next() else {
        return Ok(empty_preview(vec![issue(
            1,
            "file",
            "The Questions sheet is empty.",
        )]));
    };
    let columns = resolve_columns(header_row);
    for required in [
        "module",
        "order",
        "prompt",
        "response type",
        "domain",
        "skill",
        "difficulty",
        "pretest",
    ] {
        if !columns.contains_key(required) {
            issues.push(issue(
                1,
                required,
                &format!("Missing required column “{}”.", title_case(required)),
            ));
        }
    }

    let mut parsed_by_module: HashMap<&'static str, Vec<(usize, usize, BatchQuestionDraft)>> =
        HashMap::new();
    let mut row_count = 0usize;
    for (index, row) in rows.take(MAX_ROWS).enumerate() {
        let excel_row = index + 2;
        if row
            .iter()
            .all(|cell| cell.as_string().unwrap_or_default().trim().is_empty())
        {
            continue;
        }
        row_count += 1;
        let values = row_values(row, &columns, excel_row, &mut issues);
        if values.is_none() {
            continue;
        }
        let values = values.unwrap();
        let Some(module) = resolve_module(&values["module"]) else {
            issues.push(issue(
                excel_row,
                "Module",
                "Choose one of the six SAT modules from the template.",
            ));
            continue;
        };
        let order = parse_order(&values["order"], module.count, excel_row, &mut issues);
        let prompt = values["prompt"].trim();
        if prompt.is_empty() {
            issues.push(issue(excel_row, "Prompt", "Question text is required."));
        }
        let domain = resolve_domain(module.section_key, &values["domain"]);
        if domain.is_none() {
            issues.push(issue(
                excel_row,
                "Domain",
                "Choose a valid SAT domain for this section.",
            ));
        }
        let domain = domain.unwrap_or_default();
        let skill = resolve_skill(domain, &values["skill"]);
        if skill.is_none() {
            issues.push(issue(
                excel_row,
                "Skill",
                "Choose a skill that belongs to the selected SAT domain.",
            ));
        }
        let skill = skill.unwrap_or_default();
        let difficulty = parse_difficulty(&values["difficulty"]);
        if difficulty.is_none() {
            issues.push(issue(
                excel_row,
                "Difficulty",
                "Difficulty must be Easy, Medium, or Hard.",
            ));
        }
        let pretest = parse_bool(&values["pretest"]);
        if pretest.is_none() {
            issues.push(issue(excel_row, "Pretest", "Pretest must be Yes or No."));
        }
        let response_type = normalize(&values["response type"]);
        let is_spr = matches!(
            response_type.as_str(),
            "student response" | "spr" | "student produced response"
        );
        let is_mcq = matches!(
            response_type.as_str(),
            "multiple choice" | "mcq" | "single choice" | ""
        );
        if !is_spr && !is_mcq {
            issues.push(issue(
                excel_row,
                "Response Type",
                "Response Type must be Multiple Choice or Student Response.",
            ));
        }
        if is_spr && module.section_key != "math" {
            issues.push(issue(
                excel_row,
                "Response Type",
                "Student Response is only supported in Math.",
            ));
        }

        let answer = if is_spr {
            let accepted = split_list(&values["accepted responses"]);
            if accepted.is_empty() {
                issues.push(issue(
                    excel_row,
                    "Accepted Responses",
                    "Enter at least one accepted student response.",
                ));
            }
            AnswerDefinition::StudentProducedResponse {
                accepted_responses: accepted,
                normalize_fraction: true,
                normalize_decimal: true,
                numeric_tolerance: None,
            }
        } else {
            let mut options = Vec::with_capacity(4);
            for key in ["a", "b", "c", "d"] {
                let content = values[key].trim();
                if content.is_empty() {
                    issues.push(issue(
                        excel_row,
                        &key.to_ascii_uppercase(),
                        "Multiple-choice answers require all four choices.",
                    ));
                }
                options.push(ChoiceOption {
                    id: key.to_ascii_uppercase(),
                    content: compile_rich_content(content),
                });
            }
            let correct = values["correct"].trim().to_ascii_uppercase();
            if !matches!(correct.as_str(), "A" | "B" | "C" | "D") {
                issues.push(issue(
                    excel_row,
                    "Correct",
                    "Correct answer must be A, B, C, or D.",
                ));
            }
            AnswerDefinition::SingleChoice {
                options,
                correct_option_id: matches!(correct.as_str(), "A" | "B" | "C" | "D")
                    .then_some(correct),
            }
        };

        if order.is_none()
            || prompt.is_empty()
            || domain.is_empty()
            || skill.is_empty()
            || difficulty.is_none()
            || pretest.is_none()
        {
            continue;
        }
        let mut draft = BatchQuestionDraft {
            question_type: if is_spr {
                QuestionKind::StudentProducedResponse
            } else {
                QuestionKind::SingleChoice
            },
            stimulus: compile_rich_content(values["stimulus"].trim()),
            prompt: compile_rich_content(prompt),
            answer,
            rationale: compile_rich_content(values["rationale"].trim()),
            metadata: QuestionMetadata {
                section_key: module.section_key.to_owned(),
                domain: Some(domain.to_owned()),
                skill: Some(skill.to_owned()),
                difficulty: difficulty.unwrap(),
                tags: split_tags(&values["tags"]),
            },
            accessibility: AccessibilityMetadata {
                long_description: None,
            },
            is_pretest: pretest.unwrap(),
        };
        resolve_workbook_asset_references(&mut draft, &asset_catalog, excel_row, &mut issues);
        let provider = provider_for("sat").expect("SAT provider is registered");
        let validation_question = QuestionRevision {
            id: String::new(),
            question_id: String::new(),
            semantic_revision: 1,
            revision: 0,
            state: "draft".to_owned(),
            question_type: draft.question_type,
            stimulus: draft.stimulus.clone(),
            prompt: draft.prompt.clone(),
            answer: draft.answer.clone(),
            rationale: draft.rationale.clone(),
            metadata: draft.metadata.clone(),
            accessibility: draft.accessibility.clone(),
        };
        for provider_issue in provider.validate_question(
            QuestionValidationContext {
                section_key: module.section_key,
                module_key: module.key,
            },
            &validation_question,
        ) {
            if provider_issue.blocking {
                issues.push(SatWorkbookIssue {
                    row: excel_row,
                    field: workbook_field_for_path(&provider_issue.path).to_owned(),
                    message: provider_issue.message,
                    blocking: true,
                });
            }
        }
        parsed_by_module
            .entry(module.key)
            .or_default()
            .push((order.unwrap(), excel_row, draft));
    }

    if range.height().saturating_sub(1) > MAX_ROWS {
        issues.push(issue(
            MAX_ROWS + 2,
            "file",
            "A SAT workbook can contain at most 200 question rows.",
        ));
    }

    let mut modules = Vec::with_capacity(MODULES.len());
    for module in MODULES {
        let mut questions = parsed_by_module.remove(module.key).unwrap_or_default();
        questions.sort_by_key(|(order, row, _)| (*order, *row));
        let mut seen = HashSet::new();
        for (order, row, _) in &questions {
            if !seen.insert(*order) {
                issues.push(issue(
                    *row,
                    "Order",
                    "Order must be unique within a module.",
                ));
            }
        }
        if questions.len() != module.count {
            issues.push(issue(
                0,
                "Module",
                &format!(
                    "{} requires exactly {} questions; found {}.",
                    module.label,
                    module.count,
                    questions.len()
                ),
            ));
        }
        let pretests = questions
            .iter()
            .filter(|(_, _, question)| question.is_pretest)
            .count();
        if pretests != 2 {
            issues.push(issue(
                0,
                "Pretest",
                &format!(
                    "{} requires exactly 2 pretest questions; found {}.",
                    module.label, pretests
                ),
            ));
        }
        modules.push(SatWorkbookModuleDraft {
            module_key: module.key.to_owned(),
            section_key: module.section_key.to_owned(),
            questions: questions
                .into_iter()
                .map(|(_, _, question)| question)
                .collect(),
        });
    }

    let question_count = modules.iter().map(|module| module.questions.len()).sum();
    let valid = issues.iter().all(|issue| !issue.blocking);
    Ok(SatWorkbookPreview {
        import_id: uuid::Uuid::new_v4().to_string(),
        template_version: TEMPLATE_VERSION.to_owned(),
        row_count,
        question_count,
        valid,
        modules,
        assets,
        issues,
    })
}

fn guard_xlsx_archive(bytes: &[u8]) -> Result<(), SatWorkbookError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| SatWorkbookError::InvalidWorkbook(error.to_string()))?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(SatWorkbookError::InvalidWorkbook(
            "workbook contains too many archive entries".to_owned(),
        ));
    }
    let mut total = 0u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|error| SatWorkbookError::InvalidWorkbook(error.to_string()))?;
        if file.encrypted() {
            return Err(SatWorkbookError::InvalidWorkbook(
                "encrypted workbooks are not supported".to_owned(),
            ));
        }
        total = total.saturating_add(file.size());
        if total > MAX_UNCOMPRESSED_BYTES {
            return Err(SatWorkbookError::InvalidWorkbook(
                "workbook expands beyond the 80 MB safety limit".to_owned(),
            ));
        }
    }
    Ok(())
}

fn parse_workbook_assets<RS: Read + Seek>(
    workbook: &mut Xlsx<RS>,
    issues: &mut Vec<SatWorkbookIssue>,
) -> Result<Vec<SatWorkbookAsset>, SatWorkbookError> {
    let pictures = workbook.pictures_with_metadata();
    if pictures.len() > MAX_EMBEDDED_ASSETS {
        return Err(SatWorkbookError::InvalidWorkbook(format!(
            "workbook contains more than {MAX_EMBEDDED_ASSETS} embedded images"
        )));
    }
    let total_bytes: usize = pictures.iter().map(|picture| picture.data.len()).sum();
    if total_bytes > MAX_EMBEDDED_ASSET_TOTAL_BYTES {
        return Err(SatWorkbookError::InvalidWorkbook(
            "embedded images exceed the 30 MB safety limit".to_owned(),
        ));
    }
    for picture in pictures
        .iter()
        .filter(|picture| picture.sheet_name != ASSETS_SHEET)
    {
        issues.push(issue(
            0,
            "Assets",
            &format!(
                "Embedded image “{}” is on {}. Put workbook images on the Assets sheet.",
                picture.name, picture.sheet_name
            ),
        ));
    }
    if !workbook
        .sheet_names()
        .iter()
        .any(|name| name == ASSETS_SHEET)
    {
        return Ok(Vec::new());
    }
    let range = workbook
        .worksheet_range(ASSETS_SHEET)
        .map_err(|error| SatWorkbookError::InvalidWorkbook(error.to_string()))?;
    let mut assets = Vec::new();
    let mut seen_keys = HashSet::new();
    let mut seen_rows = HashSet::new();
    for picture in pictures
        .into_iter()
        .filter(|picture| picture.sheet_name == ASSETS_SHEET)
    {
        let excel_row = picture.row as usize + 1;
        if picture.row == 0 || picture.col != 3 {
            issues.push(issue(
                excel_row,
                "Assets",
                "Anchor each embedded image in the Image column on the same row as its asset metadata.",
            ));
            continue;
        }
        if !seen_rows.insert(picture.row) {
            issues.push(issue(
                excel_row,
                "Assets",
                "Only one embedded image is allowed per asset row.",
            ));
            continue;
        }
        if picture.data.len() > MAX_EMBEDDED_ASSET_BYTES {
            issues.push(issue(
                excel_row,
                "Assets",
                "Embedded images must be 10 MB or smaller.",
            ));
            continue;
        }
        let Some(row) = range.rows().nth(picture.row as usize) else {
            issues.push(issue(
                excel_row,
                "Assets",
                "Image metadata row could not be read.",
            ));
            continue;
        };
        let key = row
            .first()
            .and_then(DataType::as_string)
            .unwrap_or_default()
            .trim()
            .to_owned();
        let alt_text = row
            .get(1)
            .and_then(DataType::as_string)
            .unwrap_or_default()
            .trim()
            .to_owned();
        let caption = row
            .get(2)
            .and_then(DataType::as_string)
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        if !valid_asset_key(&key) {
            issues.push(issue(
                excel_row,
                "Asset Key",
                "Asset Key is required and may contain letters, numbers, dots, dashes, and underscores.",
            ));
            continue;
        }
        if !seen_keys.insert(key.clone()) {
            issues.push(issue(excel_row, "Asset Key", "Asset Key must be unique."));
            continue;
        }
        if alt_text.is_empty() {
            issues.push(issue(
                excel_row,
                "Alt Text",
                "Alternative text is required for every SAT visual.",
            ));
        }
        let Some((content_type, extension)) =
            supported_image_type(&picture.extension, &picture.data)
        else {
            issues.push(issue(
                excel_row,
                "Image",
                "Use PNG, JPEG, GIF, or WebP images.",
            ));
            continue;
        };
        let checksum_sha256 = format!("{:x}", Sha256::digest(&picture.data));
        assets.push(SatWorkbookAsset {
            key: key.clone(),
            file_name: format!("{key}.{extension}"),
            content_type: content_type.to_owned(),
            size_bytes: picture.data.len(),
            checksum_sha256,
            alt_text,
            caption,
            data_base64: Some(BASE64_STANDARD.encode(&picture.data)),
        });
    }
    for (index, row) in range.rows().enumerate().skip(1) {
        let key = row
            .first()
            .and_then(DataType::as_string)
            .unwrap_or_default();
        if !key.trim().is_empty() && !seen_rows.contains(&(index as u32)) {
            issues.push(issue(
                index + 1,
                "Image",
                "This asset row has metadata but no embedded image in the Image column.",
            ));
        }
    }
    Ok(assets)
}

fn valid_asset_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
}

fn supported_image_type(extension: &str, bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    let ext = extension.trim().to_ascii_lowercase();
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && ext == "png" {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) && matches!(ext.as_str(), "jpg" | "jpeg") {
        Some(("image/jpeg", "jpg"))
    } else if (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) && ext == "gif" {
        Some(("image/gif", "gif"))
    } else if bytes.len() >= 12
        && &bytes[..4] == b"RIFF"
        && &bytes[8..12] == b"WEBP"
        && ext == "webp"
    {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

fn resolve_workbook_asset_references(
    draft: &mut BatchQuestionDraft,
    assets: &HashMap<String, SatWorkbookAsset>,
    excel_row: usize,
    issues: &mut Vec<SatWorkbookIssue>,
) {
    for content in [&mut draft.stimulus, &mut draft.prompt, &mut draft.rationale] {
        resolve_assets_in_content(content, assets, excel_row, issues);
    }
    if let AnswerDefinition::SingleChoice { options, .. } = &mut draft.answer {
        for option in options {
            resolve_assets_in_content(&mut option.content, assets, excel_row, issues);
        }
    }
}

fn resolve_assets_in_content(
    content: &mut StructuredContent,
    assets: &HashMap<String, SatWorkbookAsset>,
    excel_row: usize,
    issues: &mut Vec<SatWorkbookIssue>,
) {
    let Some(document) = content.document.as_mut() else {
        return;
    };
    visit_json_nodes(document, &mut |node| {
        if node.get("type").and_then(Value::as_str) != Some("image") {
            return;
        }
        let Some(attrs) = node.get_mut("attrs").and_then(Value::as_object_mut) else {
            return;
        };
        let Some(asset_id) = attrs.get("assetId").and_then(Value::as_str) else {
            return;
        };
        let Some(key) = asset_id.strip_prefix("workbook:") else {
            return;
        };
        let Some(asset) = assets.get(key) else {
            issues.push(issue(
                excel_row,
                "Image",
                &format!(
                    "Workbook asset “{key}” is referenced but not defined on the Assets sheet."
                ),
            ));
            return;
        };
        attrs.insert("alt".to_owned(), Value::String(asset.alt_text.clone()));
        attrs.insert(
            "caption".to_owned(),
            asset
                .caption
                .clone()
                .map(Value::String)
                .unwrap_or(Value::Null),
        );
    });
}

fn visit_json_nodes(
    value: &mut Value,
    visitor: &mut impl FnMut(&mut serde_json::Map<String, Value>),
) {
    match value {
        Value::Object(map) => {
            visitor(map);
            for child in map.values_mut() {
                visit_json_nodes(child, visitor);
            }
        }
        Value::Array(values) => {
            for child in values {
                visit_json_nodes(child, visitor);
            }
        }
        _ => {}
    }
}

fn workbook_field_for_path(path: &str) -> &'static str {
    if path.starts_with("prompt") {
        "Prompt"
    } else if path.starts_with("stimulus") {
        "Stimulus"
    } else if path.starts_with("rationale") {
        "Rationale"
    } else if path.starts_with("metadata.domain") {
        "Domain"
    } else if path.starts_with("metadata.skill") {
        "Skill"
    } else if path.starts_with("answer.acceptedResponses") {
        "Accepted Responses"
    } else if path.starts_with("answer") {
        "Answer"
    } else {
        "Question"
    }
}

fn empty_preview(issues: Vec<SatWorkbookIssue>) -> SatWorkbookPreview {
    SatWorkbookPreview {
        import_id: uuid::Uuid::new_v4().to_string(),
        template_version: TEMPLATE_VERSION.to_owned(),
        row_count: 0,
        question_count: 0,
        valid: false,
        modules: vec![],
        assets: vec![],
        issues,
    }
}

fn resolve_columns(row: &[calamine::Data]) -> HashMap<String, usize> {
    row.iter()
        .enumerate()
        .filter_map(|(index, cell)| {
            let value = normalize(&cell.as_string().unwrap_or_default());
            (!value.is_empty()).then_some((value, index))
        })
        .collect()
}

fn row_values(
    row: &[calamine::Data],
    columns: &HashMap<String, usize>,
    excel_row: usize,
    issues: &mut Vec<SatWorkbookIssue>,
) -> Option<HashMap<&'static str, String>> {
    let keys = [
        "module",
        "order",
        "prompt",
        "stimulus",
        "response type",
        "a",
        "b",
        "c",
        "d",
        "correct",
        "accepted responses",
        "domain",
        "skill",
        "difficulty",
        "pretest",
        "rationale",
        "tags",
    ];
    let mut values = HashMap::with_capacity(keys.len());
    let mut oversized = false;
    for key in keys {
        let value = columns
            .get(key)
            .and_then(|index| row.get(*index))
            .and_then(DataType::as_string)
            .unwrap_or_default();
        if value.chars().count() > MAX_CELL_CHARS {
            issues.push(issue(
                excel_row,
                &title_case(key),
                "Cell content is too large. Keep each cell under 50,000 characters.",
            ));
            oversized = true;
        }
        values.insert(key, value);
    }
    (!oversized).then_some(values)
}

fn parse_order(
    value: &str,
    max: usize,
    row: usize,
    issues: &mut Vec<SatWorkbookIssue>,
) -> Option<usize> {
    let parsed = value.trim().parse::<usize>().ok();
    if parsed.is_none_or(|value| value == 0 || value > max) {
        issues.push(issue(
            row,
            "Order",
            &format!("Order must be a whole number from 1 to {max}."),
        ));
        return None;
    }
    parsed
}

fn resolve_module(value: &str) -> Option<ModuleSpec> {
    let value = normalize(value);
    MODULES
        .iter()
        .copied()
        .find(|module| normalize(module.key) == value || normalize(module.label) == value)
}

fn resolve_skill(domain: &str, value: &str) -> Option<&'static str> {
    let normalized = normalize(value);
    skills_for_domain(domain)
        .iter()
        .copied()
        .find(|skill| normalize(skill) == normalized)
}

fn skills_for_domain(domain: &str) -> &'static [&'static str] {
    match domain {
        "information-and-ideas" => INFORMATION_AND_IDEAS_SKILLS,
        "craft-and-structure" => CRAFT_AND_STRUCTURE_SKILLS,
        "expression-of-ideas" => EXPRESSION_OF_IDEAS_SKILLS,
        "standard-english-conventions" => STANDARD_ENGLISH_CONVENTIONS_SKILLS,
        "algebra" => ALGEBRA_SKILLS,
        "advanced-math" => ADVANCED_MATH_SKILLS,
        "problem-solving-and-data-analysis" => PROBLEM_SOLVING_SKILLS,
        "geometry-and-trigonometry" => GEOMETRY_SKILLS,
        _ => &[],
    }
}

fn resolve_domain(section_key: &str, value: &str) -> Option<&'static str> {
    let normalized = normalize(value);
    domain_catalog().into_iter().find_map(|(key, label)| {
        (valid_sat_domain(section_key, key)
            && (normalize(key) == normalized || normalize(label) == normalized))
            .then_some(key)
    })
}

fn parse_difficulty(value: &str) -> Option<Difficulty> {
    match normalize(value).as_str() {
        "easy" => Some(Difficulty::Easy),
        "medium" => Some(Difficulty::Medium),
        "hard" => Some(Difficulty::Hard),
        _ => None,
    }
}

fn parse_bool(value: &str) -> Option<bool> {
    match normalize(value).as_str() {
        "yes" | "true" | "1" => Some(true),
        "no" | "false" | "0" => Some(false),
        _ => None,
    }
}

fn split_list(value: &str) -> Vec<String> {
    value
        .split([';', '|'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn split_tags(value: &str) -> Vec<String> {
    value
        .split([',', ';'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn normalize(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn title_case(value: &str) -> String {
    value
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            chars
                .next()
                .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn issue(row: usize, field: &str, message: &str) -> SatWorkbookIssue {
    SatWorkbookIssue {
        row,
        field: field.to_owned(),
        message: message.to_owned(),
        blocking: true,
    }
}

fn template_error(error: XlsxError) -> SatWorkbookError {
    SatWorkbookError::Template(error.to_string())
}

fn domain_catalog() -> [(&'static str, &'static str); 8] {
    [
        ("information-and-ideas", "Information and Ideas"),
        ("craft-and-structure", "Craft and Structure"),
        ("expression-of-ideas", "Expression of Ideas"),
        (
            "standard-english-conventions",
            "Standard English Conventions",
        ),
        ("algebra", "Algebra"),
        ("advanced-math", "Advanced Math"),
        (
            "problem-solving-and-data-analysis",
            "Problem-Solving and Data Analysis",
        ),
        ("geometry-and-trigonometry", "Geometry and Trigonometry"),
    ]
}

fn domain_labels() -> Vec<String> {
    domain_catalog()
        .into_iter()
        .map(|(_, label)| label.to_owned())
        .collect()
}

fn skill_labels() -> Vec<String> {
    [
        INFORMATION_AND_IDEAS_SKILLS,
        CRAFT_AND_STRUCTURE_SKILLS,
        EXPRESSION_OF_IDEAS_SKILLS,
        STANDARD_ENGLISH_CONVENTIONS_SKILLS,
        ALGEBRA_SKILLS,
        ADVANCED_MATH_SKILLS,
        PROBLEM_SOLVING_SKILLS,
        GEOMETRY_SKILLS,
    ]
    .into_iter()
    .flat_map(|skills| skills.iter().copied())
    .map(ToOwned::to_owned)
    .collect()
}

pub fn compile_rich_content(source: &str) -> StructuredContent {
    let source = source.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = source.lines().collect();
    let mut nodes = Vec::new();
    let mut index = 0usize;
    while index < lines.len() {
        let line = lines[index];
        if line.trim().is_empty() {
            index += 1;
            continue;
        }
        if let Some(node) = parse_image_reference(line) {
            nodes.push(node);
            index += 1;
            continue;
        }
        if let Some((node, next)) = parse_fenced_code(&lines, index) {
            nodes.push(node);
            index = next;
            continue;
        }
        if let Some((node, next)) = parse_block_math(&lines, index) {
            nodes.push(node);
            index = next;
            continue;
        }
        if let Some((node, next)) = parse_table(&lines, index) {
            nodes.push(node);
            index = next;
            continue;
        }
        if let Some(text) = line.strip_prefix("### ") {
            nodes.push(json!({"type":"heading","attrs":{"level":3},"content":inline_nodes(text)}));
            index += 1;
            continue;
        }
        if let Some(text) = line.strip_prefix("## ") {
            nodes.push(json!({"type":"heading","attrs":{"level":2},"content":inline_nodes(text)}));
            index += 1;
            continue;
        }
        if is_bullet(line) {
            let (node, next) = parse_list(&lines, index, false);
            nodes.push(node);
            index = next;
            continue;
        }
        if is_ordered(line) {
            let (node, next) = parse_list(&lines, index, true);
            nodes.push(node);
            index = next;
            continue;
        }
        let start = index;
        index += 1;
        while index < lines.len() && !lines[index].trim().is_empty() && !starts_block(&lines, index)
        {
            index += 1;
        }
        let paragraph = lines[start..index].join("\n");
        nodes.push(json!({"type":"paragraph","content":inline_nodes(&paragraph)}));
    }
    if nodes.is_empty() {
        nodes.push(json!({"type":"paragraph"}));
    }
    StructuredContent {
        version: 2,
        nodes: vec![],
        document: Some(json!({"type":"doc","content":nodes})),
    }
}

fn starts_block(lines: &[&str], index: usize) -> bool {
    let line = lines[index];
    parse_image_reference(line).is_some()
        || line.starts_with("```")
        || line.trim_start().starts_with("\\[")
        || line.trim_start().starts_with("$$")
        || line.starts_with("## ")
        || line.starts_with("### ")
        || is_bullet(line)
        || is_ordered(line)
        || is_table_start(lines, index)
}

fn parse_image_reference(line: &str) -> Option<Value> {
    let trimmed = line.trim();
    let key = trimmed.strip_prefix("![")?.strip_suffix(']')?.trim();
    if !valid_asset_key(key) {
        return None;
    }
    Some(json!({
        "type": "image",
        "attrs": {
            "assetId": format!("workbook:{key}"),
            "alt": "",
            "caption": Value::Null
        }
    }))
}

fn parse_fenced_code(lines: &[&str], start: usize) -> Option<(Value, usize)> {
    let first = lines[start].trim_start();
    if !first.starts_with("```") {
        return None;
    }
    let mut body = Vec::new();
    let mut index = start + 1;
    while index < lines.len() && !lines[index].trim_start().starts_with("```") {
        body.push(lines[index]);
        index += 1;
    }
    if index < lines.len() {
        index += 1;
    }
    let text = body.join("\n");
    Some((
        json!({"type":"codeBlock","content":[{"type":"text","text":text}]}),
        index,
    ))
}

fn parse_block_math(lines: &[&str], start: usize) -> Option<(Value, usize)> {
    let trimmed = lines[start].trim();
    let (open, close) = if trimmed.starts_with("\\[") {
        ("\\[", "\\]")
    } else if trimmed.starts_with("$$") {
        ("$$", "$$")
    } else {
        return None;
    };
    if trimmed.len() >= open.len() + close.len() && trimmed.ends_with(close) && trimmed != open {
        let latex = trimmed[open.len()..trimmed.len() - close.len()].trim();
        return Some((
            json!({"type":"blockMath","attrs":{"latex":latex}}),
            start + 1,
        ));
    }
    let mut body = Vec::new();
    let first_remainder = trimmed.strip_prefix(open).unwrap_or_default().trim();
    if !first_remainder.is_empty() {
        body.push(first_remainder);
    }
    let mut index = start + 1;
    while index < lines.len() {
        let current = lines[index].trim();
        if current.ends_with(close) {
            let value = current.strip_suffix(close).unwrap_or(current).trim();
            if !value.is_empty() {
                body.push(value);
            }
            index += 1;
            break;
        }
        body.push(current);
        index += 1;
    }
    Some((
        json!({"type":"blockMath","attrs":{"latex":body.join("\n")}}),
        index,
    ))
}

fn parse_table(lines: &[&str], start: usize) -> Option<(Value, usize)> {
    if !is_table_start(lines, start) {
        return None;
    }
    let headers = split_table_row(lines[start]);
    let mut rows = vec![
        json!({"type":"tableRow","content":headers.into_iter().map(|cell| json!({"type":"tableHeader","content":[{"type":"paragraph","content":inline_nodes(&cell)}]})).collect::<Vec<_>>()}),
    ];
    let mut index = start + 2;
    while index < lines.len() && lines[index].contains('|') && !lines[index].trim().is_empty() {
        let cells = split_table_row(lines[index]);
        rows.push(json!({"type":"tableRow","content":cells.into_iter().map(|cell| json!({"type":"tableCell","content":[{"type":"paragraph","content":inline_nodes(&cell)}]})).collect::<Vec<_>>() }));
        index += 1;
    }
    Some((json!({"type":"table","content":rows}), index))
}

fn is_table_start(lines: &[&str], index: usize) -> bool {
    if index + 1 >= lines.len() || !lines[index].contains('|') {
        return false;
    }
    let separator = split_table_row(lines[index + 1]);
    !separator.is_empty()
        && separator.iter().all(|cell| {
            let value = cell.trim().trim_matches(':');
            value.len() >= 3 && value.chars().all(|ch| ch == '-')
        })
}

fn split_table_row(line: &str) -> Vec<String> {
    line.trim()
        .trim_matches('|')
        .split('|')
        .map(|cell| cell.trim().to_owned())
        .collect()
}

fn is_bullet(line: &str) -> bool {
    line.starts_with("- ") || line.starts_with("* ")
}

fn is_ordered(line: &str) -> bool {
    let Some((prefix, _)) = line.split_once(". ") else {
        return false;
    };
    !prefix.is_empty() && prefix.chars().all(|ch| ch.is_ascii_digit())
}

fn parse_list(lines: &[&str], start: usize, ordered: bool) -> (Value, usize) {
    let mut items = Vec::new();
    let mut index = start;
    while index < lines.len() {
        let line = lines[index];
        let content = if ordered {
            line.split_once(". ").and_then(|(prefix, text)| {
                prefix.chars().all(|ch| ch.is_ascii_digit()).then_some(text)
            })
        } else {
            line.strip_prefix("- ").or_else(|| line.strip_prefix("* "))
        };
        let Some(content) = content else {
            break;
        };
        items.push(json!({"type":"listItem","content":[{"type":"paragraph","content":inline_nodes(content)}]}));
        index += 1;
    }
    let kind = if ordered { "orderedList" } else { "bulletList" };
    (json!({"type":kind,"content":items}), index)
}

fn inline_nodes(source: &str) -> Vec<Value> {
    let mut nodes = Vec::new();
    let mut rest = source;
    while !rest.is_empty() {
        let candidates = [
            rest.find("\\(").map(|index| (index, "math")),
            rest.find("**").map(|index| (index, "bold")),
            rest.find('*').map(|index| (index, "italic")),
            rest.find('`').map(|index| (index, "code")),
        ];
        let next = candidates
            .into_iter()
            .flatten()
            .min_by_key(|(index, _)| *index);
        let Some((index, kind)) = next else {
            push_text(&mut nodes, rest, None);
            break;
        };
        if index > 0 {
            push_text(&mut nodes, &rest[..index], None);
            rest = &rest[index..];
            continue;
        }
        match kind {
            "math" => {
                if let Some(end) = rest[2..].find("\\)") {
                    let latex = &rest[2..2 + end];
                    nodes.push(json!({"type":"inlineMath","attrs":{"latex":latex}}));
                    rest = &rest[2 + end + 2..];
                } else {
                    push_text(&mut nodes, "\\(", None);
                    rest = &rest[2..];
                }
            }
            "bold" => parse_mark(&mut nodes, &mut rest, "**", "bold"),
            "italic" => parse_mark(&mut nodes, &mut rest, "*", "italic"),
            "code" => parse_mark(&mut nodes, &mut rest, "`", "code"),
            _ => unreachable!(),
        }
    }
    nodes
}

fn parse_mark<'a>(nodes: &mut Vec<Value>, rest: &mut &'a str, delimiter: &str, mark: &str) {
    let after = &rest[delimiter.len()..];
    if let Some(end) = after.find(delimiter) {
        let text = &after[..end];
        push_text(nodes, text, Some(mark));
        *rest = &after[end + delimiter.len()..];
    } else {
        push_text(nodes, delimiter, None);
        *rest = after;
    }
}

fn push_text(nodes: &mut Vec<Value>, text: &str, mark: Option<&str>) {
    if text.is_empty() {
        return;
    }
    match mark {
        Some(mark) => nodes.push(json!({"type":"text","text":text,"marks":[{"type":mark}]})),
        None => nodes.push(json!({"type":"text","text":text})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn compiler_preserves_math_tables_code_and_emphasis() {
        let content = compile_rich_content("A **bold** value \\(x^2\\).\n\n| x | y |\n| --- | --- |\n| 1 | 2 |\n\n```python\nprint(1)\n```");
        let document = content.document.expect("document");
        let types: Vec<_> = document["content"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node| node["type"].as_str().unwrap())
            .collect();
        assert_eq!(types, vec!["paragraph", "table", "codeBlock"]);
        assert_eq!(
            document["content"][0]["content"][1]["marks"][0]["type"],
            "bold"
        );
        assert_eq!(document["content"][0]["content"][3]["type"], "inlineMath");
    }

    #[test]
    fn generated_template_round_trips_as_xlsx() {
        let bytes = build_sat_workbook_template().expect("template");
        assert!(bytes.starts_with(b"PK"));
        let preview = parse_sat_workbook(&bytes).expect("parse template");
        assert_eq!(preview.row_count, 147);
        assert_eq!(preview.template_version, "2");
        assert!(!preview.valid);
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
            assert!(
                instructions.contains(required),
                "AI instructions omitted {required:?}"
            );
        }

        assert!(!instructions.trim().is_empty());
        assert!(instructions.chars().count() < 32_000);
    }

    #[test]
    fn complete_workbook_parses_all_six_modules_and_rich_content() {
        let bytes = complete_workbook_bytes();
        let preview = parse_sat_workbook(&bytes).expect("parse complete workbook");
        assert!(preview.valid, "issues: {:?}", preview.issues);
        assert_eq!(preview.question_count, 147);
        assert_eq!(preview.modules.len(), 6);
        assert!(preview.modules.iter().all(|module| module
            .questions
            .iter()
            .filter(|question| question.is_pretest)
            .count()
            == 2));

        let first = &preview.modules[0].questions[0];
        assert_eq!(
            first.metadata.skill.as_deref(),
            Some("Central Ideas and Details")
        );
        let document = first.prompt.document.as_ref().expect("rich prompt");
        let types: Vec<_> = document["content"]
            .as_array()
            .unwrap()
            .iter()
            .map(|node| node["type"].as_str().unwrap())
            .collect();
        assert!(types.contains(&"blockMath"));
        assert!(types.contains(&"table"));
        assert!(types.contains(&"codeBlock"));
    }

    #[test]
    fn embedded_asset_round_trips_and_resolves_into_question_content() {
        let mut workbook = complete_workbook("![graph_01]");
        let assets = workbook.add_worksheet();
        assets.set_name(ASSETS_SHEET).unwrap();
        for (column, header) in ["Asset Key", "Alt Text", "Caption", "Image"]
            .iter()
            .enumerate()
        {
            assets.write(0, column as u16, *header).unwrap();
        }
        assets.write(1, 0, "graph_01").unwrap();
        assets.write(1, 1, "A simple test graph").unwrap();
        assets.write(1, 2, "Workbook visual").unwrap();
        let png = BASE64_STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
            .unwrap();
        let image = rust_xlsxwriter::Image::new_from_buffer(&png).unwrap();
        assets.insert_image(1, 3, &image).unwrap();

        let bytes = workbook.save_to_buffer().unwrap();
        let preview = parse_sat_workbook(&bytes).expect("parse workbook with embedded image");
        assert!(preview.valid, "issues: {:?}", preview.issues);
        assert_eq!(preview.assets.len(), 1);
        let asset = &preview.assets[0];
        assert_eq!(asset.key, "graph_01");
        assert_eq!(asset.content_type, "image/png");
        assert_eq!(asset.alt_text, "A simple test graph");
        assert_eq!(asset.caption.as_deref(), Some("Workbook visual"));
        assert_eq!(
            asset.data_base64.as_deref(),
            Some(BASE64_STANDARD.encode(&png).as_str())
        );

        let document = preview.modules[0].questions[0]
            .prompt
            .document
            .as_ref()
            .expect("rich prompt");
        let image = &document["content"][0];
        assert_eq!(image["type"], "image");
        assert_eq!(image["attrs"]["assetId"], "workbook:graph_01");
        assert_eq!(image["attrs"]["alt"], "A simple test graph");
        assert_eq!(image["attrs"]["caption"], "Workbook visual");
    }

    fn complete_workbook_bytes() -> Vec<u8> {
        complete_workbook(
            r#"Question with math:
\[x^2=4\]

| x | y |
| --- | --- |
| 1 | 2 |

```python
print(1)
```"#,
        )
        .save_to_buffer()
        .unwrap()
    }

    fn complete_workbook(first_prompt: &str) -> Workbook {
        let mut workbook = Workbook::new();
        let sheet = workbook.add_worksheet();
        sheet.set_name(QUESTIONS_SHEET).unwrap();
        for (column, header) in HEADERS.iter().enumerate() {
            sheet.write(0, column as u16, *header).unwrap();
        }
        let mut row = 1u32;
        for module in MODULES {
            for order in 1..=module.count {
                let prompt = if row == 1 {
                    first_prompt
                } else {
                    "Which answer is correct?"
                };
                let (domain, skill) = if module.section_key == "math" {
                    ("Algebra", "linear equations in one variable")
                } else {
                    ("Information and Ideas", "central ideas and details")
                };
                let values = [
                    module.label.to_owned(),
                    order.to_string(),
                    prompt.to_owned(),
                    String::new(),
                    "Multiple Choice".to_owned(),
                    "Choice A".to_owned(),
                    "Choice B".to_owned(),
                    "Choice C".to_owned(),
                    "Choice D".to_owned(),
                    "A".to_owned(),
                    String::new(),
                    domain.to_owned(),
                    skill.to_owned(),
                    "Medium".to_owned(),
                    if order <= 2 {
                        "Yes".to_owned()
                    } else {
                        "No".to_owned()
                    },
                    "Rationale".to_owned(),
                    "workbook-test".to_owned(),
                ];
                for (column, value) in values.iter().enumerate() {
                    sheet.write(row, column as u16, value).unwrap();
                }
                row += 1;
            }
        }
        workbook
    }
}
