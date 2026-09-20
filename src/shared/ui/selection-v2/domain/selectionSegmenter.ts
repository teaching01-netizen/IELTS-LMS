/**
 * Word boundaries, from the platform's own ICU data rather than a guess.
 *
 * Word selection is the one part of a touch gesture that a regular expression
 * cannot own. Thai, Lao, Khmer and Chinese do not separate words with spaces,
 * so `/\w+/` reports a whole sentence as one word and a long press selects
 * nothing usable — and Warwick's papers are exactly where that text appears.
 * `Intl.Segmenter` is the only word-boundary authority the platform ships, so
 * it is asked for FIRST and unconditionally; the regex below is a last resort
 * for a runtime that genuinely has no ICU segmenter, not a co-equal path.
 *
 * Segmentation is also the most expensive thing a propagating gesture does —
 * a `pointermove` stream republishes many times a second — so results are
 * memoized per text node and invalidated when that node's data changes.
 */

import type { TextPoint } from './selectionTypes';

/** A half-open run of characters inside one text node. */
export interface WordSegment {
  start: number;
  end: number;
}

/**
 * The slice of `Intl.Segmenter` this module needs, narrowed so a test — or a
 * runtime without ICU data — can supply its own implementation.
 */
export interface WordSegmenter {
  segment: (text: string) => Iterable<{ start: number; end: number; isWordLike?: boolean }>;
}

type NativeSegmenter = {
  segment: (text: string) => Iterable<{ index: number; segment: string; isWordLike?: boolean }>;
};

function segmenterConstructor(): (new (locales?: string, options?: { granularity: string }) => NativeSegmenter) | null {
  const candidate = (Intl as typeof Intl & { Segmenter?: unknown }).Segmenter;
  return typeof candidate === 'function'
    ? (candidate as new (locales?: string, options?: { granularity: string }) => NativeSegmenter)
    : null;
}

/**
 * A word segmenter when the runtime has one, else null.
 *
 * The native segments are TRANSLATED rather than passed through: `Intl` reports
 * `index` plus the matched `segment` string, so reading `start`/`end` off it
 * directly yields `undefined` and every word lookup silently finds nothing —
 * a failure mode that looks exactly like "the platform does not support it",
 * which is why it is worth a wrapper rather than a cast.
 */
export function defaultWordSegmenter(locale?: string | undefined): WordSegmenter | null {
  const Segmenter = segmenterConstructor();
  if (!Segmenter) return null;
  try {
    const native = new Segmenter(locale, { granularity: 'word' });
    return {
      *segment(text: string) {
        for (const part of native.segment(text)) {
          yield {
            start: part.index,
            end: part.index + part.segment.length,
            isWordLike: part.isWordLike ?? false,
          };
        }
      },
    };
  } catch {
    return null;
  }
}

/**
 * Grapheme boundaries, for extending a selection by whole characters.
 *
 * An emoji, a combining mark or a flag is several UTF-16 code units and one
 * thing a student can see; stepping a selection by code unit would let a
 * gesture stop in the middle of a character. `grapheme` is the cheapest
 * granularity `Intl.Segmenter` offers, so it is only built when asked for.
 */
export function defaultGraphemeSegmenter(locale?: string | undefined): WordSegmenter | null {
  const Segmenter = segmenterConstructor();
  if (!Segmenter) return null;
  try {
    const native = new Segmenter(locale, { granularity: 'grapheme' });
    return {
      *segment(text: string) {
        for (const part of native.segment(text)) {
          yield { start: part.index, end: part.index + part.segment.length, isWordLike: true };
        }
      },
    };
  } catch {
    return null;
  }
}

const WORD_CHARACTER = /[\p{L}\p{N}_']/u;

/**
 * Word runs found by unicode word characters, for runtimes without ICU
 * segmentation.
 *
 * Everything outside the letter/number classes is a boundary, so a script that
 * does not space its words is broken at whatever characters happen to fall
 * outside those classes — combining marks included, which is where Thai vowels
 * and tones live. So this cannot find Thai word boundaries at all; it produces
 * plausible-looking runs that are not words. That is precisely why
 * `Intl.Segmenter` is asked for first and unconditionally, and why this is
 * documented as a degraded path rather than a default.
 */
export function fallbackWordSegments(text: string): Array<{ start: number; end: number; isWordLike: boolean }> {
  const segments: Array<{ start: number; end: number; isWordLike: boolean }> = [];
  let index = 0;
  while (index < text.length) {
    const isWord = WORD_CHARACTER.test(text[index]!);
    let end = index;
    while (end < text.length && WORD_CHARACTER.test(text[end]!) === isWord) end += 1;
    segments.push({ start: index, end, isWordLike: isWord });
    index = end;
  }
  return segments;
}

/** The segments of one node's text, or the fallback's when ICU is absent. */
export function wordSegmentsOf(
  text: string,
  segmenter: WordSegmenter | null,
): Array<{ start: number; end: number; isWordLike: boolean }> {
  if (!segmenter) return fallbackWordSegments(text);
  const segments: Array<{ start: number; end: number; isWordLike: boolean }> = [];
  for (const segment of segmenter.segment(text)) {
    segments.push({ start: segment.start, end: segment.end, isWordLike: segment.isWordLike !== false });
  }
  return segments;
}

/**
 * A memo for segmentation by text node.
 *
 * A `pointermove` stream asks for the word under the same node dozens of times
 * per gesture, and ICU segmentation is not free. The cache is keyed on the node
 * and validated against its current `data`, so a re-rendered paragraph (the
 * highlight tool replacing a text node's content, a live region updating) can
 * never be served boundaries that belong to the text it used to hold.
 */
export interface WordSegmentCache {
  segmentsOf: (node: Text, segmenter: WordSegmenter | null) => Array<{ start: number; end: number; isWordLike: boolean }>;
}

export function createWordSegmentCache(): WordSegmentCache {
  const byNode = new WeakMap<Text, { text: string; segments: Array<{ start: number; end: number; isWordLike: boolean }> }>();
  return {
    segmentsOf(node, segmenter) {
      const cached = byNode.get(node);
      if (cached && cached.text === node.data) return cached.segments;
      const segments = wordSegmentsOf(node.data, segmenter);
      byNode.set(node, { text: node.data, segments });
      return segments;
    },
  };
}

/**
 * The word a finger landed on, as offsets into its own text node.
 *
 * Four rules, in order:
 *
 *   1. A press inside a word takes that word.
 *   2. A press in a gap — the space after a word — takes the word it follows,
 *      which is what the platform's own selection does and what a student
 *      pressing beside a word means.
 *   3. A press in the leading gap before any word takes the word that follows.
 *   4. A press on punctuation BETWEEN two words takes the word before it: rule
 *      2 is "the nearest word that has already ended", and punctuation is a
 *      gap, not a word. Only a press with no earlier word at all resolves
 *      forwards.
 *
 * A node with no word in it at all still resolves to nothing rather than to a
 * neighbouring guess; the caller treats "no word" as "no selection".
 */
export function expandToWordAt(
  point: TextPoint,
  segmenter: WordSegmenter | null = defaultWordSegmenter(),
  cache: WordSegmentCache = defaultWordCache,
): WordSegment | null {
  const text = point.node.data;
  if (text.length === 0) return null;
  const offset = Math.max(0, Math.min(text.length, point.offset));
  const segments = cache.segmentsOf(point.node, segmenter);

  for (const segment of segments) {
    if (!segment.isWordLike) continue;
    if (segment.start <= offset && offset < segment.end) return { start: segment.start, end: segment.end };
  }

  // The nearest word that has already ended. Segments arrive in order, so the
  // last one to qualify is the closest.
  let preceding: WordSegment | null = null;
  for (const segment of segments) {
    if (!segment.isWordLike) continue;
    if (segment.end > offset) break;
    preceding = { start: segment.start, end: segment.end };
  }
  if (preceding) return preceding;

  for (const segment of segments) {
    if (!segment.isWordLike) continue;
    if (segment.start >= offset && segment.end > offset) return { start: segment.start, end: segment.end };
  }
  return null;
}

const defaultWordCache = createWordSegmentCache();
