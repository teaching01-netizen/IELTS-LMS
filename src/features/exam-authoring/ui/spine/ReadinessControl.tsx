import {Check,AlertCircle} from 'lucide-react';
import {SatMenu} from '@/src/products/sat/ui/Menu';
import type {AssessmentValidationIssue} from '../../contracts/assessment';
import {FIELD_LABELS,resolveAuthoringField} from './readinessFamilies';

/**
 * Question readiness as one product-wide status vocabulary: dot + label, the
 * same shape the session screen uses. It is also the jump menu into each
 * blocking field, so the status is actionable without adding another control.
 */
export function ReadinessControl({issues,onIssueSelect}:{issues:AssessmentValidationIssue[];onIssueSelect:(field:string|null)=>void}) {
 const blockers=issues.filter(i=>i.blocking).length;
 const label=blockers?blockers+' '+(blockers===1?'issue':'issues'):issues.length?'Review suggestions':'Question ready';
 const tone=blockers?'danger':issues.length?'warning':'success';
 return <div className="sat-spine__menu"><SatMenu label={label} icon={blockers?AlertCircle:Check} triggerContent={<span className={'sat-spine__status '+(tone==='danger'?'sat-spine__status--danger':tone==='warning'?'sat-spine__status--warning':'sat-spine__status--success')}>{label}</span>} items={issues.length?issues.map((issue,index)=>({id:issue.code+'-'+index,label:FIELD_LABELS[resolveAuthoringField(issue.path||issue.field||null)]+': '+issue.message,onSelect:()=>onIssueSelect(issue.path||issue.field||null)})):[{id:'ready',label:'No question blockers. Exam release checks still apply.',disabled:true,onSelect:()=>undefined}]} align="end"/></div>;
}
