import { describe, expect, it, vi } from 'vitest';
import { subscribeSelectionObserver } from '../selectionObserver';

describe('selectionObserver', () => {
  it('ignores selectionchange while pointer is down, then emits on pointerup', () => {
    const onSelectionChange = vi.fn();
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
});

