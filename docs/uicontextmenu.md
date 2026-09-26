> **Superseded (2026-09-26).** The bar that shipped follows the product reference
> instead of this plan: three visible inks (the one in use drawn larger with the
> ink drop), an underline whose line shows its style plus a chevron menu
> (solid / dashed / dotted / none), a removal, and a note — one icon-only row on
> a rounded pill, with **no X** and **no split colour control**. Escape and a
> press outside dismiss it. See `SatAnnotationControls.tsx`,
> `SatUnderlineStyleControl.tsx`, and `SatSelectionActionsPanel.tsx`. The
> reasoning below about progressive disclosure, 44px targets, restrained motion,
> and hierarchical Escape still describes the shipped behavior.

I inspected the current SAT annotation implementation. The cognitive load is coming from the structure itself: `SatAnnotationControls.tsx` renders all three colors as labeled 44px actions, while `SatSelectionActionsPanel.tsx` puts colors on row 1 and Underline + Add note + X on row 2. There is also a separate “Highlight” heading. So a very small decision is being presented as a mini control panel.

Your proposed simplification is the right direction. I would make the contextual menu behave more like an Apple text-formatting control: **one compact horizontal action bar, with complexity disclosed only when the student asks for it.**

### Recommended SAT contextual menu

```text
        ╭────────────────────────────╮
        │  ● │⌄   U    🗒     ×      │
        ╰────────────────────────────╯
                   ▲
             selected text
```

Conceptually:

```text
[ Current color | ▾ ] [ Underline ] [ Note ] [ X ]
```

Not this anymore:

```text
HIGHLIGHT

● Yellow   ● Blue   ● Pink

────────────────────────
Underline      Add note      X
```

The first control should be a **split Highlight control**. The left 44px area shows only the currently selected color and applies that highlight immediately. The right 44px chevron changes the color. That preserves the important one-tap path: select text → tap current color → done.

Pressing the chevron reveals the full palette only when requested:

```text
        ╭────────────────────────────╮
        │  ● │⌃   U    🗒     ×      │
        ╰───────┬────────────────────╯
                │
          ╭───────────────╮
          │ ●  Yellow   ✓ │
          │ ●  Blue       │
          │ ●  Pink       │
          ╰───────────────╯
```

This is a much better application of progressive disclosure than showing Yellow/Blue/Pink permanently. The student sees **one decision, not three equivalent decisions**.

I would also remove the visible `HIGHLIGHT` heading entirely. The selected text + colored swatch already communicates the relationship spatially, and the heading currently costs vertical space without helping the action.

For the individual controls, I would use compact symbols visually but keep strong accessible names:

```text
●     current highlight color
⌄     change highlight color
U̲     underline
🗒     add note
×     dismiss tools
```

`aria-label`s remain `Highlight Yellow`, `Change highlight color`, `Underline`, `Add note`, and `Close text tools`. So the UI becomes visually calm without making accessibility worse.

The interaction should be:

1. Student selects text → one-row toolbar appears beside the selection.
2. Tap the current color → immediately create the highlight using that color.
3. Tap `⌄` → reveal Yellow / Blue / Pink. Choosing a different color both sets that as the current color **and applies it to the current selection**, so there is no unnecessary second tap.
4. Tap Underline → underline immediately.
5. Tap Note → create/open the note and preserve the existing note-column behavior.
6. Tap X → hide only the contextual toolbar. **Do not destroy the selection.** Your current `onClose` contract already describes this correctly.
7. If the selected text remains selected and the student interacts with it again, the contextual controls can return.

There should be no confirmation, no tooltip instruction on touch, and no toast for ordinary actions. The visible text itself changing is the feedback.

For an **existing highlight**, reuse exactly the same toolbar:

```text
[ ● Blue | ▾ ] [ U̲ ] [ 🗒 ] [ ··· ] [ × ]
```

The one additional `···` is only present while editing an existing annotation. Put `Remove highlight` / `Remove underline` inside that disclosure instead of permanently occupying another destructive row. Your existing Undo behavior should remain. That makes the selection and editing states feel like the **same object**, rather than two different interfaces.

### Changes I would make in your repo

`src/features/student-delivery/ui/annotations/SatAnnotationControls.tsx`

Replace `SatHighlightSwatchButtons` with something along the lines of `SatHighlightColorControl`. It owns the current swatch, apply action, chevron, and palette disclosure. Keep `onMouseDown(event.preventDefault())` because that is currently protecting the text selection and is important.

`SatUnderlineControl` and `SatNoteControl` should become compact 44×44 contextual buttons rather than large labeled buttons. Do **not** reduce the touch target just because the visual becomes smaller.

`SatCloseControl` stays. The X is exactly the right persistent escape hatch.

`SatAnnotationHeading` can disappear from this contextual surface.

Then simplify `SatSelectionActionsPanel.tsx` from:

```text
row 0: Yellow / Blue / Pink
row 1: Underline / Add note / X
```

to:

```text
row 0:
[ Highlight split control ][ Underline ][ Note ][ X ]
```

There should be **no divider and no wrapping in the normal phone width**. Your current `--sat-annotation-surface-max: 340px` may need a slight adjustment because it was designed around the old two-row surface. I would allow the contextual toolbar to size naturally up to approximately the available viewport width rather than forcing a 340px presentation and then wrapping.

The current color tokens in `satAnnotationPalette.ts` are already good. Keep Yellow/Blue/Pink and the existing CSS variables; this is a presentation change, not a data-model change.

### Important craftsmanship details

The color menu should use the same surface material as the contextual bar, appear directly attached/anchored to its color control, and use a checkmark rather than a second selected background plus border plus text emphasis. One state indicator is enough.

Use very restrained animation: roughly 100–150ms opacity + subtle scale/translation for opening the palette. No spring/bounce. Respect reduced motion.

When the color chooser is open, pressing Escape should close **only the chooser first** and return focus to the color control. A second Escape can dismiss the contextual toolbar. That preserves hierarchy.

Keyboard traversal should be:

```text
Highlight → Change color → Underline → Note → Close
```

and the palette itself:

```text
Yellow
Blue
Pink
```

with Up/Down navigation and Enter/Space selection.

### Test contract I would require

Your existing SAT annotation tests are already substantial, so I would change them rather than rebuild coverage. Add assertions that the toolbar initially exposes only one color visually; Yellow/Blue/Pink are only all present after opening the color chooser; choosing Blue applies Blue and makes Blue the remembered current color; selecting text again shows that single Blue swatch; Underline, Note, and X belong to the same toolbar row; every interactive target remains at least 44×44; opening/closing the palette never collapses the DOM selection; X dismisses chrome without deleting selection or annotations; zoom 50/75/100/125/150% keeps the toolbar anchored correctly; and narrow iPhone/iPad layouts don't regress into the old multi-row menu.

The resulting hierarchy is much calmer:

**Selected words → four immediate actions → deeper color/remove options only on demand.**

That is much closer to Apple HIG than the current “small floating settings panel” approach, while preserving essentially all of the capability your existing SAT annotation system already has.

Below is an implementation plan scoped **strictly to contextual-menu presentation and interaction UI**. The existing SAT text-selection engine, dragging, handles, anchoring, dismissal semantics, persistence, native-selection suppression, and selection lifecycle must remain untouched.

## SAT Context Menu — Apple HIG UI Simplification Plan

### Hard scope boundary

This task is **UI-only**.

Do **not** modify any behavior related to:

* how text selection starts
* long-press behavior
* pointer/touch selection
* selection handles
* word/sentence snapping
* Range creation or normalization
* selection persistence
* reopening the context menu from an existing selection
* native iOS/Safari selection suppression
* drag guards
* selection anchoring
* loupe behavior
* toolbar positioning algorithm
* touch-vs-mouse placement rules
* zoom coordinate conversion
* annotation persistence
* note behavior
* underline behavior
* highlight creation behavior
* annotation edit behavior
* keyboard selection behavior

Specifically, avoid changing selection-domain files such as `satTextSelection.ts`, `satSelectionAnchor.ts`, `satSelectionDragGuard.ts`, `useSatAnnotationSelection.ts`, the shared `selection-v2` engine, or placement code unless a test proves a purely visual measurement adjustment is absolutely required.

The implementation principle is:

> **Same selection. Same actions. Same data. Same placement behavior. Smaller and calmer presentation.**

### Implementation phases

1. **Freeze current behavioral contracts before changing UI.** Run the existing SAT annotation, touch-selection, placement, zoom, and selection tests first and treat them as regression gates. In particular, preserve the current contract where closing the contextual toolbar does not destroy the selected text or annotation state. Existing behavior from `SatSelectionActionsPanel`, `SatAnnotationEditControls`, `SelectionActionMenu`, and the annotation hooks should remain the source of truth. Do not “clean up” selection code while performing this work.

2. **Replace the permanent three-color row with one Highlight control.** Refactor `SatAnnotationControls.tsx` so `SatHighlightSwatchButtons` is replaced or wrapped by a compact control representing the current/default color. The primary surface should show approximately `[ ● | ▾ ]`, where the swatch represents `currentColor`. Clicking/tapping the swatch portion performs exactly the same `actions.highlight(anchor, currentColor)` operation the existing toolbar performs. The chevron opens a small palette containing Yellow, Blue, and Pink. Do not change `SatHighlightColor`, `SAT_HIGHLIGHT_COLORS`, `defaultSatHighlightColor`, annotation payloads, persistence, or `satAnnotationPalette.ts` color semantics.

3. **Use progressive disclosure for color.** Yellow, Blue, and Pink should no longer all occupy the main contextual menu. Opening the chevron reveals them in a secondary palette. Selecting a color should use the existing highlight callback and existing color state rather than creating a second annotation implementation. The chosen color should visually become the current swatch. Use one clear selected-state indicator—prefer a checkmark—rather than multiple competing visual treatments. Keep accessibility names explicit, for example `Highlight Yellow` and `Change highlight color`.

4. **Convert the contextual surface into one horizontal action row.** Change `SatSelectionActionsPanel.tsx` from the existing two-row structure into one primary row:

   `Highlight/current color | Underline | Add Note | X`

   Remove the separate `Highlight` heading from the selection toolbar. Remove the divider between highlight and secondary tools. Underline and Note should sit at the same hierarchy level as Highlight because all three answer the same immediate question: “What do I want to do with this selected text?” Keep the existing X control as the persistent visible dismissal affordance.

5. **Make controls visually compact without shrinking interaction targets.** The visible glyphs can be around 18–20px, but every action must retain a minimum **44×44px hit target**. Keep the existing `sat-touch-target`, focus ring, keyboard support, `onMouseDown(event.preventDefault())`, disabled handling, and button semantics. This is important: visual minimalism must not reduce usability. Underline may visually use the underline icon, Note the note icon, and Close the X icon. Their `aria-label`s remain explicit even if visible text is removed.

6. **Remove `SatAnnotationHeading` from this contextual menu only.** The existing `SatAnnotationHeading` is redundant once the toolbar is compact and anchored directly to selected text. Do not globally remove it without checking whether another annotation surface still intentionally uses it. If the existing-annotation editor benefits from the same simplified presentation, reuse the new control architecture there rather than introducing a second version.

7. **Make existing-annotation editing visually consistent.** `SatAnnotationEditControls.tsx` should look like the same object in a different state. For an existing highlight, show its current color in the same split color control. Underline and Note remain on the same row. Keep the existing remove functionality and Undo behavior, but progressively disclose destructive removal behind a quiet `…` menu rather than leaving a large destructive row visible all the time. The expected edit UI becomes approximately:

   `[ ● Blue | ▾ ] [ U̲ ] [ Note ] [ … ] [ X ]`

   This is a presentation change only. `onColor`, `onUnderline`, `onNote`, `onRemove`, and `onClose` retain their existing behavior.

8. **Do not change context-menu placement behavior.** Keep `useSatAnnotationPlacement`, `satAnnotationSurfaceChrome`, caret calculation, zoom conversion, touch environment detection, and the shared placement engine unchanged. The new toolbar will probably be shorter than the existing surface, which should naturally improve placement. Do not “optimize” positioning as part of this task. If the new natural width changes measurement, fix only the presentation constraint—for example the surface max-width token—not the placement policy.

9. **Refine the surface using Apple-style hierarchy rather than decoration.** Keep the existing floating material concept but reduce visual noise: one surface, one border, one subtle shadow, approximately 10–12px corner radius, restrained internal spacing, no decorative heading, no repeated labels, no unnecessary dividers. The color palette should visually originate from the color control and use the same material system. Avoid glass effects merely for appearance; clarity should come from hierarchy, spacing, and progressive disclosure.

10. **Add restrained motion only to disclosed UI.** The main toolbar should retain the current entrance behavior. The color palette and optional `…` menu can use a subtle ~100–150ms fade with a very small scale/translation. No spring, bounce, or dramatic movement. Honor `prefers-reduced-motion`. Do not animate selection rectangles, handles, anchoring, or toolbar coordinates beyond the existing placement behavior.

11. **Preserve selection through every toolbar interaction.** Continue using `onMouseDown={(event) => event.preventDefault()}` or the existing shared equivalent on every contextual toolbar control. Clicking Highlight, color disclosure, a color, Underline, Note, `…`, or X must not accidentally cause the browser to collapse or replace the text Range. Do not solve this by modifying the selection engine; preserve the existing interaction mechanism.

12. **Implement hierarchical Escape behavior without touching selection lifecycle.** When the color submenu is open, Escape closes only the color submenu and restores focus to its trigger. If the submenu is already closed, the existing toolbar Escape behavior remains unchanged. The same rule applies to the `…` menu. Do not make Escape clear the text selection unless that is already the current SAT selection contract.

13. **Keep keyboard and screen-reader quality equal or better.** The primary toolbar navigation order should be Highlight → Change color → Underline → Note → optional More → Close. The color menu should expose Yellow, Blue, and Pink as normal selectable items with current state communicated through `aria-checked`, `aria-selected`, or an appropriate menu/radio pattern. Icon-only visual controls must still have explicit accessible names. Do not rely on tooltip text for accessibility.

14. **Update tests around presentation, not selection internals.** Modify `SatAnnotationControls.test.tsx`, `SatAnnotationFlow.test.tsx`, `SatAnnotationEditControls` coverage, and the SAT annotation Playwright suite so they assert the new UI contract. Add a test proving only the current color is visible in the closed primary toolbar; opening the color control exposes Yellow/Blue/Pink; choosing Blue applies Blue using the existing annotation pipeline and makes Blue the current swatch; Underline and Note still invoke the same callbacks; X dismisses the toolbar without modifying the existing selected Range; closing and reopening contextual chrome does not change selection; color-menu open/close does not collapse selection; editing an existing mark recolors through the same API; Remove remains undoable; and all buttons remain at least 44×44 CSS pixels.

15. **Run explicit selection-regression tests after the UI change.** Existing touch-selection tests must pass **without being rewritten merely to accommodate a regression**. Cover iPhone Safari/WebKit, iPad, Chrome/Android/coarse pointer, and desktop/fine pointer where supported. Verify drag-start, drag-end, selection handles, long press, select → close toolbar → selection remains → interact with selected text → toolbar can appear again, choice text selection, paragraph text selection, multi-line text, and the previous “whole page becomes selected” regression. The expected result should be byte-for-byte equivalent selection anchors before and after contextual-menu interactions.

16. **Run zoom and placement regression coverage.** Exercise the existing menu at 50%, 75%, 100%, 125%, and 150% SAT screen zoom. The shorter toolbar should remain attached to the same anchor and follow the existing placement policy. Do not introduce a separate geometry calculation for the new palette. Verify narrow phone viewport, iPad portrait/landscape, desktop, selection near viewport edges, long multi-line selections, and software-keyboard conditions already represented in the placement suite.

17. **Add explicit architectural guards.** A code-review requirement for this PR should state: no changes to selection engine/domain behavior are accepted as part of this ticket. Ideally the diff should be concentrated around `SatAnnotationControls.tsx`, `SatSelectionActionsPanel.tsx`, `SatAnnotationEditControls.tsx`, possibly `SatAnnotationSurfaceFrame.tsx`/CSS tokens for visual sizing only, and their tests. Any diff touching selection normalization, Range ownership, touch gestures, native-callout suppression, anchor generation, or placement policy requires separate justification and should normally be rejected from this change.

### Definition of done

The finished experience should feel like:

**Select text → one small contextual bar appears → choose Highlight, Underline, or Note → result appears immediately.**

Color is available but does not compete for attention until requested. Destructive actions are available but quiet. The X remains obvious. Touch targets remain generous.

Most importantly, comparing a build before and after this change should show **no behavioral difference whatsoever in how text becomes selected, remains selected, moves, reopens its context menu, or produces selection anchors**.

Only the contextual UI becomes simpler, calmer, and more Apple-like.
