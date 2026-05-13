import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { FormattedText } from '../FormattedText';
import { StudentHighlightPersistenceProvider } from '../highlightV2Persistence';
import { StudentHighlightSelectionManagerProvider } from '../highlightSelectionManager';

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
  it('allows broad same-surface selections so cross-block highlighting can apply', () => {
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

    const colorButton = container.querySelector('button[aria-label="Apply Yellow highlight"]');
    expect(colorButton).not.toBeNull();
    if (!colorButton) {
      throw new Error('Expected highlight color action button');
    }
    fireEvent.click(colorButton);
    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(2);

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

  it('keeps the selected passage text when clicking the floating highlight toolbar', () => {
    let textNode: ChildNode | null = null;
    const validSelection = createSelectionMock(() => textNode, {
      start: 6,
      end: 10,
      text: 'beta',
    });
    const collapsedSelection = {
      rangeCount: 0,
      toString: () => '',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;
    let activeSelection: Selection = validSelection;
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockImplementation(() => activeSelection);

    const { container } = render(
      <FormattedText
        text="Alpha beta gamma"
        highlightEnabled
        highlightSurfaceId="test:toolbar-preserves-selection"
      />,
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

    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    colorButton.dispatchEvent(mouseDown);
    if (!mouseDown.defaultPrevented) {
      activeSelection = collapsedSelection;
      fireEvent(document, new MouseEvent('mouseup', { bubbles: true }));
    }

    fireEvent.click(colorButton);

    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(1);

    getSelectionSpy.mockRestore();
  });

  it('keeps the selected passage text when tapping the floating highlight toolbar', () => {
    let textNode: ChildNode | null = null;
    const validSelection = createSelectionMock(() => textNode, {
      start: 6,
      end: 10,
      text: 'beta',
    });
    const collapsedSelection = {
      rangeCount: 0,
      toString: () => '',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;
    let activeSelection: Selection = validSelection;
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockImplementation(() => activeSelection);

    const { container } = render(
      <FormattedText
        text="Alpha beta gamma"
        highlightEnabled
        highlightSurfaceId="test:toolbar-preserves-touch-selection"
      />,
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

    if (fireEvent.touchStart(colorButton)) {
      activeSelection = collapsedSelection;
      fireEvent(document, new Event('selectionchange'));
    }

    fireEvent.click(colorButton);

    expect(container.querySelectorAll('mark[data-highlighted="true"]')).toHaveLength(1);

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

  it('keeps selection actions visible during transient invalid selection snapshots', () => {
    let textNode: ChildNode | null = null;
    let highlightable: Element | null = null;

    const validSelection = createSelectionMock(() => textNode, {
      start: 6,
      end: 10,
      text: 'beta',
    });

    const transientInvalidSelection = {
      rangeCount: 1,
      getRangeAt: () => {
        if (!highlightable) {
          throw new Error('Expected highlight surface');
        }
        const range = document.createRange();
        range.setStart(highlightable, 0);
        range.setEnd(highlightable, highlightable.childNodes.length);
        return range;
      },
      toString: () => 'beta',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    let activeSelection: Selection = validSelection;
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockImplementation(() => activeSelection);

    const { container } = render(
      <FormattedText
        text="Alpha beta gamma"
        highlightEnabled
        highlightSurfaceId="test:transient-selection"
      />,
    );

    highlightable = container.querySelector('[data-student-highlightable="true"]');
    if (!highlightable) {
      throw new Error('Expected highlight surface');
    }
    textNode = findFirstTextNode(highlightable);

    fireEvent(document, new Event('selectionchange'));
    expect(container.querySelector('button[aria-label="Apply Yellow highlight"]')).not.toBeNull();

    activeSelection = transientInvalidSelection;
    fireEvent(document, new Event('selectionchange'));
    expect(container.querySelector('button[aria-label="Apply Yellow highlight"]')).not.toBeNull();

    getSelectionSpy.mockRestore();
  });

  it('allows only one active highlight surface selection across multiple surfaces', () => {
    let firstTextNode: ChildNode | null = null;
    let secondTextNode: ChildNode | null = null;
    let activeTarget: 'first' | 'second' = 'first';

    const globalSelection = {
      rangeCount: 1,
      getRangeAt: () => {
        const textNode = activeTarget === 'first' ? firstTextNode : secondTextNode;
        if (!textNode) {
          throw new Error('Expected text node');
        }
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, 5);
        return range;
      },
      toString: () => 'Alpha',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(globalSelection);

    const { container } = render(
      <StudentHighlightSelectionManagerProvider>
        <div>
          <FormattedText
            text="Alpha one"
            highlightEnabled
            highlightSurfaceId="test:surface:one"
          />
          <FormattedText
            text="Alpha two"
            highlightEnabled
            highlightSurfaceId="test:surface:two"
          />
        </div>
      </StudentHighlightSelectionManagerProvider>,
    );

    const surfaces = container.querySelectorAll('[data-student-highlightable="true"]');
    const firstSurface = surfaces[0];
    const secondSurface = surfaces[1];
    if (!firstSurface || !secondSurface) {
      throw new Error('Expected two highlight surfaces');
    }
    firstTextNode = findFirstTextNode(firstSurface);
    secondTextNode = findFirstTextNode(secondSurface);

    activeTarget = 'first';
    fireEvent(document, new Event('selectionchange'));
    expect(container.querySelectorAll('button[aria-label="Apply Yellow highlight"]')).toHaveLength(1);

    activeTarget = 'second';
    fireEvent(document, new Event('selectionchange'));
    expect(container.querySelectorAll('button[aria-label="Apply Yellow highlight"]')).toHaveLength(1);

    getSelectionSpy.mockRestore();
  });

});
