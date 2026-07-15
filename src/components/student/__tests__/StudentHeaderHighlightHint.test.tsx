import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StudentHeader } from '../StudentHeader';

describe('StudentHeader highlight tool', () => {
  it('shows a 44px native split control only in a highlight-capable exam context', () => {
    render(
      <StudentHeader
        testTakerId="W000000"
        timeRemaining={60}
        highlightEnabled
        highlightToolMode="off"
        highlightColor="yellow"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={() => {}}
        onSelectEraseMode={() => {}}
        isExamActive
      />,
    );

    const mainButton = screen.getByRole('button', { name: 'Highlight' });
    expect(mainButton.tagName).toBe('BUTTON');
    expect(mainButton).toHaveClass('min-h-11');
    expect(mainButton).toHaveAttribute('aria-pressed', 'false');
    const eraseButton = screen.getByRole('button', { name: 'Erase highlights' });
    expect(eraseButton).toHaveClass('min-h-11');
    expect(eraseButton).toHaveClass('min-w-11');
    expect(eraseButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Tip: Select text to highlight')).toBeNull();
  });

  it('selects colors and erase mode from the palette while announcing the active mode', async () => {
    const onSelectHighlightColor = vi.fn();
    const onSelectEraseMode = vi.fn();
    render(
      <StudentHeader
        testTakerId="W000000"
        timeRemaining={60}
        highlightEnabled
        highlightToolMode="highlight"
        highlightColor="yellow"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={onSelectHighlightColor}
        onSelectEraseMode={onSelectEraseMode}
        onOpenNavigator={() => {}}
        isExamActive
      />,
    );

    expect(screen.getByRole('button', { name: 'Highlighting' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Highlighting with Yellow');

    const trigger = screen.getByRole('button', { name: 'Choose highlight color' });
    fireEvent.click(trigger);
    for (const name of ['Yellow', 'Pink', 'Green', 'Blue', 'Purple']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-11');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    expect(onSelectHighlightColor).toHaveBeenCalledWith('blue');
    await waitFor(() => expect(trigger).toHaveFocus());

    expect(screen.queryByRole('button', { name: 'Erase highlights' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Erase highlights' }));
    expect(onSelectEraseMode).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('moves focus into the disclosure and restores it after Escape or outside dismissal', async () => {
    render(
      <StudentHeader
        highlightEnabled
        highlightToolMode="highlight"
        highlightColor="green"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={() => {}}
        onSelectEraseMode={() => {}}
        onOpenNavigator={() => {}}
        isExamActive
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Choose highlight color' });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Green' })).toHaveFocus());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByLabelText('Highlight options')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Green' })).toHaveFocus());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText('Highlight options')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('anchors the disclosure below its trigger instead of the viewport edge', async () => {
    render(
      <StudentHeader
        highlightEnabled
        highlightToolMode="highlight"
        highlightColor="yellow"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={() => {}}
        onSelectEraseMode={() => {}}
        onOpenNavigator={() => {}}
        isExamActive
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Choose highlight color' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 420,
      y: 10,
      top: 10,
      right: 464,
      bottom: 54,
      left: 420,
      width: 44,
      height: 44,
      toJSON: () => ({}),
    });

    fireEvent.click(trigger);
    const panel = screen.getByRole('group', { name: 'Highlight options' });
    await waitFor(() => expect(panel).toHaveStyle({ left: '224px', top: '62px', width: '240px' }));
    expect(panel).not.toHaveClass('right-3');
  });

  it('hides the tool when the exam is inactive or highlighting is unavailable', () => {
    const { rerender } = render(
      <StudentHeader highlightEnabled highlightToolMode="off" highlightColor="yellow" />,
    );
    expect(screen.queryByRole('button', { name: 'Highlight' })).toBeNull();

    rerender(
      <StudentHeader
        highlightEnabled={false}
        highlightToolMode="off"
        highlightColor="yellow"
        isExamActive
      />,
    );
    expect(screen.queryByRole('button', { name: 'Highlight' })).toBeNull();
  });
});
