# Student Access (access-links)

Staff UI for sharing a published SAT exam with students. Route: `SatAccessRoute` →
`StudentLinksDashboard`. Also reachable from the release page via `?view=access`.

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

- `StudentLinksDashboard` — orchestration only (filters, selection, mutations,
  dialogs, toasts via `useNotificationStore`). Chrome: `SatContainer`,
  `SatPageHeader`, `SatStatStrip` (Joined/Started/Submitted funnel).
- `LinksToolbar` — `SatSearchField` (debounced 150ms in dashboard) + status
  pills with counts + `role="status"` result count.
- `AccessLinkRow` — memoized two-line row + `SatStatusPill` + overflow
  `SatMenu` (Copy/Share/Present/Edit/Duplicate/Pause-Resume/Revoke).
- `AccessLinkDetail` — tabbed `Overview | Activity | Settings`. Overview keeps
  the stale-version banner + `Create Version N Link`.
- `AccessLinkEditorSheet` — inline per-field errors + progressive roster
  validation (`rosterValidation.ts`: per-row issues, live count, template).
- `AccessLinkShareSheet` — QR (lazy `qrcode` import), break-all URL, 44px
  targets. Toasts are global (`useNotificationStore`, 4000ms success).

## Keyboard

- `/` focuses search (outside inputs/dialogs); `ArrowUp/Down` moves selection and
  scrolls the selected row into view; detail tabs implement the ARIA tab pattern
  (roving tabindex, `ArrowLeft/Right`, `Home/End`, focus follows selection);
  `Escape` in the detail pane returns focus to the selected row; menus keep Radix
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
- Selection, filter, and tab changes use the shared thumbs (`sat-selection-thumb`,
  `sat-tab-indicator`, `layoutId` springs) and the opacity-only `sat-panel-enter`
  panel reveal; reduced motion collapses all of it to instant state changes.
