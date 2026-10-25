import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentZoomableMedia } from '../StudentZoomableMedia';
import { StudentExamTypeContext } from '../layout/studentExamTypeContext';

describe('StudentZoomableMedia', () => {
  it('falls back to alternate sources and opens a zoom-only viewer', () => {
    render(
      <StudentZoomableMedia
        sources={['/missing-image.png', '/working-image.png']}
        alt="Reference diagram"
        label="Reference diagram"
        hint="Tap to zoom the diagram"
      />,
    );

    const thumbnail = screen.getByAltText('Reference diagram');
    expect(thumbnail).toHaveAttribute('src', expect.stringContaining('/missing-image.png'));

    fireEvent.error(thumbnail);
    expect(thumbnail).toHaveAttribute('src', expect.stringContaining('/working-image.png'));

    expect(screen.queryByText(/tap to zoom/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^zoom$/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^reference diagram$/i }));

    expect(screen.getByRole('dialog', { name: /reference diagram zoomed view/i })).toBeInTheDocument();
    expect(screen.getByText(/zoom only/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset image zoom/i })).toHaveTextContent('100%');

    fireEvent.click(screen.getByRole('button', { name: /zoom in image/i }));
    expect(screen.getByRole('button', { name: /reset image zoom/i })).toHaveTextContent('120%');
  });

  it('treats 100% as fit-to-viewport baseline and reset returns to that fit', () => {
    render(
      <StudentZoomableMedia
        sources={['/tall-image.png']}
        alt="Tall chart"
        label="Tall chart"
        hint="Tap to zoom the chart"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^tall chart$/i }));

    const viewport = screen.getByTestId('zoom-media-viewport');
    const viewportRectSpy = vi.spyOn(viewport, 'getBoundingClientRect');
    viewportRectSpy.mockReturnValue({
      width: 800,
      height: 500,
      top: 0,
      left: 0,
      right: 800,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const image = screen.getByTestId('zoom-media-image') as HTMLImageElement;
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1200 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1800 });
    fireEvent.load(image);

    expect(screen.getByRole('button', { name: /reset image zoom/i })).toHaveTextContent('100%');
    expect(parseFloat(image.style.width)).toBeCloseTo(333.3333, 3);
    expect(parseFloat(image.style.height)).toBeCloseTo(500, 3);

    fireEvent.click(screen.getByRole('button', { name: /zoom in image/i }));
    expect(parseFloat(image.style.width)).toBeCloseTo(400, 3);
    expect(parseFloat(image.style.height)).toBeCloseTo(600, 3);

    fireEvent.click(screen.getByRole('button', { name: /reset image zoom/i }));
    expect(screen.getByRole('button', { name: /reset image zoom/i })).toHaveTextContent('100%');
    expect(parseFloat(image.style.width)).toBeCloseTo(333.3333, 3);
    expect(parseFloat(image.style.height)).toBeCloseTo(500, 3);
  });

  it('opens the IELTS viewer full screen on the body, outside the exam layout', () => {
    const { container } = render(
      <StudentExamTypeContext.Provider value="Academic">
        <div style={{ transform: 'translateZ(0)' }}>
          <StudentZoomableMedia sources={['/ants.png']} alt="Ant trap" label="Ant trap" />
        </div>
      </StudentExamTypeContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /^ant trap$/i }));

    const viewer = screen.getByRole('dialog', { name: 'Ant trap zoomed view' });
    expect(viewer.parentElement).toBe(document.body);
    expect(container).not.toContainElement(viewer);
    expect(viewer).toHaveClass('fixed', 'inset-0');

    fireEvent.click(screen.getByRole('button', { name: 'Close image zoom' }));
    expect(screen.queryByRole('dialog', { name: 'Ant trap zoomed view' })).not.toBeInTheDocument();
  });
});
