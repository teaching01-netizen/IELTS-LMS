import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserHighlightSelectionPort,
  createInMemoryHighlightSelectionPort,
} from '../highlightSelectionPort';

describe('highlight selection port', () => {
  it('supports subscribe and unsubscribe in memory adapter', () => {
    const port = createInMemoryHighlightSelectionPort();
    const listener = vi.fn();

    const unsubscribe = port.subscribe(listener);
    port.emit();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    port.emit();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears selection snapshot in memory adapter', () => {
    const port = createInMemoryHighlightSelectionPort({
      selection: {
        start: 1,
        end: 5,
        selectedText: 'beta',
      },
      selectionText: 'beta',
      toolbarPosition: { left: 40, top: 10 },
    });

    const initial = port.readSelection(document.createElement('div'));
    expect(initial.selection?.selectedText).toBe('beta');

    port.clearSelection();
    const cleared = port.readSelection(document.createElement('div'));
    expect(cleared.selection).toBeNull();
    expect(cleared.selectionText).toBe('');
    expect(cleared.toolbarPosition).toBeNull();
  });

  it('reads and clears browser selection through adapter seam', () => {
    const host = document.createElement('div');
    host.textContent = 'Alpha beta gamma';
    document.body.appendChild(host);

    const textNode = host.firstChild as Text;
    const removeAllRanges = vi.fn();
    const selection = {
      rangeCount: 1,
      getRangeAt: () => {
        const range = document.createRange();
        range.setStart(textNode, 6);
        range.setEnd(textNode, 10);
        // JSDOM doesn't implement layout; provide a stable rect for toolbar positioning.
        (range as any).getBoundingClientRect = () => ({
          left: 10,
          top: 20,
          bottom: 40,
          width: 100,
          height: 20,
          right: 110,
          x: 10,
          y: 20,
          toJSON: () => ({}),
        });
        return range;
      },
      toString: () => 'beta',
      removeAllRanges,
    } as unknown as Selection;

    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selection);

    const port = createBrowserHighlightSelectionPort();
    const snapshot = port.readSelection(host, { enforceSingleBlock: true });
    expect(snapshot.selection?.selectedText).toBe('beta');
    expect(snapshot.selectionText).toBe('beta');
    expect(snapshot.toolbarPosition).toEqual({ left: 60, top: 40 });

    port.clearSelection();
    expect(removeAllRanges).toHaveBeenCalledTimes(1);

    getSelectionSpy.mockRestore();
    document.body.removeChild(host);
  });
});
