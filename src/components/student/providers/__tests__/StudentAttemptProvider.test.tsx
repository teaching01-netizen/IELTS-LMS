import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { studentAttemptRepository } from '../../../../services/studentAttemptRepository';
import type { ExamState } from '../../../../types';
import type { StudentAttempt, StudentAttemptMutation } from '../../../../types/studentAttempt';
import { StudentAttemptProvider, useStudentAttempt } from '../StudentAttemptProvider';
import { StudentRuntimeProvider } from '../StudentRuntimeProvider';

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
    studentKey: 'student-sched-1-alice',
    examId: 'exam-1',
    examTitle: 'Test Exam',
    candidateId: 'alice',
    candidateName: 'Alice Roe',
    candidateEmail: 'alice@example.com',
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

describe('StudentAttemptProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(studentAttemptRepository, 'saveAttempt').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'savePendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'clearPendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'saveHeartbeatEvent').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'getHeartbeatEvents').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepository, 'getPendingMutations').mockResolvedValue([]);

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  function createWrapper(attemptSnapshot = createAttemptSnapshot()) {
    const state = createExamState();

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
          {children}
        </StudentAttemptProvider>
      </StudentRuntimeProvider>
    );
  }

  it('flushes durable queued mutations when connectivity returns', async () => {
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

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(1);
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    await act(async () => {
      await result.current.actions.flushPending();
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(0);
    });

    expect(result.current.state.lastPersistedAt).not.toBeNull();
  });

  it('reloads durable pending mutations on refresh', async () => {
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

    const wrapper = createWrapper();
    const first = renderHook(() => useStudentAttempt(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(first.result.current.state.pendingMutationCount).toBe(1);
    first.unmount();

    const second = renderHook(() => useStudentAttempt(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(second.result.current.state.pendingMutationCount).toBe(1);
    expect(second.result.current.state.attemptId).toBe('attempt-1');
  });
});
