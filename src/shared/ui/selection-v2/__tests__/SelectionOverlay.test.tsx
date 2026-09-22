import React from 'react';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
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
    // The gesture's own guards as the hook answers them for a control the
    // gesture would NOT handle (a toolbar, an input): dismissed, delivered.
    // A test whose press stands in for the prose overrides this with true.
    wouldBeginGesture: vi.fn(() => false),
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

/**
 * The interaction rule a resting selection lives by (docs/selectionui.md):
 * it can only be RESIZED by acquiring one of its two visible endpoint handles,
 * and a press inside the selected text must never move an endpoint, open the
 * loupe, dismiss the selection, or start a new gesture — one physical
 * pointerdown holds exactly one intent.
 *
 * The fixture's two 44×44 endpoint boxes overlap over the selected line (any
 * selection narrower than 44px does), which is the geometry that used to make
 * a press in the MIDDLE land on an invisible handle target.
 */
describe('a resting selection is resized only by acquiring a visible handle', () => {
  /** The centre of the first painted line: inside both handles' boxes. */
  const midpoint = { clientX: 60, clientY: 110 };

  /** A prose element to press on, standing in for the exam's own passage. */
  function prose(): HTMLElement {
    const element = document.createElement('p');
    element.textContent = 'alpha beta gamma';
    document.body.append(element);
    return element;
  }

  it('acquires the handle only from the outward side of its line', () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);
    const start = screen.getByRole('button', { name: 'Adjust selection start' });

    // Above the line: the start handle's own zone — a drag may begin here.
    fireEvent.pointerDown(start, { clientX: 10, clientY: 90 });
    expect(selection.beginHandleAdjustment).toHaveBeenCalledWith(
      'start',
      expect.objectContaining({ clientX: 10, clientY: 90 }),
    );
    expect(selection.dismiss).not.toHaveBeenCalled();
  });

  it('acquires neither handle from the midpoint, even when the press lands on a handle box', () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);
    const end = screen.getByRole('button', { name: 'Adjust selection end' });
    const sawPointerDown = vi.fn();
    document.addEventListener('pointerdown', sawPointerDown);
    try {
      // The end handle's 44px box covers the midpoint of this short selection,
      // so without a directional acquisition rule this press grabs the end.
      const event = createEvent.pointerDown(end, { bubbles: true, ...midpoint });
      fireEvent(end, event);

      expect(selection.beginHandleAdjustment).not.toHaveBeenCalled();
      expect(selection.dismiss).not.toHaveBeenCalled();
      // Consumed: neither the prose below nor a later gesture may see it.
      expect(event.defaultPrevented).toBe(true);
      expect(sawPointerDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('pointerdown', sawPointerDown);
    }
  });

  it('treats a press on the selected text itself as a no-drag zone: preserved, never dismissed', () => {
    const selection = resting();
    render(<SelectionOverlay selection={selection} />);
    const body = prose();
    const sawPointerDown = vi.fn();
    document.addEventListener('pointerdown', sawPointerDown);
    try {
      const event = createEvent.pointerDown(body, { bubbles: true, ...midpoint });
      fireEvent(body, event);

      expect(selection.dismiss).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      // stopPropagation in capture: the event never reaches the target, so the
      // prose's own pointerdown — the thing that would start a new selection —
      // cannot see this press at all.
      expect(sawPointerDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('pointerdown', sawPointerDown);
    }
  });

  it('resolves an outside press the gesture would handle to dismiss() AND consume, at capture', () => {
    const selection = resting({ wouldBeginGesture: vi.fn(() => true) });
    render(<SelectionOverlay selection={selection} />);
    const body = prose();
    const sawPointerDown = vi.fn();
    document.addEventListener('pointerdown', sawPointerDown);
    try {
      const event = createEvent.pointerDown(body, { bubbles: true, clientX: 400, clientY: 400 });
      fireEvent(body, event);

      // The literal rule (docs/selectionui.md): dismissed in this capture pass,
      // and the pointerdown consumed — the prose's own handler never sees it,
      // so the same press ends the old selection and cannot also open a hidden
      // `selected → idle → pending` underneath it.
      expect(selection.dismiss).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      expect(sawPointerDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('pointerdown', sawPointerDown);
    }
  });

  it('dismisses but still delivers an outside press the gesture would never handle', () => {
    const selection = resting({ wouldBeginGesture: vi.fn(() => false) });
    render(<SelectionOverlay selection={selection} />);
    const body = prose();
    const received = vi.fn();
    body.addEventListener('pointerdown', received);

    const event = createEvent.pointerDown(body, { bubbles: true, clientX: 400, clientY: 400 });
    fireEvent(body, event);

    // Toolbars, answer fields, every other control: one dismissal here, and
    // the press still reaches its target — the gesture's handler cannot see
    // them anyway, so consuming would only break the rest of the page.
    expect(selection.dismiss).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });
});
