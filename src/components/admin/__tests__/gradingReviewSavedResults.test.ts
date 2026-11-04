import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInitialExamState } from '../../../services/examAdapterService';
import type { ExamState, QuestionBlock } from '../../../types';
import type { SectionSubmission } from '../../../types/grading';
import {
  buildObjectiveExportRows,
  buildQuestionTracebackGroups,
  buildWideObjectiveExport,
  findSavedScoreMismatches,
} from '../gradingReviewUtils';

function examWith(blocks: QuestionBlock[]): ExamState {
  const state = createInitialExamState('Export saved results', 'Academic');
  state.reading.passages[0]!.blocks = blocks;
  return state;
}

const shortAnswerBlocks: QuestionBlock[] = [
  {
    id: 'block-1',
    type: 'SHORT_ANSWER',
    instruction: '',
    questions: [{ id: 'q-1', prompt: 'What?', correctAnswer: 'Answer', answerRule: 'ONE_WORD' }],
  },
];

function submission(overrides: Partial<SectionSubmission> = {}): SectionSubmission {
  return {
    id: 'sec-1',
    submissionId: 'sub-1',
    section: 'reading',
    answers: { type: 'reading', answers: { 'q-1': 'Answer' } },
    autoGradingResults: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      totalScore: 0,
      maxScore: 1,
      percentage: 0,
      questionResults: [
        {
          questionId: 'q-1',
          studentAnswer: 'Answer',
          correctAnswer: 'Answer',
          isCorrect: false,
          awardedScore: 0,
          maxScore: 1,
          scoringRule: 'exact_match',
          hasOverride: false,
        },
      ],
    },
    gradingStatus: 'auto_graded',
    submittedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as SectionSubmission;
}

describe('saved objective results are official', () => {
  it('shows the saved score instead of the website re-check and reports the mismatch', () => {
    const examState = examWith(shortAnswerBlocks);
    const sectionSubmission = submission();
    const groups = buildQuestionTracebackGroups(examState, sectionSubmission, 'reading');
    const item = groups.flatMap((group) => group.items)[0]!;

    expect(item.correctness).toBe(false);
    expect(item.awardedScore).toBe(0);
    expect(findSavedScoreMismatches(examState, sectionSubmission, 'reading')).toHaveLength(1);

    const rows = buildObjectiveExportRows({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submission: {
        id: 'sub-1',
        scheduleId: 'schedule-1',
        studentName: 'Student',
        studentId: 'student-1',
        cohortName: 'Cohort',
        submittedAt: '2026-01-01T00:00:00.000Z',
      } as never,
      sectionSubmission,
      examState,
      moduleType: 'reading',
    });
    expect(rows[0]?.isCorrect).toBe('Incorrect');
    expect(rows[0]?.autoScore).toBe(0);
  });

  it('includes a teacher Set result change in the export', () => {
    const examState = examWith(shortAnswerBlocks);
    const sectionSubmission = submission({
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: 1,
        maxScore: 1,
        percentage: 100,
        questionResults: [
          {
            questionId: 'q-1',
            studentAnswer: 'Answer',
            correctAnswer: 'Answer',
            isCorrect: true,
            awardedScore: 1,
            maxScore: 1,
            scoringRule: 'exact_match',
            hasOverride: true,
            manualOverride: {
              isCorrect: true,
              awardedScore: 1,
              overriddenBy: 'grader-1',
              overriddenAt: '2026-01-01T00:00:00.000Z',
              reason: 'Accepted on review',
            },
          },
        ],
      },
    });

    const groups = buildQuestionTracebackGroups(examState, sectionSubmission, 'reading');
    const item = groups.flatMap((group) => group.items)[0]!;
    expect(item.correctness).toBe(true);
    expect(item.awardedScore).toBe(1);
    expect(findSavedScoreMismatches(examState, sectionSubmission, 'reading')).toHaveLength(0);

    const rows = buildObjectiveExportRows({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submission: {
        id: 'sub-1',
        scheduleId: 'schedule-1',
        studentName: 'Student',
        studentId: 'student-1',
        cohortName: 'Cohort',
        submittedAt: '2026-01-01T00:00:00.000Z',
      } as never,
      sectionSubmission,
      examState,
      moduleType: 'reading',
    });
    expect(rows[0]?.isCorrect).toBe('Correct');
    expect(rows[0]?.autoScore).toBe(1);
  });
});

describe('parity-consistent saved results', () => {
  it('produces no warning when the saved result matches the website re-check', () => {
    const fixture = JSON.parse(
      readFileSync('testdata/objective-grading-parity/full-coverage-exam.json', 'utf8'),
    ) as {
      examState: ExamState;
      answers: Record<string, unknown>;
      overrides: Record<string, unknown>;
      expected: {
        totalScore: number;
        maxScore: number;
        questions: Array<{ questionId: string; correctness: boolean | null; awardedScore: number | null; maxScore: number | null }>;
      };
    };
    const savedResults = fixture.expected.questions.map((question) => ({
      questionId: question.questionId,
      studentAnswer: '',
      correctAnswer: '',
      isCorrect: question.correctness ?? false,
      awardedScore: question.awardedScore ?? 0,
      maxScore: question.maxScore ?? 0,
      scoringRule: 'exact_match',
      hasOverride: Object.prototype.hasOwnProperty.call(fixture.overrides, question.questionId),
    }));
    const sectionSubmission = {
      id: 'sec-parity',
      submissionId: 'sub-parity',
      section: 'reading',
      answers: { type: 'reading', answers: fixture.answers },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: fixture.expected.totalScore,
        maxScore: fixture.expected.maxScore,
        percentage: 86.21,
        questionResults: savedResults,
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as SectionSubmission;

    expect(findSavedScoreMismatches(fixture.examState, sectionSubmission, 'reading')).toEqual([]);
  });

  it('keeps the saved group mark in traceback and export totals', () => {
    const fixture = JSON.parse(
      readFileSync('testdata/objective-grading-parity/full-coverage-exam.json', 'utf8'),
    ) as {
      examState: ExamState;
      answers: Record<string, unknown>;
      overrides: Record<string, unknown>;
      expected: {
        totalScore: number;
        maxScore: number;
        questions: Array<{ questionId: string; correctness: boolean | null; awardedScore: number | null; maxScore: number | null }>;
      };
    };
    const savedResults = fixture.expected.questions.map((question) => ({
      questionId: question.questionId,
      studentAnswer: '',
      correctAnswer: '',
      isCorrect: question.correctness ?? false,
      awardedScore: question.awardedScore ?? 0,
      maxScore: question.maxScore ?? 0,
      scoringRule: 'exact_match',
      hasOverride: Object.prototype.hasOwnProperty.call(fixture.overrides, question.questionId),
    }));
    const sectionSubmission = {
      id: 'sec-parity',
      submissionId: 'sub-parity',
      section: 'reading',
      answers: { type: 'reading', answers: fixture.answers },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: fixture.expected.totalScore,
        maxScore: fixture.expected.maxScore,
        percentage: 86.21,
        questionResults: savedResults,
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as SectionSubmission;

    const items = buildQuestionTracebackGroups(fixture.examState, sectionSubmission, 'reading')
      .flatMap((group) => group.items);
    const tableGroup = items.find((item) => item.questionId === 'b-table:c1');
    expect(tableGroup?.correctness).toBe(true);
    expect(tableGroup?.awardedScore).toBe(2);
    expect(tableGroup?.maxScore).toBe(2);
    const treeGroup = items.find((item) => item.questionId === 'b-tree::tree::r1::lf1');
    expect(treeGroup?.correctness).toBe(true);
    expect(treeGroup?.awardedScore).toBe(2);
    expect(treeGroup?.maxScore).toBe(2);

    const exportData = buildWideObjectiveExport({
      session: { sessionId: 'session-parity', examTitle: 'Exam' },
      submissions: [{
        id: 'sub-parity',
        scheduleId: 'schedule-1',
        studentName: 'Student',
        studentId: 'student-1',
        cohortName: 'Cohort',
        submittedAt: '2026-01-01T00:00:00.000Z',
      } as never],
      sectionSubmissions: [{ submissionId: 'sub-parity', sectionSubmission }],
      examState: fixture.examState,
      moduleType: 'reading',
    });
    const row = exportData.rows[0]!;
    expect(row['totalScore']).toBe(fixture.expected.totalScore);
    expect(row['maxScore']).toBe(fixture.expected.maxScore);
    const scoreColumns = exportData.columns.filter(
      (column) => column.key.startsWith('score:') || column.key.startsWith('scoreGroup:'),
    );
    const scoreSum = scoreColumns.reduce((sum, column) => {
      const value = row[column.key];
      return sum + (typeof value === 'number' ? value : 0);
    }, 0);
    expect(scoreSum).toBe(fixture.expected.totalScore);
  });
});
