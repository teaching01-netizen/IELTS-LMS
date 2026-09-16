/** Temporary, audit-only probes. Assertions encode the required safe behavior. */
import React from 'react';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DurableResponseEngine, type TransportClient } from '../shared/durability/DurableResponseEngine';
import { getVisibleResponse } from '../shared/durability/types';
import { StudentWriting } from '../components/student/StudentWriting';
import { ProtectedInput } from '../components/student/ProtectedInput';
import { createDefaultConfig } from '../constants/examDefaults';
import type { ExamState } from '../types';

const engines: DurableResponseEngine[] = [];
const payload = (answer: string) => ({answer, markedForReview: false, eliminatedOptions: [], annotations: []});
const makeEngine = (fetchSnapshot: TransportClient['fetchSnapshot'] = async () => []) => {
  const engine = new DurableResponseEngine({scheduleId:'probe-s',attemptId:'probe-a',leaseEpoch:1,controlEpoch:1,drainDebounceMs:60_000,
    transport:{fetchSnapshot,sendBatch:vi.fn(),submit:vi.fn()}});
  engines.push(engine); return engine;
};
function state(): ExamState {
  const config = createDefaultConfig('Academic','Academic');
  config.sections.writing.tasks = [
    {id:'task1',label:'Task 1',taskType:'task1',minWords:150,recommendedTime:20},
    {id:'task2',label:'Task 2',taskType:'task2',minWords:250,recommendedTime:40},
  ];
  return {title:'Audit',type:'Academic',activeModule:'writing',activePassageId:'p1',activeListeningPartId:'l1',config,
    reading:{passages:[]},listening:{parts:[]},writing:{task1Prompt:'Prompt 1',task2Prompt:'Prompt 2',tasks:[],customPromptTemplates:[]},
    speaking:{part1Topics:[],cueCard:'',part3Discussion:[]}};
}
beforeEach(() => {localStorage.clear();});
afterEach(() => {cleanup(); engines.splice(0).forEach(e=>e.destroy());vi.useRealTimers();vi.restoreAllMocks();});

describe('temporary answer-loss audit probes', () => {
  it('restores a synchronous checkpoint after immediate teardown and fresh recovery', async () => {
    const first = makeEngine();
    const accepted = first.acceptResponse('q1',payload('latest typed answer'));
    const raw = JSON.parse(localStorage.getItem('response-checkpoint:v2:probe-a:q1')!);
    first.destroy(); await accepted;
    const second = makeEngine(); await second.recover();
    console.log('PROBE checkpoint/reload', {storedVersion:raw.clientVersion,storedAnswer:raw.payload.answer,recovered:getVisibleResponse(second.getStates().get('q1'))});
    expect(getVisibleResponse(second.getStates().get('q1'))?.answer).toBe('latest typed answer');
  });

  it('restores the last keystroke after immediate teardown of an already recovered engine', async () => {
    const first=makeEngine();await first.recover();
    const accepted=first.acceptResponse('q1',payload('hot engine keystroke'));
    first.destroy();await accepted;
    const second=makeEngine();await second.recover();
    console.log('PROBE hot-engine/reload',{recovered:getVisibleResponse(second.getStates().get('q1'))});
    expect(getVisibleResponse(second.getStates().get('q1'))?.answer).toBe('hot engine keystroke');
  });

  it('restores typing checkpointed during a slow initial snapshot after teardown', async () => {
    let resolve!: (v: []) => void;
    const pending = new Promise<[]>((r)=>{resolve=r;});
    const fetch = vi.fn().mockReturnValue(pending);
    const first = makeEngine(fetch); const recovery = first.recover();
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalled());
    const accepted = first.acceptResponse('q1',payload('typed during recovery'));
    // Let real fallback storage persist it, but keep version initialization pending.
    await vi.waitFor(()=>expect(localStorage.getItem('warwick_durable_draft_v1:v2_attempt_probe-a_q1')).not.toBeNull());
    first.destroy(); resolve([]); await recovery; await accepted;
    const second = makeEngine(); await second.recover();
    console.log('PROBE slow-recovery/reload', {checkpoint:JSON.parse(localStorage.getItem('response-checkpoint:v2:probe-a:q1')!),recovered:getVisibleResponse(second.getStates().get('q1'))});
    expect(getVisibleResponse(second.getStates().get('q1'))?.answer).toBe('typed during recovery');
  });

  it('does not reset a DOM-only edit on an unrelated parent render before blur', () => {
    let redraw!: () => void; let saved='base';
    function Harness(){const [n,setN]=React.useState(0);const [answer,setAnswer]=React.useState('base');redraw=()=>setN(n+1);
      return <ProtectedInput security={{preventAutofill:true,preventAutocorrect:true}} value={answer} onChange={e=>{saved=e.target.value;setAnswer(e.target.value);}} data-render={n}/>;}
    render(<Harness/>);const input=screen.getByRole('textbox') as HTMLInputElement;
    input.value='base plus unseen typing';
    act(()=>redraw());fireEvent.blur(input);
    console.log('PROBE objective DOM rerender',{dom:input.value,saved});
    expect(input.value).toBe('base plus unseen typing');
    expect(saved).toBe('base plus unseen typing');
  });

  it('keeps same-length local writing after a stale prop arrives while unfocused', () => {
    vi.useFakeTimers();const change=vi.fn();const exam=state();
    const props={state:exam,onWritingChange:change,onSubmit:()=>{},currentQuestionId:'task1',onNavigate:()=>{}};
    const view=render(<StudentWriting {...props} writingAnswers={{task1:'OLD'}}/>);
    const editor=screen.getByRole('textbox',{name:/writing response/i}) as HTMLTextAreaElement;
    fireEvent.change(editor,{target:{value:'NEW'}});
    view.rerender(<StudentWriting {...props} writingAnswers={{task1:'OLD'}}/>);
    console.log('PROBE equal-length writing',{dom:editor.value,commits:change.mock.calls});
    expect(editor.value).toBe('NEW');
  });

  it('keeps a focused shorter correction across stale hydration and unmount before debounce', () => {
    vi.useFakeTimers();const change=vi.fn();const exam=state();
    const props={state:exam,onWritingChange:change,onSubmit:()=>{},currentQuestionId:'task1',onNavigate:()=>{}};
    const view=render(<StudentWriting {...props} writingAnswers={{task1:'old long answer'}}/>);
    const editor=screen.getByRole('textbox',{name:/writing response/i});
    fireEvent.focus(editor);fireEvent.change(editor,{target:{value:'new'}});
    view.rerender(<StudentWriting {...props} writingAnswers={{task1:'old long answer'}}/>);
    expect(editor).toHaveValue('new');
    view.unmount();
    console.log('PROBE shorter correction/unmount',{commits:change.mock.calls});
    expect(change).toHaveBeenCalledWith('task1','new');
  });

  it('does not leave response sync status saved while a provisional edit waits on recovery', async () => {
    let resolve!: (v:[])=>void; const pending=new Promise<[]>(r=>{resolve=r;});const fetch=vi.fn().mockReturnValue(pending);
    const first=makeEngine(fetch); const recovery=first.recover();await vi.waitFor(()=>expect(fetch).toHaveBeenCalled());
    const accepted=first.acceptResponse('q1',payload('new not acknowledged'));
    await vi.waitFor(()=>expect(localStorage.getItem('warwick_durable_draft_v1:v2_attempt_probe-a_q1')).not.toBeNull());
    console.log('PROBE pending vs sync status',{status:first.getStatus(),queueCount:first.getPendingCount(),visiblePending:first.getStates().get('q1')?.pending?.payload.answer});
    const statusAfter=first.getStatus();first.destroy();resolve([]);await recovery;await accepted;
    expect(statusAfter).not.toBe('synced');
  });

  it.each([100,101])('keeps each emitted batch within the server cap when replaying %i questions', async (count) => {
    const batches:number[]=[];
    const transport:TransportClient={fetchSnapshot:async()=>[],submit:vi.fn(),sendBatch:async (_id,req)=>{
      batches.push(req.commands.length);
      // Independent envelope-size oracle: the real Go limit is 100. Echo acks
      // only to terminate the probe; this does not pretend Go accepted >100.
      return {attemptRevision:1,serverTime:new Date().toISOString(),acknowledgements:req.commands.map(c=>({questionId:c.questionId,writeId:c.writeId,clientVersion:c.clientVersion,outcome:'applied' as const,serverRevision:1,contentHash:'x',canonicalResponse:c.response}))};
    }};
    const first=new DurableResponseEngine({scheduleId:'probe-s',attemptId:'batch-probe',leaseEpoch:1,controlEpoch:1,drainDebounceMs:60_000,transport});engines.push(first);
    await first.recover();await Promise.all(Array.from({length:count},(_,i)=>first.acceptResponse('q'+i,payload('answer'))));await first.flush();
    console.log('PROBE batch cap',{count,batches});
    expect(batches.length).toBeGreaterThan(0);expect(batches.every(n=>n<=100)).toBe(true);
  });

  it('isolates task answers on external task navigation while textarea retains focus', () => {
    const exam=state();let navigate!: (id:string)=>void;const commits:unknown[]=[];
    function Harness(){const [answers,setAnswers]=React.useState({task1:'Answer one',task2:'Answer two'});const [id,setId]=React.useState('task1');navigate=setId;
      return <StudentWriting state={exam} writingAnswers={answers} onWritingChange={(task,text)=>{commits.push([task,text]);setAnswers(a=>({...a,[task]:text}));}} onSubmit={()=>{}} currentQuestionId={id} onNavigate={setId}/>;}
    render(<Harness/>);const editor=screen.getByRole('textbox',{name:/writing response/i}) as HTMLTextAreaElement;
    fireEvent.focus(editor);fireEvent.change(editor,{target:{value:'Answer one revised'}});
    act(()=>navigate('task2'));
    console.log('PROBE focused task switch',{task:editor.dataset.taskId,dom:editor.value,commits});
    expect(editor.dataset.taskId).toBe('task2');expect(editor.value).toBe('Answer two');
  });
});
