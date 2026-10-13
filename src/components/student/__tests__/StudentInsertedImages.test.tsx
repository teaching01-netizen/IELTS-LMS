import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QuestionBlock, ShortAnswerBlock } from '../../../types';
import type { StudentQuestionDescriptor } from '../../../services/examAdapterService';
import { StudentInsertedImages, resolveInsertedImageRows } from '../StudentInsertedImages';
import { StudentQuestionBlockSection } from '../StudentQuestionBlockSection';

const DRIVE_URL = 'https://drive.google.com/file/d/1AbCDefG123456/view?usp=sharing';

function createShortAnswerBlock(
  insertedImages: ShortAnswerBlock['insertedImages'],
): ShortAnswerBlock {
  return {
    id: 'sa-11-13',
    type: 'SHORT_ANSWER',
    instruction: 'Label the diagram below.',
    insertedImages,
    questions: [
      { id: 'q-11', prompt: 'Prompt eleven', correctAnswer: 'heater', answerRule: 'ONE_WORD' },
      { id: 'q-12', prompt: 'Prompt twelve', correctAnswer: 'switch', answerRule: 'ONE_WORD' },
      { id: 'q-13', prompt: 'Prompt thirteen', correctAnswer: 'button', answerRule: 'ONE_WORD' },
    ],
  };
}

function renderBlockSection(block: QuestionBlock) {
  const blockQuestions = (block as ShortAnswerBlock).questions.map(
    (question) =>
      ({
        id: question.id,
        blockId: block.id,
        groupId: 'part-1',
        groupLabel: 'Part 1',
        isMulti: false,
        correctCount: 1,
        answerKey: question.id,
        block,
        question,
      }) as StudentQuestionDescriptor,
  );

  return render(
    <StudentQuestionBlockSection
      block={block}
      blockQuestions={blockQuestions}
      allQuestions={blockQuestions}
      answers={{ 'q-11': '', 'q-12': '', 'q-13': '' }}
      activeQuestionId={null}
      flags={{}}
      onAnswerChange={() => undefined}
      tabletMode={false}
      answerCompact={false}
      highlightEnabled={false}
      getBlockStartQuestionNumber={() => 11}
      renderBlockInstruction={(instruction) => <p>{instruction}</p>}
      expandedQuestionGapClassName="space-y-8"
    />,
  );
}

describe('StudentInsertedImages', () => {
  it('renders a Drive share link through the delivery candidate chain', () => {
    const block = createShortAnswerBlock([
      { id: 'img-1', url: DRIVE_URL, caption: 'Water heater' },
    ]);

    render(<StudentInsertedImages block={block} />);

    const image = screen.getByAltText('Water heater');
    expect(image.getAttribute('src')).toBe(
      'https://drive.google.com/thumbnail?id=1AbCDefG123456&sz=w2000',
    );
    expect(screen.getByText('Water heater')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Water heater' })).toBeInTheDocument();
  });

  it('drops rows with no usable source and renders nothing when none remain', () => {
    const mixed = createShortAnswerBlock([
      { id: 'img-empty', url: '   ' },
      { id: 'img-unsafe', url: 'javascript:alert(1)' },
      { id: 'img-ok', url: 'https://example.com/diagram.png' },
    ]);
    expect(resolveInsertedImageRows(mixed).map((row) => row.id)).toEqual(['img-ok']);

    const unusableOnly = createShortAnswerBlock([
      { id: 'img-empty', url: '' },
      { id: 'img-unsafe', url: 'javascript:alert(1)' },
    ]);

    const { container } = render(<StudentInsertedImages block={unusableOnly} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('student-inserted-images')).not.toBeInTheDocument();
  });

  it('keeps the authoring exclusion for map and diagram labeling blocks', () => {
    const mapBlock = {
      id: 'map-1',
      type: 'MAP',
      instruction: 'Label the map.',
      assetUrl: 'https://example.com/map.png',
      insertedImages: [{ id: 'img-1', url: 'https://example.com/extra.png' }],
      questions: [{ id: 'q-1', label: 'A', correctAnswer: 'A', x: 50, y: 50 }],
    } as unknown as QuestionBlock;

    expect(resolveInsertedImageRows(mapBlock)).toEqual([]);

    render(<StudentInsertedImages block={mapBlock} />);

    expect(screen.queryByTestId('student-inserted-images')).not.toBeInTheDocument();
  });

  it('renders rows that repeat an authoring id without colliding', () => {
    // Imported payloads can repeat ids. An id-only React key would make these
    // two siblings collide on reconciliation, so the component keys by id plus
    // row position (proved positionally unique in
    // verification/lean/inserted-images-delivery).
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <StudentInsertedImages
        block={createShortAnswerBlock([
          { id: 'img-1', url: 'https://example.com/a.png', caption: 'A' },
          { id: 'img-1', url: 'https://example.com/b.png', caption: 'B' },
        ])}
      />,
    );

    const images = within(screen.getByTestId('student-inserted-images')).getAllByRole('img');
    expect(images.map((image) => image.getAttribute('alt'))).toEqual(['A', 'B']);
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((arg) => String(arg).includes('same key')),
      ),
    ).toBe(false);

    consoleError.mockRestore();
  });

  it('keeps the authoring order across multiple images', () => {
    const block = createShortAnswerBlock([
      { id: 'img-1', url: 'https://example.com/first.png', caption: 'First' },
      { id: 'img-2', url: 'https://example.com/second.png', caption: 'Second' },
    ]);

    render(<StudentInsertedImages block={block} />);

    const images = within(screen.getByTestId('student-inserted-images')).getAllByRole('img');
    expect(images.map((image) => image.getAttribute('alt'))).toEqual(['First', 'Second']);
  });
});

describe('inserted images in the delivered question block', () => {
  it('renders images after the instruction and before the question content', () => {
    renderBlockSection(
      createShortAnswerBlock([{ id: 'img-1', url: DRIVE_URL, caption: 'Water heater' }]),
    );

    const instruction = screen.getByText('Label the diagram below.');
    const images = screen.getByTestId('student-inserted-images');
    const firstQuestion = screen.getByText('Prompt eleven');

    // The slot the authoring editor promises is the deliverable contract: the
    // instruction, then the image, then the questions it labels.
    expect(
      instruction.compareDocumentPosition(images) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      images.compareDocumentPosition(firstQuestion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByAltText('Water heater')).toBeInTheDocument();
  });

  it('keeps images before the questions when the instruction renders nothing', () => {
    // Listening omits the instruction element entirely for a blank instruction
    // (`renderBlockInstruction` returns null). The image must still precede the
    // question content — proved as R2 in
    // verification/lean/inserted-images-delivery/Safety.lean.
    const block = createShortAnswerBlock([
      { id: 'img-1', url: 'https://example.com/diagram.png', caption: 'Diagram' },
    ]);
    const blockQuestions = (block as ShortAnswerBlock).questions.map(
      (question) =>
        ({
          id: question.id,
          blockId: block.id,
          groupId: 'part-1',
          groupLabel: 'Part 1',
          isMulti: false,
          correctCount: 1,
          answerKey: question.id,
          block,
          question,
        }) as StudentQuestionDescriptor,
    );

    const { container } = render(
      <StudentQuestionBlockSection
        block={block}
        blockQuestions={blockQuestions}
        allQuestions={blockQuestions}
        answers={{ 'q-11': '', 'q-12': '', 'q-13': '' }}
        activeQuestionId={null}
        flags={{}}
        onAnswerChange={() => undefined}
        tabletMode={false}
        answerCompact={false}
        highlightEnabled={false}
        getBlockStartQuestionNumber={() => 11}
        renderBlockInstruction={() => null}
        expandedQuestionGapClassName="space-y-8"
      />,
    );

    const images = screen.getByTestId('student-inserted-images');
    const firstQuestion = screen.getByText('Prompt eleven');
    expect(
      images.compareDocumentPosition(firstQuestion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.textContent).not.toContain('Label the diagram below.');
  });

  it('leaves blocks without inserted images untouched', () => {
    renderBlockSection(createShortAnswerBlock(undefined));

    expect(screen.queryByTestId('student-inserted-images')).not.toBeInTheDocument();
    expect(screen.getByText('Label the diagram below.')).toBeInTheDocument();
    expect(screen.getByText('Prompt eleven')).toBeInTheDocument();
  });

  it('does not re-render images when only the answer changes', () => {
    const block = createShortAnswerBlock([
      { id: 'img-1', url: 'https://example.com/diagram.png', caption: 'Diagram' },
    ]);
    const blockQuestions = (block as ShortAnswerBlock).questions.map(
      (question) =>
        ({
          id: question.id,
          blockId: block.id,
          groupId: 'part-1',
          groupLabel: 'Part 1',
          isMulti: false,
          correctCount: 1,
          answerKey: question.id,
          block,
          question,
        }) as StudentQuestionDescriptor,
    );
    const onAnswerChange = vi.fn();
    const props = {
      block,
      blockQuestions,
      allQuestions: blockQuestions,
      activeQuestionId: null,
      flags: {},
      onAnswerChange,
      tabletMode: false,
      answerCompact: false,
      highlightEnabled: false,
      getBlockStartQuestionNumber: () => 11,
      renderBlockInstruction: (instruction: string) => <p>{instruction}</p>,
      expandedQuestionGapClassName: 'space-y-8',
    };

    const { rerender } = render(
      <StudentQuestionBlockSection {...props} answers={{ 'q-11': '', 'q-12': '', 'q-13': '' }} />,
    );
    const firstImage = screen.getByAltText('Diagram');

    rerender(
      <StudentQuestionBlockSection {...props} answers={{ 'q-11': 'heater', 'q-12': '', 'q-13': '' }} />,
    );

    expect(screen.getByAltText('Diagram')).toBe(firstImage);
  });
});
