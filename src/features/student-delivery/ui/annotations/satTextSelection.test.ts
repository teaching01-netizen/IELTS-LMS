import { beforeEach, describe, expect, it } from 'vitest';
import { satChoiceAnnotationRegion } from '../../domain/satAnnotationIdentity';
import { captureSatTextRange, captureSatTextSelection } from './satTextSelection';

/**
 * The capture functions turn a span of rendered text into a serialized anchor.
 *
 * `captureSatTextRange` is the core and `captureSatTextSelection` is the desktop
 * adapter onto it: a browser selection is one way to name a span, and an
 * app-owned touch range (see `@shared/ui/touch-selection`) is another. Both must
 * produce the same anchor for the same span, which is what these tests pin.
 */

function buildRoot(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

function rangeWithin(root: HTMLElement, selector: string, start: number, end: number): Range {
  const block = root.querySelector(selector);
  if (!block) throw new Error(`missing ${selector}`);
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode() as Text | null;
  if (!node) throw new Error(`no text in ${selector}`);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

const PROSE = '<span data-content-text-node="p1">hello brave world</span>';

function collapsedSelection(root: HTMLElement): Selection {
  const range = rangeWithin(root, 'span', 6, 6);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('captureSatTextRange', () => {
  it('serializes a span of one block into an anchor with its surrounding context', () => {
    const root = buildRoot(PROSE);

    const anchor = captureSatTextRange(root, 'stimulus', rangeWithin(root, 'span', 6, 11));

    expect(anchor).toEqual({
      nodeId: 'stimulus:p1',
      startOffset: 6,
      endOffset: 11,
      exact: 'brave',
      prefix: 'hello ',
      suffix: ' world',
    });
  });

  it('qualifies identical choice node ids with each stable option id', () => {
    const root = buildRoot(
      '<div data-content-text-node="same-id">Tree cover affects heat.</div>' +
      '<div data-content-text-node="same-id">Tree cover affects heat.</div>',
    );
    const blocks = root.querySelectorAll('[data-content-text-node]');
    const makeRange = (block: Element) => {
      const range = document.createRange();
      range.setStart(block.firstChild!, 0);
      range.setEnd(block.firstChild!, 4);
      return range;
    };
    const firstRegion = satChoiceAnnotationRegion('option:a');
    const secondRegion = satChoiceAnnotationRegion('option:b');
    const first = captureSatTextRange(root, firstRegion, makeRange(blocks[0]!));
    const second = captureSatTextRange(root, secondRegion, makeRange(blocks[1]!));

    expect(first?.nodeId).toBe('choice.option%3Aa:same-id');
    expect(second?.nodeId).toBe('choice.option%3Ab:same-id');
    expect(first?.nodeId).not.toBe(second?.nodeId);
  });

  it('returns null for a collapsed range, which names no text', () => {
    const root = buildRoot(PROSE);

    expect(captureSatTextRange(root, 'stimulus', rangeWithin(root, 'span', 6, 6))).toBeNull();
  });

  it('returns null when the span crosses two blocks, which is not one anchor', () => {
    const root = buildRoot(
      '<span data-content-text-node="p1">hello</span><span data-content-text-node="p2">brave</span>',
    );
    const [first, second] = Array.from(root.querySelectorAll('span'));
    const range = document.createRange();
    range.setStart(first!.firstChild!, 0);
    range.setEnd(second!.firstChild!, 5);

    expect(captureSatTextRange(root, 'stimulus', range)).toBeNull();
  });

  it('returns null when the span reaches onto a control that is not text', () => {
    const root = buildRoot(
      '<span data-content-text-node="p1">hello <button type="button">world</button></span>',
    );
    const text = root.querySelector('span')!.firstChild as Text;
    const button = root.querySelector('button')!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(button.firstChild!, 5);

    expect(captureSatTextRange(root, 'stimulus', range)).toBeNull();
  });

  it('refuses a span over an annotation control unless the caller allows it', () => {
    const root = buildRoot(
      '<span data-content-text-node="p1">hello <em data-sat-annotation-control="true">brave</em> world</span>',
    );
    const span = root.querySelector('span')!;
    const text = span.firstChild as Text;
    const mark = root.querySelector('em')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(mark, 5);

    expect(captureSatTextRange(root, 'stimulus', range)).toBeNull();
    expect(captureSatTextRange(root, 'stimulus', range, { allowAnnotationControls: true })).not.toBeNull();
  });

  it('returns null when the block is outside the root it was asked about', () => {
    const root = buildRoot(PROSE);
    const stray = buildRoot(PROSE);

    expect(captureSatTextRange(root, 'stimulus', rangeWithin(stray, 'span', 0, 5))).toBeNull();
  });
});

describe('captureSatTextSelection', () => {
  it('produces the same anchor as the range core for the same span', () => {
    const root = buildRoot(PROSE);
    const range = rangeWithin(root, 'span', 6, 11);
    const selection = window.getSelection()!;
    selection.addRange(range);

    expect(captureSatTextSelection(root, 'stimulus', selection)).toEqual(
      captureSatTextRange(root, 'stimulus', range),
    );
  });

  it('returns null for a missing selection and for a collapsed one', () => {
    const root = buildRoot(PROSE);

    expect(captureSatTextSelection(root, 'stimulus', null)).toBeNull();
    expect(captureSatTextSelection(root, 'stimulus', collapsedSelection(root))).toBeNull();
  });

  it('returns null for a selection carrying more than one range, which is not one span', () => {
    const root = buildRoot(PROSE);
    // Built as a shape rather than through `Selection.addRange`: the guard is
    // about a selection that names ONE span, and jsdom's own range bookkeeping
    // is not the subject here.
    const twoRanges = {
      isCollapsed: false,
      rangeCount: 2,
      getRangeAt: () => rangeWithin(root, 'span', 0, 5),
    } as unknown as Selection;

    expect(captureSatTextSelection(root, 'stimulus', twoRanges)).toBeNull();
  });
});
