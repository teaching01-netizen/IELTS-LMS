import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuestionBlock } from '../../../types';
import type { StudentQuestionDescriptor } from '@student/application/studentExamContentFacade';
import { StudentFooter } from '../StudentFooter';
import { StudentQuestionPanel } from '../StudentQuestionPanel';

// The pane measures its own width; the tests drive the band directly so the
// stacked composition is exercised without a real layout engine.
const paneWidth = vi.hoisted(() => ({ stackFlag: false }));
vi.mock('../useStudentQuestionPaneComposition', () => ({
  useStudentQuestionPaneComposition: () => ({
    measured: true,
    stackFlag: paneWidth.stackFlag,
  }),
  composeStudentQuestionPane: (width: number) => ({
    measured: true,
    stackFlag: width < 520,
  }),
}));

beforeEach(() => {
  paneWidth.stackFlag = false;
});

/**
 * P4: one navigation authority, and controls that own space in the layout.
 *
 * The first attempt at this responsive repair gave the question pane its own
 * `1 of 39 / Previous / Next` rail. That duplicated the global navigator,
 * stole roughly 60px of reading height, and could disagree with the global
 * state about which question was current. These tests pin the corrected
 * architecture: the pane renders NO navigation rail, and the single global
 * navigator owns the position readout plus Previous/Next, both derived from the
 * same active question as the chip rail.
 */

function descriptor(id: string, block: QuestionBlock, question: unknown): StudentQuestionDescriptor {
  return {
    id,
    blockId: block.id,
    groupId: 'p1',
    groupLabel: 'Passage 1',
    isMulti: false,
    correctCount: 1,
    answerKey: id,
    block,
    question,
  } as StudentQuestionDescriptor;
}

const block = {
  id: 'tfng',
  type: 'TFNG',
  instruction: 'Do the following statements agree with the information?',
  mode: 'TFNG',
  questions: [
    { id: 'q1', statement: 'Statement one.', correctAnswer: 'T' },
    { id: 'q2', statement: 'Statement two.', correctAnswer: 'F' },
    { id: 'q3', statement: 'Statement three.', correctAnswer: 'F' },
  ],
} as unknown as QuestionBlock;

const questions = [
  descriptor('q1', block, (block as any).questions[0]),
  descriptor('q2', block, (block as any).questions[1]),
  descriptor('q3', block, (block as any).questions[2]),
];

const diagramBlock = {
  id: 'diagram-1',
  type: 'DIAGRAM_LABELING',
  instruction: 'Label the diagram.',
  labels: [
    { id: 'label-a', text: 'Label A', correctAnswer: 'A' },
  ],
} as unknown as QuestionBlock;

const diagramQuestion = descriptor('diagram-1:label-a', diagramBlock, null);

function renderPanel(overrides: Record<string, unknown> = {}) {
  const onNavigate = vi.fn();
  const props = {
    blocks: [block],
    allQuestions: questions,
    answers: { q1: 'T', q2: 'F' },
    onAnswerChange: vi.fn(),
    currentQuestionId: 'q1',
    onNavigate,
    flags: {},
    onToggleFlag: vi.fn(),
    answerCompact: false,
    highlightEnabled: false,
    questionContainerRef: React.createRef<HTMLDivElement>(),
    panelTestId: 'question-panel-dock',
    getBlockStartQuestionNumber: () => 1,
    renderBlockInstruction: () => null,
    ...overrides,
  };
  const view = render(
    <StudentQuestionPanel
      {...props}
    />,
  );
  return { ...view, onNavigate, props };
}

function renderFooter(overrides: Record<string, unknown> = {}) {
  const onNavigate = vi.fn();
  const view = render(
    <StudentFooter
      questions={questions}
      currentQuestionId="q2"
      onNavigate={onNavigate}
      answers={{ q1: 'T' }}
      onSubmit={vi.fn()}
      {...overrides}
    />,
  );
  return { ...view, onNavigate };
}

describe('one navigation authority', () => {
  it('renders no navigation rail inside the question pane', () => {
    renderPanel();

    // The global navigator owns Previous/Next; the pane must not grow a second
    // footer that could disagree with it.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByTestId('student-question-stepper')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous question' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next question' })).toBeNull();
  });

  it('puts Previous/Next and the position readout in the global navigator', () => {
    renderFooter();

    const nav = screen.getByRole('contentinfo', { name: /question navigation and progress/i });
    expect(within(nav).getByRole('button', { name: 'Previous question' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Next question' })).toBeInTheDocument();
    // Position comes from the same active question as the chip rail.
    expect(within(nav).getByText(/2 of 3/)).toBeInTheDocument();
  });

  it('reflects the active question rather than the scroll position', () => {
    const { onNavigate } = renderFooter();

    const previous = screen.getByRole('button', { name: 'Previous question' });
    const next = screen.getByRole('button', { name: 'Next question' });
    expect(previous).toBeEnabled();
    expect(next).toBeEnabled();

    fireEvent.click(next);
    expect(onNavigate).toHaveBeenCalledWith('q3');

    onNavigate.mockClear();
    fireEvent.click(previous);
    expect(onNavigate).toHaveBeenCalledWith('q1');
  });

  it('does not turn question-pane scrolling into navigation', () => {
    const { onNavigate } = renderPanel();

    fireEvent.scroll(screen.getByTestId('question-panel-dock'));

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('scrolls the selected question inside the question pane', () => {
    const view = renderPanel();
    const pane = screen.getByTestId('question-panel-dock') as HTMLElement & {
      scrollTo: ReturnType<typeof vi.fn>;
    };
    const target = document.getElementById('question-q3');
    expect(target).not.toBeNull();

    pane.scrollTop = 12;
    pane.scrollTo = vi.fn();
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    vi.spyOn(target as HTMLElement, 'getBoundingClientRect').mockReturnValue({ top: 600 } as DOMRect);

    view.rerender(<StudentQuestionPanel {...view.props} currentQuestionId="q3" />);

    expect(pane.scrollTo).toHaveBeenCalledWith({ top: 496, behavior: 'auto' });
  });

  it('keeps a scroll anchor for IELTS question blocks without a questions array', () => {
    render(
      <StudentQuestionPanel
        blocks={[diagramBlock]}
        allQuestions={[diagramQuestion]}
        answers={{}}
        onAnswerChange={vi.fn()}
        currentQuestionId={diagramQuestion.id}
        onNavigate={vi.fn()}
        flags={{}}
        answerCompact={false}
        highlightEnabled={false}
        questionContainerRef={React.createRef<HTMLDivElement>()}
        panelTestId="diagram-question-panel"
        getBlockStartQuestionNumber={() => 1}
        renderBlockInstruction={() => null}
      />,
    );

    expect(document.getElementById(`question-${diagramQuestion.id}`)).not.toBeNull();
  });

  it('disables the ends of the exam instead of wrapping', () => {
    const first = renderFooter({ currentQuestionId: 'q1' });
    expect(screen.getByRole('button', { name: 'Previous question' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next question' })).toBeEnabled();

    first.unmount();

    renderFooter({ currentQuestionId: 'q3' });
    expect(screen.getByRole('button', { name: 'Previous question' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next question' })).toBeDisabled();
  });

  it('keeps the footer in flow rather than floating over the exam', () => {
    renderFooter();

    const nav = screen.getByRole('contentinfo', { name: /question navigation and progress/i });
    expect(nav.className).not.toMatch(/absolute|fixed|sticky/);
  });
});

describe('question flag placement', () => {
  it('keeps the flag in a real action column instead of floating over the prompt', () => {
    const onToggleFlag = vi.fn();
    renderPanel({ onToggleFlag });

    const row = document.getElementById('question-q1');
    expect(row).not.toBeNull();
    // The flag owns a real trailing action column in the question header.
    expect(row).toHaveClass('student-question-row', 'student-question-row--flagged');

    const flag = within(row as HTMLElement).getByRole('button', { name: 'Flag question' });
    // In-flow control: the old absolute overlay is gone for good.
    expect(flag.className).not.toContain('absolute');
    expect(flag.className).toContain('flex-shrink-0');
    // Quiet at rest: no permanent heavy ring, neutral glyph.
    expect(flag.className).toContain('text-gray-400');
    expect(flag.className).not.toContain('rounded-full');
    expect(flag).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(flag);
    expect(onToggleFlag).toHaveBeenCalledWith('q1');
  });

  it('lets the flagged state carry the accent instead of a heavy outline', () => {
    renderPanel({ flags: { q1: true } });

    const flag = screen.getByRole('button', { name: 'Unflag question' });
    expect(flag).toHaveAttribute('aria-pressed', 'true');
    expect(flag.className).toContain('text-blue-700');
    expect(flag.className).not.toContain('shadow-sm');
  });

  it('stacks the flag into a metadata row when the pane is measured as narrow', () => {
    paneWidth.stackFlag = true;
    renderPanel();

    const row = document.getElementById('question-q1');
    expect(row).toHaveClass('student-question-row--stacked');
    // The action column is still a real grid track — it moves, it never floats.
    const action = (row as HTMLElement).querySelector('.student-question-row-action');
    expect(action).not.toBeNull();
    expect((action as HTMLElement).querySelector('button[aria-label="Flag question"]')).not.toBeNull();
  });
});
