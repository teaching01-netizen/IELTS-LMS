Yes. The new photos confirm that **the native iPad/Safari selection is still leaking through**.

I rechecked the latest `main`. A lot of the previous plan **was implemented correctly**: pointer type now drives touch ownership, `selectstart`/`selectionchange` guards exist, the native `pointerup` path is skipped for owned touch, and close → keep selection → tap selection → reopen toolbar is now implemented. The remaining failure is earlier in the gesture lifecycle.

The key bug is here in `useStudentSelectionGesture.ts`:

```ts
const onDocumentPointerDown = (...) => {
  ...
  satTouchOwnership.current = true;
  root.dataset['studentSelectionOwner'] = 'app';
}
```

and CSS only disables native selection after that attribute exists:

```css
[data-student-selection-owner="app"] {
  -webkit-user-select: none;
  user-select: none;
}
```

So immediately before the finger lands, the SAT text is still:

```css
-webkit-user-select: text;
user-select: text;
```

The lifecycle is effectively:

```text
Safari sees selectable text
        ↓
finger begins on selectable text
        ↓
WebKit starts its native-selection gesture eligibility
        ↓
JS pointerdown runs
        ↓
data-student-selection-owner="app"
        ↓
user-select becomes none

TOO LATE
```

That explains exactly what your photo shows: **your custom blue selection/handles can coexist with Apple's native Copy / Look Up / Translate / Share UI.** The `selectionchange → removeAllRanges()` defense is also too late to guarantee that iPadOS never raises its native menu; it removes the Range after WebKit has already entered its native selection machinery.

The current E2E unfortunately gives false confidence. It checks `window.getSelection()` after the gesture and uses browser/synthetic touch events, but it cannot prove that the real iPadOS selection UI was never invoked.

### The fix I would make now

Do not wait until `pointerdown` to decide who owns selection.

You already have a marker that is installed **before the finger lands**:

```text
data-student-owned-touch-selection="true"
```

`useStudentSelectionGesture.ts` adds that in `useLayoutEffect()` while SAT Highlights & Notes is armed. Currently CSS uses it only for:

```css
touch-action: none;
```

That is where native selection suppression needs to move too.

Conceptually:

```css
html.student-exam-active
[data-sat-selection-protected="true"]
[data-student-owned-touch-selection="true"] {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  touch-action: none;
}
```

With the actual selector matching the fact that both data attributes currently live on the same root.

Then the state before the first finger lands becomes:

```text
Highlights & Notes OFF
→ native/default text rules

Highlights & Notes ON
→ protected SAT root pre-owned by Selection v2
→ user-select:none already computed
→ touch-action:none already computed

finger down
→ Safari never gets a native Range
→ custom Selection v2 only
```

There is one important consequence: once you pre-disable native selection, you must **not leave mouse/trackpad selection depending on the browser on that same armed surface**. Otherwise an iPad with a trackpad would have `user-select:none` but the custom engine would refuse `pointerType:"mouse"`.

For the exam I would use the cleaner architecture:

```text
Annotation mode OFF
→ browser owns normal text interaction

Annotation mode ON
→ Selection v2 owns selection on protected SAT text

pointerType decides PRESENTATION:
touch → handles + loupe + touch ergonomics
mouse/trackpad → custom drag selection, no loupe, fine-pointer ergonomics
pen → custom selection with appropriate presentation

pointerType does NOT decide Range ownership
```

That eliminates the ownership race entirely.

I would **not** attempt another patch based on dynamically changing `user-select` at `pointerdown`, adding another `selectionchange` cleanup, or adding more `contextmenu` prevention. Your physical iPad test has now demonstrated that this strategy is insufficient.

### What the next regression test must prove

The critical regression is no longer merely:

```ts
window.getSelection()?.toString() === ""
```

It should first prove the state **before touch begins**:

```text
Highlights & Notes armed
SAT protected root mounted

BEFORE pointerdown:
data-student-owned-touch-selection = true
computed -webkit-user-select = none
computed user-select = none
computed touch-action = none
```

Then exercise:

```text
hold 0.5 s
hold 2 s
hold 5 s
slow drag
stationary long press
long press selected text
drag toward pane divider
drag toward question pane
close toolbar → long press same selection
```

At every point:

```text
custom Range exists when expected
custom range stays inside one [data-content-text-node]
window.getSelection() remains empty/collapsed
```

And the final acceptance test must still be a **physical iPad Safari test**, because Playwright WebKit does not reproduce the iPadOS Copy/Translate/Share UI faithfully.

So yes: **the implementation improved the system, but the root native-selection bug is not closed yet.** The remaining defect is specifically that **selection ownership is being declared at `pointerdown`; on iOS it needs to be declared before the gesture begins.**

Yes. Treat this as a **selection-platform architecture fix**, not another Safari workaround. The goal is to make the impossible state structurally impossible:

```text
CUSTOM SAT SELECTION EXISTS
        +
NATIVE iOS SELECTION EXISTS

             ❌

There must never be two selection owners.
```

The implementation should guarantee that **before the first touch reaches the text**, Safari has already been told it does not own text selection.

## Target architecture

Use this ownership model:

```text
SAT real exam
│
├─ Highlights & Notes OFF
│    └─ no custom annotation selection interaction
│
└─ Highlights & Notes ON
     │
     └─ protected SAT text becomes APP-OWNED
          │
          ├─ -webkit-user-select: none
          ├─ user-select: none
          ├─ -webkit-touch-callout: none
          └─ Selection v2 owns all selection
               │
               ├─ touch → custom range + handles + loupe
               ├─ mouse/trackpad → custom range + fine-pointer UX
               └─ pen → custom range + pen/fine-pointer UX
```

The critical change is:

> **Pointer type controls interaction presentation. It does not control selection ownership once annotation mode is armed.**

That removes the iPad trackpad/coarse-pointer ambiguity entirely.

# Rigorous implementation plan

1. **Define hard invariants before touching implementation.** Write these directly into the Selection-v2 architecture docs and tests. When annotation mode is armed on a real SAT exam, protected text must have `user-select:none` before `pointerdown`; `window.getSelection()` must never contain a non-collapsed Range intersecting protected SAT content; exactly one `SelectionSession` owns the temporary Range; a selection can never escape its originating `[data-content-text-node]`; closing contextual controls must not destroy that Range; touching the resting selected body may reopen controls but never resize the Range; only a successfully acquired endpoint may resize it; leaving the question/module/mode must synchronously destroy both the Range and its associated presentation. These are not expected behaviors—they are invariants that tests should make difficult to violate accidentally.

2. **Move ownership from `pointerdown` to annotation-mode activation.** The current race exists because the app waits for a physical touch before applying the ownership marker. Remove that responsibility from `onDocumentPointerDown`. When `useStudentSelectionGesture` is enabled for the armed SAT annotation surface, install a stable marker during layout/commit, before input is possible, such as:

```text
data-student-selection-owner="app"
data-student-owned-selection="true"
```

The lifecycle becomes:

```text
user turns Highlights & Notes ON
        ↓
React commit
        ↓
layout effect
        ↓
root becomes app-owned
        ↓
CSS already suppresses Safari selection
        ↓
only now can a later finger land
```

Do not toggle this marker on/off for each finger. Ownership should last for the entire armed-selection lifetime.

3. **Make CSS the first-line guarantee, not JavaScript cleanup.** On the narrowest real-exam protected selector, apply the complete ownership package while Selection-v2 is armed:

```css
html.student-exam-active
[data-sat-selection-protected="true"][data-student-selection-owner="app"],
html.student-exam-active
[data-sat-selection-protected="true"][data-student-selection-owner="app"] * {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
```

For surfaces where a drag is app-owned, also establish the appropriate `touch-action` before contact. Keep this scoped to actual selection roots—not `html *`, not the whole SAT shell, and definitely not form fields. Inputs, textareas, contenteditable areas, calculators, note editors, and unrelated browser UI must preserve their expected behavior. Also remove competing later CSS rules that can restore `user-select:text` through equal/higher specificity. Add a CSS contract test that evaluates the cascade order, not merely whether the desired selector text exists.

4. **Make Selection-v2 own mouse/trackpad selection while armed too.** Once the protected root is permanently `user-select:none` while the tool is armed, the browser cannot provide native mouse selection there. Therefore make custom Selection-v2 support pointer families deliberately:

```text
touch
→ app Range
→ touch handles
→ loupe while dragging
→ coarse hit acquisition

mouse / trackpad
→ app Range
→ familiar drag-to-select
→ no touch loupe
→ no giant handles
→ fine-pointer toolbar

pen
→ app Range
→ precise pointer behavior
→ no assumption that pen == finger
```

Do not switch the protected root back to `user-select:text` when a mouse appears. That would recreate the same ownership race through a different input modality. The ownership decision should be based on “annotation mode is armed,” while pointer type controls only ergonomics.

5. **Centralize ownership in a small explicit domain object instead of scattered flags.** Introduce a single selection environment/state concept, for example:

```ts
type SelectionOwnership =
  | { kind: 'browser' }
  | { kind: 'app'; input: 'touch' | 'mouse' | 'pen' | 'keyboard' };
```

Or equivalent without storing transient input unnecessarily. From this one source derive whether the root gets the ownership attribute, whether native-selection defense is enabled, which presentation is rendered, whether the loupe is permitted, which hit-target budget is used, and which gesture activation strategy applies. Do not independently derive those answers from `matchMedia`, `navigator.maxTouchPoints`, CSS classes, and pointer events.

6. **Keep `selectionchange` and `selectstart` only as circuit breakers.** They remain worthwhile defense-in-depth, but rewrite their conceptual role:

```text
CSS / ownership architecture
= prevention

selectstart prevention
= secondary browser guard

selectionchange + removeAllRanges()
= invariant violation recovery
```

If `selectionchange` ever sees a native non-collapsed selection intersecting an app-owned SAT root, clear it immediately **and record an invariant violation**. In development/test builds, consider a loud diagnostic such as:

```text
NATIVE_SELECTION_LEAK
```

including root identity, input type, ownership state, selection anchor/focus location, computed `user-select`, computed `-webkit-user-select`, `touch-action`, and interaction phase. Production can log it through existing diagnostics without breaking the exam. A native selection appearing should be treated like detecting corrupted internal state, not normal flow.

7. **Make the Selection Session the sole Range owner.** SAT must never hold a second DOM `Range`; SAT holds only a serializable `SatTextAnchor` when it needs contextual actions. The data flow stays one-way:

```text
SelectionSession.range()
        ↓
geometry
        ↓
blue paint + handles

SelectionSession.range()
        ↓
captureSatTextRange()
        ↓
SatTextAnchor
        ↓
SAT contextual actions
```

No component should reconstruct a DOM Range from `SatTextAnchor` merely to restore the temporary selection. No toolbar should own offsets separately. No React component should mutate `window.getSelection()` to represent the custom selection.

8. **Strengthen block containment at the engine level, not only capture time.** The current SAT anchor validation should remain, but by then it should be impossible for the visual selection itself to have escaped. When a gesture begins, freeze the originating semantic boundary:

```text
press
↓
resolve TextPoint
↓
boundaryFor(start)
↓
SESSION OWNS THIS BOUNDARY FOR ITS LIFETIME
```

Every subsequent caret resolution must either resolve inside that boundary or clamp to its nearest valid edge. Never accept a TextPoint from the question pane, timer, toolbar, neighboring paragraph, or document body and then hope `captureSatTextRange()` rejects it afterward. The user should visually see a valid bounded selection at all times.

9. **Formalize the resting-selection state machine.** Make the interaction grammar explicit:

```text
IDLE
 ↓ begin
SELECTING
 ↓ release
SELECTED + TOOLS_VISIBLE

X
 ↓
SELECTED + TOOLS_HIDDEN

tap selected body
 ↓
SELECTED + TOOLS_VISIBLE

grab valid endpoint
 ↓
ADJUSTING + TOOLS_HIDDEN + LOUPE_TOUCH_ONLY
 ↓ release
SELECTED + TOOLS_VISIBLE

tap outside
 ↓
IDLE
```

The selected body is a no-drag/no-new-selection zone. A pointerdown inside it can reactivate tools but may not dismiss and restart selection. A pointerdown outside may dismiss the old selection, but the same physical event must never also begin another selection. Preserve the “one pointerdown = one intent” invariant.

10. **Harden teardown like transaction cleanup.** Every path that makes the Range invalid must converge through one function, not scattered cleanup:

```ts
endSelection(reason)
```

Reasons can include mode-off, question-change, module-change, blocked state, terminal state, explicit outside dismissal, Escape clear, unmount, root replacement, invalid boundary, and application lifecycle cancellation. That single path should release pointer capture, cancel RAF, stop autoscroll, remove loupe state, clear pointer refs, clear session Range, clear SAT contextual anchor, remove app-ownership attributes if the tool itself is no longer armed, and emit one diagnostic transition. It must be idempotent: running it twice should have no side effects.

11. **Make real-browser tests adversarial instead of gesture demos.** Build a dedicated “native-selection must never exist” test helper that samples continuously—not only after `pointerup`. During an app-owned gesture, record every `selectionchange`. Fail if any sample ever contains a non-collapsed native Range intersecting protected SAT text, even if your kill-switch removes it one millisecond later. Run the matrix against passage text, prompt text, answer-choice wording, existing highlights, a two-character selection, multiline selection, text near pane edges, zoom levels, scrolling content, and a resting custom selection. Exercise stationary holds of roughly 350 ms, 1 s, 3 s, and 5 s; tiny movements; rapid movements; pointer cancellation; lost capture; repeated select → dismiss toolbar → reactivate loops; handle crossover; question change mid-selection; disabling annotation mode mid-drag; opening Notes while a selection exists; and browser visibility changes. Tests should prove both the custom positive state and native negative state simultaneously.

12. **Add a physical-device release gate that automation cannot waive.** For this bug family, Playwright passing is necessary but not sufficient. Before declaring the issue closed, test on at least a physical iPad Safari configuration matching the reported environment. Run 20–30 repetitions of long press, select, resize, toolbar close/reopen, aggressive edge dragging, scrolling with a resting selection, and switching between finger and trackpad if available. There must be **zero** occurrences of Apple's Copy / Look Up / Translate / Share surface, zero native handles, zero page-wide blue browser selection, zero stuck loupe, zero selection jumping into the question pane, and zero toolbar that cannot be reopened.

## Test pyramid

| Layer               | What it must prove                                           |
| ------------------- | ------------------------------------------------------------ |
| Pure domain         | Ownership and phase transitions are deterministic            |
| SelectionSession    | One Range, one boundary, valid endpoint crossing             |
| React hook          | Ownership attributes exist before interaction                |
| CSS contract        | Armed real SAT root computes `user-select:none`              |
| Overlay unit        | Body tap reactivates; only handle can resize                 |
| SAT reducer         | Toolbar visibility and actual Range lifetime remain separate |
| Browser integration | Native Selection never appears during owned gestures         |
| Playwright WebKit   | Full gesture lifecycle under realistic layout                |
| Physical iPad       | Native OS menu/handles never appear                          |

A particularly important CSS/browser test should literally inspect the root **without sending any pointer event**:

```text
arm Highlights & Notes
wait one rendered frame

assert:
  owner marker = app
  webkit-user-select = none
  user-select = none

THEN send pointerdown
```

If those assertions require pointerdown first, the architecture is still wrong.

## Add a native-selection leak tripwire

I would add a development/E2E invariant monitor around Selection-v2:

```text
App-owned root
+
native non-collapsed Selection intersects root

        ↓

NATIVE_SELECTION_LEAK
```

Capture enough context to reproduce the device issue:

```text
question/module identity
region
selection phase
pointer type
owner state
computed user-select
computed -webkit-user-select
touch-action
native anchor node
native focus node
native range text length
custom range text length
visualViewport dimensions
zoom
document visibility state
```

No student text should be sent to telemetry; lengths/identifiers/state are enough.

That gives you a smoke detector for this entire class of regression.

## Avoid these fixes

Do **not** solve this by repeatedly calling `removeAllRanges()` on timers, blocking every `contextmenu` globally, applying `user-select:none` only during active finger contact, detecting “iPad” from the user agent, using `(pointer: coarse)` as selection ownership, disabling long press across the whole exam, or layering another independent SAT-specific touch-selection implementation over Selection-v2.

Those approaches can make today's screenshot disappear while leaving the architectural race intact.

## Definition of done

The fix is finished only when this equation is true:

```text
annotationModeEnabled
&& realStudentExam
&& protectedSelectionRoot
        ↓
app owns text selection BEFORE input
```

and throughout every gesture:

```text
SelectionSession.range()     valid
window.getSelection()        empty/collapsed
native iOS menu              impossible
custom handles               coherent
selection boundary           never escapes root/block
```

Then:

```text
Close X
→ Range stays

Tap selected text
→ toolbar returns

Grab endpoint
→ only that endpoint moves

Tap outside
→ Range ends

Turn tool off
→ ownership ends cleanly
```

That is the level I would use for a **production exam interaction primitive**: prevention at CSS/ownership level, one domain owner, explicit state transitions, defense-in-depth tripwires, adversarial browser tests, and physical-device certification.
