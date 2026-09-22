import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { followPointer } from '../engine/pointerCapture';

/**
 * The terminal event is the one that must never be lost.
 *
 * `followPointer` prefers pointer capture so a drag keeps following the finger
 * without a document-wide listener, but Safari can report capture as held and
 * then fail to deliver the release to the captured element — leaving the
 * machine in `adjusting-*` with the loupe open forever. These cases pin the
 * hardening: the document always holds a backup for the TERMINAL events, a
 * lost capture reads as a cancel, and a document going to the background ends
 * the gesture rather than outliving it.
 */

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** An element whose capture the browser accepts and holds. */
function capturedElement(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'releasePointerCapture').mockImplementation(() => {});
  vi.spyOn(Element.prototype, 'hasPointerCapture').mockReturnValue(true);
  return element;
}

function follow(element: Element, overrides: Partial<{ onMove: (event: PointerEvent) => void; onUp: (event: PointerEvent) => void; onCancel: (event: PointerEvent) => void }> = {}) {
  const followResult = followPointer(7, element, {
    onMove: overrides.onMove ?? vi.fn(),
    onUp: overrides.onUp ?? vi.fn(),
    onCancel: overrides.onCancel ?? vi.fn(),
  });
  if (!followResult) throw new Error('followPointer declined the element');
  return followResult;
}

describe('terminal delivery while capture claims to be held', () => {
  it('receives the pointerup dispatched on the document, exactly once', () => {
    const element = capturedElement();
    const onUp = vi.fn();
    const binding = follow(element, { onUp });

    // The failure this guards: capture reports held, so the release never
    // reaches the element — but the document backup still ends the gesture.
    fireEvent.pointerUp(document, { pointerId: 7 });
    expect(onUp).toHaveBeenCalledTimes(1);

    binding.release();
    fireEvent.pointerUp(document, { pointerId: 7 });
    expect(onUp).toHaveBeenCalledTimes(1);
  });

  it('delivers one terminal event even when it reaches both the element and the document', () => {
    const element = capturedElement();
    const onUp = vi.fn();
    follow(element, { onUp });

    // A release on the captured element bubbles to the document, where the
    // backup listener also sits: the first terminal signal tears the follow
    // down, so the same physical release cannot be handled twice.
    fireEvent.pointerUp(element, { pointerId: 7 });
    expect(onUp).toHaveBeenCalledTimes(1);
  });

  it('reads a lost pointer capture as the terminal cancel', () => {
    const element = capturedElement();
    const onCancel = vi.fn();
    follow(element, { onCancel });

    const lost = new Event('lostpointercapture', { bubbles: true });
    Object.defineProperty(lost, 'pointerId', { value: 7 });
    element.dispatchEvent(lost);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels when the document goes to the background mid-gesture', () => {
    const element = capturedElement();
    const onCancel = vi.fn();
    follow(element, { onCancel });

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
    }

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('ignores terminal events belonging to another pointer', () => {
    const element = capturedElement();
    const onUp = vi.fn();
    const onCancel = vi.fn();
    follow(element, { onUp, onCancel });

    fireEvent.pointerUp(document, { pointerId: 99 });
    const lost = new Event('lostpointercapture', { bubbles: true });
    Object.defineProperty(lost, 'pointerId', { value: 99 });
    element.dispatchEvent(lost);

    expect(onUp).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
