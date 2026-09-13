import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentSplitPaneResizer } from '../StudentSplitPaneResizer';

/**
 * P2.4 — the splitter is a directly manipulated seam, not a button.
 *
 * Rest → hover → grab → drag → release, with the narrower/wider/reset
 * commands moved off primary click (context menu only) and double-click
 * restoring the recommended split.
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

describe('StudentSplitPaneResizer direct manipulation (P2.4)', () => {
  it('keeps a persistent grabber and a forgiving hit area at rest', () => {
    renderResizer();

    const separator = screen.getByTestId('split-separator');
    expect(separator).toHaveAttribute('data-split-state', 'rest');
    // The grabber is always present — discoverability is not hover-only.
    expect(screen.getByTestId('split-separator-grabber')).toBeInTheDocument();
    // The grabbable area is wider than the hairline it represents.
    const hitArea = screen.getByTestId('split-separator-hit-area');
    expect(hitArea.style.insetInline).toBe('-7px');
  });

  it('widens the touch hit area beyond the rail on tablets', () => {
    renderResizer({ isTabletMode: true });
    // A 32px overlay rail plus 8px on each side reaches the 48pt finger target.
    expect(screen.getByTestId('split-separator-hit-area').style.insetInline).toBe('-8px');
  });

  it('never opens a menu on primary click or focus', () => {
    renderResizer();

    fireEvent.pointerDown(screen.getByTestId('split-separator'), { pointerId: 1, clientX: 400 });
    fireEvent.focus(screen.getByTestId('split-separator'));

    expect(screen.queryByTestId('split-separator-menu')).toBeNull();
    expect(screen.queryByText('Material wider')).not.toBeInTheDocument();
  });

  it('exposes the commands through the context menu instead', () => {
    const props = renderResizer();

    fireEvent.contextMenu(screen.getByTestId('split-separator'));
    expect(screen.getByTestId('split-separator-menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Material narrower' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Material wider' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Reset split' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Material wider' }));

    expect(props.resizeCommands?.wider).toHaveBeenCalledTimes(1);
    expect(props.resizeCommands?.narrower).not.toHaveBeenCalled();
    expect(props.resizeCommands?.reset).not.toHaveBeenCalled();
    expect(props.onDividerPointerDown).not.toHaveBeenCalled();
    // Choosing a command closes the menu so the seam returns to rest.
    expect(screen.queryByTestId('split-separator-menu')).toBeNull();
  });

  it('keeps pointer events inside the menu from bubbling to the drag path', () => {
    const props = renderResizer();

    fireEvent.contextMenu(screen.getByTestId('split-separator'));
    fireEvent.pointerDown(screen.getByTestId('split-separator-menu'), { bubbles: true });

    expect(props.onDividerPointerDown).not.toHaveBeenCalled();
  });

  it('resets to the recommended split on double click', () => {
    const props = renderResizer();

    fireEvent.doubleClick(screen.getByTestId('split-separator'));

    expect(props.resizeCommands?.reset).toHaveBeenCalledTimes(1);
    expect(props.onDividerPointerDown).not.toHaveBeenCalled();
  });

  it('moves from pressed to dragging only after the movement threshold', () => {
    const props = renderResizer();
    const separator = screen.getByTestId('split-separator');

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(separator).toHaveAttribute('data-split-state', 'pressed');
    expect(props.onDividerPointerDown).toHaveBeenCalledTimes(1);

    // Below the 3px threshold the gesture is still a press.
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 402, clientY: 300 });
    expect(separator).toHaveAttribute('data-split-state', 'pressed');

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 420, clientY: 300 });
    expect(separator).toHaveAttribute('data-split-state', 'dragging');
    expect(props.onDividerPointerMove).toHaveBeenCalledTimes(2);

    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(separator).toHaveAttribute('data-split-state', 'hover');
    expect(props.onDividerPointerEnd).toHaveBeenCalledTimes(1);
  });

  it('hands a mostly-vertical touch swipe back to scrolling', () => {
    const props = renderResizer();
    const separator = screen.getByTestId('split-separator');

    fireEvent.pointerDown(separator, { pointerId: 9, clientX: 400, clientY: 300, pointerType: 'touch' });
    fireEvent.pointerMove(separator, { pointerId: 9, clientX: 404, clientY: 360, pointerType: 'touch' });

    expect(props.onDividerPointerEnd).toHaveBeenCalledTimes(1);
    expect(props.onDividerPointerMove).not.toHaveBeenCalled();
    expect(separator).toHaveAttribute('data-split-state', 'rest');
  });

  it('ignores a touch that has not yet said what it means', () => {
    const props = renderResizer();
    const separator = screen.getByTestId('split-separator');

    fireEvent.pointerDown(separator, { pointerId: 3, clientX: 400, clientY: 300, pointerType: 'touch' });
    // Six pixels of travel is genuinely ambiguous — nothing resizes yet.
    fireEvent.pointerMove(separator, { pointerId: 3, clientX: 406, clientY: 302, pointerType: 'touch' });

    expect(props.onDividerPointerMove).not.toHaveBeenCalled();
    expect(separator).toHaveAttribute('data-split-state', 'pressed');
  });

  it('engages on horizontal intent and then stays locked to the splitter', () => {
    const props = renderResizer();
    const separator = screen.getByTestId('split-separator');

    fireEvent.pointerDown(separator, { pointerId: 4, clientX: 400, clientY: 300, pointerType: 'touch' });
    fireEvent.pointerMove(separator, { pointerId: 4, clientX: 420, clientY: 302, pointerType: 'touch' });

    // Recognition discards the pre-engagement anchor and re-anchors the drag
    // here, so the divider never jumps by the recognition distance.
    expect(props.onDividerPointerEnd).toHaveBeenCalledTimes(1);
    expect(props.onDividerPointerDown).toHaveBeenCalledTimes(2);
    expect(props.onDividerPointerMove).not.toHaveBeenCalled();
    expect(separator).toHaveAttribute('data-split-state', 'dragging');

    // A wobbly finger mid-drag must not hand the gesture back to scrolling.
    fireEvent.pointerMove(separator, { pointerId: 4, clientX: 460, clientY: 400, pointerType: 'touch' });

    expect(props.onDividerPointerEnd).toHaveBeenCalledTimes(1);
    expect(props.onDividerPointerMove).toHaveBeenCalledTimes(1);
    expect(separator).toHaveAttribute('data-split-state', 'dragging');

    fireEvent.pointerUp(separator, { pointerId: 4, pointerType: 'touch' });
    expect(separator).toHaveAttribute('data-split-state', 'rest');
  });

  it('sizes the grip for fingers and grows it under a finger instead of shrinking', () => {
    renderResizer();
    const separator = screen.getByTestId('split-separator');
    const grabber = screen.getByTestId('split-separator-grabber');

    // Coarse pointers get a more legible grip — there is no cursor to change.
    expect(grabber).toHaveClass('pointer-coarse:h-12', 'pointer-coarse:w-6');

    fireEvent.pointerDown(separator, { pointerId: 5, clientX: 400, clientY: 300, pointerType: 'touch' });
    expect(separator).toHaveAttribute('data-split-pointer', 'touch');
    expect(grabber).toHaveClass('scale-[1.03]');
    expect(grabber).not.toHaveClass('scale-[0.96]');

    fireEvent.pointerUp(separator, { pointerId: 5, pointerType: 'touch' });
    fireEvent.pointerDown(separator, { pointerId: 6, clientX: 400, clientY: 300 });
    expect(separator).toHaveAttribute('data-split-pointer', 'fine');
    expect(grabber).toHaveClass('scale-[0.96]');
  });

  it('teaches the affordance once, after a stationary hover', () => {
    vi.useFakeTimers();
    try {
      renderResizer();
      const separator = screen.getByTestId('split-separator');

      fireEvent.pointerEnter(separator, { pointerType: 'mouse' });
      expect(separator).toHaveAttribute('data-split-state', 'hover');
      expect(screen.queryByTestId('split-separator-hint')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(screen.getByTestId('split-separator-hint')).toHaveTextContent('Drag to resize');

      // Leaving hides it again, and a second hover never repeats it.
      fireEvent.pointerLeave(separator, { pointerType: 'mouse' });
      expect(screen.queryByTestId('split-separator-hint')).toBeNull();
      fireEvent.pointerEnter(separator, { pointerType: 'mouse' });
      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(screen.queryByTestId('split-separator-hint')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports separator ARIA value geometry from the real bounds', () => {
    renderResizer();
    const separator = screen.getByRole('separator');
    expect(separator.getAttribute('aria-valuemin')).toBe('32');
    expect(separator.getAttribute('aria-valuemax')).toBe('68');
    expect(separator.getAttribute('aria-valuenow')).toBe('50');
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-valuetext')).toContain('50 percent');
  });
});
