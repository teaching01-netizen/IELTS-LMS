import {useMemo,useState} from 'react';
import {Command} from 'cmdk';
import type {AssessmentQuestionSummary} from '../../contracts/assessment';
import {AuthoringDialog} from '../authoringPrimitives';
import {matchesQueueSearch,normalizeQueueSearch} from './queueModel';
export interface AuthoringCommand {id:string;label:string;group:'Question'|'Exam'|'View';onSelect:()=>void;disabledReason?:string|undefined;}
export interface CommandPaletteProps {open:boolean;questions:AssessmentQuestionSummary[];selectedQuestionId:string|null;onSelect:(id:string)=>void;onClose:()=>void;commands?:AuthoringCommand[]|undefined;}
export function CommandPalette(props:CommandPaletteProps){return props.open?<PaletteContent {...props}/>:null;}
function PaletteContent({questions,selectedQuestionId,onSelect,onClose,commands=[]}:CommandPaletteProps){
 const [query,setQuery]=useState('');const normalized=normalizeQueueSearch(query);
 const filtered=useMemo(()=>questions.filter(q=>matchesQueueSearch(q,normalized)),[questions,normalized]);
 const actions=commands.filter(c=>normalizeQueueSearch(c.label+' '+c.group).includes(normalized));
 const choose=(action:()=>void)=>{onClose();action();};
 return <AuthoringDialog open title="Command palette" ariaLabel="Jump to question" description="Find questions or run an authoring command." onClose={onClose} showHeader={false} contentClassName="max-w-xl p-0"><Command label="Jump to question" shouldFilter={false} className="overflow-hidden rounded-xl bg-card"><Command.Input autoFocus data-dialog-initial-focus value={query} onValueChange={setQuery} aria-label="Jump to question" placeholder="Search questions and commands…" className="min-h-14 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"/><Command.List className="max-h-[60vh] overflow-y-auto overscroll-contain p-2">
 {filtered.length?<Command.Group heading="Jump to question" className="text-xs text-muted-foreground">{filtered.map(q=><Command.Item key={q.examQuestionId} value={q.examQuestionId} onSelect={()=>choose(()=>onSelect(q.examQuestionId))} aria-label={'Question '+(q.displayOrder+1)+': '+(q.promptPreview||'Empty question')+(q.examQuestionId===selectedQuestionId?', current':'')} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground aria-selected:bg-muted"><span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{q.displayOrder+1}</span><span className="min-w-0 truncate">{q.promptPreview||'Empty question'}</span></Command.Item>)}</Command.Group>:null}
 {(['Question','Exam','View'] as const).map(group=>{const items=actions.filter(c=>c.group===group);return items.length?<Command.Group key={group} heading={group} className="mt-3 text-xs text-muted-foreground">{items.map(c=><Command.Item key={c.id} value={c.id} disabled={Boolean(c.disabledReason)} onSelect={()=>choose(c.onSelect)} className="flex min-h-11 cursor-pointer flex-col items-start justify-center rounded-md px-3 py-2 text-sm text-foreground aria-selected:bg-muted aria-disabled:cursor-default aria-disabled:text-muted-foreground"><span>{c.label}</span>{c.disabledReason?<span className="text-xs text-muted-foreground">{c.disabledReason}</span>:null}</Command.Item>)}</Command.Group>:null;})}
 {!filtered.length&&!actions.length?<p className="px-3 py-8 text-center text-sm text-muted-foreground">No matching questions or commands.</p>:null}
 </Command.List><p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">↑ ↓ to choose · Enter to run · Esc to close</p></Command></AuthoringDialog>;
}
