# Student adaptive layout contract

This module owns presentation environment facts only. It must not read or mutate
answers, timer state, flags, submission state, or persistence state.

## Policy

Layout mode is a pure decision over shell geometry facts (`studentLayoutMode.ts`),
not device identity. The four modes (P2.1) resolve in this order:

1. Invalid/unmeasured geometry → `compact` (safe default; the UI stays mounted).
2. Width <600px → `phone`: one primary pane, previous/current/next navigation.
3. Width >=1180px, stable shell height >=650px, and pane-fit → `wide`:
   draggable split, full toolbar, grouped navigator.
4. Width >=900px, stable shell height >=600px, and pane-fit → `standard`:
   draggable split, condensed toolbar.
5. Otherwise → `compact`: Passage/Questions (or Task/Response) switch.

Pane-fit requires both readable outer pane minimums (≈380px material +
≈430px questions at normal text size, including each pane's own padding)
plus one rail to fit the width, and an initial 360px of usable workspace
height. Enlarged text scales the minimums up. If the minimums cannot fit,
the presentation collapses to one pane (focus override) — never 48px panes.
The 650px/600px thresholds refer to the OUTER stable shell height after
safe-area clearance; the remaining workspace height is checked separately.
Software-keyboard opening changes the visible edit region, not the core mode.

`primaryPointer`, `hasTouch`, `hasHover`, and `orientation` are independent
facts and never select a mode by themselves.

## Invariants

1. A viewport resize or orientation change may change presentation, but never owns or
   reinterprets an answer control's value.
2. Compact and phone presentation keep BOTH pane trees mounted; the inactive pane
   is `hidden` + `inert` (absent from focus and assistive navigation) while its
   state stays alive. Exactly one textarea and one answer tree exist per task.
3. Compact presentation must keep the timer visible and expose every enabled tool
   without horizontal toolbar scrolling.
4. Primary exam actions use a 44px minimum hit area and target 48px where space allows.
5. The shell owns safe-area clearance and the primary scroll boundary; child panels may
   own their deliberate content scroll regions.
6. Next/previous navigation is separate from submit and cannot submit at the boundary.

## Viewport ownership

- `StudentExamShell` owns the exam height through exactly one semantic
  variable: `--student-exam-height` (CSS fallback `100dvh`).
- `useStudentExamViewport` observes environment events
  (`visualViewport.resize`/`scroll`, `window.resize`, `orientationchange`,
  `focusin`, `focusout`) and applies the pure policy in
  `studentExamViewportPolicy.ts`. An editable focus combined with a meaningful
  visual-viewport reduction is a probable software keyboard; the shell height
  is then frozen at the pre-keyboard value so the keyboard never reflows the
  exam chrome. A shrink without focus is browser chrome and may update the
  baseline. Orientation changes always re-establish the baseline.
- `useStudentExamPageLock` scopes `html/body.student-exam-active` to the exam
  phase and restores the prior scroll position on leave.
- `useStudentFocusedControlVisibility` scrolls only internal exam panes
  (never the document) to reveal a focused answer control that the keyboard
  would otherwise obscure.
- While `data-student-keyboard-open="true"`, the footer keeps its grid row but
  becomes `visibility: hidden; pointer-events: none`. It is never `display: none`
  and never fixed/sticky/absolute.
- `StudentExamViewport` is the bounded grid between the header and the exam
  overlays. Its first row owns the workspace; its automatic row owns the footer.
- `StudentExamWorkspace` keeps the main exam region at `min-height: 0` and
  `overflow: hidden`. Reading and Listening child panes own deliberate content
  scrolling; the document and body must not become scroll owners.
- `StudentExamFooter` participates in the viewport flow. It is not fixed or
  absolutely positioned, so footer clearance is structural rather than a
  second height calculation.
- Safe-area insets are applied at the shell/header/footer boundaries. Overlays
  must include bottom safe-area padding before they reach the viewport edge.

## Verification

The contract is covered by the focused layout tests in
`src/components/student/**/__tests__` and the cross-browser acceptance profile
in `e2e/student-viewport-layout.spec.ts`. When changing shell height, footer
placement, or child overflow, run the focused Vitest tests and the Chromium,
WebKit, and Firefox viewport profiles before changing the ownership rules.
