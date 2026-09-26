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
const closeProps = { onClose: vi.fn(), environment, currentUnderlineStyle: 'solid' as const };

/** Every action's marker, in the order the surface renders them. */
function actionOrder(): Array<string | null> {
  return screen.getAllByRole('button').map((button) => button.getAttribute('data-sat-annotation-action'));
}

describe('desktop selection panel', () => {
  it('draws the reference bar: one icon row, no heading, and no visible words', () => {
    const on = actions();
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={on} {...closeProps} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Selected text actions' });
    // The bar hangs off the selected words, so the relationship is spatial: a
    // heading would only add height to a surface the student reads past. The
    // bare "U" is the underline glyph itself, not a label for it.
    expect(toolbar.textContent).toBe('U');
    for (const word of ['Highlight', 'Underline', 'Add note', 'Close']) {
      expect(toolbar.textContent).not.toContain(word);
    }
    for (const label of ['Highlight Yellow', 'Highlight Blue', 'Highlight Pink']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    // The underline and the note are the same row, one press each.
    expect(actionOrder()).toEqual([
      'highlight-yellow', 'highlight-blue', 'highlight-pink', 'underline', 'underline-style', 'note',
    ]);
    // No X anywhere: Escape and a press outside are the ways out, and neither
    // one touches the mark.
    expect(screen.queryByRole('button', { name: 'Close text tools' })).toBeNull();
  });

  it('sizes the ink in use as the larger circle, and only it wears the drop', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="blue" actions={actions()} {...closeProps} />);
    const blue = document.querySelector('[data-sat-swatch="blue"]')!;
    const yellow = document.querySelector('[data-sat-swatch="yellow"]')!;
    expect(blue).toHaveAttribute('data-sat-swatch-state', 'current');
    expect(blue.className).toContain('h-8');
    expect(blue.querySelector('[data-sat-swatch-ink="true"]')).not.toBeNull();
    expect(yellow).toHaveAttribute('data-sat-swatch-state', 'idle');
    expect(yellow.className).toContain('h-6');
    expect(yellow.querySelector('[data-sat-swatch-ink="true"]')).toBeNull();
  });

  it('keeps every action at a 44px touch target', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} {...closeProps} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('h-11');
      expect(button.className).toContain('sat-touch-target');
    }
  });

  it('applies the tapped ink, the current underline style, and the note request', () => {
    const on = actions();
    render(
      <SatSelectionActionsPanel
        anchor={anchor}
        currentColor="yellow"
        currentUnderlineStyle="dotted"
        actions={on}
        environment={environment}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Highlight Pink' }));
    expect(on.highlight).toHaveBeenCalledWith(anchor, 'pink');
    // The U applies the line it is drawing: the student's last choice, shown
    // before they press it.
    expect(screen.getByRole('button', { name: 'Underline' }).querySelector('[data-sat-underline-glyph="dotted"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Underline' }));
    expect(on.underline).toHaveBeenCalledWith(anchor, 'dotted');
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(on.addNote).toHaveBeenCalledWith(anchor);
  });

  it('lands the caret on the first action, with nothing to dismiss by accident', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="blue" actions={actions()} {...closeProps} />);
    const yellow = screen.getByRole('button', { name: 'Highlight Yellow' });
    const blue = screen.getByRole('button', { name: 'Highlight Blue' });
    expect(document.activeElement).toBe(yellow);
    expect(blue).toHaveAttribute('aria-pressed', 'true');
    expect(yellow).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(yellow, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(blue);
  });

  it('disables every action while the exam is blocked', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} disabled {...closeProps} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('scrolls its own row inside the bound the placement measured', () => {
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions()} {...closeProps} />);
    // The body is what scrolls; the surface itself does not, because a scroll
    // container would clip the caret that sits outside its border box.
    const body = document.querySelector('[data-sat-annotation-surface-body="true"]')!;
    expect(body.className).toContain('overflow-y-auto');
    const toolbar = screen.getByRole('toolbar', { name: 'Selected text actions' });
    expect(toolbar.className).not.toContain('overflow-y-auto');
  });
});

describe('underline style menu', () => {
  function openMenu() {
    const on = actions();
    render(
      <SatSelectionActionsPanel
        anchor={anchor}
        currentColor="yellow"
        currentUnderlineStyle="solid"
        actions={on}
        environment={environment}
        onClose={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Underline style' });
    fireEvent.click(trigger);
    return { on, trigger };
  }

  it('offers the three lines and none, with the one in use checked', () => {
    const { trigger } = openMenu();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Underline style' })).toBeInTheDocument();
    const options = screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('data-sat-underline-style-option'));
    expect(options).toEqual(['solid', 'dashed', 'dotted', 'none']);
    expect(screen.getByRole('menuitemradio', { name: 'Solid underline' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Dashed underline' })).toHaveAttribute('aria-checked', 'false');
    // The one option with no line to draw carries the word instead.
    expect(screen.getByRole('menuitemradio', { name: 'No underline' })).toHaveTextContent('None');
  });

  it('is closed until the chevron asks, and applies the chosen line', () => {
    const on = actions();
    render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={on} {...closeProps} />);
    expect(screen.queryByRole('menu')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Underline style' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dashed underline' }));
    expect(on.underline).toHaveBeenCalledWith(anchor, 'dashed');
    // Choosing closes the menu and hands focus back to its trigger.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('takes Escape first: the menu closes and the selection tools stay', () => {
    const { trigger } = openMenu();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    // The toolbar itself is still there: one Escape, one meaning.
    expect(screen.getByRole('toolbar', { name: 'Selected text actions' })).toBeInTheDocument();
  });

  it('takes "none" as doing nothing on a selection that is not underlined yet', () => {
    const { on } = openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'No underline' }));
    expect(on.underline).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('edit controls', () => {
  const mark = createSatTextAnnotation({
    kind: 'highlight', nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree', color: 'pink', note: 'Check this',
  });
  const underlineMark = createSatTextAnnotation({
    kind: 'underline', nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree', style: 'dashed',
  });
  /** What every render of the mark's controls needs beyond the mark itself. */
  const base = { onClose: vi.fn(), environment };

  it('shows the mark own ink pressed, offers the note edit, and keeps removal on the row', () => {
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
    expect(document.querySelector('[data-sat-swatch="pink"]')).toHaveAttribute('data-sat-swatch-state', 'current');
    fireEvent.click(screen.getByRole('button', { name: 'Highlight Blue' }));
    expect(onColor).toHaveBeenCalledWith('blue');
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    expect(onNote).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Remove highlight' }));
    expect(onRemove).toHaveBeenCalledOnce();
    // The note is the one action that leaves the passage, so it comes after a
    // divider; nothing sits behind a second disclosure any more.
    expect(actionOrder()).toEqual([
      'highlight-yellow', 'highlight-blue', 'highlight-pink', 'underline', 'underline-style', 'remove', 'note',
    ]);
  });

  it('draws an underline mark own line, and removes that mark by name', () => {
    render(
      <SatAnnotationEditControls annotation={underlineMark} onColor={vi.fn()} onUnderline={vi.fn()} onNote={vi.fn()} onRemove={vi.fn()} {...base} />,
    );
    // A highlight has no underline yet, so the menu's checked row is "none";
    // an underline shows its own style.
    const underlineTrigger = screen.getByRole('button', { name: 'Underline' });
    expect(underlineTrigger.querySelector('[data-sat-underline-glyph="dashed"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove underline' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Underline style' }));
    expect(screen.getByRole('menuitemradio', { name: 'Dashed underline' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Solid underline' })).toHaveAttribute('aria-checked', 'false');
  });

  it('hands a style choice to the mark, including none', () => {
    const onUnderline = vi.fn();
    render(
      <SatAnnotationEditControls annotation={underlineMark} onColor={vi.fn()} onUnderline={onUnderline} onNote={vi.fn()} onRemove={vi.fn()} {...base} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Underline style' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dotted underline' }));
    expect(onUnderline).toHaveBeenCalledWith('dotted');
    fireEvent.click(screen.getByRole('button', { name: 'Underline style' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'No underline' }));
    expect(onUnderline).toHaveBeenLastCalledWith('none');
  });

  it('checks "none" on a highlight, whose words carry no underline', () => {
    render(
      <SatAnnotationEditControls annotation={mark} onColor={vi.fn()} onUnderline={vi.fn()} onNote={vi.fn()} onRemove={vi.fn()} {...base} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Underline style' }));
    expect(screen.getByRole('menuitemradio', { name: 'No underline' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Solid underline' })).toHaveAttribute('aria-checked', 'false');
  });

  it('asks to add a note on a bare mark and moves the caret into the controls', () => {
    const bare = createSatTextAnnotation({ kind: 'underline', nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' });
    render(
      <SatAnnotationEditControls annotation={bare} onColor={vi.fn()} onUnderline={vi.fn()} onNote={vi.fn()} onRemove={vi.fn()} {...base} />,
    );
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
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
});
