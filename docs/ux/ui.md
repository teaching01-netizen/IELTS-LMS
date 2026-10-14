# SAT Internal Platform — End-to-End UX Redesign

Repository reviewed: [IELTS-LMS](https://github.com/teaching01-netizen/IELTS-LMS), current `main` branch.

My recommendation is to redesign the entire SAT staff journey around one simple sequence:

Create

Edit

Publish

Room

Once the room exists: Share → Run exam → View results

The staff experience should feel like Google Forms for creating and publishing an exam, Google Classroom for configuring the session, and Kahoot for getting students into a room.

## 1. What is making the current flow complicated?

After inspecting the actual React routes and components, I found several points where the experience becomes more complicated than necessary.

| Current implementation                                                              | UX problem                                         | Recommended change                                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| Global Create room uses a five-step flow                                            | Too much navigation for common configurations      | One compact setup form                                             |
| Exam-specific Create room uses four steps                                           | Staff must repeatedly press Continue               | Display essential fields immediately                               |
| Publish opens a separate sheet, then a success screen, then room setup              | A task feels like several separate workflows       | Seamless Publish → Create room transition                          |
| Full SAT/R&W/Math can be selected at publishing and sections again at room creation | Two decisions that appear similar                  | Clearly separate published content from what this sitting uses     |
| Exam Settings, Quick settings and settings inside Publish all exist                 | Several entry points to the same configuration     | One canonical settings editor                                      |
| Five session types appear as technical choices                                      | Staff must understand adaptive-routing terminology | Simple Practice/Classroom choice, with advanced routing underneath |
| Rooms exist both globally and inside each exam                                      | The distinction isn't immediately apparent         | Same room-management experience, filtered by context               |
| Room details, check-in controls, live room and sharing use separate surfaces        | Staff must learn where each action lives           | One Room page with contextual sections                             |

This is primarily an information architecture and interaction design problem, not a missing component-library problem.

### Important things already implemented correctly

The code has several safeguards that must be preserved: published versions are immutable, room creation pins an exact version, publish checks verify the committed draft, and room creation uses one server mutation for the linked room setup. These are good foundations.

We should remove unnecessary user decisions and navigation, not the safety checks.

## 2. Which famous apps should we copy?

Google Forms — Create and publish

Keep editing focused. Settings remain accessible. Publishing is explicit, and sharing becomes available at the right moment.

[Official publishing flow](https://support.google.com/docs/answer/2839588)&#x20;

[image](https://www.google.com/s2/favicons?domain=https://support.google.com\&sz=32)

Google Docs Editors Help



Google Classroom — Configure a session

Present the task and its most important settings together. Use defaults for routine decisions; offer scheduling and drafts when needed.

[Official assignment workflow](https://support.google.com/edu/classroom/answer/6020265)&#x20;

[image](https://www.google.com/s2/favicons?domain=https://support.google.com\&sz=32)

Classroom Help



Kahoot! — Room and live controls

After setup, go directly to the lobby. Make joining, waiting participants, and the appropriate start action obvious.

[Official hosting flow](https://support.kahoot.com/hc/en-us/articles/360039422694-How-to-host-a-live-kahoot)&#x20;

[image](https://www.google.com/s2/favicons?domain=https://support.kahoot.com\&sz=32)

Kahoot! Help & Resource Center



Typeform — Publishing handoff

After publishing, immediately surface the meaningful next action rather than leaving staff in a technical release-management view.

[Official share flow](https://help.typeform.com/hc/en-us/articles/360029252892-Share-your-form)&#x20;

[image](https://www.google.com/s2/favicons?domain=https://help.typeform.com\&sz=32)

Help Center



These are interaction patterns to adapt, not workflows to copy mechanically. SAT has stricter requirements for exam versions, candidate identity, timing, and adaptive routing than those products.

## 3. The new SAT user journey

I would design three paths based on what staff are trying to accomplish.

A. New exam

Create exam → Add questions → Publish → Create room → Room ready

B. Existing published exam

Open exam → Create room → Room ready

C. Reusing an exam

Open exam → Create another room → Reuse previous settings → Room ready

For an exam with unpublished changes, show a clear choice between using the currently published version and publishing those changes first. Never silently deliver an unpublished draft.

### Screen A — Exam creation

Your existing Create exam dialog is already close to ideal.

## Create SAT exam

Give your exam a name. You can edit its content and settings afterward.

Exam name

e.g. SAT Mock Test — October

Cancel

Create exam

No section selection, publishing settings, scheduling or room options at this stage. Create the standard SAT structure as your existing code does and take the user directly into the question editor.

### Screen B — Exam editor

Keep a persistent exam identity and lifecycle indicator:

## SAT Mock Test — October

Draft

All changes saved

Publish

Questions

Rooms

Results

Settings

Reading & Writing · Module 1

Ready for review

Question editing workspace

Your existing editor stays in place

The top-right primary action changes according to the actual lifecycle:

| State                                 | Main action                                     |
| ------------------------------------- | ----------------------------------------------- |
| Never published, editing              | Publish                                         |
| Published, no changes                 | Create room                                     |
| Published, new draft changes          | Publish changes                                 |
| Published, but staff want old content | Create room using published version (secondary) |
| Cannot publish                        | Review issues                                   |

Don't make staff open a separate release-management page simply to learn whether their exam is ready.

### Screen C — Publish

Copy the Google Forms pattern: a focused review before making content available.

Keep the essential information visible:

- What is being published: Full SAT, Reading & Writing, or Math.
- Whether all required checks pass.
- Which question or setting needs fixing, if blocked.
- Which published version will be created.

Publishing must remain an explicit action. Do not publish automatically when someone clicks Create room if the exam is still a draft.

After a successful publish, offer Create room as the prominent next action and Done as an alternative. The existing code already provides those actions; the main improvement is making the handoff feel continuous and removing unnecessary room-setup screens.

### Screen D — Create room

This is where I would make the biggest change.

Replace the current four-/five-step wizard with one compact configuration sheet. Its default layout should work for most practice sessions without opening advanced settings.

## Create room

SAT Mock Test — October · Published Version 2

Room name

Saturday Morning SAT

Session type

Practice

Standard SAT

Classroom

Teacher controls

Who can join?

Anyone with the link

Check-in

Open now

Opening check-in does not start the exam.

More options

Sections, identification, scheduling

Cancel

Create room

This is a conceptual design, not an interactive production form. Actual defaults and choices must come from the published exam and server-supported room configuration.

Crucially, don't remove the important capabilities. Place them contextually:

- Selecting Classroom reveals adaptive/forced/teacher-selected Module 2 behavior.
- Selecting Listed students only reveals the student roster input.
- Selecting Scheduled reveals the check-in date and time fields.
- If the published version contains both SAT sections, staff may choose a subset for this room; if only one section is available, don't show a meaningless choice.
- Student identification remains a separate setting from the shared exam-start code.

This uses progressive disclosure: simple defaults first, advanced configuration only when needed.

### Screen E — Room ready

After the backend confirms creation, go directly to the actual room.

Don't land on another room-details page that asks staff to select the newly created room.

The room should immediately show the correct student link, QR presentation, student list, and applicable start behavior. Staff can share the room or begin running it according to the chosen session mode.

This matches the essential Kahoot hosting interaction: select a game, configure the session, enter the lobby, then manage participants.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://support.kahoot.com\&sz=32)

Kahoot! Help & Resource Center



## 4. Simplify Settings into three clear concepts

Today, exam-level settings and room-level settings can feel interchangeable. They should be distinguished by what they control.

| Setting location   | What belongs there                                                              | When staff use it                    |
| ------------------ | ------------------------------------------------------------------------------- | ------------------------------------ |
| Exam Settings      | Module timing, breaks, adaptive threshold, scoring and result visibility        | While preparing exam content         |
| Room Settings      | Room name, admitted students, identification, check-in window, enabled sections | While preparing a particular sitting |
| Live Room Controls | Start, pause/resume, add time, student interventions, complete exam             | During a sitting                     |

The existing `DeliverySettingsPanel` already powers both `ExamSettingsPage` and `ExamSettingsSheet`. Keep one underlying editor, but avoid creating additional settings entry points inside Publish.

A clean approach is: Settings tab for full editing, and Quick settings as an optional shortcut to the same editor. The Publish sheet should link to Settings when changes are needed, then restore publishing context after saving.

For room settings, enforce the current lifecycle constraints. Your code locks the room's section scope once students participate and only exposes session-type selection during creation. Display these restrictions clearly instead of presenting controls that cannot actually be changed.

## 5. The frontend architecture I would implement

Keep the existing API contracts and business logic. Refactor the UI around reusable flows.

```

SAT Staff
│
├── Exams
│   └── Exam workspace
│       ├── Questions
│       ├── Rooms
│       ├── Results
│       └── Settings
│
├── PublishExamSheet
│   ├── Publish scope
│   ├── Readiness checks
│   └── Publish result
│       └── Create room
│
├── CreateRoomSheet
│   ├── Room name
│   ├── Session type
│   ├── Audience
│   ├── Check-in
│   └── More options
│       ├── Sections
│       ├── Student identification
│       ├── Student roster
│       └── Module 2 policy
│
└── Room workspace
    ├── Student entry
    ├── Student roster
    ├── Current exam / controls
    └── Results

```

### File-by-file implementation

| Priority | Current file                                         | Change                                                                              |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| P0       | `AccessLinkEditorSheet.tsx`                          | Replace SAT guided steps with one responsive, progressively disclosed form          |
| P0       | `SatNewSessionFlow.tsx`                              | Move global exam selection into the same room setup sheet                           |
| P0       | `StudentLinksDashboard.tsx`                          | Preserve version pin and single creation mutation; direct users to the created room |
| P0       | `ExamPublishSheet.tsx`                               | Simplify Publish → Create room handoff, keeping the exact publish receipt           |
| P1       | `ExamWorkspaceHeader.tsx`                            | Use consistent lifecycle-aware primary actions and simpler navigation               |
| P1       | `SatExamLibraryRoute.tsx`                            | Clarify opening, editing and managing an exam                                       |
| P1       | `ExamSettingsPage.tsx`, `ExamSettingsSheet.tsx`      | Consolidate the settings experience around the existing shared panel                |
| P1       | `SatAccessRoute.tsx`                                 | Keep exam-specific rooms and global rooms using the same creation experience        |
| P2       | `AccessLinkDetail.tsx`, `AccessLinkSessionPanel.tsx` | Reduce duplicated room information and share actions                                |

I would extract a `SatCreateRoomForm` containing the actual fields, validation and request construction, and use it from both global and exam-specific entry points. Avoid implementing two separate forms with superficially similar layouts.

## 6. Important technical rules

The flow should feel automatic to staff, but the system must remain explicit about consequential actions.

Publishing and creating a room are separate server operations. We can make them feel continuous in the UI without pretending they are one atomic transaction. If publishing succeeds and room creation fails, keep the published version and offer a safe retry of room setup—never silently publish another version.

Room creation should still submit once with its selected audience, check-in window, session type and immutable published-version ID. When the response is uncertain, reconcile server state before offering another submission; do not blindly create a duplicate room.

The existing protections for unsaved drafts, stale publish checks, roster validation, invalid dates, room revision conflicts and permission checks should remain.

### Important behavior cases

| Situation                                   | Correct UX                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Exam has no published version               | Explain that publishing is required, with a direct Publish action                        |
| Published exam has draft edits              | Clearly offer existing published version or Publish changes first                        |
| Staff create a room from global Rooms       | Choose published exam inside the room setup sheet                                        |
| Staff create a room from an exam            | Exam and published version are already selected                                          |
| Staff choose a one-section sitting          | Show only supported sections and explain score implications                              |
| Staff choose teacher-selected Module 2      | Show the routing behavior clearly; assignments remain tied to real students and sections |
| Staff try to edit locked room settings      | Explain why and offer Duplicate setup where appropriate                                  |
| Room creation succeeds but navigation fails | Show the confirmed room and a working Open room action                                   |
| User lacks permission to operate a room     | Show the permitted management/sharing experience, not inaccessible controls              |

## 7. Implementation sequence

01

Simplify Create room first

Remove the five-step and four-step SAT wizards in favor of one shared sheet. Keep validation, conditional fields and version pinning. This delivers the largest reduction in friction.

02

Improve Publish → Room transition

Keep the same publish mutation, but simplify the success state and transition into the shared creation form without requiring an unnecessary visit to the room-management list.

03

Unify exam navigation and settings

Make Create room, Publish, Edit questions and Settings discoverable from the same exam workspace, with one primary action determined by the exam's lifecycle.

04

Polish Room ready and recovery

Make the landing screen immediately usable. Improve the next action, sharing, and error recovery without changing live exam timing or routing.

### Tests to update

Your existing `e2e/sat-staff-room-ux.spec.ts`, `e2e/sat-authoring-lifecycle.spec.ts`, `SatSessionsRoute.test.tsx`, `AccessLinkEditorSheet.interaction.test.tsx`, and `ExamPublishSheet.test.tsx` already cover significant parts of the flow.

Update the guided-step assertions to the new single-sheet behavior while preserving tests for pinned versions, duplicate-submit prevention, focus restoration, invalid windows, incomplete exams, successful publishing and safe retries.

The acceptance target is simple: an administrator with an existing published SAT exam should be able to open Create room, enter the necessary details, submit once, and arrive at a usable room without stepping through unrelated configuration screens.

## Final recommendation

The central design principle for your internal SAT platform should be:

Every screen has one obvious next action, and the system handles routine complexity without asking teachers to make unnecessary decisions.

Your existing code already has most of the important functionality. I would avoid a large rewrite or introducing a new UI framework.

Instead, make Create room a single well-designed sheet, make Publish lead naturally into it, and make Exam Settings and Room Settings unambiguous.

That gives you the familiar usability of Google Forms, Google Classroom and Kahoot, while keeping the precise versioning and exam controls that SAT requires.