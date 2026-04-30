import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormattedText } from '../FormattedText';
import { StudentHighlightPersistenceProvider, clearStudentHighlights } from '../highlightPersistence';
import { RichTextHighlighter } from '../RichTextHighlighter';

describe('student highlight persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const createSelectionMock = (getTextNode: () => ChildNode | null) => {
    let selectionCleared = false;

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
        range.setStart(textNode, 6);
        range.setEnd(textNode, 10);
        return range;
      },
      toString: () => (selectionCleared ? '' : 'beta'),
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

  it('applies highlights after touch selection on iPad', async () => {
    let currentTextNode: ChildNode | null = null;
    const selectionMock = createSelectionMock(() => currentTextNode);

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);

    const { container } = render(<FormattedText text="Alpha beta gamma" highlightEnabled />);
    const textElement = container.querySelector('span');
    if (!textElement) {
      throw new Error('Expected a rendered text span');
    }

    currentTextNode = textElement.firstChild;
    fireEvent.touchEnd(textElement);

    await waitFor(() => {
      expect(container.querySelector('mark')).not.toBeNull();
    });

    getSelectionSpy.mockRestore();
  });

  it('uses selectionchange as a touch fallback inside rich text containers', async () => {
    let currentTextNode: ChildNode | null = null;
    const selectionMock = createSelectionMock(() => currentTextNode);

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selectionMock);

    const { container } = render(<RichTextHighlighter content="Alpha beta gamma" enabled />);
    const textElement = container.querySelector('[data-student-highlightable="true"]');
    if (!textElement) {
      throw new Error('Expected a rendered highlight container');
    }

    currentTextNode = textElement.firstChild;
    fireEvent(document, new Event('selectionchange'));

    await waitFor(() => {
      expect(container.querySelector('mark')).not.toBeNull();
    });

    getSelectionSpy.mockRestore();
  });
});
