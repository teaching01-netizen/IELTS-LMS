import { describe, expect, it } from 'vitest';
import { studentHighlightPalette } from '../highlightPalette';
import {
  applyHighlightFromSnapshot,
  applyHighlightFromSnapshotWithPolicy,
  applySelectionHighlight,
  applySelectionHighlightWithPolicy,
  createHighlightSelectionSnapshot,
} from '../highlightSelection';

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

  it('rejects selection that spans multiple paragraphs', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta</p><p>Gamma delta</p>';

    const firstParagraphTextNode = container.querySelectorAll('p')[0]?.firstChild;
    const secondParagraphTextNode = container.querySelectorAll('p')[1]?.firstChild;
    if (
      !firstParagraphTextNode ||
      firstParagraphTextNode.nodeType !== Node.TEXT_NODE ||
      !secondParagraphTextNode ||
      secondParagraphTextNode.nodeType !== Node.TEXT_NODE
    ) {
      throw new Error('Expected two text nodes');
    }

    const range = document.createRange();
    range.setStart(firstParagraphTextNode, 6);
    range.setEnd(secondParagraphTextNode, 5);

    const removeAllRanges = vi.fn();
    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
      removeAllRanges,
    } as unknown as Selection;

    const result = applySelectionHighlightWithPolicy(container, selection, 'bg-blue-200');
    expect(result.reason).toBe('cross_block_selection');
    expect(result.html).toBeNull();
    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  it('still highlights when selection stays inside a single paragraph', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta</p><p>Gamma delta</p>';

    const secondParagraphTextNode = container.querySelectorAll('p')[1]?.firstChild;
    if (!secondParagraphTextNode || secondParagraphTextNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Expected a text node in the second paragraph');
    }

    const range = document.createRange();
    range.setStart(secondParagraphTextNode, 0);
    range.setEnd(secondParagraphTextNode, 5);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => 'Gamma',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const html = applySelectionHighlight(container, selection, 'bg-blue-200');

    expect(html).toContain('<p><mark');
    expect(html).toContain('Gamma');
    expect(html).toContain('data-highlighted="true"');
  });

  it('rejects cross-paragraph snapshot selections', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta</p><p>Gamma delta</p>';

    const firstParagraphTextNode = container.querySelectorAll('p')[0]?.firstChild;
    const secondParagraphTextNode = container.querySelectorAll('p')[1]?.firstChild;
    if (
      !firstParagraphTextNode ||
      firstParagraphTextNode.nodeType !== Node.TEXT_NODE ||
      !secondParagraphTextNode ||
      secondParagraphTextNode.nodeType !== Node.TEXT_NODE
    ) {
      throw new Error('Expected two text nodes');
    }

    const range = document.createRange();
    range.setStart(firstParagraphTextNode, 6);
    range.setEnd(secondParagraphTextNode, 5);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const snapshot = createHighlightSelectionSnapshot(container, selection);
    expect(snapshot).not.toBeNull();

    const result = applyHighlightFromSnapshotWithPolicy(container, snapshot!, 'bg-blue-200');
    expect(result.reason).toBe('cross_block_selection');
    expect(result.html).toBeNull();
  });

  it('rejects container-boundary selection when endpoints are outside highlight container', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p><strong>Alpha</strong> beta gamma</p><p>Delta <em>epsilon</em> zeta</p><p>Theta iota</p>';

    const range = document.createRange();
    range.setStart(container, 0);
    range.setEnd(container, 2);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const result = applySelectionHighlightWithPolicy(container, selection, 'bg-blue-200');
    expect(result.reason).toBe('cross_block_selection');
    expect(result.html).toBeNull();
  });

  it('rejects cross-paragraph partial selections with inline tags', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p><strong>Alpha</strong> beta gamma</p><p>Delta <em>epsilon</em> zeta</p>';

    const firstParagraphTextNode = container.querySelectorAll('p')[0]?.childNodes.item(1);
    const secondParagraphTextNode = container.querySelectorAll('p')[1]?.firstChild;
    if (
      !firstParagraphTextNode ||
      firstParagraphTextNode.nodeType !== Node.TEXT_NODE ||
      !secondParagraphTextNode ||
      secondParagraphTextNode.nodeType !== Node.TEXT_NODE
    ) {
      throw new Error('Expected text nodes for partial cross-paragraph selection');
    }

    const range = document.createRange();
    range.setStart(firstParagraphTextNode, 1);
    range.setEnd(secondParagraphTextNode, 3);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const result = applySelectionHighlightWithPolicy(container, selection, 'bg-blue-200');
    expect(result.reason).toBe('cross_block_selection');
    expect(result.html).toBeNull();
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

  it('can apply a stored selection snapshot even when live selection is unavailable', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta gamma delta</p>';
    const textNode = container.querySelector('p')?.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Expected a text node');
    }

    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 22);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => 'beta gamma delta',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const snapshot = createHighlightSelectionSnapshot(container, selection);
    expect(snapshot).not.toBeNull();

    const html = applyHighlightFromSnapshot(
      container,
      snapshot!,
      'rounded-sm bg-yellow-200/80 text-gray-900',
    );

    expect(html).toContain('data-highlighted="true"');
    expect(html).toContain('beta gamma delta');
  });

  it('fails closed when the reported selected text diverges from the range text', () => {
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
      toString: () => 'wrong selected text',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const snapshot = createHighlightSelectionSnapshot(container, selection);
    expect(snapshot).not.toBeNull();
    const mismatchedSnapshot = {
      ...snapshot!,
      selectedText: 'wrong selected text',
    };

    const result = applyHighlightFromSnapshotWithPolicy(
      container,
      mismatchedSnapshot,
      'bg-blue-200',
    );
    expect(result.reason).toBe('text_mismatch_guard');
    expect(result.html).toBeNull();
  });

  it('highlights when selection.toString is stale but the captured range is correct', () => {
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
      toString: () => 'stale selection text',
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const result = applySelectionHighlightWithPolicy(container, selection, 'bg-blue-200');
    expect(result.reason).toBeNull();
    expect(result.html).toContain('data-highlighted="true"');
    expect(result.html).toContain('beta');
  });

  it('rejects nested-inline cross-paragraph selection', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p><strong>Intro</strong> alpha <em>beta</em> gamma</p><p>delta epsilon</p>';

    const betaTextNode = container.querySelector('em')?.firstChild;
    const secondParagraphTextNode = container.querySelectorAll('p')[1]?.firstChild;
    if (
      !betaTextNode ||
      betaTextNode.nodeType !== Node.TEXT_NODE ||
      !secondParagraphTextNode ||
      secondParagraphTextNode.nodeType !== Node.TEXT_NODE
    ) {
      throw new Error('Expected text nodes for nested-inline selection');
    }

    const range = document.createRange();
    range.setStart(betaTextNode, 1);
    range.setEnd(secondParagraphTextNode, 5);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const result = applySelectionHighlightWithPolicy(container, selection, 'bg-blue-200');
    expect(result.reason).toBe('cross_block_selection');
    expect(result.html).toBeNull();
  });

  it('rejects cross-paragraph selections with whitespace-only separators', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta</p>\n\n<p>Gamma delta</p>';

    const firstParagraphTextNode = container.querySelectorAll('p')[0]?.firstChild;
    const secondParagraphTextNode = container.querySelectorAll('p')[1]?.firstChild;
    if (
      !firstParagraphTextNode ||
      firstParagraphTextNode.nodeType !== Node.TEXT_NODE ||
      !secondParagraphTextNode ||
      secondParagraphTextNode.nodeType !== Node.TEXT_NODE
    ) {
      throw new Error('Expected paragraph text nodes');
    }

    const range = document.createRange();
    range.setStart(firstParagraphTextNode, 6);
    range.setEnd(secondParagraphTextNode, 5);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const result = applySelectionHighlightWithPolicy(container, selection, 'bg-blue-200');
    expect(result.reason).toBe('cross_block_selection');
    expect(result.html).toBeNull();
  });

  it('does not create nested marks when re-highlighting text that is already highlighted', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta gamma</p>';

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let currentNode = walker.nextNode();
      let targetTextNode: Text | null = null;
      while (currentNode) {
        if ((currentNode.textContent ?? '').includes('beta')) {
          targetTextNode = currentNode as Text;
          break;
        }
        currentNode = walker.nextNode();
      }
      if (!targetTextNode) {
        throw new Error('Expected text node containing beta');
      }

      const value = targetTextNode.textContent ?? '';
      const start = value.indexOf('beta');
      const end = start + 'beta'.length;
      const range = document.createRange();
      range.setStart(targetTextNode, start);
      range.setEnd(targetTextNode, end);

      const selection = {
        rangeCount: 1,
        getRangeAt: () => range,
        toString: () => range.toString(),
        removeAllRanges: vi.fn(),
      } as unknown as Selection;

      const result = applySelectionHighlightWithPolicy(container, selection, 'bg-blue-200');
      if (result.html) {
        container.innerHTML = result.html;
      }
    }

    const marks = container.querySelectorAll('mark[data-highlighted="true"]');
    expect(marks).toHaveLength(1);
    expect(container.innerHTML).toContain('<mark class="bg-blue-200" data-highlighted="true">beta</mark>');
  });

  it('flattens persisted nested mark stacks when applying a new highlight', () => {
    const container = document.createElement('div');
    container.innerHTML =
      '<p>Alpha <mark data-highlighted="true" class="bg-yellow-200"><mark data-highlighted="true" class="bg-yellow-200">beta</mark></mark> gamma</p>';

    const textNode = Array.from(container.querySelectorAll('p')[0]?.childNodes ?? []).find(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').includes('gamma'),
    );
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Expected a plain text node containing gamma');
    }

    const value = textNode.textContent ?? '';
    const start = value.indexOf('gamma');
    const end = start + 'gamma'.length;
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
      removeAllRanges: vi.fn(),
    } as unknown as Selection;

    const result = applySelectionHighlightWithPolicy(container, selection, 'bg-blue-200');
    expect(result.reason).toBeNull();
    expect(result.html).not.toContain('</mark><mark');
    expect(result.html).not.toContain('<mark data-highlighted="true" class="bg-yellow-200"><mark');
  });
});
