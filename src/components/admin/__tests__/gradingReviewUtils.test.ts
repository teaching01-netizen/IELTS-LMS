import { describe, expect, test } from 'vitest';
import { createInitialExamState } from '../../../services/examAdapterService';
import {
  buildCsvContent,
  buildObjectiveExportRows,
  buildQuestionTracebackGroups,
  escapeCsvValue,
  READING_EXPORT_COLUMNS,
  WRITING_EXPORT_COLUMNS,
} from '../gradingReviewUtils';

describe('gradingReviewUtils', () => {
  test('escapes csv values with commas, quotes, and newlines', () => {
    expect(escapeCsvValue('hello, "world"\nline two')).toBe('"hello, ""world""\nline two"');
  });

  test('protects spreadsheet exports from formula-like prefixes', () => {
    expect(escapeCsvValue('=1+1')).toBe("'=1+1");
    expect(escapeCsvValue('+1+1')).toBe("'+1+1");
    expect(escapeCsvValue('-1+1')).toBe("'-1+1");
    expect(escapeCsvValue('@user')).toBe("'@user");
  });

  test('builds stable csv content with escaped values', () => {
    const csv = buildCsvContent(READING_EXPORT_COLUMNS.slice(0, 3), [
      {
        examTitle: 'Test, Exam',
        sessionId: 'sess-1',
        scheduleId: 'sched-1',
      },
    ]);

    expect(csv).toContain('Exam Title,Session ID,Schedule ID');
    expect(csv).toContain('"Test, Exam"');
  });

  test('builds traceback groups and export rows for objective questions', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'passage-1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'block-1',
            type: 'SHORT_ANSWER',
            instruction: 'Answer the question.',
            questions: [
              {
                id: 'q-1',
                prompt: 'What is it?',
                correctAnswer: 'Answer',
                answerRule: 'ONE_WORD',
              },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];

    const sectionSubmission = {
      id: 'sec-1',
      submissionId: 'sub-1',
      section: 'reading',
      answers: {
        type: 'reading',
        answers: {
          'q-1': 'Answer',
        },
      },
      autoGradingResults: {
        generatedAt: new Date().toISOString(),
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
            scoringRule: 'one_word',
            hasOverride: false,
          },
        ],
      },
      gradingStatus: 'auto_graded',
      reviewedBy: undefined,
      reviewedAt: undefined,
      finalizedBy: undefined,
      finalizedAt: undefined,
      submittedAt: '2026-01-01T00:00:00.000Z',
    } as any;

    const groups = buildQuestionTracebackGroups(examState, sectionSubmission, 'reading');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items[0]?.studentAnswer).toBe('Answer');
    expect(groups[0]?.items[0]?.correctness).toBe(true);

    const rows = buildObjectiveExportRows({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submission: {
        id: 'sub-1',
        submissionId: 'sub-1',
        scheduleId: 'sched-1',
        examId: 'exam-1',
        publishedVersionId: 'ver-1',
        studentId: 'stu-1',
        studentName: 'Student',
        cohortName: 'Cohort',
        submittedAt: '2026-01-01T00:00:00.000Z',
        timeSpentSeconds: 0,
        gradingStatus: 'submitted',
        isFlagged: false,
        isOverdue: false,
        sectionStatuses: {
          listening: 'pending',
          reading: 'auto_graded',
          writing: 'needs_review',
          speaking: 'pending',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as any,
      sectionSubmission,
      examState,
      moduleType: 'reading',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.questionId).toBe('q-1');
    expect(rows[0]?.isCorrect).toBe('Correct');
  });

  test('prefers stored objective correctness when it differs from the raw answer', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'passage-1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'block-1',
            type: 'SHORT_ANSWER',
            instruction: 'Answer the question.',
            questions: [
              {
                id: 'q-1',
                prompt: 'What is it?',
                correctAnswer: 'Answer',
                answerRule: 'ONE_WORD',
              },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];

    const mismatchedSectionSubmission = {
      id: 'sec-1',
      submissionId: 'sub-1',
      section: 'reading',
      answers: {
        type: 'reading',
        answers: {
          'q-1': 'Answer',
        },
      },
      autoGradingResults: {
        generatedAt: new Date().toISOString(),
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
            scoringRule: 'one_word',
            hasOverride: true,
          },
        ],
      },
      gradingStatus: 'auto_graded',
      reviewedBy: undefined,
      reviewedAt: undefined,
      finalizedBy: undefined,
      finalizedAt: undefined,
      submittedAt: '2026-01-01T00:00:00.000Z',
    } as any;

    const groups = buildQuestionTracebackGroups(examState, mismatchedSectionSubmission, 'reading');
    expect(groups[0]?.items[0]?.correctness).toBe(false);

    const rows = buildObjectiveExportRows({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submission: {
        id: 'sub-1',
        submissionId: 'sub-1',
        scheduleId: 'sched-1',
        examId: 'exam-1',
        publishedVersionId: 'ver-1',
        studentId: 'stu-1',
        studentName: 'Student',
        cohortName: 'Cohort',
        submittedAt: '2026-01-01T00:00:00.000Z',
        timeSpentSeconds: 0,
        gradingStatus: 'submitted',
        isFlagged: false,
        isOverdue: false,
        sectionStatuses: {
          listening: 'pending',
          reading: 'auto_graded',
          writing: 'needs_review',
          speaking: 'pending',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } as any,
      sectionSubmission: mismatchedSectionSubmission,
      examState,
      moduleType: 'reading',
    });

    expect(rows[0]?.isCorrect).toBe('Incorrect');
    expect(rows[0]?.autoScore).toBe(0);
    expect(rows[0]?.maxScore).toBe(1);
  });

  test('writing export columns remain stable', () => {
    const csv = buildCsvContent(WRITING_EXPORT_COLUMNS.slice(0, 6), [
      {
        examTitle: 'Exam',
        sessionId: 'session-1',
        scheduleId: 'sched-1',
        submissionId: 'sub-1',
        studentName: 'Student',
        studentId: 'stu-1',
      },
    ]);

    expect(csv).toContain('Exam');
    expect(csv).toContain('Student');
  });
});
