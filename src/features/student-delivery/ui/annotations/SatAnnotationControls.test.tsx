import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSatTextAnnotation } from '../../domain/satResponses';
import { SatAnnotationEditControls } from './SatAnnotationEditControls';
import { SatSelectionActionsPanel } from './SatSelectionActionsPanel';

const anchor = { nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' };
const environment = { coarsePointer: false, nativeSelectionUi: false };

function actions() {
  return { highlight: vi.fn(), underline: vi.fn(), addNote: vi.fn() };
}

/** The props a dismissal needs wherever a popover is rendered. */
const closeProps = { onClose: vi.fn(), environment };

/** Every action's marker, in the order the surface renders them. */
function actionOrder(): Array<string | null> {
  return screen.getAllByRole('button').map((button) => button.getAttribute('data-sat-annotation-action'));
}

describe('desktop selection panel', () => {
  it('names the group and labels every action, never showing a bare dot', () => {
    const on = actions();
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={on} {...closeProps} />);
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
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} {...closeProps} />);
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
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={on} {...closeProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight Pink' }));
    expect(on.highlight).toHaveBeenCalledWith(anchor, 'pink');
    fireEvent.click(screen.getByRole('button', { name: 'Underline' }));
    expect(on.underline).toHaveBeenCalledWith(anchor);
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(on.addNote).toHaveBeenCalledWith(anchor);
  });

  it('lands the caret on the first action, never on the way out', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="blue" actions={actions()} {...closeProps} />);
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
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} environment={environment} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close text tools' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Close text tools' })).toHaveAttribute('data-sat-annotation-dismiss', 'true');
  });

  it('disables every action while the exam is blocked', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} disabled {...closeProps} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('puts the dismissal last, in the bottom row, beside the secondary actions', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} {...closeProps} />);
    const close = screen.getByRole('button', { name: 'Close text tools' });
    const row = close.parentElement!;
    // Nothing comes after the way out: it is the last control in the surface, so
    // "bottom right corner" is a property of the markup and not of a stylesheet
    // someone can reorder later.
    expect(actionOrder().at(-1)).toBe('close');
    const body = document.querySelector('[data-sat-annotation-surface-body="true"]')!;
    expect(body).toContainElement(row);
    expect(body.lastElementChild).toBe(row);
    // Same row as the secondary actions, at the far end of it.
    expect(row).toContainElement(screen.getByRole('button', { name: 'Underline' }));
    expect(row).toContainElement(screen.getByRole('button', { name: 'Add note' }));
    expect(row.className).toContain('justify-between');
    // And the inks stay above it, where the primary action belongs.
    expect(actionOrder()).toEqual([
      'highlight-yellow', 'highlight-blue', 'highlight-pink', 'underline', 'note', 'close',
    ]);
  });

  it('scrolls its own rows inside the bound the placement measured', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} {...closeProps} />);
    // The body is what scrolls; the surface itself does not, because a scroll
    // container would clip the caret that sits outside its border box.
    const body = document.querySelector('[data-sat-annotation-surface-body="true"]')!;
    expect(body.className).toContain('overflow-y-auto');
    const toolbar = screen.getByRole('toolbar', { name: 'Selected text actions' });
    expect(toolbar.className).not.toContain('overflow-y-auto');
  });
});

describe('edit controls', () => {
  const mark = createSatTextAnnotation({
    kind: 'highlight', nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree', color: 'pink', note: 'Check this',
  });
  /** What every render of the mark's controls needs beyond the mark itself. */
  const base = { onClose: vi.fn(), environment };

  it('shows the current ink pressed, offers the note edit, and separates removal', () => {
    const onColor = vi.fn();
    const onRemove = vi.fn();
    const onNote = vi.fn();
    render(
      <SatAnnotationEditControls
        annotation={mark}
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
    // Removal keeps its own row, visually apart from the colours.
    fireEvent.click(screen.getByRole('button', { name: 'Remove highlight' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('asks to add a note on a bare mark and names removal after the mark kind', () => {
    const bare = createSatTextAnnotation({ kind: 'underline', nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' });
    render(
      <SatAnnotationEditControls annotation={bare} onColor={vi.fn()} onUnderline={vi.fn()} onNote={vi.fn()} onRemove={vi.fn()} {...base} />,
    );
    expect(screen.getByRole('button', { name: 'Add note' })).toHaveTextContent('Add note');
    expect(screen.getByRole('button', { name: 'Remove underline' })).toBeInTheDocument();
    // Opening a mark's controls moves the caret into them, so the keyboard never
    // has to hunt for what the tap just revealed — and never onto the dismissal,
    // which would throw the controls away on the next keystroke.
    const controls = screen.getByRole('toolbar', { name: 'Edit annotation' });
    expect(controls.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Highlight Yellow' }));
    expect(controls.getAttribute('data-sat-annotation-edit-controls')).toBe('true');
  });

  it('hands writing to the pane instead of holding an editor of its own', () => {
    const onNote = vi.fn();
    const onRemove = vi.fn();
    render(
      <SatAnnotationEditControls
        annotation={{ ...mark, note: undefined }}
        onColor={vi.fn()}
        onUnderline={vi.fn()}
        onNote={onNote}
        onRemove={onRemove}
        {...base}
      />,
    );
    // One note has one editor: these controls change the mark and ask the Notes
    // pane to open the note, so a student never sees two textareas for the same
    // words — and never has to guess which one is saving.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(onNote).toHaveBeenCalledOnce();
    // Asking for a note is not touching the mark.
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('keeps the dismissal at the far end of the removal row', () => {
    render(
      <SatAnnotationEditControls annotation={mark} onColor={vi.fn()} onUnderline={vi.fn()} onNote={vi.fn()} onRemove={vi.fn()} {...base} />,
    );
    const close = screen.getByRole('button', { name: 'Close text tools' });
    const remove = screen.getByRole('button', { name: 'Remove highlight' });
    // One row: the destructive action at one end, the way out at the other, and
    // the way out is the last control in the surface.
    expect(close.parentElement).toBe(remove.parentElement);
    expect(close.parentElement!.className).toContain('justify-between');
    expect(actionOrder().at(-1)).toBe('close');
    // Both stay reachable and apart: a thumb reaching for one cannot land on the
    // other by accident.
    expect(close.parentElement!.contains(remove)).toBe(true);
  });
});
