import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WarningOverlay } from '../WarningOverlay';

describe('WarningOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <WarningOverlay
        isOpen={false}
        severity="medium"
        message="Test message"
        onAcknowledge={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders medium severity overlay with correct title', () => {
    render(
      <WarningOverlay
        isOpen={true}
        severity="medium"
        message="Test warning"
        onAcknowledge={vi.fn()}
      />,
    );
    expect(screen.getByText('ATTENTION')).toBeInTheDocument();
    expect(screen.getByText('Test warning')).toBeInTheDocument();
  });

  it('renders high severity overlay with correct title', () => {
    render(
      <WarningOverlay
        isOpen={true}
        severity="high"
        message="High warning"
        onAcknowledge={vi.fn()}
      />,
    );
    expect(screen.getByText('WARNING — FINAL NOTICE')).toBeInTheDocument();
    expect(screen.getByText('High warning')).toBeInTheDocument();
  });

  it('renders critical severity overlay with correct title', () => {
    render(
      <WarningOverlay
        isOpen={true}
        severity="critical"
        message="Critical warning"
        onAcknowledge={vi.fn()}
      />,
    );
    expect(screen.getByText('EXAM PAUSED')).toBeInTheDocument();
    expect(screen.getByText('Critical warning')).toBeInTheDocument();
  });

  it('calls onAcknowledge when I Understand button is clicked', () => {
    const onAcknowledge = vi.fn();
    render(
      <WarningOverlay
        isOpen={true}
        severity="medium"
        message="Test"
        onAcknowledge={onAcknowledge}
      />,
    );
    fireEvent.click(screen.getByText('I Understand'));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('renders custom action button when provided', () => {
    const onClick = vi.fn();
    render(
      <WarningOverlay
        isOpen={true}
        severity="medium"
        message="Test"
        onAcknowledge={vi.fn()}
        actionButton={{ label: 'Custom Action', onClick }}
      />,
    );
    fireEvent.click(screen.getByText('Custom Action'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows countdown timer when showCountdown is true', () => {
    render(
      <WarningOverlay
        isOpen={true}
        severity="medium"
        message="Test"
        onAcknowledge={vi.fn()}
        showCountdown={true}
      />,
    );
    expect(screen.getByText(/Auto-dismiss in:/)).toBeInTheDocument();
  });

  it('hides countdown timer when showCountdown is false', () => {
    render(
      <WarningOverlay
        isOpen={true}
        severity="medium"
        message="Test"
        onAcknowledge={vi.fn()}
        showCountdown={false}
      />,
    );
    expect(screen.queryByText(/Auto-dismiss in:/)).not.toBeInTheDocument();
  });

  it('auto-dismisses after countdown reaches zero', () => {
    const onAcknowledge = vi.fn();
    render(
      <WarningOverlay
        isOpen={true}
        severity="medium"
        message="Test"
        onAcknowledge={onAcknowledge}
        showCountdown={true}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('does not auto-dismiss when showCountdown is false', () => {
    const onAcknowledge = vi.fn();
    render(
      <WarningOverlay
        isOpen={true}
        severity="medium"
        message="Test"
        onAcknowledge={onAcknowledge}
        showCountdown={false}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it('does not auto-dismiss for critical severity (no button shown)', () => {
    const onAcknowledge = vi.fn();
    render(
      <WarningOverlay
        isOpen={true}
        severity="critical"
        message="Critical"
        onAcknowledge={onAcknowledge}
        showCountdown={true}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it('renders blackout appearance', () => {
    render(
      <WarningOverlay
        isOpen={true}
        severity="medium"
        message="Blackout test"
        onAcknowledge={vi.fn()}
        appearance="blackout"
      />,
    );
    expect(screen.getByText('Screen Capture Blocked')).toBeInTheDocument();
    expect(screen.getByText('Blackout test')).toBeInTheDocument();
  });

  it('calls onAcknowledge in blackout mode when Continue Exam is clicked', () => {
    const onAcknowledge = vi.fn();
    render(
      <WarningOverlay
        isOpen={true}
        severity="medium"
        message="Blackout"
        onAcknowledge={onAcknowledge}
        appearance="blackout"
      />,
    );
    fireEvent.click(screen.getByText('Continue Exam'));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('resets countdown when isOpen changes from false to true', () => {
    const onAcknowledge = vi.fn();
    const { rerender } = render(
      <WarningOverlay
        isOpen={false}
        severity="medium"
        message="Test"
        onAcknowledge={onAcknowledge}
        showCountdown={true}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    rerender(
      <WarningOverlay
        isOpen={true}
        severity="medium"
        message="Test"
        onAcknowledge={onAcknowledge}
        showCountdown={true}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(25_000);
    });

    expect(onAcknowledge).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });
});
