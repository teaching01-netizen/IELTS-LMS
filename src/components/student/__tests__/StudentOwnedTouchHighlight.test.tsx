import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { FormattedText } from '../FormattedText';
import { StudentExamInteractionScopeProvider } from '@shared/ui/touch-selection/StudentExamInteractionScope';
import { studentHighlightPalette, type StudentHighlightColor } from '../highlightPalette';
import { StudentHighlightPersistenceProvider } from '../highlightV2Persistence';

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

beforeEach(() => {
  vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([
    { left: 0, top: 0, width: 160, height: 20 } as DOMRect,
  ] as unknown as DOMRectList);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(performance.now()), 16));
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => window.clearTimeout(id));
});

afterEach(() => {
  restoreEnvironment?.();
  restoreEnvironment = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  localStorage.clear();
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

interface SurfaceOptions {
  ownedTouchSelection: boolean;
  toolMode?: 'off' | 'highlight' | 'erase';
  color?: StudentHighlightColor;
  text?: string;
  surfaceId?: string;
}

function renderSurface(options: SurfaceOptions) {
  const element = (props: SurfaceOptions) => (
    <StudentExamInteractionScopeProvider ownedTouchSelection={props.ownedTouchSelection}>
      <StudentHighlightPersistenceProvider namespace="owned-selection-test">
        <FormattedText
          text={props.text ?? 'Alpha beta gamma'}
          highlightEnabled
          highlightToolMode={props.toolMode ?? 'highlight'}
          highlightColor={props.color ?? 'yellow'}
          highlightSurfaceId={props.surfaceId ?? 'owned-touch'}
        />
      </StudentHighlightPersistenceProvider>
    </StudentExamInteractionScopeProvider>
  );
  const result = render(element(options));
  const surface = result.container.querySelector('[data-student-highlightable="true"]') as HTMLElement;
  return { ...result, surface, update: (next: Partial<SurfaceOptions>) => {
    options = { ...options, ...next };
    result.rerender(element(options));
  } };
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

/** Hit-test canonical offsets even after highlighting splits the text nodes. */
function stubSurfaceHitTest(root: HTMLElement) {
  const capable = document as PointCapable;
  const original = capable.caretPositionFromPoint;
  capable.caretPositionFromPoint = (x: number) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = Math.round(x);
    let node: Text | null;
    let last: Text | null = null;
    while ((node = walker.nextNode() as Text | null)) {
      if (remaining < node.length) return { offsetNode: node, offset: remaining };
      remaining -= node.length;
      last = node;
    }
    return last && remaining === 0 ? { offsetNode: last, offset: last.length } : null;
  };
  return () => {
    if (original) capable.caretPositionFromPoint = original;
    else delete capable.caretPositionFromPoint;
  };
}

/** Physical movement exceeds the threshold while the hit test stays on beta. */
function immediateDrag(from: number, to: number) {
  vi.useFakeTimers();
  const surface = document.querySelector('[data-student-highlightable="true"]')!;
  fireEvent.pointerDown(surface, { pointerType: 'touch', pointerId: 1, clientX: from, clientY: 10 });
  fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: from + 9, clientY: 10 });
  fireEvent.pointerMove(document, { pointerType: 'touch', pointerId: 1, clientX: to, clientY: 10 });
  fireEvent.pointerUp(document, { pointerType: 'touch', pointerId: 1 });
}

describe('IELTS owned touch highlighting', () => {
  it.each(['touch', 'mouse', 'pen'])('owns %s selection and commits once on release without a menu', (pointerType) => {
    vi.useFakeTimers();
    const { surface, container } = renderSurface({ ownedTouchSelection: true });
    restoreEnvironment = stubSurfaceHitTest(surface);
    expect(surface).toHaveAttribute('data-student-selection-owner', 'app');
    const addRange = vi.spyOn(Selection.prototype, 'addRange');

    fireEvent.pointerDown(surface, { pointerType, pointerId: 1, clientX: 0, clientY: 10 });
    fireEvent.pointerMove(document, { pointerType, pointerId: 1, clientX: 16, clientY: 10 });
    act(() => { vi.advanceTimersByTime(20); });
    expect(document.querySelector('[data-student-selection-highlight]')).not.toBeNull();
    expect(container.querySelector('mark')).toBeNull();
    fireEvent.pointerUp(document, { pointerType, pointerId: 1 });
    fireEvent.mouseUp(surface);

    expect(container.querySelectorAll('mark')).toHaveLength(1);
    expect(container.querySelector('mark')).toHaveTextContent('Alpha beta gamma');
    expect(document.querySelector('[data-student-selection-highlight]')).toBeNull();
    expect(document.querySelector('[data-selection-action-menu]')).toBeNull();
    expect(addRange).not.toHaveBeenCalled();
    expect(surface).toHaveAttribute('data-student-selection-owner', 'app');
  });

  it.each(studentHighlightPalette)('previews $label ink during selection and saves that color', (entry) => {
    vi.useFakeTimers();
    const { surface } = renderSurface({ ownedTouchSelection: true, color: entry.id });
    restoreEnvironment = stubSurfaceHitTest(surface);
    fireEvent.pointerDown(surface, { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 10 });
    fireEvent.pointerMove(document, { pointerType: 'mouse', pointerId: 1, clientX: 16, clientY: 10 });
    act(() => { vi.advanceTimersByTime(20); });
    const paint = document.querySelector<HTMLElement>('[data-student-selection-highlight]');
    expect(paint?.style.getPropertyValue('--selection-fill')).toBe(`color-mix(in srgb, ${entry.highlightColorValue} 45%, transparent)`);
    fireEvent.pointerUp(document, { pointerType: 'mouse', pointerId: 1 });
    expect(surface.querySelector('mark')).toHaveAttribute('data-highlight-color', entry.id);
  });

  it.each(['touch', 'mouse', 'pen'])('partially erases with %s, preserves leftovers and persists the result', (pointerType) => {
    vi.useFakeTimers();
    const { surface, container, update, unmount } = renderSurface({ ownedTouchSelection: true, color: 'purple' });
    restoreEnvironment = stubSurfaceHitTest(surface);
    longPressAndDrag(0, 16);
    update({ toolMode: 'erase' });

    fireEvent.pointerDown(surface, { pointerType, pointerId: 2, clientX: 6, clientY: 10 });
    act(() => { vi.advanceTimersByTime(350); });
    fireEvent.pointerMove(document, { pointerType, pointerId: 2, clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(20); });
    expect(document.querySelector<HTMLElement>('[data-student-selection-highlight]')?.style.getPropertyValue('--selection-fill')).toBe('rgba(100, 116, 139, 0.25)');
    fireEvent.pointerUp(document, { pointerType, pointerId: 2 });

    expect([...surface.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Alpha ', ' gamma']);
    for (const mark of surface.querySelectorAll('mark')) expect(mark).toHaveAttribute('data-highlight-color', 'purple');
    expect(container.querySelector('[role="status"]')).toHaveTextContent('Highlight erased.');
    expect(document.querySelector('[data-student-selection-highlight]')).toBeNull();

    // Repeating an erasure on already plain text is a truthful no-op.
    longPressAndDrag(7, 9);
    expect(container.querySelector('[role="status"]')).toHaveTextContent('No highlights in the selected text.');
    unmount();
    const restored = renderSurface({ ownedTouchSelection: true, toolMode: 'off' });
    expect([...restored.surface.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Alpha ', ' gamma']);
  });

  it('erases across differently colored marks, then fully clears and persists an empty surface', () => {
    const { surface, update, unmount } = renderSurface({ ownedTouchSelection: true, color: 'yellow' });
    restoreEnvironment = stubSurfaceHitTest(surface);
    longPressAndDrag(0, 16);
    update({ color: 'blue' });
    longPressAndDrag(7, 9);
    update({ toolMode: 'erase' });
    longPressAndDrag(1, 9);
    expect([...surface.querySelectorAll('mark')].map((mark) => [mark.textContent, mark.dataset['highlightColor']])).toEqual([[' gamma', 'yellow']]);
    longPressAndDrag(1, 15);
    expect(surface.querySelector('mark')).toBeNull();
    unmount();
    expect(renderSurface({ ownedTouchSelection: true }).surface.querySelector('mark')).toBeNull();
  });

  it('rejects leaked native selection on pointer-owned prose without painting a mark', () => {
    const { surface } = renderSurface({ ownedTouchSelection: true });
    const range = document.createRange();
    range.selectNodeContents(surface);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(surface.querySelector('mark')).toBeNull();
    const selectStart = new Event('selectstart', { bubbles: true, cancelable: true });
    fireEvent(surface, selectStart);
    expect(selectStart.defaultPrevented).toBe(true);
  });

  it.each(['cancel', 'off', 'erase', 'passage', 'content', 'escape'])('discards a drag on %s', (reason) => {
    vi.useFakeTimers();
    const { surface, update } = renderSurface({ ownedTouchSelection: true });
    restoreEnvironment = stubSurfaceHitTest(surface);
    fireEvent.pointerDown(surface, { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 10 });
    fireEvent.pointerMove(document, { pointerType: 'mouse', pointerId: 1, clientX: 16, clientY: 10 });
    act(() => { vi.advanceTimersByTime(20); });
    if (reason === 'cancel') fireEvent.pointerCancel(document, { pointerType: 'mouse', pointerId: 1 });
    if (reason === 'off' || reason === 'erase') update({ toolMode: reason });
    if (reason === 'passage') update({ surfaceId: 'another-passage' });
    if (reason === 'content') update({ text: 'Replacement passage' });
    if (reason === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerUp(document, { pointerType: 'mouse', pointerId: 1 });
    expect(surface.querySelector('mark')).toBeNull();
    expect(document.querySelector('[data-student-selection-highlight]')).toBeNull();
  });

  it('hands keyboard selection back, applies Alt+H, and reclaims the next pointer', () => {
    const { surface } = renderSurface({ ownedTouchSelection: true });
    surface.focus();
    expect(document.activeElement).toBe(surface);
    fireEvent.keyDown(surface, { key: 'ArrowRight', shiftKey: true });
    expect(surface).not.toHaveAttribute('data-student-selection-owner');
    const range = document.createRange();
    range.setStart(surface.firstChild!, 6);
    range.setEnd(surface.firstChild!, 10);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.toString()).toBe('beta');
    fireEvent.keyDown(surface, { key: 'h', altKey: true });
    expect(surface.querySelector('mark')).toHaveTextContent('beta');
    restoreEnvironment = stubSurfaceHitTest(surface);
    fireEvent.pointerDown(surface, { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 10 });
    expect(surface).toHaveAttribute('data-student-selection-owner', 'app');
    fireEvent.pointerCancel(document, { pointerType: 'mouse', pointerId: 1 });
  });

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

  it('tells the browser the exam owns the drag while a tool is armed', () => {
    // The gesture has to be claimed BEFORE the finger lands. With the browser
    // still entitled to pan, the first few pixels of movement are read as a
    // scroll, the touch is taken away with `pointercancel`, and the selection the
    // hook had just built is discarded — on a surface whose platform selection is
    // suppressed, so nothing selects at all.
    restoreEnvironment = stubCoarsePointerDevice();
    const { surface } = renderSurface({ ownedTouchSelection: true, toolMode: 'highlight' });

    expect(surface).toHaveAttribute('data-student-owned-touch-selection', 'true');
  });

  it('hands the drag back to the browser when no tool is armed', () => {
    restoreEnvironment = stubCoarsePointerDevice();
    const { surface } = renderSurface({ ownedTouchSelection: true, toolMode: 'off' });

    expect(surface).not.toHaveAttribute('data-student-owned-touch-selection');
  });

  it('hands the drag back in a session that declared no owned gesture', () => {
    restoreEnvironment = stubCoarsePointerDevice();
    const { surface } = renderSurface({ ownedTouchSelection: false, toolMode: 'highlight' });

    expect(surface).not.toHaveAttribute('data-student-owned-touch-selection');
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
