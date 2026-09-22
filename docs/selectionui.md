Yes. I rechecked the current `selection-v2` code after your latest implementation. The new caret snapping work is there, but these two remaining issues are in a different layer: **gesture acquisition** and **pointer termination**.

The first bug is especially clear from the current code. `SelectionHandle.tsx` still exposes a **44×44 transparent button centered on each endpoint**, and `SelectionOverlay.tsx` also dismisses a resting selection on a non-handle `pointerdown` without consuming that event. That means a press in the middle can either hit an invisible handle target on short selections, or dismiss the current selection and let the same `pointerdown` continue into the prose and immediately start another selection gesture.

The second bug is consistent with the current pointer-capture lifecycle. `followPointer()` only installs document-level `pointerup/pointercancel` fallback when `setPointerCapture()` fails. If Safari says capture succeeded but subsequently loses the capture or fails to deliver the terminal event to that element, the machine can remain in `adjusting-start` / `adjusting-end`, which keeps the loupe open. Short selections increase the chance because their handle hit areas overlap and generate many accidental handle grabs.

## Target interaction spec

The interaction should follow one strict rule:

> **A resting selection can only be resized by acquiring one of its two visible endpoint handles. Starting a gesture anywhere inside the selected text must never move either endpoint.**

Once a handle has successfully been acquired, however, the finger is free to move anywhere across the text. Acquisition is strict; tracking after acquisition is permissive.

So the state grammar should be:

```text
RESTING SELECTION

touch visible START handle
        ↓
adjust start
        ↓
finger may travel anywhere
        ↓
release
        ↓
resting selection

touch visible END handle
        ↓
adjust end
        ↓
finger may travel anywhere
        ↓
release
        ↓
resting selection


touch middle of highlighted text
        ↓
NO endpoint ownership
NO loupe
NO new selection
NO movement


touch outside selection
        ↓
dismiss current selection
        ↓
same pointerdown ends there
        ↓
next gesture may create another selection
```

That last point matters. One physical `pointerdown` should never mean both **"dismiss old selection"** and **"start a new selection."**

### Acceptance behavior

| Action                                               | Required result                        |
| ---------------------------------------------------- | -------------------------------------- |
| Press middle of selection                            | Selection stays exactly unchanged      |
| Drag from middle                                     | Nothing moves; loupe never opens       |
| Press near start endpoint                            | Start handle acquires                  |
| Press near end endpoint                              | End handle acquires                    |
| After handle acquisition, move finger through middle | Handle continues following normally    |
| Start/end 44px targets overlap                       | Middle still acquires neither          |
| Release handle anywhere                              | Adjustment terminates and loupe closes |
| `pointercancel`                                      | Loupe closes and gesture terminates    |
| lost pointer capture                                 | Loupe closes; never remain adjusting   |
| app/browser loses foreground                         | No permanently open loupe              |
| very short 1–4 character selection                   | Same behavior as long selection        |

## Implementation plan

1. **Add explicit handle-acquisition hit testing instead of treating the entire 44×44 button as draggable.** Keep the 44×44 DOM button for accessibility, but pointer interaction must go through a pure `canAcquireSelectionHandle()` rule. Give it the endpoint geometry, corresponding first/last selection line, and `clientX/clientY`. For the start handle, accept the outward/upward endpoint zone; for the end handle, accept the outward/downward zone. Reject a coordinate that is inside the body of the selected line. This is the critical short-selection fix: two 44×44 boxes may geometrically overlap, but their actual drag-acquisition zones must never make the selected center draggable.

2. **Make the selected body an explicit no-drag zone in `SelectionOverlay.tsx`.** Add a small pure helper such as `selectionContainsPoint(rects, x, y)`. In the document capture `pointerdown`, resolve intents in this order: action menu → handle → selected text body → outside. If the coordinate is inside the selection body, call `preventDefault()` and `stopPropagation()`, preserve the selection, and do nothing else. Do not call `dismiss()`, and do not let the event reach `handleDown()` on the underlying prose.

3. **Make outside dismissal a one-gesture-one-intent operation.** Today `SelectionOverlay` can call `dismiss()` and then allow the same event to reach the selection root. Change outside selection handling to `dismiss()` + consume that pointerdown. A new selection can begin on the student's next gesture. This eliminates the hidden `selected → idle → pending` transition occurring inside one physical press.

4. **Do not reduce the visual handle to a tiny 12px touch target.** The visual grip can remain 12px and the accessible control can remain 44px. Only the *pointer acquisition policy* becomes directional. This preserves accessibility while fixing the native-selection behavior. I would also move the effective start target slightly outward above the text and the end target slightly outward below the text so very short selections have even less spatial overlap, but do this as polish after the acquisition rule is correct.

5. **Harden `followPointer()` against Safari losing a terminal event.** Keep `pointermove` capture-local when capture succeeds, but always install lightweight document/window backup listeners for `pointerup` and `pointercancel`. Duplicate delivery is harmless because the session already rejects a pointer ID it no longer owns. Also listen for `lostpointercapture` on the captured element. If capture disappears while the session still owns that pointer, terminate/cancel the gesture rather than leaving it adjusting forever.

6. **Create one terminal path in `useStudentSelectionGesture.ts`.** Do not separately clean refs in `handleUp`, `handleCancel`, lost-capture handling, etc. Add something conceptually like `finishPointer(pointerId, reason)`. A normal release should flush the final scheduled geometry first, transition the machine to `selected`, release capture, stop auto-scroll, clear `pointerIsText`, `lastPointer`, `resolvedCaret`, and the handle capture target, then publish the resting state immediately. A cancel/lost-capture follows the cancel policy but performs the same presentation cleanup. The invariant should be: **after any terminal signal, `pointer === null` before the next painted frame.**

7. **Make loupe visibility depend on physical pointer ownership as well as phase.** Right now `SelectionOverlay` uses `selectionMovesEndpoint(selection.phase)` plus a non-null pointer. Preserve that contract, but ensure the hook only exposes a `pointer` while `session.pointerId() !== null`. Do not let stale `lastPointer.current` represent contact after release. Conceptually:

```ts
const ownsPointer = ensureSession().pointerId() !== null;

pointer:
  ownsPointer && lastPointer.current
    ? {
        finger: ...,
        caret: resolvedCaret.current,
        snapRevision: snapRevision.current,
      }
    : null;
```

Then `adjusting-*` accidentally remaining in presentation for one render still cannot keep a ghost loupe alive.

8. **Fix the coincident-endpoint behavior for handle adjustment.** `selectionSession.spanOf()` currently uses word expansion whenever `fixed` and `moving` coincide. That makes sense for the initial long-press word claim, but it is wrong for a handle being dragged onto the opposite endpoint and is particularly unstable with short selections. Word expansion must be limited to the initial claim path. During `adjusting-start/end`, if the candidate reaches exactly the fixed endpoint, keep the last non-collapsed span until the pointer crosses it; once it crosses, flip the moving edge as you already do. Do not suddenly expand back to a whole word.

9. **Add regression tests before changing production code.** The most important new E2E fixture is deliberately short text—e.g. `One`, `block`, or even `41`—whose two 44×44 endpoint controls overlap. Select it, touch the exact midpoint of the highlighted rect, move 40px left and right, and assert: endpoint transforms unchanged, phase remains `selected`, no loupe appears, and no new session begins. Then touch the visible end-handle hotspot, drag through that same midpoint, and assert that only the acquired endpoint moves. Finally release over the prose/document rather than over the original handle and assert the loupe is gone within one frame.

Also add a pointer-capture unit test where `hasPointerCapture()` returns true but the terminal `pointerup` is dispatched on `document`; it must still release exactly once. Add another for `lostpointercapture`: the session must leave the adjusting phase and `[data-selection-loupe]` must disappear. And add a session test proving that coincident endpoints during handle adjustment do **not** trigger `createWordRangeAt()`.

The implementation should preserve this invariant:

```text
44px accessibility target
        ≠
44px unconditional drag acquisition

visible endpoint affordance
        =
the only place a drag may BEGIN

after acquisition
        =
finger can travel anywhere
```

And for the stuck loupe:

```text
loupe visible
    ⇔
selection owns a live pointer
AND
that pointer is moving an endpoint
```

Not merely:

```text
machine once entered "adjusting"
```

I would address the interaction arbitration first, then the pointer-terminal hardening. The current snapping/caret/loupe-content work does not need to be rewritten; these fixes sit cleanly around it.
