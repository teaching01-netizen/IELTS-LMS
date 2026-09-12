import {Check,AlertCircle} from 'lucide-react';
import {SatMenu} from '@/src/products/sat/ui/Menu';
import type {AssessmentValidationIssue} from '../../contracts/assessment';
import {FIELD_LABELS,resolveAuthoringField} from './readinessFamilies';
export function ReadinessControl({issues,onIssueSelect}:{issues:AssessmentValidationIssue[];onIssueSelect:(field:string|null)=>void}) {
 const blockers=issues.filter(i=>i.blocking).length;
 const label=blockers?blockers+' '+(blockers===1?'issue':'issues'):issues.length?'Review suggestions':'Question ready';
 return <div className="sat-spine__menu"><SatMenu label={label} icon={blockers?AlertCircle:Check} triggerContent={<span className={'flex items-center gap-1.5 text-xs '+(blockers?'text-destructive':'text-muted-foreground')}>{blockers?<AlertCircle size={14} aria-hidden="true"/>:<Check size={14} aria-hidden="true"/>}{label}</span>} items={issues.length?issues.map((issue,index)=>({id:issue.code+'-'+index,label:FIELD_LABELS[resolveAuthoringField(issue.path||issue.field||null)]+': '+issue.message,onSelect:()=>onIssueSelect(issue.path||issue.field||null)})):[{id:'ready',label:'No question blockers. Exam release checks still apply.',disabled:true,onSelect:()=>undefined}]} align="end"/></div>;
}
