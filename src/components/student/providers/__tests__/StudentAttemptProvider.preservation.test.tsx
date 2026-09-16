/** IELTS visible state preservation (repair verification, WP0/WP8).
 *
 * Companion to src/shared/durability/__tests__/DurableResponseEngine.preservation.test.ts
 * (renamed from studentStateLoss.audit.test.ts, WP-T1 second pass):
 * these assert the SAFE repaired behavior through the real provider.
 * Failing here means a silent-loss path regressed — treat as BLOCKING.
 *
 * WP0 mapping: this file is the WP-T1-owned provider-level preservation
 * suite. Renamed from StudentAttemptProvider.stateLoss.audit.test.tsx
 * (WP-T1 second pass): `find src/components/student/providers/__tests__
 * -name '*preservation*'` is non-empty and no *.audit.test.* survives here.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import type { ExamState } from '../../../../types';
import type { StudentAttempt } from '../../../../types/studentAttempt';
import { StudentAttemptProvider, useStudentAttempt } from '../StudentAttemptProvider';
import { StudentRuntimeProvider, useStudentRuntimeSession } from '../StudentRuntimeProvider';

const mocks = vi.hoisted(() => ({
  transport: {
    sendBatch: vi.fn(),
    submit: vi.fn(),
    fetchSnapshot: vi.fn(),
  },
  createTransport: vi.fn(),
}));

vi.mock('@student/api/responseDurabilityTransport', () => ({
  createResponseDurabilityV2Transport: mocks.createTransport,
  takeOverResponseDurabilityLease: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

// Preservation verification (WP0/WP8): recovery must keep newly typed work.
describe('IELTS visible state preservation', () => {
  beforeEach(() => {
    localStorage.clear(); vi.clearAllMocks();
    mocks.createTransport.mockReturnValue(mocks.transport);
    mocks.transport.sendBatch.mockImplementation(() => new Promise(() => {}));
  });

  it('recovery keeps a visible newly typed answer and flag in the real provider', async () => {
    const pendingSnapshot = deferred<[]>();
    mocks.transport.fetchSnapshot.mockReturnValue(pendingSnapshot.promise);
    localStorage.setItem('response-checkpoint:v2:audit-provider:q1', JSON.stringify({
      payload: { answer: 'older recovered answer', markedForReview: false, eliminatedOptions: [], annotations: [] },
      writeId: 'old-local', clientVersion: 20, leaseEpoch: 1, controlEpoch: 1, durability: 'checkpoint',
    }));
    const currentAttempt = attempt('audit-provider'); const state = examState();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider state={state} onExit={() => {}} attemptSnapshot={currentAttempt}>
        <StudentAttemptProvider scheduleId="schedule" attemptSnapshot={currentAttempt}>{children}</StudentAttemptProvider>
      </StudentRuntimeProvider>
    );
    const hook = renderHook(() => useStudentAttempt(), { wrapper });
    await waitFor(() => expect(mocks.transport.fetchSnapshot).toHaveBeenCalled());
    act(() => {
      hook.result.current.actions.persistAnswer('q1', 'newly typed');
      hook.result.current.actions.persistFlag('q1', true);
    });
    expect(hook.result.current.state.attempt?.answers.q1).toBe('newly typed');
    expect(hook.result.current.state.attempt?.flags.q1).toBe(true);
    await act(async () => { pendingSnapshot.resolve([]); });
    // Live input wins over the older recovered draft — never rolled back.
    await waitFor(() => expect(hook.result.current.state.attempt?.answers.q1).toBe('newly typed'));
    expect(hook.result.current.state.attempt?.flags.q1).toBe(true);
    hook.unmount();
  });

  it('Bug 5: a provisional edit awaiting its version is never reported as saved', async () => {
    const heldSnapshot = deferred<[]>();
    mocks.transport.fetchSnapshot.mockReturnValue(heldSnapshot.promise);
    // The acknowledgement that is allowed to restore the server-saved truth.
    mocks.transport.sendBatch.mockImplementation(
      async (
        _attemptId: string,
        req: { commands: Array<{ writeId: string; questionId: string; clientVersion: number; response: unknown }> },
      ) => ({
        attemptRevision: 1,
        serverTime: new Date().toISOString(),
        acknowledgements: req.commands.map((command) => ({
          writeId: command.writeId,
          questionId: command.questionId,
          clientVersion: command.clientVersion,
          outcome: 'applied' as const,
          serverRevision: 1,
          canonicalResponse: command.response,
          contentHash: 'hash-status',
        })),
      }),
    );
    const currentAttempt = attempt('status-provider');
    const state = examState();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider state={state} onExit={() => {}} attemptSnapshot={currentAttempt}>
        <StudentAttemptProvider scheduleId="schedule" attemptSnapshot={currentAttempt}>{children}</StudentAttemptProvider>
      </StudentRuntimeProvider>
    );
    const hook = renderHook(() => ({ attempt: useStudentAttempt(), runtime: useStudentRuntimeSession() }), { wrapper });
    await waitFor(() => expect(mocks.transport.fetchSnapshot).toHaveBeenCalled());
    // Nothing outstanding: the prior state really is saved.
    expect(hook.result.current.runtime.state.attemptSyncState).toBe('saved');

    act(() => {
      hook.result.current.attempt.actions.persistAnswer('q1', 'student latest');
    });
    expect(hook.result.current.attempt.state.attempt?.answers.q1).toBe('student latest');
    // Visible and checkpointed, but the intent has no version and no outbox
    // entry yet — so the runtime must stop claiming the server has it.
    await waitFor(() => expect(hook.result.current.runtime.state.attemptSyncState).not.toBe('saved'));

    // Resolving the snapshot issues the version; the acknowledgement is what
    // restores the server-saved truth, so the state is never sticky.
    await act(async () => { heldSnapshot.resolve([]); });
    await waitFor(() => expect(hook.result.current.runtime.state.attemptSyncState).toBe('saved'));
    hook.unmount();
  });

  it('Bug 1: a control-epoch refresh mid-recovery keeps the typed answer over the older server value', async () => {
    const heldFirstSnapshot = deferred<[]>();
    const serverAck = {
      questionId: 'q1',
      writeId: 'server-write',
      clientVersion: 1,
      serverRevision: 1,
      outcome: 'applied' as const,
      contentHash: 'hash-epoch',
      canonicalResponse: {
        answer: 'server old',
        markedForReview: false,
        eliminatedOptions: [],
        annotations: [],
      },
    };
    mocks.transport.fetchSnapshot
      .mockReturnValueOnce(heldFirstSnapshot.promise)
      .mockResolvedValue({
        attemptId: 'epoch-provider', protocolVersion: 2, deliveryStatus: 'running',
        leaseEpoch: 1, controlEpoch: 2, attemptRevision: 1, responses: [serverAck],
      });
    let currentAttempt = attempt('epoch-provider');
    const state = examState();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider state={state} onExit={() => {}} attemptSnapshot={currentAttempt}>
        <StudentAttemptProvider scheduleId="schedule" attemptSnapshot={currentAttempt}>{children}</StudentAttemptProvider>
      </StudentRuntimeProvider>
    );
    const hook = renderHook(() => useStudentAttempt(), { wrapper });
    await waitFor(() => expect(mocks.transport.fetchSnapshot).toHaveBeenCalledTimes(1));
    act(() => {
      hook.result.current.actions.persistAnswer('q1', 'student latest');
    });
    expect(hook.result.current.state.attempt?.answers.q1).toBe('student latest');
    // A proctor warning bumps the control epoch: the provider destroys and
    // rebuilds the engine while the first snapshot is still held open.
    currentAttempt = { ...currentAttempt, controlEpoch: 2 };
    hook.rerender();
    await waitFor(() => expect(mocks.transport.fetchSnapshot).toHaveBeenCalledTimes(2));
    await act(async () => { heldFirstSnapshot.resolve([]); });
    // The replacement engine recovers the newest local intent (kept visible)
    // instead of publishing the older server answer.
    await waitFor(() => expect(hook.result.current.state.attempt?.answers.q1).toBe('student latest'));
    hook.unmount();
  });
});
