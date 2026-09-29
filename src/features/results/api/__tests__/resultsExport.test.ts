import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
const downloadCsv = vi.hoisted(() => vi.fn());

vi.mock('../../infrastructure/resultsGateway', () => ({
  resultsGateway: { get },
}));
vi.mock('../../../../utils/csvExport', () => ({ downloadCsv }));

import { downloadActScienceCsv } from '../resultsExport';
import type { AdminResultRow } from '../resultsQueries';

const actRow = {
  id: 'result-1',
  submissionId: 'submission-1',
  attemptId: 'attempt-1',
  providerKey: 'act',
  outcomeStatus: 'scored',
  releaseStatus: 'ready_to_release',
  studentId: 'ACT-001',
  studentName: 'Ada Example',
  studentEmail: null,
  scheduleId: 'schedule-1',
  examId: 'exam-1',
  examTitle: 'ACT Science',
  cohortName: 'Cohort A',
  institution: null,
  versionNumber: 1,
  submittedAt: '2026-09-13T00:00:00Z',
} satisfies AdminResultRow;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('downloadActScienceCsv', () => {
  it('exports ACT category totals and correct counts after Total Score', async () => {
    get.mockResolvedValue({
      attemptId: 'attempt-1',
      scheduleId: 'schedule-1',
      studentId: 'ACT-001',
      studentName: 'Ada Example',
      course: 'ACT Prep',
      totalScore: 2,
      maxScore: 4,
      percentage: 50,
      outcomeStatus: 'scored',
      releaseStatus: 'ready_to_release',
      questions: [
        {
          questionId: 'q-iod-correct',
          displayOrder: 1,
          skillCategory: 'interpretation_of_data',
          response: 'A',
          correctAnswer: 'A',
          isCorrect: true,
          answered: true,
        },
        {
          questionId: 'q-iod-wrong',
          displayOrder: 2,
          skillCategory: 'interpretation_of_data',
          response: 'B',
          correctAnswer: 'A',
          isCorrect: false,
          answered: true,
        },
        {
          questionId: 'q-sin-unanswered',
          displayOrder: 3,
          skillCategory: 'scientific_investigation',
          response: null,
          correctAnswer: 'C',
          isCorrect: null,
          answered: false,
        },
        {
          questionId: 'q-esa-correct',
          displayOrder: 4,
          skillCategory: 'evaluating_scientific_arguments_and_models_with_evidence',
          response: 'D',
          correctAnswer: 'D',
          isCorrect: true,
          answered: true,
        },
      ],
    });

    await expect(downloadActScienceCsv([actRow])).resolves.toBe(1);

    const [filename, headers, rows] = downloadCsv.mock.calls[0];
    expect(filename).toBe('act-science-results-2026-09-13.csv');
    expect(headers.slice(4, 12)).toEqual([
      'Course',
      'Total Score',
      'Interpretation of Data (IOD)',
      'Scientific Investigation (SIN)',
      'Evaluating Scientific Arguments and Models with Evidence (ESA)',
      'IOD correct',
      'SIN correct',
      'ESA correct',
    ]);
    expect(rows[0].slice(4, 12)).toEqual(['ACT Prep', 2, 2, 1, 1, 1, 0, 1]);
  });

  it('loads canonical detail rows and includes aggregate plus question grading data', async () => {
    get.mockResolvedValue({
      attemptId: 'attempt-1',
      scheduleId: 'schedule-1',
      studentId: 'ACT-001',
      studentName: 'Ada Example',
      totalScore: 2,
      maxScore: 3,
      percentage: 66.67,
      outcomeStatus: 'scored',
      releaseStatus: 'ready_to_release',
      integrityStatus: 'verified',
      questions: [
        {
          questionId: 'q-1',
          displayOrder: 1,
          response: 'A',
          correctAnswer: ['A', 'B'],
          isCorrect: true,
          answered: true,
        },
      ],
    });

    await expect(downloadActScienceCsv([actRow])).resolves.toBe(1);

    expect(get).toHaveBeenCalledWith('/v1/results/act-science/attempt-1');
    expect(downloadCsv).toHaveBeenCalledWith(
      'act-science-results-2026-09-13.csv',
      expect.arrayContaining(['integrityStatus', 'questionId', 'isCorrect']),
      [
        expect.arrayContaining([
          'Ada Example',
          'verified',
          'q-1',
          1,
          'A',
          '["A","B"]',
          true,
        ]),
      ],
    );
  });

  it('does not request non-ACT rows and still emits an aggregate row without questions', async () => {
    get.mockResolvedValue({
      attemptId: 'attempt-1',
      scheduleId: 'schedule-1',
      studentId: 'ACT-001',
      studentName: 'Ada Example',
      totalScore: 0,
      maxScore: 0,
      percentage: 0,
      outcomeStatus: 'pending',
      releaseStatus: 'ready_to_release',
      questions: [],
    });

    await expect(
      downloadActScienceCsv([
        { ...actRow, providerKey: 'ielts', attemptId: 'ielts-attempt' },
        actRow,
      ]),
    ).resolves.toBe(1);

    expect(get).toHaveBeenCalledTimes(1);
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(downloadCsv.mock.calls[0][2][0]).toEqual([
      'Ada Example',
      'ACT-001',
      'attempt-1',
      'schedule-1',
      '',
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      'pending',
      'ready_to_release',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  });
});
