**I recommend making SAT internal feel like Google Workspace, with WhatsApp-style filters for live monitoring.** Use familiar interaction patterns consistently: Drive for finding tests, Forms for editing, Meet for running sessions, and spreadsheet-style results.

No files were edited. This review covers the staff workspace. The local app redirected to sign-in and its backend was unavailable, so the findings are based on the current source—not a verified visual walkthrough.

**What the current implementation already does well**

Several proposed improvements from the previous review are already implemented:

- [QuestionCardStack](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/spine/QuestionCardStack.tsx) already provides Google Forms-style question cards.
- [SatNewSessionFlow](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/routes/SatNewSessionFlow.tsx) already reuses the exam’s session setup form.
- Exam pages already share **Questions / Sessions / Results / Settings** tabs.
- The live room already has a searchable student roster, attention filters, and a student inspector.
- Results already preserve filters and offer a response inspector.

The best next step is to make these feel like one coherent application.

**Reference direction**

| SAT area | Familiar reference | Pattern to adopt |
|---|---|---|
| Test library | Google Drive | Predictable rows, prominent search, clear status and modification details |
| Question editor | Google Forms | One expanded question, compact surrounding cards, answer controls beside the question |
| Session setup | Calendar event form | Clearly grouped details, audience, dates, and a readable summary |
| Live proctoring | Google Meet + WhatsApp | Stable controls, searchable people list, attention filters, contextual details |
| Results | Spreadsheet + Google Forms responses | Aligned columns, filters, individual response review |

These references have documented patterns for [Drive lists and sorting](https://support.google.com/drive/answer/2375177?hl=EN), [Forms answer keys and individual response review](https://support.google.com/docs/answer/7032287?hl=en), [Meet’s persistent controls and people panel](https://support.google.com/meet/answer/10550593?hl=en), and [WhatsApp’s quick list filters](https://blog.whatsapp.com/find-messages-faster-with-chat-filters).

My recommendation is to borrow those mechanics while keeping SAT terminology. A Facebook/Instagram-style feed would make activity familiar, but it would be a weaker organizing structure for preparing tests and monitoring students.

**The proposed experience**

```text
Tests → Edit questions → Publish version → Create session
                                              ↓
                                      Share student link
                                              ↓
                                      Run session → Results
```

Every screen should make three things immediately recognizable: **where I am, what state this work is in, and what I can do next.**

1. **Navigation and visual foundation**

   Use **Tests / Sessions / Results** as the main navigation. “Tests” is shorter and more familiar than “Exam Library”; existing URLs can stay.

   Keep the exam workspace focused, but provide a consistent workspace-menu entry in its header. Currently the main sidebar disappears inside an exam, which changes the navigation model.

   Adopt solid white surfaces, a light neutral background, one blue action color, and restrained borders. Increase routine labels and metadata from the frequently used 12px to approximately 14px; use 16px for editable text. Reduce decorative blur and gradients in operational screens.

   Keep one emphasized primary action per context: **Create test**, **Publish version**, **Create session**, or **Start exam**.

2. **Test library: recognizable document list**

   Make each row easy to scan:

   ```text
   Test name                   Status                 Updated
   SAT Practice 06             Published · Version 3  Oct 9
   98 questions · Full SAT
   ```

   Keep search and sorting above the list. Use **All active / Drafts / Published / Archived** filters derived from existing data. Change the ambiguous “Changes” badge to **Unpublished changes**.

   Opening the title should continue into the current authoring flow. Any future preview action should be explicit, because opening a published test can request an editable draft.

3. **Question editing: finish the Forms pattern**

   Retain the existing card stack and single active editor.

   Arrange the active card into understandable groups: **Question text**, **Passage or image**, **Answer choices**, **Correct answer**, and **Classification**. Keep required classification visible; place optional explanation under disclosure.

   Make **Add question**, **Duplicate**, and **Move up/down** easy to locate. Keep the outline as an optional aid for search and bulk work.

   Simplify header emphasis: title, save status, preview, and publish/create-session remain prominent. Import and quick settings can move into the existing overflow menu.

   Preserve the distinction between **Saved** and **Published**. A saved edit must never imply students are receiving it.

4. **Session setup: an event people can understand**

   Refine the shared form into three groups:

   | Group | Contents |
   |---|---|
   | Session details | Name, test, pinned version, sections |
   | Students | Who can join, identification, optional roster |
   | Check-in window | Open now or scheduled, dates, visible timezone |

   Before submission, show a plain-language summary:

   > SAT Practice 06 · Version 3
   > Listed students only · Reading & Writing + Math
   > Check-in opens at 09:00 Asia/Bangkok. The proctor starts the exam.

   Keep the current distinction between group labels and admission restrictions. Keep check-in availability separate from exam runtime.

   After creation, prioritize **Copy student link**, **Show QR**, and **Open session room**. Staff should immediately recognize the session they just prepared.

5. **Live room: familiar people list with stable controls**

   Refine the existing layout:

   ```text
   Session name · Running · Live data

   Students                 Current section          Selected student
   Search                   Section timing           Name and status
   All | Needs attention    Module progress          Attention reason
   Student rows             Session overview         Student actions

   Pause exam     Add time     Student link                 End session
   ```

   Use WhatsApp-style filter chips, but badges must mean **students requiring attention**, not unread messages.

   Make the current section and its clock the visual anchor. Keep each student’s module/break time clearly labeled in their row.

   Move cohort controls into a stable, labeled control region. Separate **End session** from routine actions. Student controls stay inside the selected student’s inspector.

   Preserve the existing protection against rows moving under the pointer and the blocking of risky actions when data is stale.

6. **Results: readable records and contextual review**

   Keep the existing exam/session hierarchy, with clear breadcrumbs. When opening results from a session, go directly to that session’s students.

   Align **Student / Status / Reading & Writing / Math / Total** columns where those values exist. Show unavailable and pending scores explicitly rather than as zero.

   Retain the response inspector and previous/next navigation. Closing it must restore the same filters, page, scroll position, and row focus.

   Shorten the export label to **Export session answers**, with an adjacent scope note: **All attempts in this session; filters do not affect export.**

**Implementation order**

| Phase | Existing files to change | Completion criteria |
|---|---|---|
| 1. Staff foundation and navigation | [SatRoot.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/SatRoot.tsx), [SatPage.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/ui/SatPage.tsx), [index.css](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/index.css), [ExamWorkspaceHeader.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/shell/ExamWorkspaceHeader.tsx) | Consistent names, typography, surfaces, primary actions, and workspace navigation |
| 2. Library and session setup | [SatExamLibraryRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/routes/SatExamLibraryRoute.tsx), [AccessLinkEditorSheet.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/features/exam-authoring/ui/access-links/AccessLinkEditorSheet.tsx), existing session dashboard/share components | Staff can find a test, understand its state, create a session, and find its student link |
| 3. Live room | [SatSessionRoomRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/routes/SatSessionRoomRoute.tsx), existing roster/controls/inspector components, [sat-session-room.css](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/ui/sat-session-room.css) | Attention cases and action scope are obvious; controls remain stable during updates |
| 4. Authoring refinement | Existing `QuestionCardStack`, `SpineQuestionView`, `QuestionQueueRail`, and authoring styles | Authors can complete, duplicate, reorder, preview, and publish without losing pending edits |
| 5. Results refinement | [SatResultsRoute.tsx](/Users/rd-cream/Downloads/remix_-ielts-proctoring-system/src/products/sat/routes/SatResultsRoute.tsx), existing attempt rows and inspector | Review and export scope are clear; returning from a response preserves context |

Phase 1 establishes the shared design. Phases 2–5 can then ship as separate, reviewable changes. Reuse the current components and installed libraries; introduce a shared component only when multiple screens need the same behavior.

Because some SAT styling is shared, scope visual changes explicitly to staff surfaces so the student exam and preview remain stable.

**Verification before delivery**

Extend the existing tests around changed behavior, then verify:

- Role permissions and direct links still work.
- Both session entry points use the same setup and retain the pinned version.
- Save, preview, module switching, and publication preserve edits and collaboration.
- Cohort and individual actions clearly identify their targets.
- Reconnection and failed actions remain visible and recoverable.
- Keyboard navigation, focus restoration, contrast, reduced motion, and 44px touch targets work.
- Layouts work at 390px, 768px, and 1440px, including 200% zoom.

Run Bun typecheck/build, targeted lint and component tests, plus the existing authoring and results browser suites. Validate the final flow with representative staff: find a test, fix a question, create a session, locate a student needing attention, and review their result.

**Start with the staff foundation, session setup, and live room.** They provide the strongest improvement in familiarity; authoring already has much of the right interaction model.
