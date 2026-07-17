# Student Viewport Single-Authority Design

## Goal

Keep the active exam header and footer exactly inside the visible iPad browser rectangle after
opening an exam URL in a reused tab and after the software keyboard closes, without requiring an
input tap or manual page scroll.

## Confirmed Root Cause

The viewport controller publishes `visualViewport.height` and `visualViewport.offsetTop`, but the
rendered shell, root, and body use:

```css
height: max(var(--student-viewport-height, 100dvh), 100dvh);
```

That creates two competing viewport authorities. If iPad Chrome or Safari reports a `100dvh` value
larger than the current visual viewport during page replacement or keyboard restoration, CSS
chooses the larger value even after JavaScript has published the correct visible height. The shell
top remains correct while its bottom and footer are placed below the screen. `IMG_1105.PNG` shows
this after opening a reused tab; `IMG_1108.PNG` shows the same conflict after keyboard dismissal.

The `max()` rule was introduced to let a protected tablet shell grow without accepting transient
keyboard or pinch shrinkage. Now that viewport policy has a dedicated controller, CSS must no
longer implement a second growth policy.

## Ownership and Architecture

`studentExamViewportController.ts` is the single runtime authority for the active exam's visible
rectangle. It owns measurement, protected-height transitions, interaction guards, bounded recovery,
CSS properties, browser listeners, and cleanup.

`StudentApp` installs the controller and consumes the published properties. Shared CSS positions the
shell at the published top and gives it exactly the published height. Header, workspace, and footer
remain normal flex children; the workspace panes remain the only vertical scrolling regions.

The dependency direction remains:

```text
StudentApp -> studentExamViewportController -> browser viewport APIs
StudentApp/shared CSS <- published viewport properties
```

No answer, autosave, submission, timer, integrity, audit, grading, or persistence module is imported
or changed.

## Exact Rendered Rectangle

The active root, body, and `.student-exam-shell` use:

```css
height: var(--student-viewport-height, 100dvh);
```

The shell remains fixed at:

```css
top: var(--student-viewport-offset-top, 0px);
```

There is no positive `min-height`, `max()`, `100vh`, `100lvh`, or other lower bound capable of
making the active shell taller than the controller's rectangle. `100dvh` is only the
pre-installation fallback.

## Protected Height Policy

For a protected tablet session, the controller applies these rules in order:

1. The top offset always follows `visualViewport.offsetTop`.
2. While an editable control is focused, a smaller height is keyboard shrinkage and cannot replace
   the protected height.
3. While multi-touch pinch is active, native scale differs from one, or the short post-pinch guard is
   active, viewport changes cannot replace the protected height.
4. Outside those interactions, a passive height increase is safe browser-chrome growth and is
   accepted immediately by the controller.
5. A passive height decrease remains protected unless an explicit recovery window is active.
6. During an explicit recovery window, a native-scale height may rebase in either direction once no
   editable control or pinch guard is active.

Non-protected sessions continue to follow each visual viewport measurement directly.

## Bounded Recovery Window

The fixed `80/220/420ms` settling sequence is replaced with a bounded 1.5-second observation window.
The controller measures on each animation frame during that window, applies styles only when the
published rectangle changes, and stops automatically at the deadline. Browsers without animation
frame support use a short timeout fallback. There is no permanent polling.

A fresh recovery window starts on:

- initial active-exam installation;
- `pageshow`;
- return to a visible document;
- editable-control `focusout`;
- orientation recovery when no pinch guard is active; and
- visual-viewport `scrollend` when supported.

Resize and visual-viewport resize/scroll events continue to measure immediately. They do not grant
permission for protected shrinkage by themselves, but they can apply safe growth and top-offset
updates. A focusout recovery remains active through early keyboard resize events, so a late final
rectangle is still captured.

Editable focus state is tracked through document `focusin`/`focusout` as well as
`document.activeElement`; this avoids depending on a single browser event ordering. Pinch state is
tracked from multi-touch events and visual viewport scale.

## Cleanup and Failure Handling

Cleanup is idempotent and cancels the active animation frame or fallback timer, removes all window,
document, and visual-viewport listeners, removes active classes and CSS properties, and prevents any
late callback from mutating a non-exam page.

If `visualViewport` is unavailable, the controller uses `window.innerHeight` with a zero top offset.
If animation frames are unavailable, bounded timeout sampling preserves the same recovery deadline.
The controller never scrolls the page, synthesizes viewport events, or changes answer controls.

## Rejected Alternatives

### CSS-only dynamic viewport units

Using only `100dvh` is simpler but does not solve the observed iPad page-replacement and keyboard
timing behavior. It also cannot distinguish keyboard/pinch shrinkage from safe browser-chrome growth.

### Fixed header and footer as separate overlays

This duplicates viewport offsets, requires compensating content padding, and risks overlaying answer
controls and dialogs. The shell should remain the only fixed viewport box.

### Longer fixed timeout list

Adding more arbitrary delays leaves gaps between samples and repeats the failed timing strategy. A
bounded observation window is deterministic, short-lived, and captures changes anywhere inside the
recovery period.

## Invariants

- Opening or pasting the exam URL into a reused tab restores both header and footer automatically.
- Closing the software keyboard restores the footer automatically without page scrolling.
- The shell bottom equals the published visual viewport top plus height; CSS cannot override it.
- Keyboard and pinch shrinkage do not overwrite the protected tablet height.
- Safe native-scale viewport growth does not leave white space below the footer.
- Header and footer remain non-scrolling shell children; reading, listening, and writing panes keep
  independent scrolling.
- Whole-page pinch zoom protection, safe-area padding, dialogs, navigation, and accessibility
  controls remain unchanged.
- Cleanup cannot mutate briefing, waiting-room, post-exam, builder, admin, or other routes.
- Answer persistence, submission, timer fairness, integrity, and audit behavior remain unchanged.

## Verification and Repository Memory

- Change the CSS contract test to reject any `max()`/viewport-unit lower bound and require exact use
  of `--student-viewport-height` for root, body, and shell.
- Add controller coverage proving a final rectangle arriving after the former 420ms deadline is
  captured during initial and focusout recovery.
- Add controller coverage proving passive native-scale growth is accepted while keyboard, pinch, and
  passive shrinkage stay protected.
- Keep the existing reused-tab, keyboard-dismissal, top-offset, non-tablet, pinch, orientation,
  cleanup, and live tablet-lock `StudentApp` tests green.
- Update `docs/ux-invariants.md` so the controller is explicitly the single viewport authority.
- Run focused controller, `StudentApp`, and viewport CSS tests plus lint, TypeScript diagnostics, and
  patch-hygiene checks before publishing.
