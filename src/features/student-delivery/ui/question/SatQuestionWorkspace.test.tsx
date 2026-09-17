import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSatReadingPreferences } from '../../domain/satReadingPreferences';
import { SatQuestionWorkspace } from './SatQuestionWorkspace';
import { SatNotesSurfaceContext } from '../annotations/SatNotesSurfaceContext';

/**
 * Notes content and its placement are decided by the surface host; this layout
 * only renders the placement it is handed. So these cases hand it one directly —
 * including placements that a viewport of this width would not necessarily
 * produce — which is what proves the layout does not re-derive them.
 */
function withNotes(
  node: React.ReactNode,
  children: React.ReactNode,
  placement: 'none' | 'column' | 'pair' | 'row' = 'column',
  /** The handle a hidden column leaves behind; null when there is none. */
  rail: React.ReactNode = null,
) {
  return (
    <SatNotesSurfaceContext.Provider
      value={{ open: placement !== 'none', placement, column: node, rail, passageHint: <p>Select text</p> }}
    >
      {children}
    </SatNotesSurfaceContext.Provider>
  );
}

/**
 * Count grid tracks, keeping `minmax(0, 1fr)` and `repeat(3, …)` whole: a split
 * on whitespace alone would count the spaces inside those functions as tracks.
 */
function tracks(template: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of template) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current) out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

function mockWidths({ compact, wide }: { compact: boolean; wide: boolean }) {
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(max-width: 767px)' ? compact : query === '(min-width: 1024px)' ? wide : false,
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

describe('notes in the reading layout', () => {
  it('places the column between passage and question when it fits', () => {
    const media = mockWidths({ compact: false, wide: true });
    const { container, unmount } = render(
      withNotes(<div data-testid="notes-content" />, (
        <SatQuestionWorkspace split stimulus={<p>Passage</p>} question={<p>Question</p>}
          readingPreferences={createReading()} onSplitRatioChange={vi.fn()} />
      )),
    );
    try {
      const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
      expect(layout).toHaveAttribute('data-sat-notes-placement', 'column');
      expect(layout.querySelector('[data-sat-notes-row]')).not.toBeInTheDocument();
      // Passage, divider, notes, divider, question: five grid members, so the
      // note column has to be a column and cannot be an overlay.
      expect(tracks(layout.style.gridTemplateColumns)).toHaveLength(5);
      expect(layout.style.gridTemplateColumns).toContain('clamp(280px, 20%, 340px)');
      // The column is a member of that grid, not a layer above it.
      const column = screen.getByTestId('notes-content');
      expect(column.parentElement).toBe(layout);
      // The question stays available while notes are open.
      expect(layout.querySelector('[data-sat-question-scroll]')).toBeInTheDocument();
    } finally { unmount(); media.mockRestore(); }
  });

  it('gives notes the question’s place, not the question’s width, on the middle tier', () => {
    // The placement is handed in, so this asserts the layout obeys the one rule
    // rather than inventing a tier of its own from the viewport.
    const media = mockWidths({ compact: false, wide: true });
    const { container, unmount } = render(
      withNotes(<div data-testid="notes-content" />, (
        <SatQuestionWorkspace split stimulus={<p>Passage</p>} question={<p>Question</p>}
          readingPreferences={createReading()} onSplitRatioChange={vi.fn()} />
      ), 'pair'),
    );
    try {
      const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
      expect(layout).toHaveAttribute('data-sat-notes-placement', 'pair');
      expect(layout.style.gridTemplateColumns).toContain('clamp(280px, 32%, 340px)');
      expect(screen.getByTestId('notes-content').parentElement).toBe(layout);
      // Three members: passage, divider, notes. The question is not squeezed out
      // of view randomly — it is the pane the note column replaced, and closing
      // notes brings it back.
      expect(layout.querySelector('[data-sat-question-scroll]')).not.toBeInTheDocument();
      expect(tracks(layout.style.gridTemplateColumns)).toHaveLength(3);
    } finally { unmount(); media.mockRestore(); }
  });

  it('stacks notes full width beneath both panes when neither fits beside them', () => {
    const media = mockWidths({ compact: true, wide: false });
    const { container, unmount } = render(
      withNotes(<div data-testid="notes-content" />, (
        <SatQuestionWorkspace split stimulus={<p>Passage</p>} question={<p>Question</p>}
          readingPreferences={createReading()} onSplitRatioChange={vi.fn()} />
      ), 'row'),
    );
    try {
      const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
      const row = layout.querySelector<HTMLElement>('[data-sat-notes-row]')!;
      expect(row).toBeInTheDocument();
      // Full width beneath both panes, never floating over them, and the
      // question stays on screen. (Compact has a single column, so spanning is
      // unnecessary there; the span is what keeps the row full-width if a
      // non-compact width ever stacks it.)
      expect(row.style.gridColumn).toBe('');
      expect(layout.querySelector('[data-sat-question-scroll]')).toBeInTheDocument();
      expect(tracks(layout.style.gridTemplateRows)).toHaveLength(1);
    } finally { unmount(); media.mockRestore(); }
  });

  it('spans the stacked row across both panes when the tier still has two columns', () => {
    const media = mockWidths({ compact: false, wide: false });
    const { container, unmount } = render(
      withNotes(<div data-testid="notes-content" />, (
        <SatQuestionWorkspace split stimulus={<p>Passage</p>} question={<p>Question</p>}
          readingPreferences={createReading()} onSplitRatioChange={vi.fn()} />
      ), 'row'),
    );
    try {
      const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
      const row = layout.querySelector<HTMLElement>('[data-sat-notes-row]')!;
      expect(row.style.gridColumn).toBe('1 / -1');
      expect(layout.querySelector('[data-sat-question-scroll]')).toBeInTheDocument();
      expect(tracks(layout.style.gridTemplateRows)).toHaveLength(2);
    } finally { unmount(); media.mockRestore(); }
  });

  it('keeps the column out of the layout when notes are closed', () => {
    const media = mockWidths({ compact: false, wide: true });
    const { container, unmount } = render(
      withNotes(<div data-testid="notes-content" />, (
        <SatQuestionWorkspace split stimulus={<p>Passage</p>} question={<p>Question</p>}
          readingPreferences={createReading()} onSplitRatioChange={vi.fn()} />
      ), 'none'),
    );
    try {
      const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
      expect(layout.querySelector('[data-sat-notes-row]')).not.toBeInTheDocument();
      expect(screen.queryByTestId('notes-content')).not.toBeInTheDocument();
      expect(tracks(layout.style.gridTemplateColumns)).toHaveLength(3);
    } finally { unmount(); media.mockRestore(); }
  });

  it('gives the hidden column’s handle the column’s own seat', () => {
    // Hiding notes swaps the pane for its handle rather than reflowing the exam
    // around a gap: same member, same track, one edge moves — so opening it
    // again comes from exactly where it went.
    const media = mockWidths({ compact: false, wide: true });
    const { container, unmount } = render(
      withNotes(null, (
        <SatQuestionWorkspace split stimulus={<p>Passage</p>} question={<p>Question</p>}
          readingPreferences={createReading()} onSplitRatioChange={vi.fn()} />
      ), 'none', <button type="button" data-testid="notes-rail">Notes</button>),
    );
    try {
      const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
      expect(layout).toHaveAttribute('data-sat-notes-placement', 'none');
      const rail = screen.getByTestId('notes-rail');
      expect(rail.parentElement).toBe(layout);
      expect(tracks(layout.style.gridTemplateColumns)).toHaveLength(5);
      expect(layout.style.gridTemplateColumns).toContain('2.25rem');
      // The question keeps its seat beside the handle, so what is hidden is one
      // pane and not the layout the student had learned.
      expect(layout.querySelector('[data-sat-question-scroll]')).toBeInTheDocument();
    } finally { unmount(); media.mockRestore(); }
  });

  it('renders the teaching line inside the passage, not over the exam', () => {
    const media = mockWidths({ compact: false, wide: true });
    const { container, unmount } = render(
      withNotes(null, (
        <SatQuestionWorkspace split stimulus={<p>Passage</p>} question={<p>Question</p>}
          readingPreferences={createReading()} onSplitRatioChange={vi.fn()} />
      )),
    );
    try {
      const passage = container.querySelector('[data-sat-passage-scroll]')!;
      expect(passage).toHaveTextContent('Select text');
    } finally { unmount(); media.mockRestore(); }
  });
});

function createReading() {
  return createSatReadingPreferences();
}

describe('SAT reading layout', () => {
  it('keeps both panes available on mobile without layout mode controls', () => {
    const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(max-width: 767px)', media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    const { container, unmount } = render(<SatQuestionWorkspace split stimulus={<p>Passage text</p>} question={<p>Question text</p>}
      readingPreferences={createSatReadingPreferences()} onSplitRatioChange={vi.fn()} />);
    try {
      const splitRoot = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
      const passage = container.querySelector<HTMLElement>('[data-sat-passage-scroll]')!;
      const question = container.querySelector<HTMLElement>('[data-sat-question-scroll]')!;
      expect(splitRoot).toHaveClass('min-w-0');
      expect(passage).toHaveClass('min-w-0', 'overflow-y-auto');
      expect(question).toHaveClass('min-w-0', 'overflow-y-auto');
      expect(passage).toHaveAttribute('data-student-exam-scroll-owner');
      expect(question).toHaveAttribute('data-student-exam-scroll-owner');
      expect(passage).toBeVisible();
      expect(question).toBeVisible();
      expect(screen.queryByRole('group', { name: /layout/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Split view' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Passage only' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Question only' })).not.toBeInTheDocument();
      expect(screen.queryByRole('slider', { name: 'Passage and question width' })).not.toBeInTheDocument();
    } finally { unmount(); media.mockRestore(); }
  });
  it('keeps the desktop split divider without layout mode controls', () => {
    const onSplitRatioChange = vi.fn();
    const { container } = render(<SatQuestionWorkspace split stimulus={<p>Passage text</p>} question={<p>Question text</p>}
      readingPreferences={{ ...createSatReadingPreferences(), splitRatio: 0.6 }} onSplitRatioChange={onSplitRatioChange} />);
    const splitRoot = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    const passage = container.querySelector<HTMLElement>('[data-sat-passage-scroll]')!;
    const question = container.querySelector<HTMLElement>('[data-sat-question-scroll]')!;
    expect(splitRoot).toHaveClass('min-w-0');
    expect(passage).toHaveClass('min-w-0', 'overflow-y-auto');
    expect(question).toHaveClass('min-w-0', 'overflow-y-auto');
    expect(passage).toHaveAttribute('data-student-exam-scroll-owner');
    expect(question).toHaveAttribute('data-student-exam-scroll-owner');
    expect(passage).toBeVisible();
    expect(question).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Split view' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Passage only' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Question only' })).not.toBeInTheDocument();
    const divider = screen.getByRole('slider', { name: 'Passage and question width' });
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(onSplitRatioChange).toHaveBeenLastCalledWith(0.62);
  });
});
