Yes. In this screen, the **run sheet is not secondary information**. For a proctor it is effectively the session's operational timeline. They need to answer, at a glance:

* When did the exam actually start?
* When should the exam finish?
* Which section/module should be running now?
* When does the current module finish?
* What comes next?
* When is the break?
* Is the session running early, on time, late, or extended?
* Where is each individual student relative to that shared schedule?

So I would **not collapse the full run sheet by default and I would not put it below the student detail**. The stronger UX is a persistent session timeline plus an independently scrollable student inspection area.

# SAT Proctor Session — UX/UI plan

## 1. Define the screen around two jobs

The proctor is doing two things simultaneously.

**Job A — manage the cohort.** They need continuous visibility into the whole exam timeline, timing, current stage, next stage, breaks, and overall health.

**Job B — inspect an individual student.** They select someone who needs attention and inspect their exact progress, timers, warnings, integrity events, and actions.

These two jobs should not compete vertically.

The current design makes them compete:

> Run sheet gets tall → student detail is pushed down → proctor loses the selected student.

Instead, the layout should communicate:

> **Session state is persistent. Student investigation is contextual.**

---

# 2. Desktop information architecture

For a proctor desktop screen around the size in your screenshot, I would use:

```text
┌───────────────────────────────────────────────────────────────────────┐
│ ← Sessions    SAT Test    ● Finished                    Session action │
├───────────────┬───────────────────────────────────┬───────────────────┤
│ STUDENTS      │ CURRENT STAGE                     │ SESSION           │
│               │ Reading & Writing                 │ Finished          │
│ 1 joined      │ Section 1 · Module 2              │                   │
│ Search...     │ 12:43 remaining                   │ STUDENTS          │
│               │                                   │ 1 joined          │
│ All Attention │ RUN SHEET                         │ 0 active          │
│               │ ┌───────────────────────────────┐ │                   │
│ ● Hgff        │ │ full timeline always visible  │ │ SESSION HEALTH    │
│ reading       │ │ module / break / start / end  │ │ Clock / warnings  │
│ terminated    │ └───────────────────────────────┘ │                   │
│               │                                   │                   │
│               ├───────────────────────────────────┤                   │
│               │ SELECTED STUDENT                  │                   │
│               │ Hgff                              │                   │
│               │ section / module / timers         │                   │
│               │ warnings / integrity / actions    │                   │
│               │                                   │                   │
└───────────────┴───────────────────────────────────┴───────────────────┘
```

But the important change is **scroll ownership**.

The center column becomes a bounded application area with two internal regions:

```text
Center workspace
├── Session timeline region
│   ├── Current-stage summary
│   └── Run sheet
│
└── Student inspection region
    └── independently reachable / scrollable detail
```

The page itself should not grow endlessly.

---

# 3. Keep the complete run sheet permanently visible

I would keep the run sheet expanded by default.

Do **not** solve the problem by showing only the current module.

The full run sheet gives temporal context that the current-stage card cannot give.

For example:

```text
RUN SHEET                                      Planned end 22:55

Thailand time · ICT (UTC+7)
Started 22:25

STAGE                         WINDOW          REMAINING     STATUS

READING & WRITING
Module 1                      22:25–22:35          —        Done

Module 2 · Lower              22:35–22:39        2:41       Live
Alternative branch · 4 min

Break                         22:39–22:40          —        Upcoming

MATH
Module 1                      22:40–22:50          —        Upcoming

Module 2 · Lower              22:50–22:54          —        Upcoming

Break                         22:54–22:55          —        Upcoming
```

The proctor immediately understands the complete session.

## Current row should visually anchor the table

The current stage should be obvious within 100–200ms of looking at the screen.

Instead of just slightly changing text color, give the current row a controlled emphasis:

```text
│ Module 2 · Lower      22:35–22:39      02:41      ● Live
```

Use:

* subtle tinted background
* 2px leading accent indicator
* stronger stage text
* strong tabular countdown
* `● Live`
* optional subtle pulse only on the dot
* no pulsing background
* no aggressive green block

Think Apple Activity Monitor / professional operations software rather than dashboard alerts.

Completed rows should recede.

Upcoming rows should remain readable, not disabled-looking.

---

# 4. Add explicit timeline hierarchy

The current run sheet is technically correct, but visually every row carries almost equal weight.

Create three levels.

### Section

```text
SECTION 1
Reading & Writing                     22:25 → 22:39
```

Strongest structural row.

### Module

```text
    Module 1                           22:25 → 22:35
    Module 2 · Lower                   22:35 → 22:39
```

Primary operational unit.

### Break

```text
    ☕ Break · 1 min                    22:39 → 22:40
```

Break should look different enough to be found immediately.

A slight neutral/tinted separator works better than treating it exactly like a module.

The proctor should be able to visually scan:

> module → module → **BREAK** → module → module → **BREAK**

without reading every label.

---

# 5. Make start/end time much more prominent

The proctor specifically needs to know the beginning and expected end of the exam.

Today this information is visually buried in:

> Planned end 22:55
> Anchored to the proctor's start at 22:25 ICT

Turn that into a compact run summary immediately above the table:

```text
RUN SHEET

Started                 Planned finish              Elapsed
22:25                    22:55                       14 min
Actual start             ICT                         Server time
```

Or even more compactly:

```text
Started 22:25     •     Planned finish 22:55     •     ICT
```

During a live session:

```text
Started 22:25     •     Expected finish 22:57     •     +2 min extension
```

This becomes extremely useful once extensions occur.

The schedule should distinguish:

**Original planned end**

and

**Current expected end**

when those differ.

For example:

```text
Expected finish 23:05
Originally 22:55 · +10 min
```

That is much more useful operationally than silently changing a time.

---

# 6. Don't duplicate timing information everywhere

Right now the UI risks showing:

* current stage
* stage timer
* module timer
* run sheet remaining timer
* roster timer
* student module clock
* student section clock
* inspector clock

Some duplication is useful, but each clock needs a clear semantic owner.

Use this model:

### Top stage

**Cohort Section Clock**

```text
Reading & Writing
Section 1 · Module 2
03:42
SECTION REMAINING
```

### Run sheet

**Current row's own clock**

```text
Module 2                    03:42
```

### Student

**Student module clock**

```text
Module remaining       03:42
```

and only show student section timing if it genuinely differs or is operationally useful.

Avoid three visually equal countdowns close together.

One should always clearly be the main room clock.

---

# 7. Selected student should become a persistent inspection surface

When the proctor clicks `Hgff`, the system should give immediate feedback.

The left row becomes selected.

The student area should update without moving the run sheet.

I would introduce a distinct student panel beneath the session timeline:

```text
STUDENT

Hgff                                      •••
Ggvv · adisja.vototm@hotmail.com

Reading & Writing      Module 2 · Lower        Terminated
Current section        Current module          Attempt

03:42                  14:21
Module clock           Section clock
```

Then:

```text
ATTENTION

⚠ 1 integrity event

Tab left exam
22:37:14 · 8 seconds
```

Then operational actions.

The panel should not feel like another disconnected card floating in the middle of the screen. Use section separators and strong headings, just like macOS inspectors.

---

# 8. Student selection should never reset scroll unexpectedly

This matters a lot operationally.

Suppose the proctor is looking at Student A's integrity events and clicks Student B.

Do not:

> jump the entire workspace back to the top.

Instead:

* keep the center workspace scroll position stable where reasonable;
* replace the student content in place;
* briefly crossfade the content;
* preserve run-sheet position;
* move keyboard focus logically when selection came from keyboard.

If the selected student detail is currently outside the viewport, an explicit selection can gently bring the **student heading** into view, but don't aggressively scroll every time.

Use approximately:

```text
scrollIntoView({
  behavior: prefersReducedMotion ? "auto" : "smooth",
  block: "nearest"
})
```

not `block: "start"` every time.

---

# 9. Introduce a sticky context bar inside the center

Once the proctor scrolls down into a long student's history, they should not lose awareness of the cohort.

Inside `.sat-room__workspace`, after the large stage header scrolls away, show a small sticky contextual bar:

```text
Reading & Writing  ·  Module 2 Lower       03:42
```

Optionally:

```text
Reading & Writing · Module 2      03:42     Run sheet ↑
```

It should be around 40–44px high.

This provides persistent context without permanently occupying the large hero area.

Do **not** make both the big stage header and sticky context visible simultaneously.

The compact bar appears only once the big header leaves the viewport.

---

# 10. Keep roster persistent

The student roster is one of the most important operational elements.

At desktop:

```css
height: calc(100dvh - header);
overflow-y: auto;
```

The search and filters should stay pinned at the top of the roster.

Only the student list scrolls.

Conceptually:

```text
STUDENTS             ← fixed
1 joined · 0 active

[ Search ]           ← fixed
[ All ][ Attention ] ← fixed
────────────────────
Hgff                  ↑
Student A             │ scrollable list
Student B             ↓
```

A proctor should never need to scroll back to the top of a 200-student list simply to access Search.

Your current component structure is already close because `sat-room__roster-head` is separated from the list.

---

# 11. Right inspector should be situational, not repetitive

Currently the inspector repeats several things already visible centrally.

Use it for **ambient session health**.

Good right rail:

```text
SESSION
● Finished
Current stage      Waiting to begin
Current module     —

STUDENTS
Joined             1
Active             0
Needs attention    1

SESSION HEALTH
Warnings           0
Connection         Online
Clock source       Server
```

During live operation:

```text
SESSION HEALTH

● Server synced
Last update        Just now

Warnings           2
Disconnected       1
Overtime           No
```

The right rail should answer:

> "Is my session healthy?"

not repeat the entire current-stage block.

---

# 12. Make Needs Attention actionable

`Needs attention 1` should not just be a statistic.

Clicking it should immediately filter the left roster.

Same for the `Needs attention` number on the right inspector.

Then the filter chip becomes active:

```text
[ All ] [ Needs attention 1 ]
          ────────────────
```

If there are zero:

```text
Needs attention   0
```

don't make it clickable.

This follows the self-teaching principle:

> information that implies an action should afford the action.

---

# 13. A better visual hierarchy

The screenshot currently has a very flat hierarchy because almost everything uses similar white/grey surfaces.

I would use four visual layers only.

### Layer 1 — application shell

```text
#F5F7FA
```

quiet background.

### Layer 2 — navigation rails

White with hairline boundaries.

```text
left roster
right inspector
header
```

### Layer 3 — workspace content

Not every section needs a card.

Use spacing and separators:

```text
CURRENT STAGE
─────────────

RUN SHEET
─────────────

STUDENT
─────────────
```

### Layer 4 — exceptional states

Only warnings, live state, selection, errors and actions get stronger fills.

This improves contrast because **most things become quiet**, allowing operational state to stand out.

---

# 14. Don't over-card the interface

This page should feel like a professional control room, not a SaaS dashboard.

Avoid:

```text
[ Current stage card ]

[ Run sheet card ]

[ Student card ]

[ Attention card ]

[ Session card ]
```

Instead use structural surfaces.

Something closer to:

```text
CURRENT STAGE
Reading & Writing                       03:42

────────────────────────────────────────────

RUN SHEET
Started 22:25 · Finish 22:55

...table...

────────────────────────────────────────────

STUDENT
Hgff                                  •••

...student info...
```

The run sheet can retain a very subtle white surface because the table benefits from containment, but it should not look like a detached floating widget.

---

# 15. Improve the current-stage hero

Currently:

```text
CURRENT STAGE

Waiting to begin
Session timing begins when you start the session.

—:—
```

For pre-start state, I'd use:

```text
CURRENT STAGE

Ready to begin

Reading & Writing · Module 1
Starts when the proctor starts the session

                         Not started
```

If the runtime already knows the upcoming stage, tell the proctor what will begin.

During live:

```text
CURRENT STAGE

Reading & Writing
Section 1 · Module 2 · Lower

03:42
SECTION REMAINING

Module ends at 22:39
```

That last line is very important.

A countdown answers:

> how long?

The wall-clock end time answers:

> at what time?

Proctors need both.

---

# 16. Add time landmarks directly to the current stage

For example:

```text
Module 2 · Lower

03:42 remaining
Ends 22:39 ICT

Next
Break · 1 min
22:39–22:40
```

This is far more operationally useful than only showing a countdown.

The proctor can glance at a physical clock and understand the session without calculating.

---

# 17. Show "Next" without hiding the full schedule

The full run sheet remains permanently present.

But the stage hero can preview the next event:

```text
NEXT
Break · 1 min
Starts 22:39
```

or:

```text
NEXT
Math · Module 1
Starts 22:40
```

This is not replacement information.

It is simply a high-priority extraction from the run sheet.

---

# 18. Finished session needs different emphasis

Your screenshot is a finished session.

Right now it still says:

> Current stage
> Waiting to begin

while all run-sheet rows say Done.

That creates a semantic contradiction.

For a completed session, the hero should change entirely:

```text
SESSION FINISHED

Finished 22:55 ICT
Duration 30 min
Started 22:25 ICT
```

Then:

```text
RUN SHEET
```

remains underneath for historical review.

And the right inspector should show:

```text
Status          Finished
Started         22:25
Finished        22:55
Duration        30 min
```

Do not use the live-state phrase **Waiting to begin** for a completed session.

That is an important UX correctness issue separate from the scroll bug.

---

# 19. Finished run sheet should show actual vs planned cleanly

Your run sheet already supports actual times.

Use that capability more visibly only where it matters.

Normal case:

```text
Module 1
22:25–22:35
```

Deviation:

```text
Module 1
22:25–22:37
Planned 22:25–22:35 · +2 min
```

Don't show `Actual` underneath every row when planned and actual are identical.

Only expose the extra line on divergence.

That keeps the table calm.

---

# 20. Table column priorities

For desktop:

```text
Stage                  Start–end          Remaining       Status
```

is good.

I'd adjust widths to approximately:

```text
Stage       42%
Window      27%
Remaining   16%
Status      15%
```

The stage column needs room because labels like:

> Module 2 · Higher
> Alternative branch

carry important context.

Numbers should use tabular numerals.

Align countdowns right or maintain consistent visual column alignment.

---

# 21. Stronger row indentation

Right now indentation exists, but the hierarchy could be clearer.

Use:

```text
Section 1 · Reading & Writing
│
├── Module 1
├── Module 2 · Lower
└── Module 2 · Higher

Break

Section 2 · Math
│
├── Module 1
...
```

You don't literally need tree glyphs.

Visually reproduce it with:

* 0px section indent
* 16–20px module indent
* very light vertical guide
* break aligned with section boundary or intentionally separated

This makes adaptive branches easier to understand.

---

# 22. Alternative module branches need special treatment

SAT has lower/higher adaptive paths.

Showing both like two ordinary modules can imply that both happen sequentially.

Instead communicate:

```text
Module 2
├ Lower       22:35–22:39
└ Higher      22:35–22:39
```

with a shared group label.

Example:

```text
MODULE 2 · ADAPTIVE
    Lower                  22:35–22:39
    Higher                 22:35–22:39
```

If the cohort is actually divided across branches, show counts:

```text
Lower     14 students
Higher    18 students
```

If all students follow the same branch in your implementation, highlight the active branch and leave the alternative quieter.

This prevents a proctor from reading those two rows as an eight-minute sequence.

---

# 23. Micro-interactions

Keep motion extremely restrained.

Student selection:

```text
120–160ms background crossfade
```

Run-sheet live-row change:

```text
150–200ms background + leading indicator transition
```

Sticky stage bar appearing:

```text
opacity + translateY(4px)
150ms
```

New warning:

a very short appearance transition, no bouncing.

No animated countdown digits.

Use tabular numerals so the clock stays physically stable.

Respect:

```css
@media (prefers-reduced-motion: reduce)
```

which you already do.

---

# 24. Scrollbars should communicate scrollability

One reason the current problem is confusing is that users don't immediately know which area is supposed to scroll.

On desktop, use a subtle but visible scrollbar for the center workspace.

Avoid hiding it entirely.

The center pane should feel obviously scrollable once the content exceeds the viewport.

The left list may have an even quieter scrollbar.

---

# 25. Responsive behavior

Do **not** force the desktop three-scroll-region model onto tablets.

At ≥1440px:

```text
Roster | Workspace | Inspector
```

all viewport bounded.

At 1024–1439px:

```text
Roster | Workspace
```

Move session health into a compact horizontal summary at the top of the workspace:

```text
Finished  ·  1 joined  ·  1 attention  ·  Server synced
```

Do not leave the third inspector as a mysterious grid row.

At <1024px:

use document scrolling.

```text
Header
Session overview
Students
Current stage
Run sheet
Selected student
```

The whole run sheet remains visible.

On narrower displays, allow horizontal scrolling **inside the table only** if necessary rather than compressing four columns into unreadability.

---

# 26. Exact implementation plan

I would give the coding agent this sequence:

1. **Fix layout ownership first.** Update `sat-session-room.css` so at `min-width:1440px`, `.sat-room` uses `height:100dvh; overflow:hidden`; `.sat-room__body` uses `min-height:0; overflow:hidden`; `.sat-room__roster`, `.sat-room__workspace`, and `.sat-room__inspector` become the only intentional scrolling surfaces. Header remains sticky/fixed in the shell.

2. **Keep the full `SatRunSheet` always expanded.** Do not replace it with cards, tabs, pagination, or a collapsed summary. Preserve every section, module, adaptive branch and break.

3. **Upgrade the current-stage header.** Add current section, current module, section countdown, module/end wall-clock time, and a compact `Next` event extracted from the existing run-sheet projection. For completed sessions replace `Waiting to begin` with a `Session finished` summary.

4. **Upgrade run-sheet hierarchy.** Visually distinguish section rows, module rows, breaks, adaptive branch groups, current row, done rows, and upcoming rows. Keep actual/planned difference secondary and only show deviation details when they differ.

5. **Add run-sheet summary metadata.** Show `Started`, `Expected finish`, and `ICT` prominently above the table. When extensions change the expected finish, preserve `Originally HH:mm · +N min`.

6. **Keep student detail directly after the run sheet**, but guarantee it is reachable through the center's own scrolling. Add a small `Selected student · Hgff` affordance near the stage/run-sheet area that scrolls to the student section when clicked; don't hide the run sheet.

7. **Improve selected-student hierarchy.** Header → identity → stage/module/timers → attempt → Attention → actions. Student detail updates in place when roster selection changes without resetting the run-sheet scroll position unnecessarily.

8. **Pin roster controls.** Keep Students count, Search and All/Needs attention fixed while only the student rows scroll. Clicking Needs attention in the right inspector activates the same roster filter.

9. **Redesign the right rail around ambient health.** Session status, student counts, attention count, connection/server synchronization, warnings and overrun. Remove redundant information that already dominates the center.

10. **Fix the 1024–1439 grid.** Do not leave a three-child DOM inside a two-column layout without explicit placement. Move inspector data into the workspace summary at this breakpoint.

11. **Add component tests** for finished-session copy, run sheet always present, student detail always present, attention filtering, adaptive row hierarchy, expected-end change after extensions, and selection preserving the correct detail.

12. **Add Playwright viewport tests** at `1600×900`, `1440×900`, `1280×800`, `1024×768`, and a mobile/tablet size. At desktop verify `document.documentElement.scrollHeight ≈ viewport`, `.sat-room__workspace.scrollHeight > clientHeight`, the run sheet can be reviewed completely, then scrolling farther reveals all student information while roster/header/session health remain available.

The key principle is:

> **Do not trade Run Sheet visibility for Student visibility. Give each piece of information the correct spatial and scrolling hierarchy.**

The run sheet should remain one of the most prominent objects on the page because it is the proctor's **source of truth for the whole exam timeline**. The bug is that your layout currently makes the page grow instead of giving that operational workspace a controlled viewport. Once that foundation is corrected, you can make the run sheet richer and easier to scan without sacrificing individual student inspection.
