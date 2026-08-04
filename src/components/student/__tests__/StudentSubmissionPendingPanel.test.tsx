import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentSubmissionPendingPanel } from '../StudentSubmissionPendingPanel';

describe('StudentSubmissionPendingPanel (FEX-051)', () => {
  it('renders the pending contract copy and never claims the exam was submitted', () => {
    render(<StudentSubmissionPendingPanel onRetryNow={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Submission pending' })).toBeInTheDocument();
    expect(
      screen.getByText(/Your answers are stored on this device\. Keep this page open while we confirm your submission\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Exam submitted|IELTS Examination Complete/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument();
  });

  it('fires the retry action and toggles connection guidance', () => {
    const onRetryNow = vi.fn();
    render(<StudentSubmissionPendingPanel onRetryNow={onRetryNow} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(onRetryNow).toHaveBeenCalledTimes(1);

    const guidanceToggle = screen.getByRole('button', { name: 'View connection guidance' });
    expect(guidanceToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Check that you are connected to the internet\./)).not.toBeInTheDocument();

    fireEvent.click(guidanceToggle);
    expect(guidanceToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Check that you are connected to the internet\./)).toBeInTheDocument();
    expect(screen.getByText(/Submission retries automatically; do not close this tab\./)).toBeInTheDocument();

    fireEvent.click(guidanceToggle);
    expect(guidanceToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Check that you are connected to the internet\./)).not.toBeInTheDocument();
  });

  it('exposes the pending state as a modal alertdialog and moves focus to the primary action (M5)', () => {
    render(<StudentSubmissionPendingPanel onRetryNow={vi.fn()} />);

    const dialog = screen.getByRole('alertdialog', { name: 'Submission pending' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/stored on this device/i);
    expect(dialog.querySelector('[aria-live]')).not.toBeNull();
    // Initial focus lands on the primary action so keyboard/screen-reader
    // users can act immediately.
    expect(screen.getByRole('button', { name: 'Retry now' })).toHaveFocus();
  });

  it('restores focus to the previously focused element on unmount (M5)', () => {
    const before = document.createElement('button');
    before.textContent = 'Before';
    document.body.appendChild(before);
    before.focus();

    const { unmount } = render(<StudentSubmissionPendingPanel onRetryNow={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Retry now' })).toHaveFocus();

    unmount();
    expect(document.activeElement).toBe(before);
    before.remove();
  });
});
