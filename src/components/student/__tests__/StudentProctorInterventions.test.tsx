import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import { studentAttemptRepository } from '../../../services/studentAttemptRepository';
import type { ExamState } from '../../../types';
import type { StudentAttempt } from '../../../types/studentAttempt';
import { StudentAppWrapper } from '../StudentAppWrapper';

const state: ExamState = {
  title: 'Mock Exam',
  type: 'Academic',
  activeModule: 'writing',
  activePassageId: 'p1',
  activeListeningPartId: 'l1',
  config: createDefaultConfig('Academic', 'Academic'),
  reading: { passages: [] },
  listening: { parts: [] },
  writing: {
    task1Prompt: 'Task 1 prompt',
    task2Prompt: 'Task 2 prompt',
  },
  speaking: {
    part1Topics: [],
    cueCard: '',
    part3Discussion: [],
  },
};

function createAttemptSnapshot(
  overrides: Partial<StudentAttempt> = {},
): StudentAttempt {
  return {
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
    currentQuestionId: 'task-1',
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
      preCheck: {
        completedAt: '2026-01-01T00:00:00.000Z',
        browserFamily: 'chrome',
        browserVersion: 120,
        screenDetailsSupported: true,
        heartbeatReady: true,
        acknowledgedSafariLimitation: false,
        checks: [],
      },
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
    ...overrides,
  };
}

describe('Student proctor interventions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(studentAttemptRepository, 'saveAttempt').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'savePendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'clearPendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'saveHeartbeatEvent').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'getHeartbeatEvents').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepository, 'getPendingMutations').mockResolvedValue([]);
  });

  it('shows and acknowledges a proctor warning', async () => {
    const warningAttempt = createAttemptSnapshot({
      violations: [
        {
          id: 'warning-1',
          type: 'PROCTOR_WARNING',
          severity: 'medium',
          timestamp: '2026-01-01T00:01:00.000Z',
          description: 'Please return to your seat.',
        },
      ],
      proctorStatus: 'warned',
      lastWarningId: 'warning-1',
    });

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId={warningAttempt.scheduleId}
        attemptSnapshot={warningAttempt}
      />,
    );

    expect(screen.getByText(/please return to your seat\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /i understand/i }));

    await waitFor(() => {
      expect(studentAttemptRepository.saveAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          id: warningAttempt.id,
          lastAcknowledgedWarningId: 'warning-1',
          proctorStatus: 'active',
        }),
      );
    });
  });

  it('blocks the candidate when the proctor pauses the individual session', () => {
    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={createAttemptSnapshot({
          proctorStatus: 'paused',
          proctorUpdatedAt: '2026-01-01T00:05:00.000Z',
          proctorUpdatedBy: 'Proctor',
          proctorNote: 'Manual review in progress',
        })}
      />,
    );

    expect(screen.getByText(/individual session paused/i)).toBeInTheDocument();
    expect(screen.getByText(/manual review in progress/i)).toBeInTheDocument();
  });
});
