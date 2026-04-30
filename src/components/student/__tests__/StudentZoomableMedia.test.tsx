import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudentZoomableMedia } from '../StudentZoomableMedia';

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

    fireEvent.click(screen.getByRole('button', { name: /reference diagram\. tap to zoom the diagram/i }));

    const dialog = screen.getByRole('dialog', { name: /reference diagram zoomed view/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByText(/zoom only/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /zoom in image/i }));
    expect(screen.getByRole('button', { name: /reset image zoom/i })).toHaveTextContent('155%');

    const viewport = screen.getByTestId('zoomable-media-viewport');
    viewport.scrollLeft = 40;
    viewport.scrollTop = 25;
    expect(viewport).toHaveStyle({ cursor: 'grab' });

    fireEvent.mouseDown(viewport, { button: 0, clientX: 280, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 250, clientY: 155 });
    fireEvent.mouseUp(window);

    expect(viewport.scrollLeft).toBe(70);
    expect(viewport.scrollTop).toBe(70);

    fireEvent.touchStart(viewport, {
      touches: [
        { clientX: 20, clientY: 20 },
        { clientX: 120, clientY: 20 },
      ],
    });
    fireEvent.touchMove(viewport, {
      touches: [
        { clientX: 20, clientY: 20 },
        { clientX: 180, clientY: 20 },
      ],
    });
    fireEvent.touchEnd(viewport, { touches: [] });

    expect(screen.getByRole('button', { name: /reset image zoom/i })).toHaveTextContent('248%');
  });

  it('opens the zoom viewer on a two-finger gesture from the thumbnail', () => {
    render(
      <StudentZoomableMedia
        sources={['/diagram-preview.png']}
        alt="Listening diagram"
        label="Listening diagram"
        hint="Tap to zoom"
      />,
    );

    const trigger = screen.getByRole('button', { name: /listening diagram\. tap to zoom/i });
    fireEvent.touchStart(trigger, {
      touches: [
        { clientX: 30, clientY: 30 },
        { clientX: 120, clientY: 30 },
      ],
    });

    expect(screen.getByRole('dialog', { name: /listening diagram zoomed view/i })).toBeInTheDocument();
  });
});
