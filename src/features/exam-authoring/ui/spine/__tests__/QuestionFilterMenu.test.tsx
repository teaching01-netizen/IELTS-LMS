import { fireEvent,render,screen } from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {QuestionFilterMenu} from '../QuestionFilterMenu';
describe('QuestionFilterMenu',()=>{it('shows real counts only and forwards stable filter IDs',()=>{const change=vi.fn();render(<QuestionFilterMenu filter="all" counts={{ready:2,incomplete:1,error:0}} onFilterChange={change}/>);fireEvent.click(screen.getByRole('button',{name:'Question readiness filters'}));expect(screen.getByRole('menuitem',{name:'Has errors'})).toBeInTheDocument();fireEvent.click(screen.getByRole('menuitem',{name:'Needs attention (1)'}));expect(change).toHaveBeenCalledWith('incomplete');});});
