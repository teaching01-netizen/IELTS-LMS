import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { type RefObject } from 'react';
import { useStudentSelectionGesture } from '../react/useStudentSelectionGesture';
import { SelectionLoupe } from '../react/SelectionLoupe';
import type { TextPoint } from '../domain/selectionTypes';

/**
 * The performance gates, as assertions rather than intentions.
 *
 * A touch selection lives or dies on whether the frame after a `pointermove`
 * costs one geometry pass or a hundred. These are the numbers behind that claim:
 * raw events may not resolve anything, may not re-render React, and may not
 * rebuild the magnifier's DOM; and a torn-down surface may not leave listeners
 * behind on the document.
 */

function manualFrames() {
  const queue = new Map<number, () => void>();
  let nextHandle = 1;
  return {
    requestFrame: (callback: () => void) => {
      const handle = nextHandle++;
      queue.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle: number) => {
      queue.delete(handle);
    },
    run: () => {
      const pending = [...queue.entries()];
      queue.clear();
      for (const [, callback] of pending) callback();
    },
  };
}

function harness() {
  const host = document.createElement('div');
  host.innerHTML = '<p id="prose">alpha beta gamma</p>';
  document.body.appendChild(host);
  const prose = host.querySelector('#prose') as HTMLElement;
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  const text = walker.nextNode() as Text;
  const frames = manualFrames();
  const resolveCaretAtPoint = vi.fn((x: number): TextPoint => ({
    node: text,
    offset: Math.max(0, Math.min(text.data.length, Math.round(x) % text.data.length)),
  }));
  const rootRef = { current: prose } as RefObject<HTMLElement | null>;
  let renders = 0;

  const view = renderHook(() => {
    renders += 1;
    return useStudentSelectionGesture({
      enabled: true,
      activation: 'drag',
      rootRef,
      resolveCaretAtPoint,
      onSelect: () => {},
      isCoarsePointer: () => true,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
  });

  return { view, prose, frames, resolveCaretAtPoint, renderCount: () => renders };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('a pointermove stream is coalesced into frames', () => {
  it('does no geometry work and no React render per raw event', () => {
    const { prose, frames, resolveCaretAtPoint, renderCount } = harness();

    fireEvent.pointerDown(prose, { pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 10 });
    act(() => {
      frames.run();
    });
    resolveCaretAtPoint.mockClear();
    const rendersBefore = renderCount();

    for (let move = 0; move < 500; move += 1) {
      fireEvent.pointerMove(prose, { pointerType: 'touch', pointerId: 1, clientX: move % 40, clientY: 10 });
    }

    expect(resolveCaretAtPoint).not.toHaveBeenCalled();
    expect(renderCount()).toBe(rendersBefore);

    // One frame later: exactly one resolution, one range, one render.
    act(() => {
      frames.run();
    });
    expect(resolveCaretAtPoint).toHaveBeenCalledTimes(1);
    expect(renderCount()).toBe(rendersBefore + 1);
  });

  it('costs one geometry pass per frame across a long gesture', () => {
    const { prose, frames, resolveCaretAtPoint } = harness();

    fireEvent.pointerDown(prose, { pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 10 });
    act(() => {
      frames.run();
    });
    resolveCaretAtPoint.mockClear();

    for (let frame = 0; frame < 60; frame += 1) {
      for (let move = 0; move < 25; move += 1) {
        fireEvent.pointerMove(prose, { pointerType: 'touch', pointerId: 1, clientX: frame + move, clientY: 10 });
      }
      act(() => {
        frames.run();
      });
    }

    expect(resolveCaretAtPoint).toHaveBeenCalledTimes(60);
  });
});

describe('the overlay follows a finger without rebuilding anything', () => {
  it('clones the magnified content once, no matter how far the finger travels', () => {
    const source = document.createElement('div');
    source.innerHTML = '<p>alpha beta gamma</p>';
    document.body.append(source);
    const sourceRef = { current: source } as RefObject<HTMLElement | null>;
    const cloneNode = vi.spyOn(Node.prototype, 'cloneNode');

    const { rerender } = render(<SelectionLoupe open point={{ x: 10, y: 200 }} sourceRef={sourceRef} />);
    for (let move = 0; move < 50; move += 1) {
      rerender(<SelectionLoupe open point={{ x: 10 + move, y: 200 + move }} sourceRef={sourceRef} />);
    }

    expect(cloneNode).toHaveBeenCalledTimes(1);
  });
});

describe('nothing is left behind', () => {
  it('removes every document listener and disconnects observers on unmount', () => {
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    const disconnect = vi.fn();
    class ObservingStub {
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    }
    (globalThis as unknown as Record<string, unknown>)['ResizeObserver'] = ObservingStub;

    const { view, prose, frames } = harness();
    fireEvent.pointerDown(prose, { pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 10 });
    act(() => {
      frames.run();
    });
    fireEvent.pointerMove(prose, { pointerType: 'touch', pointerId: 1, clientX: 12, clientY: 10 });
    act(() => {
      frames.run();
    });
    expect(view.result.current.phase).not.toBe('idle');

    view.unmount();

    const addedEvents = added.mock.calls.map(([type]) => type);
    const removedEvents = removed.mock.calls.map(([type]) => type);
    for (const type of ['pointermove', 'pointerup', 'pointercancel', 'keydown']) {
      if (!addedEvents.includes(type)) continue;
      expect(removedEvents.filter((event) => event === type).length).toBeGreaterThanOrEqual(
        addedEvents.filter((event) => event === type).length,
      );
    }
    expect(disconnect).toHaveBeenCalled();
  });

  it('drops its frame work when the surface goes away mid-gesture', () => {
    const { view, prose, frames, resolveCaretAtPoint } = harness();
    fireEvent.pointerDown(prose, { pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 10 });
    act(() => {
      frames.run();
    });
    fireEvent.pointerMove(prose, { pointerType: 'touch', pointerId: 1, clientX: 20, clientY: 10 });
    resolveCaretAtPoint.mockClear();

    view.unmount();
    act(() => {
      frames.run();
    });

    expect(resolveCaretAtPoint).not.toHaveBeenCalled();
  });
});
