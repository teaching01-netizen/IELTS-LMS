/**
 * Builds testdata/objective-grading-parity/full-coverage-exam.json.
 *
 * The fixture covers every row of the key-source table, grouped slots,
 * sub-answer trees, choose-N partial credit, shared answer pools, schedule
 * overrides and exclusions. The expected block is a snapshot of the website
 * scorer; the Go and TypeScript parity tests both compare against it.
 *
 * Run: bun backend/scripts/build-grading-parity-fixture.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialExamState, getStudentQuestionsForModule } from '../../src/services/examAdapterService';
import { scoreObjectiveDescriptors } from '../../src/features/grading/objectiveScoring';
import type { QuestionBlock, SubAnswerTreeNode } from '../../src/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../testdata/objective-grading-parity/full-coverage-exam.json');

const tree: SubAnswerTreeNode[] = [
  {
    id: 'r1',
    label: 'Root one',
    children: [
      { id: 'lf1', label: 'Leaf one', acceptedAnswers: ['yes'], required: true },
      { id: 'lf2', label: 'Leaf two', acceptedAnswers: ['no'], required: true },
      { id: 'lf3', label: 'Optional', acceptedAnswers: ['maybe'], required: false },
    ],
  },
];

const blocks: QuestionBlock[] = [
  {
    id: 'b-tfng',
    type: 'TFNG',
    mode: 'TFNG',
    instruction: '',
    questions: [{ id: 'tfng-1', statement: 'True?', correctAnswer: 'T', acceptedAnswers: ['TRUE'] } as never],
  },
  {
    id: 'b-cloze',
    type: 'CLOZE',
    answerRule: 'ONE_WORD',
    instruction: '',
    questions: [
      { id: 'cloze-1', prompt: 'Building', correctAnswer: 'Garden hall' },
      { id: 'cloze-2', prompt: 'Job', correctAnswer: 'waiter\u200b' },
      { id: 'cloze-3', prompt: 'Date', correctAnswer: '28 June' },
      { id: 'cloze-4', prompt: 'Date again', correctAnswer: '28 June' },
      { id: 'cloze-5', prompt: 'Accent', correctAnswer: 'café' },
      { id: 'cloze-6', prompt: 'No accent', correctAnswer: 'cafe' },
      { id: 'cloze-7', prompt: 'Apostrophe', correctAnswer: "don't" },
    ],
  },
  {
    id: 'b-match',
    type: 'MATCHING',
    instruction: '',
    headings: [
      { id: 'H1', text: 'First' },
      { id: 'H2', text: 'Second' },
    ],
    questions: [{ id: 'match-1', paragraphLabel: 'C', correctHeading: 'H2' }],
  },
  {
    id: 'b-map',
    type: 'MAP',
    instruction: '',
    assetUrl: 'map.png',
    questions: [
      { id: 'map-1', label: 'Gate', correctAnswer: 'north gate', acceptedAnswers: ['north gate', 'north entrance'], x: 0, y: 0 } as never,
    ],
  },
  {
    id: 'b-short',
    type: 'SHORT_ANSWER',
    instruction: '',
    questions: [{ id: 'short-1', prompt: 'Shape', correctAnswer: 'graph | chart', answerRule: 'ONE_WORD' }],
  },
  {
    id: 'b-sentence',
    type: 'SENTENCE_COMPLETION',
    instruction: '',
    questions: [
      {
        id: 'sent-1',
        sentence: 'The ____ and ____.',
        answerRule: 'ONE_WORD',
        blanks: [
          { id: 'sb1', position: 0, correctAnswer: 'alpha' },
          { id: 'sb2', position: 1, correctAnswer: 'beta' },
        ],
      },
    ],
  },
  {
    id: 'b-pool',
    type: 'SENTENCE_COMPLETION',
    instruction: '',
    questions: [
      {
        id: 'pool-1',
        sentence: 'The ____ and ____.',
        answerRule: 'ONE_WORD',
        acceptAnyAnswerKey: true,
        sharedAcceptedAnswers: ['red', 'blue'],
        blanks: [
          { id: 'pb1', position: 0, correctAnswer: 'red' },
          { id: 'pb2', position: 1, correctAnswer: 'blue' },
        ],
      },
    ],
  },
  {
    id: 'b-sentence-group',
    type: 'SENTENCE_COMPLETION',
    instruction: '',
    questions: [
      {
        id: 'sg-1',
        sentence: 'The ____ and ____.',
        answerRule: 'ONE_WORD',
        blanks: [
          { id: 'sg1', position: 0, correctAnswer: 'one', scoreGroupId: 'grp', requiredCorrect: 2 },
          { id: 'sg2', position: 1, correctAnswer: 'two', scoreGroupId: 'grp', requiredCorrect: 2 },
        ],
      },
    ],
  },
  {
    id: 'b-note',
    type: 'NOTE_COMPLETION',
    instruction: '',
    questions: [
      {
        id: 'note-1',
        noteText: 'A note',
        answerRule: 'ONE_WORD',
        blanks: [{ id: 'nb1', position: 0, correctAnswer: 'note answer' }],
      },
    ],
  },
  {
    id: 'b-diagram',
    type: 'DIAGRAM_LABELING',
    instruction: '',
    imageUrl: 'diagram.png',
    labels: [{ id: 'dl1', x: 0, y: 0, correctAnswer: 'a | b' }],
  },
  {
    id: 'b-flow',
    type: 'FLOW_CHART',
    instruction: '',
    steps: [{ id: 'fs1', label: 'Step', correctAnswer: 'mix' }],
  },
  {
    id: 'b-table',
    type: 'TABLE_COMPLETION',
    instruction: '',
    answerRule: 'ONE_WORD',
    headers: ['A'],
    rows: [[''], [''], ['']],
    cells: [
      { id: 'c1', row: 0, col: 0, correctAnswer: 'x', scoreGroupId: 'g1', requiredCorrect: 2 },
      { id: 'c2', row: 1, col: 0, correctAnswer: 'y', scoreGroupId: 'g1', requiredCorrect: 2 },
      { id: 'c3', row: 2, col: 0, correctAnswer: 'z' },
    ],
  },
  {
    id: 'b-class',
    type: 'CLASSIFICATION',
    instruction: '',
    categories: ['A', 'B'],
    items: [{ id: 'ci1', text: 'Item', correctCategory: 'B', correctAnswer: 'A' } as never],
  },
  {
    id: 'b-features',
    type: 'MATCHING_FEATURES',
    instruction: '',
    options: ['M1', 'M2'],
    features: [{ id: 'fi1', text: 'Feature', correctMatch: 'M2', correctAnswer: 'M1' } as never],
  },
  {
    id: 'b-multi-partial',
    type: 'MULTI_MCQ',
    instruction: '',
    stem: 'Choose TWO',
    requiredSelections: 2,
    options: [
      { id: 'po1', text: 'One', isCorrect: true },
      { id: 'po2', text: 'Two', isCorrect: true },
      { id: 'po3', text: 'Three', isCorrect: false },
    ],
  },
  {
    id: 'b-multi-override',
    type: 'MULTI_MCQ',
    instruction: '',
    stem: 'Choose TWO',
    requiredSelections: 2,
    options: [
      { id: 'oo1', text: 'One', isCorrect: true },
      { id: 'oo2', text: 'Two', isCorrect: true },
      { id: 'oo3', text: 'Three', isCorrect: false },
    ],
  },
  {
    id: 'b-single',
    type: 'SINGLE_MCQ',
    instruction: '',
    stem: 'Choose ONE',
    options: [
      { id: 'so1', text: 'One', isCorrect: true },
      { id: 'so2', text: 'Two', isCorrect: false },
    ],
  },
  {
    id: 'b-tree',
    type: 'SHORT_ANSWER',
    instruction: '',
    questions: [],
    subAnswerModeEnabled: true,
    answerTree: tree,
  },
];

const examState = createInitialExamState('Objective grading parity full coverage', 'Academic');
examState.reading.passages[0]!.blocks = blocks;

const answers: Record<string, unknown> = {
  'tfng-1': 'T',
  'cloze-1': 'ＧＡＲＤＥＮ  hall',
  'cloze-2': 'waiter',
  'cloze-3': '28 june',
  'cloze-4': '28 June',
  'cloze-5': 'CAFÉ',
  'cloze-6': 'café',
  'cloze-7': 'dont',
  'match-1': 'H2',
  'map-1': 'north gate',
  'short-1': 'chart',
  'sent-1': ['alpha', 'beta'],
  'pool-1': ['blue', 'red'],
  'sg-1': ['one'],
  'note-1': ['note answer'],
  'b-diagram': ['b'],
  'b-flow': ['mix'],
  'b-table': ['x', 'y', 'z'],
  'b-class': ['B'],
  'b-features': ['M2'],
  'b-multi-partial': ['po1'],
  'b-multi-override': ['oo1', 'oo2'],
  'b-single': 'so1',
  'b-tree::tree::r1::lf1': 'no',
  'b-tree::tree::r1::lf2': 'yes',
};

const overrides = {
  'cloze-3': {
    acceptedAnswers: ['28 June'],
    excludedAnswers: ['28 june'],
    scoringRule: 'exact_match',
    maxScore: 1,
  },
  'b-multi-override': {
    correctOptionIds: ['oo1', 'oo2'],
    scoringRule: 'MULTI_MCQ',
    maxScore: 2,
  },
};

const descriptors = getStudentQuestionsForModule(examState, 'reading');
const scoring = scoreObjectiveDescriptors(descriptors, answers as never, overrides);
const expected = {
  totalScore: scoring.totalScore,
  maxScore: scoring.maxScore,
  questions: descriptors.map((descriptor) => {
    const score = scoring.byId.get(descriptor.id);
    return {
      questionId: descriptor.id,
      correctness: score?.correctness ?? null,
      awardedScore: score?.awardedScore ?? null,
      maxScore: score?.maxScore ?? null,
    };
  }),
};

writeFileSync(
  OUT,
  JSON.stringify(
    {
      description: 'Full-coverage objective grading parity exam. Shared by the Go and TypeScript tests.',
      section: 'reading',
      versionId: 'parity-full-coverage',
      examState,
      answers,
      keys: {},
      overrides,
      expected,
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write(`wrote ${OUT} (${expected.totalScore}/${expected.maxScore})\n`);
