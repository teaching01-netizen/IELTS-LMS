import {useId,type ReactNode} from 'react';
import {AlertCircle} from 'lucide-react';
import type {AssessmentValidationIssue} from '../../contracts/assessment';
import type {AuthoringField} from './readinessFamilies';

/**
 * Spine section rule (plan Phase 4, refined).
 *
 * Structure comes from one soft hairline plus real vertical space, never from
 * a card. Required is the default assumption — the header only speaks up for
 * the exceptional case (`Optional`) — and validation is one quiet line under
 * the field rather than a banner beside it. The section title stays the
 * strongest thing in the header; everything else is metadata.
 */
export function SectionRule({title,field,hint='Optional',actions,issues=[],children}:{title:string;field?:AuthoringField;hint?:string;actions?:ReactNode;issues?:AssessmentValidationIssue[];children:ReactNode}) {
 const id=useId();
 const blocking=issues.filter(issue=>issue.blocking);
 const warnings=issues.filter(issue=>!issue.blocking);
 const first=blocking[0]??warnings[0];
 const tone=blocking.length?'danger':'warning';
 return <section className="sat-spine__section" data-authoring-field={field} data-field-state={first?tone:undefined} aria-labelledby={id+'-heading'} aria-describedby={first?id+'-errors':undefined} tabIndex={-1}>
 <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
   <h3 id={id+'-heading'} className="flex items-baseline gap-2 text-[15px] font-semibold tracking-[-0.01em] text-foreground">
     {title}
     {hint?<span aria-hidden="true" className="text-xs font-normal text-muted-foreground">{hint}</span>:null}
     {first?<span className={'sat-spine__status '+(tone==='danger'?'sat-spine__status--danger':'sat-spine__status--warning')}>{blocking.length?`${blocking.length} to fix`:'Review'}</span>:null}
   </h3>
   {actions}
 </div>
 {children}
 {first?<p id={id+'-errors'} className="sat-spine__field-error"><AlertCircle size={14} aria-hidden="true" className="mt-px shrink-0"/><span>{first.message}</span></p>:null}
 {issues.length>1?<ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">{issues.slice(1).map((issue,index)=><li key={issue.code+'-'+index}>{issue.message}</li>)}</ul>:null}
 </section>;
}
