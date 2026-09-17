import { describe, expect, it } from 'vitest';
import {
  SAT_NOTE_MARKER_LINE_PX,
  clusterSatNoteMarkers,
  satNoteMarkersEqual,
} from '../satNoteMarkers';

/**
 * The margin dots answer "where did I write?" — one dot per line that carries a
 * note, never a stack. These cases pin the two rules that make that readable: a
 * shared line collapses to one dot, and lines stay distinct.
 */
describe('clusterSatNoteMarkers', () => {
  it('keeps one dot per line when two notes share a line', () => {
    const dots = clusterSatNoteMarkers([
      { id: 'a1', top: 40, color: 'yellow' },
      { id: 'a2', top: 42, color: 'blue' },
    ]);
    // The first mark owns the line, deterministically: the same two notes must
    // not swap which one is dotted as the student saves.
    expect(dots).toEqual([{ id: 'a1', top: 40, color: 'yellow' }]);
  });

  it('keeps notes on different lines apart', () => {
    const dots = clusterSatNoteMarkers([
      { id: 'a1', top: 40 },
      { id: 'a2', top: 40 + SAT_NOTE_MARKER_LINE_PX },
    ]);
    expect(dots).toHaveLength(2);
    expect(dots.map((dot) => dot.id)).toEqual(['a1', 'a2']);
  });

  it('measures to whole pixels so a re-measure cannot invent a new line', () => {
    // Sub-pixel layout jitter between two measurements of the same line must not
    // read as two lines and give the student a second dot.
    const dots = clusterSatNoteMarkers([
      { id: 'a1', top: 40.2 },
      { id: 'a2', top: 40.4 },
    ]);
    expect(dots).toEqual([{ id: 'a1', top: 40 }]);
  });

  it('carries no colour for a mark that has none, rather than guessing yellow', () => {
    expect(clusterSatNoteMarkers([{ id: 'a1', top: 10 }])).toEqual([{ id: 'a1', top: 10 }]);
  });

  it('has nothing to say about an empty passage', () => {
    expect(clusterSatNoteMarkers([])).toEqual([]);
  });
});

describe('satNoteMarkersEqual', () => {
  it('treats identical dots as the same dots', () => {
    const dots = [{ id: 'a1', top: 40, color: 'pink' as const }];
    expect(satNoteMarkersEqual(dots, [{ id: 'a1', top: 40, color: 'pink' }])).toBe(true);
  });

  it('notices a moved dot, a different mark, and a different ink', () => {
    const base = [{ id: 'a1', top: 40, color: 'pink' as const }];
    expect(satNoteMarkersEqual(base, [{ id: 'a1', top: 41, color: 'pink' }])).toBe(false);
    expect(satNoteMarkersEqual(base, [{ id: 'a2', top: 40, color: 'pink' }])).toBe(false);
    expect(satNoteMarkersEqual(base, [{ id: 'a1', top: 40, color: 'blue' }])).toBe(false);
    expect(satNoteMarkersEqual(base, [])).toBe(false);
  });
});
