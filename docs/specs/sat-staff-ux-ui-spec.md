# Digital SAT Staff Workspace UX/UI Specification

**Status:** Draft for product and design validation

**Updated:** 2026-10-11
**Scope:** Staff workspace under `/sat/*`

## 1. Purpose and scope

Define a coherent, accessible, responsive experience for staff who author SAT exams, prepare student access, operate exam rooms, and review responses. The specification is grounded in the current SAT routes and shared components; it sets user-facing requirements and does not claim that backend timing, scoring, durability, authorization, or concurrency guarantees have been formally verified.

Included workflows:

1. Find, create, author, preview, and publish an SAT exam.
2. Set up a room, select its audience and sections, schedule it, and share student entry.
3. Monitor a live room and take room-wide or student-specific actions.
4. Find an exam or room's responses and inspect an attempt.

Out of scope: candidate test-taking screens, IELTS workspace redesign, backend/API behavior, and visual redesign of the question content itself.

## 2. Users and their primary jobs

| Role | Primary job | Main workspace |
| --- | --- | --- |
| Admin | Configure exams and rooms, operate sessions, review outcomes | Exams, Rooms, Responses |
| Builder | Create and maintain exam content; preview and publish | Exams |
| Proctor | Prepare and operate assigned rooms; review permitted responses | Rooms, Responses |
| Grader | Review and score permitted responses | Responses |

Navigation and action visibility must follow the user's actual permissions. Hiding a control is not an authorization boundary; route and server access remain authoritative.

## 3. Product principles

Apply the pasted UI design notes as concrete SAT rules:

1. **Hierarchy:** Every page makes its purpose, current exam/room, current state, and next useful action apparent before secondary information.
2. **Progressive disclosure:** Split long setup into short, named steps. Show progress, preserve entered values when moving back, and provide a final review before creating or publishing.
3. **Consistency:** Reuse the SAT staff navigation, page headers, list rows, status labels, dialogs, fields, and action hierarchy. The same action must use the same name and placement across entry points.
4. **Contrast and state clarity:** Use semantic status color with a text label and/or icon. Color alone never carries status, urgency, selection, or error.
5. **Proximity and alignment:** Keep labels with their fields, room controls with room context, and student actions with the selected student. Use shared columns and spacing for comparable lists.
6. **Feedback:** Every save, publish, share, room action, and retry gives a visible result, a pending state, and a recoverable error when applicable.
7. **Accessibility:** The same tasks work with keyboard, touch, screen reader, magnification, and reduced-motion preferences.

## 4. Information architecture

### Global SAT workspace

- Primary destinations are **Exams**, **Rooms**, and **Responses**, shown according to role.
- Keep the selected destination visually and programmatically identifiable.
- On narrow screens, use the existing compact navigation without covering page content or focused controls.
- The SAT/IELTS workspace switch and account actions remain separate from task navigation.
- Exam detail pages keep one stable exam header and a consistent set of tabs: **Questions**, **Rooms**, **Responses** (when permitted), **Settings**, and **Publish**. The exam title and lifecycle state remain visible while moving among tabs.
- Preserve the user's list context on return: search, filter, sort, scroll position, and the previously opened record when still available.

### Page inventory

| Surface | User needs to see first | Main actions |
| --- | --- | --- |
| Exams library | Exam name, lifecycle state, question count, last update | Search, filter by state, sort, create/open exam |
| Exam workspace | Exam identity, draft/published state, active tab | Author, preview, configure, publish, open rooms/responses |
| Publish review | Readiness, blockers, publish scope, current and next version | Fix a blocker, refresh checks, review, publish |
| Rooms list | Room name, exam/version scope, start time and timezone, joined/active counts, state | Search, filter upcoming/live/finished, create/open room |
| Room setup | Selected exam/version, audience, sections, schedule and entry settings | Continue/back, review, create room |
| Live room | Room state, current section/module, authoritative remaining time, next stage, students needing attention | Start/pause/resume/end, add time, inspect student, share entry |
| Responses | Exam or room, attempt totals and states, filters | Search/filter, open attempt, page through results |
| Attempt detail | Student and attempt identity, completion state, answers and history | Move between attempts, return to the same result context |

## 5. Core workflow requirements

### 5.1 Find and author an exam

- The Exams page has a single primary **Create exam** action, clear lifecycle filters, labeled search and sort controls, and a readable result count.
- List rows distinguish **Draft**, **Published**, **Unpublished changes**, and **Archived** in text. Show question count and last-updated date without forcing users to open each exam.
- Empty states explain why there are no results and offer a useful next action: clear search/filter, show another state, or create an exam.
- Creating an exam asks for the minimum information needed to start. Explain the SAT structure that will be created and move directly into that exam's workspace after success.
- The authoring workspace keeps navigation, preview, and lifecycle context stable. Validation errors identify the affected question/field and provide a direct correction path.

### 5.2 Review and publish an exam

- Publish readiness is grouped by actionable blocker. Each blocker states what is wrong, where it is, and how to fix it; a disabled Publish action always states why.
- Show the publish scope and current version before the final action. The confirmation names the exam, scope, and resulting version.
- Show clear pending, success, and failure states. A failed or stale check must not look like a successful publish.
- Explain that publishing creates a version and that existing rooms remain pinned to their created version. Do not imply that publishing silently changes a room already in progress or already scheduled.
- After success, show the published version and the next relevant action (for example, preview or create a room).

### 5.3 Set up a room and share student entry

- Room creation uses one guided flow whether started from Rooms or an exam. The chosen exam and its published version/scope are visible throughout setup.
- Name each setup step and show `Step n of total` plus a short explanation. Back navigation preserves valid entries; leaving a dirty flow asks before discarding.
- Group related fields. Use progressive disclosure for audience/member selection and advanced entry options. Explain section selection, student access, and schedule consequences beside the decision.
- Before creation, provide a compact review of exam/version/scope, room name, audience, sections, timing, timezone, and entry window. Make the final action explicit (for example, **Create room**).
- After creation, confirm the room and take staff to its room workspace. Student link, QR, copy, and rotate actions state which room they affect and give immediate feedback.
- If no published exam exists, explain the dependency and link to Exams. Loading, access, and setup errors provide retry or a clear way back without losing entered data.

### 5.4 Operate a room

- Keep one coherent room context at the top: room/exam identity, state, current section/module, a single authoritative remaining-time display, its timezone/end-time context, and the next stage when known.
- Keep room-wide controls in a group labeled **Room controls** and student-specific actions in the selected student's detail. Never make a student action appear to affect the whole room or vice versa.
- Make the most likely safe action primary for the current state. Use distinct styling and explicit confirmation for **End exam** and other consequential actions; describe who or what is affected.
- Student rows show identity and operational state with text labels. The **Needs attention** filter explains the count and each student's reason. Live updates must not unexpectedly move the row under pointer or keyboard focus.
- A stale/disconnected room view is unmistakable. State the last successful refresh, offer retry, and communicate which actions are unavailable until current data returns. Do not present stale data as live.
- Announce important state changes accessibly without repeatedly reading a ticking clock. Confirm each successful action against refreshed room state; if refresh fails, say that the action may have succeeded but the view could not confirm it.
- On narrow screens, preserve access to current room state, roster, student details, and essential room controls; no action may depend on hover.

### 5.5 Review responses and attempts

- The Responses landing page summarizes exams and attempts, while an exam-scoped Responses tab opens directly to that exam's rooms/attempts.
- Search, date/status filters, pagination, and selected attempt state remain in the URL where practical so a result can be refreshed or shared without losing context.
- Make the active exam, room, date range, timezone, filters, result count, and page range explicit. Clearing filters is easy and does not silently alter the selected exam.
- Attempt detail provides a clear return path to the same result list and supports previous/next attempt navigation when available.
- Loading, empty, no-match, and error states are distinct. Do not use a blank table as the only explanation for missing data.

## 6. Shared visual and interaction system

- Extend the existing SAT staff system in `src/products/sat/ui/SatPage.tsx` and the `--sat-staff-*` tokens in `src/index.css`; do not create one-off colors, radii, shadows, or control styles for an individual route.
- Use the established page header → summary/context → controls → content order. Each page has one clear primary action; secondary actions stay quieter and destructive actions stay visually distinct.
- Use spacing and alignment to show grouping before adding dividers or card decoration. Keep related lists on one column grid across header and rows.
- Use tabular numerals for clocks, durations, dates, counts, and version identifiers. Keep readable line lengths and allow long names to wrap or truncate without hiding their accessible name.
- Status pills combine a stable text label with shape/color treatment. Reuse the same vocabulary for the same lifecycle state everywhere.
- Use brief, task-focused copy. Label fields persistently; use examples as examples, not as the only label. Error messages say what happened and what the user can do next.
- Motion is brief and functional. Respect `prefers-reduced-motion`; never use animation as the only indication of a state change.

## 7. Responsive behavior

- Design for the current desktop staff workspace and support tablet and phone layouts for every in-scope flow.
- At narrow widths, stack filters and fields, convert dense tables to readable rows/cards or provide a deliberate table-scrolling region, and keep primary actions visible without covering content.
- Support reflow at 320 CSS px and text resizing without loss of task content or controls. No page-level horizontal scrolling except where two-dimensional data is essential and the region is independently operable.
- Keep tap targets comfortably usable; common room controls should target at least 44 × 44 CSS px. WCAG 2.2 AA's minimum target-size criterion is 24 × 24 CSS px with defined exceptions.
- Verify sticky headers, bottom navigation, dialogs, inspectors, and focus positions together so they do not obscure one another.

## 8. Accessibility requirements

Target **WCAG 2.2 Level AA** for complete staff workflows, not only isolated components.

- All functionality is keyboard operable with a visible focus indicator, logical focus order, no keyboard trap, and focus not fully obscured by sticky UI.
- Use semantic headings, landmarks, lists/tables, form labels, button/link roles, and accessible names. Icon-only actions need names; decorative icons are hidden from assistive technology.
- Text contrast is at least 4.5:1 for normal text and 3:1 for large text. Meaningful control boundaries, focus indicators, and state graphics meet non-text contrast requirements.
- Do not convey status, validation, selection, or urgency by color alone. Pair it with text and/or an icon and programmatic state.
- Associate field errors and help text with their controls. Move focus to validation summaries when needed and announce async results, errors, and important room changes through appropriate live regions.
- Dialogs and sheets have an accessible title, trapped focus while modal, Escape/close behavior, and focus restoration to the invoking control.
- Support zoom/reflow, reduced motion, screen-reader status messages, and accessible names that match visible action labels.

## 9. Cross-cutting states and content

Every data-backed screen and action must define these states where applicable:

| State | Required treatment |
| --- | --- |
| Initial loading | Stable skeleton or progress message with a useful accessible label |
| Empty | Explain why the collection is empty and offer the next relevant action |
| No match | Preserve current query and offer clear/reset |
| Pending action | Prevent duplicate submission, identify the pending action, and retain context |
| Success | Confirm what changed and identify the resulting object/state |
| Validation error | Place the error near the field and in a summary when multiple fields fail |
| Recoverable service error | Plain-language explanation and retry; retain safe user input |
| Permission denied | Explain the missing access at a high level and offer a permitted route |
| Stale/offline | Show freshness/connectivity and disable actions that rely on current state |
| Destructive confirmation | Name scope and consequence; provide a safe cancel path |

Use one vocabulary throughout: **exam**, **room**, **student link**, **published version**, **section**, **module**, **response/attempt**. Distinguish a room's scheduled start from the proctor's actual start and distinguish a saved draft from a published version.

## 10. Acceptance criteria

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| SAT-UX-01 | A staff member can identify their role-appropriate destinations and return to the same list context after opening an item. | Role-based route walkthrough; filters and scroll context survive detail → back. |
| SAT-UX-02 | Staff can find or create an exam without ambiguity about draft/published state. | Keyboard and pointer walkthrough including empty, search-no-match, loading, and error states. |
| SAT-UX-03 | Staff can identify every publish blocker and understand version/scope impact before publishing. | Walkthrough with passing and failing readiness states; confirmation states exam, scope, and version. |
| SAT-UX-04 | Staff can create a room and verify exam/version, audience, sections, timing/timezone, and entry settings before committing. | Complete guided setup from both entry points; back navigation retains values; final review is readable at narrow width. |
| SAT-UX-05 | A proctor can distinguish current room state, time, next stage, student status, and room-wide versus student-specific actions. | Live-room walkthrough with live, paused, stale, reconnect, empty roster, attention, and confirmation states. |
| SAT-UX-06 | Staff can locate an attempt, inspect it, and return to the same filtered result context. | Search/filter/paginate/open/return walkthrough and direct URL refresh. |
| SAT-UX-07 | Complete workflows work without pointer input and with screen reader semantics. | Keyboard-only pass plus representative screen-reader walkthrough; no focus traps or obscured focus. |
| SAT-UX-08 | Core staff tasks remain usable on phone/tablet and at zoom/reflow settings. | Check 320 CSS px, tablet, desktop, and 200% text zoom; no lost controls or task-critical information. |
| SAT-UX-09 | WCAG 2.2 AA criteria are met across full processes. | Automated checks plus manual contrast, keyboard, focus, reflow, form-error, and assistive-technology review. |

## 11. Open product decisions

Resolve these before treating the spec as final:

1. Which staff roles and assignment rules are supported in production, and which room/response actions can each role perform?
2. **Timezone policy:** Schedule inputs, the Rooms list, and Responses filters use the staff member's local timezone; the live room run sheet uses Thailand operations time (ICT, UTC+7). Each time display must label its zone, and conversions must preserve the same instant. Revisit this policy if the operating region changes.
3. Which screen widths/devices are required for live proctoring versus supported as a secondary view?
4. Which usability measures should be baselined (for example, time to publish, create/share a room, identify a student needing attention, and locate an attempt)? No target values are asserted until baseline data exists.

## 12. Repository alignment and references

Current implementation anchors include `src/products/sat/SatRoot.tsx`, `src/app/router/route-manifest.ts`, `src/products/sat/routes/SatExamLibraryRoute.tsx`, `SatSessionsRoute.tsx`, `SatNewSessionFlow.tsx`, `SatSessionRoomRoute.tsx`, `SatResultsRoute.tsx`, `SatResultDetailRoute.tsx`, `src/features/exam-authoring/ui/shell/ExamWorkspaceHeader.tsx`, `src/features/exam-authoring/ui/release/`, `src/features/exam-authoring/ui/access-links/`, `src/products/sat/ui/SatPage.tsx`, and SAT staff tokens in `src/index.css`.

This is a product and interaction specification, not a formal Lean verification result. Where room timing, answer durability, adaptive routing, privacy, or authorization affects behavior, a separate implementation-level correctness review must establish the relevant guarantee.

References:

- User-provided UI design notes: hierarchy, progressive disclosure, consistency, contrast, proximity, accessibility, alignment, and usability testing.
- [W3C Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/), Recommendation, 12 December 2024.
