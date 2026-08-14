import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentToolsSheet } from '../StudentToolsSheet';

describe('StudentToolsSheet', () => {
  it('renders as an open native dialog with safe-area spacing', () => {
    render(
      <StudentToolsSheet open onClose={() => undefined}>
        <button type="button">First action</button>
        <button type="button">Second action</button>
      </StudentToolsSheet>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Exam tools' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveClass('student-tools-sheet');
    expect(dialog).toHaveClass('pb-[max(1rem,var(--student-safe-bottom))]');
  });

  it('wraps Tab focus inside the open sheet and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <StudentToolsSheet open onClose={onClose}>
        <button type="button">First action</button>
        <button type="button">Second action</button>
      </StudentToolsSheet>,
    );

    const first = screen.getByRole('button', { name: 'Close exam tools' });
    const last = screen.getByRole('button', { name: 'Second action' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(first, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
