import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ProtectedInput } from '../ProtectedInput';

const saveStudentAuditEventMock = vi.fn();

vi.mock('../../../services/studentAuditService', () => ({
  saveStudentAuditEvent: (...args: unknown[]) => saveStudentAuditEventMock(...args),
}));

vi.mock('../providers/StudentAttemptProvider', () => ({
  useOptionalStudentAttempt: () => ({
    state: {
      attempt: { scheduleId: 'sched-ctx' },
      attemptId: 'attempt-ctx',
    },
  }),
}));

describe('ProtectedInput', () => {
  afterEach(() => {
    saveStudentAuditEventMock.mockReset();
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
});
