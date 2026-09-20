You are **partly correct**, but there is an important distinction in the current repo.

Right now, SAT **already has a first-generation custom touch-selection implementation**. In `SatAnnotatedContent.tsx`, SAT calls:

```ts
useStudentTouchTextSelection({
  enabled:
    enabled &&
    view.annotationModeEnabled &&
    examScope.ownedTouchSelection,
  activation: 'drag',
  ...
})
```

and renders:

```tsx
<StudentTouchSelectionOverlay rects={touchSelection.rects} />
```

So the current behavior is:

| Situation                                | Current behavior                                    |
| ---------------------------------------- | --------------------------------------------------- |
| Mobile/iPad + **Highlights & Notes OFF** | ❌ Text intentionally cannot be selected             |
| Mobile/iPad + **Highlights & Notes ON**  | ✅ Existing custom Range-based selection should work |
| Desktop/fine pointer                     | ✅ Native browser selection                          |
| Authoring / preview                      | ✅ Native browser selection                          |
| Custom blue selection rectangles         | ✅ Already exists                                    |
| Custom draggable selection handles       | ❌ Not implemented                                   |
| Apple-style persistent selection         | ❌ Not implemented                                   |
| Loupe/magnifier                          | ❌ Not implemented                                   |
| Apple-style contextual selection menu    | ❌ Not implemented                                   |
| Drag handles after finger release        | ❌ Not implemented                                   |

The code even explicitly says that on coarse pointers, when annotation mode is OFF, SAT text being unselectable is intentional:

> `the mode being OFF means passage text cannot be selected at all`

because the CSS suppresses native selection to prevent the OS Copy / Look Up / Share UI.

### The current flow

Right now on iPad/mobile it is essentially:

```text
Highlights & Notes OFF
        ↓
user-select: none
        ↓
cannot select text
```

Then:

```text
Highlights & Notes ON
        ↓
useStudentTouchTextSelection()
        ↓
finger drag / hold
        ↓
DOM Range created
        ↓
StudentTouchSelectionOverlay
        ↓
temporary blue rectangles
        ↓
pointerup
        ↓
captureSatTextRange()
        ↓
custom SAT annotation toolbar
```

And importantly, the custom selection **disappears on pointerup** because `finish()` calls `reset()` before reporting the Range.

That is why it does **not feel like a real iOS selection system** even though there is technically already custom selection infrastructure.

### So your proposed “part 2” is still valid

What you're actually building is not:

> “SAT currently has no custom selection, add one.”

It is:

> **“Replace the existing minimal owned-touch Range capture with a complete persistent custom selection experience.”**

The target becomes:

```text
Long press / drag
       ↓
Custom Range
       ↓
custom blue selection stays visible
       ↓
 ●──────── selected text ────────●
 ↑                                ↑
start handle                  end handle

       ↓
Apple-like floating toolbar
[ Highlight ] [ Underline ] [ Note ]

       ↓
drag handle
       ↓
loupe appears
       ↓
Range changes live
       ↓
release
       ↓
toolbar returns
```

So I would slightly revise my previous implementation plan: **do not throw away the existing `touch-selection` engine immediately. Build v2 on top of its proven Range/caret primitives, then replace its gesture/presentation lifecycle.**

And one important diagnostic: **if you currently turn “Highlights & Notes” ON on an iPad/mobile and you still cannot visually select text at all, that is a current bug—not expected behavior.** The repository clearly intends the existing custom overlay to work in that state.
