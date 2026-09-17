import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSatTextAnnotation } from '../../domain/satResponses';
import {
  focusSatAnnotationMark,
  focusSatNotesRail,
  focusSatQuestionNoteRow,
  measureSatNoteMarkers,
  scrollSatAnnotationIntoView,
} from './satAnnotationDom';

/**
 * Clicking a note must reveal the text it belongs to — and must move nothing
 * else in the exam while doing it.
 */
function buildPane(annotationId: string, containerTop = 0): { pane: HTMLElement; mark: HTMLElement } {
  const pane = document.createElement('div');
  pane.setAttribute('data-student-exam-scroll-owner', 'true');
  const mark = document.createElement('span');
  mark.setAttribute('data-sat-annotation-id', annotationId);
  // jsdom has no layout: geometry is stubbed so the centring maths is exercised.
  pane.getBoundingClientRect = () => ({ top: containerTop, height: 400 }) as DOMRect;
  Object.defineProperty(pane, 'clientHeight', { value: 400, configurable: true });
  mark.getBoundingClientRect = () => ({ top: containerTop + 600, height: 20 }) as DOMRect;
  pane.scrollTo = vi.fn();
  pane.appendChild(mark);
  document.body.appendChild(pane);
  return { pane, mark };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('scrollSatAnnotationIntoView', () => {
  it('recentres the passage pane on the mark', () => {
    const { pane } = buildPane('a1');
    expect(scrollSatAnnotationIntoView('a1')).toBe(true);
    // 600px down, half of the 400px pane, half of the 20px mark: 600 - 190.
    expect(vi.mocked(pane.scrollTo)).toHaveBeenCalledWith({ top: 410, behavior: 'smooth' });
  });

  it('moves only the pane that owns the mark', () => {
    const { pane } = buildPane('a1');
    const { pane: other } = buildPane('a2', 2_000);
    scrollSatAnnotationIntoView('a1');
    expect(vi.mocked(pane.scrollTo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(other.scrollTo)).not.toHaveBeenCalled();
  });

  it('jumps instead of gliding when the student asked for less motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList);
    const { pane } = buildPane('a1');
    scrollSatAnnotationIntoView('a1');
    // scrollTop assignment, not a smooth scroll.
    expect(vi.mocked(pane.scrollTo)).not.toHaveBeenCalled();
    expect(pane.scrollTop).toBe(410);
  });

  it('reports when there is nothing to scroll to', () => {
    expect(scrollSatAnnotationIntoView('missing')).toBe(false);
  });
});

/**
 * The margin dots are measured from the marks themselves, because where a phrase
 * sits on screen is a fact only the renderer has. These cases pin the two ways
 * this can go wrong: a dot beside a mark nobody wrote about, and a dot parked at
 * the top of the passage because layout had not happened yet.
 */
describe('measureSatNoteMarkers', () => {
  function box(top: number, height: number): DOMRect {
    return { top, height, left: 0, right: 0, bottom: top + height, width: 600, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  }

  function buildRoot(marks: Record<string, number>, rootTop = 0): HTMLElement {
    const root = document.createElement('div');
    root.getBoundingClientRect = () => box(rootTop, 800);
    for (const [id, top] of Object.entries(marks)) {
      const mark = document.createElement('span');
      mark.setAttribute('data-sat-annotation-id', id);
      mark.getBoundingClientRect = () => box(top, 20);
      root.appendChild(mark);
    }
    document.body.appendChild(root);
    return root;
  }

  const at = { kind: 'highlight' as const, nodeId: 'stimulus:p', startOffset: 0, endOffset: 4, exact: 'tree' };
  const noted = (id: string, note = 'Check this') => createSatTextAnnotation({ ...at, id, note });
  const bare = (id: string) => createSatTextAnnotation({ ...at, id });

  it('dots the phrase that has a note and leaves the bare highlight alone', () => {
    const root = buildRoot({ a1: 40, a2: 90 }, 12);
    // Level with the mark's line, in the content box's own coordinates, and in
    // the mark's ink.
    expect(measureSatNoteMarkers(root, [noted('a1'), bare('a2')])).toEqual([
      { id: 'a1', top: 38, color: 'yellow' },
    ]);
  });

  it('treats a whitespace-only note as nothing written', () => {
    const root = buildRoot({ a1: 40 });
    expect(measureSatNoteMarkers(root, [noted('a1', '   ')])).toEqual([]);
  });

  it('collapses two notes on one line to a single dot', () => {
    const root = buildRoot({ a1: 40, a2: 42 });
    expect(measureSatNoteMarkers(root, [noted('a1'), noted('a2')])).toHaveLength(1);
  });

  it('has nothing to dot when the mark has not laid out', () => {
    // jsdom (and a question that has not painted yet) reports zero-height boxes: a
    // dot at the passage's top-left corner would be worse than no dot.
    const root = document.createElement('div');
    const mark = document.createElement('span');
    mark.setAttribute('data-sat-annotation-id', 'a1');
    root.appendChild(mark);
    document.body.appendChild(root);
    expect(measureSatNoteMarkers(root, [noted('a1')])).toEqual([]);
  });

  it('skips a note whose mark is not on screen at all', () => {
    const root = buildRoot({ a1: 40 });
    expect(measureSatNoteMarkers(root, [noted('gone')])).toEqual([]);
  });
});

/**
 * Closing a note is a return, not an exit: the student lands back on the text
 * they were working on. Without these, focus lands on <body> and a keyboard
 * student loses their place in the exam entirely.
 */
describe('note close returns focus', () => {
  it('returns focus to the mark a note was written about', () => {
    const mark = document.createElement('span');
    mark.setAttribute('data-sat-annotation-id', 'a1');
    // What a real mark is: a span in the tab order, so it can take focus back.
    mark.tabIndex = 0;
    document.body.appendChild(mark);
    expect(focusSatAnnotationMark('a1')).toBe(true);
    expect(document.activeElement).toBe(mark);
  });

  it('reports failure for a mark that exists but cannot take focus', () => {
    // Better to tell the caller so it can fall back than to claim a return that
    // left the caret on <body>.
    const mark = document.createElement('span');
    mark.setAttribute('data-sat-annotation-id', 'a1');
    document.body.appendChild(mark);
    expect(focusSatAnnotationMark('a1')).toBe(false);
  });

  it('returns focus to the question’s own note row', () => {
    const row = document.createElement('button');
    row.setAttribute('data-sat-note-card', 'question');
    document.body.appendChild(row);
    expect(focusSatQuestionNoteRow()).toBe(true);
    expect(document.activeElement).toBe(row);
  });

  it('returns focus to the handle a hidden Notes column left behind', () => {
    const rail = document.createElement('button');
    rail.setAttribute('data-sat-notes-rail', 'true');
    document.body.appendChild(rail);
    expect(focusSatNotesRail()).toBe(true);
    expect(document.activeElement).toBe(rail);
  });

  it('reports when there is nothing to return to, so a caller can fall back', () => {
    expect(focusSatAnnotationMark('missing')).toBe(false);
    expect(focusSatQuestionNoteRow()).toBe(false);
    // No handle on this tier (stacked panes, or notes unavailable): the caller
    // falls back to the top-bar entry instead of leaving focus on <body>.
    expect(focusSatNotesRail()).toBe(false);
  });
});
