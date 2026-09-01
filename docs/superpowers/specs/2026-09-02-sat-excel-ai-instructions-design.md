# SAT Excel AI Instructions Design

## Status

Approved design. This change improves the existing **Import SAT from Excel** template so an AI tool can understand the SAT authoring contract and generate a valid, complete question workbook. It does not add an in-app AI assistant or change the import data model.

## Goal

Give an AI enough context to create a complete Digital SAT question workbook using the current Excel format and the rich-content syntax already supported by the importer. The workbook must explain both:

1. how an author or AI should fill each field; and
2. where that field appears in the authoring system and student exam.

## Product decision

The first version is **workbook-only**. The downloaded template will contain a visible `AI Instructions` sheet with a copyable system prompt and reference material.

The AI instructions target a complete workbook because the existing full-workbook import requires:

- all six SAT modules;
- 147 total questions;
- 27 questions in each Reading & Writing module;
- 22 questions in each Math module; and
- exactly two pretest questions per module.

Partial workbook generation and merge/import behavior are out of scope.

## Current behavior

The existing template contains:

- `Questions` — one row per question;
- `Guide` — short human-oriented formatting examples;
- `Assets` — embedded images and their accessibility metadata; and
- hidden `_SAT` — template metadata and taxonomy validation values.

The existing parser reads `Questions` and `Assets`, converts supported rich text into structured content, previews it with the authoring/student renderer, validates the complete SAT structure, and commits the draft atomically. Extra visible sheets are not question data and are ignored by the parser.

The current authoring editor supports richer UI interactions than the workbook syntax exposes. This design documents only the syntax that the current workbook parser can reliably convert.

## Feature contract

```text
Actor: SAT builder or administrator using an AI tool
Trigger: Download the SAT Excel template and ask an AI to create the exam
Preconditions: The AI receives the template or the copied AI Instructions prompt
Expected behavior: The AI fills the existing Questions and Assets sheets without changing their contract
State transition: No application state changes until the completed workbook is uploaded and imported
Visible result: Preview shows the same structured question content that students will receive
Persistence: Existing atomic SAT workbook commit only
Side effects: None from the instructions sheet itself
Failure behavior: Existing row/field validation and import errors remain authoritative
Authorization: Existing staff/SAT authorization for template download and import
Out of scope: In-app AI calls, partial merges, and importing delivery settings from Excel
```

## Workbook structure

The generated workbook will contain these visible sheets:

1. `Questions` — the only sheet used for question rows.
2. `Guide` — concise human instructions and formatting examples.
3. `Assets` — images/graphs, keys, alt text, and captions.
4. `AI Instructions` — the AI system prompt, field semantics, rendering context, rich-content syntax, and validation checklist.

The hidden `_SAT` sheet remains unchanged except for the template version value.

### AI Instructions layout

The sheet should be easy to read in Excel and easy to copy into an AI tool:

- a title and purpose row;
- a clearly labeled `System prompt — copy this into your AI tool` area containing one complete, line-break-preserving prompt;
- a field-by-field reference table;
- a rich-content syntax table with examples;
- a student-rendering and authoring-context section;
- a complete SAT structure and quality checklist; and
- a note that timing, adaptive routing, calculator policy, and release settings are configured on the existing Release page, not imported from this workbook.

The copyable prompt must remain below Excel's per-cell text limit. Reference details may be split into separate cells/rows so the sheet remains readable without requiring one oversized cell.

## AI system prompt requirements

The prompt must tell the AI to:

### Preserve the workbook contract

- edit the supplied template rather than replacing it with a different format;
- preserve the exact sheet names and `Questions` headers;
- write question content into the existing rows/columns;
- keep the hidden `_SAT` sheet intact;
- avoid formulas and unsupported columns;
- return an `.xlsx` workbook suitable for **Import SAT from Excel**; and
- keep all content within the workbook's cell and file-size limits.

### Produce the complete SAT structure

- create exactly 147 questions across the six required modules;
- use the exact module labels from the template;
- number `Order` from 1 through the module's target count without duplicates;
- mark exactly two rows per module as `Pretest=Yes`;
- use Reading & Writing domains/skills only in Reading & Writing modules;
- use Math domains/skills only in Math modules; and
- use `Multiple Choice` for Reading & Writing and either `Multiple Choice` or `Student Response` for Math.

### Create valid SAT question content

- put the exact student-visible question in `Prompt`;
- use `Stimulus` for passages, context, data, tables, graphs, or notes when the item requires supporting material;
- provide four complete options and one unambiguous `Correct` answer for multiple choice;
- provide one primary answer plus valid equivalents in `Accepted Responses` for student-response Math items;
- put a concise explanation in `Rationale` for staff review;
- choose the correct domain, skill, difficulty, tags, and pretest metadata;
- verify calculations, distractors, grammar, and the rationale before returning the workbook; and
- create original SAT-style practice content rather than claiming that content is official.

### Use supported rich content

The prompt must include the supported syntax and explain that syntax is converted into the structured rich editor content used by the system. It must not promise unsupported workbook syntax.

### Handle assets accessibly

- place every embedded visual on the `Assets` sheet;
- use a unique asset key containing only allowed characters;
- provide meaningful alt text;
- provide an optional caption; and
- reference the asset from `Prompt` or `Stimulus` with `![asset_key]` on its own line.

### Explain settings boundaries

The AI may understand the system's timing, adaptive routing, calculator, and release concepts for context, but it must not invent settings columns or assume that settings written into arbitrary cells will be imported. Those settings remain managed on the Release page.

## Field and rendering reference

The AI Instructions sheet must describe this mapping:

| Excel field | Authoring meaning | Student visibility |
| --- | --- | --- |
| `Module` | Destination SAT module and adaptive branch | Not shown as raw metadata; determines placement |
| `Order` | Position within the module | Determines question order |
| `Prompt` | Main question content | Shown as the question students answer |
| `Stimulus` | Supporting passage, data, context, or visual content | Shown with the question when present |
| `Response Type` | Multiple choice or Math student response | Determines the response control |
| `A`–`D` | Four answer choices | Shown for multiple choice |
| `Correct` | Internal choice answer key | Never shown to students |
| `Accepted Responses` | Internal equivalent answers for Math student response | Never shown to students |
| `Domain` / `Skill` | SAT taxonomy classification | Internal authoring/review metadata |
| `Difficulty` | Authoring classification | Internal metadata |
| `Pretest` | SAT assessment metadata | Internal system behavior |
| `Rationale` | Staff explanation of the answer | Internal; not shown to students |
| `Tags` | Searchable internal labels | Internal metadata |
| `Assets` metadata | Visual key, accessibility text, and caption | Image/caption render; alt text supports assistive technology |

The reference must explain that Reading & Writing supporting material can be presented alongside the question in the student workspace, while Math supporting material is presented in the Math question flow. Exact placement remains owned by the existing renderer, not by the AI prompt.

## Supported rich-content syntax

The instructions must document these conversions:

| Syntax | Result |
| --- | --- |
| `**bold**` | Bold text |
| `*italic*` | Italic text |
| `` `code` `` | Inline code formatting |
| `\\(x^2+1\\)` | Inline equation |
| `\\[x^2+1=5\\]` | Display equation |
| `## Heading` or `### Heading` | Heading/subheading |
| `- item` or `* item` | Bulleted list |
| `1. item` | Numbered list |
| Markdown table rows | Structured table |
| Fenced code block | Code block |
| `![graph_01]` | Workbook asset reference |

The prompt must tell the AI to keep image references on their own line and to match every reference to exactly one `Asset Key` row with an embedded image.

Underline, superscript, and subscript are available in parts of the interactive editor but are not included as Excel syntax in this version. The AI instructions must not tell the AI to generate those markers.

## Architecture and change surface

### Must change

- `backend/crates/application/src/sat_workbook.rs`
  - add the `AI Instructions` worksheet;
  - expand the `Guide` reference content;
  - add the copyable system prompt/reference data;
  - update the generated template version from `1` to `2`.

- focused Rust tests in the existing workbook test module
  - verify sheet presence, template version, prompt content, field mapping, rich syntax examples, and the existing complete-workbook round trip.

### Must verify unchanged

- `parse_sat_workbook` continues to read only `Questions` and `Assets` for content;
- the new sheet cannot become an imported question or asset;
- all existing row, asset, formula, size, module, pretest, and rich-content validation remains unchanged;
- preview, staged asset upload, atomic commit, undo, and version-conflict behavior remain unchanged;
- the frontend importer and authoring/student renderers require no contract changes; and
- IELTS and non-SAT behavior remain unchanged.

### No change

- no AI provider dependency or API endpoint;
- no database migration;
- no new frontend AI state;
- no partial workbook merge behavior;
- no Excel-driven delivery-settings mutation; and
- no expansion of Excel syntax beyond the currently supported parser behavior.

## Data flow

```text
Builder downloads template
  → AI reads/copies AI Instructions
  → AI fills Questions and, when needed, Assets
  → Builder uploads .xlsx
  → Existing parser validates Questions/Assets
  → Existing preview renders structured content
  → Builder reviews actual student renderer
  → Existing atomic commit saves the complete SAT draft
  → Release page configures timing/routing/settings
  → Published student exam receives the committed question content
```

The instruction sheet is never sent through the content parser as question data and has no persistence side effect.

## Error and safety behavior

- A malformed or incomplete AI-generated workbook continues to produce the existing row/field diagnostics.
- The Import button remains disabled when preview validation fails.
- Missing, invalid, or inaccessible assets remain blocking issues.
- Formulas remain rejected.
- The workbook size, cell-size, archive-expansion, asset-count, and asset-byte safeguards remain authoritative.
- The AI prompt cannot bypass server-side validation or authorization.
- No draft changes occur until the existing explicit Import action succeeds.

## Testing strategy

Use generated XLSX workbooks rather than committing binary fixtures.

### Template tests

- generated bytes are a readable `.xlsx` ZIP;
- the workbook contains `Questions`, `Guide`, `Assets`, `AI Instructions`, and `_SAT`;
- `_SAT.templateVersion` is `2`;
- the copyable prompt is non-empty and below the Excel cell-size limit;
- the prompt mentions all six modules, 147 questions, module counts, pretest counts, field names, rich syntax, assets, and Release-page settings; and
- the Guide and AI Instructions sheets contain no accidental formulas or unsupported promises.

### Regression tests

- the generated template still round-trips through the existing parser;
- a complete generated workbook still previews as 147 questions across six modules;
- rich content still produces the same structured node types;
- asset references still resolve and retain alt text/caption;
- invalid question and asset inputs retain their existing diagnostics; and
- existing frontend import, authoring, rendering, and SAT delivery tests remain unchanged and pass.

## Acceptance criteria

1. Downloading the SAT template exposes a visible `AI Instructions` sheet.
2. A builder can copy one clearly labeled system prompt from that sheet into an AI tool.
3. The prompt explains the complete 147-question workbook contract.
4. The prompt explains every Questions field and whether it is visible to students, staff-only, or used for placement/assessment behavior.
5. The prompt explains all rich-content syntax currently accepted by the importer.
6. The prompt explains the Assets workflow and accessibility requirements.
7. The prompt explains that delivery settings remain on the Release page.
8. Adding the sheet does not change import parsing, preview, atomic commit, undo, or delivery behavior.
9. Existing generated-workbook and SAT importer tests continue to pass.

## Rollout and rollback

This is a backward-compatible template enhancement. New downloads use template version `2`. Existing version `1` workbooks remain importable because the parser does not require `AI Instructions`.

If the new template content causes an issue, rollback only the template-generation change. No persisted question data, database migration, or API compatibility window is introduced.

## Unresolved decisions

None. The approved scope is the workbook-only AI context, complete-workbook generation, and current Excel rich-content syntax.
