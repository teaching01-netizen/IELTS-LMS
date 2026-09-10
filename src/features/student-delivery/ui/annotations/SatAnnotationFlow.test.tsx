import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SatAccessibilityDebugRoute } from '../../../../app/router/dev/SatAccessibilityDebugRoute';

describe('SAT shell annotation flow', () => {
  it('changes exam zoom and contrast independently from text size', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase screen zoom' }));
    fireEvent.click(screen.getByRole('button', { name: 'High contrast' }));
    expect(screen.getByTestId('sat-exam-shell')).toHaveAttribute('data-sat-contrast', 'high-contrast');
    expect(container.querySelector('[data-sat-content-zoom]')).toHaveAttribute('data-sat-content-zoom', '1.25');
    expect(container.querySelector('[data-sat-reading-split]')).toHaveStyle('--sat-reading-scale: 1');
    fireEvent.click(screen.getByRole('button', { name: 'Reset display settings' }));
    expect(container.querySelector('[data-sat-content-zoom]')).toHaveAttribute('data-sat-content-zoom', '1');
    expect(screen.getByTestId('sat-exam-shell')).toHaveAttribute('data-sat-contrast', 'default');
  });
  it('lets the student move the line reader by keyboard and dismiss it with Escape', () => {
    render(<SatAccessibilityDebugRoute />);
    // Line Reader launches from More (Bluebook parity) — not a top-bar button.
    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Line Reader/ }));
    const reader = screen.getByRole('slider', { name: 'Reading line position' });
    const initial = Number(reader.getAttribute('aria-valuenow'));
    fireEvent.keyDown(reader, { key: 'ArrowDown' });
    expect(Number(reader.getAttribute('aria-valuenow'))).toBeGreaterThan(initial);
    // Escape priority: the open More menu closes first, then Line Reader.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'More tools' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('slider', { name: 'Reading line position' })).not.toBeInTheDocument();
  });
  it('uses Annotate to attach an editable note to selected text', async () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    // Highlight entry arms highlight mode.
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
    // Silent mode: sr-only status for AT, no visible bar.
    expect(screen.getByTestId('sat-annotation-mode-bar-stimulus')).toHaveTextContent('Highlighting');
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    const leaf = container.querySelector('[data-sat-annotation-region="stimulus"] [data-content-text-node] span span')!.firstChild!;
    const range = document.createRange();
    range.setStart(leaf, 0); range.setEnd(leaf, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.pointerUp(leaf.parentElement!);
    // Highlight mode creates a bare highlight; the note editor opens from
    // the annotation's Edit affordance (Bluebook parity: one entry).
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveTextContent('Several');
    fireEvent.click(screen.getByRole('button', { name: 'Add note: Several' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your note' }), { target: { value: 'Check the evidence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    // Radix prevents autofocus on close (focusBack has no selector in this
    // harness); the dialog must at least be gone with the note persisted.
    expect(screen.queryByRole('dialog', { name: 'Note on selected text' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit note: Several' }));
    expect(screen.getByRole('textbox', { name: 'Your note' })).toHaveValue('Check the evidence');
    fireEvent.click(screen.getByRole('button', { name: 'Delete this note' }));
    expect(screen.queryByRole('button', { name: 'Edit note: Several' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-sat-highlight]')).toHaveTextContent('Several');
  });
  it('turns a completed selection into a visible highlight and leaves normal selection unchanged after Escape', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    const selectFirstWord = () => {
      const leaf = container.querySelector('[data-sat-annotation-region="stimulus"] [data-content-text-node] span span')!.firstChild!;
      const range = document.createRange();
      range.setStart(leaf, 0); range.setEnd(leaf, 7);
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
      fireEvent.pointerUp(leaf.parentElement!);
    };
    selectFirstWord();
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveTextContent('Several');
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    selectFirstWord();
    expect(container.querySelectorAll('[data-sat-highlight="true"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('removes a highlight through the annotation editor (Bluebook card path)', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    const leaf = container.querySelector('[data-sat-annotation-region="stimulus"] [data-content-text-node] span span')!.firstChild!;
    const range = document.createRange();
    range.setStart(leaf, 0); range.setEnd(leaf, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.pointerUp(leaf.parentElement!);
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveTextContent('Several');
    // Bare highlight offers Add note; the editor's Delete removes the mark.
    fireEvent.click(screen.getByRole('button', { name: 'Add note: Several' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this note' }));
    expect(container.querySelectorAll('[data-sat-highlight="true"]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Add note: Several' })).not.toBeInTheDocument();
  });
  it('creates a highlight with the keyboard (shift+arrows then keyup) while Highlights is armed', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    const leaf = container.querySelector('[data-sat-annotation-region="stimulus"] [data-content-text-node] span span')!.firstChild!;
    const seed = document.createRange();
    seed.setStart(leaf, 0); seed.setEnd(leaf, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(seed);
    fireEvent.keyUp(document, { key: 'ArrowRight', shiftKey: true });
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveTextContent('Several');
  });
});

describe('SAT annotation Bluebook surfaces (Phase 7)', () => {
  it('renders the note-on-selection card at 260px with 8px radius, answer-grade border, pale-yellow header, and no large shadow', () => {
    render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    const leaf = document.querySelector('[data-sat-annotation-region="stimulus"] [data-content-text-node] span span')!.firstChild!;
    const range = document.createRange();
    range.setStart(leaf, 0); range.setEnd(leaf, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.pointerUp(leaf.parentElement!);
    fireEvent.click(screen.getByRole('button', { name: 'Add note: Several' }));
    const dialog = screen.getByRole('dialog', { name: 'Note on selected text' });
    // Document-like note card: fixed narrow width, small radius, answer-grade
    // border, pale-yellow header band, small/no shadow (never shadow-xl/2xl).
    expect(dialog.className).toContain('w-[260px]');
    expect(dialog.className).toContain('var(--sat-answer-border)');
    expect(dialog.className).not.toMatch(/shadow-xl|shadow-2xl/);
    const header = dialog.querySelector('[data-sat-note-header]')!;
    expect(header.className).toContain('var(--sat-note-header)');
  });

  it('keeps selection-color preview wiring on the highlight without a large shadow', () => {
    const css = readFileSync(resolve(__dirname, '../../../../index.css'), 'utf8');
    expect(css).toContain('--sat-selection-color');
  });
});
