import {fireEvent,render,screen,within} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {Inspector} from '../Inspector';
import type {QuestionRevision} from '../../../contracts/assessment';
const content={version:2 as const,nodes:[],document:{type:'doc' as const,content:[{type:'paragraph' as const}]}};
const question:QuestionRevision={id:'r1',questionId:'q1',state:'draft',revision:1,semanticRevision:1,questionType:'single_choice',prompt:content,stimulus:content,rationale:content,answer:{kind:'single_choice',options:[],correctOptionId:null},metadata:{sectionKey:'math',domain:null,skill:null,difficulty:'medium',tags:[]},accessibility:{longDescription:null}};
describe('Inspector',()=>{
 it('is a nonmodal region on wide screens, a real dialog on narrow screens',()=>{const props={open:true,modal:false,question,issues:[],onChange:vi.fn(),onClose:vi.fn()};const {rerender}=render(<Inspector {...props}/>);expect(screen.getByRole('region',{name:'Question inspector'})).toBeInTheDocument();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();rerender(<Inspector {...props} modal/>);expect(screen.getByRole('dialog',{name:'Question settings'})).toBeInTheDocument();expect(screen.getAllByLabelText('Domain')).toHaveLength(1);});
 it('edits existing accessibility data through the draft callback',()=>{const change=vi.fn();render(<Inspector open modal={false} question={question} issues={[]} onChange={change} onClose={vi.fn()}/>);fireEvent.change(screen.getByLabelText('Long description'),{target:{value:'Detailed graph data'}});expect(change).toHaveBeenCalledWith({...question,accessibility:{longDescription:'Detailed graph data'}});});
 it('closes only the focused nonmodal panel with Escape',()=>{const close=vi.fn();render(<Inspector open modal={false} question={question} issues={[]} onChange={vi.fn()} onClose={close}/>);fireEvent.keyDown(within(screen.getByRole('region',{name:'Question inspector'})).getByLabelText('Domain'),{key:'Escape'});expect(close).toHaveBeenCalledOnce();});
});
