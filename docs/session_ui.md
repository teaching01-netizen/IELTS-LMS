I rechecked the current `main` implementation in `teaching01-netizen/IELTS-LMS`. The refactor should be treated as an **information-architecture change only**: preserve the SAT runtime/timing/domain behavior, preserve every operational fact, and reduce cognitive load by changing hierarchy, placement, and progressive disclosure.

## Implementation plan

### 1. Lock the invariants before touching layout

Before refactoring, add/adjust tests around the information we are explicitly **not allowed to lose**.

The session room must continue to expose:

* every section
* every module
* both adaptive Module 2 branches
* every break
* planned start/end
* actual start/end when different
* remaining time for the currently running stage
* runtime-vs-plan mismatch warnings
* extensions and paused time
* session status/start/finish/duration
* joined/active/attention counts
* connection state
* clock source
* last updated
* student identity
* current section/module
* section/module clocks
* attempt status
* warnings/integrity events
* all current proctor/student actions

Do **not** change `sessionRunSheet.ts`, server-authoritative clock behavior, runtime contracts, API calls, proctor controller behavior, or backend timing logic as part of this work.

---

### 2. Introduce an explicit presentation mode

In:

`src/products/sat/routes/SatSessionRoomRoute.tsx`

derive a presentation-only mode:

```ts
type SatRoomMode = 'prestart' | 'live' | 'review';

function getSatRoomMode(
  status: ExamSessionRuntime['status'],
): SatRoomMode {
  if (status === 'not_started') return 'prestart';

  if (status === 'completed' || status === 'cancelled') {
    return 'review';
  }

  return 'live';
}
```

This must **not** become another runtime state machine. It is only UI hierarchy derived from the authoritative runtime status.

Use it to control emphasis:

```text
prestart
→ readiness + roster + complete projected run sheet

live
→ current stage + authoritative clock + roster + student inspector

review
→ completed run sheet + integrity review + student inspector
```

This eliminates the current mistake where a completed session still looks like an active operational dashboard.

---

### 3. Replace the current desktop structure with three stable panes

Current desktop structure effectively becomes:

```text
Roster
    Timeline
    ─────────
    Student detail
Session summary
```

Replace it with:

```text
┌──────────────┬───────────────────────────────┬──────────────────┐
│ Students     │ Session / Run Sheet           │ Selected Student │
│              │                               │                  │
│ roster       │ complete timeline             │ inspector        │
│ search       │ current stage when live       │ attention        │
│ filters      │ all modules + breaks          │ timing/state     │
│              │                               │ actions          │
└──────────────┴───────────────────────────────┴──────────────────┘
```

Implement this in:

`src/products/sat/ui/sat-session-room.css`

For large desktop:

```css
.sat-room__body {
  grid-template-columns:
    minmax(260px, 290px)
    minmax(0, 1fr)
    minmax(320px, 370px);

  grid-template-areas:
    "roster workspace inspector";
}
```

The key requirement is:

> The center must no longer be vertically split between timeline and selected student.

There should be one primary vertical scrolling surface for the timeline and one independent inspector scroll if needed.

Avoid nested scrolling inside the run sheet itself except horizontal overflow at genuinely narrow widths.

---

### 4. Move selected student into the right inspector

In:

`SatSessionRoomRoute.tsx`

move the existing `StudentDetail` out of `.sat-room__student-pane` and render it in the right inspector.

Reuse:

`src/products/sat/ui/SatSessionRoomStudents.tsx`

Do not duplicate student rendering.

Once this is done, remove:

* `studentPaneRef`
* `studentDetailRef`
* `jumpToSelectedStudent`
* `Selected student ↓` control
* associated scrolling logic
* associated CSS

The roster itself becomes the direct manipulation:

```text
select student
→ inspector changes immediately
```

No intermediate navigation affordance is needed.

Use a subtle ~120–160ms content transition on student changes, and respect `prefers-reduced-motion`.

---

### 5. Replace the permanent Session Summary inspector with a compact context bar

The existing:

`src/products/sat/ui/SatSessionSummary.tsx`

currently consumes an entire desktop column for mostly passive metadata.

Replace its route-level use with something like:

`SatSessionContextBar.tsx`

placed below the main page header.

For a completed session:

```text
08:23–08:53 ICT · 29 min
1 joined · 0 active · 1 needs attention
● Online · Server clock · Updated 09:04:50
```

For live:

```text
Started 08:23 ICT
23 joined · 22 active · 1 needs attention
● Online · Server clock · Updated just now
```

Preserve every existing `SatSessionSummary` fact, but give each fact one canonical visual home.

Important exception: unhealthy states can repeat because they require action.

For example:

```text
⚠ Reconnecting
```

may appear in both the header/context bar and the operational banner.

Normal `Online`, `Finished`, and counts should not be repeated throughout the screen.

Delete `SatSessionSummary.tsx` only after verifying it has no other consumers.

---

### 6. Simplify the stage header according to mode

The current stage header duplicates run-sheet and inspector information.

Keep it important during active operation:

```text
READING & WRITING

Section 1 · Module 1

                         12:34
                  SECTION REMAINING

Module ends 09:32 · section ends 10:04
Next: Module 2 · Adaptive
```

But in `review` mode replace the large hero with a small review heading:

```text
SESSION FINISHED
Finished 08:53 ICT · 29 min
```

Do not show a fake/empty hero clock after completion.

During `prestart`:

```text
READY TO BEGIN
Reading & Writing
Starts when the proctor starts the session
```

Keep the projected run sheet underneath.

---

### 7. Refactor `SatRunSheet` visually, not logically

Keep:

`src/products/sat/ui/sessionRunSheet.ts`

as the single source of truth.

Do **not** introduce a second timeline calculation or remap times in the React component.

Refactor only:

`src/products/sat/ui/SatRunSheet.tsx`

from a dense spreadsheet appearance toward hierarchical rows.

Target:

```text
READING & WRITING                       08:23 — 08:37       Done

│  Module 1                             08:23 — 08:33       Done
│  Base · Actual 08:23
│
│  MODULE 2 · ADAPTIVE
│
├─ Lower                                08:33 — 08:37       Done
│  Alternative branch · 4 min
│
└─ Higher                               08:33 — 08:37       Done
   Alternative branch · 4 min

BREAK                                   08:37 — 08:47       Done
```

For live rows:

```text
● Module 1                09:00 — 09:32        12:34
```

The live row gets emphasis; completed/upcoming rows recede.

Do not hide adaptive branches. Proctors still need to understand both possible student paths.

Avoid large tinted row backgrounds everywhere. Prefer:

* typography
* indentation
* hairlines
* one current-state indicator
* tabular numerals
* whitespace

Use strong tint only for warnings/mismatches/current paused state.

---

### 8. Reduce duplicate Run Sheet metadata

Currently the stage hero, Run Sheet summary, and session summary all repeat start/end/duration.

Make the context bar the canonical location for high-level session timing.

The Run Sheet can retain its operational metadata but should avoid looking like another dashboard header.

For example:

```text
RUN SHEET
Thailand time · ICT (UTC+7)

Anchored to proctor start at 08:23
```

If extension/pause data exists:

```text
Original finish 10:14 · +5 min extension · paused 2 min
```

This remains because it explains the run-sheet projection rather than merely repeating session metadata.

---

### 9. Reorder `StudentDetail` by urgency

In:

`src/products/sat/ui/SatSessionRoomStudents.tsx`

the current inspector displays normal timing information before Attention.

Change hierarchy based on mode/state.

For a flagged completed student:

```text
STUDENT

Djjdmcnfn
Djjd · adisak@hotmail.com
Terminated                               ⋯


ATTENTION · 1

┌─────────────────────────────────────┐
│ TAB SWITCH                          │
│ You left the exam screen...         │
└─────────────────────────────────────┘


EXAM STATE

Current section         —
Current module          Reading
Module clock            —
Section clock           0:00
Attempt                  Terminated
```

For a healthy live student:

```text
STUDENT

Ananda S.
A001 · email@example.com


CURRENT

Reading & Writing
Module 1

12:34
Module remaining

44:02 section remaining


ATTENTION

● No current warnings
```

Same data, different priority.

Pass `roomMode` or a smaller semantic prop such as:

```ts
variant: 'operational' | 'review'
```

Avoid making the component independently infer session semantics from unrelated values.

---

### 10. Keep warnings highly visible but remove warning duplication

Currently attention can appear in:

* top header
* roster filter
* student row
* selected-student banner
* Attention section
* session summary

Use this rule:

```text
global issue → context/header
student has issue → roster indicator
selected issue → inspector detail
```

Therefore:

* keep header/context count
* keep roster warning icon
* keep `Needs attention` filter
* keep full event in inspector
* remove the extra “details in the Attention section below” banner once the inspector is always visible

The UI should demonstrate the problem instead of explaining where to scroll to find it.

---

### 11. Responsive behavior

Desktop ≥1440:

```text
Students | Run Sheet | Student Inspector
```

Medium desktop/tablet landscape around 1024–1439:

```text
Students | Run Sheet
```

Selected student opens as a right-side inspector/drawer, not below several screens of run-sheet content.

Mobile/narrow tablet:

```text
Session
Students
Run Sheet
Selected student
```

One document scroll; avoid independently scrolling cards.

Never make information inaccessible at narrower sizes. Progressive disclosure is allowed, removal is not.

---

## Test plan

Use TDD around the existing test files rather than deleting tests that become inconvenient.

### `SatSessionRoomRoute.test.tsx`

Add/update tests for:

```text
✓ completed runtime derives review presentation
✓ live runtime derives operational presentation
✓ not_started runtime derives prestart presentation

✓ completed session still renders Run Sheet
✓ completed session still renders selected student
✓ completed session does not render active hero clock
✓ finished/start/duration remain visible

✓ selecting roster student updates right inspector
✓ first student remains auto-selected
✓ selected student disappearing still falls back safely
✓ arrow-key roster navigation still changes selection

✓ attention filter still works
✓ flagged roster row retains warning indicator
✓ selected flagged student exposes violation details
✓ no redundant selected-student jump button exists

✓ reconnect state remains visible
✓ reconnect continues to disable risky actions
✓ retry remains functional

✓ session actions continue to work
✓ student actions continue to work
✓ confirmation dialogs remain unchanged
```

Prefer role/accessible-name assertions over implementation-specific class assertions for behavior.

---

### `SatRunSheet.test.tsx`

Preserve the existing important regression tests:

* runtime clock beats authored plan when they disagree
* shortened runtime compresses module windows correctly
* adaptive alternatives remain visible
* current module/section count down correctly
* paused runtime freezes clocks
* projected pre-start schedule remains correct

Then adapt rendering assertions for the new hierarchy:

```text
✓ all sections render
✓ all Module 1 rows render
✓ lower + higher adaptive branches render
✓ break renders
✓ correct start/end windows render
✓ current row exposes remaining time
✓ completed rows expose completed status
✓ mismatches remain visible
✓ actual time remains visible when different from plan
✓ extensions/paused delta remains visible
```

Do not test exact DOM nesting such as `<tr>` if the redesign intentionally stops being table-based. Test semantic attributes/data contracts instead.

For example retain:

```tsx
data-sat-run-sheet-row="module"
data-sat-run-sheet-status="live"
data-runtime-mismatch="true"
```

so tests and debugging remain stable across visual changes.

---

### Add dedicated Student Inspector tests

Prefer a new:

`src/products/sat/ui/__tests__/SatSessionRoomStudents.test.tsx`

Test:

```text
review + violation
→ Attention appears before Exam state

review + no violation
→ healthy state shown quietly

live student
→ module/section timing receives operational emphasis

terminated
→ clocks remain available but no running representation

student actions
→ menu labels and disabled state preserved
```

This keeps `SatSessionRoomRoute.test.tsx` from becoming a huge monolithic test file.

---

### CSS contract tests

Extend the SAT CSS tests or introduce:

`src/products/sat/ui/__tests__/satSessionRoomCss.test.ts`

Assert structural contracts rather than pixel-perfect styling:

```text
✓ large desktop uses 3-column layout
✓ workspace no longer has timeline/student vertical split
✓ center timeline is independently scrollable on desktop
✓ roster remains independently scrollable on desktop
✓ reduced motion disables student inspector transition
✓ forced-colors styles still work
✓ no horizontal page overflow at supported breakpoints
```

Avoid brittle assertions such as “must be exactly 360px”.

Prefer ranges/tokens/minmax semantics.

---

### Accessibility tests

Verify:

* roster remains a correctly labeled listbox
* selected student state is conveyed without color
* warning state is conveyed without color alone
* all menus remain keyboard accessible
* focus remains stable when switching students
* inspector heading receives sensible programmatic association
* context bar status has readable text
* countdown updates do not create noisy live-region announcements every second
* `prefers-reduced-motion` eliminates transition movement
* forced colors preserve selection/current/warning distinction

Do **not** make the countdown an assertive live region.

---

### Visual/manual acceptance matrix

Test at minimum:

| State            | What to verify                                               |
| ---------------- | ------------------------------------------------------------ |
| Not started      | roster + projected complete run sheet + obvious Start action |
| Live Module 1    | current module/section obvious within ~1 glance              |
| Live Module 2    | adaptive context correct                                     |
| Break            | break is visually current and countdown obvious              |
| Paused           | clocks frozen and paused state unmistakable                  |
| Student warning  | roster → inspector relationship obvious                      |
| Reconnecting     | stale-data warning + risky actions disabled                  |
| Completed        | Run Sheet dominates, student review inspector visible        |
| Cancelled        | review layout without pretending exam is still running       |
| Runtime mismatch | warning visible on exact affected stage                      |

Also test approximately `1024`, `1280`, `1440`, `1600`, and narrow/mobile widths.

---

## Recommended implementation order

1. **Tests first:** encode the no-information-loss and mode requirements.
2. Add `SatRoomMode`.
3. Build `SatSessionContextBar`.
4. Convert desktop shell to three panes.
5. Move `StudentDetail` to inspector and remove jump/vertical-pane logic.
6. Reorder student information by operational/review priority.
7. Refactor `SatRunSheet` presentation while keeping `sessionRunSheet.ts` untouched.
8. Finish responsive behavior.
9. Add reduced-motion/a11y contracts.
10. Run the focused tests, then full quality gates.

Use:

```bash
bun run test:run -- \
  src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx \
  src/products/sat/ui/__tests__/SatRunSheet.test.tsx \
  src/products/sat/ui/__tests__/SatSessionRoomStudents.test.tsx

bun run typecheck
bun run lint
bun run test:run
bun run build
```

The release gate should be: **zero runtime/timing behavior changes, zero operational information removed, but each piece of information has one obvious primary home.** That is the main architectural constraint for this redesign.
