import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';
import type { ExamState } from '../../../../types';
import type { ExamSessionRuntime } from '../../../../types/domain';
import type { StudentAttempt } from '../../../../types/studentAttempt';

const state = {
  title: 'Synthetic timer gate',
  type: 'Academic',
  activeModule: 'writing',
  activePassageId: null,
  activeListeningPartId: null,
  config: createDefaultConfig('Academic', 'Academic'),
  reading: { passages: [] },
  listening: { parts: [] },
  writing: { task1Prompt: '', task2Prompt: '', tasks: [], customPromptTemplates: [] },
  speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
} as unknown as ExamState;

const attempt = {
  id: 'attempt-synthetic',
  scheduleId: 'schedule-synthetic',
  studentKey: 'student-synthetic',
  examId: 'exam-synthetic',
  examTitle: 'Synthetic timer gate',
  candidateId: 'candidate-synthetic',
  candidateName: 'Synthetic Candidate',
  candidateEmail: 'synthetic@example.test',
  phase: 'exam',
  currentModule: 'writing',
  currentQuestionId: null,
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
  // The pre-check must be completed for a runtime-backed attempt to boot
  // straight into the exam phase (FEX-010); without it the provider stays on
  // the briefing and the timer display never renders.
  integrity: {
    preCheck: {
      completedAt: '2026-01-01T00:00:00.000Z',
      browserFamily: 'chrome',
      browserVersion: 124,
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
  recovery: { lastRecoveredAt: null, lastLocalMutationAt: null, lastPersistedAt: null, lastDroppedMutations: null, pendingMutationCount: 0, serverAcceptedThroughSeq: 0, clientSessionId: null, syncState: 'saved' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as StudentAttempt;

function runtime(revision = 1): ExamSessionRuntime {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'runtime-synthetic', scheduleId: attempt.scheduleId, examId: attempt.examId,
    examTitle: attempt.examTitle, cohortName: 'Synthetic', deliveryMode: 'proctor_start',
    status: 'live', actualStartAt: now, actualEndAt: null, activeSectionKey: 'writing', currentSectionKey: 'writing',
    currentSectionRemainingSeconds: 10, currentSectionDeadlineAt: '2026-01-01T00:00:10.000Z', serverNow: now,
    waitingForNextSection: false, isOverrun: false, totalPausedSeconds: 0,
    sections: [{ sectionKey: 'writing', label: 'Writing', order: 1, plannedDurationMinutes: 1, gapAfterMinutes: 0,
      status: 'live', availableAt: now, actualStartAt: now, actualEndAt: null, pausedAt: null,
      accumulatedPausedSeconds: 0, extensionMinutes: 0, completionReason: undefined,
      projectedStartAt: now, projectedEndAt: '2026-01-01T00:01:00.000Z' }],
    revision, createdAt: now, updatedAt: now,
  } as unknown as ExamSessionRuntime;
}

function Probe() {
  const { state } = useStudentRuntime();
  return <output data-testid="remaining">{state.displayTimeRemaining}</output>;
}

describe('synthetic timer release gate', () => {
  it('survives 10,000 equal-revision snapshot replacements and reaches zero', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const initial = runtime();
      const { rerender } = render(
        <StudentRuntimeProvider state={state} onExit={() => undefined} runtimeBacked runtimeSnapshot={initial} attemptSnapshot={attempt}>
          <Probe />
        </StudentRuntimeProvider>,
      );
      let previous = 10;
      for (let batch = 0; batch < 100; batch += 1) {
        act(() => {
          for (let index = 0; index < 100; index += 1) {
            rerender(
              <StudentRuntimeProvider state={state} onExit={() => undefined} runtimeBacked runtimeSnapshot={{ ...initial, updatedAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + batch * 100 + index).toISOString() }} attemptSnapshot={attempt}>
                <Probe />
              </StudentRuntimeProvider>,
            );
            vi.advanceTimersByTime(1);
            const current = Number(screen.getByTestId('remaining').textContent);
            expect(current).toBeLessThanOrEqual(previous);
            previous = current;
          }
        });
      }
      expect(screen.getByTestId('remaining')).toHaveTextContent('0');
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects an unverified later deadline without an extension', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const initial = runtime();
      const { rerender } = render(
        <StudentRuntimeProvider state={state} onExit={() => undefined} runtimeBacked runtimeSnapshot={initial} attemptSnapshot={attempt}>
          <Probe />
        </StudentRuntimeProvider>,
      );

      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(screen.getByTestId('remaining')).toHaveTextContent('8');

      rerender(
        <StudentRuntimeProvider
          state={state}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={{
            ...initial,
            currentSectionRemainingSeconds: 20,
            currentSectionDeadlineAt: '2026-01-01T00:00:20.000Z',
            sections: initial.sections.map((section) => ({ ...section, extensionMinutes: 0 })),
          }}
          attemptSnapshot={attempt}
        >
          <Probe />
        </StudentRuntimeProvider>,
      );

      expect(screen.getByTestId('remaining')).toHaveTextContent('8');
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.getByTestId('remaining')).toHaveTextContent('7');
    } finally {
      vi.useRealTimers();
    }
  });
});
