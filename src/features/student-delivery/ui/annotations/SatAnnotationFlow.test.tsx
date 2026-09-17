import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SatAccessibilityDebugRoute } from '../../../../app/router/dev/SatAccessibilityDebugRoute';

/**
 * The student journey the whole pass exists for: select text, see obvious
 * labeled controls, tap a color, watch the sentence change. No tutorial is
 * involved anywhere in these tests — that is the point.
 */

/** Select the first `length` characters of the passage's first text node. */
function selectStimulusText(container: HTMLElement, value: string, length = value.length): void {
  const root = container.querySelector('[data-sat-annotation-region="stimulus"]')!;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node && !(node.nodeValue ?? '').includes(value)) node = walker.nextNode();
  expect(node).not.toBeNull();
  const textNode = node as Text;
  const start = textNode.data.indexOf(value);
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + length);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.pointerUp(textNode.parentElement!);
}

function highlight(container: HTMLElement, value: string, color: 'Yellow' | 'Blue' | 'Pink', length?: number) {
  selectStimulusText(container, value, length ?? value.length);
  fireEvent.click(screen.getByRole('button', { name: 'Highlight ' + color }));
}

/**
 * jsdom has no viewport, so every width query answers false and the notes
 * column would always land on its narrowest tier. This stands in for a desktop
 * exam window, which is the tier the three-pane promise belongs to.
 */
function stubWideViewport(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width: 1024px'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList);
}

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('SAT shell annotation flow (selection first)', () => {
  it('raises labeled color controls on a selection and highlights on one tap', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    expect(screen.queryByRole('toolbar', { name: 'Selected text actions' })).not.toBeInTheDocument();

    selectStimulusText(container, 'Several');
    const toolbar = screen.getByRole('toolbar', { name: 'Selected text actions' });
    // The word "Highlight" next to the swatches is what connects a selection to
    // these colors — and each swatch is labeled, never a bare dot.
    expect(toolbar).toHaveTextContent('Highlight');
    expect(screen.getByRole('button', { name: 'Highlight Yellow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Highlight Blue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Highlight Pink' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Underline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Highlight Blue' }));
    const mark = container.querySelector('[data-sat-highlight="true"]');
    expect(mark).toHaveTextContent('Several');
    expect(mark).toHaveAttribute('data-sat-highlight-color', 'blue');
    // Acting does not dismiss the tools: they become the new mark's controls, in
    // the same place, with the chosen ink pressed — so a second tap is a new ink
    // rather than a hunt for the mark.
    expect(screen.queryByRole('toolbar', { name: 'Selected text actions' })).not.toBeInTheDocument();
    const dock = screen.getByRole('toolbar', { name: 'Edit annotation' });
    expect(screen.getByRole('button', { name: 'Highlight Blue' })).toHaveAttribute('aria-pressed', 'true');
    // The note the student may want next is one labeled press away, here — not in
    // a pane that had to open in the middle of the exam to offer it.
    expect(dock).toHaveTextContent('Add note');
    expect(screen.queryByRole('complementary', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.getByTestId('sat-annotation-announcement')).toHaveTextContent('Text highlighted blue.');
  });

  it('lets the student close the popover with a written control', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    selectStimulusText(container, 'Several');
    const toolbar = screen.getByRole('toolbar', { name: 'Selected text actions' });
    // Esc already did this, invisibly. The control names the action for the
    // student who does not guess gestures.
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Close text tools' }));
    expect(screen.queryByRole('toolbar', { name: 'Selected text actions' })).not.toBeInTheDocument();
    // Closing the tools is not editing: nothing was marked.
    expect(container.querySelector('[data-sat-highlight="true"]')).toBeNull();
  });

  it('underlines a selection from the same toolbar', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    selectStimulusText(container, 'researchers');
    fireEvent.click(screen.getByRole('button', { name: 'Underline' }));
    expect(container.querySelector('[data-sat-underline="true"]')).toHaveTextContent('researchers');
    expect(screen.getByTestId('sat-annotation-announcement')).toHaveTextContent('Text underlined.');
  });

  it('creates a highlight from the keyboard alone (shift+arrows then the toolbar)', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    const leaf = container.querySelector('[data-sat-annotation-region="stimulus"] [data-content-text-node] span span')!.firstChild!;
    const seed = document.createRange();
    seed.setStart(leaf, 0); seed.setEnd(leaf, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(seed);
    fireEvent.keyUp(document, { key: 'ArrowRight', shiftKey: true });

    // The toolbar takes focus so a keyboard student is one keystroke away.
    const yellow = screen.getByRole('button', { name: 'Highlight Yellow' });
    expect(document.activeElement).toBe(yellow);
    fireEvent.click(yellow);
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveTextContent('Several');
  });

  it('opens a new note in the Notes pane, in edit mode, with the caret already in it', async () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    selectStimulusText(container, 'Several');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    // Choosing "Add note" leaves a visible mark behind: a note without a source
    // would be unfindable later.
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveTextContent('Several');
    // One note has one editor: the mark's tools step aside for the pane's field
    // rather than sitting over it with a second textarea for the same words.
    expect(screen.queryByRole('toolbar', { name: 'Edit annotation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Selected text actions' })).not.toBeInTheDocument();

    // The note opens on its own card, quoting the words it is about, and the
    // caret is already in the field: the press WAS the invitation to type.
    const column = await screen.findByRole('complementary', { name: 'Notes' });
    expect(column).toHaveTextContent('“Several”');
    const field = screen.getByRole('textbox', { name: 'Notes' });
    expect(field).toHaveAttribute('placeholder', 'Add a quick note…');
    await waitFor(() => expect(document.activeElement).toBe(field));
    // The promise is made once, because there is no Save button to look for.
    expect(column).toHaveTextContent('Notes save automatically.');

    fireEvent.change(field, { target: { value: 'Remember this claim' } });
    // Autosave, then the quiet confirmation — and the promise retires with it.
    await waitFor(() => expect(screen.getByTestId('sat-note-saved')).toHaveTextContent('Saved'), { timeout: 3000 });
    await waitFor(() => expect(column).not.toHaveTextContent('Notes save automatically.'));
  });

  it('recolors an existing mark in one tap and forgives removal with Undo', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    highlight(container, 'Several', 'Yellow');
    const mark = container.querySelector('[data-sat-highlight="true"]')!;
    expect(mark).toHaveAttribute('data-sat-highlight-color', 'yellow');

    // Tapping the mark teaches that it is an object you can change later.
    fireEvent.click(mark);
    const dock = screen.getByRole('toolbar', { name: 'Edit annotation' });
    expect(dock).toHaveTextContent('Highlight');
    fireEvent.click(screen.getByRole('button', { name: 'Highlight Pink' }));
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveAttribute('data-sat-highlight-color', 'pink');

    fireEvent.click(screen.getByRole('button', { name: 'Remove highlight' }));
    expect(container.querySelector('[data-sat-highlight="true"]')).not.toBeInTheDocument();
    const toast = screen.getByTestId('sat-undo-toast');
    expect(toast).toHaveTextContent('Highlight removed');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveAttribute('data-sat-highlight-color', 'pink');
    expect(screen.queryByTestId('sat-undo-toast')).not.toBeInTheDocument();
  });

  it('reopens an existing mark’s note with its saved text and quoted source', async () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    highlight(container, 'Several', 'Blue');
    fireEvent.click(container.querySelector('[data-sat-highlight="true"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const field = await screen.findByRole('textbox', { name: 'Notes' });
    fireEvent.change(field, { target: { value: 'Check the evidence' } });
    // Leaving the field is a commit: there is no Save button to press.
    fireEvent.blur(field);
    await waitFor(() => expect(screen.getByTestId('sat-note-saved')).toBeInTheDocument());

    // Hiding the pane leaves the note on the mark: the words live with the
    // mark, not with the panel that happened to be showing when they were typed.
    fireEvent.click(screen.getByRole('button', { name: /^Hide notes/ }));
    expect(screen.queryByRole('complementary', { name: 'Notes' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveAttribute('data-sat-annotation-note', 'true');

    // Reopening from the mark shows the saved note under the quoted source.
    fireEvent.click(container.querySelector('[data-sat-highlight="true"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    expect(await screen.findByRole('textbox', { name: 'Notes' })).toHaveValue('Check the evidence');
    expect(document.querySelector('[data-sat-note-card]')).toHaveTextContent('“Several”');
  });

  it('clears the tools on Escape without touching the mark', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    highlight(container, 'Several', 'Yellow');
    selectStimulusText(container, 'Several');
    expect(screen.getByRole('toolbar', { name: 'Selected text actions' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('toolbar', { name: 'Selected text actions' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveTextContent('Several');
  });

  it('lists anchored notes in the Notes column with their ink and quoted source', async () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    highlight(container, 'Several', 'Pink');
    fireEvent.click(container.querySelector('[data-sat-highlight="true"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const field = await screen.findByRole('textbox', { name: 'Notes' });
    fireEvent.change(field, { target: { value: 'Compare the claim' } });
    fireEvent.blur(field);

    const column = await screen.findByRole('complementary', { name: 'Notes' });
    expect(column).toHaveTextContent('“Several”');
    expect(column).toHaveTextContent('Compare the claim');
    // The card carries the ink of the mark it hangs off, which is the visual
    // link between a note and its source.
    expect(column.querySelector('[data-sat-note-ink]')).toHaveAttribute('data-sat-note-ink', 'pink');
    expect(column.querySelector('[data-sat-notes-empty]')).toBeNull();
  });

  it('coaches an empty Notes column instead of floating a detached pill', () => {
    render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: /^Highlights & Notes/ }));
    // What the column is, then the one gesture that fills it — no dashed box and
    // no call to action standing in for a heading.
    const empty = document.querySelector('[data-sat-notes-empty]')!;
    expect(empty).toHaveTextContent('No notes yet');
    expect(empty).toHaveTextContent('Select text in the passage, then choose Add note.');
    // The "Select any text" balloon is gone: teaching lives in the passage.
    expect(document.querySelector('[data-sat-select-text-coach]')).toBeNull();
  });

  it('shows the passive first-use hint in the passage, and retires it on the gesture alone', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<SatAccessibilityDebugRoute />);
      // Nothing appears on load: the hint is an aside, not an alert.
      expect(document.querySelector('[data-sat-annotation-hint]')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      // It sits in the passage it is about, not pinned to the tool entry.
      const hint = document.querySelector('[data-sat-annotation-hint]')!;
      expect(hint).toHaveTextContent('Select text to highlight or add a note');
      expect(hint.closest('[data-sat-passage-scroll]')).not.toBeNull();
      // Time passing is not a lesson: the line waits for the student instead of
      // retiring itself, which is what let slow readers miss it entirely.
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(document.querySelector('[data-sat-annotation-hint]')).not.toBeNull();
      // Demonstrating the gesture is the whole lesson: the hint never returns.
      selectStimulusText(container, 'Several');
      expect(document.querySelector('[data-sat-annotation-hint]')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(document.querySelector('[data-sat-annotation-hint]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('teaches at once when the student opens Highlights & Notes', () => {
    vi.useFakeTimers();
    try {
      render(<SatAccessibilityDebugRoute />);
      expect(document.querySelector('[data-sat-annotation-hint]')).toBeNull();
      // Pressing the tool is a direct request for it, so the lesson is already on
      // screen — no delay to sit through, and no selection required first.
      fireEvent.click(screen.getByRole('button', { name: /^Highlights & Notes/ }));
      expect(screen.getByRole('complementary', { name: 'Notes' })).toBeInTheDocument();
      expect(document.querySelector('[data-sat-annotation-hint]')).toHaveTextContent('Select text to highlight or add a note');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the question’s own note the same undo as a note on the passage', async () => {
    render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: /^Highlights & Notes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add question note' }));
    const field = await screen.findByRole('textbox', { name: 'This question' });
    fireEvent.change(field, { target: { value: 'The control condition' } });
    fireEvent.blur(field);
    await waitFor(() => expect(screen.getByTestId('sat-note-saved')).toBeInTheDocument());

    // One removal path covers both card kinds, so the question's note is not the
    // one place where writing still disappears on a single press.
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    expect(await screen.findByTestId('sat-undo-toast')).toHaveTextContent('Note removed');
    expect(screen.getByRole('textbox', { name: 'This question' })).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('textbox', { name: 'This question' })).toHaveValue('The control condition');
    expect(screen.queryByTestId('sat-undo-toast')).not.toBeInTheDocument();
  });

  it('removes a note’s words but not its mark, and puts them back with Undo', async () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    highlight(container, 'Several', 'Blue');
    const bare = container.querySelector('[data-sat-highlight="true"]')!;
    expect(bare).not.toHaveAttribute('data-sat-annotation-note');

    fireEvent.click(bare);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const field = await screen.findByRole('textbox', { name: 'Notes' });
    fireEvent.change(field, { target: { value: 'Cooler after the trees' } });
    fireEvent.blur(field);
    await waitFor(() => expect(screen.getByTestId('sat-note-saved')).toBeInTheDocument());

    // The mark reports that it carries a note — nothing is drawn into the
    // sentence for it, and no pane had to open to say so.
    const written = container.querySelector('[data-sat-highlight="true"]')!;
    expect(written).toHaveAttribute('data-sat-annotation-note', 'true');
    // Nothing is drawn into the sentence for a note: the mark reports it, and the
    // pane the student is already looking at shows it.
    expect(container.querySelector('[data-sat-note-mark]')).toBeNull();
    expect(await screen.findByRole('complementary', { name: 'Notes' })).toHaveTextContent('Cooler after the trees');

    // Removing a note discards up to two thousand characters, so it gets the same
    // forgiveness as deleting a mark instead of being final on one press.
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    const toast = await screen.findByTestId('sat-undo-toast');
    expect(toast).toHaveTextContent('Note removed');
    const cleared = container.querySelector('[data-sat-highlight="true"]')!;
    expect(cleared).not.toHaveAttribute('data-sat-annotation-note');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    const restored = container.querySelector('[data-sat-highlight="true"]')!;
    expect(restored).toHaveAttribute('data-sat-annotation-note', 'true');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Cooler after the trees'));
  });
});

describe('SAT annotation Bluebook surfaces (Phase 7)', () => {
  it('writes notes in a structural column: no modal, no scrim, exam still usable', async () => {
    stubWideViewport();
    const { container } = render(<SatAccessibilityDebugRoute />);
    selectStimulusText(container, 'Several');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const field = await screen.findByRole('textbox', { name: 'Notes' });
    fireEvent.change(field, { target: { value: 'Compare the two blocks' } });

    // Adding a note is the student's own request, so the column may take layout
    // space for it — while a highlight alone never does.
    const column = screen.getByRole('complementary', { name: 'Notes' });
    const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;
    // A member of the passage/question grid, so adding a note moves nothing and
    // the source it quotes stays on screen next to it — and the question stays
    // available while the student writes, because notes support the task rather
    // than interrupting it.
    expect(layout).toHaveAttribute('data-sat-notes-placement', 'column');
    expect(column.closest('[data-sat-reading-split]')).not.toBeNull();
    expect(container.querySelector('[data-sat-question-scroll]')).not.toBeNull();
    // Exactly one column, and it is a direct member of that grid.
    expect(document.querySelectorAll('[data-sat-notes-column]')).toHaveLength(1);
    expect(column.parentElement).toBe(layout);
    // Nothing dims the exam, and no modal takes the work hostage.
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(document.querySelector('.bg-black\\/20')).toBeNull();
  });

  it('leaves nothing in the middle until there is a note, then a handle that brings it back', async () => {
    stubWideViewport();
    const { container } = render(<SatAccessibilityDebugRoute />);
    const trigger = screen.getByRole('button', { name: /^Highlights & Notes/ });
    fireEvent.click(trigger);
    expect(await screen.findByRole('complementary', { name: 'Notes' })).toBeInTheDocument();
    const layout = container.querySelector<HTMLElement>('[data-sat-reading-split]')!;

    // Nothing written yet: hiding leaves nothing behind, because a handle promises
    // something to come back to and there is nothing yet. The middle of the exam
    // holds no notes-shaped furniture — and the caret still lands somewhere useful
    // rather than on <body>, because the labeled entry that opened the pane is the
    // one way back that exists.
    fireEvent.click(screen.getByRole('button', { name: 'Hide notes' }));
    expect(screen.queryByRole('complementary', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show notes' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    // Marking text is not writing about it: a highlight on its own still leaves the
    // middle alone, which is the state a student who only highlights lives in.
    highlight(container, 'Several', 'Blue');
    expect(screen.queryByRole('button', { name: 'Show notes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Notes' })).not.toBeInTheDocument();

    // One written note and the handle exists: what took the pane's place says, in
    // words, that the pane can come back — and it stands exactly where the pane was,
    // so the reversal is found by looking at the edge it was lost from rather than
    // by searching the toolbar.
    selectStimulusText(container, 'Several');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const field = await screen.findByRole('textbox', { name: 'Notes' });
    fireEvent.change(field, { target: { value: 'Compare the claim' } });
    fireEvent.blur(field);
    // Hiding mid-edit returns the caret to the words the note is about, which is
    // where the student was working — not to a control somewhere else.
    fireEvent.click(screen.getByRole('button', { name: 'Hide notes' }));
    const mark = container.querySelector<HTMLElement>('[data-sat-highlight="true"]')!;
    await waitFor(() => expect(mark).toHaveFocus());

    // The note survived the trip, and now there is something to come back to:
    // hiding the list itself leaves the handle in the pane's own seat with the
    // caret on it, so a keyboard student can undo the hide with the next press.
    fireEvent.click(trigger);
    expect(await screen.findByRole('complementary', { name: 'Notes' })).toHaveTextContent('Compare the claim');
    fireEvent.click(screen.getByRole('button', { name: 'Hide notes' }));
    const rail = screen.getByRole('button', { name: 'Show notes' });
    expect(rail).toHaveTextContent('Notes');
    expect(layout).toContainElement(rail);
    await waitFor(() => expect(rail).toHaveFocus());

    fireEvent.click(rail);
    expect(await screen.findByRole('complementary', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show notes' })).not.toBeInTheDocument();
  });

  it('keeps every annotation ink a token, never a literal in the copy-free palette', () => {
    const css = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');
    expect(css).toContain('--sat-highlight-background');
    expect(css).toContain('--sat-highlight-bg-blue');
    expect(css).toContain('--sat-highlight-bg-pink');
    expect(css).toContain('--sat-swatch-yellow');
    // Selection preview + entrance motion stay tokenized too.
    expect(css).toContain('--sat-selection-color');
    expect(css).toContain('--sat-motion-annotation');
    expect(css).toContain('sat-annotation-enter');
  });
});
