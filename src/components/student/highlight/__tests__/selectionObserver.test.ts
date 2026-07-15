import { describe, expect, it, vi } from 'vitest';
import { subscribeSelectionObserver } from '../selectionObserver';

describe('selectionObserver', () => {
  it('installs one shared seven-listener set for multiple subscribers and removes it after the last', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const first = subscribeSelectionObserver(() => false);
    const second = subscribeSelectionObserver(() => false);

    expect(addSpy).toHaveBeenCalledTimes(7);
    first();
    expect(removeSpy).not.toHaveBeenCalled();
    second();
    expect(removeSpy).toHaveBeenCalledTimes(7);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('fans out in subscription order until one subscriber consumes the selection', () => {
    const first = vi.fn(() => false);
    const second = vi.fn(() => true);
    const third = vi.fn(() => true);
    const unsubscribeFirst = subscribeSelectionObserver(first);
    const unsubscribeSecond = subscribeSelectionObserver(second);
    const unsubscribeThird = subscribeSelectionObserver(third);

    document.dispatchEvent(new Event('selectionchange'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).not.toHaveBeenCalled();

    unsubscribeFirst();
    unsubscribeSecond();
    unsubscribeThird();
  });

  it('ignores selectionchange while pointer is down, then emits on pointerup', () => {
    const onSelectionChange = vi.fn(() => true);
    const unsubscribe = subscribeSelectionObserver(onSelectionChange);

    // Baseline: selectionchange without a pointer gesture should notify.
    document.dispatchEvent(new Event('selectionchange'));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);

    onSelectionChange.mockClear();

    // Simulate drag-selection: pointerdown -> many selectionchange -> pointerup.
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(new Event('selectionchange'));
    expect(onSelectionChange).toHaveBeenCalledTimes(0);

    document.dispatchEvent(new Event('pointerup'));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('deduplicates the synchronous compatibility events emitted for one iPad gesture', () => {
    const onSelectionChange = vi.fn(() => true);
    const unsubscribe = subscribeSelectionObserver(onSelectionChange);

    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(new Event('pointerup'));
    document.dispatchEvent(new Event('mouseup'));
    document.dispatchEvent(new Event('touchend'));

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('deduplicates compatibility completions dispatched in later event-loop tasks', async () => {
    vi.useFakeTimers();
    const onSelectionChange = vi.fn(() => true);
    const unsubscribe = subscribeSelectionObserver(onSelectionChange);
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('pointerup'));
    await Promise.resolve();
    vi.advanceTimersByTime(20);
    document.dispatchEvent(new Event('mouseup'));
    document.dispatchEvent(new Event('touchend'));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    vi.useRealTimers();
  });

  it('allows delayed native selection finalization after an unconsumed pointer completion', () => {
    const onSelectionChange = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const unsubscribe = subscribeSelectionObserver(onSelectionChange);
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('pointerup'));
    document.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(new Event('mouseup'));
    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('accepts a later keyboard selectionchange after the consumed-state window expires', () => {
    vi.useFakeTimers();
    const onSelectionChange = vi.fn(() => true);
    const unsubscribe = subscribeSelectionObserver(onSelectionChange);
    document.dispatchEvent(new Event('selectionchange'));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(501);
    document.dispatchEvent(new Event('selectionchange'));
    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    vi.useRealTimers();
  });
});
