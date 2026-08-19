import React, { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExamState } from '../../../types';
import { StudentReading } from '../StudentReading';
import { QuestionRenderer } from '../QuestionRenderer';
import {
  createInMemoryHighlightSelectionPort,
  StudentHighlightSelectionPortProvider,
} from '../highlightSelectionPort';
import { StudentUIProvider, useStudentUI } from '../providers/StudentUIProvider';
import { StudentHighlightPersistenceProvider } from '../highlightV2Persistence';
import { readPersistedSurfaceRanges } from '../highlight/highlightStore';

function HighlightMode({ children }: { children: React.ReactNode }) {
  const { actions } = useStudentUI();
  const { setHighlightToolMode } = actions;
  useEffect(() => setHighlightToolMode('highlight'), [setHighlightToolMode]);
  return (
    <>
      <button data-testid="set-erase-mode" onClick={() => setHighlightToolMode('erase')}>
        Test erase mode
      </button>
      {children}
    </>
  );
}

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

  it('normalizes passage html typography to the standard reading font settings', () => {
    const state = createState();
    state.reading.passages[0].content = `
      <p>
        <span style="font-family: 'Times New Roman'; font-size: 28px; line-height: 2.4; color: #102a43;">
          Styled text should keep color only.
        </span>
        <strong>Bold emphasis stays.</strong>
      </p>
    `;

    const { container } = render(
      <StudentReading
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="q1"
        onNavigate={() => {}}
      />,
    );

    const styledSpan = container.querySelector('span');
    expect(styledSpan).not.toBeNull();
    expect(styledSpan).not.toHaveStyle({ fontFamily: 'Times New Roman' });
    expect(styledSpan).not.toHaveStyle({ fontSize: '28px' });
    expect(styledSpan).not.toHaveStyle({ lineHeight: '2.4' });
    expect(styledSpan).toHaveStyle({ color: 'rgb(16, 42, 67)' });
    expect(screen.getByText('Bold emphasis stays.').tagName).toBe('STRONG');
  });

  it('does not render a static highlight button on tablet reading passages', () => {
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

    expect(screen.queryByRole('button', { name: /highlight selected text/i })).not.toBeInTheDocument();
  });

  it('does not render a static highlight button on desktop reading passages', () => {
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

    expect(screen.queryByRole('button', { name: /highlight selected text/i })).not.toBeInTheDocument();
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
    expect(passagePane).toHaveStyle({ userSelect: 'text' });
    expect(passagePane?.getAttribute('style') ?? '').not.toContain(
      'student-exam-footer-clearance',
    );
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

  it('creates and erases a mark in question copy while keeping the answer input excluded', () => {
    const port = createInMemoryHighlightSelectionPort({
      selection: { start: 0, end: 4, selectedText: 'What' },
      selectionText: 'What',
    });
    const { container } = render(
      <StudentHighlightSelectionPortProvider port={port}>
        <StudentHighlightPersistenceProvider namespace="test:question-copy">
          <StudentUIProvider>
            <HighlightMode>
              <QuestionRenderer
                block={createState().reading.passages[0].blocks[0]}
                question={createState().reading.passages[0].blocks[0].questions[0]}
                number={1}
                answer=""
                onChange={() => {}}
                highlightEnabled
              />
            </HighlightMode>
          </StudentUIProvider>
        </StudentHighlightPersistenceProvider>
      </StudentHighlightSelectionPortProvider>,
    );

    act(() => port.emit());
    const mark = container.querySelector('mark[data-highlighted="true"]');
    expect(mark).not.toBeNull();
    expect(mark).toHaveTextContent('What');
    expect(
      readPersistedSurfaceRanges('test:question-copy', 'question:q-block:q1:prompt')?.ranges,
    ).toHaveLength(1);
    expect(mark?.closest('[data-student-highlightable="true"]')).not.toBeNull();
    expect(screen.getByRole('textbox')).not.toHaveAttribute('data-student-highlightable');
    expect(screen.getByRole('textbox').closest('[data-student-highlightable="true"]')).toBeNull();

    act(() => actionsSetEraseMode(container));
    port.setSnapshot({
      selection: { start: 0, end: 4, selectedText: 'What' },
      selectionText: 'What',
    });
    act(() => port.emit());
    expect(container.querySelector('mark[data-highlighted="true"]')).toBeNull();
  });

  it('persists block instruction highlights under the owning reading block id', () => {
    render(
      <StudentHighlightPersistenceProvider namespace="test:reading-instruction">
        <StudentUIProvider>
          <HighlightMode>
            <StudentReading
              state={createState()}
              answers={{}}
              onAnswerChange={() => {}}
              currentQuestionId="q1"
              onNavigate={() => {}}
              highlightEnabled
            />
          </HighlightMode>
        </StudentUIProvider>
      </StudentHighlightPersistenceProvider>,
    );
    const textNode = screen.getByText('Answer the question.').firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event('pointerup'));

    expect(
      readPersistedSurfaceRanges(
        'test:reading-instruction',
        'question:reading:q-block:instruction',
      )?.ranges,
    ).toHaveLength(1);
  });
});

function actionsSetEraseMode(container: HTMLElement) {
  const button = container.querySelector('[data-testid="set-erase-mode"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Expected erase mode test control');
  button.click();
}
