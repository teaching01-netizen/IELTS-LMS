# Listening Parts Sidebar (Builder) — Design

Date: 2026-04-23

## Goal

In the exam builder, the Listening module should have a left-side panel similar to the Reading “Passages” sidebar. This panel lets staff:

- Navigate between Listening parts
- Add/delete/reorder parts
- Rename a part (updates the active part label shown in the Listening UI)

## Non-goals

- Changing candidate runtime behavior
- Persisting any new “metadata” for listening parts
- Refactoring Reading + Listening into a shared generic sidebar (can be done later)

## UX / Layout

Listening builder layout becomes:

1. Left: **Parts** sidebar (collapsible)
2. Middle: **Audio Workspace** for the active part (audio URL, playback controls, pins)
3. Right: **Question Builder** pane

The sidebar is hidden when “Focus on Questions” mode is enabled.

## Data Model

- Reuse `ExamState.listening.parts` and `ExamState.activeListeningPartId`
- Rename updates `ListeningPart.title`
- Add/delete/reorder operates on the `parts` array only (consistent with Reading passages behavior)

## Interactions

- **Select part**: sets `activeListeningPartId`
- **Add part**: appends a new part, sets it active
- **Delete part**: removes the part; if it was active, pick the first remaining part (or none)
- **Reorder**: drag-and-drop reorder by index; active part stays active by id
- **Rename**: edit icon toggles an inline input; commit on Enter/blur; cancels on Escape

## Persistence

- Sidebar collapsed state stored in `localStorage` key: `listening-part-list-collapsed`

## Acceptance Criteria

- Listening module shows a left “Parts” sidebar styled consistently with Reading’s passage list.
- Selecting a part changes which Listening part is shown/edited.
- Renaming a part updates the “Audio Workspace: …” header and the Question Builder title immediately.
- Add/delete/reorder works and doesn’t break existing Listening builder functions (audio pins, question builder).

