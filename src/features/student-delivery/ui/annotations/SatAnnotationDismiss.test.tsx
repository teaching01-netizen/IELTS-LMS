import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createSatTextAnnotation } from '../../domain/satResponses';
import { SatAnnotationEditControls } from './SatAnnotationEditControls';
import { SatSelectionActionsPanel } from './SatSelectionActionsPanel';

/**
 * A press outside the annotation tools closes them. The gesture is the whole
 * subject here, so it is dispatched directly rather than through a click helper:
 * what matters is the `pointerdown` the hook listens for, in the capture phase,
 * on a target that is (or is not) inside the surface.
 */

const anchor = { nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' };
const environment = { coarsePointer: false, nativeSelectionUi: false };
const actions = { highlight: vi.fn(), underline: vi.fn(), addNote: vi.fn() };
const mark = createSatTextAnnotation({
  kind: 'highlight', nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree', color: 'yellow',
});

/** The passage, a toolbar button, the page at large — anything but the surface. */
function press(target: EventTarget, type = 'pointerdown'): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function outsideNode(): HTMLElement {
  const passage = document.createElement('div');
  passage.setAttribute('data-content-text-node', 'p1');
  passage.textContent = 'A tree grows.';
  document.body.appendChild(passage);
  return passage;
}

function renderSelectionPanel(onClose = vi.fn()) {
  render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions} environment={environment} onClose={onClose} />);
  return onClose;
}

function renderEditControls(onClose = vi.fn()) {
  render(
    <SatAnnotationEditControls
      annotation={mark}
      environment={environment}
      onColor={vi.fn()}
      onUnderline={vi.fn()}
      onNote={vi.fn()}
      onRemove={vi.fn()}
      onClose={onClose}
    />,
  );
  return onClose;
}

describe('annotation tools: press outside to dismiss', () => {
  it('closes the selection tools when the press lands on the passage', () => {
    const onClose = renderSelectionPanel();
    press(outsideNode());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes them for a press anywhere else on the page, our chrome included', () => {
    const onClose = renderSelectionPanel();
    // The top bar, the footer, the notes column: all outside, all the same
    // answer. Nothing here needs to know what the target is — only that it is
    // not the surface.
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    press(elsewhere);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves them open when the press is inside them', () => {
    const onClose = renderSelectionPanel();
    const toolbar = screen.getByRole('toolbar', { name: 'Selected text actions' });
    const targets = [
      toolbar,
      screen.getByRole('button', { name: 'Highlight Yellow' }),
      screen.getByRole('button', { name: 'Underline' }),
      screen.getByRole('button', { name: 'Add note' }),
      // The scrolling body is inside the surface's box and is a child of it,
      // which is exactly the distinction the hook relies on.
      toolbar.querySelector('[data-sat-annotation-surface-body="true"]')!,
    ];
    for (const target of targets) press(target);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('never cancels the press it is reading', () => {
    renderSelectionPanel();
    // A dismissal that called preventDefault would break the native selection,
    // the answer buttons, and every other thing the same press was going to do.
    expect(press(outsideNode()).defaultPrevented).toBe(false);
  });

  it('does not dismiss on a scroll, which is not a press', () => {
    const onClose = renderSelectionPanel();
    press(outsideNode(), 'wheel');
    press(outsideNode(), 'scroll');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes a mark own edit controls the same way', () => {
    const onClose = renderEditControls();
    press(outsideNode());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls the newest dismissal after a re-render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<SatSelectionActionsPanel anchor={anchor} currentColor="yellow" actions={actions} environment={environment} onClose={first} />);
    // A re-render mid-life must not leave the listener holding the old callback:
    // the surface that closes is the one on screen, not the one that was.
    rerender(<SatSelectionActionsPanel anchor={anchor} currentColor="pink" actions={actions} environment={environment} onClose={second} />);
    press(outsideNode());
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
