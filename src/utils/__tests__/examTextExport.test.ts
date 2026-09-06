import { describe, expect, it } from 'vitest';
import { createInitialExamState } from '../../services/examAdapterService';
import type { Exam, QuestionBlock, SingleMCQBlock } from '../../types';
import {
  buildExamTextExport,
  buildExamTextExportFilename,
} from '../examTextExport';

function buildAllQuestionTypesBlocks(): QuestionBlock[] {
  return [
    {
      id: 'blk-tfng',
      type: 'TFNG',
      mode: 'TFNG',
      instruction: 'Decide T/F/NG',
      questions: [{ id: 'q-tfng-1', statement: 'Sky is blue.', correctAnswer: 'T' }],
    },
    {
      id: 'blk-cloze',
      type: 'CLOZE',
      instruction: 'Fill in the blank',
      answerRule: 'ONE_WORD',
      questions: [
        { id: 'q-cloze-1', prompt: 'The capital is ____.', correctAnswer: 'Bangkok', acceptedAnswers: ['Bangkok'] },
      ],
    },
    {
      id: 'blk-matching',
      type: 'MATCHING',
      instruction: 'Match heading',
      headings: [
        { id: 'I', text: 'Heading One' },
        { id: 'II', text: 'Heading Two' },
      ],
      questions: [{ id: 'q-match-1', paragraphLabel: 'A', correctHeading: 'I' }],
    },
    {
      id: 'blk-map',
      type: 'MAP',
      instruction: 'Map labels',
      assetUrl: 'https://example.com/map.png',
      questions: [{ id: 'q-map-1', label: 'Entrance', correctAnswer: 'A', x: 25, y: 35 }],
    },
    {
      id: 'blk-multi-mcq',
      type: 'MULTI_MCQ',
      instruction: 'Select two options',
      stem: 'Which are renewable?',
      requiredSelections: 2,
      options: [
        { id: 'opt-a', text: 'Solar', isCorrect: true },
        { id: 'opt-b', text: 'Coal', isCorrect: false },
        { id: 'opt-c', text: 'Wind', isCorrect: true },
      ],
    },
    {
      id: 'blk-single-mcq',
      type: 'SINGLE_MCQ',
      instruction: 'Select one option',
      stem: 'What color is grass?',
      options: [
        { id: 'opt-x', text: 'Blue', isCorrect: false },
        { id: 'opt-y', text: 'Green', isCorrect: true },
      ],
    },
    {
      id: 'blk-short',
      type: 'SHORT_ANSWER',
      instruction: 'Short answer',
      questions: [
        {
          id: 'q-short-1',
          prompt: 'Name one pet.',
          correctAnswer: 'dog',
          acceptedAnswers: ['dog', 'cat'],
          answerRule: 'ONE_WORD',
        },
      ],
    },
    {
      id: 'blk-sentence',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete sentence',
      questions: [
        {
          id: 'q-sentence-1',
          sentence: 'The ____ jumps over the ____.',
          blanks: [
            { id: 'blank-1', correctAnswer: 'fox', acceptedAnswers: ['fox'], position: 0 },
            { id: 'blank-2', correctAnswer: 'dog', acceptedAnswers: ['dog'], position: 1 },
          ],
          answerRule: 'ONE_WORD',
        },
      ],
    },
    {
      id: 'blk-diagram',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label the diagram',
      imageUrl: 'https://example.com/diagram.png',
      labels: [{ id: 'label-1', x: 10, y: 20, prompt: 'Top label', correctAnswer: 'Engine' }],
    },
    {
      id: 'blk-flow',
      type: 'FLOW_CHART',
      instruction: 'Flow process',
      steps: [{ id: 'step-1', label: 'Start process', correctAnswer: 'Input' }],
    },
    {
      id: 'blk-table',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete table',
      headers: ['Col A', 'Col B'],
      rows: [['R1C1', '____']],
      cells: [{ id: 'cell-1', correctAnswer: 'Cell Answer', acceptedAnswers: ['Cell Answer', 'Alt Cell'], row: 0, col: 1 }],
      answerRule: 'ONE_WORD',
    },
    {
      id: 'blk-note',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete notes',
      questions: [
        {
          id: 'q-note-1',
          noteText: 'Bring your ____ to entry.',
          blanks: [{ id: 'note-blank-1', correctAnswer: 'ticket', acceptedAnswers: ['ticket'], position: 0 }],
          answerRule: 'ONE_WORD',
        },
      ],
    },
    {
      id: 'blk-classification',
      type: 'CLASSIFICATION',
      instruction: 'Classify each item',
      categories: ['Mammal', 'Bird'],
      items: [{ id: 'item-1', text: 'Eagle', correctCategory: 'Bird' }],
    },
    {
      id: 'blk-matching-features',
      type: 'MATCHING_FEATURES',
      instruction: 'Match features',
      options: ['Alice', 'Bob'],
      features: [{ id: 'feature-1', text: 'Loves hiking', correctMatch: 'Alice' }],
    },
  ];
}

function createExamFixture(id: string, title: string): Exam {
  const state = createInitialExamState(title, 'Academic', 'Academic');
  state.reading.passages = [
    {
      id: 'passage-1',
      title: 'Passage <b>One</b>',
      content: '<p>Alpha <strong>beta</strong> text.</p>',
      blocks: buildAllQuestionTypesBlocks(),
      images: [],
      wordCount: 3,
    },
  ];
  state.listening.parts = [
    {
      id: 'part-1',
      title: 'Part <i>One</i>',
      audioUrl: 'https://example.com/audio.mp3',
      pins: [],
      blocks: [
        {
          id: 'listening-tfng',
          type: 'TFNG',
          mode: 'TFNG',
          instruction: 'Listening T/F/NG',
          questions: [{ id: 'listening-q-1', statement: 'Audio says hello.', correctAnswer: 'T' }],
        },
      ],
    },
  ];
  state.writing.task1Prompt = '<p>Describe the graph in 150 words.</p>';
  state.writing.task2Prompt = '<p>Discuss both views and give your opinion.</p>';
  state.writing.tasks = undefined;
  state.speaking.part1Topics = ['<b>Hometown</b>', 'Work'];
  state.speaking.cueCard = 'Describe a place you visited recently.';
  state.speaking.part3Discussion = ['Why do people travel?'];

  return {
    id,
    title,
    type: 'Academic',
    status: 'Draft',
    author: 'Admin User',
    lastModified: '2026-04-30T10:00:00.000Z',
    createdAt: '2026-04-29T10:00:00.000Z',
    content: state,
  };
}

describe('examTextExport', () => {
  it('builds a combined text export for multiple exams', () => {
    const first = createExamFixture('exam-1', 'Exam One');
    const second = createExamFixture('exam-2', 'Exam Two');
    const output = buildExamTextExport(
      [first, second],
      new Date('2026-04-30T12:00:00.000Z'),
    );

    expect(output).toContain('IELTS EXAM TEXT EXPORT');
    expect(output).toContain('EXAM 1 OF 2');
    expect(output).toContain('EXAM 2 OF 2');
    expect(output).toContain('Title: Exam One');
    expect(output).toContain('Title: Exam Two');
  });

  it('exports only provided exams (selected exams only behavior)', () => {
    const first = createExamFixture('exam-1', 'Selected Exam');
    const second = createExamFixture('exam-2', 'Unselected Exam');
    const output = buildExamTextExport([first], new Date('2026-04-30T12:00:00.000Z'));

    expect(output).toContain('Title: Selected Exam');
    expect(output).not.toContain('Title: Unselected Exam');
    expect(output).toContain('Total Exams: 1');
    expect(second.id).toBe('exam-2');
  });

  it('skips disabled modules', () => {
    const exam = createExamFixture('exam-1', 'Module Toggle');
    exam.content.config.sections.listening.enabled = false;
    exam.content.config.sections.speaking.enabled = false;
    const output = buildExamTextExport([exam], new Date('2026-04-30T12:00:00.000Z'));

    expect(output).toContain('[READING]');
    expect(output).toContain('[WRITING]');
    expect(output).not.toContain('[LISTENING]');
    expect(output).not.toContain('[SPEAKING]');
  });

  it('formats MCQ answers as option letter and text', () => {
    const exam = createExamFixture('exam-1', 'MCQ Format');
    const output = buildExamTextExport([exam], new Date('2026-04-30T12:00:00.000Z'));

    expect(output).toContain('Answer: A. Solar | C. Wind');
    expect(output).toContain('Answer: B. Green');
  });

  it('includes inline answers and final answer-key sections', () => {
    const exam = createExamFixture('exam-1', 'Keys');
    const output = buildExamTextExport([exam], new Date('2026-04-30T12:00:00.000Z'));

    expect(output).toContain('Answer: T');
    expect(output).toContain('ANSWER KEY (READING)');
    expect(output).toContain('ANSWER KEY (LISTENING)');
    expect(output).toMatch(/Q1 -> /);
  });

  it('exports table completion accepted alternatives in inline rows and answer key', () => {
    const exam = createExamFixture('exam-1', 'Table Alternatives');
    const output = buildExamTextExport([exam], new Date('2026-04-30T12:00:00.000Z'));

    expect(output).toContain('Cell row 1, col 2');
    expect(output).toContain('Cell Answer | Alt Cell');
  });

  it('normalizes HTML-rich content into plain text', () => {
    const exam = createExamFixture('exam-1', 'HTML');
    const output = buildExamTextExport([exam], new Date('2026-04-30T12:00:00.000Z'));

    expect(output).toContain('Passage 1: Passage One');
    expect(output).toContain('Alpha beta text.');
    expect(output).toContain('Describe the graph in 150 words.');
    expect(output).not.toContain('<strong>');
    expect(output).not.toContain('<p>');
  });

  it('resets numbering per objective module', () => {
    const exam = createExamFixture('exam-1', 'Numbering');
    const output = buildExamTextExport([exam], new Date('2026-04-30T12:00:00.000Z'));

    const readingKeyStart = output.indexOf('ANSWER KEY (READING)');
    const listeningKeyStart = output.indexOf('ANSWER KEY (LISTENING)');
    const readingSection = output.slice(readingKeyStart, listeningKeyStart);
    const listeningSection = output.slice(listeningKeyStart);

    expect(readingSection).toContain('Q1 ->');
    expect(listeningSection).toContain('Q1 ->');
  });

  it('renders all supported question block types', () => {
    const exam = createExamFixture('exam-1', 'All Types');
    const output = buildExamTextExport([exam], new Date('2026-04-30T12:00:00.000Z'));

    [
      '(TFNG)',
      '(CLOZE)',
      '(MATCHING)',
      '(MAP)',
      '(MULTI_MCQ)',
      '(SINGLE_MCQ)',
      '(SHORT_ANSWER)',
      '(SENTENCE_COMPLETION)',
      '(DIAGRAM_LABELING)',
      '(FLOW_CHART)',
      '(TABLE_COMPLETION)',
      '(NOTE_COMPLETION)',
      '(CLASSIFICATION)',
      '(MATCHING_FEATURES)',
    ].forEach((typeLabel) => {
      expect(output).toContain(typeLabel);
    });
  });

  it('exports inserted image URL/caption lines under block instructions for supported types only', () => {
    const exam = createExamFixture('exam-1', 'Inserted Images');
    const readingBlocks = exam.content.reading.passages[0]?.blocks ?? [];
    const tfngBlock = readingBlocks.find((block) => block.type === 'TFNG');
    const mapBlock = readingBlocks.find((block) => block.type === 'MAP');

    if (tfngBlock) {
      tfngBlock.insertedImages = [
        {
          id: 'img-1',
          url: 'https://example.com/context.png',
          caption: 'Context caption',
        },
      ];
    }
    if (mapBlock) {
      mapBlock.insertedImages = [
        {
          id: 'img-map',
          url: 'https://example.com/should-not-export.png',
          caption: 'Should not export',
        },
      ];
    }

    const output = buildExamTextExport([exam], new Date('2026-04-30T12:00:00.000Z'));

    expect(output).toContain('Inserted image 1: https://example.com/context.png');
    expect(output).toContain('Inserted image 1 caption: Context caption');
    expect(output).not.toContain('https://example.com/should-not-export.png');
  });

  it('builds filename using yyyy-mm-dd format', () => {
    const filename = buildExamTextExportFilename(new Date('2026-04-30T12:00:00.000Z'));
    expect(filename).toBe('exam-export-2026-04-30.txt');
  });

  it('exports every SINGLE_MCQ sub-question (regression: 40 shown but only 30 exported)', () => {
    const exam = createExamFixture('exam-1', 'SingleMcq Subquestions');
    const readingBlocks = exam.content.reading.passages[0]?.blocks ?? [];
    const singleMcq = readingBlocks.find(
      (block) => block.type === 'SINGLE_MCQ',
    ) as SingleMCQBlock | undefined;

    expect(singleMcq).toBeDefined();

    const subStems = [
      'Sub question one stem.',
      'Sub question two stem.',
      'Sub question three stem.',
    ];

    if (singleMcq) {
      singleMcq.questions = [
        {
          id: 'single-q-1',
          stem: subStems[0],
          options: [
            { id: 'a', text: 'One A', isCorrect: true },
            { id: 'b', text: 'One B', isCorrect: false },
          ],
        },
        {
          id: 'single-q-2',
          stem: subStems[1],
          options: [
            { id: 'a', text: 'Two A', isCorrect: false },
            { id: 'b', text: 'Two B', isCorrect: true },
          ],
        },
        {
          id: 'single-q-3',
          stem: subStems[2],
          options: [
            { id: 'a', text: 'Three A', isCorrect: true },
            { id: 'b', text: 'Three B', isCorrect: false },
          ],
        },
      ];
    }

    const output = buildExamTextExport([exam], new Date('2026-04-30T12:00:00.000Z'));

    // Every SINGLE_MCQ sub-question must appear in the export, otherwise the
    // admin "total questions" count (which includes sub-questions) lies about
    // what the file actually contains.
    subStems.forEach((stem) => {
      expect(output).toContain(stem);
    });

    const exportedSubQuestions = subStems.filter((stem) => output.includes(stem)).length;
    expect(exportedSubQuestions).toBe(subStems.length);

    // Each sub-question produces its own answer-key entry.
    expect(output).toContain('A. One A');
    expect(output).toContain('B. Two B');
    expect(output).toContain('A. Three A');
  });

  it('does not drop SINGLE_MCQ sub-questions across a realistic 40-question exam', () => {
    const exam = createExamFixture('exam-40', 'Forty Questions');
    const readingBlocks = exam.content.reading.passages[0]?.blocks ?? [];
    const singleMcq = readingBlocks.find(
      (block) => block.type === 'SINGLE_MCQ',
    ) as SingleMCQBlock | undefined;

    const subStems = Array.from(
      { length: 10 },
      (_, index) => `Sub question ${index + 1} stem.`,
    );

    if (singleMcq) {
      singleMcq.questions = subStems.map((stem, index) => ({
        id: `single-q-${index + 1}`,
        stem,
        options: [
          { id: 'a', text: `Opt A ${index + 1}`, isCorrect: index % 2 === 0 },
          { id: 'b', text: `Opt B ${index + 1}`, isCorrect: index % 2 === 1 },
        ],
      }));
    }

    const output = buildExamTextExport([exam], new Date('2026-04-30T12:00:00.000Z'));

    // All 10 sub-questions must survive the export instead of collapsing into a
    // single block-level question.
    subStems.forEach((stem) => {
      expect(output).toContain(stem);
    });
    const exportedSubQuestions = subStems.filter((stem) => output.includes(stem)).length;
    expect(exportedSubQuestions).toBe(subStems.length);
  });
});

describe('examTextExport uncovered branches', () => {
  const EXPORT_DATE = new Date('2026-04-30T12:00:00.000Z');

  function createMinimalExam(id: string, title: string, readingBlocks: QuestionBlock[]): Exam {
    const exam = createExamFixture(id, title);
    exam.content.reading.passages = [
      {
        id: 'passage-1',
        title: 'Solo',
        content: '',
        blocks: readingBlocks,
        images: [],
        wordCount: 0,
      },
    ];
    exam.content.listening.parts = [];
    exam.content.config.sections.listening.enabled = false;
    exam.content.config.sections.writing.enabled = false;
    exam.content.config.sections.speaking.enabled = false;
    return exam;
  }

  function countOccurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
  }

  it('pads single-digit month and day in the export filename', () => {
    expect(buildExamTextExportFilename(new Date('2026-01-05T08:00:00.000Z'))).toBe(
      'exam-export-2026-01-05.txt',
    );
  });

  it('exports an empty exam list with zero totals and a trailing newline', () => {
    const output = buildExamTextExport([], EXPORT_DATE);

    expect(output).toContain('IELTS EXAM TEXT EXPORT');
    expect(output).toContain('Generated At: 2026-04-30T12:00:00.000Z');
    expect(output).toContain('Total Exams: 0');
    expect(output).not.toContain('EXAM 1 OF');
    expect(output.endsWith('\n')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(false);
  });

  it('renders exam header metadata fields and an empty answer key', () => {
    const exam = createMinimalExam('exam-meta', 'Meta Exam', []);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Total Exams: 1');
    expect(output).toContain('EXAM 1 OF 1');
    expect(output).toContain('Title: Meta Exam');
    expect(output).toContain('Exam ID: exam-meta');
    expect(output).toContain('Type: Academic');
    expect(output).toContain('Status: Draft');
    expect(output).toContain('Owner: Admin User');
    expect(output).toContain('Updated: 2026-04-30T10:00:00.000Z');
    expect(output).toContain('Passage 1: Solo');
    expect(output).not.toContain('Content:');
    expect(output).toContain('ANSWER KEY (READING)');
    expect(output).toContain('(no objective questions)');
  });

  it('renders a MULTI_MCQ spanning a question-number range', () => {
    const exam = createMinimalExam('exam-multi', 'Multi Range', [
      {
        id: 'blk-multi',
        type: 'MULTI_MCQ',
        instruction: 'Pick two',
        stem: 'Which are renewable?',
        requiredSelections: 2,
        options: [
          { id: 'opt-a', text: 'Solar', isCorrect: true },
          { id: 'opt-b', text: 'Coal', isCorrect: false },
          { id: 'opt-c', text: 'Wind', isCorrect: true },
        ],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Stem: Which are renewable?');
    expect(output).toContain('Correct options: 2');
    expect(output).toContain('Q1-2. Which are renewable?');
    expect(output).toContain('Answer: A. Solar | C. Wind');
    expect(output).toContain('Q1-2 -> A. Solar | C. Wind');
  });

  it('renders a MULTI_MCQ with no marked-correct options as (none)', () => {
    const exam = createMinimalExam('exam-multi-none', 'Multi None', [
      {
        id: 'blk-multi',
        type: 'MULTI_MCQ',
        instruction: '',
        stem: 'Which are renewable?',
        requiredSelections: 1,
        options: [
          { id: 'opt-a', text: 'Coal', isCorrect: false },
          { id: 'opt-b', text: 'Oil', isCorrect: false },
        ],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Correct options: 0');
    expect(output).toContain('Answer: (none)');
    expect(output).toContain('Q1 -> (none)');
  });

  it('falls back for empty TFNG statements and CLOZE/SHORT prompts', () => {
    const exam = createMinimalExam('exam-empty', 'Empty Text', [
      {
        id: 'blk-tfng',
        type: 'TFNG',
        mode: 'TFNG',
        instruction: '',
        questions: [{ id: 'q1', statement: '', correctAnswer: 'NG' }],
      },
      {
        id: 'blk-cloze',
        type: 'CLOZE',
        instruction: '',
        answerRule: 'ONE_WORD',
        questions: [{ id: 'q2', prompt: '', correctAnswer: 'Bangkok' }],
      },
      {
        id: 'blk-short',
        type: 'SHORT_ANSWER',
        instruction: '',
        questions: [{ id: 'q3', prompt: '   ', correctAnswer: 'dog', answerRule: 'ONE_WORD' }],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Q1. (empty statement)');
    expect(output).toContain('Q2. (empty prompt)');
    expect(output).toContain('Q3. (empty prompt)');
    expect(output).not.toContain('Instruction:');
  });

  it('resolves MATCHING answers by id, roman index, and raw fallback', () => {
    const exam = createMinimalExam('exam-match', 'Matching Display', [
      {
        id: 'blk-match',
        type: 'MATCHING',
        instruction: '',
        headings: [
          { id: 'A', text: 'Alpha' },
          { id: 'B', text: '' },
        ],
        questions: [
          { id: 'q-roman', paragraphLabel: '', correctHeading: 'i' },
          { id: 'q-by-id-empty', paragraphLabel: 'C', correctHeading: 'B' },
          { id: 'q-unknown', paragraphLabel: 'D', correctHeading: 'ZZZ' },
        ],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Choices:');
    expect(output).toContain('  - A. Alpha');
    expect(output).toContain('  - B');
    expect(output).toContain('Q1. Paragraph q-roman');
    expect(output).toContain('Answer: i. Alpha');
    expect(output).toContain('Q2. Paragraph C');
    expect(output).toContain('Answer: B');
    expect(output).toContain('Q3. Paragraph D');
    expect(output).toContain('Answer: ZZZ');
  });

  it('falls back to the MAP question id when the label is empty', () => {
    const exam = createMinimalExam('exam-map', 'Map Labels', [
      {
        id: 'blk-map',
        type: 'MAP',
        instruction: '',
        assetUrl: 'https://example.com/map.png',
        questions: [
          { id: 'map-q', label: '', correctAnswer: 'C', x: 10, y: 20 },
          { id: 'map-q2', label: 'Entrance', correctAnswer: 'A', x: 25, y: 35 },
        ],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Q1. map-q (x:10, y:20)');
    expect(output).toContain('Answer: C');
    expect(output).toContain('Q2. Entrance (x:25, y:35)');
    expect(output).toContain('Answer: A');
  });

  it('renders block-level SINGLE_MCQ stems, options, and answers', () => {
    const exam = createMinimalExam('exam-single', 'Single Block', [
      {
        id: 'blk-single',
        type: 'SINGLE_MCQ',
        instruction: 'Pick one',
        stem: 'Block stem?',
        options: [
          { id: 'a', text: 'First', isCorrect: false },
          { id: 'b', text: 'Second', isCorrect: true },
        ],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Stem: Block stem?');
    expect(output).toContain('  A. First');
    expect(output).toContain('  B. Second');
    expect(output).toContain('Q1. Block stem?');
    expect(output).toContain('Answer: B. Second');
    expect(output).toContain('Q1 -> B. Second');
  });

  it('falls back to block options for SINGLE_MCQ sub-questions without options', () => {
    const exam = createMinimalExam('exam-sub-fallback', 'Sub Fallback', [
      {
        id: 'blk-single',
        type: 'SINGLE_MCQ',
        instruction: '',
        stem: 'Block stem?',
        options: [{ id: 'a', text: 'Block A', isCorrect: true }],
        questions: [{ id: 'sq-1', stem: 'Sub stem?', options: [] }],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Stem: Sub stem?');
    expect(output).toContain('  A. Block A');
    expect(output).toContain('Answer: A. Block A');
  });

  it('renders (none) for SINGLE_MCQ with no correct option', () => {
    const exam = createMinimalExam('exam-single-none', 'Single None', [
      {
        id: 'blk-single',
        type: 'SINGLE_MCQ',
        instruction: '',
        stem: 'Block stem?',
        options: [{ id: 'a', text: 'Only', isCorrect: false }],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Answer: (none)');
    expect(output).toContain('Q1 -> (none)');
  });

  it('groups SENTENCE_COMPLETION blanks sharing a score group into one row', () => {
    const exam = createMinimalExam('exam-sent', 'Sentence Groups', [
      {
        id: 'blk-s1',
        type: 'SENTENCE_COMPLETION',
        instruction: '',
        questions: [
          {
            id: 'q1',
            sentence: 'The ____ jumps.',
            blanks: [
              { id: 'b1', correctAnswer: 'fox', position: 0 },
              { id: 'b2', correctAnswer: 'dog', position: 1 },
            ],
            answerRule: 'ONE_WORD',
          },
        ],
      },
      {
        id: 'blk-s2',
        type: 'SENTENCE_COMPLETION',
        instruction: '',
        questions: [
          {
            id: 'q2',
            sentence: 'It is ____ and ____.',
            blanks: [
              { id: 'b3', correctAnswer: 'red', position: 0, scoreGroupId: 'g1' },
              { id: 'b4', correctAnswer: 'blue', position: 1, scoreGroupId: 'g1' },
            ],
            answerRule: 'ONE_WORD',
          },
        ],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Q1 -> fox');
    expect(output).toContain('Q2 -> dog');
    expect(output).toContain('Q3 -> red | blue');
    expect(output).toContain('[Blank 1, Blank 2]');
    expect(output).toContain('Answer: red | blue');
  });

  it('renders diagram image lines with Label fallback and (none) answers', () => {
    const exam = createMinimalExam('exam-diagram', 'Diagram', [
      {
        id: 'blk-diagram',
        type: 'DIAGRAM_LABELING',
        instruction: '',
        imageUrl: 'https://example.com/d.png',
        labels: [{ id: 'l1', x: 1, y: 2, correctAnswer: '' }],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Diagram image: https://example.com/d.png');
    expect(output).toContain('Q1. Label');
    expect(output).toContain('Answer: (none)');
  });

  it('omits diagram image lines for empty urls and skips inserted images', () => {
    const exam = createMinimalExam('exam-diagram-empty', 'Diagram Empty', [
      {
        id: 'blk-diagram',
        type: 'DIAGRAM_LABELING',
        instruction: '',
        imageUrl: '',
        labels: [{ id: 'l1', x: 1, y: 2, prompt: 'Top', correctAnswer: 'Engine' }],
        insertedImages: [
          { id: 'img-1', url: 'https://example.com/should-not-export.png', caption: 'Skip me' },
        ],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).not.toContain('Diagram image:');
    expect(output).toContain('Q1. Top');
    expect(output).toContain('Answer: Engine');
    expect(output).not.toContain('should-not-export');
    expect(output).not.toContain('Skip me');
  });

  it('falls back to Step for FLOW_CHART steps without labels', () => {
    const exam = createMinimalExam('exam-flow', 'Flow', [
      {
        id: 'blk-flow',
        type: 'FLOW_CHART',
        instruction: '',
        steps: [{ id: 's1', label: '', correctAnswer: 'Input' }],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Q1. Step');
    expect(output).toContain('Answer: Input');
  });

  it('renders TABLE_COMPLETION headers, rows, and cell coordinates', () => {
    const exam = createMinimalExam('exam-table', 'Table', [
      {
        id: 'blk-table',
        type: 'TABLE_COMPLETION',
        instruction: '',
        headers: ['H1', 'H2'],
        rows: [
          ['a', '____'],
          ['b', '____'],
        ],
        cells: [{ id: 'c1', correctAnswer: 'X', row: 0, col: 1 }],
        answerRule: 'ONE_WORD',
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Headers: H1 | H2');
    expect(output).toContain('Row 1: a | ____');
    expect(output).toContain('Row 2: b | ____');
    expect(output).toContain('Cell row 1, col 2');
    expect(output).toContain('Answer: X');
  });

  it('renders NOTE_COMPLETION note text with per-blank numbering', () => {
    const exam = createMinimalExam('exam-note', 'Notes', [
      {
        id: 'blk-note',
        type: 'NOTE_COMPLETION',
        instruction: '',
        questions: [
          {
            id: 'n1',
            noteText: '<p>Take ____ and ____.</p>',
            blanks: [
              { id: 'nb1', correctAnswer: 'one', position: 0 },
              { id: 'nb2', correctAnswer: 'two', position: 1 },
            ],
            answerRule: 'ONE_WORD',
          },
        ],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Note 1:');
    expect(output).toContain('Take ____ and ____.');
    expect(output).toContain('Note 1 blank 1');
    expect(output).toContain('Note 1 blank 2');
    expect(output).toContain('Answer: one');
    expect(output).toContain('Answer: two');
  });

  it('renders CLASSIFICATION categories with item fallbacks and omits empty category lines', () => {
    const exam = createMinimalExam('exam-cls', 'Classification', [
      {
        id: 'blk-cls',
        type: 'CLASSIFICATION',
        instruction: '',
        categories: ['Mammal', 'Bird'],
        items: [{ id: 'item-x', text: '', correctCategory: '' }],
      },
      {
        id: 'blk-cls-plain',
        type: 'CLASSIFICATION',
        instruction: '',
        categories: [],
        items: [{ id: 'i1', text: 'Eagle', correctCategory: 'Bird' }],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Categories: Mammal | Bird');
    expect(countOccurrences(output, 'Categories:')).toBe(1);
    expect(output).toContain('Q1. item-x');
    expect(output).toContain('Q1 -> (none)');
    expect(output).toContain('Q2. Eagle');
    expect(output).toContain('Q2 -> Bird');
  });

  it('renders MATCHING_FEATURES options with feature fallbacks and omits empty option lines', () => {
    const exam = createMinimalExam('exam-mf', 'Matching Features', [
      {
        id: 'blk-mf',
        type: 'MATCHING_FEATURES',
        instruction: '',
        options: [],
        features: [{ id: 'f-x', text: '', correctMatch: 'Alice' }],
      },
      {
        id: 'blk-mf-plain',
        type: 'MATCHING_FEATURES',
        instruction: '',
        options: ['A', 'B'],
        features: [{ id: 'f1', text: 'Loves hiking', correctMatch: 'A' }],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(countOccurrences(output, 'Options:')).toBe(1);
    expect(output).toContain('Options: A | B');
    expect(output).toContain('Q1. f-x');
    expect(output).toContain('Q1 -> Alice');
    expect(output).toContain('Q2. Loves hiking');
  });

  it('renders inserted images with only a url or only a caption', () => {
    const exam = createMinimalExam('exam-img', 'Inserted Images', [
      {
        id: 'blk-tfng',
        type: 'TFNG',
        mode: 'TFNG',
        instruction: 'Read closely',
        questions: [{ id: 'q1', statement: 'Sky.', correctAnswer: 'T' }],
        insertedImages: [
          { id: 'img-1', url: 'https://example.com/only.png' },
          { id: 'img-2', url: '', caption: 'Only caption' },
        ],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Instruction: Read closely');
    expect(output).toContain('Inserted image 1: https://example.com/only.png');
    expect(output).not.toContain('Inserted image 1 caption');
    expect(output).toContain('Inserted image 2 caption: Only caption');
    expect(output).not.toContain('Inserted image 2: http');
  });

  it('joins accepted-answer alternatives for short answers and cloze prompts', () => {
    const exam = createMinimalExam('exam-alt', 'Alternatives', [
      {
        id: 'blk-short',
        type: 'SHORT_ANSWER',
        instruction: '',
        questions: [
          {
            id: 'q1',
            prompt: 'Name one pet.',
            correctAnswer: 'dog',
            acceptedAnswers: ['dog', 'cat'],
            answerRule: 'ONE_WORD',
          },
        ],
      },
      {
        id: 'blk-cloze',
        type: 'CLOZE',
        instruction: '',
        answerRule: 'ONE_WORD',
        questions: [
          {
            id: 'q2',
            prompt: 'Capital?',
            correctAnswer: 'Bangkok',
            acceptedAnswers: ['Bangkok', 'Krung Thep'],
          },
        ],
      },
    ]);
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Answer: dog | cat');
    expect(output).toContain('Answer: Bangkok | Krung Thep');
  });

  it('renders the writing tasks array branch with ids and missing-prompt fallback', () => {
    const exam = createExamFixture('exam-w', 'Writing Tasks');
    exam.content.writing.tasks = [
      { taskId: 't1', prompt: '<p>Write about <b>cars</b>.</p>' },
      { taskId: '', prompt: '' },
    ];
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('[WRITING]');
    expect(output).toContain('Task 1 (t1)');
    expect(output).toContain('Write about cars.');
    expect(output).toContain('Task 2');
    expect(countOccurrences(output, '(no prompt)')).toBe(1);
  });

  it('falls back to (no prompt) for legacy writing prompts when empty', () => {
    const exam = createExamFixture('exam-wl', 'Legacy Writing');
    exam.content.writing.tasks = undefined;
    exam.content.writing.task1Prompt = '';
    exam.content.writing.task2Prompt = '';
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Task 1');
    expect(output).toContain('Task 2');
    expect(countOccurrences(output, '(no prompt)')).toBe(2);
  });

  it('renders speaking cue-card details and (none) for empty lists', () => {
    const exam = createExamFixture('exam-s', 'Speaking Details');
    exam.content.speaking.part1Topics = [];
    exam.content.speaking.cueCard = '';
    exam.content.speaking.cueCardDetails = {
      topic: '<b>Park</b>',
      bullets: ['<i>Where</i>', 'When'],
      timeAllocation: '1 min',
      evaluatorNotes: '',
    };
    exam.content.speaking.part3Discussion = [];
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('Part 1 Topics:');
    expect(output).toContain('Cue Card:');
    expect(output).toContain('Topic: Park');
    expect(output).toContain('- 1. Where');
    expect(output).toContain('- 2. When');
    expect(output).toContain('Part 3 Discussion:');
    expect(countOccurrences(output, '(none)')).toBe(2);
  });

  it('renders (none) for a fully empty speaking cue card', () => {
    const exam = createExamFixture('exam-s-empty', 'Speaking Empty');
    exam.content.speaking.part1Topics = [];
    exam.content.speaking.cueCard = '';
    exam.content.speaking.cueCardDetails = undefined;
    exam.content.speaking.part3Discussion = [];
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(countOccurrences(output, '(none)')).toBe(3);
  });

  it('handles empty passages and listening parts without content or audio lines', () => {
    const exam = createExamFixture('exam-empty-mod', 'Empty Modules');
    exam.content.reading.passages = [];
    exam.content.listening.parts = [{ id: 'part-1', title: '', audioUrl: '', pins: [], blocks: [] }];
    exam.content.config.sections.writing.enabled = false;
    exam.content.config.sections.speaking.enabled = false;
    const output = buildExamTextExport([exam], EXPORT_DATE);

    expect(output).toContain('[READING]');
    expect(output).toContain('[LISTENING]');
    expect(output).toContain('Part 1: Part 1');
    expect(output).not.toContain('Content:');
    expect(output).not.toContain('Audio:');
    expect(countOccurrences(output, '(no objective questions)')).toBe(2);
  });
});
