import React from 'react';
import {act, renderHook, waitFor, cleanup} from '@testing-library/react';
import {beforeEach, afterEach, expect, it, vi} from 'vitest';
import {createDefaultConfig} from '../constants/examDefaults';
import type {ExamState} from '../types';
import type {StudentAttempt} from '../types/studentAttempt';
import {StudentAttemptProvider,useStudentAttempt} from '../components/student/providers/StudentAttemptProvider';
import {StudentRuntimeProvider,useStudentRuntimeSession} from '../components/student/providers/StudentRuntimeProvider';
const mocks=vi.hoisted(()=>({fetchSnapshot:vi.fn(),sendBatch:vi.fn(),submit:vi.fn()}));
vi.mock('@student/api/responseDurabilityTransport',()=>({createResponseDurabilityV2Transport:()=>mocks,takeOverResponseDurabilityLease:vi.fn()}));
function examState(): ExamState {
  return {
    title: 'Test Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config: createDefaultConfig('Academic', 'Academic'),
    reading: { passages: [{ id: 'p1', title: 'Passage', content: 'Content', blocks: [] }] },
    listening: { parts: [{ id: 'l1', title: 'Part', pins: [], blocks: [] }] },
    writing: { task1Prompt: 'Task 1', task2Prompt: 'Task 2', tasks: [], customPromptTemplates: [] },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
  };
}

function attempt(id: string): StudentAttempt {
  return {
    id,
    scheduleId: 'schedule',
    studentKey: `student-${id}`,
    examId: 'exam',
    examTitle: 'Test Exam',
    candidateId: 'candidate',
    candidateName: 'Candidate',
    candidateEmail: 'candidate@example.com',
    phase: 'exam',
    currentModule: 'reading',
    currentQuestionId: 'q1',
    answers: {},
    writingAnswers: {},
    flags: {},
    violations: [],
    proctorStatus: 'active',
    proctorNote: null,
    proctorUpdatedAt: null,
    proctorUpdatedBy: null,
    lastWarningId: null,
    lastAcknowledgedWarningId: null,
    protocolVersion: 2,
    leaseEpoch: 1,
    controlEpoch: 1,
    integrity: {
      preCheck: null,
      deviceFingerprintHash: null,
      lastDisconnectAt: null,
      lastReconnectAt: null,
      lastHeartbeatAt: null,
      lastHeartbeatStatus: 'idle',
    },
    recovery: {
      lastRecoveredAt: null,
      lastLocalMutationAt: null,
      lastPersistedAt: null,
      pendingMutationCount: 0,
      syncState: 'saved',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();mocks.sendBatch.mockImplementation(()=>new Promise(()=>{}));});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('preserves typed answer when a control-epoch refresh replaces an engine still recovering',async()=>{
 let finishOld!: (v:[])=>void;
 const first=new Promise<[]>(r=>{finishOld=r;});
 const ack={questionId:'q1',writeId:'old-server',clientVersion:1,serverRevision:1,outcome:'applied',contentHash:'hash',canonicalResponse:{answer:'server old',markedForReview:false,eliminatedOptions:[],annotations:[]}};
 mocks.fetchSnapshot.mockReturnValueOnce(first).mockResolvedValue({attemptId:'epoch-probe',protocolVersion:2,deliveryStatus:'running',leaseEpoch:1,controlEpoch:2,attemptRevision:1,responses:[ack]});
 let current=attempt('epoch-probe');const state=examState();
 const wrapper=({children}:{children:React.ReactNode})=><StudentRuntimeProvider state={state} onExit={()=>{}} attemptSnapshot={current}><StudentAttemptProvider scheduleId="schedule" attemptSnapshot={current}>{children}</StudentAttemptProvider></StudentRuntimeProvider>;
 const hook=renderHook(()=>({attempt:useStudentAttempt(),runtime:useStudentRuntimeSession()}),{wrapper});
 await waitFor(()=>expect(mocks.fetchSnapshot).toHaveBeenCalledTimes(1));
 act(()=>hook.result.current.attempt.actions.persistAnswer('q1','student latest'));
 expect(hook.result.current.attempt.state.attempt?.answers.q1).toBe('student latest');
 console.log('PROBE provider provisional status',{answer:hook.result.current.attempt.state.attempt?.answers.q1,sync:hook.result.current.runtime.state.attemptSyncState,pending:hook.result.current.attempt.state.pendingMutationCount});
 current={...current,controlEpoch:2};hook.rerender();
 await waitFor(()=>expect(mocks.fetchSnapshot).toHaveBeenCalledTimes(2));
 await act(async()=>{finishOld([]);await Promise.resolve();});
 console.log('PROBE provider epoch replacement',{answer:hook.result.current.attempt.state.attempt?.answers.q1,sync:hook.result.current.runtime.state.attemptSyncState,checkpoint:localStorage.getItem('response-checkpoint:v2:epoch-probe:q1')});
 expect(hook.result.current.attempt.state.attempt?.answers.q1).toBe('student latest');
});
