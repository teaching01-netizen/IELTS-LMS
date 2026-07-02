import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ClassificationBlock,
  DiagramLabelingBlock,
  ExamState,
  MatchingFeaturesBlock,
  MultiMCQBlock,
  QuestionBlock,
  SingleMCQBlock,
  SentenceCompletionBlock,
  TableCompletionBlock,
} from '../../../types';
import type { StudentQuestionDescriptor } from '../../../services/examAdapterService';
import { QuestionRenderer } from '../QuestionRenderer';
import { StudentQuestionBlockSection } from '../StudentQuestionBlockSection';
import { StudentFooter } from '../StudentFooter';
import { StudentHeader } from '../StudentHeader';
import { StudentListening } from '../StudentListening';
import { StudentReading } from '../StudentReading';

describe('student question experience', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps footer numbering aligned after a multi-slot question block', () => {
    render(
      <StudentFooter
        questions={[
          {
            id: 'q1',
            blockId: 'q1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            isMulti: false,
            correctCount: 1,
          },
          {
            id: 'multi-1',
            blockId: 'multi-1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            isMulti: true,
            correctCount: 3,
          },
          {
            id: 'q5',
            blockId: 'q5',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            isMulti: false,
            correctCount: 1,
          },
        ]}
        currentQuestionId="q1"
        onNavigate={() => {}}
        answers={{}}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2-4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();
  });

  it('does not show decorative category tags for classification questions', () => {
    const block: ClassificationBlock = {
      id: 'classify-1',
      type: 'CLASSIFICATION',
      instruction: 'Classify each item.',
      categories: ['Category A', 'Category B'],
      items: [
        { id: 'item-1', text: 'First item', correctAnswer: 'Category A' },
      ],
    };

    const { container } = render(
      <QuestionRenderer
        question={null}
        block={block}
        number={1}
        answer={[]}
        onChange={() => {}}
      />,
    );

    expect(container.querySelector('.rounded-full.bg-blue-50')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Category selection for question 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Category A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Category B' })).toBeInTheDocument();
  });

  it('marks only non-active question blocks as safe offscreen render candidates', () => {
    const block: QuestionBlock = {
      id: 'short-2',
      type: 'SHORT_ANSWER',
      instruction: 'Answer the question.',
      questions: [{ id: 'q2', prompt: 'Prompt', correctAnswer: 'A' }],
      answerRule: 'ONE_WORD',
    } as QuestionBlock;
    const blockQuestions: StudentQuestionDescriptor[] = [
      {
        id: 'q2',
        blockId: 'short-2',
        groupId: 'p1',
        groupLabel: 'Passage 1',
        isMulti: false,
        correctCount: 1,
        answerKey: 'q2',
        block,
        question: (block as any).questions[0],
      } as StudentQuestionDescriptor,
    ];

    const { container, rerender } = render(
      <StudentQuestionBlockSection
        block={block}
        blockQuestions={blockQuestions}
        allQuestions={blockQuestions}
        answers={{ q2: '' }}
        currentQuestionId="q1"
        flags={{}}
        onAnswerChange={() => undefined}
        tabletMode={false}
        answerCompact={false}
        highlightEnabled={false}
        getBlockStartQuestionNumber={() => 2}
        renderBlockInstruction={(instruction) => <p>{instruction}</p>}
        expandedQuestionGapClassName="space-y-8"
      />,
    );

    expect(container.firstElementChild).toHaveClass('student-question-block-deferred');

    rerender(
      <StudentQuestionBlockSection
        block={block}
        blockQuestions={blockQuestions}
        allQuestions={blockQuestions}
        answers={{ q2: '' }}
        currentQuestionId="q2"
        flags={{}}
        onAnswerChange={() => undefined}
        tabletMode={false}
        answerCompact={false}
        highlightEnabled={false}
        getBlockStartQuestionNumber={() => 2}
        renderBlockInstruction={(instruction) => <p>{instruction}</p>}
        expandedQuestionGapClassName="space-y-8"
      />,
    );

    expect(container.firstElementChild).not.toHaveClass('student-question-block-deferred');
  });

  it('uses full-width compact controls for classification in narrow tablet panes', () => {
    const block: ClassificationBlock = {
      id: 'classify-compact',
      type: 'CLASSIFICATION',
      instruction: 'Classify each item.',
      categories: ['Category A', 'Category B'],
      items: [{ id: 'item-1', text: 'First item', correctAnswer: 'Category A' }],
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={1}
        answer={[]}
        onChange={() => {}}
        tabletMode
        compactPane
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Category selection for question 1' });
    expect(select).toHaveClass('w-full');
    expect(select).toHaveClass('min-w-0');
    expect(select).not.toHaveClass('min-w-[11rem]');
  });

  it('uses accessibility typography classes for table completion content', () => {
    const block: TableCompletionBlock = {
      id: 'table-1',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      headers: ['Metric', 'Value'],
      rows: [
        ['Temperature', ''],
        ['Humidity', 'High'],
      ],
      cells: [
        { id: 'cell-1', row: 0, col: 1, correctAnswer: 'Warm' },
      ],
      answerRule: 'ONE_WORD',
    };

    const { container } = render(
      <QuestionRenderer
        question={null}
        block={block}
        number={21}
        answer={['']}
        onChange={() => {}}
      />,
    );

    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(table).toHaveClass('text-[length:var(--student-control-font-size)]');
    expect(table).not.toHaveClass('text-sm');
    expect(screen.getByRole('columnheader', { name: 'Metric' })).toBeInTheDocument();
    expect(screen.getByText('Humidity')).toBeInTheDocument();

    const answerInput = screen.getByRole('textbox', { name: 'Answer for question 21' });
    expect(answerInput).toHaveClass('text-[length:var(--student-control-font-size)]');
    expect(answerInput).not.toHaveClass('text-sm');
  });

  it('renders table placeholder token as inline numbered input and preserves surrounding text', () => {
    const block: TableCompletionBlock = {
      id: 'table-prompt',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      headers: ['Item', 'Details'],
      rows: [['Special dietary requirements:', 'no _______ (red)']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: 'nuts' }],
      answerRule: 'ONE_WORD',
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={5}
        answer={['']}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText(/no/i)).toBeInTheDocument();
    expect(screen.getByText(/\(red\)/i)).toBeInTheDocument();
    expect(screen.queryByText('no _______ (red)')).not.toBeInTheDocument();
    expect(screen.getByText('5.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 5' })).toBeInTheDocument();
  });

  it('replaces authored underscore placeholder token inside table completion slot cells', () => {
    const block: TableCompletionBlock = {
      id: 'table-no-badge',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      headers: ['Item', 'Details'],
      rows: [['Special dietary requirements:', 'no _______ (red)']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: 'nuts' }],
      answerRule: 'ONE_WORD',
    };

    const { container } = render(
      <QuestionRenderer
        question={null}
        block={block}
        number={5}
        answer={['']}
        onChange={() => {}}
      />,
    );

    const slotCell = container.querySelector('#question-table-no-badge\\:cell-1');
    expect(slotCell).not.toBeNull();
    expect(slotCell).toHaveTextContent('no');
    expect(slotCell).toHaveTextContent('(red)');
    expect(slotCell).not.toHaveTextContent('_______');
    expect(slotCell).toHaveTextContent('5.');
  });

  it('emits slot metadata for table completion edits so shared answer keys persist per question slot', () => {
    const onChange = vi.fn();
    const block: TableCompletionBlock = {
      id: 'table-meta',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      headers: ['Metric', 'Value'],
      rows: [
        ['Temperature', ''],
        ['Humidity', ''],
      ],
      cells: [
        { id: 'cell-1', row: 0, col: 1, correctAnswer: 'Warm' },
        { id: 'cell-2', row: 1, col: 1, correctAnswer: 'High' },
      ],
      answerRule: 'ONE_WORD',
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={11}
        answer={['', '']}
        onChange={onChange}
        slotIds={['table-meta:cell-1', 'table-meta:cell-2']}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 12' }), {
      target: { value: 'HIGH' },
    });

    expect(onChange).toHaveBeenLastCalledWith(
      ['', 'HIGH'],
      expect.objectContaining({
        slotIndex: 1,
        slotId: 'table-meta:cell-2',
        slotCount: 2,
        slotValue: 'HIGH',
      }),
    );
  });

  it('renders multiple placeholders in a single table cell as separate answer slots', () => {
    const block: TableCompletionBlock = {
      id: 'table-multi-slot',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      headers: ['Item', 'Details'],
      rows: [['Special dietary requirements:', 'no _______ (red), _______ (green)']],
      cells: [
        { id: 'cell-a', row: 0, col: 1, placeholderIndex: 0, correctAnswer: 'nuts' },
        { id: 'cell-b', row: 0, col: 1, placeholderIndex: 1, correctAnswer: 'fish' },
      ],
      answerRule: 'ONE_WORD',
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={5}
        answer={['NUTS', 'FISH']}
        onChange={() => {}}
        slotIds={['table-multi-slot:cell-a', 'table-multi-slot:cell-b']}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Answer for question 5' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 6' })).toBeInTheDocument();
    expect((screen.getByRole('textbox', { name: 'Answer for question 5' }) as HTMLInputElement).value).toBe('NUTS');
    expect((screen.getByRole('textbox', { name: 'Answer for question 6' }) as HTMLInputElement).value).toBe('FISH');
  });

  it('renders multiple placeholders even when table cell placeholderIndex metadata is missing', () => {
    const block: TableCompletionBlock = {
      id: 'table-multi-slot-legacy',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      headers: ['Item', 'Details'],
      rows: [['Special dietary requirements:', 'no _______ (red), _______ (green)']],
      cells: [
        { id: 'cell-a', row: 0, col: 1, correctAnswer: 'nuts' },
        { id: 'cell-b', row: 0, col: 1, correctAnswer: 'fish' },
      ],
      answerRule: 'ONE_WORD',
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={5}
        answer={['NUTS', 'FISH']}
        onChange={() => {}}
        slotIds={['table-multi-slot-legacy:cell-a', 'table-multi-slot-legacy:cell-b']}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Answer for question 5' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 6' })).toBeInTheDocument();
    expect((screen.getByRole('textbox', { name: 'Answer for question 5' }) as HTMLInputElement).value).toBe('NUTS');
    expect((screen.getByRole('textbox', { name: 'Answer for question 6' }) as HTMLInputElement).value).toBe('FISH');
  });

  it('keeps non-slot table cells rendered as plain text', () => {
    const block: TableCompletionBlock = {
      id: 'table-nonslot',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      headers: ['Metric', 'Value'],
      rows: [
        ['Temperature', 'no _______ (red)'],
        ['Humidity', 'High'],
      ],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: 'Warm' }],
      answerRule: 'ONE_WORD',
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={9}
        answer={['']}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText('Humidity')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 9' })).toBeInTheDocument();
  });

  it('does not show decorative option tags for matching feature questions', () => {
    const block: MatchingFeaturesBlock = {
      id: 'features-1',
      type: 'MATCHING_FEATURES',
      instruction: 'Match each feature.',
      options: ['Writer A', 'Writer B'],
      features: [
        { id: 'feature-1', text: 'First feature', correctAnswer: 'Writer A' },
      ],
    };

    const { container } = render(
      <QuestionRenderer
        question={null}
        block={block}
        number={1}
        answer={[]}
        onChange={() => {}}
      />,
    );

    expect(container.querySelector('.rounded-full.bg-gray-100')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Matching selection for question 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Writer A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Writer B' })).toBeInTheDocument();
  });

  it('allows jumping to another part from the footer progress pill', () => {
    const onNavigate = vi.fn();

    render(
      <StudentFooter
        questions={[
          {
            id: 'q1',
            blockId: 'q1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            isMulti: false,
            correctCount: 1,
          },
          {
            id: 'q2',
            blockId: 'q2',
            groupId: 'group-2',
            groupLabel: 'Section 2',
            isMulti: false,
            correctCount: 1,
          },
        ]}
        currentQuestionId="q1"
        onNavigate={onNavigate}
        answers={{}}
        onSubmit={() => {}}
      />,
    );

    const jumpButton = screen.getByRole('button', { name: 'Jump to Part 2' });
    expect(jumpButton).toHaveTextContent('0/1');
    expect(jumpButton).toHaveTextContent('Part 2');

    fireEvent.click(jumpButton);
    expect(onNavigate).toHaveBeenCalledWith('q2');
  });

  it('renders semantic checkbox inputs for multi-select questions', () => {
    const block: MultiMCQBlock = {
      id: 'multi-1',
      type: 'MULTI_MCQ',
      instruction: 'Choose two options.',
      stem: 'Pick two answers',
      requiredSelections: 2,
      options: [
        { id: 'a', text: 'Answer A', isCorrect: true },
        { id: 'b', text: 'Answer B', isCorrect: true },
        { id: 'c', text: 'Answer C', isCorrect: false },
      ],
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={1}
        answer={[]}
        onChange={() => {}}
      />,
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('renders SINGLE_MCQ using question-level stem/options when questions[] is present', () => {
    const block: SingleMCQBlock = {
      id: 'single-block-1',
      type: 'SINGLE_MCQ',
      instruction: 'Choose one answer for each question.',
      stem: 'legacy fallback stem',
      options: [
        { id: 'legacy-a', text: 'Legacy A', isCorrect: true },
        { id: 'legacy-b', text: 'Legacy B', isCorrect: false },
      ],
      questions: [
        {
          id: 'single-q1',
          stem: 'First single-choice question?',
          options: [
            { id: 'q1-a', text: 'Q1 Option A', isCorrect: true },
            { id: 'q1-b', text: 'Q1 Option B', isCorrect: false },
          ],
        },
        {
          id: 'single-q2',
          stem: 'Second single-choice question?',
          options: [
            { id: 'q2-a', text: 'Q2 Option A', isCorrect: false },
            { id: 'q2-b', text: 'Q2 Option B', isCorrect: true },
          ],
        },
      ],
    };

    const { rerender } = render(
      <QuestionRenderer
        question={block.questions![0]!}
        block={block}
        number={8}
        answer="q1-b"
        onChange={() => {}}
      />,
    );

    expect(screen.getByText('First single-choice question?')).toBeInTheDocument();
    expect(screen.getByText('Q1 Option A')).toBeInTheDocument();
    expect(screen.queryByText('Q2 Option A')).not.toBeInTheDocument();
    const firstNames = screen
      .getAllByRole('radio')
      .map((node) => node.getAttribute('name'));
    expect(firstNames.every((name) => name === 'q-single-q1')).toBe(true);

    rerender(
      <QuestionRenderer
        question={block.questions![1]!}
        block={block}
        number={9}
        answer="q2-a"
        onChange={() => {}}
      />,
    );

    expect(screen.getByText('Second single-choice question?')).toBeInTheDocument();
    expect(screen.getByText('Q2 Option B')).toBeInTheDocument();
    const secondNames = screen
      .getAllByRole('radio')
      .map((node) => node.getAttribute('name'));
    expect(secondNames.every((name) => name === 'q-single-q2')).toBe(true);
  });

  it('renders sentence completion blanks instead of an unimplemented placeholder', () => {
    const question = {
      id: 'sentence-1',
      sentence: 'The library is open ____ and ____.',
      blanks: [
        { id: 'blank-1', correctAnswer: 'daily', position: 0 },
        { id: 'blank-2', correctAnswer: 'late', position: 1 },
      ],
      answerRule: 'TWO_WORDS' as const,
    };

    const block: SentenceCompletionBlock = {
      id: 'sentence-block-1',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete the sentence.',
      questions: [question],
    };

    render(
      <QuestionRenderer
        question={question}
        block={block}
        number={7}
        answer={['', '']}
        onChange={() => {}}
      />,
    );

    expect(screen.queryByText(/not yet implemented/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.queryByText(/limit:/i)).not.toBeInTheDocument();
  });

  it('renders sentence completion slot numbers from slotNumbers when provided', () => {
    const question = {
      id: 'sentence-1',
      sentence: 'The library is open ____ and ____.',
      blanks: [
        { id: 'blank-1', correctAnswer: 'daily', position: 0 },
        { id: 'blank-2', correctAnswer: 'late', position: 1 },
      ],
      answerRule: 'TWO_WORDS' as const,
    };

    const block: SentenceCompletionBlock = {
      id: 'sentence-block-1',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete the sentence.',
      questions: [question],
    };

    render(
      <QuestionRenderer
        question={question}
        block={block}
        number={35}
        answer={['', '']}
        onChange={() => {}}
        slotIds={['sentence-slot-a', 'sentence-slot-b']}
        slotNumbers={[35, 35]}
      />,
    );

    const firstSlot = document.getElementById('question-sentence-slot-a');
    const secondSlot = document.getElementById('question-sentence-slot-b');

    expect(firstSlot).not.toBeNull();
    expect(secondSlot).not.toBeNull();
    expect(firstSlot).toHaveTextContent('35');
    expect(secondSlot).toHaveTextContent('35');
  });

  it('renders diagram-labeling answers below a sticky diagram reference', () => {
    const onChange = vi.fn();
    const block: DiagramLabelingBlock = {
      id: 'diagram-1',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label the diagram.',
      imageUrl: '/diagram.jpg',
      labels: [
        { id: 'label-a', x: 25, y: 35, correctAnswer: 'engine' },
        { id: 'label-b', x: 70, y: 62, correctAnswer: 'wheel' },
      ],
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={12}
        answer={['existing', '']}
        onChange={onChange}
        slotIds={['diagram-1:label-a', 'diagram-1:label-b']}
        currentQuestionId="diagram-1:label-a"
      />,
    );

    expect(screen.getByAltText('Diagram reference')).toBeInTheDocument();
    expect(screen.getByTestId('diagram-sticky-reference')).toHaveClass('sticky');
    expect(screen.getByTestId('diagram-answer-panel')).toBeInTheDocument();
    expect(screen.getByText('Answers')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 12' })).toHaveValue('existing');
    expect(screen.getByRole('textbox', { name: 'Answer for question 13' })).toBeInTheDocument();
    const firstSlot = document.getElementById('question-diagram-1:label-a');
    expect(firstSlot).not.toBeNull();
    expect(firstSlot?.firstElementChild).toHaveTextContent(/label 1/i);
    expect(within(firstSlot as HTMLElement).getByText(/label 1/i)).toHaveClass('text-[length:var(--student-meta-font-size)]');

    const secondSlot = document.getElementById('question-diagram-1:label-b');
    expect(secondSlot).not.toBeNull();
    expect(secondSlot?.firstElementChild).toHaveTextContent(/label 2/i);
    expect(within(secondSlot as HTMLElement).getByText(/label 2/i)).toHaveClass('text-[length:var(--student-meta-font-size)]');

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 13' }), {
      target: { value: 'wheel' },
    });

    expect(onChange).toHaveBeenCalledWith(
      ['existing', 'wheel'],
      expect.objectContaining({
        slotIndex: 1,
        slotId: 'diagram-1:label-b',
        slotCount: 2,
        slotValue: 'wheel',
      }),
    );
  });

  it('shows diagram-labeling fallback fields with authored prompt text and fallback labels', () => {
    const block: DiagramLabelingBlock = {
      id: 'diagram-1',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label the diagram.',
      imageUrl: '',
      labels: [
        { id: 'label-a', x: 25, y: 35, prompt: 'Engine label', correctAnswer: 'engine' },
        { id: 'label-b', x: 70, y: 62, correctAnswer: 'wheel' },
      ],
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={12}
        answer={['', '']}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText(/image url is missing or inaccessible/i)).toBeInTheDocument();
    screen.getByRole('textbox', { name: 'Answer for question 12' });
    expect(screen.getByRole('textbox', { name: 'Answer for question 13' })).toBeInTheDocument();
    const firstSlot = document.getElementById('question-diagram-1:label-a');
    expect(firstSlot).not.toBeNull();
    expect(firstSlot?.firstElementChild).toHaveTextContent(/engine label/i);
    expect(within(firstSlot as HTMLElement).getByText(/engine label/i)).toHaveClass('text-[length:var(--student-meta-font-size)]');

    const secondSlot = document.getElementById('question-diagram-1:label-b');
    expect(secondSlot).not.toBeNull();
    expect(secondSlot?.firstElementChild).toHaveTextContent(/label 2/i);
    expect(within(secondSlot as HTMLElement).getByText(/label 2/i)).toHaveClass('text-[length:var(--student-meta-font-size)]');
  });

  it('can render diagram-labeling answers without duplicating the diagram reference', () => {
    const block: DiagramLabelingBlock = {
      id: 'diagram-1',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label the diagram.',
      imageUrl: '/diagram.jpg',
      labels: [
        { id: 'label-a', x: 25, y: 35, correctAnswer: 'engine' },
        { id: 'label-b', x: 70, y: 62, correctAnswer: 'wheel' },
      ],
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={12}
        answer={['', '']}
        onChange={() => {}}
        hideDiagramReference
      />,
    );

    expect(screen.queryByAltText('Diagram reference')).not.toBeInTheDocument();
    expect(screen.getByTestId('diagram-answer-panel')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 12' })).toBeInTheDocument();
  });

  it('renders uploaded reading pictures in a sticky wrapper on desktop', () => {
    const state = {
      title: 'Reading Test',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: false, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['TFNG'] },
          reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['TFNG'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['TFNG'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['TFNG'] },
        },
      },
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'Read the diagram.',
            images: [
              {
                id: 'img-1',
                src: '/uploaded-picture.jpg',
                alt: 'Uploaded diagram',
                annotations: [],
                crop: { x: 0, y: 0, width: 100, height: 100 },
                height: 600,
                width: 800,
                zoom: 1,
              },
            ],
            blocks: [
              {
                id: 'q-block',
                type: 'SHORT_ANSWER',
                instruction: 'Answer.',
                questions: [{ id: 'q1', prompt: 'What is shown?', correctAnswer: 'diagram', answerRule: 'ONE_WORD' }],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    } as ExamState;

    render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
      />,
    );

    const image = screen.getByAltText('Uploaded diagram');
    const mediaWrapper = image.closest('.overflow-hidden.rounded-2xl');
    expect(mediaWrapper).not.toBeNull();
  });

  it('uses accessibility typography variables for the reading passage panel', () => {
    const state = {
      title: 'Reading Test',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: false, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Accessible Passage',
            content: '<h1>Main heading</h1><p>Read the passage text.</p><ul><li>First point</li></ul>',
            images: [],
            blocks: [
              {
                id: 'q-block',
                type: 'SHORT_ANSWER',
                instruction: 'Answer.',
                questions: [{ id: 'q1', prompt: 'What is shown?', correctAnswer: 'passage', answerRule: 'ONE_WORD' }],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    } as ExamState;

    const { container } = render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
      />,
    );

    const passageTitle = screen.getByRole('heading', { name: 'Accessible Passage' });
    const passagePanel = passageTitle.parentElement;

    expect(passagePanel).toHaveStyle({
      fontSize: 'var(--student-passage-font-size)',
      lineHeight: 'var(--student-passage-line-height)',
    });
    expect(passagePanel?.className).not.toContain('text-sm');
    expect(passagePanel?.className).not.toContain('md:text-base');
    expect(passageTitle).toHaveStyle({ fontSize: 'var(--student-passage-title-font-size)' });
    expect(passageTitle.nextElementSibling?.className).toContain('--student-passage-h1-font-size');

    const readingHighlighters = passagePanel?.querySelectorAll('[data-student-highlightable="true"]') ?? [];
    const readingHighlighter = readingHighlighters[readingHighlighters.length - 1] ?? null;
    expect(readingHighlighter).not.toBeNull();
    expect(readingHighlighter).toHaveClass('whitespace-pre-wrap');
    expect(readingHighlighter?.className).not.toContain('break-words');
    expect(readingHighlighter?.className).not.toContain('[overflow-wrap:anywhere]');
  });

  it('routes table completion changes through student reading with shared answer key slot metadata', () => {
    const onAnswerChange = vi.fn();
    const state = {
      title: 'Reading Test',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: false, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['TABLE_COMPLETION'] },
          reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['TABLE_COMPLETION'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['TABLE_COMPLETION'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['TABLE_COMPLETION'] },
        },
      },
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'Complete the table.',
            images: [],
            blocks: [
              {
                id: 'table-block-1',
                type: 'TABLE_COMPLETION',
                instruction: 'Fill the blanks.',
                headers: ['A', 'B'],
                rows: [
                  ['x', ''],
                  ['y', ''],
                ],
                cells: [
                  { id: 'cell-1', row: 0, col: 1, correctAnswer: 'ONE' },
                  { id: 'cell-2', row: 1, col: 1, correctAnswer: 'TWO' },
                ],
                answerRule: 'ONE_WORD',
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    } as ExamState;

    render(
      <StudentReading
        state={state}
        answers={{ 'table-block-1': ['', ''] }}
        onAnswerChange={onAnswerChange}
        currentQuestionId="table-block-1:cell-2"
        onNavigate={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 2' }), {
      target: { value: 'TWO' },
    });

    expect(onAnswerChange).toHaveBeenLastCalledWith(
      'table-block-1',
      ['', 'TWO'],
      expect.objectContaining({
        slotIndex: 1,
        slotId: 'table-block-1:cell-2',
        slotCount: 2,
      }),
    );
  });

  it('keeps reading split-screen side by side in tablet mode with simple highlight guidance', () => {
    const state = {
      title: 'Reading Test',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: false, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'Read this passage carefully.',
            images: [],
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question.',
                questions: [{ id: 'reading-q1', prompt: 'What?', correctAnswer: 'answer', answerRule: 'ONE_WORD' }],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    } as ExamState;

    render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="reading-q1"
        onNavigate={() => {}}
        tabletMode
        highlightEnabled
      />,
    );

    const workspace = screen.getByTestId('reading-split-workspace');
    expect(workspace).toHaveClass('flex-row');
    expect(workspace).toHaveStyle({
      '--reading-pane-width': '40%',
      '--question-pane-width': 'calc(60%)',
      '--split-divider-width': '32px',
    });
    expect(screen.getByTestId('reading-pane-resizer')).toBeInTheDocument();
    expect(screen.getByTestId('reading-pane-resizer')).toHaveClass('w-11');
    expect(screen.getByTestId('reading-pane-resizer')).toHaveClass('absolute');
    expect(screen.getByTestId('reading-pane-resizer').querySelector('.w-14')).toBeInTheDocument();
    expect(screen.getByTestId('reading-pane-resizer').querySelector('.h-\\[5\\.5rem\\]')).toBeInTheDocument();
    expect(workspace.querySelector('.min-w-\\[48px\\]')).toBeInTheDocument();
    expect(screen.queryByTestId('reading-split-presets')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set split to material wider/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set split to equal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set split to answers wider/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Material wider')).not.toBeInTheDocument();
    expect(screen.queryByText('Equal')).not.toBeInTheDocument();
    expect(screen.queryByText('Answers wider')).not.toBeInTheDocument();
    expect(screen.queryByText(/select passage text to highlight it/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /highlight selected text/i })).not.toBeInTheDocument();

    const readingWorkspaceRect = vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({
      bottom: 600,
      height: 600,
      left: 100,
      right: 900,
      top: 0,
      width: 800,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.mouseDown(screen.getByTestId('reading-pane-resizer'), { clientX: 420 });
    fireEvent.mouseMove(document, { clientX: 580 });
    fireEvent.mouseUp(document);
    expect(workspace).toHaveStyle({
      '--reading-pane-width': '60%',
      '--question-pane-width': 'calc(40%)',
    });

    fireEvent.mouseDown(screen.getByTestId('reading-pane-resizer'), { clientX: 580 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);
    expect(workspace).toHaveStyle({
      '--reading-pane-width': '6%',
      '--question-pane-width': 'calc(94%)',
    });

    readingWorkspaceRect.mockReturnValue({
      bottom: 600,
      height: 600,
      left: 100,
      right: 1700,
      top: 0,
      width: 1600,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.mouseDown(screen.getByTestId('reading-pane-resizer'), { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 1800 });
    fireEvent.mouseUp(document);
    expect(workspace).toHaveStyle({
      '--reading-pane-width': '97%',
      '--question-pane-width': 'calc(3%)',
    });
    expect(screen.getByTestId('reading-question-scroll')).toHaveClass('p-2.5');
    expect(screen.getByTestId('reading-question-scroll')).toHaveClass('md:p-3');
  });

  it('allows desktop reading split drag to reach near-boundary widths', () => {
    const state = {
      title: 'Reading Test',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: false, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'Read this passage carefully.',
            images: [],
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question.',
                questions: [{ id: 'reading-q1', prompt: 'What?', correctAnswer: 'answer', answerRule: 'ONE_WORD' }],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    } as ExamState;

    render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="reading-q1"
        onNavigate={() => {}}
      />,
    );

    const workspace = screen.getByTestId('reading-split-workspace');
    const resizer = screen.getByTestId('reading-pane-resizer');
    expect(workspace).toHaveStyle({
      '--reading-pane-width': '40%',
      '--question-pane-width': 'calc(60% - var(--split-divider-width))',
      '--split-divider-width': '16px',
    });

    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({
      bottom: 600,
      height: 600,
      left: 100,
      right: 900,
      top: 0,
      width: 800,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(resizer, { clientX: 420 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);
    expect(workspace).toHaveStyle({
      '--reading-pane-width': '6%',
      '--question-pane-width': 'calc(94% - var(--split-divider-width))',
    });

    fireEvent.mouseDown(resizer, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 1800 });
    fireEvent.mouseUp(document);
    expect(workspace).toHaveStyle({
      '--reading-pane-width': '92%',
      '--question-pane-width': 'calc(8% - var(--split-divider-width))',
    });
  });

  it('hides single reading question headings and keeps multi-question range headings', () => {
    const state = {
      title: 'Reading Test',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: false, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'Read the passage.',
            images: [],
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer questions 1 to 10.',
                questions: Array.from({ length: 10 }, (_, index) => ({
                  id: `reading-pre-${index + 1}`,
                  prompt: `Question ${index + 1}`,
                  correctAnswer: 'answer',
                  answerRule: 'ONE_WORD',
                })),
              },
              {
                id: 'reading-block-2',
                type: 'SHORT_ANSWER',
                instruction: 'Answer question 11.',
                questions: [{ id: 'reading-q11', prompt: 'Single question?', correctAnswer: 'yes', answerRule: 'ONE_WORD' }],
              },
              {
                id: 'reading-block-3',
                type: 'SHORT_ANSWER',
                instruction: 'Answer questions 12 and 13.',
                questions: [
                  { id: 'reading-q12', prompt: 'First multi?', correctAnswer: 'yes', answerRule: 'ONE_WORD' },
                  { id: 'reading-q13', prompt: 'Second multi?', correctAnswer: 'yes', answerRule: 'ONE_WORD' },
                ],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    } as ExamState;

    render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="reading-q11"
        onNavigate={() => {}}
      />,
    );

    expect(screen.queryByText('Questions 11')).not.toBeInTheDocument();
    expect(screen.queryByText('Questions 11–11')).not.toBeInTheDocument();
    expect(screen.getByText('Questions 12–13')).toBeInTheDocument();
    expect(screen.getByText('Answer question 11.')).toBeInTheDocument();
  });

  it('hides single listening question headings and keeps multi-question range headings', () => {
    const state = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: true, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          reading: { enabled: false, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '/audio/test.mp3',
            transcript: 'Listen and answer.',
            pins: [],
            blocks: [
              {
                id: 'listening-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer questions 1 to 10.',
                questions: Array.from({ length: 10 }, (_, index) => ({
                  id: `listening-pre-${index + 1}`,
                  prompt: `Question ${index + 1}`,
                  correctAnswer: 'answer',
                  answerRule: 'ONE_WORD',
                })),
              },
              {
                id: 'listening-block-2',
                type: 'SHORT_ANSWER',
                instruction: 'Answer question 11.',
                questions: [{ id: 'listening-q11', prompt: 'Single question?', correctAnswer: 'yes', answerRule: 'ONE_WORD' }],
              },
              {
                id: 'listening-block-3',
                type: 'SHORT_ANSWER',
                instruction: 'Answer questions 12 and 13.',
                questions: [
                  { id: 'listening-q12', prompt: 'First multi?', correctAnswer: 'yes', answerRule: 'ONE_WORD' },
                  { id: 'listening-q13', prompt: 'Second multi?', correctAnswer: 'yes', answerRule: 'ONE_WORD' },
                ],
              },
            ],
          },
        ],
      },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    } as ExamState;

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="listening-q11"
        onNavigate={() => {}}
      />,
    );

    expect(screen.queryByText('Questions 11')).not.toBeInTheDocument();
    expect(screen.queryByText('Questions 11–11')).not.toBeInTheDocument();
    expect(screen.getByText('Questions 12–13')).toBeInTheDocument();
    expect(screen.getByText('Answer question 11.')).toBeInTheDocument();
  });

  it('opens the question navigator from the header when the control is available', () => {
    const onOpenNavigator = vi.fn();

    render(
      <StudentHeader
        timeRemaining={1200}
        onOpenNavigator={onOpenNavigator}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /open question navigator/i }));

    expect(onOpenNavigator).toHaveBeenCalledTimes(1);
  });

  it('wires zoom controls from the header', () => {
    const onOpenAccessibility = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomReset = vi.fn();

    render(
      <StudentHeader
        timeRemaining={1200}
        zoom={1.25}
        onOpenAccessibility={onOpenAccessibility}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
      />,
    );

    expect(screen.getByTestId('zoom-controls')).toHaveClass('w-[11.5rem]');
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('125%');
    expect(screen.getByText('125%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /zoom out/i }));
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    fireEvent.click(screen.getByRole('button', { name: /reset zoom/i }));
    fireEvent.click(screen.getByRole('button', { name: /open accessibility settings/i }));

    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomReset).toHaveBeenCalledTimes(1);
    expect(onOpenAccessibility).toHaveBeenCalledTimes(1);
  });

  it('renders tablet zoom controls in the header', () => {
    const onOpenAccessibility = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomReset = vi.fn();

    render(
      <StudentHeader
        timeRemaining={1200}
        tabletMode
        zoom={1.1}
        onOpenAccessibility={onOpenAccessibility}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
      />,
    );

    expect(screen.queryByTestId('zoom-controls')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open zoom controls/i })).toHaveTextContent('Zoom');
    fireEvent.click(screen.getByRole('button', { name: /open zoom controls/i }));

    const zoomPanel = screen.getByRole('dialog', { name: /zoom controls/i });
    expect(within(zoomPanel).getByTestId('zoom-controls')).toBeInTheDocument();
    expect(zoomPanel.parentElement).toBe(document.body);
    expect(zoomPanel).toHaveClass('z-[90]');

    fireEvent.click(within(zoomPanel).getByRole('button', { name: /zoom in/i }));
    fireEvent.click(screen.getByRole('button', { name: /open accessibility settings/i }));

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onOpenAccessibility).toHaveBeenCalledTimes(1);
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(onZoomReset).not.toHaveBeenCalled();
  });

  it('keeps the timer anchored in the same center slot regardless of module-specific controls', () => {
    const onOpenAccessibility = vi.fn();
    const onOpenNavigator = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomReset = vi.fn();

    const { rerender } = render(
      <StudentHeader
        timeRemaining={1200}
        onOpenAccessibility={onOpenAccessibility}
      />,
    );

    const writingHeader = screen.getByRole('banner');
    const writingTimerSlot = screen.getByTestId('student-header-timer-slot');
    const timerSlotClassName = writingTimerSlot.className;

    expect(writingHeader).toHaveClass('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]');
    expect(writingTimerSlot).toHaveClass('justify-self-center');
    expect(screen.queryByRole('button', { name: /open question navigator/i })).not.toBeInTheDocument();

    rerender(
      <StudentHeader
        timeRemaining={1200}
        zoom={1}
        onOpenAccessibility={onOpenAccessibility}
        onOpenNavigator={onOpenNavigator}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
      />,
    );

    const readingTimerSlot = screen.getByTestId('student-header-timer-slot');
    expect(readingTimerSlot.className).toBe(timerSlotClassName);
    expect(screen.getByRole('button', { name: /open question navigator/i })).toBeInTheDocument();
  });

  it('wires the listening transport controls to the audio element', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => {});

    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: {
            enabled: true,
            order: 1,
            duration: 30,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          reading: {
            enabled: false,
            order: 2,
            duration: 60,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          writing: {
            enabled: false,
            order: 3,
            duration: 60,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          speaking: {
            enabled: false,
            order: 4,
            duration: 15,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '/audio/test.mp3',
            transcript: '',
            pins: [],
            blocks: [
              {
                id: 'tfng-1',
                type: 'TFNG',
                instruction: 'Answer the question.',
                mode: 'TFNG',
                questions: [
                  {
                    id: 'q1',
                    statement: 'The statement is true.',
                    correctAnswer: 'T',
                  },
                ],
              },
            ],
          },
        ],
      },
      writing: {
        task1Prompt: '',
        task2Prompt: '',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
      />,
    );

    const audio = document.querySelector('audio');
    expect(audio).not.toBeNull();
    Object.defineProperty(audio as HTMLAudioElement, 'duration', {
      configurable: true,
      value: 343,
    });
    Object.defineProperty(audio as HTMLAudioElement, 'currentTime', {
      configurable: true,
      writable: true,
      value: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: /play audio/i }));
    expect(play).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole('button', { name: /pause audio/i }));
    expect(pause).toHaveBeenCalledTimes(1);

    const volume = screen.getByLabelText(/audio volume/i);
    fireEvent.change(volume, { target: { value: '35' } });
    expect((audio as HTMLAudioElement).volume).toBeCloseTo(0.35);

    const progressbar = screen.getByTestId('listening-progress-track');
    Object.defineProperty(progressbar, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 200,
        height: 8,
        right: 200,
        bottom: 8,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.click(progressbar, { clientX: 100 });
    expect((audio as HTMLAudioElement).currentTime).toBeCloseTo(171.5);

    (audio as HTMLAudioElement).currentTime = 120;
    fireEvent.timeUpdate(audio as HTMLAudioElement);

    const trackPanel = screen.getByText('Listening Audio Track').closest('div');
    expect(trackPanel).not.toBeNull();
    expect(within(trackPanel as HTMLElement).getByText('02:00')).toBeInTheDocument();
  });

  it('moves the listening flag control into reserved inline space in tablet mode', () => {
    const onToggleFlag = vi.fn();

    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: {
            enabled: true,
            order: 1,
            duration: 30,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          reading: {
            enabled: false,
            order: 2,
            duration: 60,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          writing: {
            enabled: false,
            order: 3,
            duration: 60,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          speaking: {
            enabled: false,
            order: 4,
            duration: 15,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '/audio/test.mp3',
            transcript: '',
            pins: [],
            blocks: [
              {
                id: 'tfng-1',
                type: 'TFNG',
                instruction: 'Answer the question.',
                mode: 'TFNG',
                questions: [
                  {
                    id: 'q1',
                    statement: 'The statement is true.',
                    correctAnswer: 'T',
                  },
                ],
              },
            ],
          },
        ],
      },
      writing: {
        task1Prompt: '',
        task2Prompt: '',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
        flags={{ q1: true }}
        onToggleFlag={onToggleFlag}
        tabletMode
      />,
    );

    const flagButton = screen.getByRole('button', { name: /unflag question/i });
    expect(flagButton).toHaveClass('inline-flex');
    expect(flagButton).not.toHaveClass('absolute');

    fireEvent.click(flagButton);
    expect(onToggleFlag).toHaveBeenCalledWith('q1');
  });

  it('disables the listening audio player when staff turns off audio playback', () => {
    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: {
            enabled: true,
            order: 1,
            duration: 30,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
            audioPlaybackEnabled: false,
            staffInstructions: 'Use the invigilator audio system.',
          },
          reading: {
            enabled: false,
            order: 2,
            duration: 60,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          writing: {
            enabled: false,
            order: 3,
            duration: 60,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
          speaking: {
            enabled: false,
            order: 4,
            duration: 15,
            autoContinue: true,
            allowedQuestionTypes: ['TFNG'],
          },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '/audio/test.mp3',
            transcript: '',
            pins: [],
            blocks: [
              {
                id: 'tfng-1',
                type: 'TFNG',
                instruction: 'Answer the question.',
                mode: 'TFNG',
                questions: [
                  {
                    id: 'q1',
                    statement: 'The statement is true.',
                    correctAnswer: 'T',
                  },
                ],
              },
            ],
          },
        ],
      },
      writing: {
        task1Prompt: '',
        task2Prompt: '',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
      />,
    );

    expect(document.querySelector('audio')).toBeNull();
    expect(screen.queryByText(/staff instructions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/use the invigilator audio system/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/listening audio track/i)).toBeNull();
  });

  it('keeps listening split-screen side by side in tablet mode and shows question instructions', () => {
    const longInstruction = 'Answer the question using the words you hear. '.repeat(6);
    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: {
            enabled: true,
            order: 1,
            duration: 30,
            autoContinue: true,
            allowedQuestionTypes: ['SHORT_ANSWER'],
            audioPlaybackEnabled: false,
            staffInstructions: 'Use the invigilator audio system.',
          },
          reading: { enabled: false, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '',
            transcript: 'Reference transcript text.',
            pins: [],
            blocks: [
              {
                id: 'listening-block-1',
                type: 'SHORT_ANSWER',
                instruction: longInstruction,
                questions: [{ id: 'q1', prompt: 'What?', correctAnswer: 'answer', answerRule: 'ONE_WORD' }],
              },
            ],
          },
        ],
      },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
        tabletMode
        highlightEnabled
      />,
    );

    const transcriptReference = screen.getByText('Reference transcript text.');
    const transcriptHighlighter = transcriptReference.closest('[data-student-highlightable="true"]');
    expect(transcriptHighlighter).not.toBeNull();
    expect(transcriptHighlighter).toHaveClass('student-accessible-table-typography');

    const workspace = screen.getByTestId('listening-split-workspace');
    expect(workspace).toHaveClass('flex-row');
    expect(workspace).toHaveStyle({
      '--listening-pane-width': '40%',
      '--question-pane-width': 'calc(60%)',
      '--split-divider-width': '32px',
    });
    expect(screen.getByTestId('listening-pane-resizer')).toBeInTheDocument();
    expect(screen.queryByText(/staff instructions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/use the invigilator audio system/i)).not.toBeInTheDocument();
    expect(screen.getByText(/answer the question using the words you hear/i)).toBeInTheDocument();
    expect(screen.getByTestId('listening-pane-resizer')).toHaveClass('w-11');
    expect(screen.getByTestId('listening-pane-resizer')).toHaveClass('absolute');
    expect(screen.getByTestId('listening-pane-resizer').querySelector('.w-14')).toBeInTheDocument();
    expect(screen.getByTestId('listening-pane-resizer').querySelector('.h-\\[5\\.5rem\\]')).toBeInTheDocument();
    expect(workspace.querySelector('.min-w-\\[48px\\]')).toBeInTheDocument();
    expect(screen.queryByTestId('listening-split-presets')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set split to material wider/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set split to equal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /set split to answers wider/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Material wider')).not.toBeInTheDocument();
    expect(screen.queryByText('Equal')).not.toBeInTheDocument();
    expect(screen.queryByText('Answers wider')).not.toBeInTheDocument();
    expect(screen.queryByText(/select reference text to highlight it/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /highlight selected text/i })).not.toBeInTheDocument();

    const listeningWorkspaceRect = vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({
      bottom: 600,
      height: 600,
      left: 100,
      right: 900,
      top: 0,
      width: 800,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.mouseDown(screen.getByTestId('listening-pane-resizer'), { clientX: 420 });
    fireEvent.mouseMove(document, { clientX: 580 });
    fireEvent.mouseUp(document);
    expect(workspace).toHaveStyle({
      '--listening-pane-width': '60%',
      '--question-pane-width': 'calc(40%)',
    });

    fireEvent.mouseDown(screen.getByTestId('listening-pane-resizer'), { clientX: 580 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);
    expect(workspace).toHaveStyle({
      '--listening-pane-width': '6%',
      '--question-pane-width': 'calc(94%)',
    });

    listeningWorkspaceRect.mockReturnValue({
      bottom: 600,
      height: 600,
      left: 100,
      right: 1700,
      top: 0,
      width: 1600,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.mouseDown(screen.getByTestId('listening-pane-resizer'), { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 1800 });
    fireEvent.mouseUp(document);
    expect(workspace).toHaveStyle({
      '--listening-pane-width': '97%',
      '--question-pane-width': 'calc(3%)',
    });
    expect(screen.getByTestId('listening-question-scroll')).toHaveClass('p-2.5');
    expect(screen.getByTestId('listening-question-scroll')).toHaveClass('md:p-3');
  });

  it('allows desktop listening split drag to reach near-boundary widths', () => {
    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: {
            enabled: true,
            order: 1,
            duration: 30,
            autoContinue: true,
            allowedQuestionTypes: ['SHORT_ANSWER'],
            audioPlaybackEnabled: false,
          },
          reading: { enabled: false, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '',
            transcript: 'Reference transcript text.',
            pins: [],
            blocks: [
              {
                id: 'listening-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question.',
                questions: [{ id: 'q1', prompt: 'What?', correctAnswer: 'answer', answerRule: 'ONE_WORD' }],
              },
            ],
          },
        ],
      },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
      />,
    );

    const workspace = screen.getByTestId('listening-split-workspace');
    const resizer = screen.getByTestId('listening-pane-resizer');
    expect(workspace).toHaveStyle({
      '--listening-pane-width': '40%',
      '--question-pane-width': 'calc(60% - var(--split-divider-width))',
      '--split-divider-width': '16px',
    });

    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({
      bottom: 600,
      height: 600,
      left: 100,
      right: 900,
      top: 0,
      width: 800,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(resizer, { clientX: 420 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);
    expect(workspace).toHaveStyle({
      '--listening-pane-width': '6%',
      '--question-pane-width': 'calc(94% - var(--split-divider-width))',
    });

    fireEvent.mouseDown(resizer, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 1800 });
    fireEvent.mouseUp(document);
    expect(workspace).toHaveStyle({
      '--listening-pane-width': '92%',
      '--question-pane-width': 'calc(8% - var(--split-divider-width))',
    });
  });

  it('applies tablet zoom scaling to reading and listening content panes', () => {
    const readingState = {
      title: 'Reading Test',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: false, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'Read this passage carefully.',
            images: [],
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question.',
                questions: [{ id: 'reading-q1', prompt: 'What?', correctAnswer: 'answer', answerRule: 'ONE_WORD' }],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    } as ExamState;

    const { unmount } = render(
      <StudentReading
        state={readingState}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="reading-q1"
        onNavigate={() => {}}
        tabletMode
        contentZoom={1.3}
      />,
    );

    const readingZoomedPanes = screen
      .getByTestId('reading-split-workspace')
      .querySelectorAll<HTMLElement>('[data-student-zoom-scroll]');
    expect(readingZoomedPanes.length).toBeGreaterThan(1);
    for (const pane of readingZoomedPanes) {
      const style = pane.getAttribute('style') ?? '';
      expect(style).toMatch(/zoom: 1\.3|transform: scale\(1\.3\)/);
    }

    unmount();

    const listeningState: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: {
            enabled: true,
            order: 1,
            duration: 30,
            autoContinue: true,
            allowedQuestionTypes: ['SHORT_ANSWER'],
            audioPlaybackEnabled: false,
          },
          reading: { enabled: false, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '',
            transcript: 'Reference transcript text.',
            pins: [],
            blocks: [
              {
                id: 'listening-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question.',
                questions: [{ id: 'q1', prompt: 'What?', correctAnswer: 'answer', answerRule: 'ONE_WORD' }],
              },
            ],
          },
        ],
      },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    };

    render(
      <StudentListening
        state={listeningState}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
        tabletMode
        contentZoom={1.3}
      />,
    );

    const listeningZoomedPanes = screen
      .getByTestId('listening-split-workspace')
      .querySelectorAll<HTMLElement>('[data-student-zoom-scroll]');
    expect(listeningZoomedPanes.length).toBeGreaterThan(1);
    for (const pane of listeningZoomedPanes) {
      const style = pane.getAttribute('style') ?? '';
      expect(style).toMatch(/zoom: 1\.3|transform: scale\(1\.3\)/);
    }
  });

  it('places listening diagram material on the left and answers on the right', () => {
    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: true, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['DIAGRAM_LABELING'], audioPlaybackEnabled: false },
          reading: { enabled: false, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '',
            pins: [],
            blocks: [
              {
                id: 'diagram-1',
                type: 'DIAGRAM_LABELING',
                instruction: 'Label the diagram.',
                imageUrl: '/diagram.jpg',
                labels: [
                  { id: 'label-a', x: 25, y: 35, correctAnswer: 'engine' },
                  { id: 'label-b', x: 70, y: 62, correctAnswer: 'wheel' },
                ],
              },
            ],
          },
        ],
      },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="diagram-1:label-a"
        onNavigate={() => {}}
        tabletMode
      />,
    );

    const materialPane = screen.getByTestId('listening-material-pane');
    expect(within(materialPane).getByAltText('Diagram reference')).toBeInTheDocument();
    expect(within(materialPane).queryByRole('button', { name: /zoom diagram in/i })).not.toBeInTheDocument();
    expect(within(materialPane).queryByRole('button', { name: /zoom diagram out/i })).not.toBeInTheDocument();
    expect(within(materialPane).queryByRole('button', { name: /reset diagram zoom/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('diagram-answer-panel')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 1' })).toBeInTheDocument();
    expect(screen.getAllByAltText('Diagram reference')).toHaveLength(1);
    fireEvent.click(within(materialPane).getByRole('button', { name: /^diagram reference$/i }));
    expect(screen.getByRole('dialog', { name: /diagram reference zoomed view/i })).toBeInTheDocument();
  });

  it('renders instruction-placed listening diagrams between instruction and questions, not in the left pane', () => {
    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: true, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['DIAGRAM_LABELING'], audioPlaybackEnabled: false },
          reading: { enabled: false, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '',
            pins: [],
            blocks: [
              {
                id: 'diagram-1',
                type: 'DIAGRAM_LABELING',
                instruction: 'Label the diagram.',
                imageUrl: '/diagram.jpg',
                referenceImagePlacement: 'instruction',
                labels: [
                  { id: 'label-a', x: 25, y: 35, correctAnswer: 'engine' },
                  { id: 'label-b', x: 70, y: 62, correctAnswer: 'wheel' },
                ],
              },
            ],
          },
        ],
      },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="diagram-1:label-a"
        onNavigate={() => {}}
        tabletMode
      />,
    );

    expect(screen.queryByTestId('listening-material-pane')).not.toBeInTheDocument();
    expect(screen.getByTestId('diagram-sticky-reference')).toBeInTheDocument();
    expect(screen.getByTestId('diagram-answer-panel')).toBeInTheDocument();
    expect(screen.getAllByAltText('Diagram reference')).toHaveLength(1);
  });

  it('renders instruction-placed listening diagrams between instruction and questions, not in the left pane', () => {
    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: true, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['DIAGRAM_LABELING'], audioPlaybackEnabled: false },
          reading: { enabled: false, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '',
            pins: [],
            blocks: [
              {
                id: 'diagram-1',
                type: 'DIAGRAM_LABELING',
                instruction: 'Label the diagram.',
                imageUrl: '/diagram.jpg',
                referenceImagePlacement: 'instruction',
                labels: [
                  { id: 'label-a', x: 25, y: 35, correctAnswer: 'engine' },
                  { id: 'label-b', x: 70, y: 62, correctAnswer: 'wheel' },
                ],
              },
            ],
          },
        ],
      },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="diagram-1:label-a"
        onNavigate={() => {}}
        tabletMode
      />,
    );

    expect(screen.queryByTestId('listening-material-pane')).not.toBeInTheDocument();
    expect(screen.getByTestId('diagram-sticky-reference')).toBeInTheDocument();
    expect(screen.getByTestId('diagram-answer-panel')).toBeInTheDocument();
    expect(screen.getAllByAltText('Diagram reference')).toHaveLength(1);
  });

  it('shows the active listening diagram when the diagram is not in the first part', () => {
    const state: ExamState = {
      title: 'Listening Test',
      type: 'Academic',
      activeModule: 'listening',
      activePassageId: 'passage-1',
      activeListeningPartId: 'part-1',
      config: {
        type: 'Academic',
        delivery: {
          launchMode: 'proctor_start',
          transitionMode: 'auto_with_proctor_override',
          allowedExtensionMinutes: [5],
        },
        sections: {
          listening: { enabled: true, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER', 'DIAGRAM_LABELING'], audioPlaybackEnabled: false },
          reading: { enabled: false, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER'] },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '',
            pins: [],
            blocks: [
              {
                id: 'short-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question.',
                questions: [{ id: 'short-q1', prompt: 'What is the name?', correctAnswer: 'Alex' }],
                wordLimit: 1,
              },
            ],
          },
          {
            id: 'part-2',
            title: 'Part 2',
            audioUrl: '',
            pins: [],
            blocks: [
              {
                id: 'diagram-2',
                type: 'DIAGRAM_LABELING',
                instruction: 'Label the diagram.',
                imageUrl: '/diagram-part-two.jpg',
                labels: [{ id: 'label-a', x: 25, y: 35, correctAnswer: 'entrance' }],
              },
            ],
          },
        ],
      },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    };

    render(
      <StudentListening
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="diagram-2:label-a"
        onNavigate={() => {}}
        tabletMode
      />,
    );

    expect(screen.getByRole('heading', { name: 'Part 2' })).toBeInTheDocument();
    expect(screen.getByTestId('listening-material-pane')).toBeInTheDocument();
    expect(screen.getByAltText('Diagram reference')).toHaveAttribute('src', '/diagram-part-two.jpg');
    expect(screen.getByTestId('diagram-answer-panel')).toBeInTheDocument();
  });
});
