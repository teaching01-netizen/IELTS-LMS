import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

afterEach(() => {
  window.localStorage.clear();
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
    // Acting dismisses the tools: the mark itself is the feedback now.
    expect(screen.queryByRole('toolbar', { name: 'Selected text actions' })).not.toBeInTheDocument();
    expect(screen.getByTestId('sat-annotation-announcement')).toHaveTextContent('Text highlighted blue.');
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

  it('attaches a note to the selection, opening the card focused with a human placeholder', async () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    selectStimulusText(container, 'Several');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    // Choosing "Add note" leaves a visible mark behind: a note without a source
    // would be unfindable later.
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveTextContent('Several');
    const field = await screen.findByRole('textbox', { name: 'Your note' });
    expect(field).toHaveAttribute('placeholder', 'Add a quick note…');
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, { target: { value: 'Remember this claim' } });
    // Autosave, then the quiet confirmation that no Save button is needed.
    await waitFor(() => expect(screen.getByTestId('sat-note-saved')).toHaveTextContent('Saved'), { timeout: 3000 });
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

  it('edits the note of an existing mark and keeps the quoted source linked by ink', async () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    highlight(container, 'Several', 'Blue');
    fireEvent.click(container.querySelector('[data-sat-highlight="true"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const field = await screen.findByRole('textbox', { name: 'Your note' });
    fireEvent.change(field, { target: { value: 'Check the evidence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    // Reopening shows the saved note under the quoted source.
    fireEvent.click(container.querySelector('[data-sat-highlight="true"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    expect(await screen.findByRole('textbox', { name: 'Your note' })).toHaveValue('Check the evidence');
    expect(screen.getByRole('dialog', { name: 'Note on selected text' })).toHaveTextContent('Selected text: Several');
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

  it('lists anchored notes in the Notes panel with their ink and quoted source', async () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    highlight(container, 'Several', 'Pink');
    fireEvent.click(container.querySelector('[data-sat-highlight="true"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const field = await screen.findByRole('textbox', { name: 'Your note' });
    fireEvent.change(field, { target: { value: 'Compare the claim' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    // The top-bar entry keeps its label; the annotation dot appends a spoken
    // suffix, so match the label prefix rather than the whole name.
    fireEvent.click(screen.getByRole('button', { name: /^Highlights & Notes/ }));
    const list = document.querySelector('[data-sat-notes-list="true"]')!;
    expect(list).toHaveTextContent('Several');
    expect(list).toHaveTextContent('Compare the claim');
    expect(document.querySelector('[data-sat-notes-empty]')).toBeNull();
  });

  it('coaches an empty Notes panel instead of showing an empty list', () => {
    render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: /^Highlights & Notes/ }));
    expect(document.querySelector('[data-sat-notes-empty]')).toHaveTextContent('No notes yet');
    expect(document.querySelector('[data-sat-select-text-coach]')).toHaveTextContent('Select any text');
  });

  it('shows the passive first-use hint once per attempt, then retires it on selection', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<SatAccessibilityDebugRoute />);
      // Nothing appears on load: the hint is an aside, not an alert.
      expect(document.querySelector('[data-sat-annotation-hint]')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(document.querySelector('[data-sat-annotation-hint]')).toHaveTextContent('Select text to highlight');
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
});

describe('SAT annotation Bluebook surfaces (Phase 7)', () => {
  it('renders the note card at 260px with 8px radius, answer-grade border, pale-yellow header, and no large shadow', async () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    selectStimulusText(container, 'Several');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const dialog = await screen.findByRole('dialog', { name: 'Note on selected text' });
    // Document-like note card: fixed narrow width, small radius, answer-grade
    // border, pale-yellow header band, small/no shadow (never shadow-xl/2xl).
    expect(dialog.className).toContain('w-[260px]');
    expect(dialog.className).toContain('var(--sat-answer-border)');
    expect(dialog.className).not.toMatch(/shadow-xl|shadow-2xl/);
    const header = dialog.querySelector('[data-sat-note-header]')!;
    expect(header.className).toContain('var(--sat-note-header)');
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
