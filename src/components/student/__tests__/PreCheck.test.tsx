import React, { StrictMode, act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import { PreCheck } from '../PreCheck';

// Labels of the five silent device checks (runPreCheckChecks). None of them may
// ever appear in the visible briefing (FEX-001: no technical compatibility checklist).
const HIDDEN_CHECK_LABELS = [
  'Browser compatibility',
  'JavaScript runtime',
  'Secure local storage',
  'Network connectivity',
  'Secondary screen detection',
];

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
    expect(screen.getByRole('status')).toHaveTextContent('Preparing your connection');
    expect(screen.queryByText('Waiting for proctor')).not.toBeInTheDocument();
    expect(
      screen.getByText('The timer starts when the proctor begins the exam.', { exact: false }),
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
    expect(screen.getByText(/having trouble reaching the server/i)).toBeInTheDocument();
  });

  it('never surfaces the technical compatibility checklist while the five silent checks still run (FEX-001)', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const config = createDefaultConfig('Academic', 'Academic');

    render(<PreCheck config={config} examTitle="IELTS Academic" candidateName="Ada Lovelace" candidateId="C-42" onComplete={onComplete} />);

    // No checklist UI: none of the device-check labels, requirement copy, or
    // a technical requirements list may be visible in the briefing.
    for (const label of HIDDEN_CHECK_LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/camera/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/microphone/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/browser check/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    // The checks still run silently and are handed to persistence.
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0]?.[0].checks).toHaveLength(5);
  });

  it('shows only enabled sections with their configured durations in the briefing (FEX-001)', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const config = createDefaultConfig('Academic', 'Academic');

    config.sections.listening = { enabled: true, order: 2, duration: 30, label: 'Listening', allowedQuestionTypes: [] };
    config.sections.reading = { enabled: true, order: 1, duration: 60, label: 'Reading', allowedQuestionTypes: [] };
    config.sections.writing.enabled = false;
    config.sections.speaking.enabled = false;

    render(<PreCheck config={config} examTitle="IELTS Academic" onComplete={onComplete} />);

    const sections = screen.getAllByTestId('exam-section');
    expect(sections).toHaveLength(2);
    expect(sections[0]).toHaveTextContent('Reading');
    expect(sections[0]).toHaveTextContent('1 hour');
    expect(sections[1]).toHaveTextContent('Listening');
    expect(sections[1]).toHaveTextContent('30 minutes');
    expect(screen.getByText('1 hour 30 minutes')).toBeInTheDocument();
    expect(screen.queryByText('Writing')).not.toBeInTheDocument();
    expect(screen.queryByText('Speaking')).not.toBeInTheDocument();

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it('persists exactly once under a StrictMode double-mount, reusing the first result (FEX-002)', async () => {
    let resolvePersist: (() => void) | null = null;
    const onComplete = vi
      .fn()
      .mockImplementation(() => new Promise<void>((resolve) => { resolvePersist = resolve; }));
    const config = createDefaultConfig('Academic', 'Academic');

    render(
      <StrictMode>
        <PreCheck config={config} onComplete={onComplete} />
      </StrictMode>,
    );

    // StrictMode runs mount -> cleanup -> mount; the second effect run must
    // not start a second persist with a second device-check result.
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(resolvePersist).not.toBeNull();

    act(() => {
      resolvePersist?.();
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it('still retries with the same result when the first persist fails under a StrictMode double-mount (FEX-002)', async () => {
    const onComplete = vi
      .fn()
      .mockRejectedValueOnce(new Error('Nope'))
      .mockResolvedValueOnce(undefined);
    const config = createDefaultConfig('Academic', 'Academic');

    render(
      <StrictMode>
        <PreCheck config={config} onComplete={onComplete} />
      </StrictMode>,
    );

    // StrictMode: the first persist rejects AFTER the simulated cleanup, so
    // the live (second) effect run must own the retry — otherwise the student
    // is stuck on "Preparing your connection…" forever.
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2), { timeout: 4_000 });
    expect(onComplete.mock.calls[1]?.[0]).toBe(onComplete.mock.calls[0]?.[0]);
    expect(screen.getByText(/having trouble reaching the server/i)).toBeInTheDocument();
  });

  it('reuses the same device-check result across automatic retries (FEX-002)', async () => {
    const onComplete = vi
      .fn()
      .mockRejectedValueOnce(new Error('Nope'))
      .mockResolvedValueOnce(undefined);
    const config = createDefaultConfig('Academic', 'Academic');

    render(<PreCheck config={config} onComplete={onComplete} />);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2), { timeout: 4_000 });
    const firstResult = onComplete.mock.calls[0]?.[0];
    const secondResult = onComplete.mock.calls[1]?.[0];
    // The retry must preserve the SAME device-check result (same completedAt),
    // which is what keeps the backend idempotency identity stable.
    expect(secondResult).toBe(firstResult);
  });
});
