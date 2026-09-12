import {useId,type ReactNode} from 'react';
import type {AssessmentValidationIssue} from '../../contracts/assessment';
import type {AuthoringField} from './readinessFamilies';
export function SectionRule({title,field,required=false,actions,issues=[],children}:{title:string;field?:AuthoringField;required?:boolean;actions?:ReactNode;issues?:AssessmentValidationIssue[];children:ReactNode}) {
 const id=useId();return <section className="sat-spine__section" data-authoring-field={field} aria-labelledby={id+'-heading'} aria-describedby={issues.length?id+'-errors':undefined} tabIndex={-1}>
 <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3"><h3 id={id+'-heading'} className="text-sm font-semibold text-foreground">{title}<span aria-hidden="true" className="ml-2 text-xs font-normal text-muted-foreground">{required?'Required':'Optional'}</span></h3>{actions}</div>
 {children}{issues.length?<ul id={id+'-errors'} className="mt-2 space-y-1 text-xs">{issues.map((issue,index)=><li key={issue.code+'-'+index} className={issue.blocking?'text-destructive':'text-muted-foreground'}>{issue.message}</li>)}</ul>:null}</section>;
}
