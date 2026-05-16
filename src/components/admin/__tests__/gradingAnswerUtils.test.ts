import { describe, expect, test } from 'vitest';
import type {
  StudentQuestionDescriptor,
} from '../../../services/examAdapterService';
import {
  getCorrectAnswerDisplay,
  getQuestionPrompt,
  getStudentAnswerDisplay,
  isStudentAnswerCorrect,
} from '../gradingAnswerUtils';

describe('gradingAnswerUtils', () => {
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

  test('CLOZE: compares case-insensitively for correctness indicator', () => {
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
    expect(isStudentAnswerCorrect(descriptor, { q1: 'Daily' })).toBe(true);
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
    expect(isStudentAnswerCorrect(descriptor, { 'q-alt': 'State of the art' })).toBe(true);
    expect(isStudentAnswerCorrect(descriptor, { 'q-alt': 'advanced' })).toBe(true);
    expect(isStudentAnswerCorrect(descriptor, { 'q-alt': 'different' })).toBe(false);
  });

  test('CLOZE: correct answer display omits variants that exceed the answerRule word limit', () => {
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

    expect(getCorrectAnswerDisplay(descriptor)).toBe('crowd');
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
        requiredSelections: 2,
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
