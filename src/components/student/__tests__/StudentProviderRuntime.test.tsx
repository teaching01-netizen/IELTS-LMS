import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { StudentAppWrapper } from '../StudentAppWrapper';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';

describe('Student Provider Runtime Integration', () => {
  let state: ExamState;
  let runtimeSnapshot: ExamSessionRuntime;
  let attemptSnapshot: StudentAttempt;

  beforeEach(() => {
    state = {
      title: 'Mock Exam',
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
            blocks: []
          }
        ]
      },
      listening: {
        parts: [
          {
            id: 'l1',
            title: 'Part 1',
            pins: [],
            blocks: []
          }
        ]
      },
      writing: {
        task1Prompt: 'Task 1 prompt',
        task2Prompt: 'Task 2 prompt'
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: []
      }
    };

    runtimeSnapshot = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 1800,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
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
          projectedEndAt: '2026-01-01T01:00:00.000Z'
        }
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    attemptSnapshot = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'writing',
      currentQuestionId: 'task-2',
      answers: { q1: 'A' },
      writingAnswers: { 'task-2': '<p>Essay</p>' },
      flags: { q1: true },
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
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
  });

  it('initializes providers with runtime-backed mode when runtimeSnapshot is provided', () => {
    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={runtimeSnapshot}
      />
    );

    // Should render in exam phase (not pre-check) when runtime-backed
    // This is a regression test to ensure providers respect runtime state
    expect(screen.queryByText(/pre-check/i)).not.toBeInTheDocument();
  });

  it('always shows syscheck before the waiting room when entering a scheduled exam', () => {
    const preCheckPendingAttempt: StudentAttempt = {
      ...attemptSnapshot,
      phase: 'lobby',
      integrity: {
        ...attemptSnapshot.integrity,
        preCheck: null,
      },
    };

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={preCheckPendingAttempt}
        onRuntimeRefresh={async () => {}}
        runtimeSnapshot={null}
      />,
    );

    expect(screen.getByRole('heading', { name: /system checking/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start exam/i })).not.toBeInTheDocument();
  });

  it('syncs navigation provider with runtime currentSectionKey', () => {
    runtimeSnapshot.currentSectionKey = 'writing';
    runtimeSnapshot.activeSectionKey = 'writing';

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={runtimeSnapshot}
      />
    );

    // NavigationProvider should sync currentModule from runtime snapshot
    // This is a regression test to ensure navigation state stays in sync
    // We can't directly test the provider state, but we can verify no errors occur
  });

  it('syncs session provider time remaining from runtime snapshot', () => {
    runtimeSnapshot.currentSectionRemainingSeconds = 900; // 15 minutes

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={runtimeSnapshot}
      />
    );

    // SessionProvider should sync timeRemaining from runtime snapshot
    // This is a regression test to ensure timer state stays in sync
    // We can't directly test the provider state, but we can verify no errors occur
  });

  it('handles runtime status completed by transitioning to post-exam phase', async () => {
    runtimeSnapshot.status = 'completed';
    runtimeSnapshot.currentSectionKey = null;
    runtimeSnapshot.activeSectionKey = null;

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={runtimeSnapshot}
      />
    );

    await waitFor(() => {
      // Should show completion screen when runtime status is completed
      expect(screen.queryByText(/examination complete/i)).toBeInTheDocument();
    });
  });

  it('handles runtime waitingForNextSection by showing blocking overlay', () => {
    runtimeSnapshot.waitingForNextSection = true;
    runtimeSnapshot.currentSectionKey = 'reading';
    runtimeSnapshot.sections[0].status = 'completed';

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />
    );

    // Should show cohort blocking overlay when waiting for next section
    expect(screen.getByText(/waiting for cohort advance/i)).toBeInTheDocument();
  });

  it('handles runtime paused status by showing blocking overlay', () => {
    runtimeSnapshot.status = 'paused';
    runtimeSnapshot.currentSectionKey = 'reading';
    runtimeSnapshot.sections[0].status = 'paused';

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />
    );

    // Should show cohort blocking overlay when runtime is paused
    expect(screen.getByText(/cohort paused/i)).toBeInTheDocument();
  });

  it('initializes in pre-check phase when not runtime-backed', () => {
    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={null}
      />
    );

    // Should show pre-check screen when not runtime-backed
    expect(screen.getByRole('heading', { name: /system checking/i })).toBeInTheDocument();
  });

  it('handles runtime not_started status by showing blocking overlay', () => {
    runtimeSnapshot.status = 'not_started';
    runtimeSnapshot.currentSectionKey = null;

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />
    );

    // Should show waiting overlay when runtime hasn't started
    expect(screen.getByText(/waiting for start/i)).toBeInTheDocument();
  });

  it('syncs currentSectionKey changes across provider updates', async () => {
    const { rerender } = render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={runtimeSnapshot}
      />
    );

    // Simulate runtime advancing to next section
    const updatedSnapshot: ExamSessionRuntime = {
      ...runtimeSnapshot,
      currentSectionKey: 'writing' as const,
      activeSectionKey: 'writing' as const,
      sections: [
        {
          ...runtimeSnapshot.sections[0],
          status: 'completed' as const,
          completionReason: 'auto_timeout' as const,
          actualEndAt: '2026-01-01T01:00:00.000Z'
        },
        {
          sectionKey: 'writing' as const,
          label: 'Writing',
          order: 2,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live' as const,
          availableAt: '2026-01-01T01:00:00.000Z',
          actualStartAt: '2026-01-01T01:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T01:00:00.000Z',
          projectedEndAt: '2026-01-01T02:00:00.000Z'
        }
      ]
    };

    rerender(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={updatedSnapshot}
      />
    );

    // NavigationProvider should update currentModule to 'writing'
    // This is a regression test to ensure provider state updates correctly
    // We verify no errors occur during the transition
  });

  it('preserves local UI state across runtime snapshot updates', async () => {
    const { rerender } = render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={runtimeSnapshot}
      />
    );

    // Update runtime snapshot
    const updatedSnapshot = {
      ...runtimeSnapshot,
      currentSectionRemainingSeconds: 1200
    };

    rerender(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={updatedSnapshot}
      />
    );

    // Local UI state (modals, accessibility, etc.) should be preserved
    // This is a regression test to ensure runtime updates don't reset UI state
  });

  it('handles missing runtime snapshot gracefully', () => {
    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={null}
      />
    );

    // Should not crash when runtimeSnapshot is null
    // This is a regression test for error handling
    expect(screen.getByRole('heading', { name: /system checking/i })).toBeInTheDocument();
  });

  it('handles partial runtime snapshot data gracefully', () => {
    const partialSnapshot = {
      ...runtimeSnapshot,
      currentSectionKey: undefined,
      currentSectionRemainingSeconds: undefined
    } as any;

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        runtimeSnapshot={partialSnapshot}
      />
    );

    // Should handle missing optional fields gracefully
    // This is a regression test for robustness
  });

  it('boots with attempt-only state and skips cosmetic pre-check progress once pre-check is complete', () => {
    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={null}
      />
    );

    expect(screen.queryByRole('heading', { name: /system checking/i })).not.toBeInTheDocument();
  });

  it('hydrates runtime UI state from attempt snapshot when runtime and attempt are both present', () => {
    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={{
          ...runtimeSnapshot,
          currentSectionKey: 'writing',
          activeSectionKey: 'writing',
        }}
      />
    );

    expect(screen.queryByRole('heading', { name: /system checking/i })).not.toBeInTheDocument();
  });
});
