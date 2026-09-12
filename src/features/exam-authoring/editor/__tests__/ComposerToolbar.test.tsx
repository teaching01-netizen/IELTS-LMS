import {act,fireEvent,render,screen} from '@testing-library/react';
import {Editor} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {TableKit} from '@tiptap/extension-table';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {EditableBlockMath,EditableInlineMath} from '../EditableMathExtension';
import {SatImage} from '../SatImageExtension';
import {ComposerToolbar} from '../ComposerToolbar';
import {SAT_RICH_COMPOSER_CAPABILITIES as capabilities} from '../RichQuestionComposer';
const editors:Editor[]=[];afterEach(()=>editors.splice(0).forEach(e=>e.destroy()));
function make(content:object){const e=new Editor({extensions:[StarterKit,TableKit,EditableInlineMath,EditableBlockMath,SatImage],content});editors.push(e);return e;}
describe('contextual toolbar',()=>{
 it('edits and converts the selected equation without losing its expression',()=>{const e=make({type:'doc',content:[{type:'blockMath',attrs:{latex:'x^2'}}]});e.commands.setNodeSelection(0);const open=vi.fn();render(<ComposerToolbar editor={e} capabilities={capabilities} onOpenDialog={open} onTableMutation={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Edit equation'}));expect(open).toHaveBeenCalledWith('math',expect.objectContaining({pos:0,latex:'x^2',display:true}));fireEvent.click(screen.getByRole('button',{name:'Inline equation'}));expect(JSON.stringify(e.getJSON())).toContain('inlineMath');expect(JSON.stringify(e.getJSON())).toContain('x^2');});
 it('targets the selected image for metadata editing rather than inserting another',()=>{const e=make({type:'doc',content:[{type:'image',attrs:{src:'https://example.test/image.png',alt:'Graph',assetId:'asset-1'}}]});e.commands.setNodeSelection(0);const open=vi.fn();render(<ComposerToolbar editor={e} capabilities={capabilities} onOpenDialog={open} onTableMutation={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Edit alternative text'}));expect(open).toHaveBeenCalledWith('image',expect.objectContaining({pos:0,attrs:expect.objectContaining({assetId:'asset-1'})}));fireEvent.click(screen.getByRole('button',{name:'Delete image'}));expect(JSON.stringify(e.getJSON())).not.toContain('asset-1');});
 it('switches to table actions without mounting another toolbar',()=>{const e=make({type:'doc',content:[{type:'paragraph'}]});render(<ComposerToolbar editor={e} capabilities={capabilities} onOpenDialog={vi.fn()} onTableMutation={vi.fn()}/>);act(()=>{e.commands.insertTable({rows:2,cols:2});});expect(screen.getByRole('button',{name:'Add row'})).toBeInTheDocument();expect(screen.getAllByRole('toolbar')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Table actions'}));fireEvent.click(screen.getByRole('menuitem',{name:'Delete table'}));expect(screen.getByRole('button',{name:'Insert content'})).toBeInTheDocument();});
});
