# Exam "Rooms" tab → light room finder

## Context
The exam workspace's Rooms tab (`/sat/exams/:id/access`) is a second rooms console: a two-pane list plus a detail panel (Share and run, Activity, Settings). It duplicates the global Rooms page (`/sat/sessions` list → `/sat/sessions/:scheduleId` room page), and with 55 rooms that all say "Check-in open" it doesn't help anyone find the room they want.

Goal: the exam tab becomes a calm finder. One click opens the real room page. It helps people find a room again with "Jump back in" (recently opened), grouping by exam phase, and "Last opened" highlighting. It links to the global Rooms page, filtered to this exam.

Decisions already made with you:
- Edit, Share, Present, Duplicate, Pause/Resume, Revoke and Delete stay in each row's ⋯ menu. They reuse the existing sheets and confirm dialog.
- The Activity tab is dropped.

## Design (internal-tool rules: repeat user first, one primary action, calm status)

**Exam tab layout** (`StudentLinksDashboard`, 8px grid, comfortable density)
1. Page header: eyebrow `{exam} · Version N`, title "Rooms", description "Find a room for this exam and open it to share, start and monitor." Header action: a quiet `All rooms ↗` button that goes to `/sat/sessions?exam={examId}`. The primary "Create room" button stays in the workspace header, so the view still has one primary action.
2. **Jump back in** (hidden when empty): up to 3 compact cards for rooms of this exam that this browser opened recently, newest first. Each card shows the room name, an exam-phase pill (Running / Ready / Finished), and `Opened 12 min ago · 24 joined`. Clicking a card opens the room. The cards are laid out in a 3-column grid and stack on phones.
3. Toolbar: a search field (keep the `/` shortcut; it matches name, audience and "version N") and a result count. Use the shared `SatSearchField` and `SatResultCount`, the same components as the global Rooms page. Drop the check-in status chips (`LinksToolbar`), because they don't tell rooms apart.
4. List grouped by exam phase, each group with a small heading and count:
   - **Live now** (live or paused)
   - **Ready to start**
   - **Finished**
   - **Closed** (revoked or cancelled), collapsed by default as a disclosure "Closed rooms (2)"

   Inside each group, newest first.
5. Row (adapted `AccessLinkRow`):
   - **Line 1:** name · `Version 41` · section badge
   - **Line 2:** exam-phase pill + `Anyone with link · Created Sun 4 Oct, 15:42` (or the scheduled window). Check-in state stays visible only when it isn't the normal "open", e.g. "Check-in paused".
   - **Line 3:** `82 registered · 82 submitted`
   - Right side: ⋯ menu and a chevron.
   - Clicking the row opens `/sat/sessions/:scheduleId` with `state.from` set to this tab plus `?link=`. That is the existing `session.onOpenRoom`, and it already makes Back on the room page return here.
   - The last-opened room (from `?link=`) gets a quiet accent tint and a "Last opened" tag. It is scrolled into view and focused on return.
   - Roles that can't run rooms (`!session.canRun`): clicking a row opens Share instead. That is never a dead end.
6. ⋯ menu: the current `menuItemsFor` items, plus "View results" when the phase is finished (uses `session.onOpenResults`).
7. States:
   - Loading: skeleton.
   - Error: keep the existing banners.
   - No rooms: keep the existing "Create your first room" empty state, which is where the "How rooms work" guide gets folded in.
   - No search matches: "No rooms match '…'" with a Clear search button.
   - Session status unknown: no pill rather than a guess.

**Room page** (`SatSessionRoomRoute`)
- When it loads, record `{scheduleId, examId, at}` in a recent-rooms list in localStorage (max 20, wrapped in try/catch). The room page is the one place every entry path goes through: the global list, the exam tab, and deep links.
- Admins always see "Room settings". It goes to the exam tab with `?link={id}&edit=1`, which opens that room's edit sheet and highlights its row. Today it is hidden when you arrived from the exam tab.

**Global Rooms page** (`SatSessionsRoute`)
- Support `?exam={examId}`: filter summaries by `schedule.examId`, so bucket counts follow the filter. Show a removable chip "Exam: {title} ✕" next to the search field. Add `exam` to `useSatListParams`.

## Files
- `src/features/exam-authoring/ui/access-links/StudentLinksDashboard.tsx`:
  - Remove the detail pane, selection state, arrow-key selection, the activity query, `justCreated`, `DeliverySetupGuide` and `LinksToolbar`.
  - Add the Jump back in section, phase groups, the `All rooms` action and `edit=1` handling.
  - Props `selectedLinkId`/`onSelectionChange` become `highlightLinkId` plus `onEditHandled` (to clear `edit`).
- `src/features/exam-authoring/ui/access-links/AccessLinkRow.tsx`: the row opens the room. Add a phase pill, date, `highlighted`/"Last opened" tag and a chevron. Remove `quickAction` and `selected`.
- New `src/products/sat/ui/recentRooms.ts` (~30 lines): `rememberRoom(entry)` and `readRecentRooms(examId)`, localStorage with try/catch.
- `src/products/sat/routes/SatAccessRoute.tsx`: pass `?link` as the highlight, read and clear `?edit=1`, and give the All-rooms URL.
- `src/products/sat/routes/SatSessionRoomRoute.tsx`: call `rememberRoom` and always show "Room settings" for admins.
- `src/products/sat/routes/SatSessionsRoute.tsx` and `src/products/sat/ui/useSatListParams.ts`: add the `exam` filter and chip.
- Delete the components that become unused, along with their tests: `AccessLinkDetail.tsx`, `LinksToolbar.tsx`, `delivery/DeliverySetupGuide.tsx`, `delivery/AccessLinkSessionPanel.tsx`. Update `access-links/README.md`.

Reuse:
- `useAccessSessionBindings` / `infoFor` (phase and joined count)
- `SESSION_PHASE_LABEL`
- `SatStatusPill`, `SatSearchField`, `SatResultCount`, `SatEmptyState`
- `formatCompactDateTime`, `describeAccessLinkAudience`, `accessLinkSectionBadge`
- `examWorkspacePath`, `isExamDeliveryPath`

## Verification
- `bun run typecheck`, `bun run lint`.
- `bunx vitest run src/features/exam-authoring/ui/access-links src/products/sat/routes`. Update `StudentLinksDashboard.test.tsx`, `DeliveryFlow.test.tsx` and `SatSessionsRoute.test.tsx` so they cover:
  - clicking a row opens the room
  - the ⋯ menu actions still work
  - phase grouping
  - Jump back in shows only this exam's recent rooms
  - the `?exam=` filter and its chip clear
  - `?edit=1` opens the edit sheet
- Browser (`bun run dev`, `:3000`):
  1. Exam → Rooms → open a room.
  2. Back lands on the tab with that row marked "Last opened" and the room in Jump back in.
  3. Room settings opens the edit sheet.
  4. All rooms opens the global list filtered to the exam.
  5. Check at 375px width and with keyboard only.
