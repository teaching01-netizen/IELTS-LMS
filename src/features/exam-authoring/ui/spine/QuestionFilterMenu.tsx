import { ListFilter } from 'lucide-react';
import { SatMenu } from '@/src/products/sat/ui/Menu';
import type { SpineQueueCounts, SpineQueueFilter } from './queueModel';
export function QuestionFilterMenu({filter,counts,onFilterChange}:{filter:SpineQueueFilter;counts:SpineQueueCounts;onFilterChange:(filter:SpineQueueFilter)=>void}) {
 const choices = [['all','All questions'],['ready','Ready'],['incomplete','Needs attention'],['error','Has errors']] as const;
 return <div className="sat-spine__menu"><SatMenu compact icon={ListFilter} label="Question readiness filters" align="end" items={choices.map(([id,label])=>({id,label:label+((id==='all'?counts.ready+counts.incomplete+counts.error:counts[id])>0?' ('+(id==='all'?counts.ready+counts.incomplete+counts.error:counts[id])+')':''),current:filter===id,onSelect:()=>onFilterChange(id)}))} /></div>;
}
