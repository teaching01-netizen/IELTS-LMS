import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { FormattedText } from '../FormattedText';
import { StudentHighlightPersistenceProvider } from '../highlightV2Persistence';
import { StudentHighlightSelectionManagerProvider } from '../highlightSelectionManager';
import type { StudentHighlightColor } from '../highlightPalette';
import { createInMemoryHighlightSelectionPort, StudentHighlightSelectionPortProvider } from '../highlightSelectionPort';
import { hashString } from '../highlightV2Engine';
import { writePersistedSurfaceRanges } from '../highlight/highlightStore';

function firstTextNode(root: Element): ChildNode {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!node) throw new Error('Expected text node');
  return node;
}

function selectionFor(getNode: () => ChildNode, start: number, end: number): Selection {
  return {
    rangeCount: 1,
    getRangeAt: () => {
      const range = document.createRange();
      range.setStart(getNode(), start);
      range.setEnd(getNode(), end);
      return range;
    },
    toString: () => getNode().textContent?.slice(start, end) ?? '',
    removeAllRanges: vi.fn(),
  } as unknown as Selection;
}

describe('student highlight persistence v2', () => {
  it.each<StudentHighlightColor>(['yellow', 'amber', 'green', 'blue', 'purple'])(
    'automatically applies %s once when selection completes',
    (color) => {
    let node: ChildNode | null = null;
    const selection = selectionFor(() => node!, 6, 10);
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selection);
    const { container } = render(
      <FormattedText
        text="Alpha beta gamma"
        highlightEnabled
        highlightToolMode="highlight"
        highlightColor={color}
        highlightSurfaceId={`test:auto-highlight:${color}`}
      />,
    );
    node = firstTextNode(container.querySelector('[data-student-highlightable="true"]')!);

    fireEvent(document, new Event('pointerdown'));
    fireEvent(document, new Event('pointerdown'));
    fireEvent(document, new Event('pointerup'));
    fireEvent(document, new Event('mouseup'));
    fireEvent(document, new Event('touchend'));

    const marks = container.querySelectorAll('mark[data-highlighted="true"]');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveAttribute('data-highlight-color', color);
    expect(selection.removeAllRanges).toHaveBeenCalledTimes(1);
    expect(container.querySelector('button[aria-label^="Apply "]')).toBeNull();
    getSelectionSpy.mockRestore();
    },
  );

  it('preserves native selection without mutation while the tool is off', () => {
    let node: ChildNode | null = null;
    const selection = selectionFor(() => node!, 6, 10);
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selection);
    const { container } = render(
      <FormattedText text="Alpha beta gamma" highlightEnabled highlightToolMode="off" />,
    );
    node = firstTextNode(container.querySelector('[data-student-highlightable="true"]')!);
    fireEvent(document, new Event('pointerdown'));
    fireEvent(document, new Event('pointerup'));

    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(selection.removeAllRanges).not.toHaveBeenCalled();
    getSelectionSpy.mockRestore();
  });

  it('consumes a valid selection finalized after an initially empty pointer completion', () => {
    let node: ChildNode | null = null;
    const emptySelection = {
      rangeCount: 0,
      toString: () => '',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;
    const validSelection = selectionFor(() => node!, 0, 5);
    let activeSelection = emptySelection;
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockImplementation(() => activeSelection);
    const { container } = render(
      <FormattedText text="Alpha beta" highlightEnabled highlightToolMode="highlight" highlightSurfaceId="delayed-ios" />,
    );
    node = firstTextNode(container.querySelector('[data-student-highlightable="true"]')!);

    fireEvent(document, new Event('pointerdown'));
    fireEvent(document, new Event('pointerup'));
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    activeSelection = validSelection;
    fireEvent(document, new Event('selectionchange'));

    expect(container.querySelectorAll('mark')).toHaveLength(1);
    expect(validSelection.removeAllRanges).toHaveBeenCalledTimes(1);
    getSelectionSpy.mockRestore();
  });

  it('keeps highlight mode active for repeated completed selections', () => {
    const port = createInMemoryHighlightSelectionPort({
      selection: { start: 0, end: 5, selectedText: 'Alpha' },
      selectionText: 'Alpha',
    });
    const { container } = render(
      <StudentHighlightSelectionPortProvider port={port}>
        <FormattedText text="Alpha beta" highlightEnabled highlightToolMode="highlight" highlightSurfaceId="repeat" />
      </StudentHighlightSelectionPortProvider>,
    );
    act(() => port.emit());
    port.setSnapshot({ selection: { start: 6, end: 10, selectedText: 'beta' }, selectionText: 'beta' });
    act(() => port.emit());

    expect(container.querySelectorAll('mark')).toHaveLength(2);
  });

  it('persists ranges across remounts and renders them while the tool is off', () => {
    let node: ChildNode | null = null;
    const selection = selectionFor(() => node!, 6, 10);
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selection);
    const first = render(
      <StudentHighlightPersistenceProvider namespace="attempt:demo-v2">
        <FormattedText text="Alpha beta gamma" highlightEnabled highlightToolMode="highlight" highlightSurfaceId="persist" />
      </StudentHighlightPersistenceProvider>,
    );
    node = firstTextNode(first.container.querySelector('[data-student-highlightable="true"]')!);
    fireEvent(document, new Event('pointerup'));
    expect(first.container.querySelectorAll('mark')).toHaveLength(1);
    first.unmount();

    const second = render(
      <StudentHighlightPersistenceProvider namespace="attempt:demo-v2">
        <FormattedText text="Alpha beta gamma" highlightEnabled highlightToolMode="off" highlightSurfaceId="persist" />
      </StudentHighlightPersistenceProvider>,
    );
    expect(second.container.querySelectorAll('mark')).toHaveLength(1);
    getSelectionSpy.mockRestore();
  });

  it('automatically erases selected highlight coverage in erase mode', () => {
    let node: ChildNode | null = null;
    let start = 0;
    let end = 5;
    const selection = selectionFor(() => node!, start, end);
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selection);
    const { container, rerender } = render(
      <FormattedText text="Alpha beta" highlightEnabled highlightToolMode="highlight" highlightSurfaceId="erase" />,
    );
    const surface = container.querySelector('[data-student-highlightable="true"]')!;
    node = firstTextNode(surface);
    fireEvent(document, new Event('pointerup'));
    expect(container.querySelector('mark')?.textContent).toBe('Alpha');

    rerender(
      <FormattedText text="Alpha beta" highlightEnabled highlightToolMode="erase" highlightSurfaceId="erase" />,
    );
    const mark = container.querySelector('mark')!;
    node = firstTextNode(mark);
    start = 0;
    end = 5;
    fireEvent(document, new Event('pointerup'));

    expect(container.querySelector('mark')).toBeNull();
    getSelectionSpy.mockRestore();
  });

  it('invalidates persisted ranges when source text changes', () => {
    let node: ChildNode | null = null;
    const selection = selectionFor(() => node!, 0, 5);
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selection);
    const first = render(
      <StudentHighlightPersistenceProvider namespace="attempt:source-change">
        <FormattedText text="Alpha beta" highlightEnabled highlightToolMode="highlight" highlightSurfaceId="source" />
      </StudentHighlightPersistenceProvider>,
    );
    node = firstTextNode(first.container.querySelector('[data-student-highlightable="true"]')!);
    fireEvent(document, new Event('pointerup'));
    expect(first.container.querySelectorAll('mark')).toHaveLength(1);
    first.unmount();

    const second = render(
      <StudentHighlightPersistenceProvider namespace="attempt:source-change">
        <FormattedText text="Changed beta" highlightEnabled highlightToolMode="off" highlightSurfaceId="source" />
      </StudentHighlightPersistenceProvider>,
    );
    expect(second.container.querySelectorAll('mark')).toHaveLength(0);
    getSelectionSpy.mockRestore();
  });

  it('fails closed when a selection belongs to another surface', () => {
    let firstNode: ChildNode | null = null;
    const selection = selectionFor(() => firstNode!, 0, 5);
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selection);
    const { container } = render(
      <StudentHighlightSelectionManagerProvider>
        <FormattedText text="Alpha one" highlightEnabled highlightToolMode="highlight" highlightSurfaceId="first" />
        <FormattedText text="Beta two" highlightEnabled highlightToolMode="highlight" highlightSurfaceId="second" />
      </StudentHighlightSelectionManagerProvider>,
    );
    const surfaces = container.querySelectorAll('[data-student-highlightable="true"]');
    firstNode = firstTextNode(surfaces[0]!);
    fireEvent(document, new Event('pointerup'));

    expect(surfaces[0]!.querySelectorAll('mark')).toHaveLength(1);
    expect(surfaces[1]!.querySelectorAll('mark')).toHaveLength(0);
    getSelectionSpy.mockRestore();
  });

  it('releases surface ownership and preserves selection when the range cap is reached', () => {
    const longText = Array.from({ length: 201 }, () => 'x ').join('');
    const namespace = 'attempt:range-cap';
    writePersistedSurfaceRanges(namespace, 'capped', {
      sourceHash: hashString(longText),
      ranges: Array.from({ length: 200 }, (_, index) => ({
        start: index * 2,
        end: index * 2 + 1,
        color: 'yellow' as const,
      })),
    });
    const cappedPort = createInMemoryHighlightSelectionPort({
      selection: { start: 400, end: 401, selectedText: 'x' },
      selectionText: 'x',
    });
    const otherPort = createInMemoryHighlightSelectionPort({
      selection: { start: 0, end: 4, selectedText: 'Beta' },
      selectionText: 'Beta',
    });
    const cappedClear = vi.spyOn(cappedPort, 'clearSelection');
    const { container } = render(
      <StudentHighlightPersistenceProvider namespace={namespace}>
        <StudentHighlightSelectionManagerProvider>
          <StudentHighlightSelectionPortProvider port={cappedPort}>
            <FormattedText text={longText} highlightEnabled highlightToolMode="highlight" highlightSurfaceId="capped" />
          </StudentHighlightSelectionPortProvider>
          <StudentHighlightSelectionPortProvider port={otherPort}>
            <FormattedText text="Beta surface" highlightEnabled highlightToolMode="highlight" highlightSurfaceId="other" />
          </StudentHighlightSelectionPortProvider>
        </StudentHighlightSelectionManagerProvider>
      </StudentHighlightPersistenceProvider>,
    );
    act(() => cappedPort.emit());
    expect(cappedClear).not.toHaveBeenCalled();

    act(() => otherPort.emit());
    const surfaces = container.querySelectorAll('[data-student-highlightable="true"]');
    expect(surfaces[1]!.querySelectorAll('mark')).toHaveLength(1);
  });
});
