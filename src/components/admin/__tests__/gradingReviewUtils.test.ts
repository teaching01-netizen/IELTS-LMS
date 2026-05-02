import { describe, expect, test } from 'vitest';
import { createInitialExamState } from '../../../services/examAdapterService';
import {
  buildCsvContent,
  buildObjectiveExportRows,
  buildQuestionTracebackGroups,
  buildWideObjectiveExport,
  buildWideWritingExport,
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

function createWritingTaskSubmission(
  submissionId: string,
  taskId: string,
  studentText: string,
  wordCount: number,
) {
  return {
    id: `${submissionId}-${taskId}`,
    submissionId,
    taskId,
    taskLabel: taskId === 'task1' ? 'Task 1' : 'Task 2',
    prompt: `${taskId} prompt`,
    studentText,
    wordCount,
    rubricAssessment: {
      taskResponseBand: 7,
      coherenceBand: 6.5,
      lexicalBand: 7.5,
      grammarBand: 6,
      overallBand: 7,
    },
    annotations: [
      {
        id: `${submissionId}-${taskId}-annotation-1`,
        taskId,
        type: 'highlight',
        startOffset: 0,
        endOffset: 5,
        selectedText: 'Hello',
        comment: '',
        visibility: 'student_visible',
        createdBy: 'teacher-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: `${submissionId}-${taskId}-annotation-2`,
        taskId,
        type: 'inline_comment',
        startOffset: 6,
        endOffset: 11,
        selectedText: 'world',
        comment: 'Internal',
        visibility: 'internal_only',
        createdBy: 'teacher-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    overallFeedback: `${taskId} feedback`,
    studentVisibleNotes: `${taskId} notes`,
    gradingStatus: 'finalized',
    submittedAt: '2026-01-01T00:00:00.000Z',
    gradedBy: 'teacher-1',
    gradedAt: '2026-01-02T00:00:00.000Z',
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

  test('keeps objective raw-fidelity for array answers and CSV parity', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'passage-1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'mcq-block-1',
            type: 'MULTI_MCQ',
            instruction: 'Choose two',
            stem: 'Choose two',
            requiredSelections: 2,
            options: [
              { id: 'A', text: 'Alpha', isCorrect: true },
              { id: 'B', text: 'Beta', isCorrect: false },
              { id: 'C', text: 'Charlie', isCorrect: true },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];

    const storedAnswer = [' A ', '', 'C,C'];
    const sectionSubmission = createSectionSubmission(
      'sub-1',
      'reading',
      { 'mcq-block-1': storedAnswer },
      [createQuestionResult('mcq-block-1', false, 0)],
    );

    const groups = buildQuestionTracebackGroups(examState, sectionSubmission, 'reading');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(2);
    expect(groups[0]?.items[0]?.studentAnswerSlots).toEqual(storedAnswer);
    expect(groups[0]?.items[1]?.studentAnswerSlots).toEqual(storedAnswer);
    expect(groups[0]?.items[0]?.studentAnswer).toBe('[" A ","","C,C"]');
    expect(groups[0]?.items[1]?.studentAnswer).toBe('[" A ","","C,C"]');

    const exportData = buildWideObjectiveExport({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submissions: [createStudentSubmission('sub-1', 'stu-1', 'Student One')],
      sectionSubmissions: [{ submissionId: 'sub-1', sectionSubmission }],
      examState,
      moduleType: 'reading',
    });

    expect(exportData.rows[0]?.['answer:mcq-block-1:slot:1']).toBe(groups[0]?.items[0]?.studentAnswer);
    expect(exportData.rows[0]?.['answer:mcq-block-1:slot:2']).toBe(groups[0]?.items[1]?.studentAnswer);
  });

  test('scores MULTI_MCQ with partial credit across slot descriptors in wide export totals', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'passage-1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'mcq-block-2',
            type: 'MULTI_MCQ',
            instruction: 'Choose two',
            stem: 'Choose two',
            requiredSelections: 2,
            options: [
              { id: 'A', text: 'Alpha', isCorrect: true },
              { id: 'B', text: 'Beta', isCorrect: false },
              { id: 'C', text: 'Charlie', isCorrect: true },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];

    const sectionSubmission = createSectionSubmission(
      'sub-1',
      'reading',
      { 'mcq-block-2': ['A'] },
      [],
    );

    const exportData = buildWideObjectiveExport({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submissions: [createStudentSubmission('sub-1', 'stu-1', 'Student One')],
      sectionSubmissions: [{ submissionId: 'sub-1', sectionSubmission }],
      examState,
      moduleType: 'reading',
    });

    expect(exportData.rows[0]?.totalScore).toBe(1);
    expect(exportData.rows[0]?.maxScore).toBe(2);
    expect(exportData.rows[0]?.correctCount).toBe(1);
  });

  test('uses root-only scoring for sub-answer tree mode with unordered leaf matching', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'passage-1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'tree-block-1',
            type: 'SHORT_ANSWER',
            instruction: 'Tree mode',
            subAnswerModeEnabled: true,
            answerTree: [
              {
                id: 'root-a',
                label: 'Root A',
                children: [
                  { id: 'leaf-a', label: 'Leaf A', acceptedAnswers: ['cat'], required: true },
                  { id: 'leaf-b', label: 'Leaf B', acceptedAnswers: ['dog'], required: true },
                ],
              },
            ],
            questions: [],
          } as any,
        ],
        images: [],
        wordCount: 1,
      },
    ];

    const answers = {
      'tree-block-1::tree::root-a::leaf-a': 'dog',
      'tree-block-1::tree::root-a::leaf-b': 'cat',
    };
    const sectionSubmission = createSectionSubmission('sub-1', 'reading', answers, []);

    const groups = buildQuestionTracebackGroups(examState, sectionSubmission, 'reading');
    expect(groups[0]?.items).toHaveLength(2);
    expect(groups[0]?.items[0]?.rootCorrectness).toBe(true);
    expect(groups[0]?.items[1]?.rootCorrectness).toBe(true);

    const exportData = buildWideObjectiveExport({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submissions: [createStudentSubmission('sub-1', 'stu-1', 'Student One')],
      sectionSubmissions: [{ submissionId: 'sub-1', sectionSubmission }],
      examState,
      moduleType: 'reading',
    });

    expect(exportData.rows[0]?.totalScore).toBe(1);
    expect(exportData.rows[0]?.maxScore).toBe(1);
    expect(exportData.rows[0]?.correctCount).toBe(1);
  });

  test('tree traceback prompt does not expose legacy node ids when label is empty', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'passage-1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'tree-blank-prompt',
            type: 'SHORT_ANSWER',
            instruction: 'Tree mode',
            subAnswerModeEnabled: true,
            answerTree: [
              {
                id: 'root-a',
                label: '',
                children: [
                  { id: 'legacy-node-id', label: '   ', acceptedAnswers: ['cat'], required: true },
                ],
              },
            ],
            questions: [],
          } as any,
        ],
        images: [],
        wordCount: 1,
      },
    ];

    const answers = {
      'tree-blank-prompt::tree::root-a::legacy-node-id': 'cat',
    };
    const sectionSubmission = createSectionSubmission('sub-1', 'reading', answers, []);

    const groups = buildQuestionTracebackGroups(examState, sectionSubmission, 'reading');
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]?.prompt).toBe('1.1');
    expect(groups[0]?.items[0]?.prompt).not.toContain('legacy-node-id');
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
      'Q1 Right Answer',
      'Q2 Right Answer',
      'Q1 Score',
      'Q2 Score',
      'IELTS Band Score',
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
    expect(exportData.rows[1]?.totalScore).toBe(1);
  });

  test('recomputes correct count from per-question scores and adds IELTS band score', () => {
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
            questions: Array.from({ length: 40 }, (_, index) => ({
              id: `q-${index + 1}`,
              prompt: `Question ${index + 1}?`,
              correctAnswer: `A${index + 1}`,
              answerRule: 'ONE_WORD' as const,
            })),
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];
    const questionResults = Array.from({ length: 40 }, (_, index) =>
      createQuestionResult(`q-${index + 1}`, true, 1),
    );
    const sectionSubmission = createSectionSubmission(
      'sub-1',
      'reading',
      Object.fromEntries(questionResults.map((result, index) => [result.questionId, `A${index + 1}`])),
      questionResults,
    );
    sectionSubmission.autoGradingResults.totalScore = 0;

    const exportData = buildWideObjectiveExport({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submissions: [createStudentSubmission('sub-1', 'stu-1', 'Student One')],
      sectionSubmissions: [{ submissionId: 'sub-1', sectionSubmission }],
      examState,
      moduleType: 'reading',
    });

    expect(exportData.columns.at(-1)?.label).toBe('IELTS Band Score');
    expect(exportData.rows[0]?.correctCount).toBe(40);
    expect(exportData.rows[0]?.totalScore).toBe(40);
    expect(exportData.rows[0]?.ieltsBandScore).toBe(9);
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
    expect(exportData.columns.at(-4)?.label).toBe('Q1 Answer');
    expect(exportData.columns.at(-3)?.label).toBe('Q1 Right Answer');
    expect(exportData.columns.at(-2)?.label).toBe('Q1 Score');
    expect(exportData.columns.at(-1)?.label).toBe('IELTS Band Score');
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

  test('builds wide writing export with one row per student and plain text responses', () => {
    const submissions = [
      createStudentSubmission('sub-1', 'stu-1', 'Student One'),
      createStudentSubmission('sub-2', 'stu-2', 'Student Two'),
    ];

    const exportData = buildWideWritingExport({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submissions,
      writingSubmissions: [
        {
          submissionId: 'sub-1',
          writing: [
            createWritingTaskSubmission(
              'sub-1',
              'task1',
              '<div>Hello&nbsp;world</div><div>Second line</div>',
              4,
            ),
            createWritingTaskSubmission('sub-1', 'task2', '<p>Task two &amp; more</p>', 4),
          ],
        },
        {
          submissionId: 'sub-2',
          writing: [
            createWritingTaskSubmission('sub-2', 'task1', '<span>Another answer</span>', 2),
            createWritingTaskSubmission('sub-2', 'task2', '=formula-like text', 2),
          ],
        },
      ],
    });

    expect(exportData.rows).toHaveLength(2);
    expect(exportData.columns.map((column) => column.label)).toContain('Task 1 Response');
    expect(exportData.columns.map((column) => column.label)).toContain('Task 2 Overall Band');
    expect(exportData.rows[0]?.['task1:response']).toBe('Hello world\nSecond line');
    expect(exportData.rows[0]?.['task2:response']).toBe('Task two & more');
    expect(exportData.rows[0]?.['task1:wordCount']).toBe(4);
    expect(exportData.rows[0]?.['task1:overallBand']).toBe(7);
    expect(exportData.rows[0]?.['task1:annotationCount']).toBe(2);
    expect(exportData.rows[0]?.['task1:studentVisibleAnnotationCount']).toBe(1);
    expect(exportData.rows[1]?.studentName).toBe('Student Two');
    expect(exportData.rows[1]?.['task2:response']).toBe('=formula-like text');
  });

  test('leaves missing writing task columns blank', () => {
    const exportData = buildWideWritingExport({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submissions: [createStudentSubmission('sub-1', 'stu-1', 'Student One')],
      writingSubmissions: [
        {
          submissionId: 'sub-1',
          writing: [createWritingTaskSubmission('sub-1', 'task1', '<p>Task one only</p>', 3)],
        },
      ],
    });

    expect(exportData.rows[0]?.['task1:response']).toBe('Task one only');
    expect(exportData.rows[0]?.['task2:response']).toBe('');
    expect(exportData.rows[0]?.['task2:wordCount']).toBe('');
    expect(exportData.rows[0]?.['task2:overallBand']).toBe('');
  });

  test('wide writing csv keeps escaping and formula protection', () => {
    const exportData = buildWideWritingExport({
      session: { sessionId: 'session-1', examTitle: 'Exam' },
      submissions: [createStudentSubmission('sub-1', 'stu-1', 'Student One')],
      writingSubmissions: [
        {
          submissionId: 'sub-1',
          writing: [
            createWritingTaskSubmission(
              'sub-1',
              'task1',
              '<p>Hello, "world"</p><p>=SUM(A1:A2)</p>',
              3,
            ),
          ],
        },
      ],
    });

    const csv = buildCsvContent(exportData.columns, exportData.rows);

    expect(csv).toContain('"Hello, ""world""\n=SUM(A1:A2)"');
  });
});
