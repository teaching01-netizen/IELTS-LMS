# Student adaptive layout contract

This module owns presentation environment facts only. It must not read or mutate
answers, timer state, flags, submission state, or persistence state.

## Policy

- `compact`: fewer than 700 effective CSS pixels.
- `medium`: 700 through 1199 effective CSS pixels.
- `wide`: 1200 pixels or wider.
- `primaryPointer`, `hasTouch`, `hasHover`, and `orientation` are independent facts.

## Invariants

1. A viewport resize or orientation change may change presentation, but never owns or
   reinterprets an answer control's value.
2. Compact presentation must keep the timer visible and expose every enabled tool
   without horizontal toolbar scrolling.
3. Primary exam actions use a 44px minimum hit area and target 48px where space allows.
4. The shell owns safe-area clearance and the primary scroll boundary; child panels may
   own their deliberate content scroll regions.
5. Next/previous navigation is separate from submit and cannot submit at the boundary.

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
