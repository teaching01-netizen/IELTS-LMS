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
