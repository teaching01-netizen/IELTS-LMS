import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWordRangeAt } from '../engine/selectionRange';
import { createSelectionSession, type SelectionSession } from '../engine/selectionSession';
import { createWordSegmentCache, defaultWordSegmenter } from '../domain/selectionSegmenter';

/**
 * Word expansion is the INITIAL CLAIM's answer, and nothing else's.
 *
 * A hold that never travelled leaves both endpoints coincident, and the honest
 * span around that point is the word under the finger — that is what the
 * overlay paints and what a grab then adopts. But a handle being dragged ONTO
 * the opposite endpoint is coincident too, and expanding there snaps the
 * selection back to a whole word the student did not ask for; on a short
 * selection it is visibly unstable. These cases pin the split: the claim path
 * may call `createWordRangeAt`, an adjusting handle may not — at coincidence it
 * keeps the last non-collapsed span until the finger crosses it, and the
 * crossover flips the moving edge exactly as it always has.
 */

vi.mock('../engine/selectionRange', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/selectionRange')>();
  return { ...actual, createWordRangeAt: vi.fn(actual.createWordRangeAt) };
});

function textNode(data: string): Text {
  const paragraph = document.createElement('p');
  paragraph.textContent = data;
  document.body.append(paragraph);
  return paragraph.firstChild as Text;
}

/** A selection claimed by a hold, dragged to offsets 0–11, then released. */
function claimedSelection(node: Text): SelectionSession {
  const session = createSelectionSession({
    segmenter: defaultWordSegmenter(),
    words: createWordSegmentCache(),
  });
  session.press({ pointerId: 1, pointerType: 'touch', x: 0, y: 0, point: { node, offset: 0 } });
  session.hold();
  session.move({ pointerId: 1, x: 11, y: 0, point: { node, offset: 11 } });
  session.release(1);
  expect(session.phase()).toBe('selected');
  return session;
}

beforeEach(() => {
  vi.mocked(createWordRangeAt).mockClear();
  document.body.innerHTML = '';
});

describe('the span of a selection under a handle drag', () => {
  it('word-expands exactly once — on the initial claim — and never again for the same gesture', () => {
    const node = textNode('alpha beta gamma');
    const session = claimedSelection(node);

    // The press arrived with no span at all, so the word under the finger is
    // the only honest answer; the hold and the release re-derive nothing.
    expect(vi.mocked(createWordRangeAt)).toHaveBeenCalledTimes(1);
    expect(session.range()?.toString()).toBe('alpha beta ');
  });

  it('keeps the last non-collapsed span when a handle reaches the fixed endpoint, without re-expanding to a word', () => {
    const node = textNode('alpha beta gamma');
    const session = claimedSelection(node);

    const grabbed = session.grab({ pointerId: 2, edge: 'start', x: 0, y: 0 });
    expect(grabbed).not.toBeNull();
    const adjusting = session.range();
    expect(adjusting?.toString()).toBe('alpha beta ');
    vi.mocked(createWordRangeAt).mockClear();

    // The start handle is dragged back ONTO the fixed end: coincident, but
    // this is an adjustment, not a claim — the span the student could see
    // stands, and no word is expanded around the anchor.
    session.move({ pointerId: 2, x: 11, y: 0, point: { node, offset: 11 } });
    expect(session.range()).toBe(adjusting);
    expect(vi.mocked(createWordRangeAt)).not.toHaveBeenCalled();
    // The loupe keeps pointing at the endpoint the finger owns, not at the
    // anchor it merely reached.
    expect(session.movingEndpoint()?.offset).toBe(0);

    // Crossing the fixed endpoint flips the moving edge, as it always has —
    // and still without any word expansion.
    session.move({ pointerId: 2, x: 16, y: 0, point: { node, offset: 16 } });
    expect(session.phase()).toBe('adjusting-end');
    expect(session.range()?.toString()).toBe('gamma');
    expect(vi.mocked(createWordRangeAt)).not.toHaveBeenCalled();
  });

  it('still takes the word under the finger for the claim path itself', () => {
    const node = textNode('alpha beta gamma');
    const session = createSelectionSession({
      segmenter: defaultWordSegmenter(),
      words: createWordSegmentCache(),
    });

    session.press({ pointerId: 1, pointerType: 'touch', x: 0, y: 0, point: { node, offset: 7 } });
    session.hold();
    session.release(1);

    expect(session.phase()).toBe('selected');
    expect(session.range()?.toString()).toBe('beta');
    expect(vi.mocked(createWordRangeAt)).toHaveBeenCalled();
  });
});
