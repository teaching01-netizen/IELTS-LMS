# Student Visible Viewport Shell Design

## Goal

Keep the student exam header and footer aligned with the visible iPad browser viewport and remove the matching blank area below the footer when browser chrome shifts the visual viewport.

## Ownership

- `StudentApp` owns the exam-phase browser viewport lifecycle and the CSS custom properties that describe the protected viewport rectangle.
- The shared student exam CSS in `src/index.css` owns how `.student-exam-shell` is positioned within that rectangle.
- `StudentHeader`, `StudentExamWorkspace`, and `StudentFooter` retain their existing flex-layout responsibilities. Their behavior and data contracts do not change.

## Root Cause

The current exam shell tracks `window.visualViewport.height`, but it does not track `window.visualViewport.offsetTop`. On iPad Chrome and Safari, expanding or collapsing browser chrome can move the visual viewport relative to the layout viewport. The shell remains anchored at layout-viewport position zero, so its header can sit behind browser chrome and its bottom edge can stop above the visible viewport bottom. The resulting bottom gap approximately matches the unhandled vertical offset.

## Design

While the effective student phase is `exam`, `StudentApp` will expose the current non-negative visual viewport offset through a `--student-viewport-offset-top` custom property alongside the existing protected height property. The value will be refreshed from `visualViewport.offsetTop` on the existing window and visual-viewport resize and scroll boundaries. Browsers without `visualViewport` will use an offset of zero.

The shared `.student-exam-shell` contract will become a fixed shell whose top edge is the tracked visual viewport offset. Its existing protected effective height remains the larger of the session-locked height and `100dvh`. The header and footer remain normal, non-scrolling flex children of that shell; the main workspace remains the only flexible region, and its existing passage/question panes continue to own vertical scrolling.

When the exam phase ends, `StudentApp` will remove both viewport custom properties and the active exam classes. No viewport positioning policy will leak into briefing, waiting-room, post-exam, builder, admin, or other routes.

## Rejected Alternatives

- Fixing `StudentHeader` and `StudentFooter` independently would require duplicated offsets and content padding, and could overlay answer content or dialogs.
- Forcing `window.scrollTo(0, 0)` on viewport events would fight iPad browser chrome and focus behavior without describing the actual visible rectangle.
- A CSS-only fixed shell at `top: 0` would still ignore a non-zero visual viewport offset.

## Invariants

- The header and footer remain fully visible at the top and bottom of the visible exam viewport when the visual viewport has a non-zero vertical offset.
- No blank document area appears between the footer and the visible viewport bottom.
- Reading, listening, and writing content panes retain independent scrolling and split-pane behavior.
- Temporary visual-viewport shrinkage from the software keyboard must not rebase the protected tablet height.
- The page-zoom guard, safe-area padding, dialog positioning, question navigation, and footer progress behavior remain unchanged.
- No answer, autosave, submission, timer, integrity, audit, or persistence behavior changes.

## Verification and Repository Memory

- Extend the `StudentApp` visual viewport mock to represent `offsetTop`.
- Add a failing regression test proving that a shifted visual viewport updates the offset property while preserving the protected height.
- Add a focused CSS contract test proving that the exam shell is fixed and uses the tracked top offset.
- Extend the iPad layout test to assert that the header and footer both remain inside the viewport and that the footer bottom aligns with the viewport bottom.
- Run focused student app and layout-contract tests, then the relevant type/build check and patch-hygiene check.
