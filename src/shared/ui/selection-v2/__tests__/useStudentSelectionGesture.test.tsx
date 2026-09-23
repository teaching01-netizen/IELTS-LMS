import { act, createEvent, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { useStudentSelectionGesture, type SelectionHandlePointerEvent } from '../react/useStudentSelectionGesture';
import { SelectionOverlay } from '../react/SelectionOverlay';
import type { TextPoint } from '../domain/selectionTypes';

type Handlers = {
  enabled?: boolean;
  scopeKey?: string;
  ownedPointer?: (event: PointerEvent) => boolean;
  activation?: 'long-press' | 'drag';
  boundaryFor?: (point: TextPoint) => Element | null;
  onSelect?: (range: Range, text: string) => void;
  clearOnSelect?: boolean;
  longPressMs?: number;
  scrollContainer?: (root: HTMLElement) => HTMLElement | null;
  diagnostics?: { record: (stage: string, details?: Record<string, unknown>) => void; listener: (root: HTMLElement | null) => void };
  /** The haptic seam, injected like every other platform boundary in here. */
  vibrate?: (milliseconds: number) => boolean;
  /** The clock beside it, so the throttle window is driven rather than spied. */
  now?: () => number;
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
  const state = { enabled: handlers.enabled ?? true, scopeKey: handlers.scopeKey ?? '' };
  const rootRef = { current: prose } as RefObject<HTMLElement | null>;
  const view = renderHook(() =>
    useStudentSelectionGesture({
      enabled: state.enabled,
      scopeKey: state.scopeKey,
      rootRef,
      resolveCaretAtPoint,
      onSelect,
      isOwnedPointer: handlers.ownedPointer,
      longPressMs: handlers.longPressMs ?? 350,
      moveTolerancePx: 8,
      activation: handlers.activation,
      boundaryFor: handlers.boundaryFor,
      clearOnSelect: handlers.clearOnSelect,
      scrollContainer: handlers.scrollContainer,
      diagnostics: handlers.diagnostics,
      vibrate: handlers.vibrate,
      now: handlers.now,
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
    setScopeKey: (scopeKey: string) => {
      state.scopeKey = scopeKey;
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

/**
 * jsdom measures nothing, and a grab may only begin from the paint's OWN handle
 * geometry (the acquisition gate reads it) — so any test that grabs a handle
 * gives the range real measurements, exactly as a browser would. The two lines
 * land the handles at (10, 100) and (50, 144): every acquisition coordinate
 * below presses there.
 */
function mockMeasuredLines() {
  const rects = [
    { left: 10, top: 100, width: 100, height: 20 } as DOMRect,
    { left: 10, top: 124, width: 40, height: 20 } as DOMRect,
  ];
  vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(rects as unknown as DOMRectList);
}

/**
 * The paint that makes the two endpoint controls fight over one coordinate: a
 * 20px word on a 21px line.
 *
 * Its handles land at (10, 100) and (30, 121) — 21px apart, less than the height
 * of either 44px control — so the END handle's box is centred on the line's
 * bottom edge and reaches 1px ABOVE the line's top, over the whole of the START
 * handle's outward zone. A press at (20, 101) therefore belongs to the START
 * while a real browser delivers it to the END control.
 */
function mockShortWordLine() {
  const rects = [{ left: 10, top: 100, width: 20, height: 21 } as DOMRect];
  vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(rects as unknown as DOMRectList);
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
  it('uses the physical pointer type, independent of the primary pointer media query', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    const mouse = harness();
    fireEvent.pointerDown(mouse.prose, { pointerType: 'mouse', pointerId: 1, clientX: 7, clientY: 10 });
    expect(mouse.view.result.current.phase).toBe('idle');
    expect(mouse.onSelect).not.toHaveBeenCalled();
    mouse.view.unmount();

    const touch = harness();
    touchDown(touch.prose, 7);
    hold(touch.frames);
    touchUp(touch.prose, 7);
    frame(touch.frames);
    expect(touch.onSelect).toHaveBeenCalledTimes(1);
    expect(touch.onSelect.mock.calls[0]?.[1]).toBe('beta');
  });

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

  it('extends the selection by whole words as the finger travels', () => {
    const { prose, onSelect, frames, view } = harness();

    // The hold claims `alpha`; offset 11 is inside `gamma`, so the run is every
    // whole word between them — the raw-caret version stopped at `alpha beta `.
    touchDown(prose, 0);
    hold(frames);
    touchMove(prose, 11);
    frame(frames);

    expect(view.result.current.selectionText).toBe('alpha beta gamma');
    expect(view.result.current.phase).toBe('extending');

    touchUp(prose, 11);
    frame(frames);
    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('alpha beta gamma');
  });

  it('keeps a mid-word claim whole, and takes whole words on either side of it', () => {
    const { prose, onSelect, frames, view } = harness();

    // The spec's own example, through the gesture: a hold in the MIDDLE of
    // `beta`. Every string the raw-caret version produced here (`e`, `b`,
    // `pha b`, `eta g`) is a partial word, and none of them may appear.
    touchDown(prose, 7);
    hold(frames);
    expect(view.result.current.selectionText).toBe('beta');

    touchMove(prose, 8);
    frame(frames);
    expect(view.result.current.selectionText).toBe('beta');

    touchMove(prose, 2);
    frame(frames);
    expect(view.result.current.selectionText).toBe('alpha beta');

    touchMove(prose, 12);
    frame(frames);
    expect(view.result.current.selectionText).toBe('beta gamma');

    touchUp(prose, 12);
    frame(frames);
    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('beta gamma');
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
    expect(view.result.current.selectionText).toBe('alpha beta gamma');

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
    // Word-granular, and still whole words AFTER the release: the run is
    // re-derived from the claim's anchor, not from the last caret the finger
    // happened to be over.
    expect(view.result.current.selectionText).toBe('alpha beta gamma');
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

  it('keeps the exact Range endpoints and geometry when a closed toolbar selection is dragged on its body', () => {
    const onSelect = vi.fn();
    const { prose, frames, view } = harness({ activation: 'drag', onSelect, scopeKey: 'q1' });
    mockMeasuredLines();

    touchDown(prose, 0);
    touchMove(prose, 11);
    frame(frames);
    touchUp(prose, 11);
    frame(frames);
    expect(view.result.current.phase).toBe('selected');
    const firstRange = onSelect.mock.calls[0]![0] as Range;
    const endpoints = (range: Range) => ({
      startContainer: range.startContainer,
      startOffset: range.startOffset,
      endContainer: range.endContainer,
      endOffset: range.endOffset,
    });
    const rangeBefore = endpoints(firstRange);
    const paintBefore = {
      text: view.result.current.selectionText,
      rects: structuredClone(view.result.current.rects),
      startHandle: structuredClone(view.result.current.startHandle),
      endHandle: structuredClone(view.result.current.endHandle),
    };
    const overlay = render(<SelectionOverlay selection={view.result.current} />);

    // The toolbar is closed: pressing the selected body reactivates the exact
    // session range. A drag past pointerdown must not start a second session or
    // reinterpret the paint as new endpoints.
    const down = createEvent.pointerDown(document.body, {
      bubbles: true,
      cancelable: true,
      pointerId: 44,
      pointerType: 'touch',
      clientX: 30,
      clientY: 110,
    });
    fireEvent(document.body, down);
    fireEvent.pointerMove(document.body, { pointerId: 44, pointerType: 'touch', clientX: 44, clientY: 116 });
    fireEvent.pointerUp(document.body, { pointerId: 44, pointerType: 'touch', clientX: 44, clientY: 116 });

    expect(down.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(endpoints(onSelect.mock.calls[1]![0] as Range)).toEqual(rangeBefore);
    expect({
      text: view.result.current.selectionText,
      rects: view.result.current.rects,
      startHandle: view.result.current.startHandle,
      endHandle: view.result.current.endHandle,
    }).toEqual(paintBefore);
    overlay.unmount();
  });

  it('resets the Range at the owning boundary when question scope changes', () => {
    const onSelect = vi.fn();
    const { prose, frames, view, setScopeKey } = harness({ activation: 'drag', onSelect, scopeKey: 'q1' });

    touchDown(prose, 0);
    touchMove(prose, 11);
    frame(frames);
    touchUp(prose, 11);
    frame(frames);
    expect(view.result.current.phase).toBe('selected');
    expect(view.result.current.selectionText).toBeTruthy();

    setScopeKey('q2');
    expect(view.result.current.phase).toBe('idle');
    expect(view.result.current.selectionText).toBe('');
    expect(view.result.current.rects).toEqual([]);

    touchDown(prose, 0);
    touchMove(prose, 11);
    frame(frames);
    touchUp(prose, 11);
    frame(frames);
    expect(view.result.current.phase).toBe('selected');
    expect(onSelect).toHaveBeenCalledTimes(2);
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
 * A selection the finger has already made and let go of: the word `beta`,
 * narrowed by its END HANDLE to offsets 6–12 (`beta g`), resting in `selected`
 * with two real handle elements to grab.
 *
 * The partial span is built the way the spec says only precision can build one
 * (`docs/selectionui.md`): a body gesture can no longer leave a selection ending
 * in the middle of a word, so the helper claims the word and then drags one
 * endpoint — which is also what keeps every case below about a span that a
 * crossover, a release and an auto-scroll can actually move.
 */
function restingSelection(handlers: Handlers = {}) {
  const harnessed = harness(handlers);
  const end = document.createElement('button');
  const start = document.createElement('button');
  document.body.append(start, end);
  mockMeasuredLines();
  touchDown(harnessed.prose, 7);
  hold(harnessed.frames);
  touchUp(harnessed.prose, 7);
  frame(harnessed.frames);
  act(() => {
    harnessed.view.result.current.beginHandleAdjustment(handleEvent({ current: end }, 50, 144, 7));
  });
  touchMove(end, 12, 10, 7);
  frame(harnessed.frames);
  touchUp(end, 12, 10, 7);
  frame(harnessed.frames);
  expect(harnessed.view.result.current.selectionText).toBe('beta g');
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
    mockMeasuredLines();
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
      view.result.current.beginHandleAdjustment(handleEvent({ current: start }, 10, 100, 7));
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
      view.result.current.beginHandleAdjustment(handleEvent({ current: end }, 50, 144, 8));
    });
    touchMove(end, 13, 10, 8);
    frame(frames);

    expect(view.result.current.selectionText).toBe('beta ga');
  });

  it('moves only the endpoint whose handle was grabbed', () => {
    const { prose, frames, view, end } = restingSelection();

    act(() => {
      view.result.current.beginHandleAdjustment(handleEvent({ current: end }, 50, 144, 7));
    });
    frame(frames);
    expect(view.result.current.adjusting).toBe(true);
    // Grabbing a handle must not move the endpoint: the handle sits on the line
    // edge, not on the character the student aimed at.
    expect(view.result.current.selectionText).toBe('beta g');

    touchMove(end, 16, 10, 7);
    frame(frames);

    expect(view.result.current.selectionText).toBe('beta gamma');
    expect(view.result.current.phase).toBe('adjusting-end');
  });

  it('keeps the finger on the same endpoint when it drags across the other one', () => {
    const { frames, view, start } = restingSelection();

    // The selection rests as offsets 6–12, so the fixed end is 12. Dragging the
    // START handle past it must leave the finger owning the endpoint it grabbed,
    // with the range still forward and the handle relabelled.
    act(() => {
      view.result.current.beginHandleAdjustment(handleEvent({ current: start }, 10, 100, 7));
    });
    frame(frames);
    expect(view.result.current.phase).toBe('adjusting-start');

    touchMove(start, 16, 10, 7);
    frame(frames);

    expect(view.result.current.phase).toBe('adjusting-end');
    expect(view.result.current.selectionText).toBe('amma');
  });

  it('captures the pointer on the handle, so the drag survives leaving the dot', () => {
    const capture = vi.fn();
    vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(capture);
    const { frames, view, end } = restingSelection();

    act(() => {
      view.result.current.beginHandleAdjustment(handleEvent({ current: end }, 50, 144, 7));
    });

    expect(capture).toHaveBeenCalledWith(7);
  });

  it('reports the adjusted span and rests again when the handle is released', () => {
    const { frames, view, end, onSelect } = restingSelection();

    act(() => {
      view.result.current.beginHandleAdjustment(handleEvent({ current: end }, 50, 144, 7));
    });
    touchMove(end, 16, 10, 7);
    frame(frames);
    touchUp(end, 16, 10, 7);
    frame(frames);

    expect(view.result.current.phase).toBe('selected');
    expect(view.result.current.adjusting).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect((onSelect.mock.calls[0]![0] as Range).toString()).toBe('beta gamma');
  });

  it('ignores a grab while a finger is still down', () => {
    const { prose, frames, view, end } = harness();
    mockMeasuredLines();

    touchDown(prose, 0);
    hold(frames);
    act(() => {
      view.result.current.beginHandleAdjustment(handleEvent({ current: end }, 50, 144, 7));
    });

    // The acquisition passes — the press is on the outward zone — and it is
    // the MACHINE that refuses, so this asserts the second gate, not the first.
    expect(view.result.current.phase).toBe('selecting');
  });

  it('moves the endpoint whose zone the press is in, not the control it landed on', () => {
    const { prose, frames, view } = harness();
    mockShortWordLine();
    const start = document.createElement('button');
    const end = document.createElement('button');
    document.body.append(start, end);

    touchDown(prose, 7);
    hold(frames);
    touchUp(prose, 7);
    frame(frames);
    expect(view.result.current.selectionText).toBe('beta');

    // The press is in the START's outward zone, handed to the END control —
    // which is exactly what the browser does on this paint, because the end
    // control is the one on top there. Asking only that control refuses the
    // press and the handle the student aimed at never moves.
    act(() => {
      view.result.current.beginHandleAdjustment(handleEvent({ current: end }, 20, 101, 7));
    });
    frame(frames);

    expect(view.result.current.phase).toBe('adjusting-start');
    touchMove(end, 2, 10, 7);
    frame(frames);

    // The START is the endpoint under the finger: the word's end stays at offset
    // 9 and the span grows to its left.
    expect(view.result.current.selectionText).toBe('pha beta');
  });

  it('refuses a grab that does not acquire, even called directly on the gesture', () => {
    const { frames, view, end } = restingSelection();

    // Inside the end handle's 44px box but above its own line's bottom edge:
    // the press the overlay consumes. The entry gate refuses it too, so no
    // caller can bypass the directional rule (docs/selectionui.md #1).
    act(() => {
      view.result.current.beginHandleAdjustment(handleEvent({ current: end }, 60, 130, 7));
    });
    frame(frames);

    expect(view.result.current.phase).toBe('selected');
    expect(view.result.current.adjusting).toBe(false);
    expect(view.result.current.selectionText).toBe('beta g');
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
    // Building the resting selection ends with a handle drag of its own, whose
    // finger sits above the box — so it has already asked for one scroll step.
    // Cleared here because the delta below is the claim: the MOVE in this test
    // is what puts a finger in the edge band.
    scrollBy.mockClear();

    // The grab must satisfy the acquisition rule (on the handle, at the paint);
    // it is the MOVE below that puts the finger in the edge band.
    act(() => {
      view.result.current.beginHandleAdjustment(handleEvent({ current: end }, 50, 144, 7));
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
    expect(diagnostics.record).toHaveBeenCalledWith('range', expect.objectContaining({ rangeText: 'alpha beta gamma', rangeCollapsed: false }));
  });
});

/**
 * The snap key: one tick per NEW caret position, on both channels.
 *
 * Two coordinates, two cadences. The FINGER travels every pixel; the CARET is
 * at a character boundary or it is not. Everything downstream — the marker's
 * spring, the grip's, the haptic — is driven by the one event `{node, offset}`
 * changing, so these tests pin it from both sides: a finger travelling inside
 * one glyph changes nothing at all (content byte-identical, no revision, no
 * buzz), a crossing ticks EXACTLY once, and the visual and haptic channels
 * differ in cadence but never in cause.
 */
describe('the snap key: one tick per new caret position', () => {
  /**
   * Glyph boxes jsdom cannot lay out: irregular widths, one line from x = 10.
   *
   * The spy answers exactly as a renderer would — a box per measured range,
   * nothing for a collapsed one (Blink and Gecko's own answer for a caret,
   * which is what forces the adjacent-glyph fallback), and nothing at all for
   * ranges in other nodes.
   */
  function layoutGlyphs(node: Text, widths: number[]) {
    return vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
      if (this.startContainer !== node || this.startOffset >= this.endOffset) {
        return [] as unknown as DOMRectList;
      }
      let left = 10;
      for (let index = 0; index < this.startOffset; index += 1) left += widths[index] ?? 8;
      let width = 0;
      for (let index = this.startOffset; index < this.endOffset; index += 1) width += widths[index] ?? 8;
      return [
        { left, top: 100, width, height: 20, right: left + width, bottom: 120, x: left, y: 100, toJSON: () => ({}) },
      ] as unknown as DOMRectList;
    });
  }

  const widths = [7, 5, 9, 4, 11, 6, 8, 3, 10, 5, 7, 12, 4, 6, 9, 5];
  /** The document x of the boundary at `offset`: the right edge of its glyph. */
  function boundaryX(offset: number) {
    let x = 10;
    for (let index = 0; index < offset; index += 1) x += widths[index] ?? 8;
    return x;
  }

  it('leaves the content untouched while the finger travels inside one glyph', () => {
    const vibrate = vi.fn(() => true);
    const { prose, proseText, frames, view } = harness({ activation: 'drag', vibrate });
    layoutGlyphs(proseText, widths);

    touchDown(prose, 0);
    touchMove(prose, 10);
    frame(frames);
    const resting = view.result.current.pointer;
    expect(resting).not.toBeNull();
    expect(resting!.caret).toMatchObject({ x: boundaryX(10), y: 110 });
    vibrate.mockClear();

    // 10.2 resolves to the same offset the resolver already had: the hand
    // moved, the text did not. The lens's BOX follows the finger — and its
    // CONTENT must not change by so much as a pixel: identical geometry (the
    // picture has nothing to translate), no revision for the marker or grip to
    // spring from, no haptic saying "new character" when there isn't one.
    touchMove(prose, 10.2);
    frame(frames);
    const moved = view.result.current.pointer!;

    expect(moved.finger.x).toBe(10.2);
    expect(moved.caret).toEqual(resting!.caret);
    expect(moved.snapRevision).toBe(resting!.snapRevision);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('snaps exactly once when the finger crosses a character midpoint', () => {
    const vibrate = vi.fn(() => true);
    const { prose, proseText, frames, view } = harness({ activation: 'drag', vibrate });
    layoutGlyphs(proseText, widths);

    touchDown(prose, 0);
    touchMove(prose, 10);
    frame(frames);
    const before = view.result.current.pointer!;
    vibrate.mockClear();

    // One crossing: one revision step, one buzz, and the caret is AT the new
    // boundary — not part-way, because it was never anywhere in between. Two
    // frames rather than one so the crossing is measured against a caret that
    // already exists, which is the only state in which a change is a change.
    touchMove(prose, 10.6);
    frame(frames);
    const after = view.result.current.pointer!;

    expect(after.snapRevision).toBe(before.snapRevision + 1);
    expect(after.caret!.x).not.toBe(before.caret!.x);
    expect(after.caret).toMatchObject({ x: boundaryX(11), y: 110 });
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it('keeps snapping when the platform asks for reduced motion', () => {
    // prefers-reduced-motion reaches the MOTION policy — the spring back is
    // dropped there, asserted in selectionMotion.test — and must not reach the
    // snap: the caret still resolves to the new boundary and the lens's content
    // still jumps to it, which is information rather than decoration. The
    // gesture reads no motion preference; a document answering "reduce" to
    // everything changes nothing here, and if it ever did this would fail.
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList);
    const { prose, proseText, frames, view } = harness({ activation: 'drag' });
    layoutGlyphs(proseText, widths);

    touchDown(prose, 0);
    touchMove(prose, 10);
    frame(frames);
    const before = view.result.current.pointer!;

    touchMove(prose, 10.6);
    frame(frames);
    const after = view.result.current.pointer!;

    expect(after.snapRevision).toBe(before.snapRevision + 1);
    expect(after.caret).toMatchObject({ x: boundaryX(11), y: 110 });
  });

  describe('the haptic channel', () => {
    it('is feature-detected: with no platform vibrate a crossing still snaps, and costs nothing', () => {
      // jsdom is iOS Safari here: `navigator.vibrate` simply does not exist,
      // which is the ordinary case on the device most likely to be held. The
      // absence must be free — no throw, no retry — and must not disable the
      // snap, which is not the haptic's to disable.
      Reflect.deleteProperty(navigator, 'vibrate');
      const { prose, proseText, frames, view } = harness({ activation: 'drag' });
      layoutGlyphs(proseText, widths);

      touchDown(prose, 0);
      touchMove(prose, 10);
      frame(frames);
      const before = view.result.current.pointer!;
      touchMove(prose, 10.6);
      frame(frames);

      expect(view.result.current.pointer!.snapRevision).toBe(before.snapRevision + 1);
      expect(view.result.current.pointer!.caret).toMatchObject({ x: boundaryX(11) });
    });

    it('reaches the platform’s own vibrate when one is present', () => {
      const platform = vi.fn(() => true);
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: platform });
      try {
        const { prose, proseText, frames } = harness({ activation: 'drag' });
        layoutGlyphs(proseText, widths);

        touchDown(prose, 0);
        touchMove(prose, 10);
        frame(frames);
        touchMove(prose, 10.6);
        frame(frames);

        expect(platform).toHaveBeenCalledWith(8);
      } finally {
        Reflect.deleteProperty(navigator, 'vibrate');
      }
    });

    it('is throttled to a tap per crossing window, and never continuous', () => {
      const vibrate = vi.fn(() => true);
      // The clock is the INJECTED one, starting at zero: each crossing below
      // moves it by hand, so the window is asserted exactly — no spy on the
      // machine's clock, and no timestamp chosen to clear production's
      // `lastHapticAt = 0` sentinel (the first crossing at 60ms is past the
      // floor on its own).
      let now = 0;
      const { prose, proseText, frames, view } = harness({ activation: 'drag', vibrate, now: () => now });
      layoutGlyphs(proseText, widths);

      touchDown(prose, 0);
      touchMove(prose, 10);
      frame(frames);
      const baseline = view.result.current.pointer!.snapRevision;
      vibrate.mockClear();

      now = 60;
      touchMove(prose, 10.6);
      frame(frames);
      expect(vibrate).toHaveBeenCalledTimes(1);
      expect(vibrate).toHaveBeenCalledWith(8);

      // A second crossing 20ms later: the VISUAL tick still advances — the
      // student's eye is not throttled — but the finger is not buzzed twice
      // inside one window, which is the difference between a tap and a hum.
      now = 80;
      touchMove(prose, 11.6);
      frame(frames);
      expect(vibrate).toHaveBeenCalledTimes(1);
      expect(view.result.current.pointer!.snapRevision).toBe(baseline + 2);

      // Past the floor: the next real crossing buzzes again.
      now = 140;
      touchMove(prose, 12.6);
      frame(frames);
      expect(vibrate).toHaveBeenCalledTimes(2);

      // Inside one glyph, however many frames: no crossing, no buzz. Every
      // call this gesture ever makes is the same 8ms tap — never a longer pulse,
      // never a pattern, never one per pointermove.
      for (const x of [13, 13.2, 13.4, 13.1]) {
        touchMove(prose, x);
        frame(frames);
      }
      expect(vibrate).toHaveBeenCalledTimes(2);
      expect(vibrate.mock.calls.every(([milliseconds]) => milliseconds === 8)).toBe(true);
      expect(view.result.current.pointer!.snapRevision).toBe(baseline + 3);
    });
  });
});

/**
 * Every terminal signal ends the gesture — and after any of them the loupe's
 * precondition (a pointer the session OWNS) is gone before the next painted
 * frame.
 *
 * The Safari failure these pin: capture reports held, so no listener was ever
 * installed on the document, and the terminal event arrives there instead —
 * the machine then stays in `adjusting-*` with the loupe open forever. The
 * fix keeps a document backup for the terminal events, reads a lost capture as
 * a cancel, and clears the presentation refs in ONE place so a stale
 * `lastPointer` can never stand in for contact that ended.
 */
describe('a gesture ends on every terminal signal', () => {
  it('releases exactly once when capture claims to hold but the pointerup arrives at the document', () => {
    vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(true);
    const { frames, view, end, onSelect } = restingSelection();

    act(() => {
      view.result.current.beginHandleAdjustment(handleEvent({ current: end }, 50, 144, 7));
    });
    frame(frames);
    expect(view.result.current.phase).toBe('adjusting-end');

    act(() => {
      fireEvent.pointerUp(document, { pointerId: 7 });
    });
    frame(frames);

    expect(view.result.current.phase).toBe('selected');
    expect(view.result.current.adjusting).toBe(false);
    expect(view.result.current.pointer).toBeNull();
    expect(onSelect).toHaveBeenCalledTimes(1);

    // A duplicate delivery — the same physical release reaching a backup
    // listener twice — must not report the selection a second time.
    act(() => {
      fireEvent.pointerUp(document, { pointerId: 7 });
    });
    frame(frames);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(view.result.current.phase).toBe('selected');
  });

  it('leaves the adjusting phase when the browser loses the pointer capture', () => {
    vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(true);
    const { frames, view, end } = restingSelection();

    act(() => {
      view.result.current.beginHandleAdjustment(handleEvent({ current: end }, 50, 144, 7));
    });
    frame(frames);
    expect(view.result.current.phase).toBe('adjusting-end');

    act(() => {
      const lost = new Event('lostpointercapture', { bubbles: true });
      Object.defineProperty(lost, 'pointerId', { value: 7 });
      end.dispatchEvent(lost);
    });
    frame(frames);

    // The cancel policy (nothing reported, the platform takes the gesture
    // back) with the same presentation cleanup: no adjusting phase, and no
    // pointer for a loupe to be gated on.
    expect(view.result.current.phase).toBe('idle');
    expect(view.result.current.adjusting).toBe(false);
    expect(view.result.current.selectionText).toBe('');
    expect(view.result.current.pointer).toBeNull();
  });

  it('exposes no pointer the moment the finger lifts, before any frame runs', () => {
    const { prose, frames, view } = harness();

    touchDown(prose, 0);
    hold(frames);
    touchMove(prose, 11);
    frame(frames);
    expect(view.result.current.pointer).not.toBeNull();

    touchUp(prose, 11);

    expect(view.result.current.phase).toBe('selected');
    expect(view.result.current.pointer).toBeNull();
  });
});
