# Phase 2 — Adaptive shell, stable panes, and splitter

Status: planned. Depends on: [Phase 1](phase-01-design-system.md). Next: [Phase 3](phase-03-controls-navigation.md).

## Result

The same live answer/editor trees work at phone, portrait tablet, landscape tablet, and desktop sizes. Layout changes never own answer mutations or reset meaningful working context.

## File ownership

| Boundary | Existing files |
| --- | --- |
| Environment/pure policy | `src/components/student/layout/studentLayoutMode.ts`, `studentCapabilities.ts`, `useStudentLayoutEnvironment.ts`, `studentExamViewportPolicy.ts`, `useStudentExamViewport.ts` |
| Shell | `layout/StudentExamShell.tsx`, `StudentExamViewport.tsx`, `useStudentExamPageLock.ts`, `useStudentFocusedControlVisibility.ts`, `layout/README.md`, `StudentApp.tsx` |
| Pane composition | `StudentMaterialWithQuestionPane.tsx`, `StudentWriting.tsx`, `StudentWritingPanes.tsx`, `StudentExamWorkspace.tsx` |
| Resize | `StudentSplitPaneResizer.tsx`, `useSplitPaneResize.ts`, `splitPaneDimensions.ts`, `browserParityPolicy.ts` |
| Existing context restoration | `useZoomScrollAnchoring.ts`, `StudentAppWrapper.tsx` |
| Acceptance matrix | `e2e/support/studentViewportMatrix.ts`, existing layout component tests |

## P2.1 — Define precise geometry inputs

Extend the existing pure layout policy; do not introduce another layout store. Its conceptual inputs are:

```ts
type LayoutFacts = {
  containerWidth: number;
  stableShellHeight: number;
  workspaceHeight: number;
  minMaterialWidth: number;
  minAnswerWidth: number;
  railWidth: number;
};
```

This is a proposed contract sketch, not an additional required public type. Reuse compatible existing types.

`stableShellHeight` is the outer available shell height after safe-area clearance; `workspaceHeight` is the remaining actual content area. The 650px wide and 600px standard thresholds refer to **shell height**, not content height after subtracting header/footer. This resolves the ambiguity in the original overview: a 1280×720 viewport may correctly remain wide with roughly 596px of workspace.

Order the decision explicitly:

1. Invalid/unmeasured geometry gets a safe initial focus layout; keep the UI mounted while measurements arrive.
2. Width <600px means phone.
3. Width >=1180px, stable shell height >=650px, and pane-fit means wide.
4. Width >=900px, stable shell height >=600px, and pane-fit means standard.
5. Otherwise use compact/focus presentation.

Pane-fit requires both minimum outer pane widths plus the rail to fit, and an initial minimum of 360px usable workspace height for split view. Outer pane minimums include their own padding; do not count gutters twice. Normal defaults start at approximately 380px material and 430px questions; enlarge requirements for explicit text preferences.

Expose capabilities such as `splitView`, `resizable`, `compactHeader`, and `compactNavigator`. Fine/coarse pointer and touch support are separate facts. `any-pointer: coarse` can enlarge targets without incorrectly treating a mouse as a coarse primary pointer.

## P2.2 — Measure once and prevent resize feedback loops

1. Attach `ResizeObserver` at the stable shell/content boundary through the existing layout hook. Observe actual container width, not only `window.innerWidth`.
2. Reuse viewport events for height, offset, focus, and zoom scale. Retain the last valid measurement when a temporarily hidden element reports zero.
3. Coalesce repeated measurements per frame and compare snapshots before setting state. No answer data or network calls in observer callbacks.
4. Choose structural mode from stable shell geometry; probable keyboard opening changes the visible edit region, not the core mode solely because a keyboard appeared. An actual window/container resize can still change mode.
5. Keep the mode calculation free from self-induced oscillation: do not toggle modes based on a header height that the same mode alternately expands and collapses. Use known mode chrome minimums plus stable outer height, then validate fit.
6. Update the mode union, all switch cases, CSS selectors, tokens, README, and E2E helpers together. Avoid a permanent `medium` compatibility mode alongside `standard`.

## P2.3 — Make DOM identity stable

Refactor the current conditional compact/split branches to one workspace root with stable material and response children. The root changes CSS arrangement. The hidden pane remains mounted but is `hidden`/inert and absent from the focus order.

Keep exactly one textarea per active Writing task and exactly one answer tree. Do not render a mobile copy and a desktop copy, reparent a live editor between branches, or change its key on resize. Keep media playback ownership above panels that change visibility. On an explicit pane switch, commit the active draft before hiding it through the existing draft path; a mere resize must not create a new answer value.

Focus rules:

- User chooses Questions/Response: show that pane and preserve its logical position; focus only a suitable visible target.
- User chooses Passage/Task: preserve reading position; never leave focus in a hidden editor.
- Resize: retain focused pane and element when possible. If it becomes hidden, reveal it or transfer focus predictably without moving the document.
- Proctor/phase lock: close ephemeral overlays and use the existing blocking focus policy.

## P2.4 — Replace the splitter's geometry and gesture path

Define split preference as a ratio of the **usable pane width excluding the rail**. Let `W` be container width, `R` rail width, and `U = W - R`.

```text
lower = max(0.32, minMaterialWidth / U)
upper = min(0.68, 1 - minAnswerWidth / U)
renderedRatio = clamp(preferredRatio, lower, upper)
leftPixels = renderedRatio * U
rightPixels = U - leftPixels
```

If `U <= 0` or `lower > upper`, use focus mode. Do not swap impossible bounds. The visible rail, CSS grid, hit zone positioning, ARIA range, and pointer-to-ratio conversion all use the same geometry. Account for the pointer's grip offset so the divider does not jump on press.

Keep `preferredRatio` distinct from `renderedRatio`; temporary narrow-window clamping must not destroy the preferred wide-window split. Read valid old preferences once, normalize units, and clamp. Persist on keyboard/click action or drag completion.

Use one pointer path: pointerdown captures the active pointer, pointermove schedules the current ratio, and pointerup commits it. Ignore unrelated pointers. On pointercancel/lost capture, end the gesture safely and keep the last valid layout. Clean up on unmount and restore any temporary selection/cursor styles. Never wait for a CSS transition to finish a drag.

Use a labeled separator with real bounds and `aria-controls`. Left/right adjust 2%, Shift+arrow 5%, Home/End reach limits. A visible-on-focus/touch resize menu provides narrower/wider/reset actions for users who cannot drag. Its focus behavior must work without hover.

## P2.5 — Scope workspace preferences to identity

`StudentApp.tsx` currently passes `ielts-split-pane:${examState.title}`. Replace that with the attempt/session identity already available through `StudentAppWrapper`/attempt state, including published version and module. Do not change `ExamState`'s domain model just to manufacture a layout key.

For live sessions, require a stable attempt ID; for preview, use its existing synthetic preview identity. A title is a display value, not an identifier. Old title-keyed storage may seed a valid numeric split preference, but must not transfer candidate-specific scroll/selection state. Initialize active pane from current navigation when no scoped state exists.

Keep ephemeral drag/menu/tool state out of persisted view preferences. Storage failure falls back to in-memory layout without blocking answers.

## P2.6 — Preserve reading and writing context

Capture stable paragraph/question/task anchors and relative pixel offsets before explicit pane/layout transitions. Reuse `useZoomScrollAnchoring`'s responsibility instead of letting multiple effects compete to restore scroll. Scope queries to the active exam root, not every matching element in the document.

Restore after measurements settle, bounded by content length and current viewport. Abort an old restore if the user has since scrolled or navigated. When fonts wrap differently, use anchor identity first and raw scrollTop only as fallback. Preserve textarea selection start/end/direction and scroll on pane changes; never reset selection while IME is composing.

## P2.7 — Make the keyboard-visible edit region usable

Extend the existing viewport snapshot with the facts needed to distinguish keyboard from pinch zoom and browser chrome. Bound the textarea or answer scroll region to visible viewport bottom minus required clearance. Keep stable shell chrome if appropriate, while removing inaccessible blank space below the keyboard from the editing surface.

Re-evaluate on viewport offset/height change and focus transfer while the keyboard stays open, not just a boolean `keyboardOpen` transition. Prefer native textarea caret scrolling after correcting its visible height. Only add selection/caret measurement if a demonstrated remaining case requires it; never scroll on every keystroke.

Safe-area padding has one owner per edge. Page locking is acquired only for active exam and released with prior styles/scroll restored. Avoid document scrolling as a keyboard workaround.

## Validation and exit gate

Extend existing pure policy/viewport tests and add focused cases for the ratio math and pointer lifecycle. Component tests must assert identical DOM node references before/after mode changes, retained values, hidden-pane focus exclusion, and no answer command on resize.

```sh
npm run test:run -- src/components/student/layout/__tests__ src/components/student/__tests__/StudentMaterialWithQuestionPane.test.tsx src/components/student/__tests__/StudentWriting.lifecycle.test.tsx src/components/student/__tests__/StudentSplitPaneCss.test.ts src/components/student/__tests__/StudentViewportCss.test.ts
npm run typecheck
```

Cover zero/NaN measurements, minimum-fit equality, inverted bounds, 599/600, 899/900, 1179/1180, 599/600 and 649/650 heights, 844×390, resize during drag, touch cancellation, repeated mount/unmount, title collisions, and candidate/version changes. Update old 768px portrait expectations intentionally.

Suggested commits: policy/measurement; stable panes and identity; pointer splitter; viewport/scroll restoration. Exit when code-based invariants pass and the corresponding device checks are prepared. Real keyboard/viewport claims remain unverified until the later release checks are allowed and executed.
