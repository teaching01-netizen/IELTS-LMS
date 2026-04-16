import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { studentAttemptRepository } from '../../../../services/studentAttemptRepository';
import type { ExamState } from '../../../../types';
import type { StudentAttempt, StudentAttemptMutation } from '../../../../types/studentAttempt';
import { StudentAttemptProvider, useStudentAttempt } from '../StudentAttemptProvider';
import { StudentNetworkProvider, useStudentNetwork } from '../StudentNetworkProvider';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';

vi.mock('../../../../utils/deviceFingerprinting', () => ({
  getDeviceFingerprint: vi.fn(async () => ({
    components: {},
    hash: 'fp-1',
  })),
}));

function createExamState(): ExamState {
  return {
    title: 'Test Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config: createDefaultConfig('Academic', 'Academic'),
    reading: {
      passages: [
        {
          id: 'p1',
          title: 'Passage 1',
          content: 'Test content',
          blocks: [],
        },
      ],
    },
    listening: {
      parts: [
        {
          id: 'l1',
          title: 'Part 1',
          pins: [],
          blocks: [],
        },
      ],
    },
    writing: {
      task1Prompt: 'Task 1 prompt',
      task2Prompt: 'Task 2 prompt',
      tasks: [],
      customPromptTemplates: [],
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: [],
    },
  };
}

function createAttemptSnapshot(): StudentAttempt {
  return {
    id: 'attempt-1',
    scheduleId: 'sched-1',
    studentKey: 'student-sched-1',
    examId: 'exam-1',
    examTitle: 'Test Exam',
    phase: 'exam',
    currentModule: 'reading',
    currentQuestionId: 'q1',
    answers: {},
    writingAnswers: {},
    flags: {},
    violations: [],
    integrity: {
      preCheck: null,
      deviceFingerprintHash: 'fp-1',
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

describe('StudentNetworkProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(studentAttemptRepository, 'saveAttempt').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'savePendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'clearPendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'saveHeartbeatEvent').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'getHeartbeatEvents').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepository, 'getPendingMutations').mockResolvedValue([]);
  });

  function createWrapper(
    attemptSnapshot = createAttemptSnapshot(),
    config = createExamState().config,
  ) {
    const state = createExamState();
    state.config = config;

    return ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider
        state={state}
        onExit={vi.fn()}
        attemptSnapshot={attemptSnapshot}
      >
        <StudentAttemptProvider
          scheduleId={attemptSnapshot.scheduleId}
          attemptSnapshot={attemptSnapshot}
        >
          <StudentNetworkProvider config={config} scheduleId={attemptSnapshot.scheduleId}>
            {children}
          </StudentNetworkProvider>
        </StudentAttemptProvider>
      </StudentRuntimeProvider>
    );
  }

  it('blocks the exam when the browser goes offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    const { result } = renderHook(
      () => ({
        runtime: useStudentRuntime(),
        network: useStudentNetwork(),
      }),
      { wrapper: createWrapper() },
    );

    act(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });
      window.dispatchEvent(new Event('offline'));
    });

    await waitFor(() => {
      expect(result.current.runtime.state.blocking.reason).toBe('offline');
    });

    expect(result.current.network.state.isOnline).toBe(false);
    expect(result.current.network.state.lastDisconnectAt).not.toBeNull();
  });

  it('flushes queued mutations before clearing reconnect blocking', async () => {
    const pendingMutation: StudentAttemptMutation = {
      id: 'mutation-1',
      attemptId: 'attempt-1',
      scheduleId: 'sched-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'answer',
      payload: {
        questionId: 'q1',
      },
    };

    vi.mocked(studentAttemptRepository.getPendingMutations).mockResolvedValue([pendingMutation]);
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(
      () => ({
        attempt: useStudentAttempt(),
        runtime: useStudentRuntime(),
        network: useStudentNetwork(),
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.attempt.state.pendingMutationCount).toBe(1);
    });

    act(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(studentAttemptRepository.saveAttempt).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.runtime.state.blocking.reason).toBeNull();
    });

    expect(result.current.network.state.isRecovering).toBe(false);
  });

  it('keeps reconnect blocking active when queued mutations fail to flush', async () => {
    const pendingMutation: StudentAttemptMutation = {
      id: 'mutation-1',
      attemptId: 'attempt-1',
      scheduleId: 'sched-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'answer',
      payload: {
        questionId: 'q1',
      },
    };

    vi.mocked(studentAttemptRepository.getPendingMutations).mockResolvedValue([pendingMutation]);
    vi.mocked(studentAttemptRepository.saveAttempt).mockRejectedValue(new Error('persist failed'));
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(
      () => ({
        attempt: useStudentAttempt(),
        runtime: useStudentRuntime(),
        network: useStudentNetwork(),
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.attempt.state.pendingMutationCount).toBe(1);
    });

    act(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(result.current.runtime.state.blocking.reason).toBe('syncing_reconnect');
    });

    await waitFor(() => {
      expect(result.current.attempt.state.attempt?.recovery.syncState).toBe('error');
    });

    expect(result.current.network.state.isRecovering).toBe(false);
  });
});
