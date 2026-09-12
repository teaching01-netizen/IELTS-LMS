import type {AssessmentValidationIssue} from '../../contracts/assessment';
export type AuthoringField='prompt'|'stimulus'|'answer'|'rationale'|'domain'|'skill'|'difficulty'|'tags'|'accessibility';
/** Validator paths and public aliases converge here; nested image errors stay with their content. */
export function resolveAuthoringField(path:string|null):AuthoringField {
 const p=path??'';
 if(p==='explanation'||p.startsWith('rationale'))return 'rationale';
 if(p.startsWith('stimulus'))return 'stimulus';
 if(p.startsWith('prompt'))return 'prompt';
 for(const field of ['domain','skill','difficulty','tags'] as const)if(p===field||p.startsWith('metadata.'+field))return field;
 if(p.startsWith('accessibility'))return 'accessibility';
 return 'answer';
}
export function issuesForField(issues:AssessmentValidationIssue[],field:AuthoringField){return issues.filter(issue=>resolveAuthoringField(issue.path||issue.field||null)===field);}
export const FIELD_LABELS:Record<AuthoringField,string>={prompt:'Question',stimulus:'Supporting material',answer:'Answer',rationale:'Explanation',domain:'Domain',skill:'Skill',difficulty:'Difficulty',tags:'Tags',accessibility:'Accessibility'};
