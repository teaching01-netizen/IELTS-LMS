import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectedSelect } from '../ProtectedSelect';

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
}));

describe('ProtectedSelect', () => {
  afterEach(() => {
    flushAnswerDurabilityNowMock.mockReset();
    vi.restoreAllMocks();
  });

  it('commits the latest DOM value on pagehide when controlled state is stale', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedSelect value="A" onChange={handleChange} aria-label="select answer">
        <option value="A">A</option>
        <option value="B">B</option>
      </ProtectedSelect>,
    );

    const select = screen.getByRole('combobox', { name: 'select answer' }) as HTMLSelectElement;
    select.value = 'B';

    fireEvent(window, new Event('pagehide'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { value?: unknown } }).target?.value).toBe('B');
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('commits the latest DOM value on focusout when controlled state is stale', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedSelect value="A" onChange={handleChange} aria-label="select answer">
        <option value="A">A</option>
        <option value="B">B</option>
      </ProtectedSelect>,
    );

    const select = screen.getByRole('combobox', { name: 'select answer' }) as HTMLSelectElement;
    select.value = 'B';

    fireEvent(select, new FocusEvent('focusout', { bubbles: true }));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { value?: unknown } }).target?.value).toBe('B');
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('commits the latest DOM value on beforeunload when controlled state is stale', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedSelect value="A" onChange={handleChange} aria-label="select answer">
        <option value="A">A</option>
        <option value="B">B</option>
      </ProtectedSelect>,
    );

    const select = screen.getByRole('combobox', { name: 'select answer' }) as HTMLSelectElement;
    select.value = 'B';

    fireEvent(window, new Event('beforeunload'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { value?: unknown } }).target?.value).toBe('B');
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });
});
