Yes. Based on the current `main` implementation, I would fix this as **one ownership cleanup**, not as two independent patches.

The core rule should become:

> **In a real SAT student exam on a coarse-pointer device, every selectable SAT text surface is either owned by Selection v2 or not selectable at all. The browser must never create a native text selection.**

That includes **stimulus, question prompt, and answer-choice text**. The radio button, choice marker, elimination button, note editor, calculator, etc. remain normal controls.

## Target behavior

| Interaction                            | Expected                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------- |
| Select passage text on iPad            | Custom blue selection + handles + loupe                                     |
| Select prompt text                     | Same                                                                        |
| Select answer-choice wording           | Same                                                                        |
| Native iOS Copy/Look Up/Translate menu | Never appears in real exam                                                  |
| Custom toolbar position                | ~12px from selected line when space permits                                 |
| Tap answer normally                    | Answers question                                                            |
| Drag-select answer wording             | Does **not** answer question                                                |
| Drag selection across controls         | Controls excluded                                                           |
| Highlight choice wording               | Persists against that exact choice                                          |
| Reorder/render choices                 | Annotation stays attached to stable `option.id`, never A/B index            |
| Desktop mouse                          | Existing browser-selection path continues working                           |
| Preview/authoring                      | Keep normal platform behavior unless explicitly using owned-selection scope |

# Implementation plan

1. **Write the regressions first and make them fail.** In `src/shared/ui/selection-v2/__tests__/selectionPlacement.test.ts`, replace the current assumption that `touch === native menu exists`. Add two independent environment facts: coarse-pointer ergonomics and whether native selection UI actually exists. The important failing case should be: coarse pointer + `nativeSelectionUi: false` places a 108px toolbar at `selection.bottom + gap`, not `selection.bottom + nativeUiZone + gap`. Keep another test for `nativeSelectionUi: true` so the placement engine remains capable of supporting a browser-owned selection surface. In `src/features/student-delivery/ui/annotations/__tests__/satAnnotationSurfacePlacement.test.tsx`, replace tests named around “the lane the native menu leaves free” with the real SAT contract: an **owned iPad selection reserves no native-menu lane**.

   Also add a regression around `SatSingleChoiceAnswer`: a selection gesture starting **inside choice wording** must produce custom selection and must not activate the radio. The existing `SatSingleChoiceAnswer.guard.test.tsx` only tests a gesture that has already ended; it does not prove the choice text itself participates in Selection v2.

2. **Untangle “touch device” from “native selection menu exists.”** This is the main popover fix. `selectionPlacement.ts` currently overloads `touch` with two meanings: larger finger-friendly spacing and presence of iOS native selection UI. Replace that with an explicit environment, conceptually:

```ts
interface SelectionMenuEnvironment {
  coarsePointer: boolean;
  nativeSelectionUi: boolean;
}
```

Keep `coarsePointer` responsible for `comfort` versus `comfortFine`. Only `nativeSelectionUi` may create `nativeLane` or apply `nativeUiZone`.

The resulting logic should effectively be:

```ts
const budgets = resolveSelectionMenuBudgets(
  environment.coarsePointer,
  input.budgets,
);

const nativeLane =
  environment.nativeSelectionUi
    ? resolveNativeLane(...)
    : null;
```

Do **not** fix this by setting `touch={false}`. That would accidentally remove the larger touch comfort budget and would hide the architectural issue instead of fixing it.

Update `useSatAnnotationPlacement.ts`, `useSatAnnotationSurface.ts`, `SatSelectionActionsPanel.tsx`, and `SatAnnotationEditControls.tsx` to carry this environment explicitly. In `SatExamShell.tsx`, rename the existing:

```ts
const touchAnnotations = useSatMediaQuery('(pointer: coarse)');
```

to something like:

```ts
const coarsePointer = useSatMediaQuery('(pointer: coarse)');
```

and combine it with `useStudentExamInteractionScope()`:

```ts
const selectionEnvironment = {
  coarsePointer,
  nativeSelectionUi:
    coarsePointer && !examScope.ownedTouchSelection,
};
```

For a real iPad exam this becomes:

```text
coarsePointer      = true
ownedTouchSelection = true
nativeSelectionUi   = false
```

Therefore the toolbar gets touch-friendly spacing without the bogus `80px + 12px` reservation.

3. **Replace the `.sat-exam-prose` structural assumption with an explicit selection-protection surface.** `src/index.css` currently assumes all protected SAT text lives inside `.sat-exam-prose`. Choices do not, which is why iOS owns them. Add a semantic marker to the actual text-selection root in `SatAnnotatedContent.tsx`, for example:

```tsx
data-sat-selection-protected="true"
```

This marker should exist even when annotation mode is off. It means “the browser may not own text selection here during a locked student exam,” not “annotation is currently armed.”

Move the SAT protection rules toward:

```css
.student-exam-active [data-sat-selection-protected="true"],
.student-exam-active [data-sat-selection-protected="true"] * {
  -webkit-touch-callout: none;
}

@media (pointer: coarse) {
  html.student-exam-active [data-sat-selection-protected="true"],
  html.student-exam-active [data-sat-selection-protected="true"] * {
    -webkit-user-select: none;
    user-select: none;
  }
}
```

`touch-action: none` should remain **dynamic**, only on the root currently armed by `useStudentSelectionGesture` through `data-student-owned-touch-selection="true"`. Do not put `touch-action:none` permanently on every answer row because normal scrolling/tapping must continue when annotation is not armed.

Once stimulus, prompt, and choices are all routed through this explicit marker, remove or narrow the stale `.sat-exam-prose` ownership comments/rules so there is one authority rather than two overlapping definitions.

4. **Give answer choices stable annotation-region identities.** `SatAnnotatedContent` currently accepts only:

```ts
'stimulus' | 'prompt'
```

Extend the SAT annotation-region model, but do **not** use display letters (`A`, `B`, `C`, `D`) or the array index. Use the stable `option.id`.

Because `SatTextAnchor.nodeId` already uses the first `:` to separate region from structured-content node ID, keep the choice region itself colon-free. Add one canonical helper, for example in `satTextSelection.ts` or a small region module:

```ts
export type SatAnnotationRegion =
  | 'stimulus'
  | 'prompt'
  | `choice.${string}`;

export function satChoiceAnnotationRegion(
  optionId: string,
): SatAnnotationRegion {
  return `choice.${encodeURIComponent(optionId)}`;
}
```

An anchor then looks conceptually like:

```text
choice.option-uuid:p1
```

instead of:

```text
choice:option-uuid:p1
```

The second version would break the current `regionAndNode()` first-colon parser.

Add tests proving two options with identical wording and identical internal node IDs still resolve to different anchors.

5. **Render only the choice prose through the existing `SatAnnotatedContent`; do not create another selection implementation.** Keep `SatSingleChoiceAnswer` responsible for radio-answer interaction. Give it an optional rendering seam such as:

```ts
renderOptionContent?: (
  option: ChoiceOption
) => ReactNode;
```

Then in `SatQuestionRenderer.tsx`:

```tsx
<SatSingleChoiceAnswer
  ...
  renderOptionContent={(option) =>
    renderContent(
      option.content,
      satChoiceAnnotationRegion(option.id),
    )
  }
/>
```

and inside the answer row:

```tsx
<div id={optionContentId} ...>
  {props.renderOptionContent
    ? props.renderOptionContent(option)
    : <StructuredContentRenderer content={option.content} />}
</div>
```

This is important architecturally: **reuse `SatAnnotatedContent` → `useStudentSelectionGesture` → `SelectionOverlay` → `captureSatTextRange`**. Do not implement a second “choice selection” hook.

The custom-selection root should cover only the option's wording. It must not include the radio input, letter marker, or elimination button.

6. **Close the answer-activation race for app-owned selections.** This becomes critical once Selection v2 runs inside a `<label>`. The existing browser-selection path calls:

```ts
markSatSelectionGestureEnded()
```

when it sees a noncollapsed `window.getSelection()`.

But an owned Selection-v2 gesture intentionally never creates `window.getSelection()`. Therefore the owned path must explicitly mark completion.

At the beginning of `reportOwnedRange()` in `SatAnnotatedContent.tsx`, mark the gesture before processing the anchor:

```ts
const reportOwnedRange = useCallback((range: Range) => {
  markSatSelectionGestureEnded();

  ...
});
```

Do this before `captureSatTextRange()`/annotation-limit handling. A valid text-selection gesture must suppress the label's synthetic click even if the annotation later cannot be stored.

Keep the existing radio guard:

```ts
onChange={() => {
  if (isSatSelectionGestureEcho()) return;
  props.onChange(option.id);
}}
```

Then test all three cases separately:

```text
tap choice → answer
drag choice text → custom selection, no answer
wait > guard window + tap → answer
```

7. **Make selection and annotation behavior identical across prompt/passage/choices.** `SatAnnotatedContent` should remain the owner of annotation painting and anchor capture. `satAnnotationBlockFor()` and `satAnnotationRangeFor()` should resolve a choice anchor exactly the same way they resolve `prompt` and `stimulus`.

Add domain tests covering:

```text
choice A highlight → only choice A paints
choice B same text → unaffected
navigate away/back → choice A highlight survives
add note to choice text → note resolves back to choice A
remove/recolor → same existing mutation path
```

There should be no special `kind: 'choice-highlight'`. Choice highlights are ordinary `SatTextAnnotation`s with a different region.

8. **Update placement tests so they protect the new architecture rather than the old bug.** The current tests intentionally enforce native-menu avoidance on mobile. Change the test vocabulary from:

```text
touch ⇒ native menu
```

to:

```text
coarse pointer ⇒ larger comfort
nativeSelectionUi ⇒ reserve native lane
```

For a normal owned SAT iPad selection, assert approximately:

```ts
surface.top === selectionBottom + gap
```

when below is selected, with tolerance for the measured border/scale.

Specifically remove expectations equivalent to:

```text
our toolbar must stay out of the native menu's lane
```

from the **owned-selection SAT case**. Keep this behavior tested only for an explicit `nativeSelectionUi: true` input.

9. **Extend the real-browser touch suite, not only jsdom.** Add choice scenarios to `e2e/student-owned-touch-selection.spec.ts`. The iPad WebKit project already exists in `playwright.touch-selection.config.ts`; use it.

The strongest DOM invariant after selecting choice wording is:

```js
window.getSelection()?.rangeCount === 0 ||
window.getSelection()?.isCollapsed === true
```

while simultaneously:

```text
[data-student-selection-line] > 0
[data-student-selection-handle] === 2
[data-sat-selection-toolbar="true"] is visible
```

That proves the visual selection belongs to the app and the browser never owns a live Range.

Also assert the chosen radio remains unchecked until a subsequent deliberate tap.

10. **Finish with a physical-iPad acceptance pass.** Playwright's WebKit/iPad profile is essential, but it does not render every real iPadOS selection/callout surface exactly as Safari does. The final gate should therefore include one real Safari/iPad run.

Use these scenarios:

| Scenario                    | Acceptance                                |
| --------------------------- | ----------------------------------------- |
| Prompt long-press/drag      | No OS menu, custom selection appears      |
| Passage long-press/drag     | Same                                      |
| Choice text long-press/drag | Same                                      |
| Resting custom selection    | 2 handles, toolbar near selected text     |
| Toolbar distance            | Normal gap, not ~92px artificial gap      |
| Drag a handle               | Loupe appears, toolbar does not interfere |
| Tap choice                  | Radio changes normally                    |
| Drag choice text            | Radio unchanged                           |
| Eliminate choice            | Eliminate control still works             |
| Highlight choice            | Highlight persists                        |
| Add note                    | Note belongs to same choice span          |
| Turn Highlights off         | No native selection comes back            |
| Scroll with mode off        | Page/pane still scrolls normally          |
| Desktop Chrome/Safari       | Existing mouse behavior remains intact    |

### Test commands

Run the focused tests first:

```bash
bunx vitest run \
  src/shared/ui/selection-v2/__tests__/selectionPlacement.test.ts \
  src/features/student-delivery/ui/annotations/__tests__/satAnnotationSurfacePlacement.test.tsx \
  src/features/student-delivery/ui/question/SatSingleChoiceAnswer.guard.test.tsx \
  src/features/student-delivery/ui/question/SatSingleChoiceAnswer.test.tsx \
  src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx \
  src/features/student-delivery/ui/question/SatQuestionRenderer.test.tsx
```

Then the real-browser suites:

```bash
bunx playwright test -c playwright.touch-selection.config.ts
bunx playwright test -c playwright.sat-annotations.config.ts
```

I would also run the normal SAT student accessibility/security suites afterward because this change touches labels, pointer behavior, and selection protection.

## Definition of done

The implementation is finished when there is one consistent chain:

```text
SAT selectable text
        ↓
SatAnnotatedContent
        ↓
explicit selection-protected root
        ↓
coarse real exam
→ native selection prohibited
        ↓
useStudentSelectionGesture
        ↓
app-owned Range
        ↓
SelectionOverlay
        ↓
SatTextAnchor
        ↓
SAT toolbar
```

and the placement environment independently knows:

```text
coarse pointer?       → ergonomic spacing
native selection UI? → reserve OS lane
```

For a real iPad student exam the second answer must be **no**.

### Avoid these shortcuts

Do not globally apply `user-select:none` to the whole question pane, do not add more `contextmenu`/`touchstart` suppression, do not hard-code a negative toolbar offset, do not change `nativeUiZone` from `80` to `0`, do not simply pass `touch={false}`, and do not build a second selection implementation for choices. Those would conceal the two ownership problems instead of making Selection v2 the single source of truth.
