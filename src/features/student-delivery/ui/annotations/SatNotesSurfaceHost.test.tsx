import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SatNotesSurfaceHost } from './SatNotesSurfaceHost';
import { createSatTextAnnotation, type SatTextAnnotation } from '../../domain/satResponses';
import { useSatNotesSurface } from './SatNotesSurfaceContext';
import type { SatNotesUiState } from '../../domain/satNotesUi';
import { SAT_QUESTION_NOTE_EDITOR } from '../../domain/satNotesUi';

function mockWidths({ compact, wide }: { compact: boolean; wide: boolean }) {
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(max-width: 767px)' ? compact : query === '(min-width: 1024px)' ? wide : false,
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

/** A probe standing in for the layout: it can only see what the host handed it. */
function Probe() {
  const surface = useSatNotesSurface();
  return (
    <div
      data-testid="probe"
      data-open={surface.open ? 'true' : 'false'}
      data-placement={surface.placement}
      data-has-column={surface.column ? 'true' : 'false'}
      data-has-rail={surface.rail ? 'true' : 'false'}
      data-has-hint={surface.passageHint ? 'true' : 'false'}
    >
      {/* Same contract as the real layout: it renders what the host handed it. */}
      {surface.column ?? surface.rail}
    </div>
  );
}

function renderHost(
  state: SatNotesUiState,
  overrides: {
    hintVisible?: boolean;
    compact?: boolean;
    wide?: boolean;
    questionKey?: string;
    questionNote?: string;
    annotations?: SatTextAnnotation[];
    notesAvailable?: boolean;
    onSaveQuestionNote?: (note: string) => void;
    onOpenNotes?: () => void;
    onSettleNoteEditor?: () => void;
  } = {},
) {
  const media = mockWidths({ compact: overrides.compact ?? false, wide: overrides.wide ?? true });    const view = render(
    <SatNotesSurfaceHost
      state={state}
      questionKey={overrides.questionKey ?? 'module::0'}
      annotations={overrides.annotations ?? []}
      questionNote={overrides.questionNote ?? ''}
      hasHighlights={false}
      notesAvailable={overrides.notesAvailable ?? true}
      disabled={false}
      hintVisible={overrides.hintVisible ?? false}
      onSelectNote={vi.fn()}
      onChangeNote={vi.fn()}
      onSaveQuestionNote={overrides.onSaveQuestionNote ?? vi.fn()}
      onRemoveNote={vi.fn()}
      onAddQuestionNote={vi.fn()}
      onSettleNoteEditor={overrides.onSettleNoteEditor ?? vi.fn()}
      onOpenNotes={overrides.onOpenNotes ?? vi.fn()}
      onClose={vi.fn()}
    >
      <Probe />
    </SatNotesSurfaceHost>,
  );
  return { ...view, media };
}

const notes = (editorId: string | null = null): SatNotesUiState => ({ kind: 'notes', editorId, activeId: null });

/** A mark the student wrote a note on — the only thing a handle promises. */
function writtenNote(): SatTextAnnotation {
  return {
    ...createSatTextAnnotation({
      kind: 'highlight', nodeId: 'stimulus:p', startOffset: 0, endOffset: 7, exact: 'Several', color: 'yellow',
    }),
    note: 'Check the evidence',
  };
}

/** A highlight with no words behind it: marked, but nothing to come back to. */
function bareMark(): SatTextAnnotation {
  return createSatTextAnnotation({
    kind: 'highlight', nodeId: 'stimulus:p', startOffset: 8, endOffset: 12, exact: 'trees', color: 'pink',
  });
}

/**
 * The host is the one place that decides what the column is and where it goes,
 * then hands both to the layout. These cases pin the single decision, because the
 * duplicate derivation it replaced is what let the placement drift out of sync
 * with the state.
 */
describe('SatNotesSurfaceHost', () => {
  it('offers nothing to the layout while notes are closed', () => {
    const { media, unmount } = renderHost({ kind: 'idle' });
    try {
      const probe = screen.getByTestId('probe');
      expect(probe).toHaveAttribute('data-placement', 'none');
      expect(probe).toHaveAttribute('data-has-column', 'false');
    } finally { unmount(); media.mockRestore(); }
  });

  it('hands the layout a handle where the hidden column stood, so it is visibly reversible', () => {
    const onOpenNotes = vi.fn();
    const { media, unmount } = renderHost({ kind: 'idle' }, { annotations: [writtenNote()], onOpenNotes });
    try {
      const probe = screen.getByTestId('probe');
      expect(probe).toHaveAttribute('data-has-column', 'false');
      expect(probe).toHaveAttribute('data-has-rail', 'true');
      // The handle says what it is and what pressing it does: no decoding a
      // corner chevron to find out a pane can come back.
      const rail = screen.getByRole('button', { name: 'Show notes' });
      expect(rail).toHaveTextContent('Notes');
      fireEvent.click(rail);
      expect(onOpenNotes).toHaveBeenCalledTimes(1);
    } finally { unmount(); media.mockRestore(); }
  });

  it('leaves nothing in the middle until there is a note to come back to', () => {
    // Highlighted but never wrote: no pane, no handle — the exam holds no
    // notes-shaped furniture, and the labeled top-bar entry is the way in.
    const { media, unmount } = renderHost({ kind: 'idle' }, { annotations: [bareMark()], questionNote: '   ' });
    try {
      expect(screen.getByTestId('probe')).toHaveAttribute('data-has-rail', 'false');
      expect(screen.queryByRole('button', { name: 'Show notes' })).not.toBeInTheDocument();
    } finally { unmount(); media.mockRestore(); }

    // One written note is enough: the handle stands as soon as there is something
    // to bring back.
    const written = renderHost({ kind: 'idle' }, { annotations: [], questionNote: 'The theme is control' });
    try {
      expect(screen.getByTestId('probe')).toHaveAttribute('data-has-rail', 'true');
    } finally { written.unmount(); written.media.mockRestore(); }
  });

  it('leaves no handle while the column is open, or where notes cannot open', () => {
    const open = renderHost(notes());
    try {
      expect(screen.getByTestId('probe')).toHaveAttribute('data-has-rail', 'false');
    } finally { open.unmount(); open.media.mockRestore(); }

    // Math: the surface is absent, so a handle would advertise a pane that can
    // never appear.
    const unavailable = renderHost({ kind: 'idle' }, { notesAvailable: false });
    try {
      expect(screen.getByTestId('probe')).toHaveAttribute('data-has-rail', 'false');
      expect(screen.queryByRole('button', { name: 'Show notes' })).not.toBeInTheDocument();
    } finally { unavailable.unmount(); unavailable.media.mockRestore(); }

    // Stacked tiers have no edge to hold a handle on.
    const compact = renderHost({ kind: 'idle' }, { compact: true, wide: false });
    try {
      expect(screen.getByTestId('probe')).toHaveAttribute('data-has-rail', 'false');
    } finally { compact.unmount(); compact.media.mockRestore(); }
  });

  it('hands the column and its placement to the layout together', () => {
    const { media, unmount } = renderHost(notes());
    try {
      const probe = screen.getByTestId('probe');
      expect(probe).toHaveAttribute('data-open', 'true');
      expect(probe).toHaveAttribute('data-placement', 'column');
      expect(probe).toHaveAttribute('data-has-column', 'true');
      expect(screen.getByRole('complementary', { name: 'Notes' })).toBeInTheDocument();
    } finally { unmount(); media.mockRestore(); }
  });

  it('narrows to the two-pane placement on tablet widths', () => {
    const { media, unmount } = renderHost(notes(), { wide: false });
    try {
      expect(screen.getByTestId('probe')).toHaveAttribute('data-placement', 'pair');
      expect(screen.getByRole('complementary', { name: 'Notes' })).toBeInTheDocument();
    } finally { unmount(); media.mockRestore(); }
  });

  it('stacks rather than floating when there is no room for a pane', () => {
    const { media, unmount } = renderHost(notes(), { compact: true, wide: false });
    try {
      expect(screen.getByTestId('probe')).toHaveAttribute('data-placement', 'row');
    } finally { unmount(); media.mockRestore(); }
  });

  it('carries the one-time hint inside the surface it teaches', () => {
    const { media, unmount } = renderHost(notes(), { hintVisible: true });
    try {
      expect(screen.getByTestId('probe')).toHaveAttribute('data-has-hint', 'true');
    } finally { unmount(); media.mockRestore(); }
  });

  it('commits a pending draft to its own question and starts the next one clean', () => {
    // The column is keyed by question: switching questions must not carry the
    // draft across (writing a note onto the wrong question) or drop it (losing
    // what the student typed).
    const onSaveQuestionNote = vi.fn();
    const { media, rerender, unmount } = renderHost(notes(SAT_QUESTION_NOTE_EDITOR), { onSaveQuestionNote });
    try {
      fireEvent.change(screen.getByRole('textbox', { name: 'This question' }), {
        target: { value: 'Half-typed thought' },
      });
      rerender(
        <SatNotesSurfaceHost
          state={notes(SAT_QUESTION_NOTE_EDITOR)}
          questionKey="module::1"
          annotations={[]}
          questionNote=""
          hasHighlights={false}
          notesAvailable
          disabled={false}
          hintVisible={false}
          onSelectNote={vi.fn()}
          onChangeNote={vi.fn()}
          onSaveQuestionNote={onSaveQuestionNote}
          onRemoveNote={vi.fn()}
          onAddQuestionNote={vi.fn()}
          onSettleNoteEditor={vi.fn()}
          onOpenNotes={vi.fn()}
          onClose={vi.fn()}
        >
          <Probe />
        </SatNotesSurfaceHost>,
      );
      expect(onSaveQuestionNote).toHaveBeenCalledWith('Half-typed thought');
      expect(screen.getByRole('textbox', { name: 'This question' })).toHaveValue('');
    } finally { unmount(); media.mockRestore(); }
  });

  it('keeps the column open while a note is being written', () => {
    // The editor is the reason to be open: a state that closed the column while
    // a field was live would take the field with it.
    const { media, unmount } = renderHost(notes(SAT_QUESTION_NOTE_EDITOR));
    try {
      expect(screen.getByTestId('probe')).toHaveAttribute('data-has-column', 'true');
      expect(screen.getByRole('textbox', { name: 'This question' })).toBeInTheDocument();
    } finally { unmount(); media.mockRestore(); }
  });
});
