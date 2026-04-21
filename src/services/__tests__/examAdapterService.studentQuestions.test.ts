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
});

