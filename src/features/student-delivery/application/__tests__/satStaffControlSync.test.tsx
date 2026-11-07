import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSatResponsePersistence } from '../../hooks/useSatResponsePersistence';
import { useSatExamController } from '../../hooks/useSatExamController';
import type { AssessmentDeliveryBootstrap } from '../../contracts/assessmentDelivery';
import type { ResponseBatchRequestV2 } from '../../../../shared/durability/types';
import type { SatDeliveryGateway } from '../ports/SatDeliveryGateway';

const io = vi.hoisted(() => ({ fetchSnapshot: vi.fn(), sendBatch: vi.fn(), submit: vi.fn(), bootstrap: vi.fn(), state: vi.fn() }));
vi.mock('@student/api/responseDurabilityTransport', () => ({ createResponseDurabilityV2Transport: () => io, takeOverResponseDurabilityLease: vi.fn() }));
vi.mock('../../infrastructure/satDeliveryGateway', () => ({ configureSatDeliveryAttempt: () => {}, satDeliveryGateway: { bootstrap: io.bootstrap, state: io.state, startModule: vi.fn(), submitModule: vi.fn(), submitAssessment: vi.fn() } }));

afterEach(() => { vi.clearAllMocks(); localStorage.clear(); });

function snapshot(reopened = false): AssessmentDeliveryBootstrap {
 const now = new Date().toISOString();
 const empty = { version: 1 as const, nodes: [] };
 const modules = ['m1','m2'].map((id, index) => ({ id, moduleKey: id, title: id, displayOrder: index, durationSeconds: 1200, targetQuestionCount: 1, adaptiveRole: index === 0 ? 'base' : 'higher_branch', instructions: empty, toolPolicy: [], questions: [{ examQuestionId: `q${index+1}`, questionId: `q${index+1}`, displayOrder: 0, isPretest: false, questionType: 'single_choice' as const, stimulus: empty, prompt: empty, answer: { kind: 'single_choice' as const, options: [] }, metadata: {}, accessibility: {} }] }));
 return { scheduleId: 'schedule-staff', examId:'exam', providerKey:'sat', versionId:'v1', serverNow:now, candidateName:'Ada', scheduleRuntimeStatus:'live', timing:{authority:'cohort_runtime',timingModel:'sat_personal_v1',stageKey:'reading-writing',stageStatus:'live',serverNow:now,deadlineAt:null,remainingSeconds:1200,runtimeRevision:1}, proctorStatus:'active',proctorNote:null,deviceFingerprintHash:null,result:null,
 sections:[{id:'rw',sectionKey:'reading-writing',title:'Reading and Writing',displayOrder:0,durationSeconds:2400,breakAfterSeconds:0,instructions:empty,modules}],
 attempt:{id:'attempt-staff',responses:[],moduleAttempts:modules.map((m,index)=>({id:`ma-${m.id}`,moduleId:m.id,state:reopened ? index===0?'active':'locked' : index===0?'locked':'active',allocatedSeconds:1200,availableAt:now,startedAt:now,pausedAt:null,accumulatedPausedSeconds:0,extensionSeconds:0,deadlineAt:new Date(Date.now()+1200000).toISOString(),remainingSeconds:1200,completionReason:null,rawCorrect:null,operationalQuestionCount:null,toolState:{},revision:reopened?4:2,entryGeneration:reopened && index===0 ? 1 : 0,runGeneration:reopened && index===0 ? 1 : 0}))},
 ...(reopened ? {staffControl:{revision:2,action:'move' as const,changedAt:now}} : {}) };
}

it('adopts a staff-reopened module from the student read API and rejects the old payload afterward', async () => {
 const before=snapshot();const reopened=snapshot(true);
 io.fetchSnapshot.mockResolvedValue({attemptId:'attempt-staff',protocolVersion:2,deliveryStatus:'running',leaseEpoch:1,controlEpoch:1,attemptRevision:1,responses:[]});
 io.bootstrap.mockResolvedValue(before);io.state.mockImplementation(()=>new Promise(()=>{}));
 const hook=renderHook(()=>useSatExamController({scheduleId:'schedule-staff',attemptId:'attempt-staff',candidateId:'candidate',liveSocketConnected:true}));
 await waitFor(()=>expect(hook.result.current.stateModule?.id).toBe('m2'));
 io.bootstrap.mockResolvedValue(reopened);
 io.state.mockResolvedValue(reopened);
 await act(async()=>{await hook.result.current.commands.refreshRecoveryState();});
 await waitFor(()=>expect(hook.result.current.stateModule?.id).toBe('m1'));
 io.state.mockResolvedValue(before);
 await act(async()=>{await hook.result.current.commands.refreshRecoveryState();});
 expect(hook.result.current.stateModule?.id).toBe('m1');
 hook.unmount();
});

it('silently syncs an interrupted answer and permits new answers after the module is reopened', async () => {
 io.fetchSnapshot.mockResolvedValue({attemptId:'attempt-staff',protocolVersion:2,deliveryStatus:'running',leaseEpoch:1,controlEpoch:1,attemptRevision:1,responses:[]});
 io.sendBatch.mockImplementation(async (_id:string,request:ResponseBatchRequestV2)=>({attemptRevision:3,serverTime:new Date().toISOString(),acknowledgements:request.commands.map(command=>({writeId:command.writeId,questionId:command.questionId,clientVersion:command.clientVersion,outcome:'applied',serverRevision:3,canonicalResponse:command.response,contentHash:'hash'}))}));
 const uploads:unknown[]=[];
 const gateway:SatDeliveryGateway={bootstrap:io.bootstrap,startModule:vi.fn(),submitModule:vi.fn(),submitAssessment:vi.fn(),saveResponse:vi.fn(),resolveRecovery:vi.fn(),recordLateEvidence:async(_s,_a,request)=>{uploads.push(request);return {recorded:request.answers.length};}};
 const hook=renderHook(()=>useSatResponsePersistence({scheduleId:'schedule-staff',attemptId:'attempt-staff',gateway,onSavedRevision:()=>{}}));
 await act(async()=>{await hook.result.current.flush();});
 const active=snapshot(true);delete active.staffControl;
 act(()=>hook.result.current.hydrateBootstrap(active));
 act(()=>hook.result.current.save({questionId:'q1',answer:'A',markedForReview:false,eliminatedOptionIds:[],annotations:{version:2,annotations:[],legacyQuestionNote:''}}));
 const moved=snapshot();moved.staffControl={revision:2,action:'move',changedAt:new Date().toISOString(),sources:[{moduleAttemptId:'ma-m1',moduleId:'m1',throughControlEpoch:1,questionIds:['q1']}]};
 act(()=>hook.result.current.hydrateBootstrap(moved));
 expect(hook.result.current.failure).toBeNull();
 await waitFor(()=>expect(uploads).toHaveLength(1),{timeout:5000});
 expect(uploads[0]).toMatchObject({staffMove:true,moduleId:'m1',answers:[{questionId:'q1',originControlEpoch:1,response:{answer:'A'}}]});
 act(()=>hook.result.current.hydrateBootstrap(snapshot(true)));
 act(()=>hook.result.current.save({questionId:'q1',answer:'B',markedForReview:false,eliminatedOptionIds:[],annotations:{version:2,annotations:[],legacyQuestionNote:''}}));
 await act(async()=>{await hook.result.current.flush();});
 expect(hook.result.current.visibleDrafts.q1?.answer).toBe('B');
 expect(hook.result.current.blockedDrafts).toEqual([]);
 hook.unmount();
});
