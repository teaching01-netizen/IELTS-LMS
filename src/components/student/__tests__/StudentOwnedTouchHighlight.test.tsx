import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { FormattedText } from '../FormattedText';
import { StudentExamInteractionScopeProvider } from '@shared/ui/touch-selection/StudentExamInteractionScope';

/**
 * The IELTS half of the owned touch selection, end to end.
 *
 * On a coarse pointer an exam passage is `user-select: none`, because the
 * platform's Copy / Look Up bar is attached to the selection itself and cannot
 * be suppressed while a selection exists. Highlighting therefore arrives through
 * the exam's own gesture — and that gesture is armed by the SESSION's declared
 * scope, never by the highlight tool being on or by anything this component can
 * observe about where it is mounted.
 *
 * Both halves are pinned here: the capture works, and it does not happen in a
 * session that has not declared it.
 */

type PointCapable = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

let restoreEnvironment: (() => void) | null = null;

afterEach(() => {
  restoreEnvironment?.();
  restoreEnvironment = null;
  vi.useRealTimers();
});

function stubCoarsePointerDevice() {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('pointer: coarse'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

function stubHitTest(leaf: Text) {
  const capable = document as PointCapable;
  const original = capable.caretPositionFromPoint;
  capable.caretPositionFromPoint = (x: number) => ({ offsetNode: leaf, offset: Math.round(x) });
  return () => {
    if (original) capable.caretPositionFromPoint = original;
    else delete capable.caretPositionFromPoint;
  };
}

function renderSurface(options: {
  ownedTouchSelection: boolean;
  toolMode?: 'off' | 'highlight' | 'erase';
}) {
  const result = render(
    <StudentExamInteractionScopeProvider ownedTouchSelection={options.ownedTouchSelection}>
      <FormattedText
        text="Alpha beta gamma"
        highlightEnabled
        highlightToolMode={options.toolMode ?? 'highlight'}
        highlightColor="yellow"
        highlightSurfaceId={`owned-touch:${options.ownedTouchSelection}:${options.toolMode ?? 'highlight'}`}
      />
    </StudentExamInteractionScopeProvider>,
  );
  const surface = result.container.querySelector('[data-student-highlightable="true"]') as HTMLElement;
  return { ...result, surface };
}

function longPressAndDrag(from: number, to: number) {
  vi.useFakeTimers();
  fireEvent.pointerDown(document.querySelector('[data-student-highlightable="true"]')!, {
    pointerType: 'touch',
    pointerId: 1,
    clientX: from,
    clientY: 10,
  });
  act(() => {
    vi.advanceTimersByTime(350);
  });
  fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: to, clientY: 10 });
  fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1 });
}

/** Press and start dragging on the same breath, which is how touch selection is
 * performed almost everywhere else. The vertical travel is what exceeds the
 * tolerance; the horizontal coordinates are the character offsets. */
function immediateDrag(from: number, to: number) {
  vi.useFakeTimers();
  const surface = document.querySelector('[data-student-highlightable="true"]')!;
  fireEvent.pointerDown(surface, { pointerType: 'touch', pointerId: 1, clientX: from, clientY: 10 });
  fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: from, clientY: 25 });
  fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: to, clientY: 25 });
  fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1 });
}

describe('IELTS owned touch highlighting', () => {
  it('highlights the dragged span without ever making a browser selection', () => {
    const { container, surface } = renderSurface({ ownedTouchSelection: true });
    const leaf = surface.firstChild as Text;
    const restoreMedia = stubCoarsePointerDevice();
    const restoreHit = stubHitTest(leaf);
    restoreEnvironment = () => {
      restoreHit();
      restoreMedia();
    };
    const addRange = vi.spyOn(Selection.prototype, 'addRange');

    longPressAndDrag(6, 10);

    const marks = container.querySelectorAll('mark[data-highlighted="true"]');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('beta');
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(addRange).not.toHaveBeenCalled();
    addRange.mockRestore();
  });

  it('highlights an armed drag that never pauses for a hold', () => {
    // The regression this pins: with the platform's own selection suppressed,
    // requiring a 350 ms stationary hold before a drag counted meant a student
    // who simply dragged — the usual way to select text on touch — got nothing
    // at all, from either system.
    const { container } = renderSurface({ ownedTouchSelection: true, toolMode: 'highlight' });
    const leaf = (document.querySelector('[data-student-highlightable="true"]') as HTMLElement)
      .firstChild as Text;
    const restoreMedia = stubCoarsePointerDevice();
    const restoreHit = stubHitTest(leaf);
    restoreEnvironment = () => {
      restoreHit();
      restoreMedia();
    };

    immediateDrag(6, 10);

    const marks = container.querySelectorAll('mark[data-highlighted="true"]');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('beta');
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it('leaves the passage to the browser while no tool is armed', () => {
    // With the highlighter off there is nothing to do with a selection, so the
    // gesture must not take the drag: claiming it would freeze scrolling on a
    // passage the student is only trying to read.
    const { container } = renderSurface({ ownedTouchSelection: true, toolMode: 'off' });
    const leaf = (document.querySelector('[data-student-highlightable="true"]') as HTMLElement)
      .firstChild as Text;
    const restoreMedia = stubCoarsePointerDevice();
    const restoreHit = stubHitTest(leaf);
    restoreEnvironment = () => {
      restoreHit();
      restoreMedia();
    };

    vi.useFakeTimers();
    fireEvent.pointerDown(document.querySelector('[data-student-highlightable="true"]')!, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 6,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    const scroll = new Event('touchmove', { cancelable: true, bubbles: true });
    document.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);

    fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1 });
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });

  it('leaves the platform selection alone in a session that declared no owned gesture', () => {
    // A preview or an authoring surface renders this very component. The scope
    // defaults to false, so the gesture never claims the text there.
    const { container, surface } = renderSurface({ ownedTouchSelection: false });
    const leaf = surface.firstChild as Text;
    const restoreMedia = stubCoarsePointerDevice();
    const restoreHit = stubHitTest(leaf);
    restoreEnvironment = () => {
      restoreHit();
      restoreMedia();
    };

    longPressAndDrag(6, 10);

    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });
});
