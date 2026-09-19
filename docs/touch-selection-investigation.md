# IELTS Reading touch-selection investigation

Status: **physical-device root cause not yet established**. This change adds opt-in observation and browser coverage. It does not change selection policy, listener dependencies, caret resolution order, pointer capture, or CSS. Choosing a fix before collecting the failing iPad trace would be speculative.

## Reported reproduction

- Device: physical iPad, Safari. Model and iPadOS/Safari versions are unknown.
- Site: https://ielts-warwick-institute.up.railway.app, real student IELTS Reading session.
- Steps: arm Highlight, then drag over passage text.
- Expected: app-owned selection appears, then a highlight is applied without a native selection menu.
- Reported actual: Highlight arms and native selection is suppressed, but no selectable/highlighted range appears.

No physical iPad is connected to this investigation environment. None of the automated results below are physical-device verification.

## Baseline and evidence

On 2026-09-19, checked-out HEAD, `origin/main`, and the remote main ref all resolved to `a4a87016b2c0c0d547630952937ff56230589615`. The public deployment served `index-ceHgidLi.js`, `index-xag21ff7.css`, and `useStudentTouchTextSelection-CHVjCk4i.js`. Inspection of those public assets found the same relevant enablement, ref-effect, caret fallback, and owned-selection CSS paths. This does not establish the exact deployed commit or the assets cached on the affected iPad.

| Seam | Evidence and limit |
| --- | --- |
| Enablement | `StudentSessionRoute.tsx:163` and `:185` provide owned touch selection to both real exam routes. IELTS `useHighlightSurfaceV2.ts:208` gates on enabled, owned scope, and tool mode. SAT `SatAnnotatedContent.tsx:220` also requires annotation mode. The trace reports those gates and the actual coarse-pointer query separately. |
| Listener lifecycle | `useStudentTouchTextSelection.ts:447` reads the ref once per effect; its dependencies at `:466` are `[enabled, rootRef]`. An always-enabled test component with a null ref followed by a mounted root reproduces a missing listener and marker. **This is a confirmed generic lifecycle gap, not a proven cause of this incident.** |
| Actual IELTS lifecycle | `FormattedText.tsx:102` conditionally renders the ref-bearing surface. In the tested disabled-to-enabled transition, hook enablement changes in the same commit that mounts the root, so the effect binds it. In actual `StudentReading`, arming Highlight preserves the DOM root; browser traces report `listenerAttached: true` and `listenerRootMatches: true`. |
| DOM stability | `HighlightableSurface.tsx:34` memoizes the innerHTML prop. The actual component stability tests and browser arming check pass. The physical trace additionally compares the attached node with the current ref. |
| Events and caret | Chromium browser-generated touch events traverse down → native text caret → move → claim → focus caret → range → rects → up → onSelect. WebKit traverses the same code using synthetic pointer events and real layout/caret APIs. No cancellation occurs in those runs. The failing iPad sequence remains unknown. |
| Range and completion | Actual IELTS Reading produces `beta gamma`, a non-collapsed range, usable rects, successful `captureSurfaceRange`, a rendered mark, and persistence after reload. SAT produces a valid `captureSatTextRange`, displays the real shell toolbar, and renders the chosen annotation. |
| Caret fallbacks | Browser tests disable both native caret APIs and successfully use `elementFromPoint` plus real character geometry in Chromium and WebKit. An exploratory legacy-only run also succeeded. Neither result determines which API or geometry the affected iPad returns. |
| Pointer capture | Move/up/cancel listeners are on `document`. No observed event loss justifies adding `setPointerCapture()`. Physical event loss is still unverified. |

Paths in this table are under `src/components/student`, `src/shared/ui/touch-selection`, `src/features/student/routes`, and `src/features/student-delivery/ui/annotations`, respectively.

### CSS cascade

All relevant rules below are in the same stylesheet layer in `src/index.css`:

| Rule | Specificity | Result on tested coarse exam surfaces |
| --- | --- | --- |
| `html.student-exam-active [data-student-highlightable="true"]` and `.sat-exam-prose` variant, including descendants | `(0,2,1)` | `user-select: none`, `-webkit-user-select: none` |
| `.student-translation-guard-active [data-student-highlightable="true"]` and `.student-exam-active` native-selection rules | `(0,2,0)` | Lose to the coarse exam rule |
| Highlightable/callout-protected defaults | `(0,1,0)` | Lose to the coarse exam rule |
| `html.student-exam-active [data-student-owned-touch-selection="true"]` | `(0,2,1)` | `touch-action: none` while armed |
| Reading/listening pane `touch-action: auto` | `(0,1,0)` | Does not override the owned marker rule |

The inspected components do not set competing inline selection or touch-action styles. A descendant can report `touch-action: auto` while its marked ancestor reports `none`; the descendant value alone does not establish a conflict. Both are recorded. WebKit's unprefixed computed `user-select` can be empty in the local trace while `-webkit-user-select` is `none`.

Existing comments claiming a historical iPad cancellation are not proof of the current failure. The instrumentation captures the computed styles **before the hook handles pointerdown**, when gesture ownership matters.

### Why the existing jsdom tests could pass

The hook harness supplies a populated ref and injected text caret results. Component tests stub the coarse-pointer query and native caret API. jsdom does not supply real text layout, CSS gesture arbitration, OS menus, or physical browser cancellation. These tests verify the supplied range pipeline but cannot prove the missing device behavior.

## Collect the decisive iPad trace

The diagnostic code is local and **has not been deployed**. After deploying this change:

1. On the affected iPad, enter the same real IELTS Reading session.
2. Add `touchSelectionDebug=1` to the **current exam URL**, preserving its path and existing parameters, and reload. Use `?` for the first query parameter or `&` if one already exists. Adding it only to the homepage before navigation is insufficient.
3. Confirm the collapsed “Touch selection diagnostics” panel appears. Leave it collapsed while dragging, so it does not cover the passage.
4. Arm Highlight and reproduce the failed drag once. Release the finger.
5. Expand the panel and choose **Save trace**. Retain `touch-selection-trace.json` before trying another gesture. The visible read-only trace is also available if Safari cannot save the file.
6. Return that trace and, if available, the model and version from the device's settings. Do not infer these from an emulation profile or user-agent string.

The session exposes the same data at `window.__studentTouchSelectionDebug.snapshot()`. Removing the parameter and reloading disables diagnostics.

The export includes enablement, coarse query, listener/root identity, `rootExistsAtEffect` (retained across gestures), marker, computed root and target styles, pointer IDs/types/coordinates, raw DOM events, native caret answers/nulls/element results, geometry result, claim, start/focus containment, range text/connectedness/rect count, completion, and capture outcome. IELTS records the state mutation call; `renderedMarkCount` observes its rendered outcome. SAT records anchor reporting; the browser regression separately exercises its toolbar mutation.

`pointerDownSeen`/`pointerMoveSeen`/`pointerUpSeen`/`pointerCancelSeen` describe **hook handler progress**. Independently recorded `dom:pointer*` and top-level `documentEvents` reveal events, including cancellation, even when no gesture was started or no root listener attached. Inspect those raw events when the hook flags are false. Listener events before the current gesture are not retained in its event list; the snapshot retains their binding facts.

Each event buffer retains the first 40 and latest 80 entries when a gesture exceeds 120 entries. `rangeRectCount` counts usable overlay rects after filtering/coalescing. Selection text is clipped to 200 characters per sample. A snapshot's `nativeSelectionRangeCount` can include a collapsed caret after focus moves to the debug controls; it is not evidence that the owned range was installed in native Selection. The browser tests check empty native selection text immediately after the coarse gesture, before opening the panel.

The observer does not prevent events or change gesture ownership. Data stays in page memory until explicitly saved locally; there is no upload or telemetry endpoint. The export contains passage excerpts and user-agent data, but does not collect answer values, candidate identifiers, or the session URL.

## Validation

- Focused unit/integration suite: **143 tests passed across 11 files**, covering the shared hook/range/point code, real IELTS/SAT components, DOM stability, Reading controls, and session route.
- Browser suite: **11 passed, 1 intentionally skipped**. Projects cover touch Chromium, iPad-profile WebKit, and desktop Chromium. The desktop-only skip is the coarse-pointer geometry fallback scenario.
- Final diagnostic export checks: IELTS scenario passed in all three browser projects; the saved JSON and visible panel were inspected. The diagnostic unit suite was rerun after preserving `rootExistsAtEffect` through a gesture.
- Typecheck, targeted ESLint, production build, and whitespace checks passed. Existing route auth tests emit React `act` warnings.

Run the browser coverage with:

```sh
bun x playwright test --config playwright.touch-selection.config.ts
```

Run the focused integration coverage with:

```sh
bun x vitest run src/shared/ui/touch-selection src/components/student/__tests__/StudentOwnedTouchHighlight.test.tsx src/components/student/__tests__/HighlightableSurfaceDomStability.test.tsx src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx src/features/student/routes/__tests__/StudentSessionRoute.test.tsx --reporter=dot
```

The browser fixture mounts production `StudentReading` and the actual SAT shell with controlled content. It does not authenticate into the live student session. Chromium uses trusted browser-generated touch input; WebKit uses synthetic pointers with real layout. WebKit's emulated iPad profile is **not** the user's device model or Safari version and cannot validate physical touch arbitration.

## Risk and fix decision

| Area | Current boundary and outstanding device check |
| --- | --- |
| Scrolling | Gesture policy is unchanged. Marker removal on disarm is covered. Armed/unarmed scrolling and pinch behavior still need physical-device checks. |
| Cancellation | Cancellation logging and no-completion behavior are covered. The actual failing iPad's raw cancellation sequence is required. |
| Accessibility | Existing keyboard/announcement behavior is unchanged. The optional panel is keyboard reachable and collapsed initially; no physical VoiceOver audit was performed. |
| Preview/authoring | Owned selection remains opt-in at the real student route. Browser coverage verifies preview's native selection style and diagnostics-off default. |
| Editable controls | The observer is passive; existing exclusions are unchanged. Hook textarea exclusion and browser input editing pass. Physical notes/editor/calculator interaction is not claimed as verified. |
| SAT/IELTS | Both capture paths are instrumented and browser-tested. The reported physical failure is specifically IELTS Reading. |

No minimal corrective patch is selected yet. The next step is to identify the first missing or invalid stage in the failed physical trace, reproduce that behavior in a regression test, and change only the responsible boundary. The reproducible generic late-ref gap must not be presented as this incident's cause without evidence from the affected lifecycle.
