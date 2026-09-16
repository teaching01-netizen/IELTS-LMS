import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSatTextAnnotation } from '../../domain/satResponses';
import { SatAnnotationEditDock } from './SatAnnotationEditDock';
import { SatSelectionActionsPanel } from './SatSelectionActionsPanel';

const anchor = { nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' };

function actions() {
  return { highlight: vi.fn(), underline: vi.fn(), addNote: vi.fn() };
}

// Only these two module-level gesture caches can leak between tests.
describe('desktop selection panel', () => {
  it('names the group and labels every action, never showing a bare dot', () => {
    const on = actions();
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={on} variant="floating" />);
    const toolbar = screen.getByRole('toolbar', { name: 'Selected text actions' });
    // The heading is what connects "selected text" to "highlight" with no tutorial.
    expect(toolbar).toHaveTextContent('Highlight');
    for (const label of ['Highlight Yellow', 'Highlight Blue', 'Highlight Pink']) {
      expect(screen.getByRole('button', { name: label })).toHaveTextContent(label.replace('Highlight ', ''));
    }
    // Visible words and accessible names come from the same copy table.
    expect(screen.getByRole('button', { name: 'Underline' })).toHaveTextContent('Underline');
    expect(screen.getByRole('button', { name: 'Add note' })).toHaveTextContent('Add note');
  });

  it('keeps every action at a 44px touch target with a small visual swatch', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} variant="floating" />);
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-[44px]');
      expect(button.className).toContain('min-w-[44px]');
    }
    const swatch = document.querySelector('[data-sat-swatch="yellow"]')!;
    expect(swatch.className).toContain('h-[20px]');
    expect(swatch.className).toContain('w-[20px]');
  });

  it('applies the tapped ink to the live anchor and dismisses nothing else', () => {
    const on = actions();
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={on} variant="floating" />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight Pink' }));
    expect(on.highlight).toHaveBeenCalledWith(anchor, 'pink');
    fireEvent.click(screen.getByRole('button', { name: 'Underline' }));
    expect(on.underline).toHaveBeenCalledWith(anchor);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(on.addNote).toHaveBeenCalledWith(anchor);
  });

  it('lands the caret on the first action so a keyboard student can act at once', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="blue" actions={actions()} variant="floating" />);
    const [yellow, blue] = screen.getAllByRole('button');
    // Focus starts on the primary action so Enter highlights immediately...
    expect(document.activeElement).toBe(yellow);
    // ...while the pressed swatch stays the remembered ink: it tells the
    // student what their next highlight will use before they act.
    expect(blue).toHaveAttribute('aria-pressed', 'true');
    expect(yellow).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(yellow!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(blue);
  });

  it('disables every action while the exam is blocked', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} variant="floating" disabled />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });
});

describe('touch dock', () => {
  it('quotes the selected passage so the tools are visibly attached to it', () => {
    const on = actions();
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={on} variant="docked" />);
    expect(document.querySelector('[data-sat-dock-quote="true"]')).toHaveTextContent('tree');
    expect(document.querySelector('[data-sat-touch-dock="true"]')).not.toBeNull();
    expect(document.querySelector('[data-sat-selection-toolbar="true"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Highlight Blue' }));
    expect(on.highlight).toHaveBeenCalledWith(anchor, 'blue');
  });
});

describe('edit dock', () => {
  const mark = createSatTextAnnotation({
    kind: 'highlight', nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree', color: 'pink', note: 'Check this',
  });

  it('shows the current ink pressed, offers the note edit, and separates removal', () => {
    const onColor = vi.fn();
    const onRemove = vi.fn();
    const onNote = vi.fn();
    render(
      <SatAnnotationEditDock
        annotation={mark}
        touch={false}
        onColor={onColor}
        onUnderline={vi.fn()}
        onNote={onNote}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByRole('button', { name: 'Highlight Pink' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Highlight Yellow' })).toHaveAttribute('aria-pressed', 'false');
    // Recolour is one tap on the existing mark: never delete-then-redraw.
    fireEvent.click(screen.getByRole('button', { name: 'Highlight Blue' }));
    expect(onColor).toHaveBeenCalledWith('blue');
    // The note action explains its own state without documentation.
    expect(screen.getByRole('button', { name: 'Edit note' })).toHaveTextContent('Edit note');
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    expect(onNote).toHaveBeenCalledOnce();
    // Removal sits in its own row, visually apart from the colours.
    fireEvent.click(screen.getByRole('button', { name: 'Remove highlight' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('asks to add a note on a bare mark and names removal after the mark kind', () => {
    const bare = createSatTextAnnotation({ kind: 'underline', nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' });
    render(
      <SatAnnotationEditDock annotation={bare} touch onColor={vi.fn()} onUnderline={vi.fn()} onNote={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Add note' })).toHaveTextContent('Add note');
    expect(screen.getByRole('button', { name: 'Remove underline' })).toBeInTheDocument();
    // Opening a mark's editor moves the caret into it, so the keyboard never
    // has to hunt for the controls the tap just revealed.
    const dock = screen.getByRole('toolbar', { name: 'Edit annotation' });
    expect(dock.contains(document.activeElement)).toBe(true);
  });
});
