# Student Exam Viewport State Machine Design

## Goal

Keep the active exam header and footer aligned to the usable browser viewport across mobile,
tablet, desktop, split-screen, reused-tab navigation, software-keyboard transitions, browser chrome
changes, orientation changes, and browsers with partial viewport API support.

The design is capability-based. It must not depend on an Apple, Android, tablet, browser-family, or
browser-version check.

## Confirmed Failure

`IMG_1109.PNG` shows the footer frozen above the physical bottom after the software keyboard closes.
The gap remains indefinitely. The controller starts with a trusted `900px` full-height viewport,
protects it while the keyboard reports `560px`, then lets focusout recovery permanently rebase the
protected height to a smaller `820px` sample. The current unit and integration tests explicitly
expect that downward rebase, so they encode the production failure rather than prevent it.

The reused-tab correction is independent and works: initial recovery must still be able to replace a
stale starting rectangle in either direction.

## Standards and Browser Constraints

The CSS Viewport specification defines `interactive-widget=resizes-visual` as resizing the visual
viewport without resizing the initial viewport. This is the modern default, but older browsers and
embedded web views may resize both viewports or ignore the directive. The exam viewport meta policy
will declare it explicitly as a progressive enhancement.

Dynamic viewport units react to browser UI, but the specification allows user-agent differences and
notes that on-screen keyboards commonly overlay content without affecting viewport units. Therefore
`dvh` is a fallback, not a runtime keyboard-state oracle.

`VisualViewport` remains the preferred geometry source because it exposes visible height, top
offset, scale, and resize/scroll events. Its output is accepted only through the state policy;
individual measurements are not automatically trusted during keyboard or pinch transitions.

The optional `VirtualKeyboard` API can provide an additional `geometrychange` signal in supporting
Chromium environments. The application will not set `overlaysContent`, call `show()`/`hide()`, or
make core behavior depend on that API because support is not universal and opting into overlay mode
would make the application responsible for all focused-control occlusion.

## Ownership and Boundaries

The student UI module owns this behavior.

- `studentExamViewportPolicy.ts` will own the pure state transition and rectangle acceptance rules.
- `studentExamViewportController.ts` will own browser capability detection, event wiring, bounded
  sampling, publishing CSS properties, and cleanup.
- `examPageZoomGuard.ts` will own the exam-only viewport meta content, including the explicit
  interactive-widget policy.
- `StudentApp.tsx` will install the controller for every active exam session. It will no longer use
  device-family detection to decide whether keyboard protection is enabled.
- `src/index.css` will consume the published rectangle exactly and retain ordered viewport-unit
  fallbacks for environments where JavaScript has not published a value.

The dependency direction remains:

```text
StudentApp -> viewport controller -> pure viewport policy
StudentApp -> exam viewport meta guard
shared CSS <- controller CSS custom properties
```

No answer, autosave, submission, timer, integrity, audit, grading, or persistence behavior changes.

## Geometry Model

A viewport rectangle contains rounded, non-negative CSS-pixel `height` and `offsetTop` values. A
sample also contains layout width and visual scale so the policy can distinguish keyboard/pinch
noise from a real display topology change.

Measurement fallback order is:

1. a finite, positive `VisualViewport.height`, with its finite offset and scale;
2. a finite, positive `window.innerHeight` with zero offset;
3. a finite, positive `document.documentElement.clientHeight` with zero offset;
4. the last trusted rectangle, if all live sources are temporarily invalid.

Zero, negative, `NaN`, and infinite dimensions never replace a trusted rectangle.

## Explicit State Machine

The pure policy uses these states:

### `bootstrapping`

The exam has just installed, been restored, or returned to a visible document. Native-scale samples
may replace the rectangle in either direction during a bounded observation window. This preserves
the reused-tab fix when a late viewport-meta recalculation changes the initial rectangle without a
final event.

### `stable`

The policy stores the last trusted full viewport rectangle and layout width. Native-scale visual
viewport changes are accepted when no editable control or pinch is active. Browser chrome can
therefore grow or shrink the shell during ordinary browsing.

### `keyboard-active`

Entering an editable control captures the stable rectangle as `keyboardBaseline`. Smaller height
samples cannot replace that baseline. The published top may follow the active visual viewport while
typing so the header stays at the visible top when the browser pans to the focused control.

### `keyboard-recovery`

Leaving the final editable control immediately republishes the complete `keyboardBaseline`,
including its stable top offset. A bounded observation loop watches for recovery even if no final
resize event fires. Native-scale growth is accepted, but a smaller sample can never replace the
baseline solely because a timer expires. When observation ends, the baseline remains trusted rather
than committing the last keyboard-era sample.

### `pinch-active`

Multi-touch or a non-native visual scale freezes the trusted height. The policy leaves this state
only after native scale returns and the existing release guard completes.

### `topology-recovery`

A real display change invalidates the keyboard baseline and permits bidirectional rebasing. Trusted
evidence is an orientation event, a material layout-width change, page restoration, or return to a
visible document. A height-only resize while an editor is active is not topology evidence because
older browsers resize `window.innerHeight` for the keyboard.

## Transition Rules

- Installation enters `bootstrapping`.
- `pageshow` and visibility return enter `bootstrapping`/`topology-recovery` and allow bounded
  bidirectional settling.
- Editable `focusin` enters `keyboard-active` and captures the most recent stable rectangle.
- Focus movement between editable controls remains `keyboard-active` and retains the same baseline.
- Final editable `focusout` enters `keyboard-recovery` and restores the baseline immediately.
- A keyboard recovery sample at or above the baseline may grow the trusted rectangle.
- A keyboard recovery sample below the baseline is ignored indefinitely unless topology evidence
  arrives.
- Orientation or material width change enters `topology-recovery`, even if it occurred while the
  keyboard was active.
- Pinch protection takes precedence over sampling in every state.
- Non-native scale never becomes a trusted full-screen rectangle.

## Browser Event Strategy

The controller listens to:

- window `resize`, `orientationchange`, and `pageshow`;
- visual viewport `resize`, `scroll`, and `scrollend` when available;
- document `visibilitychange`, capturing `focusin`/`focusout`, and touch lifecycle events; and
- `VirtualKeyboard.geometrychange` when the API exists.

Initial, topology, and keyboard-recovery observation use one cancelable animation-frame loop with a
short timeout fallback. The loop is bounded; ordinary event-driven measurements continue afterward.
No permanent polling is introduced.

Cleanup remains idempotent and removes every listener, timer/frame, CSS class, and custom property.

## Rendering Contract and Fallbacks

The controller remains the only active runtime height policy. Root, body, and the exam shell consume
`--student-viewport-height` exactly. CSS must not use `max()`, a positive `min-height`, or another
lower bound around the measured value.

The ordered fallback declarations are:

```css
height: 100vh;
height: 100dvh;
height: var(--student-viewport-height, 100dvh);
```

Older browsers that do not understand dynamic units or custom properties retain the preceding
usable declaration. Once the controller publishes a pixel value, that value remains the sole shell
height.

The exam viewport meta content becomes:

```text
width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no,
interactive-widget=resizes-visual
```

Unsupported engines ignore the final key and use the JavaScript fallback policy.

## Rejected Alternatives

### Device/version branching

User-agent checks decay as browsers change engines, tablets request desktop sites, and embedded web
views omit familiar identifiers. Capability and event-state checks cover those environments without
an expanding browser matrix.

### CSS-only `dvh`

Viewport-unit behavior around on-screen keyboards is not a portable keyboard signal. CSS also
cannot distinguish a keyboard transition from orientation, pinch, browser chrome, or split-screen.

### `VirtualKeyboard.overlaysContent = true`

This can stabilize viewport geometry in supporting Chromium versions, but is unavailable in many
Safari/Firefox versions and transfers focused-control occlusion responsibility to the application.
It is not an acceptable cross-browser foundation.

### Longer recovery timeout

The reported smaller height remains indefinitely. Waiting longer would commit the same invalid
measurement later and make tests slower.

### Permanent polling or forced page scrolling

Polling wastes resources and still cannot assign meaning to a stale sample. Programmatic page
scrolling would interfere with the independent reading/question panes and user focus position.

## Regression Matrix

Pure policy, controller, integration, meta, and CSS tests will cover:

- reused-tab entry: stale small/offset rectangle settles to the final rectangle without user input;
- persistent keyboard stale height: `900 -> 560 -> focusout -> 820` remains `900` after the complete
  recovery window;
- late keyboard growth: the same sequence accepts a later `950` full-height sample;
- focus transfer between answer controls retains one baseline;
- orientation or material width change while typing permits a new smaller stable rectangle;
- ordinary browser-chrome shrink in `stable` is accepted;
- pinch scale and multi-touch cannot rebase the trusted rectangle;
- invalid/zero VisualViewport geometry falls back safely;
- missing VisualViewport uses `innerHeight`, then root `clientHeight`;
- `VirtualKeyboard.geometrychange`, when present, triggers measurement without becoming required;
- `interactive-widget=resizes-visual` is applied and the prior viewport meta content is restored;
- CSS retains `100vh`, `100dvh`, and exact custom-property consumption without competing bounds;
- cleanup cancels delayed work and prevents late mutation outside the exam.

Existing StudentApp tests for reused tabs, page zoom, iPad Chrome parity, orientation, objective and
writing inputs, pinch, dialogs, and independent pane scrolling remain green.

## Repository Memory

- Replace the incorrect keyboard-downward-rebase tests with the persistent-stale-height regression.
- Update `docs/ux-invariants.md` to define trusted stable rectangles and keyboard/topology state
  transitions.
- Add a failure-case note explaining why focusout is not permission to accept a smaller viewport.
- Keep the state transition rules in a pure module so future browser reports can be expressed as
  table-driven tests rather than additional controller flags.

## Success Criteria

- The footer returns to the physical bottom after keyboard dismissal without scrolling or tapping.
- No white gap can persist because of a smaller post-keyboard sample.
- The already-fixed reused-tab/pasted-link scenario remains fixed.
- Real orientation, split-screen, window, and browser-chrome changes still resize the shell.
- Behavior is selected by available APIs and observed lifecycle state, never browser identity.
- Answer durability, submission immutability, timer fairness, integrity events, and audit behavior are
  unchanged.
