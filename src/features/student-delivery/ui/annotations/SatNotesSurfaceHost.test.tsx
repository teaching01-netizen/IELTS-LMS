import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SatNotesSurfaceHost } from './SatNotesSurfaceHost';
import { createSatTextAnnotation, type SatTextAnnotation } from '../../domain/satResponses';
import { useSatNotesSurface } from './SatNotesSurfaceContext';
import type { SatNotesUiState } from '../../domain/satNotesUi';
import { SAT_QUESTION_NOTE_EDITOR } from '../../domain/satNotesUi';
import { createSatReadingPreferences } from '../../domain/satReadingPreferences';
import { SatQuestionWorkspace } from '../question/SatQuestionWorkspace';
import { SatReadingLayoutHarness, SAT_TEST_BOX } from '../reading/__tests__/satReadingLayoutHarness';

/**
 * The boxes these cases hand the host are the whole of its "where does the
 * column go" input: the host reads the shared reading decision, so nothing here
 * mocks a viewport media query — the placement and the panes it sits between
 * come from one measurement by construction.
 */
type TestBox = { width: number; height: number };

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
    box?: TestBox;
    hasStimulus?: boolean;
    questionKey?: string;
    questionNote?: string;
    annotations?: SatTextAnnotation[];
    notesAvailable?: boolean;
    onSaveQuestionNote?: (note: string) => void;
    onOpenNotes?: () => void;
    onSettleNoteEditor?: () => void;
  } = {},
) {
  const view = render(
    <SatReadingLayoutHarness
      box={overrides.box ?? SAT_TEST_BOX.tablet}
      hasStimulus={overrides.hasStimulus ?? true}
    >
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
    </SatNotesSurfaceHost>
    </SatReadingLayoutHarness>,
  );
  return view;
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
    renderHost({ kind: 'idle' });
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-placement', 'none');
    expect(probe).toHaveAttribute('data-has-column', 'false');
  });

  it('hands the layout a handle where the hidden column stood, so it is visibly reversible', () => {
    const onOpenNotes = vi.fn();
    renderHost({ kind: 'idle' }, { annotations: [writtenNote()], onOpenNotes });
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-has-column', 'false');
    expect(probe).toHaveAttribute('data-has-rail', 'true');
    // The handle says what it is and what pressing it does: no decoding a
    // corner chevron to find out a pane can come back.
    const rail = screen.getByRole('button', { name: 'Show notes' });
    expect(rail).toHaveTextContent('Notes');
    fireEvent.click(rail);
    expect(onOpenNotes).toHaveBeenCalledTimes(1);
  });

  it('leaves nothing in the middle until there is a note to come back to', () => {
    // Highlighted but never wrote: no pane, no handle — the exam holds no
    // notes-shaped furniture, and the labeled top-bar entry is the way in.
    renderHost({ kind: 'idle' }, { annotations: [bareMark()], questionNote: '   ' });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-has-rail', 'false');
    expect(screen.queryByRole('button', { name: 'Show notes' })).not.toBeInTheDocument();
  });

  it('stands the handle up as soon as there is something to bring back', () => {
    renderHost({ kind: 'idle' }, { annotations: [], questionNote: 'The theme is control' });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-has-rail', 'true');
  });

  it('leaves no handle while the column is open, or where notes cannot open', () => {
    renderHost(notes());
    expect(screen.getByTestId('probe')).toHaveAttribute('data-has-rail', 'false');
    cleanup();

    // Math: the surface is absent, so a handle would advertise a pane that can
    // never appear.
    renderHost({ kind: 'idle' }, { notesAvailable: false });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-has-rail', 'false');
    expect(screen.queryByRole('button', { name: 'Show notes' })).not.toBeInTheDocument();
  });

  it('leaves no handle where the panes are stacked: there is no edge to hold', () => {
    renderHost({ kind: 'idle' }, { box: SAT_TEST_BOX.phone, annotations: [writtenNote()] });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-has-rail', 'false');
  });

  it('hands the column and its placement to the layout together', () => {
    renderHost(notes());
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-open', 'true');
    expect(probe).toHaveAttribute('data-placement', 'column');
    expect(probe).toHaveAttribute('data-has-column', 'true');
    expect(screen.getByRole('complementary', { name: 'Notes' })).toBeInTheDocument();
  });

  it('narrows to the two-pane placement where a third column would squeeze both panes', () => {
    renderHost(notes(), { box: SAT_TEST_BOX.smallTablet });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-placement', 'pair');
    expect(screen.getByRole('complementary', { name: 'Notes' })).toBeInTheDocument();
  });

  it('stacks rather than floating when there is no room for a pane', () => {
    renderHost(notes(), { box: SAT_TEST_BOX.phone });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-placement', 'row');
  });

  it('sits beside a question that has no passage until the two stop fitting', () => {
    // No stimulus: the question is the only reading pane, so the column shares
    // the row with it while the question still has readable width — the same
    // measurement the workspace uses, not a second opinion about "wide".
    renderHost(notes(), { hasStimulus: false, box: SAT_TEST_BOX.smallTablet });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-placement', 'column');

    cleanup();
    renderHost(notes(), { hasStimulus: false, box: SAT_TEST_BOX.phone });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-placement', 'row');
  });

  it('carries the one-time hint inside the surface it teaches', () => {
    renderHost(notes(), { hintVisible: true });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-has-hint', 'true');
  });

  it('commits a pending draft to its own question and starts the next one clean', () => {
    // The column is keyed by question: switching questions must not carry the
    // draft across (writing a note onto the wrong question) or drop it (losing
    // what the student typed).
    const onSaveQuestionNote = vi.fn();
    const { rerender } = renderHost(notes(SAT_QUESTION_NOTE_EDITOR), { onSaveQuestionNote });
    fireEvent.change(screen.getByRole('textbox', { name: 'This question' }), {
      target: { value: 'Half-typed thought' },
    });
    rerender(
      <SatReadingLayoutHarness box={SAT_TEST_BOX.tablet}>
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
        </SatNotesSurfaceHost>
      </SatReadingLayoutHarness>,
    );
    expect(onSaveQuestionNote).toHaveBeenCalledWith('Half-typed thought');
    expect(screen.getByRole('textbox', { name: 'This question' })).toHaveValue('');
  });

  it('keeps the column open while a note is being written', () => {
    // The editor is the reason to be open: a state that closed the column while
    // a field was live would take the field with it.
    renderHost(notes(SAT_QUESTION_NOTE_EDITOR));
    expect(screen.getByTestId('probe')).toHaveAttribute('data-has-column', 'true');
    expect(screen.getByRole('textbox', { name: 'This question' })).toBeInTheDocument();
  });
});

/**
 * The real column, in the real workspace, with the box the layout is measured
 * from handed in — so a case can walk the whole arrangement from one placement to
 * another the way raising Text size does in the exam.
 */
function ReflowHarness({ box }: { box: TestBox }) {
  const [questionNote, setQuestionNote] = useState('');
  const preferences = createSatReadingPreferences();
  return (
    <SatReadingLayoutHarness box={box} preferences={preferences}>
      <SatNotesSurfaceHost
        state={notes(SAT_QUESTION_NOTE_EDITOR)}
        questionKey="module::0"
        annotations={[]}
        questionNote={questionNote}
        hasHighlights={false}
        notesAvailable
        disabled={false}
        hintVisible={false}
        onSelectNote={vi.fn()}
        onChangeNote={vi.fn()}
        onSaveQuestionNote={setQuestionNote}
        onRemoveNote={vi.fn()}
        onAddQuestionNote={vi.fn()}
        onSettleNoteEditor={vi.fn()}
        onOpenNotes={vi.fn()}
        onClose={vi.fn()}
      >
        <SatQuestionWorkspace
          split
          stimulus={<p>Passage</p>}
          question={<p>Question</p>}
          readingPreferences={preferences}
          onSplitRatioChange={vi.fn()}
        />
      </SatNotesSurfaceHost>
    </SatReadingLayoutHarness>
  );
}

/**
 * A reflow moves the column; it must not rebuild it.
 *
 * Placement is derived from one measurement, and it is what decides whether the
 * column sits between the panes, takes the question's place, or stacks beneath
 * them. Those are different places in the grid — and the thing the student is
 * typing into lives inside the column, so "different place" has to mean a moved
 * node, never a new one. A remount would commit the draft through the unmount
 * hand-off (which is why the words alone are not proof of anything) and then hand
 * the student a fresh, empty caret while they are mid-sentence.
 */
describe('the notes pane survives a reflow', () => {
  const workspace = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-sat-reading-layout]')!;

  it('keeps the same pane, the same editor and the caret across column → row', async () => {
    const { container, rerender } = render(<ReflowHarness box={SAT_TEST_BOX.tablet} />);
    expect(workspace(container)).toHaveAttribute('data-sat-notes-placement', 'column');

    const field = screen.getByRole('textbox', { name: 'This question' });
    const column = container.querySelector<HTMLElement>('[data-sat-notes-column]')!;
    field.focus();
    fireEvent.change(field, { target: { value: 'Compare canopy density with paving.' } });
    // The mount's own focus work has to finish before the reflow is allowed to
    // be blamed for anything about focus.
    await waitFor(() => expect(field).toHaveFocus());

    // 390px is a phone: the panes stack, so the column stacks with them.
    rerender(<ReflowHarness box={SAT_TEST_BOX.phone} />);
    expect(workspace(container)).toHaveAttribute('data-sat-notes-placement', 'row');

    expect(container.querySelector('[data-sat-notes-column]')).toBe(column);
    expect(screen.getByRole('textbox', { name: 'This question' })).toBe(field);
    expect(field).toHaveValue('Compare canopy density with paving.');
    expect(field).toHaveFocus();
  });

  it('moves the pane without disturbing what is inside it in the other direction', async () => {
    const { container, rerender } = render(<ReflowHarness box={SAT_TEST_BOX.phone} />);
    expect(workspace(container)).toHaveAttribute('data-sat-notes-placement', 'row');

    const field = screen.getByRole('textbox', { name: 'This question' });
    field.focus();
    fireEvent.change(field, { target: { value: 'Canopy density.' } });
    await waitFor(() => expect(field).toHaveFocus());

    // A desktop: returning from stacked, the third column needs the panes to
    // clear the readable budget with the hysteresis margin on top of it, which is
    // the same rule that keeps the panes themselves from flickering.
    rerender(<ReflowHarness box={SAT_TEST_BOX.desktop} />);
    expect(workspace(container)).toHaveAttribute('data-sat-notes-placement', 'column');

    expect(screen.getByRole('textbox', { name: 'This question' })).toBe(field);
    expect(field).toHaveValue('Canopy density.');
    expect(field).toHaveFocus();
  });
});
