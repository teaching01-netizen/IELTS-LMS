import { describe, expect, it } from 'vitest';
import {
  applySatAnnotationsToText,
  createSatTextAnnotation,
  emptySatAnnotationsV2,
  normalizeSatAnnotations,
} from './satResponses';

describe('satResponses v2 annotations', () => {
  it('never applies another block’s annotation even when the text is identical', () => {
    const annotation = createSatTextAnnotation({ kind: 'highlight', nodeId: 'passage', startOffset: 0, endOffset: 4, exact: 'tree' });
    expect(applySatAnnotationsToText('tree', [annotation], 'question')).toEqual([{ start: 0, end: 4, highlight: false, underline: false }]);
  });
  it('recovers a highlight after text is inserted before its anchor', () => {
    const annotation = createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 4, endOffset: 8, exact: 'tree', prefix: 'The ', suffix: ' grows.' });
    const text = 'Today: The tree grows.';
    const segments = applySatAnnotationsToText(text, [annotation], 'p');
    expect(segments.filter((segment) => segment.highlight).map((segment) => text.slice(segment.start, segment.end))).toEqual(['tree']);
    expect(annotation.anchor.startOffset).toBe(4);
  });

  it('leaves missing or ambiguous recovered text undecorated without deleting the annotation', () => {
    const annotation = createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 99, endOffset: 103, exact: 'tree' });
    for (const text of ['A tree and another tree.', 'A flower grows.']) {
      expect(applySatAnnotationsToText(text, [annotation], 'p')).toEqual([{ start: 0, end: text.length, highlight: false, underline: false }]);
    }
    expect(annotation.anchor.exact).toBe('tree');
  });

  it('uses surrounding context to recover the right occurrence of repeated text', () => {
    const text = 'A tree; the tree grows.';
    const annotation = createSatTextAnnotation({ kind: 'underline', nodeId: 'p', startOffset: 99, endOffset: 103, exact: 'tree', prefix: 'the ', suffix: ' grows.' });
    expect(applySatAnnotationsToText(text, [annotation], 'p').filter((segment) => segment.underline)).toEqual([{ start: 12, end: 16, highlight: false, underline: true }]);
  });
  it('migrates a v1 freeform note into legacyQuestionNote without data loss', () => {
    expect(normalizeSatAnnotations({ version: 1, note: 'important' })).toEqual({
      version: 2,
      annotations: [],
      legacyQuestionNote: 'important',
    });
    expect(normalizeSatAnnotations({ version: 1, note: '' })).toEqual({
      version: 2,
      annotations: [],
      legacyQuestionNote: '',
    });
  });

  it('round-trips v2 annotations and drops malformed entries', () => {
    const created = createSatTextAnnotation({
      kind: 'highlight',
      nodeId: 'p-1',
      startOffset: 2,
      endOffset: 7,
      exact: 'hello',
    });
    expect(created.kind).toBe('highlight');
    expect(created.anchor.nodeId).toBe('p-1');
    const normalized = normalizeSatAnnotations({
      version: 2,
      annotations: [created, { kind: 'nope' }, null],
    });
    expect(normalized.version).toBe(2);
    expect(normalized.annotations).toHaveLength(1);
    expect(normalized.annotations[0]?.id).toBe(created.id);
  });

  it('splits overlapping highlight and underline ranges into segments', () => {
    const segments = applySatAnnotationsToText('abcdefghij', [
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 2, endOffset: 7, exact: 'cdefg' }),
      createSatTextAnnotation({ kind: 'underline', nodeId: 'p', startOffset: 5, endOffset: 10, exact: 'fghij' }),
    ], 'p');
    expect(segments.map((s) => [s.start, s.end, s.highlight, s.underline])).toEqual([
      [0, 2, false, false],
      [2, 5, true, false],
      [5, 7, true, true],
      [7, 10, false, true],
    ]);
  });

  it('merges adjacent segments with identical treatment', () => {
    const segments = applySatAnnotationsToText('abcdef', [
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 0, endOffset: 2, exact: 'ab' }),
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 2, endOffset: 4, exact: 'cd' }),
    ], 'p');
    expect(segments.map((s) => [s.start, s.end, s.highlight])).toEqual([
      [0, 4, true],
      [4, 6, false],
    ]);
  });

  it('returns one plain segment for empty or fully-out-of-range annotations', () => {
    expect(applySatAnnotationsToText('abc', [], 'p')).toEqual([{ start: 0, end: 3, highlight: false, underline: false }]);
    expect(applySatAnnotationsToText('', [], 'p')).toEqual([]);
    const segments = applySatAnnotationsToText('abc', [
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 99, endOffset: 120, exact: 'z' }),
    ], 'p');
    expect(segments).toEqual([{ start: 0, end: 3, highlight: false, underline: false }]);
  });

  it('keeps emptySatAnnotationsV2 stable and distinct per question', () => {
    const a = emptySatAnnotationsV2();
    const b = emptySatAnnotationsV2();
    expect(a).toEqual({ version: 2, annotations: [], legacyQuestionNote: '' });
    expect(a).not.toBe(b);
    expect(a.annotations).not.toBe(b.annotations);
  });
});
