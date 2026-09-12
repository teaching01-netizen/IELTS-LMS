import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentSplitPaneResizer } from '../StudentSplitPaneResizer';

/**
 * P2.4 — drag-free resize menu on the split separator.
 *
 * Keyboard/touch users get narrower/wider/reset actions that appear on
 * focus or tap. Pointer events inside the menu must never start a drag.
 */

function renderResizer(overrides: Partial<Parameters<typeof StudentSplitPaneResizer>[0]> = {}) {
  const props: Parameters<typeof StudentSplitPaneResizer>[0] = {
    isTabletMode: false,
    leftWidth: 50,
    minWidth: 32,
    maxWidth: 68,
    onDividerPointerDown: vi.fn(),
    onDividerPointerMove: vi.fn(),
    onDividerPointerEnd: vi.fn(),
    onDividerKeyDown: vi.fn(),
    resizeCommands: { narrower: vi.fn(), wider: vi.fn(), reset: vi.fn() },
    ariaLabel: 'Resize material pane',
    testId: 'split-separator',
    ...overrides,
  };
  render(<StudentSplitPaneResizer {...props} />);
  return props;
}

describe('StudentSplitPaneResizer resize menu (P2.4)', () => {
  it('hides the menu until focus or pointer contact', () => {
    renderResizer();
    expect(screen.queryByTestId('split-separator-menu')).toBeNull();
  });

  it('reveals the drag-free actions on separator focus', () => {
    renderResizer();
    fireEvent.focus(screen.getByTestId('split-separator'));
    expect(screen.getByTestId('split-separator-menu')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Material narrower' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Material wider' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset split' })).toBeTruthy();
  });

  it('reveals the menu on tap (touch users cannot hover)', () => {
    renderResizer();
    fireEvent.pointerDown(screen.getByTestId('split-separator'));
    expect(screen.getByTestId('split-separator-menu')).toBeTruthy();
  });

  it('invokes the matching command without starting a drag', () => {
    const props = renderResizer();
    fireEvent.focus(screen.getByTestId('split-separator'));
    fireEvent.click(screen.getByRole('button', { name: 'Material wider' }));
    expect(props.resizeCommands?.wider).toHaveBeenCalledTimes(1);
    expect(props.resizeCommands?.narrower).not.toHaveBeenCalled();
    expect(props.resizeCommands?.reset).not.toHaveBeenCalled();
    expect(props.onDividerPointerDown).not.toHaveBeenCalled();
  });

  it('keeps pointer events inside the menu from bubbling to the drag path', () => {
    const props = renderResizer();
    fireEvent.focus(screen.getByTestId('split-separator'));
    const menu = screen.getByTestId('split-separator-menu');
    // A pointerdown on the menu surface bubbles to the separator element in
    // jsdom; the component must stop it before the drag handler sees it.
    fireEvent.pointerDown(menu, { bubbles: true });
    expect(props.onDividerPointerDown).not.toHaveBeenCalled();
  });

  it('reports separator ARIA value geometry from the real bounds', () => {
    renderResizer();
    const separator = screen.getByRole('separator');
    expect(separator.getAttribute('aria-valuemin')).toBe('32');
    expect(separator.getAttribute('aria-valuemax')).toBe('68');
    expect(separator.getAttribute('aria-valuenow')).toBe('50');
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
  });
});
