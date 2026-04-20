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

  it('allows mobile/iPad only when fullscreen and secondary screen detection are disabled', async () => {
    const onComplete = vi.fn();

    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    Reflect.deleteProperty(window, 'getScreenDetails');
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: undefined,
      configurable: true,
    });

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.requireFullscreen = false;
    config.security.detectSecondaryScreen = false;

    render(<PreCheck config={config} onComplete={onComplete} onExit={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    );
  });

  it('blocks mobile/iPad when secure mode is enabled', async () => {
    const onComplete = vi.fn();

    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    Reflect.deleteProperty(window, 'getScreenDetails');

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.requireFullscreen = false;
    config.security.detectSecondaryScreen = true;

    render(<PreCheck config={config} onComplete={onComplete} onExit={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/Mobile\/iPad is supported only in non-secure mode/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('requires Safari acknowledgement when secondary screen detection is enabled but unsupported', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      configurable: true,
    });
    Reflect.deleteProperty(window, 'getScreenDetails');

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.requireFullscreen = false;
    config.security.detectSecondaryScreen = true;
    config.security.allowSafariWithAcknowledgement = true;

    render(<PreCheck config={config} onComplete={onComplete} onExit={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/Safari acknowledgment required/i)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('checkbox'));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    );
  });
});
