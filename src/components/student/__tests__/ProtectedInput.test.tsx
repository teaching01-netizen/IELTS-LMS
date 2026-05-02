import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ProtectedInput } from '../ProtectedInput';

const saveStudentAuditEventMock = vi.fn();
const flushAnswerDurabilityNowMock = vi.fn();

vi.mock('../../../services/studentAuditService', () => ({
  saveStudentAuditEvent: (...args: unknown[]) => saveStudentAuditEventMock(...args),
}));

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

describe('ProtectedInput', () => {
  afterEach(() => {
    saveStudentAuditEventMock.mockReset();
    flushAnswerDurabilityNowMock.mockReset();
    vi.restoreAllMocks();
  });

  it('does not emit paste audit events (clipboard enforcement lives at document level)', () => {
    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        sessionId="sched-1"
        studentId="attempt-1"
      />,
    );

    const input = screen.getByRole('textbox');
    fireEvent.paste(input);

    expect(saveStudentAuditEventMock).not.toHaveBeenCalled();
  });

  it('defaults audit IDs from attempt context when props are omitted', () => {
    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
      />,
    );

    const input = screen.getByRole('textbox');
    const event = new Event('beforeinput', { bubbles: true, cancelable: true });
    Object.assign(event, { inputType: 'insertReplacementText', data: 'x' });
    fireEvent(input, event);

    expect(saveStudentAuditEventMock).toHaveBeenCalledWith(
      'sched-ctx',
      'AUTOFILL_SUSPECTED',
      expect.any(Object),
      'attempt-ctx',
    );
  });

  it('commits the latest DOM value on pagehide (iPad/Safari last-keystroke protection)', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="abc"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;

    // Simulate the iOS/Safari failure mode: the DOM has a newer value than React state,
    // but no input/change event was delivered before the page is backgrounded.
    input.value = 'abcd';

    fireEvent(window, new Event('pagehide'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { value?: unknown } }).target?.value).toBe('abcd');
  });

  it('forces immediate answer durability flush after pagehide DOM rescue commit', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="abc"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'abcd';

    fireEvent(window, new Event('pagehide'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('commits the latest DOM value on focusout when controlled state is stale', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="abc"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'abcd';

    fireEvent(input, new FocusEvent('focusout', { bubbles: true }));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { value?: unknown } }).target?.value).toBe('abcd');
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('commits the latest DOM value on beforeunload when controlled state is stale', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="abc"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'abcd';

    fireEvent(window, new Event('beforeunload'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((handleChange.mock.calls[0]?.[0] as { target?: { value?: unknown } }).target?.value).toBe('abcd');
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes DOM rescue commits across sequential lifecycle events for the same value', () => {
    const handleChange = vi.fn();

    render(
      <ProtectedInput
        security={{ preventAutofill: true, preventAutocorrect: true } as any}
        name="answer"
        value="abc"
        onChange={handleChange}
      />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    input.value = 'abcd';

    fireEvent(input, new FocusEvent('focusout', { bubbles: true }));
    fireEvent(window, new Event('pagehide'));
    fireEvent(window, new Event('beforeunload'));

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect(flushAnswerDurabilityNowMock).toHaveBeenCalledTimes(1);
  });
});
