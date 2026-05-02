import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStudentQuestionsForModule } from '../../../services/examAdapterService';

import type {
  ClassificationBlock,
  DiagramLabelingBlock,
  ExamState,
  MatchingFeaturesBlock,
  MultiMCQBlock,
  SentenceCompletionBlock,
  TableCompletionBlock,
} from '../../../types';
import { QuestionRenderer } from '../QuestionRenderer';
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
            rootId: 'q1',
            rootNumber: 1,
            numberLabel: '1',
            isMulti: false,
            correctCount: 1,
            answerKey: 'q1',
          },
          {
            id: 'multi-1:slot:1',
            blockId: 'multi-1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            rootId: 'multi-1:slot:1',
            rootNumber: 2,
            numberLabel: '2',
            isMulti: false,
            correctCount: 1,
            answerKey: 'multi-1',
            answerIndex: 0,
          },
          {
            id: 'multi-1:slot:2',
            blockId: 'multi-1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            rootId: 'multi-1:slot:2',
            rootNumber: 3,
            numberLabel: '3',
            isMulti: false,
            correctCount: 1,
            answerKey: 'multi-1',
            answerIndex: 1,
          },
          {
            id: 'multi-1:slot:3',
            blockId: 'multi-1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            rootId: 'multi-1:slot:3',
            rootNumber: 4,
            numberLabel: '4',
            isMulti: false,
            correctCount: 1,
            answerKey: 'multi-1',
            answerIndex: 2,
          },
          {
            id: 'q5',
            blockId: 'q5',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            rootId: 'q5',
            rootNumber: 5,
            numberLabel: '5',
            isMulti: false,
            correctCount: 1,
            answerKey: 'q5',
          },
        ]}
        currentQuestionId="q1"
        onNavigate={() => {}}
        answers={{}}
        onSubmit={() => {}}
      />,
    );

    expect(
      screen.getByRole('contentinfo', { name: /question navigation and progress/i }),
    ).toHaveClass('student-exam-footer');
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();
  });

  it('marks matching-dropdown answer changes as discrete interactions', () => {
    const onChange = vi.fn();
    const block = {
      id: 'match-1',
      type: 'MATCHING',
      instruction: 'Match headings',
      headings: [
        { id: 'h1', text: 'Heading one' },
        { id: 'h2', text: 'Heading two' },
      ],
      questions: [
        {
          id: 'q1',
          paragraphLabel: 'A',
          correctHeadingId: 'h1',
        },
      ],
    } as any;

    const question = {
      id: 'q1',
      paragraphLabel: 'A',
      correctHeadingId: 'h1',
    } as any;

    render(
      <QuestionRenderer
        question={question}
        block={block}
        number={1}
        answer=""
        onChange={onChange}
      />,
    );

    const select = screen.getByRole('combobox', { name: /heading selection for question 1/i });
    fireEvent.change(select, { target: { value: 'ii' } });

    expect(onChange).toHaveBeenCalledWith('ii', {
      interactionType: 'discrete',
    });
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

  it('renders separate footer numbers for MULTI_MCQ slots and navigates to the selected slot', () => {
    const onNavigate = vi.fn();
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
          reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['SHORT_ANSWER', 'MULTI_MCQ'] },
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
                id: 'reading-pre',
                type: 'SHORT_ANSWER',
                instruction: 'Answer question 1.',
                questions: [{ id: 'reading-q1', prompt: 'Question 1', correctAnswer: 'answer', answerRule: 'ONE_WORD' }],
              },
              {
                id: 'reading-multi',
                type: 'MULTI_MCQ',
                instruction: 'Choose two letters.',
                stem: 'Pick two',
                requiredSelections: 2,
                options: [
                  { id: 'a', text: 'A', isCorrect: true },
                  { id: 'b', text: 'B', isCorrect: true },
                  { id: 'c', text: 'C', isCorrect: false },
                ],
              },
              {
                id: 'reading-post',
                type: 'SHORT_ANSWER',
                instruction: 'Answer question 4.',
                questions: [{ id: 'reading-q4', prompt: 'Question 4', correctAnswer: 'answer', answerRule: 'ONE_WORD' }],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: { task1Prompt: '', task2Prompt: '' },
      speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    } as unknown as ExamState;

    const questions = getStudentQuestionsForModule(state, 'reading');
    render(
      <StudentFooter
        questions={questions}
        currentQuestionId="reading-q1"
        onNavigate={onNavigate}
        answers={{}}
        onSubmit={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(onNavigate).toHaveBeenCalledWith('reading-multi:slot:2');
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4' })).toBeInTheDocument();
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

  it('updates only the edited sentence-completion slot and preserves sibling values', () => {
    const onChange = vi.fn();
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
        answer={['cat', 'bird']}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 7' }), {
      target: { value: 'wolf' },
    });

    expect(onChange).toHaveBeenCalledWith(
      ['wolf', 'bird'],
      expect.objectContaining({
        slotIndex: 0,
        slotId: 'sentence-block-1:0',
        slotCount: 2,
      }),
    );
  });

  it('keeps prior slot edits when two slot changes happen before rerender', () => {
    const onChange = vi.fn();
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
        onChange={onChange}
      />,
    );

    const first = screen.getByRole('textbox', { name: 'Answer for question 7' });
    const second = screen.getByRole('textbox', { name: 'Answer for question 8' });

    fireEvent.change(first, { target: { value: 'wolf' } });
    fireEvent.change(second, { target: { value: 'bird' } });

    expect(onChange).toHaveBeenNthCalledWith(
      2,
      ['wolf', 'bird'],
      expect.objectContaining({
        slotIndex: 1,
        slotId: 'sentence-block-1:1',
        slotCount: 2,
      }),
    );
  });

  it('renders table blanks inline and keeps row-major numbering stable', () => {
    const onChange = vi.fn();
    const block: TableCompletionBlock = {
      id: 'table-inline-1',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      answerRule: 'ONE_WORD',
      headers: ['Field', 'Value'],
      rows: [['Name: ____', 'Country: ____']],
      cells: [
        { id: 'cell-country', row: 0, col: 1, correctAnswer: 'India' },
        { id: 'cell-name', row: 0, col: 0, correctAnswer: 'Anu' },
      ],
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={10}
        answer={['anu', 'india']}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Name:')).toBeInTheDocument();
    expect(screen.getByText('Country:')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 10' })).toHaveValue('anu');
    expect(screen.getByRole('textbox', { name: 'Answer for question 11' })).toHaveValue('india');

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 11' }), {
      target: { value: 'thai' },
    });

    expect(onChange).toHaveBeenCalledWith(
      ['anu', 'thai'],
      expect.objectContaining({
        slotIndex: 1,
        slotId: 'table-inline-1:1',
        slotCount: 2,
      }),
    );
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
    expect(screen.getByText(/label 1/i)).toBeInTheDocument();
    expect(screen.getByText(/label 2/i)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Answer for question 13' }), {
      target: { value: 'wheel' },
    });

    expect(onChange).toHaveBeenCalledWith(
      ['existing', 'wheel'],
      expect.objectContaining({
        slotIndex: 1,
        slotId: 'diagram-1:label-b',
        slotCount: 2,
      }),
    );
  });

  it('shows diagram-labeling fallback fields with top prompts and supports custom label text', () => {
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

    expect(screen.getByText(/add a diagram/i)).toBeInTheDocument();
    const firstAnswer = screen.getByRole('textbox', { name: 'Answer for question 12' });
    expect(screen.getByRole('textbox', { name: 'Answer for question 13' })).toBeInTheDocument();
    const customPrompt = screen.getByText('Engine label');
    expect(customPrompt.compareDocumentPosition(firstAnswer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/^Label 1$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/label 2/i)).toBeInTheDocument();
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
    const stickyWrapper = image.closest('.lg\\:sticky');
    expect(stickyWrapper).not.toBeNull();
  });

  it('renders inserted reading images between instruction and question body with drive URL resolution', () => {
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
            content: 'Read and answer.',
            images: [],
            blocks: [
              {
                id: 'q-block',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question.',
                insertedImages: [
                  {
                    id: 'img-1',
                    url: 'https://drive.google.com/file/d/abc123DEF456/view?usp=sharing',
                    caption: 'Blueprint caption',
                  },
                ],
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

    const instruction = screen.getByText('Answer the question.');
    const caption = screen.getByText('Blueprint caption');
    const prompt = screen.getByText('What is shown?');
    expect(
      instruction.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      caption.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const image = screen.getByAltText('Blueprint caption');
    expect(image).toHaveAttribute(
      'src',
      'https://drive.google.com/uc?export=view&id=abc123DEF456',
    );
  });

  it('does not render inserted image slot for reading map blocks', () => {
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
          listening: { enabled: false, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['MAP'] },
          reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['MAP'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['MAP'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['MAP'] },
        },
      },
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'Read and answer.',
            images: [],
            blocks: [
              {
                id: 'map-block',
                type: 'MAP',
                instruction: 'Label the map.',
                insertedImages: [
                  {
                    id: 'img-hidden',
                    url: 'https://example.com/map-context.png',
                    caption: 'Hidden map caption',
                  },
                ],
                assetUrl: 'https://example.com/map.png',
                questions: [{ id: 'q-map-1', label: 'Entrance', correctAnswer: 'A', x: 50, y: 50 }],
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
        currentQuestionId="q-map-1"
        onNavigate={() => {}}
      />,
    );

    expect(screen.queryByText('Hidden map caption')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /question reference image/i }),
    ).not.toBeInTheDocument();
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

    render(
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
  });

  it('renders HTML reading passages with normal whitespace handling', () => {
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
            content:
              '<p>You\nshould spend about 20 minutes on <strong>Questions 1-13</strong>, which are based on Reading Passage 1 below.</p><h3>Frozen\nFood</h3>',
            images: [],
            blocks: [
              {
                id: 'q-block',
                type: 'SHORT_ANSWER',
                instruction: 'Answer.',
                questions: [{ id: 'q1', prompt: 'What?', correctAnswer: 'answer', answerRule: 'ONE_WORD' }],
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

    const readingHighlighter = container.querySelector('[data-student-highlightable="true"]');
    expect(readingHighlighter).not.toBeNull();
    expect(readingHighlighter).toHaveClass('whitespace-normal');
    expect(readingHighlighter).not.toHaveClass('whitespace-pre-wrap');
  });

  it('normalizes hard-wrapped plain-text reading passages while preserving paragraph breaks', () => {
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
            content:
              'You\nshould spend about 20 minutes on Questions 1-13,\nwhich are based on Reading Passage 1 below.\n\nFrozen\nFood',
            images: [],
            blocks: [
              {
                id: 'q-block',
                type: 'SHORT_ANSWER',
                instruction: 'Answer.',
                questions: [{ id: 'q1', prompt: 'What?', correctAnswer: 'answer', answerRule: 'ONE_WORD' }],
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

    const readingHighlighter = container.querySelector('[data-student-highlightable="true"]') as HTMLElement | null;
    expect(readingHighlighter).not.toBeNull();
    expect(readingHighlighter).toHaveClass('whitespace-pre-wrap');
    expect(readingHighlighter).not.toHaveClass('whitespace-normal');
    expect(readingHighlighter?.textContent).toBe(
      'You should spend about 20 minutes on Questions 1-13, which are based on Reading Passage 1 below.\n\nFrozen Food',
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
  });

  it('shows a single reading question number without a repeated range', () => {
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

    expect(screen.getByText('Questions 11')).toBeInTheDocument();
    expect(screen.queryByText('Questions 11–11')).not.toBeInTheDocument();
    expect(screen.getByText('Questions 12–13')).toBeInTheDocument();
  });

  it('shows a single listening question number without a repeated range', () => {
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

    expect(screen.getByText('Questions 11')).toBeInTheDocument();
    expect(screen.queryByText('Questions 11–11')).not.toBeInTheDocument();
    expect(screen.getByText('Questions 12–13')).toBeInTheDocument();
  });

  it('renders inserted listening images between instruction and question body', () => {
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
                instruction: 'Answer this question.',
                insertedImages: [
                  {
                    id: 'img-1',
                    url: 'https://example.com/listening-context.png',
                    caption: 'Listening context image',
                  },
                ],
                questions: [{ id: 'listening-q1', prompt: 'What did you hear?', correctAnswer: 'rain', answerRule: 'ONE_WORD' }],
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
        currentQuestionId="listening-q1"
        onNavigate={() => {}}
      />,
    );

    const instruction = screen.getByText('Answer this question.');
    const caption = screen.getByText('Listening context image');
    const prompt = screen.getByText('What did you hear?');
    expect(
      instruction.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      caption.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.getByAltText('Listening context image')).toHaveAttribute(
      'src',
      'https://example.com/listening-context.png',
    );
  });

  it('opens the question navigator from the header when the control is available', () => {
    const onOpenNavigator = vi.fn();

    render(
      <StudentHeader
        onExit={() => {}}
        timeRemaining={1200}
        isExamActive
        onOpenNavigator={onOpenNavigator}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /open question navigator/i }));

    expect(onOpenNavigator).toHaveBeenCalledTimes(1);
  });

  it('wires zoom controls and opens the highlight palette from the header', () => {
    const onOpenAccessibility = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomReset = vi.fn();
    const onHighlightModeToggle = vi.fn();
    const onHighlightColorChange = vi.fn();

    render(
      <StudentHeader
        onExit={() => {}}
        timeRemaining={1200}
        isExamActive
        zoom={1.25}
        highlightEnabled={false}
        highlightColor="yellow"
        onOpenAccessibility={onOpenAccessibility}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
        onHighlightModeToggle={onHighlightModeToggle}
        onHighlightColorChange={onHighlightColorChange}
      />,
    );

    expect(screen.getByTestId('zoom-controls')).toHaveClass('w-[11.5rem]');
    expect(screen.getByTestId('zoom-percent')).toHaveTextContent('125%');
    expect(screen.getByText('125%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /zoom out/i }));
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    fireEvent.click(screen.getByRole('button', { name: /reset zoom/i }));
    fireEvent.click(screen.getByRole('button', { name: /open highlight options/i }));
    expect(screen.getByRole('dialog', { name: /highlight options/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /select amber highlight color/i }));
    fireEvent.click(screen.getByRole('button', { name: /open accessibility settings/i }));

    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomReset).toHaveBeenCalledTimes(1);
    expect(onHighlightModeToggle).toHaveBeenCalledTimes(1);
    expect(onHighlightColorChange).toHaveBeenCalledWith('amber');
    expect(onOpenAccessibility).toHaveBeenCalledTimes(1);
  });

  it('renders separate tablet zoom and highlight controls in the header', () => {
    const onOpenAccessibility = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onZoomReset = vi.fn();
    const onHighlightModeToggle = vi.fn();
    const onHighlightColorChange = vi.fn();

    render(
      <StudentHeader
        onExit={() => {}}
        timeRemaining={1200}
        isExamActive
        tabletMode
        zoom={1.1}
        highlightEnabled={false}
        highlightColor="yellow"
        onOpenAccessibility={onOpenAccessibility}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
        onHighlightModeToggle={onHighlightModeToggle}
        onHighlightColorChange={onHighlightColorChange}
      />,
    );

    expect(screen.queryByTestId('zoom-controls')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open zoom controls/i })).toHaveTextContent('Zoom');
    expect(screen.getByRole('button', { name: /open highlight options/i })).toHaveTextContent('Highlight');

    fireEvent.click(screen.getByRole('button', { name: /open zoom controls/i }));

    const zoomPanel = screen.getByRole('dialog', { name: /zoom controls/i });
    expect(within(zoomPanel).getByTestId('zoom-controls')).toBeInTheDocument();
    expect(zoomPanel.parentElement).toBe(document.body);
    expect(zoomPanel).toHaveClass('z-[90]');

    fireEvent.click(within(zoomPanel).getByRole('button', { name: /zoom in/i }));
    fireEvent.click(screen.getByRole('button', { name: /open highlight options/i }));
    const highlightPanel = screen.getByRole('dialog', { name: /highlight options/i });
    expect(within(highlightPanel).queryByTestId('zoom-controls')).not.toBeInTheDocument();
    expect(highlightPanel.parentElement).toBe(document.body);
    expect(highlightPanel).toHaveClass('z-[90]');
    fireEvent.click(within(highlightPanel).getByRole('button', { name: /select amber highlight color/i }));
    fireEvent.click(screen.getByRole('button', { name: /open accessibility settings/i }));

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onHighlightColorChange).toHaveBeenCalledWith('amber');
    expect(onHighlightModeToggle).toHaveBeenCalledTimes(1);
    expect(onOpenAccessibility).toHaveBeenCalledTimes(1);
    expect(onZoomOut).not.toHaveBeenCalled();
    expect(onZoomReset).not.toHaveBeenCalled();
  });

  it('hides the header exit control when requested', () => {
    render(
      <StudentHeader
        onExit={() => {}}
        timeRemaining={1200}
        isExamActive
        showExitButton={false}
      />,
    );

    expect(screen.queryByRole('button', { name: /exit exam/i })).not.toBeInTheDocument();
  });

  it('shows the header exit control by default outside active exam mode', () => {
    render(
      <StudentHeader
        onExit={() => {}}
        timeRemaining={1200}
        isExamActive={false}
      />,
    );

    expect(screen.getByRole('button', { name: /exit preview/i })).toBeInTheDocument();
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
    expect(within(materialPane).getByRole('button', { name: /tap to zoom the diagram/i })).toBeInTheDocument();
    expect(screen.getByTestId('diagram-answer-panel')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 1' })).toBeInTheDocument();
    expect(screen.getAllByAltText('Diagram reference')).toHaveLength(1);
  });

  it('opens listening diagram zoom in the shared modal viewer', () => {
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
                labels: [{ id: 'label-a', x: 25, y: 35, correctAnswer: 'engine' }],
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

    const openZoomButton = screen.getByRole('button', { name: /tap to zoom the diagram/i });
    fireEvent.click(openZoomButton);

    const zoomDialog = screen.getByRole('dialog', { name: /diagram reference image zoomed view/i });
    expect(zoomDialog.parentElement).toBe(document.body);
    expect(screen.getByTestId('zoomable-media-viewport')).toBeInTheDocument();
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

  it('shows map reference between instruction and questions when map placement is set to instruction', () => {
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
          listening: { enabled: false, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['MAP'] },
          reading: { enabled: true, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['MAP'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['MAP'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['MAP'] },
        },
      },
      reading: {
        passages: [
          {
            id: 'passage-1',
            title: 'Passage 1',
            content: 'Read the map.',
            images: [],
            blocks: [
              {
                id: 'map-block',
                type: 'MAP',
                instruction: 'Label the map.',
                referenceImagePlacement: 'instruction',
                assetUrl: '/map-reference.jpg',
                questions: [{ id: 'q-map-1', label: 'Entrance', correctAnswer: 'A', x: 50, y: 50 }],
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
        currentQuestionId="q-map-1"
        onNavigate={() => {}}
      />,
    );

    expect(screen.getByText('Label the map.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /map reference image/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /map reference image/i })).toHaveLength(1);
  });

  it('moves listening diagram reference into question pane when placement is set to instruction', () => {
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
          listening: { enabled: true, order: 1, duration: 30, autoContinue: true, allowedQuestionTypes: ['DIAGRAM_LABELING'] },
          reading: { enabled: false, order: 2, duration: 60, autoContinue: true, allowedQuestionTypes: ['DIAGRAM_LABELING'] },
          writing: { enabled: false, order: 3, duration: 60, autoContinue: true, allowedQuestionTypes: ['DIAGRAM_LABELING'] },
          speaking: { enabled: false, order: 4, duration: 15, autoContinue: true, allowedQuestionTypes: ['DIAGRAM_LABELING'] },
        },
      },
      reading: { passages: [] },
      listening: {
        parts: [
          {
            id: 'part-1',
            title: 'Part 1',
            audioUrl: '/audio/test.mp3',
            pins: [],
            blocks: [
              {
                id: 'diagram-1',
                type: 'DIAGRAM_LABELING',
                instruction: 'Label the diagram.',
                referenceImagePlacement: 'instruction',
                imageUrl: '/diagram.jpg',
                labels: [{ id: 'label-a', x: 40, y: 40, correctAnswer: 'Valve' }],
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
        currentQuestionId="diagram-1:label-a"
        onNavigate={() => {}}
      />,
    );

    expect(screen.queryByTestId('listening-material-pane')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /diagram reference image/i })).toBeInTheDocument();
  });
});
