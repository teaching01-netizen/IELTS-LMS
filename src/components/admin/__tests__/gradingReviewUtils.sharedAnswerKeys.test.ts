import { describe, expect, test } from 'vitest';
import { createInitialExamState } from '../../../services/examAdapterService';
import { buildQuestionTracebackGroups } from '../gradingReviewUtils';

describe('gradingReviewUtils shared sentence answer keys', () => {
  test('shows one correct and one incorrect traceback slot for a repeated shared answer', () => {
    const examState = createInitialExamState('Exam', 'Academic');
    examState.reading.passages = [
      {
        id: 'passage-1',
        title: 'Passage 1',
        content: 'Content',
        blocks: [
          {
            id: 'sentence-block',
            type: 'SENTENCE_COMPLETION',
            instruction: 'Complete the sentence.',
            questions: [
              {
                id: 'sentence-1',
                sentence: 'The answer is ____ and ____.',
                blanks: [
                  { id: 'blank-1', correctAnswer: 'alpha', position: 0 },
                  { id: 'blank-2', correctAnswer: 'beta', position: 1 },
                ],
                answerRule: 'ONE_WORD',
                acceptAnyAnswerKey: true,
                sharedAcceptedAnswers: ['alpha', 'beta'],
              },
            ],
          },
        ],
        images: [],
        wordCount: 1,
      },
    ];

    const sectionSubmission = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: 'reading',
      answers: {
        type: 'reading',
        answers: { 'sentence-1': ['alpha', 'alpha'] },
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } as any;

    const groups = buildQuestionTracebackGroups(examState, sectionSubmission, 'reading');
    const items = groups[0]?.items ?? [];

    expect(items.map((item) => item.questionId)).toEqual([
      'sentence-1:blank-1',
      'sentence-1:blank-2',
    ]);
    expect(items.map((item) => item.studentAnswer)).toEqual(['alpha', 'alpha']);
    expect(items.map((item) => item.correctness)).toEqual([true, false]);
    expect(items.map((item) => item.correctAnswer)).toEqual(['alpha | beta', 'alpha | beta']);
  });
});
