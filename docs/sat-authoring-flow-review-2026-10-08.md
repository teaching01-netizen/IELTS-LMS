# SAT authoring, publishing, access, and session UX review

Recommendation: use Google Forms for editing and a Zoom-style session workspace for delivery. Make a **session** the recognizable object that owns the audience, student link, waiting room, live controls, and results.

This reviews the current working tree, including its uncommitted UX changes. The shared Questions / Delivery / Responses / Settings header already exists. This proposal builds on it. The local application redirected to sign-in; authenticated screens and backend scenarios were not exercised. Findings below are source-backed observations and UX inferences, not usability-test results. No application code was changed.

## Users and completion conditions

| User job | Completion |
| --- | --- |
| Author prepares a test | A valid, server-confirmed published version exists. |
| Authorized staff prepare a sitting | One identifiable session has the correct version, sections, access rules, and a usable student link. |
| Proctor runs a sitting | Students enter, the proctor starts and monitors the correct session, and completion exposes its results. |
| Student takes a sitting | The student understands whether they can join, must wait, can start, can resume, or have submitted. |
| Authorized reviewer checks results | They can locate the sitting and its students without finding the exam again. |

Keep existing permissions. Sharing student entry, publishing content, reading results, and running a session are different capabilities; a new navigation label must not grant access.

## Current path and findings

```text
Exam Library → Questions → Publish sheet → Publish version
  → Configure access → Create access group → Select group
  → Share and run → Start review → Session room → Responses

Alternate entry:
Global Sessions → New Session → Select exam + name + times
  → Schedule → Session room → Share student link
```

Overall assessment: **the structure has improved, but delivery still requires users to translate between overlapping objects.** No critical runtime failure was established. The strongest source-backed concerns are one access-policy clarity issue and several structural comprehension issues.

| Priority | Observation and evidence | UX implication |
| --- | --- | --- |
| P1 | The access editor offers Anyone / Cohort / Selected as peer audience choices. The admission boundary checks membership only for Selected. See [editor](../src/features/exam-authoring/ui/access-links/AccessLinkEditorSheet.tsx) and [entry policy](../backend/go/internal/accesslinks/entry.go). | Cohort can look like a restriction although it is a group label. Separate naming from access permission. |
| P2 | Creating an access group atomically creates a backing proctor-start schedule. Global New Session separately creates a schedule and asks a different set of questions. See [access creation](../backend/go/internal/accesslinks/service.go) and [Sessions](../src/products/sat/routes/SatSessionsRoute.tsx). | Staff must decide whether to create access or create a session even though both prepare a sitting. Neither path was shown to be broken. |
| P2 | Delivery contains access-group rows, link-detail tabs, editing and sharing sheets, session controls, and a setup guide. See [dashboard](../src/features/exam-authoring/ui/access-links/StudentLinksDashboard.tsx) and [details](../src/features/exam-authoring/ui/access-links/AccessLinkDetail.tsx). | Users must learn the link-management structure before they can run an exam. |
| P2 | Publish correctly creates a version without opening entry or starting a session. Its next action is Configure access for Version N. See [publish sheet](../src/features/exam-authoring/ui/publish/ExamPublishSheet.tsx). | The next action exposes a configuration concept instead of the user's goal: prepare a sitting. |
| P2 | Anytime availability still creates a proctor-start schedule. Entry and runtime are explicitly separate. See [access creation](../backend/go/internal/accesslinks/service.go) and [session states](../src/features/exam-authoring/ui/delivery/sessionState.ts). | Anytime can be mistaken for independent practice. Explain that it permits check-in and that the proctor controls the start. |
| P3 | The question workspace renders a selected question beside a navigator. See [workspace](../src/features/exam-authoring/ui/AuthoringWorkspace.tsx). | A module overview with compact question summaries would improve review and reordering. This is lower priority than delivery structure. |

Preserve the existing strengths: shared exam header, explicit version pins, distinct saving/publication indicators, separate entry/runtime states, stale-status handling, start review, and direct jumps to publish blockers.

## Alternatives

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| **Forms editor + session workspace — recommended** | Familiar editing, one delivery setup, clear live operations. Fits the current version + schedule + link model. | Requires unifying the two setup entry points and changing delivery presentation. |
| Extend the current Delivery page | Smallest immediate change; clearer labels and fewer controls. | Access group remains the main object and the alternative session setup remains confusing. |
| Full Classroom-style assignments | Useful if homework and class rosters are the main product job. | Adds another concept and requires genuine self-start behavior before it can represent practice accurately. |

## Recommended structure

```text
Global: Exams | Sessions | Results

Inside an exam:
← Exams   SAT Mock 06   Saved · Published version 3
Questions | Sessions | Results | Settings
                                    Preview   Create session
```

Questions remains the authoring home. When a draft has changes, its primary action is **Publish version**. After publication, the next suggested action is **Create session**. Publishing can still be completed without setting up a sitting.

### Editing: borrow Google Forms interactions

Google Forms keeps question type, answer choices, duplication, and answer keys close to the question being edited. Borrow those interactions, adapting them to SAT modules. [Editing reference](https://support.google.com/docs/answer/2839737?hl=en), [answer-key reference](https://support.google.com/docs/answer/7032287?hl=en).

- Use a module list of compact question summaries, expanding the selected question for editing. Keep the existing editor and its save ownership.
- Show the prompt, supporting passage/figure when needed, options, and answer key together.
- Keep required classification visible; disclose optional explanations and advanced properties.
- Keep one section/module selector and a compact progress summary. Label adaptive branches clearly.
- Preview returns to the same question and module. Publish blockers jump directly to their field.
- Provide keyboard alternatives to dragging. Avoid remounting rich editors in ways that lose selection, composition, or pending saves.

### Publishing: content becomes reusable

Use a focused sheet: scope, readiness, consequences, then **Publish version**. Keep timing and routing edits in Settings; the publish sheet may link there when a blocker requires it.

Success copy:

> Version 3 is published and ready to use in a session.
> Existing sessions continue using their current version.

Actions: **Create session** and **Done**. An existing setup can be reused from the session creation flow rather than presenting another branch immediately after publishing.

Google Forms combines publication with responder-access controls. Our adaptation deliberately retains separate version and session lifecycles because one exam can support several sittings. [Publication reference](https://support.google.com/docs/answer/2839588?hl=en).

### Preparing delivery: one creation flow

Both exam-level Create session and global New Session open the same setup. The exam entry preselects the exam and exact published version; the global entry asks for the exam first.

Use three short sections on one setup screen:

1. **Session:** name, published version, sections. Default sections to the version's supported scope.
2. **Students:** Anyone with the link or Listed students only. Put an optional class/group label under session naming. Describe a student code as identification; claim roster verification only when a roster is actually enforced.
3. **Check-in:** Open now or Scheduled window, with a visible timezone. State: “Students can join during this window. The proctor starts the exam.”

The result is one session with a generated student link. Reuse the existing atomic schedule/link creation where applicable; do not create duplicate schedules. Existing standalone schedules and their URLs must continue to work and be represented honestly.

Google Classroom groups the audience, dates, and posting choice around a single assignment. Borrow that task-centered setup without adding an Assignment entity now. [Assignment reference](https://support.google.com/edu/classroom/answer/6020265?co=GENIE.Platform%3DDesktop&hl=en).

### Running delivery: session workspace

After creation, open the session overview directly:

```text
Saturday morning mock · SAT Mock 06 · Version 3 · Full SAT

Check-in open · Exam not started
18 joined · 16 ready

Copy student link   Show QR              Open waiting room

Students | Results | Session settings
```

Put the consequential **Start exam** action in the waiting room, beside readiness and the version/section summary. Keep the existing start review. Starting the exam and opening its waiting room must remain distinguishable.

While running, prioritize the stage/clock, active students, attention items, and pause/end controls. After completion, **View results** becomes the main action. Stop showing setup guidance as the main content.

Zoom's scheduling flow centers the named meeting, time, optional invitees, and later sharing. Adapt that session-centered organization; SAT controls and permissions remain exam-specific. [Scheduling reference](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0060700).

The global Sessions page lists these same sessions across exams. The exam Sessions tab is a filtered view, not another kind of record.

### Student path

```text
Open student link → Identify / verify roster → Waiting room
  → Proctor starts → Begin exam → Submit → Receipt
```

The waiting room names the session, sections, and expected start behavior. Distinguish entry not open, not on roster, session not started, running, paused, completed, and connection failure. An existing student should see Resume when appropriate. A self-start practice mode should be introduced only with verified end-to-end support; Anytime alone must not imply it.

## State, recovery, and roles

| Flow | Success | Failure / interruption | Next action |
| --- | --- | --- | --- |
| Edit | Saved with server confirmation | Retain draft, show retry/conflict state, restore module/question | Preview or publish |
| Publish | Exact version confirmed | Preserve inputs; fix blocker; reconcile uncertain outcome before retry | Create session or finish |
| Create session | Session, audience, version, and link confirmed | Preserve setup; prevent duplicate sitting on retry | Open waiting room |
| Join | Correct waiting room | Explain access/window/roster failure; permit retry | Wait, begin, or resume |
| Start | Server-confirmed running state | Refresh stale status; disable repeat start; retain review context | Monitor |
| Finish | Submission/session completion confirmed | Reconcile pending/failed writes; expose truthful state | Receipt or results |

Keep publication, check-in, and runtime separate in the data and display. Prefer “Check-in open · Exam not started” to asking users to interpret several unrelated badges. Closing check-in must not claim that active attempts have stopped. Runtime pause must not claim that the student link is revoked.

Builders keep their current content/access capabilities. Proctors see the session information and controls their role permits. Results access remains role-gated. A refreshed or directly opened session must resolve its exam and version from persisted data; provide a stable return to the exam where authorized, without depending solely on navigation history.

## Delivery order and acceptance

First fix terminology and the Cohort permission implication. Then unify session setup and expose the same session in both global and exam views. Next make publication success lead to session creation and make the room adapt to waiting/running/finished state. Question-card refinement comes after those changes.

Acceptance scenarios:

- Creating from an exam or global Sessions uses the same setup and yields one sitting with a working student-entry URL.
- The post-publish setup pins the version just published even if another author publishes again.
- Class/group naming does not imply access restriction. Listed students requires a validated roster and blocks unlisted students at admission.
- Opening check-in never starts the exam. Closing check-in does not silently pause active attempts.
- A waiting room clearly shows the named session, exact version, sections, joined/ready counts, and explicit start consequence.
- A builder cannot gain start/results access through the new tabs; a proctor cannot gain draft access through return links.
- Refresh, browser Back, preview return, and publish-blocker return preserve the appropriate context and confirmed work.
- Failed creation/start, double activation, stale state, and concurrent publication cannot silently create duplicates or start the wrong version.
- Completed sessions retain historical versions and results; changes to an exam affect future setups only.
- Keyboard and screen-reader users can configure, join, and run the authorized flow; narrow screens reflow the detail workspace instead of placing key controls below a long list.

Before implementation acceptance, exercise those scenarios in an authenticated browser. Current UX conclusions are inferred from source; conversion/drop-off, task time, mobile layout, and actual user comprehension have not been measured. A practical usability check is to ask new staff to prepare and run one named mock exam without explaining publication/access/session terminology first, then record hesitation, backtracking, and completion.

Regression boundaries: preserve existing exam/access/session URLs, role policies, draft saving and collaboration, immutable version pins, section locks after participation, schedule timing, existing standalone sessions, start confirmations, and historical results. This proposal requires no database redesign merely to change the user-facing organization.
