import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { backendPost } from '../../../../services/backendBridge';
import { studentAttemptRepository } from '../../../../services/studentAttemptRepository';
import type { ResponseSnapshotV2 } from '../../../../shared/durability/types';
import type { ExamState } from '../../../../types';
import type { StudentAttempt, StudentPreCheckResult } from '../../../../types/studentAttempt';
import { StudentAttemptProvider, useStudentAttempt } from '../StudentAttemptProvider';
import { StudentRuntimeProvider } from '../StudentRuntimeProvider';

const transportMocks = vi.hoisted(() => ({
  transport: {
    sendBatch: vi.fn(),
    submit: vi.fn(),
    fetchSnapshot: vi.fn(),
  },
  createTransport: vi.fn(),
}));

vi.mock('@student/api/responseDurabilityTransport', () => ({
  createResponseDurabilityV2Transport: transportMocks.createTransport,
  takeOverResponseDurabilityLease: vi.fn(),
}));

vi.mock('../../../../services/backendBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/backendBridge')>();
  return { ...actual, backendPost: vi.fn() };
});

function createExamState(): ExamState {
  return {
    title: 'Test Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config: createDefaultConfig('Academic', 'Academic'),
    reading: {
      passages: [{ id: 'p1', title: 'Passage 1', content: 'Test content', blocks: [] }],
    },
    listening: {
      parts: [{ id: 'l1', title: 'Part 1', pins: [], blocks: [] }],
    },
    writing: {
      task1Prompt: 'Task 1 prompt',
      task2Prompt: 'Task 2 prompt',
      tasks: [],
      customPromptTemplates: [],
    },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
  };
}

function createAttemptSnapshot(overrides: Partial<StudentAttempt> = {}): StudentAttempt {
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
    protocolVersion: 2,
    leaseEpoch: 1,
    controlEpoch: 1,
    integrity: {
      preCheck: null,
      deviceFingerprintHash: null,
      clientSessionId: null,
      lastDisconnectAt: null,
      lastReconnectAt: null,
      lastHeartbeatAt: null,
      lastHeartbeatStatus: 'idle',
    },
    recovery: {
      finalSubmissionPending: false,
      lastRecoveredAt: null,
      lastLocalMutationAt: null,
      lastPersistedAt: null,
      lastDroppedMutations: null,
      pendingMutationCount: 0,
      serverAcceptedThroughSeq: 0,
      clientSessionId: null,
      syncState: 'saved',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createPreCheckResult(): StudentPreCheckResult {
  return {
    completedAt: '2026-01-01T00:05:00.000Z',
    browserFamily: 'chrome',
    browserVersion: 120,
    screenDetailsSupported: true,
    heartbeatReady: true,
    acknowledgedSafariLimitation: false,
    checks: [
      {
        id: 'browser',
        label: 'Browser',
        message: 'Supported browser',
        required: true,
        status: 'pass',
      },
    ],
  };
}

function createEmptySnapshot(): ResponseSnapshotV2 {
  return {
    attemptId: 'attempt-1',
    protocolVersion: 2,
    deliveryStatus: 'open',
    leaseEpoch: 1,
    controlEpoch: 1,
    attemptRevision: 3,
    deadlineAt: null,
    closingGraceUntil: null,
    responses: [],
  };
}

function renderAttemptHarness(
  snapshot: StudentAttempt | null,
  options?: { persistenceEnabled?: boolean },
) {
  let latest: ReturnType<typeof useStudentAttempt> | null = null;

  function Probe() {
    latest = useStudentAttempt();
    const attempt = latest.state.attempt;
    return (
      <div>
        <div data-testid="attempt-id">{latest.state.attemptId ?? 'none'}</div>
        <div data-testid="answer-q1">{String(attempt?.answers['q1'] ?? 'unset')}</div>
        <div data-testid="writing-task-1">{attempt?.writingAnswers['task-1'] ?? 'unset'}</div>
        <div data-testid="flag-q1">{String(attempt?.flags['q1'] ?? 'unset')}</div>
        <div data-testid="module">{attempt?.currentModule ?? 'none'}</div>
        <div data-testid="phase">{attempt?.phase ?? 'none'}</div>
        <div data-testid="sync">{attempt?.recovery.syncState ?? 'none'}</div>
        <div data-testid="pending">{String(latest.state.pendingMutationCount)}</div>
      </div>
    );
  }

  render(
    <StudentRuntimeProvider state={createExamState()} onExit={vi.fn()} attemptSnapshot={snapshot}>
      <StudentAttemptProvider
        scheduleId={snapshot?.scheduleId}
        attemptSnapshot={snapshot}
        persistenceEnabled={options?.persistenceEnabled ?? false}
      >
        <Probe />
      </StudentAttemptProvider>
    </StudentRuntimeProvider>,
  );

  return {
    get current() {
      return latest!;
    },
  };
}

describe('StudentAttemptProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    transportMocks.createTransport.mockReturnValue(transportMocks.transport);
    transportMocks.transport.fetchSnapshot.mockResolvedValue(createEmptySnapshot());
    transportMocks.transport.sendBatch.mockResolvedValue({
      attemptRevision: 4,
      serverTime: '2026-01-01T00:00:01.000Z',
      acknowledgements: [],
    });
    transportMocks.transport.submit.mockResolvedValue({
      attemptId: 'attempt-1',
      submissionId: 'sub-1',
      status: 'submitted',
      attemptRevision: 5,
      finalResponseDigest: 'digest-1',
      submittedAt: '2026-01-01T00:00:02.000Z',
      acknowledgements: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the initial attempt snapshot through the consumer probe', () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());

    expect(screen.getByTestId('attempt-id')).toHaveTextContent('attempt-1');
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');
    expect(screen.getByTestId('module')).toHaveTextContent('reading');
    expect(screen.getByTestId('pending')).toHaveTextContent('0');
    expect(harness.current.state.attempt?.id).toBe('attempt-1');
    expect(harness.current.state.attemptId).toBe('attempt-1');
    expect(harness.current.state.durabilityLeaseConflict).toBe(false);
    expect(harness.current.state.lastLocalMutationAt).toBeNull();
    expect(harness.current.state.lastPersistedAt).toBeNull();
  });

  it('renders a null attempt when no snapshot is provided', () => {
    const harness = renderAttemptHarness(null);

    expect(screen.getByTestId('attempt-id')).toHaveTextContent('none');
    expect(harness.current.state.attempt).toBeNull();
    expect(harness.current.state.attemptId).toBeNull();
  });

  it('throws when useStudentAttempt is used outside the provider', () => {
    function OutsideProbe() {
      useStudentAttempt();
      return null;
    }

    expect(() => render(<OutsideProbe />)).toThrow(
      'useStudentAttempt must be used within StudentAttemptProvider',
    );
  });

  it('updates the answer in context when persistAnswer is called', () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());

    act(() => {
      harness.current.actions.persistAnswer('q1', 'A');
    });

    expect(screen.getByTestId('answer-q1')).toHaveTextContent('A');
    expect(harness.current.state.attempt?.answers['q1']).toBe('A');
  });

  it('updates the writing answer in context when persistWritingAnswer is called', () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());

    act(() => {
      harness.current.actions.persistWritingAnswer('task-1', 'My essay text');
    });

    expect(screen.getByTestId('writing-task-1')).toHaveTextContent('My essay text');
    expect(harness.current.state.attempt?.writingAnswers['task-1']).toBe('My essay text');
  });

  it('updates the flag in context when persistFlag is called', () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());

    act(() => {
      harness.current.actions.persistFlag('q1', true);
    });

    expect(screen.getByTestId('flag-q1')).toHaveTextContent('true');
    expect(harness.current.state.attempt?.flags['q1']).toBe(true);
  });

  it('updates position in context when persistPosition is called', () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());

    act(() => {
      harness.current.actions.persistPosition('listening', 'q9', 'exam');
    });

    expect(screen.getByTestId('module')).toHaveTextContent('listening');
    expect(harness.current.state.attempt?.currentModule).toBe('listening');
    expect(harness.current.state.attempt?.currentQuestionId).toBe('q9');
  });

  it('appends a violation when persistViolation is called', () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());

    act(() => {
      harness.current.actions.persistViolation({
        id: 'v-1',
        type: 'TAB_SWITCH',
        severity: 'medium',
        timestamp: '2026-01-01T00:06:00.000Z',
        description: 'Tab switched',
      });
    });

    expect(harness.current.state.attempt?.violations).toHaveLength(1);
    expect(harness.current.state.attempt?.violations[0]?.id).toBe('v-1');
  });

  it('stores the pre-check result locally when persistence is disabled', async () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());

    await act(async () => {
      await harness.current.actions.recordPreCheckResult(createPreCheckResult());
    });

    expect(harness.current.state.attempt?.integrity.preCheck?.completedAt).toBe(
      '2026-01-01T00:05:00.000Z',
    );
  });

  it('records network disconnect and reconnect timestamps', async () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());

    await act(async () => {
      await harness.current.actions.recordNetworkStatus('offline', '2026-01-01T00:07:00.000Z');
    });
    expect(harness.current.state.attempt?.integrity.lastDisconnectAt).toBe(
      '2026-01-01T00:07:00.000Z',
    );

    await act(async () => {
      await harness.current.actions.recordNetworkStatus('online', '2026-01-01T00:08:00.000Z');
    });
    expect(harness.current.state.attempt?.integrity.lastReconnectAt).toBe(
      '2026-01-01T00:08:00.000Z',
    );
  });

  it('does not hit the repository gateway for heartbeats when persistence is disabled', async () => {
    const saveHeartbeatEvent = vi
      .spyOn(studentAttemptRepository, 'saveHeartbeatEvent')
      .mockResolvedValue();
    const harness = renderAttemptHarness(createAttemptSnapshot());

    await act(async () => {
      await harness.current.actions.recordHeartbeat('heartbeat');
    });

    expect(saveHeartbeatEvent).not.toHaveBeenCalled();
    expect(harness.current.state.attempt?.id).toBe('attempt-1');
  });

  it('acknowledges a proctor warning and clears the warned status locally', async () => {
    const harness = renderAttemptHarness(
      createAttemptSnapshot({ proctorStatus: 'warned', lastWarningId: 'w-1' }),
    );

    await act(async () => {
      await harness.current.actions.acknowledgeProctorWarning('w-1');
    });

    expect(harness.current.state.attempt?.lastAcknowledgedWarningId).toBe('w-1');
    expect(harness.current.state.attempt?.proctorStatus).toBe('active');
  });

  it('stores the device fingerprint hash', async () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());

    await act(async () => {
      await harness.current.actions.setDeviceFingerprintHash('hash-abc');
    });

    expect(harness.current.state.attempt?.integrity.deviceFingerprintHash).toBe('hash-abc');
  });

  it('clears the dropped-mutations banner marker', async () => {
    const snapshot = createAttemptSnapshot();
    snapshot.recovery.lastDroppedMutations = {
      at: '2026-01-01T00:09:00.000Z',
      count: 2,
      fromModule: 'reading',
      toModule: null,
      reason: 'test-drop',
    };
    const harness = renderAttemptHarness(snapshot);

    await act(async () => {
      await harness.current.actions.dismissDroppedMutationsBanner();
    });

    expect(harness.current.state.attempt?.recovery.lastDroppedMutations).toBeNull();
  });

  it('completes submission locally when persistence is disabled', async () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());
    let submitted = false;

    await act(async () => {
      submitted = await harness.current.actions.submitAttempt();
    });

    expect(submitted).toBe(true);
    expect(screen.getByTestId('phase')).toHaveTextContent('post-exam');
    expect(harness.current.state.attempt?.submittedAt).not.toBeNull();
  });

  it('reports flushPending as not durable when persistence is disabled', async () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());
    let flushed = true;

    await act(async () => {
      flushed = await harness.current.actions.flushPending();
    });

    expect(flushed).toBe(false);
  });

  it('reports lease takeover as unavailable when persistence is disabled', async () => {
    const harness = renderAttemptHarness(createAttemptSnapshot());
    let takenOver = true;

    await act(async () => {
      takenOver = await harness.current.actions.takeOverDurabilityLease();
    });

    expect(takenOver).toBe(false);
    expect(harness.current.state.durabilityLeaseConflict).toBe(false);
  });

  it('surfaces pre-check persistence failures and marks sync state as error', async () => {
    vi.mocked(backendPost).mockRejectedValueOnce(new Error('precheck down'));
    const harness = renderAttemptHarness(createAttemptSnapshot(), { persistenceEnabled: true });
    await act(async () => {
      await Promise.resolve();
    });

    let error: unknown = null;
    await act(async () => {
      try {
        await harness.current.actions.recordPreCheckResult(createPreCheckResult());
      } catch (caught) {
        error = caught;
      }
    });

    expect(vi.mocked(backendPost)).toHaveBeenCalledWith(
      expect.stringContaining('/precheck'),
      expect.anything(),
      expect.anything(),
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('precheck down');
    expect(harness.current.state.attempt?.recovery.syncState).toBe('error');
  });

  it('returns false from submitAttempt when no attempt is loaded', async () => {
    const harness = renderAttemptHarness(null);
    let submitted = true;

    await act(async () => {
      submitted = await harness.current.actions.submitAttempt();
    });

    expect(submitted).toBe(false);
    expect(harness.current.state.attempt).toBeNull();
  });

  it('throws from recordPreCheckResult when no attempt is loaded', async () => {
    const harness = renderAttemptHarness(null);
    let error: unknown = null;

    await act(async () => {
      try {
        await harness.current.actions.recordPreCheckResult(createPreCheckResult());
      } catch (caught) {
        error = caught;
      }
    });

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Missing student attempt context.');
  });
});
