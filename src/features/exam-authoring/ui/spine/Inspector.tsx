import {useEffect,useRef} from 'react';
import {X} from 'lucide-react';
import {Sheet,SheetContent,SheetDescription,SheetHeader,SheetTitle} from '@/src/components/ui/sheet';
import type {AssessmentValidationIssue,QuestionRevision} from '../../contracts/assessment';
import {ClassificationFieldset} from './ClassificationFieldset';
import {ItemSettingsInspector} from './ItemSettingsInspector';
export interface InspectorProps {open:boolean;modal:boolean;question:QuestionRevision;issues:AssessmentValidationIssue[];onChange:(q:QuestionRevision)=>void;onClose:()=>void;isPretest?:boolean|undefined;onPretestChange?:((next:boolean)=>void)|undefined;readOnly?:boolean|undefined;}
export function Inspector({open,modal,question,issues,onChange,onClose,isPretest,onPretestChange,readOnly=false}:InspectorProps){
 const panel=useRef<HTMLElement>(null);
 useEffect(()=>{if(open&&!modal)panel.current?.querySelector<HTMLElement>('select,input,textarea')?.focus({preventScroll:true});},[open,modal]);
 if(!open)return null;
 const content=<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5"><ClassificationFieldset question={question} onChange={onChange} issues={issues} readOnly={readOnly}/><ItemSettingsInspector question={question} issues={issues} onChange={onChange} isPretest={isPretest} onPretestChange={onPretestChange} readOnly={readOnly}/></div>;
 const close=<button type="button" aria-label="Close question settings" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"><X size={17} aria-hidden="true"/></button>;
 if(modal)return <Sheet open onOpenChange={next=>{if(!next)onClose();}}><SheetContent side="right" showCloseButton={false} className="sat-product sat-spine-inspector-sheet flex w-[min(92vw,340px)] max-w-[340px] flex-col gap-0 p-0"><SheetHeader className="flex-row items-center justify-between border-b border-border px-5 py-2"><div><SheetTitle>Question settings</SheetTitle><SheetDescription className="sr-only">Classification and item settings for the current question.</SheetDescription></div>{close}</SheetHeader>{content}</SheetContent></Sheet>;
 // Escape bubbles from the panel controls; this is intentionally not a modal on desktop.
 // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
 return <aside ref={panel} role="region" aria-label="Question inspector" className="sat-spine__inspector" onKeyDown={e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!(e.target as HTMLElement).closest('[role=dialog],[role=menu]')){e.stopPropagation();onClose();}}}><header className="flex items-center justify-between border-b border-border px-5 py-2"><h2 className="text-sm font-semibold">Question settings</h2>{close}</header>{content}</aside>;
}
