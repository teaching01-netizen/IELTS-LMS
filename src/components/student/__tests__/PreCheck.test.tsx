import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('shows the waiting room and silently submits compatibility details without any button', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const config = createDefaultConfig('Academic', 'Academic');

    config.sections.listening = { enabled: true, order: 2, duration: 30, label: 'Listening', allowedQuestionTypes: [] };
    config.sections.reading = { enabled: true, order: 1, duration: 60, label: 'Reading', allowedQuestionTypes: [] };
    config.sections.writing.enabled = false;
    config.sections.speaking.enabled = false;
    render(<PreCheck config={config} examTitle="IELTS Academic" candidateName="Ada Lovelace" candidateId="C-42" onComplete={onComplete} />);

    expect(screen.getByRole('heading', { name: 'Waiting for the exam to start' })).toBeInTheDocument();
    expect(screen.getByText('IELTS Academic')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('C-42')).toBeInTheDocument();
    expect(screen.getByText('1 hour 30 minutes')).toBeInTheDocument();
    expect(screen.getByText('Waiting for proctor')).toBeInTheDocument();
    expect(
      screen.getByText('The timer will begin when the proctor starts the exam.', { exact: false }),
    ).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Continue to waiting room' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave exam' })).not.toBeInTheDocument();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0]?.[0].checks).toHaveLength(5);
  });

  it('retries persistence automatically when it fails, without a student action', async () => {
    const onComplete = vi
      .fn()
      .mockRejectedValueOnce(new Error('Nope'))
      .mockResolvedValueOnce(undefined);
    const config = createDefaultConfig('Academic', 'Academic');

    render(<PreCheck config={config} onComplete={onComplete} />);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2), { timeout: 4_000 });
    expect(screen.getByRole('heading', { name: 'Waiting for the exam to start' })).toBeInTheDocument();
  });
});
