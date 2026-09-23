Below is the implementation plan I would hand to the engineer/AI coding agent. It is scoped to the current SAT student-delivery architecture in `teaching01-netizen/IELTS-LMS` and intentionally avoids changing server-authoritative timing.

## SAT Student Transition Simplification — Implementation Plan

### Goal

Remove student-facing transition/directions UI from normal SAT progression.

The desired student experience is:

```text
Pre-start waiting
      ↓ automatic
Reading/Writing Module 1
      ↓ automatic
Reading/Writing Module 2
      ↓
Scheduled Break
      ↓ automatic
Math Module 1
      ↓ automatic
Math Module 2
      ↓
Complete
```

Only the **scheduled break** should be a dedicated between-exam screen.

The following must **not** appear during normal flow:

```text
"Begin module"
Module directions screen
"Starting your module…"
full-screen loading page
old transition UI
blank/white flash
```

Internal controller states may still exist, but internal states such as `directions` must not automatically become visible pages.

---

## 1. Establish the UX/state contract first

Treat these as separate concepts:

```ts
// Domain/controller state
type SatRunnerPhase =
  | "loading"
  | "directions"
  | "module"
  | "review"
  | "break"
  | "submitting"
  | "complete";

// Student-visible surface
type SatStudentSurface =
  | "pre-start"
  | "exam"
  | "scheduled-break"
  | "submitting"
  | "complete"
  | "fatal-error";
```

Do **not** create a 1:1 mapping such as:

```ts
directions -> DirectionsScreen
```

Instead derive the visible surface from runtime intent.

Core rule:

```text
directions = orchestration state
not necessarily a UI state
```

Acceptance rule:

> During a healthy SAT session, a student should never be able to identify that the controller entered `directions`.

---

## 2. Change Module 1 → Module 2 entry policy

### Current problem

`src/features/student-delivery/application/satEntry.ts`

currently distinguishes between:

```text
Module 1 timed out
→ Module 2 auto-starts

Module 1 submitted early
→ Module 2 waits for student
→ SatDirectionsScreen
→ Begin Module button
```

This is the main reason Module 1 → Module 2 still exposes old transition UI.

### New behavior

Once the server has selected the adaptive branch and supplied a `not_started` Module 2 attempt, Module 2 should automatically open.

Change the branch-module policy from conceptually:

```ts
if (isBranch) {
  return predecessorTimedOut
    ? autoStart()
    : awaitStudent();
}
```

to:

```ts
if (isBranch && attemptIsNotStarted) {
  return {
    shouldStart: true,
    reason: "next-module-entry",
    autoStartPending: true,
  };
}
```

The client must **not** choose the branch.

The server still owns:

```text
Module 1 scoring
→ adaptive routing
→ lower/higher Module 2 selection
```

The frontend only opens the `moduleId` it receives.

### Files

Primary:

```text
src/features/student-delivery/application/satEntry.ts
```

Tests:

```text
src/features/student-delivery/hooks/__tests__/
  useSatExamController.autoEntry.test.tsx

src/features/student-delivery/application/__tests__/
```

Remove `previousModuleTimedOut` from entry policy if it becomes unused elsewhere. Do not leave dead conditional logic simply to minimize the diff.

---

## 3. Preserve `directions` internally but stop rendering it normally

Primary file:

```text
src/features/student-delivery/routes/SatStudentSessionRoute.tsx
```

Currently:

```tsx
if (state.phase === "directions") {
  ...
  return <SatDirectionsScreen ... />;
}
```

Replace this with a presentation decision.

Normal `directions` cases should fall into one of three states:

```text
A. Runtime has not started yet
   → retain/show pre-start waiting surface

B. A module is being entered
   → retain the previous stable surface

C. Scheduled section break exists
   → SatScheduledBreakScreen
```

`SatDirectionsScreen` should therefore not be mounted in real healthy student delivery.

Do not simply replace it with:

```tsx
<SatLoadingSurface />
```

That would replace one transition page with another.

---

## 4. Create a derived presentation selector

Avoid accumulating another large conditional tree directly inside `SatStudentSessionRoute.tsx`.

Create something similar to:

```text
src/features/student-delivery/application/
  satStudentSurface.ts
```

Suggested contract:

```ts
export type SatStudentSurface =
  | { kind: "pre-start" }
  | { kind: "exam" }
  | {
      kind: "scheduled-break";
      phase: "waiting" | "break" | "opening-next-section";
      remainingSeconds: number | null;
      nextSectionKey: SatSectionKey;
    }
  | { kind: "hold-exam-frame" }
  | { kind: "submitting" }
  | { kind: "complete" }
  | { kind: "fatal-error" };
```

Example selector:

```ts
deriveSatStudentSurface({
  runnerPhase,
  runtimeStatus,
  pendingBreakSeconds,
  pendingSectionWaitSeconds,
  entryInFlight,
  entryRecoverable,
  hasPreviousExamFrame,
});
```

Benefits:

* route becomes easier to reason about;
* runtime state and UI state cannot accidentally become coupled again;
* transitions become unit-testable;
* future timing changes won't require another UI rewrite.

---

## 5. Waiting → Module 1 must transition directly

Today the controller correctly waits for:

```text
scheduleRuntimeStatus === "live"
```

before auto-entry.

Keep that behavior.

Current important test:

```text
stays in the waiting room through recovery polls
while runtime is not_started
```

That invariant must remain.

However, when the proctor starts the session:

```text
pre-start UI
      ↓
startModule()
      ↓
module UI
```

Do not insert:

```text
pre-start
→ directions
→ "Starting module…"
→ module
```

### Presentation rule

While first-module `startModule()` is in flight:

```text
keep the pre-start surface mounted
```

When the module payload is confirmed:

```text
replace pre-start with SatExamShell
```

This avoids the flash.

---

## 6. Module 1 → Module 2 should retain the exam frame

This should feel like content changing within one app rather than navigating between pages.

You already have:

```ts
lastValidFrameRef
```

in `SatStudentSessionRoute.tsx`.

Extend the concept rather than building another transition component.

Desired behavior:

```text
Module 1 question/review
        ↓ submit
Module 1 frame temporarily remains
        ↓
server returns routed Module 2
        ↓
Module 2 exam replaces it
```

However, the retained frame must not remain interactive.

Best practice is to separate:

```ts
lastStableExamFrame
```

from a live interactive exam.

While entry is occurring:

```tsx
<div
  inert
  aria-hidden="true"
  data-sat-transition-hold
>
  {lastStableExamFrame}
</div>
```

Do not allow:

* changing answers;
* navigation;
* reopening calculator;
* keyboard shortcuts;
* submitting again.

Prefer retaining visual continuity for a short network handoff rather than exposing temporary controller state.

---

## 7. Put a bounded recovery limit on invisible transitions

A hidden transition must not become an infinite frozen exam page.

Define explicit transition states.

For example:

```ts
const NORMAL_ENTRY_HOLD_MS = 1500;
const ENTRY_RECOVERY_SURFACE_MS = 5000;
```

Conceptually:

```text
0–1.5 s
→ retain previous surface silently

1.5–5 s
→ still retain it, optional subtle non-blocking progress if needed

>5 s and retries failing
→ dedicated recovery/error state
```

Do not use the exact durations as business logic.

Server state still determines whether entry is allowed.

The timeout only determines presentation/recovery escalation.

For genuine failure:

```text
We’re having trouble opening the next module.

Your saved answers are safe.

[Retry]
```

This is an exceptional error state, not part of normal navigation.

---

# 8. Make scheduled break the single deliberate transition surface

Current code has break-related visual states split between:

```text
state.phase === directions
+ pendingSectionWaitSeconds

state.phase === directions
+ pendingBreakSeconds

state.phase === break
```

Visually these should be one component.

I recommend moving toward:

```text
src/features/student-delivery/ui/break/
  SatScheduledBreakScreen.tsx
```

instead of continuing to treat it as generic `ui/transitions`.

Suggested API:

```ts
interface SatScheduledBreakScreenProps {
  phase:
    | "waiting-for-break"
    | "on-break"
    | "opening-next-section";

  remainingSeconds: number | null;
  nextSectionKey: SatSectionKey;
}
```

One mounted component should handle:

```text
student finishes early
      ↓
waiting-for-break

shared section deadline reached
      ↓
on-break

break reaches 0
      ↓
opening-next-section

module ready
      ↓
exam
```

Do not unmount/remount separate full-screen components for each substate.

---

# 9. Break screen UX

The break screen should be calm and intentionally sparse.

Desktop:

```text
┌────────────────────────────────────────────┐
│                                            │
│                   Break                    │
│                                            │
│                   09:42                    │
│                                            │
│             Take a short break.            │
│                                            │
│                Math is next                │
│                                            │
│     Your next section starts automatically │
│                                            │
└────────────────────────────────────────────┘
```

The hierarchy should be:

```text
small contextual label
↓
large countdown
↓
primary status
↓
next section
↓
quiet explanatory copy
```

Avoid:

* cards inside cards;
* strong borders;
* large warning banners;
* progress bars;
* unnecessary buttons;
* excessive helper copy.

The student has nothing to decide here.

---

## 10. Early-finish state

If the student finishes Module 2 before the shared section deadline, this is **not yet their scheduled break**.

Keep the same visual shell.

Example:

```text
Section complete

03:18

Your break begins in 3:18.

Math is next
```

This is preferable to switching to another "waiting" page.

When the shared section deadline is reached, update only the text:

```text
Break

10:00
```

The student's visual position should barely change.

---

## 11. Break → next section

When break reaches zero:

Do not immediately replace it with a loading screen.

Update the same component:

```text
Opening Math…

Your next section starts automatically.
```

Timer can become:

```text
—
```

or disappear.

Then once module entry has succeeded:

```text
SatScheduledBreakScreen
       ↓ crossfade
SatExamShell
```

---

# 12. Motion specification

Reuse the existing SAT motion infrastructure:

```text
src/features/student-delivery/ui/motion/
  SatPresenceSurface.tsx
  satMotion.ts
```

Current values are already appropriate:

```ts
state: 130ms
surface: 160ms
surfaceExit: 110ms
```

Do not create long cinematic transitions.

Recommended behavior:

### Waiting → exam

```text
exam opacity: 0 → 1
translateY: 4px → 0
duration: ~160ms
```

### Module 1 → Module 2

Prefer no full-page directional animation.

Use:

```text
old question content fades
→ new question content appears
```

around 130–160 ms.

Do not slide the whole application horizontally.

### Enter break

```text
opacity + 4px vertical settle
~160ms
```

### Waiting-for-break → break

Only crossfade changed text.

The timer must remain spatially stable.

### Break → next exam

```text
break opacity: 1 → 0
exam opacity: 0 → 1
```

Keep it under ~200 ms.

### Reduced motion

Existing `useReducedMotion()` support must remain authoritative.

Reduced-motion mode should avoid transform animation and use effectively instant/very short state changes.

---

# 13. Do not remount the whole SAT shell unnecessarily

Avoid code such as:

```tsx
key={`${phase}:${moduleId}`}
```

on the top-level application container if it causes the entire tree to remount.

That can create:

* calculator reload;
* preference reset;
* zoom reset;
* scroll jumps;
* focus jumps;
* selection state loss;
* expensive Desmos remounting.

Only key the smallest content region that truly represents a different module.

Preserve stable outer application chrome wherever possible.

---

# 14. Preserve authoritative timing

Do **not** modify the server timing architecture for this ticket.

Keep:

```text
cohort_section_v3
cohort_runtime
serverNow
deadlineAt
runtimeRevision
nextSectionStartAt
entryWindowSeconds
```

The frontend must never invent when:

* a module begins;
* a break starts;
* a break finishes;
* a section becomes active.

Motion and visual retention can hide orchestration, but they must not alter timing.

---

# 15. Keep existing entry retry/dedupe guarantees

`useSatModuleEntry.ts` already provides important behavior:

```text
single-flight module start
retry failed start
retry inert start response
dedupe successfully opened module
```

Preserve that.

Specifically ensure:

```ts
canAttemptEntry()
settleEntry()
SAT_ENTRY_RETRY_WINDOW_MS
```

continue protecting duplicate start requests.

The UX simplification must not produce:

```text
POST /modules/start
POST /modules/start
POST /modules/start
```

for the same transition.

---

# 16. Update application tests first

I would implement this using TDD.

### `satEntry` policy tests

Add/modify tests for:

```text
AT-01
Module 1 timed out
→ selected Module 2 auto-starts

AT-02
Module 1 submitted early
→ selected Module 2 ALSO auto-starts

AT-03
branch module does not exist yet
→ do not invent/start one

AT-04
branch attempt already active
→ do not start again

AT-05
runtime not live
→ do not start

AT-06
proctor paused
→ do not start

AT-07
stage not ready
→ do not start
```

Remove the old expectation:

```text
early Module 1 submit
→ awaiting-student
```

That is now obsolete.

---

# 17. Controller tests

Primary:

```text
src/features/student-delivery/hooks/__tests__/
useSatExamController.autoEntry.test.tsx
```

Required scenarios:

```text
1. pre-start
   runtime not_started
   → zero startModule calls

2. runtime becomes live
   → exactly one first-module start
   → phase becomes module

3. Module 1 timeout
   → selected Module 2 starts automatically

4. Module 1 early submit
   → selected Module 2 starts automatically

5. duplicate bootstrap/socket event
   → still one start request

6. first start fails
   → retry occurs
   → student eventually reaches module

7. start request returns module still not_started
   → retry allowed

8. scheduled break active
   → no next-section start

9. break reaches authoritative boundary
   → next section starts automatically

10. transition conflict / SECTION_NOT_ACTIVE
    → silently retry
    → do not show fatal student error
```

The old test:

```text
leaves Module 2 to the student when Module 1 was submitted early
```

should be replaced.

---

# 18. Route presentation tests

Primary:

```text
src/features/student-delivery/routes/__tests__/
SatStudentSessionRoute.between-sections.test.tsx
```

Add explicit negative assertions.

### Waiting → Module 1

During auto-entry:

```ts
expect(
  screen.queryByRole("button", { name: /Begin module/i })
).not.toBeInTheDocument();

expect(
  screen.queryByText(/Starting your module/i)
).not.toBeInTheDocument();
```

And verify the waiting UI remains until exam content is available.

### Module 1 → Module 2

Assert:

```text
no directions heading
no Begin Module button
no full-screen SAT loader
no break page
```

Then rerender the mocked controller as Module 2 and assert:

```text
Module 2 question is rendered.
```

### Break

Assert that this is the only planned transition surface:

```text
On break
timer
Math is next
automatic-start copy
```

---

# 19. Component continuity test

This is important for the smoothness requirement.

Give the scheduled-break surface a stable test identifier:

```tsx
data-testid="sat-scheduled-break"
```

Test:

```text
waiting-for-break
→ rerender on-break
→ rerender opening-next-section
```

and assert:

```ts
const initial = screen.getByTestId("sat-scheduled-break");

rerender(...);

expect(screen.getByTestId("sat-scheduled-break")).toBe(initial);
```

This catches accidental remounts.

Do the same where appropriate for stable exam chrome.

---

# 20. Interaction safety test during frame retention

When the previous Module 1 frame is retained while Module 2 opens:

verify it is inert.

For example:

```ts
expect(heldSurface).toHaveAttribute("inert");
```

and test that:

```text
Next button does nothing
answer selection cannot change
calculator cannot open
keyboard shortcut cannot mutate state
```

This prevents the smooth-UI solution from introducing a correctness bug.

---

# 21. Accessibility tests

Break screen:

```text
exactly one H1
timer has role="timer"
timer has useful aria-label
next section communicated as text
no disabled fake CTA
no unnecessary live-region spam
```

During state changes:

Use a polite announcement for important changes such as:

```text
Break started.
Opening Math.
```

Do not make every countdown tick an `aria-live` update.

Reduced-motion behavior should also have coverage.

---

# 22. E2E transition test

Add a focused Playwright scenario.

Recommended test:

```text
SAT student seamless progression
```

Flow:

```text
1. Student enters before proctor starts.
2. Confirm waiting screen.
3. Proctor starts exam.
4. Confirm Question 1 appears directly.
5. Confirm directions UI never appears.
6. Complete/submit Module 1 early.
7. Backend returns routed Module 2.
8. Confirm Module 2 appears automatically.
9. Confirm no Begin Module button.
10. Finish Module 2.
11. Confirm scheduled break page.
12. Advance authoritative break clock.
13. Confirm Math appears automatically.
14. Confirm no intermediate directions/loading screen.
```

Use DOM assertions rather than screenshot-only assertions.

Also capture video/screenshots in CI for this particular flow if your Playwright setup already supports artifacts.

---

# 23. Regression cases

Explicitly test:

```text
refresh during pre-start
refresh during Module 1
refresh while Module 2 is being opened
refresh during break
refresh at exact break boundary
refresh immediately after next section starts
offline during Module 1 → Module 2 transition
socket duplicate event
poll duplicate event
proctor pauses during entry
runtime terminates during transition
final module submission
```

None of these should accidentally resurrect `SatDirectionsScreen`.

---

# 24. Cleanup after behavior is migrated

The student route and preview/staff routes had no remaining live use for
`SatDirectionsScreen`. The component, its direct tests, and its directions-only
copy were removed with the migration. The separate `SatBreakScreen` remains
owned by `SatPreviewRoute`; student delivery uses `SatScheduledBreakScreen`.

Keep this ownership explicit if preview behavior changes later:

```text
preview break → SatBreakScreen
student scheduled break → SatScheduledBreakScreen
```

---

# 25. Files likely affected

Core:

```text
src/features/student-delivery/application/satEntry.ts
src/features/student-delivery/application/satStudentSurface.ts     // new
src/features/student-delivery/hooks/useSatExamController.ts
src/features/student-delivery/routes/SatStudentSessionRoute.tsx
src/features/student-delivery/ui/break/SatScheduledBreakScreen.tsx // new/refactor
src/features/student-delivery/domain/satCopy.ts
```

Tests:

```text
src/features/student-delivery/application/__tests__/
src/features/student-delivery/hooks/__tests__/
  useSatExamController.autoEntry.test.tsx

src/features/student-delivery/routes/__tests__/
  SatStudentSessionRoute.between-sections.test.tsx

src/features/student-delivery/ui/break/
```

Plus one Playwright transition-flow test.

---

# Definition of done

The implementation is complete only when all of these are true:

```text
✓ Waiting → Module 1 is automatic
✓ No directions UI appears

✓ Module 1 → Module 2 is automatic
✓ This is true for timeout AND early submit
✓ No Begin Module button appears

✓ Server still owns adaptive Module 2 choice

✓ Module 2 → scheduled break shows the break screen

✓ Early section completion stays on the same break/wait shell

✓ Break → next section is automatic

✓ No loader/directions flash at the break boundary

✓ Previous exam content cannot be interacted with while held

✓ Existing server-authoritative clocks are unchanged

✓ Duplicate events cannot duplicate module starts

✓ Failed entry remains retryable

✓ prefers-reduced-motion is respected

✓ Mobile/iPad/desktop do not overflow or jump

✓ Unit + route + controller + E2E tests cover the complete lifecycle
```

## Transition verification map

| Requirement | Evidence |
| --- | --- |
| Pre-start, automatic entry, early branch routing, retries, duplicate payloads, and authoritative break entry | `useSatExamController.autoEntry.test.tsx` |
| Transition surface selection, held-frame timeout, and keyed reset | `satStudentSurface.test.ts`, `useSatEntryTransitionHold.test.tsx` |
| Pre-start/recovery semantics, break phases, heading/timer/status semantics, and reduced-motion policy | `SatEntrySurfaces.test.tsx`, `SatStudentSessionRoute.between-sections.test.tsx`, `SatScheduledBreakScreen.test.tsx`, reduced-motion Chromium transition scenario |
| Held-frame inertness, global shortcut guard, immediate proctor pause, and runtime termination | `SatStudentSessionRoute.skew.test.tsx` |
| Refresh across pre-start, modules, and both break phases; failed start retry; held-review submission guard; desktop/mobile/tablet width checks; full progression to completion | `e2e/sat-transition-flow.spec.ts` |

Run the browser scenario with `bun run e2e:sat-transition` and set
`TEST_DATABASE_URL` to a disposable MySQL database. The dedicated Playwright
config refuses to start without that explicit test database because setup
seeds fixtures and the scenario advances the runtime clock.

The most important engineering principle for this change is: **do not solve this by styling `SatDirectionsScreen` better. Remove `directions` from the normal student-visible state machine.** That fixes the architectural reason the old UI keeps reappearing, while preserving the existing server-authoritative SAT runtime.
