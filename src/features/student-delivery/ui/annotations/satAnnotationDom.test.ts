import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  focusSatAnnotationMark,
  focusSatNotesRail,
  focusSatQuestionNoteRow,
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
