import { describe, expect, test } from 'vitest';
import { createInitialExamState } from '../../../services/examAdapterService';
import {
  buildCsvContent,
  buildObjectiveExportRows,
  buildQuestionTracebackGroups,
  buildWideObjectiveExport,
  escapeCsvValue,
  OBJECTIVE_WIDE_EXPORT_BASE_COLUMNS,
  WRITING_EXPORT_COLUMNS,
} from '../gradingReviewUtils';

function createStudentSubmission(id: string, studentId: string, studentName: string) {
  return {
    id,
    submissionId: id,
    scheduleId: 'sched-1',
    examId: 'exam-1',
    publishedVersionId: 'ver-1',
    studentId,
    studentName,
    studentEmail: `${studentId}@example.com`,
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
  } as any;
}

function createQuestionResult(questionId: string, isCorrect: boolean, awardedScore: number) {
  return {
    questionId,
    studentAnswer: '',
    correctAnswer: '',
    isCorrect,
    awardedScore,
    maxScore: 1,
    scoringRule: 'one_word',
    hasOverride: false,
  };
}

function createSectionSubmission(
  submissionId: string,
  section: 'reading' | 'listening',
  answers: Record<string, unknown>,
  questionResults: ReturnType<typeof createQuestionResult>[],
) {
  return {
    id: `${submissionId}-${section}`,
    submissionId,
    section,
    answers: {
      type: section,
      answers,
    },
    autoGradingResults: {
      generatedAt: new Date().toISOString(),
      totalScore: questionResults.reduce((sum, result) => sum + result.awardedScore, 0),
      maxScore: questionResults.reduce((sum, result) => sum + result.maxScore, 0),
      percentage:
        questionResults.length === 0
          ? 0
          : (questionResults.reduce((sum, result) => sum + result.awardedScore, 0) /
              questionResults.reduce((sum, result) => sum + result.maxScore, 0)) *
            100,
      questionResults,
    },
    gradingStatus: 'auto_graded',
    reviewedBy: undefined,
    reviewedAt: undefined,
    finalizedBy: undefined,
    finalizedAt: undefined,
    submittedAt: '2026-01-01T00:00:00.000Z',
  } as any;
}

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
    const csv = buildCsvContent(OBJECTIVE_WIDE_EXPORT_BASE_COLUMNS.slice(0, 3), [
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

  test('builds one reading export row per student with answers before scores', () => {
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
            instruction: 'Answer the questions.',
            questions: [
              { id: 'q-1', prompt: 'First?', correctAnswer: 'Alpha', answerRule: 'ONE_WORD' },
              { id: 'q-2', prompt: 'Second?', correctAnswer: 'Beta', answerRule: 'ONE_WORD' },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];
    const submissions = [
      createStudentSubmission('sub-1', 'stu-1', 'Student One'),
      createStudentSubmission('sub-2', 'stu-2', 'Student Two'),
    ];

    const exportData = buildWideObjectiveExport({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submissions,
      sectionSubmissions: [
        {
          submissionId: 'sub-1',
          sectionSubmission: createSectionSubmission('sub-1', 'reading', { 'q-1': 'Alpha', 'q-2': 'Wrong' }, [
            createQuestionResult('q-1', true, 1),
            createQuestionResult('q-2', false, 0),
          ]),
        },
        {
          submissionId: 'sub-2',
          sectionSubmission: createSectionSubmission('sub-2', 'reading', { 'q-1': 'Other', 'q-2': 'Beta' }, [
            createQuestionResult('q-1', false, 0),
            createQuestionResult('q-2', true, 1),
          ]),
        },
      ],
      examState,
      moduleType: 'reading',
    });

    expect(exportData.rows).toHaveLength(2);
    expect(exportData.columns.map((column) => column.label)).toEqual([
      'Exam Title',
      'Session ID',
      'Schedule ID',
      'Submission ID',
      'Student Name',
      'Student ID',
      'Student Email',
      'Cohort Name',
      'Section',
      'Submitted At',
      'Total Score',
      'Max Score',
      'Percentage',
      'Correct Count',
      'Q1 Answer',
      'Q2 Answer',
      'Q1 Correct Answer',
      'Q2 Correct Answer',
      'Q1 Score',
      'Q2 Score',
    ]);
    expect(exportData.rows[0]?.['answer:q-1']).toBe('Alpha');
    expect(exportData.rows[0]?.['answer:q-2']).toBe('Wrong');
    expect(exportData.rows[0]?.['correct:q-1']).toBe('Alpha');
    expect(exportData.rows[0]?.['correct:q-2']).toBe('Beta');
    expect(exportData.rows[0]?.['score:q-1']).toBe(1);
    expect(exportData.rows[0]?.['score:q-2']).toBe(0);
    expect(exportData.rows[1]?.['answer:q-1']).toBe('Other');
    expect(exportData.rows[1]?.['answer:q-2']).toBe('Beta');
    expect(exportData.rows[1]?.['correct:q-1']).toBe('Alpha');
    expect(exportData.rows[1]?.['correct:q-2']).toBe('Beta');
    expect(exportData.rows[1]?.correctCount).toBe(1);
  });

  test('builds listening export with the same wide format', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.listening.parts = [
      {
        id: 'part-1',
        title: 'Part 1',
        audioUrl: undefined,
        pins: [],
        blocks: [
          {
            id: 'listen-block-1',
            type: 'SHORT_ANSWER',
            instruction: 'Answer the question.',
            questions: [
              { id: 'lq-1', prompt: 'Listen for the word.', correctAnswer: 'Train', answerRule: 'ONE_WORD' },
            ],
          },
        ],
      },
    ];

    const exportData = buildWideObjectiveExport({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submissions: [createStudentSubmission('sub-1', 'stu-1', 'Student One')],
      sectionSubmissions: [
        {
          submissionId: 'sub-1',
          sectionSubmission: createSectionSubmission('sub-1', 'listening', { 'lq-1': 'Train' }, [
            createQuestionResult('lq-1', true, 1),
          ]),
        },
      ],
      examState,
      moduleType: 'listening',
    });

    expect(exportData.rows).toHaveLength(1);
    expect(exportData.columns.at(-3)?.label).toBe('Q1 Answer');
    expect(exportData.columns.at(-2)?.label).toBe('Q1 Correct Answer');
    expect(exportData.columns.at(-1)?.label).toBe('Q1 Score');
    expect(exportData.rows[0]?.section).toBe('listening');
    expect(exportData.rows[0]?.['answer:lq-1']).toBe('Train');
    expect(exportData.rows[0]?.['correct:lq-1']).toBe('Train');
  });

  test('uses computed auto scores when stored question scores are missing', () => {
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
            instruction: 'Answer the questions.',
            questions: [
              { id: 'q-1', prompt: 'First?', correctAnswer: 'Alpha', answerRule: 'ONE_WORD' },
              { id: 'q-2', prompt: 'Second?', correctAnswer: 'Beta', answerRule: 'ONE_WORD' },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];

    const exportData = buildWideObjectiveExport({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submissions: [createStudentSubmission('sub-1', 'stu-1', 'Student One')],
      sectionSubmissions: [
        {
          submissionId: 'sub-1',
          sectionSubmission: createSectionSubmission('sub-1', 'reading', { 'q-1': 'Alpha' }, [
            createQuestionResult('q-1', true, 1),
          ]),
        },
      ],
      examState,
      moduleType: 'reading',
    });

    expect(exportData.rows[0]?.['answer:q-2']).toBe('');
    expect(exportData.rows[0]?.['correct:q-2']).toBe('Beta');
    expect(exportData.rows[0]?.['score:q-1']).toBe(1);
    expect(exportData.rows[0]?.['score:q-2']).toBe(0);
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
