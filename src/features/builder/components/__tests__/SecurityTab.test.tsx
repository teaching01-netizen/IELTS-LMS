import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import { SecurityTab } from '../SecurityTab';

describe('SecurityTab', () => {
  it('exposes toggles to turn off fullscreen and translation warnings', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const onChange = vi.fn();

    render(<SecurityTab config={config} onChange={onChange} />);

    expect(screen.getByText(/fullscreen warning/i)).toBeInTheDocument();
    expect(screen.getByText(/translation warning/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/fullscreen warning/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        security: expect.objectContaining({ requireFullscreen: false }),
      }),
    );

    fireEvent.click(screen.getByLabelText(/translation warning/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        security: expect.objectContaining({ preventTranslation: false }),
      }),
    );
  });
});
