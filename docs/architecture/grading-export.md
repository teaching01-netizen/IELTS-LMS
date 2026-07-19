# Grading Export (UI)

This document describes the grading export behavior in the admin grading session detail UI.

## Invariants

- Exports are **read-only**: exporting must not mutate submissions, answers, grades, or review state.
- If a selected section has no stored submission data for a student, the export must still produce that student's PDF and show **"No submission"** for that section.

## Export Modes (per grading session UI)

The grading session detail page supports a UI-level export mode selector:

- `default`: existing CSV exports (Reading/Listening) and "Print all writing"
- `per_student_zip_pdf`: export selected students into a single ZIP containing one PDF per student

The selected mode is persisted **per grading session** using `localStorage`:

- `grading:<sessionId>:exportMode`

## Per-student ZIP (PDF) export

When `exportMode = per_student_zip_pdf`, the UI provides:

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

- Reading/Listening: rendered as a teacher-friendly table: question, student answer, right answer, correct, score.
- Writing uses the same structure as the default **"Print all writing"** export (task pages with prompt, response, and assessment form), and includes the full essay text (plain text) when available.
- Missing section data is rendered as **"No submission"**.
- For `MULTI_MCQ`, the student-answer column maps the persisted submitted option-ID array to option text, while the right-answer column maps options marked `isCorrect`. A stale legacy `requiredSelections` value must affect neither column.

The selected sections are persisted per grading session in `localStorage`:

- `grading:<sessionId>:perStudentExportSections` (JSON array)

The PDF mode is persisted per grading session in `localStorage`:

- `grading:<sessionId>:perStudentPdfMode` (`combined` / `separate`)

PDF filenames inside the ZIP can be customized via a template persisted per grading session in `localStorage`:

- `grading:<sessionId>:perStudentPdfFilenameTemplate`

The template affects **only** PDF filenames inside the ZIP (the ZIP filename remains unchanged). Unknown placeholders are kept as literal text and the UI warns.

Notes:

- In `separate` PDF mode, use `{{section}}` in the template to generate distinct filenames per section and avoid ` (2)`, ` (3)` suffixes.

## Owning modules and seams

Per-student ZIP export is intentionally split into a few deep modules to keep UI changes local and make PDF layout work safer:

- Dialog UI (state + persisted preferences): `src/components/admin/PerStudentZipPdfExportDialog.tsx`
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
