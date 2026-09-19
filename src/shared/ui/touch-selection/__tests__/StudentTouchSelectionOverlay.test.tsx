import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudentTouchSelectionOverlay } from '../StudentTouchSelectionOverlay';

describe('StudentTouchSelectionOverlay', () => {
  it('paints nothing when no selection is owned', () => {
    const { container } = render(<StudentTouchSelectionOverlay rects={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('paints one box per measured line, in viewport coordinates', () => {
    const { container } = render(
      <StudentTouchSelectionOverlay
        rects={[
          { left: 12, top: 40, width: 120, height: 18 },
          { left: 12, top: 60, width: 80, height: 18 },
        ]}
      />,
    );

    const lines = container.querySelectorAll('[data-student-touch-selection-line="true"]');
    expect(lines).toHaveLength(2);
    expect((lines[0] as HTMLElement).style.left).toBe('12px');
    expect((lines[0] as HTMLElement).style.top).toBe('40px');
    expect((lines[0] as HTMLElement).style.width).toBe('120px');
    expect((lines[1] as HTMLElement).style.width).toBe('80px');
  });

  it('stays decoration: hidden from assistive tech and never a hit target', () => {
    const { container } = render(
      <StudentTouchSelectionOverlay rects={[{ left: 0, top: 0, width: 10, height: 10 }]} />,
    );

    const layer = container.querySelector('[data-student-touch-selection="true"]') as HTMLElement;
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer.className).toContain('pointer-events-none');
    // Nothing here is announced or focusable on its own: the toolbar that
    // follows a selection is where the outcome is stated.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
