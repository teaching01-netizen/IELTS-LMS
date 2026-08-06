import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import * as studentAttemptRepoModule from '../../../../services/studentAttemptRepository';
import { studentAttemptRepository } from '../../../../services/studentAttemptRepository';
import type { ExamState } from '../../../../types';
import type { ExamSessionRuntime } from '../../../../types/domain';
import type {
  StudentAttempt,
  StudentAttemptMutation,
} from '../../../../types/studentAttempt';
import * as studentObservabilityUtilsModule from '../../../../utils/studentObservability';
import * as studentAttemptFacadeModule from '@student/application/studentAttemptFacade';
import { ProtectedInput } from '../../ProtectedInput';
import { StudentAttemptProvider, useStudentAttempt } from '../StudentAttemptProvider';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';

const ANSWER_DURABLE_WRITE_DEBOUNCE_MS = 100;
const ANSWER_SYNC_CHECKPOINT_KEY_PREFIX = 'ielts_student_answer_checkpoint_v1';

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
    submittedAt: null,
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

function createRuntimeSnapshot(currentSectionKey: 'listening' | 'reading' = 'reading'): ExamSessionRuntime {
  const now = '2026-01-01T00:00:00.000Z';

  return {
    id: 'runtime-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    examTitle: 'Test Exam',
    cohortName: 'Test Cohort',
    deliveryMode: 'proctor_start',
    status: 'live',
    actualStartAt: now,
    actualEndAt: null,
    activeSectionKey: currentSectionKey,
    currentSectionKey,
    currentSectionRemainingSeconds: 3000,
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    sections: [
      {
        sectionKey: 'listening',
        label: 'Listening',
        order: 1,
        plannedDurationMinutes: 30,
        gapAfterMinutes: 0,
        status: currentSectionKey === 'listening' ? 'live' : 'completed',
        availableAt: now,
        actualStartAt: now,
        actualEndAt: currentSectionKey === 'listening' ? null : now,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionMinutes: 0,
      },
      {
        sectionKey: 'reading',
        label: 'Reading',
        order: 2,
        plannedDurationMinutes: 60,
        gapAfterMinutes: 0,
        status: currentSectionKey === 'reading' ? 'live' : 'locked',
        availableAt: currentSectionKey === 'reading' ? now : null,
        actualStartAt: currentSectionKey === 'reading' ? now : null,
        actualEndAt: null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionMinutes: 0,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

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

describe('StudentAttemptProvider', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();

    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      'ielts_student_attempt_credentials_v1',
      JSON.stringify([
        {
          attemptId: 'attempt-1',
          scheduleId: 'sched-1',
          attemptToken: 'token-1',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      ]),
    );

    vi.spyOn(studentAttemptRepository, 'saveAttempt').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'savePendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'clearPendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'submitAttempt').mockResolvedValue({
      ...createAttemptSnapshot(),
      phase: 'post-exam',
    });
    vi.spyOn(studentAttemptRepository, 'saveHeartbeatEvent').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'getHeartbeatEvents').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepository, 'getPendingMutations').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepository, 'getAttemptsByScheduleId').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepoModule, 'refreshAttemptCredentialForAttempt').mockResolvedValue(false);

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    window.localStorage.clear();
  });

  async function flushAnswerDurableDebounceWindow() {
    await act(async () => {
      vi.advanceTimersByTime(ANSWER_DURABLE_WRITE_DEBOUNCE_MS);
      await Promise.resolve();
    });
  }

  function createRuntimeBackedWrapper(attemptSnapshot: StudentAttempt, runtimeSnapshot: ExamSessionRuntime) {
    const state = createExamState();

    return ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider
        state={state}
        onExit={vi.fn()}
        runtimeBacked
        runtimeSnapshot={runtimeSnapshot}
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

  // A runtime-backed attempt with a completed pre-check: the runtime provider
  // only maps to the 'exam' phase (the phase required for the final-time
  // immediate-durability boundary) once the pre-check is complete.
  function createBoundaryAttemptSnapshot(
    overrides: Partial<StudentAttempt> = {},
  ): StudentAttempt {
    return {
      ...createAttemptSnapshot(),
      ...overrides,
      integrity: {
        ...createAttemptSnapshot().integrity,
        ...overrides.integrity,
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
      },
    };
  }

  it('flushes durable queued mutations when connectivity returns', async () => {
    vi.mocked(studentAttemptRepository.getPendingMutations).mockResolvedValue([]);
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'OFFLINE_TYPED');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(1);
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    await act(async () => {
      void result.current.actions.flushPending();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(0);
    });

    expect(result.current.state.lastPersistedAt).not.toBeNull();
  });

  it('kept the offline answer queued across a runtime question navigation and replayed it exactly once after reconnection (FEX-032)', async () => {
    vi.useFakeTimers();
    try {
      const runtimeSnapshot: ExamSessionRuntime = createRuntimeSnapshot('reading');

      const { result } = renderHook(
        () => ({
          attempt: useStudentAttempt(),
          runtime: useStudentRuntime(),
        }),
        {
          wrapper: createRuntimeBackedWrapper(
            createBoundaryAttemptSnapshot(),
            runtimeSnapshot,
          ),
        },
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.attempt.state.pendingMutationCount).toBe(0);

      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });

      await act(async () => {
        result.current.attempt.actions.persistAnswer('q1', 'OFFLINE_NAV');
        await Promise.resolve();
      });
      expect(result.current.attempt.state.pendingMutationCount).toBe(1);
      expect(result.current.attempt.state.attempt?.answers.q1).toBe('OFFLINE_NAV');

      // Navigate the runtime to a later question while offline: the durable
      // mirror persists the navigation as its own coalesced position mutation,
      // so the pending queue is NOT discarded — it keeps the offline answer
      // alongside the recorded position.
      await act(async () => {
        result.current.runtime.actions.setCurrentQuestionId('q2');
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.attempt.state.pendingMutationCount).toBeGreaterThanOrEqual(1);
      expect(result.current.attempt.state.attempt?.answers.q1).toBe('OFFLINE_NAV');
      expect(result.current.attempt.state.attempt?.currentQuestionId).toBe('q2');

      // Reconnect: the durable replay carries the offline answer to the
      // persistence layer exactly once.
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      await act(async () => {
        await result.current.attempt.actions.flushPending();
        await Promise.resolve();
        await Promise.resolve();
      });

      const offlineNavAnswerCalls = vi
        .mocked(studentAttemptRepository.savePendingMutations)
        .mock.calls.filter((call) =>
          (call[1] ?? []).some(
            (mutation) =>
              mutation.type === 'answer' &&
              mutation.payload?.questionId === 'q1' &&
              mutation.payload?.value === 'OFFLINE_NAV',
          ),
        );
      expect(offlineNavAnswerCalls).toHaveLength(1);
      expect(result.current.attempt.state.pendingMutationCount).toBe(0);
    } finally {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      vi.useRealTimers();
    }
  });

  it('replays pending writing drafts into the runtime state on mount', async () => {
    const attemptSnapshot: StudentAttempt = {
      ...createAttemptSnapshot(),
      currentModule: 'writing',
      currentQuestionId: 'task1',
      writingAnswers: {},
    };

    const pendingMutation: StudentAttemptMutation = {
      id: 'mutation-1',
      attemptId: attemptSnapshot.id,
      scheduleId: attemptSnapshot.scheduleId,
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'writing_answer',
      payload: {
        taskId: 'task1',
        value: '<p>Draft</p>',
        module: 'writing',
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
      }),
      { wrapper: createWrapper(attemptSnapshot) },
    );

    await waitFor(() => {
      expect(result.current.attempt.state.pendingMutationCount).toBe(1);
    });

    expect(result.current.attempt.state.attempt?.writingAnswers['task1']).toBe('<p>Draft</p>');
  });

  it('preserves explicit sync state patches for network transitions', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.actions.recordNetworkStatus('online', '2026-01-01T00:00:00.000Z');
    });

    expect(result.current.state.attempt?.recovery.syncState).toBe('syncing_reconnect');
    vi.useRealTimers();
  });

  it('queues violation mutations with the full violations snapshot expected by the backend', async () => {
    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.actions.persistViolation({
        id: 'violation-1',
        type: 'TAB_SWITCH',
        severity: 'medium',
        timestamp: '2026-01-01T00:00:00.000Z',
        description: 'Tab switching detected',
      });
    });

    await waitFor(() => {
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalled();
    });

    const pendingMutations = vi.mocked(studentAttemptRepository.savePendingMutations).mock.calls.at(-1)?.[1];
    const violationMutation = pendingMutations?.find((mutation) => mutation.type === 'violation');
    expect(violationMutation).toBeDefined();
    expect(violationMutation?.payload).toMatchObject({
      violationId: 'violation-1',
      violationType: 'TAB_SWITCH',
      violations: [
        {
          id: 'violation-1',
          type: 'TAB_SWITCH',
          severity: 'medium',
          timestamp: '2026-01-01T00:00:00.000Z',
          description: 'Tab switching detected',
        },
      ],
    });
  });

  it('does not persist an unverified post-exam phase in runtime-backed mode', async () => {
    vi.useFakeTimers();

    const attemptSnapshot: StudentAttempt = {
      ...createAttemptSnapshot(),
      integrity: {
        ...createAttemptSnapshot().integrity,
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
      },
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: attemptSnapshot.scheduleId,
      examId: attemptSnapshot.examId,
      examTitle: attemptSnapshot.examTitle,
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 120,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 0,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const wrapperRuntimeBacked = ({ children }: { children: React.ReactNode }) => {
      const state = createExamState();
      return (
        <StudentRuntimeProvider
          state={state}
          onExit={vi.fn()}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
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
    };

    const { result } = renderHook(
      () => ({
        attempt: useStudentAttempt(),
        runtime: useStudentRuntime(),
      }),
      { wrapper: wrapperRuntimeBacked },
    );

    await act(async () => {
      await Promise.resolve();
    });

    vi.mocked(studentAttemptRepository.saveAttempt).mockClear();

    act(() => {
      result.current.runtime.actions.setPhase('post-exam');
    });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(studentAttemptRepository.saveAttempt).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('coalesces writing answer mutations by task id to avoid unbounded growth', async () => {
    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.actions.persistWritingAnswer('task1', 'first');
      result.current.actions.persistWritingAnswer('task1', 'second');
    });

    await waitFor(() => {
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalled();
    });

    const pendingMutations = vi
      .mocked(studentAttemptRepository.savePendingMutations)
      .mock.calls.at(-1)?.[1];
    expect(pendingMutations).toHaveLength(1);
    expect(pendingMutations?.[0]?.type).toBe('writing_answer');
    expect(pendingMutations?.[0]?.payload).toMatchObject({
      taskId: 'task1',
      value: 'second',
    });
  });

  it('keeps the deadline countdown moving during continuous writing persistence', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const attemptSnapshot: StudentAttempt = {
        ...createAttemptSnapshot(),
        currentModule: 'writing',
        currentQuestionId: 'task1',
        integrity: {
          ...createAttemptSnapshot().integrity,
          preCheck: {
            completedAt: '2026-01-01T00:00:00.000Z',
            browserFamily: 'chrome',
            browserVersion: 120,
            screenDetailsSupported: true,
            heartbeatReady: true,
            acknowledgedSafariLimitation: false,
            checks: [],
          },
        },
      };
      const runtimeSnapshot: ExamSessionRuntime = {
        ...createRuntimeSnapshot('reading'),
        currentSectionRemainingSeconds: 10,
        currentSectionDeadlineAt: '2026-01-01T00:00:10.000Z',
        serverNow: '2026-01-01T00:00:00.000Z',
      };

      const { result } = renderHook(
        () => ({
          attempt: useStudentAttempt(),
          runtime: useStudentRuntime(),
        }),
        { wrapper: createRuntimeBackedWrapper(attemptSnapshot, runtimeSnapshot) },
      );

      await act(async () => {
        await Promise.resolve();
      });

      for (let expected = 9; expected >= 0; expected -= 1) {
        await act(async () => {
          for (let event = 0; event < 20; event += 1) {
            result.current.attempt.actions.persistWritingAnswer(
              'task1',
              `draft-${expected}-${event}`,
            );
            vi.advanceTimersByTime(50);
          }
          await Promise.resolve();
        });

        expect(result.current.runtime.state.displayTimeRemaining).toBe(expected);
      }

      await act(async () => {
        vi.advanceTimersByTime(100);
        await Promise.resolve();
      });

      expect(result.current.attempt.state.attempt?.writingAnswers.task1).toBe('draft-0-19');
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledWith(
        'attempt-1',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'writing_answer',
            payload: expect.objectContaining({
              taskId: 'task1',
              value: 'draft-0-19',
            }),
          }),
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps only the latest objective answer mutation during super-fast typing bursts', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer('q-typing', 'M');
      result.current.actions.persistAnswer('q-typing', 'MA');
      result.current.actions.persistAnswer('q-typing', 'MAR');
      result.current.actions.persistAnswer('q-typing', 'MARS');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(1);
    });
    await waitFor(() => {
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalled();
    });

    const pendingMutations = vi
      .mocked(studentAttemptRepository.savePendingMutations)
      .mock.calls.at(-1)?.[1];

    expect(result.current.state.attempt?.answers['q-typing']).toBe('MARS');
    expect(pendingMutations).toHaveLength(1);
    expect(pendingMutations?.[0]?.payload).toMatchObject({
      questionId: 'q-typing',
      value: 'MARS',
    });
  });

  it('coalesces fast typing per slot index while preserving each slot mutation', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });
    const questionId = 'blk-af811567-c9aa-4a4d-8775-44b529b499fd';

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer(
        questionId,
        ['C', '', ''],
        { slotIndex: 0 },
      );
      result.current.actions.persistAnswer(
        questionId,
        ['CA', '', ''],
        { slotIndex: 0 },
      );
      result.current.actions.persistAnswer(
        questionId,
        ['CA', 'T', ''],
        { slotIndex: 1 },
      );
      result.current.actions.persistAnswer(
        questionId,
        ['CA', 'TE', ''],
        { slotIndex: 1 },
      );
      result.current.actions.persistAnswer(
        questionId,
        ['CA', 'TE', 'S'],
        { slotIndex: 2 },
      );
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(3);
    });
    await waitFor(() => {
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalled();
    });

    const pendingMutations = vi
      .mocked(studentAttemptRepository.savePendingMutations)
      .mock.calls.at(-1)?.[1] ?? [];
    const bySlot = new Map(
      pendingMutations
        .filter((mutation) => mutation.type === 'answer')
        .map((mutation) => [mutation.payload['slotIndex'], mutation]),
    );

    expect(pendingMutations).toHaveLength(3);
    expect(bySlot.get(0)?.payload['value']).toEqual(['CA', '', '']);
    expect(bySlot.get(1)?.payload['value']).toEqual(['CA', 'TE', '']);
    expect(bySlot.get(2)?.payload['value']).toEqual(['CA', 'TE', 'S']);
  });

  it('does not coalesce array answer mutations across different slot indexes', async () => {
    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.actions.persistAnswer(
        'blk-af811567-c9aa-4a4d-8775-44b529b499fd',
        ['239', 'MODERN', 'LAMP', '', '', '', '', '', '', ''],
        { slotIndex: 2 },
      );
      result.current.actions.persistAnswer(
        'blk-af811567-c9aa-4a4d-8775-44b529b499fd',
        ['239', 'MODERN', 'LAMP', 'AARON', '', '', '', '', '', ''],
        { slotIndex: 3 },
      );
    });

    await waitFor(() => {
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalled();
    });

    const pendingMutations = vi
      .mocked(studentAttemptRepository.savePendingMutations)
      .mock.calls.at(-1)?.[1];

    expect(pendingMutations).toHaveLength(2);
    expect(pendingMutations?.map((mutation) => mutation.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          questionId: 'blk-af811567-c9aa-4a4d-8775-44b529b499fd',
          slotIndex: 2,
        }),
        expect.objectContaining({
          questionId: 'blk-af811567-c9aa-4a4d-8775-44b529b499fd',
          slotIndex: 3,
        }),
      ]),
    );
  });

  it('persists slot identity metadata for slot-scoped answer mutations', async () => {
    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.actions.persistAnswer(
        'blk-af811567-c9aa-4a4d-8775-44b529b499fd',
        ['239', 'WOLF', 'BIRD'],
        {
          slotIndex: 1,
          slotId: 'blk-af811567-c9aa-4a4d-8775-44b529b499fd:blank-b',
          slotCount: 3,
        },
      );
    });

    await waitFor(() => {
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalled();
    });

    const pendingMutations = vi
      .mocked(studentAttemptRepository.savePendingMutations)
      .mock.calls.at(-1)?.[1];

    expect(pendingMutations).toHaveLength(1);
    expect(pendingMutations?.[0]?.payload).toMatchObject({
      questionId: 'blk-af811567-c9aa-4a4d-8775-44b529b499fd',
      slotIndex: 1,
      slotId: 'blk-af811567-c9aa-4a4d-8775-44b529b499fd:blank-b',
      slotCount: 3,
    });
  });

  it('clears one slot without shifting or wiping its sibling slot answers', async () => {
    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });
    const questionId = 'blk-af811567-c9aa-2a4d-8775-44b529b499fd';

    await act(async () => {
      result.current.actions.persistAnswer(
        questionId,
        ['daily', 'late'],
        { slotIndex: 1 },
      );
      result.current.actions.persistAnswer(
        questionId,
        ['', 'late'],
        { slotIndex: 0 },
      );
    });

    await waitFor(() => {
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalled();
    });

    const pendingMutations = vi
      .mocked(studentAttemptRepository.savePendingMutations)
      .mock.calls.at(-1)?.[1] ?? [];
    const bySlot = new Map(
      pendingMutations
        .filter((mutation) => mutation.type === 'answer')
        .map((mutation) => [mutation.payload['slotIndex'], mutation]),
    );

    // The clear of slot 0 must be a distinct per-slot mutation that keeps the
    // slot-1 value untouched; it must never shift the sibling into another
    // position or drop it.
    expect(pendingMutations).toHaveLength(2);
    expect(bySlot.get(0)?.payload['value']).toEqual(['', 'late']);
    expect(bySlot.get(1)?.payload['value']).toEqual(['daily', 'late']);
    expect(result.current.state.attempt?.answers[questionId]).toEqual(['', 'late']);
  });

  it('submits the attempt even when pending mutations are still queued', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'A');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBeGreaterThan(0);
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    await act(async () => {
      const submitted = await result.current.actions.submitAttempt();
      expect(submitted).toBe(true);
    });

    expect(studentAttemptRepository.submitAttempt).toHaveBeenCalled();
  });

  it('flushes answer changes made while another flush is in flight before reporting success', async () => {
    let resolveFirstSave: (() => void) | null = null;
    vi.mocked(studentAttemptRepository.saveAttempt)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstSave = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'first');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(1);
    });

    let flushPromise: Promise<boolean>;
    await act(async () => {
      flushPromise = result.current.actions.flushPending();
    });

    await waitFor(() => {
      expect(studentAttemptRepository.saveAttempt).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'second');
    });

    await waitFor(() => {
      expect(result.current.state.attempt?.answers.q1).toBe('second');
    });

    await act(async () => {
      resolveFirstSave?.();
      await flushPromise;
    });

    expect(studentAttemptRepository.saveAttempt).toHaveBeenCalledTimes(2);
    expect(vi.mocked(studentAttemptRepository.saveAttempt).mock.calls.at(-1)?.[0].answers.q1)
      .toBe('second');
    expect(result.current.state.pendingMutationCount).toBe(0);
  });

  it('does not lose new answers queued while clearPendingMutations is still in flight', async () => {
    let resolveClearPending: (() => void) | null = null;
    vi.mocked(studentAttemptRepository.clearPendingMutations).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveClearPending = resolve;
        }),
    );

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'first');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(1);
    });

    let flushPromise: Promise<boolean>;
    await act(async () => {
      flushPromise = result.current.actions.flushPending();
    });

    await waitFor(() => {
      expect(studentAttemptRepository.clearPendingMutations).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'second');
    });

    await waitFor(() => {
      expect(result.current.state.attempt?.answers.q1).toBe('second');
      expect(result.current.state.pendingMutationCount).toBe(1);
    });

    await act(async () => {
      resolveClearPending?.();
      const flushed = await flushPromise;
      expect(flushed).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(0);
    });

    expect(studentAttemptRepository.saveAttempt).toHaveBeenCalledTimes(2);
    expect(vi.mocked(studentAttemptRepository.saveAttempt).mock.calls.at(-1)?.[0].answers.q1)
      .toBe('second');
  });

  it('preserves the final answer when latency overlaps a rapid typing burst', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    let resolveFirstSave: (() => void) | null = null;
    vi.mocked(studentAttemptRepository.saveAttempt)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstSave = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'A');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(1);
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    let flushPromise: Promise<boolean>;
    await act(async () => {
      flushPromise = result.current.actions.flushPending();
    });

    await waitFor(() => {
      expect(studentAttemptRepository.saveAttempt).toHaveBeenCalledTimes(1);
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'AB');
      result.current.actions.persistAnswer('q1', 'ABC');
      result.current.actions.persistAnswer('q1', 'ABCD');
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    await act(async () => {
      resolveFirstSave?.();
      const flushed = await flushPromise;
      expect(flushed).toBe(true);
    });

    expect(studentAttemptRepository.saveAttempt).toHaveBeenCalledTimes(2);
    expect(vi.mocked(studentAttemptRepository.saveAttempt).mock.calls.at(-1)?.[0].answers.q1)
      .toBe('ABCD');
    expect(result.current.state.pendingMutationCount).toBe(0);
  });

  it('keeps pending mutations when connection drops mid-flush and recovers on retry', async () => {
    let resolveFirstSave: (() => void) | null = null;
    vi.mocked(studentAttemptRepository.saveAttempt)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstSave = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'first');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(1);
    });

    let firstFlushPromise: Promise<boolean>;
    await act(async () => {
      firstFlushPromise = result.current.actions.flushPending();
    });

    await waitFor(() => {
      expect(studentAttemptRepository.saveAttempt).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'second');
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    await act(async () => {
      resolveFirstSave?.();
      const flushed = await firstFlushPromise;
      expect(flushed).toBe(false);
    });

    expect(studentAttemptRepository.saveAttempt).toHaveBeenCalledTimes(1);
    expect(result.current.state.pendingMutationCount).toBe(1);
    expect(result.current.state.attempt?.recovery.syncState).toBe('offline');
    expect(studentAttemptRepository.clearPendingMutations).not.toHaveBeenCalled();

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    await act(async () => {
      const flushed = await result.current.actions.flushPending();
      expect(flushed).toBe(true);
    });

    expect(studentAttemptRepository.saveAttempt).toHaveBeenCalledTimes(2);
    expect(result.current.state.pendingMutationCount).toBe(0);
    expect(vi.mocked(studentAttemptRepository.saveAttempt).mock.calls.at(-1)?.[0].answers.q1)
      .toBe('second');
  });

  it('still marks submission complete when immediate submit sync fails', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    vi.mocked(studentAttemptRepository.saveAttempt).mockRejectedValueOnce(new Error('persist failed'));

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'A');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBeGreaterThan(0);
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    await act(async () => {
      const submitted = await result.current.actions.submitAttempt();
      expect(submitted).toBe(true);
    });

    expect(studentAttemptRepository.submitAttempt).toHaveBeenCalled();
    expect(result.current.state.attempt?.phase).toBe('post-exam');
  });

  it('does not drop pending mutations when the attempt credential is missing', async () => {
    window.sessionStorage.clear();

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'A');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBeGreaterThan(0);
    });

    let flushed = true;
    await act(async () => {
      flushed = await result.current.actions.flushPending();
    });

    expect(flushed).toBe(false);
    expect(studentAttemptRepository.clearPendingMutations).not.toHaveBeenCalled();
    expect(result.current.state.pendingMutationCount).toBeGreaterThan(0);
    expect(result.current.state.attempt?.recovery.syncState).toBe('error');
  });

  it('tags objective answer mutations with the runtime section when the attempt snapshot is stale', async () => {
    const staleAttempt = {
      ...createAttemptSnapshot(),
      currentModule: 'listening' as const,
      currentQuestionId: 'listening-q1',
    };
    const runtimeSnapshot = createRuntimeSnapshot('reading');

    const { result } = renderHook(() => useStudentAttempt(), {
      wrapper: createRuntimeBackedWrapper(staleAttempt, runtimeSnapshot),
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer('reading-q1', 'mars');
    });

    await waitFor(() => {
      const pendingMutations = vi
        .mocked(studentAttemptRepository.savePendingMutations)
        .mock.calls.at(-1)?.[1];
      const answerMutation = pendingMutations?.find((mutation) => mutation.type === 'answer');
      expect(answerMutation).toBeDefined();
      expect(answerMutation?.payload).toMatchObject({
        questionId: 'reading-q1',
        value: 'mars',
        module: 'reading',
      });
    });
  });

  it('batches durable answer persistence within a 100ms debounce while keeping RAM updates immediate', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'A');
      result.current.actions.persistAnswer('q1', 'AB');
      result.current.actions.persistAnswer('q1', 'ABC');
    });

    expect(result.current.state.attempt?.answers.q1).toBe('ABC');
    expect(result.current.state.pendingMutationCount).toBe(1);
    expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(ANSWER_DURABLE_WRITE_DEBOUNCE_MS - 1);
    });
    expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

    await flushAnswerDurableDebounceWindow();

    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
    expect(vi.mocked(studentAttemptRepository.savePendingMutations).mock.calls[0]?.[1]?.[0]?.payload)
      .toMatchObject({
        questionId: 'q1',
        value: 'ABC',
      });
    vi.useRealTimers();
  });

  it('persists discrete objective selections durably without waiting for the debounce window', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'A', {
        interactionType: 'discrete',
      } as any);
      await Promise.resolve();
    });

    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
    expect(vi.mocked(studentAttemptRepository.savePendingMutations).mock.calls[0]?.[1]?.[0]?.payload)
      .toMatchObject({
        questionId: 'q1',
        value: 'A',
        interactionType: 'discrete',
      });

    await act(async () => {
      vi.advanceTimersByTime(ANSWER_DURABLE_WRITE_DEBOUNCE_MS + 10);
      await Promise.resolve();
    });

    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('persists a typed answer durably immediately once remaining time is inside the 20-second boundary', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const runtimeSnapshot: ExamSessionRuntime = {
      ...createRuntimeSnapshot('reading'),
      currentSectionRemainingSeconds: 10,
    };

    const { result } = renderHook(() => useStudentAttempt(), {
      wrapper: createRuntimeBackedWrapper(createBoundaryAttemptSnapshot(), runtimeSnapshot),
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'FINAL_TYPED');
      await Promise.resolve();
    });

    // FEX-030: RAM reflects the answer synchronously…
    expect(result.current.state.attempt?.answers.q1).toBe('FINAL_TYPED');
    // FEX-031: …and the durable write skips the 100ms typing debounce entirely.
    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(studentAttemptRepository.savePendingMutations).mock.calls[0]?.[1]?.[0]?.payload,
    ).toMatchObject({
      questionId: 'q1',
      value: 'FINAL_TYPED',
    });

    await act(async () => {
      vi.advanceTimersByTime(ANSWER_DURABLE_WRITE_DEBOUNCE_MS + 10);
      await Promise.resolve();
    });

    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('keeps the 100ms durable debounce once remaining time moves above the immediate-durability boundary', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const runtimeSnapshot: ExamSessionRuntime = {
      ...createRuntimeSnapshot('reading'),
      currentSectionRemainingSeconds: 21,
    };

    const { result } = renderHook(() => useStudentAttempt(), {
      wrapper: createRuntimeBackedWrapper(createBoundaryAttemptSnapshot(), runtimeSnapshot),
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'EARLY_TYPED');
    });

    // RAM stays immediate; durability remains debounced outside the boundary.
    expect(result.current.state.attempt?.answers.q1).toBe('EARLY_TYPED');
    expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(ANSWER_DURABLE_WRITE_DEBOUNCE_MS - 1);
    });
    expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

    await flushAnswerDurableDebounceWindow();

    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(studentAttemptRepository.savePendingMutations).mock.calls[0]?.[1]?.[0]?.payload,
    ).toMatchObject({
      questionId: 'q1',
      value: 'EARLY_TYPED',
    });
    vi.useRealTimers();
  });

  it('applies the final-time boundary to writing answers, skipping the durable debounce', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const runtimeSnapshot: ExamSessionRuntime = {
      ...createRuntimeSnapshot('reading'),
      currentSectionRemainingSeconds: 10,
    };

    const { result } = renderHook(() => useStudentAttempt(), {
      wrapper: createRuntimeBackedWrapper(
        createBoundaryAttemptSnapshot({
          currentModule: 'writing',
          currentQuestionId: 'task1',
        }),
        runtimeSnapshot,
      ),
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      result.current.actions.persistWritingAnswer('task1', '<p>FINAL</p>');
      await Promise.resolve();
    });

    expect(result.current.state.attempt?.writingAnswers.task1).toBe('<p>FINAL</p>');

    // FEX-031: the writing mutation must reach the durable mirror without ANY
    // timer advancement — the durable debounce is skipped entirely (the 1500ms
    // writing delay only governs the outbound network flush, offline here).
    const writingMutationsDurablyPersisted = vi
      .mocked(studentAttemptRepository.savePendingMutations)
      .mock.calls.map((call) => call[1] ?? [])
      .flat()
      .filter((mutation) => mutation.type === 'writing_answer');
    expect(writingMutationsDurablyPersisted).toHaveLength(1);
    expect(writingMutationsDurablyPersisted[0]?.payload).toMatchObject({
      taskId: 'task1',
      value: '<p>FINAL</p>',
    });

    // And an untouched debounce window far beyond the 100ms durable budget adds
    // no further writes — the value is already durably persisted by the boundary path.
    const callsAfterImmediatePersist = vi.mocked(
      studentAttemptRepository.savePendingMutations,
    ).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(ANSWER_DURABLE_WRITE_DEBOUNCE_MS + 10);
      await Promise.resolve();
    });

    expect(
      vi.mocked(studentAttemptRepository.savePendingMutations).mock.calls.length,
    ).toBe(callsAfterImmediatePersist);
    vi.useRealTimers();
  });

  it('forces an immediate durable answer flush on input blur before the debounce window elapses', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'A');
    });

    expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

    const input = document.createElement('input');
    document.body.appendChild(input);

    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await Promise.resolve();
    });

    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
    input.remove();
    vi.useRealTimers();
  });

  it('creates and flushes an answer mutation from DOM rescue on focusout when no mutation was queued yet', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    function ObjectiveRescueHarness() {
      const { actions } = useStudentAttempt();
      const [value, setValue] = React.useState('');

      return (
        <ProtectedInput
          security={{ preventAutofill: true, preventAutocorrect: true }}
          aria-label="objective answer"
          value={value}
          onChange={(event) => {
            const nextValue = (event.target as HTMLInputElement).value;
            setValue(nextValue);
            void actions.persistAnswer('q1', nextValue);
          }}
        />
      );
    }

    render(<ObjectiveRescueHarness />, { wrapper: createWrapper() });

    expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();
    const input = screen.getByRole('textbox', { name: 'objective answer' }) as HTMLInputElement;
    input.value = 'RESCUED_TYPED_VALUE';

    await act(async () => {
      fireEvent(input, new FocusEvent('focusout', { bubbles: true }));
      await Promise.resolve();
    });

    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
    const persistedMutations = vi.mocked(studentAttemptRepository.savePendingMutations).mock.calls[0]?.[1];
    expect(persistedMutations).toHaveLength(1);
    expect(persistedMutations?.[0]?.type).toBe('answer');
    expect(persistedMutations?.[0]?.payload).toMatchObject({
      questionId: 'q1',
      value: 'RESCUED_TYPED_VALUE',
    });
    vi.useRealTimers();
  });

  it('does not flush or clear RAM pending answers when durable pending-mutation persist fails', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    vi.mocked(studentAttemptRepository.savePendingMutations).mockRejectedValue(
      new Error('quota exceeded'),
    );

    const { result } = renderHook(
      () => ({
        attempt: useStudentAttempt(),
        runtime: useStudentRuntime(),
      }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.attempt.actions.persistAnswer('q1', 'LOCAL_TYPED');
    });

    await flushAnswerDurableDebounceWindow();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.attempt.state.attempt?.recovery.syncState).toBe('error');

    await act(async () => {
      const flushed = await result.current.attempt.actions.flushPending();
      expect(flushed).toBe(false);
    });

    expect(studentAttemptRepository.saveAttempt).not.toHaveBeenCalled();
    expect(studentAttemptRepository.clearPendingMutations).not.toHaveBeenCalled();
    expect(result.current.attempt.state.pendingMutationCount).toBeGreaterThan(0);
    expect(result.current.attempt.state.attempt?.answers.q1).toBe('LOCAL_TYPED');
    expect(result.current.runtime.state.blocking.reason).toBe('storage_unavailable');
    vi.useRealTimers();
  });

  it('emitted the pending-persist-failure observability metric and storage-error audit event exactly once across a durable failure and a later success (FEX-033)', async () => {
    vi.useFakeTimers();
    const observabilityMetricSpy = vi.spyOn(
      studentObservabilityUtilsModule,
      'emitStudentObservabilityMetric',
    );
    const auditEventSpy = vi
      .spyOn(studentAttemptFacadeModule, 'saveStudentAuditEvent')
      .mockResolvedValue(undefined);
    try {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      vi.mocked(studentAttemptRepository.savePendingMutations).mockRejectedValue(
        new Error('quota exceeded'),
      );

      const { result } = renderHook(
        () => ({
          attempt: useStudentAttempt(),
          runtime: useStudentRuntime(),
        }),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        result.current.attempt.actions.persistAnswer('q1', 'LOCAL_TYPED');
      });

      await flushAnswerDurableDebounceWindow();
      await act(async () => {
        await Promise.resolve();
      });

      const pendingPersistFailureCalls = observabilityMetricSpy.mock.calls.filter(
        (call) => call[0] === 'student_pending_persist_failure_total',
      );
      const storageErrorAuditCalls = auditEventSpy.mock.calls.filter(
        (call) => call[1] === 'PERSISTENCE_STORAGE_ERROR',
      );
      expect(pendingPersistFailureCalls).toHaveLength(1);
      expect(storageErrorAuditCalls).toHaveLength(1);
      expect(result.current.attempt.state.attempt?.recovery.syncState).toBe('error');

      // Snapshot the total spy call counts so the subsequent successful save
      // can prove it fires NO additional metric/audit calls at all.
      const metricCallCountAfterFailure = observabilityMetricSpy.mock.calls.length;
      const auditCallCountAfterFailure = auditEventSpy.mock.calls.length;

      await act(async () => {
        // mockResolvedValue restores the durable-write path: the next durable
        // save succeeds.
        vi.mocked(studentAttemptRepository.savePendingMutations).mockResolvedValue();
      });
      await act(async () => {
        result.current.attempt.actions.persistAnswer('q1', 'LOCAL_TYPED_2');
      });
      await flushAnswerDurableDebounceWindow();
      await act(async () => {
        await Promise.resolve();
      });

      // The successful save fires no additional metric or audit calls.
      expect(observabilityMetricSpy.mock.calls.length).toBe(metricCallCountAfterFailure);
      expect(auditEventSpy.mock.calls.length).toBe(auditCallCountAfterFailure);
      expect(
        observabilityMetricSpy.mock.calls.filter(
          (call) => call[0] === 'student_pending_persist_failure_total',
        ),
      ).toHaveLength(1);
      expect(
        auditEventSpy.mock.calls.filter(
          (call) => call[1] === 'PERSISTENCE_STORAGE_ERROR',
        ),
      ).toHaveLength(1);
    } finally {
      observabilityMetricSpy.mockRestore();
      auditEventSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('recovers answer mutations from the sync checkpoint when repository pending mutations are empty', async () => {
    const checkpointPayload = {
      attemptId: 'attempt-1',
      savedAt: '2026-01-01T00:00:00.000Z',
      mutationVersion: 2,
      mutations: [
        {
          id: 'mutation-answer-1',
          attemptId: 'attempt-1',
          scheduleId: 'sched-1',
          timestamp: '2026-01-01T00:00:00.000Z',
          type: 'answer',
          payload: {
            questionId: 'q1',
            value: 'CHECKPOINT_ANSWER',
            interactionType: 'typing',
          },
        },
      ],
    };
    window.localStorage.setItem(
      `${ANSWER_SYNC_CHECKPOINT_KEY_PREFIX}:attempt-1`,
      JSON.stringify(checkpointPayload),
    );
    vi.mocked(studentAttemptRepository.getPendingMutations).mockResolvedValue([]);
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(
      () => ({
        attempt: useStudentAttempt(),
        runtime: useStudentRuntime(),
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.attempt.state.pendingMutationCount).toBe(1);
    });

    expect(result.current.attempt.state.attempt?.answers.q1).toBe('CHECKPOINT_ANSWER');
  });

  it('forces an immediate durable answer flush on pagehide and beforeunload', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'A');
    });
    expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      await Promise.resolve();
    });
    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);

    vi.mocked(studentAttemptRepository.savePendingMutations).mockClear();
    await act(async () => {
      result.current.actions.persistAnswer('q1', 'AB');
    });
    expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'));
      await Promise.resolve();
    });
    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('forces an immediate durable answer flush on window blur and page freeze', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'A');
    });
    expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      await Promise.resolve();
    });
    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);

    vi.mocked(studentAttemptRepository.savePendingMutations).mockClear();
    await act(async () => {
      result.current.actions.persistAnswer('q1', 'AB');
    });
    expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(new Event('freeze'));
      await Promise.resolve();
    });
    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('forces an immediate durable answer flush when the document becomes hidden (visibilitychange)', async () => {
    vi.useFakeTimers();
    const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState',
    );
    try {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });

      const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

      await act(async () => {
        result.current.actions.persistAnswer('q1', 'A');
      });
      expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);

      // The visibility guard only flushes on `hidden`: a fresh unsaved answer
      // must stay debounced while the document is visible again.
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      vi.mocked(studentAttemptRepository.savePendingMutations).mockClear();
      await act(async () => {
        result.current.actions.persistAnswer('q1', 'AB');
      });
      expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });
      expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await Promise.resolve();
      });
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
      expect(
        vi
          .mocked(studentAttemptRepository.savePendingMutations)
          .mock.calls.at(-1)?.[1]?.[0]?.payload,
      ).toMatchObject({
        questionId: 'q1',
        value: 'AB',
      });
    } finally {
      if (originalVisibilityStateDescriptor) {
        Object.defineProperty(document, 'visibilityState', originalVisibilityStateDescriptor);
      } else {
        Reflect.deleteProperty(document, 'visibilityState');
      }
      vi.useRealTimers();
    }
  });

  it('keeps non-answer mutation durability immediate (no debounce)', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.actions.persistFlag('q1', true);
      await Promise.resolve();
    });

    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);

    await flushAnswerDurableDebounceWindow();
    expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
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

  it('does not generate autosave mutations when hydrating existing answers', async () => {
    const hydratedAttempt: StudentAttempt = {
      ...createAttemptSnapshot(),
      answers: {
        'blk-af811567-c9aa-4a4d-8775-44b529b499fd': ['cat', 'dog', 'bird'],
      },
      currentQuestionId: 'blk-af811567-c9aa-4a4d-8775-44b529b499fd',
    };

    renderHook(() => useStudentAttempt(), { wrapper: createWrapper(hydratedAttempt) });

    await act(async () => {
      await Promise.resolve();
    });

    expect(studentAttemptRepository.savePendingMutations).not.toHaveBeenCalled();
    expect(studentAttemptRepository.saveAttempt).not.toHaveBeenCalled();
  });

  it('hydrates proctor warnings even while local mutations are pending', async () => {
    const state = createExamState();

    const initialAttempt = createAttemptSnapshot();
    let updateAttemptSnapshot: ((next: StudentAttempt) => void) | null = null;

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const [attemptSnapshot, setAttemptSnapshot] = React.useState(initialAttempt);

      React.useEffect(() => {
        updateAttemptSnapshot = setAttemptSnapshot;
        return () => {
          updateAttemptSnapshot = null;
        };
      }, []);

      return (
        <StudentRuntimeProvider state={state} onExit={vi.fn()} attemptSnapshot={attemptSnapshot}>
          <StudentAttemptProvider
            scheduleId={attemptSnapshot.scheduleId}
            attemptSnapshot={attemptSnapshot}
          >
            {children}
          </StudentAttemptProvider>
        </StudentRuntimeProvider>
      );
    };

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.state.attemptId).toBe('attempt-1');
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'A');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBeGreaterThan(0);
      expect(result.current.state.attempt?.answers.q1).toBe('A');
    });

    const warnedAttempt: StudentAttempt = {
      ...initialAttempt,
      updatedAt: '2026-01-01T00:00:01.000Z',
      violations: [
        ...initialAttempt.violations,
        {
          id: 'warning-1',
          type: 'PROCTOR_WARNING',
          severity: 'high',
          timestamp: '2026-01-01T00:00:01.000Z',
          description: 'Please focus on your exam',
        },
      ],
      lastWarningId: 'warning-1',
      proctorStatus: 'warned',
      proctorUpdatedAt: '2026-01-01T00:00:01.000Z',
      proctorUpdatedBy: 'Proctor',
    };

    await act(async () => {
      updateAttemptSnapshot?.(warnedAttempt);
    });

    await waitFor(() => {
      expect(
        result.current.state.attempt?.violations.some(
          (violation) => violation.type === 'PROCTOR_WARNING',
        ),
      ).toBe(true);
      expect(result.current.state.attempt?.answers.q1).toBe('A');
    });
  });

  it('keeps local answers when a stale backend snapshot arrives after a successful flush', async () => {
    const state = createExamState();
    const initialAttempt = createAttemptSnapshot();
    let updateAttemptSnapshot: ((next: StudentAttempt) => void) | null = null;

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const [attemptSnapshot, setAttemptSnapshot] = React.useState(initialAttempt);

      React.useEffect(() => {
        updateAttemptSnapshot = setAttemptSnapshot;
        return () => {
          updateAttemptSnapshot = null;
        };
      }, []);

      return (
        <StudentRuntimeProvider state={state} onExit={vi.fn()} attemptSnapshot={attemptSnapshot}>
          <StudentAttemptProvider
            scheduleId={attemptSnapshot.scheduleId}
            attemptSnapshot={attemptSnapshot}
          >
            {children}
          </StudentAttemptProvider>
        </StudentRuntimeProvider>
      );
    };

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.state.attemptId).toBe('attempt-1');
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'LOCAL');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(1);
      expect(result.current.state.attempt?.answers.q1).toBe('LOCAL');
    });

    await act(async () => {
      const flushed = await result.current.actions.flushPending();
      expect(flushed).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(0);
    });

    const staleAttempt: StudentAttempt = {
      ...initialAttempt,
      updatedAt: '2026-01-01T00:00:00.500Z',
      answers: {},
    };

    await act(async () => {
      updateAttemptSnapshot?.(staleAttempt);
    });

    await waitFor(() => {
      expect(result.current.state.attempt?.answers.q1).toBe('LOCAL');
    });
  });

  it('uses a fresher backend snapshot when incoming attempt state is newer', async () => {
    const state = createExamState();
    const initialAttempt = createAttemptSnapshot();
    let updateAttemptSnapshot: ((next: StudentAttempt) => void) | null = null;

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const [attemptSnapshot, setAttemptSnapshot] = React.useState(initialAttempt);

      React.useEffect(() => {
        updateAttemptSnapshot = setAttemptSnapshot;
        return () => {
          updateAttemptSnapshot = null;
        };
      }, []);

      return (
        <StudentRuntimeProvider state={state} onExit={vi.fn()} attemptSnapshot={attemptSnapshot}>
          <StudentAttemptProvider
            scheduleId={attemptSnapshot.scheduleId}
            attemptSnapshot={attemptSnapshot}
          >
            {children}
          </StudentAttemptProvider>
        </StudentRuntimeProvider>
      );
    };

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.state.attemptId).toBe('attempt-1');
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'LOCAL');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(1);
      expect(result.current.state.attempt?.answers.q1).toBe('LOCAL');
    });

    await act(async () => {
      const flushed = await result.current.actions.flushPending();
      expect(flushed).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(0);
    });

    const freshServerAttempt: StudentAttempt = {
      ...initialAttempt,
      updatedAt: '2099-01-01T00:00:00.000Z',
      answers: { q1: 'SERVER_NEW' },
      recovery: {
        ...initialAttempt.recovery,
        serverAcceptedThroughSeq: 99,
        syncState: 'saved',
      },
    };

    await act(async () => {
      updateAttemptSnapshot?.(freshServerAttempt);
    });

    await waitFor(() => {
      expect(result.current.state.attempt?.answers.q1).toBe('SERVER_NEW');
    });
  });

  it('keeps local answers when freshness signals are equal but local mutation signals exist', async () => {
    const state = createExamState();
    const initialAttempt = createAttemptSnapshot();
    let updateAttemptSnapshot: ((next: StudentAttempt) => void) | null = null;

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const [attemptSnapshot, setAttemptSnapshot] = React.useState(initialAttempt);

      React.useEffect(() => {
        updateAttemptSnapshot = setAttemptSnapshot;
        return () => {
          updateAttemptSnapshot = null;
        };
      }, []);

      return (
        <StudentRuntimeProvider state={state} onExit={vi.fn()} attemptSnapshot={attemptSnapshot}>
          <StudentAttemptProvider
            scheduleId={attemptSnapshot.scheduleId}
            attemptSnapshot={attemptSnapshot}
          >
            {children}
          </StudentAttemptProvider>
        </StudentRuntimeProvider>
      );
    };

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.state.attemptId).toBe('attempt-1');
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'LOCAL');
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(1);
      expect(result.current.state.attempt?.answers.q1).toBe('LOCAL');
    });

    await act(async () => {
      const flushed = await result.current.actions.flushPending();
      expect(flushed).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.state.pendingMutationCount).toBe(0);
    });

    const localAttemptAfterFlush = result.current.state.attempt;
    expect(localAttemptAfterFlush).not.toBeNull();

    const equalFreshnessServerAttempt: StudentAttempt = {
      ...initialAttempt,
      answers: { q1: 'SERVER_EQUAL' },
      updatedAt: localAttemptAfterFlush?.updatedAt ?? initialAttempt.updatedAt,
      recovery: {
        ...initialAttempt.recovery,
        lastPersistedAt: localAttemptAfterFlush?.recovery.lastPersistedAt ?? null,
        serverAcceptedThroughSeq:
          localAttemptAfterFlush?.recovery.serverAcceptedThroughSeq ??
          initialAttempt.recovery.serverAcceptedThroughSeq,
        syncState: 'saved',
      },
    };

    await act(async () => {
      updateAttemptSnapshot?.(equalFreshnessServerAttempt);
    });

    await waitFor(() => {
      expect(result.current.state.attempt?.answers.q1).toBe('LOCAL');
    });
  });

  it('preserves local answers in preview mode when backend snapshots refresh', async () => {
    const state = createExamState();
    const initialAttempt = createAttemptSnapshot();
    let updateAttemptSnapshot: ((next: StudentAttempt) => void) | null = null;

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const [attemptSnapshot, setAttemptSnapshot] = React.useState(initialAttempt);

      React.useEffect(() => {
        updateAttemptSnapshot = setAttemptSnapshot;
        return () => {
          updateAttemptSnapshot = null;
        };
      }, []);

      return (
        <StudentRuntimeProvider state={state} onExit={vi.fn()} attemptSnapshot={attemptSnapshot}>
          <StudentAttemptProvider
            scheduleId={attemptSnapshot.scheduleId}
            attemptSnapshot={attemptSnapshot}
            persistenceEnabled={false}
          >
            {children}
          </StudentAttemptProvider>
        </StudentRuntimeProvider>
      );
    };

    const { result } = renderHook(() => useStudentAttempt(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.state.attemptId).toBe('attempt-1');
    });

    await act(async () => {
      result.current.actions.persistAnswer('q1', 'PREVIEW_LOCAL');
    });

    await waitFor(() => {
      expect(result.current.state.attempt?.answers.q1).toBe('PREVIEW_LOCAL');
    });

    const refreshedBackendAttempt: StudentAttempt = {
      ...initialAttempt,
      updatedAt: '2026-01-01T00:00:03.000Z',
      answers: {},
      recovery: {
        ...initialAttempt.recovery,
        syncState: 'idle',
      },
    };

    await act(async () => {
      updateAttemptSnapshot?.(refreshedBackendAttempt);
    });

    await waitFor(() => {
      expect(result.current.state.attempt?.answers.q1).toBe('PREVIEW_LOCAL');
    });
  });

  it('does not attempt state updates after unmount while flushing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let resolveSave: (() => void) | null = null;
    vi.mocked(studentAttemptRepository.saveAttempt).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    const wrapper = createWrapper();
    const harness = renderHook(() => useStudentAttempt(), { wrapper });

    await act(async () => {
      harness.result.current.actions.persistAnswer('q1', 'A');
    });

    let flushPromise: Promise<boolean>;
    await act(async () => {
      flushPromise = harness.result.current.actions.flushPending();
    });
    await act(async () => {
      harness.unmount();
    });

    await act(async () => {
      resolveSave?.();
      await flushPromise;
    });

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('StudentAttemptProvider pending submission contract (FEX-051)', () => {
  const PENDING_SUBMISSIONS_STORAGE_KEY = 'ielts_student_attempt_pending_submissions_v1';

  beforeEach(() => {
    // Self-contained spy setup: restore any spies left by earlier describes so
    // mock call history never leaks between tests, then re-establish the full
    // provider mock surface this block relies on.
    vi.restoreAllMocks();

    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      'ielts_student_attempt_credentials_v1',
      JSON.stringify([
        {
          attemptId: 'attempt-1',
          scheduleId: 'sched-1',
          attemptToken: 'token-1',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      ]),
    );
    window.localStorage.clear();

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    vi.spyOn(studentAttemptRepository, 'saveAttempt').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'savePendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'clearPendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'submitAttempt').mockResolvedValue({
      ...createAttemptSnapshot(),
      phase: 'post-exam',
      submittedAt: '2026-01-01T01:00:01.000Z',
    });
    vi.spyOn(studentAttemptRepository, 'saveHeartbeatEvent').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'getHeartbeatEvents').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepository, 'getPendingMutations').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepository, 'getAttemptsByScheduleId').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepoModule, 'refreshAttemptCredentialForAttempt').mockResolvedValue(false);

    vi.spyOn(studentAttemptRepository, 'savePendingSubmission').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'clearPendingSubmission').mockResolvedValue();
  });

  function seedPendingSubmission(
    attempt: StudentAttempt,
    overrides?: Partial<studentAttemptRepoModule.PendingStudentSubmission>,
  ): studentAttemptRepoModule.PendingStudentSubmission {
    const record = {
      ...studentAttemptRepoModule.buildPendingStudentSubmission(attempt),
      ...overrides,
    };
    window.localStorage.setItem(PENDING_SUBMISSIONS_STORAGE_KEY, JSON.stringify([record]));
    return record;
  }

  async function flushAsyncState() {
    await act(async () => {
      for (let i = 0; i < 30; i += 1) {
        await Promise.resolve();
      }
    });
  }

  it('records a pending submission and does not claim post-exam when the immediate submit fails', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(studentAttemptRepository.submitAttempt).mockRejectedValue(
        new Error('network down'),
      );

      const { result } = renderHook(
        () => ({
          attempt: useStudentAttempt(),
          runtime: useStudentRuntime(),
        }),
        { wrapper: createWrapper() },
      );

      await flushAsyncState();

      await act(async () => {
        result.current.attempt.actions.persistAnswer('q1', 'FINAL_ANSWER');
      });

      await act(async () => {
        const submitted = await result.current.attempt.actions.submitAttempt();
        expect(submitted).toBe(true);
      });

      // No false success: phase stays exam, no local submittedAt, no post-exam.
      expect(result.current.attempt.state.attempt?.phase).toBe('exam');
      expect(result.current.attempt.state.attempt?.submittedAt).toBeNull();
      expect(result.current.runtime.state.phase).not.toBe('post-exam');

      // The pending record carries the submission identity and the final snapshot.
      expect(result.current.attempt.state.pendingSubmission).not.toBeNull();
      expect(result.current.attempt.state.pendingSubmission?.submissionId).toBe(
        'student-submit-attempt-1',
      );
      expect(result.current.attempt.state.pendingSubmission?.finalSnapshot.answers.q1).toBe(
        'FINAL_ANSWER',
      );
      expect(studentAttemptRepository.savePendingSubmission).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptId: 'attempt-1',
          submissionId: 'student-submit-attempt-1',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries with the ORIGINAL frozen final snapshot and the same submission identity, then confirms', async () => {
    vi.useFakeTimers();
    try {
      const submittedAttempt: StudentAttempt = {
        ...createAttemptSnapshot(),
        phase: 'post-exam',
        submittedAt: '2026-01-01T01:00:01.000Z',
      };
      const submitSpy = vi.mocked(studentAttemptRepository.submitAttempt);
      submitSpy.mockResolvedValue(submittedAttempt);
      submitSpy.mockRejectedValueOnce(new Error('network down'));

      const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

      await flushAsyncState();

      await act(async () => {
        result.current.actions.persistAnswer('q1', 'FINAL_ANSWER');
      });

      await act(async () => {
        const submitted = await result.current.actions.submitAttempt();
        expect(submitted).toBe(true);
      });

      expect(result.current.state.pendingSubmission).not.toBeNull();
      expect(submitSpy).toHaveBeenCalledTimes(1);

      // The student cannot edit while pending, but a stray mutation must not
      // change what gets replayed.
      await act(async () => {
        result.current.actions.persistAnswer('q1', 'CHANGED_AFTER_SUBMIT');
      });

      // First background retry fires after the 5s backoff.
      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(submitSpy).toHaveBeenCalledTimes(2);
      const retryAttempt = submitSpy.mock.calls[1][0];
      expect(retryAttempt.id).toBe('attempt-1');
      expect(retryAttempt.answers.q1).toBe('FINAL_ANSWER');

      // The receipt transitions the page to confirmed success and clears the
      // pending record.
      await flushAsyncState();
      expect(result.current.state.pendingSubmission).toBeNull();
      expect(result.current.state.attempt?.phase).toBe('post-exam');
      expect(result.current.state.attempt?.submittedAt).toBe('2026-01-01T01:00:01.000Z');
      expect(studentAttemptRepository.clearPendingSubmission).toHaveBeenCalledWith('attempt-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries with the ORIGINAL frozen payload fields when revision advances after a lost response (I1 drift)', async () => {
    vi.useFakeTimers();
    try {
      // The repository attaches `submitPayload` (the payload-determining
      // fields of the failed request) to the thrown error; the provider must
      // persist and replay them so hash(retry) === hash(first request).
      const submitSpy = vi.mocked(studentAttemptRepository.submitAttempt);
      submitSpy.mockRejectedValue(
        Object.assign(new Error('response lost'), {
          submitPayload: {
            lastSeenRevision: 3,
            clientFinalSeq: 7,
            serverAcceptedThroughSeq: 5,
            finalClientSnapshotHash: 'sha-1',
          },
        }),
      );
      // Let the pending record actually persist so the bootstrap effect can
      // restore it when the snapshot changes (the beforeEach spy swallows it).
      vi.mocked(studentAttemptRepository.savePendingSubmission).mockRestore();

      let attemptSnapshot = {
        ...createAttemptSnapshot(),
        revision: 3,
        answers: { q1: 'FINAL_ANSWER' },
        recovery: { ...createAttemptSnapshot().recovery, serverAcceptedThroughSeq: 5 },
      };
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <StudentRuntimeProvider
          state={createExamState()}
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

      const { result, rerender } = renderHook(() => useStudentAttempt(), { wrapper });

      await flushAsyncState();

      await act(async () => {
        await result.current.actions.submitAttempt();
      });
      expect(submitSpy).toHaveBeenCalledTimes(1);
      expect(result.current.state.pendingSubmission?.frozenPayload).toEqual({
        lastSeenRevision: 3,
        clientFinalSeq: 7,
        serverAcceptedThroughSeq: 5,
        finalClientSnapshotHash: 'sha-1',
      });

      // The first submit actually reached the server (response lost). A later
      // mutation-batch response advances revision/seq BEFORE the first retry.
      attemptSnapshot = {
        ...attemptSnapshot,
        revision: 9,
        recovery: { ...attemptSnapshot.recovery, serverAcceptedThroughSeq: 8 },
      };
      rerender();
      await flushAsyncState();

      // First background retry after the 5s backoff must send the ORIGINAL
      // payload-determining fields and the ORIGINAL final snapshot.
      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(submitSpy).toHaveBeenCalledTimes(2);
      const [retryCandidate, retryFrozenPayload] = submitSpy.mock.calls[1];
      expect(retryCandidate.answers.q1).toBe('FINAL_ANSWER');
      expect(retryFrozenPayload).toEqual({
        lastSeenRevision: 3,
        clientFinalSeq: 7,
        serverAcceptedThroughSeq: 5,
        finalClientSnapshotHash: 'sha-1',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores a durable pending submission on mount and resumes the retry loop before any confirmed success', async () => {
    vi.useFakeTimers();
    try {
      const seededAttempt = {
        ...createAttemptSnapshot(),
        answers: { q1: 'SEEDED_FINAL' },
      };
      seedPendingSubmission(seededAttempt);

      vi.mocked(studentAttemptRepository.submitAttempt).mockRejectedValue(
        new Error('still down'),
      );

      const { result } = renderHook(() => useStudentAttempt(), {
        wrapper: createWrapper(seededAttempt),
      });

      await flushAsyncState();

      // Pending state is restored and the retry loop resumes with the SAME
      // submission identity — no confirmed state in between.
      expect(result.current.state.pendingSubmission).not.toBeNull();
      expect(result.current.state.pendingSubmission?.submissionId).toBe(
        'student-submit-attempt-1',
      );
      expect(result.current.state.attempt?.phase).toBe('exam');
      expect(result.current.state.attempt?.submittedAt).toBeNull();

      expect(studentAttemptRepository.submitAttempt).toHaveBeenCalledTimes(1);
      const retryAttempt = vi.mocked(studentAttemptRepository.submitAttempt).mock.calls[0][0];
      expect(retryAttempt.answers.q1).toBe('SEEDED_FINAL');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not resume an expired pending submission', async () => {
    vi.useFakeTimers();
    try {
      const seededAttempt = {
        ...createAttemptSnapshot(),
        answers: { q1: 'OLD' },
      };
      seedPendingSubmission(seededAttempt, {
        expiresAt: '2025-01-01T00:00:00.000Z',
      });

      const { result } = renderHook(() => useStudentAttempt(), {
        wrapper: createWrapper(seededAttempt),
      });

      await flushAsyncState();

      expect(result.current.state.pendingSubmission).toBeNull();
      expect(studentAttemptRepository.submitAttempt).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the pending submission when an authoritative submitted snapshot arrives', async () => {
    vi.useFakeTimers();
    try {
      const seededAttempt = {
        ...createAttemptSnapshot(),
        answers: { q1: 'SEEDED' },
      };
      seedPendingSubmission(seededAttempt);
      vi.mocked(studentAttemptRepository.submitAttempt).mockRejectedValue(
        new Error('still down'),
      );

      let attemptSnapshot = seededAttempt;
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <StudentRuntimeProvider
          state={createExamState()}
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

      const { result, rerender } = renderHook(() => useStudentAttempt(), { wrapper });

      await flushAsyncState();
      expect(result.current.state.pendingSubmission).not.toBeNull();

      attemptSnapshot = {
        ...seededAttempt,
        phase: 'post-exam',
        submittedAt: '2026-01-01T01:00:01.000Z',
      };
      rerender();

      await flushAsyncState();

      expect(result.current.state.pendingSubmission).toBeNull();
      expect(studentAttemptRepository.clearPendingSubmission).toHaveBeenCalledWith('attempt-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('StrictMode double-mount resumes exactly one retry loop', async () => {
    vi.useFakeTimers();
    try {
      const seededAttempt = {
        ...createAttemptSnapshot(),
        answers: { q1: 'SEEDED' },
      };
      seedPendingSubmission(seededAttempt);
      vi.mocked(studentAttemptRepository.submitAttempt).mockRejectedValue(
        new Error('still down'),
      );

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <React.StrictMode>
          <StudentRuntimeProvider
            state={createExamState()}
            onExit={vi.fn()}
            attemptSnapshot={seededAttempt}
          >
            <StudentAttemptProvider
              scheduleId={seededAttempt.scheduleId}
              attemptSnapshot={seededAttempt}
            >
              {children}
            </StudentAttemptProvider>
          </StudentRuntimeProvider>
        </React.StrictMode>
      );

      const { result } = renderHook(() => useStudentAttempt(), { wrapper });

      await flushAsyncState();

      expect(result.current.state.pendingSubmission).not.toBeNull();
      // Exactly one resume → one loop → one submit attempt.
      expect(studentAttemptRepository.submitAttempt).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the sticky storage_unavailable blocking flag once the pending save succeeds and after confirmation (M7)', async () => {
    vi.useFakeTimers();
    try {
      const submittedAttempt: StudentAttempt = {
        ...createAttemptSnapshot(),
        phase: 'post-exam',
        submittedAt: '2026-01-01T01:00:01.000Z',
      };
      const submitSpy = vi.mocked(studentAttemptRepository.submitAttempt);
      submitSpy
        .mockRejectedValueOnce(new Error('network down'))
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue(submittedAttempt);
      const saveSpy = vi.mocked(studentAttemptRepository.savePendingSubmission);
      saveSpy.mockRejectedValueOnce(new Error('quota exceeded')).mockResolvedValue();

      const { result } = renderHook(
        () => ({
          attempt: useStudentAttempt(),
          runtime: useStudentRuntime(),
        }),
        { wrapper: createWrapper() },
      );

      await flushAsyncState();

      await act(async () => {
        const submitted = await result.current.attempt.actions.submitAttempt();
        expect(submitted).toBe(true);
      });

      // The FIRST durable save failed: the blocking flag must be set so the
      // student is not left between "pending" and "confirmed" silently.
      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(result.current.runtime.state.blocking.reason).toBe('storage_unavailable');

      // First retry (5s backoff): submit fails again, but the durable save
      // now SUCCEEDS — storage is evidently usable again, so the blocking
      // flag must clear (M7: it must not stay sticky until reload).
      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(submitSpy).toHaveBeenCalledTimes(2);
      expect(saveSpy).toHaveBeenCalledTimes(2);
      expect(result.current.runtime.state.blocking.reason).toBeNull();

      // Second retry (10s backoff) confirms the submission: the confirmation
      // clear must also release the flag.
      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(submitSpy).toHaveBeenCalledTimes(3);
      expect(result.current.attempt.state.pendingSubmission).toBeNull();
      expect(studentAttemptRepository.clearPendingSubmission).toHaveBeenCalledWith('attempt-1');
      expect(result.current.runtime.state.blocking.reason).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces the stale frozen payload when the repository invalidates it after a 409-disproved conflict (I1-residual)', async () => {
    vi.useFakeTimers();
    try {
      const submittedAttempt: StudentAttempt = {
        ...createAttemptSnapshot(),
        phase: 'post-exam',
        submittedAt: '2026-01-01T01:00:01.000Z',
      };
      const submitSpy = vi.mocked(studentAttemptRepository.submitAttempt);
      submitSpy
        .mockRejectedValueOnce(
          Object.assign(new Error('response lost'), {
            submitPayload: {
              lastSeenRevision: 3,
              clientFinalSeq: 7,
              serverAcceptedThroughSeq: 5,
            },
          }),
        )
        .mockRejectedValueOnce(
          Object.assign(new Error('BASE_REVISION_MISMATCH'), {
            // The repository's live-fields resubmit also failed: the carrier
            // holds the LIVE values and the invalidation marker.
            submitPayload: {
              lastSeenRevision: 9,
              clientFinalSeq: 12,
              serverAcceptedThroughSeq: 8,
            },
            invalidatesFrozenPayload: true,
          }),
        )
        .mockResolvedValue(submittedAttempt);

      const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper() });

      await flushAsyncState();

      await act(async () => {
        await result.current.actions.submitAttempt();
      });
      expect(result.current.state.pendingSubmission?.frozenPayload).toEqual({
        lastSeenRevision: 3,
        clientFinalSeq: 7,
        serverAcceptedThroughSeq: 5,
      });

      // The frozen retry is rejected with a 409-disproved conflict: the old
      // frozen payload is DEAD. The provider must abandon it and keep the
      // live carrier values instead of replaying the stale payload forever.
      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(submitSpy).toHaveBeenCalledTimes(2);
      expect(submitSpy.mock.calls[1][1]).toEqual({
        lastSeenRevision: 3,
        clientFinalSeq: 7,
        serverAcceptedThroughSeq: 5,
      });
      expect(result.current.state.pendingSubmission?.frozenPayload).toEqual({
        lastSeenRevision: 9,
        clientFinalSeq: 12,
        serverAcceptedThroughSeq: 8,
      });

      // The next retry replays the replaced (live) values and confirms.
      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(submitSpy).toHaveBeenCalledTimes(3);
      expect(submitSpy.mock.calls[2][1]).toEqual({
        lastSeenRevision: 9,
        clientFinalSeq: 12,
        serverAcceptedThroughSeq: 8,
      });
      expect(result.current.state.pendingSubmission).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hard-stops the retry loop at the record expiry and clears the pending state so the student can resubmit without a reload (M2)', async () => {
    vi.useFakeTimers();
    try {
      const seededAttempt = {
        ...createAttemptSnapshot(),
        answers: { q1: 'SEEDED' },
      };
      seedPendingSubmission(seededAttempt, {
        expiresAt: new Date(Date.now() + 6_000).toISOString(),
      });
      vi.mocked(studentAttemptRepository.submitAttempt).mockRejectedValue(
        new Error('still down'),
      );

      const { result } = renderHook(() => useStudentAttempt(), {
        wrapper: createWrapper(seededAttempt),
      });

      await flushAsyncState();

      // Bootstrap resume attempt fires immediately at t=0 and fails.
      expect(studentAttemptRepository.submitAttempt).toHaveBeenCalledTimes(1);
      expect(result.current.state.pendingSubmission).not.toBeNull();

      // One retry at t=5 (5s backoff); the next backoff (10s) wakes at t=15,
      // past the 6s expiry — the loop must stop there.
      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(studentAttemptRepository.submitAttempt).toHaveBeenCalledTimes(2);

      await act(async () => {
        vi.advanceTimersByTime(10_000);
        await Promise.resolve();
        await Promise.resolve();
      });

      // Hard stop at expiresAt: no further attempts past the window.
      await act(async () => {
        vi.advanceTimersByTime(60_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(studentAttemptRepository.submitAttempt).toHaveBeenCalledTimes(2);

      // The pending state and the durable record are cleared so the student
      // can resubmit without a reload. This is NOT a confirmation: the phase
      // stays 'exam' and submittedAt stays null — the backend remains the
      // only source of truth for confirmed success.
      expect(result.current.state.pendingSubmission).toBeNull();
      expect(studentAttemptRepository.clearPendingSubmission).toHaveBeenCalledWith('attempt-1');
      expect(result.current.state.attempt?.phase).toBe('exam');
      expect(result.current.state.attempt?.submittedAt).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('StudentAttemptProvider pre-check persistence identity (FEX-002)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    vi.spyOn(studentAttemptRepository, 'saveAttempt').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'savePendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'clearPendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'getPendingMutations').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepository, 'getAttemptsByScheduleId').mockResolvedValue([]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function installPreCheckFetchMock(attempt: StudentAttempt) {
    const precheckRequests: Array<{ init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/v1/student/sessions/sched-1/precheck') {
        precheckRequests.push({ init: init ?? {} });
        const body = JSON.parse(String(init?.body ?? '{}')) as { preCheck?: unknown };
        const backendAttempt = {
          id: attempt.id,
          scheduleId: attempt.scheduleId,
          studentKey: attempt.studentKey,
          examId: attempt.examId,
          examTitle: attempt.examTitle,
          candidateId: attempt.candidateId,
          candidateName: attempt.candidateName,
          candidateEmail: attempt.candidateEmail,
          phase: attempt.phase,
          currentModule: attempt.currentModule,
          currentQuestionId: attempt.currentQuestionId,
          answers: attempt.answers,
          writingAnswers: attempt.writingAnswers,
          flags: attempt.flags,
          violationsSnapshot: attempt.violations,
          integrity: {
            preCheck: body.preCheck,
            deviceFingerprintHash: attempt.integrity.deviceFingerprintHash,
          },
          recovery: { syncState: 'idle' },
          createdAt: attempt.createdAt,
          updatedAt: attempt.updatedAt,
        };
        return new Response(JSON.stringify({ success: true, data: backendAttempt }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Credential-refresh fallback; not expected in this flow.
      return new Response(
        JSON.stringify({
          success: true,
          data: { attempt: { attemptToken: 'token-1', expiresAt: '2099-01-01T00:00:00.000Z' } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    global.fetch = fetchMock as typeof fetch;
    return precheckRequests;
  }

  function createPreCheckResult(completedAt: string) {
    return {
      completedAt,
      browserFamily: 'chrome',
      browserVersion: 124,
      screenDetailsSupported: true,
      heartbeatReady: true,
      acknowledgedSafariLimitation: false,
      checks: [],
    };
  }

  it('re-records the same pre-check result under the identical idempotency key (FEX-002)', async () => {
    const attempt = createAttemptSnapshot();
    const precheckRequests = installPreCheckFetchMock(attempt);
    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper(attempt) });

    const preCheck = createPreCheckResult('2026-01-01T00:01:00.000Z');
    await act(async () => {
      await result.current.actions.recordPreCheckResult(preCheck);
    });
    await act(async () => {
      await result.current.actions.recordPreCheckResult(preCheck);
    });

    expect(precheckRequests).toHaveLength(2);
    const idempotencyKeys = precheckRequests.map((request) =>
      (request.init.headers as Record<string, string> | undefined)?.['Idempotency-Key'],
    );
    // Idempotency identity = attempt.id : clientSessionId : completedAt.
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
    expect(idempotencyKeys[0]).toMatch(/^attempt-1:[^:]+:2026-01-01T00:01:00\.000Z$/);

    // The serialized bodies are identical too: same client session, same result.
    const body0 = JSON.parse(String(precheckRequests[0].init.body)) as {
      clientSessionId: string;
      preCheck: { completedAt: string };
    };
    const body1 = JSON.parse(String(precheckRequests[1].init.body)) as {
      clientSessionId: string;
      preCheck: { completedAt: string };
    };
    expect(body0.clientSessionId).toBe(body1.clientSessionId);
    expect(body0.preCheck.completedAt).toBe(body1.preCheck.completedAt);
  });

  it('uses a distinct idempotency key when the pre-check result changes (new completedAt)', async () => {
    const attempt = createAttemptSnapshot();
    const precheckRequests = installPreCheckFetchMock(attempt);
    const { result } = renderHook(() => useStudentAttempt(), { wrapper: createWrapper(attempt) });

    await act(async () => {
      await result.current.actions.recordPreCheckResult(
        createPreCheckResult('2026-01-01T00:01:00.000Z'),
      );
    });
    await act(async () => {
      await result.current.actions.recordPreCheckResult(
        createPreCheckResult('2026-01-01T00:02:00.000Z'),
      );
    });

    expect(precheckRequests).toHaveLength(2);
    const idempotencyKeys = precheckRequests.map((request) =>
      (request.init.headers as Record<string, string> | undefined)?.['Idempotency-Key'] ?? '',
    );
    // Idempotency identity = attempt.id : clientSessionId : completedAt
    // (completedAt itself contains colons, so parse the key segments carefully).
    const parseKey = (key: string) => {
      const match = /^([^:]+):([^:]+):(.+)$/.exec(key);
      if (!match) {
        throw new Error(`Unexpected idempotency key: ${key}`);
      }
      return { attemptId: match[1], clientSessionId: match[2], completedAt: match[3] };
    };
    const first = parseKey(idempotencyKeys[0]);
    const second = parseKey(idempotencyKeys[1]);
    // Same attempt identity and same client session…
    expect(first.attemptId).toBe(second.attemptId);
    expect(first.clientSessionId).toBe(second.clientSessionId);
    // …but a different completedAt must produce a different key.
    expect(first.completedAt).not.toBe(second.completedAt);
    expect(first.completedAt).toBe('2026-01-01T00:01:00.000Z');
    expect(second.completedAt).toBe('2026-01-01T00:02:00.000Z');
  });
});
