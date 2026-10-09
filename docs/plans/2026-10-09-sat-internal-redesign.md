# SAT internal workspace redesign — implementation plan

Date: 9 October 2026

Status: ready for implementation after the visual baseline in Phase 0.

## Outcome and scope

Make the SAT staff workspace feel like one product: predictable navigation, readable lists, clear next actions, consistent controls, and reliable feedback. Staff should be able to create an exam, publish it, prepare a room, run it, and review responses without learning a different interface at each step.

Scope includes admin, builder, proctor, and grader views under `/sat`: exam library; question authoring; publishing; exam settings; room setup and sharing; live monitoring; response lists; scored results; and saved-answer review.

This is a frontend redesign using the existing routes, API contracts, permissions, and delivery behavior. The student exam interface keeps its existing exam-specific layout. Preview content must continue to match student delivery.

Preparation used source inspection and official application documentation. No skills, worktrees, or subagents were used. No application code was changed or browser tests run while preparing this plan. Visual findings need confirmation against rendered screens in Phase 0; source findings below are already traceable.

## Design direction

Use a quiet operational interface: neutral canvas, white surfaces, dark readable text, a single blue action accent, compact aligned lists, restrained borders, and clear labels. Most polish should come from spacing, alignment, hierarchy, and feedback.

Borrow familiar patterns, then adapt them to SAT:

| Reference | Pattern to adopt | SAT application |
| --- | --- | --- |
| [Linear filters](https://linear.app/docs/filters) and [display options](https://linear.app/docs/display-options) | Compact list controls, visible applied filters, filters represented in the URL | Exam and room lists; student-attempt search; preserve Back and refresh behavior |
| [Shopify resource lists](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/resource-list) | Consistent wide rows that adapt to narrow lists; distinct links and row actions | Rooms, access setup, and student attempts; avoid nested interactive controls inside a clickable row |
| [Atlassian dynamic tables](https://atlassian.design/components/dynamic-table/) | Clear column comparison, sorting, and pagination | Student attempts and question-level responses where comparing values is the task |

These are interaction references, not dependencies to install. Reuse the project's React, Radix, Lucide, and existing SAT components. Do not add an unrelated dashboard, board view, theme picker, advanced filter builder, or command system.

## Current evidence and changes needed

| Observed in source | Consequence | Planned change |
| --- | --- | --- |
| `SatRoot.tsx` renders a 244px sidebar for lists, rooms, and result details, but hides it throughout an exam workspace. `SatWorkspaceNav.tsx` supplies an icon-only workspace switcher on focused pages. | Product navigation changes presentation; the escape route is less discoverable inside an exam. | Keep standard and focused layouts, with the same named destinations and an explicit “Digital SAT” workspace trigger on focused pages. |
| `SatPage.tsx` already supplies headers, toolbars, grouped rows, search, states, and status pills. | A useful shared foundation exists. | Extend this foundation where an actual repeated need exists; migrate outliers instead of building a second component library. |
| Staff tokens in `src/index.css`, authoring `spine.css`, generic theme classes, and direct slate utilities coexist. Global `.sat-product` overrides and `.sat-staff-root` font overrides compensate for differences. | Visual rules have multiple owners; some changes could spill into other products or preview. | Give SAT staff styling one scoped token contract and alias authoring chrome to it. Replace compensating overrides as their callers migrate. |
| Navigation uses “Exams / Rooms / Responses”; some error buttons still use “Tests”; detail buttons use “Results”; access documentation still describes “Sessions.” | The same destination or object is named differently. | Adopt the vocabulary below in active UI and update the associated documentation. Preserve route and storage names. |
| Global room creation selects an exam before opening `AccessLinkEditorSheet`; exam-level room creation uses that editor directly. | The same setup flow has two entry points. | Preserve one setup editor; show the selected exam/version context consistently and avoid redundant selection at exam level. |
| `SatSessionRoomRoute.tsx` composes roster, run sheet, inspector, and room controls. `SatSessionRoomInspector.tsx` uses viewport breakpoints while a product sidebar also consumes width. | Three panes may compete for space on ordinary laptops; room and student controls can compete for attention. | Base layout choices on available workspace width and separate room controls from selected-student controls. |
| `SatResultsRoute.tsx` already drills down exam → room → attempts, retains query parameters, and paginates attempts. Scored and saved-answer detail routes have different styling. | Review has a sound data structure but uneven presentation. | Keep the hierarchy and transport; add consistent breadcrumbs and detail chrome with explicit attempt/scoring states. |

## Navigation and language contract

Keep the existing destinations and URLs:

```text
Digital SAT
  Exams       /sat/exams
    Exam      /sat/exams/:examId
      Questions
      Rooms       /access
      Responses   /responses
      Settings    /settings
      Publish review /release
      Preview        /preview
  Rooms       /sat/sessions
    Live room /sat/sessions/:scheduleId
  Responses   /sat/results
    Exam → Room → Student attempt → Response detail
```

| Term | Meaning / rule |
| --- | --- |
| Exam | Authored SAT content. Use “Exams” for the library and its Back buttons. |
| Version | An immutable published release. Display it wherever a room or result depends on that release. |
| Room | A sitting prepared for students. Use “Create room,” “Open room,” and “Room settings.” |
| Check-in | Whether students can enter. Opening or pausing check-in does not start or pause the exam. |
| Exam status | Not started, Running, Paused, Finished, or Cancelled, derived from existing state. |
| Responses | The navigation destination for reviewing student attempts and answers. |
| Score / result | Information within a completed attempt. Do not rename the entire Responses destination “Results” on some pages. |
| Saved answers | Server-confirmed answers for an attempt that may not yet have a scored result. |

Keep each role's existing destinations and capability checks. Shared navigation must route through the existing unsaved-change/save-flush guards. Changing the shell must not bypass them.

## Shared visual and interaction contract

| Element | Target |
| --- | --- |
| Typeface | Existing system sans throughout staff chrome; no new font dependency. Keep content rendering fonts where exam content requires them. |
| Typography | Page title 28px/34px, section title 20px/28px, labels/body/metadata 14px/20px, text-entry controls 16px/24px. Preserve the current staff readability floor. |
| Spacing | Use 4, 8, 12, 16, 24, and 32px steps. Standard page gutters: 16px small screens, 24px larger screens. |
| Widths | Lists/review approximately 1180px; settings text approximately 920px; authoring retains its content measure; live room can fill available workspace width. Header and content align within each layout. |
| Surfaces | Neutral canvas, white content surfaces, one border treatment. Group records in one surface with separators. Elevation is reserved for menus, sheets, and dialogs. |
| Radius | Controls 10px, grouped surfaces 14px, dialogs 18px. Map existing authoring chrome aliases to these values without altering student rendering. |
| Controls | Default 44px height. Icon buttons and touch targets are 44×44px. Fix the current 28px search-clear exception with adequate space in the input and update its existing CSS contract test. |
| Buttons | Primary, secondary, quiet, danger; consistent padding, focus, pending indicator, and disabled state. At most one visually dominant action per page header or dialog. |
| Color | One blue action/selection accent. Success, warning, and danger always include text; no color-only status. Verify 4.5:1 normal-text contrast and 3:1 relevant control/focus contrast. |
| Numbers | Tabular numerals for counts, scores, and clocks. Missing score is “Not scored” or an explanatory state, never fabricated zero. |
| Motion | Existing short opacity/color transitions, reduced-motion support, no layout shift on pending/success, no repeated entrance animation during polling. |
| Feedback | Local pending and success feedback at the initiating control; persistent actionable error near the affected content. “Saved” only after server acknowledgement. |

Reuse `SatMenu`, `SatSegmentedControl`, SAT dialogs, and `SatPage` states. Extend `SatPrimaryButton` into a compatible shared button with the required variants; keep existing callers working during migration. Add a shared field wrapper only for repeated label/help/error markup. Lists and semantic tables should share styling without forcing one generic data-grid abstraction.

Use `.sat-staff-root` as the staff styling boundary. Existing SAT portals must carry a staff marker when rendered outside that DOM subtree so menus/dialogs receive the same contract. Keep student preview/delivery selectors isolated. Audit other callers before changing shared authoring or result components.

## Screen specifications

### Exam library

- Header: “Exams,” concise context, one “Create exam” action.
- Keep Active / Drafts / Published / Archived tabs, search, and current sort choices.
- Rows use aligned Exam / Status / Updated fields with a clear exam link. Keep title prominent, version visible in status, secondary information subordinate.
- Use the same header/toolbar during loading and no-match states. A load failure should retain location and a working Retry action.
- Creation stays a short title dialog with field error, pending state, dirty-close protection, and navigation to the created exam.

### Exam workspace: questions, settings, publish

- Keep focused authoring: question queue on the left, editing surface in the center, optional inspector. Avoid adding another full product sidebar alongside the question queue.
- Keep a labeled Digital SAT workspace trigger, Exams breadcrumb, exam title, lifecycle state, separate save state, and the same Questions / Rooms / Responses / Settings navigation on every exam surface.
- Draft or unpublished changes: Publish version is primary. Current published version: Create room is primary; publishing remains secondary. Reuse current lifecycle logic and permissions.
- Show Import and Preview as secondary actions; infrequent controls remain in the existing overflow menu.
- Preserve question editor behavior, math/media rendering, import, adaptive module selection, validation, collaboration, and recovery. This phase changes chrome and placement, not the editor model.
- Group settings into Reading & Writing, Math, break, and delivery policy using existing section save behavior. Put help beside the field it explains and retain dirty-leave handling.
- Publish review leads with scope and readiness; blockers link to the exact question/field, warnings stay separate, version and timing summary precede confirmation. Retain `/release` and the existing publish sheet for current entry points, sharing the readiness/publish UI.

### Room setup and sharing

- Reuse `AccessLinkEditorSheet` from both global and exam-level creation. Global creation adds exam selection; exam-level creation already knows the exam.
- Show three clear groups: Room details (name/group/version), Who can join, and Check-in settings. Show conditional roster fields only for listed-student access.
- Keep pinned version visible; publishing another version does not silently update existing rooms. Retain the explicit action for creating a replacement room on the newer version.
- Room overview uses separately labeled Check-in and Exam status. “Pause check-in” must never be confused with “Pause exam.”
- Sharing uses one consistent Copy student link action, QR option, and local “Copied” feedback. Show the link's current admission state beside sharing.
- Use the existing overview/activity/settings structure where useful. Update stale Sessions terminology in the access-links README when UI changes land.

### Room list and live room

- Room list follows the same header, tabs, search, sort, result-count, and row grammar as Exams. Show room/group identity clearly, with exam, version, start time, joined count, and run state as secondary fields where available.
- Live-room header shows room identity and exam/version; use the existing room/access-link name when available, with a cohort fallback for legacy schedules.
- Keep room-wide controls in a labeled room action area. One primary control depends on state: Start exam, Resume exam, or View responses. Pause/Add time remain clearly scoped secondary controls; End exam requires the existing confirmation.
- Keep joined/active/needs-attention counts compact and actionable. Preserve attention filtering and actual attention reasons.
- Keep the authoritative run sheet and current-stage clock central. Distinguish room/section, module, and student clocks by label; do not derive replacement clocks for appearance.
- Selected-student panel starts with identity and current state. Label time extensions, warnings, pause/resume, and termination as actions on that student. Confirmation includes the affected student or room and the actual consequence.
- Fit panes to workspace space: three columns only when roster + central run sheet + inspector are readable after the outer sidebar is accounted for; otherwise inspector opens as a sheet. At narrow widths show roster/timeline in a readable sequence and student details in an accessible dialog.
- Preserve selected student and focus through layout changes. Resolve outer mobile-header and room-header sticky offsets to prevent overlap.
- Keep stale/reconnecting feedback visible. Dangerous operations remain blocked until current state is confirmed; uncertainty must not look like success.

### Responses and details

- Retain exam → room → attempts hierarchy and server-side pagination; the existing endpoints do not require a new global flattened attempt search.
- Give each level a breadcrumb and a title. Name the search scope explicitly: Search exams, Search rooms, Search students.
- Attempts use a semantic comparison table on desktop: Student, Test started, Status, Score, and response/review link; retain multiple attempts by one student as distinct rows. Keep room/exam/version context above the table rather than repeating it in every cell.
- Use All / Completed / Running / Ended filters from existing data. Keep date filters and viewer timezone visible. Filtering resets pagination appropriately and clears stale selection.
- Scored detail and saved-answer detail share identity header, context, status, back behavior, section grouping, and question-response styling. Keep their different capabilities explicit.
- Show progress/save evidence for in-progress attempts. Completed attempts show “Score pending” only when the data indicates scoring is pending; flows that do not generate a score explain that explicitly. Ended/invalidated attempts show the reason and no score. Legitimate zero values remain numeric.
- Keep question response, correct answer, verdict, and module context readable. Preserve raw-data export and existing review controls where currently available.
- Back restores filters, page, selection/focus, and scroll through `useSatListReturn`, current query parameters, and `satReturnPath`.

## Ordered implementation tasks

Implement sequentially in the current checkout. Each phase should leave usable screens and avoid mixing changes to delivery rules with visual changes.

| Phase | Work and ownership | Dependencies | Exit evidence |
| --- | --- | --- | --- |
| 0 — Baseline | Capture current and proposed layouts for Exams, Questions, room setup, live room, and Responses at 1440, 1280, 1024, and 390px. Record loading, empty, error, and populated states. Confirm sidebar-adjusted room widths. | None | Annotated before/target screenshots and explicit geometry decisions; role route/capability matrix recorded from current guards. Use mocked fixtures for layout work and a dedicated test environment for mutations. |
| 1 — Foundation | Update staff-scoped tokens in `src/index.css`; align `spine.css` chrome; extend `SatPage.tsx` controls; unify menus/dialogs and search-clear target. | 0 | One representative list, focused header, field, status, and overlay follow the contract at all target widths. Student preview retains its rendering. |
| 2 — Navigation and lists | Update `SatRoot.tsx`, `SatWorkspaceNav.tsx`, `ExamWorkspaceHeader.tsx`; normalize UI vocabulary. Apply header/toolbar/row grammar to exam and global room lists. Preserve URL/list memory. | 1 | Role-specific navigation remains correct; list → detail → Back restores state; focused workspace has a discoverable exit with dirty/save guards intact. |
| 3 — Authoring and publish | Align authoring queue/chrome, Settings page, publish sheet and `/release` page. Use existing validation and lifecycle-derived actions. | 2 | Edit → save → preview → return preserves confirmed edits and collaboration; blocker navigation and publish confirmation remain correct. |
| 4 — Room preparation | Align `StudentLinksDashboard`, access-link rows/detail/editor/share components, and `SatNewSessionFlow`. Keep a single setup editor and distinct check-in/run states. | 3 | Both creation entry points produce the same setup behavior; admission, roster validation, version pinning, dirty close, and copy feedback remain correct. |
| 5 — Live operations | Update room route, roster, timeline/context bar, controls, inspector, confirmations, and room CSS. Make layout account for outer chrome width. | 4 | Ordinary laptop width supports readable operations; room vs student actions are unambiguous; stale-state blocking, timing, alerts, and transfer requests remain correct. |
| 6 — Response review | Align Responses route, exam responses wrapper, grouping rows, scored detail, saved-answer detail, and `QuestionRawTable` styling. | 2 and 5 | Complete, pending, running, invalidated, multiple-attempt, and unanswered records render accurately; filter/pagination/Back behavior is preserved. |
| 7 — Verification and cleanup | Run relevant checks below; compare all target screenshots; remove superseded styling/overrides and update UI documentation. | 3–6 | Cross-route consistency, keyboard/touch access, role restrictions, and critical SAT journey verified; no unexplained differences or dead compatibility styles. |

### Primary implementation files

Shared staff chrome:

- `src/index.css`
- `src/products/sat/SatRoot.tsx`
- `src/products/sat/ui/{SatPage,SatWorkspaceNav,Menu,SegmentedControl,ConfirmDialog,SatActiveFilters}.tsx`
- `src/products/sat/ui/{useSatListParams,useSatListReturn}.ts`

Exam workspace:

- `src/features/exam-authoring/ui/shell/ExamWorkspaceHeader.tsx`
- `src/features/exam-authoring/ui/shell/{useExamWorkspaceChrome,examLifecycle}.ts`
- `src/features/exam-authoring/ui/{AuthoringWorkspace,SatDeliveryReleasePage}.tsx`
- `src/features/exam-authoring/ui/spine/{SpineLayout.tsx,spine.css}`
- `src/features/exam-authoring/ui/settings/{ExamSettingsPage,DeliverySettingsPanel}.tsx`
- `src/features/exam-authoring/ui/publish/ExamPublishSheet.tsx` and existing `ui/release/` components

Rooms and review:

- `src/products/sat/routes/{SatExamLibraryRoute,SatSessionsRoute,SatNewSessionFlow,SatAccessRoute,SatSessionRoomRoute,SatResultsRoute,SatExamResponsesRoute,SatExamGroupSection,SatResultDetailRoute,SatAttemptAnswersRoute}.tsx`
- `src/products/sat/ui/SatSessionRoom*.tsx`, `SatSessionControls.tsx`, `SatSessionContextBar.tsx`, `SatRunSheet.tsx`, and `sat-session-room.css`
- `src/features/exam-authoring/ui/access-links/` and `ui/delivery/` existing room/setup components
- `src/components/results/QuestionRawTable.tsx`

Do not alter transport, scoring, admission, timing, or collaboration modules unless a demonstrated UI integration issue requires a separately identified change. Shared components must be checked for IELTS callers before modifying defaults.

## Verification and completion criteria

Use Bun and Node 20+ as required by the repository. Run focused checks after each behavior-bearing phase, then the production checks at completion.

```bash
bun run typecheck
bun run lint
bun run build
bunx vitest run src/products/sat
bunx vitest run src/features/exam-authoring/ui/shell src/features/exam-authoring/ui/settings src/features/exam-authoring/ui/access-links src/features/exam-authoring/ui/publish src/features/exam-authoring/ui/release
bunx playwright test --config playwright.sat-authoring.config.ts
bun run e2e:sat-results
```

The authoring lifecycle and results-scan configurations use browser transport fixtures and a frontend server. The Go-backed workspace suite below requires its backend, coedit service, and a dedicated test database; its setup mutates fixture data, so use `TEST_DATABASE_URL` for an isolated test database.

```bash
bunx playwright test e2e/sat-product-workspace.spec.ts --project=chromium
```

Baseline existing tests before changing expected labels. Source inspection found `sat-results-scan.spec.ts` expecting “SAT results” while the current top-level route renders “Responses”; record whether this is a pre-existing failure and update the assertion to the chosen product vocabulary rather than retaining conflicting labels. Existing CSS source-contract tests, including the 28px search-clear assertion, must be updated when that intended contract changes. Favor behavior checks for new interaction changes over additional CSS-string tests.

| Scenario | Required result |
| --- | --- |
| Admin, builder, proctor, grader | Each sees existing permitted destinations/actions. Direct forbidden routes remain protected. |
| Filtered library → exam → Back/refresh | Same query, tab, sort, scroll, and appropriate focus; selected exam remains recognizable. |
| Dirty authoring/settings → navigation | Existing save/leave handling works from breadcrumb, workspace switcher, tabs, and browser navigation. No collaboration teardown loses edits. |
| Invalid/incomplete publish | Clear blockers, exact field navigation, disabled publish reason; successful publish displays server-confirmed version. |
| Global vs exam room creation | Same admission/setup behavior; global selection step only where needed; new room is pinned to the selected published version. |
| Check-in pause vs exam pause | Distinct labels and effects; UI reports the server's confirmed state. |
| Concurrent room edits | Stale revision reports refresh/retry and does not show false success. |
| Room-wide vs one-student action | Scope and consequence visible before confirmation; correct target passed to existing callback. |
| Live room at 1280/1024px and 200% zoom | No essential pane squeezed offscreen; inspector reachable; selected student/focus preserved; headers and dialogs do not obscure controls. |
| Reconnect or failed operation | Stale feedback stays visible, unsafe controls blocked, retry works, polling does not erase selection or reanimate rows. |
| Completed, running, pending, invalidated, unanswered attempts | Correct statuses and score availability; zero is preserved; saved-answer evidence is distinguished from scoring. |
| Response filter/page → detail → Back | Same filters, dates/timezone, page and scroll; repeated student attempts remain distinguishable. |
| Keyboard, touch, reduced motion | All menus/dialogs usable, focus visible and restored, status text announced appropriately, no icon-only critical action, 44px touch targets, motion preference respected. |

Add a frontend-only Playwright staff redesign spec/config only for the missing navigation/layout/keyboard scenarios, reusing current transport fixture patterns. Live timing, start/pause/resume/end, transfer, and end-to-end response correctness still require the real Go-backed suite. Re-run relevant student delivery checks if shared CSS or preview rendering changed; `e2e:sat-a11y` is student coverage and does not by itself validate staff accessibility.

Completion means the same control has the same appearance and behavior across all staff screens; every screen exposes its location and next action; the baseline task journeys and permissions pass; all target widths and 200% zoom are visually reviewed; and remaining limitations are recorded with evidence. No deployment is part of this plan.
