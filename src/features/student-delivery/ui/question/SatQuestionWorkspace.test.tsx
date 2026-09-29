import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSatReadingPreferences, type SatReadingTextScale } from '../../domain/satReadingPreferences';
import { SatQuestionWorkspace } from './SatQuestionWorkspace';
import { SatNotesSurfaceContext } from '../annotations/SatNotesSurfaceContext';
import {
  SAT_NOTES_SEAT_GUTTER_PX,
  SAT_READING_NOTES_COLUMN_SEAT_TRACK,
  SAT_READING_NOTES_PAIR_SEAT_TRACK,
} from '../../domain/satReadingLayout';
import { SatReadingLayoutHarness, SAT_TEST_BOX } from '../reading/__tests__/satReadingLayoutHarness';

/**
 * Notes content and its placement are decided by the surface host; this layout
 * only renders the placement it is handed. So these cases hand it one directly —
 * including placements that a workspace of this width would not necessarily
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

function reading(textScale: SatReadingTextScale = 1) {
  return { ...createSatReadingPreferences(), textScale };
}

interface WorkspaceOverrides {
  box?: { width: number; height: number };
  textScale?: SatReadingTextScale;
  split?: boolean;
}

/**
 * The workspace's arrangement is decided by the shared reading layout, so these
 * cases state the box instead of mocking a media query: the same code path the
 * exam uses, with a width a test can reason about.
 */
function renderWorkspace(
  notes: { placement?: 'none' | 'column' | 'pair' | 'row'; column?: React.ReactNode; rail?: React.ReactNode } = {},
  overrides: WorkspaceOverrides = {},
) {
  const preferences = reading(overrides.textScale ?? 1);
  const view = render(
    withNotes(
      notes.column ?? null,
      <SatReadingLayoutHarness
        box={overrides.box ?? SAT_TEST_BOX.tablet}
        preferences={preferences}
        // The harness's stand-in registration speaks for a workspace that is not
        // there; the real one below registers itself with the same answer.
        hasStimulus={overrides.split ?? true}
      >
        <SatQuestionWorkspace split={overrides.split ?? true} stimulus={<p>Passage</p>} question={<p>Question</p>}
          readingPreferences={preferences} onSplitRatioChange={vi.fn()} />
      </SatReadingLayoutHarness>,
      notes.placement ?? 'none',
      notes.rail ?? null,
    ),
  );
  return view;
}

describe('notes in the reading layout', () => {
  it('places the column between passage and question when it fits', () => {
    const { container } = renderWorkspace(
      { placement: 'column', column: <div data-testid="notes-content" /> },
      { box: SAT_TEST_BOX.tablet },
    );
    const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    expect(layout).toHaveAttribute('data-sat-notes-placement', 'column');
    expect(layout.querySelector('[data-sat-notes-row]')).not.toBeInTheDocument();
    // Passage, divider, notes, divider, question: five grid members, so the
    // note column has to be a column and cannot be an overlay.
    expect(tracks(layout.style.gridTemplateColumns)).toHaveLength(5);
    // The SEAT, not the bare band: the track carries the clearance the divider
    // handle beside this pane needs, which is what the resolver measured when it
    // decided the third column fits at all.
    expect(layout.style.gridTemplateColumns).toContain(SAT_READING_NOTES_COLUMN_SEAT_TRACK);
    expect(layout.style.gridTemplateColumns).toContain(
      `+ ${SAT_NOTES_SEAT_GUTTER_PX}px`,
    );
    // The column is a member of that grid, not a layer above it — through one
    // wrapper the layout owns, which is the same wrapper in every placement so
    // that moving the pane never rebuilds it.
    const column = screen.getByTestId('notes-content');
    const slot = layout.querySelector<HTMLElement>('[data-sat-notes-slot]')!;
    expect(column.parentElement).toBe(slot);
    expect(slot.parentElement).toBe(layout);
    // The question stays available while notes are open.
    expect(layout.querySelector('[data-sat-question-scroll]')).toBeInTheDocument();
  });

  it('gives notes the question’s place, not the question’s width, on the middle tier', () => {
    // The placement is handed in, so this asserts the layout obeys the one rule
    // rather than inventing a tier of its own from the workspace width.
    const { container } = renderWorkspace(
      { placement: 'pair', column: <div data-testid="notes-content" /> },
      { box: SAT_TEST_BOX.tablet },
    );
    const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    expect(layout).toHaveAttribute('data-sat-notes-placement', 'pair');
    expect(layout.style.gridTemplateColumns).toContain(SAT_READING_NOTES_PAIR_SEAT_TRACK);
    expect(screen.getByTestId('notes-content').parentElement).toBe(
      layout.querySelector('[data-sat-notes-slot]'),
    );
    // Three members: passage, divider, notes. The question is not squeezed out
    // of view randomly — it is the pane the note column replaced, and closing
    // notes brings it back.
    expect(layout.querySelector('[data-sat-question-scroll]')).not.toBeInTheDocument();
    expect(tracks(layout.style.gridTemplateColumns)).toHaveLength(3);
  });

  it('stacks notes full width beneath both panes when neither fits beside them', () => {
    const { container } = renderWorkspace(
      { placement: 'row', column: <div data-testid="notes-content" /> },
      { box: SAT_TEST_BOX.phone },
    );
    const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    const row = layout.querySelector<HTMLElement>('[data-sat-notes-row]')!;
    expect(row).toBeInTheDocument();
    // Full width beneath both panes, never floating over them, and the
    // question stays on screen. (Stacked panes are a single column, so spanning
    // is unnecessary there; the span is what keeps the row full-width if a
    // two-column layout ever stacks it.)
    expect(row.style.gridColumn).toBe('');
    expect(layout.querySelector('[data-sat-question-scroll]')).toBeInTheDocument();
    expect(tracks(layout.style.gridTemplateRows)).toHaveLength(3);
  });

  it('spans the stacked row across both panes when the tier still has two columns', () => {
    const { container } = renderWorkspace(
      { placement: 'row', column: <div data-testid="notes-content" /> },
      { box: SAT_TEST_BOX.tablet },
    );
    const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    const row = layout.querySelector<HTMLElement>('[data-sat-notes-row]')!;
    expect(row.style.gridColumn).toBe('1 / -1');
    expect(layout.querySelector('[data-sat-question-scroll]')).toBeInTheDocument();
    expect(tracks(layout.style.gridTemplateRows)).toHaveLength(2);
  });

  it('leaves the gutter out where no handle stands beside the pane', () => {
    // A question with no passage has no divider to drag, so the notes pane claims
    // its own band and nothing more: the clearance is the handle's room, and it is
    // reserved exactly where the handle exists.
    const { container } = renderWorkspace(
      { placement: 'column', column: <div data-testid="notes-content" /> },
      { box: SAT_TEST_BOX.tablet, split: false },
    );
    const layout = container.querySelector<HTMLElement>('[data-sat-reading-layout]')!;
    expect(layout).toHaveAttribute('data-sat-reading-layout', 'single');
    expect(layout.style.gridTemplateColumns).toContain('clamp(280px, 20%, 340px)');
    expect(layout.style.gridTemplateColumns).not.toContain('calc(');
  });

  it('keeps the column out of the layout when notes are closed', () => {
    const { container } = renderWorkspace(
      { placement: 'none' },
      { box: SAT_TEST_BOX.tablet },
    );
    const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    expect(layout.querySelector('[data-sat-notes-row]')).not.toBeInTheDocument();
    expect(tracks(layout.style.gridTemplateColumns)).toHaveLength(3);
  });

  it('gives the hidden column’s handle the column’s own seat', () => {
    // Hiding notes swaps the pane for its handle rather than reflowing the exam
    // around a gap: same member, same track, one edge moves — so opening it
    // again comes from exactly where it went.
    const { container } = renderWorkspace(
      { placement: 'none', rail: <button type="button" data-testid="notes-rail">Notes</button> },
      { box: SAT_TEST_BOX.tablet },
    );
    const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    expect(layout).toHaveAttribute('data-sat-notes-placement', 'none');
    const rail = screen.getByTestId('notes-rail');
    const slot = layout.querySelector<HTMLElement>('[data-sat-notes-slot]')!;
    expect(rail.parentElement).toBe(slot);
    expect(slot.parentElement).toBe(layout);
    expect(tracks(layout.style.gridTemplateColumns)).toHaveLength(5);
    expect(layout.style.gridTemplateColumns).toContain('48px');
    // The question keeps its seat beside the handle, so what is hidden is one
    // pane and not the layout the student had learned.
    expect(layout.querySelector('[data-sat-question-scroll]')).toBeInTheDocument();
  });

  it('renders the teaching line inside the passage, not over the exam', () => {
    const { container } = renderWorkspace({ placement: 'none' }, { box: SAT_TEST_BOX.tablet });
    const passage = container.querySelector('[data-sat-passage-scroll]')!;
    expect(passage).toHaveTextContent('Select text');
  });
});

describe('SAT reading layout', () => {
  it('keeps both panes available on a phone, stacked, with no width control', () => {
    // The device name is the test's business, never the product's: all the
    // workspace is told is that 390px is the box it has to work with.
    const { container } = renderWorkspace({}, { box: SAT_TEST_BOX.phone });
    const root = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    const passage = container.querySelector<HTMLElement>('[data-sat-passage-scroll]')!;
    const question = container.querySelector<HTMLElement>('[data-sat-question-scroll]')!;
    expect(root).toHaveAttribute('data-sat-reading-layout', 'stacked');
    expect(root).toHaveAttribute('data-sat-reading-layout-measured', 'true');
    expect(root).toHaveAttribute('data-sat-reading-layout-reason', 'insufficient-pane-width');
    expect(root).toHaveClass('min-w-0');
    expect(passage).toHaveClass('min-w-0', 'overflow-y-auto');
    expect(question).toHaveClass('min-w-0', 'overflow-y-auto');
    expect(passage).toHaveAttribute('data-student-exam-scroll-owner');
    expect(question).toHaveAttribute('data-student-exam-scroll-owner');
    expect(passage).toBeVisible();
    expect(question).toBeVisible();
    // Both panes in one column, one above the other.
    expect(tracks(root.style.gridTemplateColumns)).toHaveLength(1);
    expect(tracks(root.style.gridTemplateRows)).toHaveLength(2);
    // An unusable slider is not merely hidden: it is absent.
    expect(screen.queryByRole('slider', { name: 'Passage and question width' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /layout/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Split view' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Passage only' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Question only' })).not.toBeInTheDocument();
  });

  it('keeps the desktop split divider without layout mode controls', () => {
    const onSplitRatioChange = vi.fn();
    const preferences = { ...createSatReadingPreferences(), splitRatio: 0.6 };
    const { container } = render(
      <SatReadingLayoutHarness box={SAT_TEST_BOX.desktop} preferences={preferences}>
        <SatQuestionWorkspace split stimulus={<p>Passage text</p>} question={<p>Question text</p>}
          readingPreferences={preferences} onSplitRatioChange={onSplitRatioChange} />
      </SatReadingLayoutHarness>,
    );
    const splitRoot = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    const passage = container.querySelector<HTMLElement>('[data-sat-passage-scroll]')!;
    const question = container.querySelector<HTMLElement>('[data-sat-question-scroll]')!;
    expect(splitRoot).toHaveAttribute('data-sat-reading-layout', 'split');
    expect(splitRoot).toHaveAttribute('data-sat-reading-layout-reason', 'readable-split');
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

  it('stacks rather than refusing to show a question a phone cannot split at 200% text', () => {
    const { container } = renderWorkspace({}, { box: SAT_TEST_BOX.tablet, textScale: 2 });
    const root = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    // 1024px in two panes is 511px each; 200% text needs 720px before a pane is
    // worth reading, so the panes stack instead of shrinking the type.
    expect(root).toHaveAttribute('data-sat-reading-layout', 'stacked');
    expect(screen.queryByRole('slider', { name: 'Passage and question width' })).not.toBeInTheDocument();
  });

  it('keeps the same passage and question elements across split ↔ stacked', () => {
    // The reflow must change grid placement, never component identity: an
    // answer, a mark, a draft note, and a scroll position all live inside these
    // two nodes.
    const preferences = createSatReadingPreferences();
    const view = render(
      <SatReadingLayoutHarness box={SAT_TEST_BOX.tablet} preferences={preferences}>
        <SatQuestionWorkspace split stimulus={<p>Passage</p>} question={<p>Question</p>}
          readingPreferences={preferences} onSplitRatioChange={vi.fn()} />
      </SatReadingLayoutHarness>,
    );
    const passageBefore = view.container.querySelector('[data-sat-passage-scroll]');
    const questionBefore = view.container.querySelector('[data-sat-question-scroll]');
    expect(view.container.querySelector('[data-sat-reading-split]')).toHaveAttribute('data-sat-reading-layout', 'split');

    view.rerender(
      <SatReadingLayoutHarness box={SAT_TEST_BOX.phone} preferences={preferences}>
        <SatQuestionWorkspace split stimulus={<p>Passage</p>} question={<p>Question</p>}
          readingPreferences={preferences} onSplitRatioChange={vi.fn()} />
      </SatReadingLayoutHarness>,
    );
    const root = view.container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    expect(root).toHaveAttribute('data-sat-reading-layout', 'stacked');
    expect(view.container.querySelector('[data-sat-passage-scroll]')).toBe(passageBefore);
    expect(view.container.querySelector('[data-sat-question-scroll]')).toBe(questionBefore);
  });

  it('shows a single pane, with no divider, for a question with no stimulus', () => {
    const { container } = renderWorkspace({}, { box: SAT_TEST_BOX.desktop, split: false });
    const root = container.querySelector<HTMLElement>('[data-sat-reading-layout]')!;
    expect(root).toHaveAttribute('data-sat-reading-layout', 'single');
    expect(root).toHaveAttribute('data-sat-reading-layout-reason', 'single-question');
    expect(container.querySelector('[data-sat-passage-scroll]')).toBeNull();
    expect(container.querySelector('[data-sat-question-scroll]')).not.toBeNull();
    expect(screen.queryByRole('slider', { name: 'Passage and question width' })).not.toBeInTheDocument();
  });
});

/**
 * The workspace is the surface the student reads in, so it is also the surface
 * that has to keep the reading inside itself: neither the exam's frame nor the
 * panes may be widened by the text they hold. Both halves of that live here
 * rather than in a media query, because it is the layout — not the viewport —
 * that decides how much room a pane has.
 */
describe('the reading surface keeps its text inside itself', () => {
  const css = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');

  it('owns the wrap rule unconditionally, and by min-content', () => {
    // `anywhere`, not `break-word`: only `anywhere` also lowers min-content
    // width, so one long token cannot inflate a pane before wrapping is
    // considered. Unconditional, because the panes' readability is not a
    // consequence of screen zoom.
    expect(css).toContain('.sat-reading-surface {\n  overflow-wrap: anywhere;\n}');
    expect(css).not.toContain('[data-sat-screen-zoom] .sat-reading-surface');
  });

  it('holds the overflow at both workspace roots, so a pane scrolls locally', () => {
    for (const note of ['single', 'split-and-stacked'] as const) {
      const { container, unmount } = renderWorkspace(
        {},
        note === 'single' ? { box: SAT_TEST_BOX.desktop, split: false } : { box: SAT_TEST_BOX.tablet },
      );
      const root = container.querySelector<HTMLElement>('[data-sat-reading-layout]')!;
      expect(root.className).toContain('sat-reading-surface');
      expect(root.className).toContain('min-w-0');
      expect(root.className).toContain('overflow-hidden');
      // Every pane is a shrinkable grid member: `min-w-0` is what lets a pane
      // give width back instead of forcing the workspace wider.
      for (const pane of container.querySelectorAll<HTMLElement>(
        '[data-sat-passage-scroll], [data-sat-question-scroll]',
      )) {
        expect(pane.className, note).toContain('min-w-0');
      }
      unmount();
    }
  });

  it('leaves two-dimensional content its own line breaking, and its own scrolling', () => {
    // The prose rule is a last resort for prose; a code block or an expression is
    // a shape, and breaking a token inside it destroys the thing being read. Each
    // keeps its own wrapping and scrolls in its own surface instead — which is
    // why the exemption can exist at all without the exam scrolling sideways.
    expect(css).toContain(
      '.sat-reading-surface :is(pre, code, [role="math"], math-field) {\n  overflow-wrap: normal;\n}',
    );
    const renderer = readFileSync(
      resolve(__dirname, '../../../exam-rendering/RichStructuredContentRenderer.tsx'),
      'utf8',
    );
    expect(renderer).toContain('[&_pre]:overflow-x-auto');
    // Display math is the equation's own scrolling surface; the exemption is what
    // stops the prose rule from breaking the expression inside it.
    expect(renderer).toContain('my-4 block overflow-x-auto text-center');
  });
});

/**
 * Text size is a reading preference, not a browser zoom.
 *
 * The rule the student's choice follows: it makes the passage, the question, the
 * answers and their notes bigger, and it does not resize the exam around them —
 * not the figures, not the chrome, not the layout the resolver measured. All of
 * that hangs off how the scale token is allowed to be used, so that is what these
 * cases pin: one custom property, multiplied into font sizes and nothing else.
 */
describe('Text size scales reading content and nothing else', () => {
  const css = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');
  const renderer = readFileSync(
    resolve(__dirname, '../../../exam-rendering/RichStructuredContentRenderer.tsx'),
    'utf8',
  );

  it('multiplies the scale into font sizes only', () => {
    const uses = css
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('var(--sat-reading-scale)'));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line, line).toMatch(/^font-size: calc\(/);
    }
  });

  it('never sizes a figure with the text', () => {
    // A figure is inspected with the image tools, not enlarged by the note beside
    // it: its own box stays constrained and nothing here reads the text scale.
    expect(renderer).toContain('max-w-full');
    expect(renderer).not.toContain('--sat-reading-scale');
  });

  it('scales the surfaces that hold reading copy', () => {
    for (const className of ['.sat-type-body', '.sat-reading-copy']) {
      expect(css, className).toContain(`.sat-reading-surface ${className} {`);
    }
  });
});
