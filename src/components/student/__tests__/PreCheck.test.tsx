import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PreCheck } from '../PreCheck';
import { createDefaultConfig } from '../../../constants/examDefaults';

describe('PreCheck', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
    });
    Object.defineProperty(window, 'getScreenDetails', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(window, 'localStorage', {
      value: window.localStorage,
      configurable: true,
    });
  });

  it('enters fullscreen before completing when the exam requires fullscreen', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: requestFullscreen,
      configurable: true,
    });
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
    });

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.requireFullscreen = true;

    render(<PreCheck config={config} onComplete={onComplete} onExit={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
