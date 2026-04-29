import { describe, expect, it } from 'vitest';
import { studentHighlightPalette } from '../highlightPalette';
import { applySelectionHighlight } from '../highlightSelection';

describe('applySelectionHighlight', () => {
  it('wraps the selected text without removing the passage', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta gamma</p>';

    const textNode = container.querySelector('p')?.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Expected a text node');
    }

    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 10);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => 'beta',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const html = applySelectionHighlight(container, selection, 'bg-blue-200');

    expect(html).toContain('Alpha');
    expect(html).toContain('beta');
    expect(html).toContain('gamma');
    expect(html).toContain('data-highlighted="true"');
    expect(container.textContent).toBe('Alpha beta gamma');
  });

  it('uses highlight styles that do not add spacing around highlighted text', () => {
    expect(studentHighlightPalette.every((entry) => !entry.highlightClassName.includes('px-'))).toBe(true);

    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta gamma</p>';
    const textNode = container.querySelector('p')?.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Expected a text node');
    }

    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 10);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => 'beta',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const html = applySelectionHighlight(container, selection);

    expect(html).not.toContain('px-0.5');
    expect(html).toContain('Alpha <mark');
    expect(html).toContain('</mark> gamma');
  });
});
