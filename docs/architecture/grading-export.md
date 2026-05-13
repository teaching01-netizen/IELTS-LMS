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
- Section picker: Reading and/or Writing

Output:

- A single `.zip` download
- One `.pdf` per selected student
- `manifest.json` at the root of the ZIP, describing:
  - `mode = per_student_zip_pdf`
  - `generatedAt`
  - selected `sections`
  - per-student status (`ok` / `failed`)

PDF content:

- Mirrors the existing grading CSV fields for the selected sections (rendered as a readable key/value report).
- Writing includes the full essay text (plain text) when available.
- Missing section data is rendered as **"No submission"**.

The selected sections are persisted per grading session in `localStorage`:

- `grading:<sessionId>:perStudentExportSections` (JSON array)

