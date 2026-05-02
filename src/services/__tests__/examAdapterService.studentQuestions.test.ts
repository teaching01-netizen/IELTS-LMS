import { describe, expect, it } from 'vitest';
import {
  countAnsweredQuestions,
  countQuestionSlots,
  createInitialExamState,
  getQuestionNumberLabel,
  getStudentQuestionsForModule,
  isQuestionFullyAnswered,
} from '../examAdapterService';

describe('student question descriptors (student exam core logic)', () => {
  it('expands MULTI_MCQ into required selection slots with progressive answered counts', () => {
    const state = createInitialExamState('Exam', 'Academic');

    state.reading.passages[0].blocks = [
      {
        id: 'short-1',
        type: 'SHORT_ANSWER',
        instruction: 'Answer one question.',
        questions: [{ id: 'q-1', prompt: 'Q1', correctAnswer: 'A', answerRule: 'ONE_WORD' }],
      },
      {
        id: 'multi-1',
        type: 'MULTI_MCQ',
        instruction: 'Choose two letters.',
        stem: 'Pick two answers',
        requiredSelections: 2,
        options: [
          { id: 'A', text: 'A', isCorrect: true },
          { id: 'B', text: 'B', isCorrect: true },
          { id: 'C', text: 'C', isCorrect: false },
        ],
      },
      {
        id: 'short-2',
        type: 'SHORT_ANSWER',
        instruction: 'Answer one question.',
        questions: [{ id: 'q-2', prompt: 'Q2', correctAnswer: 'B', answerRule: 'ONE_WORD' }],
      },
    ] as any;

    const questions = getStudentQuestionsForModule(state, 'reading');
    const multiQuestions = questions.filter((question) => question.blockId === 'multi-1');

    expect(multiQuestions).toHaveLength(2);
    expect(multiQuestions.map((question) => question.id)).toEqual([
      'multi-1:slot:1',
      'multi-1:slot:2',
    ]);
    expect(multiQuestions.map((question) => question.numberLabel)).toEqual(['2', '3']);
    expect(countQuestionSlots(questions)).toBe(4);

    expect(countAnsweredQuestions(questions, {})).toBe(0);
    expect(countAnsweredQuestions(questions, { 'multi-1': ['A'] })).toBe(1);
    expect(countAnsweredQuestions(questions, { 'multi-1': ['A', 'B'] })).toBe(2);
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

  it('builds sub-answer tree leaf descriptors with dot labels and root completion counting', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.reading.passages[0].blocks = [
      {
        id: 'short-tree-1',
        type: 'SHORT_ANSWER',
        instruction: 'Tree mode block',
        insertedImages: [],
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
      },
    ] as any;

    const questions = getStudentQuestionsForModule(state, 'reading');
    expect(questions.map((question) => question.numberLabel)).toEqual(['1.1', '1.2']);
    expect(questions.every((question) => question.rootNumber === 1)).toBe(true);

    const answerMap = {
      [questions[0].id]: 'cat',
      [questions[1].id]: '',
    };
    expect(countAnsweredQuestions(questions, answerMap)).toBe(0);

    answerMap[questions[1].id] = 'dog';
    expect(countAnsweredQuestions(questions, answerMap)).toBe(1);
  });

  it('keeps empty tree labels as empty prompts in student descriptors', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.reading.passages[0].blocks = [
      {
        id: 'short-tree-empty-label',
        type: 'SHORT_ANSWER',
        instruction: 'Tree mode block',
        insertedImages: [],
        subAnswerModeEnabled: true,
        answerTree: [
          {
            id: 'root-a',
            label: '',
            children: [{ id: 'legacy-leaf-id', label: '   ', acceptedAnswers: ['cat'], required: true }],
          },
        ],
        questions: [],
      },
    ] as any;

    const questions = getStudentQuestionsForModule(state, 'reading');
    expect(questions).toHaveLength(1);
    expect(questions[0]?.treePrompt).toBe('');
    expect(questions[0]?.treePrompt).not.toBe('legacy-leaf-id');
  });

  it('excludes optional-only tree roots from total and answered counts', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.reading.passages[0].blocks = [
      {
        id: 'short-tree-optional',
        type: 'SHORT_ANSWER',
        instruction: 'Tree mode optional-only',
        insertedImages: [],
        subAnswerModeEnabled: true,
        answerTree: [
          {
            id: 'root-a',
            label: 'Root A',
            children: [{ id: 'leaf-a', label: 'Leaf A', acceptedAnswers: ['cat'], required: false }],
          },
        ],
        questions: [],
      },
    ] as any;

    const questions = getStudentQuestionsForModule(state, 'reading');
    expect(questions).toHaveLength(1);
    expect(countQuestionSlots(questions)).toBe(0);
    expect(countAnsweredQuestions(questions, { [questions[0].id]: 'cat' })).toBe(0);
  });

  it('heals collapsed legacy tree roots before building student descriptors', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.reading.passages[0].blocks = [
      {
        id: 'short-tree-collapsed',
        type: 'SHORT_ANSWER',
        instruction: 'Tree mode collapsed',
        insertedImages: [],
        subAnswerModeEnabled: true,
        questions: [
          { id: 'q1', prompt: 'Prompt 1', correctAnswer: 'a', answerRule: 'ONE_WORD', acceptedAnswers: ['a'] },
          { id: 'q2', prompt: 'Prompt 2', correctAnswer: 'b', answerRule: 'ONE_WORD', acceptedAnswers: ['b'] },
          { id: 'q3', prompt: 'Prompt 3', correctAnswer: 'c', answerRule: 'ONE_WORD', acceptedAnswers: ['c'] },
        ],
        answerTree: [
          {
            id: 'root-a',
            label: 'Root A',
            children: [{ id: 'leaf-a', label: 'Leaf A', acceptedAnswers: ['a'], required: true }],
          },
        ],
      },
    ] as any;

    const questions = getStudentQuestionsForModule(state, 'reading');
    expect(questions.map((question) => question.rootNumber)).toEqual([1, 2, 3]);
    expect(questions.map((question) => question.numberLabel)).toEqual(['1.1', '2.1', '3.1']);
  });

  it('hydrates tree prompts from block questions when canonical roots contain stale empty leaf labels', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.reading.passages[0].blocks = [
      {
        id: 'short-tree-stale-prompts',
        type: 'SHORT_ANSWER',
        instruction: 'Tree mode stale prompts',
        insertedImages: [],
        subAnswerModeEnabled: true,
        questions: [
          { id: 'q1', prompt: 'Question 18 prompt', correctAnswer: 'a', answerRule: 'ONE_WORD', acceptedAnswers: ['a'] },
          { id: 'q2', prompt: 'Question 19 prompt', correctAnswer: 'b', answerRule: 'ONE_WORD', acceptedAnswers: ['b'] },
        ],
        answerTree: [
          {
            id: 'root-1',
            label: '',
            children: [{ id: 'leaf-1', label: '', acceptedAnswers: [], required: true }],
          },
          {
            id: 'root-2',
            label: '',
            children: [{ id: 'leaf-2', label: 'outdated', acceptedAnswers: ['old'], required: true }],
          },
        ],
      },
    ] as any;

    const questions = getStudentQuestionsForModule(state, 'reading');

    expect(questions.map((question) => question.treePrompt)).toEqual([
      'Question 18 prompt',
      'Question 19 prompt',
    ]);
  });
});
