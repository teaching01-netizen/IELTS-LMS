# SAT Rich Editor UX Polish: Visible Undo/Redo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Undo and Redo always-visible toolbar controls in the SAT rich question composer, in every editing context (text, table, equation, image), so authors can recover from any mistake in one click.

**Architecture:** The contextual toolbar (`ComposerToolbar.tsx`) renders a different control row per node context. Undo/Redo currently exist only as overflow-menu items in the text context and vanish entirely in table/equation/image contexts. The fix renders a persistent `history` group appended to the toolbar row *outside* the context branches, gated by the existing `history` capability and `editor.can().undo()` state. No new extensions, no keyboard work (TipTap's StarterKit already binds ⌘Z / ⇧⌘Z).

**Tech Stack:** React 19, TipTap 3.30, vitest + Testing Library, Bun, existing CSS custom properties in `src/index.css` (the `.sat-rich-editor__toolbar-group--history` modifier already exists and is currently unused — dead CSS becomes the styling for this group; mobile reset already exists at `src/index.css:3660-3665`).

**Out of scope (agreed polish backlog, NOT this plan):** PasteStatus timer differentiation, MathDialog placement copy, image dialog cancel affordance, toolbar redesign.

---

## Contracts discovered (must not regress)

| Contract | Location | Effect of this change |
|---|---|---|
| Default toolbar shows exactly 5 buttons + style combobox | `src/features/exam-authoring/editor/__tests__/RichQuestionComposer.test.tsx:46-51` | **Intentionally updated 5 → 7** (Undo + Redo become visible buttons) |
| Choice-mode overflow menu contains "Underline (⌘U)", no "Bulleted list" | `RichQuestionComposer.test.tsx:75-77` | Unaffected (Undo/Redo removed from menu, Underline untouched) |
| Table toolbar stays a single `toolbar` role; "Add row" present; Delete table returns to "Insert content" | `ComposerToolbar.test.tsx:15` | Unaffected (history group appends to the same row) |
| Equation "Edit equation"/"Inline equation" and image "Edit alternative text"/"Delete image" buttons | `ComposerToolbar.test.tsx:13-14` | Unaffected |
| Collaborative mode must not register a second history stack | `RichQuestionComposer.tsx:53-71` | Unaffected (we only render buttons; the `state.history` gate already detects whether undo commands exist, which is true in collaborative mode via the Collaboration extension) |
| PasteStatus "Undo paste" / "Add alt text" buttons | `PasteStatus.test.tsx` | Unaffected (separate component, distinct labels) |

## File Structure

- Modify: `src/features/exam-authoring/editor/ComposerToolbar.tsx` — add history group to every context; extend `button()` helper with `disabled`; remove duplicated menu entries.
- Modify: `src/features/exam-authoring/editor/__tests__/ComposerToolbar.test.tsx` — new failing tests first.
- Modify: `src/features/exam-authoring/editor/__tests__/RichQuestionComposer.test.tsx:49` — button count 5 → 7.

No CSS changes required.

---

### Task 1: RED — write the failing tests

**Files:**
- Modify: `src/features/exam-authoring/editor/__tests__/ComposerToolbar.test.tsx`

- [ ] **Step 1: Add the three tests inside `describe('contextual toolbar', ...)` before the closing `});` on line 16**

```tsx
 it('keeps undo and redo visible in the text context and functional',()=>{const e=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});render(<ComposerToolbar editor={e} capabilities={capabilities} onOpenDialog={vi.fn()} onTableMutation={vi.fn()}/>);expect(screen.getByRole('button',{name:'Undo (⌘Z)'})).toBeDisabled();act(()=>{e.commands.insertContentAt(5,' more');});const undo=screen.getByRole('button',{name:'Undo (⌘Z)'});expect(undo).toBeEnabled();fireEvent.click(undo);expect(e.state.doc.textContent).toBe('Stem');expect(screen.getByRole('button',{name:'Redo (⇧⌘Z)'})).toBeEnabled();});
 it('keeps undo and redo visible in table, equation, and image contexts',()=>{const renderToolbar=(editor:Editor)=>render(<ComposerToolbar editor={editor} capabilities={capabilities} onOpenDialog={vi.fn()} onTableMutation={vi.fn()}/>);const equation=make({type:'doc',content:[{type:'blockMath',attrs:{latex:'x^2'}}]});equation.commands.setNodeSelection(0);const a=renderToolbar(equation);expect(a.getByRole('button',{name:'Undo (⌘Z)'})).toBeInTheDocument();a.unmount();const image=make({type:'doc',content:[{type:'image',attrs:{src:'https://example.test/i.png',alt:'Graph',assetId:'a1'}}]});image.commands.setNodeSelection(0);const b=renderToolbar(image);expect(b.getByRole('button',{name:'Redo (⇧⌘Z)'})).toBeInTheDocument();b.unmount();const table=make({type:'doc',content:[{type:'paragraph'}]});const c=renderToolbar(table);act(()=>{table.commands.insertTable({rows:2,cols:2});});expect(c.getByRole('button',{name:'Undo (⌘Z)'})).toBeEnabled();c.unmount();});
 it('removes the duplicated undo and redo entries from the overflow menu',()=>{const e=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});render(<ComposerToolbar editor={e} capabilities={capabilities} onOpenDialog={vi.fn()} onTableMutation={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'More formatting'}));expect(screen.queryByRole('menuitem',{name:'Undo'})).toBeNull();expect(screen.queryByRole('menuitem',{name:'Redo'})).toBeNull();});
```

- [ ] **Step 2: Run the tests and verify they fail for the right reason**

Run: `bun run test:run src/features/exam-authoring/editor/__tests__/ComposerToolbar.test.tsx`
Expected: 3 new tests FAIL with "Unable to find role button" / queryByRole not null. The 3 existing tests still PASS.

### Task 2: GREEN — render the history group in every context

**Files:**
- Modify: `src/features/exam-authoring/editor/ComposerToolbar.tsx`

- [ ] **Step 1: Add icons to the lucide import (line 2)**

```tsx
import {Bold,Italic,MoreHorizontal,Plus,Redo2,Sigma,Undo2} from 'lucide-react';
```

- [ ] **Step 2: Extend the `button()` helper with a `disabled` parameter (line 14)**

```tsx
 const button=(label:string,action:()=>void,content:React.ReactNode=label,active?:boolean,disabled?:boolean)=><button type="button" className="sat-rich-editor__toolbar-button" aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={action}>{content}</button>;
```

- [ ] **Step 3: Delete the duplicated menu entries (line 47)**

Delete this line entirely:
```tsx
  if(c.history&&state.history)more.push({id:'undo',label:'Undo',disabled:!state.undo,onSelect:()=>{editor.chain().focus().undo().run();}},{id:'redo',label:'Redo',disabled:!state.redo,onSelect:()=>{editor.chain().focus().redo().run();}});
```

- [ ] **Step 4: Append the history group outside the context branches (line 50)**

Replace the return statement with:
```tsx
 return <div className="sat-rich-editor__toolbar" role="toolbar" aria-label="Formatting tools" data-composer-context={context.kind}><div className="sat-rich-editor__toolbar-row">{row}{c.history&&state.history?<span className="sat-rich-editor__toolbar-group sat-rich-editor__toolbar-group--history" data-toolbar-group="history">{button('Undo (⌘Z)',()=>{editor.chain().focus().undo().run();},<Undo2 size={15}/>,undefined,!state.undo)}{button('Redo (⇧⌘Z)',()=>{editor.chain().focus().redo().run();},<Redo2 size={15}/>,undefined,!state.redo)}</span>:null}</div></div>;
```

Rationale: the group mounts once, after `{row}`, so it appears in text/table/equation/image contexts alike; `state.undo`/`state.redo` already update reactively via `useEditorState`; `c.history && state.history` preserves the existing capability + command-availability gate; the BEM modifier class activates the existing push-right CSS (index.css:3358-3362) and its mobile reset (index.css:3660-3665).

### Task 3: Update the pinned button-count contract

**Files:**
- Modify: `src/features/exam-authoring/editor/__tests__/RichQuestionComposer.test.tsx:46-51`

- [ ] **Step 1: Change the expectation from 5 to 7 buttons**

```tsx
  it("shows the standard control set plus visible undo and redo", async () => {
    render(<RichQuestionComposer value={plainContentFromText("Hello")} onChange={vi.fn()} label="Question" />);
    const toolbar=await screen.findByRole("toolbar", {name:"Formatting tools"});
    expect(within(toolbar).getAllByRole("button")).toHaveLength(7);
    expect(within(toolbar).getByRole("combobox", {name:"Text style"})).toBeInTheDocument();
  });
```

### Task 4: Verify GREEN + regressions

- [ ] **Step 1: Run the focused tests**

Run: `bun run test:run src/features/exam-authoring/editor/__tests__/ComposerToolbar.test.tsx src/features/exam-authoring/editor/__tests__/RichQuestionComposer.test.tsx src/features/exam-authoring/editor/__tests__/PasteStatus.test.tsx`
Expected: all PASS, no warnings.

- [ ] **Step 2: Typecheck and lint the touched files**

Run: `bun run typecheck && bun run lint -- src/features/exam-authoring/editor/ComposerToolbar.tsx`
Expected: exit 0.

### Task 5: Commit (scoped — the working tree has unrelated in-flight changes)

- [ ] **Step 1: Stage only the three touched files and commit**

```bash
git add src/features/exam-authoring/editor/ComposerToolbar.tsx src/features/exam-authoring/editor/__tests__/ComposerToolbar.test.tsx src/features/exam-authoring/editor/__tests__/RichQuestionComposer.test.tsx
git commit -m "feat(sat-editor): keep undo/redo visible across composer contexts"
```

---

## Acceptance criteria (the 10/10 bar)

1. Undo/Redo are visible toolbar buttons in every composer context; never more than one click away.
2. Buttons disable (not hide) when there is nothing to undo/redo — position never shifts.
3. Clicking Undo reverts the last transaction; Redo re-applies it (proven by Task 1 test).
4. The overflow menu no longer duplicates Undo/Redo.
5. All existing toolbar, composer, and paste-status contracts pass unchanged (except the intentionally updated button count).
6. Typecheck and lint clean; commit contains only the three files.
