import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});