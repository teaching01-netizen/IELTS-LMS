import { describe, expect, test } from 'vitest';
import type { StudentQuestionDescriptor } from '../../../services/examAdapterService';
import { getCorrectAnswerDisplay } from '../gradingAnswerUtils';

function descriptor(
  block: Record<string, unknown>,
  question: Record<string, unknown> | null,
  answerIndex: number | undefined,
): StudentQuestionDescriptor {
  return {
    id: `${String(block.id)}:${String(question?.id ?? answerIndex ?? 'slot')}`,
    blockId: String(block.id),
    groupId: 'passage-1',
    groupLabel: 'Passage 1',
    isMulti: false,
    correctCount: 1,
    answerKey: String(question?.id ?? block.id),
    answerIndex,
    block,
    question,
  } as unknown as StudentQuestionDescriptor;
}

describe('displayed answer key equals the effective grading keys', () => {
  test('diagram labels show the primary then every accepted variant', () => {
    const display = getCorrectAnswerDisplay(descriptor(
      {
        id: 'diagram-1',
        type: 'DIAGRAM_LABELING',
        instruction: '',
        labels: [{ id: 'l1', x: 0, y: 0, correctAnswer: 'main gate', acceptedAnswers: ['gate', 'entrance'] }],
      },
      null,
      0,
    ));
    expect(display).toBe('main gate | gate | entrance');
  });

  test('flow chart steps show the primary then every accepted variant', () => {
    const display = getCorrectAnswerDisplay(descriptor(
      {
        id: 'flow-1',
        type: 'FLOW_CHART',
        instruction: '',
        steps: [{ id: 's1', label: 'Step', correctAnswer: 'mix', acceptedAnswers: ['combine'] }],
      },
      null,
      0,
    ));
    expect(display).toBe('mix | combine');
  });

  test('classification items show the selected category then alternatives', () => {
    const display = getCorrectAnswerDisplay(descriptor(
      {
        id: 'class-1',
        type: 'CLASSIFICATION',
        instruction: '',
        categories: ['A', 'B'],
        items: [{ id: 'i1', text: 'Item', correctCategory: 'A', acceptedAnswers: ['Alpha'] }],
      },
      null,
      0,
    ));
    expect(display).toBe('A | Alpha');
  });

  test('matching features show the selected match then alternatives', () => {
    const display = getCorrectAnswerDisplay(descriptor(
      {
        id: 'features-1',
        type: 'MATCHING_FEATURES',
        instruction: '',
        options: ['X', 'Y'],
        features: [{ id: 'f1', text: 'Feature', correctMatch: 'X', acceptedAnswers: ['Option X'] }],
      },
      null,
      0,
    ));
    expect(display).toBe('X | Option X');
  });

  test('map answers are primary-wins, matching the grading order', () => {
    const withPrimary = getCorrectAnswerDisplay(descriptor(
      { id: 'map-1', type: 'MAP', instruction: '' },
      { id: 'q1', label: 'Map', x: 0, y: 0, correctAnswer: 'north gate', acceptedAnswers: ['north entrance'] },
      undefined,
    ));
    expect(withPrimary).toBe('north gate');

    const withoutPrimary = getCorrectAnswerDisplay(descriptor(
      { id: 'map-1', type: 'MAP', instruction: '' },
      { id: 'q1', label: 'Map', x: 0, y: 0, correctAnswer: '', acceptedAnswers: ['north entrance', 'north exit'] },
      undefined,
    ));
    expect(withoutPrimary).toBe('north entrance | north exit');
  });

  test('matching displays the winning key as heading text (acceptedAnswers before correctHeading)', () => {
    const block = {
      id: 'matching-1',
      type: 'MATCHING',
      instruction: '',
      headings: [{ id: 'h1', text: 'Heading One' }, { id: 'h2', text: 'Heading Two' }],
    };
    const withAlternative = getCorrectAnswerDisplay(descriptor(
      block,
      { id: 'q1', paragraphLabel: 'A', correctHeading: 'h1', acceptedAnswers: ['h2'] },
      0,
    ));
    expect(withAlternative).toBe('Heading Two');

    const headingOnly = getCorrectAnswerDisplay(descriptor(
      block,
      { id: 'q1', paragraphLabel: 'A', correctHeading: 'h1' },
      0,
    ));
    expect(headingOnly).toBe('Heading One');
  });

  test('cloze displays the winning key: acceptedAnswers before correctAnswer', () => {
    const display = getCorrectAnswerDisplay(descriptor(
      { id: 'cloze-1', type: 'CLOZE', instruction: '' },
      { id: 'c1', prompt: 'Fill', correctAnswer: 'primary', acceptedAnswers: ['alternative'] },
      0,
    ));
    expect(display).toBe('alternative');
  });

  test('TFNG still displays a key stored only in acceptedAnswers', () => {
    const block = { id: 'tfng-1', type: 'TFNG', instruction: '' };
    const acceptedOnly = getCorrectAnswerDisplay(descriptor(
      block,
      { id: 't1', statement: 'Statement', correctAnswer: '', acceptedAnswers: ['T'] },
      0,
    ));
    expect(acceptedOnly).toBe('T');

    const primary = getCorrectAnswerDisplay(descriptor(
      block,
      { id: 't2', statement: 'Statement', correctAnswer: 'F', acceptedAnswers: ['False'] },
      0,
    ));
    expect(primary).toBe('F');
  });
});
