import type { EditorState } from '@tiptap/pm/state';
export type ComposerContext =
 | {kind:'text'} | {kind:'table'}
 | {kind:'equation';pos:number;display:boolean;latex:string}
 | {kind:'image';pos:number;attrs:Record<string, unknown>};
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
