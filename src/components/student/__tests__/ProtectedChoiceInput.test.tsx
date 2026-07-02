import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectedChoiceInput } from '../ProtectedChoiceInput';

const flushAnswerDurabilityNowMock = vi.fn();

vi.mock('../providers/StudentAttemptProvider', () => ({
  useOptionalStudentAttempt: () => ({
    state: {
      attempt: { scheduleId: 'sched-ctx' },
      attemptId: 'attempt-ctx',
    },
    actions: {
      flushAnswerDurabilityNow: (...args: unknown[]) => flushAnswerDurabilityNowMock(...args),
    },
  }),
  useOptionalStudentAttemptControls: () => ({
    getScheduleId: () => 'sched-ctx',
    getAttemptId: () => 'attempt-ctx',
    flushAnswerDurabilityNow: (...args: unknown[]) => flushAnswerDurabilityNowMock(...args),
  }),
}));

describe('ProtectedChoiceInput', () => {
  afterEach(() => {
    flushAnswerDurabilityNowMock.mockReset();
    vi.restoreAllMocks();
  });

  it('commits latest checked state on pagehide when controlled state is stale', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedChoiceInput
        type="checkbox"
        checked={false}
        onChange={handleChange}
        aria-label="choice answer"
      />,
    );

    const input = screen.getByRole('checkbox', { name: 'choice answer' }) as HTMLInputElement;
    input.checked = true;

    fireEvent(window, new Event('pagehide'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { checked?: unknown } }).target?.checked).toBe(true);
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('emits live checked callback on checkbox change', () => {
    const onLiveCheckedChange = vi.fn();
    render(
      <ProtectedChoiceInput
        type="checkbox"
        checked={false}
        onChange={vi.fn()}
        onLiveCheckedChange={onLiveCheckedChange}
        aria-label="choice answer"
      />,
    );

    const input = screen.getByRole('checkbox', { name: 'choice answer' }) as HTMLInputElement;
    fireEvent.change(input, { target: { checked: true } });
    expect(onLiveCheckedChange).toHaveBeenCalledWith(true);
  });

  it('commits latest checked state on focusout when controlled state is stale', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedChoiceInput
        type="checkbox"
        checked={false}
        onChange={handleChange}
        aria-label="choice answer"
      />,
    );

    const input = screen.getByRole('checkbox', { name: 'choice answer' }) as HTMLInputElement;
    input.checked = true;

    fireEvent(input, new FocusEvent('focusout', { bubbles: true }));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { checked?: unknown } }).target?.checked).toBe(true);
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('commits latest checked state on beforeunload when controlled state is stale', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedChoiceInput
        type="checkbox"
        checked={false}
        onChange={handleChange}
        aria-label="choice answer"
      />,
    );

    const input = screen.getByRole('checkbox', { name: 'choice answer' }) as HTMLInputElement;
    input.checked = true;

    fireEvent(window, new Event('beforeunload'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { checked?: unknown } }).target?.checked).toBe(true);
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('commits a deferred focusout rescue when iPad applies a late checked value', async () => {
    vi.useFakeTimers();
    const handleChange = vi.fn();

    render(
      <ProtectedChoiceInput
        type="checkbox"
        checked={false}
        onChange={handleChange}
        aria-label="choice answer"
      />,
    );

    const input = screen.getByRole('checkbox', { name: 'choice answer' }) as HTMLInputElement;
    fireEvent(input, new FocusEvent('focusout', { bubbles: true }));
    expect(handleChange).not.toHaveBeenCalled();

    input.checked = true;
    vi.advanceTimersByTime(0);
    await Promise.resolve();

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { checked?: unknown } }).target?.checked).toBe(true);
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
