# SAT staff interaction contract

Applied reference: `Instacart_Rappi_UIUX_Microinteractions_Frontend_Engineering_SKILL.md`, supplied by the user, version 1.0.0 (2026-10-25).

The decisions below are **proposed adaptations for SAT administration**. They do not describe Instacart or Rappi's private design systems. The job is to prepare exams, operate rooms, review responses, and maintain scoring policies. Payment, shopping, delivery gestures, and native-app APIs do not apply. The earlier requirement for calm, non-disorienting motion remains in force.

## Route and state map

```mermaid
flowchart TD
  Exams["/sat/exams"] --> Create["Create exam: name → modules → scoring → review"]
  Create --> Questions["/sat/exams/:examId"]
  Questions <--> Settings["/sat/exams/:examId/settings"]
  Questions <--> Access["/sat/exams/:examId/access"]
  Questions <--> ExamResponses["/sat/exams/:examId/responses"]
  Questions <--> Preview["/sat/exams/:examId/preview"]
  Questions <--> Release["/sat/exams/:examId/release"]
  Rooms["/sat/sessions"] --> Room["/sat/sessions/:scheduleId"]
  Responses["/sat/results"] --> Detail["/sat/results/:resultId"]
  Responses --> Answers["/sat/results/attempts/:attemptId"]
  Forms["/sat/forms"] --> FormDetail["Response detail dialog"]
  Scoring["/sat/score-conversion"] --> Draft["Edit → validate → review → publish"]
```

For every mutation: `available → pending → confirmed | recoverable failure`. Motion never supplies a success state. The existing API/query controller continues to decide whether work was saved, published, assigned, exported, or completed.

## Component and variant inventory

| Surface family | Shared boundary | Behavior |
| --- | --- | --- |
| Exams, rooms, responses, forms, scoring | `SatRoot`, `SatPage`, `SatButton` | Stable page chrome; immediate press response; focusable pending buttons; no large-row shrinking |
| Search, filters, pagination | `SatSearchField`, `SatSegmentedControl`, list/query owners | Synchronous typing; URL-backed selection; keyboard arrows/Home/End; existing query identity and list-return policies |
| Creation and direct confirmations | `SatFormDialog`, `SatConfirmDialog` | Stationary fade; focus entry/return; native dialog semantics; brief close transition |
| Authoring, form editing, import, release, response detail | `AuthoringDialog`, `AuthoringConfirmDialog` | Staff tokens follow portals; safe confirmation focus; pending operations keep existing close guards |
| Preview, settings, question navigator, inspector, room links, attempt inspector | Shared Radix `SheetContent` | No full-width slide; caller focus policies retained; otherwise capture and restore the persistent opener |
| Context menus, nested menus, popovers, tooltips | Shared Radix portal components and `SatMenu` | Local fade; no zoom; menu dismissal cannot steal focus from a newly opened dialog |
| Question and answer editing | `QuestionCardStack`, `AnswerKeyField`, `RichQuestionComposer` | Selected content stays still; one radio tab stop; focus follows arrows; no equation-preview animation on each keystroke |
| Save, collaboration, upload | `SaveCluster`, conflict notice/resolver, upload editor | Persistent truthful text; failures actionable immediately; no success bounce; reduced motion retains labels |
| Live room assignment | `SatStaffRoutePanel` | Selected action stays focused and visibly busy; other choices blocked; success only after server acknowledgement |

## Interaction contracts and choreography

| Trigger | Immediate acknowledgement | Pending/result/recovery | Motion and interruption |
| --- | --- | --- | --- |
| Activate a small control | Press fill/scale in the current interaction | Dispatch existing handler immediately; explicitly `aria-disabled` actions never execute | 100 ms release; no wait before action |
| Change a local segment or exam section | Selected label and semantic state update | Route/query remains the source of truth; draft and return context retain existing owners | 160 ms local indicator; independent groups have unique identities; reduced motion swaps instantly |
| Open a dialog or sheet | Modal semantics and focus apply at once | Close/Escape follows existing dirty/pending policy; return to the connected opener without scrolling | 180 ms opacity entrance, 100 ms exit; no translate or scale; Radix owns interrupted presence |
| Change a question or resolve a field issue | Reveal the actual target with nearest scrolling | Preserve draft identity and focus the field; no animation-completion callback controls navigation | Immediate positioning; no animated movement of the editing plane |
| Type an equation | Render the current expression | Incomplete input keeps existing validation; no speculative server result | No keyed entrance or layout animation per keystroke |
| Save or assign | Busy semantics appear on the initiating control | Success follows acknowledgement; errors remain in context with existing Retry/Review actions | Save text remains readable during a brief fade; no bouncing success glyph |
| Load more form responses | The same button becomes busy | Repeated activation is ignored while pending; existing rows remain mounted | Spinner stays in the button footprint; reduced motion keeps a static progress cue |
| Load a list | Shape-preserving skeleton and named status | Existing empty, error, cached-data and retry branches remain authoritative | Gentle opacity variation instead of a sweeping staff-list shimmer; static under reduced motion |

## State ownership and TypeScript interfaces

- `SurfaceScopeContext: string | undefined` supplies staff surface classes across portals. It owns no business data. Outside `SatRoot`, it defaults to `undefined` and applies no SAT styles.
- `captureOverlayReturnTarget(): HTMLElement | null` resolves a menu item's persistent trigger using Radix's accessible relationship. A caller-provided focus policy still takes precedence.
- `SatButtonProps` retains `pending`, native `disabled`, and `aria-disabled`. Both boolean and string `true` block activation; string `false` remains enabled.
- `SatSegmentedControlProps<T>` retains controlled `value`, `options`, and `onChange`. Keyboard and pointer both dispatch that same contract.
- `AnswerKeyFieldProps` retains the existing `QuestionRevision` and `onChange` payload; selected answers remain keyed by option ID rather than presentation position.
- No backend interfaces, authorizations, retry/idempotency policies, query keys, or persistence schemas change for motion.

## Accessibility and exceptional states

- Reduced motion removes spatial motion, CSS surface animations, skeleton variation, and decorative editor flashes while retaining text, selection, progress, and recovery actions.
- Portaled sheets, dialogs, menus, popovers and tooltips receive the same preference rules as inline staff content.
- Keyboard focus enters the active surface and returns to a persistent, connected trigger. Explicit caller focus handlers are preserved. Restoring focus does not initiate a page scroll.
- Answer choices have one radio tab stop, visible focus, arrow selection/focus parity, and stable option identity. Multiple question editors have distinct heading IDs.
- Loading is scoped to the affected control/surface. Existing save-offline, reconnect, conflict, forbidden, validation, empty-result, and error branches are retained. No visual effect invents progress or confirmation.

## Observable QA and instrumentation

Automated coverage includes staff portal scoping (and its absence outside SAT), menu-to-sheet/dialog focus restoration, disabled-action semantics, segmented keyboard navigation, answer-choice focus/tab order, pending Module 2 assignments, native dialog focus, reduced-motion CSS, and opacity-only surface keyframes. Existing SAT, authoring, settings, room lifecycle, response, and score-conversion tests supply domain/error coverage.

Existing action logging, API request identities, save-state/live-region semantics, Radix `data-state`, `aria-busy`, and list-return markers remain the observation points. This change introduces no analytics service or collection of student information. Timing values are design budgets, not measured production latency or frame-rate claims.

Browser review uses the real shared components in a development-only fixture. Authenticated production journeys, physical-device profiling, actual OS reduced-motion settings, and full assistive-technology sessions require separate verification; component/CSS tests do not establish those results.

## Authoring section and created-room handoffs (2026-10-25)

**PROPOSED SAT adaptation of the explicitly requested `instacart-rappi-commerce-interaction-engineering` skill.** The task is repeated staff navigation (Questions ↔ Settings ↔ Rooms ↔ Responses), followed by managing a newly created room. React web, the installed React Router 7/Motion 12 stack, and existing save, authorization, and room-operation contracts remain the platform assumptions. These choices do not describe proprietary Instacart/Rappi behavior.

```text
Questions --immediate tab feedback + required save acknowledgement--> Settings / Rooms / Responses / Preview
Settings --save or existing discard decision--> another exam section
section click --> router loads destination module (source stays usable)
              --> guarded route commits --> content reveals; header stays steady
              --> saved window scroll and section-button focus restored

Create room --> syncing --> creating --> confirmed receipt
                                  |--> invalid / failed / unknown (existing recovery)
confirmed receipt --> open /sat/sessions/:scheduleId
                  --> loading: "Room created. Opening your room…"
                  --> ready: full room + dismissible confirmation + heading focus
                  --> read failure: creation remains confirmed; Retry reloads that room
```

| Component / variant | Contract and choreography |
| --- | --- |
| `useSatNavigate` / forward, replace, history | Uses the router's `viewTransition` option after the caller's existing save/unsaved-settings gate. Preserves state, replace, and history semantics. OS reduced motion skips native snapshots. Explicit opt-out remains available. |
| SAT data routes / module pending | The router awaits the exam/room route module before replacing the source. A quiet status appears after 200ms for longer waits; confirmed creation has its own pending copy. No arbitrary navigation timeout or invented percentage. |
| `ExamWorkspaceHeader` / selected section | Separate named snapshot prevents header travel or geometry interpolation. Selected-page semantics remain on real section actions. |
| Content / native, fallback, reduced | Native route content dissolves over 140ms, with the previous content fading out over 90ms on an opaque canvas. The fixed header does not fade. Unsupported-browser content entrances retain the 180ms fade from 0.88 to 1. No directional slide, zoom, blur, spring, stagger, or exit wait. Native snapshot and live entrance do not stack. Unsupported browsers use a mount-only content entrance. Reduced motion is immediate. |
| Window scroll / section arrival | Existing scroll-memory owner also restores forward section visits. Waits for the selected destination marker if content is lazy. New sections start at zero. Query-only edits do not trigger section focus. Existing inner editor state remains under its own controller. |
| Focus / tab or created room | Section changes focus the current section button; confirmed room arrival focuses the room heading without scrolling. A newly active field/sheet keeps its focus. Route-changing room sheets do not restore focus into the source page. |
| Created room / pending, ready, failed read | Confirmation travels with the returned schedule ID, never a speculative ID. A partial loading snapshot remains loading. Read errors retry the existing room; they do not restart creation. Existing offline, validation, unknown-result and idempotency recovery remain unchanged. |

Existing backend TypeScript interfaces remain `CreateSatRoomRequest`, `CreateRoomState`, and `SatRoomReceipt` in `contracts/satCreateRoom.ts`. The receipt's `room.scheduleId` is the destination; the router marker `{ satCreatedRoom: scheduleId }` is a local confirmation cue, not a new API or authorization decision. `AccessSessionBindings.onOpenRoom(scheduleId, { created: true })` carries the cue from the exam's Rooms list. Ordinary room opens omit it. A successful create still invokes `onRoomCreated(room, receipt)` only after the existing authoritative operation resolves.

Observable acceptance coverage:

- Preserve the route's authorization guard when loading its module before navigation.
- Preserve navigation state/options and skip native snapshots under reduced motion.
- Wait for a delayed section, then restore its window scroll/focus; do not steal focus from an active field.
- Keep confirmed room creation visible through loading/partial data and a failed destination read; Retry reads that room.
- Focus the created room title, allow dismissing its confirmation, and reject another room's marker.
- Keep the existing create failure, duplicate-submit, unknown-result recovery, dirty-settings and authoring save-gate tests passing.

Instrumentation uses existing router navigation state, Radix focus state, the selected-section `data-sat-exam-section` marker, the room-title marker and live-region copy. No analytics service or new collection of student data is introduced. The ignored `e2e/.generated/sat-navigation-review.html` fixture exercises actual shared header/sheet/room primitives and router navigation with clearly labeled local sample content. Its native handoff count verifies the browser integration, not production performance. Authenticated staff journeys, OS-level preference toggling and physical-device profiling remain unverified.

### Immediate Questions → Settings response (feedback correction)

The source of avoidable latency was the route barrier awaiting three active projection refetches after a confirmed save. The barrier now cancels pre-commit reads and marks those caches stale locally. Destination observers perform the fresh reads; Preview keeps its existing stale-data loading guard. No save acknowledgement is skipped. The Settings route module warms while Questions is open.

The requested tab highlights on the click frame and exposes `aria-busy` plus an Opening status while a necessary save or route load completes. Current-page semantics stay on the actual route. Refused saves restore the existing tab; a newer tab request supersedes an older pending save continuation, and unmount cancels those continuations. The native dissolve starts alongside route commit, with no decorative wait.

Focused tests cover immediate pending feedback, refusal recovery, out-of-order save waits, cancellation of pre-commit query responses, fresh destination reads, and the existing co-editing durability/offline barriers. Native timing values remain proposed budgets, not measured click-to-content latency. Authenticated browser latency is still unmeasured.
