import { useEffect, useRef, useState } from 'react';
import {Check,AlertCircle} from 'lucide-react';
import {SatMenu} from '@/src/products/sat/ui/Menu';
import type {AssessmentValidationIssue} from '../../contracts/assessment';
import {FIELD_LABELS,resolveAuthoringField} from './readinessFamilies';

/** How long a state *change* is allowed to be loud. */
const READY_FLASH_MS = 1500;

/**
 * Question readiness as one product-wide status vocabulary: dot + label, the
 * same shape the session screen uses. It is also the jump menu into each
 * blocking field, so the status is actionable without adding another control.
 *
 * Status is metadata, so it stays calmer than the document it describes: at
 * rest it is a neutral dot and a word. Strong green is spent only where it
 * carries information — the moment the question becomes ready — and then it
 * settles back. The editor is the loudest thing on the page, not its lifecycle.
 */
export function ReadinessControl({issues,onIssueSelect}:{issues:AssessmentValidationIssue[];onIssueSelect:(field:string|null)=>void}) {
 const blockers=issues.filter(i=>i.blocking).length;
 const label=blockers?blockers+' '+(blockers===1?'issue':'issues'):issues.length?'Review suggestions':'Question ready';
 const ready=!blockers&&!issues.length;
 // Ready is the quiet default; only a *change* into it earns the accent, which
 // the flash below adds.
 const tone=blockers?'danger':issues.length?'warning':'neutral';
 const [flashReady,setFlashReady]=useState(false);
 const previousReady=useRef<boolean|undefined>(undefined);

 useEffect(()=>{
  const wasReady=previousReady.current;
  previousReady.current=ready;
  if (wasReady!==false||!ready) return;
  setFlashReady(true);
  const timer=window.setTimeout(()=>setFlashReady(false),READY_FLASH_MS);
  return ()=>window.clearTimeout(timer);
 },[ready]);

 const toneClass=
  tone==='danger'?'sat-spine__status--danger':
  tone==='warning'?'sat-spine__status--warning':
  flashReady?'sat-spine__status--success':'sat-spine__status--neutral';

 return <div className="sat-spine__menu"><SatMenu label={label} icon={blockers?AlertCircle:Check} triggerContent={<span className={'sat-spine__status '+toneClass}>{label}</span>} items={issues.length?issues.map((issue,index)=>({id:issue.code+'-'+index,label:FIELD_LABELS[resolveAuthoringField(issue.path||issue.field||null)]+': '+issue.message,onSelect:()=>onIssueSelect(issue.path||issue.field||null)})):[{id:'ready',label:'No question blockers. Exam release checks still apply.',disabled:true,onSelect:()=>undefined}]} align="end"/></div>;
}
