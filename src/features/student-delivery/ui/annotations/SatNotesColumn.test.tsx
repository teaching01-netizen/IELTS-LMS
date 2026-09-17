import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SatNotesColumn } from './SatNotesColumn';
import { createSatTextAnnotation } from '../../domain/satResponses';
import type { SatTextAnnotation } from '../../domain/satResponses';
import { SAT_QUESTION_NOTE_EDITOR } from '../../domain/satNotesUi';

/**
 * The Notes column is where the feature's mental model is either obvious or
 * lost, so these tests pin the things that make it obvious: one list, two things
 * per card (the excerpt, the field), no Save button, no scrim, no reading state
 * to leave, and nothing on screen that says the same thing twice.
 */
function note(overrides: Partial<SatTextAnnotation> = {}, exact = 'Several'): SatTextAnnotation {
  return {
    ...createSatTextAnnotation({
      kind: 'highlight',
      nodeId: 'stimulus:p',
      startOffset: 0,
      endOffset: exact.length,
      exact,
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
    onAddQuestionNote: vi.fn(),
    onSettleNoteEditor: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<SatNotesColumn {...props} />), props };
}

function cardFor(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-sat-note-card="${id}"]`)!;
}

function fieldIn(card: HTMLElement): HTMLTextAreaElement {
  return within(card).getByRole('textbox') as HTMLTextAreaElement;
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

  it('shows the highlighted text once, semibold and unquoted, with its mark’s ink', () => {
    const target = note();
    renderColumn({ annotations: [target] });
    const card = cardFor(target.id);
    const excerpt = card.querySelector('[data-sat-note-excerpt]')!;
    // The student's own selection, as they selected it: no quote decorations, no
    // italic, no "Highlighted text" label. Typography is the hierarchy.
    expect(excerpt).toHaveTextContent('Several');
    expect(excerpt.textContent).toBe('Several');
    expect(excerpt.className).toContain('font-semibold');
    expect(excerpt.className).not.toContain('italic');
    expect(card.querySelector('[data-sat-note-ink]')).toHaveAttribute('data-sat-note-ink', 'blue');
  });

  it('never renders the note twice: the field is the only representation', () => {
    const target = note({ note: 'Check the evidence' });
    renderColumn({ annotations: [target] });
    const card = cardFor(target.id);
    // One value, one representation. A card that also printed the note above the
    // field is the thing this replaced, and it is what made a student decide
    // which copy was theirs: the words live in the field, and nothing else in the
    // card repeats them.
    expect(fieldIn(card)).toHaveValue('Check the evidence');
    const withoutField = card.cloneNode(true) as HTMLElement;
    withoutField.querySelector('textarea')?.remove();
    expect(withoutField.textContent).not.toContain('Check the evidence');
    expect(card.textContent?.split('Check the evidence').length).toBe(2);
    // The excerpt itself quotes nothing: no wrapping quotation marks anywhere.
    expect(card.textContent).not.toContain('\u201CSeveral\u201D');
  });

  it('makes every anchored card directly editable, with no state to enter', () => {
    const first = note({}, 'Several');
    const second = note({ id: 'a2' }, 'trees change heat');
    const { container } = renderColumn({ annotations: [first, second] });
    // A note IS the field: neither card is a preview that has to be opened, and
    // the unfocused one is the same element as the focused one.
    expect(container.querySelector(`[data-sat-note-card="${first.id}"]`)!.tagName).toBe('DIV');
    expect(container.querySelector(`[data-sat-note-card="${second.id}"]`)!.tagName).toBe('DIV');
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(fieldIn(cardFor(first.id))).toHaveValue('Check the evidence');
    expect(fieldIn(cardFor(second.id))).toHaveValue('Check the evidence');
  });

  it('writes into the note the student typed in, not into a single open editor', () => {
    vi.useFakeTimers();
    try {
      const first = note({}, 'Several');
      const second = note({ id: 'a2' }, 'trees change heat');
      const { props } = renderColumn({ annotations: [first, second] });
      fireEvent.change(fieldIn(cardFor('a2')), { target: { value: 'Second note only' } });
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      // Every card carries a live field, so the card the keystroke happened in is
      // the note the text belongs to.
      expect(props.onChangeNote).toHaveBeenCalledWith('a2', 'Second note only');
      expect(props.onChangeNote).not.toHaveBeenCalledWith(first.id, expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the empty state and live fields from sharing the column', () => {
    const target = note({ note: undefined });
    renderColumn({ annotations: [target], state: notesState(target.id) });
    expect(document.querySelector('[data-sat-notes-empty]')).toBeNull();
    expect(fieldIn(cardFor(target.id))).toHaveValue('');
  });

  it('coaches an empty column with one line instead of an idle editor', () => {
    const { container } = renderColumn();
    // Two lines: what this column is, then the one gesture that fills it.
    const empty = container.querySelector('[data-sat-notes-empty]')!;
    expect(empty).toHaveTextContent('No notes yet');
    expect(empty).toHaveTextContent('Select text in the passage, then choose Add note.');
    // Guidance and editors never share the column: nothing is on screen to type
    // in until the student asks for it.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('leaves a quiet way to write about the question even with no selection', () => {
    // The capability the redesign nearly lost: with nothing selected and nothing
    // written, the column still offers the one action that is always available.
    const first = renderColumn();
    fireEvent.click(screen.getByRole('button', { name: 'Add question note' }));
    expect(first.props.onAddQuestionNote).toHaveBeenCalledTimes(1);
    first.unmount();

    // Demoted, not removed: with notes about the passage in the list this is one
    // text button under them, so selected-text notes stay the pattern instead of
    // the two competing as equal primary actions.
    const withList = renderColumn({ annotations: [note()] });
    const button = screen.getByRole('button', { name: 'Add question note' });
    expect(button).toHaveAttribute('data-sat-notes-add-question-note', 'true');
    // Asked for from where the existing notes are, never instead of them.
    expect(button.closest('ul')).toBeNull();
    fireEvent.click(button);
    expect(withList.props.onAddQuestionNote).toHaveBeenCalledTimes(1);
  });

  it('reads the question’s own note in a field with no invented source line', () => {
    const { container } = renderColumn({ questionNote: 'Remember the theme' });
    expect(container.querySelector('[data-sat-notes-empty]')).toBeNull();
    const card = cardFor('question');
    // No fake highlighted context and no label to read: the field is the note.
    expect(card.querySelector('[data-sat-notes-add-question-note]')).toBeNull();
    expect(card).not.toHaveTextContent('This question');
    const field = fieldIn(card);
    expect(field).toHaveValue('Remember the theme');
    // Still named in speech, because a pane of unlabeled fields is unusable
    // without sight.
    expect(field).toHaveAccessibleName('This question');
  });

  it('reverts the question slot to its one button when there is nothing to read', () => {
    renderColumn();
    expect(document.querySelector('[data-sat-note-card="question"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add question note' })).toBeInTheDocument();
  });

  it('keeps the count out of the way until the limit is in range', () => {
    const target = note({ note: 'short' });
    renderColumn({ annotations: [target] });
    expect(document.querySelector('[data-sat-note-counter]')).toBeNull();

    fireEvent.change(fieldIn(cardFor(target.id)), {
      target: { value: 'x'.repeat(1_600) },
    });
    expect(document.querySelector('[data-sat-note-counter]')).toHaveTextContent('1,600/2,000');
  });

  it('offers removal only once there is a note, and only behind a disclosure', () => {
    const bare = note({ note: undefined }, 'Several');
    const { unmount } = renderColumn({ annotations: [bare] });
    expect(document.querySelector('[data-sat-note-actions-trigger]')).toBeNull();
    unmount();

    const written = note();
    renderColumn({ annotations: [written] });
    // Neutral control, no destructive ink at rest: a student mid-sentence must not
    // have their eye caught by the way to lose the sentence.
    const card = cardFor(written.id);
    const trigger = within(card).getByRole('button', { name: 'Note actions for \u201CSeveral\u201D' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-sat-note-actions]')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete note' })).not.toBeInTheDocument();
  });

  it('reveals the destructive verb only after the student asks for it', () => {
    const written = note();
    renderColumn({ annotations: [written] });
    const card = cardFor(written.id);
    fireEvent.click(within(card).getByRole('button', { name: 'Note actions for \u201CSeveral\u201D' }));
    expect(document.querySelector('[data-sat-note-actions]')).toHaveAttribute('role', 'menu');
    expect(screen.getByRole('menuitem', { name: 'Delete note' })).toBeInTheDocument();
  });

  it('closes the disclosure on Escape without closing the pane under it', () => {
    const written = note();
    renderColumn({ annotations: [written] });
    const card = cardFor(written.id);
    const trigger = within(card).getByRole('button', { name: 'Note actions for \u201CSeveral\u201D' });
    fireEvent.click(trigger);
    const onDocumentEscape = vi.fn();
    document.addEventListener('keydown', onDocumentEscape);
    try {
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Delete note' }), { key: 'Escape' });
      // One press, one meaning: the exam must not also hear the key and take the
      // column — with the note the student was about to delete — with it.
      expect(onDocumentEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onDocumentEscape);
    }
    expect(screen.queryByRole('menuitem', { name: 'Delete note' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('hands removal to the owner so it can be undone, and never deletes on its own', () => {
    // The column renders what it is given: "undoable" is a decision the owner
    // makes, and a column that cleared the note itself could not offer it.
    const target = note();
    const { props } = renderColumn({ annotations: [target] });
    const card = cardFor(target.id);
    fireEvent.click(within(card).getByRole('button', { name: 'Note actions for \u201CSeveral\u201D' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete note' }));
    expect(props.onRemoveNote).toHaveBeenCalledWith(target.id);
    expect(props.onChangeNote).not.toHaveBeenCalled();
  });

  it('never lets a queued autosave resurrect a note the owner removed', () => {
    vi.useFakeTimers();
    try {
      const target = note({ note: 'First draft' });
      const { props, rerender } = renderColumn({ annotations: [target] });
      // Typing, then removing before the idle pause elapses: the queued write must
      // die with the value the owner cleared, or the removed note comes back —
      // and Undo, pressed at the right moment, would bring it back twice.
      fireEvent.change(fieldIn(cardFor(target.id)), { target: { value: 'First draft, extended' } });
      fireEvent.click(within(cardFor(target.id)).getByRole('button', { name: /^Note actions/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete note' }));
      expect(props.onRemoveNote).toHaveBeenCalledWith(target.id);

      rerender(<SatNotesColumn {...props} annotations={[note({ id: target.id, note: undefined })]} />);
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(props.onChangeNote).not.toHaveBeenCalledWith(target.id, 'First draft, extended');
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes the question’s own removal through the same owner', () => {
    const { props } = renderColumn({ questionNote: 'Remember the theme' });
    fireEvent.click(within(cardFor('question')).getByRole('button', { name: 'Note actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete note' }));
    expect(props.onRemoveNote).toHaveBeenCalledWith(SAT_QUESTION_NOTE_EDITOR);
  });

  it('summarizes the list in the heading only once there is one', () => {
    const { container, unmount } = renderColumn();
    expect(container.querySelector('[data-sat-notes-count]')).toBeNull();
    unmount();

    // A card open for a first note is not a note yet: the count reads what exists.
    const drafting = note({ note: undefined });
    const second = renderColumn({ annotations: [drafting, note({ id: 'a2' })] });
    expect(screen.getByText('1 note')).toBeInTheDocument();
    second.unmount();

    renderColumn({ annotations: [note(), note({ id: 'a2' })], questionNote: 'Theme' });
    expect(screen.getByText('3 notes')).toBeInTheDocument();
  });

  it('tells a student who only highlighted where those marks went', () => {
    const { container } = renderColumn({ hasHighlights: true });
    // The empty state still teaches the note gesture first, then answers the
    // question a highlighted-but-unwritten student actually has.
    expect(container.querySelector('[data-sat-notes-empty]')).toHaveTextContent('Select text in the passage');
    expect(container.querySelector('[data-sat-notes-empty-highlights]')).toHaveTextContent(
      'Your highlights are marked in the passage',
    );
  });

  it('says nothing about highlights when the passage has none', () => {
    const { container } = renderColumn();
    expect(container.querySelector('[data-sat-notes-empty-highlights]')).toBeNull();
  });

  it('says nothing about saving until saving is actually happening', async () => {
    const target = note({ note: undefined });
    const { props } = renderColumn({ annotations: [target] });
    const field = fieldIn(cardFor(target.id));
    // At rest the field is silent: autosave is a capability, not a chore the
    // student has to manage, so nothing on screen asks them to think about it.
    expect(document.querySelector('[data-sat-note-status]')).toBeNull();

    fireEvent.change(field, { target: { value: 'Compare the claims' } });
    expect(document.querySelector('[data-sat-note-status="saving"]')).toHaveTextContent('Saving');
    expect(document.querySelector('[data-sat-note-autosave-hint]')).toBeNull();

    await waitFor(() => expect(props.onChangeNote).toHaveBeenCalledWith(target.id, 'Compare the claims'));
    await waitFor(() =>
      expect(document.querySelector('[data-sat-note-status="saved"]')).toHaveTextContent('Saved'),
    );
    // And then it goes away again, without the student doing anything.
    await waitFor(() => expect(document.querySelector('[data-sat-note-status]')).toBeNull(), {
      timeout: 3_000,
    });
  });

  it('promises nothing about saving when a draft ends where it started', async () => {
    const target = note({ note: 'Kept' });
    const { props } = renderColumn({ annotations: [target] });
    const field = fieldIn(cardFor(target.id));
    fireEvent.change(field, { target: { value: 'Kept, then not' } });
    fireEvent.change(field, { target: { value: 'Kept' } });
    // Back to what is already stored: there is nothing to wait for, so the field
    // must not claim to be saving text the owner already has.
    expect(document.querySelector('[data-sat-note-status]')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(props.onChangeNote).not.toHaveBeenCalled();
  });

  it('commits a pending draft when the column closes', async () => {
    const target = note({ note: undefined });
    const { props, unmount } = renderColumn({ annotations: [target] });
    fireEvent.change(fieldIn(cardFor(target.id)), { target: { value: 'Typed and left' } });
    // Closing before the autosave pause elapses must not lose the text.
    unmount();
    expect(props.onChangeNote).toHaveBeenCalledWith(target.id, 'Typed and left');
  });

  it('writes the question’s own note through the same field, with no Save button', async () => {
    const { props } = renderColumn({
      questionNote: 'First thought',
      state: notesState(SAT_QUESTION_NOTE_EDITOR),
    });
    const field = fieldIn(cardFor('question'));
    expect(field).toHaveValue('First thought');
    expect(field).toHaveAttribute('placeholder', 'Write a note\u2026');
    fireEvent.change(field, { target: { value: 'Main idea is control' } });
    await waitFor(() => expect(props.onSaveQuestionNote).toHaveBeenCalledWith('Main idea is control'));
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('settles the note the student was in when they press back in the passage', () => {
    const target = note();
    const { props } = renderColumn({ annotations: [target], state: notesState(target.id) });
    // A press outside the pane leaves the note: the field's own blur commits the
    // words and the pane stays exactly where it is, but the note stops being
    // *open* — which is the whole difference between writing a note and being
    // stuck in one, and what lets the next selection raise the tools.
    fireEvent.pointerDown(document.body);
    expect(props.onSettleNoteEditor).toHaveBeenCalledTimes(1);
  });

  it('never settles a note on a press inside the pane', () => {
    const target = note();
    const { props } = renderColumn({ annotations: [target], state: notesState(target.id) });
    // Moving between notes, or reaching for the question's own field, is not
    // leaving: only a press that lands outside the column is the student looking
    // at something else.
    fireEvent.pointerDown(fieldIn(cardFor(target.id)));
    fireEvent.pointerDown(document.querySelector('[data-sat-notes-column]')!);
    expect(props.onSettleNoteEditor).not.toHaveBeenCalled();
  });

  it('selects a note so the passage can show its source', () => {
    const target = note();
    const { props } = renderColumn({ annotations: [target] });
    fireEvent.click(document.querySelector('[data-sat-note-excerpt]')!);
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

  it('marks the card whose mark is active in the passage', () => {
    const first = note({}, 'Several');
    const second = note({ id: 'a2' }, 'trees change heat');
    renderColumn({ annotations: [first, second], state: notesState(null, second.id) });
    // The other half of the highlight <-> note link: the card that belongs to the
    // mark the student is on is the one that looks current, by an accent on its
    // leading edge rather than by another border.
    const active = cardFor('a2');
    const idle = cardFor(first.id);
    expect(active.className).toContain('border-l-[var(--sat-accent)]');
    expect(active.querySelector('[data-sat-note-excerpt]')).toHaveAttribute('aria-current', 'true');
    expect(idle.className).toContain('border-l-transparent');
    expect(idle.querySelector('[data-sat-note-excerpt]')).not.toHaveAttribute('aria-current');
  });

  it('uses one boundary at a time: the pane is the card, the ring is the field', () => {
    const target = note();
    const { container } = renderColumn({ annotations: [target] });
    const card = cardFor(target.id);
    const field = fieldIn(card);
    // Idle: the card adds no box of its own — no border, no ring — so a pane of
    // notes cannot read as a box inside a box, and the field is the only surface.
    expect(card.className).not.toContain('ring-1');
    expect(card.className).not.toContain('border-[var(--sat-accent)]');
    expect(within(card).getAllByRole('textbox')).toHaveLength(1);
    // Focus is the field's alone: the object being edited is the one that becomes
    // visually dominant, and nothing else layers up with it.
    expect(field.className).toContain('focus:ring-2');
    expect(container.querySelectorAll('[data-sat-note-card]')).toHaveLength(1);
  });

  it('puts the count under the title instead of on the dismissal’s line', () => {
    renderColumn({ annotations: [note(), note({ id: 'a2' }, 'trees change heat')] });
    const heading = screen.getByRole('heading', { name: 'Notes' });
    const count = document.querySelector('[data-sat-notes-count]')!;
    // Title primary, count secondary metadata, dismissal last: three things on
    // one row made "1 note" look like something to press.
    expect(count.tagName).toBe('P');
    expect(count.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(heading.parentElement).not.toBe(screen.getByRole('button', { name: 'Hide notes' }).parentElement);
  });
});
