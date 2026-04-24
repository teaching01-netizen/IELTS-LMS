import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import * as studentAttemptRepoModule from '../../../../services/studentAttemptRepository';
import { studentAttemptRepository } from '../../../../services/studentAttemptRepository';
import type { ExamState } from '../../../../types';
import type { StudentAttempt, StudentAttemptMutation } from '../../../../types/studentAttempt';
import { StudentAttemptProvider, useStudentAttempt } from '../StudentAttemptProvider';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';

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
