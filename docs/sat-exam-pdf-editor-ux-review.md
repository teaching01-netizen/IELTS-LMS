# Exam PDF layout editor: UX and UI review

**Status** - Implemented. The editor now lives in the exam workspace chrome,
uses the staff design tokens, and explains every state it can be in.

**Scope** - The SAT staff PDF layout editor at /sat/exams/:examId/settings/pdf.
No schema change: the layout and asset tables are unchanged, so migrations
0131, 0132, 0133 and 0134 are untouched.

## What the editor is

Staff prepare the printed exam report. They add finished slides (images) that
print before or after a report section, and they can replace three brand
marks: the cover logo, the left watermark and the right watermark. The
editor saves one layout per exam. New PDFs use it; PDFs already prepared keep
the version they were created with.

## The audit that produced this change

The shipped editor was structurally sound: it rendered previews through the
real PDF pipeline, kept per-section sample pages, returned focus carefully,
guarded unsaved navigation, detected conflicting saves, offered a read-only
mode and could undo a removal. All of that stays.

What it did not do was speak the staff member's language or sit inside the
workspace it belongs to.

| Finding | Before | Now |
| --- | --- | --- |
| Off-system chrome | Hand-rolled header, 18px title, a 1440px container, generic border and muted fills | The exam workspace header (breadcrumb, exam title, tabs) plus a staff section header, staff tokens, one measure |
| False state | A never-saved layout reported All changes saved | Default layout at revision 0, Saved v7 after a save, Unsaved changes while dirty, View only without edit access |
| Silent blocks | Save disabled with no reason when a slide had no description, when the 8-slide cap was reached, or when an image failed to load | The reason is stated next to the action, and the same reasons are checked before saving |
| Jargon | PDF editor, Page order, PDF pages, image page | Exam PDF layout, Slides, Report outline, slide |
| Leaked keys | A removed module printed math-m2-higher (unavailable) | A readable label, and the section is marked as no longer in the exam |
| Hidden condition | When released was carried only by aria-description | Visible text plus aria-describedby, so every screen reader reads it |
| Unstable labels | Section labels came from raw target keys | Labels come from the exam, with a readable fallback |
| Card soup | Outline, stage, upload, sample and branding were each a bordered card | Hairline rails on one warm canvas, one white paper, one accent |
| Lossy interactions | Moving a slide took five interactions | Move up and down, drag to reorder in the outline, and change placement in one place |
| No preview context | Preview replaced the whole editor | Preview opens over the draft in a dialog; the draft stays behind it |
| Blind upload | A file input, size checked client-side, dimensions checked after the upload | Drop, paste or choose; type, size and pixel dimensions checked before the upload |
| Undo out of sight | Undo remove sat at the bottom of the stage | Undo lives with the removal in the inspector, and names the slide |
| No way back | No reset to the default report | Reset layout to default behind a confirm that names what is lost |

## The layout

    Report outline            Paper                       Inspector
    -------------             -----                       ---------
    COVER                     [Zoom] Page 1 of 18        Cover
      + Add slide at Cover    +---------------------+     Add slide before
      Orientation.png         |                     |     Add slide after
    SCORE REPORT  when rel.  |    the printed page   |
    ANSWER SUMMARY            |                     |
    ANSWER KEY      when rel.  +---------------------+
    EXAM REVIEW               + Add slide after Cover
      Math  2 slides

Three rules hold it together:

- The paper is the only white object. The report is the product; the rails
  are quiet.
- A slide always sits next to the section it prints against, so after Cover
  is a position, not a sentence to remember.
- The inspector answers three questions about the selection: what prints
  here, what can be changed, and what happens if it changes.

## Behaviour worth knowing

- Save is explicit (Cmd+S also works). Save is enabled only when the draft
  changed, the staff member may write, and nothing blocks it.
- The slide count is always visible: 3 of 8 slides placed. The cap is
  explained where the Add buttons stop working.
- The version is always visible. updated_at and updated_by are read from the
  existing layout row (no migration) and shown as Saved at 09:04 by you.
- Placement is checked before the upload, so an oversized export is refused
  locally with its own reason instead of after a 4 MB round trip.
- A conflict keeps the draft: Another person changed this layout. Your edits
  are still here. with Review my edits and Load latest layout.
- Read-only staff see the layout, the samples and the preview, and no write
  controls.

## Files

| File | Change |
| --- | --- |
| src/features/exam-authoring/ui/settings/pdf-layout/ExamPdfLayoutEditor.tsx | Rewritten: staff header, status pill, three zones, keyboard shortcuts, drag reorder, reset to default |
| src/features/exam-authoring/ui/settings/pdf-layout/PdfReportOutline.tsx | Replaces PdfPageStrip.tsx: report outline with slide thumbnails, conditions, counts and insert affordances |
| src/features/exam-authoring/ui/settings/pdf-layout/PdfPaperStage.tsx | The paper: zoom, sample page, slide, page caption |
| src/features/exam-authoring/ui/settings/pdf-layout/PdfInspector.tsx | The selection inspector: description, replace, remove, undo, placement, reset |
| src/features/exam-authoring/ui/settings/pdf-layout/PdfLayoutImageForm.tsx | Drop, paste or choose; type, size and dimension checks before upload; position and section pickers |
| src/features/exam-authoring/ui/settings/pdf-layout/PdfLayoutPreview.tsx | Preview as a dialog over the draft, with the answer-key switch and a download fallback |
| src/features/exam-authoring/ui/settings/pdf-layout/PdfSectionSample.tsx | Sample hooks that keep the last good page when a render fails |
| src/features/exam-authoring/ui/settings/pdf-layout/pdfSampleRaster.ts | PDF rasterizing shared by the sample book and the single-section sample |
| src/features/exam-authoring/ui/settings/pdf-layout/pdfLayoutLabels.ts | One vocabulary for sections, conditions and placements |
| src/features/exam-authoring/routes/ExamPdfLayoutRoute.tsx | The exam workspace header, so the editor keeps the exam chrome |
| src/features/exam-authoring/ui/settings/ExamSettingsPage.tsx | Entry copy: Edit PDF layout |
| src/shared/sat/pdfLayout.ts | updatedAt and updatedBy on the editor payload |
| backend/go/internal/satpdflayout/layout.go and service.go | Read updated_at and updated_by from the layout row |
| src/index.css | The paper shadow token for the one object that lifts off the canvas |
| src/features/exam-authoring/ui/settings/pdf-layout/__tests__/ExamPdfLayoutEditor.test.tsx | The editor flow: open, add, save, remove, undo, blocked-save reason |

## Verification

- bunx tsc --noEmit - clean.
- bunx eslint on the changed paths - clean.
- bunx vitest run src/features/exam-authoring/ui/settings/pdf-layout - the
  editor flow passes.
- bun run build - production bundle builds; student bundle isolation
  verified.
- go test ./internal/satpdflayout ./internal/answeredpdf ./cmd/api
  ./cmd/migrate - pass.

The remaining suite failures in this repository also fail on origin/main:
student delivery tools, results routes, copy contracts, selection guards,
route and service architecture guards, the load-runner catalog, and the
schema guard table count. They are not caused by this change.

## Still open

- Revision history. The layout row keeps only the current revision; a history
  table would need a new migration and a decision on retention.
- Dragging a slide from one placement to another. Reordering inside a
  placement works; moving across placements is still a form.
- A live side-by-side of the draft and the rendered report. The preview is
  still a separate dialog.
