I rechecked current `main`. For **P0 only**, I would implement these two changes and explicitly leave calculator/Desmos, motion, contrast, and other P1/P2 work untouched.

## P0-1 — Split SAT and IELTS student delivery bundles

**Current problem:** `src/features/student/routes/StudentSessionRoute.tsx` statically imports both:

```ts
StudentAppWrapper           // IELTS / generic delivery
SatStudentSessionRoute      // SAT delivery
```

So the provider is selected at runtime, but the module graph already references both product trees.

### Target architecture

```text
/student/:scheduleId/:studentId
        │
        ▼
StudentSessionRoute
thin provider router only
        │
        ├── provider unknown
        │     └── neutral loading surface
        │
        ├── SAT
        │     └── dynamic import
        │          SatStudentDeliveryBranch
        │               └── SatStudentSessionRoute
        │
        └── IELTS
              └── dynamic import
                   IeltsStudentDeliveryBranch
                        └── StudentAppWrapper
```

I recommend creating two small provider-specific branch components rather than only putting `React.lazy()` around the current two components. That gives a clean dependency boundary.

### Files

Create:

```text
src/features/student/routes/
  SatStudentDeliveryBranch.tsx
  IeltsStudentDeliveryBranch.tsx
```

Modify:

```text
src/features/student/routes/StudentSessionRoute.tsx
```

### `SatStudentDeliveryBranch`

Move SAT-only concerns into this branch:

* `SatStudentSessionRoute`
* `SatLoadingSurface` where appropriate
* SAT resume locator logic:

  * `loadSatResumeLocator`
  * `saveSatResumeLocator`
  * `clearSatResumeLocator`
* `getVerifiedTerminalState` usage that exists specifically for SAT resume behavior
* SAT attempt/bootstrap props

The branch receives already-resolved common route facts:

```ts
scheduleId
attemptSnapshot
runtimeSnapshot
liveSocketConnected
satAttemptUpdateToken
satBootstrapSeed
diagnosticsEnabled
onExit
```

No SAT business behavior changes.

### `IeltsStudentDeliveryBranch`

Move:

```ts
StudentAppWrapper
```

and IELTS-specific props into this lazy branch:

```ts
state
scheduleId
attemptSnapshot
runtimeSnapshot
answerInvariantRollout
refreshRuntime
onExit
```

Preserve:

```ts
showSubmitControls={false}
allowExitDuringExam={false}
```

exactly.

### Thin `StudentSessionRoute`

It should continue owning only common responsibilities:

```text
URL params
auth
provider resolution
shared loading/error handling
Back to Check-in
shared interaction scope
touch-selection diagnostics
```

Then define module-level lazy boundaries:

```ts
const SatStudentDeliveryBranch = React.lazy(() =>
  import("./SatStudentDeliveryBranch").then(m => ({
    default: m.SatStudentDeliveryBranch
  }))
);

const IeltsStudentDeliveryBranch = React.lazy(() =>
  import("./IeltsStudentDeliveryBranch").then(m => ({
    default: m.IeltsStudentDeliveryBranch
  }))
);
```

**Important:** do not preload either branch while:

```ts
providerKey === "unknown"
```

Otherwise the optimization is defeated.

### Suspense behavior

Preserve your current single-surface rule:

```text
unknown provider
→ neutral loading

known SAT + SAT chunk loading
→ SatLoadingSurface

known IELTS + IELTS chunk loading
→ LoadingSurface
```

There must be **no SAT → generic skeleton → SAT flicker**.

### P0-1 tests

Add a focused bundle/isolation test.

**Case A — SAT cold entry**

Given:

```text
providerKey = sat
```

assert:

```text
✓ SAT branch loads
✓ SAT exam mounts
✓ StudentAppWrapper / IELTS branch is never imported
✓ no IELTS student renderer chunk is requested
✓ existing SAT loading surface remains the only loading surface
```

**Case B — IELTS cold entry**

Assert the reverse:

```text
✓ IELTS branch loads
✓ SAT delivery route is never imported
```

**Case C — unknown provider**

Before provider resolution:

```text
✓ neither lazy branch imports
✓ neutral loading surface only
```

I would also build production once with Vite manifest output and add a small static assertion that the student provider-router chunk does not statically depend on either full provider runtime.

---

# P0-2 — Remove the 500 ms whole SAT runner render clock

This needs more care.

Current `useSatExamController.ts` contains:

```ts
const [now, setNow] = useState(() => Date.now());

useEffect(() => {
  const timer = window.setInterval(
    () => setNow(Date.now()),
    500
  );

  return () => window.clearInterval(timer);
}, []);
```

But `now` currently drives more than the visible timer:

```text
personal module countdown
legacy break countdown
pending module window
break-end recovery
module-entry retry
timeout detection
```

And the controller also directly calls `useAuthoritativeDeadlineClock()`, which itself subscribes to a clock.

Therefore **do not simply change `500` → `1000`**. That still makes the entire controller/route clock-driven.

## Target architecture

Separate **authoritative exam state** from **derived ticking time**.

```text
useSatExamController
NO clock subscription
        │
        │ static timing facts
        ▼
SatTemporalRuntime
1 Hz shared clock
        │
        ├── timer display
        ├── personal countdown
        ├── section countdown
        ├── break countdown
        ├── pending-module countdown
        │
        └── boundary effects
             expiry / break-end / entry
```

The heavy question tree does **not** subscribe to the clock.

---

## Phase 2A — Controller returns timing facts, not time ticks

Remove from `useSatExamController.ts`:

```ts
const [now, setNow] = ...
setInterval(...500...)
```

Also move the continuously ticking `useAuthoritativeDeadlineClock()` subscriptions out of this controller.

Keep the controller responsible for server facts:

```text
effective timing snapshot
snapshotReceivedAt
serverNow
serverNow receipt timestamp
deadlineAt
runtime revision
stage key/status
runtime status
module attempt
module deadline
published remaining seconds
pending attempt
nextSectionStartAt
timing model
```

Introduce a stable structure such as:

```ts
interface SatTemporalModel {
  timingModel;
  runtimeStatus;
  stageKey;
  stageStatus;

  serverNow;
  serverNowReceivedAt;
  sectionDeadlineAt;
  sectionRemainingSnapshot;

  moduleAttempt;
  sectionKey;

  pendingModule;
  pendingAttempt;

  nextSectionStartAt;
  waitingForNextSection;

  snapshotReceivedAt;
}
```

This object changes when **authoritative information changes**, not every 500 ms.

---

## Phase 2B — Add one SAT temporal runtime

Create something like:

```text
src/features/student-delivery/timing/
  SatTemporalRuntime.tsx
  satTemporalModel.ts
```

`SatTemporalRuntime` subscribes to the existing shared precise clock mechanism from:

```text
src/shared/hooks/useAuthoritativeDeadlineClock.ts
```

Prefer one-second resolution. SAT displays whole seconds, so a 500 ms React render cadence gives no useful UI precision.

Compute from the existing pure functions—do not duplicate timing math:

```ts
personalModuleRemainingSeconds()
satCountdown()
satBreakCountdownSeconds()
satSectionWaitSeconds()
satModuleWindow()
satClockOffsetMs()
```

That preserves your server-authoritative timing rules.

---

## Phase 2C — Timer UI becomes the main clock consumer

Currently `SatExamShell` receives:

```ts
remainingLabel
remainingSeconds
```

which causes shell-level rerenders when those values change.

Move ticking countdown consumption toward the timer subtree:

```text
SatExamShell
  └── SatExamTopBar
        └── SatTimer
              └── subscribes to temporal runtime
```

Target:

```text
tick
 ↓
SatTimer rerenders

NOT

tick
 ↓
SatStudentSessionRoute
 ↓
SatExamShell
 ↓
SatQuestionWorkspace
 ↓
SatQuestionRenderer
```

Keep timer behavior unchanged:

* Hide/Show
* automatic reveal at 5:00
* 5-minute announcement
* 1-minute announcement
* `role="timer"`
* no per-second screen-reader announcements

The existing accessibility behavior in `SatExamTopBar` should remain.

---

## Phase 2D — Convert clock-driven business events into boundary events

There are several important actions that currently happen because `now` repeatedly rerenders the controller.

Preserve each, but isolate it.

### Module expiry

A small temporal-effect component watches:

```text
expiryRemainingSeconds
```

When it crosses:

```text
> 0 → 0
```

fire exactly once:

```text
block answer interaction
set timeout transition
flush persistence
request authoritative refresh
```

The server remains the authority.

Do **not** locally submit or close the module.

### Break end

Currently the controller repeatedly checks the clock and triggers the break-end pull.

Move that into the temporal runtime.

At:

```text
nextSectionStartSeconds === 0
```

trigger the existing bounded refresh once per:

```text
identity + runtimeRevision
```

Keep:

```ts
SAT_BREAK_END_PULL_WINDOW_MS
```

and the current request-storm protection.

### Module-entry retry

`useSatModuleEntry.ts` currently accepts:

```ts
now
```

just so retry eligibility eventually gets evaluated again.

Refactor this hook to use a **single scheduled retry wakeup** instead.

Instead of:

```text
500 ms tick
500 ms tick
500 ms tick
→ finally retry window reached
```

use:

```text
attempt fails
    ↓
calculate retryAt
    ↓
one setTimeout
    ↓
retry eligibility wakes once
```

Keep:

```ts
canAttemptEntry()
settleEntry()
```

as the policy owners.

This is both lighter and easier to reason about.

---

# Critical invariant

After this P0 work, ordinary question reading should look like:

```text
every second
    ↓
clock store updates
    ↓
timer + tiny temporal runtime update

SatQuestionRenderer
    ─────────────────
    NO render
```

The question subtree should render because of:

```text
question navigation
answer change
annotation change
display preference change
exam control/state change
```

—not because one second passed.

---

# Required regression tests

I would make these hard acceptance gates.

| Test                      | Required result                                                   |
| ------------------------- | ----------------------------------------------------------------- |
| SAT bundle isolation      | SAT session does not load IELTS delivery branch                   |
| IELTS bundle isolation    | IELTS session does not load SAT runner                            |
| Unknown-provider loading  | Neither provider branch loads before resolution                   |
| SAT loader                | No generic/admin loading flash after SAT is known                 |
| 10-second idle question   | Timer advances correctly                                          |
| 10-second idle question   | `SatQuestionRenderer` render count stays unchanged after settling |
| 10-second idle question   | answer DOM is not recreated                                       |
| Personal module timer     | Still decreases once per real second                              |
| Cohort pause              | Both section/personal clocks freeze                               |
| Resume                    | Both clocks resume without jumping incorrectly                    |
| Timeout                   | Exactly one timeout transition/flush/refresh                      |
| Break reaches 0           | Exactly one bounded recovery pull                                 |
| Entry failure             | Retry still occurs after existing retry window                    |
| Offline/reconnect         | Clock display remains correct and server refresh reconciles       |
| Module 1 → Module 2       | No timing/routing regression                                      |
| Adaptive hard/easy branch | Selected server module remains authoritative                      |

For the render test, add a test-only render probe around `SatQuestionRenderer` or its question workspace. Do not infer this from DOM changes alone.

---

# Explicit non-goals for this P0 change

Do **not** combine this PR with:

```text
calculator lazy loading
Desmos prewarm changes
Reference Sheet splitting
motion/react removal
CSS refactors
selection/loupe changes
annotation behavior changes
answer persistence redesign
adaptive routing changes
server timing changes
UI redesign
accessibility semantics changes
```

Those broaden the blast radius unnecessarily.

## Definition of done

P0 is complete when:

> A SAT student loads only the SAT provider runtime, an IELTS student loads only the IELTS provider runtime, provider resolution causes no cross-product UI flash, and a student sitting on an unchanged SAT question for 10+ seconds sees an accurate server-authoritative countdown without the question/exam content subtree rerendering on clock ticks. Timeout, pause/resume, break-end, adaptive routing, answer durability, and automatic module entry behave exactly as before.

I would implement **P0-1 first and P0-2 second**, as separate commits, because bundle isolation is mechanically low-risk while the timing boundary deserves its own focused regression set.
