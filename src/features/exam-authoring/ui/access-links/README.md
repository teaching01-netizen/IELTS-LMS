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

- `/` focuses search (outside inputs/dialogs); `ArrowUp/Down` moves selection;
  detail tabs support `ArrowLeft/Right`; menus keep Radix typeahead/Escape.
