import { describe, expect, it } from 'vitest';
import {
  createInitialExamState,
  getQuestionNumberLabel,
  getStudentQuestionsForModule,
  isQuestionFullyAnswered,
} from '../examAdapterService';

describe('student question descriptors (student exam core logic)', () => {
  it('does not treat MULTI_MCQ with requiredSelections=0 as fully answered', () => {
    const state = createInitialExamState('Exam', 'Academic');

    state.listening.parts[0].blocks = [
      {
        id: 'm1',
        type: 'MULTI_MCQ',
        instruction: 'Choose ONE letter.',
        stem: 'Which option is correct?',
        requiredSelections: 0,
        options: [
          { id: 'A', text: 'A', isCorrect: true },
          { id: 'B', text: 'B', isCorrect: false },
        ],
      },
    ];

    const questions = getStudentQuestionsForModule(state, 'listening');
    expect(questions).toHaveLength(1);

    expect(isQuestionFullyAnswered(questions[0], {})).toBe(false);
    expect(getQuestionNumberLabel(questions, questions[0].id)).toBe('1');
  });

  it('builds TABLE_COMPLETION descriptors in canonical row-major slot order', () => {
    const state = createInitialExamState('Exam', 'Academic');

    state.reading.passages[0].blocks = [
      {
        id: 'table-1',
        type: 'TABLE_COMPLETION',
        instruction: 'Complete the table.',
        answerRule: 'ONE_WORD',
        headers: ['Key', 'Value'],
        rows: [
          ['Name', '____'],
          ['Country', '____'],
        ],
        cells: [
          { id: 'cell-country', row: 1, col: 1, correctAnswer: 'India' },
          { id: 'cell-name', row: 0, col: 1, correctAnswer: 'Anu' },
        ],
      },
    ];

    const questions = getStudentQuestionsForModule(state, 'reading');

    expect(questions).toHaveLength(2);
    expect(questions.map((question) => question.id)).toEqual([
      'table-1:cell-name',
      'table-1:cell-country',
    ]);
    expect(questions[0]?.answerIndex).toBe(0);
    expect(questions[1]?.answerIndex).toBe(1);
    expect(getQuestionNumberLabel(questions, questions[0].id)).toBe('1');
    expect(getQuestionNumberLabel(questions, questions[1].id)).toBe('2');
  });
});
