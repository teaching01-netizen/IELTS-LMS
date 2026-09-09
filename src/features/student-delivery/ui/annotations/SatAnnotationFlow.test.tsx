import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SatAccessibilityDebugRoute } from '../../../../app/router/dev/SatAccessibilityDebugRoute';

describe('SAT shell annotation flow', () => {
  it('changes exam zoom and contrast independently from text size', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Reading' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase exam zoom' }));
    fireEvent.click(screen.getByRole('button', { name: 'High contrast' }));
    expect(screen.getByTestId('sat-exam-shell')).toHaveAttribute('data-sat-contrast', 'high-contrast');
    expect(container.querySelector('[data-sat-content-zoom]')).toHaveAttribute('data-sat-content-zoom', '1.25');
    expect(container.querySelector('[data-sat-reading-split]')).toHaveStyle('--sat-reading-scale: 1');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(container.querySelector('[data-sat-content-zoom]')).toHaveAttribute('data-sat-content-zoom', '1');
    expect(screen.getByTestId('sat-exam-shell')).toHaveAttribute('data-sat-contrast', 'default');
  });
  it('lets the student move the line reader by keyboard and dismiss it with Escape', () => {
    render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Line Reader' }));
    const reader = screen.getByRole('slider', { name: 'Reading line position' });
    const initial = Number(reader.getAttribute('aria-valuenow'));
    fireEvent.keyDown(reader, { key: 'ArrowDown' });
    expect(Number(reader.getAttribute('aria-valuenow'))).toBeGreaterThan(initial);
    fireEvent.keyDown(reader, { key: 'Escape' });
    expect(screen.queryByRole('slider', { name: 'Reading line position' })).not.toBeInTheDocument();
  });
  it('uses Notes mode to attach an editable note to selected text', async () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-pressed', 'true');
    const leaf = container.querySelector('[data-sat-annotation-region="stimulus"] [data-content-text-node] span span')!.firstChild!;
    const range = document.createRange();
    range.setStart(leaf, 0); range.setEnd(leaf, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.pointerUp(leaf.parentElement!);
    fireEvent.change(screen.getByRole('textbox', { name: 'Note for selected text' }), { target: { value: 'Check the evidence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notes' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Edit note: Several' }));
    expect(screen.getByRole('textbox', { name: 'Note for selected text' })).toHaveValue('Check the evidence');
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
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
  it('erases a highlight via Eraser mode and exits erase on Escape', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'false');
    selectFirstWord();
    expect(container.querySelectorAll('[data-sat-highlight="true"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'false');
    selectFirstWord();
    expect(container.querySelectorAll('[data-sat-highlight="true"]')).toHaveLength(0);
  });
  it('erases with the keyboard (shift+arrows then keyup) while erase is armed', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    const leaf = container.querySelector('[data-sat-annotation-region="stimulus"] [data-content-text-node] span span')!.firstChild!;
    const seed = document.createRange();
    seed.setStart(leaf, 0); seed.setEnd(leaf, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(seed);
    fireEvent.pointerUp(leaf.parentElement!);
    expect(container.querySelector('[data-sat-highlight="true"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    const again = document.createRange();
    again.setStart(leaf, 0); again.setEnd(leaf, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(again);
    fireEvent.keyUp(document, { key: 'ArrowRight', shiftKey: true });
    expect(container.querySelectorAll('[data-sat-highlight="true"]')).toHaveLength(0);
  });
});
