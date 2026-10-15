# Rooms (access-links)

Staff UI for preparing, sharing and running sittings of a published SAT exam. A
**room** is the object staff work with: it owns the audience, the student link,
the check-in window, the waiting room and the responses. Storage is unchanged — a
room is one `assessment_access_links` row plus its backing schedule, created
atomically. Route: `SatAccessRoute` (kept at `/sat/exams/:id/access`; the tab is
labelled **Rooms**) → `StudentLinksDashboard`. The global Rooms page
(`SatSessionsRoute` → `SatNewSessionFlow`) renders the same
`AccessLinkEditorSheet` with an **Exam** picker as its first field, so both entry
points create the same thing from one sheet. Creating from inside an exam goes
through `SatCreateRoomFlow`, which pins the published version or, for unpublished
changes, asks explicitly: *Use published Version N* (default) or *Publish changes
first*.

Creating a SAT room is ONE form, never a wizard: Room name · Session type
(Practice / Classroom; Classroom reveals Module 2 routing in place) · Who can join
(roster appears for *Listed students only*) · Check-in (dates appear for
*Scheduled*) · **More options** (sections — hidden when the release has only one —
student identification, class or group). The closed disclosure summarizes its
current values; Create validates every field and opens More options when the
first problem lives there. Editing an existing room keeps the grouped layout
**Room details** · **Who can join** · **Check-in settings**.

## Vocabulary

- **Who can join** is a choice of two: *Anyone with the link* or *Listed students
  only*. Only `selected_students` restricts admission (`ResolveEntryTx`).
- **Class or group** is an optional label (`audienceLabel`) and never restricts
  anyone. The stored `cohort` audience is the legacy spelling of "anyone, with a
  label": it reads back as *Anyone with the link* (`accessLinkAudienceChoice`), and
  a label saves as `cohort` only so older readers keep working.
- **Check-in** (link status: open / opens later / paused / closed) is separate from
  the **exam run state** (not started / running / paused / finished). The room
  row shows the exam phase as a pill and mentions check-in only when it is not
  open; `sessionStatusLine` renders the one-line form used in the live-room
  header ("Check-in open · Exam not started"). Opening check-in never starts the
  exam; pausing it never stops attempts in progress.

## Invariants (do not change without a backend migration)

- Links are pinned to the immutable release they were created for
  (`publishedVersionId`). Publishing a new version never mutates old links.
- `duplicate(source)` keeps the link's version; `duplicate(current)` creates a
  replacement pinned to the current published version.
- Optimistic concurrency: lifecycle/update/duplicate send `revision`. A stale
  revision surfaces "This link changed elsewhere. Refresh and retry." + Refresh.
- `selected_students` links always require `student_code`; roster codes are
  unique (case-insensitive), email optional but validated.
- `studentJoinUrl` encodes the link id; share targets open with
  `target="_blank" rel="noreferrer"`.

## Layout

- `StudentLinksDashboard` — the exam's **room finder**, orchestration only
  (search, grouping, mutations, dialogs). Sections: **Jump back in** (up to 3
  rooms of this exam this browser opened, from `products/sat/ui/recentRooms.ts`,
  recorded by the room page) → search + result count → rooms grouped by exam
  phase (Live now · Ready to start · Finished · Other rooms) with **Closed
  rooms** (revoked or cancelled) in a collapsed disclosure; newest first in each
  group. Header action **All rooms** opens `/sat/sessions?exam=<id>`.
- `AccessLinkRow` — the whole row opens the room (`session.onOpenRoom`; staff
  who cannot run rooms get the Share sheet instead). Three lines: name · version
  · sections, exam-phase pill · audience · date (check-in noted only when not
  open), registered/submitted. The room from `?link=` is tinted, tagged **Last
  opened** and focused. Overflow `SatMenu`: Copy/Share/Present/Edit/Duplicate/
  View results (finished)/Pause-Resume/Revoke/Delete.
- Deep links: `?link=<id>` highlights a row; `?link=<id>&edit=1` (the room
  page's **Room settings**) opens that room's `AccessLinkEditorSheet` once.
- `AccessLinkEditorSheet` — inline per-field errors + progressive roster
  validation (`rosterValidation.ts`: per-row issues, live count, template).
- `AccessLinkShareSheet` — QR (lazy `qrcode` import), break-all URL, 44px
  targets. Toasts are global (`useNotificationStore`, 4000ms success).

## Keyboard

- `/` focuses search (outside inputs/dialogs); `Escape` clears it; rows and
  recent cards are plain buttons in tab order; menus keep Radix
  typeahead/Escape.

## Press and feedback (interaction contract)

- **One press vocabulary.** Controls carry `sat-press` (0.97) and large surfaces
  `sat-press-row` (0.99) from `index.css`; press-in is 0ms (same-frame answer) and
  the release settles over `--sat-staff-motion-press` / `--sat-staff-ease-press`.
  Optional fills: `sat-press-fill` (neutral) and `sat-press-fill-accent`. Never add
  a bare `button:active` rule — press is opt-in per control. Rows also carry
  `sat-list-row` (shared hover fill, press scale, reduced-motion reset).
- **Acknowledgement is local.** A copy confirms at its own control (check +
  `Copied`, ~1.6s via `useTransientValue`); a lifecycle write shows a per-row
  pending label plus the shared spinner inside the row's existing 40px trigger box,
  then settles in place. Nothing may change size or push neighbours when pending
  starts or ends.
- **Pending is derived, never fabricated.** `pendingWrite` reads the mutation's
  `isPending`/`variables`; the row keeps the server's real status until the write
  is confirmed. Optimistic *status* is forbidden here (staff would believe student
  entry is closed when it is not). Pending/confirmation state never reaches the
  room or the query cache.
- **`useNotificationStore` has no renderer in this app.** `showToast(...)` writes
  are still made (a future host may consume them) but they are NOT the success
  channel: if you add feedback, put it at the control or in the page's own
  `role="status"` region.
- **No entrance motion on poll refresh.** Row entrance (`sat-row-enter`) is
  mount-only; the 30–35s overview/activity polls update numbers in place.
- Reduced motion collapses row entrance and press motion to instant state
  changes.
