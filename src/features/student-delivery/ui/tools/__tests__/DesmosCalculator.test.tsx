import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { desmosEmbedUrl } from '../../../infrastructure/desmos/desmosTypes';
import { DesmosCalculator, type DesmosOutcomeEvent } from '../DesmosCalculator';

describe('DesmosCalculator', () => {
  it('loads only the selected calculator until another mode is activated', () => {
    render(<DesmosCalculator mode="scientific" />);

    const scientific = screen.getByTitle('Desmos scientific calculator, College Board testing version');

    // Phase 03 deliberate contract change: the embed carries the explicit
    // exam locale (SAT_EXAM_LOCALE). Base path + ?embed marker preserved.
    expect(scientific).toHaveAttribute('src', desmosEmbedUrl('scientific'));
    expect(scientific.getAttribute('src')).toContain('lang=en');
    expect(scientific).toHaveClass('block');
    expect(
      screen.queryByTitle('Desmos graphing calculator, College Board testing version'),
    ).not.toBeInTheDocument();
  });

  it('keeps an activated embed mounted when switching modes', () => {
    const { rerender } = render(<DesmosCalculator mode="scientific" />);
    const scientific = screen.getByTitle('Desmos scientific calculator, College Board testing version');

    fireEvent.load(scientific);
    rerender(<DesmosCalculator mode="graphing" />);
    const graphing = screen.getByTitle('Desmos graphing calculator, College Board testing version');
    fireEvent.load(graphing);

    expect(scientific).toBeInTheDocument();
    expect(graphing).toBeInTheDocument();
    expect(scientific).toHaveClass('invisible');
    expect(graphing).toHaveClass('block');
    expect(screen.queryByText('Loading calculator…')).not.toBeInTheDocument();
    // Both frames share the frozen exam locale so reveal never reloads.
    expect(graphing.getAttribute('src')).toContain('lang=en');
  });

  it('requests the exam locale explicitly and never inherits the browser locale', () => {
    render(<DesmosCalculator mode="graphing" />);
    const graphing = screen.getByTitle('Desmos graphing calculator, College Board testing version');
    expect(graphing).toHaveAttribute('src', desmosEmbedUrl('graphing'));
    expect(graphing.getAttribute('src')).toContain('lang=en');
    expect(graphing.getAttribute('src')).toContain('?embed');
  });

  it('lays out both modes while keeping the inactive frame inert and inaccessible', () => {
    render(<DesmosCalculator mode="scientific" prewarmInactiveModes eagerInactive />);
    const scientific = screen.getByTitle('Desmos scientific calculator, College Board testing version');
    const graphing = screen.getByTitle('Desmos graphing calculator, College Board testing version');
    expect(scientific).toHaveClass('absolute', 'block');
    expect(graphing).toHaveClass('absolute', 'invisible');
    expect(graphing).toHaveAttribute('inert');
    expect(graphing).toHaveAttribute('aria-hidden', 'true');
    expect(graphing).toHaveAttribute('tabindex', '-1');
    expect(graphing.style.width).toBe('100%');
    expect(graphing.style.height).toBe('100%');
  });

  it('mounts only the active mode until eagerInactive allows the second', () => {
    const { rerender } = render(<DesmosCalculator mode="scientific" prewarmInactiveModes />);
    expect(
      screen.queryByTitle('Desmos graphing calculator, College Board testing version'),
    ).not.toBeInTheDocument();
    expect(screen.getByTitle('Desmos scientific calculator, College Board testing version')).toBeInTheDocument();

    rerender(<DesmosCalculator mode="scientific" prewarmInactiveModes eagerInactive />);
    expect(
      screen.getByTitle('Desmos graphing calculator, College Board testing version'),
    ).toBeInTheDocument();
  });

  it('reports ready with durationMs and data attrs on load', () => {
    const onDesmosOutcome = vi.fn();
    render(<DesmosCalculator mode="graphing" onDesmosOutcome={onDesmosOutcome} />);
    const container = screen.getByLabelText('Desmos calculator');
    expect(container).toHaveAttribute('data-desmos-status', 'loading');

    const graphing = screen.getByTitle('Desmos graphing calculator, College Board testing version');
    expect(graphing).toHaveAttribute('data-desmos-mode-status', 'loading');
    fireEvent.load(graphing);

    expect(container).toHaveAttribute('data-desmos-status', 'ready');
    expect(container).toHaveAttribute('data-desmos-ready', 'true');
    expect(graphing).toHaveAttribute('data-desmos-mode-status', 'ready');
    expect(onDesmosOutcome).toHaveBeenCalledTimes(1);
    const event = onDesmosOutcome.mock.calls[0]?.[0] as DesmosOutcomeEvent;
    expect(event.mode).toBe('graphing');
    expect(event.outcome).toBe('ready');
    expect(event.durationMs).toEqual(expect.any(Number));
    expect(event.retryCount).toBe(0);
  });

  it('resolves a stalled frame to timeout with error UI and Retry within the watchdog budget', async () => {
    const onDesmosOutcome = vi.fn();
    render(<DesmosCalculator mode="scientific" watchdogMs={30} onDesmosOutcome={onDesmosOutcome} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Calculator unavailable');
    const container = screen.getByLabelText('Desmos calculator');
    expect(container).toHaveAttribute('data-desmos-status', 'timeout');
    expect(container).toHaveAttribute('data-desmos-error', 'scientific:timeout');
    expect(screen.queryByText('Loading calculator…')).not.toBeInTheDocument();
    expect(onDesmosOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'scientific', outcome: 'timeout', retryCount: 0 }),
    );

    // Retry remounts the same mode (single document) back into loading.
    fireEvent.click(screen.getByRole('button', { name: 'Retry calculator' }));
    expect(container).toHaveAttribute('data-desmos-status', 'loading');
    expect(screen.getByText('Loading calculator…')).toBeInTheDocument();
  });

  it('classifies a fast frame error as blocked with a network hint', () => {
    const onDesmosOutcome = vi.fn();
    render(<DesmosCalculator mode="scientific" watchdogMs={60_000} onDesmosOutcome={onDesmosOutcome} />);
    const scientific = screen.getByTitle('Desmos scientific calculator, College Board testing version');
    fireEvent.error(scientific);

    const container = screen.getByLabelText('Desmos calculator');
    expect(container).toHaveAttribute('data-desmos-status', 'blocked');
    expect(container).toHaveAttribute('data-desmos-error', 'scientific:blocked');
    expect(screen.getByRole('alert')).toHaveTextContent('blocked on this network');
    expect(onDesmosOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'scientific', outcome: 'blocked', retryCount: 0 }),
    );
  });

  it('allows at most three user retries, then locks Retry without blocking the exam', () => {
    render(<DesmosCalculator mode="scientific" watchdogMs={60_000} />);
    const scientific = () =>
      screen.getByTitle('Desmos scientific calculator, College Board testing version');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      fireEvent.error(scientific());
      fireEvent.click(screen.getByRole('button', { name: 'Retry calculator' }));
    }
    expect(screen.getByLabelText('Desmos calculator')).toHaveAttribute(
      'data-desmos-status',
      'loading',
    );
    fireEvent.error(scientific());
    const retry = screen.getByRole('button', { name: 'Retry unavailable — keep answering' });
    expect(retry).toBeDisabled();
    // The student can still answer: the failure is contained to the tool.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(scientific()).toBeInTheDocument();
  });

  it('treats a desmos-origin HTTP failure (503) as an error, never ready', () => {
    // TRACK-A-01: shed 503s commit a desmos-origin document that fires `load`.
    // Resource Timing responseStatus (visible with Timing-Allow-Origin) proves
    // the failure where the cross-origin href probe cannot.
    const entriesByName = vi.spyOn(performance, 'getEntriesByName').mockReturnValue([
      { responseStatus: 503, name: desmosEmbedUrl('scientific') } as PerformanceResourceTiming,
    ]);
    try {
      const onDesmosOutcome = vi.fn();
      render(<DesmosCalculator mode="scientific" watchdogMs={60_000} onDesmosOutcome={onDesmosOutcome} />);
      const scientific = screen.getByTitle('Desmos scientific calculator, College Board testing version');
      fireEvent.load(scientific);

      const container = screen.getByLabelText('Desmos calculator');
      expect(container).toHaveAttribute('data-desmos-ready', 'false');
      expect(screen.getByRole('alert')).toHaveTextContent('Calculator unavailable');
      expect(onDesmosOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'scientific', retryCount: 0 }),
      );
      const event = onDesmosOutcome.mock.calls[0]?.[0] as DesmosOutcomeEvent;
      expect(['timeout', 'blocked', 'error']).toContain(event.outcome);
      expect(event.outcome).not.toBe('ready');
    } finally {
      entriesByName.mockRestore();
    }
  });

  it('removes the calculator iframe from keyboard interaction when the proctor pauses the exam', async () => {
    const { rerender } = render(<DesmosCalculator mode="graphing" />);
    const graphing = screen.getByTitle('Desmos graphing calculator, College Board testing version');
    graphing.focus();
    expect(document.activeElement).toBe(graphing);

    rerender(<DesmosCalculator mode="graphing" disabled />);
    await waitFor(() => expect(document.activeElement).not.toBe(graphing));
    expect(graphing).toHaveAttribute('tabindex', '-1');
    expect(graphing).toHaveAttribute('inert', '');
    expect(screen.getByText('Paused by proctor')).toBeInTheDocument();
  });
});
