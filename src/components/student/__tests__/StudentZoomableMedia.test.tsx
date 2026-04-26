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

    expect(screen.getByRole('dialog', { name: /reference diagram zoomed view/i })).toBeInTheDocument();
    expect(screen.getByText(/zoom only/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /zoom in image/i }));
    expect(screen.getByRole('button', { name: /reset image zoom/i })).toHaveTextContent('155%');
  });
});
