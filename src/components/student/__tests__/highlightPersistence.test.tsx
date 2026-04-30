import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormattedText } from '../FormattedText';
import { StudentHighlightPersistenceProvider, clearStudentHighlights } from '../highlightPersistence';
import { RichTextHighlighter } from '../RichTextHighlighter';

describe('student highlight persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const createSelectionMock = (
    getTextNode: () => ChildNode | null,
    selection: { start?: number; end?: number; text?: string } = {},
  ) => {
    let selectionCleared = false;
    const start = selection.start ?? 6;
    const end = selection.end ?? 10;
    const text = selection.text ?? 'beta';

    return {
      get rangeCount() {
        return selectionCleared ? 0 : 1;
      },
      getRangeAt: () => {
        const textNode = getTextNode();
        if (!textNode) {
          throw new Error('Expected a text node');
        }

        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
        return range;
      },
      toString: () => (selectionCleared ? '' : text),
      removeAllRanges: vi.fn(() => {
        selectionCleared = true;
      }),
    } as unknown as Selection;
  };

  it('persists a highlight across remounts and clears it on request', async () => {
    const namespace = 'attempt-highlight-test';
    let currentTextNode: ChildNode | null = null;
    const selectionMock = createSelectionMock(() => currentTextNode);

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);

    const renderText = () =>
      render(
        <StudentHighlightPersistenceProvider namespace={namespace}>
          <FormattedText text="Alpha beta gamma" highlightEnabled />
        </StudentHighlightPersistenceProvider>,
      );

    const firstRender = renderText();
    const textElement = firstRender.container.querySelector('span');
    if (!textElement) {
      throw new Error('Expected a rendered text span');
    }

    currentTextNode = textElement.firstChild;
    fireEvent.mouseUp(textElement);

    await waitFor(() => {
      expect(firstRender.container.querySelector('mark')).not.toBeNull();
    });

    firstRender.unmount();

    const secondRender = renderText();
    await waitFor(() => {
      expect(secondRender.container.querySelector('mark')).not.toBeNull();
    });

    act(() => {
      clearStudentHighlights(namespace);
    });

    await waitFor(() => {
      expect(secondRender.container.querySelector('mark')).toBeNull();
    });

    getSelectionSpy.mockRestore();
  });

  it('auto-highlights after touch selection settles on iPad', async () => {
    vi.useFakeTimers();
    let currentTextNode: ChildNode | null = null;
    const selectionMock = createSelectionMock(() => currentTextNode, {
      start: 6,
      end: 22,
      text: 'beta gamma delta',
    });

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);

    const { container } = render(<FormattedText text="Alpha beta gamma delta" highlightEnabled />);
    const textElement = container.querySelector('span');
    if (!textElement) {
      throw new Error('Expected a rendered text span');
    }

    currentTextNode = textElement.firstChild;
    fireEvent.touchEnd(textElement);

    expect(container.querySelector('mark')).toBeNull();
    expect(screen.queryByRole('button', { name: /highlight selected text/i })).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(container.querySelector('mark')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(container.querySelector('mark')).not.toBeNull();
    expect(container.querySelector('mark')).toHaveTextContent('beta gamma delta');

    getSelectionSpy.mockRestore();
  });

  it('debounces selectionchange before auto-highlighting rich text containers', async () => {
    vi.useFakeTimers();
    let currentTextNode: ChildNode | null = null;
    const selectionMock = createSelectionMock(() => currentTextNode, {
      start: 6,
      end: 22,
      text: 'beta gamma delta',
    });

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);

    const { container } = render(<RichTextHighlighter content="Alpha beta gamma delta" enabled />);
    const textElement = container.querySelector('[data-student-highlightable="true"]');
    if (!textElement) {
      throw new Error('Expected a rendered highlight container');
    }

    currentTextNode = textElement.firstChild;
    fireEvent(document, new Event('selectionchange'));

    expect(container.querySelector('mark')).toBeNull();
    expect(screen.queryByRole('button', { name: /highlight selected text/i })).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent(document, new Event('selectionchange'));
    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(container.querySelector('mark')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(container.querySelector('mark')).not.toBeNull();
    expect(container.querySelector('mark')).toHaveTextContent('beta gamma delta');

    getSelectionSpy.mockRestore();
  });

  it('removes one tapped highlight while preserving the rest', async () => {
    const { container } = render(
      <RichTextHighlighter
        content={'Alpha <mark data-highlighted="true" class="bg-yellow-200">beta</mark> gamma <mark data-highlighted="true" class="bg-yellow-200">delta</mark>'}
        contentType="html"
        enabled
      />,
    );

    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(2);

    const firstHighlight = container.querySelector('mark[data-highlighted="true"]');
    if (!firstHighlight) {
      throw new Error('Expected a highlighted phrase');
    }

    fireEvent.click(firstHighlight);

    await waitFor(() => {
      expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(1);
      expect(container).toHaveTextContent('Alpha beta gamma delta');
      expect(container.querySelector('mark[data-highlighted="true"]')).toHaveTextContent('delta');
    });
  });
});
