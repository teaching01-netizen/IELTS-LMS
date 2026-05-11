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

  it('highlights on touch end after touch selection settles on iPad', async () => {
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
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByRole('button', { name: /highlight selected text/i })).not.toBeInTheDocument();

    expect(container.querySelector('mark')).not.toBeNull();
    expect(container.querySelector('mark')).toHaveTextContent('beta gamma delta');

    getSelectionSpy.mockRestore();
  });

  it('keeps touch selection pending until explicit button press when highlight button mode is enabled', async () => {
    vi.useFakeTimers();
    let currentTextNode: ChildNode | null = null;
    const selectionMock = createSelectionMock(() => currentTextNode, {
      start: 6,
      end: 22,
      text: 'beta gamma delta',
    });
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);

    const { container } = render(
      <FormattedText text="Alpha beta gamma delta" highlightEnabled showHighlightButton />,
    );
    const textElement = container.querySelector('span');
    if (!textElement) {
      throw new Error('Expected a rendered text span');
    }

    currentTextNode = textElement.firstChild;
    fireEvent.touchStart(textElement);
    fireEvent.touchEnd(textElement);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(container.querySelector('mark')).toBeNull();

    expect(screen.getByRole('button', { name: /highlight selected text/i })).toBeInTheDocument();

    getSelectionSpy.mockRestore();
  });

  it('auto-highlights from snapshot even if live touch selection collapses before touch end', async () => {
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
    fireEvent(document, new Event('selectionchange'));
    getSelectionSpy.mockReturnValue(collapsedSelection);
    fireEvent.touchEnd(textElement);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    const marks = container.querySelectorAll('mark[data-highlighted="true"]');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('beta gamma delta');

    getSelectionSpy.mockRestore();
  });

  it('does not apply a stale touch-start snapshot when no in-session selectionchange occurred', async () => {
    vi.useFakeTimers();
    let currentTextNode: ChildNode | null = null;
    const staleSelection = createSelectionMock(() => currentTextNode, {
      start: 0,
      end: 22,
      text: 'Alpha beta gamma delta',
    });
    const collapsedSelection = {
      rangeCount: 0,
      getRangeAt: () => {
        throw new Error('Selection collapsed');
      },
      toString: () => '',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(staleSelection);

    const { container } = render(<FormattedText text="Alpha beta gamma delta" highlightEnabled />);
    const textElement = container.querySelector('span');
    if (!textElement) {
      throw new Error('Expected a rendered text span');
    }

    currentTextNode = textElement.firstChild;
    fireEvent.touchStart(textElement);
    getSelectionSpy.mockReturnValue(collapsedSelection);
    fireEvent.touchEnd(textElement);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    const marks = container.querySelectorAll('mark[data-highlighted="true"]');
    expect(marks).toHaveLength(0);

    getSelectionSpy.mockRestore();
  });

  it('does not apply before touch end, even when selectionchange repeats the same snapshot', async () => {
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
      vi.advanceTimersByTime(1000);
    });
    fireEvent(document, new Event('selectionchange'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelector('mark')).toBeNull();

    fireEvent.touchEnd(textElement);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(container.querySelector('mark')).not.toBeNull();
    expect(container.querySelector('mark')).toHaveTextContent('beta gamma delta');

    getSelectionSpy.mockRestore();
  });

  it('applies the latest long touch selection only on touch end', async () => {
    vi.useFakeTimers();
    let currentTextNode: ChildNode | null = null;
    const start = 6;
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
      vi.advanceTimersByTime(3000);
    });
    expect(container.querySelector('mark')).toBeNull();

    fireEvent.touchEnd(textElement);
    await act(async () => {
      vi.advanceTimersByTime(500);
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
      vi.advanceTimersByTime(500);
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

  it('retries after touch end and highlights once selection stabilizes later', async () => {
    vi.useFakeTimers();
    let currentTextNode: ChildNode | null = null;
    let selectionReady = false;
    const selectionMock = {
      get rangeCount() {
        return selectionReady ? 1 : 0;
      },
      getRangeAt: () => {
        if (!selectionReady) {
          throw new Error('Selection not ready');
        }
        const textNode = currentTextNode;
        if (!textNode) {
          throw new Error('Expected a text node');
        }
        const range = document.createRange();
        range.setStart(textNode, 6);
        range.setEnd(textNode, 22);
        return range;
      },
      toString: () => (selectionReady ? 'beta gamma delta' : ''),
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);
    const { container } = render(<RichTextHighlighter content="Alpha beta gamma delta" enabled />);
    const textElement = container.querySelector('[data-student-highlightable="true"]');
    if (!textElement) {
      throw new Error('Expected a rendered highlight container');
    }

    currentTextNode = textElement.firstChild;
    fireEvent.touchStart(textElement);
    fireEvent.touchEnd(textElement);

    await act(async () => {
      vi.advanceTimersByTime(130);
    });
    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(0);

    selectionReady = true;
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(1);
    expect(container.querySelector('mark[data-highlighted="true"]')).toHaveTextContent('beta gamma delta');
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

  it('does not auto-retry desktop highlight after a collapsed mouseup selection', async () => {
    vi.useFakeTimers();
    let currentTextNode: ChildNode | null = null;
    let collapsed = false;
    const selectionMock = {
      get rangeCount() {
        return collapsed ? 0 : 1;
      },
      getRangeAt: () => {
        if (collapsed) {
          throw new Error('Selection collapsed');
        }
        const textNode = currentTextNode;
        if (!textNode) {
          throw new Error('Expected a text node');
        }
        const range = document.createRange();
        range.setStart(textNode, 6);
        range.setEnd(textNode, 10);
        return range;
      },
      toString: () => (collapsed ? '' : 'beta'),
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);

    const { container } = render(<RichTextHighlighter content="Alpha beta gamma" enabled />);
    const textElement = container.querySelector('[data-student-highlightable="true"]');
    if (!textElement) {
      throw new Error('Expected a rendered highlight container');
    }

    currentTextNode = textElement.firstChild;
    collapsed = true;
    fireEvent.mouseUp(textElement);
    expect(container.querySelector('mark')).toBeNull();

    collapsed = false;
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(container.querySelector('mark')).toBeNull();

    getSelectionSpy.mockRestore();
  });

  it('highlights cross-paragraph selection without showing a policy hint', async () => {
    vi.useFakeTimers();
    let firstParagraphTextNode: ChildNode | null = null;
    let secondParagraphTextNode: ChildNode | null = null;
    const selectionMock = {
      rangeCount: 1,
      getRangeAt: () => {
        if (!firstParagraphTextNode || !secondParagraphTextNode) {
          throw new Error('Expected paragraph text nodes');
        }
        const range = document.createRange();
        range.setStart(firstParagraphTextNode, 6);
        range.setEnd(secondParagraphTextNode, 5);
        return range;
      },
      toString: () => {
        if (!firstParagraphTextNode || !secondParagraphTextNode) {
          return '';
        }
        const range = document.createRange();
        range.setStart(firstParagraphTextNode, 6);
        range.setEnd(secondParagraphTextNode, 5);
        return range.toString();
      },
      removeAllRanges: vi.fn(),
    } as unknown as Selection;
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);

    const { container } = render(
      <RichTextHighlighter
        content="<p>Alpha beta</p><p>Gamma delta</p>"
        contentType="html"
        enabled
      />,
    );

    const highlightable = container.querySelector('[data-student-highlightable="true"]');
    if (!highlightable) {
      throw new Error('Expected a rendered highlight container');
    }
    const paragraphs = highlightable.querySelectorAll('p');
    firstParagraphTextNode = paragraphs[0]?.firstChild ?? null;
    secondParagraphTextNode = paragraphs[1]?.firstChild ?? null;

    fireEvent.mouseDown(highlightable);
    fireEvent.mouseUp(highlightable);

    expect(screen.queryByText('Highlight works within one paragraph at a time.')).not.toBeInTheDocument();
    expect(container.querySelectorAll('mark[data-highlighted="true"]').length).toBeGreaterThan(0);
    getSelectionSpy.mockRestore();
  });
});
