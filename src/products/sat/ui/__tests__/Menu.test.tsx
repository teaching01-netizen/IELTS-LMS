import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SatMenu, type SatMenuItem } from '../Menu';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}

function buildItems(onSelect: (id: string) => void): SatMenuItem[] {
  return [
    { id: 'extend-5', label: 'Add 5 minutes', onSelect: () => onSelect('extend-5') },
    { id: 'extend-10', label: 'Add 10 minutes', onSelect: () => onSelect('extend-10') },
    { id: 'finish', label: 'Finish session…', onSelect: () => onSelect('finish'), destructive: true, separatorBefore: true },
  ];
}

function renderMenu(onSelect: (id: string) => void) {
  return render(<SatMenu label="Session actions" compact items={buildItems(onSelect)} align="end" />);
}

describe('SatMenu', () => {
  it('opens from the trigger and selects an item, closing the menu', () => {
    const onSelect = vi.fn();
    renderMenu(onSelect);
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    const item = screen.getByRole('menuitem', { name: 'Add 5 minutes' });
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith('extend-5');
    expect(screen.queryByRole('menuitem', { name: 'Add 5 minutes' })).not.toBeInTheDocument();
  });

  it('marks the destructive item and renders the group separator', () => {
    const onSelect = vi.fn();
    renderMenu(onSelect);
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    expect(screen.getByRole('menuitem', { name: 'Finish session…' })).toHaveAttribute('data-destructive');
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('closes on Escape without selecting', () => {
    const onSelect = vi.fn();
    renderMenu(onSelect);
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    expect(screen.getByRole('menuitem', { name: 'Add 5 minutes' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Add 5 minutes' })).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders nothing interactive until opened', () => {
    renderMenu(vi.fn());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('animates the menu surface on open with an origin-aware enter', () => {
    renderMenu(vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    const menu = screen.getByRole('menu');
    expect(menu).toHaveAttribute('data-sat-menu-animate');
  });

  it('marks the current item with aria-current while keeping it clickable', () => {
    const onSelect = vi.fn();
    render(
      <SatMenu
        label="Workspace"
        compact
        items={[
          { id: 'a', label: 'Morning cohort', onSelect: () => onSelect('a'), current: true },
          { id: 'b', label: 'Evening cohort', onSelect: () => onSelect('b') },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    const current = screen.getByRole('menuitem', { name: 'Morning cohort' });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('menuitem', { name: 'Evening cohort' })).not.toHaveAttribute('aria-current');
    fireEvent.click(current);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('keeps the non-compact trigger name on the label in every branch', () => {
    render(<SatMenu label="Workspace switcher" items={buildItems(vi.fn())} />);
    expect(screen.getByRole('button', { name: 'Workspace switcher' })).toHaveAttribute('aria-label', 'Workspace switcher');
  });

  it('renders a disabled item as disabled and never fires onSelect', () => {
    const onSelect = vi.fn();
    render(
      <SatMenu
        label="Session actions"
        compact
        items={[
          { id: 'only', label: 'Locked action', onSelect: () => onSelect('only'), disabled: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    const item = screen.getByRole('menuitem', { name: 'Locked action' });
    expect(item).toBeDisabled();
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders no separator when separatorBefore is set on the first item (index guard)', () => {
    render(
      <SatMenu
        label="Session actions"
        compact
        items={[{ id: 'first', label: 'First', onSelect: vi.fn(), separatorBefore: true }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    expect(screen.getByRole('menuitem', { name: 'First' })).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });
});

/**
 * Where the popup goes.
 *
 * The default — `document.body` — is right for a trigger in stable chrome. A menu
 * owned by a *floating* surface has to stay inside that surface's container: the
 * editor hides the surface when focus leaves the element it was appended to, so a
 * body-portaled popup hides its own surface, which takes the button the popup is
 * anchored to out of the document — and the popup then lands where a zero-sized
 * anchor puts it, at the top-left of the screen.
 *
 * jsdom has no `matchMedia`, and SatMenu deliberately falls back to a static menu
 * without it; the stub keeps this test on the branch a browser runs.
 */
describe('popup placement', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
  });

  it('renders inside the container it is given', () => {
    const container = document.createElement('div');
    container.setAttribute('data-surface-host', '');
    document.body.append(container);

    render(
      <SatMenu label="Image options" compact items={buildItems(vi.fn())} portalContainer={container} />,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Image options' }), { button: 0 });

    const hosted = screen.getByRole('menu', { name: 'Image options' });
    expect(container.contains(hosted)).toBe(true);
    // Radix wraps the popup in a positioning element, which is the container's
    // child — not the body's.
    expect(hosted.parentElement?.parentElement).toBe(container);
  });

  it('renders in the document body when no container is given', () => {
    renderMenu(vi.fn());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Session actions' }), { button: 0 });

    const portalled = screen.getByRole('menu', { name: 'Session actions' });
    expect(document.body.contains(portalled)).toBe(true);
    expect(portalled.parentElement?.parentElement).toBe(document.body);
  });
});