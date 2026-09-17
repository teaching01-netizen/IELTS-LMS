import {readFileSync} from 'node:fs';
import {act,fireEvent,render,screen} from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {EditableBlockMath,EditableInlineMath} from '../EditableMathExtension';
import {SatImage} from '../SatImageExtension';
import {ComposerToolbar} from '../ComposerToolbar';
import {SAT_RICH_COMPOSER_CAPABILITIES as capabilities, SAT_CHOICE_COMPOSER_CAPABILITIES as choiceCapabilities} from '../RichQuestionComposer';
import type { EditorFeedbackInput } from '../editorFeedbackCopy';
const editors:Editor[]=[];afterEach(()=>editors.splice(0).forEach(e=>e.destroy()));
// StarterKit v3 already ships Underline; the script marks are what it does not.
function make(content:object){const e=new Editor({extensions:[StarterKit,TableKit,Subscript,Superscript,EditableInlineMath,EditableBlockMath,SatImage],content});editors.push(e);return e;}
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
  expect(mainRowGroups()).toEqual(['style','format','math','insert','more','history']);
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
   expect(mainRowGroups()).toEqual(['style','format','math','insert','more','history']);
   expect(document.querySelector('.sat-rich-editor__toolbar')).toHaveAttribute('data-composer-context',item.context);
   expect(document.querySelector('.sat-rich-editor__toolbar')).toHaveAttribute('data-selection-kind','node');
   expect(screen.queryByRole('button',{name:'Replace image'})).toBeNull();
   expect(screen.queryByRole('button',{name:'Edit equation'})).toBeNull();
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
  expect(mainRowGroups()).toEqual(['style','format','math','insert','more','history']);
  fireEvent.click(screen.getByRole('button',{name:'Table actions'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'Delete table'}));
  expect(screen.queryByRole('group',{name:'Table tools'})).toBeNull();
  expect(screen.getByRole('button',{name:'Insert content'})).toBeInTheDocument();
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
 it('groups advanced formatting by concept and keeps destructive-free clear last',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  const onFeedback=renderToolbar(editor);
  fireEvent.click(screen.getByRole('button',{name:'More formatting'}));
  for(const name of ['Underline (⌘U)','Superscript','Subscript','Bulleted list','Numbered list','Clear formatting']) expect(screen.getByRole('menuitem',{name})).toBeInTheDocument();
  expect(screen.getAllByRole('separator')).toHaveLength(3);
  fireEvent.click(screen.getByRole('menuitem',{name:'Clear formatting'}));
  expect(onFeedback).toHaveBeenCalledWith({message:'Formatting cleared',undoable:true});
 });
 it('drops list and block-style commands from a choice composer without reshuffling the row',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Choice A'}]}]});
  renderToolbar(editor,choiceCapabilities);
  expect(mainRowGroups()).toEqual(['format','math','insert','more','history']);
  fireEvent.click(screen.getByRole('button',{name:'More formatting'}));
  expect(screen.getByRole('menuitem',{name:'Underline (⌘U)'})).toBeInTheDocument();
  expect(screen.queryByRole('menuitem',{name:'Bulleted list'})).toBeNull();
  expect(screen.getAllByRole('separator')).toHaveLength(2);
  fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'});
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
 it('places the recovery group with the selector its CSS actually targets',()=>{
  // The row's geometry is decided in CSS, so the selector and the markup have to
  // name the same thing: a class the toolbar no longer renders silently drops
  // undo/redo back into the middle of the row.
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  renderToolbar(editor);
  const selector='.sat-rich-editor__toolbar-group[data-toolbar-group="history"]';
  expect(document.querySelectorAll(selector)).toHaveLength(1);
  expect(readFileSync('src/index.css','utf8')).toContain(selector+' {');
  const history=document.querySelector(selector) as HTMLElement;
  expect(mainRowGroups().at(-1)).toBe('history');
  expect(history.querySelectorAll('button')).toHaveLength(2);
 });
 it('renders every toolbar control through the shared control contract',()=>{
  const editor=make({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Stem'}]}]});
  renderToolbar(editor);
  const row=document.querySelector('.sat-rich-editor__toolbar-row') as HTMLElement;
  const commands=Array.from(row.querySelectorAll<HTMLButtonElement>('.sat-rich-editor__toolbar-button'));
  // The commands of the default row: Bold, Italic, Math, Undo, Redo. Every one
  // of them is the shared control, and the menus are the only other kind of
  // button in the row — a third recipe is how surfaces drift apart.
  expect(commands.map((button)=>button.getAttribute('aria-label'))).toEqual([
   'Bold (⌘B)','Italic (⌘I)','Insert equation','Undo (⌘Z)','Redo (⇧⌘Z)',
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
