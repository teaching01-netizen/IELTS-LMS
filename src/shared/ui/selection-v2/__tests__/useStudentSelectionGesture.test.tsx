import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { useStudentSelectionGesture, type SelectionHandlePointerEvent } from '../react/useStudentSelectionGesture';
import type { TextPoint } from '../domain/selectionTypes';

type Handlers = {
  enabled?: boolean;
  coarse?: boolean;
  activation?: 'long-press' | 'drag';
  boundaryFor?: (point: TextPoint) => Element | null;
  onSelect?: (range: Range, text: string) => void;
  clearOnSelect?: boolean;
  longPressMs?: number;
  scrollContainer?: (root: HTMLElement) => HTMLElement | null;
  diagnostics?: { record: (stage: string, details?: Record<string, unknown>) => void; listener: (root: HTMLElement | null) => void };
};

/** Frames the test drives by hand, so "one geometry pass per frame" is exact. */
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
    queued: () => queue.size,
    reset: () => queue.clear(),
  };
}

type Frames = ReturnType<typeof manualFrames>;

function firstTextNode(scope: ParentNode): Text {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode() as Text | null;
  if (!node) throw new Error('no text');
  return node;
}

function harness(handlers: Handlers = {}) {
  const host = document.createElement('div');
  host.innerHTML = handlers.boundaryFor
    ? '<p id="first">alpha beta</p><p id="second">gamma delta</p>'
    : '<p id="prose">alpha beta gamma</p>';
  document.body.appendChild(host);

  const prose = host.querySelector('#prose, #first') as HTMLElement;
  const proseText = firstTextNode(prose);
  const onSelect = handlers.onSelect ?? vi.fn();
  const frames = manualFrames();

  // jsdom cannot hit-test a coordinate against text, so the gesture takes the
  // resolver as a parameter. The default maps x straight onto an offset, which
  // makes every assertion below readable as a character index.
  const resolveCaretAtPoint = vi.fn((x: number) => ({
    node: proseText,
    offset: Math.max(0, Math.min(proseText.data.length, Math.round(x))),
  }));

  // Read through a mutable box so a test can disarm the surface between renders,
  // exactly as turning the highlight tool off does in the exam.
  const state = { enabled: handlers.enabled ?? true };
  const rootRef = { current: prose } as RefObject<HTMLElement | null>;
  const view = renderHook(() =>
    useStudentSelectionGesture({
      enabled: state.enabled,
      rootRef,
      resolveCaretAtPoint,
      onSelect,
      isCoarsePointer: () => handlers.coarse ?? true,
      longPressMs: handlers.longPressMs ?? 350,
      moveTolerancePx: 8,
      activation: handlers.activation,
      boundaryFor: handlers.boundaryFor,
      clearOnSelect: handlers.clearOnSelect,
      scrollContainer: handlers.scrollContainer,
      diagnostics: handlers.diagnostics,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    }),
  );

  return {
    view,
    host,
    prose,
    proseText,
    onSelect,
    resolveCaretAtPoint,
    frames,
    setEnabled: (enabled: boolean) => {
      state.enabled = enabled;
      act(() => {
        view.rerender();
      });
    },
  };
}

/** One animation frame's worth of work, wrapped in act for React. */
function frame(frames: Frames) {
  act(() => {
    frames.run();
  });
}

function touchDown(target: Element, x: number, y = 10, pointerId = 1) {
  fireEvent.pointerDown(target, { pointerType: 'touch', pointerId, clientX: x, clientY: y });
}
function touchMove(target: Element, x: number, y = 10, pointerId = 1) {
  fireEvent.pointerMove(target, { pointerType: 'touch', pointerId, clientX: x, clientY: y });
}
function touchUp(target: Element, x: number, y = 10, pointerId = 1) {
  fireEvent.pointerUp(target, { pointerType: 'touch', pointerId, clientX: x, clientY: y });
}
function touchCancel(target: Element, pointerId = 1) {
  fireEvent.pointerCancel(target, { pointerType: 'touch', pointerId });
}
function hold(frames: Frames, ms = 350) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  frame(frames);
}
function handleEvent(edge: { current: Element | null }, x: number, y: number, pointerId: number): SelectionHandlePointerEvent {
  return { pointerId, clientX: x, clientY: y, currentTarget: edge.current };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('claiming text', () => {
  it('selects nothing for a tap', () => {
    const { prose, onSelect, frames, view } = harness();

    touchDown(prose, 4);
    touchUp(prose, 4);
    frame(frames);

    expect(onSelect).not.toHaveBeenCalled();
    expect(view.result.current.selectionText).toBe('');
  });

  it('selects the word under a completed hold', () => {
    const { prose, onSelect, frames, view } = harness();

    touchDown(prose, 7);
    hold(frames);

    expect(view.result.current.selectionText).toBe('beta');
    expect(view.result.current.phase).toBe('selecting');

    touchUp(prose, 7);
    frame(frames);
    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('beta');
  });

  it('extends the selection as the finger travels', () => {
    const { prose, onSelect, frames, view } = harness();

    touchDown(prose, 0);
    hold(frames);
    touchMove(prose, 11);
    frame(frames);

    expect(view.result.current.selectionText).toBe('alpha beta ');
    expect(view.result.current.phase).toBe('extending');

    touchUp(prose, 11);
    frame(frames);
    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('alpha beta ');
  });

  it('orders a right-to-left drag into a forward range', () => {
    const { prose, onSelect, frames } = harness();

    touchDown(prose, 16);
    hold(frames);
    touchMove(prose, 6);
    frame(frames);
    touchUp(prose, 6);
    frame(frames);

    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('beta gamma');
  });

  it('claims an early drag on an armed surface rather than handing it back as a scroll', () => {
    const { prose, view, frames, onSelect } = harness({ activation: 'drag' });

    touchDown(prose, 0);
    touchMove(prose, 20);
    frame(frames);

    expect(view.result.current.selectionText).toBe('alpha beta gamma');

    touchUp(prose, 20);
    frame(frames);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('cancels a gesture the platform takes over, reporting nothing', () => {
    const { prose, onSelect, frames, view } = harness();

    touchDown(prose, 0);
    hold(frames);
    touchCancel(prose, 1);
    frame(frames);

    expect(onSelect).not.toHaveBeenCalled();
    expect(view.result.current.phase).toBe('idle');
    expect(view.result.current.selectionText).toBe('');
  });

  it('abandons an unarmed drag before the hold completes, so the page still scrolls', () => {
    const { prose, onSelect, frames, view } = harness();

    touchDown(prose, 0);
    touchMove(prose, 30);
    frame(frames);
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(view.result.current.phase).toBe('idle');
    touchUp(prose, 30);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('cancels an owned gesture when a second finger lands', () => {
    const { prose, onSelect, frames, view } = harness();

    touchDown(prose, 0);
    hold(frames);
    touchDown(prose, 30, 40, 2);
    frame(frames);

    expect(view.result.current.phase).toBe('idle');
    touchUp(prose, 30, 40, 2);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores movement from a pointer that does not own the session', () => {
    const { prose, frames, view } = harness();

    touchDown(prose, 0);
    hold(frames);
    touchMove(prose, 16, 10, 2);
    frame(frames);

    expect(view.result.current.selectionText).toBe('alpha');
  });

  it('clears an owned selection when the surface is disarmed mid-drag', () => {
    const { prose, frames, view, setEnabled, onSelect } = harness();

    touchDown(prose, 0);
    hold(frames);
    touchMove(prose, 11);
    frame(frames);
    expect(view.result.current.selectionText).toBe('alpha beta ');

    setEnabled(false);

    expect(view.result.current.phase).toBe('idle');
    expect(view.result.current.selectionText).toBe('');
    touchUp(prose, 11);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('the selection survives the finger', () => {
  it('stays selected, with handles, after the finger lifts', () => {
    const { prose, frames, view } = harness();
    const rects = [
      { left: 10, top: 100, width: 100, height: 20 } as DOMRect,
      { left: 10, top: 124, width: 40, height: 20 } as DOMRect,
    ];

    touchDown(prose, 0);
    hold(frames);
    touchMove(prose, 11);
    frame(frames);
    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(rects as unknown as DOMRectList);
    touchUp(prose, 11);
    frame(frames);

    expect(view.result.current.phase).toBe('selected');
    expect(view.result.current.selected).toBe(true);
    expect(view.result.current.selectionText).toBe('alpha beta ');
    expect(view.result.current.rects).toEqual([
      { left: 10, top: 100, width: 100, height: 20 },
      { left: 10, top: 124, width: 40, height: 20 },
    ]);
    expect(view.result.current.startHandle).toMatchObject({ edge: 'start', x: 10, y: 100, stem: 'up' });
    expect(view.result.current.endHandle).toMatchObject({ edge: 'end', x: 50, y: 144, stem: 'down' });
  });

  it('dismisses a resting selection without reporting it again', () => {
    const { prose, onSelect, frames, view } = harness();

    touchDown(prose, 0);
    hold(frames);
    touchMove(prose, 11);
    frame(frames);
    touchUp(prose, 11);
    frame(frames);
    expect(onSelect).toHaveBeenCalledTimes(1);

    act(() => {
      view.result.current.dismiss();
    });

    expect(view.result.current.phase).toBe('idle');
    expect(view.result.current.selectionText).toBe('');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('clears itself once the product has consumed the selection, when asked to', () => {
    const onSelect = vi.fn();
    const { prose, frames, view } = harness({ clearOnSelect: true, onSelect });

    touchDown(prose, 0);
    hold(frames);
    touchMove(prose, 11);
    frame(frames);
    touchUp(prose, 11);
    frame(frames);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(view.result.current.phase).toBe('idle');
  });

  it('hands the product a range that includes the last movement before release', () => {
    const { prose, onSelect, frames } = harness();

    touchDown(prose, 0);
    hold(frames);
    // The move is never given its own frame: the release must flush it, or the
    // exam would be handed the range from one frame ago.
    touchMove(prose, 16);
    touchUp(prose, 16);

    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('alpha beta gamma');
  });
});

describe('the browser never learns a selection exists', () => {
  it('leaves window.getSelection() empty and never installs a range', () => {
    const addRange = vi.spyOn(Selection.prototype, 'addRange');
    const { prose, frames, onSelect } = harness();

    touchDown(prose, 0);
    hold(frames);
    touchMove(prose, 11);
    frame(frames);
    touchUp(prose, 11);
    frame(frames);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(addRange).not.toHaveBeenCalled();
  });
});

describe('pointer capture, not a document-wide drag listener', () => {
  it('captures the pointer on the surface and releases it when the gesture ends', () => {
    const capture = vi.fn();
    const release = vi.fn();
    const { prose, frames } = harness();
    vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(capture);
    vi.spyOn(Element.prototype, 'releasePointerCapture').mockImplementation(release);

    touchDown(prose, 0);
    expect(capture).toHaveBeenCalledWith(1);

    hold(frames);
    touchUp(prose, 0);
    frame(frames);

    expect(release).toHaveBeenCalledWith(1);
    expect(prose.hasPointerCapture(1)).toBe(false);
  });

  it('follows the finger on the captured element and nowhere else while capture is held', () => {
    vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(true);
    const { prose, frames, view } = harness();

    touchDown(prose, 0);
    hold(frames);
    // With capture held, the browser retargets every move to the captured
    // element, so a move that arrives at the document belongs to something else.
    touchMove(document.body, 16);
    frame(frames);
    expect(view.result.current.selectionText).toBe('alpha');

    touchMove(prose, 16);
    frame(frames);
    expect(view.result.current.selectionText).toBe('alpha beta gamma');
  });

  it('still follows the pointer through the document when capture is unavailable', () => {
    vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(false);
    const { prose, frames, view } = harness();

    touchDown(prose, 0);
    hold(frames);
    touchMove(document.body, 16);
    frame(frames);

    expect(view.result.current.selectionText).toBe('alpha beta gamma');
  });
});

/**
 * A selection the finger has already made and let go of: offsets 0–11 of the
 * prose, resting in `selected`, with two real handle elements to grab.
 */
function restingSelection(handlers: Handlers = {}) {
  const harnessed = harness(handlers);
  const end = document.createElement('button');
  const start = document.createElement('button');
  document.body.append(start, end);
  touchDown(harnessed.prose, 0);
  hold(harnessed.frames);
  touchMove(harnessed.prose, 11);
  frame(harnessed.frames);
  touchUp(harnessed.prose, 11);
  frame(harnessed.frames);
  harnessed.onSelect.mockClear();
  return { ...harnessed, start, end };
}

describe('handle adjustment', () => {
  /**
   * The word a hold claimed is a selection the handles can adjust.
   *
   * A hold with no drag leaves the machine owning ONE character — the one under
   * the finger — while the student is shown the word around it and the handles are
   * drawn on that word's edges. The handle at the word's start was therefore not
   * an endpoint the machine could move: grabbing it moved the word's END, and the
   * edge the student touched stayed exactly where it was. Both edges are asserted
   * because the mismatch was symmetric — it hid in whichever direction the finger
   * happened to travel, which is why a suite of geometry assertions missed it.
   */
  it('adjusts the edge the student grabbed on a word a hold claimed, from either end', () => {
    const { prose, frames, view } = harness();
    const start = document.createElement('button');
    const end = document.createElement('button');
    document.body.append(start, end);

    const claimWord = () => {
      touchDown(prose, 7);
      hold(frames);
      touchUp(prose, 7);
      frame(frames);
      expect(view.result.current.selectionText).toBe('beta');
      expect(view.result.current.phase).toBe('selected');
    };

    claimWord();
    act(() => {
      view.result.current.beginHandleAdjustment('start', handleEvent({ current: start }, 6, 10, 7));
    });
    touchMove(start, 3, 10, 7);
    frame(frames);

    // The word's end (offset 10) is the anchor, so the span grows to its left.
    expect(view.result.current.selectionText).toBe('ha beta');
    touchUp(start, 3, 10, 7);
    frame(frames);

    // A press while a selection rests dismisses it and starts nothing, so the
    // text has to be claimed again before the other end can be tried.
    touchDown(prose, 7);
    touchUp(prose, 7);
    frame(frames);
    claimWord();
    act(() => {
      view.result.current.beginHandleAdjustment('end', handleEvent({ current: end }, 10, 10, 8));
    });
    touchMove(end, 13, 10, 8);
    frame(frames);

    expect(view.result.current.selectionText).toBe('beta ga');
  });

  it('moves only the endpoint whose handle was grabbed', () => {
    const { prose, frames, view, end } = restingSelection();

    act(() => {
      view.result.current.beginHandleAdjustment('end', handleEvent({ current: end }, 11, 10, 7));
    });
    frame(frames);
    expect(view.result.current.adjusting).toBe(true);
    // Grabbing a handle must not move the endpoint: the handle sits on the line
    // edge, not on the character the student aimed at.
    expect(view.result.current.selectionText).toBe('alpha beta ');

    touchMove(end, 16, 10, 7);
    frame(frames);

    expect(view.result.current.selectionText).toBe('alpha beta gamma');
    expect(view.result.current.phase).toBe('adjusting-end');
  });

  it('keeps the finger on the same endpoint when it drags across the other one', () => {
    const { frames, view, start } = restingSelection();

    // The selection rests as offsets 0–11. Dragging the START handle past the
    // fixed end must leave the finger owning the endpoint it grabbed, with the
    // range still forward and the handle relabelled.
    act(() => {
      view.result.current.beginHandleAdjustment('start', handleEvent({ current: start }, 0, 10, 7));
    });
    frame(frames);
    expect(view.result.current.phase).toBe('adjusting-start');

    touchMove(start, 16, 10, 7);
    frame(frames);

    expect(view.result.current.phase).toBe('adjusting-end');
    expect(view.result.current.selectionText).toBe('gamma');
  });

  it('captures the pointer on the handle, so the drag survives leaving the dot', () => {
    const capture = vi.fn();
    vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(capture);
    const { frames, view, end } = restingSelection();

    act(() => {
      view.result.current.beginHandleAdjustment('end', handleEvent({ current: end }, 11, 10, 7));
    });

    expect(capture).toHaveBeenCalledWith(7);
  });

  it('reports the adjusted span and rests again when the handle is released', () => {
    const { frames, view, end, onSelect } = restingSelection();

    act(() => {
      view.result.current.beginHandleAdjustment('end', handleEvent({ current: end }, 11, 10, 7));
    });
    touchMove(end, 16, 10, 7);
    frame(frames);
    touchUp(end, 16, 10, 7);
    frame(frames);

    expect(view.result.current.phase).toBe('selected');
    expect(view.result.current.adjusting).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('alpha beta gamma');
  });

  it('ignores a grab while a finger is still down', () => {
    const { prose, frames, view, end } = harness();

    touchDown(prose, 0);
    hold(frames);
    act(() => {
      view.result.current.beginHandleAdjustment('end', handleEvent({ current: end }, 11, 10, 7));
    });

    expect(view.result.current.phase).toBe('selecting');
  });
});

describe('geometry is coalesced into frames', () => {
  it('costs one caret resolution per frame no matter how many moves arrive', () => {
    const { prose, frames, resolveCaretAtPoint, view } = harness({ activation: 'drag' });

    touchDown(prose, 0);
    frame(frames);
    resolveCaretAtPoint.mockClear();

    for (let step = 1; step <= 200; step += 1) touchMove(prose, (step % 16) + 1);
    expect(resolveCaretAtPoint).not.toHaveBeenCalled();

    frame(frames);
    expect(resolveCaretAtPoint).toHaveBeenCalledTimes(1);
    expect(view.result.current.phase).toBe('extending');

    // And the next frame costs exactly one more.
    touchMove(prose, 10);
    frame(frames);
    expect(resolveCaretAtPoint).toHaveBeenCalledTimes(2);
  });

  it('does not read the caret at all while a gesture is only pending', () => {
    const { prose, frames, resolveCaretAtPoint } = harness();

    touchDown(prose, 0);
    resolveCaretAtPoint.mockClear();
    touchMove(prose, 3);
    frame(frames);

    expect(resolveCaretAtPoint).not.toHaveBeenCalled();
  });

  it('re-measures a resting selection when the page moves under it', () => {
    const { prose, frames, view } = harness();

    touchDown(prose, 0);
    hold(frames);
    touchMove(prose, 11);
    frame(frames);
    touchUp(prose, 11);
    frame(frames);
    expect(frames.queued()).toBe(0);

    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(frames.queued()).toBe(1);
    frame(frames);
    expect(view.result.current.phase).toBe('selected');
  });
});

describe('scrolling stays the platform’s until the selection is owned', () => {
  function scrollEvent() {
    return new Event('touchmove', { cancelable: true, bubbles: true });
  }

  it('allows the page to scroll while a gesture is only a candidate', () => {
    const { prose, frames } = harness({ activation: 'drag' });

    touchDown(prose, 0);
    const before = scrollEvent();
    document.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);

    touchMove(prose, 20);
    frame(frames);
    const during = scrollEvent();
    document.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);

    touchUp(prose, 20);
    frame(frames);
    const after = scrollEvent();
    document.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('never marks the surface for a long-press contract, where a drag means reading', () => {
    const { prose } = harness();

    expect(prose.dataset['studentOwnedTouchSelection']).toBeUndefined();
  });

  it('marks the surface before any finger lands when a tool is armed', () => {
    const { prose } = harness({ activation: 'drag' });

    expect(prose.dataset['studentOwnedTouchSelection']).toBe('true');
  });

  it('hands the drag back to the browser the moment the tool is put down', () => {
    const { prose, setEnabled } = harness({ activation: 'drag' });
    expect(prose.dataset['studentOwnedTouchSelection']).toBe('true');

    setEnabled(false);

    expect(prose.dataset['studentOwnedTouchSelection']).toBeUndefined();
  });
});

describe('edge auto-scroll while adjusting', () => {
  it('scrolls the container and re-measures while the finger holds past an edge', () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ top: 100, bottom: 700, height: 600, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const scrollBy = vi.fn();
    container.scrollBy = scrollBy;
    document.body.append(container);

    const { frames, view, end } = restingSelection({ scrollContainer: () => container });

    act(() => {
      view.result.current.beginHandleAdjustment('end', handleEvent({ current: end }, 11, 690, 7));
    });
    touchMove(end, 11, 690, 7);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    frame(frames);

    expect(scrollBy).toHaveBeenCalled();
    const [, dy] = scrollBy.mock.calls[0]!;
    expect(dy).toBeGreaterThan(0);

    touchUp(end, 11, 690, 7);
    frame(frames);
  });
});

describe('the exam boundary', () => {
  it('confines a drag that leaves the block it started in', () => {
    const { prose, frames, view, onSelect } = harness({ boundaryFor: () => prose.parentElement?.querySelector('#first') ?? null });

    touchDown(prose, 0);
    hold(frames);
    touchMove(prose, 11);
    frame(frames);
    touchUp(prose, 11);
    frame(frames);

    expect(view.result.current.selectionText).toBe('alpha beta');
    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('alpha beta');
  });

  it('reports the gesture stages to an injected diagnostic sink', () => {
    const diagnostics = { record: vi.fn(), listener: vi.fn() };
    const { prose, frames, onSelect } = harness({ activation: 'drag', diagnostics });

    touchDown(prose, 0);
    touchMove(prose, 11);
    frame(frames);
    touchUp(prose, 11);
    frame(frames);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(diagnostics.listener).toHaveBeenCalledWith(prose);
    const stages = diagnostics.record.mock.calls.map(([stage]) => stage);
    expect(stages).toEqual(
      expect.arrayContaining(['pointerdown', 'start-caret', 'pointermove', 'claim', 'focus-caret', 'range', 'pointerup', 'onSelect']),
    );
    expect(diagnostics.record).toHaveBeenCalledWith('range', expect.objectContaining({ rangeText: 'alpha beta ', rangeCollapsed: false }));
  });
});
