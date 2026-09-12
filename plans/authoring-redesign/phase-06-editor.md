# Phase 06 — Editor (the toolbar stops looking like a CMS)

## 1. Objective

Make the rich-text editor feel like editing a document, not operating a CMS:

1. Default toolbar becomes **5 controls + `···`**: `Text ▾ · B · I · Math · Insert + · ···`.
2. Advanced controls move behind two menus (Insert, More) with **identical accessible names** so nothing becomes unreachable.
3. Toolbars become **contextual**: inside a table → table controls; an equation selected → equation controls; an image selected → image controls; plain text → the default row.
4. The editor surface stops being a bordered box at rest: transparent by default, subtle surface on hover, quiet focus treatment.
5. Answer option rows become compact: letter + content, with reorder behind hover/focus. **This phase owns that change** (Phase 06 lands in Wave 3, before Phase 04's canvas rewrite).

## 2. Dependencies

- Requires: Phase 01 (radius/spacing/motion tokens).
- Parallel with: Phase 03 (disjoint files; neither edits `AuthoringWorkspace.tsx`).
- Blocks: nothing; Phase 07 polishes keyboard/motion around it.
- Owns: `editor/RichQuestionComposer.tsx`, `editor/FastQuestionComposer.tsx` (props only), the `.sat-rich-editor*` block in `src/index.css`, `spine/AnswerKeyField.tsx` (option row geometry only — Phase 04 owns its label row), editor tests.
- Does **not** own: `SpineQuestionView.tsx` (call sites pass the same props), `EditableMathExtension.tsx` / `SatImageExtension.tsx` (extension behaviour unchanged).

## 3. Current state (verified)

```text
RichQuestionComposer.tsx (≈470 lines)
  extensions: RichContentIdentity, StarterKit(heading 2/3, blockquote off), EditableInlineMath,
              EditableBlockMath, TableKit(resizable), Subscript, Superscript, SatImage, Placeholder
  capabilities: SAT_RICH_COMPOSER_CAPABILITIES (all true)
                SAT_CHOICE_COMPOSER_CAPABILITIES (blockStyles/lists false, rest true)
  useEditorState selector exposes: bold italic underline superscript subscript bulletList
                                   orderedList table codeBlock blockStyle canUndo canRedo
  ComposerToolbar renders ONE row with:
    [style select Body/Heading/Subheading] [bullet] [ordered] | [B] [I] [U] [x2] [x2] |
    [Sigma] [image] [table] [code] | [undo] [redo]
  TableToolbar renders above the content when the cursor is in a table:
    [Table label] [Add row] [Add column] [delete row] [delete column] [merge] [split] ...
  Dialogs: math (insert/edit, display toggle) and image (upload/alt/caption)
  Table feedback: data-table-feedback + a "table inserted" announcement
CSS (src/index.css:2728-2960+):
  .sat-rich-editor { border: 1px solid separator-strong; radius-au-lg; surface; shadow-sm }
  .sat-rich-editor:focus-within { accent border + 3px accent tint ring }
  .sat-rich-editor__toolbar { surface-raised + bottom border }
  .sat-rich-editor__toolbar-button { 32px; hover fill; is-active accent tint }
  .sat-rich-editor__content { padding 16px 20px } / [data-compact] { 12px }
  .sat-rich-editor__input { 15px; caret accent }
Pinned tests (editor/__tests__/RichQuestionComposer.test.tsx):
  - textbox accessible name = the label prop ("Question prompt" / "Answer choice A")
  - toolbar role/name: role="toolbar" name="Formatting tools"
  - buttons by name: "Underline (⌘U)", "Insert equation", "Insert image or graph", "Code block",
    "Insert table", and (compact) the same set must remain available
  - clicking "Insert equation" opens the math dialog and shows the inline-placement preview
  - plain SAT content opens directly in the rich editor (no reveal step)
```

## 4. Behavioral contract

- The editor keeps: the label as the textbox accessible name, the `Formatting tools` toolbar landmark, `⌘B/⌘I/⌘U` shortcuts, paste/image/table/equation behaviour, the math and image dialogs, table feedback announcements, placeholder behaviour, and the `capabilities` prop semantics (compact choice editors still get math/image/table/code, just without block styles or lists).
- **Every control that exists today must remain reachable by name.** Specifically the test-pinned names must still resolve: `Insert equation`, `Insert image or graph`, `Insert table`, `Code block`, `Underline (⌘U)`. They may live inside a menu; the accessible name must not change.
- Toolbar keyboard contract: the toolbar remains a single `role="toolbar"`; menu triggers inside it are ordinary buttons that open a `role="menu"` with roving focus (use `SatMenu`, already proven in this repo).
- No change to the document model, the identity extension, the math/image extensions, or the `StructuredContent` serialization.

## 5. Design decisions

- **5.1 Default toolbar (spec §8).**
  ```text
  [Text ▾]   [B]  [I]   [Math]   [Insert +]   ···
  ```
  - `Text ▾`: the existing style `<select>` (Body / Heading / Subheading), unchanged options, restyled as a compact button-ish select.
  - `Math`: a labelled button (not a Σ glyph) that opens the existing math dialog. **Decision: use a text label with a `Sigma` icon**, name `Insert equation` (preserves the test + is clearer than a bare glyph).
  - `Insert +` menu items: `Image` (name: `Insert image or graph`), `Table` (name: `Insert table`), `Equation` (name: `Insert equation`), `Code block`, `Divider` (horizontal rule — currently absent; adding it is a 3-line Tiptap command and completes the insert set the spec lists).
  - `···` menu items: `Underline (⌘U)`, `Superscript`, `Subscript`, `Bulleted list`, `Numbered list`, `Undo`, `Redo`. These are the current 32px icon buttons with their exact titles as names.
  - Rationale: AC-10 (≤ 5 controls + `···`), spec §8.
- **5.2 Contextual rows (spec §13).** The composer renders **at most two rows**: the default row, plus one contextual row when the cursor/selection matches.
  ```text
  in table        -> [Table]  Add row  Add column  Alignment ▾  ···   (replaces the default row)
  equation sel.   -> [Equation]  Inline | Block   Edit   ···          (replaces the default row)
  image selected  -> [Image]  Replace  Alt text  Delete               (replaces the default row)
  plain text      -> default row
  ```
  - **Decision: contextual rows replace the default row rather than stacking above it.** Rationale: spec §13 says the UI grows with intent; stacking produces exactly the two-row CMS look we are removing. Escape/blur returns to the default row.
  - **Decision: the existing `TableToolbar` is reused**, restyled into the contextual row and gated on selection instead of always-on-when-in-table. Its buttons keep their current names ("Add row", "Add column", "Delete row", "Delete column", "Merge cells", "Split cell", …) so nothing regresses.
  - **Decision: equation and image contextual rows are new.** Equation: reads the selected node's `display` attr and offers Inline/Block + Edit (opens the existing math dialog in edit mode with the node position — the dialog already supports `{mode:"edit", pos}`). Image: Replace (existing upload path), Alt text (existing dialog field), Delete (`deleteSelection`).
  - **Decision: do not build a "Link" control.** Links are not part of the current document model (StarterKit link is not enabled) and adding one would change the serialized contract. Documented omission with rationale.
- **5.3 Editor surface (spec §14).**
  ```css
  .sat-rich-editor            { border: 1px solid transparent; background: transparent; border-radius: 12px; }
  .sat-rich-editor:hover      { background: var(--color-au-surface-raised); }
  .sat-rich-editor:focus-within {
    background: var(--color-au-surface);
    border-color: var(--color-au-separator-strong);
    box-shadow: 0 0 0 3px var(--color-au-accent-tint);   /* keep a visible focus ring: AC-18 */
  }
  ```
  - **Decision: keep a focus ring.** Removing it would violate AC-18; the "quiet" treatment is about the *rest* state, not the focus state.
  - **Decision: no shadow at rest.** Elevation is reserved for popovers/menus (AC-02).
- **5.4 Typography.** Editor content 16px (`--spine-text-body`) with 1.6 line height, up from 15px. Rationale: spec §23/§47 (editor text 16–17px) and it is the single biggest readability win on a wide canvas.
  - Placeholder colour must stay ≥ 4.5:1 on the surface (currently `--color-gray-400` on white ≈ 3.0:1 — **fix to a compliant neutral**, e.g. `--color-gray-500`, and note it in the log).
- **5.5 Answer option rows (spec §17).** `AnswerKeyField` rows:
  ```text
  [ ● A ]  [ option content editor .............................. ]   [↑] [↓]   (reorder on hover/focus)
  ```
  - The 44px letter target stays (test-pinned class strings).
  - The option editor keeps `compact` + `SAT_CHOICE_COMPOSER_CAPABILITIES` (math/image/table/code still available).
  - Reorder buttons (`Move choice X earlier/later`): apply `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` here. **This phase owns the change**; Phase 04 (Wave 4) must not re-add permanent visibility. Verify no test asserts their absence, and keep the accessible names unchanged — they are the only keyboard path for reordering.
  - The row keeps `data-spine-key-row` for the key marker (identity test relies on the option id, not the letter).

## 6. Detailed TODOs

### 6.1 Composer restructure

- [ ] **6.1** Extract the toolbar into `editor/ComposerToolbar.tsx` with an explicit contract:
  ```tsx
  export type ComposerContext =
    | { kind: "text" }
    | { kind: "table" }
    | { kind: "equation"; display: boolean; pos: number }
    | { kind: "image"; pos: number; alt: string | null };

  export interface ComposerToolbarProps {
    editor: Editor;
    state: ComposerState;            // the existing useEditorState selector result
    capabilities: Readonly<RichComposerCapabilities>;
    context: ComposerContext;
    onOpenDialog: (dialog: "math" | "image", target?: MathDialogTarget) => void;
    onTableMutation: () => void;
  }
  ```
  - Keep `role="toolbar" aria-label="Formatting tools"` on the outer element for every context.
  - Keep the exact accessible names listed in §4.
  Verify: extend `RichQuestionComposer.test.tsx` with: default row renders exactly 5 controls + `···`; opening `Insert +` exposes the 5 insert names; opening `···` exposes underline/superscript/subscript/lists/undo/redo.
- [ ] **6.2** Add `context` derivation inside the composer:
  ```ts
  const context: ComposerContext = useMemo(() => {
    if (selectionIsImage) return { kind: "image", pos, alt };
    if (selectionIsMath)  return { kind: "equation", display, pos };
    if (editor?.isActive("table")) return { kind: "table" };
    return { kind: "text" };
  }, [editor, editorState]);
  ```
  - **Decision: detect image/math selection via `editor.state.selection` + `editor.getAttributes("image")` / `getAttributes("inlineMath" | "blockMath")`, not via a custom plugin.** The attributes already exist on the nodes.
  - Verify with unit tests that simulate selection where feasible; where Tiptap makes that heavy, assert the pure derivation function by extracting it as `resolveComposerContext(state)` in `editor/composerContext.ts` (pure, unit-testable).
- [ ] **6.3** Implement the Insert menu and More menu with `SatMenu`. Each menu item keeps its current `title` as the accessible name. Menus must close and return focus to the trigger (SatMenu contract).
- [ ] **6.4** Implement the equation contextual row: Inline/Block toggle writes the node's `display` attr; Edit opens the math dialog in edit mode at `pos`.
- [ ] **6.5** Implement the image contextual row: Replace (reuses the upload flow), Alt text (opens the image dialog focused on alt), Delete (`deleteSelection()`).
- [ ] **6.6** Table contextual row: reuse `TableToolbar`, restyled, gated on `context.kind === "table"`. Keep every existing action and name.
- [ ] **6.7** Add the Divider insert (`setHorizontalRule()`).
- [ ] **6.8** Keep the compact/choice behaviour: when `capabilities.blockStyles === false` and `capabilities.lists === false` (choice editors), the `Text ▾` control is hidden and the More menu omits the list items — matching today's capability semantics.

### 6.2 CSS

- [ ] **6.9** Rewrite the `.sat-rich-editor` block in `src/index.css` per 5.3/5.4. Keep the class names (tests and other surfaces rely on them).
  - Add `.sat-rich-editor__toolbar--context` for the contextual row styling (same visual language, single row).
  - Toolbar buttons: 28–32px, radius `--spine-radius-sm`, hover fill, active = accent tint + accent text (existing).
  - Remove the toolbar's bottom border when the toolbar is in a menu-only state? **Decision: keep one hairline under the toolbar row** (it separates chrome from content and is the only line in the editor).
- [ ] **6.10** Fix the placeholder contrast (5.4) and document the old/new values in the phase log.

### 6.3 Answer options

- [ ] **6.11** Adjust `AnswerKeyField` option rows to 5.5 (geometry + hover-reveal reorder; no behaviour change). Add a test asserting the reorder group keeps its accessible names while visually hidden at rest. Verify `AnswerKeyField.test.tsx` and `AnswerKeyIdentity.test.tsx` still pass.

## 7. File-by-file plan

- **CHANGE** `editor/RichQuestionComposer.tsx` (toolbar extraction + context wiring)
- **ADD** `editor/ComposerToolbar.tsx`, `editor/composerContext.ts`, `editor/__tests__/composerContext.test.ts`, `editor/__tests__/ComposerToolbar.test.tsx`
- **CHANGE** `src/index.css` — `.sat-rich-editor*` block only
- **CHANGE** `spine/AnswerKeyField.tsx` (option row geometry + hover-reveal reorder). Note: Phase 04 (Wave 4) also edits this file for label rows — it runs **after** this phase, so keep the diff small and the accessible names stable.
- **CHANGE** tests: `editor/__tests__/RichQuestionComposer.test.tsx`
- **VERIFY (no change)** `EditableMathExtension.tsx`, `SatImageExtension.tsx`, `RichContentIdentityExtension.tsx`, `richContent.ts`

## 8. Test changes (explicit, with reasons)

| Test | Change | Why |
|---|---|---|
| "keeps rich SAT choice tools available in compact presentation" | Keep; update how the toolbar is queried (menu opening may be required for some names) | Capabilities unchanged; controls moved |
| "applies the inline placement layout to the equation preview" | Keep; open the math dialog from `Math` or the Insert menu | Same dialog, new trigger |
| "starts plain SAT content in the rich editor without a reveal action" | Keep unchanged | No reveal step introduced |
| new: default toolbar count | Exactly 5 controls + `···` in the text context | AC-10 |
| new: insert menu names | Image/Table/Equation/Code block/Divider reachable | AC-10 + spec §8 |
| new: more menu names | Underline/Superscript/Subscript/Bulleted list/Numbered list/Undo/Redo reachable | Nothing lost |
| new: contextual row | table/equation/image contexts replace the default row | Spec §13 |

## 9. Error / edge matrix

| Condition | Expected | Handling |
|---|---|---|
| jsdom (tests) has no real layout | toolbar renders, menus open via `SatMenu` static fallback | SatMenu already handles this |
| Cursor enters a table | table row replaces the default row; leaving restores it | context derivation |
| Equation selected, then user types | context returns to text | state-driven |
| Image deleted while the image row is open | context recomputes to text | state-driven |
| Compact choice editor | no `Text ▾`, no list items; math/image/table/code still reachable | capability gating |
| Paste with formatting | unchanged (Tiptap default) | no change |
| Undo after a contextual action | editor history unchanged | commands only |
| Reduced motion | no animation added in this phase | — |
| Placeholder contrast | ≥ 4.5:1 | 6.10 |

## 10. Test strategy & gate

```bash
npx vitest run src/features/exam-authoring/editor src/features/exam-authoring/ui/spine/__tests__/AnswerKeyField.test.tsx
npx vitest run src/features/exam-authoring
npx eslint src/features/exam-authoring
npx vite build
grep -n "sat-rich-editor__toolbar-button" src/index.css | wc -l     # rule still present
grep -rn "Insert image or graph\|Insert table\|Insert equation\|Code block" src/features/exam-authoring/editor   # names preserved
```

## 11. Definition of done

- [ ] Default toolbar is `Text ▾ · B · I · Math · Insert + · ···` (≤ 5 + overflow) and every legacy control is reachable by its original name.
- [ ] Contextual rows for table / equation / image replace the default row; text returns automatically.
- [ ] Editor surface: transparent at rest, subtle surface on hover, quiet focus with a visible ring.
- [ ] Editor text is 16px; placeholder contrast fixed and documented.
- [ ] Answer option rows are compact with hover/focus reorder; 44px targets and radiogroup semantics intact.
- [ ] Editor + full authoring suites green; eslint clean; build passes.
- [ ] `plans/authoring-redesign/phase-06-verification-log.md` written.

