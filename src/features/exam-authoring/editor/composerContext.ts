import { NodeSelection, type EditorState } from '@tiptap/pm/state';

/** What the image dialog was opened for: inserting, replacing, or metadata. */
export type ImageDialogMode = 'insert' | 'replace' | 'alt';

export type ComposerContext =
 | {kind:'text'} | {kind:'table'}
 | {kind:'equation';pos:number;display:boolean;latex:string}
 | {kind:'image';pos:number;attrs:Record<string,unknown>;mode?:ImageDialogMode};

/** An object the author has selected: things that own their own controls. */
export type ComposerObjectContext = Extract<ComposerContext, {kind:'image'} | {kind:'equation'}>;

/** Node kind is authoritative: blockMath/inlineMath are different schema nodes. */
export function resolveComposerContext(state:EditorState):ComposerContext {
 const selection=state.selection;
 if ('node' in selection) {
  const node=selection.node as {type:{name:string};attrs:Record<string,unknown>};
  if(node.type.name==='image')return {kind:'image',pos:selection.from,attrs:node.attrs};
  if(node.type.name==='inlineMath'||node.type.name==='blockMath')return {kind:'equation',pos:selection.from,display:node.type.name==='blockMath',latex:String(node.attrs['latex']??'')};
 }
 for(let depth=selection.$from.depth;depth>0;depth--)if(selection.$from.node(depth).type.name==='table')return {kind:'table'};
 return {kind:'text'};
}

/** What the author currently has hold of, in the editor's three-state model. */
export function selectionKindOf(state:EditorState):'text'|'node'|'table' {
 if (state.selection instanceof NodeSelection) return 'node';
 for (let depth=state.selection.$from.depth;depth>0;depth--) {
  if (state.selection.$from.node(depth).type.name==='table') return 'table';
 }
 return 'text';
}

/**
 * The object the author selected, or null. Only images and equations are
 * objects with their own controls — text is formatted in place and tables get
 * their own strip, so neither belongs to this decision.
 */
export function resolveObjectBubble(state:EditorState):ComposerObjectContext|null {
 const context=resolveComposerContext(state);
 return context.kind==='image'||context.kind==='equation'?context:null;
}

/**
 * Whether the selection bubble should be offered: a real text range inside an
 * editable editor. A collapsed caret is typing, not selecting, and a node
 * selection belongs to the object, not to the text.
 */
export function resolveTextBubble({state,editable}:{state:EditorState;editable:boolean}):boolean {
 if (!editable) return false;
 const selection=state.selection;
 if (selection instanceof NodeSelection) return false;
 if (selection.empty||selection.from===selection.to) return false;
 return state.doc.textBetween(selection.from,selection.to,' ').trim().length>0;
}
