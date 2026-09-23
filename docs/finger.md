Yes. I rechecked the current `main` architecture, and I would implement this as a **Selection v2 ownership hardening + selection/menu lifecycle fix**, not as three isolated UI patches.

The important architectural rule should be:

```text
Real SAT exam + touch interaction on protected exam text
                    ↓
            Selection v2 owns it
                    ↓
 window.getSelection() never owns the gesture
                    ↓
 custom range is confined to one SAT text block
```

And separately:

```text
visual text selection
        ≠
contextual toolbar visibility

Close toolbar
→ selection stays

Tap selected text
→ toolbar comes back

Tap outside
→ selection actually ends
```

That separation is the key to fixing this cleanly.

## Implementation plan

1. **Start with failing regressions and diagnostics before changing behavior.** Extend `e2e/student-owned-touch-selection.spec.ts` with the exact three physical-device failures from your screenshots. First, create a custom selection, then hold the already-selected words for 1–2 seconds; assert that the custom lines/handles remain and `window.getSelection()` is always empty/collapsed. Second, drag/hold aggressively near the edge of the passage and verify that neither the custom Range nor any browser Range escapes the original `[data-content-text-node]`. Third, select text → close the SAT toolbar → verify the selection and two handles remain → tap the highlighted body → verify the same SAT toolbar comes back without changing the range.

   Before fixing anything, extend the existing touch-selection diagnostics to record on every relevant `pointerdown`, `selectstart`, and `selectionchange`: `event.pointerType`, `(pointer: coarse)`, `(any-pointer: coarse)`, `navigator.maxTouchPoints`, computed `user-select`, computed `-webkit-user-select`, computed `touch-action`, whether the touched root has `data-sat-selection-protected`, whether `data-student-owned-touch-selection` is present, `window.getSelection().rangeCount/isCollapsed`, and whether the native selection's anchor/focus nodes are inside the SAT root. This gives you a real answer on iPad instead of another browser-heuristic fix.

2. **Separate three concepts that are currently too closely coupled: exam ownership, input modality, and ergonomics.** `StudentExamInteractionScope.ownedTouchSelection` should remain the authority for whether this real exam is allowed to own touch selection. The actual `PointerEvent.pointerType` should decide whether the current physical gesture is touch, mouse, or pen. CSS media queries such as `(pointer: coarse)` should only affect ergonomics—spacing, hit targets, menu comfort—not whether Safari or your application owns the Range.

   In particular, refactor the current `wouldBeginGesture()` logic in `useStudentSelectionGesture.ts`. Do not make this the ownership gate:

```ts
if (!config.isCoarsePointer()) return false;
```

Move toward an input predicate such as:

```ts
const isOwnedPointer = (event: PointerEvent) =>
  event.pointerType === 'touch';
```

Keep the predicate injectable for tests. A touchscreen iPad with a trackpad attached must not suddenly hand finger selection back to Safari because the primary pointer happens to be reported differently.

3. **Harden native-selection suppression at the protected SAT surface, but keep it narrowly scoped.** `SatAnnotatedContent.tsx` already marks the correct semantic boundary with:

```tsx
data-sat-selection-protected="true"
```

Keep that. Do not globally disable text selection on the entire document or SAT workspace.

Introduce one explicit ownership marker controlled by the selection adapter, conceptually:

```text
data-student-selection-owner="app"
```

The protected text root should receive it only in real student delivery where app-owned touch selection is supported. `-webkit-touch-callout:none` can remain permanently active on that protected root in the locked exam because it does not need to be part of the selection model.

For `user-select`, do not depend solely on `(pointer: coarse)`. Make touch ownership explicit and ensure the property is already effective whenever a touch selection can exist—including while an existing custom selection is resting. This is important because the student's second long press is currently one of the ways Safari can appear to reacquire the text.

Do **not** add more generic `contextmenu` suppression. The repo's own Selection v2 comments are correct: preventing a context-menu event after Safari has created a Selection is too late.

4. **Add a narrow native-selection fail-safe.** Even after the CSS ownership rule is fixed, add defense in depth because this is an exam surface and Safari behavior is the exact thing failing on hardware.

   While app-owned touch selection is active, listen to `selectionchange`. If and only if all of these are true—

```text
real student exam
+ app-owned selection surface
+ touch selection mode
+ non-collapsed window.getSelection()
+ native selection intersects that protected root
```

—immediately call `removeAllRanges()`.

Also intercept `selectstart` on that protected root where supported and prevent it while touch ownership is active. Keep both listeners inside the Selection-v2 adapter, not scattered across SAT components.

Critically, this guard must **not** erase normal text selections in authoring, preview, note editors, inputs, textareas, contenteditable elements, or ordinary desktop pages.

5. **Make the custom session the only authority for the visual selection.** Do not reconstruct a selection from the blue rectangles or from SAT's toolbar anchor. `selectionSession.ts` already owns the Range; continue using that.

   The session invariant should be:

```text
session.range()
→ source of selected text
→ source of blue rectangles
→ source of handles
→ source used when SAT needs an anchor
```

Never derive the Range from the toolbar's `SatTextAnchor`.

Keep `satAnnotationBlockForPoint()` as the boundary owner. A touch beginning in one `[data-content-text-node]` may extend only inside that block. If the finger leaves it, clamp to the block edge. It must never become:

```text
passage → divider → timer → question controls
```

which is the failure shown in your screenshot.

6. **Fix the semantic mismatch in SAT interaction state.** Currently `satInteractionState.ts` describes `annotation.selection` as if `null` means that no text is selected. That is already untrue: `closeSelectionTools()` calls `interaction.selectionCleared()`, but the shared Selection-v2 session and its handles can remain alive.

   Clean this up rather than adding another special boolean. Rename the SAT state concept to what it actually owns, for example:

```ts
annotation: {
  modeEnabled: boolean;
  selectionToolsAnchor: SatTextAnchor | null;
}
```

or similarly `contextualSelectionAnchor`.

Then the state model becomes truthful:

```text
Selection-v2 session
→ owns actual temporary visual selection

SAT interaction machine
→ owns whether contextual annotation controls are showing
```

Introduce explicit intents/events such as:

```text
TEXT_SELECTION_CAPTURED
TEXT_SELECTION_TOOLS_DISMISSED
TEXT_SELECTION_CLEARED
```

Their meanings should be different:

```text
CAPTURED
→ store/replace toolbar anchor

TOOLS_DISMISSED
→ hide contextual toolbar only

CLEARED
→ no contextual anchor remains because the actual selection ended
```

Do not use `TEXT_SELECTION_CLEARED` for the X button anymore.

7. **Add a first-class “activate resting selection” operation to Selection v2.** The shared overlay currently sees a press on selected text and intentionally consumes it, which is good—it prevents a new selection from starting. What is missing is the callback that says, “the student touched this existing selection again.”

   Extend the shared gesture contract with something like:

```ts
activateCurrentSelection(): boolean
```

or:

```ts
onSelectionActivated?: (range: Range, text: string) => void
```

The implementation must read `session.range()`. It must not mutate the endpoints.

Then change the resting-body branch in `SelectionOverlay.tsx` to:

```text
pointerdown inside selected rectangles
        ↓
consume pointerdown
        ↓
do not move handles
        ↓
do not dismiss selection
        ↓
activate current Range
```

SAT's adapter handles that activation through the same canonical pipeline it already trusts:

```text
Selection v2 session Range
        ↓
captureSatTextRange(...)
        ↓
SatTextAnchor
        ↓
TEXT_SELECTION_CAPTURED
        ↓
SatSelectionActionsPanel
```

This gives exactly the interaction you requested without maintaining a second copy of the selection.

8. **Define dismissal behavior explicitly so one pointer never means two things.** Keep the interaction grammar consistent:

| Student action              | Selection                            | Handles | SAT toolbar           |
| --------------------------- | ------------------------------------ | ------- | --------------------- |
| Finish selection            | stays                                | visible | visible               |
| Tap X                       | stays                                | visible | hidden                |
| Tap selected words after X  | stays unchanged                      | visible | visible again         |
| Drag start/end handle       | adjusts                              | visible | hidden while dragging |
| Release handle              | updated                              | visible | visible               |
| Tap outside prose selection | cleared                              | gone    | gone                  |
| Escape with toolbar open    | decide one level only: toolbar first |         |                       |
| Escape again                | selection cleared                    |         |                       |
| Turn Highlights & Notes off | selection cleared                    | gone    | gone                  |
| Navigate question/module    | selection cleared                    | gone    | gone                  |

Do not allow an outside pointerdown to both dismiss the existing selection **and** begin another selection under the same event. The current SelectionOverlay already has much of this one-pointer-one-intent logic; preserve it.

9. **Keep the browser-selection adapter and owned-selection adapter mutually exclusive for one physical gesture.** `useSatAnnotationSelection.ts` currently supports both `window.getSelection()` and the app-owned Range because desktop still needs native selection. Keep both capabilities, but explicitly partition them:

```text
mouse / keyboard native selection
→ captureSatTextSelection(...)

owned touch interaction
→ captureSatTextRange(...)
→ browser Selection must stay empty
```

Never let the same touch gesture be processed through both pipelines.

The document-level `pointerup` native-selection reporter should skip the browser path when the gesture was known to be app-owned touch. This avoids a late Safari Selection being treated as legitimate SAT input.

10. **Test the domain/state machine separately from the browser mechanics.** Add reducer tests in `src/features/student-delivery/domain/__tests__/satInteractionReducer.test.ts` and intent/controller tests around the new semantic events. Verify: capture shows tools; dismiss-tools preserves the fact that annotation mode remains armed; recapture of the same anchor works; recapture of a modified anchor replaces it; actual clear removes contextual state; annotation mode off refuses reactivation; question change clears transient state; module change clears and disarms according to the existing contract; note-editor conflicts still behave exactly as before.

For `SelectionOverlay.test.tsx`, explicitly test that a body press invokes activation once, consumes the event, does not call `dismiss`, does not call `beginHandleAdjustment`, and does not change the geometry. A body drag after the toolbar was closed must still not create a new session.

For `useStudentSelectionGesture.test.tsx`, test a real `pointerType:'touch'` when the environment reports a fine primary pointer. It must still use the owned touch path. Conversely, a mouse pointer must not suddenly receive touch handles unless that is deliberately opted in.

11. **Add adversarial Safari/WebKit E2E cases rather than only happy-path drags.** Extend `playwright.touch-selection.config.ts` coverage with at least these cases:

```text
long hold on unselected word
long hold on already-selected word
hold > 2 seconds
slow 1px movements during hold
drag to left edge of text block
drag to right edge
drag vertically outside paragraph
drag toward pane divider
drag toward timer/header
short 1–3 character selection
selection overlapping existing highlight
close toolbar → wait → tap selected text
close toolbar → long hold selected text
adjust handle after toolbar closed
pointercancel
lostpointercapture
question navigation with resting selection
mode off with resting selection
```

For every owned-touch scenario, assert both sides simultaneously:

```ts
expect(await page.evaluate(() => {
  const s = window.getSelection();
  return !s || s.rangeCount === 0 || s.isCollapsed;
})).toBe(true);
```

and:

```text
[data-student-selection-line] > 0
[data-student-selection-handle] == 2
```

That combination is much stronger than merely checking that the custom blue UI appeared.

12. **Use a real physical iPad as the final release gate.** Playwright WebKit is necessary, but this exact defect involves Safari/iPadOS's native selection UI, which browser automation does not perfectly reproduce. The release checklist on hardware should include Safari and, if you support it, Chrome on iPadOS because both use WebKit underneath.

The pass criteria should be: hold custom-selected text for 3–5 seconds and no native Copy/Translate/Share menu ever appears; drag aggressively and no blue native selection can escape into the timer/question/header; close the custom menu and the selected text remains; tap the selected text and the custom menu returns immediately; handles still work after reopening; outside tap removes everything cleanly; and repeated cycles do not produce a stuck loupe, duplicate toolbar, or stale selection.

### Files I would expect to change

The core patch should stay concentrated around:

```text
src/shared/ui/selection-v2/react/useStudentSelectionGesture.ts
src/shared/ui/selection-v2/react/SelectionOverlay.tsx
src/shared/ui/selection-v2/domain/selectionTypes.ts
src/shared/ui/selection-v2/engine/selectionSession.ts        # only if activation API belongs here
src/index.css

src/features/student-delivery/ui/annotations/useSatAnnotationSelection.ts
src/features/student-delivery/ui/annotations/SatAnnotatedContent.tsx
src/features/student-delivery/hooks/useSatAnnotationSurface.ts
src/features/student-delivery/hooks/useSatInteractionController.ts
src/features/student-delivery/domain/satInteractionState.ts
src/features/student-delivery/domain/satInteractionIntents.ts
```

with the corresponding Selection-v2 unit tests, SAT interaction reducer/controller tests, and `e2e/student-owned-touch-selection.spec.ts`.

### Definition of done

Do not consider this fixed merely because the iOS menu is difficult to reproduce. The invariant should be mechanically testable:

```text
owned touch SAT selection
        ↓
window.getSelection() = empty
        ↓
session.range() = valid + block-bounded
        ↓
custom rectangles + two handles
```

and:

```text
X
→ toolbar hidden
→ session.range() unchanged

tap selected text
→ same Range reactivated
→ same SatTextAnchor regenerated
→ toolbar visible
```

I would **not** solve this with global `user-select:none`, more `contextmenu` listeners, a timer that repeatedly clears native Selection, a fake second Range stored in SAT state, or a special-case “if menu closed then open it” handler inside `SatAnnotatedContent`. The fix should make **Selection v2 the sole owner of touch selection and SAT the sole owner of what actions appear for that selection**.
