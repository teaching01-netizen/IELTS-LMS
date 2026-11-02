import { describe, expect, it } from 'vitest';
import { createInitialExamState, getStudentQuestionsForModule } from '../../../services/examAdapterService';
import type { QuestionBlock } from '../../../types';
import { getEffectiveAcceptedAnswersForGrading } from '../gradingAnswerUtils';

function descriptorsFor(blocks: QuestionBlock[]) {
  const state = createInitialExamState('Key source table', 'Academic');
  state.reading.passages[0]!.blocks = blocks;
  return getStudentQuestionsForModule(state, 'reading');
}

describe('website key-source table', () => {
  it('matching headings reads correctHeading when acceptedAnswers is absent', () => {
    const [descriptor] = descriptorsFor([
      {
        id: 'match-block',
        type: 'MATCHING',
        instruction: '',
        headings: [
          { id: 'H1', text: 'First' },
          { id: 'H2', text: 'Second' },
        ],
        questions: [{ id: 'q-match', paragraphLabel: 'C', correctHeading: 'H2' }],
      },
    ]);
    expect(getEffectiveAcceptedAnswersForGrading(descriptor!)).toEqual(['H2']);
  });

  it('classification prefers correctCategory over stale correctAnswer', () => {
    const [descriptor] = descriptorsFor([
      {
        id: 'class-block',
        type: 'CLASSIFICATION',
        instruction: '',
        categories: ['A', 'B'],
        items: [{ id: 'ci1', text: 'Item', correctCategory: 'B', correctAnswer: 'A' } as never],
      },
    ]);
    expect(getEffectiveAcceptedAnswersForGrading(descriptor!)).toEqual(['B']);
  });

  it('matching features prefers correctMatch over stale correctAnswer', () => {
    const [descriptor] = descriptorsFor([
      {
        id: 'feature-block',
        type: 'MATCHING_FEATURES',
        instruction: '',
        options: ['M1', 'M2'],
        features: [{ id: 'f1', text: 'Feature', correctMatch: 'M2', correctAnswer: 'M1' } as never],
      },
    ]);
    expect(getEffectiveAcceptedAnswersForGrading(descriptor!)).toEqual(['M2']);
  });

  it('tfng reads correctAnswer before acceptedAnswers', () => {
    const [descriptor] = descriptorsFor([
      {
        id: 'tfng-block',
        type: 'TFNG',
        instruction: '',
        questions: [{ id: 't1', statement: 'True?', correctAnswer: 'F', acceptedAnswers: ['T', 'TRUE'] } as never],
      },
    ]);
    expect(getEffectiveAcceptedAnswersForGrading(descriptor!)).toEqual(['F']);
  });

  it('map falls back to correctAnswer', () => {
    const [descriptor] = descriptorsFor([
      {
        id: 'map-block',
        type: 'MAP',
        instruction: '',
        assetUrl: 'map.png',
        questions: [{ id: 'm1', label: 'Gate', correctAnswer: 'north gate', x: 0, y: 0 }],
      },
    ]);
    expect(getEffectiveAcceptedAnswersForGrading(descriptor!)).toEqual(['north gate']);
  });

  it('diagram labels split pipe alternatives', () => {
    const [descriptor] = descriptorsFor([
      {
        id: 'diagram-block',
        type: 'DIAGRAM_LABELING',
        instruction: '',
        imageUrl: 'diagram.png',
        labels: [{ id: 'l1', x: 0, y: 0, correctAnswer: 'a | b' }],
      },
    ]);
    expect(getEffectiveAcceptedAnswersForGrading(descriptor!)).toEqual(['a', 'b']);
  });

  it('flow steps read correctAnswer', () => {
    const [descriptor] = descriptorsFor([
      {
        id: 'flow-block',
        type: 'FLOW_CHART',
        instruction: '',
        steps: [{ id: 's1', label: 'Step', correctAnswer: 'mix' }],
      },
    ]);
    expect(getEffectiveAcceptedAnswersForGrading(descriptor!)).toEqual(['mix']);
  });

  it('table cells read acceptedAnswers before correctAnswer', () => {
    const [descriptor] = descriptorsFor([
      {
        id: 'table-block',
        type: 'TABLE_COMPLETION',
        instruction: '',
        answerRule: 'ONE_WORD',
        headers: ['A'],
        rows: [['']],
        cells: [{ id: 'c1', row: 0, col: 0, correctAnswer: '2000', acceptedAnswers: ['1999'] }],
      },
    ]);
    expect(getEffectiveAcceptedAnswersForGrading(descriptor!)).toEqual(['1999']);
  });

  it('sentence blanks use the shared pool when acceptAnyAnswerKey is set', () => {
    const [descriptor] = descriptorsFor([
      {
        id: 'sentence-block',
        type: 'SENTENCE_COMPLETION',
        instruction: '',
        questions: [
          {
            id: 's1',
            sentence: 'The ____ and ____.',
            answerRule: 'ONE_WORD',
            acceptAnyAnswerKey: true,
            sharedAcceptedAnswers: ['alpha', 'beta'],
            blanks: [
              { id: 'b1', position: 0, correctAnswer: 'alpha' },
              { id: 'b2', position: 1, correctAnswer: 'beta' },
            ],
          },
        ],
      },
    ]);
    expect(getEffectiveAcceptedAnswersForGrading(descriptor!)).toEqual(['alpha', 'beta']);
  });

  it('sub-answer leaves read acceptedAnswers from the tree', () => {
    const [descriptor] = descriptorsFor([
      {
        id: 'tree-block',
        type: 'SHORT_ANSWER',
        instruction: '',
        questions: [],
        subAnswerModeEnabled: true,
        answerTree: [
          {
            id: 'root',
            label: 'Root',
            children: [{ id: 'leaf', label: 'Leaf', acceptedAnswers: ['yes'], required: true }],
          },
        ],
      },
    ]);
    expect(getEffectiveAcceptedAnswersForGrading(descriptor!)).toEqual(['yes']);
  });
});
