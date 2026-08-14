# Grading Export (UI)

This document describes the grading export behavior in the admin grading session detail UI.

## Invariants

- Exports are **read-only**: exporting must not mutate submissions, answers, grades, or review state.
- If a selected section has no stored submission data for a student, the export must still produce that student's PDF and show **"No submission"** for that section.

## Export Menu (per grading session UI)

The grading session detail page exposes a single **Export** dropdown menu that
keeps every export surface in one place:

- **Download CSV**: Reading answers & scores, Reading manual check sheet,
  Listening answers & scores, Listening manual check sheet
- **Print**: Print all writing (task pages with prompts, responses, assessment forms)
- **Export Builder · PDF ZIP**: per-student PDF export dialog

The menu lives in `GradingExportButtons` and opens the existing
`PerStudentZipPdfExportDialog` (Export Builder) directly; the former
UI-level export mode selector and its `grading:<sessionId>:exportMode`
localStorage key are no longer used.

## Per-student ZIP (PDF) export

The primary bulk-export surface is the **Export Builder** (`src/components/admin/gradingExportBuilder/`).
It is deliberately split into two phases:

1. `exportPlan.ts` applies filters, keeps selection separate from the filter result, resolves canonical
   identity fields, groups folder segments, renders safe filenames, and reports warnings/conflicts.
2. `buildPerStudentZipPdfExportInput.ts` assembles the read-only section data and carries the plan's
   resolved output paths into the ZIP implementation.

`gradingPerStudentExport/studentPdf.ts` remains the PDF source of truth. The ZIP builder consumes the
plan's folder/filename outputs but does not change the renderer or PDF layout.

Canonical identity fields for export are `nickname`, `wcode`, `level`, and `fullName`. Until registration
metadata exposes a distinct level, the adapter uses the explicit `level` field when present and falls back
to the existing course value; it never parses display text.

The Export Builder dialog (opened from the Export menu) provides:

- Student picker: multi-select + search + select-all
- Section picker: Reading, Listening, and/or Writing
- PDF mode:
  - `combined`: one PDF per student containing the selected sections
  - `separate`: one folder per student, with one PDF per selected section

Output:

- A single `.zip` download
- One `.pdf` per selected student (combined mode), or one PDF per selected section (separate mode)
- `manifest.json` at the root of the ZIP, describing:
  - `mode = per_student_zip_pdf`
  - `generatedAt`
  - selected `sections`
  - `pdfMode`
  - per-student status (`ok` / `failed`)

PDF content:

- Every PDF page header shows the candidate identity in this order: `nickname (Wcode)`,
  `Course: <course> | Level: <level>`, and `Name: <full name>`. Missing optional identity fields
  use explicit fallback text so the header remains useful for legacy submissions.
- Reading/Listening: rendered as a teacher-friendly table: question, student answer, right answer, correct, score.
- Writing uses the same structure as the default **"Print all writing"** export (task pages with prompt, response, and assessment form), and includes the full essay text (plain text) when available.
- Missing section data is rendered as **"No submission"**.
- For `MULTI_MCQ`, the student-answer column maps the persisted submitted option-ID array to option text, while the right-answer column maps options marked `isCorrect`. A stale legacy `requiredSelections` value must affect neither column. The score is the number of selected marked-correct IDs out of the marked-correct count (for example, `2/5`); exact-set equality controls the correctness label separately.

The selected sections, PDF mode, and filename template are now part of the active Export Profile. The
legacy per-session preference keys are not the source of truth for the builder and are intentionally not
used to hydrate a profile.

The template affects **only** PDF filenames inside the ZIP (the ZIP filename remains unchanged). Unknown
placeholders are kept as literal text and the UI warns.

Notes:

- In `separate` PDF mode, use `{{section}}` in the template to generate distinct filenames per section and avoid ` (2)`, ` (3)` suffixes.

The default filename template is:

```text
{{nickname}} ({{wcode}}) - {{level}} - {{fullName}}.pdf
```

The builder preview shows the resolved folder tree, file count, missing identity warnings, and collision
resolution before generation. Profiles are stored through the shared `/v1/settings/export-profiles`
endpoint; `profileStorage.ts` keeps a browser-only fallback for offline/dev environments without changing
the plan or PDF seams.

### Export Builder UI invariant

The filter panel is designed to live inside a narrow column of the grading export dialog. Multi-value
filters must use compact trigger controls with checkbox options; native `select[multiple]` listboxes are
not allowed because they expand vertically, collide with adjacent controls, and make the export plan hard
to scan. The control must continue to emit the existing `ExportFilterState` arrays so filtering and
selection semantics remain unchanged.

## Owning modules and seams

Per-student ZIP export is intentionally split into a few deep modules to keep UI changes local and make PDF layout work safer:

- Dialog entrypoint: `src/components/admin/PerStudentZipPdfExportDialog.tsx`
- Export Builder UI: `src/components/admin/gradingExportBuilder/ExportBuilderDialog.tsx`
- Export plan domain: `src/components/admin/gradingExportBuilder/exportPlan.ts`
- Profile adapter: `src/components/admin/gradingExportBuilder/profileStorage.ts`
  - Responsibility: load/save organization-scoped profiles through the backend, with an offline/dev fallback.
- Export orchestrator (read-only data assembly seam): `src/components/admin/buildPerStudentZipPdfExportInput.ts`
  - Responsibility: fetch section submissions + writing submissions, build wide exports, and assemble `PerStudentZipPdfExportInput`.
  - Invariant: must not mutate grading/submission data.
- Export implementation (PDF renderers + ZIP/manifest builder):
  - Public entrypoint: `src/components/admin/gradingPerStudentExport.ts` (re-exports)
  - ZIP builder + manifest: `src/components/admin/gradingPerStudentExport/zipExport.ts`
  - Student PDF builder: `src/components/admin/gradingPerStudentExport/studentPdf.ts`
  - Objective table-row model: `src/components/admin/gradingPerStudentExport/objective/tableRows.ts`
  - Objective table renderer: `src/components/admin/gradingPerStudentExport/objective/renderTable.ts`
  - Writing renderer: `src/components/admin/gradingPerStudentExport/writing/renderWritingLikeDefaultPrint.ts`
