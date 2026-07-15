import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { SecurityTab } from '../SecurityTab';

describe('SecurityTab', () => {
  it('does not expose deleted fullscreen controls and still exposes active security controls', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();

    render(<SecurityTab config={config} onChange={onChange} />);

    expect(screen.queryByText(/fullscreen warning/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/auto re-enter fullscreen/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/max fullscreen violations/i)).not.toBeInTheDocument();
    expect(screen.getByText(/translation warning/i)).toBeInTheDocument();
    expect(screen.getByText(/best-effort deterrence/i)).toBeInTheDocument();
    expect(screen.getByText(/anti-screenshot guard/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/translation warning/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        security: expect.objectContaining({ preventTranslation: false }),
      }),
    );

    fireEvent.click(screen.getByLabelText(/anti-screenshot guard/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        security: expect.objectContaining({ antiScreenshotGuardEnabled: false }),
      }),
    );
  });
});
