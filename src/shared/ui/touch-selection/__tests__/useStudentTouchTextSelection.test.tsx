import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { useStudentTouchTextSelection } from '../useStudentTouchTextSelection';

type Handlers = {
  enabled?: boolean;
  coarse?: boolean;
  boundaryFor?: (point: { node: Text; offset: number }) => Element | null;
  onSelect?: (range: Range, text: string) => void;
};

function textNodeIn(scope: ParentNode, selector: string): Text {
  const element = scope.querySelector(selector);
  if (!element) throw new Error(`missing ${selector}`);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode() as Text | null;
  if (!node) throw new Error(`no text in ${selector}`);
  return node;
}

/** The element the boundary resolver answers with, set once the host exists. */
let boundaryBound: Element | null = null;

function harness(handlers: Handlers = {}) {
  const host = document.createElement('div');
  host.id = 'touch-root';
  host.innerHTML = handlers.boundaryFor
    ? '<p id="first">alpha beta</p><p id="second">gamma delta</p>'
    : '<p id="prose">alpha beta gamma</p>';
  document.body.appendChild(host);

  const prose = host.querySelector('#prose, #first') as HTMLElement;
  const proseText = (() => {
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode() as Text | null;
    if (!node) throw new Error('no text in the gesture root');
    return node;
  })();
  const onSelect = handlers.onSelect ?? vi.fn();

  // The one thing jsdom cannot do is hit-test a coordinate against text, so the
  // gesture takes the resolver as a parameter. The default maps x directly onto
  // an offset, which makes every assertion below readable as a character index.
  const resolveCaretAtPoint = vi.fn((x: number) => ({
    node: proseText,
    offset: Math.max(0, Math.min(proseText.data.length, Math.round(x))),
  }));

  const rootRef = { current: prose } as RefObject<HTMLElement | null>;
  const view = renderHook(() =>
    useStudentTouchTextSelection({
      enabled: handlers.enabled ?? true,
      rootRef,
      resolveCaretAtPoint,
      onSelect,
      isCoarsePointer: () => handlers.coarse ?? true,
      longPressMs: 350,
      moveTolerancePx: 8,
      ...(handlers.boundaryFor ? { boundaryFor: handlers.boundaryFor } : {}),
    }),
  );

  return { view, host, prose, proseText, onSelect, resolveCaretAtPoint };
}

function touchDown(target: Element, x: number) {
  fireEvent.pointerDown(target, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: 10 });
}
function mouseDown(target: Element, x: number) {
  fireEvent.pointerDown(target, { pointerType: 'mouse', pointerId: 1, clientX: x, clientY: 10 });
}
function move(x: number) {
  fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: 10 });
}
function mouseMove(x: number) {
  fireEvent.pointerMove(document, { pointerType: 'mouse', pointerId: 1, clientX: x, clientY: 10 });
}
function release() {
  fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1 });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('useStudentTouchTextSelection — long press ownership', () => {
  it('holds off while the finger is merely resting, and starts once the hold completes', () => {
    const { view, prose, onSelect } = harness();

    touchDown(prose, 0);
    act(() => {
      vi.advanceTimersByTime(349);
    });
    expect(view.result.current.active).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(view.result.current.active).toBe(true);

    release();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('selects the word under the finger when the hold lands without a drag', () => {
    const { view, prose, onSelect } = harness();

    touchDown(prose, 7);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(view.result.current.selectionText).toBe('beta');

    release();
    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('beta');
  });

  it('extends the owned selection as the finger travels', () => {
    const { view, prose, onSelect } = harness();

    touchDown(prose, 0);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    move(11);
    // Offset 11 is the space after "beta": the drag selected every character it
    // crossed, and offsets are exclusive at both ends.
    expect(view.result.current.selectionText).toBe('alpha beta ');

    release();
    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('alpha beta ');
    expect(view.result.current.active).toBe(false);
    expect(view.result.current.selectionText).toBe('');
  });

  it('orders a right-to-left drag into a forward range', () => {
    const { prose, onSelect } = harness();

    touchDown(prose, 16);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    move(6);
    release();

    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('beta gamma');
  });
});

describe('useStudentTouchTextSelection — the browser never learns', () => {
  it('leaves window.getSelection() empty for the whole gesture', () => {
    const addRange = vi.spyOn(Selection.prototype, 'addRange');
    const { prose, onSelect } = harness();

    touchDown(prose, 0);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    move(10);
    release();

    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(addRange).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
    addRange.mockRestore();
  });
});

describe('useStudentTouchTextSelection — cancelled gestures stay scrolling', () => {
  it('cancels when the finger moves past the tolerance before the hold completes', () => {
    const { view, prose, onSelect } = harness();

    touchDown(prose, 0);
    move(9);
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(view.result.current.active).toBe(false);
    release();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores a tap that never becomes a hold', () => {
    const { view, prose, onSelect } = harness();

    touchDown(prose, 4);
    release();
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(view.result.current.active).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('abandons a gesture the platform cancels', () => {
    const { view, prose, onSelect } = harness();

    touchDown(prose, 0);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(view.result.current.active).toBe(true);

    fireEvent.pointerCancel(document, { pointerType: 'touch', pointerId: 1 });

    expect(view.result.current.active).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('suppresses scrolling only while it owns the selection', () => {
    const { prose } = harness();
    const scroll = new Event('touchmove', { cancelable: true, bubbles: true });

    touchDown(prose, 0);
    document.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);

    act(() => {
      vi.advanceTimersByTime(350);
    });
    const ownedScroll = new Event('touchmove', { cancelable: true, bubbles: true });
    document.dispatchEvent(ownedScroll);
    expect(ownedScroll.defaultPrevented).toBe(true);

    release();
    const afterScroll = new Event('touchmove', { cancelable: true, bubbles: true });
    document.dispatchEvent(afterScroll);
    expect(afterScroll.defaultPrevented).toBe(false);
  });
});

describe('useStudentTouchTextSelection — scope and boundaries', () => {
  it('confines a drag to the boundary the caller names', () => {
    const { host, onSelect, resolveCaretAtPoint } = harness({
      boundaryFor: () => boundaryBound,
    });
    boundaryBound = host.querySelector('#first');
    const firstText = textNodeIn(host, '#first');
    const secondText = textNodeIn(host, '#second');
    // Press inside the first block, drag on into the second.
    resolveCaretAtPoint
      .mockReturnValueOnce({ node: firstText, offset: 6 })
      .mockReturnValueOnce({ node: secondText, offset: 5 });

    touchDown(host.querySelector('#first') as HTMLElement, 6);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: 5, clientY: 10 });
    release();

    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('beta');
  });

  it('leaves editable controls to the platform', () => {
    const { host, view } = harness();
    const field = document.createElement('textarea');
    host.querySelector('#prose')!.appendChild(field);

    touchDown(field, 0);
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(view.result.current.active).toBe(false);
  });

  it('ignores gestures that begin outside the root', () => {
    const { view } = harness();

    touchDown(document.body, 0);
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(view.result.current.active).toBe(false);
  });

  it('stays inert while disabled', () => {
    const { view, prose, onSelect } = harness({ enabled: false });

    touchDown(prose, 0);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    release();

    expect(view.result.current.active).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('stays inert on a fine pointer, where the platform selection still works', () => {
    const { view, prose, onSelect } = harness({ coarse: false });

    mouseDown(prose, 0);
    mouseMove(11);
    fireEvent.pointerUp(document, { pointerType: 'mouse', pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(view.result.current.active).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('owns a mouse drag immediately on a coarse-pointer device, where a trackpad has no long press', () => {
    const { view, prose, onSelect } = harness();

    mouseDown(prose, 0);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(view.result.current.active).toBe(true);

    mouseMove(5);
    fireEvent.pointerUp(document, { pointerType: 'mouse', pointerId: 1 });

    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('alpha');
  });

  it('serves a second gesture after the first one completes', () => {
    const { prose, onSelect } = harness();

    touchDown(prose, 0);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    release();

    touchDown(prose, 6);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    release();

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect((onSelect.mock.calls[1]![0] as Range).toString()).toBe('beta');
  });

  it('detaches on unmount, leaving no listener behind', () => {
    const { view, prose, onSelect } = harness();

    view.unmount();
    touchDown(prose, 0);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    release();

    expect(onSelect).not.toHaveBeenCalled();
  });
});
