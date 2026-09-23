You are implementing a native-iPhone-like touch text selection model in:

https://github.com/teaching01-netizen/IELTS-LMS

Work inside the existing `selection-v2` architecture. Do not rewrite the engine unless necessary. Preserve all recently implemented behavior:
- custom owned touch selection
- native OS selection suppression
- loupe / magnifier
- fingerPoint vs caretPoint separation
- caret snapping
- haptic/snap revision behavior
- strict handle acquisition
- selected-body no-drag behavior
- pointer cleanup / stuck-loupe fixes
- one physical pointerdown = one intent

Main bug to fix:

After long-pressing inside a word, the visible selection correctly expands to the whole word, but when the same finger moves immediately left/right, the internal selection still uses the original character caret as one endpoint.

This causes:
- the opposite side of the visible word to move unexpectedly
- direct finger movement to create partial-character / partial-word selections
- behavior that does not match iPhone text selection

Target behavior:

DIRECT TOUCH SELECTION:
- long press selects the whole lexical word under the finger
- continuing to move the SAME finger must remain WORD-GRANULAR
- moving inside the same original word must not change selection
- dragging into a previous word selects complete words from that word through the original word
- dragging into a later word selects complete words from the original word through that later word
- dragging across whitespace should not create partial words
- direct finger dragging must never produce arbitrary character-level endpoints

HANDLE ADJUSTMENT:
- dragging the visible start/end `|` handles is the precision mode
- handle dragging may select precise text
- precision should snap to grapheme boundaries, not raw UTF-16 code-unit offsets
- only the grabbed endpoint moves
- handle crossover keeps finger ownership and flips the visual moving edge correctly

Desired semantic model:

BODY TOUCH
    -> word granularity
    -> whole word / whole-word span

HANDLE DRAG
    -> grapheme granularity
    -> precise endpoint adjustment

Important example:

Text:
`alpha beta gamma`

Long press anywhere inside `beta`:
`alpha [beta] gamma`

Move finger slightly inside beta:
`alpha [beta] gamma`

Move left into alpha:
`[alpha beta] gamma`

Move right into gamma:
`alpha [beta gamma]`

Direct touch must NOT produce:
`alpha b[eta ga]mma`
or
`alp[ha b]eta`

Those partial ranges should only be achievable by dragging the start/end selection handles.

Implementation requirements:

1. Inspect these files first:
- `src/shared/ui/selection-v2/domain/selectionMachine.ts`
- `src/shared/ui/selection-v2/engine/selectionSession.ts`
- `src/shared/ui/selection-v2/domain/selectionSegmenter.ts`
- `src/shared/ui/selection-v2/engine/selectionRange.ts`
- `src/shared/ui/selection-v2/react/useStudentSelectionGesture.ts`
- `src/shared/ui/selection-v2/react/SelectionOverlay.tsx`
- `src/shared/ui/selection-v2/react/SelectionHandle.tsx`
- `src/shared/ui/selection-v2/engine/selectionGeometry.ts`
- relevant unit tests
- `e2e/student-owned-touch-selection.spec.ts`

2. Do not let the exact character caret from the original long press remain the hidden anchor after the visible selection has expanded to a whole word.

The session must own the actual word boundaries that the student sees.

3. Add an explicit distinction between:
- direct/body touch selection
- handle adjustment

Do not infer this from React components. The selection engine/session should own this semantic distinction.

4. During initial long-press claim:
- resolve the word with the existing `Intl.Segmenter`-based logic
- adopt the word's START and END as the actual owned span
- store the original claimed word boundaries for subsequent direct-finger extension

5. During direct-finger movement:
- resolve the current pointer to the word it belongs to
- if still inside original claimed word -> keep original word unchanged
- if before original word -> selection = currentWord.start -> originalWord.end
- if after original word -> selection = originalWord.start -> currentWord.end
- keep the range in reading order
- preserve RTL correctness

Do not extend using the raw caret offset for body-touch dragging.

6. Whitespace/punctuation:
Use the existing `expandToWordAt()` semantics unless a clearly better native-like rule is needed.
Do not allow a space between words to generate a partial-word endpoint.
Selection should remain stable until the pointer meaningfully enters another lexical word.

7. Handle adjustment:
Keep handle dragging independent from body word-selection behavior.
Do not word-expand handle movement.

For handle precision, use grapheme boundaries:
- reuse `defaultGraphemeSegmenter()` or an equivalent existing primitive
- never allow a handle endpoint to split:
  - emoji
  - combining marks
  - Thai grapheme clusters
  - accented characters
  - surrogate pairs

8. Short-word behavior:
Handle selections like:
`I`
`to`
`41`

The finger may cover the entire selected word.

Requirements:
- long press still selects the whole word
- touching the middle/body does not resize
- start/end handles remain the only precision affordances
- overlapping 44px handle targets must not let DOM stacking order choose the wrong endpoint

Review the current `SelectionOverlay.tsx` logic:
it currently finds a single hit DOM handle using:
`target.closest('[data-student-selection-handle]')`

For tiny selections, both 44x44 hit targets may overlap.
Implement geometric arbitration across BOTH handle endpoints.

Prefer a pure helper such as:

`resolveHandleAcquisition(selection, x, y): 'start' | 'end' | null`

Rules:
- independently evaluate start and end acquisition zones
- if only one accepts -> use it
- if both accept -> choose nearest optical endpoint
- if still tied -> deterministic directional/text-direction tiebreaker
- DOM z-order must never determine which endpoint is grabbed

9. Preserve all loupe behavior:
- loupe shell follows physical finger
- loupe content follows resolved caret
- direct word-drag caret/loupe should still be coherent with the word boundary the engine owns
- handle drag remains precise
- no stuck loupe regressions

10. Do not regress:
- selected body no-drag zone
- one-press-one-intent arbitration
- outside selection dismissal
- pointerup/pointercancel/lost capture cleanup
- auto-scroll
- RTL
- Thai
- reduced motion
- browser never receives a native `window.getSelection()` range

TDD REQUIREMENTS

Add failing tests before production changes.

Unit tests:

A. Initial middle-of-word claim
Given `alpha beta gamma`
press offset inside `beta`
hold
expect selection = `beta`

B. Finger moves inside same word
long press inside `beta`
move pointer to another caret inside `beta`
expect still exactly `beta`
expect no partial character range

C. Extend left by word
long press inside `beta`
move into `alpha`
expect `alpha beta`

D. Extend right by word
long press inside `beta`
move into `gamma`
expect `beta gamma`

E. Cross origin word
start in `beta`
move into `alpha`
then move into `gamma`
expect `beta gamma`
not an inverted/partial range

F. Handle precision remains
claim/select a word
grab start or end handle
move to a grapheme boundary inside a word
expect partial-word selection is possible through the HANDLE

G. Grapheme safety
test emoji / combining mark / Thai
handle endpoint must never stop inside one grapheme cluster

H. Short selection overlap
create a 1-2 character selection whose two 44px targets overlap
press body midpoint
expect:
- no handle acquired
- phase stays selected
- no loupe
- no endpoint moves

press start outward zone
expect start acquires

press end outward zone
expect end acquires

E2E tests:

1. Long press inside the middle of a word on a real touch fixture.
Assert whole word.

2. Keep finger down and move a few pixels while still over same word.
Assert exact selected text unchanged.

3. Move into neighboring word.
Assert full neighboring word is added, no partial characters.

4. Test both directions.

5. Test short word where finger covers both handles.
Middle touch must not resize.
Each outward handle zone must still be independently grabbable.

6. Handle drag still allows precise text selection.

7. Run on:
- Chromium mobile emulation
- WebKit path where supported

QUALITY RULES

- One source of truth for selected span.
- Do not store one visible span and another hidden caret span.
- Pure helpers for word-span derivation and handle arbitration.
- Do not put text-selection semantics in React presentation components.
- Do not duplicate word-boundary logic.
- Reuse existing `Intl.Segmenter` infrastructure.
- Preserve current dependency injection/test seams.
- Keep geometry reads inside scheduled frame paths where applicable.
- Avoid adding ad-hoc flags when the state machine/session can express the state explicitly.

When finished, report:

1. root cause
2. files changed
3. exact behavioral contract implemented
4. unit tests added
5. E2E tests added
6. any behavior intentionally different from native iOS
7. any remaining edge cases


Yes. I rechecked the latest `selection-v2` implementation in your repo, including the fixes from the previous task. This is a **different bug**, and the current code explains it.

The interaction model should be changed to:

> **Direct finger selection = word-granular.
> Selection-handle `|` dragging = precise/grapheme-granular.**

That distinction is the missing piece.

### What is wrong now

Suppose the text is:

```text
alpha beta gamma
       ↑
   long-press here
```

Your `selectionSession.ts` correctly expands the initial press to the whole word:

```text
alpha [beta] gamma
       ↑
```

But the state machine still internally owns the original caret *inside* `beta`.

Then, as soon as the finger moves, `selectionMachine.ts` does effectively:

```ts
fixed = originalFingerCaret;
moving = newFingerCaret;
```

So dragging left can produce something like:

```text
alp[ha b]eta
```

and dragging right can produce:

```text
alpha b[eta ga]mma
```

That is why you see the **other edge move immediately**, and why normal finger movement can produce partial characters.

The existing tests also hide the bug. `extends the selection as the finger travels` starts at offset `0`, exactly at a word boundary, and the RTL test starts at another convenient boundary. There is no test that starts **in the middle of a word**, which is the important real-phone case.

---

# Target iPhone-like selection contract

There should now be **two granularities**.

| Gesture                                      | Selection granularity                                     |                           |
| -------------------------------------------- | --------------------------------------------------------- | ------------------------- |
| Long-press / direct touch on prose           | Whole word                                                |                           |
| Continue moving same finger after long-press | Whole words                                               |                           |
| Move across several words / lines            | Complete word run                                         |                           |
| Move inside originally selected word         | Selection does not change                                 |                           |
| Release                                      | Resting whole-word selection                              |                           |
| Drag start `                                 | ` handle                                                  | Precise grapheme boundary |
| Drag end `                                   | ` handle                                                  | Precise grapheme boundary |
| Cross opposite handle                        | Grabbed handle remains owned by finger; edge flips        |                           |
| Touch selection body                         | Does not resize                                           |                           |
| Very short word                              | Whole word initially; handles remain separately reachable |                           |

So if the student long-presses the middle of `beta`:

```text
alpha [beta] gamma
```

moving the finger a little left/right **inside `beta`** must still show:

```text
alpha [beta] gamma
```

Dragging into `alpha`:

```text
[alpha beta] gamma
```

Dragging into `gamma`:

```text
alpha [beta gamma]
```

It must **never** become:

```text
alpha b[eta ga]mma
```

from direct finger movement.

If the student specifically wants:

```text
alpha b[eta ga]mma
```

then they must grab one of the endpoint handles:

```text
      |        |
alpha beta gamma
```

That is the precision mode.

---

# Important rule: the original word is the anchor

Do not anchor the selection to the exact character initially under the finger.

For a long-press on `beta`, record:

```text
originWord.start = before "b"
originWord.end   = after "a"
```

Then direct-finger movement behaves like:

```text
finger remains inside origin word
        ↓
[beta]

finger enters a word before origin
        ↓
[targetWord.start → originWord.end]

finger enters a word after origin
        ↓
[originWord.start → targetWord.end]
```

So the opposite side of the initially selected word **cannot move accidentally**.

This also makes crossing naturally correct. Start on `beta`, drag left to `alpha`, then move all the way right into `gamma`:

```text
[alpha beta]
      ↓ cross original word
alpha [beta gamma]
```

The origin remains `beta`; the active side changes around it.

---

# Small words need a special interaction policy

You're correct to worry about this.

Consider:

```text
[I]
| |
```

or:

```text
[41]
|  |
```

The student's finger is much wider than the selected word. You should **not solve that by allowing the selection body to drag**.

Instead:

```text
tiny word
   ↓
long press selects entire word

middle/body
   ↓
inert — does not resize

start handle outward region
   ↓
precise start adjustment

end handle outward region
   ↓
precise end adjustment

loupe
   ↓
shows exact character despite finger covering it
```

Your recently added `canAcquireSelectionHandle()` is the right direction, but there is another short-selection edge case in the current `SelectionOverlay.tsx`.

Right now you first ask which DOM handle was hit:

```ts
target.closest('[data-student-selection-handle]')
```

and then validate only that handle.

For tiny words, the 44×44 start and end targets can overlap. DOM stacking can therefore make the `end` button receive a coordinate that actually belongs to the `start` handle's valid outward zone. If `end` rejects it, the event is consumed without ever trying `start`.

Replace that with **geometric arbitration of both handles**.

Conceptually:

```ts
resolveHandleAcquisition(
  selection,
  clientX,
  clientY
): 'start' | 'end' | null
```

It should check both handles independently.

If only one accepts → use it.

If both accept → choose the endpoint whose optical anchor is closest to the finger. If still tied, use the pointer's side relative to the selection midpoint / text direction as a deterministic tiebreaker.

The DOM stacking order must never decide which endpoint the student grabs.

---

# Implementation plan

1. **Introduce an explicit granularity/gesture policy.** I would use something like `SelectionGranularity = 'word' | 'grapheme'`, or equivalent internal semantics. Direct prose selection always uses `word`; handle adjustment always uses `grapheme`. Do not make components decide this—the engine/session owns it.

2. **Store the original claimed word boundaries.** In `selectionSession.ts`, when a body gesture is claimed, derive and preserve `{ claimStart, claimEnd }`. Do not leave the state machine anchored to the exact press character after `spanOf()` expanded the visible selection to a word. This is the root cause of the current opposite-edge jump.

3. **Add a pure direct-touch word-span resolver.** Something like:

```ts
resolveWordDragSpan(
  originWord,
  pointerPoint,
  segmenter,
  cache
)
```

Its output should be `{ fixed, moving }`, not arbitrary raw caret endpoints. When the target remains within the origin word, return the unchanged origin word. Before it, fix `originWord.end` and move to `targetWord.start`. After it, fix `originWord.start` and move to `targetWord.end`.

4. **Keep whitespace stable.** Your existing `expandToWordAt()` already has useful behavior: whitespace and punctuation after a word resolve to the preceding lexical word. Preserve that. This prevents the selection from flickering to the next word merely because the finger is travelling through the gap between words. The next word should join once the finger actually reaches it.

5. **Do not use word granularity for handle adjustment.** `adjusting-start` and `adjusting-end` continue to move only the endpoint the student grabbed. This is where precise selection belongs. However, precise should mean **grapheme boundary**, not arbitrary UTF-16 offset. You already have `defaultGraphemeSegmenter()` in `selectionSegmenter.ts`; use it so a handle cannot cut an emoji, Thai combining sequence, accented character, etc. in half.

6. **Resolve overlapping small-word handles geometrically.** Replace the current single `target.closest(...) → test that edge` logic with `resolveHandleAcquisition()` over both endpoint geometries. Keep the existing 44px accessible controls and tiny visual dots, but DOM z-order must not choose the endpoint. A selection body press remains a no-drag zone.

7. **Preserve the loupe model you've already implemented.** Direct touch while extending whole words can keep the loupe above the finger, but the selected range changes only at lexical boundaries. Handle adjustment uses the loupe for precise grapheme/caret movement. Do not regress the existing `fingerPoint ≠ caretPoint` behavior.

8. **Change the tests before production behavior.** The crucial regression case should start inside a word, e.g. press offset `7` in `beta`. After hold expect `beta`; move to another position inside `beta` and still expect exactly `beta`; move left into `alpha` and expect `alpha beta`; move right into `gamma` and expect `beta gamma`. Explicitly assert neither direct drag ever produces `ha b`, `eta ga`, or any other partial edge. Then retain existing handle tests such as partial `beta ga`, because **partial text should still be possible through a handle**. Add the same cases for one-character/two-character words, overlapping handle targets, Thai, RTL, emoji/combining marks, wrapped lines, and handle crossover.

The central invariant should become:

```text
BODY TOUCH
    ↓
WORD SELECTION
    ↓
word → whole-word run → whole-word run

HANDLE |
    ↓
PRECISION SELECTION
    ↓
grapheme → grapheme → grapheme
```

And specifically:

```text
long-press inside a word
        ↓
the exact character under the initial finger
MUST NEVER become an endpoint
```

The endpoint is the **word boundary**.

This is the part I would fix next in `selectionSession.ts` / `selectionMachine.ts`. Your previous handle-acquisition, pointer cleanup, snapped caret, and loupe work can remain; this is mostly a correction to **selection semantics**, plus one additional short-word arbitration fix in `SelectionOverlay.tsx`.
