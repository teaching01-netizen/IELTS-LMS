import { describe, expect, it, vi } from 'vitest';
import {
  createWordSegmentCache,
  defaultGraphemeSegmenter,
  defaultWordSegmenter,
  expandToWordAt,
  resolveWordDragSpan,
  snapToGraphemeBoundary,
  wordSegmentsOf,
  type WordSegmenter,
} from '../domain/selectionSegmenter';
import type { TextPoint } from '../domain/selectionTypes';

/** The real platform segmenter: ICU data is the point of this module. */
const icu = defaultWordSegmenter();

function nodeOf(data: string): Text {
  return document.createTextNode(data);
}

function wordAt(data: string, offset: number, segmenter: WordSegmenter | null = icu) {
  const node = nodeOf(data);
  const word = expandToWordAt({ node, offset }, segmenter, createWordSegmentCache());
  return word ? data.slice(word.start, word.end) : null;
}

/** Offset of the first character of `needle`, which is where a press lands. */
function inside(data: string, needle: string): number {
  const at = data.indexOf(needle);
  if (at < 0) throw new Error(`${needle} not in ${data}`);
  return at;
}

describe('English', () => {
  it('takes the word a finger lands inside', () => {
    expect(wordAt('the quick brown fox', 5)).toBe('quick');
  });

  it('takes the word before a press that lands in the gap after it', () => {
    expect(wordAt('the quick brown fox', inside('the quick brown fox', 'the ') + 3)).toBe('the');
  });

  it('takes the following word when nothing precedes the press', () => {
    expect(wordAt('   leading', 2)).toBe('leading');
  });

  it('keeps a contraction whole', () => {
    expect(wordAt("don't stop", 3)).toBe("don't");
  });

  it('keeps a number whole', () => {
    expect(wordAt('1984 was', 2)).toBe('1984');
  });

  it('resolves nothing when the node holds no word at all', () => {
    expect(wordAt('   ', 1)).toBeNull();
  });
});

describe('scripts without spaces between words', () => {
  /**
   * These assertions are deliberately structural rather than fixed to ICU's
   * chosen boundaries. Which break ICU picks for Thai is a dictionary decision
   * that changes between ICU versions; that it CAN break the run at all is the
   * capability under test, and it is exactly what a whitespace regex cannot do.
   */
  it('breaks a Thai run into words shorter than the sentence', () => {
    const thai = 'นักเรียนกำลังอ่านหนังสือ';
    const word = wordAt(thai, 3);
    expect(word).not.toBeNull();
    expect(word!.length).toBeGreaterThan(0);
    expect(word!.length).toBeLessThan(thai.length);
    expect(thai.includes(word!)).toBe(true);
  });

  it('breaks a Chinese run into words shorter than the sentence', () => {
    const chinese = '我昨天去图书馆看书了';
    const word = wordAt(chinese, 2);
    expect(word).not.toBeNull();
    expect(word!.length).toBeLessThan(chinese.length);
  });

  it('breaks a Japanese run into words rather than one long segment', () => {
    const japanese = 'きょうはとてもいい天気ですね';
    const word = wordAt(japanese, 3);
    expect(word).not.toBeNull();
    expect(word!.length).toBeLessThan(japanese.length);
  });

  it('degrades without ICU to the runs between the characters it can recognize', () => {
    const thai = 'นักเรียนกำลังอ่านหนังสือ';
    const withoutIcu = wordAt(thai, 3, null);

    expect(withoutIcu).not.toBeNull();
    expect(thai).toContain(withoutIcu!);
    // A run that stops at a combining mark is not a word boundary: the same
    // press through ICU gets the dictionary word instead. This is the degraded
    // path, and the reason the real segmenter is asked for first.
    expect(wordAt(thai, 3)).not.toBe(withoutIcu);
  });
});

describe('mixed and directional text', () => {
  it('selects the English word inside mixed Thai and English text', () => {
    const mixed = 'อ่าน passage นี้';
    expect(wordAt(mixed, inside(mixed, 'passage') + 2)).toBe('passage');
  });

  it('selects an Arabic word inside an RTL sentence', () => {
    const arabic = 'الطالب يقرأ الكتاب';
    const word = wordAt(arabic, 9);
    expect(word).not.toBeNull();
    expect(word).not.toContain(' ');
  });

  it('never returns a selection that splits an emoji in half', () => {
    // Whether ICU reports a lone pictograph as word-like is a version-dependent
    // detail; that a press inside it can never produce half a surrogate pair is
    // the invariant the student depends on.
    const text = 'ship 🚀 now';
    const node = nodeOf(text);
    const word = expandToWordAt({ node, offset: text.indexOf('🚀') + 1 }, icu, createWordSegmentCache());

    expect(word).not.toBeNull();
    const selected = text.slice(word!.start, word!.end);
    expect(['ship', '🚀']).toContain(selected);
    expect(/[\uD800-\uDBFF]$/.test(selected)).toBe(false);
  });

  it('treats punctuation between two words as the earlier word', () => {
    expect(wordAt('alpha, beta', 5)).toBe('alpha');
  });
});

describe('the fallback path', () => {
  it('segments space-separated scripts correctly without ICU', () => {
    const segments = wordSegmentsOf('hello world', null);
    expect(segments.filter((segment) => segment.isWordLike).map((segment) => [segment.start, segment.end])).toEqual([
      [0, 5],
      [6, 11],
    ]);
  });

  it('is only reached when the runtime has no Segmenter at all', () => {
    const original = (Intl as { Segmenter?: unknown }).Segmenter;
    try {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
      expect(defaultWordSegmenter()).toBeNull();
      expect(wordAt('hello world', 8)).toBe('world');
    } finally {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: original });
    }
    expect(icu).not.toBeNull();
  });
});

describe('grapheme granularity', () => {
  it('treats an emoji built from several code units as one character', () => {
    const segmenter = defaultGraphemeSegmenter();
    if (!segmenter) return;
    const segments = [...segmenter.segment('👍🏽')];
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: 0, end: '👍🏽'.length });
  });
});

/**
 * Where a handle's endpoint is allowed to stop. Observed offsets against the real
 * `Intl.Segmenter`: every expectation below is a cluster boundary of the string in
 * the case's own name.
 */
describe('snapToGraphemeBoundary', () => {
  function snap(text: string, offset: number): number {
    const node = nodeOf(text);
    return snapToGraphemeBoundary({ node, offset }, defaultGraphemeSegmenter(), createWordSegmentCache()).offset;
  }

  it('leaves an offset that is already a boundary alone', () => {
    // 2 and 13 are the family cluster's own edges.
    const family = 'x \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} y';
    expect(snap(family, 2)).toBe(2);
    expect(snap(family, 13)).toBe(13);
    expect(snap(family, 0)).toBe(0);
    expect(snap(family, family.length)).toBe(family.length);
  });

  it('moves an offset inside a cluster to the nearer edge', () => {
    const family = 'x \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} y';
    expect(snap(family, 4)).toBe(2);
    expect(snap(family, 7)).toBe(2);
    expect(snap(family, 9)).toBe(13);
    expect(snap(family, 12)).toBe(13);
  });

  it('resolves a cluster\u2019s exact middle to its earlier edge, whatever came before', () => {
    // `e` + U+0301 spans 3\u20135, and a Thai syllable with a tone mark spans the same
    // two offsets: both are ties, and both resolve the same way.
    expect(snap('cafe\u0301 bar', 4)).toBe(3);
    expect(snap('\u0E21\u0E32 \u0E01\u0E48\u0E2D\u0E19', 4)).toBe(3);
  });

  it('clamps an offset outside the node before snapping', () => {
    expect(snap('a\u{1F1F9}\u{1F1ED}b', 99)).toBe(6);
    expect(snap('a\u{1F1F9}\u{1F1ED}b', -4)).toBe(0);
  });

  it('degrades to the raw offset when the platform has no segmenter', () => {
    const node = nodeOf('x \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} y');

    expect(snapToGraphemeBoundary({ node, offset: 7 }, null, createWordSegmentCache())).toEqual({ node, offset: 7 });
  });

  it('costs one segmentation per node across a whole handle drag', () => {
    const node = nodeOf('x \u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} y');
    const spy = vi.fn(defaultGraphemeSegmenter()!.segment);
    const cache = createWordSegmentCache();

    for (let offset = 0; offset < 10; offset += 1) {
      snapToGraphemeBoundary({ node, offset }, { segment: spy }, cache);
    }

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('the segmentation memo', () => {
  it('segments a node once while its text is unchanged', () => {
    const spy = vi.fn((text: string) => {
      void text;
      return [{ start: 0, end: 5, isWordLike: true }][Symbol.iterator]();
    });
    const segmenter: WordSegmenter = { segment: spy };
    const cache = createWordSegmentCache();
    const node = nodeOf('alpha beta');

    cache.segmentsOf(node, segmenter);
    cache.segmentsOf(node, segmenter);
    cache.segmentsOf(node, segmenter);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-segments when the node text has changed under it', () => {
    const cache = createWordSegmentCache();
    const node = nodeOf('alpha beta');

    cache.segmentsOf(node, icu);
    node.data = 'gamma';
    const segments = cache.segmentsOf(node, icu);

    expect(segments.filter((segment) => segment.isWordLike).map((segment) => segment.end)).toEqual([5]);
  });

  it('serves the offsets a press needs through the memo as well', () => {
    const cache = createWordSegmentCache();
    const node = nodeOf('alpha beta');
    const point: TextPoint = { node, offset: 8 };

    expect(expandToWordAt(point, icu, cache)).toEqual({ start: 6, end: 10 });
  });
});

/**
 * The run a body-touch drag means, from the word it claimed and the word under
 * the finger. `beta` in `alpha beta gamma` is the spec's own example.
 */
describe('resolveWordDragSpan', () => {
  const beta = { start: 6, end: 10 };
  const wordAt = (data: string, offset: number) => {
    const node = nodeOf(data);
    return expandToWordAt({ node, offset }, icu, createWordSegmentCache());
  };

  it('holds the claimed word while the finger is still inside it', () => {
    const text = 'alpha beta gamma';
    for (const needle of ['b', 'e', 't', 'a']) {
      const result = resolveWordDragSpan(beta, wordAt(text, inside(text, 'beta') + inside('beta', needle)));
      expect(result, `inside ${needle}`).toEqual({ span: beta, side: 'unchanged' });
    }
  });

  it('holds the claimed word in the gaps on either side of it', () => {
    const text = 'alpha beta gamma';
    // The space after the claim resolves backwards to the claim itself, so the
    // run cannot shrink or flicker while the finger crosses it.
    expect(resolveWordDragSpan(beta, wordAt(text, 10))).toEqual({ span: beta, side: 'unchanged' });
  });

  it('runs to a word before the claim without moving the claim\u2019s far edge', () => {
    expect(resolveWordDragSpan(beta, { start: 0, end: 5 })).toEqual({
      span: { start: 0, end: 10 },
      side: 'before',
    });
  });

  it('runs to a word after the claim without moving the claim\u2019s near edge', () => {
    expect(resolveWordDragSpan(beta, { start: 11, end: 16 })).toEqual({
      span: { start: 6, end: 16 },
      side: 'after',
    });
  });

  it('crosses several words at once without partial ends', () => {
    expect(resolveWordDragSpan({ start: 11, end: 16 }, { start: 0, end: 5 }).span).toEqual({ start: 0, end: 16 });
    expect(resolveWordDragSpan({ start: 0, end: 5 }, { start: 17, end: 21 }).span).toEqual({ start: 0, end: 21 });
  });

  it('keeps the claim in reading order when the finger is on the far side of it', () => {
    const target = { start: 0, end: 5 };
    expect(resolveWordDragSpan(beta, target).side).toBe('before');
    expect(resolveWordDragSpan(beta, target).span.start).toBeLessThan(resolveWordDragSpan(beta, target).span.end);
  });

  it('keeps the claim when there is no word under the finger at all', () => {
    expect(resolveWordDragSpan(beta, null)).toEqual({ span: beta, side: 'unchanged' });
  });
});
