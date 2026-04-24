import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultConfig } from '../../../constants/examDefaults';
import { studentAttemptRepository } from '../../../services/studentAttemptRepository';
import type { ExamState } from '../../../types';
import type { StudentAttempt } from '../../../types/studentAttempt';
import { StudentAppWrapper } from '../StudentAppWrapper';

describe('Student completion summary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.spyOn(studentAttemptRepository, 'getPendingMutations').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepository, 'saveAttempt').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'savePendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'clearPendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository, 'getAttemptsByScheduleId').mockResolvedValue([]);
  });

  it('shows answered/unanswered counts per enabled section', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.security.requireFullscreen = false;
    config.security.detectSecondaryScreen = false;

    const state: ExamState = {
      title: 'Summary Exam',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'p1',
      activeListeningPartId: 'l1',
      config,
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
      listening: {
        parts: [
          {
            id: 'l1',
            title: 'Part 1',
            pins: [],
            blocks: [
              {
                id: 'listening-block-1',
                type: 'TFNG',
                instruction: 'Choose the answer.',
                mode: 'TFNG',
                questions: [
                  {
                    id: 'lq1',
                    statement: 'Statement 1',
                    correctAnswer: 'T',
                  },
                ],
              },
            ],
          },
        ],
      },
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

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Summary Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'post-exam',
      currentModule: 'reading',
      currentQuestionId: null,
      answers: {
        q1: 'seeded answer',
        lq1: 'T',
      },
      writingAnswers: {
        task1: '<p>Draft</p>',
      },
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
        lastDroppedMutations: null,
        pendingMutationCount: 0,
        serverAcceptedThroughSeq: 0,
        clientSessionId: null,
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(<StudentAppWrapper state={state} onExit={() => {}} attemptSnapshot={attemptSnapshot} />);

    expect(screen.getByText(/Examination Complete/i)).toBeInTheDocument();
    const readingRow = screen.getByText('Reading').parentElement?.parentElement;
    expect(readingRow).toBeTruthy();
    expect(readingRow).toHaveTextContent('1 answered');
    expect(readingRow).toHaveTextContent('0 unanswered');

    const listeningRow = screen.getByText('Listening').parentElement?.parentElement;
    expect(listeningRow).toBeTruthy();
    expect(listeningRow).toHaveTextContent('1 answered');

    const writingRow = screen.getByText('Writing').parentElement?.parentElement;
    expect(writingRow).toBeTruthy();
    expect(writingRow).toHaveTextContent('1 answered');
    expect(writingRow).toHaveTextContent('1 unanswered');
  });
});
