import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { FormattedText } from '../FormattedText';
import { StudentHighlightPersistenceProvider } from '../highlightPersistence';

function findFirstTextNode(root: Element): ChildNode | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.textContent?.length ?? 0) > 0) {
      return node;
    }
    node = walker.nextNode();
  }
  return null;
}

function createSelectionMock(
  getTextNode: () => ChildNode | null,
  options: { start: number; end: number; text: string },
): Selection {
  return {
    rangeCount: 1,
    getRangeAt: () => {
      const textNode = getTextNode();
      if (!textNode) {
        throw new Error('Expected text node');
      }
      const range = document.createRange();
      range.setStart(textNode, options.start);
      range.setEnd(textNode, options.end);
      return range;
    },
    toString: () => options.text,
    removeAllRanges: vi.fn(),
  } as unknown as Selection;
}

describe('student highlight persistence v2', () => {
  it('rejects broad container-boundary selections to avoid accidental select-all highlights', () => {
    let highlightable: Element | null = null;
    const broadSelection = {
      rangeCount: 1,
      getRangeAt: () => {
        if (!highlightable) {
          throw new Error('Expected surface');
        }
        const range = document.createRange();
        range.setStart(highlightable, 0);
        range.setEnd(highlightable, highlightable.childNodes.length);
        return range;
      },
      toString: () => highlightable?.textContent ?? '',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(broadSelection);

    const { container } = render(
      <FormattedText text={'Alpha beta.\n\nGamma delta.'} as="div" highlightEnabled />,
    );
    highlightable = container.querySelector('[data-student-highlightable="true"]');
    if (!highlightable) {
      throw new Error('Expected highlight surface');
    }

    fireEvent(document, new Event('selectionchange'));

    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(0);

    getSelectionSpy.mockRestore();
  });

  it('persists v2 ranges across remounts within the same attempt namespace', () => {
    let textNode: ChildNode | null = null;
    const selection = createSelectionMock(() => textNode, {
      start: 6,
      end: 10,
      text: 'beta',
    });
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selection);

    const first = render(
      <StudentHighlightPersistenceProvider namespace="attempt:demo-v2">
        <FormattedText
          text="Alpha beta gamma"
          highlightEnabled
          highlightSurfaceId="test:persist"
        />
      </StudentHighlightPersistenceProvider>,
    );

    const firstSurface = first.container.querySelector('[data-student-highlightable="true"]');
    if (!firstSurface) {
      throw new Error('Expected first surface');
    }

    textNode = findFirstTextNode(firstSurface);
    fireEvent(document, new Event('selectionchange'));
    const colorButton = first.container.querySelector('button[aria-label="Apply Yellow highlight"]');
    if (!colorButton) {
      throw new Error('Expected highlight color action button');
    }
    fireEvent.click(colorButton);
    expect(first.container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(1);

    first.unmount();

    const second = render(
      <StudentHighlightPersistenceProvider namespace="attempt:demo-v2">
        <FormattedText
          text="Alpha beta gamma"
          highlightEnabled={false}
          highlightSurfaceId="test:persist"
        />
      </StudentHighlightPersistenceProvider>,
    );

    expect(second.container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(1);

    getSelectionSpy.mockRestore();
  });

  it('drops stored ranges when the source text changes', () => {
    let textNode: ChildNode | null = null;
    const selection = createSelectionMock(() => textNode, {
      start: 6,
      end: 10,
      text: 'beta',
    });
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selection);

    const { container, rerender } = render(
      <StudentHighlightPersistenceProvider namespace="attempt:demo-v2-reset">
        <FormattedText
          text="Alpha beta gamma"
          highlightEnabled
          highlightSurfaceId="test:hash-reset"
        />
      </StudentHighlightPersistenceProvider>,
    );

    const surface = container.querySelector('[data-student-highlightable="true"]');
    if (!surface) {
      throw new Error('Expected surface');
    }

    textNode = findFirstTextNode(surface);
    fireEvent(document, new Event('selectionchange'));
    const colorButton = container.querySelector('button[aria-label="Apply Yellow highlight"]');
    if (!colorButton) {
      throw new Error('Expected highlight color action button');
    }
    fireEvent.click(colorButton);
    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(1);

    rerender(
      <StudentHighlightPersistenceProvider namespace="attempt:demo-v2-reset">
        <FormattedText
          text="Completely different sentence"
          highlightEnabled={false}
          highlightSurfaceId="test:hash-reset"
        />
      </StudentHighlightPersistenceProvider>,
    );

    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(0);

    getSelectionSpy.mockRestore();
  });

});
