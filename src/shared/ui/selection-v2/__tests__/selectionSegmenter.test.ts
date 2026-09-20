import { describe, expect, it, vi } from 'vitest';
import {
  createWordSegmentCache,
  defaultGraphemeSegmenter,
  defaultWordSegmenter,
  expandToWordAt,
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
