import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import { PreCheck } from '../PreCheck';

describe('PreCheck', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    Object.defineProperty(window, 'getScreenDetails', { value: vi.fn(), configurable: true });
    Object.defineProperty(window, 'localStorage', { value: window.localStorage, configurable: true });
  });

  it('enables continue after checks run and submits precheck', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const config = createDefaultConfig('Academic', 'Academic');

    render(<PreCheck config={config} onComplete={onComplete} onExit={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not block continue when checks fail', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.security.requireFullscreen = true;
    config.security.detectSecondaryScreen = true;

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    Reflect.deleteProperty(window, 'getScreenDetails');

    render(<PreCheck config={config} onComplete={vi.fn()} onExit={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    );
  });

  it('allows iPad secure mode as best-effort instead of failing browser compatibility', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Safari/604.1',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
    Object.defineProperty(document.documentElement, 'webkitRequestFullscreen', {
      value: vi.fn(),
      configurable: true,
    });

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.requireFullscreen = true;
    config.security.detectSecondaryScreen = true;

    const user = userEvent.setup();
    const onComplete = vi.fn();

    render(<PreCheck config={config} onComplete={onComplete} onExit={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const submittedResult = onComplete.mock.calls[0]?.[0];
    const browserCheck = submittedResult?.checks.find(
      (check: { id: string }) => check.id === 'browser',
    );
    expect(browserCheck?.status).toBe('pass');
    expect(browserCheck?.message).toMatch(/iPad secure mode is best-effort/i);
  });

  it('shows submit error and allows retry', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    onComplete.mockRejectedValueOnce(new Error('Nope'));
    const config = createDefaultConfig('Academic', 'Academic');

    render(<PreCheck config={config} onComplete={onComplete} onExit={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText(/Nope/i)).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(),
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onComplete).toHaveBeenCalledTimes(2);
  });
});
