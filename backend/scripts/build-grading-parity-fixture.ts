/**
 * Builds testdata/objective-grading-parity/full-coverage-exam.json.
 *
 * The fixture covers every row of the key-source table, grouped slots,
 * sub-answer trees, choose-N partial credit, shared answer pools, schedule
 * overrides and exclusions.
 *
 * The expected block is a reviewed golden file regenerated from the Go grader.
 * The website test compares against it independently, so the two graders
 * cannot drift together. Without --update-expected the script preserves the
 * checked-in golden file; --check fails CI when it is missing or stale.
 *
 * Run: bun backend/scripts/build-grading-parity-fixture.ts [--update-expected|--check]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialExamState } from '../../src/services/examAdapterService';
import type { QuestionBlock, SubAnswerTreeNode } from '../../src/types';

declare const Bun: {
  spawn: (
    command: string[],
    options: Record<string, unknown>,
  ) => {
    stdin: { write: (value: string) => void; end: () => Promise<void> };
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
  };
};

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../testdata/objective-grading-parity/full-coverage-exam.json');
const GO_ROOT = resolve(HERE, '../../backend/go');
const SECTION = 'reading' as const;
const VERSION_ID = 'parity-full-coverage';

interface GoQuestionResult {
  questionId: string;
  correctness: boolean | null;
  awardedScore: number | null;
  maxScore: number | null;
}

interface GoSectionResult {
  totalScore: number;
  maxScore: number;
  questions: GoQuestionResult[];
}

interface GoldenExpected {
  totalScore: number;
  maxScore: number;
  questions: GoQuestionResult[];
}

async function runGoExpected(): Promise<GoldenExpected> {
  const proc = Bun.spawn(['go', 'run', './cmd/grading-parity-grade'], {
    cwd: GO_ROOT,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  proc.stdin.write(JSON.stringify([{
    section: SECTION,
    content: examState,
    answers,
    keys: {},
    overrides,
    versionId: VERSION_ID,
  }]));
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Go parity grader failed (exit ${exitCode}): ${stderr.slice(0, 2000)}`);
  }
  const [result] = JSON.parse(stdout) as GoSectionResult[];
  if (!result) throw new Error('Go parity grader returned no result.');
  return {
    totalScore: result.totalScore,
    maxScore: result.maxScore,
    questions: result.questions.map((question) => ({
      questionId: question.questionId,
      correctness: question.correctness,
      awardedScore: question.awardedScore,
      maxScore: question.maxScore,
    })),
  };
}

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
  'b-table:c1': {
    acceptedAnswers: ['x'],
    scoringRule: 'exact_match',
    maxScore: 2,
  },
  'b-tree::tree::r1::lf1': {
    acceptedAnswers: ['yes'],
    scoringRule: 'exact_match',
    maxScore: 2,
  },
};

const updateExpected = process.argv.includes('--update-expected');
const check = process.argv.includes('--check');
if (updateExpected && check) {
  throw new Error('Use either --update-expected or --check, not both.');
}

const existing = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, 'utf8')) as { expected?: GoldenExpected })
  : null;
const computed = await runGoExpected();
let expected: GoldenExpected;

if (check) {
  if (!existing?.expected) {
    throw new Error(`Golden expected results are missing from ${OUT}. Run with --update-expected and review the diff.`);
  }
  if (JSON.stringify(existing.expected) !== JSON.stringify(computed)) {
    process.stderr.write(
      `Golden expected results are stale. Run ${'`'}bun backend/scripts/build-grading-parity-fixture.ts --update-expected${'`'} and review the diff.\n`,
    );
    process.exitCode = 1;
    process.exit(1);
  }
  process.stdout.write(`golden expected results are current (${computed.totalScore}/${computed.maxScore})\n`);
  process.exit(0);
}

if (updateExpected) {
  expected = computed;
} else {
  if (!existing?.expected) {
    throw new Error(`Golden expected results are missing from ${OUT}. Run with --update-expected and review the diff.`);
  }
  expected = existing.expected;
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      description:
        'Full-coverage objective grading parity exam. The expected block is a reviewed golden file regenerated from the Go grader; the website test compares against it independently.',
      section: SECTION,
      versionId: VERSION_ID,
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
