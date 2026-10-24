import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectedInput } from '../ProtectedInput';
import { StudentExamTypeContext } from '../layout/studentExamTypeContext';

vi.mock('../../../services/studentAuditService', () => ({
  saveStudentAuditEvent: vi.fn(),
}));

vi.mock('../providers/StudentAttemptProvider', () => ({
  useOptionalStudentAttemptControls: () => undefined,
}));

const security = { preventAutofill: true, preventAutocorrect: true };

function renderAnswer(examType: 'Academic' | 'ACT' | null) {
  const field = <ProtectedInput name="p1-q1" security={security} aria-label="Answer 1" />;
  return render(
    examType ? (
      <StudentExamTypeContext.Provider value={examType}>{field}</StudentExamTypeContext.Provider>
    ) : (
      field
    ),
  );
}

describe('ProtectedInput answer wrapping', () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('wraps IELTS answers in a textarea', () => {
    renderAnswer('Academic');

    expect(screen.getByRole('textbox', { name: 'Answer 1' }).tagName).toBe('TEXTAREA');
  });

  it('keeps the single-line input for ACT and outside an exam shell', () => {
    const { unmount } = renderAnswer('ACT');
    expect(screen.getByRole('textbox', { name: 'Answer 1' }).tagName).toBe('INPUT');
    unmount();

    renderAnswer(null);
    expect(screen.getByRole('textbox', { name: 'Answer 1' }).tagName).toBe('INPUT');
  });

  it('does not let Enter add a line break to an IELTS answer', () => {
    renderAnswer('Academic');

    const notCancelled = fireEvent.keyDown(screen.getByRole('textbox', { name: 'Answer 1' }), { key: 'Enter' });

    expect(notCancelled).toBe(false);
  });

  it('collapses pasted line breaks into one line of text', () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    renderAnswer('Academic');

    const notCancelled = fireEvent.paste(screen.getByRole('textbox', { name: 'Answer 1' }), {
      clipboardData: { getData: () => 'first line\r\nsecond line\n\nthird' },
    });

    expect(notCancelled).toBe(false);
    expect(execCommand).toHaveBeenCalledWith('insertText', false, 'first line second line third');
  });
});
