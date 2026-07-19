import { describe, expect, it } from 'vitest';
import {
  countQuestionSlots,
  createInitialExamState,
  getQuestionNumberLabel,
  getQuestionStartNumber,
  getStudentQuestionsForModule,
  isQuestionFullyAnswered,
} from '../examAdapterService';

describe('student question descriptors (student exam core logic)', () => {
  it('derives MULTI_MCQ descriptor slots from marked options instead of requiredSelections', () => {
    const state = createInitialExamState('Exam', 'Academic');

    state.reading.passages[0].blocks = [{
      id: 'm-stale',
      type: 'MULTI_MCQ',
      instruction: 'Choose the correct options.',
      stem: 'Which options are correct?',
      requiredSelections: 4,
      options: [
        { id: 'a', text: 'A', isCorrect: true },
        { id: 'b', text: 'B', isCorrect: false },
        { id: 'c', text: 'C', isCorrect: true },
      ],
    }];

    const questions = getStudentQuestionsForModule(state, 'reading');

    expect(questions[0]?.correctCount).toBe(2);
    expect(countQuestionSlots(questions)).toBe(2);
  });

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

  it('creates one descriptor per SINGLE_MCQ question when questions[] is present', () => {
    const state = createInitialExamState('Exam', 'Academic');

    state.reading.passages[0].blocks = [
      {
        id: 'single-block',
        type: 'SINGLE_MCQ',
        instruction: 'Choose one answer for each question.',
        stem: 'legacy fallback stem',
        options: [
          { id: 'legacy-a', text: 'Legacy A', isCorrect: true },
          { id: 'legacy-b', text: 'Legacy B', isCorrect: false },
        ],
        questions: [
          {
            id: 'single-q1',
            stem: 'Question 1',
            options: [
              { id: 'q1-a', text: 'A', isCorrect: true },
              { id: 'q1-b', text: 'B', isCorrect: false },
            ],
          },
          {
            id: 'single-q2',
            stem: 'Question 2',
            options: [
              { id: 'q2-a', text: 'C', isCorrect: false },
              { id: 'q2-b', text: 'D', isCorrect: true },
            ],
          },
        ],
      } as any,
    ];

    const questions = getStudentQuestionsForModule(state, 'reading');
    expect(questions).toHaveLength(2);

    expect(questions[0]?.id).toBe('single-q1');
    expect(questions[0]?.answerKey).toBe('single-q1');
    expect(questions[0]?.blockId).toBe('single-block');
    expect(questions[1]?.id).toBe('single-q2');
    expect(questions[1]?.answerKey).toBe('single-q2');

    expect(getQuestionNumberLabel(questions, 'single-q1')).toBe('1');
    expect(getQuestionNumberLabel(questions, 'single-q2')).toBe('2');
  });

  it('creates sub-answer tree leaf descriptors when subAnswerModeEnabled is true', () => {
    const state = createInitialExamState('Exam', 'Academic');

    state.reading.passages[0].blocks = [
      {
        id: 'tree-block',
        type: 'SHORT_ANSWER',
        instruction: 'Complete the answer tree.',
        questions: [
          {
            id: 'legacy-q1',
            prompt: 'Legacy prompt',
            correctAnswer: 'legacy',
            acceptedAnswers: ['legacy'],
            answerRule: 'ONE_WORD',
          },
        ],
        subAnswerModeEnabled: true,
        answerTree: [
          {
            id: 'root-a',
            label: 'Root prompt',
            children: [
              { id: 'leaf-a', label: 'Leaf A', acceptedAnswers: ['cat'], required: true },
              { id: 'leaf-b', label: 'Leaf B', acceptedAnswers: ['dog'], required: true },
            ],
          },
        ],
      } as any,
    ];

    const questions = getStudentQuestionsForModule(state, 'reading');
    expect(questions).toHaveLength(2);

    expect(questions[0]?.id).toBe('tree-block::tree::root-a::leaf-a');
    expect(questions[0]?.answerKey).toBe('tree-block::tree::root-a::leaf-a');
    expect(questions[0]?.isSubAnswerTreeLeaf).toBe(true);
    expect(questions[0]?.rootNumber).toBe(1);
    expect(questions[0]?.treePrompt).toBe('Root prompt');
    expect(questions[1]?.id).toBe('tree-block::tree::root-a::leaf-b');
    expect(questions[1]?.rootNumber).toBe(1);
  });

  it('assigns shared rootNumber for grouped sentence-completion blanks', () => {
    const state = createInitialExamState('Exam', 'Academic');

    state.reading.passages[0].blocks = [
      {
        id: 'sentence-grouped',
        type: 'SENTENCE_COMPLETION',
        instruction: 'Complete the sentence.',
        questions: [
          {
            id: 'sentence-q1',
            sentence: 'The ____ is ____.',
            answerRule: 'TWO_WORDS',
            blanks: [
              {
                id: 'blank-1',
                correctAnswer: 'data',
                position: 0,
                scoreGroupId: 'sentence-q1',
                scoreWeight: 1,
                groupRule: 'at_least_n',
                requiredCorrect: 2,
              },
              {
                id: 'blank-2',
                correctAnswer: 'important',
                position: 1,
                scoreGroupId: 'sentence-q1',
                scoreWeight: 0,
                groupRule: 'at_least_n',
                requiredCorrect: 2,
              },
            ],
          },
        ],
      } as any,
    ];

    const questions = getStudentQuestionsForModule(state, 'reading');
    expect(questions).toHaveLength(2);

    // Grouped scoring should display one root question number for both blanks.
    expect(questions[0]?.rootNumber).toBe(1);
    expect(questions[1]?.rootNumber).toBe(1);

    // Student numbering + totals should collapse the group into one question slot.
    expect(countQuestionSlots(questions)).toBe(1);
    expect(getQuestionStartNumber(questions, questions[0]!.id)).toBe(1);
    expect(getQuestionStartNumber(questions, questions[1]!.id)).toBe(1);
    expect(getQuestionNumberLabel(questions, questions[0]!.id)).toBe('1');
    expect(getQuestionNumberLabel(questions, questions[1]!.id)).toBe('1');
  });
});
