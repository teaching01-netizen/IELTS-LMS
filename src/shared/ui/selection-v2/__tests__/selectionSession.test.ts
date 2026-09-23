import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWordRangeAt } from '../engine/selectionRange';
import { createSelectionSession, type SelectionSession } from '../engine/selectionSession';
import {
  createWordSegmentCache,
  defaultGraphemeSegmenter,
  defaultWordSegmenter,
} from '../domain/selectionSegmenter';

/**
 * A BODY gesture is spelled in words; a HANDLE is not.
 *
 * The claim adopts the WORD under the finger and keeps its boundaries for the
 * whole gesture, so a finger that drifts inside `beta` keeps showing `beta` and a
 * finger that reaches another word takes that whole word — never the character
 * offset under it. These cases walk the spec's example end to end, in both
 * directions and across the gaps, because the raw-caret version they replace
 * looked correct in every test that started on a word boundary.
 *
 * Precision has not gone anywhere: it is the handle's job, so the last cases
 * prove a partial span is still reachable by dragging one, and that doing so
 * drops the word anchor rather than re-expanding it.
 *
 * Word expansion itself (`createWordRangeAt`) is also counted here: it is the
 * CLAIM's answer and nothing else's — a handle being dragged onto the opposite
 * endpoint is coincident too, and expanding there would snap the selection back
 * to a whole word the student did not ask for.
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

function newSession(activation: 'long-press' | 'drag' = 'long-press'): SelectionSession {
  return createSelectionSession({
    activation,
    segmenter: defaultWordSegmenter(),
    words: createWordSegmentCache(),
    // The platform's own grapheme data: the point of the handle cases below is
    // what ICU says a character IS, not what a code-unit index guesses.
    graphemes: defaultGraphemeSegmenter(),
  });
}

/** Point the finger at one offset of the node and hold until the claim lands. */
function claim(session: SelectionSession, node: Text, offset: number, pointerId = 1): void {
  session.press({ pointerId, pointerType: 'touch', x: 0, y: 0, point: { node, offset } });
  session.hold();
}

/** A finger that has travelled to an offset, on the pointer that owns the claim. */
function dragTo(session: SelectionSession, node: Text, offset: number, pointerId = 1): void {
  session.move({ pointerId, x: offset, y: 0, point: { node, offset } });
}

beforeEach(() => {
  vi.mocked(createWordRangeAt).mockClear();
  document.body.innerHTML = '';
});

describe('a body gesture selects whole words', () => {
  const TEXT = 'alpha beta gamma';

  it('claims the whole word under the press, not the character', () => {
    const node = textNode(TEXT);
    const session = newSession();

    claim(session, node, 7);
    expect(session.range()?.toString()).toBe('beta');

    session.release(1);
    expect(session.phase()).toBe('selected');
    // The committed range is what the product is handed — the word, not the caret.
    expect(session.range()?.toString()).toBe('beta');
  });

  it('keeps that word while the finger moves inside it, in either direction', () => {
    for (const offset of [8, 6, 9, 7]) {
      const node = textNode(TEXT);
      const session = newSession();

      claim(session, node, 7);
      dragTo(session, node, offset);

      // No partial range, no moving opposite edge: `e`, `b`, `eta` are the
      // strings the raw-caret version produced here.
      expect(session.range()?.toString(), `finger still inside beta, at ${offset}`).toBe('beta');
      expect(session.movingEndpoint()).toMatchObject({ offset });
    }
  });

  it('takes the whole preceding word when the finger reaches it', () => {
    const node = textNode(TEXT);
    const session = newSession();

    claim(session, node, 7);
    dragTo(session, node, 2);

    // The fixed side is the CLAIM's end (offset 10), which is why the edge the
    // student can see does not move while the run grows leftwards.
    expect(session.range()?.toString()).toBe('alpha beta');
    expect(session.movingEndpoint()).toMatchObject({ offset: 2 });
  });

  it('takes the whole following word when the finger reaches it', () => {
    const node = textNode(TEXT);
    const session = newSession();

    claim(session, node, 7);
    dragTo(session, node, 12);

    expect(session.range()?.toString()).toBe('beta gamma');
    expect(session.movingEndpoint()).toMatchObject({ offset: 12 });
  });

  it('holds the claim across the gaps on either side of it, and takes the word beyond', () => {
    const node = textNode(TEXT);
    const session = newSession();

    claim(session, node, 7);
    // The space after the claim belongs to it (expandToWordAt's gap rule), so
    // travelling through it changes nothing...
    dragTo(session, node, 10);
    expect(session.range()?.toString()).toBe('beta');
    // ...and the next word joins only once the finger is ON it.
    dragTo(session, node, 11);
    expect(session.range()?.toString()).toBe('beta gamma');

    // The same on the other side: the gap resolves backwards, so the run starts
    // at `alpha` rather than at the space between the two words.
    dragTo(session, node, 5);
    expect(session.range()?.toString()).toBe('alpha beta');
  });

  it('moves around the claim when the finger crosses it, in reading order', () => {
    const node = textNode(TEXT);
    const session = newSession();

    claim(session, node, 7);
    dragTo(session, node, 2);
    expect(session.range()?.toString()).toBe('alpha beta');

    // Back across the claim to the far side: the origin stays `beta`, so the run
    // is `beta gamma` — not an inverted or partial range.
    dragTo(session, node, 12);
    expect(session.range()?.toString()).toBe('beta gamma');

    dragTo(session, node, 2);
    expect(session.range()?.toString()).toBe('alpha beta');
  });

  it('keeps the whole run when the finger lifts, so the product is handed a word', () => {
    const node = textNode(TEXT);
    const session = newSession();

    claim(session, node, 7);
    dragTo(session, node, 12);
    session.release(1);

    expect(session.phase()).toBe('selected');
    expect(session.range()?.toString()).toBe('beta gamma');
  });

  it('selects whole words on an armed surface too, where the drag IS the claim', () => {
    const node = textNode(TEXT);
    const session = newSession('drag');

    // No hold: the tool is armed, so the first travelling move claims the text.
    session.press({ pointerId: 1, pointerType: 'touch', x: 0, y: 0, point: { node, offset: 7 } });
    dragTo(session, node, 12);

    expect(session.phase()).toBe('extending');
    expect(session.range()?.toString()).toBe('beta gamma');
  });

  it('has no word to anchor on in a node without one, and keeps the precise path there', () => {
    const node = textNode('   ');
    const session = newSession();

    // No claim resolves, so there is no anchor to measure against: the gesture
    // falls back to the offsets it travelled over rather than inventing a run
    // out of the surrounding blank space.
    claim(session, node, 1);
    expect(session.range()).toBeNull();

    dragTo(session, node, 3);
    expect(session.range()?.toString()).toBe('  ');
  });
});

/**
 * A drag that leaves the claimed node is STILL a run of whole words.
 *
 * A passage splits its words across inline elements — an annotated `<mark>`, an
 * `<em>` — and a finger that reaches the next paragraph is doing the same thing
 * it was doing a moment earlier. Every case below asserts the run while the
 * finger is down, because the version this replaces only guarded the claimed
 * node: its fall-through read the raw offsets of two different nodes and produced
 * partials at BOTH edges (`eta ga` out of `beta` + `gamma`, `everal researc`
 * across an inline boundary). None of those strings may appear.
 */
describe('a drag across a node boundary keeps the run word-granular', () => {
  it('spans two paragraphs, in both directions, and survives the release', () => {
    const first = textNode('alpha beta');
    const second = textNode('gamma delta');
    const session = newSession();

    claim(session, first, 7);
    expect(session.range()?.toString()).toBe('beta');

    // Into the next paragraph: the claim's WHOLE word, the story's text between,
    // and the whole word the finger reached.
    dragTo(session, second, 2);
    expect(session.range()?.toString()).toBe('betagamma');
    // The opposite edge did not move, and the caret the loupe magnifies is the
    // finger's own position inside the run.
    const live = session.range()!;
    expect(live.startContainer).toBe(first);
    expect(live.startOffset).toBe(6);
    expect(session.movingEndpoint()).toEqual({ node: second, offset: 2 });

    // Deeper into the same paragraph word: still the whole word.
    dragTo(session, second, 4);
    expect(session.range()?.toString()).toBe('betagamma');
    // Into the paragraph's second word: both words whole.
    dragTo(session, second, 7);
    expect(session.range()?.toString()).toBe('betagamma delta');

    // Back across the claim to the other side: the origin stays `beta`.
    dragTo(session, first, 2);
    expect(session.range()?.toString()).toBe('alpha beta');
    expect(session.range()?.startContainer).toBe(first);

    // And the run is what a release leaves resting, not the last caret.
    dragTo(session, second, 7);
    session.release(1);
    expect(session.phase()).toBe('selected');
    expect(session.range()?.toString()).toBe('betagamma delta');
    expect(session.range()?.endContainer).toBe(second);
    expect(session.range()?.endOffset).toBe(11);
  });

  it('spans an inline boundary inside one paragraph', () => {
    const block = document.createElement('p');
    block.innerHTML = 'Several <em>researchers</em> examined the data';
    document.body.append(block);
    // The product's own markup splits the paragraph into three text nodes: the
    // claim is inside the emphasized run, and the neighbour is a SIBLING node.
    const before = block.childNodes[0] as Text;
    const marked = (block.querySelector('em') as Element).firstChild as Text;
    const after = block.childNodes[2] as Text;
    const session = newSession();

    claim(session, marked, 4);
    expect(session.range()?.toString()).toBe('researchers');

    dragTo(session, before, 3);
    expect(session.range()?.toString()).toBe('Several researchers');
    expect(session.range()?.startContainer).toBe(before);
    expect(session.range()?.startOffset).toBe(0);

    // A nudge inside the claimed word changes nothing, exactly as it does when
    // the claim and the finger share a node.
    dragTo(session, marked, 2);
    expect(session.range()?.toString()).toBe('researchers');

    dragTo(session, after, 1);
    expect(session.range()?.toString()).toBe('researchers examined');
    expect(session.range()?.endContainer).toBe(after);
    expect(session.range()?.endOffset).toBe(9);

    session.release(1);
    expect(session.range()?.toString()).toBe('researchers examined');
  });

  it('pulls the loupe caret onto the run when the finger is inside leading whitespace', () => {
    const first = textNode('  alpha');
    const second = textNode('beta gamma');
    const session = newSession();

    claim(session, second, 1);
    dragTo(session, first, 1);
    // The run starts at `alpha`, so a caret at offset 1 of the first node is
    // outside it and is pulled to the run's own start: the magnifier can never
    // describe a character the highlight does not cover.
    expect(session.range()?.toString()).toBe('alphabeta');
    expect(session.range()?.startOffset).toBe(2);
    expect(session.movingEndpoint()).toEqual({ node: first, offset: 2 });
  });

  it('holds the claim through a node with no word in it, then takes the next word', () => {
    const first = textNode('alpha beta');
    const blank = textNode('   ');
    const last = textNode('gamma');
    const session = newSession();

    claim(session, first, 7);
    dragTo(session, blank, 1);
    // No word to take: the claim stands, rather than the gesture falling back to
    // the offsets it travelled over.
    expect(session.range()?.toString()).toBe('beta');

    dragTo(session, last, 2);
    expect(session.range()?.toString()).toBe('beta   gamma');
    expect(session.range()?.endContainer).toBe(last);
    expect(session.range()?.endOffset).toBe(5);
  });
});

/**
 * A handle is precise, and precision is measured in CHARACTERS A STUDENT CAN SEE.
 *
 * Every offset below was observed from the real `Intl.Segmenter`, and each case
 * names the cluster the finger was inside and the cluster boundary the endpoint
 * had to land on. The strings are the ones a passage really contains: a ZWJ family
 * emoji, a flag, a base letter with a combining accent, a Thai syllable with a
 * tone mark, and an emoji with a skin-tone modifier.
 */
describe('a grabbed handle stops on grapheme boundaries', () => {
  /** Claim the word under `claimAt`, then drag `edge` to each offset in turn. */
  function handleDrag(
    text: string,
    claimAt: number,
    edge: 'start' | 'end',
    offsets: number[],
  ): { session: SelectionSession; endpoints: number[]; texts: string[] } {
    const node = textNode(text);
    const session = newSession();
    claim(session, node, claimAt);
    session.release(1);
    session.grab({ pointerId: 2, edge, x: 0, y: 0 });
    const endpoints: number[] = [];
    const texts: string[] = [];
    for (const offset of offsets) {
      dragTo(session, node, offset, 2);
      endpoints.push(session.movingEndpoint()?.offset ?? -1);
      texts.push(session.range()?.toString() ?? '');
    }
    return { session, endpoints, texts };
  }

  it('never stops inside a ZWJ emoji cluster (offsets 2–13 of the family)', () => {
    const { endpoints, texts } = handleDrag('x \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} y', 0, 'end', [4, 7, 9, 12]);

    // 4 and 7 are inside the cluster and nearer its start (2); 9 and 12 are
    // nearer its end (13). No endpoint lands between them — the raw version
    // produced offset 4 and then 7, each cutting the family in half.
    expect(endpoints).toEqual([2, 2, 13, 13]);
    expect(texts).toEqual(['x ', 'x ', 'x \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}', 'x \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}']);
  });

  it('keeps a combining accent with its base letter (offsets 3–5 of `e\u0301`)', () => {
    const { endpoints, texts } = handleDrag('cafe\u0301 bar', 1, 'end', [4, 3]);

    // Offset 4 is the exact middle of `e` + U+0301, so the tie resolves to the
    // earlier boundary — either way the accent is never orphaned.
    expect(endpoints).toEqual([3, 3]);
    expect(texts).toEqual(['caf', 'caf']);
  });

  it('keeps a Thai tone mark with its base (offsets 3–5 of `\u0E01\u0E48`)', () => {
    const { endpoints, texts } = handleDrag('\u0E21\u0E32 \u0E01\u0E48\u0E2D\u0E19 \u0E19\u0E30', 1, 'end', [4, 5]);

    expect(endpoints).toEqual([3, 5]);
    expect(texts).toEqual(['\u0E21\u0E32 ', '\u0E21\u0E32 \u0E01\u0E48']);
  });

  it('moves the START endpoint over a whole flag rather than into it (offsets 1–5)', () => {
    const { endpoints, texts } = handleDrag('a\u{1F1F9}\u{1F1ED}b', 2, 'start', [3, 4]);

    // Grabbing put the finger on offset 0; the move to 3 is the cluster's own
    // midpoint, which resolves back to 1 and collapses the span, so the last
    // non-collapsed span stands. The move to 4 snaps PAST the flag to 5.
    expect(endpoints).toEqual([0, 5]);
    expect(texts).toEqual(['a', '\u{1F1F9}\u{1F1ED}']);
  });

  it('keeps a skin-tone modifier attached to its emoji (offsets 7–11)', () => {
    // The accent also proves the two rules compose: `e\u0301` is ONE cluster, so
    // the claim word is six offsets long, and the modifier is never separated.
    const { endpoints, texts } = handleDrag('e\u0301tude \u{1F44D}\u{1F3FD}', 1, 'end', [8, 10]);

    expect(endpoints).toEqual([7, 11]);
    expect(texts).toEqual(['e\u0301tude ', 'e\u0301tude \u{1F44D}\u{1F3FD}']);
  });

  it('keeps the cluster boundary after the finger lifts', () => {
    const { session, texts } = handleDrag('x \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} y', 0, 'end', [9]);
    session.release(2);

    expect(texts[0]).toBe('x \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}');
    expect(session.range()?.toString()).toBe('x \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}');
  });

  it('leaves the body gesture on words, untouched by the handle rule', () => {
    const node = textNode('x \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} y');
    const session = newSession();

    claim(session, node, 0);
    dragTo(session, node, 4);

    // The finger is inside the emoji and the run is still the claimed WORD: a
    // body gesture is spelled in words, so no partial boundary can appear here.
    expect(session.range()?.toString()).toBe('x');
  });
});

describe('a grabbed handle is still precise', () => {
  it('moves by character, and takes the word anchor with it', () => {
    const node = textNode('alpha beta gamma');
    const session = newSession();

    claim(session, node, 7);
    session.release(1);
    expect(session.range()?.toString()).toBe('beta');

    // Precision mode: the end handle alone moves, INTO the next word — the
    // partial range the body gesture can no longer produce.
    expect(session.grab({ pointerId: 2, edge: 'end', x: 0, y: 0 })).not.toBeNull();
    dragTo(session, node, 12, 2);
    expect(session.phase()).toBe('adjusting-end');
    expect(session.range()?.toString()).toBe('beta g');

    // Released, the partial span stands: the word anchor was dropped by the
    // grab, so nothing re-expands what the student deliberately narrowed.
    session.release(2);
    expect(session.range()?.toString()).toBe('beta g');
  });
});

describe('the claim word-expands exactly once and never again', () => {
  it('expands on the claim and derives every later body move from it', () => {
    const node = textNode('alpha beta gamma');
    const session = newSession();

    claim(session, node, 7);
    // The press resolves the word; the hold, the drag and the release are all
    // measured against that anchor rather than re-asked.
    expect(vi.mocked(createWordRangeAt)).toHaveBeenCalledTimes(1);

    dragTo(session, node, 2);
    dragTo(session, node, 12);
    session.release(1);

    expect(vi.mocked(createWordRangeAt)).toHaveBeenCalledTimes(1);
    expect(session.range()?.toString()).toBe('beta gamma');
  });

  it('keeps the last non-collapsed span when a handle reaches the fixed endpoint, without re-expanding to a word', () => {
    const node = textNode('alpha beta gamma delta');
    const session = newSession();

    // A body claim ('beta') dragged into `gamma`: the run the student can see.
    claim(session, node, 7);
    dragTo(session, node, 12);
    session.release(1);
    expect(session.range()?.toString()).toBe('beta gamma');

    const grabbed = session.grab({ pointerId: 2, edge: 'start', x: 0, y: 0 });
    expect(grabbed).not.toBeNull();
    const adjusting = session.range();
    expect(adjusting?.toString()).toBe('beta gamma');
    vi.mocked(createWordRangeAt).mockClear();

    // The start handle is dragged back ONTO the fixed end: coincident, but this
    // is an adjustment, not a claim — the span the student could see stands, and
    // no word is expanded around the anchor.
    dragTo(session, node, 16, 2);
    expect(session.range()).toBe(adjusting);
    expect(vi.mocked(createWordRangeAt)).not.toHaveBeenCalled();
    // The loupe keeps pointing at the endpoint the finger owns, not at the
    // anchor it merely reached.
    expect(session.movingEndpoint()?.offset).toBe(6);

    // Crossing the fixed endpoint flips the moving edge — and stays precise.
    dragTo(session, node, 20, 2);
    expect(session.phase()).toBe('adjusting-end');
    expect(session.range()?.toString()).toBe(' del');
    expect(vi.mocked(createWordRangeAt)).not.toHaveBeenCalled();
  });
});

/**
 * What a selection's endpoints are SPELLED IN is the machine's own state, not a
 * flag kept beside it (docs/selectionui.md).
 *
 * The distinction is the whole model: a body gesture is word-granular and a
 * handle is grapheme-granular, and the machine decides it in the same transition
 * that decides the phase — a press starts word-granular and a `grab` is the one
 * transition that leaves it. Pinning the TRANSITIONS here, rather than only their
 * effects on a range, is what keeps the state from drifting back into a private
 * boolean: whoever reads `granularity()` gets the same answer the derivation used,
 * and the answer outlives the finger, which is the part a release depends on.
 */
describe('the granularity a selection is spelled in', () => {
  it('is word for a body gesture and grapheme for a handle, including while resting', () => {
    const node = textNode('alpha beta gamma');
    const session = newSession();

    expect(session.granularity(), 'idle: the machine is armed for a body press').toBe('word');

    claim(session, node, 7);
    expect(session.granularity(), 'the claim').toBe('word');
    dragTo(session, node, 12);
    expect(session.granularity(), 'the body drag').toBe('word');
    session.release(1);
    // The finger is up and the release has just re-derived the span from the word
    // anchor — which only a word-granular selection does.
    expect(session.granularity(), 'the body-made resting selection').toBe('word');
    expect(session.range()?.toString()).toBe('beta gamma');

    expect(session.grab({ pointerId: 2, edge: 'end', x: 0, y: 0 }), 'the grab').not.toBeNull();
    expect(session.granularity(), 'a handle makes it precise').toBe('grapheme');
    dragTo(session, node, 15, 2);
    expect(session.range()?.toString(), 'a partial span is the handle’s to make').toBe('beta gamm');

    session.release(2);
    // The one that matters: the span in hand is still the student's own, so the
    // release must NOT re-derive a whole word around it.
    expect(session.granularity(), 'the handle-made resting selection').toBe('grapheme');
    expect(session.range()?.toString()).toBe('beta gamm');

    session.dismiss();
    expect(session.granularity(), 'dismissal hands the machine back to words').toBe('word');
    expect(session.phase()).toBe('idle');
  });
});
