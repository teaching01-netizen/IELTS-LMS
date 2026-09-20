import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SelectionActionMenu,
  type SelectionMenuAction,
  type SelectionMenuChrome,
} from '../react/SelectionActionMenu';
import { SelectionFloatingLayer } from '../react/SelectionFloatingLayer';

afterEach(() => {
  vi.restoreAllMocks();
});

/** The product's share: the material, the geometry, the rows, the caret, the bound. */
function chrome(overrides: Partial<SelectionMenuChrome> = {}): SelectionMenuChrome {
  return {
    className: 'sat-ui absolute sat-annotation-surface-floating',
    style: { left: 100, top: 400, width: 240, maxHeight: 96, visibility: 'visible' },
    renderBody: (content, maxHeight) => (
      <div data-testid="body" data-max-height={maxHeight === null ? 'none' : String(maxHeight)}>
        {content}
      </div>
    ),
    rowClassName: (row, last) => `row-${row}${last ? ' row-last' : ''}`,
    ...overrides,
  };
}

function actions(onSelect = vi.fn()): SelectionMenuAction[] {
  return [
    { id: 'highlight', render: <button type="button" onClick={onSelect}>Highlight</button> },
    { id: 'underline', row: 1, render: <button type="button" onClick={onSelect}>Underline</button> },
    { id: 'close', row: 1, render: <button type="button" onClick={onSelect}>Close</button> },
  ];
}

describe('SelectionActionMenu', () => {
  it('renders the product controls in its rows, in order, and marks the last row', () => {
    render(<SelectionActionMenu actions={actions()} chrome={chrome()} />);

    const rows = document.querySelectorAll('[data-selection-menu-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveClass('row-0');
    expect(rows[0]).not.toHaveClass('row-last');
    expect(rows[1]).toHaveClass('row-1');
    expect(rows[1]).toHaveClass('row-last');
    expect(rows[0]!.textContent).toBe('Highlight');
    expect(rows[1]!.textContent).toBe('UnderlineClose');
  });

  it('is a real toolbar with a name, so it is reachable without a pointer', () => {
    render(<SelectionActionMenu actions={actions()} chrome={chrome()} label="Highlight actions" />);

    const toolbar = screen.getByRole('toolbar', { name: 'Highlight actions' });
    expect(toolbar).toHaveAttribute('aria-orientation', 'horizontal');
    expect(toolbar).toHaveAttribute('data-selection-action-menu', 'true');
  });

  it('dresses the surface exactly as the product asked, adding no geometry of its own', () => {
    render(<SelectionActionMenu actions={actions()} chrome={chrome()} />);

    // The product maps the placement decision into these; the menu must not have
    // a second opinion about where the surface goes.
    expect(screen.getByRole('toolbar')).toHaveClass('sat-ui absolute sat-annotation-surface-floating');
    expect(screen.getByRole('toolbar')).toHaveStyle({
      left: '100px',
      top: '400px',
      width: '240px',
      maxHeight: '96px',
      visibility: 'visible',
    });
  });

  it('keeps the surface mounted, in the product\'s shape, while its anchor is off screen', () => {
    render(<SelectionActionMenu actions={actions()} chrome={chrome({ style: { visibility: 'hidden', width: 'min(340px, 100%)' } })} />);

    // Hidden rather than absent: the caret the student was standing on must
    // survive, and so must the measured box the next placement reads back. The
    // menu neither decides this nor overrides it — it is queried by marker,
    // because a hidden toolbar has left the accessibility tree on purpose.
    const menu = document.querySelector('[data-selection-action-menu]');
    expect(menu).toHaveStyle({ visibility: 'hidden', width: 'min(340px, 100%)' });
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(menu).toHaveTextContent('Highlight');
  });

  it('keeps its own controls pressable whatever the product\'s chrome says', () => {
    render(<SelectionActionMenu actions={actions()} chrome={chrome({ style: { pointerEvents: 'none' } })} />);

    expect(screen.getByRole('button', { name: 'Highlight' })).toBeEnabled();
    expect(document.querySelector('[data-selection-action-menu]')).toHaveStyle({ pointerEvents: 'auto' });
  });

  it('gives the product the body, the bound it scrolls inside, the caret and the heading', () => {
    render(
      <SelectionActionMenu
        actions={actions()}
        chrome={chrome({
          caret: <span data-testid="caret" />,
          heading: <span data-testid="heading">Highlight</span>,
          bodyMaxHeight: 128,
          attributes: { 'data-sat-selection-toolbar': 'true' },
        })}
      />,
    );

    expect(screen.getByTestId('caret')).toBeInTheDocument();
    expect(screen.getByTestId('heading')).toBeInTheDocument();
    expect(screen.getByTestId('body')).toHaveAttribute('data-max-height', '128');
    // The heading travels with the content, so it is inside the scrolling body.
    expect(screen.getByTestId('body')).toContainElement(screen.getByTestId('heading'));
    expect(screen.getByRole('toolbar')).toHaveAttribute('data-sat-selection-toolbar', 'true');
  });

  it('hands the body a null bound rather than a zero one when nothing bounded it', () => {
    render(<SelectionActionMenu actions={actions()} chrome={chrome({ bodyMaxHeight: 0 })} />);

    expect(screen.getByTestId('body')).toHaveAttribute('data-max-height', 'none');
  });

  it('navigates between the product controls with the arrow keys, skipping disabled ones', () => {
    render(
      <SelectionActionMenu
        actions={[
          { id: 'highlight', render: <button type="button">Highlight</button> },
          { id: 'note', render: <button type="button" disabled>Note</button> },
          { id: 'close', render: <button type="button">Close</button> },
        ]}
        chrome={chrome()}
      />,
    );

    const highlight = screen.getByRole('button', { name: 'Highlight' });
    const close = screen.getByRole('button', { name: 'Close' });
    highlight.focus();

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(highlight);

    fireEvent.keyDown(document, { key: 'End' });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: 'Home' });
    expect(document.activeElement).toBe(highlight);
  });

  it('leaves the caret alone when it is somewhere else', () => {
    render(<SelectionActionMenu actions={actions()} chrome={chrome()} />);

    // A toolbar that stays up while the student types in a note must not steal
    // the arrow keys out of the field they are writing in.
    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    elsewhere.focus();

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(elsewhere);

    elsewhere.remove();
  });

  it('dismisses on a press outside the menu, and never on a press inside it', () => {
    const onDismiss = vi.fn();
    render(<SelectionActionMenu actions={actions()} chrome={chrome()} onDismiss={onDismiss} />);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Highlight' }));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole('toolbar'));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to the surface that owns the selection', () => {
    const onDismiss = vi.fn();
    render(<SelectionActionMenu actions={actions()} chrome={chrome()} onDismiss={onDismiss} />);

    // One key, one owner: the overlay (or the exam's shell) arbitrates Escape,
    // and a menu handler would make the same press mean two things.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('survives a re-render mid-gesture with the newest dismissal callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<SelectionActionMenu actions={actions()} chrome={chrome()} onDismiss={first} />);

    rerender(<SelectionActionMenu actions={actions()} chrome={chrome()} onDismiss={second} />);
    fireEvent.pointerDown(document.body);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('SelectionFloatingLayer', () => {
  it('renders nothing while it is closed', () => {
    render(
      <SelectionFloatingLayer open={false} label="Selection">
        <span>child</span>
      </SelectionFloatingLayer>,
    );

    expect(screen.queryByText('child')).toBeNull();
  });

  it('falls back to a portal when the popover API is unavailable', () => {
    render(
      <SelectionFloatingLayer open label="Selection">
        <span>child</span>
      </SelectionFloatingLayer>,
    );

    const layer = document.querySelector('[data-selection-floating-layer]');
    expect(layer).toHaveAttribute('data-selection-floating-layer', 'portal');
    expect(layer?.parentElement).toBe(document.body);
    expect(screen.getByRole('region', { name: 'Selection' })).toBeInTheDocument();
  });

  it('promotes itself to the top layer when the platform supports it', () => {
    const showPopover = vi.fn();
    const hidePopover = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: showPopover });
    Object.defineProperty(HTMLElement.prototype, 'hidePopover', { configurable: true, value: hidePopover });
    vi.spyOn(Element.prototype, 'matches').mockReturnValue(false);

    try {
      const { rerender } = render(
        <SelectionFloatingLayer open label="Selection">
          <span>child</span>
        </SelectionFloatingLayer>,
      );

      expect(document.querySelector('[data-selection-floating-layer]')).toHaveAttribute('data-selection-floating-layer', 'popover');
      expect(showPopover).toHaveBeenCalledTimes(1);

      rerender(
        <SelectionFloatingLayer open={false} label="Selection">
          <span>child</span>
        </SelectionFloatingLayer>,
      );
      expect(document.querySelector('[data-selection-floating-layer]')).toBeNull();
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)['showPopover'];
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)['hidePopover'];
    }
  });
});
