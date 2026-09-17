import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    disabled: false,
    onSelectNote: vi.fn(),
    onChangeNote: vi.fn(),
    onSaveQuestionNote: vi.fn(),
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

  it('empties the note without destroying the mark behind it', () => {
    const target = note();
    const { props } = renderColumn({ annotations: [target], state: notesState(target.id) });
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    expect(props.onChangeNote).toHaveBeenCalledWith('');
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

  it('closes with an explicit, labeled control', () => {
    const { props } = renderColumn();
    fireEvent.click(screen.getByRole('button', { name: 'Close notes' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('names what closing does where the column took the question’s place', () => {
    // On the two-pane tier the question is hidden behind notes, so a control
    // called "Close notes" would under-promise; it says what comes back.
    renderColumn({ placement: 'pair' });
    fireEvent.click(screen.getByRole('button', { name: 'Close notes and show the question' }));
  });
});
