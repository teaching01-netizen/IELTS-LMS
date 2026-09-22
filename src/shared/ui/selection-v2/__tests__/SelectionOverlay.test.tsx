import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionOverlay, type SelectionOverlaySelection } from '../react/SelectionOverlay';
import { IDLE_SELECTION } from '../domain/selectionTypes';

const rects = [
  { left: 10, top: 100, width: 100, height: 20 },
  { left: 10, top: 124, width: 40, height: 20 },
];

function resting(overrides: Partial<SelectionOverlaySelection> = {}): SelectionOverlaySelection {
  return {
    ...IDLE_SELECTION,
    id: 'selection:1',
    phase: 'selected',
    selected: true,
    selectionText: 'alpha beta',
    rects,
    startHandle: { edge: 'start', x: 10, y: 100, direction: 'ltr', stem: 'up' },
    endHandle: { edge: 'end', x: 50, y: 144, direction: 'ltr', stem: 'down' },
    anchorRect: { left: 10, top: 100, width: 100, height: 44 },
    pointer: { finger: { x: 30, y: 120 }, caret: null, snapRevision: 0 },
    adjusting: false,
    beginHandleAdjustment: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('painting a selection', () => {
  it('paints one line per measured rect and nothing at all when idle', () => {
    const { rerender } = render(<SelectionOverlay selection={resting()} />);

    expect(screen.getAllByText('', { selector: '[data-student-selection-line]' })).toHaveLength(2);
    expect(document.querySelector('[data-student-selection-highlight]')).toBeInTheDocument();

    rerender(<SelectionOverlay selection={resting({ ...IDLE_SELECTION })} />);
    expect(document.querySelector('[data-student-selection-highlight]')).toBeNull();
  });

  it('never lets a decoration intercept the finger', () => {
    render(<SelectionOverlay selection={resting()} />);

    expect(document.querySelector('[data-student-selection-highlight]')).toHaveStyle({ pointerEvents: 'none' });
    expect(document.querySelector('[data-selection-floating-layer]')).toHaveStyle({ pointerEvents: 'none' });
    expect(screen.getByRole('button', { name: 'Adjust selection start' })).toHaveStyle({ pointerEvents: 'auto' });
  });

  it('moves a line by transform rather than by re-laying it out', () => {
    render(<SelectionOverlay selection={resting()} />);

    expect(screen.getAllByText('', { selector: '[data-student-selection-line]' })[0]).toHaveStyle({
      transform: 'translate3d(10px, 100px, 0)',
    });
  });
});

describe('handles', () => {
  it('offers both endpoints as labelled controls, with the grabber pointing outward', () => {
    render(<SelectionOverlay selection={resting()} />);

    const start = screen.getByRole('button', { name: 'Adjust selection start' });
    const end = screen.getByRole('button', { name: 'Adjust selection end' });

    expect(start).toHaveAttribute('data-stem', 'up');
    expect(end).toHaveAttribute('data-stem', 'down');
    expect(start).toHaveAttribute('data-student-selection-handle', 'start');
  });

  it('starts adjusting the edge that was grabbed, with the pointer it was grabbed by', () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Adjust selection end' }), {
      pointerId: 7,
      clientX: 50,
      clientY: 144,
    });

    expect(selection.beginHandleAdjustment).toHaveBeenCalledWith(
      'end',
      expect.objectContaining({ pointerId: 7, clientX: 50, clientY: 144 }),
    );
  });
});

/**
 * The overlay paints and dismisses; it does not raise a menu. A product's
 * toolbar must also appear for the browser's own selection — a mouse drag, a
 * shift-arrow — which is exactly the state in which this overlay paints nothing,
 * so the menu is owned by whoever owns the toolbar (see `SelectionActionMenu`).
 * What the overlay does owe that menu is a press it can read as a command.
 */
describe('the boundary with the product menu', () => {
  it('paints no menu of its own', () => {
    render(<SelectionOverlay selection={resting()} />);

    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('reads a press on a handle, or on the menu raised for this selection, as inside it', () => {
    const selection = resting();
    render(
      <>
        <SelectionOverlay selection={selection} />
        <div data-selection-action-menu="true">
          <button type="button">Highlight</button>
        </div>
      </>,
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Highlight' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Adjust selection start' }));
    expect(selection.dismiss).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(selection.dismiss).toHaveBeenCalledTimes(1);
  });
});

describe('the loupe', () => {
  const source = () => {
    const element = document.createElement('p');
    element.textContent = 'alpha beta';
    document.body.append(element);
    return { current: element };
  };

  it('appears while text is being claimed or an endpoint moved, and nowhere else', () => {
    const sourceRef = source();
    const { rerender } = render(<SelectionOverlay selection={resting()} loupe={{ sourceRef }} />);
    expect(screen.queryByText('', { selector: '[data-selection-loupe]' })).toBeNull();

    rerender(<SelectionOverlay selection={resting({ phase: 'adjusting-end', adjusting: true })} loupe={{ sourceRef }} />);
    expect(document.querySelector('[data-selection-loupe]')).toBeInTheDocument();
    expect(document.querySelector('[data-selection-loupe-source]')).toHaveTextContent('alpha beta');

    rerender(<SelectionOverlay selection={resting({ pointer: null })} loupe={{ sourceRef }} />);
    expect(document.querySelector('[data-selection-loupe]')).toBeNull();

    rerender(<SelectionOverlay selection={resting({ phase: 'adjusting-end', adjusting: true })} loupe={{ sourceRef, enabled: false }} />);
    expect(document.querySelector('[data-selection-loupe]')).toBeNull();
  });
});

describe('dismissal', () => {
  it('ends the selection on Escape', () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(selection.dismiss).toHaveBeenCalledTimes(1);
  });

  it('ends the selection on a press outside it', () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);

    fireEvent.pointerDown(document.body);

    expect(selection.dismiss).toHaveBeenCalled();
  });

  it('listens for nothing while there is no selection', () => {
    const selection = resting({ ...IDLE_SELECTION });
    render(<SelectionOverlay selection={selection} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.body);

    expect(selection.dismiss).not.toHaveBeenCalled();
  });
});
