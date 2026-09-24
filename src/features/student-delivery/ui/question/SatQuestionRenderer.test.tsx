import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeliveredQuestion } from '../../contracts/assessmentDelivery';
import { createSatTextAnnotation, emptySatQuestionResponse } from '../../domain/satResponses';
import { createSatReadingPreferences } from '../../domain/satReadingPreferences';
import { SatAnnotationViewContext } from '../annotations/SatAnnotationViewContext';
import { SatQuestionRenderer } from './SatQuestionRenderer';
import { StudentExamInteractionScopeProvider } from '@shared/ui/touch-selection/StudentExamInteractionScope';
import { clearSatGestureOrigin, clearSatSelectionGesture, isSatSelectionGestureEcho, SAT_SELECTION_GUARD_MS } from '../annotations/satSelectionDragGuard';

let restoreGestureEnvironment: (() => void) | null = null;

afterEach(() => {
  restoreGestureEnvironment?.();
  restoreGestureEnvironment = null;
  clearSatGestureOrigin();
  clearSatSelectionGesture();
  vi.useRealTimers();
});

const text = { version: 1 as const, nodes: [{ type: 'paragraph' as const, id: 'same-id', text: 'A tree grows.' }] };
const question: DeliveredQuestion = {
  examQuestionId: 'q1', questionId: 'q1', displayOrder: 0, isPretest: false, questionType: 'single_choice',
  stimulus: text, prompt: text,
  answer: { kind: 'single_choice', options: [{ id: 'A', content: text }] },
  metadata: { sectionKey: 'reading-writing', domain: null, skill: null, difficulty: 'medium', tags: [] },
  accessibility: { longDescription: null },
};
const mathQuestion: DeliveredQuestion = {
  ...question,
  metadata: { ...question.metadata, sectionKey: 'math' },
};

describe('SAT annotated question rendering', () => {
  it('renders saved passage highlights without marking the identical prompt or answer text', () => {
    const response = emptySatQuestionResponse('q1');
    response.annotations.annotations = [createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:same-id', startOffset: 2, endOffset: 6, exact: 'tree' })];
    const { container } = render(<SatQuestionRenderer sectionKey="reading-writing" questionNumber={1} question={question} response={response}
      eliminationMode={false} disabled={false} readingPreferences={createSatReadingPreferences()}
      onReadingSplitRatioChange={vi.fn()} onAnswerChange={vi.fn()} onToggleReview={vi.fn()} onToggleEliminationMode={vi.fn()} onToggleEliminatedOption={vi.fn()} />);
    const highlights = container.querySelectorAll('[data-sat-highlight="true"]');
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toHaveTextContent('tree');
    expect(highlights[0]?.closest('[data-sat-passage-scroll]')).not.toBeNull();
  });

  it('uses the supporting material pane for Math questions with stimulus content', () => {
    const response = emptySatQuestionResponse('q1');
    const { container } = render(<SatQuestionRenderer sectionKey="math" questionNumber={1} question={mathQuestion} response={response}
      eliminationMode={false} disabled={false} readingPreferences={createSatReadingPreferences()}
      onReadingSplitRatioChange={vi.fn()} onAnswerChange={vi.fn()} onToggleReview={vi.fn()} onToggleEliminationMode={vi.fn()} onToggleEliminatedOption={vi.fn()} />);

    expect(screen.queryByRole('group', { name: 'Supporting material and question layout' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Supporting material' })).toHaveTextContent('A tree grows.');
    expect(screen.getByRole('slider', { name: 'Supporting material and question width' })).toBeInTheDocument();
    expect(container.querySelector('[data-sat-question-scroll]')).toHaveTextContent('A tree grows.');
  });

  it('annotates Math prompt, supporting material, and choice text roots', () => {
    const response = emptySatQuestionResponse('q1');
    response.annotations.annotations = [
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:same-id', startOffset: 2, endOffset: 6, exact: 'tree' }),
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'prompt:same-id', startOffset: 2, endOffset: 6, exact: 'tree' }),
    ];
    const { container } = render(
      <SatAnnotationViewContext.Provider value={{ activeAnnotationId: null, openEditorActive: true, annotationModeEnabled: true, openEditor: vi.fn() }}>
        <SatQuestionRenderer sectionKey="math" questionNumber={1} question={mathQuestion} response={response}
          eliminationMode={false} disabled={false} readingPreferences={createSatReadingPreferences()}
          onReadingSplitRatioChange={vi.fn()} onAnswerChange={vi.fn()} onToggleReview={vi.fn()} onToggleEliminationMode={vi.fn()} onToggleEliminatedOption={vi.fn()} />
      </SatAnnotationViewContext.Provider>,
    );
    const regions = [...container.querySelectorAll('[data-sat-annotation-region]')].map((el) => el.getAttribute('data-sat-annotation-region'));
    expect(regions).toContain('stimulus');
    expect(regions).toContain('prompt');
    expect(container.querySelector('[data-sat-annotation-region="stimulus"] [data-sat-highlight="true"]')).toHaveTextContent('tree');
    expect(container.querySelector('[data-sat-annotation-region="prompt"] [data-sat-highlight="true"]')).toHaveTextContent('tree');
    // Choice wording stays annotatable in Math too.
    expect(container.querySelector('[data-sat-annotation-region="choice.A"] [data-content-text-node]')).not.toBeNull();
  });
});

describe('SAT choice annotations', () => {
  const optionContent = {
    version: 1 as const,
    nodes: [{ type: 'paragraph' as const, id: 'same-id', text: 'Tree cover affects heat.' }],
  };
  const optionA = { id: 'option-a', content: optionContent };
  const optionB = { id: 'option-b', content: optionContent };
  const choicesQuestion: DeliveredQuestion = {
    ...question,
    answer: { kind: 'single_choice', options: [optionA, optionB] },
  };

  it('keeps a choice mark and note attached to its option across identical text, reordering, and question navigation', () => {
    const marked = createSatTextAnnotation({
      kind: 'highlight',
      nodeId: 'choice.option-a:same-id',
      startOffset: 0,
      endOffset: 4,
      exact: 'Tree',
      note: 'Compare the local conditions',
    });
    const response = {
      ...emptySatQuestionResponse('q1'),
      annotations: { version: 2 as const, annotations: [marked], legacyQuestionNote: '' },
    };
    const openEditor = vi.fn();
    const props = {
      sectionKey: 'reading-writing' as const,
      questionNumber: 1,
      response,
      eliminationMode: false,
      disabled: false,
      readingPreferences: createSatReadingPreferences(),
      onReadingSplitRatioChange: vi.fn(),
      onAnswerChange: vi.fn(),
      onToggleReview: vi.fn(),
      onToggleEliminationMode: vi.fn(),
      onToggleEliminatedOption: vi.fn(),
    };
    const { container, rerender } = render(
      <SatAnnotationViewContext.Provider value={{ activeAnnotationId: null, openEditorActive: true, annotationModeEnabled: true, openEditor }}>
        <SatQuestionRenderer {...props} question={choicesQuestion} />
      </SatAnnotationViewContext.Provider>,
    );

    const assertChoiceAOwnsTheMark = () => {
      const first = container.querySelector('[data-sat-annotation-region="choice.option-a"]')!;
      const second = container.querySelector('[data-sat-annotation-region="choice.option-b"]')!;
      const marks = container.querySelectorAll('[data-sat-highlight="true"]');
      expect(marks).toHaveLength(1);
      expect(marks[0]).toHaveTextContent('Tree');
      expect(first).toContainElement(marks[0] as HTMLElement);
      expect(second.querySelector('[data-sat-highlight="true"]')).toBeNull();
      const optionARadio = container.querySelector<HTMLInputElement>('input[value="option-a"]')!;
      expect(first.closest('label')).toContainElement(optionARadio);
      expect(first).not.toContainElement(optionARadio);
      expect(first).toHaveAttribute('data-sat-selection-protected', 'true');
    };
    assertChoiceAOwnsTheMark();

    fireEvent.click(container.querySelector(`[data-sat-annotation-id="${marked.id}"]`)!);
    expect(openEditor).toHaveBeenCalledWith(marked);

    rerender(
      <SatAnnotationViewContext.Provider value={{ activeAnnotationId: null, openEditorActive: true, annotationModeEnabled: true, openEditor }}>
        <SatQuestionRenderer {...props} question={{
          ...choicesQuestion,
          answer: { kind: 'single_choice', options: [optionB, optionA] },
        }} />
      </SatAnnotationViewContext.Provider>,
    );
    assertChoiceAOwnsTheMark();

    // Navigating to another question removes the old surface; returning with
    // that question's saved response resolves the mark to the same stable id.
    rerender(
      <SatAnnotationViewContext.Provider value={{ activeAnnotationId: null, openEditorActive: true, annotationModeEnabled: true, openEditor }}>
        <SatQuestionRenderer
          {...props}
          response={emptySatQuestionResponse('q2')}
          question={{
            ...choicesQuestion,
            examQuestionId: 'q2',
            questionId: 'q2',
            answer: { kind: 'single_choice', options: [{ id: 'other-option', content: optionContent }] },
          }}
        />
      </SatAnnotationViewContext.Provider>,
    );
    expect(container.querySelector('[data-sat-highlight="true"]')).toBeNull();

    rerender(
      <SatAnnotationViewContext.Provider value={{ activeAnnotationId: null, openEditorActive: true, annotationModeEnabled: true, openEditor }}>
        <SatQuestionRenderer {...props} question={choicesQuestion} />
      </SatAnnotationViewContext.Provider>,
    );
    assertChoiceAOwnsTheMark();
  });

  it('owns a drag that starts in choice wording and suppresses its label click', () => {
    const onAnswerChange = vi.fn();
    const onSelectionCaptured = vi.fn();
    const mediaOriginal = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('pointer: coarse'), media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {},
      removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const caretDocument = document as unknown as {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    const oldCaretPosition = caretDocument.caretPositionFromPoint;
    const { container } = render(
      <StudentExamInteractionScopeProvider ownedTouchSelection>
        <SatAnnotationViewContext.Provider value={{
          activeAnnotationId: null,
          openEditorActive: true,
          annotationModeEnabled: true,
          openEditor: vi.fn(),
          onSelectionCaptured,
        }}>
          <SatQuestionRenderer
            sectionKey="reading-writing"
            questionNumber={1}
            question={choicesQuestion}
            response={emptySatQuestionResponse('q1')}
            eliminationMode={false}
            disabled={false}
            readingPreferences={createSatReadingPreferences()}
            onReadingSplitRatioChange={vi.fn()}
            onAnswerChange={onAnswerChange}
            onToggleReview={vi.fn()}
            onToggleEliminationMode={vi.fn()}
            onToggleEliminatedOption={vi.fn()}
          />
        </SatAnnotationViewContext.Provider>
      </StudentExamInteractionScopeProvider>,
    );
    const selectionRoot = container.querySelector<HTMLElement>('[data-sat-annotation-region="choice.option-a"]')!;
    const block = selectionRoot.querySelector('[data-content-text-node]')!;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode() as Text;
    caretDocument.caretPositionFromPoint = (x) => ({ offsetNode: text, offset: Math.round(x) });
    restoreGestureEnvironment = () => {
      window.matchMedia = mediaOriginal;
      if (oldCaretPosition) caretDocument.caretPositionFromPoint = oldCaretPosition;
      else delete caretDocument.caretPositionFromPoint;
    };
    vi.useFakeTimers();

    fireEvent.pointerDown(selectionRoot, { pointerType: 'touch', pointerId: 1, clientX: 2, clientY: 10 });
    fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: 2, clientY: 25 });
    fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: 6, clientY: 25 });
    fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1, clientX: 6, clientY: 25 });

    expect(onSelectionCaptured).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'choice.option-a:same-id' }));
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(isSatSelectionGestureEcho()).toBe(true);

    // Browsers synthesize this click after touch pointerup on the wrapping label.
    fireEvent.click(selectionRoot.querySelector('[data-content-text-node]')!);
    expect(onAnswerChange).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(SAT_SELECTION_GUARD_MS + 1); });
    fireEvent.click(selectionRoot.querySelector('[data-content-text-node]')!);
    expect(onAnswerChange).toHaveBeenCalledWith('option-a');
  });
});

describe('annotation mark affordances follow the shell view context', () => {
  it('reports a mark tap upward instead of mutating annotations itself', () => {
    // The shell owns every annotation write (toolbar, dock, note card), so the
    // renderer is only a reporter: tapping a mark asks the shell to open it.
    const noted = createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:same-id', startOffset: 0, endOffset: 7, exact: 'A tree ', note: 'Check the evidence' });
    const response = { ...emptySatQuestionResponse('q1'), annotations: { version: 2, annotations: [noted], legacyQuestionNote: '' } };
    const openEditor = vi.fn();
    render(
      <SatAnnotationViewContext.Provider value={{ activeAnnotationId: null, openEditorActive: true, annotationModeEnabled: true, openEditor }}>
        <SatQuestionRenderer sectionKey="reading-writing" questionNumber={1} question={question} response={response}
          eliminationMode={false} disabled={false} readingPreferences={createSatReadingPreferences()}
          onReadingSplitRatioChange={vi.fn()} onAnswerChange={vi.fn()} onToggleReview={vi.fn()} onToggleEliminationMode={vi.fn()} onToggleEliminatedOption={vi.fn()} />
      </SatAnnotationViewContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Highlight: A tree/ }));
    expect(openEditor).toHaveBeenCalledWith(noted);
  });
});
