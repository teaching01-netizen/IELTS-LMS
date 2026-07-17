# Student Viewport Lifecycle Resynchronization Design

## Goal

Make the active student exam automatically align to the final visible iPad browser viewport when an exam URL is opened in a reused tab and after the software keyboard closes, without requiring the student to focus an input or scroll the page.

## Ownership and Compression

- A new module-local student viewport controller will own visual-viewport measurement, settling, event listeners, timers, CSS custom properties, and cleanup.
- `StudentApp` will only install and dispose that controller for the active exam phase.
- Shared CSS will continue to position `.student-exam-shell` from the controller's height and top-offset properties.

This extraction is required by the repository compression rule: viewport height locking, dynamic growth, zoom protection, and offset anchoring have already produced three tactical patches in the same `StudentApp` effect.

## Root Cause

The current exam lifecycle measures `visualViewport.height` and `visualViewport.offsetTop` once synchronously, then measures again only when the browser emits resize or scroll. On iPad Chrome and Safari, a reused tab can finish applying the new page's viewport meta policy after the first measurement without emitting another event.

Keyboard dismissal has a related timing boundary. The first focus or visual-viewport event can arrive before browser chrome and the visual viewport finish restoring their final rectangle. A later manual scroll emits the missing measurement, which is why the footer returns only after the student scrolls.

## Design

Create `studentExamViewportController.ts` with a single installer that receives the target window, document, and whether tablet height protection is required. It returns an idempotent cleanup function.

The controller will apply an immediate measurement and start a bounded settle cycle using the next animation frame plus short delayed measurements. A settle cycle will also start on `pageshow`, when document visibility returns to `visible`, and when an editable answer control loses focus. Resize and visual-viewport resize/scroll events will still apply an immediate measurement and schedule bounded follow-up measurements because the first browser event may precede the final rectangle.

During a settle cycle, the protected height may rebase only when no editable element is focused and native page scale is approximately one. Once the cycle completes, tablet height becomes the protected baseline again. While an input remains focused, a smaller visual viewport is treated as keyboard shrinkage and must not replace the protected height. The visual viewport top offset is always refreshed because stale offset is the direct cause of hidden header/footer boundaries.

All animation frames, timeouts, classes, CSS properties, and event listeners will be removed during cleanup. The controller will not scroll the window, synthesize browser events, poll continuously, or mutate answer controls.

## Keyboard Dismissal

When focus leaves an input, textarea, select, or contenteditable answer control, the controller will start a fresh settle cycle. This cycle captures the viewport after the keyboard and browser chrome finish expanding. The footer therefore returns to the visible bottom automatically even when iPad emits only an early resize and no final event.

## Invariants

- Opening the exam URL in a tab previously used by another site must settle automatically without keyboard or scroll interaction.
- Closing the keyboard must restore the footer automatically without page scrolling.
- While the keyboard is open, its smaller visual viewport must not replace the protected tablet height.
- Header and footer remain non-scrolling shell children; content panes retain independent scrolling.
- Whole-page pinch zoom remains blocked by the existing exam page-zoom guard.
- Cleanup must prevent delayed callbacks from mutating non-exam pages.
- No answer, autosave, submission, timer, integrity, audit, grading, or persistence behavior changes.

## Verification and Repository Memory

- Add controller tests with a mutable visual viewport that changes without dispatching resize after installation; delayed settling must publish the final height and offset.
- Add a test that shrinks the viewport while an input is focused, then changes it again after focusout without a final resize; delayed settling must restore the footer rectangle.
- Add cleanup coverage proving pending animation frames/timeouts and listeners cannot update CSS properties after disposal.
- Keep the existing `StudentApp` keyboard, pinch, orientation, dynamic-growth, and offset tests green after replacing the inline effect.
- Update the iPad viewport invariant and the implementation plan with both reused-tab and keyboard-dismissal cases.
