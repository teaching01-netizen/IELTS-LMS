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
});
