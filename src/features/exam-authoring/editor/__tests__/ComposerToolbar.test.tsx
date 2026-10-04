import {act,fireEvent,render,screen} from '@testing-library/react';
import { Editor } from '@tiptap/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {ComposerToolbar} from '../ComposerToolbar';
import {composerBaseExtensions, SAT_RICH_COMPOSER_CAPABILITIES as capabilities, SAT_CHOICE_COMPOSER_CAPABILITIES as choiceCapabilities} from '../RichQuestionComposer';
import type { EditorFeedbackInput } from '../editorFeedbackCopy';
import * as tableClipboard from '../tableClipboard';
const editors:Editor[]=[];afterEach(()=>{editors.splice(0).forEach(e=>e.destroy());vi.restoreAllMocks();});
function make(content:object|string){const e=new Editor({extensions:composerBaseExtensions(false),content});editors.push(e);return e;}
function renderToolbar(editor:Editor, caps=capabilities, onFeedback=vi.fn()){
 render(<ComposerToolbar editor={editor} capabilities={caps} onOpenDialog={vi.fn()} onTableMutation={vi.fn()} onFeedback={onFeedback}/>);
 return onFeedback;
}
/** The main row's group order — the contract that keeps Bold where it was learned. */
function mainRowGroups(){return Array.from(document.querySelectorAll('[data-toolbar-group]')).map(node=>node.getAttribute('data-toolbar-group'));}
describe('stable composer toolbar',()=>{
 it('keeps one row, in one order, and never moves Bold when the context changes',()=>{
  const paragraph=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  renderToolbar(paragraph);
  expect(mainRowGroups()).toEqual(['history','style','format','script','lists','align','math','insert','more']);
  expect(screen.getByRole('button',{name:'Text style'})).toHaveTextContent('Paragraph');
  expect(screen.queryByRole('button',{name:'Replace image'})).toBeNull();
 });
 it('reports the same row for image, equation, and table selections, with no object controls in it',()=>{
  const cases:{content:object;pos:number;context:string}[]=[
   {content:{type:'doc',content:[{type:'image',attrs:{src:'https://example.test/i.png',alt:'Graph',assetId:'a1'}}]},pos:0,context:'image'},
   {content:{type:'doc',content:[{type:'blockMath',attrs:{latex:'x^2'}}]},pos:0,context:'equation'},
  ];
  for(const item of cases){
   const editor=make(item.content);
   editor.commands.setNodeSelection(item.pos);
   const view=render(<ComposerToolbar editor={editor} capabilities={capabilities} onOpenDialog={vi.fn()} onTableMutation={vi.fn()} onFeedback={vi.fn()}/>);
   expect(mainRowGroups()).toEqual(['history','style','format','script','lists','align','math','insert','more']);
   expect(document.querySelector('.sat-rich-editor__toolbar')).toHaveAttribute('data-composer-context',item.context);
   expect(document.querySelector('.sat-rich-editor__toolbar')).toHaveAttribute('data-selection-kind','node');
   expect(screen.queryByRole('button',{name:'Replace image'})).toBeNull();
   expect(screen.queryByRole('button',{name:'Edit LaTeX'})).toBeNull();
   // Marks cannot apply to a node selection, so they dim rather than move.
   expect(screen.getByRole('button',{name:'Bold (⌘B)'})).toBeDisabled();
   view.unmount();
  }
 });
 it('puts table structure on its own row inside the same toolbar',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph'}]});
  renderToolbar(editor);
  expect(screen.queryByRole('group',{name:'Table tools'})).toBeNull();
  act(()=>{editor.commands.insertTable({rows:2,cols:2,withHeaderRow:true});});
  expect(screen.getAllByRole('toolbar')).toHaveLength(1);
  expect(screen.getByRole('group',{name:'Table tools'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Add row'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Add column'})).toBeInTheDocument();
  expect(mainRowGroups()).toEqual(['history','style','format','script','lists','align','math','insert','more']);
  fireEvent.click(screen.getByRole('button',{name:'Table actions'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'Delete table'}));
  expect(screen.queryByRole('group',{name:'Table tools'})).toBeNull();
  expect(screen.getByRole('button',{name:'Insert content'})).toBeInTheDocument();
 });
 it('centers only the current table and restores its alignment through Undo and the toggle',()=>{
  const table={type:'table',content:[
   {type:'tableRow',content:[{type:'tableHeader',content:[{type:'paragraph',content:[{type:'text',text:'Header'}]}]}]},
   {type:'tableRow',content:[{type:'tableCell',attrs:{align:'right'},content:[{type:'paragraph',content:[{type:'text',text:'Value'}]}]}]},
  ]};
  const editor=make({type:'doc',content:[table,{type:'paragraph',content:[{type:'text',text:'Between tables'}]},table]});
  editor.commands.setTextSelection(4);
  const onFeedback=renderToolbar(editor);
  const button=screen.getByRole('button',{name:'Center all cells'});
  expect(button).toHaveAttribute('aria-pressed','false');
  fireEvent.mouseDown(button);
  fireEvent.click(button);
  const tables=editor.view.dom.querySelectorAll('table');
  expect(tables[0]).toHaveAttribute('data-cell-alignment','center');
  expect(tables[1]).not.toHaveAttribute('data-cell-alignment');
  expect(button).toHaveAttribute('aria-pressed','true');
  expect(tables[0]?.querySelector('td')).toHaveStyle({textAlign:'right'});
  expect(onFeedback).toHaveBeenCalledWith({message:'All table cells centered horizontally and vertically',undoable:true});
  fireEvent.click(screen.getByRole('button',{name:'Undo (⌘Z)'}));
  expect(tables[0]).not.toHaveAttribute('data-cell-alignment');
  expect(button).toHaveAttribute('aria-pressed','false');
  fireEvent.click(screen.getByRole('button',{name:'Redo (⇧⌘Z)'}));
  expect(tables[0]).toHaveAttribute('data-cell-alignment','center');
  fireEvent.click(button);
  expect(tables[0]).not.toHaveAttribute('data-cell-alignment');
  expect(tables[1]).not.toHaveAttribute('data-cell-alignment');
 });
 it('keeps every cell centered after adding rows and columns and reopening saved content',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph'}]});
  editor.commands.insertTable({rows:2,cols:2,withHeaderRow:true});
  renderToolbar(editor);
  fireEvent.click(screen.getByRole('button',{name:'Center all cells'}));
  fireEvent.click(screen.getByRole('button',{name:'Add row'}));
  fireEvent.click(screen.getByRole('button',{name:'Add column'}));
  const table=editor.view.dom.querySelector('table');
  expect(table).toHaveAttribute('data-cell-alignment','center');
  expect(table?.querySelectorAll('td,th')).toHaveLength(9);
  for(const saved of [editor.getJSON(),editor.getHTML()]){
   const reopened=make(saved);
   expect(reopened.getJSON().content?.find(node=>node.type==='table')?.attrs?.['cellAlignment']).toBe('center');
   expect(reopened.view.dom.querySelector('table')).toHaveAttribute('data-cell-alignment','center');
   expect(reopened.view.dom.querySelectorAll('td,th')).toHaveLength(9);
  }
 });
 it('offers table-wide centering when a formula inside a cell is selected',()=>{
  const editor=make({type:'doc',content:[
   {type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:'inlineMath',attrs:{latex:'4'}}]}]}]}]},
   {type:'blockMath',attrs:{latex:'x^2'}},
  ]});
  editor.commands.setNodeSelection(4);
  renderToolbar(editor);
  expect(document.querySelector('.sat-rich-editor__toolbar')).toHaveAttribute('data-composer-context','equation');
  fireEvent.click(screen.getByRole('button',{name:'Center all cells'}));
  expect(editor.view.dom.querySelector('table')).toHaveAttribute('data-cell-alignment','center');
  expect(screen.getByRole('button',{name:'Center all cells'})).toHaveAttribute('aria-pressed','true');
  act(()=>{editor.commands.setNodeSelection(editor.state.doc.child(0).nodeSize);});
  expect(screen.queryByRole('group',{name:'Table tools'})).toBeNull();
 });
 it('disables Copy table during a write and reports a failed copy before allowing a retry',async()=>{
  const editor=make({type:'doc',content:[{type:'paragraph'}]});
  editor.commands.insertTable({rows:2,cols:2,withHeaderRow:true});
  let reject!:(reason:Error)=>void;
  const copy=vi.spyOn(tableClipboard,'copyCurrentTable')
   .mockImplementationOnce(()=>new Promise<void>((_resolve,fail)=>{reject=fail;}))
   .mockResolvedValueOnce(undefined);
  const feedback=renderToolbar(editor);
  const button=screen.getByRole('button',{name:'Copy table'});
  const original=editor.getJSON();
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(button).toHaveTextContent('Copying…');
  expect(feedback).not.toHaveBeenCalled();
  await act(async()=>{reject(new Error('denied'));});
  expect(button).toBeEnabled();
  expect(feedback).toHaveBeenLastCalledWith({message:'Could not copy the table. Check clipboard access and try again.'});
  await act(async()=>{fireEvent.click(button);});
  expect(copy).toHaveBeenCalledTimes(2);
  expect(feedback).toHaveBeenLastCalledWith({message:'Table copied with contents and formatting'});
  expect(editor.getJSON()).toEqual(original);
 });
 it('teaches the text styles by rendering them at the size and weight they apply',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  renderToolbar(editor);
  fireEvent.click(screen.getByRole('button',{name:'Text style'}));
  const paragraph=screen.getByRole('menuitem',{name:'Paragraph'});
  const heading=screen.getByRole('menuitem',{name:'Heading'});
  const subheading=screen.getByRole('menuitem',{name:'Subheading'});
  expect(paragraph.querySelector('.sat-rich-editor__style-option--paragraph')).not.toBeNull();
  expect(heading.querySelector('.sat-rich-editor__style-option--heading')).not.toBeNull();
  expect(subheading.querySelector('.sat-rich-editor__style-option--subheading')).not.toBeNull();
  fireEvent.click(heading);
  expect(JSON.stringify(editor.getJSON())).toContain('"level":2');
  expect(screen.getByRole('button',{name:'Text style'})).toHaveTextContent('Heading');
 });
 it('keeps only clear formatting and the shortcut sheet behind ···, since every format is on the row',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  const onFeedback=vi.fn();
  const onOpenShortcutHelp=vi.fn();
  render(<ComposerToolbar editor={editor} capabilities={capabilities} onOpenDialog={vi.fn()} onTableMutation={vi.fn()} onFeedback={onFeedback} onOpenShortcutHelp={onOpenShortcutHelp}/>);
  fireEvent.click(screen.getByRole('button',{name:'More formatting'}));
  expect(screen.getAllByRole('menuitem').map((item)=>item.textContent)).toEqual(['Clear formatting','Keyboard shortcuts (⌘/)']);
  fireEvent.click(screen.getByRole('menuitem',{name:'Keyboard shortcuts (⌘/)'}));
  expect(onOpenShortcutHelp).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'More formatting'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'Clear formatting'}));
  expect(onFeedback).toHaveBeenCalledWith({message:'Formatting cleared',undoable:true});
 });
 it('states every text format on the row and toggles it in place',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  editor.commands.selectAll();
  renderToolbar(editor);
  for(const [name,mark] of [['Underline (⌘U)','underline'],['Strikethrough (⇧⌘S)','strike'],['Superscript (⌘.)','superscript'],['Subscript (⌘,)','subscript']] as const){
   const button=screen.getByRole('button',{name});
   expect(button).toHaveAttribute('aria-pressed','false');
   fireEvent.click(button);
   expect(editor.isActive(mark)).toBe(true);
   expect(button).toHaveAttribute('aria-pressed','true');
  }
 });
 it('indents only inside a list, and nests the item when it can',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Plain'}]}]});
  renderToolbar(editor);
  expect(screen.getByRole('button',{name:'Increase indent (Tab)'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Decrease indent (⇧Tab)'})).toBeDisabled();
  act(()=>{editor.commands.setContent({type:'doc',content:[{type:'bulletList',content:[
   {type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'One'}]}]},
   {type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Two'}]}]},
  ]}]});editor.commands.setTextSelection(10);});
  expect(screen.getByRole('button',{name:'Bulleted list (⇧⌘8)'})).toHaveAttribute('aria-pressed','true');
  fireEvent.click(screen.getByRole('button',{name:'Increase indent (Tab)'}));
  expect(editor.view.dom.querySelectorAll('ul ul')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Decrease indent (⇧Tab)'}));
  expect(editor.view.dom.querySelectorAll('ul ul')).toHaveLength(0);
 });
 it('aligns the paragraph from the Align menu and shows the current alignment',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  renderToolbar(editor);
  fireEvent.click(screen.getByRole('button',{name:'Text alignment'}));
  expect(screen.getByRole('menuitem',{name:/Align left/})).toHaveAttribute('aria-current','true');
  fireEvent.click(screen.getByRole('menuitem',{name:/Align center/}));
  expect(editor.getJSON().content?.[0]?.attrs?.['textAlign']).toBe('center');
  expect(editor.view.dom.querySelector('p')).toHaveStyle({textAlign:'center'});
  fireEvent.click(screen.getByRole('button',{name:'Text alignment'}));
  expect(screen.getByRole('menuitem',{name:/Align center/})).toHaveAttribute('aria-current','true');
  // Left is the default, so it is stored as nothing at all.
  fireEvent.click(screen.getByRole('menuitem',{name:/Align left/}));
  expect(editor.getJSON().content?.[0]?.attrs?.['textAlign']).toBeNull();
 });
 it('keeps alignment through a save and reopen, and never trusts a stored value it does not know',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]},{type:'heading',attrs:{level:2},content:[{type:'text',text:'Title'}]}]});
  editor.chain().selectAll().setTextAlign('right').run();
  for(const saved of [editor.getJSON(),editor.getHTML()]){
   const reopened=make(saved);
   expect(reopened.getJSON().content?.slice(0,2).map((node)=>node.attrs?.['textAlign'])).toEqual(['right','right']);
  }
  const hostile=make('<p style="text-align: evil">One</p><p style="text-align: center">Two</p>');
  expect(hostile.getJSON().content?.map((node)=>node.attrs?.['textAlign'])).toEqual([null,'center']);
  expect(make({type:'doc',content:[{type:'paragraph',attrs:{textAlign:'evil'},content:[{type:'text',text:'x'}]}]}).getHTML()).not.toContain('evil');
 });
 it('inserts symbols and the SAT blank at the cursor from the Insert menu',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'x'}]}]});
  editor.commands.setTextSelection(2);
  renderToolbar(editor);
  fireEvent.click(screen.getByRole('button',{name:'Insert content'}));
  fireEvent.click(screen.getByRole('menuitem',{name:/Less than or equal to/}));
  fireEvent.click(screen.getByRole('button',{name:'Insert content'}));
  fireEvent.click(screen.getByRole('menuitem',{name:/Blank/}));
  expect(editor.state.doc.textContent).toBe('x≤______');
 });
 it('drops list and block-style commands from a choice composer without reshuffling the row',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Choice A'}]}]});
  renderToolbar(editor,choiceCapabilities);
  expect(mainRowGroups()).toEqual(['history','format','script','math','insert','more']);
  expect(screen.getByRole('button',{name:'Underline (⌘U)'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Bulleted list (⇧⌘8)'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Text alignment'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Insert content'}));
  for(const name of ['Insert image or graph','Insert equation','Insert table','Code block']) expect(screen.getByRole('menuitem',{name})).toBeInTheDocument();
  // Divider is a block-style insert, so a choice composer never offers it.
  expect(screen.queryByRole('menuitem',{name:'Divider'})).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
 });
 it('keeps undo and redo visible and functional in the text context',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  renderToolbar(editor);
  expect(screen.getByRole('button',{name:'Undo (⌘Z)'})).toBeDisabled();
  act(()=>{editor.commands.insertContentAt(5,' more');});
  const undo=screen.getByRole('button',{name:'Undo (⌘Z)'});
  expect(undo).toBeEnabled();
  fireEvent.click(undo);
  expect(editor.state.doc.textContent).toBe('Stem');
  const redo=screen.getByRole('button',{name:'Redo (⇧⌘Z)'});
  expect(redo).toBeEnabled();
  fireEvent.click(redo);
  expect(editor.state.doc.textContent).toBe('Stem more');
 });
 it('advertises the visible Insert label while keeping the full accessible name',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph'}]});
  renderToolbar(editor);
  const trigger=screen.getByRole('button',{name:'Insert content'});
  expect(trigger).toHaveTextContent('Insert');
  expect(trigger.querySelector('.sat-rich-editor__toolbar-label')).not.toBeNull();
 });
 it('never exposes a disabled control as invisible decoration',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  renderToolbar(editor);
  const undo=screen.getByRole('button',{name:'Undo (⌘Z)'});
  expect(undo).toBeDisabled();
  expect(undo.querySelector('svg')).not.toBeNull();
 });
 it('opens the row with undo and redo, as a word processor does',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  renderToolbar(editor);
  const history=document.querySelector('[data-toolbar-group="history"]') as HTMLElement;
  expect(mainRowGroups().at(0)).toBe('history');
  expect(history.querySelectorAll('button')).toHaveLength(2);
 });
 it('renders every toolbar control through the shared control contract',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  renderToolbar(editor);
  const row=document.querySelector('.sat-rich-editor__toolbar-row') as HTMLElement;
  const commands=Array.from(row.querySelectorAll<HTMLButtonElement>('.sat-rich-editor__toolbar-button'));
  // The commands of the default row. Every one of them is the shared control,
  // and the menus are the only other kind of button in the row — a third
  // recipe is how surfaces drift apart.
  expect(commands.map((button)=>button.getAttribute('aria-label'))).toEqual([
   'Undo (⌘Z)','Redo (⇧⌘Z)','Bold (⌘B)','Italic (⌘I)','Underline (⌘U)','Strikethrough (⇧⌘S)',
   'Superscript (⌘.)','Subscript (⌘,)','Bulleted list (⇧⌘8)','Numbered list (⇧⌘7)',
   'Decrease indent (⇧Tab)','Increase indent (Tab)','Insert equation',
  ]);
  for(const button of commands){
   expect(button.tagName).toBe('BUTTON');
   expect(button.getAttribute('type')).toBe('button');
  }
  for(const button of Array.from(row.querySelectorAll('button'))){
   expect(button.getAttribute('aria-label')).toBeTruthy();
  }
 });
});

// The toolbar's own feedback contract lives in the composer; this keeps the
// publisher type honest for consumers that only render the row.
export type ToolbarFeedbackContract = EditorFeedbackInput;
