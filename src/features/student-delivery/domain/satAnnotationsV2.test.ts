import { describe, expect, it } from 'vitest';
import {
  applySatAnnotationsToText,
  applySatHighlightRange,
  applySatUnderlineRange,
  attachSatNoteToAnchor,
  createSatTextAnnotation,
  emptySatAnnotationsV2,
  normalizeSatAnnotations,
  reinsertSatAnnotation,
  removeSatAnnotationById,
  restoreSatAnnotationNote,
  satAnnotatedNotes,
  setSatAnnotationColor,
  SAT_ANNOTATION_NOTE_LIMIT,
  type SatQuestionAnnotations,
} from './satResponses';

/** Inks painted across a block, one entry per segment (null = unmarked). */
function satAnnotationSegments(
  annotations: SatQuestionAnnotations,
  text: string,
  nodeId: string,
): (string | null)[] {
  return applySatAnnotationsToText(text, annotations.annotations, nodeId).map((segment) => segment.highlight);
}

describe('satResponses v2 annotations', () => {
  it('never applies another block’s annotation even when the text is identical', () => {
    const annotation = createSatTextAnnotation({ kind: 'highlight', nodeId: 'passage', startOffset: 0, endOffset: 4, exact: 'tree' });
    expect(applySatAnnotationsToText('tree', [annotation], 'question')).toEqual([{ start: 0, end: 4, highlight: null, underline: false }]);
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
      expect(applySatAnnotationsToText(text, [annotation], 'p')).toEqual([{ start: 0, end: text.length, highlight: null, underline: false }]);
    }
    expect(annotation.anchor.exact).toBe('tree');
  });

  it('uses surrounding context to recover the right occurrence of repeated text', () => {
    const text = 'A tree; the tree grows.';
    const annotation = createSatTextAnnotation({ kind: 'underline', nodeId: 'p', startOffset: 99, endOffset: 103, exact: 'tree', prefix: 'the ', suffix: ' grows.' });
    expect(applySatAnnotationsToText(text, [annotation], 'p').filter((segment) => segment.underline)).toEqual([{ start: 12, end: 16, highlight: null, underline: true }]);
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

  it('treats a missing or unknown highlight color as the default ink instead of dropping the mark', () => {
    const legacy = normalizeSatAnnotations({
      version: 2,
      annotations: [{
        id: 'a1', kind: 'highlight',
        anchor: { nodeId: 'p', startOffset: 0, endOffset: 4, exact: 'tree' },
        createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z',
      }],
    });
    // Absent color stays absent on the wire (yellow by contract) but still paints.
    expect(legacy.annotations[0]?.color).toBeUndefined();
    expect(satAnnotationSegments(legacy, 'tree', 'p')).toEqual(['yellow']);

    const future = normalizeSatAnnotations({
      version: 2,
      annotations: [{
        id: 'a1', kind: 'highlight', color: 'chartreuse',
        anchor: { nodeId: 'p', startOffset: 0, endOffset: 4, exact: 'tree' },
      }],
    });
    // A palette this build does not know about degrades to yellow; it must
    // never cost the student the highlight itself.
    expect(future.annotations[0]?.color).toBeUndefined();
    expect(satAnnotationSegments(future, 'tree', 'p')).toEqual(['yellow']);
  });

  it('recolors a mark in one step and never stacks duplicates on the same anchor', () => {
    const anchor = { nodeId: 'p', startOffset: 0, endOffset: 4, exact: 'tree' };
    const first = applySatHighlightRange(emptySatAnnotationsV2(), anchor, 'blue');
    expect(first.annotations.annotations).toHaveLength(1);
    expect(first.annotations.annotations[0]?.color).toBe('blue');

    const again = applySatHighlightRange(first.annotations, anchor, 'blue');
    expect(again.annotations).toBe(first.annotations);

    const recolored = applySatHighlightRange(first.annotations, anchor, 'pink');
    expect(recolored.annotations.annotations).toHaveLength(1);
    expect(recolored.annotations.annotations[0]?.color).toBe('pink');

    const direct = setSatAnnotationColor(first.annotations, first.annotation.id, 'pink');
    expect(direct.annotations[0]?.color).toBe('pink');
    expect(setSatAnnotationColor(direct, first.annotation.id, 'pink')).toBe(direct);

    // Underline over the same span is a second mark, not a replacement.
    const both = applySatUnderlineRange(first.annotations, anchor);
    expect(both.annotations.annotations.map((a) => a.kind)).toEqual(['highlight', 'underline']);
  });

  it('attaches a note by creating the default-yellow mark it hangs off', () => {
    const anchor = { nodeId: 'p', startOffset: 0, endOffset: 4, exact: 'tree' };
    const note = attachSatNoteToAnchor(emptySatAnnotationsV2(), anchor);
    expect(note.annotation.kind).toBe('highlight');
    expect(note.annotation.color).toBe('yellow');
    expect(satAnnotatedNotes(note.annotations)).toHaveLength(0);
  });

  it('restores an undone removal at its original index', () => {
    const anchor = (start: number) => ({ nodeId: 'p', startOffset: start, endOffset: start + 4, exact: 'tree' });
    const seeded = [
      applySatHighlightRange(emptySatAnnotationsV2(), anchor(0), 'yellow').annotation,
      applySatHighlightRange(emptySatAnnotationsV2(), anchor(10), 'blue').annotation,
    ];
    const base = { ...emptySatAnnotationsV2(), annotations: seeded };
    const removed = removeSatAnnotationById(base, seeded[0]!.id);
    const restored = reinsertSatAnnotation(removed, seeded[0]!, 0);
    expect(restored.annotations.map((a) => a.id)).toEqual(seeded.map((a) => a.id));
    expect(reinsertSatAnnotation(restored, seeded[0]!, 0)).toBe(restored);
  });

  // Removing a note used to be one irreversible press, and a note can hold two
  // thousand characters: the same forgiveness a deleted mark gets now covers it.
  it('restores removed note text onto the mark it belonged to', () => {
    const marked = attachSatNoteToAnchor(emptySatAnnotationsV2(), {
      nodeId: 'p', startOffset: 0, endOffset: 4, exact: 'tree',
    });
    const written: SatQuestionAnnotations = {
      ...marked.annotations,
      annotations: marked.annotations.annotations.map((annotation) => ({ ...annotation, note: 'Cooler here' })),
    };
    const cleared = restoreSatAnnotationNote(written, marked.annotation.id, '');
    // The words go; the ink stays, so the source is never lost with the note.
    expect(cleared.annotations[0]!.note).toBeUndefined();
    expect(cleared.annotations[0]!.color).toBe(marked.annotation.color);

    const restored = restoreSatAnnotationNote(cleared, marked.annotation.id, 'Cooler here');
    expect(restored.annotations[0]!.note).toBe('Cooler here');
    // Nothing to restore is a no-op, not a new empty annotation.
    expect(restoreSatAnnotationNote(restored, 'missing-id', 'text')).toBe(restored);
  });

  it('never restores more text than a note may hold', () => {
    const marked = attachSatNoteToAnchor(emptySatAnnotationsV2(), {
      nodeId: 'p', startOffset: 0, endOffset: 4, exact: 'tree',
    });
    const restored = restoreSatAnnotationNote(marked.annotations, marked.annotation.id, 'x'.repeat(5_000));
    expect(restored.annotations[0]!.note).toHaveLength(SAT_ANNOTATION_NOTE_LIMIT);
  });

  it('paints overlapping highlights with the later annotation’s ink', () => {
    const segments = applySatAnnotationsToText('abcdefghij', [
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 0, endOffset: 6, exact: 'abcdef', color: 'yellow' }),
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 4, endOffset: 10, exact: 'efghij', color: 'blue' }),
    ], 'p');
    expect(segments.map((s) => [s.start, s.end, s.highlight])).toEqual([
      [0, 4, 'yellow'],
      [4, 10, 'blue'],
    ]);
  });

  it('repairs null-like public boundary values to an empty v2 annotation object', () => {
    for (const value of [null, undefined, 'malformed', 42, []]) {
      expect(normalizeSatAnnotations(value as unknown as Record<string, unknown>)).toEqual({
        version: 2,
        annotations: [],
        legacyQuestionNote: '',
      });
    }
  });

  it('splits overlapping highlight and underline ranges into segments', () => {
    const segments = applySatAnnotationsToText('abcdefghij', [
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 2, endOffset: 7, exact: 'cdefg' }),
      createSatTextAnnotation({ kind: 'underline', nodeId: 'p', startOffset: 5, endOffset: 10, exact: 'fghij' }),
    ], 'p');
    expect(segments.map((s) => [s.start, s.end, s.highlight, s.underline])).toEqual([
      [0, 2, null, false],
      [2, 5, 'yellow', false],
      [5, 7, 'yellow', true],
      [7, 10, null, true],
    ]);
  });

  it('merges adjacent segments with identical treatment', () => {
    const segments = applySatAnnotationsToText('abcdef', [
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 0, endOffset: 2, exact: 'ab' }),
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 2, endOffset: 4, exact: 'cd' }),
    ], 'p');
    expect(segments.map((s) => [s.start, s.end, s.highlight])).toEqual([
      [0, 4, 'yellow'],
      [4, 6, null],
    ]);
  });

  it('returns one plain segment for empty or fully-out-of-range annotations', () => {
    expect(applySatAnnotationsToText('abc', [], 'p')).toEqual([{ start: 0, end: 3, highlight: null, underline: false }]);
    expect(applySatAnnotationsToText('', [], 'p')).toEqual([]);
    const segments = applySatAnnotationsToText('abc', [
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'p', startOffset: 99, endOffset: 120, exact: 'z' }),
    ], 'p');
    expect(segments).toEqual([{ start: 0, end: 3, highlight: null, underline: false }]);
  });

  it('keeps emptySatAnnotationsV2 stable and distinct per question', () => {
    const a = emptySatAnnotationsV2();
    const b = emptySatAnnotationsV2();
    expect(a).toEqual({ version: 2, annotations: [], legacyQuestionNote: '' });
    expect(a).not.toBe(b);
    expect(a.annotations).not.toBe(b.annotations);
  });
});

describe('sat annotation removal', () => {
  it('removes a single annotation by id, including one that carries a note', () => {
    const base = emptySatAnnotationsV2();
    const noted = createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 0, endOffset: 7, exact: 'Several', note: 'Check the evidence' });
    const plain = createSatTextAnnotation({ kind: 'underline', nodeId: 'stimulus:p', startOffset: 8, endOffset: 12, exact: 'rese' });
    const seeded = { ...base, annotations: [noted, plain] };
    const next = removeSatAnnotationById(seeded, noted.id);
    expect(next.annotations.map((a) => a.id)).toEqual([plain.id]);
    expect(removeSatAnnotationById(seeded, 'missing-id')).toBe(seeded);
  });
});
