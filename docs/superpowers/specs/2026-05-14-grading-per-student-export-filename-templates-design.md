# Design: Per-student ZIP export PDF filename templates

Date: 2026-05-14 (Asia/Bangkok)

## Summary

Extend the admin grading session **Per-student ZIP (PDF)** export to support **custom PDF filenames** inside the ZIP using a template syntax with `{{placeholders}}`.

This does **not** change:

- the ZIP filename
- grading data, submissions, or review state (export remains read-only)

## Goals

- Let staff configure PDF filenames with a template (per grading session UI).
- Provide a UI list of available placeholders and allow inserting them into the template.
- Show a live preview example using the first selected student.
- Guarantee safe filenames and uniqueness within the ZIP.

## Non-goals

- Server-side export generation (this export remains client-side for now).
- Custom folder structure inside the ZIP.
- Template conditionals/loops.

## User experience

In the **Export per student (ZIP PDFs)** dialog, add:

1. **PDF filename template** (text input)
2. **Available fields** (chips/buttons) to insert `{{field}}` into the template
3. **Example preview**: rendered filename for the first selected student
4. **Warnings**: invalid/unknown placeholders and duplicate output resolution

### Default template

```
{{studentName}}_{{submissionId}}_{{sections}}.pdf
```

## Template syntax

- Placeholders are delimited by `{{` and `}}`
- Placeholder names are case-sensitive and must match the available fields list
- Unknown placeholders are **kept as-is** (e.g. `{{foo}}` stays in output) and the UI shows a warning

## Available placeholders (v1)

Student/submission:

- `{{studentName}}`
- `{{studentId}}`
- `{{studentEmail}}`
- `{{submissionId}}`

Session context:

- `{{examTitle}}`
- `{{cohortName}}`
- `{{sessionId}}`

Export context:

- `{{sections}}` (e.g. `reading`, `writing`, `reading-writing`)
- `{{date}}` (YYYY-MM-DD, local)
- `{{timestamp}}` (ISO-like, safe for filenames)

## Filename safety and uniqueness

After rendering a template:

1. Ensure `.pdf` extension is present (append if missing).
2. Sanitize for cross-platform safety:
   - replace invalid characters: `/ \\ : * ? " < > |` with `-`
   - trim whitespace, collapse runs of whitespace
   - strip trailing dots/spaces
   - cap total length (e.g. 180 chars) while preserving `.pdf`
3. Ensure uniqueness inside the ZIP:
   - if collision occurs, append ` (2)`, ` (3)`, ... before `.pdf`

## Persistence (per grading session UI)

Store in `localStorage`:

- `grading:<sessionId>:perStudentPdfFilenameTemplate`

The template affects **only** the PDF filenames inside the ZIP.

## Audit / invariants

- Export remains read-only; do not mutate answers, grades, or review state.
- No new PII exposure beyond what the user already has access to via grading UI.

## Test plan (characterization/regression)

Add unit tests around the filename rendering function:

- renders known placeholders
- keeps unknown placeholders and reports them
- sanitizes invalid characters
- adds `.pdf` when missing
- resolves duplicates with ` (n)` suffix

