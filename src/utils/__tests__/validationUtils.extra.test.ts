import { describe, expect, it } from 'vitest';
import { validateQuestionBlock } from '../validationUtils';

const fields = (errors: { field: string }[]) => errors.map((e) => e.field);
const hasField = (errors: { field: string }[], field: string) =>
  errors.some((e) => e.field === field);
const hasFieldContaining = (errors: { field: string }[], part: string) =>
  errors.some((e) => e.field.includes(part));

describe('extra - SINGLE_MCQ legacy shape (no questions list)', () => {
  const twoOptions = (a: string, b: string, correctIndex: number) => [
    { id: 'o-1', text: a, isCorrect: correctIndex === 0 },
    { id: 'o-2', text: b, isCorrect: correctIndex === 1 },
  ];

  it('flags a missing stem', () => {
    const errors = validateQuestionBlock({
      id: 'mcq-legacy-1',
      type: 'SINGLE_MCQ',
      instruction: 'Pick one.',
      stem: '   ',
      options: twoOptions('A', 'B', 0),
    });
    expect(hasField(errors, 'stem')).toBe(true);
    expect(errors.find((e) => e.field === 'stem')?.message).toMatch(/stem is required/);
  });

  it('flags fewer than 2 options', () => {
    const errors = validateQuestionBlock({
      id: 'mcq-legacy-2',
      type: 'SINGLE_MCQ',
      instruction: 'Pick one.',
      stem: 'Question?',
      options: [{ id: 'o-1', text: 'Only', isCorrect: true }],
    });
    expect(hasField(errors, 'options')).toBe(true);
    expect(errors.find((e) => e.field === 'options')?.message).toMatch(/at least 2 options/);
  });

  it('flags zero correct options', () => {
    const errors = validateQuestionBlock({
      id: 'mcq-legacy-3',
      type: 'SINGLE_MCQ',
      instruction: 'Pick one.',
      stem: 'Question?',
      options: [
        { id: 'o-1', text: 'A', isCorrect: false },
        { id: 'o-2', text: 'B', isCorrect: false },
      ],
    });
    expect(errors.find((e) => e.field === 'options')?.message).toMatch(/exactly one correct/);
  });

  it('flags more than one correct option', () => {
    const errors = validateQuestionBlock({
      id: 'mcq-legacy-4',
      type: 'SINGLE_MCQ',
      instruction: 'Pick one.',
      stem: 'Question?',
      options: [
        { id: 'o-1', text: 'A', isCorrect: true },
        { id: 'o-2', text: 'B', isCorrect: true },
      ],
    });
    expect(errors.find((e) => e.field === 'options')?.message).toMatch(/exactly one correct/);
  });

  it('flags empty option text with legacy option-N field', () => {
    const errors = validateQuestionBlock({
      id: 'mcq-legacy-5',
      type: 'SINGLE_MCQ',
      instruction: 'Pick one.',
      stem: 'Question?',
      options: [
        { id: 'o-1', text: '  ', isCorrect: true },
        { id: 'o-2', text: 'B', isCorrect: false },
      ],
    });
    expect(hasField(errors, 'option-0')).toBe(true);
  });

  it('accepts a valid legacy block', () => {
    const errors = validateQuestionBlock({
      id: 'mcq-legacy-6',
      type: 'SINGLE_MCQ',
      instruction: 'Pick one.',
      stem: 'Question?',
      options: twoOptions('A', 'B', 1),
    });
    expect(errors).toEqual([]);
  });
});

describe('extra - SINGLE_MCQ questions-list shape', () => {
  const goodOptions = [
    { id: 'o-1', text: 'A', isCorrect: true },
    { id: 'o-2', text: 'B', isCorrect: false },
  ];

  it('flags a missing stem on the listed question', () => {
    const errors = validateQuestionBlock({
      id: 'mcq-list-1',
      type: 'SINGLE_MCQ',
      instruction: 'Pick one.',
      stem: 'Ignored fallback',
      options: goodOptions,
      questions: [{ id: 'q-1', stem: '', options: goodOptions }],
    });
    expect(hasField(errors, 'questions[0].stem')).toBe(true);
  });

  it('flags too few options on the listed question', () => {
    const errors = validateQuestionBlock({
      id: 'mcq-list-2',
      type: 'SINGLE_MCQ',
      instruction: 'Pick one.',
      stem: 'Fallback',
      options: goodOptions,
      questions: [
        { id: 'q-1', stem: 'Q1', options: [{ id: 'o-1', text: 'Only', isCorrect: true }] },
      ],
    });
    expect(errors.find((e) => e.field === 'questions[0].options')?.message).toMatch(
      /at least 2 options/,
    );
  });

  it('flags wrong correct-option count on the listed question', () => {
    const errors = validateQuestionBlock({
      id: 'mcq-list-3',
      type: 'SINGLE_MCQ',
      instruction: 'Pick one.',
      stem: 'Fallback',
      options: goodOptions,
      questions: [
        {
          id: 'q-1',
          stem: 'Q1',
          options: [
            { id: 'o-1', text: 'A', isCorrect: false },
            { id: 'o-2', text: 'B', isCorrect: false },
          ],
        },
      ],
    });
    expect(errors.find((e) => e.field === 'questions[0].options')?.message).toMatch(
      /exactly one correct/,
    );
  });

  it('flags empty option text with the listed field path', () => {
    const errors = validateQuestionBlock({
      id: 'mcq-list-4',
      type: 'SINGLE_MCQ',
      instruction: 'Pick one.',
      stem: 'Fallback',
      options: goodOptions,
      questions: [
        {
          id: 'q-1',
          stem: 'Q1',
          options: [
            { id: 'o-1', text: 'A', isCorrect: true },
            { id: 'o-2', text: '   ', isCorrect: false },
          ],
        },
      ],
    });
    expect(hasField(errors, 'questions[0].options[1].text')).toBe(true);
  });

  it('accepts a valid questions-list block', () => {
    const errors = validateQuestionBlock({
      id: 'mcq-list-5',
      type: 'SINGLE_MCQ',
      instruction: 'Pick one.',
      stem: 'Fallback',
      options: goodOptions,
      questions: [
        { id: 'q-1', stem: 'Q1', options: goodOptions },
        {
          id: 'q-2',
          stem: 'Q2',
          options: [
            { id: 'o-1', text: 'C', isCorrect: false },
            { id: 'o-2', text: 'D', isCorrect: true },
          ],
        },
      ],
    });
    expect(errors).toEqual([]);
  });
});

describe('extra - SHORT_ANSWER core errors', () => {
  it('flags an empty questions array', () => {
    const errors = validateQuestionBlock({
      id: 'sa-1',
      type: 'SHORT_ANSWER',
      instruction: 'Answer.',
      questions: [],
    });
    expect(hasField(errors, 'questions')).toBe(true);
  });

  it('flags a missing prompt', () => {
    const errors = validateQuestionBlock({
      id: 'sa-2',
      type: 'SHORT_ANSWER',
      instruction: 'Answer.',
      questions: [{ id: 'q-1', prompt: '  ', correctAnswer: 'dog', answerRule: 'ONE_WORD' }],
    });
    expect(hasField(errors, 'question-0-prompt')).toBe(true);
  });

  it('flags a missing answer when no alternatives exist', () => {
    const errors = validateQuestionBlock({
      id: 'sa-3',
      type: 'SHORT_ANSWER',
      instruction: 'Answer.',
      questions: [{ id: 'q-1', prompt: 'Name a pet.', correctAnswer: '  ', answerRule: 'ONE_WORD' }],
    });
    expect(hasField(errors, 'question-0-answer')).toBe(true);
  });
});

describe('extra - SENTENCE_COMPLETION core errors', () => {
  it('flags an empty questions array', () => {
    const errors = validateQuestionBlock({
      id: 'sc-1',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [],
    });
    expect(hasField(errors, 'questions')).toBe(true);
  });

  it('flags empty sentence text', () => {
    const errors = validateQuestionBlock({
      id: 'sc-2',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [{ id: 'q-1', sentence: '   ', blanks: [], answerRule: 'ONE_WORD' }],
    });
    expect(hasField(errors, 'sentence-0')).toBe(true);
    expect(hasField(errors, 'sentence-0-blanks')).toBe(true);
  });

  it('flags a sentence with zero placeholders', () => {
    const errors = validateQuestionBlock({
      id: 'sc-3',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [{ id: 'q-1', sentence: 'No blanks here.', blanks: [], answerRule: 'ONE_WORD' }],
    });
    expect(errors.find((e) => e.field === 'sentence-0-blanks')?.message).toMatch(
      /at least one blank placeholder/,
    );
  });

  it('flags a blank with no answer when placeholder counts match', () => {
    const errors = validateQuestionBlock({
      id: 'sc-4',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [
        {
          id: 'q-1',
          sentence: 'My favourite animal is ____.',
          blanks: [{ id: 'b-1', correctAnswer: '', position: 0 }],
          answerRule: 'ONE_WORD',
        },
      ],
    });
    expect(hasField(errors, 'sentence-0-blank-0')).toBe(true);
    expect(hasField(errors, 'sentence-0-blanks')).toBe(false);
  });
});

describe('extra - SENTENCE_COMPLETION grouped slot scoring', () => {
  const sentence = 'The ____ is ____.';
  const blank = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    correctAnswer: id === 'b-1' ? 'sun' : 'moon',
    position: id === 'b-1' ? 0 : 1,
    ...extra,
  });

  it('rejects a negative score weight', () => {
    const errors = validateQuestionBlock({
      id: 'sc-g-1',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [
        {
          id: 'q-1',
          sentence,
          blanks: [blank('b-1', { scoreGroupId: 'g1', scoreWeight: -1 }), blank('b-2', { scoreGroupId: 'g1' })],
          answerRule: 'ONE_WORD',
        },
      ],
    });
    expect(hasField(errors, 'sentence-0-0-score-weight')).toBe(true);
  });

  it('rejects a non-finite score weight', () => {
    const errors = validateQuestionBlock({
      id: 'sc-g-2',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [
        {
          id: 'q-1',
          sentence,
          blanks: [blank('b-1', { scoreGroupId: 'g1', scoreWeight: NaN }), blank('b-2', { scoreGroupId: 'g1' })],
          answerRule: 'ONE_WORD',
        },
      ],
    });
    expect(hasField(errors, 'sentence-0-0-score-weight')).toBe(true);
  });

  it('rejects inconsistent group rules within one group', () => {
    const errors = validateQuestionBlock({
      id: 'sc-g-3',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [
        {
          id: 'q-1',
          sentence,
          blanks: [
            blank('b-1', { scoreGroupId: 'g2', groupRule: 'at_least_n', requiredCorrect: 1 }),
            blank('b-2', { scoreGroupId: 'g2', groupRule: 'all_required' }),
          ],
          answerRule: 'ONE_WORD',
        },
      ],
    });
    expect(hasField(errors, 'sentence-0-group-g2-rule')).toBe(true);
  });

  it('rejects inconsistent requiredCorrect within one group', () => {
    const errors = validateQuestionBlock({
      id: 'sc-g-4',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [
        {
          id: 'q-1',
          sentence,
          blanks: [
            blank('b-1', { scoreGroupId: 'g3', groupRule: 'at_least_n', requiredCorrect: 1 }),
            blank('b-2', { scoreGroupId: 'g3', groupRule: 'at_least_n', requiredCorrect: 2 }),
          ],
          answerRule: 'ONE_WORD',
        },
      ],
    });
    expect(
      errors.find((e) => e.field === 'sentence-0-group-g3-required')?.message,
    ).toMatch(/one consistent required-correct/);
  });

  it('rejects at_least_n with no requiredCorrect', () => {
    const errors = validateQuestionBlock({
      id: 'sc-g-5',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [
        {
          id: 'q-1',
          sentence,
          blanks: [
            blank('b-1', { scoreGroupId: 'g4', groupRule: 'at_least_n' }),
            blank('b-2', { scoreGroupId: 'g4', groupRule: 'at_least_n' }),
          ],
          answerRule: 'ONE_WORD',
        },
      ],
    });
    expect(
      errors.find((e) => e.field === 'sentence-0-group-g4-required')?.message,
    ).toMatch(/integer >= 1/);
  });

  it('rejects requiredCorrect of zero and non-integers', () => {
    for (const requiredCorrect of [0, 1.5]) {
      const errors = validateQuestionBlock({
        id: `sc-g-zero-${String(requiredCorrect)}`,
        type: 'SENTENCE_COMPLETION',
        instruction: 'Complete.',
        questions: [
          {
            id: 'q-1',
            sentence,
            blanks: [
              blank('b-1', { scoreGroupId: 'g5', groupRule: 'at_least_n', requiredCorrect }),
              blank('b-2', { scoreGroupId: 'g5', groupRule: 'at_least_n', requiredCorrect }),
            ],
            answerRule: 'ONE_WORD',
          },
        ],
      });
      expect(hasField(errors, 'sentence-0-group-g5-required')).toBe(true);
    }
  });

  it('rejects requiredCorrect larger than the slot count', () => {
    const errors = validateQuestionBlock({
      id: 'sc-g-6',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [
        {
          id: 'q-1',
          sentence,
          blanks: [
            blank('b-1', { scoreGroupId: 'g6', groupRule: 'at_least_n', requiredCorrect: 3 }),
            blank('b-2', { scoreGroupId: 'g6', groupRule: 'at_least_n', requiredCorrect: 3 }),
          ],
          answerRule: 'ONE_WORD',
        },
      ],
    });
    expect(
      errors.find((e) => e.field === 'sentence-0-group-g6-required')?.message,
    ).toMatch(/only 2 slot/);
  });

  it('accepts all_required groups without requiredCorrect', () => {
    const errors = validateQuestionBlock({
      id: 'sc-g-7',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [
        {
          id: 'q-1',
          sentence,
          blanks: [
            blank('b-1', { scoreGroupId: 'g7', groupRule: 'all_required', scoreWeight: 1 }),
            blank('b-2', { scoreGroupId: 'g7', groupRule: 'all_required', scoreWeight: 2 }),
          ],
          answerRule: 'ONE_WORD',
        },
      ],
    });
    expect(hasFieldContaining(errors, 'group-g7')).toBe(false);
  });
});

describe('extra - DIAGRAM_LABELING', () => {
  const label = (answer: string) => ({ id: 'l-1', x: 10, y: 20, correctAnswer: answer });

  it('flags a missing image URL', () => {
    const errors = validateQuestionBlock({
      id: 'dg-1',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label.',
      imageUrl: '',
      labels: [label('heart')],
    });
    expect(hasField(errors, 'imageUrl')).toBe(true);
  });

  it('flags a whitespace-only image URL', () => {
    const errors = validateQuestionBlock({
      id: 'dg-2',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label.',
      imageUrl: '   ',
      labels: [label('heart')],
    });
    expect(hasField(errors, 'imageUrl')).toBe(true);
  });

  it('flags an empty labels array', () => {
    const errors = validateQuestionBlock({
      id: 'dg-3',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label.',
      imageUrl: 'https://example.com/d.png',
      labels: [],
    });
    expect(hasField(errors, 'labels')).toBe(true);
  });

  it('flags a label with no answer', () => {
    const errors = validateQuestionBlock({
      id: 'dg-4',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label.',
      imageUrl: 'https://example.com/d.png',
      labels: [label('  ')],
    });
    expect(hasField(errors, 'label-0')).toBe(true);
  });

  it('accepts a valid block and ignores inserted-image slots (unsupported type)', () => {
    const errors = validateQuestionBlock({
      id: 'dg-5',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label.',
      imageUrl: 'https://example.com/d.png',
      insertedImages: [{ id: 'img-1', url: '' }],
      labels: [label('heart')],
    });
    expect(errors).toEqual([]);
  });
});

describe('extra - FLOW_CHART', () => {
  it('flags an empty steps array', () => {
    const errors = validateQuestionBlock({
      id: 'fc-1',
      type: 'FLOW_CHART',
      instruction: 'Complete the chart.',
      steps: [],
    });
    expect(hasField(errors, 'steps')).toBe(true);
  });

  it('flags a step with no label', () => {
    const errors = validateQuestionBlock({
      id: 'fc-2',
      type: 'FLOW_CHART',
      instruction: 'Complete the chart.',
      steps: [{ id: 's-1', label: '  ', correctAnswer: 'filter' }],
    });
    expect(hasField(errors, 'step-0')).toBe(true);
  });

  it('flags a step with no answer', () => {
    const errors = validateQuestionBlock({
      id: 'fc-3',
      type: 'FLOW_CHART',
      instruction: 'Complete the chart.',
      steps: [{ id: 's-1', label: 'Boil', correctAnswer: '' }],
    });
    expect(hasField(errors, 'step-0-answer')).toBe(true);
  });

  it('accepts a valid block', () => {
    const errors = validateQuestionBlock({
      id: 'fc-4',
      type: 'FLOW_CHART',
      instruction: 'Complete the chart.',
      steps: [{ id: 's-1', label: 'Boil', correctAnswer: 'filter' }],
    });
    expect(errors).toEqual([]);
  });
});

describe('extra - TABLE_COMPLETION core errors', () => {
  it('flags fewer than 2 headers', () => {
    const errors = validateQuestionBlock({
      id: 'tc-1',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      answerRule: 'ONE_WORD',
      headers: ['Only'],
      rows: [['x']],
      cells: [],
    });
    expect(hasField(errors, 'headers')).toBe(true);
  });

  it('flags an empty rows array', () => {
    const errors = validateQuestionBlock({
      id: 'tc-2',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      answerRule: 'ONE_WORD',
      headers: ['Key', 'Value'],
      rows: [],
      cells: [],
    });
    expect(hasField(errors, 'rows')).toBe(true);
    expect(hasField(errors, 'rows-placeholders')).toBe(true);
  });

  it('flags an empty header cell', () => {
    const errors = validateQuestionBlock({
      id: 'tc-3',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      answerRule: 'ONE_WORD',
      headers: ['Key', '   '],
      rows: [['Name', '____']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: 'Anu' }],
    });
    expect(hasField(errors, 'header-1')).toBe(true);
  });

  it('flags cells-mismatch when cells exist but no placeholders do', () => {
    const errors = validateQuestionBlock({
      id: 'tc-4',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      answerRule: 'ONE_WORD',
      headers: ['Key', 'Value'],
      rows: [['Name', 'Anu']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: 'Anu' }],
    });
    expect(hasField(errors, 'rows-placeholders')).toBe(true);
    expect(hasField(errors, 'cells-mismatch')).toBe(true);
  });

  it('flags a table cell with no answer', () => {
    const errors = validateQuestionBlock({
      id: 'tc-5',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      answerRule: 'ONE_WORD',
      headers: ['Key', 'Value'],
      rows: [['Name', '____']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: '' }],
    });
    expect(hasField(errors, 'cell-0')).toBe(true);
  });

  it('accepts a valid table', () => {
    const errors = validateQuestionBlock({
      id: 'tc-6',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      answerRule: 'ONE_WORD',
      headers: ['Key', 'Value'],
      rows: [['Name', '____']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: 'Anu' }],
    });
    expect(errors).toEqual([]);
  });
});

describe('extra - TABLE_COMPLETION grouped slot scoring', () => {
  const twoSlotTable = (cellExtra1: Record<string, unknown>, cellExtra2: Record<string, unknown>) => ({
    id: 'tc-g',
    type: 'TABLE_COMPLETION' as const,
    instruction: 'Complete the table.',
    answerRule: 'ONE_WORD' as const,
    headers: ['Key', 'Value'],
    rows: [
      ['Name', '____'],
      ['Country', '____'],
    ],
    cells: [
      { id: 'cell-1', row: 0, col: 1, correctAnswer: 'Anu', ...cellExtra1 },
      { id: 'cell-2', row: 1, col: 1, correctAnswer: 'India', ...cellExtra2 },
    ],
  });

  it('rejects a negative cell score weight', () => {
    const errors = validateQuestionBlock(
      twoSlotTable({ scoreGroupId: 't1', scoreWeight: -2 }, { scoreGroupId: 't1' }),
    );
    expect(hasField(errors, 'table-cells-0-score-weight')).toBe(true);
  });

  it('rejects inconsistent cell group rules', () => {
    const errors = validateQuestionBlock(
      twoSlotTable(
        { scoreGroupId: 't2', groupRule: 'at_least_n', requiredCorrect: 1 },
        { scoreGroupId: 't2', groupRule: 'all_required' },
      ),
    );
    expect(hasField(errors, 'table-cells-group-t2-rule')).toBe(true);
  });
});

describe('extra - NOTE_COMPLETION core errors', () => {
  it('flags an empty questions array', () => {
    const errors = validateQuestionBlock({
      id: 'nc-1',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete the notes.',
      questions: [],
    });
    expect(hasField(errors, 'questions')).toBe(true);
  });

  it('flags empty note text', () => {
    const errors = validateQuestionBlock({
      id: 'nc-2',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete the notes.',
      questions: [{ id: 'q-1', noteText: '  ', blanks: [], answerRule: 'ONE_WORD' }],
    });
    expect(hasField(errors, 'note-0')).toBe(true);
  });

  it('flags notes with zero placeholders', () => {
    const errors = validateQuestionBlock({
      id: 'nc-3',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete the notes.',
      questions: [{ id: 'q-1', noteText: 'No blanks here.', blanks: [], answerRule: 'ONE_WORD' }],
    });
    expect(errors.find((e) => e.field === 'note-0-blanks')?.message).toMatch(
      /at least one blank placeholder/,
    );
  });

  it('flags a blank with no answer', () => {
    const errors = validateQuestionBlock({
      id: 'nc-4',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete the notes.',
      questions: [
        {
          id: 'q-1',
          noteText: 'Bring your ____.',
          blanks: [{ id: 'b-1', correctAnswer: '', position: 0 }],
          answerRule: 'ONE_WORD',
        },
      ],
    });
    expect(hasField(errors, 'note-0-blank-0')).toBe(true);
  });

  it('accepts a valid block', () => {
    const errors = validateQuestionBlock({
      id: 'nc-5',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete the notes.',
      questions: [
        {
          id: 'q-1',
          noteText: 'Bring your ____.',
          blanks: [{ id: 'b-1', correctAnswer: 'ticket', position: 0 }],
          answerRule: 'ONE_WORD',
        },
      ],
    });
    expect(errors).toEqual([]);
  });
});

describe('extra - CLASSIFICATION', () => {
  it('flags fewer than 2 categories', () => {
    const errors = validateQuestionBlock({
      id: 'cl-1',
      type: 'CLASSIFICATION',
      instruction: 'Classify.',
      categories: ['Only'],
      items: [{ id: 'i-1', text: 'X', correctCategory: 'Only' }],
    });
    expect(hasField(errors, 'categories')).toBe(true);
  });

  it('flags an empty items array', () => {
    const errors = validateQuestionBlock({
      id: 'cl-2',
      type: 'CLASSIFICATION',
      instruction: 'Classify.',
      categories: ['A', 'B'],
      items: [],
    });
    expect(hasField(errors, 'items')).toBe(true);
  });

  it('flags an empty category', () => {
    const errors = validateQuestionBlock({
      id: 'cl-3',
      type: 'CLASSIFICATION',
      instruction: 'Classify.',
      categories: ['A', '   '],
      items: [{ id: 'i-1', text: 'X', correctCategory: 'A' }],
    });
    expect(hasField(errors, 'category-1')).toBe(true);
  });

  it('flags an item with no text', () => {
    const errors = validateQuestionBlock({
      id: 'cl-4',
      type: 'CLASSIFICATION',
      instruction: 'Classify.',
      categories: ['A', 'B'],
      items: [{ id: 'i-1', text: '  ', correctCategory: 'A' }],
    });
    expect(hasField(errors, 'item-0')).toBe(true);
  });

  it('flags an item assigned to an unknown category', () => {
    const errors = validateQuestionBlock({
      id: 'cl-5',
      type: 'CLASSIFICATION',
      instruction: 'Classify.',
      categories: ['A', 'B'],
      items: [{ id: 'i-1', text: 'X', correctCategory: 'Z' }],
    });
    expect(hasField(errors, 'item-0-category')).toBe(true);
  });

  it('accepts a valid block', () => {
    const errors = validateQuestionBlock({
      id: 'cl-6',
      type: 'CLASSIFICATION',
      instruction: 'Classify.',
      categories: ['A', 'B'],
      items: [{ id: 'i-1', text: 'X', correctCategory: 'A' }],
    });
    expect(errors).toEqual([]);
  });
});

describe('extra - MATCHING_FEATURES', () => {
  it('flags an empty features array', () => {
    const errors = validateQuestionBlock({
      id: 'mf-1',
      type: 'MATCHING_FEATURES',
      instruction: 'Match.',
      features: [],
      options: ['O1', 'O2'],
    });
    expect(hasField(errors, 'features')).toBe(true);
  });

  it('flags fewer than 2 options', () => {
    const errors = validateQuestionBlock({
      id: 'mf-2',
      type: 'MATCHING_FEATURES',
      instruction: 'Match.',
      features: [{ id: 'f-1', text: 'F', correctMatch: 'O1' }],
      options: ['O1'],
    });
    expect(hasField(errors, 'options')).toBe(true);
  });

  it('flags a feature with no text', () => {
    const errors = validateQuestionBlock({
      id: 'mf-3',
      type: 'MATCHING_FEATURES',
      instruction: 'Match.',
      features: [{ id: 'f-1', text: '   ', correctMatch: 'O1' }],
      options: ['O1', 'O2'],
    });
    expect(hasField(errors, 'feature-0')).toBe(true);
  });

  it('flags a feature matched to an unknown option', () => {
    const errors = validateQuestionBlock({
      id: 'mf-4',
      type: 'MATCHING_FEATURES',
      instruction: 'Match.',
      features: [{ id: 'f-1', text: 'F', correctMatch: 'Nope' }],
      options: ['O1', 'O2'],
    });
    expect(hasField(errors, 'feature-0-match')).toBe(true);
  });

  it('flags an empty option', () => {
    const errors = validateQuestionBlock({
      id: 'mf-5',
      type: 'MATCHING_FEATURES',
      instruction: 'Match.',
      features: [{ id: 'f-1', text: 'F', correctMatch: 'O1' }],
      options: ['O1', '   '],
    });
    expect(hasField(errors, 'option-1')).toBe(true);
  });

  it('accepts a valid block', () => {
    const errors = validateQuestionBlock({
      id: 'mf-6',
      type: 'MATCHING_FEATURES',
      instruction: 'Match.',
      features: [{ id: 'f-1', text: 'F', correctMatch: 'O1' }],
      options: ['O1', 'O2'],
    });
    expect(errors).toEqual([]);
  });
});

describe('extra - legacy passthrough types', () => {
  it('returns no errors for TFNG/CLOZE/MATCHING/MAP/MULTI_MCQ bodies', () => {
    const blocks = [
      {
        id: 'pt-1',
        type: 'TFNG',
        instruction: 'TFNG.',
        mode: 'TFNG',
        questions: [{ id: 'q-1', statement: 'S', correctAnswer: 'T' }],
      },
      {
        id: 'pt-2',
        type: 'CLOZE',
        instruction: 'Cloze.',
        answerRule: 'ONE_WORD',
        questions: [{ id: 'q-1', prompt: 'P', correctAnswer: 'a' }],
      },
      {
        id: 'pt-3',
        type: 'MATCHING',
        instruction: 'Match.',
        headings: [{ id: 'h-1', text: 'H' }],
        questions: [{ id: 'q-1', paragraphLabel: 'A', correctHeading: 'H' }],
      },
      {
        id: 'pt-4',
        type: 'MAP',
        instruction: 'Map.',
        assetUrl: 'https://example.com/map.png',
        questions: [{ id: 'q-1', label: 'A', correctAnswer: 'hall', x: 1, y: 2 }],
      },
      {
        id: 'pt-5',
        type: 'MULTI_MCQ',
        instruction: 'Pick two.',
        stem: 'Q?',
        requiredSelections: 2,
        options: [
          { id: 'o-1', text: 'A', isCorrect: true },
          { id: 'o-2', text: 'B', isCorrect: true },
        ],
      },
    ] as const;

    for (const block of blocks) {
      expect(validateQuestionBlock(block as never)).toEqual([]);
    }
  });
});

describe('extra - inserted images and sub-answer tree early return', () => {
  it('flags a whitespace-only image URL on a supported type', () => {
    const errors = validateQuestionBlock({
      id: 'img-1',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      answerRule: 'ONE_WORD',
      headers: ['Key', 'Value'],
      rows: [['Name', '____']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: 'Anu' }],
      insertedImages: [{ id: 'img-1', url: '   ' }],
    });
    expect(errors).toEqual([
      { field: 'insertedImages[0].url', message: 'Inserted image 1 URL is required' },
    ]);
  });

  it('skips legacy per-type checks once sub-answer tree mode is active', () => {
    const errors = validateQuestionBlock({
      id: 'tree-early-1',
      type: 'SHORT_ANSWER',
      instruction: 'Tree mode',
      // Legacy validation would flag this empty list, but tree mode returns early.
      questions: [],
      subAnswerModeEnabled: true,
      answerTree: [
        {
          id: 'root-1',
          label: 'Root',
          children: [{ id: 'leaf-1', label: 'Leaf', acceptedAnswers: ['a'], required: true }],
        },
      ],
    } as never);
    expect(fields(errors)).not.toContain('questions');
    expect(errors).toEqual([]);
  });

  it('still reports inserted-image errors in tree mode without legacy errors', () => {
    const errors = validateQuestionBlock({
      id: 'tree-early-2',
      type: 'SHORT_ANSWER',
      instruction: 'Tree mode',
      questions: [],
      insertedImages: [{ id: 'img-1', url: '' }],
      subAnswerModeEnabled: true,
      answerTree: [
        {
          id: 'root-1',
          label: 'Root',
          children: [{ id: 'leaf-1', label: 'Leaf', acceptedAnswers: ['a'], required: true }],
        },
      ],
    } as never);
    expect(hasField(errors, 'insertedImages[0].url')).toBe(true);
    expect(fields(errors)).not.toContain('questions');
  });
});
