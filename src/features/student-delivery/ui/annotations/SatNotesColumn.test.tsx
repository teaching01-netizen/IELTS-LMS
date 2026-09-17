import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SatNotesColumn } from './SatNotesColumn';
import { createSatTextAnnotation } from '../../domain/satResponses';
import type { SatTextAnnotation } from '../../domain/satResponses';
import { SAT_QUESTION_NOTE_EDITOR } from '../../domain/satNotesUi';

/**
 * The Notes column is where the feature's mental model is either obvious or
 * lost, so these tests pin the things that make it obvious: one list, quoted
 * sources, no Save button, no scrim, and nothing on screen that contradicts
 * the state the student is in.
 */
function note(overrides: Partial<SatTextAnnotation> = {}): SatTextAnnotation {
  return {
    ...createSatTextAnnotation({
      kind: 'highlight',
      nodeId: 'stimulus:p',
      startOffset: 0,
      endOffset: 7,
      exact: 'Several',
      color: 'blue',
    }),
    note: 'Check the evidence',
    ...overrides,
  };
}

/** The column reads one state; these helpers spell the states out by name. */
function notesState(editorId: string | null = null, activeId: string | null = null) {
  return { kind: 'notes' as const, editorId, activeId };
}

function renderColumn(overrides: Partial<React.ComponentProps<typeof SatNotesColumn>> = {}) {
  const props = {
    state: notesState(),
    placement: 'column' as const,
    annotations: [] as SatTextAnnotation[],
    questionNote: '',
    hasHighlights: false,
    disabled: false,
    onSelectNote: vi.fn(),
    onChangeNote: vi.fn(),
    onSaveQuestionNote: vi.fn(),
    onRemoveNote: vi.fn(),
    onWriteAboutQuestion: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<SatNotesColumn {...props} />), props };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SatNotesColumn', () => {
  it('is a column, not a dialog: no scrim, no modal role', () => {
    const { container } = renderColumn();
    expect(screen.getByRole('complementary', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(container.querySelector('.bg-black\\/20')).toBeNull();
  });

  it('shows one list carrying the quoted source and the ink of each mark', () => {
    renderColumn({ annotations: [note()] });
    const card = document.querySelector('[data-sat-note-card]')!;
    expect(card).toHaveTextContent('“Several”');
    expect(card).toHaveTextContent('Check the evidence');
    expect(card.querySelector('[data-sat-note-ink]')).toHaveAttribute('data-sat-note-ink', 'blue');
    // Reading a note is not writing one: the note's own field only exists once
    // the student opens it. (The question's field is the other card.)
    expect(screen.queryByRole('textbox', { name: 'Notes' })).not.toBeInTheDocument();
  });

  it('never shows the empty state beside an open editor', () => {
    const target = note({ note: undefined });
    renderColumn({ annotations: [target], state: notesState(target.id) });
    expect(document.querySelector('[data-sat-notes-empty]')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument();
  });

  it('coaches an empty column with one line instead of an idle editor', () => {
    const { container } = renderColumn();
    expect(container.querySelector('[data-sat-notes-empty]')).toHaveTextContent('Select text to add a note');
    // Guidance and editors never share the column: an open field beside
    // "nothing here yet" is the contradiction this replaced.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('turns into a list as soon as there is something to read', () => {
    const { container } = renderColumn({ questionNote: 'Remember the theme' });
    expect(container.querySelector('[data-sat-notes-empty]')).toBeNull();
    // A note that exists reads as a card quoting where it came from — not as a
    // permanently open field waiting to be typed in.
    const card = container.querySelector('[data-sat-note-card="question"]')!;
    expect(card).toHaveTextContent('This question');
    expect(card).toHaveTextContent('Remember the theme');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('leaves a way to write about the question even with no selection', () => {
    // The capability the redesign nearly lost: with nothing selected and nothing
    // written, the column still offers the one action that is always available.
    const { props } = renderColumn();
    fireEvent.click(screen.getByRole('button', { name: 'Write a note about this question' }));
    expect(props.onWriteAboutQuestion).toHaveBeenCalledTimes(1);

    // And it stays reachable once the list has content, as a quiet row in it.
    renderColumn({ annotations: [note()] });
    fireEvent.click(screen.getAllByRole('button', { name: 'Write a note about this question' })[0]!);
    expect(props.onWriteAboutQuestion).toHaveBeenCalledTimes(2);
  });

  it('keeps the count out of the way until the limit is in range', () => {
    const target = note({ note: 'short' });
    renderColumn({ annotations: [target], state: notesState(target.id) });
    expect(document.querySelector('[data-sat-note-counter]')).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), {
      target: { value: 'x'.repeat(1_600) },
    });
    expect(document.querySelector('[data-sat-note-counter]')).toHaveTextContent('1,600/2,000');
  });

  it('offers removal only once there is a note to remove', () => {
    const bare = note({ note: undefined });
    const { unmount } = renderColumn({ annotations: [bare], state: notesState(bare.id) });
    expect(screen.queryByRole('button', { name: 'Remove note' })).not.toBeInTheDocument();
    unmount();

    const written = note();
    renderColumn({ annotations: [written], state: notesState(written.id) });
    expect(screen.getByRole('button', { name: 'Remove note' })).toBeInTheDocument();
  });

  it('hands removal to the owner so it can be undone, and never deletes on its own', () => {
    // The column renders what it is given: "undoable" is a decision the owner
    // makes, and a column that cleared the note itself could not offer it.
    const target = note();
    const { props } = renderColumn({ annotations: [target], state: notesState(target.id) });
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    expect(props.onRemoveNote).toHaveBeenCalledWith(target.id);
    expect(props.onChangeNote).not.toHaveBeenCalled();
  });

  it('never lets a queued autosave resurrect a note the owner removed', () => {
    vi.useFakeTimers();
    try {
      const target = note({ note: 'First draft' });
      const { props, rerender } = renderColumn({ annotations: [target], state: notesState(target.id) });
      // Typing, then removing before the idle pause elapses: the queued write must
      // die with the value the owner cleared, or the removed note comes back —
      // and Undo, pressed at the right moment, would bring it back twice.
      fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), {
        target: { value: 'First draft, extended' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
      expect(props.onRemoveNote).toHaveBeenCalledWith(target.id);

      rerender(<SatNotesColumn {...props} annotations={[note({ id: target.id, note: undefined })]} />);
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(props.onChangeNote).not.toHaveBeenCalledWith('First draft, extended');
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes the question’s own removal through the same owner', () => {
    const { props } = renderColumn({
      questionNote: 'Remember the theme',
      state: notesState(SAT_QUESTION_NOTE_EDITOR),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    expect(props.onRemoveNote).toHaveBeenCalledWith(SAT_QUESTION_NOTE_EDITOR);
  });

  it('summarizes the list in the heading only once there is one', () => {
    const { container, unmount } = renderColumn();
    expect(container.querySelector('[data-sat-notes-count]')).toBeNull();
    unmount();

    // A card open for a first note is not a note yet: the count reads what exists.
    const drafting = note({ note: undefined });
    const second = renderColumn({ annotations: [drafting, note({ id: 'a2' })], state: notesState(drafting.id) });
    expect(screen.getByText('1 note')).toBeInTheDocument();
    second.unmount();

    renderColumn({ annotations: [note(), note({ id: 'a2' })], questionNote: 'Theme' });
    expect(screen.getByText('3 notes')).toBeInTheDocument();
  });

  it('tells a student who only highlighted where those marks went', () => {
    const { container } = renderColumn({ hasHighlights: true });
    // The empty state still teaches the note gesture first, then answers the
    // question a highlighted-but-unwritten student actually has.
    expect(container.querySelector('[data-sat-notes-empty]')).toHaveTextContent('Select text to add a note');
    expect(container.querySelector('[data-sat-notes-empty-highlights]')).toHaveTextContent(
      'Your highlights are marked in the passage',
    );
  });

  it('says nothing about highlights when the passage has none', () => {
    const { container } = renderColumn();
    expect(container.querySelector('[data-sat-notes-empty-highlights]')).toBeNull();
  });

  it('autosaves an idle draft and says so without a Save button', async () => {
    const target = note({ note: undefined });
    const { props } = renderColumn({ annotations: [target], state: notesState(target.id) });
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), {
      target: { value: 'Compare the claims' },
    });
    await waitFor(() => expect(props.onChangeNote).toHaveBeenCalledWith('Compare the claims'));
    await waitFor(() => expect(screen.getByTestId('sat-note-saved')).toHaveTextContent('Saved'));
  });

  it('commits a pending draft when the column closes', async () => {
    const target = note({ note: undefined });
    const { props, unmount } = renderColumn({ annotations: [target], state: notesState(target.id) });
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), {
      target: { value: 'Typed and left' },
    });
    // Closing before the autosave pause elapses must not lose the text.
    unmount();
    expect(props.onChangeNote).toHaveBeenCalledWith('Typed and left');
  });

  it('writes the question’s own note through the same field, with no Save button', async () => {
    const { props } = renderColumn({
      questionNote: 'First thought',
      state: notesState(SAT_QUESTION_NOTE_EDITOR),
    });
    const field = screen.getByRole('textbox', { name: 'This question' });
    expect(field).toHaveValue('First thought');
    expect(field).toHaveAttribute('placeholder', 'Add a quick note…');
    fireEvent.change(field, { target: { value: 'Main idea is control' } });
    await waitFor(() => expect(props.onSaveQuestionNote).toHaveBeenCalledWith('Main idea is control'));
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('selects a note so the passage can show its source', () => {
    const target = note();
    const { props } = renderColumn({ annotations: [target] });
    fireEvent.click(document.querySelector('[data-sat-note-card]')!);
    expect(props.onSelectNote).toHaveBeenCalledWith(target.id);
  });

  it('hides with an explicit, written control — never a corner glyph to decode', () => {
    const { props } = renderColumn();
    const control = screen.getByRole('button', { name: 'Hide notes' });
    // Written out, because a pane that comes back is not a universal glyph: the
    // word is what tells a first-time student the press is reversible.
    expect(control).toHaveTextContent('Hide notes');
    expect(control.querySelector('svg')).not.toBeNull();
    fireEvent.click(control);
    expect(props.onClose).toHaveBeenCalled();
  });

  it('says what hiding brings back where the column took the question’s place', () => {
    // On the two-pane tier the question is hidden behind notes, so a control
    // called "Hide notes" would under-promise; it says what comes back.
    renderColumn({ placement: 'pair' });
    fireEvent.click(screen.getByRole('button', { name: 'Hide notes and show the question' }));
  });

  it('points the way the pane goes, which depends on the tier it is placed in', () => {
    const side = renderColumn();
    // Beside the passage the pane retracts to its trailing edge: a left chevron.
    expect(side.props.placement).toBe('column');
    expect(screen.getByRole('button', { name: 'Hide notes' }).querySelector('.lucide-chevron-left')).not.toBeNull();
    side.unmount();

    // Stacked beneath the panes it goes down instead, so the same press reports a
    // different direction rather than a generic "dismiss".
    renderColumn({ placement: 'row' });
    expect(screen.getByRole('button', { name: 'Hide notes' }).querySelector('.lucide-chevron-down')).not.toBeNull();
  });
});
