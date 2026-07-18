# Student Exam Viewport Occlusion Design

**Date:** 2026-07-18

**Status:** Approved for implementation

**Owner:** Student exam viewport module

## Context

The existing viewport state machine fixed reused-tab entry and one keyboard-dismissal sequence, but
`IMG_1111.PNG` demonstrates that the shell can still retain a displaced origin or stale height after
the software keyboard closes. The visible results are a header above the screen, a footer above the
physical bottom, or both.

Two user-confirmed dismissal paths expose the remaining problem:

1. Tapping outside the input fires `focusout`. The controller enters recovery and restores the
   baseline rectangle, including its old top offset, before the browser finishes returning the
   visual viewport origin. The layout viewport remains panned, so the header is clipped and a
   matching gap appears below the footer.
2. Using the keyboard-hide button can leave the input focused. The controller remains
   `keyboard-active`, ignores a recovered or larger height, and leaves the footer above the physical
   bottom even though the header can remain visible through live offset tracking.

The architectural error is treating input focus as keyboard visibility and treating height and
origin as one trusted rectangle. Mobile browsers can change the Visual Viewport height and origin
independently, and keyboard visibility is not equivalent to focus.

## User-Approved Behavior

- The header and footer belong to one full-height exam shell.
- While the software keyboard is visible, the shell does not shrink. The footer remains at the
  physical screen bottom behind the keyboard.
- When the keyboard closes, the header and footer return correctly without scrolling, tapping an
  input again, or waiting for another browser event.
- Both tapping outside the input and using the keyboard-hide button must recover.
- Reused tabs, pasted exam links, browser chrome, orientation, split-screen, pinch protection, and
  devices without optional keyboard APIs must remain supported.
- Browser family and version checks are prohibited.

## Ownership and Boundaries

`src/components/student/studentExamViewportPolicy.ts` remains the pure owner of viewport meaning.
It accepts normalized events and publishes the shell geometry to use.

`src/components/student/studentExamViewportController.ts` remains a browser adapter. It reads
Visual Viewport, layout viewport, focus, orientation, and optional Virtual Keyboard signals. It may
schedule bounded observation but may not independently decide shell geometry.

`src/components/student/StudentApp.tsx` installs the controller only during the active exam.
`src/index.css` consumes the published height and top offset without adding another sizing policy.

No answer, autosave, submission, timer, integrity, audit, or grading flow changes.

## Geometry Model

The policy separates three values that the previous rectangle coupled:

### Closed shell height

`closedHeight` is the last trusted keyboard-closed height for the current display topology. It is
the shell height while the keyboard is occluding content or while dismissal geometry is settling.

### Live visual origin

`liveOffsetTop` is the current valid native-scale Visual Viewport `offsetTop`. It is published
independently from height. A keyboard baseline never restores an older origin.

This keeps the fixed layout-viewport shell aligned with the visual viewport when the browser pans
the document to expose a focused input.

### Keyboard occlusion

`keyboardOcclusion` describes whether the full shell is currently covered by a software keyboard.
Focus only arms keyboard detection. It never proves that the keyboard is open, and retained focus
never prevents keyboard closure.

The published shell geometry is derived as follows:

- Native scale and keyboard occluding or recovering: `height = closedHeight`,
  `offsetTop = liveOffsetTop`.
- Native scale and keyboard clear: `height = measured closed height`,
  `offsetTop = liveOffsetTop`.
- Pinch scale: retain the last trusted published geometry until native scale returns.

## State and Signals

The pure policy retains explicit bootstrapping, topology, pinch, and keyboard lifecycles, but focus
and keyboard visibility become separate state:

- `editableFocusActive`: whether an editable control is focused.
- `keyboardPhase`: `clear`, `armed`, `occluding`, or `recovering`.
- `closedHeight`: trusted full-shell height for the current topology.
- `liveOffsetTop`: latest valid native-scale visual origin.
- `layoutWidth`: width used to identify a material topology change.
- `modeBeforePinch`: state restored when native scale returns.

Signals are normalized from:

- initial, animation-frame, `pageshow`, and visible-tab measurements;
- window and Visual Viewport `resize`;
- Visual Viewport `scroll` and `scrollend`;
- editable `focusin` and `focusout`;
- orientation and material layout-width change;
- pinch touch/scale transitions;
- optional `VirtualKeyboard.geometrychange` and `boundingRect.height`.

## Keyboard Detection and Recovery

### Focus entry and keyboard opening

Editable focus changes `keyboardPhase` from `clear` to `armed` and captures `closedHeight`. Any
valid native-scale height below that captured height while armed is treated conservatively as
`occluding`. A positive optional Virtual Keyboard intersection also confirms `occluding`.

During `armed` or `occluding`, smaller measurements cannot replace `closedHeight`. The shell uses
the current valid `liveOffsetTop`, so input-driven browser panning cannot hide the header.

### Tapping outside the input

Final editable `focusout` changes the phase to `recovering` and starts bounded follow-up
observation. It does not restore an old offset. Until a full-height measurement arrives, the policy
publishes `closedHeight` plus the live origin.

A native-scale height at or above `closedHeight` clears recovery and is accepted as the current
closed height even when `offsetTop` remains nonzero. Later origin-only events continue updating
`liveOffsetTop` until it returns to zero or another valid browser-chrome position.

### Keyboard-hide button with retained focus

Retained focus does not lock the policy in `occluding`. A native-scale height at or above
`closedHeight`, or an optional Virtual Keyboard intersection returning to zero after positive
occlusion, proves that the keyboard closed. The phase becomes `armed` while focus remains, and the
live origin continues to update independently. A recovered height at or above `closedHeight` is
accepted. A zero keyboard intersection never authorizes a smaller height; that sample remains
protected until full geometry returns or an independent topology transition establishes a new
baseline.

If the user reopens the keyboard without changing focus, a later material height reduction or
positive keyboard intersection re-enters `occluding`.

### Browser behavior without Visual Viewport

Measurement falls back to `window.innerHeight`, then root `clientHeight`. Focus-armed shrinkage is
treated as keyboard occlusion; a measurement at or above the captured height clears it. Offset
defaults to zero. Optional Virtual Keyboard geometry strengthens detection where available but is
never required.

## Other Viewport Lifecycles

### Bootstrap and reused tabs

Initial entry, `pageshow`, and return to a visible tab keep bidirectional bounded observation so a
late viewport-meta update can establish the correct closed height without user interaction.

### Browser chrome

When keyboard phase is `clear` and native scale is active, ordinary valid height changes can update
`closedHeight`. When focus is armed, growth is accepted as a closed height; shrinkage first becomes
keyboard occlusion instead of immediately rebasing.

### Orientation, split-screen, and window topology

Orientation or a material layout-width change explicitly invalidates the previous `closedHeight`
and starts topology recovery. This is the only keyboard-independent path that may accept a smaller
closed height while a focus lifecycle is active.

### Pinch zoom

Non-native scale and confirmed multi-touch retain the last trusted published geometry. Native scale
must return before keyboard or topology measurements can rebase the shell.

## Observation and Failure Handling

Bootstrap, topology, and keyboard recovery use one cancelable animation-frame observation loop with
a bounded deadline. The deadline stops work; it never makes the latest smaller sample trustworthy.

Zero, negative, non-finite, or pinch-scale geometry is rejected. Missing Visual Viewport fields use
the validated layout fallbacks. Duplicate geometry is not republished. Cleanup cancels frames and
timers, removes every listener, active class, and custom property, and prevents delayed mutation
after the exam ends.

No programmatic page scrolling or input blurring is introduced. Those actions could disrupt the
independently scrollable passage/question panes or the student's typing position.

## CSS Contract

The controller continues to publish:

- `--student-viewport-height`
- `--student-viewport-offset-top`

The exam shell remains fixed against the layout viewport and consumes these values exactly. The
height declaration keeps ordered `100vh` and `100dvh` fallbacks before the measured custom property.
CSS must not add `max()`, a positive `min-height`, or another competing height authority.

The header and footer remain non-scrolling flex children. Only the module workspaces and their panes
scroll. The existing viewport meta progressive enhancement and optional Virtual Keyboard listener
remain capability-based.

## Regression Strategy

Pure policy tests must first reproduce and fail for both production sequences:

1. Tap outside: `900/0 -> focus -> 560/180 -> focusout -> 900/180 -> 900/0`. The published shell
   keeps height `900`, follows offsets `180 -> 0`, and clears keyboard recovery.
2. Keyboard-hide with retained focus: `900/0 -> focus -> 560/180 -> 950/180 -> 950/0`. The recovered
   `950` height is accepted without `focusout`, the phase returns to armed, and a later shrink can
   reopen occlusion.

Controller and StudentApp integration tests cover the same event order through real policy wiring.
They assert published CSS variables and shell ownership. Existing regressions remain green for:

- reused-tab and pasted-link recovery;
- persistent smaller post-keyboard samples;
- focus transfer between answer controls;
- browser chrome growth and shrink;
- orientation and material width changes;
- pinch and page-zoom protection;
- invalid and missing viewport geometry;
- optional Virtual Keyboard geometry;
- cleanup and exact CSS/meta contracts.

The failure case and UX invariant documentation will be updated to state that height, origin, focus,
and keyboard occlusion have independent trust rules.

## Rejected Alternatives

### Focusout-driven recovery

It cannot detect a keyboard-hide action that retains focus and resets origin too early when blur
precedes visual viewport recovery.

### Virtual Keyboard overlay as the foundation

It is useful as an optional signal but is unavailable across required iPadOS/Safari and older
engines. Enabling `overlaysContent` would also transfer focused-control occlusion responsibility to
the application.

### CSS-only dynamic viewport height

It cannot assign meaning to focus panning, keyboard occlusion, reused-tab geometry, topology, or
pinch transitions.

### Browser/version branches

They cannot reliably identify engine behavior in iPad desktop-site mode or embedded browsers and
would expand indefinitely.

## Success Criteria

- Tapping outside after typing restores both header and footer without user scrolling.
- The keyboard-hide button restores the footer even when the answer input remains focused.
- While the keyboard is visible, the full-height footer stays behind it rather than moving above it.
- No persistent white band can remain because height and origin recover independently.
- Reused-tab entry and all existing viewport protections remain intact.
- Behavior is selected from capabilities and observed geometry, never browser identity.
- No answer durability, submission, timer, integrity, audit, or grading behavior changes.
