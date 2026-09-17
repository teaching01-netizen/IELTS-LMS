import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSatTextAnnotation } from '../../domain/satResponses';
import { SatAnnotationEditDock } from './SatAnnotationEditDock';
import { SatSelectionActionsPanel } from './SatSelectionActionsPanel';

const anchor = { nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' };

function actions() {
  return { highlight: vi.fn(), underline: vi.fn(), addNote: vi.fn() };
}

/** The props a dismissal needs wherever a popover is rendered. */
const closeProps = { onClose: vi.fn() };

// Only these two module-level gesture caches can leak between tests.
describe('desktop selection panel', () => {
  it('names the group and labels every action, never showing a bare dot', () => {
    const on = actions();
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={on} variant="floating" {...closeProps} />);
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
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} variant="floating" {...closeProps} />);
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
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={on} variant="floating" {...closeProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight Pink' }));
    expect(on.highlight).toHaveBeenCalledWith(anchor, 'pink');
    fireEvent.click(screen.getByRole('button', { name: 'Underline' }));
    expect(on.underline).toHaveBeenCalledWith(anchor);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(on.addNote).toHaveBeenCalledWith(anchor);
  });

  it('lands the caret on the first action, never on the way out', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="blue" actions={actions()} variant="floating" {...closeProps} />);
    const yellow = screen.getByRole('button', { name: 'Highlight Yellow' });
    const blue = screen.getByRole('button', { name: 'Highlight Blue' });
    // Focus starts on the primary action so Enter highlights immediately — and
    // not on "Close text tools", which would make the first keystroke after
    // selecting text throw the tools away.
    expect(document.activeElement).toBe(yellow);
    expect(screen.getByRole('button', { name: 'Close text tools' })).toBeInTheDocument();
    // The pressed swatch stays the remembered ink: it tells the student what
    // their next highlight will use before they act.
    expect(blue).toHaveAttribute('aria-pressed', 'true');
    expect(yellow).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(yellow, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(blue);
  });

  it('offers a written way out, and closing touches nothing', () => {
    const onClose = vi.fn();
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} variant="floating" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close text tools' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Close text tools' })).toHaveAttribute('data-sat-annotation-dismiss', 'true');
  });

  it('disables every action while the exam is blocked', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} variant="floating" disabled {...closeProps} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });
});

describe('touch dock', () => {
  it('quotes the selected passage so the tools are visibly attached to it', () => {
    const on = actions();
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={on} variant="docked" {...closeProps} />);
    expect(document.querySelector('[data-sat-dock-quote="true"]')).toHaveTextContent('tree');
    expect(document.querySelector('[data-sat-touch-dock="true"]')).not.toBeNull();
    expect(document.querySelector('[data-sat-selection-toolbar="true"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Highlight Blue' }));
    expect(on.highlight).toHaveBeenCalledWith(anchor, 'blue');
  });
});

describe('presentation parity', () => {
  it('keeps the same actions in the same order whether it floats or docks', () => {
    const order = () =>
      screen.getAllByRole('button').map((button) => button.getAttribute('data-sat-annotation-action'));
    const { unmount } = render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} variant="floating" {...closeProps} />);
    const floating = order();
    unmount();
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} variant="docked" {...closeProps} />);
    // A docked sheet is the same tool moved, never a rearranged one: muscle
    // memory has to survive the presentation change in the middle of an exam.
    expect(order()).toEqual(floating);
    expect(floating).toEqual(['close', 'highlight-yellow', 'highlight-blue', 'highlight-pink', 'underline', 'note']);
  });
});

describe('edit dock', () => {
  const mark = createSatTextAnnotation({
    kind: 'highlight', nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree', color: 'pink', note: 'Check this',
  });
  /** What every render of the dock needs beyond the mark itself. */
  const base = { onClose: vi.fn() };

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
        {...base}
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
      <SatAnnotationEditDock annotation={bare} touch onColor={vi.fn()} onUnderline={vi.fn()} onNote={vi.fn()} onRemove={vi.fn()} {...base} />,
    );
    expect(screen.getByRole('button', { name: 'Add note' })).toHaveTextContent('Add note');
    expect(screen.getByRole('button', { name: 'Remove underline' })).toBeInTheDocument();
    // Opening a mark's editor moves the caret into it, so the keyboard never
    // has to hunt for the controls the tap just revealed — and never onto the
    // dismissal, which would throw the tools away on the next keystroke.
    const dock = screen.getByRole('toolbar', { name: 'Edit annotation' });
    expect(dock.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Highlight Yellow' }));
  });

  it('hands writing to the pane instead of holding an editor of its own', () => {
    const onNote = vi.fn();
    const onRemove = vi.fn();
    render(
      <SatAnnotationEditDock
        annotation={{ ...mark, note: undefined }}
        touch={false}
        onColor={vi.fn()}
        onUnderline={vi.fn()}
        onNote={onNote}
        onRemove={onRemove}
        {...base}
      />,
    );
    // One note has one editor: this dock changes the mark and asks the Notes pane
    // to open the note, so a student never sees two textareas for the same words
    // — and never has to guess which one is saving.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(onNote).toHaveBeenCalledOnce();
    // Asking for a note is not touching the mark.
    expect(onRemove).not.toHaveBeenCalled();
  });
});
