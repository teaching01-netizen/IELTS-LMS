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
    fireEvent.touchStart(textElement);
    fireEvent.touchEnd(textElement);

    expect(container.querySelector('mark')).toBeNull();
    expect(screen.queryByRole('button', { name: /highlight selected text/i })).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(419);
    });
    expect(container.querySelector('mark')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(container.querySelector('mark')).not.toBeNull();
    expect(container.querySelector('mark')).toHaveTextContent('beta gamma delta');

    getSelectionSpy.mockRestore();
  });

  it('auto-highlights from snapshot even if live touch selection collapses before timer completes', async () => {
    vi.useFakeTimers();
    let currentTextNode: ChildNode | null = null;
    const activeSelection = createSelectionMock(() => currentTextNode, {
      start: 6,
      end: 22,
      text: 'beta gamma delta',
    });
    const collapsedSelection = {
      rangeCount: 0,
      getRangeAt: () => {
        throw new Error('Selection collapsed');
      },
      toString: () => '',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const getSelectionSpy = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue(activeSelection);

    const { container } = render(<FormattedText text="Alpha beta gamma delta" highlightEnabled />);
    const textElement = container.querySelector('span');
    if (!textElement) {
      throw new Error('Expected a rendered text span');
    }

    currentTextNode = textElement.firstChild;
    fireEvent.touchStart(textElement);
    getSelectionSpy.mockReturnValue(collapsedSelection);

    await act(async () => {
      vi.advanceTimersByTime(420);
    });

    expect(container.querySelector('mark')).not.toBeNull();
    expect(container.querySelector('mark')).toHaveTextContent('beta gamma delta');

    getSelectionSpy.mockRestore();
  });

  it('does not reset the timer for identical selectionchange snapshots and does not require container touchend', async () => {
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
    fireEvent.touchStart(textElement);

    expect(container.querySelector('mark')).toBeNull();
    expect(screen.queryByRole('button', { name: /highlight selected text/i })).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    fireEvent(document, new Event('selectionchange'));
    await act(async () => {
      vi.advanceTimersByTime(319);
    });
    expect(container.querySelector('mark')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(container.querySelector('mark')).not.toBeNull();
    expect(container.querySelector('mark')).toHaveTextContent('beta gamma delta');

    getSelectionSpy.mockRestore();
  });

  it('forces auto-highlight by the max wait cap during continuous touch selection changes', async () => {
    vi.useFakeTimers();
    let currentTextNode: ChildNode | null = null;
    let start = 6;
    let end = 10;
    let text = 'beta';
    const selectionMock = {
      rangeCount: 1,
      getRangeAt: () => {
        const textNode = currentTextNode;
        if (!textNode) {
          throw new Error('Expected a text node');
        }

        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, end);
        return range;
      },
      toString: () => text,
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);

    const { container } = render(<RichTextHighlighter content="Alpha beta gamma delta epsilon zeta eta theta" enabled />);
    const textElement = container.querySelector('[data-student-highlightable="true"]');
    if (!textElement) {
      throw new Error('Expected a rendered highlight container');
    }

    currentTextNode = textElement.firstChild;
    fireEvent.touchStart(textElement);

    const changeSelection = (nextEnd: number, nextText: string) => {
      end = nextEnd;
      text = nextText;
      fireEvent(document, new Event('selectionchange'));
    };

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    changeSelection(16, 'beta gamma');

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    changeSelection(22, 'beta gamma delta');

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    changeSelection(30, 'beta gamma delta epsilon');

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    changeSelection(35, 'beta gamma delta epsilon zeta');

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    changeSelection(39, 'beta gamma delta epsilon zeta eta');

    await act(async () => {
      vi.advanceTimersByTime(199);
    });
    expect(container.querySelector('mark')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(container.querySelector('mark')).not.toBeNull();
    expect(container.querySelector('mark')).toHaveTextContent('beta gamma delta epsilon zeta eta');

    getSelectionSpy.mockRestore();
  });

  it('does not remove a highlight on the immediate post-auto-apply tap but allows removal after the guard window', async () => {
    vi.useFakeTimers();
    let currentTextNode: ChildNode | null = null;
    const selectionMock = createSelectionMock(() => currentTextNode, {
      start: 6,
      end: 10,
      text: 'beta',
    });
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);

    const { container } = render(<RichTextHighlighter content="Alpha beta gamma" enabled />);
    const textElement = container.querySelector('[data-student-highlightable="true"]');
    if (!textElement) {
      throw new Error('Expected a rendered highlight container');
    }

    currentTextNode = textElement.firstChild;
    fireEvent.touchStart(textElement);
    fireEvent.touchEnd(textElement);

    await act(async () => {
      vi.advanceTimersByTime(420);
    });

    const highlight = container.querySelector('mark[data-highlighted="true"]');
    expect(highlight).not.toBeNull();
    if (!highlight) {
      throw new Error('Expected a highlight to be created');
    }

    fireEvent.click(highlight);
    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(701);
    });

    fireEvent.click(highlight);
    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(0);

    getSelectionSpy.mockRestore();
  });

  it('does not remove a highlight immediately after a successful mouse selection but allows removal after the guard window', async () => {
    vi.useFakeTimers();
    let currentTextNode: ChildNode | null = null;
    const selectionMock = createSelectionMock(() => currentTextNode, {
      start: 6,
      end: 10,
      text: 'beta',
    });
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);

    const { container } = render(<FormattedText text="Alpha beta gamma" highlightEnabled />);
    const textElement = container.querySelector('span');
    if (!textElement) {
      throw new Error('Expected a rendered text span');
    }

    currentTextNode = textElement.firstChild;
    fireEvent.mouseUp(textElement);
    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(1);

    const highlight = container.querySelector('mark[data-highlighted="true"]');
    if (!highlight) {
      throw new Error('Expected a highlight to be created');
    }

    fireEvent.click(highlight);
    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(451);
    });

    fireEvent.click(highlight);
    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(0);

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

  it('does not remove a highlight while a non-collapsed text selection is active', async () => {
    const activeSelection = {
      rangeCount: 1,
      isCollapsed: false,
      toString: () => 'beta gamma',
    } as Selection;
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(activeSelection);

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

    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(2);
    getSelectionSpy.mockRestore();
  });

  it('does not remove a highlight immediately after a mouse selection attempt that cannot be highlighted', async () => {
    const outsideHost = document.createElement('div');
    outsideHost.textContent = 'outside text';
    document.body.appendChild(outsideHost);
    const outsideTextNode = outsideHost.firstChild;
    if (!outsideTextNode) {
      throw new Error('Expected outside text node');
    }
    const outsideRange = document.createRange();
    outsideRange.setStart(outsideTextNode, 0);
    outsideRange.setEnd(outsideTextNode, 7);

    const selectionIntent = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => outsideRange,
      toString: () => 'outside',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;
    const collapsedSelection = {
      rangeCount: 0,
      isCollapsed: true,
      toString: () => '',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;
    let currentSelection: Selection = selectionIntent;
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockImplementation(() => currentSelection);

    const { container } = render(
      <RichTextHighlighter
        content={'Alpha <mark data-highlighted="true" class="bg-yellow-200">beta</mark> gamma <mark data-highlighted="true" class="bg-yellow-200">delta</mark>'}
        contentType="html"
        enabled
      />,
    );

    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(2);
    const textContainer = container.querySelector('[data-student-highlightable="true"]');
    if (!textContainer) {
      throw new Error('Expected highlightable container');
    }
    fireEvent.mouseUp(textContainer);

    currentSelection = collapsedSelection;
    const firstHighlight = container.querySelector('mark[data-highlighted="true"]');
    if (!firstHighlight) {
      throw new Error('Expected a highlighted phrase');
    }
    fireEvent.click(firstHighlight);

    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(2);

    getSelectionSpy.mockRestore();
    document.body.removeChild(outsideHost);
  });
});
