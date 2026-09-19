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

function renderSurface(options: { ownedTouchSelection: boolean }) {
  const result = render(
    <StudentExamInteractionScopeProvider ownedTouchSelection={options.ownedTouchSelection}>
      <FormattedText
        text="Alpha beta gamma"
        highlightEnabled
        highlightToolMode="highlight"
        highlightColor="yellow"
        highlightSurfaceId={`owned-touch:${options.ownedTouchSelection}`}
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
