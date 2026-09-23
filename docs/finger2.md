Use the full stack, including the scoped `touchstart` guard now. The failure is already reproduced on real iPad, so there is little value in hiding that guard behind a flag.

## Concise implementation plan

1. **Sterilize the entire Selection-v2 presentation layer.** In `src/shared/ui/selection-v2/styles/selection.css`, add scoped `-webkit-touch-callout:none`, `-webkit-user-select:none`, and `user-select:none` to `.selection-v2-layer`, loupe, clone source, and descendants. Do not change the real SAT source ownership rules and do not apply this globally.

2. **Sterilize the loupe clone in JS too.** In `loupePicture.ts` `dressPicture()`, force `user-select:none`, `-webkit-user-select:none`, `-webkit-touch-callout:none`, and `pointer-events:none` on the clone and descendants after sanitization. Keep `inert`, `aria-hidden`, and `tabindex=-1`. Do not add these properties to `PICTURE_STYLE_PROPERTIES`.

3. **Expand the native-selection circuit breaker.** In `useStudentSelectionGesture.ts`, detect native ranges intersecting either the active SAT root **or Selection-v2 presentation DOM**. Add endpoint classification such as `source-root`, `loupe-clone`, `floating-layer`, `handle`, `toolbar`, `editable`, `body`, `other`. If an app-owned SAT selection is active and a forbidden native range appears, record `native-selection-leak` and immediately `removeAllRanges()`. Preserve native ranges inside legitimate editable controls.

4. **Add the scoped iOS `touchstart` capture guard.** Register a non-passive capture listener only for an armed real SAT app-owned root. Prevent default only when the touch begins inside a valid `[data-content-text-node]` and not inside excluded/editable UI. Keep the protection stack:

```text id="d48g8w"
user-select:none
→ -webkit-touch-callout:none
→ touch-action:none
→ touchstart preventDefault
→ selectstart preventDefault
→ selectionchange emergency cleanup
```

5. **Upgrade diagnostics.** Record native-selection endpoint origin, current Selection-v2 phase, whether a custom Range exists, loupe-open state, owner marker, relevant computed `user-select`, and native/custom text lengths. Do not record student text. Ensure loupe-originated `selectionchange` events are no longer filtered out.

6. **Add regressions before declaring fixed.** Cover: loupe clone and every descendant compute `user-select:none`; a programmatically created native Range inside the loupe is immediately removed and logged as `anchorOrigin='loupe-clone'`; same protection for floating layer/handles; editable ranges remain untouched; source/clone/layer are all non-selectable before and during touch.

### Release gate

Run:

```bash id="or61hc"
bun run typecheck
bun run lint
bunx vitest run src/shared/ui/selection-v2
```

Then run the SAT touch-selection Playwright suite, followed by a **physical iPad Safari test with repeated 2–5 second holds**.

Definition of done:

```text id="ptn3ng"
real SAT source          user-select:none
loupe DOM clone          user-select:none
Selection-v2 layer       user-select:none
window.getSelection()    empty/collapsed
SelectionSession.range() sole valid selection

2–5s iPad hold:
no Copy / Look Up / Translate menu
no native handles
no whole-page native selection
```

Do not modify source ownership again unless these tests show that the source itself regressed.
