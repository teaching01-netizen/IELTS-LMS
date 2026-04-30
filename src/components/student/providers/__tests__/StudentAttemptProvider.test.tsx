import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
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
import { StudentAttemptProvider, useStudentAttempt } from '../StudentAttemptProvider';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';

const ANSWER_DURABLE_WRITE_DEBOUNCE_MS = 100;

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
    vi.spyOn(studentAttemptRepoModule, 'refreshAttemptCredentialForAttempt').mockResolvedValue(false);

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

    expect(result.current.runtime.state.writingAnswers['task1']).toBe('<p>Draft</p>');
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
    expect(pendingMutations).toHaveLength(1);
    expect(pendingMutations?.[0]?.type).toBe('violation');
    expect(pendingMutations?.[0]?.payload).toMatchObject({
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

  it('flushes pending mutations before submitting the attempt', async () => {
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

    expect(studentAttemptRepository.saveAttempt).toHaveBeenCalled();
    expect(studentAttemptRepository.submitAttempt).toHaveBeenCalled();

    const saveOrder = vi
      .mocked(studentAttemptRepository.saveAttempt)
      .mock.invocationCallOrder[0];
    const submitOrder = vi
      .mocked(studentAttemptRepository.submitAttempt)
      .mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(submitOrder);
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

  it('does not submit the attempt when flushing pending mutations fails', async () => {
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
      expect(submitted).toBe(false);
    });

    expect(studentAttemptRepository.submitAttempt).not.toHaveBeenCalled();
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

  it('prefers incoming snapshot when freshness signals are equal', async () => {
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
      expect(result.current.state.attempt?.answers.q1).toBe('SERVER_EQUAL');
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
