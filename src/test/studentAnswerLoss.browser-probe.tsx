import React from 'react';
import {createRoot} from 'react-dom/client';
import {StudentWriting} from '../components/student/StudentWriting';
import {ProtectedInput} from '../components/student/ProtectedInput';
import {createDefaultConfig} from '../constants/examDefaults';

type AuditHarness = {
 commits: Array<[string, string]>;
 latest: Record<string, string>;
 objective: string;
 bump: () => void;
 navigate: (id: string) => void;
 show: (visible: boolean) => void;
};

const config=createDefaultConfig('Academic','Academic');
config.sections.writing.tasks=[{id:'task1',label:'Task 1',taskType:'task1-academic',minWords:150,recommendedTime:20},{id:'task2',label:'Task 2',taskType:'task2-essay',minWords:250,recommendedTime:40}];
const exam={title:'Audit',type:'Academic',activeModule:'writing',activePassageId:'p1',activeListeningPartId:'l1',config,reading:{passages:[]},listening:{parts:[]},writing:{task1Prompt:'Prompt 1',task2Prompt:'Prompt 2',tasks:[],customPromptTemplates:[]},speaking:{part1Topics:[],cueCard:'',part3Discussion:[]}} as any;
const audit: AuditHarness = {commits:[],latest:{},objective:'',bump:()=>{},navigate:()=>{},show:()=>{}};
(window as any).audit=audit;
function Harness(){
 const [answers,setAnswers]=React.useState({task1:'old long answer',task2:'second answer'});
 const [id,setId]=React.useState('task1'); const [show,setShow]=React.useState(true);const [n,setN]=React.useState(0); const [objective,setObjective]=React.useState('base');
 audit.bump=()=>{setN(x=>x+1);setAnswers(a=>({...a}));};audit.navigate=setId;audit.show=setShow;audit.latest=answers;audit.objective=objective;
 return <><ProtectedInput aria-label="Objective probe" value={objective} security={{preventAutofill:true,preventAutocorrect:true}} onChange={e=>setObjective(e.target.value)} data-n={n}/>{show&&<StudentWriting state={exam} writingAnswers={answers} onWritingChange={(task,text)=>{audit.commits.push([task,text]);setAnswers(a=>({...a,[task]:text}));}} onSubmit={()=>{}} currentQuestionId={id} onNavigate={setId}/>}</>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
