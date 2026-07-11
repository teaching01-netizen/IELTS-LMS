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

  it('shows configured exam briefing and silently submits compatibility details', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const config = createDefaultConfig('Academic', 'Academic');

    config.sections.listening = { enabled: true, order: 2, duration: 30, label: 'Listening', allowedQuestionTypes: [] };
    config.sections.reading = { enabled: true, order: 1, duration: 60, label: 'Reading', allowedQuestionTypes: [] };
    config.sections.writing.enabled = false;
    config.sections.speaking.enabled = false;
    render(<PreCheck config={config} examTitle="IELTS Academic" candidateName="Ada Lovelace" candidateId="C-42" onComplete={onComplete} onExit={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Before you continue' })).toBeInTheDocument();
    expect(screen.getByText('IELTS Academic')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('C-42')).toBeInTheDocument();
    expect(screen.getByText('1 hour 30 minutes')).toBeInTheDocument();
    expect(screen.getByText('After you continue, you will enter the waiting room. Your exam timer will not begin while you are waiting. The timer will begin when the proctor starts the exam.')).toBeInTheDocument();
    expect(screen.getByText('Your answers will be saved automatically. If your connection is interrupted, return using the same device and browser. Refreshing or leaving the page will not pause the timer after the exam begins.')).toBeInTheDocument();
    expect(screen.queryByText(/system checking/i)).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue to waiting room' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Continue to waiting room' }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0].checks).toHaveLength(5);
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave exam' })).toBeInTheDocument();
  });

  it('does not block continue when checks fail', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.security.requireFullscreen = true;
    config.security.detectSecondaryScreen = true;

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    Reflect.deleteProperty(window, 'getScreenDetails');

    render(<PreCheck config={config} onComplete={vi.fn()} onExit={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue to waiting room' })).toBeEnabled(),
    );
  });

  it('does not include fullscreen checks for legacy fullscreen configs', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Safari/604.1',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
    const config = createDefaultConfig('Academic', 'Academic');
    config.security.requireFullscreen = true;
    config.security.detectSecondaryScreen = true;

    const user = userEvent.setup();
    const onComplete = vi.fn();

    render(<PreCheck config={config} onComplete={onComplete} onExit={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue to waiting room' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Continue to waiting room' }));

    const submittedResult = onComplete.mock.calls[0]?.[0];
    expect(submittedResult?.checks.some((check: { id: string }) => check.id === 'fullscreen')).toBe(false);
    const browserCheck = submittedResult?.checks.find(
      (check: { id: string }) => check.id === 'browser',
    );
    expect(browserCheck?.status).toBe('pass');
    expect(browserCheck?.message).not.toMatch(/fullscreen/i);
  });

  it('shows submit error and allows retry', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    onComplete.mockRejectedValueOnce(new Error('Nope'));
    const config = createDefaultConfig('Academic', 'Academic');

    render(<PreCheck config={config} onComplete={onComplete} onExit={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue to waiting room' })).toBeEnabled(),
    );

    await user.click(screen.getByRole('button', { name: 'Continue to waiting room' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('We could not continue to the waiting room. Please try again.'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue to waiting room' })).toBeEnabled(),
    );

    await user.click(screen.getByRole('button', { name: 'Continue to waiting room' }));
    expect(onComplete).toHaveBeenCalledTimes(2);
  });
});
