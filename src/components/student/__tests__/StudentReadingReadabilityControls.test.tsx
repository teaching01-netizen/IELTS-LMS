import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExamState } from '../../../types';
import { StudentReading } from '../StudentReading';

function createState(): ExamState {
  return {
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
        listening: {
          enabled: false,
          order: 1,
          duration: 30,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
        },
        reading: {
          enabled: true,
          order: 2,
          duration: 60,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
        },
        writing: {
          enabled: false,
          order: 3,
          duration: 60,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
        },
        speaking: {
          enabled: false,
          order: 4,
          duration: 15,
          autoContinue: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
        },
      },
    },
    reading: {
      passages: [
        {
          id: 'passage-1',
          title: 'Passage 1',
          content: 'First paragraph. Second sentence.',
          images: [],
          blocks: [
            {
              id: 'q-block',
              type: 'SHORT_ANSWER',
              instruction: 'Answer the question.',
              questions: [
                {
                  id: 'q1',
                  prompt: 'What is the answer?',
                  correctAnswer: 'answer',
                  answerRule: 'ONE_WORD',
                },
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
}

describe('StudentReading passage readability controls', () => {
  it('does not render in-pane controls anymore', () => {
    const onIncrease = vi.fn();
    const onDecrease = vi.fn();
    const onReset = vi.fn();

    render(
      <StudentReading
        state={createState()}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
        onIncreasePassageReadability={onIncrease}
        onDecreasePassageReadability={onDecrease}
        onResetPassageReadability={onReset}
        passageReadabilityLabel="Comfort"
        canIncreasePassageReadability
        canDecreasePassageReadability
      />,
    );

    expect(screen.queryByTestId('passage-readability-controls')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /increase passage text size/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /decrease passage text size/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset passage readability/i })).not.toBeInTheDocument();

    expect(onIncrease).not.toHaveBeenCalled();
    expect(onDecrease).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });

  it('keeps question pane sizing unchanged', () => {
    render(
      <StudentReading
        state={createState()}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
        onIncreasePassageReadability={vi.fn()}
        onDecreasePassageReadability={vi.fn()}
        onResetPassageReadability={vi.fn()}
        passageReadabilityLabel="Extra Large"
        canIncreasePassageReadability={false}
        canDecreasePassageReadability={false}
      />,
    );

    const questionPane = screen.getByTestId('reading-question-scroll');
    expect(questionPane).not.toHaveStyle({ fontSize: 'var(--student-reading-question-font-size)' });
    expect(questionPane).not.toHaveStyle({ lineHeight: 'var(--student-reading-question-line-height)' });
  });

  it('renders highlightable passage text when highlight mode is enabled', () => {
    const state = createState();
    state.reading.passages[0].content =
      '<p>William Henry Perkin was born in London.<br>As a boy, curiosity shaped his studies.</p><p><em>Second paragraph keeps emphasis.</em></p>';

    const { container } = render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
        highlightEnabled
      />,
    );

    const highlightContainer = container.querySelector('[data-student-highlightable="true"]');
    expect(highlightContainer).not.toBeNull();
    expect(highlightContainer?.textContent).toContain('William Henry Perkin was born in London.');
    expect(highlightContainer?.textContent).toContain('Second paragraph keeps emphasis.');
  });

  it('requires explicit highlight button tap on tablet reading passages', () => {
    render(
      <StudentReading
        state={createState()}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
        highlightEnabled
        tabletMode
      />,
    );

    expect(screen.getByRole('button', { name: /highlight selected text/i })).toBeInTheDocument();
  });

  it('requires explicit highlight button click on desktop reading passages', () => {
    render(
      <StudentReading
        state={createState()}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
        highlightEnabled
      />,
    );

    expect(screen.getByRole('button', { name: /highlight selected text/i })).toBeInTheDocument();
  });

  it('marks the full reading passage pane as highlightable so native drag-selection is never blocked there', () => {
    const { container } = render(
      <StudentReading
        state={createState()}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
        highlightEnabled={false}
      />,
    );

    const passagePane = container.querySelector('.student-reading-passage-pane');
    expect(passagePane).not.toBeNull();
    expect(passagePane).toHaveAttribute('data-student-highlightable', 'true');
  });

  it('does not auto-scroll question panel while passage text selection is active', () => {
    const getSelectionSpy = vi.spyOn(window, 'getSelection');
    const state = createState();
    const scrollIntoViewSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    const { rerender } = render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId={null}
        onNavigate={() => {}}
      />,
    );

    const passagePane = document.querySelector('.student-reading-passage-pane');
    const textNode = passagePane?.querySelector('h2')?.firstChild ?? null;
    expect(textNode).not.toBeNull();

    getSelectionSpy.mockReturnValue({
      isCollapsed: false,
      anchorNode: textNode,
    } as unknown as Selection);

    rerender(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
      />,
    );

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    scrollIntoViewSpy.mockRestore();
    getSelectionSpy.mockRestore();
  });
});
