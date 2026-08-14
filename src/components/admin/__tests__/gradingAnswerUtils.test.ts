import { describe, expect, test } from 'vitest';
import type {
  StudentQuestionDescriptor,
} from '../../../services/examAdapterService';
import {
  getCorrectAnswerDisplay,
  getQuestionPrompt,
  getStudentAnswerDisplay,
  getMultiSelectAnswerScore,
  isStudentAnswerCorrect,
  resolveSentenceCompletionCorrectness,
} from '../gradingAnswerUtils';

function buildSentenceDescriptor(
  id: string,
  answerIndex: number,
  acceptAnyAnswerKey: boolean,
  sharedAcceptedAnswers?: string[],
): StudentQuestionDescriptor {
  const question = {
    id: 'sentence-1',
    sentence: 'The answer is ____ and ____.',
    blanks: [
      { id: 'blank-1', correctAnswer: 'alpha', position: 0 },
      { id: 'blank-2', correctAnswer: 'beta', position: 1 },
    ],
    answerRule: 'ONE_WORD',
    acceptAnyAnswerKey,
    ...(sharedAcceptedAnswers === undefined ? {} : { sharedAcceptedAnswers }),
  };

  return {
    id,
    blockId: 'sentence-block',
    groupId: 'passage-1',
    groupLabel: 'Passage 1',
    isMulti: false,
    correctCount: 1,
    answerKey: 'sentence-1',
    answerIndex,
    block: {
      id: 'sentence-block',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete the sentence.',
      questions: [question],
    },
    question,
  } as unknown as StudentQuestionDescriptor;
}

describe('gradingAnswerUtils', () => {
  test('grades a shared sentence permutation once across its blanks', () => {
    const descriptors = [
      buildSentenceDescriptor('sentence-1:blank-1', 0, true),
      buildSentenceDescriptor('sentence-1:blank-2', 1, true),
    ];

    expect(
      resolveSentenceCompletionCorrectness(descriptors, {
        'sentence-1': ['beta', 'alpha'],
      }),
    ).toEqual(new Map([
      ['sentence-1:blank-1', true],
      ['sentence-1:blank-2', true],
    ]));
  });

  test('consumes a shared answer key so repeated answers score one slot', () => {
    const descriptors = [
      buildSentenceDescriptor('sentence-1:blank-1', 0, true),
      buildSentenceDescriptor('sentence-1:blank-2', 1, true),
    ];

    expect(
      resolveSentenceCompletionCorrectness(descriptors, {
        'sentence-1': ['alpha', 'alpha'],
      }),
    ).toEqual(new Map([
      ['sentence-1:blank-1', true],
      ['sentence-1:blank-2', false],
    ]));
  });

  test('shared-disabled blank 1 rejects a key configured only on blank 2', () => {
    const descriptors = [
      buildSentenceDescriptor('sentence-1:blank-1', 0, false),
      buildSentenceDescriptor('sentence-1:blank-2', 1, false),
    ];

    expect(
      resolveSentenceCompletionCorrectness(descriptors, {
        'sentence-1': ['beta', ''],
      }),
    ).toEqual(new Map([
      ['sentence-1:blank-1', false],
      ['sentence-1:blank-2', false],
    ]));
  });

  test('displays the effective shared pool for every shared sentence row', () => {
    const descriptor = buildSentenceDescriptor('sentence-1:blank-1', 0, true);

    expect(getCorrectAnswerDisplay(descriptor)).toBe('alpha | beta');
  });

  test('does not display hidden blank keys when the shared pool is explicitly empty', () => {
    const descriptor = buildSentenceDescriptor('sentence-1:blank-1', 0, true, []);

    expect(getCorrectAnswerDisplay(descriptor)).toBe('');
  });

  test('TFNG: formats prompt, correct answer, and correctness', () => {
    const descriptor = {
      id: 'q1',
      blockId: 'b1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'q1',
      block: {
        id: 'b1',
        type: 'TFNG',
        instruction: '',
        mode: 'TFNG',
        questions: [{ id: 'q1', statement: 'Statement', correctAnswer: 'T' }],
      },
      question: { id: 'q1', statement: 'Statement', correctAnswer: 'T' },
    } as unknown as StudentQuestionDescriptor;

    expect(getQuestionPrompt(descriptor)).toBe('Statement');
    expect(getCorrectAnswerDisplay(descriptor)).toBe('T');
    expect(getStudentAnswerDisplay(descriptor, { q1: 'T' })).toBe('T');
    expect(isStudentAnswerCorrect(descriptor, { q1: 'T' })).toBe(true);
  });

  test('CLOZE: requires answer-key case for correctness indicator', () => {
    const descriptor = {
      id: 'q1',
      blockId: 'b1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'q1',
      block: {
        id: 'b1',
        type: 'CLOZE',
        instruction: '',
        answerRule: 'TWO_WORDS',
        questions: [{ id: 'q1', prompt: 'Fill blank', correctAnswer: 'daily' }],
      },
      question: { id: 'q1', prompt: 'Fill blank', correctAnswer: 'daily' },
    } as unknown as StudentQuestionDescriptor;

    expect(getCorrectAnswerDisplay(descriptor)).toBe('daily');
    expect(isStudentAnswerCorrect(descriptor, { q1: 'Daily' })).toBe(false);
    expect(isStudentAnswerCorrect(descriptor, { q1: 'daily' })).toBe(true);
  });

  test('CLOZE: accepts alternatives and normalizes punctuation/spacing', () => {
    const descriptor = {
      id: 'q-alt',
      blockId: 'b-alt',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'q-alt',
      block: {
        id: 'b-alt',
        type: 'CLOZE',
        instruction: '',
        answerRule: 'TWO_WORDS',
        questions: [
          {
            id: 'q-alt',
            prompt: 'Fill blank',
            correctAnswer: 'state-of-the-art',
            acceptedAnswers: ['state-of-the-art', 'advanced'],
          },
        ],
      },
      question: {
        id: 'q-alt',
        prompt: 'Fill blank',
        correctAnswer: 'state-of-the-art',
        acceptedAnswers: ['state-of-the-art', 'advanced'],
      },
    } as unknown as StudentQuestionDescriptor;

    expect(getCorrectAnswerDisplay(descriptor)).toBe('state-of-the-art | advanced');
    expect(isStudentAnswerCorrect(descriptor, { 'q-alt': 'state of the art' })).toBe(true);
    expect(isStudentAnswerCorrect(descriptor, { 'q-alt': 'State of the art' })).toBe(false);
    expect(isStudentAnswerCorrect(descriptor, { 'q-alt': 'advanced' })).toBe(true);
    expect(isStudentAnswerCorrect(descriptor, { 'q-alt': 'different' })).toBe(false);
  });

  test('CLOZE: correct answer display shows all accepted variants from the key', () => {
    const descriptor = {
      id: 'q-words',
      blockId: 'b-words',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'q-words',
      block: {
        id: 'b-words',
        type: 'CLOZE',
        instruction: '',
        answerRule: 'ONE_WORD',
        questions: [{ id: 'q-words', prompt: 'Fill blank', correctAnswer: 'crowd | crowd noise' }],
      },
      question: { id: 'q-words', prompt: 'Fill blank', correctAnswer: 'crowd | crowd noise', answerRule: 'ONE_WORD' },
    } as unknown as StudentQuestionDescriptor;

    expect(getCorrectAnswerDisplay(descriptor)).toBe('crowd | crowd noise');
  });

  test('SINGLE_MCQ: maps option id to option text', () => {
    const descriptor = {
      id: 'block-1',
      blockId: 'block-1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'block-1',
      block: {
        id: 'block-1',
        type: 'SINGLE_MCQ',
        instruction: '',
        stem: 'Choose one',
        options: [
          { id: 'A', text: 'Alpha', isCorrect: true },
          { id: 'B', text: 'Beta', isCorrect: false },
        ],
      },
      question: null,
    } as unknown as StudentQuestionDescriptor;

    expect(getCorrectAnswerDisplay(descriptor)).toBe('Alpha');
    expect(getStudentAnswerDisplay(descriptor, { 'block-1': 'A' })).toBe('Alpha');
    expect(isStudentAnswerCorrect(descriptor, { 'block-1': 'A' })).toBe(true);
  });

  test('SINGLE_MCQ: resolves prompt/options from question-level data when questions[] is present', () => {
    const descriptor = {
      id: 'single-q2',
      blockId: 'block-1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'single-q2',
      block: {
        id: 'block-1',
        type: 'SINGLE_MCQ',
        instruction: '',
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
              { id: 'q1-a', text: 'Q1 A', isCorrect: true },
              { id: 'q1-b', text: 'Q1 B', isCorrect: false },
            ],
          },
          {
            id: 'single-q2',
            stem: 'Question 2',
            options: [
              { id: 'q2-a', text: 'Q2 A', isCorrect: false },
              { id: 'q2-b', text: 'Q2 B', isCorrect: true },
            ],
          },
        ],
      },
      question: {
        id: 'single-q2',
        stem: 'Question 2',
        options: [
          { id: 'q2-a', text: 'Q2 A', isCorrect: false },
          { id: 'q2-b', text: 'Q2 B', isCorrect: true },
        ],
      },
    } as unknown as StudentQuestionDescriptor;

    expect(getQuestionPrompt(descriptor)).toBe('Question 2');
    expect(getCorrectAnswerDisplay(descriptor)).toBe('Q2 B');
    expect(getStudentAnswerDisplay(descriptor, { 'single-q2': 'q2-b' })).toBe('Q2 B');
    expect(isStudentAnswerCorrect(descriptor, { 'single-q2': 'q2-b' })).toBe(true);
  });

  test('MULTI_MCQ: set-compare ignores ordering', () => {
    const descriptor = {
      id: 'block-1',
      blockId: 'block-1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: true,
      correctCount: 2,
      answerKey: 'block-1',
      block: {
        id: 'block-1',
        type: 'MULTI_MCQ',
        instruction: '',
        stem: 'Choose two',
        requiredSelections: 4,
        options: [
          { id: 'A', text: 'Alpha', isCorrect: true },
          { id: 'B', text: 'Beta', isCorrect: false },
          { id: 'C', text: 'Charlie', isCorrect: true },
        ],
      },
      question: null,
    } as unknown as StudentQuestionDescriptor;

    expect(getCorrectAnswerDisplay(descriptor)).toBe('Alpha, Charlie');
    expect(getStudentAnswerDisplay(descriptor, { 'block-1': ['C', 'A'] })).toBe('Charlie, Alpha');
    expect(isStudentAnswerCorrect(descriptor, { 'block-1': ['C', 'A'] })).toBe(true);
  });

  test('MULTI_MCQ: option IDs are compared exactly without answer-text normalization', () => {
    const descriptor = {
      id: 'block-exact-ids',
      blockId: 'block-exact-ids',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: true,
      correctCount: 1,
      answerKey: 'block-exact-ids',
      block: {
        id: 'block-exact-ids',
        type: 'MULTI_MCQ',
        instruction: '',
        stem: 'Choose one',
        requiredSelections: 1,
        options: [
          { id: 'Option-A', text: 'Alpha', isCorrect: true },
          { id: 'Option-B', text: 'Beta', isCorrect: false },
        ],
      },
      question: null,
    } as unknown as StudentQuestionDescriptor;

    expect(isStudentAnswerCorrect(descriptor, { 'block-exact-ids': ['option-a'] })).toBe(false);
    expect(isStudentAnswerCorrect(descriptor, { 'block-exact-ids': ['Option-A'] })).toBe(true);
  });

  test('MULTI_MCQ: awards one point for each selected correct option', () => {
    const descriptor = {
      id: 'block-partial',
      blockId: 'block-partial',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: true,
      correctCount: 5,
      answerKey: 'block-partial',
      block: {
        id: 'block-partial',
        type: 'MULTI_MCQ',
        instruction: '',
        stem: 'Choose five',
        requiredSelections: 1,
        options: [
          { id: 'A', text: 'Alpha', isCorrect: true },
          { id: 'B', text: 'Beta', isCorrect: false },
          { id: 'C', text: 'Charlie', isCorrect: true },
          { id: 'D', text: 'Delta', isCorrect: false },
          { id: 'E', text: 'Echo', isCorrect: true },
          { id: 'F', text: 'Foxtrot', isCorrect: true },
          { id: 'G', text: 'Golf', isCorrect: true },
        ],
      },
      question: null,
    } as unknown as StudentQuestionDescriptor;

    expect(getMultiSelectAnswerScore(descriptor, { 'block-partial': ['C', 'A', 'B', 'A'] })).toEqual({
      awardedScore: 2,
      maxScore: 5,
    });
    expect(isStudentAnswerCorrect(descriptor, { 'block-partial': ['C', 'A'] })).toBe(false);
  });

  test('MULTI_MCQ: an empty answer key never auto-passes an unanswered student', () => {
    const descriptor = {
      id: 'block-empty',
      blockId: 'block-empty',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: true,
      correctCount: 1,
      answerKey: 'block-empty',
      block: {
        id: 'block-empty',
        type: 'MULTI_MCQ',
        instruction: '',
        stem: 'Malformed answer key',
        requiredSelections: 1,
        options: [
          { id: 'A', text: 'Alpha', isCorrect: false },
          { id: 'B', text: 'Beta', isCorrect: false },
        ],
      },
      question: null,
    } as unknown as StudentQuestionDescriptor;

    expect(isStudentAnswerCorrect(descriptor, { 'block-empty': [] })).toBeNull();
  });

  test('SENTENCE_COMPLETION: uses answerIndex to resolve correct blank', () => {
    const descriptor = {
      id: 'q1:blank-1',
      blockId: 'b1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'q1',
      answerIndex: 0,
      block: {
        id: 'b1',
        type: 'SENTENCE_COMPLETION',
        instruction: '',
        questions: [
          {
            id: 'q1',
            sentence: 'It is ____.',
            blanks: [{ id: 'blank-1', correctAnswer: 'late', position: 0 }],
            answerRule: 'ONE_WORD',
          },
        ],
      },
      question: {
        id: 'q1',
        sentence: 'It is ____.',
        blanks: [{ id: 'blank-1', correctAnswer: 'late', position: 0 }],
        answerRule: 'ONE_WORD',
      },
    } as unknown as StudentQuestionDescriptor;

    expect(getCorrectAnswerDisplay(descriptor)).toBe('late');
    expect(getStudentAnswerDisplay(descriptor, { q1: ['late'] })).toBe('late');
    expect(isStudentAnswerCorrect(descriptor, { q1: ['late'] })).toBe(true);
  });

  test('SENTENCE_COMPLETION: supports accepted answer alternatives per blank', () => {
    const descriptor = {
      id: 'q1:blank-1',
      blockId: 'b1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'q1',
      answerIndex: 0,
      block: {
        id: 'b1',
        type: 'SENTENCE_COMPLETION',
        instruction: '',
        questions: [
          {
            id: 'q1',
            sentence: 'It is ____.',
            blanks: [
              { id: 'blank-1', correctAnswer: 'dog', acceptedAnswers: ['dog', 'cat'], position: 0 },
            ],
            answerRule: 'ONE_WORD',
          },
        ],
      },
      question: {
        id: 'q1',
        sentence: 'It is ____.',
        blanks: [{ id: 'blank-1', correctAnswer: 'dog', acceptedAnswers: ['dog', 'cat'], position: 0 }],
        answerRule: 'ONE_WORD',
      },
    } as unknown as StudentQuestionDescriptor;

    expect(getCorrectAnswerDisplay(descriptor)).toBe('dog | cat');
    expect(isStudentAnswerCorrect(descriptor, { q1: ['cat'] })).toBe(true);
  });

  test('NOTE_COMPLETION: supports accepted answer alternatives per blank', () => {
    const descriptor = {
      id: 'n1:blank-1',
      blockId: 'b-note',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'n1',
      answerIndex: 0,
      block: {
        id: 'b-note',
        type: 'NOTE_COMPLETION',
        instruction: '',
        questions: [
          {
            id: 'n1',
            noteText: 'The ____ is useful.',
            blanks: [{ id: 'blank-1', correctAnswer: 'bike', acceptedAnswers: ['bike', 'bicycle'], position: 0 }],
            answerRule: 'ONE_WORD',
          },
        ],
      },
      question: {
        id: 'n1',
        noteText: 'The ____ is useful.',
        blanks: [{ id: 'blank-1', correctAnswer: 'bike', acceptedAnswers: ['bike', 'bicycle'], position: 0 }],
        answerRule: 'ONE_WORD',
      },
    } as unknown as StudentQuestionDescriptor;

    expect(getCorrectAnswerDisplay(descriptor)).toBe('bike | bicycle');
    expect(isStudentAnswerCorrect(descriptor, { n1: ['bicycle'] })).toBe(true);
  });

  test('TABLE_COMPLETION: displays every accepted answer for a cell', () => {
    const descriptor = {
      id: 'table-1:cell-1',
      blockId: 'table-1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'table-1',
      answerIndex: 0,
      block: {
        id: 'table-1',
        type: 'TABLE_COMPLETION',
        instruction: '',
        headers: ['Answer'],
        rows: [['']],
        cells: [{
          id: 'cell-1',
          row: 0,
          col: 0,
          correctAnswer: 'faces of china',
          acceptedAnswers: ['faces of china', 'FACES OF CHINA', 'Faces of China'],
        }],
        answerRule: 'THREE_WORDS',
      },
      question: null,
    } as unknown as StudentQuestionDescriptor;

    expect(getCorrectAnswerDisplay(descriptor)).toBe(
      'faces of china | FACES OF CHINA | Faces of China',
    );
  });

  test('TABLE_COMPLETION: scores from accepted answers when the canonical answer is absent', () => {
    const descriptor = {
      id: 'table-1:cell-1',
      blockId: 'table-1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'table-1',
      answerIndex: 0,
      block: {
        id: 'table-1',
        type: 'TABLE_COMPLETION',
        instruction: '',
        headers: ['Answer'],
        rows: [['']],
        cells: [{
          id: 'cell-1',
          row: 0,
          col: 0,
          correctAnswer: undefined,
          acceptedAnswers: ['GARDEN HALL', 'garden hall', 'Garden Hall', 'Garden hall'],
        }],
        answerRule: 'TWO_WORDS',
      },
      question: null,
    } as unknown as StudentQuestionDescriptor;

    expect(isStudentAnswerCorrect(descriptor, { 'table-1': ['Garden hall'] })).toBe(true);
  });

  test('SHORT_ANSWER: supports accepted answer alternatives', () => {
    const descriptor = {
      id: 'sa-1',
      blockId: 'b-sa',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'sa-1',
      block: {
        id: 'b-sa',
        type: 'SHORT_ANSWER',
        instruction: '',
        questions: [
          {
            id: 'sa-1',
            prompt: 'Name one pet',
            correctAnswer: 'dog',
            acceptedAnswers: ['dog', 'cat'],
            answerRule: 'ONE_WORD',
          },
        ],
      },
      question: {
        id: 'sa-1',
        prompt: 'Name one pet',
        correctAnswer: 'dog',
        acceptedAnswers: ['dog', 'cat'],
        answerRule: 'ONE_WORD',
      },
    } as unknown as StudentQuestionDescriptor;

    expect(getCorrectAnswerDisplay(descriptor)).toBe('dog | cat');
    expect(isStudentAnswerCorrect(descriptor, { 'sa-1': 'cat' })).toBe(true);
  });
});
