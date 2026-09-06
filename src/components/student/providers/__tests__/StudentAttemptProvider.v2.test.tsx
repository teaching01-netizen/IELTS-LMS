import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import type { ExamState } from '../../../../types';
import type { StudentAttempt } from '../../../../types/studentAttempt';
import { StudentAttemptProvider, useStudentAttempt } from '../StudentAttemptProvider';
import { StudentRuntimeProvider } from '../StudentRuntimeProvider';

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

describe('StudentAttemptProvider V2 integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocks.createTransport.mockReturnValue(mocks.transport);
  });

  it('does not redirect a save into a replacement attempt while recovery is pending', async () => {
    const firstRecovery = deferred<[]>();
    const secondRecovery = deferred<[]>();
    mocks.transport.fetchSnapshot
      .mockReturnValueOnce(firstRecovery.promise)
      .mockReturnValueOnce(secondRecovery.promise);

    let currentAttempt = attempt('attempt-a');
    const state = examState();
    const onExit = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider state={state} onExit={onExit} attemptSnapshot={currentAttempt}>
        <StudentAttemptProvider
          scheduleId="schedule"
          attemptSnapshot={currentAttempt}
        >
          {children}
        </StudentAttemptProvider>
      </StudentRuntimeProvider>
    );
    const hook = renderHook(() => useStudentAttempt(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.transport.fetchSnapshot).toHaveBeenCalledTimes(1);
    act(() => {
      hook.result.current.actions.persistAnswer('q1', 'private-A');
    });

    currentAttempt = attempt('attempt-b');
    hook.rerender();
    await act(async () => {
      firstRecovery.resolve([]);
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.state.attempt?.id).toBe('attempt-b'));
    expect(hook.result.current.state.attempt?.answers.q1).toBeUndefined();

    secondRecovery.resolve([]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.state.attempt?.answers.q1).toBeUndefined();
  });

  it('does not let a refreshed legacy snapshot overwrite a visible V2 response', async () => {
    const firstRecovery = deferred<[]>();
    mocks.transport.fetchSnapshot.mockReturnValue(firstRecovery.promise);
    let currentAttempt = attempt('attempt-a');
    const state = examState();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider state={state} onExit={vi.fn()} attemptSnapshot={currentAttempt}>
        <StudentAttemptProvider
          scheduleId="schedule"
          attemptSnapshot={currentAttempt}
        >
          {children}
        </StudentAttemptProvider>
      </StudentRuntimeProvider>
    );
    const hook = renderHook(() => useStudentAttempt(), { wrapper });

    await act(async () => {
      firstRecovery.resolve([]);
      await Promise.resolve();
    });
    act(() => {
      hook.result.current.actions.persistAnswer('q1', 'local-answer');
    });

    currentAttempt = attempt('attempt-a');
    currentAttempt.answers.q1 = 'stale-server-answer';
    hook.rerender();

    await waitFor(() =>
      expect(hook.result.current.state.attempt?.answers.q1).toBe('local-answer')
    );
  });

  it('keeps preview attempts on local persistence', async () => {
    const currentAttempt = attempt('preview-attempt');
    const state = examState();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider state={state} onExit={vi.fn()} attemptSnapshot={currentAttempt}>
        <StudentAttemptProvider
          scheduleId="schedule"
          attemptSnapshot={currentAttempt}
          persistenceEnabled={false}
        >
          {children}
        </StudentAttemptProvider>
      </StudentRuntimeProvider>
    );
    const hook = renderHook(() => useStudentAttempt(), { wrapper });

    await act(async () => {
      hook.result.current.actions.persistAnswer('q1', 'preview-answer');
      await Promise.resolve();
    });

    expect(hook.result.current.state.attempt?.answers.q1).toBe('preview-answer');
    expect(hook.result.current.state.attempt?.recovery.syncState).toBe('idle');
    expect(mocks.transport.fetchSnapshot).not.toHaveBeenCalled();
  });
});
