import {MoreHorizontal} from 'lucide-react';
import {SatMenu} from '@/src/products/sat/ui/Menu';
import type {AssessmentValidationIssue} from '../../contracts/assessment';
import {ReadinessControl} from './ReadinessControl';
export function QuestionHeader({number,issues,onIssueSelect,onPreview,onDuplicate,onDelete,onMove,onSettings,busy=false,canMoveUp=false,canMoveDown=false}:{number?:number|undefined;issues:AssessmentValidationIssue[];onIssueSelect:(field:string|null)=>void;onPreview:()=>void;onDuplicate:()=>void;onDelete:()=>void;onMove?:((direction:-1|1)=>void)|undefined;onSettings?:(()=>void)|undefined;busy?:boolean|undefined;canMoveUp?:boolean|undefined;canMoveDown?:boolean|undefined}) {
 return <header className="mb-12 flex flex-wrap items-start justify-between gap-3"><h2 id="spine-question-heading" className="text-[var(--spine-text-display)] font-semibold tracking-tight text-foreground">{number?'Question '+number:'Edit question'}</h2><div className="flex items-center gap-1"><ReadinessControl issues={issues} onIssueSelect={onIssueSelect}/>{onSettings?<button type="button" onClick={onSettings} className="hidden min-h-11 px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:block">Settings</button>:null}<div className="sat-spine__menu"><SatMenu compact label="Question actions" icon={MoreHorizontal} align="end" items={[
 {id:'preview',label:'Preview question as students will see it',onSelect:onPreview},
 {id:'duplicate',label:'Duplicate question',disabled:busy,onSelect:onDuplicate},
 {id:'up',label:'Move up',disabled:busy||!canMoveUp||!onMove,onSelect:()=>onMove?.(-1)},
 {id:'down',label:'Move down',disabled:busy||!canMoveDown||!onMove,onSelect:()=>onMove?.(1)},
 {id:'settings',label:'Question settings',disabled:!onSettings,onSelect:()=>onSettings?.()},
 {id:'delete',label:'Delete question',destructive:true,separatorBefore:true,disabled:busy,onSelect:onDelete},
 ]}/></div></div></header>;
}
