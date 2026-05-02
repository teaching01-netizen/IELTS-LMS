import { describe, expect, test } from 'vitest';
import type {
  StudentQuestionDescriptor,
} from '../../../services/examAdapterService';
import {
  getCorrectAnswerDisplay,
  getQuestionPrompt,
  projectRawObjectiveAnswer,
  rawSlotValue,
  renderRawMultiSlotAnswer,
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

  test('SINGLE_MCQ: preserves stored option id in student answer display', () => {
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
    expect(getStudentAnswerDisplay(descriptor, { 'block-1': 'A' })).toBe('A');
    expect(isStudentAnswerCorrect(descriptor, { 'block-1': 'A' })).toBe(true);
  });

  test('MULTI_MCQ: set-compare ignores ordering while display preserves raw array projection', () => {
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
    expect(getStudentAnswerDisplay(descriptor, { 'block-1': ['C', 'A'] })).toBe('["C","A"]');
    expect(isStudentAnswerCorrect(descriptor, { 'block-1': ['C', 'A'] })).toBe(true);
  });

  test('MULTI_MCQ: slot descriptors apply partial-credit correctness by answerIndex', () => {
    const firstSlotDescriptor = {
      id: 'block-2:slot:1',
      blockId: 'block-2',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      rootId: 'block-2:slot:1',
      rootNumber: 10,
      numberLabel: '10',
      isMulti: false,
      correctCount: 1,
      answerKey: 'block-2',
      answerIndex: 0,
      block: {
        id: 'block-2',
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

    const secondSlotDescriptor = {
      ...firstSlotDescriptor,
      id: 'block-2:slot:2',
      rootId: 'block-2:slot:2',
      rootNumber: 11,
      numberLabel: '11',
      answerIndex: 1,
    } as unknown as StudentQuestionDescriptor;

    expect(isStudentAnswerCorrect(firstSlotDescriptor, { 'block-2': ['A'] })).toBe(true);
    expect(isStudentAnswerCorrect(secondSlotDescriptor, { 'block-2': ['A'] })).toBe(false);
    expect(isStudentAnswerCorrect(firstSlotDescriptor, { 'block-2': ['A', 'C'] })).toBe(true);
    expect(isStudentAnswerCorrect(secondSlotDescriptor, { 'block-2': ['A', 'C'] })).toBe(true);
    expect(isStudentAnswerCorrect(firstSlotDescriptor, { 'block-2': ['B'] })).toBe(false);
    expect(isStudentAnswerCorrect(secondSlotDescriptor, { 'block-2': ['B'] })).toBe(false);
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

  test('TABLE_COMPLETION: matches accepted alternatives using canonical row-major slot ordering', () => {
    const descriptor = {
      id: 'tbl-1:cell-b',
      blockId: 'tbl-1',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'tbl-1',
      answerIndex: 0,
      block: {
        id: 'tbl-1',
        type: 'TABLE_COMPLETION',
        instruction: 'Complete the table.',
        answerRule: 'ONE_WORD',
        headers: ['Key', 'Value'],
        rows: [
          ['Name', '____'],
          ['Country', '____'],
        ],
        cells: [
          { id: 'cell-country', row: 1, col: 1, correctAnswer: 'India', acceptedAnswers: ['India', 'IND'] },
          { id: 'cell-name', row: 0, col: 1, correctAnswer: 'Anu', acceptedAnswers: ['Anu', 'Anupama'] },
        ],
      },
      question: null,
    } as unknown as StudentQuestionDescriptor;

    expect(getQuestionPrompt(descriptor)).toBe('Table cell row 1, col 2');
    expect(getCorrectAnswerDisplay(descriptor)).toBe('Anu | Anupama');
    expect(isStudentAnswerCorrect(descriptor, { 'tbl-1': ['anupama', 'india'] })).toBe(true);
  });

  test('raw slot fidelity: preserves scalar string exactly and maps nullish to empty', () => {
    expect(rawSlotValue(' answer ')).toBe(' answer ');
    expect(rawSlotValue('\nline\n')).toBe('\nline\n');
    expect(rawSlotValue(null)).toBe('');
    expect(rawSlotValue(undefined)).toBe('');
  });

  test('raw slot fidelity: preserves multi-slot order, empties, whitespace, punctuation, and symbols', () => {
    const fixtures: string[][] = [
      ['A', 'B', 'C'],
      [' A ', 'B\nB', 'C\tC'],
      ['A', '', 'C'],
      ['', '', ''],
      ['A,', 'B|B', '[C]'],
      ['0', 'false', 'null'],
      [' A\n', '\tB ', ' C  '],
    ];

    fixtures.forEach((fixture) => {
      expect(renderRawMultiSlotAnswer(fixture)).toEqual(fixture);
    });
  });

  test('raw slot fidelity: preserves empty intermediate slots without filter(Boolean) loss', () => {
    const projected = projectRawObjectiveAnswer(['first', '', 'third']);
    expect(projected.slots).toEqual(['first', '', 'third']);
    expect(projected.canonical).toBe('["first","","third"]');
  });

  test('raw slot fidelity: null and undefined slots become empty strings', () => {
    const projected = projectRawObjectiveAnswer(['A', null, undefined, 'D']);
    expect(projected.slots).toEqual(['A', '', '', 'D']);
  });

  test('raw slot fidelity: comma-containing slot values are not flattened with join', () => {
    const projected = projectRawObjectiveAnswer(['hello, world', 'x', 'y']);
    expect(projected.canonical).not.toBe('hello, world, x, y');
    expect(projected.slots).toEqual(['hello, world', 'x', 'y']);
  });

  test('sub-answer tree leaf descriptors resolve prompt and accepted answers', () => {
    const descriptor = {
      id: 'tree-block::tree::root-a::leaf-a',
      blockId: 'tree-block',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      rootId: 'tree-block::tree::root::root-a',
      rootNumber: 21,
      numberLabel: '21.1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'tree-block::tree::root-a::leaf-a',
      isSubAnswerTreeLeaf: true,
      treePrompt: 'Leaf prompt',
      treeAcceptedAnswers: ['cat', 'kitty'],
      block: {
        id: 'tree-block',
        type: 'SHORT_ANSWER',
        instruction: '',
        questions: [],
      },
      question: null,
    } as unknown as StudentQuestionDescriptor;

    expect(getQuestionPrompt(descriptor)).toBe('Leaf prompt');
    expect(getCorrectAnswerDisplay(descriptor)).toBe('cat | kitty');
    expect(isStudentAnswerCorrect(descriptor, { [descriptor.id]: 'Kitty' })).toBe(true);
  });

  test('sub-answer tree grading prompt falls back to question number, not node id', () => {
    const descriptor = {
      id: 'tree-block::tree::root-a::legacy-node-id',
      blockId: 'tree-block',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      rootId: 'tree-block::tree::root::root-a',
      rootNumber: 21,
      numberLabel: '21.1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'tree-block::tree::root-a::legacy-node-id',
      isSubAnswerTreeLeaf: true,
      treePrompt: '   ',
      treeAcceptedAnswers: ['cat'],
      block: {
        id: 'tree-block',
        type: 'SHORT_ANSWER',
        instruction: '',
        questions: [],
      },
      question: null,
    } as unknown as StudentQuestionDescriptor;

    expect(getQuestionPrompt(descriptor)).toBe('21.1');
  });
});
