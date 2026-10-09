**I recommend making SAT follow Google Forms’ exam workflow, with a room for each exam sitting: open exam → publish → create room → share student link → review responses.** This gives teachers/admins one continuous journey.

I reviewed the current source and existing improvement document. The local app requires sign-in, so visual findings still need authenticated verification. **I made no edits.**

Google Forms provides a useful reference for publishing, sharing, and reviewing responses within the same form. Google Classroom provides familiar audience selection and assignment setup patterns. These are the patterns I would adapt. [Forms publishing](https://support.google.com/docs/answer/2839588?hl=en), [Forms responses](https://support.google.com/docs/answer/139706?hl=en), [Classroom assignment setup](https://support.google.com/edu/classroom/answer/6020265?co=GENIE.Platform%3DDesktop&hl=en).

**What is creating the confusion today**

| Current finding | Effect on teachers/admins |
|---|---|
| Global Sessions uses a record list; an exam’s Sessions tab uses an access-link dashboard with a permanent details panel. | The same task feels like two different applications. |
| Labels alternate between Tests, exams, sessions, student links, Results, and responses. | Users must translate terminology between screens. |
| Exam details hide the main sidebar, while session rooms restore it. | Navigation changes during the workflow. |
| Room setup exposes sections, audience, identification, roster format, check-in rules, and a summary in one long sheet. | A routine creation task requires understanding many concepts upfront. |
| Sharing has separate components and URL formats: `/join/:linkId` and `/student/:scheduleId`. | Sharing behavior needs one consistent presentation and clear entry-policy handling. |
| Responses generally drill down through exam → session → student. | Teachers navigate through grouping screens before seeing answers. |

The shared exam header, shared creation form, version pinning, response inspector, and post-creation room navigation are already useful foundations. Keep them.

**The proposed structure**

Give users three clear concepts:

| Concept | Meaning |
|---|---|
| **Exam** | Reusable questions, settings, and published versions. |
| **Room** | One sitting of an exam, with students, a student link, and live controls. |
| **Response** | One student’s attempt, saved answers, and scoring outcome. |

Use **Exams · Rooms · Responses** in global navigation.

Within an exam, use **Questions · Rooms · Responses · Settings**. The global Rooms page and an exam’s Rooms tab should render the same list; the exam tab simply applies an exam filter.

“Student access” belongs inside room setup and sharing. It should not require navigating to a separate management concept. Existing URLs and backend names can remain during this UI change.

A cosmetic refresh would leave most navigation friction intact. A single wizard covering every task would become cumbersome for repeat users. **The exam workspace with contextual room creation is the recommended approach.**

**The four redesigned flows**

1. **Publish an exam**

   Keep publishing in the exam header. Open one review sheet showing included sections, blocking issues, and the consequence of publishing.

   Make errors actionable: selecting an issue returns to its question or setting. After confirmation, show:

   > Version 3 published. Create a room to give students access.

   Offer **Create room** and **Done**. Existing rooms remain pinned to their original version. Publishing must never start an exam or silently update those rooms.

2. **Create a room**

   From an exam, preselect its published version. From global Rooms, include exam selection in the same setup surface.

   Show these essential controls first:

   - Room name.
   - Who can join: **Anyone with the link** or **Listed students only**.
   - Student identification.
   - Check-in: **Open now** or **Scheduled**.

   Show the roster only when listed students are selected. Put the optional group label, section overrides, and reuse options under **More options**, with a visible summary of their effective values.

   Replace raw roster formatting as the primary interface with editable **Student code / Name / Email** rows. Keep spreadsheet-style paste as a shortcut with row-specific errors.

   Preserve existing admission defaults. Explain that a student code identifies a student; roster checking determines whether that student is admitted.

   After creation, open the room’s preparation view consistently.

3. **Give students access**

   Use one **Share with students** surface everywhere. Include the room name, exam/version, who can join, check-in availability, copyable link, and QR code.

   Make **Copy student link** primary. Keep **Present QR** and **Download QR** secondary. Explain:

   > Students can check in now. They wait until you start the exam.

   Resolve the correct student entry URL centrally. Access-backed rooms should consistently use their access link; legacy schedule links need compatible handling. Verify that both entry paths enforce the intended admission policy before consolidating them.

4. **See responses**

   Open **Responses** inside the exam workspace.

   If the exam has one room, show its student table immediately. If it has several, show a room selector above the table rather than a separate grouping page.

   Suggested columns: **Student · Room · Attempt status · Score · Submitted**. Clicking a student opens the existing answer inspector beside the table; mobile uses a full-screen detail view. Closing restores filters, pagination, selection, and focus.

   Keep attempt status and scoring status distinct. Pending or unavailable scores must not appear as zero. Show repeated attempts separately.

   Label the existing export **Download room responses (.xlsx)** so its scope is explicit. An “All rooms” student table requires additional API work: the current query requires both an exam and a session.

**How the interface should look and behave**

Use a consistent object header, tab row, toolbar, and content area across the workflow:

```text
SAT navigation: Exams · Rooms · Responses

September SAT                         Published · Version 3
Questions   Rooms   Responses   Settings       [Create room]

Search / filters
Records or focused working area
```

Use solid neutral surfaces, one accent color, readable 14–16px controls, consistent spacing, and restrained borders. Lists should share columns, filters, row behavior, and empty states.

The room itself should change with its stage:

| Stage | Main content | Primary action |
|---|---|---|
| Preparing | Student link, joined/ready counts, roster | Review and start exam |
| Running | Current section, time, students needing attention | Pause exam |
| Paused | Pause status and affected students | Resume exam |
| Finished | Completion summary and student attempts | View responses |

Keep **Check-in open** and **Exam not started** visibly separate. Put individual student actions beside that student. Keep cancellation and ending actions away from routine controls.

On smaller screens, show one working panel at a time. Preserve visible keyboard focus, labeled controls, 44px touch targets, and focus restoration after dialogs.

**Implementation order**

| Phase | Concrete work | Acceptance condition |
|---|---|---|
| **1. Navigation and language** | Standardize Exams/Rooms/Responses, breadcrumbs, active navigation, and action labels. Preserve role permissions and existing URLs. | Users retain their location when moving between an exam, its room, and responses. |
| **2. One room list** | Make global and exam-specific lists share presentation and behavior. Move detailed access configuration into room settings. | Both entry points open the same room with the correct return destination. |
| **3. Publish → create room** | Simplify publish review and creation fields; preserve exact version handoff and server-confirmed creation. | Publishing leads into room setup without reselecting the exam or version. |
| **4. Unified sharing** | Consolidate link/QR presentation and centralize entry-URL resolution. | Sharing from a list, exam, or room shows consistent information and enforces the same intended policy. |
| **5. Responses** | Replace the room grouping screen with a selector; retain the inspector and existing export contract. | Teachers can find and inspect a student attempt without leaving the exam context. |
| **6. Room and visual polish** | Align stage layouts, controls, spacing, responsive panels, loading, failure, and empty states. | The preparation, live, and finished screens feel like stages of the same room. |

The principal implementation files are:

- Navigation: [SatRoot.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/SatRoot.tsx) and [ExamWorkspaceHeader.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/shell/ExamWorkspaceHeader.tsx).
- Room lists/setup: [StudentLinksDashboard.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/access-links/StudentLinksDashboard.tsx), [SatSessionsRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/routes/SatSessionsRoute.tsx), and [AccessLinkEditorSheet.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/access-links/AccessLinkEditorSheet.tsx).
- Publishing/sharing: [ExamPublishSheet.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/publish/ExamPublishSheet.tsx), [AccessLinkShareSheet.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/access-links/AccessLinkShareSheet.tsx), and [SatStudentLink.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/ui/SatStudentLink.tsx).
- Responses/live room: [SatResultsRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/routes/SatResultsRoute.tsx) and [SatSessionRoomRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/routes/SatSessionRoomRoute.tsx).

Before release, verify the complete admin journey, restricted-roster admission, scheduled check-in, publication while an older room exists, connection failures, repeated attempts, and browser Back/refresh behavior. Extend the existing workflow and accessibility tests, then test with teachers unfamiliar with the interface. A proposed usability target is **four of five completing publish, create, share, and response review without guidance**.